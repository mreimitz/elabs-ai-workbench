// model-identity WP4.2 (locked decision **D-MI4**) — a SUBSCRIPTION-PINNED agent inside a mission.
//
// Driven end to end by STUBS at the driver boundary, exactly as `hub-subscription-mcp-tools.test.ts`
// and the Testing subscription suites do: a scripted fake `AgentSessionDriver`, a stub auth resolver
// and a fake throwaway-workspace factory. **No Agent SDK is imported, no child process is spawned, no
// Anthropic endpoint (metered or subscription) is contacted, no real MCP server is connected, and the
// real filesystem is never touched.** What is proven here therefore stops at the app's own boundary —
// resolution, routing, prompt composition, report parsing and settlement — and says nothing about how a
// real signed-in subscription behaves on a metered turn (owner acceptance).
//
// Locks, in the order WP4.2's Testing section names them:
//   1. a subscription-pinned agent RUNS in a mission and produces a valid `HubAgentReport` through the
//      prompt-enforced contract (no `generateObject` anywhere on its path);
//   2. parse-and-repair recovers a RECOVERABLE malformed report;
//   3. an UNRECOVERABLE one fails BY NAME — the message is NOT "The agent failed to produce a report."
//      and it names the agent plus the real cause;
//   4. a **409** for a credential pinned inside a JSON blob no FK protects (D-MI2) surfaces by name too;
//   5. provider identity crosses PARENT → CHILD (the child resolves on the pin, never a re-guess);
//   6. an UNPINNED / legacy mission is byte-identical (the regression lock);
//   7. synthesis + best-of-N judging with a subscription-pinned member behave per D-MI4 and never
//      silently degrade to `deterministicSynthesis` while hiding the reason.
//
// Plus the pure parser units (`agent-report-contract.ts`), which are what makes 1–3 more than anecdote.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_TOKEN_PROFILE,
  hubAgentReportSchema,
  type HubAgentReport,
  type HubEvent,
  type HubMissionPlan,
  type ProviderKind,
} from "@mcp-token-footprint/shared";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  HubSessionService,
  type HubModelResolution,
} from "../src/hub/session-service.js";
import { createHubSubscriptionAdapter } from "../src/hub/subscription-adapter.js";
import {
  AGENT_REPORT_PROJECTED_NOTE,
  createSessionAgentRunner,
  HUB_AGENT_REPORT_FENCE,
  HubMissionService,
  parseAgentReportContract,
  type HubJudge,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";
import type { CreateThrowawayWorkspace } from "../src/testing/claude-subscription-executor.js";
import { AsyncSemaphore, type ConcurrencyGate } from "../src/testing/subscription-concurrency.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { httpError } from "../src/utils/errors.js";

// ── Harness ─────────────────────────────────────────────────────────────────────────────────────────

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  // `hub_sessions.provider_credential_id` is a REAL foreign key (migration v55, D-MI2), so the two
  // fixture credentials must exist for a pinned child session to be insertable at all. Inserted
  // directly (not through `ProviderRepository`) so no key material — encrypted or otherwise — is
  // involved anywhere in this file.
  const insert = db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(SUBSCRIPTION_CRED, "claude_subscription", "Anthropic CLI", NOW, NOW);
  insert.run(API_CRED, "anthropic", "Anthropic", NOW, NOW);
  return new HubRepository(db);
}

const NOW = "2026-07-27T00:00:00.000Z";

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-sub-agent-"));
  tempDirs.push(dir);
  return dir;
}

/** The two credentials the whole file turns on: the SAME canonical model id served by both an Anthropic
 *  API key and the signed-in subscription. Nothing but the credential distinguishes them (§3 freezes the
 *  ids), which is precisely the ambiguity WP4.2 has to resolve. */
const SUBSCRIPTION_CRED = "cred-anthropic-cli";
const API_CRED = "cred-anthropic-api";
const MODEL = "claude-sonnet-5";

