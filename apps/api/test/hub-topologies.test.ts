// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP2.2) — the mission TOPOLOGY strategies + saved-crew
// instantiation, driven by STUBBED model seams (no provider/API key). File lives at `apps/api/test/`
// because the api runner globs `test/*.test.ts`.
//
// Proves (per-Acceptance + WP2.R refutation targets):
//   • pipeline — stage N's `runAgent` is called only after N-1 has produced a report (ordering), and
//     N-1's report is folded into N's brief (the hand-off); a stage producing nothing HALTS the chain;
//   • debate  — ROUND-BASED (hub-fixes WP4.4 / D-HF3): round 1 runs debaters in PARALLEL on the bare
//     brief (independent openings), each further round runs them in parallel again seeing the OTHERS'
//     latest reports (rebuttals); a debater producing nothing DROPS OUT (never halts the debate); the
//     budget trips at round boundaries; the synthesis step is the neutral RESOLVER over final positions;
//   • best_of_n — N independent attempts run + a BLIND judge selects the winner; the judge sees the
//     attempts ANONYMIZED (never the authoring model/role — R-SK7); the winner drives the synthesis;
//     a deterministic winner is picked when no judge is wired;
//   • hard budgets stay enforced across topologies (a pipeline budget trip halts cleanly + partial);
//   • saved crews instantiate deterministically (member overrides + topology + brief), skip deleted
//     roles, 400 empty; and a mission proposed with a `crewId` runs the crew's topology;
//   • every topology REPLAYS INERT from `hub_events` alone with the right topology on the board.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  hubMissionPlanSchema,
  type HubAgentReport,
  type HubAgentRoleInput,
  type HubCrew,
  type HubEvent,
  type HubMissionPlan,
  type HubPlannedAgent,
  type HubToolGrants,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import { findCitationMarkers } from "../src/hub/citations.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import {
  clampDebateRounds,
  composeCrewBrief,
  composeDebateRoundBrief,
  composeHandoffBrief,
  DEBATE_ROUND_BRIEF_INTRO,
  deterministicWinner,
  DROPPED_DEBATER_NOTE,
  HubMissionService,
  hydratePlannedAgentFromRole,
  instantiateCrewPlan,
  pinForModel,
  reconstructMission,
  type HubAgentRunInput,
  type HubAgentRunner,
  type HubJudge,
  type HubJudgeInput,
  type HubMissionServiceConfig,
  type HubPlanner,
  type HubResolvedCrew,
  type HubSynthesizer,
} from "../src/hub/missions/index.js";

// ── Harness ─────────────────────────────────────────────────────────────────────────────────────

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

/** model-identity WP6.1 (F2) — the two fixture credentials the pin tests turn on: the SAME canonical
 *  model id served by an Anthropic API key and by the signed-in subscription, so nothing but the
 *  credential distinguishes them (README §3 freezes the ids). `hub_sessions.provider_credential_id` is a
 *  REAL foreign key (migration v55), so they must exist for a pinned child session to be insertable. */
const SUBSCRIPTION_CRED = "cred-anthropic-cli";
const API_CRED = "cred-anthropic-api";
const PINNED_MODEL = "claude-sonnet-5";

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  // Inserted directly (not through `ProviderRepository`) so no key material — encrypted or otherwise —
  // is involved anywhere in this file.
  const insert = db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  const at = "2026-07-27T00:00:00.000Z";
  insert.run(SUBSCRIPTION_CRED, "claude_subscription", "Anthropic CLI", at, at);
  insert.run(API_CRED, "anthropic", "Anthropic", at, at);
  return new HubRepository(db);
}

function collectSink(): { sink: HubTurnSink; events: HubEvent[] } {
  const events: HubEvent[] = [];
  return { sink: { onEvent: (e) => events.push(e), onDelta: () => {} }, events };
}

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

function plannedAgent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.name ?? over.key,
    systemPrompt: `You are ${over.key}.`,
    model: "gpt-4o",
    toolGrants: EMPTY_GRANTS,
    skillIds: [],
    brief: `Do the work for ${over.key}.`,
    target: `Target ${over.key}`,
    expectedOutcome: "A structured report.",
    ...over,
  };
}

function report(over: Partial<HubAgentReport> = {}): HubAgentReport {
  return { findings: [{ summary: "A finding." }], citations: [], artifacts: [], confidence: "medium", openQuestions: [], ...over };
}

const DEFAULT_CONFIG: HubMissionServiceConfig = {
  maxAgents: 6,
  maxParallel: 3,
  defaultBudgetUsd: 2.0,
  maxBudgetUsd: 10.0,
  askAboveAgents: 3,
  askAboveUsd: 1.0,
  defaultAutonomy: "always_ask",
};

function plannerReturning(plan: HubMissionPlan): HubPlanner {
  return async () => plan;
}

/** Agent-runner stub capturing every input (order + brief) and returning a fixed report per key. */
function agentRunnerReturning(
  reports: Record<string, HubAgentReport>,
  opts: { inputs?: HubAgentRunInput[]; costUsd?: number } = {},
): HubAgentRunner {
  return async (input) => {
    opts.inputs?.push(input);
    if (input.abortSignal.aborted) return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    return { report: reports[input.key] ?? report(), costUsd: opts.costUsd ?? 0.1, tokensIn: 100, tokensOut: 50 };
  };
}

const synthesizerCiting: HubSynthesizer = async () => ({
  text: "Combining: point one [1] and point two [2].",
  usage: { tokensIn: 30, tokensOut: 20 },
  costUsd: 0.05,
});

function makeService(over: {
  repository: HubRepository;
  planner: HubPlanner;
  runAgent: HubAgentRunner;
  synthesizer?: HubSynthesizer;
  judge?: HubJudge;
  resolveCrew?: (crewId: string) => HubResolvedCrew | undefined;
  config?: Partial<HubMissionServiceConfig>;
}): HubMissionService {
  return new HubMissionService({
    repository: over.repository,
    planner: over.planner,
    runAgent: over.runAgent,
    synthesizer: over.synthesizer ?? synthesizerCiting,
    ...(over.judge ? { judge: over.judge } : {}),
    ...(over.resolveCrew ? { resolveCrew: over.resolveCrew } : {}),
    config: { ...DEFAULT_CONFIG, ...over.config },
    now: () => "2026-07-18T00:00:00.000Z",
  });
}

