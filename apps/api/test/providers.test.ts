import assert from "node:assert/strict";
import { test } from "node:test";
import type { LanguageModelUsage, ProviderMetadata } from "ai";
import { extractProviderUsage } from "../src/testing/accounting.js";
import { modelFor, providerOptions, type DecryptedCredential } from "../src/providers/registry.js";

// ── Acceptance 1: usage normalization unit-tested per provider (the gate-verifiable core) ────────
//
// Feed representative provider usage objects (AI-SDK-normalized `LanguageModelUsage`, with the raw
// provider payload preserved on `usage.raw`) to the centralized normalization switch and assert the
// mapped `TokenUsageActual` — cached/reasoning where relevant. No network.

/** Build a normalized usage object; `raw` holds the verbatim provider payload (as the SDK does). */
function usageOf(over: Partial<LanguageModelUsage>): LanguageModelUsage {
  return {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    ...over,
  } as LanguageModelUsage;
}

test("usage normalization — Anthropic maps input/output + cache (read+write) from providerMetadata", () => {
  const usage = usageOf({ inputTokens: 1200, outputTokens: 300 });
  const metadata = {
    anthropic: { cacheReadInputTokens: 800, cacheCreationInputTokens: 100 },
  } as unknown as ProviderMetadata;

  const actual = extractProviderUsage("anthropic", usage, metadata);

  assert.equal(actual.inputTokens, 1200);
  assert.equal(actual.outputTokens, 300);
  assert.equal(actual.cachedInputTokens, 900, "cache read + creation are summed");
  assert.equal(actual.cacheReadTokens, 800, "cache-read slice kept separate for pricing");
  assert.equal(actual.cacheWriteTokens, 100, "cache-write slice kept separate for pricing");
  assert.equal(actual.reasoningTokens, undefined, "no reasoning reported → left undefined");
});

test("usage normalization — OpenAI maps prompt/completion + cached + reasoning (normalized + raw)", () => {
  // SDK-normalized fields present (the common case).
  const normalized = usageOf({
    inputTokens: 2000,
    outputTokens: 500,
    inputTokenDetails: { noCacheTokens: 1500, cacheReadTokens: 500, cacheWriteTokens: undefined },
    outputTokenDetails: { textTokens: 300, reasoningTokens: 200 },
  });
  const a = extractProviderUsage("openai", normalized);
  assert.equal(a.inputTokens, 2000);
  assert.equal(a.outputTokens, 500);
  assert.equal(a.cachedInputTokens, 500, "prompt_tokens_details.cached_tokens mapped");
  assert.equal(a.reasoningTokens, 200, "completion_tokens_details.reasoning_tokens mapped");

  // Fallback: only the RAW provider payload carries the detail fields (older SDK / proxy).
  const rawOnly = usageOf({
    inputTokens: 2000,
    outputTokens: 500,
    raw: {
      prompt_tokens: 2000,
      completion_tokens: 500,
      prompt_tokens_details: { cached_tokens: 640 },
      completion_tokens_details: { reasoning_tokens: 120 },
    },
  });
  const b = extractProviderUsage("openai", rawOnly);
  assert.equal(
    b.cachedInputTokens,
    640,
    "cached_tokens read from raw payload when normalized is absent",
  );
  assert.equal(
    b.reasoningTokens,
    120,
    "reasoning_tokens read from raw payload when normalized is absent",
  );
});

test("usage normalization — Google maps input/output; omitted detail fields stay undefined", () => {
  const usage = usageOf({ inputTokens: 900, outputTokens: 150 });
  const actual = extractProviderUsage("google", usage);

  assert.equal(actual.inputTokens, 900);
  assert.equal(actual.outputTokens, 150);
  assert.equal(
    actual.cachedInputTokens,
    undefined,
    "Google omits cache here → undefined (estimator covers it)",
  );
  assert.equal(actual.reasoningTokens, undefined, "Google omits reasoning here → undefined");
});

test("usage normalization — Ollama maps the minimal input/output it returns; rest undefined", () => {
  const usage = usageOf({ inputTokens: 64, outputTokens: 16 });
  const actual = extractProviderUsage("ollama", usage);

  assert.equal(actual.inputTokens, 64);
  assert.equal(actual.outputTokens, 16);
  assert.equal(actual.cachedInputTokens, undefined);
  assert.equal(actual.reasoningTokens, undefined);
});

test("usage normalization — missing token counts default to 0 (never NaN/undefined on the required fields)", () => {
  const actual = extractProviderUsage("openai", usageOf({}));
  assert.equal(actual.inputTokens, 0);
  assert.equal(actual.outputTokens, 0);
});

// ── Acceptance 2: modelFor builds a model OFFLINE for each provider; baseUrl-required → 400 ───────
//
// `createX(...)(model)` constructs a LanguageModel object WITHOUT making a network call, so this is
// fully offline. We assert a model is produced (and is the right kind) and that the self-hosted
// providers throw a 400 when their base URL is missing.

function expectModel(cred: DecryptedCredential, model: string): void {
  const built = modelFor(cred, model);
  // The AI SDK returns either a model id string or a LanguageModelV* object; both are valid here.
  assert.ok(built, `modelFor produced a model for ${cred.kind}`);
  assert.ok(typeof built === "string" || typeof built === "object");
}

