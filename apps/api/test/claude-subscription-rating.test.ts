import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { JudgeSettings } from "@mcp-token-footprint/shared";
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
import {
  createClaudeCliJudgeGenerate,
  type CreateThrowawayWorkspace,
} from "../src/grading/claude-cli-judge.js";
import { GradeRepository } from "../src/grading/grade-repository.js";
import { GradeService } from "../src/grading/grade-service.js";
import type { Grader } from "../src/grading/grader.js";
import { createOutcomeJudge, type JudgeGenerate } from "../src/grading/judge.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import {
  RunService,
  type ClaudeSubscriptionAuthResolver,
} from "../src/testing/run-service.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { SubscriptionConcurrencyPool } from "../src/testing/subscription-concurrency.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// WP 3.3 (planning/Roadmap/RM-09-claude-subscription/) — auto-rating interaction for subscription runs. This is a
// VERIFICATION workstream: WP 1.2 already chains `reviewRun` onto EVERY run regardless of provider kind
// (`run-service.ts` `start()`), and `GradeService.gradeRun`/`isEligible` (`grade-service.ts`) carry NO
// kind gate at all. WP 2.1 originally wired the ONE `SubscriptionConcurrencyPool.shared` gate into BOTH
// the Auto-Rating CLI judge AND the subscription run executor (`index.ts`); Unified Sessions (WP1.4/
// WP1.7, D-US6) then DECOUPLED them — the judge still draws on `.shared`, but a subscription run now
// draws on the separate `.runs` gate (`index.ts` also sizes it from `SUBSCRIPTION_RUNS_MAX_CONCURRENCY`).
// These tests exercise that exact CURRENT production shape end-to-end — through `RunService` +
// `GradeService` + the REAL `createOutcomeJudge` / `createClaudeCliJudgeGenerate` — entirely via a
// SCRIPTED FAKE driver: NO SDK is imported, NO child is spawned, NO Anthropic call is made.

const NOW = "2026-07-13T00:00:00.000Z";
const SUB_PROMPT = "Summarize the cats dataset.";
const SUB_AUTH: AssistantAuthSource = {
  kind: "claude_oauth",
  token: "sk-ant-oat01-fake-subscription-token",
};
/** A judge config with no real provider behind it — `createClaudeCliJudgeGenerate` never reads
 * `providerCredentialId` (its OWN `resolveJudgeAuth` supplies the subscription auth); only `model`
 * matters, and it need not be priced (the CLI leg is cost-0 regardless). */
const JUDGE_SETTINGS: JudgeSettings = {
  providerCredentialId: "prov-cli-ignored",
  model: "claude-sonnet-4-5",
};

const TURN_DONE: DriverEvent = {
  type: "turn_done",
  usage: {
    inputTokens: 100,
    outputTokens: 40,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
};

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

// ── The scripted fake Agent-SDK driver (SDK-free; never spawns a child) — shared, when a test wants
// it, by BOTH the subscription RUN executor and the Auto-Rating CLI JUDGE (mirrors the WP 2.1 D-CS10
// test technique in claude-subscription-concurrency.test.ts) so a single `sessions` array/order proves
// which side actually spawned a child. A "run" session carries `maxTurns > 1` (the scenario's
// `guardrails.maxTurns`); the CLI judge's one-shot always carries `maxTurns: 1`. ───────────────────────

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
  onSend?: (text: string, session: FakeSession) => void;
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
    this.onSend?.(message.text, this);
  }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined {
    return "sess-fake";
  }
  emit(event: DriverEvent): void {
    this.out.push(event);
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  /** Auto-script hook, called synchronously after each `start()` (leave unset for manual control). */
  onStart?: (session: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options);
    this.sessions.push(session);
    this.onStart?.(session);
    return session;
  }
}

/** A fake throwaway-workspace factory that never touches the real filesystem (mirrors claude-cli-judge.test.ts). */
function fakeWorkspaces(): { create: CreateThrowawayWorkspace } {
  let n = 0;
  const create: CreateThrowawayWorkspace = async () => {
    const dir = `/fake/tmp/ws-${n++}`;
    return { dir, cleanup: async () => {} };
  };
  return { create };
}

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timed out");
}

// ── Harness — the SAME wiring shape as production `index.ts` (a minimal slice: no MCP servers, no
// skills — the rating axis + concurrency sharing don't need them) ──────────────────────────────────

type RatingHarness = {
  runService: RunService;
  runRepo: RunRepository;
  scenarioRepo: ScenarioRepository;
  testService: TestService;
  gradeService: GradeService;
  subProviderId: string;
};

