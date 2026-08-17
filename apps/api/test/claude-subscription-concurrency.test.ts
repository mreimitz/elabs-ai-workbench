import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { JudgeSettings, RunEvent } from "@mcp-token-footprint/shared";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { createClaudeCliJudgeGenerate } from "../src/grading/claude-cli-judge.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteOrchestrator } from "../src/suites/orchestrator.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import {
  runClaudeSubscription,
  type ClaudeSubscriptionRunConfig,
  type CreateThrowawayWorkspace,
} from "../src/testing/claude-subscription-executor.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { RunService } from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import {
  AsyncSemaphore,
  type ConcurrencyGate,
  SubscriptionConcurrencyPool,
} from "../src/testing/subscription-concurrency.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// WP 2.1 (roadmap/claude-subscription/, D-CS2/D-CS10) — the ONE shared runs+judge concurrency budget +
// the per-provider cap, exercised ENTIRELY through SCRIPTED FAKE drivers + stub auth/workspace seams. NO
// SDK is imported, NO child is spawned, NO Anthropic call is made, and the real filesystem is never
// touched. The crux this file proves: a subscription RUN child and the Auto-Rating CLI JUDGE child draw
// from the SAME semaphore instance (so their TOTAL is bounded), not two separate ones (which risked 2N).