const CREDENTIAL_KINDS: ReadonlyMap<string, ProviderKind> = new Map<string, ProviderKind>([
  [SUBSCRIPTION_CRED, "claude_subscription"],
  [API_CRED, "anthropic"],
]);

// ── A tiny pushable async iterable — SDK-free; mirrors `hub-subscription-adapter.test.ts`. ──────────
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
  /** The reply the scripted child produces for each `send()`, in order (last one repeats). An array is
   *  several SETTLED assistant blocks within ONE turn — what a child that called tools actually emits. */
  constructor(private readonly replies: readonly (string | readonly string[])[]) {}
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options);
    let turn = 0;
    session.onSend = (_text, s) => {
      const reply = this.replies[Math.min(turn, this.replies.length - 1)] ?? "";
      turn += 1;
      // The settled assistant block(s), then a `turn_done` with exact usage — the shape the real driver
      // normalizes an Agent-SDK turn into.
      for (const text of typeof reply === "string" ? [reply] : reply) {
        s.emit({ type: "assistant_message", text });
      }
      s.emit({
        type: "turn_done",
        usage: {
          inputTokens: 120,
          outputTokens: 60,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      });
    };
    this.sessions.push(session);
    return session;
  }
  async supportedModels(): Promise<never[]> {
    return [];
  }
}

const AUTH: AssistantAuthSource = { kind: "claude_oauth", token: "sk-ant-oat01-fake" };

function fakeWorkspaces(): CreateThrowawayWorkspace {
  let n = 0;
  return async () => {
    n += 1;
    return { dir: `/fake/tmp/ws-${n}`, cleanup: async () => {} };
  };
}

function gate(): ConcurrencyGate {
  return new AsyncSemaphore(2);
}

/**
 * A model resolver over the two-credential fixture. An EXPLICIT pin is authoritative (D-MI1); an absent
 * pin runs the legacy name heuristic, which for `claude-*` yields `anthropic` — structurally unable to
 * name the subscription, which is the original defect (README §1) and the reason test 6 is a lock.
 * `throwOn` reproduces the D-MI9 **409** a since-deleted, JSON-blob-pinned credential now raises.
 */
function resolver(opts?: { throwOn?: string; throwMessage?: string }) {
  return (modelId: string, providerCredentialId?: string): HubModelResolution => {
    if (providerCredentialId && providerCredentialId === opts?.throwOn) {
      throw httpError(409, opts.throwMessage ?? "pinned credential is gone");
    }
    const kind: ProviderKind =
      providerCredentialId !== undefined
        ? (CREDENTIAL_KINDS.get(providerCredentialId) ?? "anthropic")
        : "anthropic";
    if (kind === "claude_subscription") {
      // The subscription branch deliberately carries NO `buildModel` — its executor owns construction.
      return { providerKind: kind, modelId, contextWindow: 200_000 };
    }
    return {
      providerKind: kind,
      modelId,
      contextWindow: 200_000,
      buildModel: () => {
        throw new Error("no AI-SDK model is wired in this test");
      },
    };
  };
}

/** A schema-valid report block, as the child is instructed to emit it. */
function reportBlock(report: unknown, fence = HUB_AGENT_REPORT_FENCE): string {
  return ["Here is what I found.", "", "```" + fence, JSON.stringify(report, null, 2), "```"].join(
    "\n",
  );
}

const GOOD_REPORT = {
  summary: "The subscription agent completed its slice.",
  findings: [
    { summary: "A concrete finding the agent actually established.", confidence: "high" },
  ],
  citations: [{ id: "1", title: "Internal analysis" }],
  artifacts: [],
  confidence: "high",
  openQuestions: [],
};

const MISSION_CONFIG: HubMissionServiceConfig = {
  maxAgents: 6,
  maxParallel: 3,
  defaultBudgetUsd: 2.0,
  maxBudgetUsd: 10.0,
  askAboveAgents: 3,
  askAboveUsd: 1.0,
  defaultAutonomy: "auto",
  agentRunnerMode: "session",
};