function missionSession(repo: HubRepository, autonomy: "always_ask" | "threshold" | "auto") {
  return repo.createSession({ mode: "mission", model: "gpt-4o", autonomy });
}

function agentReportEvents(events: HubEvent[]) {
  return events.filter((e): e is Extract<HubEvent, { type: "agent_report" }> => e.type === "agent_report");
}
function synthEvent(events: HubEvent[]) {
  return events.find((e): e is Extract<HubEvent, { type: "mission_synthesis" }> => e.type === "mission_synthesis");
}
function synthesisMessage(events: HubEvent[]) {
  const id = synthEvent(events)?.messageId;
  return events.find(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message" && e.messageId === id,
  );
}

// ── (1) pipeline: ordered hand-offs — stage N starts only after N-1 reports, fed its report ──────────

test("pipeline: stages run in order, each stage's report feeds the next brief", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "pipeline",
    autonomy: "auto",
    agents: [
      plannedAgent({ key: "a", name: "Stage A" }),
      plannedAgent({ key: "b", name: "Stage B" }),
      plannedAgent({ key: "c", name: "Stage C" }),
    ],
  };
  const inputs: HubAgentRunInput[] = [];
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning(
      {
        a: report({ summary: "FINDING_FROM_A", findings: [{ summary: "A did X." }] }),
        b: report({ summary: "FINDING_FROM_B", findings: [{ summary: "B did Y." }] }),
        c: report({ summary: "FINDING_FROM_C" }),
      },
      { inputs },
    ),
  });

  const mission = await service.proposePlan({ sessionId: session.id, text: "pipeline it", sink });
  assert.equal(mission.status, "completed");

  // Ran strictly in order a → b → c (the runner captured inputs in call order because pipeline awaits).
  assert.deepEqual(inputs.map((i) => i.key), ["a", "b", "c"], "stages ran in strict pipeline order");
  // Stage A's brief is the plain planned brief (no upstream yet).
  assert.equal(inputs[0]!.brief.includes("FINDING_FROM_A"), false);
  assert.ok(inputs[0]!.brief.includes("Do the work for a"), "stage A got its own planned brief");
  // Stage B's brief carries stage A's report (the hand-off) + a "build on" framing.
  assert.ok(inputs[1]!.brief.includes("FINDING_FROM_A"), "stage B's brief carries stage A's report");
  assert.ok(/build/i.test(inputs[1]!.brief), "the pipeline hand-off tells B to build on upstream");
  // Stage C's brief carries BOTH prior stages.
  assert.ok(inputs[2]!.brief.includes("FINDING_FROM_A") && inputs[2]!.brief.includes("FINDING_FROM_B"), "stage C sees A+B");

  assert.equal(agentReportEvents(events).length, 3, "all three stages reported");
  assert.equal(synthEvent(events)?.partial, false, "a full pipeline is not partial");
});

test("pipeline: a stage that produces no report HALTS the chain (partial, downstream skipped)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "pipeline",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" }), plannedAgent({ key: "c" })],
  };
  // Stage B throws (no report) — the pipeline must not run C.
  const runAgent: HubAgentRunner = async (input) => {
    if (input.key === "b") throw new Error("stage B failed");
    return { report: report({ summary: input.key }), costUsd: 0.1, tokensIn: 1, tokensOut: 1 };
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent });

  const mission = await service.proposePlan({ sessionId: session.id, text: "x", sink });
  assert.equal(agentReportEvents(events).length, 1, "only stage A reported before the chain broke");
  assert.equal(synthEvent(events)?.partial, true, "a halted pipeline synthesizes PARTIALLY");
  assert.equal(mission.status, "completed");
  // C never ran → its child settled aborted (never reported).
  const children = repo.listMissionAgentSessions(mission.id);
  assert.equal(children.filter((c) => c.status === "aborted").length, 1, "the un-run stage C settled aborted");
});

// ── (2) debate: ROUND-BASED — parallel openings, rebuttal round(s) w/ cross-visibility, resolver (WP4.4) ─

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A debate runner stub keyed by (agent key, round #): `reportFor(key, round)` returns the report for that
 * debater in that round, or `undefined` to make the debater DROP OUT of that round onward. `onEnter` is an
 * optional per-call hook (the round-1 parallelism barrier). Rounds are counted per key, so detection never
 * depends on brief content. Every input is captured (order + brief) into `inputs`.
 */
function debateRunner(opts: {
  reportFor: (key: string, round: number) => HubAgentReport | undefined;
  inputs?: HubAgentRunInput[];
  onEnter?: (input: HubAgentRunInput, round: number) => Promise<void> | void;
  costUsd?: number;
}): HubAgentRunner {
  const rounds = new Map<string, number>();
  return async (input) => {
    if (input.abortSignal.aborted) return { report: undefined, costUsd: 0, tokensIn: 0, tokensOut: 0, aborted: true };
    const round = (rounds.get(input.key) ?? 0) + 1;
    rounds.set(input.key, round);
    opts.inputs?.push(input);
    await opts.onEnter?.(input, round);
    const rep = opts.reportFor(input.key, round);
    return { report: rep, costUsd: opts.costUsd ?? 0.1, tokensIn: 100, tokensOut: 50 };
  };
}

/** A synthesizer stub that CAPTURES the `userPrompt` it is handed (the reports digest — how we inspect
 *  exactly which reports the RESOLVER composed over). */
function capturingSynthesizer(capture: { userPrompt?: string }): HubSynthesizer {
  return async (input) => {
    capture.userPrompt = input.userPrompt;
    return { text: "Resolved position [1] and [2].", usage: { tokensIn: 30, tokensOut: 20 }, costUsd: 0.05 };
  };
}

const debatePlan = (over: Partial<HubMissionPlan> = {}): HubMissionPlan => ({
  topology: "debate",
  autonomy: "auto",
  agents: [plannedAgent({ key: "pro", name: "Proponent" }), plannedAgent({ key: "con", name: "Opponent" })],
  ...over,
});

test("debate: round 1 runs the debaters in PARALLEL (their run intervals OVERLAP), then a rebuttal round", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();

  // A round-1 barrier: both debaters must ENTER round 1 before either is allowed to leave — so their run
  // intervals provably overlap under the parallel pool. A hypothetical SEQUENTIAL debate would never get
  // two debaters in-flight at once (the second only enters after the first returns → no overlap); the
  // race-with-timeout keeps such an impl from hanging the test (it would fail the overlap assertion).
  const enteredAt: Record<string, number> = {};
  const exitedAt: Record<string, number> = {};
  let tick = 0;
  let round1Entered = 0;
  let releaseRound1 = (): void => {};
  const round1Gate = new Promise<void>((r) => {
    releaseRound1 = r;
  });
  const runAgent = debateRunner({
    reportFor: (key, round) => report({ summary: `${key.toUpperCase()}_R${round}` }),
    onEnter: async (input, round) => {
      if (round !== 1) return;
      enteredAt[input.key] = tick++;
      round1Entered++;
      if (round1Entered >= 2) releaseRound1();
      await Promise.race([round1Gate, delay(1000)]);
      exitedAt[input.key] = tick++;
    },
  });
  const service = makeService({ repository: repo, planner: plannerReturning(debatePlan()), runAgent });

  await service.proposePlan({ sessionId: session.id, text: "Should we do X?", sink });

  // Both debaters' round-1 intervals overlap: each entered before the other exited.
  assert.ok(
    enteredAt.pro !== undefined && enteredAt.con !== undefined && exitedAt.pro !== undefined && exitedAt.con !== undefined,
    "both debaters ran round 1",
  );
  assert.ok(
    enteredAt.pro! < exitedAt.con! && enteredAt.con! < exitedAt.pro!,
    "round-1 debater intervals overlap (parallel), not sequential",
  );
  // Two rounds ran for two debaters ⇒ four agent_report events (openings + rebuttals).
  assert.equal(agentReportEvents(events).length, 4, "2 rounds × 2 debaters = 4 reports");
});