function makeRatingHarness(opts: {
  driver: FakeDriver;
  resolveAuth: ClaudeSubscriptionAuthResolver;
  graders: readonly Grader[];
  subscriptionConcurrency?: SubscriptionConcurrencyPool;
}): RatingHarness {
  const db = createDatabase();
  const secrets = new SecretStore(crypto.randomBytes(32));

  // A `claude_subscription` credential carries NO stored key (D-CS7) — auth comes from the injected
  // resolver at run time, not this row.
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-sub', 'claude_subscription', 'My Claude', NULL, NULL, @now, @now)`,
  ).run({ now: NOW });

  const scans = new ScanRepository(db);
  const servers = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(servers, new OAuthRepository(db, secrets));
  const scenarioRepo = new ScenarioRepository(db);
  const scenarioService = new ScenarioService(scenarioRepo, scans);
  const testService = new TestService(new TestRepository(db));
  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);

  const gradeRepo = new GradeRepository(db);
  const gradeService = new GradeService(gradeRepo, testService, runRepo, opts.graders, {
    autoRatingEnabled: true,
  });

  const runService = new RunService(
    scenarioService,
    testService,
    providers,
    servers,
    oauthService,
    runManager,
    runRepo,
    undefined, // modelFactory — unused (no agent-loop scenario is ever created in these tests)
    undefined, // sessionOpener — unused
    undefined, // skills
    gradeService, // WP 1.2 (rating): wired so `reviewRun` actually grades, unlike the WP1.2 routing tests
    undefined, // issues
    opts.driver, // subscription run driver
    opts.resolveAuth,
    opts.subscriptionConcurrency,
  );

  return { runService, runRepo, scenarioRepo, testService, gradeService, subProviderId: "prov-sub" };
}

function subscriptionScenario(h: RatingHarness) {
  return h.scenarioRepo.create({
    name: "Subscription env",
    providerId: h.subProviderId,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "You are a data analyst agent.",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 12 },
    toolLoadingMode: "eager",
  });
}

// ── (1) A completed claude_subscription run is auto-rated — NO kind gate ───────────────────────────

test("a completed claude_subscription run is auto-rated (no kind-gate skip); a judge with NO logprobs degrades honestly to single_sample", async () => {
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.emit({ type: "assistant_message", text: "Cats are wonderful pets." });
    s.emit(TURN_DONE);
  };
  // A STUBBED judge chain — no real child spawns, no SDK, no network — mirroring exactly what the
  // Claude-CLI judge itself returns for a rated call: real text + real usage, and crucially NO
  // `ratingLogprobs` (AR13: "the CLI exposes none"). This proves the outcome judge degrades HONESTLY
  // (single_sample, a real parsed rating) rather than crashing or fabricating a logprob-weighted score.
  const stubGenerate: JudgeGenerate = async () => ({
    text: "<rating>9</rating> a strong, well-supported match.",
    usage: { inputTokens: 12, outputTokens: 8 },
  });
  const outcomeJudge = createOutcomeJudge({ resolveJudge: () => JUDGE_SETTINGS, generate: stubGenerate });

  const h = makeRatingHarness({ driver, resolveAuth: () => SUB_AUTH, graders: [outcomeJudge] });
  const scenario = subscriptionScenario(h);
  const testRow = h.testService.create({
    name: "Q1",
    userPrompt: SUB_PROMPT,
    addedProfiles: [],
    expectations: { expectedInsight: "cats are wonderful pets" },
  });

  const handle = h.runService.start(testRow.id, scenario.id, "automated");
  // `handle.done` resolves only AFTER `reviewRun` settles (see run-service.ts `start()`), so awaiting it
  // covers the full post-run rating phase — no extra polling needed.
  const result = await handle.done;

  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "completed");
  // The rating axis actually RAN to a settled `rated` state — not `skipped` (which is what happens when
  // no GradeService is wired at all, proving there is no kind-based short-circuit for the subscription
  // provider kind anywhere in `reviewRun`/`GradeService.gradeRun`/`isEligible`).
  assert.equal(h.runRepo.getSummary(handle.runId).ratingState, "rated");

  const latest = h.gradeService.listGrades(handle.runId).latest;
  const outcome = latest.find((g) => g.graderId === "outcome_judge");
  assert.ok(outcome, "outcome_judge produced a grade row for the subscription run");
  assert.equal(outcome?.status, "graded");
  assert.equal(
    outcome?.method,
    "single_sample",
    "no logprobs on the subscription/CLI-judge path -> honest single-sample degradation, never a fabricated logprob-weighted number",
  );
  assert.equal(outcome?.score, 0.9);
});

// ── (2) D-CS10/D-US6 (WP1.7 completes the decoupling) — the rating's own CLI judge draws from
// `SubscriptionConcurrencyPool.shared`; a subscription RUN draws from the SEPARATE `.runs` gate — proven
// through the REAL production pieces (RunService + GradeService + createOutcomeJudge +
// createClaudeCliJudgeGenerate + SubscriptionConcurrencyPool), not just the raw gates in isolation
// (already proven at that level in claude-subscription-concurrency.test.ts). D-CS10 originally wired
// BOTH sides onto the ONE `.shared` gate; WP1.4 (D-US6) introduced the dedicated `.runs` gate for run
// children specifically so a suite of runs could no longer contend with (or be starved by) in-flight CLI
// judges, and WP1.7 is the "one-line follow-up" (`subscription-concurrency.ts`'s own coordination note)
// that repoints `resolveClaudeSubscription`'s `concurrency` at `.runs` in production — this test now
// proves THAT (the decoupled) shape, superseding the old shared-gate blocking assertion.