test("modelFor builds a model offline for openai / google", () => {
  expectModel({ kind: "openai", apiKey: "sk-test" }, "gpt-4o-mini");
  expectModel({ kind: "google", apiKey: "test-key" }, "gemini-2.5-flash");
});

test("modelFor builds an openai_compatible model offline when baseUrl is provided", () => {
  expectModel(
    { kind: "openai_compatible", baseUrl: "http://localhost:1234/v1", apiKey: "sk-local" },
    "local-model",
  );
});

test("modelFor builds an ollama model offline (explicit and default base URL)", () => {
  expectModel({ kind: "ollama", baseUrl: "http://localhost:11434/v1" }, "llama3.1");
  // No baseUrl → falls back to the default local Ollama endpoint (does NOT throw).
  expectModel({ kind: "ollama" }, "llama3.1");
});

test("modelFor throws 400 for openai_compatible when baseUrl is missing", () => {
  try {
    modelFor({ kind: "openai_compatible", apiKey: "sk" }, "local-model");
    assert.fail("expected a 400 for openai_compatible without a baseUrl");
  } catch (error) {
    assert.equal((error as { statusCode?: number }).statusCode, 400);
    assert.match((error as Error).message, /base url/i);
  }
});

test("modelFor throws 400 for openai_compatible when baseUrl is blank/whitespace", () => {
  try {
    modelFor({ kind: "openai_compatible", baseUrl: "   ", apiKey: "sk" }, "local-model");
    assert.fail("expected a 400 for a blank baseUrl");
  } catch (error) {
    assert.equal((error as { statusCode?: number }).statusCode, 400);
  }
});

// ── Escape hatch: providerOptions builder ───────────────────────────────────────────────────────

test("providerOptions injects Anthropic cacheControl (and thinking only for high reasoning effort)", () => {
  const base = providerOptions({ kind: "anthropic", apiKey: "k" }, { params: {} });
  assert.ok(base?.anthropic, "anthropic provider options present");
  assert.deepEqual(base.anthropic.cacheControl, { type: "ephemeral" }, "prompt caching opted in");
  assert.equal(base.anthropic.thinking, undefined, "no thinking unless reasoning effort is high");

  const thinking = providerOptions(
    { kind: "anthropic", apiKey: "k" },
    { params: { reasoningEffort: "high" } },
  );
  assert.ok(thinking?.anthropic?.thinking, "high reasoning effort enables extended thinking");
  assert.deepEqual(thinking.anthropic.thinking, { type: "enabled", budgetTokens: 4000 });
});

test("providerOptions returns undefined for providers without a native escape hatch", () => {
  for (const kind of ["openai", "google", "openai_compatible", "ollama"] as const) {
    assert.equal(
      providerOptions({ kind, apiKey: "k", baseUrl: "http://x/v1" }, { params: {} }),
      undefined,
      `${kind} has no native escape hatch yet`,
    );
  }
});

// ── Acceptance 3: env-gated live ≥2-provider loop — SELF-SKIPS when keys are absent ──────────────
//
// The suite MUST pass green with NO keys. This test runs the real agent loop against each provider
// whose key is set; it asserts ≥2 providers only when ≥2 keys are present, and skips entirely
// otherwise. No keys in CI → returns immediately (green).

test("live ≥2-provider agent loop (env-gated; skips without keys)", async () => {
  const creds: Array<{ cred: DecryptedCredential; model: string }> = [];
  if (process.env.ANTHROPIC_API_KEY) {
    creds.push({
      cred: { kind: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY },
      model: "claude-haiku-4-5",
    });
  }
  if (process.env.OPENAI_API_KEY) {
    creds.push({
      cred: { kind: "openai", apiKey: process.env.OPENAI_API_KEY },
      model: "gpt-4o-mini",
    });
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    creds.push({
      cred: { kind: "google", apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY },
      model: "gemini-2.5-flash",
    });
  }

  // No keys → nothing to run; the suite stays green without credentials.
  if (creds.length === 0) return;

  // Lazy imports so the no-key path never loads the engine/manager machinery.
  const { runAgentLoop } = await import("../src/testing/engine.js");
  const { RunManager } = await import("../src/testing/run-manager.js");

  let ran = 0;
  for (const { cred, model } of creds) {
    const runId = `live-${cred.kind}`;
    const manager = new RunManager();
    manager.create(runId);
    const result = await runAgentLoop(
      runId,
      {
        model: modelFor(cred, model),
        system: "You are a terse test harness.",
        userPrompt: "Reply with the single word: pong",
        tools: {},
        maxTurns: 2,
        profiles: ["generic_o200k"],
        ...(providerOptions(cred, { params: {} })
          ? { providerOptions: providerOptions(cred, { params: {} }) as never }
          : {}),
      },
      (event) => manager.emit(runId, event),
    );
    assert.equal(result.status, "completed", `${cred.kind} run completed`);
    assert.ok(result.tokensIn > 0, `${cred.kind} reported provider-actual input tokens`);
    ran += 1;
  }

  // When ≥2 keys are present, the loop ran against ≥2 providers (the WP's ≥2-provider acceptance).
  if (creds.length >= 2) assert.ok(ran >= 2, "exercised ≥2 providers behind env-gated keys");
});