test("debate: round-2 briefs carry the OTHER debaters' openings only — never the debater's OWN opening (WP4.4)", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const inputs: HubAgentRunInput[] = [];
  const runAgent = debateRunner({
    inputs,
    reportFor: (key, round) =>
      report({
        summary: `${key.toUpperCase()}_${round === 1 ? "OPENING" : "REBUTTAL"}`,
        citations: [{ id: "1", title: `${key} source`, url: `https://${key}/x` }],
        findings: [{ summary: `${key} point [1]`, citationIds: ["1"] }],
      }),
  });
  const service = makeService({ repository: repo, planner: plannerReturning(debatePlan()), runAgent });

  await service.proposePlan({ sessionId: session.id, text: "Should we do X?", sink });

  const round1 = inputs.filter((i) => !i.brief.includes(DEBATE_ROUND_BRIEF_INTRO));
  const round2 = inputs.filter((i) => i.brief.includes(DEBATE_ROUND_BRIEF_INTRO));
  assert.equal(round1.length, 2, "round 1 = two bare openings (no rebuttal framing)");
  assert.equal(round2.length, 2, "round 2 = two rebuttals");
  // Round-1 openings are INDEPENDENT — no opponent argument folded in.
  assert.ok(round1.every((i) => !/OPENING/.test(i.brief.replace(/Do the work for \w+\./, ""))), "openings are bare");

  const conRebuttal = round2.find((i) => i.key === "con")!;
  const proRebuttal = round2.find((i) => i.key === "pro")!;
  // Each rebuttal sees the OTHER's opening + the adversarial framing, and NOT its own opening.
  assert.ok(conRebuttal.brief.includes("PRO_OPENING"), "con's rebuttal carries pro's opening");
  assert.ok(!conRebuttal.brief.includes("CON_OPENING"), "con's rebuttal does NOT carry con's OWN opening");
  assert.ok(proRebuttal.brief.includes("CON_OPENING"), "pro's rebuttal carries con's opening");
  assert.ok(!proRebuttal.brief.includes("PRO_OPENING"), "pro's rebuttal does NOT carry pro's OWN opening");
  assert.ok(/rebut|counter/i.test(conRebuttal.brief), "the rebuttal framing is adversarial");

  // The RESOLVER composes over BOTH debaters' final (rebuttal-round) reports — a full debate is not partial.
  assert.equal(synthEvent(events)?.agentReportRefs?.length, 2, "the resolver refs both debaters");
  assert.equal(synthEvent(events)?.partial, false, "a full round-based debate is not partial");
});

test("debate: debateRounds=1 ⇒ independent openings + synthesis (no rebuttal); 2 is the default; the value clamps to 1..3", async () => {
  // clampDebateRounds is the shared 1..3 clamp (default 2 when unset/NaN).
  assert.equal(clampDebateRounds(undefined), 2, "unset ⇒ default 2");
  assert.equal(clampDebateRounds(0), 1, "0 clamps up to 1");
  assert.equal(clampDebateRounds(5), 3, "5 clamps down to 3");

  // debateRounds:1 → each debater runs exactly once (opening only), no rebuttal brief exists.
  {
    const repo = openRepo();
    const session = missionSession(repo, "auto");
    const { sink, events } = collectSink();
    const inputs: HubAgentRunInput[] = [];
    const runAgent = debateRunner({ inputs, reportFor: (key) => report({ summary: `${key}-opening` }) });
    const service = makeService({ repository: repo, planner: plannerReturning(debatePlan({ debateRounds: 1 })), runAgent });
    await service.proposePlan({ sessionId: session.id, text: "x", sink });
    assert.equal(inputs.length, 2, "debateRounds:1 → one run per debater (openings only)");
    assert.ok(inputs.every((i) => !i.brief.includes(DEBATE_ROUND_BRIEF_INTRO)), "no rebuttal round runs");
    assert.equal(agentReportEvents(events).length, 2, "two opening reports");
    assert.equal(synthEvent(events)?.partial, false, "openings-only is complete (not partial)");
    assert.equal(synthEvent(events)?.agentReportRefs?.length, 2, "both openings feed the resolver");
  }

  // debateRounds:5 → clamped to 3 rounds ⇒ three runs per debater.
  {
    const repo = openRepo();
    const session = missionSession(repo, "auto");
    const { sink } = collectSink();
    const inputs: HubAgentRunInput[] = [];
    const runAgent = debateRunner({ inputs, reportFor: (key, round) => report({ summary: `${key}-r${round}` }) });
    const service = makeService({ repository: repo, planner: plannerReturning(debatePlan({ debateRounds: 5 })), runAgent });
    await service.proposePlan({ sessionId: session.id, text: "x", sink });
    assert.equal(inputs.length, 6, "debateRounds:5 clamps to 3 → 3 rounds × 2 debaters = 6 runs");
  }
});