const synthesizerStub: HubSynthesizer = async () => ({
  text: "Synthesis: the agent reported [1].",
  usage: { tokensIn: 10, tokensOut: 5 },
  costUsd: 0.01,
});

/** A one-agent plan on `MODEL`, optionally pinned to a credential. */
function plannerFor(providerCredentialId?: string, agents = 1): HubPlanner {
  return async (): Promise<HubMissionPlan> => ({
    topology: agents > 1 ? "best_of_n" : "parallel",
    autonomy: "auto",
    agents: Array.from({ length: agents }, (_unused, i) => ({
      key: `agent-${i + 1}`,
      name: `Investigator ${i + 1}`,
      systemPrompt: "You are a focused investigator.",
      model: MODEL,
      ...(providerCredentialId ? { providerCredentialId } : {}),
      toolGrants: { servers: {}, builtins: [] },
      skillIds: [],
      brief: "Investigate the target and report your findings.",
      target: "Investigate the target.",
      expectedOutcome: "A short structured report.",
    })),
  });
}

type Harness = {
  repo: HubRepository;
  mission: HubMissionService;
  driver: FakeDriver;
  sessionService: HubSessionService;
};

function harness(opts: {
  replies: readonly (string | readonly string[])[];
  planner: HubPlanner;
  /** Absent ⇒ the seam is UNWIRED, i.e. pre-WP4.2 behaviour (used by the regression lock). */
  credentialKinds?: ReadonlyMap<string, ProviderKind>;
  resolve?: ReturnType<typeof resolver>;
  judge?: HubJudge;
  synthesizer?: HubSynthesizer;
  logger?: { warn?: (m: string) => void };
}): Harness {
  const repo = openRepo();
  const driver = new FakeDriver(opts.replies);
  const sessionService = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: opts.resolve ?? resolver(),
    subscriptionExecutor: createHubSubscriptionAdapter({
      repository: repo,
      driver,
      resolveAuth: () => AUTH,
      concurrency: gate(),
      createWorkspace: fakeWorkspaces(),
    }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25_000 },
    },
  });
  const mission = new HubMissionService({
    repository: repo,
    config: MISSION_CONFIG,
    planner: opts.planner,
    ...(opts.credentialKinds ? { providerCredentialKinds: () => opts.credentialKinds! } : {}),
    runAgent: createSessionAgentRunner({
      runAgentTurn: (input) => sessionService.runAgentTurn(input),
      repository: repo,
      buildModel: () => {
        throw new Error("the extraction model must never be built on the contract path");
      },
    }),
    synthesizer: opts.synthesizer ?? synthesizerStub,
    ...(opts.judge ? { judge: opts.judge } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    now: () => "2026-07-27T00:00:00.000Z",
  });
  return { repo, mission, driver, sessionService };
}

function collectSink() {
  const events: HubEvent[] = [];
  return { sink: { onEvent: (e: HubEvent) => events.push(e), onDelta: () => undefined }, events };
}

function childrenOf(repo: HubRepository, parentSessionId: string): string[] {
  return repo.listChildSessionIds(parentSessionId);
}

/** The string D-MI4 charters WP4.2 to eliminate. Referenced by name so a regression is unmissable. */
const GENERIC_FAILURE = "The agent failed to produce a report.";

function childErrorMessages(repo: HubRepository, childId: string): string[] {
  return repo
    .listEvents(childId)
    .filter((e): e is Extract<HubEvent, { type: "error" }> => e.type === "error")
    .map((e) => e.message);
}

// ── 1. A subscription-pinned agent RUNS and produces a valid report via the contract ────────────────