// ── A tiny pushable async iterable (the fake's normalized event stream) — SDK-free ────────────────────
class Pushable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.buffer.push(item);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    let w = this.waiters.shift();
    while (w) {
      w({ value: undefined as unknown as T, done: true });
      w = this.waiters.shift();
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const b = this.buffer.shift();
        if (b !== undefined) return Promise.resolve({ value: b, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class FakeSession implements DriverSession {
  readonly out = new Pushable<DriverEvent>();
  readonly sent: string[] = [];
  readonly options: DriverStartOptions;
  constructor(options: DriverStartOptions) {
    this.options = options;
    this.out.push({ type: "session", sessionId: "sess-fake" });
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sent.push(message.text);
  }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined {
    return "sess-fake";
  }
  /** Test hook: push a scripted normalized event into this session's stream. */
  emit(event: DriverEvent): void {
    this.out.push(event);
  }
}

/**
 * ONE fake Agent-SDK driver shared by BOTH the subscription run executor AND the CLI judge — so its
 * `active`/`maxActive` counters count EVERY ~1 GiB child (runs + judges) together. Both sides abort their
 * controller in a `finally`, which ends the stream + decrements `active`; that is exactly how the shared
 * budget's ceiling is observed.
 */
class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  active = 0;
  maxActive = 0;
  onStart?: (session: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    options.abortController.signal.addEventListener(
      "abort",
      () => {
        this.active -= 1;
      },
      { once: true },
    );
    const session = new FakeSession(options);
    this.sessions.push(session);
    this.onStart?.(session);
    return session;
  }
}

// ── Shared fixtures ───────────────────────────────────────────────────────────────────────────────
const AUTH: AssistantAuthSource = {
  kind: "claude_oauth",
  token: "sk-ant-oat01-fake-shared-budget-token",
};
const MODEL = "claude-sonnet-4-5";
const PROMPT = "Summarize the dataset.";
const JUDGE_SETTINGS: JudgeSettings = { providerCredentialId: "prov-ignored", model: MODEL };
const TURN_DONE: DriverEvent = { type: "turn_done", usage: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } };

/** A fake throwaway-workspace factory that never touches the FS. */
const fakeWorkspaces: CreateThrowawayWorkspace = async () => ({
  dir: `/fake/tmp/ws-${crypto.randomUUID()}`,
  cleanup: async () => {},
});

function collector(): { emit: (e: RunEvent) => void; events: RunEvent[] } {
  const events: RunEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

/** A run config with every DI seam stubbed offline; `concurrency` is injected by each test. */
function makeRunConfig(
  driver: FakeDriver,
  gate: ConcurrencyGate,
): ClaudeSubscriptionRunConfig {
  return {
    model: MODEL,
    prompt: PROMPT,
    system: "You are a data analyst agent.",
    maxTurns: 8,
    driver,
    resolveAuth: () => AUTH,
    concurrency: gate,
    createWorkspace: fakeWorkspaces,
  };
}

/** Build a CLI-judge generate over the SAME driver + gate a run uses (the crux of D-CS10 sharing). */
function makeJudge(driver: FakeDriver, gate: ConcurrencyGate) {
  return createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => AUTH,
    gate,
    createWorkspace: fakeWorkspaces,
  });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

// ── (a) A RUN and a JUDGE contend on ONE shared instance ──────────────────────────────────────────

test("D-CS10: a held RUN permit blocks a JUDGE acquire — they contend on ONE shared gate (never 2N)", async () => {
  const driver = new FakeDriver(); // manual scripting — do NOT auto-complete
  const gate = new AsyncSemaphore(1); // the ONE shared runs+judge budget
  const judge = makeJudge(driver, gate);
  const runEvents = collector();

  // The RUN acquires the sole permit and starts its child; it holds the permit (no turn_done yet).
  const runPromise = runClaudeSubscription("run-A", makeRunConfig(driver, gate), runEvents.emit);
  await waitFor(() => driver.sessions.length === 1);
  assert.equal(driver.active, 1, "the run holds the sole permit; its child is live");

  // The JUDGE acquires the SAME gate — blocked, so it NEVER spawns a child while the run holds the permit.
  const judgePromise = judge(JUDGE_SETTINGS, "grade this", { system: "JUDGE", signal: freshSignal() });
  await tick();
  await tick();
  assert.equal(driver.sessions.length, 1, "the judge is blocked on the SAME gate — no 2nd child");
  assert.equal(driver.active, 1, "still exactly one ~1 GiB child in flight");

  // Complete the RUN → it releases the permit → the JUDGE may now acquire + spawn.
  driver.sessions[0]!.emit(TURN_DONE);
  const runResult = await runPromise;
  assert.equal(runResult.outcome, "completed");

  await waitFor(() => driver.sessions.length === 2);
  driver.sessions[1]!.emit(TURN_DONE);
  await judgePromise;

  // The peak count is 1: the run and the judge NEVER overlapped — proof of one shared budget.
  assert.equal(driver.maxActive, 1, "run + judge never both in flight → they share ONE gate");
});

test("D-CS10: a held JUDGE permit blocks a RUN acquire — the same shared gate, the other direction", async () => {
  const driver = new FakeDriver();
  const gate = new AsyncSemaphore(1);
  const judge = makeJudge(driver, gate);
  const runEvents = collector();

  // The JUDGE acquires the sole permit first and holds it (no turn_done yet).
  const judgePromise = judge(JUDGE_SETTINGS, "grade this", { system: "JUDGE", signal: freshSignal() });
  await waitFor(() => driver.sessions.length === 1);
  assert.equal(driver.active, 1);

  // A subscription RUN now wants to start — it blocks on the SAME gate (the judge holds the permit), so
  // it emits NO `running` status and spawns NO child until the judge releases.
  const runPromise = runClaudeSubscription("run-B", makeRunConfig(driver, gate), runEvents.emit);
  await tick();
  await tick();
  assert.equal(driver.sessions.length, 1, "the run is blocked on the SAME gate — no 2nd child");
  assert.equal(
    runEvents.events.some((e) => e.type === "status" && e.status === "running"),
    false,
    "a blocked run has not even emitted `running` yet",
  );

  // Complete the JUDGE → it releases → the RUN acquires + spawns.
  driver.sessions[0]!.emit(TURN_DONE);
  await judgePromise;
  await waitFor(() => driver.sessions.length === 2);
  driver.sessions[1]!.emit(TURN_DONE);
  const runResult = await runPromise;

  assert.equal(runResult.outcome, "completed");
  assert.equal(driver.maxActive, 1, "judge + run never both in flight → one shared gate");
});

// ── (b) The TOTAL of (runs + judges) never exceeds the shared bound N ──────────────────────────────

test("D-CS10: with bound N=2, the TOTAL of in-flight runs + judges never exceeds N", async () => {
  const driver = new FakeDriver();
  const gate = new AsyncSemaphore(2); // shared budget = 2
  const judge = makeJudge(driver, gate);
  const runEvents = collector();

  // 2 subscription runs + 2 CLI judges, all sharing the ONE gate + the ONE driver.
  const tasks: Promise<unknown>[] = [
    runClaudeSubscription("run-1", makeRunConfig(driver, gate), runEvents.emit),
    runClaudeSubscription("run-2", makeRunConfig(driver, gate), runEvents.emit),
    judge(JUDGE_SETTINGS, "g1", { system: "J", signal: freshSignal() }),
    judge(JUDGE_SETTINGS, "g2", { system: "J", signal: freshSignal() }),
  ];

  // Exactly 2 are admitted; the other 2 block. The count NEVER exceeds the bound.
  await waitFor(() => driver.sessions.length === 2);
  await tick();
  await tick();
  assert.equal(driver.sessions.length, 2, "only N=2 children admitted; the rest wait");
  assert.equal(driver.active, 2);
  assert.equal(driver.maxActive, 2);

  // Free the first two → the queued two spawn, but still only 2 at a time.
  driver.sessions[0]!.emit(TURN_DONE);
  driver.sessions[1]!.emit(TURN_DONE);
  await waitFor(() => driver.sessions.length === 4);
  assert.equal(driver.active, 2, "the freed permits admit exactly the queued two — never a third");
  driver.sessions[2]!.emit(TURN_DONE);
  driver.sessions[3]!.emit(TURN_DONE);

  await Promise.all(tasks);
  assert.equal(driver.maxActive, 2, "the high-water mark of runs + judges combined is exactly N=2");
});

// ── (c) The per-provider cap bounds ONE provider's runs (D-CS2) ────────────────────────────────────

test("D-CS2: the per-provider cap bounds one provider's runs; a different provider is independent", async () => {
  // shared budget deliberately large (10) so ONLY the per-provider cap (1) is the binding constraint here.
  const pool = new SubscriptionConcurrencyPool(10, 1);
  const gateA = pool.providerGate("prov-A");
  assert.equal(pool.providerGate("prov-A"), gateA, "same provider → the SAME memoized gate");
  const gateB = pool.providerGate("prov-B");
  assert.notEqual(gateA, gateB, "different providers → independent gates");

  // Provider A's cap is 1: the first run acquires; a second run of A blocks until the first releases.
  await gateA.acquire();
  let secondAAcquired = false;
  const secondA = gateA.acquire().then(() => {
    secondAAcquired = true;
  });
  await tick();
  assert.equal(secondAAcquired, false, "a 2nd run of provider A is blocked at cap 1");

  // Provider B is unaffected by A's saturation — its own permit is free.
  let bAcquired = false;
  await gateB.acquire().then(() => {
    bAcquired = true;
  });
  assert.equal(bAcquired, true, "a different provider is NOT blocked by A's cap");

  // Releasing A's permit admits the queued A run — no permit leaked, none double-counted.
  gateA.release();
  await secondA;
  assert.equal(secondAAcquired, true, "releasing A's permit admits the queued A run");
});

test("SubscriptionConcurrencyPool: `.shared` is the single injectable budget; `.providerGate` memoizes", () => {
  const pool = new SubscriptionConcurrencyPool(3);
  // The shared gate is one stable instance (the SAME reference index.ts hands to BOTH the run + the judge).
  assert.equal(pool.shared, pool.shared);
  assert.ok(typeof pool.shared.acquire === "function" && typeof pool.shared.release === "function");
  // maxPerProvider defaults to maxConcurrency, so a single provider can, at most, fill the whole budget.
  assert.equal(pool.providerGate("x"), pool.providerGate("x"));
});

// ── (d) A suite with a `claude_subscription` member runs through the UNCHANGED orchestrator path ─────

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const NOW = "2026-07-13T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

test("D-CS10/orchestrator: a suite with a claude_subscription member runs it via the UNCHANGED orchestrator path (stub driver, no real child)", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));

  // A `claude_subscription` credential (no stored key — auth comes from the injected resolver at run time).
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-sub', 'claude_subscription', 'My Claude', NULL, NULL, @now, @now)`,
  ).run({ now: NOW });

  const scans = new ScanRepository(db);
  const servers = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(servers, new OAuthRepository(db, secrets));
  const skills = new SkillRepository(db, secrets);
  const scenarioRepo = new ScenarioRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans, skills);
  const testService = new TestService(new TestRepository(db));
  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);

  // The FakeDriver auto-completes each run (proving the subscription EXECUTOR branch is reached — no
  // real child). If the orchestrator special-cased the kind (skip / different engine), this driver would
  // never be started.
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "The average was 42." });
    s.emit(TURN_DONE);
  };

  const pool = new SubscriptionConcurrencyPool(2);
  const runService = new RunService(
    scenarioService,
    testService,
    providers,
    servers,
    oauthService,
    runManager,
    runRepo,
    undefined, // modelFactory — unused for a subscription run
    undefined, // sessionOpener
    skills,
    undefined, // grades — no LLM judge fires
    undefined, // issues
    driver, // subscriptionDriver (the stub — NO real child)
    () => AUTH, // subscriptionAuth
    pool, // subscriptionConcurrency (WP 2.1)
  );

  const scenario = scenarioRepo.create({
    name: "Subscription env",
    providerId: "prov-sub",
    model: MODEL,
    params: {},
    systemPrompt: "You are a data analyst agent.",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 8 },
    toolLoadingMode: "eager",
  });
  const testRow = testService.create({ name: "Q1", userPrompt: PROMPT, addedProfiles: [] });

  // Wire the orchestrator's run starter to the REAL RunService (production wiring) — a claude_subscription
  // cell must flow through the SAME `startRun` any other kind does, with NO kind-special-casing.
  const suites = new SuiteRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const grades = new GradeRepository(db);
  const manager = new SuiteRunManager();
  const orchestrator = new SuiteOrchestrator(
    runService.start.bind(runService),
    runService.stop.bind(runService),
    runRepo,
    suiteRuns,
    suites,
    grades,
    manager,
  );

  const suite = suites.create({
    name: "Sub suite",
    config: { repetitions: 1, maxConcurrency: 2 },
    testIds: [testRow.id],
    scenarioIds: [scenario.id],
  });

  const suiteRun = orchestrator.startSuiteRun(suite.id);
  await orchestrator.whenSettled(suiteRun.id);

  // The subscription EXECUTOR branch was reached via the normal orchestrator path — the stub driver ran.
  assert.equal(driver.sessions.length, 1, "the suite drove the subscription executor's stub driver once");
  assert.deepEqual(driver.sessions[0]?.sent, [PROMPT], "the opener prompt reached the run child");
  assert.equal(driver.sessions[0]?.options.env.CLAUDE_CODE_OAUTH_TOKEN, AUTH.token);

  // The cell settled as a completed run linked to the suite run (the unchanged suite-run bookkeeping).
  const finished = suiteRuns.getRun(suiteRun.id);
  assert.equal(finished.status, "completed");
  assert.equal(finished.aggregates?.cellsTotal, 1);
  assert.equal(finished.aggregates?.cellsCompleted, 1);

  const linked = db
    .prepare("SELECT status FROM runs WHERE suite_run_id = ?")
    .all(suiteRun.id) as Array<{ status: string }>;
  assert.equal(linked.length, 1, "one child run linked to the suite run");
  assert.equal(linked[0]?.status, "completed");
});