test("debate: a debater that produces nothing DROPS OUT (never halts the debate); its opening is FLAGGED into the resolver + the mission is PARTIAL", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const capture: { userPrompt?: string } = {};
  const inputs: HubAgentRunInput[] = [];
  // con opens (round 1) but produces NOTHING in round 2 → it drops out; pro debates both rounds.
  const runAgent = debateRunner({
    inputs,
    reportFor: (key, round) => {
      if (key === "con" && round >= 2) return undefined; // con withdraws after its opening
      return report({ summary: `${key.toUpperCase()}_R${round}` });
    },
  });
  const service = makeService({
    repository: repo,
    planner: plannerReturning(debatePlan()),
    runAgent,
    synthesizer: capturingSynthesizer(capture),
  });

  await service.proposePlan({ sessionId: session.id, text: "Should we do X?", sink });

  // The debate did NOT halt when con dropped: pro still ran its rebuttal (round 2).
  const proRuns = inputs.filter((i) => i.key === "pro").length;
  assert.equal(proRuns, 2, "pro debated both rounds even though con dropped out");
  // The mission is honestly PARTIAL (a planned debater did not make it to the final round).
  assert.equal(synthEvent(events)?.partial, true, "a dropped debater makes the mission partial");
  // The resolver still sees BOTH sides: pro's final rebuttal + con's opening, the latter FLAGGED as withdrawn.
  assert.ok(capture.userPrompt, "the resolver ran");
  assert.ok(capture.userPrompt!.includes("PRO_R2"), "the resolver has pro's final (round-2) position");
  assert.ok(capture.userPrompt!.includes("CON_R1"), "the resolver still has con's opening position");
  assert.ok(capture.userPrompt!.includes(DROPPED_DEBATER_NOTE), "con's opening is FLAGGED as a withdrawal");
  assert.equal(synthEvent(events)?.agentReportRefs?.length, 2, "both sides still feed the resolver");
});

test("debate: a budget trip at a ROUND BOUNDARY stops further rounds cleanly and synthesizes PARTIALLY", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const inputs: HubAgentRunInput[] = [];
  // Each run costs $1; cap $1.50 → round 1 (2 debaters = $2) trips the budget, so no round 2 launches.
  const runAgent = debateRunner({
    inputs,
    costUsd: 1,
    reportFor: (key, round) => report({ summary: `${key}-r${round}` }),
  });
  const service = makeService({
    repository: repo,
    planner: plannerReturning(debatePlan()),
    runAgent,
    config: { defaultBudgetUsd: 1.5 },
  });

  await service.proposePlan({ sessionId: session.id, text: "x", sink });

  // No second round ran (the trip is checked at the round boundary) — only the two openings.
  assert.ok(inputs.every((i) => !i.brief.includes(DEBATE_ROUND_BRIEF_INTRO)), "no rebuttal round launched after the trip");
  assert.equal(synthEvent(events)?.partial, true, "a budget-tripped debate is partial");
});

test("debate: an OLD sequential-debate event log (one report per debater, no rounds) still REPLAYS/reconstructs", () => {
  // A hand-built PRE-WP4.4 debate log: agent_spawned + a SINGLE agent_report per debater + a synthesis —
  // exactly the shape the old sequential runDebate emitted. The board reducer is unchanged, so it must
  // still reconstruct a terminal 2-debater board (a debater with >1 report — the new shape — is covered
  // by the round-based tests above; this fixture guards the OLD shape's replay fidelity).
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const proChild = "child-pro-legacy";
  const conChild = "child-con-legacy";
  const plan: HubMissionPlan = debatePlan();

  repo.appendEvent(session.id, { type: "plan_proposed", missionId: "m-legacy", plan });
  repo.appendEvent(session.id, { type: "plan_approved", missionId: "m-legacy", auto: true, autonomy: "auto" });
  repo.appendEvent(session.id, { type: "mission_started", missionId: "m-legacy", agentSessionIds: [proChild, conChild] });
  repo.appendEvent(session.id, { type: "agent_spawned", missionId: "m-legacy", agentSessionId: proChild, key: "pro", roleName: "Proponent", model: "gpt-4o", index: 0 });
  repo.appendEvent(session.id, { type: "agent_spawned", missionId: "m-legacy", agentSessionId: conChild, key: "con", roleName: "Opponent", model: "gpt-4o", index: 1 });
  // ONE report each (the old sequential shape).
  repo.appendEvent(session.id, { type: "agent_report", missionId: "m-legacy", agentSessionId: proChild, report: report({ summary: "PRO", agentSessionId: proChild, roleName: "Proponent" }), costUsd: 0.1, tokensIn: 1, tokensOut: 1 });
  repo.appendEvent(session.id, { type: "agent_report", missionId: "m-legacy", agentSessionId: conChild, report: report({ summary: "CON", agentSessionId: conChild, roleName: "Opponent" }), costUsd: 0.1, tokensIn: 1, tokensOut: 1 });
  repo.appendEvent(session.id, { type: "mission_synthesis", missionId: "m-legacy", messageId: "msg-1", partial: false, agentReportRefs: [proChild, conChild] });

  const before = repo.listEvents(session.id).length;
  const board = reconstructMission(repo.listEvents(session.id));
  const after = repo.listEvents(session.id).length;
  assert.equal(after, before, "reconstruction is side-effect-free (replay-inert)");
  assert.ok(board, "the OLD-shape debate log reconstructs a board");
  assert.equal(board.plan.topology, "debate", "the reconstructed board is a debate");
  assert.equal(board.phase, "done", "the old-log board settles terminal");
  assert.equal(board.agents.length, 2, "both debaters are on the board");
  assert.ok(board.agents.every((a) => a.reported), "both debaters' single reports render");
  assert.deepEqual(board.synthesis?.agentReportRefs, [proChild, conChild], "the resolver refs survive replay");
});