test("WP4.2: a subscription-pinned mission agent runs on the subscription executor and reports via the prompt contract", async () => {
  const warnings: string[] = [];
  const h = harness({
    replies: [reportBlock(GOOD_REPORT)],
    planner: plannerFor(SUBSCRIPTION_CRED),
    credentialKinds: CREDENTIAL_KINDS,
    logger: { warn: (m) => warnings.push(m) },
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const result = await h.mission.proposePlan({
    sessionId: session.id,
    text: "Investigate the target.",
    sink,
  });

  assert.equal(result.status, "completed", `the mission completed — warnings: ${warnings.join(" | ")}`);

  // It really went through the SUBSCRIPTION executor — a driver child was started for the agent turn.
  assert.equal(h.driver.sessions.length, 1, "exactly one Agent-SDK child was started");
  const started = h.driver.sessions[0]!.options;

  // The child got the ROLE prompt (identity replaced §8.4), not the chat/session prompt…
  assert.ok(
    started.systemPrompt.includes("You are Investigator 1, a specialist agent in a mission"),
    "the role template replaced identity on the subscription path too",
  );
  // …carrying the machine-parseable report contract, which is what makes the report possible at all.
  assert.ok(
    started.systemPrompt.includes("Mission report contract (REQUIRED)"),
    "the prompt-enforced contract reached the child",
  );
  assert.ok(
    started.systemPrompt.includes("```" + HUB_AGENT_REPORT_FENCE),
    "the contract names the exact fence the parser looks for",
  );
  // A headless child never gets `ask_user` — a blocking question would wedge the parallel join.
  assert.ok(
    !JSON.stringify(started.mcpServers ?? {}).includes("ask"),
    "no ask_user bridge is wired into a mission agent's child",
  );
  // ISOLATION (D-AH9): the brief is the child's SOLE user turn, and it is what the driver was sent.
  assert.deepEqual(h.driver.sessions[0]!.sent, [
    "Investigate the target and report your findings.",
  ]);

  // The board carries a real, schema-valid report — parsed out of the child's own prose, not extracted.
  const reports = events.filter(
    (e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report",
  );
  assert.equal(reports.length, 1);
  const report = reports[0]!.report;
  assert.doesNotThrow(() => hubAgentReportSchema.parse(report));
  assert.equal(report.summary, GOOD_REPORT.summary);
  assert.equal(report.confidence, "high");
  assert.equal(report.findings.length, 1);
  // The orchestrator's own provenance stamp still applies on this path.
  assert.equal(report.roleName, "Investigator 1");
  assert.ok(report.agentSessionId, "the report is stamped with its child session id");
  // …and it is NOT the "no contract block" projection.
  assert.ok(
    !report.openQuestions.includes(AGENT_REPORT_PROJECTED_NOTE),
    "a parsed contract report is not marked as a prose projection",
  );

  // No child failed.
  const [childId] = childrenOf(h.repo, session.id);
  assert.deepEqual(childErrorMessages(h.repo, childId!), []);
});

// ── 2. Parse-and-repair recovers a RECOVERABLE malformed report ─────────────────────────────────────

test("WP4.2: parse-and-repair recovers a recoverable malformed report block", async () => {
  // Everything an LLM plausibly gets wrong at once: an untagged ```json fence, a trailing comma, curly
  // quotes, `"High"` casing, a bare-string finding, a numeric citation id, and no `artifacts` key.
  const malformed = [
    "Findings below.",
    "",
    "```json",
    "{",
    '  “summary”: "Recovered after repair.",',
    '  "findings": ["A finding emitted as a bare string."],',
    '  "citations": [{ "id": 7, "title": "A source" }],',
    '  "confidence": "High",',
    '  "openQuestions": [],',
    "}",
    "```",
  ].join("\n");

  const h = harness({
    replies: [malformed],
    planner: plannerFor(SUBSCRIPTION_CRED),
    credentialKinds: CREDENTIAL_KINDS,
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const result = await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  assert.equal(result.status, "completed");
  const report = events.find(
    (e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report",
  )?.report;
  assert.ok(report, "a repaired report reached the board");
  assert.doesNotThrow(() => hubAgentReportSchema.parse(report));
  assert.equal(report.summary, "Recovered after repair.");
  assert.equal(report.confidence, "high", "`\"High\"` is coerced, not rejected");
  assert.equal(report.findings[0]?.summary, "A finding emitted as a bare string.");
  assert.equal(report.citations[0]?.id, "7", "a numeric citation id is coerced to a string");
  assert.deepEqual(report.artifacts, [], "a missing array becomes empty, never undefined");
});

// ── 3. An UNRECOVERABLE report fails BY NAME ────────────────────────────────────────────────────────

test("WP4.2: an unrecoverable report block fails BY NAME — never the generic string", async () => {
  // A block the agent clearly INTENDED as its report (it carries the fence and `"findings"`) but which
  // is truncated mid-value: unparseable, and repair deliberately does not guess a closing brace.
  const truncated = [
    "```" + HUB_AGENT_REPORT_FENCE,
    '{ "summary": "starting", "findings": [ { "summary": "half a fin',
    "```",
  ].join("\n");

  const warnings: string[] = [];
  const h = harness({
    replies: [truncated],
    planner: plannerFor(SUBSCRIPTION_CRED),
    credentialKinds: CREDENTIAL_KINDS,
    logger: { warn: (m) => warnings.push(m) },
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink } = collectSink();
  await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  const [childId] = childrenOf(h.repo, session.id);
  const errors = childErrorMessages(h.repo, childId!);
  assert.equal(errors.length, 1, "the child settled with exactly one error");
  const message = errors[0]!;
  assert.notEqual(message, GENERIC_FAILURE);
  assert.ok(!message.includes(GENERIC_FAILURE), `the generic string is gone: ${message}`);
  // It names the AGENT…
  assert.ok(message.includes("Investigator 1"), `names the agent: ${message}`);
  assert.ok(message.includes(MODEL), `names the model the operator picked: ${message}`);
  // …and the REAL cause.
  assert.ok(
    message.includes("report block") && message.includes("not valid JSON"),
    `names the real cause: ${message}`,
  );
  assert.equal(h.repo.getSession(childId!).status, "error");
  assert.ok(
    warnings.some((w) => w.includes("Investigator 1")),
    "the same by-name cause is logged, not a different one",
  );
});

test("WP4.2: the contract block is found when it rides a LATER settled block than the prose", async () => {
  // A child that called tools settles several assistant blocks in one turn. Reading only the LAST one
  // (what the prose PROJECTION deliberately does) would miss a report emitted alongside a closing
  // remark; the contract parse therefore scans every settled block and takes the last MATCH.
  const h = harness({
    replies: [["Working through the data now.", reportBlock(GOOD_REPORT), "Done."]],
    planner: plannerFor(SUBSCRIPTION_CRED),
    credentialKinds: CREDENTIAL_KINDS,
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  const report = events.find(
    (e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report",
  )?.report;
  assert.equal(report?.summary, GOOD_REPORT.summary);
  assert.ok(!report?.openQuestions.includes(AGENT_REPORT_PROJECTED_NOTE));
});

test("WP4.2: no report block at all falls back to the visibly-marked prose projection, not a failure", async () => {
  const h = harness({
    replies: ["I looked into it and concluded the pipeline is healthy. No blockers."],
    planner: plannerFor(SUBSCRIPTION_CRED),
    credentialKinds: CREDENTIAL_KINDS,
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const result = await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  assert.equal(result.status, "completed", "an agent that did real work is not dropped");
  const report = events.find(
    (e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report",
  )?.report;
  assert.ok(report);
  assert.ok(
    report.summary?.includes("pipeline is healthy"),
    "the projection carries the agent's OWN prose — nothing is invented",
  );
  assert.ok(
    report.openQuestions.includes(AGENT_REPORT_PROJECTED_NOTE),
    "the projection is marked VISIBLY, so a thin report is explainable",
  );
});

// ── 4. A 409 for a JSON-blob-pinned credential surfaces BY NAME ─────────────────────────────────────

test("WP4.2: a 409 for a deleted plan-pinned credential surfaces by name at turn time (D-MI9 carry-forward)", async () => {
  // `hub_missions.plan_json` has no FK (D-MI2), so `ON DELETE SET NULL` cannot degrade a pin inside it.
  // Under D-MI9 the resolver 409s at TURN time — the exact path that used to collapse into the generic
  // string. The credential-kinds seam is deliberately UNWIRED here, mirroring the real race: the plan
  // was frozen while the credential still existed, and it was deleted before the agent ran.
  const REAL_409 =
    'The provider credential "cred-anthropic-cli" pinned for model "claude-sonnet-5" no longer exists. ' +
    "Pick the model again (or clear the pin) — the Assistant will not silently run it on a different credential.";
  const h = harness({
    replies: [reportBlock(GOOD_REPORT)],
    planner: plannerFor(SUBSCRIPTION_CRED),
    resolve: resolver({ throwOn: SUBSCRIPTION_CRED, throwMessage: REAL_409 }),
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink } = collectSink();
  await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  const [childId] = childrenOf(h.repo, session.id);
  const errors = childErrorMessages(h.repo, childId!);
  assert.equal(errors.length, 1);
  const message = errors[0]!;
  assert.notEqual(message, GENERIC_FAILURE);
  assert.ok(message.includes("Investigator 1"), `names the agent: ${message}`);
  assert.ok(
    message.includes("no longer exists"),
    `carries the resolver's own 409 reason: ${message}`,
  );
  assert.ok(
    message.includes("cred-anthropic-cli"),
    `names the credential the resolver refused: ${message}`,
  );
  // Nothing was spawned: the refusal happened before any child could start.
  assert.equal(h.driver.sessions.length, 0);
});

test("WP4.2: an UNKNOWN plan pin is stripped at propose time, so a stale blob degrades instead of 409-ing", async () => {
  // The other half of the same carry-forward: when the credential store CAN be consulted, a pin naming a
  // credential that no longer exists is dropped at propose time — restoring the `ON DELETE SET NULL`
  // parity the JSON blob cannot have — so the agent runs on the documented heuristic path.
  const h = harness({
    replies: ["A plain answer with no report block."],
    planner: plannerFor("cred-deleted-long-ago"),
    credentialKinds: CREDENTIAL_KINDS,
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink, events } = collectSink();
  const result = await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  assert.equal(result.status, "completed");
  const [childId] = childrenOf(h.repo, session.id);
  assert.equal(
    h.repo.getSession(childId!).providerCredentialId ?? null,
    null,
    "the invented/stale pin never reached the child session",
  );
  const proposed = events.find(
    (e): e is Extract<HubEvent, { type: "plan_proposed" }> => e.type === "plan_proposed",
  );
  assert.ok(
    proposed?.plan.rationale?.includes("Provider check:"),
    "the strip is recorded LOUDLY on the plan card, never silently",
  );
  assert.ok(proposed?.plan.rationale?.includes("does not exist"));
});

// ── 5. Provider identity crosses PARENT → CHILD ─────────────────────────────────────────────────────

test("WP4.2: the planned agent's credential crosses parent → child; the child resolves on the pin, not a re-guess", async () => {
  const seen: Array<{ modelId: string; credentialId?: string }> = [];
  const base = resolver();
  const h = harness({
    replies: [reportBlock(GOOD_REPORT)],
    planner: plannerFor(SUBSCRIPTION_CRED),
    credentialKinds: CREDENTIAL_KINDS,
    resolve: ((modelId: string, credentialId?: string) => {
      seen.push({ modelId, ...(credentialId ? { credentialId } : {}) });
      return base(modelId, credentialId);
    }) as ReturnType<typeof resolver>,
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink } = collectSink();
  await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  // The spawn seam persisted the pin on the child row (WP2.1) …
  const [childId] = childrenOf(h.repo, session.id);
  assert.equal(h.repo.getSession(childId!).providerCredentialId, SUBSCRIPTION_CRED);
  // … and `runAgentTurn` resolved with it, rather than calling the name heuristic. Both models share the
  // id `claude-sonnet-5`, so ONLY the credential can distinguish subscription from metered API.
  const agentResolution = seen.find((s) => s.credentialId === SUBSCRIPTION_CRED);
  assert.ok(agentResolution, `the child resolved on its pin: ${JSON.stringify(seen)}`);
  assert.ok(
    !seen.some((s) => s.modelId === MODEL && s.credentialId === undefined),
    `no unpinned re-guess happened for the agent model: ${JSON.stringify(seen)}`,
  );
});

// ── 6. An UNPINNED / legacy mission is byte-identical ───────────────────────────────────────────────

test("WP4.2 regression lock: an UNPINNED mission still resolves through the heuristic and never touches the subscription path", async () => {
  const seen: Array<string | undefined> = [];
  const base = resolver();
  const h = harness({
    replies: [reportBlock(GOOD_REPORT)],
    planner: plannerFor(undefined),
    // Deliberately NO `providerCredentialKinds`: a pre-WP4.2 construction.
    resolve: ((modelId: string, credentialId?: string) => {
      seen.push(credentialId);
      return base(modelId, credentialId);
    }) as ReturnType<typeof resolver>,
  });
  const session = h.repo.createSession({ mode: "mission", model: MODEL, autonomy: "auto" });
  const { sink } = collectSink();
  await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  const [childId] = childrenOf(h.repo, session.id);
  assert.equal(h.repo.getSession(childId!).providerCredentialId ?? null, null);
  assert.ok(
    seen.every((c) => c === undefined),
    "every resolution ran unpinned — the legacy heuristic path, unchanged",
  );
  // No subscription child was ever started (the heuristic cannot name `claude_subscription`).
  assert.equal(h.driver.sessions.length, 0);
  // The agent still failed the AI-SDK way (this fixture wires no AI-SDK model), and even that failure is
  // now named — the by-name settle is not conditional on the subscription path.
  const errors = childErrorMessages(h.repo, childId!);
  assert.equal(errors.length, 1);
  assert.notEqual(errors[0], GENERIC_FAILURE);
});

// ── 7. Synthesis + best-of-N never silently degrade ────────────────────────────────────────────────

test("WP4.2: a subscription-pinned session with no structured-capable model says WHY its synthesis is mechanical", async () => {
  const synthesizerCalls: string[] = [];
  const h = harness({
    replies: [reportBlock(GOOD_REPORT)],
    planner: plannerFor(SUBSCRIPTION_CRED),
    credentialKinds: CREDENTIAL_KINDS,
    synthesizer: async ({ model }) => {
      synthesizerCalls.push(model);
      return { text: "a model-written synthesis" };
    },
  });
  // The PARENT session is subscription-pinned too, so nothing in the mission can run the synthesis turn.
  const session = h.repo.createSession({
    mode: "mission",
    model: MODEL,
    autonomy: "auto",
    providerCredentialId: SUBSCRIPTION_CRED,
  });
  const { sink, events } = collectSink();
  const result = await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  assert.equal(result.status, "completed");
  assert.deepEqual(
    synthesizerCalls,
    [],
    "the guaranteed-to-fail (and billable) synthesizer call is skipped, not attempted",
  );
  const synthesis = events.find(
    (e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis",
  );
  assert.ok(synthesis, "the mission still produced an answer");
  const answer = events
    .filter((e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message")
    .find((e) => e.messageId === synthesis.messageId);
  assert.ok(answer, "the synthesis message was persisted");
  const text = answer.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
  assert.ok(
    text.includes("No model in this mission can run the synthesis turn"),
    `the mechanical synthesis explains ITSELF rather than degrading silently: ${text.slice(0, 200)}`,
  );
  assert.ok(
    text.includes(GOOD_REPORT.summary),
    "and it is still composed from the agents' real reports",
  );
});

test("WP4.2: the best-of-N judge is routed to a structured-capable model, not the subscription-pinned agent model", async () => {
  const judged: Array<{ model: string; providerCredentialId: string | undefined }> = [];
  const judge: HubJudge = async ({ model, providerCredentialId }) => {
    judged.push({ model, providerCredentialId });
    return { winnerIndex: 0 };
  };
  const h = harness({
    replies: [reportBlock(GOOD_REPORT)],
    planner: plannerFor(SUBSCRIPTION_CRED, 2),
    credentialKinds: CREDENTIAL_KINDS,
    judge,
  });
  // The parent session runs on the metered API credential — the one thing here that CAN `generateObject`.
  const session = h.repo.createSession({
    mode: "mission",
    model: MODEL,
    autonomy: "auto",
    providerCredentialId: API_CRED,
  });
  const { sink } = collectSink();
  await h.mission.proposePlan({ sessionId: session.id, text: "Go.", sink });

  assert.equal(judged.length, 1, "the blind judge ran (it was not skipped)");
  assert.equal(judged[0]?.model, MODEL);
  assert.equal(
    judged[0]?.providerCredentialId,
    API_CRED,
    "the judge resolves on the structured-capable credential, never the subscription-pinned agent's",
  );
});

// ── The pure parser (`agent-report-contract.ts`) ────────────────────────────────────────────────────

test("parseAgentReportContract: the tagged fence wins over an earlier example block", () => {
  const decoy = { summary: "decoy", findings: [], citations: [], artifacts: [], confidence: "low", openQuestions: [] };
  const text = [
    "First, the shape I will use:",
    "```json",
    JSON.stringify(decoy),
    "```",
    "",
    "Now the real one.",
    "```" + HUB_AGENT_REPORT_FENCE,
    JSON.stringify(GOOD_REPORT),
    "```",
  ].join("\n");
  const parsed = parseAgentReportContract(text);
  assert.equal(parsed.outcome, "parsed");
  assert.equal(parsed.outcome === "parsed" && parsed.report.summary, GOOD_REPORT.summary);
});

test("parseAgentReportContract: an unfenced trailing object is accepted; an unrelated fenced payload is not", () => {
  const bare = parseAgentReportContract(`Prose first.\n\n${JSON.stringify(GOOD_REPORT)}`);
  assert.equal(bare.outcome, "parsed");

  const unrelated = parseAgentReportContract('Result:\n```json\n{"rows": [1, 2, 3]}\n```');
  assert.equal(unrelated.outcome, "absent", "a fenced tool payload is not mistaken for a report");
});

test("parseAgentReportContract: an EMPTY husk is unusable, never a fabricated report", () => {
  const husk = {
    summary: "   ",
    findings: [],
    citations: [],
    artifacts: [],
    confidence: "high",
    openQuestions: [],
  };
  const parsed = parseAgentReportContract(reportBlock(husk));
  assert.equal(parsed.outcome, "unusable");
  assert.ok(
    parsed.outcome === "unusable" && parsed.reason.includes("no summary"),
    "the reason names what was missing",
  );
});

test("parseAgentReportContract: no block at all is `absent`, which is NOT a failure", () => {
  assert.equal(parseAgentReportContract("Just prose, no JSON anywhere.").outcome, "absent");
  assert.equal(parseAgentReportContract("").outcome, "absent");
});

test("parseAgentReportContract: a brace inside a JSON string never breaks the balanced-object scan", () => {
  const tricky: HubAgentReport = {
    summary: 'It printed "}" and then {"nested": true} inside a quoted string.',
    findings: [{ summary: "Escaped \\\" quote and a } brace.", confidence: "medium" }],
    citations: [],
    artifacts: [],
    confidence: "medium",
    openQuestions: [],
  };
  const parsed = parseAgentReportContract(`Prose.\n\n${JSON.stringify(tricky)}`);
  assert.equal(parsed.outcome, "parsed");
  assert.equal(parsed.outcome === "parsed" && parsed.report.summary, tricky.summary);
});