test("D-US6/WP1.7: a subscription run's OWN post-run rating (the CLI judge, on `.shared`) no longer contends with a second subscription run (on the separate `.runs` gate) — neither blocks the other", async () => {
  const driver = new FakeDriver(); // shared by BOTH the run executor and the CLI judge — one order of truth
  const pool = new SubscriptionConcurrencyPool(1); // `.shared` bound = 1; `.runs` also defaults to 1 (unset 3rd arg)
  const cliGenerate = createClaudeCliJudgeGenerate({
    driver,
    resolveJudgeAuth: () => SUB_AUTH,
    // The CLI judge always draws on `.shared` — unaffected by the run-side decoupling (D-CS10 still
    // holds for judge-vs-judge concurrency; only judge-vs-RUN contention was decoupled, D-US6).
    gate: pool.shared,
    createWorkspace: fakeWorkspaces().create,
  });
  const outcomeJudge = createOutcomeJudge({ resolveJudge: () => JUDGE_SETTINGS, generate: cliGenerate });

  const h = makeRatingHarness({
    driver,
    resolveAuth: () => SUB_AUTH,
    graders: [outcomeJudge],
    subscriptionConcurrency: pool,
  });
  const scenario1 = subscriptionScenario(h);
  const test1 = h.testService.create({
    name: "Q1",
    userPrompt: SUB_PROMPT,
    addedProfiles: [],
    expectations: { expectedInsight: "cats are wonderful" }, // makes outcome_judge ELIGIBLE for this run
  });

  // Start run1 — its executor `gate.acquire()`s `.runs` (WP1.7: `resolveClaudeSubscription`'s
  // `concurrency` reads `this.subscriptionConcurrency.runs`, not `.shared`) BEFORE spawning its child.
  const handle1 = h.runService.start(test1.id, scenario1.id, "automated");
  await waitFor(() => driver.sessions.length === 1);
  assert.equal(driver.sessions[0]?.options.maxTurns, 12, "session #1 is the RUN child (scenario maxTurns)");

  // Settle run1's turn — the executor releases its `.runs` permit in its `finally`, BEFORE `execute()`
  // resolves and `reviewRun` starts (see claude-subscription-executor.ts `runClaudeSubscription`).
  driver.sessions[0]?.emit({ type: "assistant_message", text: "Cats are wonderful." });
  driver.sessions[0]?.emit(TURN_DONE);

  // reviewRun -> GradeService.gradeRun -> outcome_judge.grade -> cliGenerate -> pool.shared.acquire() ->
  // a SECOND child appears (the CLI judge one-shot, maxTurns: 1) — the judge's OWN gate, `.shared`.
  await waitFor(() => driver.sessions.length === 2);
  assert.equal(driver.sessions[1]?.options.maxTurns, 1, "session #2 is the CLI JUDGE one-shot rating run1");

  // WHILE the judge holds the `.shared` permit, start a SECOND subscription run. Its executor acquires
  // `.runs` — a SEPARATE gate the judge never touches — so it is admitted IMMEDIATELY, never blocked
  // behind the judge (the exact D-US6 guarantee WP1.7's production wiring now delivers end-to-end).
  const scenario2 = subscriptionScenario(h);
  const test2 = h.testService.create({ name: "Q2", userPrompt: "Second question.", addedProfiles: [] });
  const handle2 = h.runService.start(test2.id, scenario2.id, "automated");
  await waitFor(() => driver.sessions.length === 3);
  assert.equal(
    driver.sessions[2]?.options.maxTurns,
    12,
    "session #3 is run2's child, admitted immediately — `.runs` was never contended by the judge",
  );

  // Settle run2 (its test has no `expectations`, so outcome_judge is not eligible — no extra judge call)
  // WHILE the judge (session #1) is still in flight — proving the two truly never blocked each other.
  driver.sessions[2]?.emit({ type: "assistant_message", text: "answer 2" });
  driver.sessions[2]?.emit(TURN_DONE);
  const result2 = await handle2.done;
  assert.equal(result2.status, "completed");
  assert.equal(h.runRepo.getSummary(handle2.runId).ratingState, "rated");

  // Now settle the judge's one-shot — a rating with NO logprobs (the CLI never returns them; AR13).
  driver.sessions[1]?.emit({ type: "assistant_message", text: "<rating>9</rating> a strong match." });
  driver.sessions[1]?.emit(TURN_DONE);

  const result1 = await handle1.done;
  assert.equal(result1.status, "completed");
  assert.equal(h.runRepo.getSummary(handle1.runId).ratingState, "rated");

  // Exactly 3 children total (run1, the judge rating run1, run2) — no 4th ever appears.
  assert.equal(driver.sessions.length, 3);

  // The subscription run's own rating recorded honestly: real parsed rating, NO fabricated logprob math.
  const outcome1 = h.gradeService.listGrades(handle1.runId).latest.find((g) => g.graderId === "outcome_judge");
  assert.equal(outcome1?.status, "graded");
  assert.equal(outcome1?.method, "single_sample");
  assert.ok((outcome1?.score ?? 0) > 0.8);
});