// ── (3) best_of_n: N independent attempts + a BLIND judge ────────────────────────────────────────────

test("best_of_n: a BLIND judge selects the winner and the winner drives the synthesis", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "best_of_n",
    autonomy: "auto",
    agents: [
      plannedAgent({ key: "a", name: "SECRET_ROLE_A", model: "SECRET_MODEL_A" }),
      plannedAgent({ key: "b", name: "SECRET_ROLE_B", model: "SECRET_MODEL_B" }),
      plannedAgent({ key: "c", name: "SECRET_ROLE_C", model: "SECRET_MODEL_C" }),
    ],
  };
  const reports: Record<string, HubAgentReport> = {
    a: report({ summary: "Attempt A body", citations: [{ id: "1", title: "Source A", url: "https://a/x" }], findings: [{ summary: "A [1]", citationIds: ["1"] }] }),
    b: report({ summary: "Attempt B body", citations: [{ id: "1", title: "Source B", url: "https://b/x" }], findings: [{ summary: "B [1]", citationIds: ["1"] }] }),
    c: report({ summary: "Attempt C body", citations: [{ id: "1", title: "Source C", url: "https://c/x" }], findings: [{ summary: "C [1]", citationIds: ["1"] }] }),
  };
  let judgeInput: HubJudgeInput | undefined;
  const judge: HubJudge = async (input) => {
    judgeInput = input;
    return { winnerIndex: 1, rationale: "B is best", costUsd: 0.02 }; // pick attempt B
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning(reports), judge });

  const mission = await service.proposePlan({ sessionId: session.id, text: "solve it", sink });

  // All three attempts ran + surfaced on the board.
  assert.equal(agentReportEvents(events).length, 3, "all three attempts reported");
  // BLINDNESS (R-SK7): the judge saw the attempts, but NOT the authoring models or role names.
  assert.ok(judgeInput, "the judge ran");
  assert.equal(judgeInput.attempts.length, 3);
  const attemptsJson = JSON.stringify(judgeInput.attempts);
  for (const secret of ["SECRET_MODEL_A", "SECRET_MODEL_B", "SECRET_MODEL_C", "SECRET_ROLE_A", "SECRET_ROLE_B", "SECRET_ROLE_C"]) {
    assert.equal(attemptsJson.includes(secret), false, `the judge never sees ${secret}`);
  }
  assert.ok(judgeInput.attempts.every((a) => /^Attempt \d+$/.test(a.label)), "attempts are anonymized to 'Attempt N'");

  // The WINNER (attempt B) drives the synthesis — only B's source survives, and agentReportRefs = [B].
  const synth = synthesisMessage(events);
  assert.ok(synth, "the synthesis ran");
  assert.equal(synth.citations.length, 1, "only the winning attempt's source drives the answer");
  assert.equal(synth.citations[0]!.title, "Source B", "the winner is attempt B (the judge's pick)");
  const children = repo.listMissionAgentSessions(mission.id);
  const bChild = children.find((c) => c.title === "SECRET_ROLE_B");
  assert.deepEqual(synthEvent(events)?.agentReportRefs, [bChild!.id], "the synthesis refs the winner only");
  assert.equal(synthEvent(events)?.partial, false, "all attempts succeeded → not partial");
});

test("best_of_n: with no judge wired, a deterministic winner (highest confidence) is picked", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "best_of_n",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" }), plannedAgent({ key: "c" })],
  };
  const reports: Record<string, HubAgentReport> = {
    a: report({ confidence: "low", citations: [{ id: "1", title: "Source A", url: "https://a/x" }] }),
    b: report({ confidence: "high", citations: [{ id: "1", title: "Source B", url: "https://b/x" }] }), // the winner
    c: report({ confidence: "medium", citations: [{ id: "1", title: "Source C", url: "https://c/x" }] }),
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning(reports) });

  await service.proposePlan({ sessionId: session.id, text: "solve it", sink });
  const synth = synthesisMessage(events);
  assert.equal(synth?.citations[0]!.title, "Source B", "the highest-confidence attempt (B) wins deterministically");
});

test("deterministicWinner ranks by confidence, then fewest open questions", () => {
  assert.equal(deterministicWinner([report({ confidence: "low" }), report({ confidence: "high" })]), 1);
  assert.equal(
    deterministicWinner([
      report({ confidence: "high", openQuestions: ["q1", "q2"] }),
      report({ confidence: "high", openQuestions: [] }),
    ]),
    1,
    "same confidence → fewer open questions wins",
  );
  assert.equal(deterministicWinner([report({ confidence: "high" }), report({ confidence: "high" })]), 0, "ties keep the earliest");
});

// ── (4) budgets stay hard across topologies ──────────────────────────────────────────────────────────

test("pipeline: a tripped budget halts the chain cleanly and synthesizes PARTIALLY", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink, events } = collectSink();
  const plan: HubMissionPlan = {
    topology: "pipeline",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" }), plannedAgent({ key: "c" })],
  };
  // Each stage costs $1; cap $0.50 → stage A trips it, B + C never launch.
  const service = makeService({
    repository: repo,
    planner: plannerReturning(plan),
    runAgent: agentRunnerReturning({}, { costUsd: 1 }),
    config: { defaultBudgetUsd: 0.5 },
  });
  const mission = await service.proposePlan({ sessionId: session.id, text: "x", sink });
  assert.equal(agentReportEvents(events).length, 1, "only stage A ran before the budget tripped");
  assert.equal(synthEvent(events)?.partial, true, "the budget-tripped pipeline is partial");
  assert.equal(mission.status, "completed");
  assert.equal(repo.listMissionAgentSessions(mission.id).filter((c) => c.status === "aborted").length, 2);
});

// ── (5) saved-crew instantiation ─────────────────────────────────────────────────────────────────────

