import assert from "node:assert/strict";
import { test } from "node:test";
import { ASSISTANT_DEFAULT_MODEL_ROSTER } from "@mcp-token-footprint/shared";
import type {
  AgentSessionDriver,
  DriverModelInfo,
  DriverSession,
  DriverStartOptions,
  DriverSupportedModelsOptions,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import type { ConcurrencyGate } from "../src/testing/subscription-concurrency.js";
import { SubscriptionModelResolver } from "../src/providers/subscription-models.js";

// The LIVE Claude-subscription model roster resolver (planning/Roadmap/RM-09-claude-subscription/ follow-up). Every
// case injects a SCRIPTED FAKE driver returning a FIXED `DriverModelInfo[]` — NO real child is spawned,
// NO Anthropic call is made, NO real filesystem is touched (the workspace factory is a stub).

const OAUTH: AssistantAuthSource = { kind: "claude_oauth", token: "sk-ant-oat01-TESTTOKEN" };

// A live roster shaped like the SDK's — includes an ALIAS row (`sonnet` → `claude-sonnet-5`) to prove
// value-vs-resolvedModel handling, and deliberately does NOT include the stale `claude-sonnet-4-5`.
const LIVE_MODELS: DriverModelInfo[] = [
  { value: "claude-opus-4-8", displayName: "Opus 4.8" },
  { value: "claude-fable-5", displayName: "Fable 5" },
  { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet 5" },
  { value: "claude-haiku-4-5", displayName: "Haiku 4.5" },
];

class FakeDriver implements AgentSessionDriver {
  supportedModelsCalls = 0;
  lastOptions: DriverSupportedModelsOptions | undefined;
  constructor(private readonly behavior: () => Promise<DriverModelInfo[]>) {}
  start(_options: DriverStartOptions): DriverSession {
    throw new Error("start() must never be called by the model resolver");
  }
  async supportedModels(options: DriverSupportedModelsOptions): Promise<DriverModelInfo[]> {
    this.supportedModelsCalls += 1;
    this.lastOptions = options;
    return this.behavior();
  }
}

class CountingGate implements ConcurrencyGate {
  acquires = 0;
  releases = 0;
  async acquire(): Promise<void> {
    this.acquires += 1;
  }
  release(): void {
    this.releases += 1;
  }
}

function makeResolver(opts: {
  driver: FakeDriver;
  gate?: CountingGate;
  resolveAuth?: () => AssistantAuthSource | null;
  now?: () => number;
}): SubscriptionModelResolver {
  return new SubscriptionModelResolver({
    driver: opts.driver,
    resolveAuth: opts.resolveAuth ?? (() => OAUTH),
    gate: opts.gate ?? new CountingGate(),
    // Stub workspace — no real temp dir (the fake driver never spawns anything anyway).
    createWorkspace: async () => ({ dir: "/tmp/fake-sub-models", cleanup: async () => {} }),
    now: opts.now,
  });
}

// ── (a) live models mapped to AvailableModel ────────────────────────────────────────────────────────

test("resolve() maps the SDK live roster to AvailableModel (order + displayName preserved) and gates the spawn", async () => {
  const driver = new FakeDriver(async () => LIVE_MODELS);
  const gate = new CountingGate();
  const resolver = makeResolver({ driver, gate });

  const models = await resolver.resolve();

  assert.deepEqual(models, [
    { id: "claude-opus-4-8", displayName: "Opus 4.8" },
    { id: "claude-fable-5", displayName: "Fable 5" },
    // the alias row's id is its CANONICAL `resolvedModel` (not the `sonnet` alias) — pricing + the
    // maxCostUsd cap only know the canonical id, so a run stores/prices on it.
    { id: "claude-sonnet-5", displayName: "Sonnet 5" },
    { id: "claude-haiku-4-5", displayName: "Haiku 4.5" },
  ]);
  assert.equal(driver.supportedModelsCalls, 1);
  // The probe drew from (and returned) the shared concurrency budget.
  assert.equal(gate.acquires, 1);
  assert.equal(gate.releases, 1);
  // The subscription token was injected into the throwaway child env — never an API key.
  assert.equal(driver.lastOptions?.env.CLAUDE_CODE_OAUTH_TOKEN, OAUTH.token);
});

// ── (b) caches: a second call does not re-spawn ──────────────────────────────────────────────────────

test("resolve() caches the live roster — a second call does NOT re-spawn", async () => {
  const driver = new FakeDriver(async () => LIVE_MODELS);
  const resolver = makeResolver({ driver });

  const first = await resolver.resolve();
  const second = await resolver.resolve();

  assert.deepEqual(second, first);
  assert.equal(driver.supportedModelsCalls, 1);
});

test("resolve() coalesces concurrent callers onto ONE probe", async () => {
  const driver = new FakeDriver(async () => LIVE_MODELS);
  const resolver = makeResolver({ driver });

  const [a, b] = await Promise.all([resolver.resolve(), resolver.resolve()]);

  assert.deepEqual(a, b);
  assert.equal(driver.supportedModelsCalls, 1);
});

// ── (c) fallback to the corrected static roster on error / not-signed-in — never throws ──────────────

test("resolve() falls back to the corrected static roster on a driver error — never throws", async () => {
  const driver = new FakeDriver(async () => {
    throw new Error("spawn failed");
  });
  const resolver = makeResolver({ driver });

  const models = await resolver.resolve();

  assert.deepEqual(models.map((m) => m.id), [...ASSISTANT_DEFAULT_MODEL_ROSTER]);
  // The corrected roster: Sonnet 5 (not 4-5) present, Fable 5 present.
  assert.ok(models.some((m) => m.id === "claude-sonnet-5"));
  assert.ok(models.some((m) => m.id === "claude-fable-5"));
  assert.ok(!models.some((m) => m.id === "claude-sonnet-4-5"));
  // A fallback entry never drives strict validation.
  assert.equal(resolver.cachedSupportedModelIds(), undefined);
});

test("resolve() returns the static roster WITHOUT spawning when not signed in", async () => {
  const driver = new FakeDriver(async () => LIVE_MODELS);
  const resolver = makeResolver({ driver, resolveAuth: () => null });

  const models = await resolver.resolve();

  assert.deepEqual(models.map((m) => m.id), [...ASSISTANT_DEFAULT_MODEL_ROSTER]);
  assert.equal(driver.supportedModelsCalls, 0);
  assert.equal(resolver.cachedSupportedModelIds(), undefined);
});

// ── cachedSupportedModelIds() — the run-path guard's cache-only view ─────────────────────────────────

test("cachedSupportedModelIds() is undefined when cold (no spawn), then exposes value ∪ resolvedModel after a LIVE resolve", async () => {
  const driver = new FakeDriver(async () => LIVE_MODELS);
  const resolver = makeResolver({ driver });

  // Cold cache → skip validation, and crucially NO spawn on the hot-path read.
  assert.equal(resolver.cachedSupportedModelIds(), undefined);
  assert.equal(driver.supportedModelsCalls, 0);

  await resolver.resolve();

  const ids = resolver.cachedSupportedModelIds();
  assert.ok(ids);
  assert.ok(ids.has("claude-opus-4-8"));
  assert.ok(ids.has("sonnet")); // the alias `value`
  assert.ok(ids.has("claude-sonnet-5")); // its `resolvedModel`
  assert.ok(!ids.has("claude-sonnet-4-5")); // the stale id is genuinely NOT offered
  // Still no extra spawn (read off the cache).
  assert.equal(driver.supportedModelsCalls, 1);
});

// ── cache invalidation ───────────────────────────────────────────────────────────────────────────────

test("a re-sign-in (different token) busts the cache and re-probes", async () => {
  let auth: AssistantAuthSource = { kind: "claude_oauth", token: "token-A" };
  const driver = new FakeDriver(async () => LIVE_MODELS);
  const resolver = makeResolver({ driver, resolveAuth: () => auth });

  await resolver.resolve();
  await resolver.resolve();
  assert.equal(driver.supportedModelsCalls, 1, "same sign-in → cached");

  auth = { kind: "claude_oauth", token: "token-B" };
  await resolver.resolve();
  assert.equal(driver.supportedModelsCalls, 2, "re-sign-in → re-probed");
});

test("the live cache expires after its TTL and re-probes", async () => {
  let now = 1_000;
  const driver = new FakeDriver(async () => LIVE_MODELS);
  const resolver = new SubscriptionModelResolver({
    driver,
    resolveAuth: () => OAUTH,
    gate: new CountingGate(),
    createWorkspace: async () => ({ dir: "/tmp/fake-sub-models", cleanup: async () => {} }),
    liveTtlMs: 100,
    now: () => now,
  });

  await resolver.resolve();
  now += 50;
  await resolver.resolve();
  assert.equal(driver.supportedModelsCalls, 1, "within TTL → cached");

  now += 100; // past the 100ms TTL
  await resolver.resolve();
  assert.equal(driver.supportedModelsCalls, 2, "after TTL → re-probed");
});