const roleInput = (over: Partial<HubAgentRoleInput> & { name: string }): HubAgentRoleInput => ({
  systemPrompt: `System for ${over.name}`,
  defaultModel: "gpt-4o",
  target: `Target for ${over.name}`,
  expectedOutcome: "A report.",
  ...over,
});

test("instantiateCrewPlan: resolves roles, applies overrides, carries the crew topology + brief", () => {
  const repo = openRepo();
  const researcher = repo.createAgentRole(roleInput({ name: "Researcher", defaultModel: "gpt-4o", target: "Research the topic" }));
  const writer = repo.createAgentRole(roleInput({ name: "Writer", defaultModel: "gpt-4o" }));
  const crew = repo.createCrew({
    name: "Duo",
    topology: "pipeline",
    members: [
      { agentId: researcher.id }, // inherits defaults
      { agentId: writer.id, model: "claude-3-5", target: "Draft the summary" }, // overrides
    ],
  });
  const plan = instantiateCrewPlan({ crew, roles: [researcher, writer], ask: "Explain topic X", autonomy: "always_ask" });

  assert.equal(plan.topology, "pipeline", "the crew's topology is carried");
  assert.equal(plan.autonomy, "always_ask");
  assert.equal(plan.agents.length, 2);
  assert.equal(plan.agents[0]!.model, "gpt-4o", "member 1 inherits the role's default model");
  assert.equal(plan.agents[0]!.target, "Research the topic");
  assert.equal(plan.agents[1]!.model, "claude-3-5", "member 2's model override applies");
  assert.equal(plan.agents[1]!.target, "Draft the summary", "member 2's target override applies");
  // The brief is the ask framed by the role focus (isolation: the ask is the task, not a parent transcript).
  assert.ok(plan.agents[0]!.brief.includes("Explain topic X"), "the brief carries the mission ask");
  assert.ok(plan.agents[0]!.brief.includes("Research the topic"), "the brief carries the role focus");
  assert.doesNotThrow(() => hubMissionPlanSchema.parse(plan), "the instantiated plan is wire-valid");
});

test("instantiateCrewPlan: a crewId member becomes a CREW-REF planned unit (not dropped); agentId members unchanged (WP2.1)", () => {
  const repo = openRepo();
  const researcher = repo.createAgentRole(roleInput({ name: "Researcher", defaultModel: "gpt-4o" }));
  // A hand-built crew mixing an agentId member and a nested crewId member (built directly so the author-time
  // graph check is out of scope — this exercises the pure per-level plan builder's crew-ref branch).
  const crew: HubCrew = {
    id: "crewP",
    name: "Parent",
    topology: "parallel",
    members: [{ agentId: researcher.id }, { crewId: "crewC", target: "Deep dive" }],
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
  const plan = instantiateCrewPlan({
    crew,
    roles: [researcher],
    ask: "Explain topic X",
    autonomy: "auto",
    resolveCrewName: (id) => (id === "crewC" ? "Child Crew" : undefined),
  });

  assert.equal(plan.agents.length, 2, "both the agent member AND the crew-ref survive (crewId NOT dropped)");
  const agentUnit = plan.agents.find((a) => a.crewId === undefined)!;
  const crewUnit = plan.agents.find((a) => a.crewId !== undefined)!;
  // The agentId member is byte-for-byte unchanged (the role projected exactly as before crew nesting).
  assert.equal(agentUnit.name, "Researcher");
  assert.equal(agentUnit.roleId, researcher.id);
  assert.equal(agentUnit.model, "gpt-4o");
  assert.ok(agentUnit.brief.includes("Explain topic X"), "the agent member's brief carries the ask");
  // The crewId member → a crew-ref: crewId set, label = resolved child crew name, curated brief (ask + focus,
  // NEVER the parent transcript — D-CN9), and a placeholder empty model (normalizePlannedModels backfills it).
  assert.equal(crewUnit.crewId, "crewC");
  assert.equal(crewUnit.name, "Child Crew", "the crew-ref label is the resolved child crew name");
  assert.equal(crewUnit.model, "", "the crew-ref carries a placeholder model, backfilled downstream");
  assert.equal(crewUnit.systemPrompt, "", "a crew-ref has no single system prompt of its own");
  assert.ok(crewUnit.brief.includes("Explain topic X"), "the crew-ref brief carries the mission ask");
  assert.ok(crewUnit.brief.includes("Deep dive"), "the crew-ref brief carries the member focus");
  assert.doesNotThrow(() => hubMissionPlanSchema.parse(plan), "the plan carrying a crew-ref is wire-valid");
});

test("instantiateCrewPlan: a crew of ONLY nested crew-refs instantiates (not a 400); unresolved name falls back to `Crew <id>` (WP2.1)", () => {
  const crew: HubCrew = {
    id: "crewOnlyNested",
    name: "OnlyNested",
    topology: "pipeline",
    members: [{ crewId: "crewA" }, { crewId: "crewB" }],
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
  const plan = instantiateCrewPlan({ crew, roles: [], ask: "go", autonomy: "auto" });
  assert.equal(plan.agents.length, 2, "two crew-refs — a crew composed only of sub-crews is valid");
  assert.ok(plan.agents.every((a) => a.crewId !== undefined), "both units are crew-refs");
  assert.equal(plan.agents[0]!.name, "Crew crewA", "no resolver ⇒ the stable `Crew <id>` label fallback");
});

test("instantiateCrewPlan: skips deleted-role members; an all-deleted crew is a 400", () => {
  const repo = openRepo();
  const alive = repo.createAgentRole(roleInput({ name: "Alive" }));
  const crew = repo.createCrew({ name: "Mixed", topology: "parallel", members: [{ agentId: "deleted-1" }, { agentId: alive.id }] });
  const plan = instantiateCrewPlan({ crew, roles: [alive], ask: "go", autonomy: "auto" });
  assert.equal(plan.agents.length, 1, "the deleted-role member is skipped");
  assert.equal(plan.agents[0]!.name, "Alive");

  const empty = repo.createCrew({ name: "Empty", topology: "parallel", members: [{ agentId: "gone" }] });
  assert.throws(
    () => instantiateCrewPlan({ crew: empty, roles: [], ask: "go", autonomy: "auto" }),
    /no usable roles/,
    "an all-deleted crew is rejected",
  );
});

// ── (5b) model-identity WP6.1 / F2 — a saved agent's / crew member's PIN is not write-only ──────────
//
// The WP5.R refute-review's acceptance-criterion-4 break: `roleToPlannedAgent` copied model, grants,
// skills and budgets from the role/member but NOT `providerCredentialId`, so the only pin a UI operator
// can set was validated on write, persisted, and then silently discarded at mission instantiation —
// every crew launch spawned its child with NULL and fell back to the name heuristic → the metered key.
// These are NEW tests, not mutation probes: a missing copy cannot be surfaced by breaking existing code.

test("F2: a saved agent's pin reaches its planned agent, and a crew member's pin overrides the role's", () => {
  const repo = openRepo();
  const pinned = repo.createAgentRole(
    roleInput({ name: "Pinned", defaultModel: PINNED_MODEL, providerCredentialId: SUBSCRIPTION_CRED }),
  );
  const unpinned = repo.createAgentRole(roleInput({ name: "Unpinned", defaultModel: PINNED_MODEL }));
  const crew = repo.createCrew({
    name: "Pins",
    topology: "parallel",
    members: [
      { agentId: pinned.id }, // inherits the ROLE's pin
      { agentId: unpinned.id, providerCredentialId: API_CRED }, // member re-pins the SAME model id
    ],
  });
  const plan = instantiateCrewPlan({ crew, roles: [pinned, unpinned], ask: "go", autonomy: "auto" });

  assert.equal(plan.agents[0]!.providerCredentialId, SUBSCRIPTION_CRED, "the role's own pin is carried");
  assert.equal(
    plan.agents[1]!.providerCredentialId,
    API_CRED,
    "a member pin with no model override re-pins the SAME model id to the other credential (the twin case)",
  );
  assert.doesNotThrow(() => hubMissionPlanSchema.parse(plan), "a pinned plan is wire-valid");
});

test("F2: a member that OVERRIDES the model does not inherit a pin chosen for the role's model", () => {
  const repo = openRepo();
  const role = repo.createAgentRole(
    roleInput({ name: "Pinned", defaultModel: PINNED_MODEL, providerCredentialId: SUBSCRIPTION_CRED }),
  );
  const crew = repo.createCrew({
    name: "Overridden",
    topology: "parallel",
    // Model overridden to a DIFFERENT id, with no pin of the member's own.
    members: [{ agentId: role.id, model: "gpt-4o" }],
  });
  const plan = instantiateCrewPlan({ crew, roles: [role], ask: "go", autonomy: "auto" });
  assert.equal(plan.agents[0]!.model, "gpt-4o");
  assert.equal(
    plan.agents[0]!.providerCredentialId,
    undefined,
    "the role's subscription pin was chosen for claude-sonnet-5 — carrying it onto gpt-4o would be the stale mis-pin",
  );
});

test("F2: pinForModel — the pin travels with its model, and a pin-less layer never resurrects a stale one", () => {
  // A layer that names a pin AND the effective model wins.
  assert.equal(pinForModel("m1", [{ model: "m1", pin: "c1" }]), "c1");
  // A layer that pins without naming a model re-pins whatever it inherited (the twin case).
  assert.equal(pinForModel("m1", [{ pin: "c1" }]), "c1");
  // Most-specific-first: the member wins over the role.
  assert.equal(pinForModel("m2", [{ model: "m2", pin: "c2" }, { model: "m1", pin: "c1" }]), "c2");
  // A model override with no pin of its own DROPS the lower pin (stale — chosen for m1).
  assert.equal(pinForModel("m2", [{ model: "m2" }, { model: "m1", pin: "c1" }]), undefined);
  // Absent everywhere ⇒ absent (the documented heuristic path), and `null`/blank are absent too.
  assert.equal(pinForModel("m1", [{ model: "m1" }, {}]), undefined);
  assert.equal(pinForModel("m1", [{ model: "m1", pin: null }, { model: "m1", pin: "  " }]), undefined);
});

test("F2: hydratePlannedAgentFromRole replaces the planner's pin with the role's, never leaving one for the old model", () => {
  const repo = openRepo();
  const role = repo.createAgentRole(
    roleInput({ name: "Saved", defaultModel: PINNED_MODEL, providerCredentialId: SUBSCRIPTION_CRED }),
  );
  const hydrated = hydratePlannedAgentFromRole(
    plannedAgent({ key: "a", model: "gpt-4o", providerCredentialId: API_CRED }),
    role,
  );
  assert.equal(hydrated.model, PINNED_MODEL, "the role's model wins (unchanged behaviour)");
  assert.equal(
    hydrated.providerCredentialId,
    SUBSCRIPTION_CRED,
    "…and so does the role's pin — the planner's was chosen for the model we just replaced",
  );

  // A role with NO pin hydrates to NO pin: the planner's credential is not smuggled through.
  const bare = repo.createAgentRole(roleInput({ name: "Bare", defaultModel: PINNED_MODEL }));
  const hydratedBare = hydratePlannedAgentFromRole(
    plannedAgent({ key: "b", model: PINNED_MODEL, providerCredentialId: API_CRED }),
    bare,
  );
  assert.equal(hydratedBare.providerCredentialId, undefined, "an unpinned role hydrates to the heuristic path");
});

test("F2 end to end: a crew whose member is pinned spawns its CHILD SESSION on that credential", async () => {
  const repo = openRepo();
  const r1 = repo.createAgentRole(
    roleInput({ name: "R1", defaultModel: PINNED_MODEL, providerCredentialId: SUBSCRIPTION_CRED }),
  );
  const r2 = repo.createAgentRole(roleInput({ name: "R2", defaultModel: PINNED_MODEL }));
  const crew = repo.createCrew({
    name: "Pinned crew",
    topology: "parallel",
    members: [{ agentId: r1.id }, { agentId: r2.id }],
  });
  const resolveCrew = (crewId: string): HubResolvedCrew | undefined => {
    const c = repo.getCrew(crewId);
    const wanted = new Set(c.members.map((m) => m.agentId));
    return { crew: c, roles: repo.listAgentRoles().filter((role) => wanted.has(role.id)) };
  };
  const planner: HubPlanner = async () => {
    throw new Error("planner should not run for a crew instantiation");
  };
  const service = makeService({ repository: repo, planner, runAgent: agentRunnerReturning({}), resolveCrew });

  const session = missionSession(repo, "auto");
  const { sink } = collectSink();
  const mission = await service.proposePlan({ sessionId: session.id, text: "go", sink, crewId: crew.id });

  const children = repo.listMissionAgentSessions(mission.id);
  const pinnedChild = children.find((c) => c.title === "R1");
  const unpinnedChild = children.find((c) => c.title === "R2");
  assert.equal(
    pinnedChild?.providerCredentialId,
    SUBSCRIPTION_CRED,
    "the saved agent's pin survived instantiation and is on the spawned child session — `runAgentTurn` resolves on it instead of re-guessing from the model name",
  );
  assert.equal(
    unpinnedChild?.providerCredentialId ?? null,
    null,
    "an unpinned member still spawns NULL ⇒ the unchanged heuristic (no backfill, historical replay intact)",
  );
});

test("proposePlan with a crewId runs the crew's topology (user-instantiated); a bad crewId is a 404", async () => {
  const repo = openRepo();
  const r1 = repo.createAgentRole(roleInput({ name: "R1" }));
  const r2 = repo.createAgentRole(roleInput({ name: "R2" }));
  const crew = repo.createCrew({ name: "BestOf", topology: "best_of_n", members: [{ agentId: r1.id }, { agentId: r2.id }] });

  const resolveCrew = (crewId: string): HubResolvedCrew | undefined => {
    try {
      const c = repo.getCrew(crewId);
      const wanted = new Set(c.members.map((m) => m.agentId));
      return { crew: c, roles: repo.listAgentRoles().filter((role) => wanted.has(role.id)) };
    } catch {
      return undefined;
    }
  };
  // The planner MUST NOT be called on the crew path.
  const planner: HubPlanner = async () => {
    throw new Error("planner should not run for a crew instantiation");
  };
  const service = makeService({ repository: repo, planner, runAgent: agentRunnerReturning({}), resolveCrew });

  const session = missionSession(repo, "auto");
  const { sink } = collectSink();
  const mission = await service.proposePlan({ sessionId: session.id, text: "Compare approaches", sink, crewId: crew.id });
  assert.equal(mission.plan.topology, "best_of_n", "the mission adopts the crew's topology");
  assert.equal(mission.plan.agents.length, 2, "the crew's members became the plan's agents");
  assert.equal(mission.status, "completed");

  // A bad crewId 404s.
  const session2 = missionSession(repo, "auto");
  await assert.rejects(
    () => service.proposePlan({ sessionId: session2.id, text: "x", sink, crewId: "nope" }),
    /could not be found/,
  );
});

// ── (6) replay: each topology reconstructs inert with the right topology ─────────────────────────────

test("replay: a best_of_n mission reconstructs inert with its topology + the winner ref", async () => {
  const repo = openRepo();
  const session = missionSession(repo, "auto");
  const { sink } = collectSink();
  const plan: HubMissionPlan = {
    topology: "best_of_n",
    autonomy: "auto",
    agents: [plannedAgent({ key: "a" }), plannedAgent({ key: "b" })],
  };
  const reports: Record<string, HubAgentReport> = {
    a: report({ confidence: "low" }),
    b: report({ confidence: "high" }),
  };
  const service = makeService({ repository: repo, planner: plannerReturning(plan), runAgent: agentRunnerReturning(reports) });
  const mission = await service.proposePlan({ sessionId: session.id, text: "x", sink });

  const before = repo.listEvents(session.id).length;
  const board = reconstructMission(repo.listEvents(session.id));
  const after = repo.listEvents(session.id).length;
  assert.equal(after, before, "reconstruction is side-effect-free");
  assert.ok(board);
  assert.equal(board.plan.topology, "best_of_n", "the reconstructed board carries the topology");
  assert.equal(board.phase, "done");
  assert.equal(board.agents.length, 2, "both attempts are on the board");
  // The winner (higher confidence 'b') is the synthesis' single ref.
  const bChild = repo.listMissionAgentSessions(mission.id).find((c) => c.title === "b");
  assert.deepEqual(board.synthesis?.agentReportRefs, [bChild!.id], "the winner is the synthesis ref on replay");
});

// ── Unit: hand-off + crew brief composition ──────────────────────────────────────────────────────────

test("composeHandoffBrief folds prior reports in with the right framing", () => {
  const prior = [report({ roleName: "Analyst", summary: "PRIOR_SUMMARY" })];
  const pipeline = composeHandoffBrief("base brief", prior, "pipeline");
  assert.ok(pipeline.includes("base brief") && pipeline.includes("PRIOR_SUMMARY"));
  assert.ok(/build/i.test(pipeline));
  const debate = composeHandoffBrief("base brief", prior, "debate");
  assert.ok(/challenge|rebut/i.test(debate), "debate framing is adversarial");
});

test("composeDebateRoundBrief folds the OPPOSING reports in adversarially; an empty list is the bare brief", () => {
  const opposing = [report({ roleName: "Opponent", summary: "OPPOSING_SUMMARY" })];
  const brief = composeDebateRoundBrief("my bare brief", opposing);
  assert.ok(brief.includes("my bare brief"), "the debater's own brief is preserved");
  assert.ok(brief.includes("OPPOSING_SUMMARY"), "the opponent's argument is folded in");
  assert.ok(brief.includes(DEBATE_ROUND_BRIEF_INTRO), "the rebuttal framing is present");
  assert.ok(/rebut|counter/i.test(brief), "the framing is adversarial");
  // No opponents (a lone debater) ⇒ just the bare brief, no rebuttal scaffolding.
  assert.equal(composeDebateRoundBrief("solo brief", []), "solo brief");
});

test("composeCrewBrief frames the ask by the role focus", () => {
  assert.equal(composeCrewBrief("Do X", "Writer", "Draft it"), "Do X\n\nYour focus as Writer: Draft it");
  assert.equal(composeCrewBrief("Do X", "Writer", ""), "Do X", "no focus → just the ask");
});
