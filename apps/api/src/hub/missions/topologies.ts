// Assistant Hub (roadmap/assistant-hub/, WP2.2 · §1.9 · D-AH6/D-AH7/D-AH9 · R-SK7/R-UX4) — the mission
// TOPOLOGY strategies + saved-crew instantiation. WP1.7 shipped the `parallel` fan-out inline in the
// orchestrator; this module GENERALIZES it into four interchangeable scheduling strategies, all driven
// through the SAME orchestrator primitives (spawn → run one child agent → collect a structured report →
// synthesize). The orchestrator hands each strategy a {@link TopologyContext} (the `runSlot` primitive +
// a hard-budget gate + the mission abort) and each returns a {@link TopologyOutcome} (the reports that
// ran, the reports the synthesizer composes from, an honest `partial` flag, any extra model-call cost).
//
// The four strategies (D-AH6):
//   • parallel   — every agent runs concurrently (bounded by maxParallel); the original WP1.7 pool.
//   • pipeline   — ORDERED hand-offs: stage N starts only once N-1's report has settled, and N-1's
//                  report is folded into N's brief (each stage builds on the upstream results).
//   • debate     — ROUND-BASED adversarial turns (hub-fixes WP4.4 / D-HF3): round 1 runs ALL debaters in
//                  parallel on the bare brief (independent openings); each further round runs them in
//                  parallel again, each seeing every OTHER debater's latest report and instructed to
//                  rebut; the mission's synthesis step is the neutral RESOLVER over the final positions.
//   • best_of_n  — N INDEPENDENT attempts (same task, no cross-talk) + a BLIND judge: the judge sees the
//                  attempts ANONYMIZED (label only — never the authoring model or role name — R-SK7) and
//                  selects the single best; that winning attempt becomes the mission's answer.
//
// Hard budgets stay server-side (D-AH9): every launch goes through `runSlot`, which the orchestrator
// wires to the mission-wide cost cap + per-agent aborts — a strategy can only ever schedule WITHIN the
// caps, never widen them. Depth-1 PER LEVEL (D-AH9, amended by crew-nesting D-CN2): a strategy schedules
// the planned units of ONE level and never spawns agents itself. A unit carrying a `crewId` (a nested
// saved crew, WP2.1) is still scheduled through the SAME `runSlot` seam — the orchestrator expands it into
// its own sub-mission under the child crew's topology and returns ONE report, so a strategy stays agnostic
// about whether a slot is a leaf agent or a whole sub-crew. No I/O here beyond the injected
// `runSlot`/`judge` seams — fully stub-testable.

import type {
  HubAgentReport,
  HubAgentRole,
  HubAutonomyLevel,
  HubConfidence,
  HubCrew,
  HubCrewMember,
  HubMissionPlan,
  HubPlannedAgent,
  HubSession,
  HubToolGrants,
  HubTopology,
  HubUsage,
} from "@mcp-token-footprint/shared";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { httpError } from "../../utils/errors.js";
import type { HubAgentRunResult } from "./orchestrator.js";
import { clampDebateRounds, composeDebateRoundBrief, renderReportText } from "./shared.js";

// ── The blind judge seam (best_of_n) ───────────────────────────────────────────────────────────────

/** One ANONYMIZED attempt shown to the judge — a stable label + the rendered report body ONLY. It
 *  deliberately carries NO authoring model and NO role name (R-SK7 blindness): the judge ranks the WORK,
 *  never the author. */
export type HubJudgeAttempt = { label: string; report: string };

/** The blind-judge input (best_of_n): the user's question + the anonymized attempts + the model the
 *  judge itself runs on (a neutral judge model — NOT any attempt's model). */
export type HubJudgeInput = {
  question: string;
  attempts: HubJudgeAttempt[];
  model: string;
  /** model-identity WP4.2 (D-MI1) — the credential that owns `model`, so the production judge resolves
   *  on the provider the orchestrator picked (`pickAuxiliaryModel`) instead of re-guessing from the
   *  model name. Absent ⇒ the unchanged heuristic. */
  providerCredentialId?: string;
};

/** The judge's structured verdict: the 0-based index of the winning attempt + an optional rationale. */
export type HubJudgeResult = {
  winnerIndex: number;
  rationale?: string;
  costUsd?: number;
  usage?: HubUsage;
};

/**
 * The blind-judge DI seam (D-AH6 best_of_n). Production wraps AI-SDK `generateObject`
 * ({@link createStructuredJudge}); tests inject a deterministic stub. When no judge is wired, best_of_n
 * falls back to {@link deterministicWinner} so a winner always exists — the judge is a QUALITY seam, not a
 * correctness dependency. In every path the judge only ever sees {@link HubJudgeAttempt}s (label + body),
 * never the authors' models/roles.
 */
export type HubJudge = (input: HubJudgeInput) => Promise<HubJudgeResult>;

// ── Strategy contract ───────────────────────────────────────────────────────────────────────────────

/** One planned agent bound to its spawned child session (the unit a strategy schedules). */
export type TopologySlot = {
  planned: HubPlannedAgent;
  child: HubSession;
  index: number;
};

/** The primitives the orchestrator lends a strategy. `runSlot` is the ONLY way to run an agent — it
 *  registers a per-agent abort tied to the mission, calls the model seam, and records the spend against
 *  the hard budget (tripping it aborts in-flight agents). A strategy decides ORDER + BRIEFS + any
 *  judge/resolver step; it never touches persistence or budgets directly. */
export type TopologyContext = {
  slots: TopologySlot[];
  maxParallel: number;
  missionAbort: AbortSignal;
  /** Run ONE agent (child lifecycle + `agent_report` event), optionally with a composed brief override
   *  (pipeline/debate hand-off). Returns the run result; a skipped/aborted run has `report: undefined`. */
  runSlot: (slot: TopologySlot, briefOverride?: string) => Promise<HubAgentRunResult>;
  /**
   * True once THIS level's OR ANY ANCESTOR's hard total-cost budget has tripped (crew nesting, WP2.2 /
   * D-CN3 — the orchestrator composes the nested predicate as `() => nestedTripped || parentIsTripped()`,
   * so a nested strategy stops launching the instant an ancestor exhausts its allocation, not only when
   * this level's own subdivision is spent). Every strategy consults it BETWEEN launches (the worker pool
   * short-circuits mid-batch too), so a tripped level never starts a further slot.
   */
  isBudgetTripped: () => boolean;
  /** The blind judge for best_of_n (a deterministic fallback is used when absent). */
  judge?: HubJudge;
  /** The user's mission ask (the judge's question framing / for context). */
  ask: string;
  /** The model the strategy's OWN model call (the judge) runs on — the mission/session model, never an
   *  attempt's (blindness). model-identity WP4.2: the orchestrator now picks it via `pickAuxiliaryModel`,
   *  so a subscription-pinned session/plan model (no `generateObject`) is skipped in favour of one that
   *  can actually run the judge; the deterministic winner remains the documented fallback. */
  resolutionModel: string;
  /** model-identity WP4.2 (D-MI1) — the credential that owns {@link resolutionModel}. */
  resolutionProviderCredentialId?: string;
  /** hub-fixes WP4.4 (D-HF3) — the DEBATE round count from the plan (`plan.debateRounds`), only read by
   *  {@link runDebate}. Absent ⇒ the {@link DEBATE_ROUNDS_DEFAULT}; any value is clamped to 1..3
   *  ({@link clampDebateRounds}). Ignored by every other topology. */
  debateRounds?: number;
  logger?: { warn?: (msg: string) => void };
};

/** What a strategy hands back to the orchestrator. */
export type TopologyOutcome = {
  /** Every report actually produced, in board/slot order (honest accounting + the board). */
  producedReports: HubAgentReport[];
  /** The reports the synthesizer composes the final answer from — for best_of_n the WINNING attempt
   *  only (the judge's pick); for the others, all produced reports. */
  synthesisReports: HubAgentReport[];
  /** Honest incompleteness: a planned contributor is missing / a budget tripped / the mission stopped. */
  partial: boolean;
  /** Extra model-call cost the strategy itself incurred beyond the agents (the best_of_n judge). */
  extraCostUsd: number;
};

/** Dispatch a mission to its topology strategy (D-AH6). An unknown value defaults to `parallel`. */
export function runTopology(topology: HubTopology, ctx: TopologyContext): Promise<TopologyOutcome> {
  switch (topology) {
    case "pipeline":
      return runPipeline(ctx);
    case "debate":
      return runDebate(ctx);
    case "best_of_n":
      return runBestOfN(ctx);
    default:
      return runParallel(ctx);
  }
}

// ── The shared worker pool (WP1.7 semantics; reused per-round by debate — WP4.4) ──────────────────────

/** Run a set of slots through a bounded worker pool (the exact WP1.7 pool semantics): at most
 *  `maxParallel` run concurrently, the rest queue, and every worker short-circuits the instant the mission
 *  aborts or the hard budget trips (so a slot never launches past the cap). `briefFor` supplies each slot's
 *  optional composed brief override (debate's per-round rebuttal brief; `undefined` = the planned brief).
 *  Returns a POSITIONAL results array aligned to `slots` (a never-launched slot stays `undefined`), so the
 *  caller reads reports back in deterministic slot order regardless of completion order (replay-safe). */
async function runSlotPool(
  ctx: TopologyContext,
  slots: readonly TopologySlot[],
  briefFor: (slot: TopologySlot, i: number) => string | undefined,
): Promise<(HubAgentRunResult | undefined)[]> {
  const parallel = Math.max(1, Math.min(ctx.maxParallel, Math.max(1, slots.length)));
  const results = new Array<HubAgentRunResult | undefined>(slots.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (ctx.missionAbort.aborted || ctx.isBudgetTripped()) return;
      const i = cursor++;
      if (i >= slots.length) return;
      results[i] = await ctx.runSlot(slots[i]!, briefFor(slots[i]!, i));
    }
  };
  await Promise.all(Array.from({ length: parallel }, () => worker()));
  return results;
}

// ── parallel (the WP1.7 pool, extracted) ─────────────────────────────────────────────────────────────

/** Every agent runs concurrently, bounded by `maxParallel` (the rest queue) and the hard cost budget —
 *  the exact WP1.7 worker-pool semantics, now expressed through the shared {@link runSlotPool}. */
async function runParallel(ctx: TopologyContext): Promise<TopologyOutcome> {
  const { slots } = ctx;
  const results = await runSlotPool(ctx, slots, () => undefined);
  const produced = collectReports(results);
  return {
    producedReports: produced,
    synthesisReports: produced,
    partial: produced.length < slots.length || ctx.missionAbort.aborted || ctx.isBudgetTripped(),
    extraCostUsd: 0,
  };
}

// ── pipeline (ordered hand-offs) ─────────────────────────────────────────────────────────────────────

/** Stages run STRICTLY in order: stage N's `runSlot` is awaited to completion before stage N+1 starts
 *  (so N's report has settled — the ordering invariant), and every settled upstream report is folded into
 *  the next stage's brief. A stage that produces nothing (aborted / model failure) HALTS the pipeline —
 *  downstream stages depend on their input, so the run ends honestly partial. */
async function runPipeline(ctx: TopologyContext): Promise<TopologyOutcome> {
  const produced: HubAgentReport[] = [];
  for (const slot of ctx.slots) {
    if (ctx.missionAbort.aborted || ctx.isBudgetTripped()) break;
    const briefOverride = produced.length > 0 ? composeHandoffBrief(slot.planned.brief, produced, "pipeline") : undefined;
    const result = await ctx.runSlot(slot, briefOverride);
    if (result.report) produced.push(result.report);
    else break; // no report ⇒ the chain is broken; the remaining stages settle skipped (partial)
  }
  return {
    producedReports: produced,
    synthesisReports: produced,
    partial: produced.length < ctx.slots.length || ctx.missionAbort.aborted || ctx.isBudgetTripped(),
    extraCostUsd: 0,
  };
}

// ── debate (round-based: parallel openings → rebuttal rounds → resolver — WP4.4 / D-HF3) ──────────────

/** hub-fixes WP4.4 — the note prepended to a DROPPED debater's last report when it is handed to the
 *  resolver: the debater withdrew before the final round, so its position is its opening only. The note is
 *  added to a CLONE fed to synthesis — the persisted `agent_report` events keep the un-annotated report. */
export const DROPPED_DEBATER_NOTE = "[Withdrew before the final round — opening position only]";

/** Clone a dropped debater's last report with the {@link DROPPED_DEBATER_NOTE} folded into its summary so
 *  the resolver knows this side did not participate to the end. Identity fields (`agentSessionId`, citations)
 *  are preserved, so synthesis still cites + refs it correctly. */
function flagDroppedDebaterReport(report: HubAgentReport): HubAgentReport {
  const base = report.summary?.trim();
  return { ...report, summary: base ? `${DROPPED_DEBATER_NOTE} ${base}` : DROPPED_DEBATER_NOTE };
}

/**
 * Round-based debate (WP4.4 / D-HF3). Round 1 runs ALL debaters in PARALLEL on the bare planned brief
 * (independent openings); each further round runs the still-active debaters in parallel again, each fed a
 * rebuttal brief composed from every OTHER active debater's LATEST report (never its own —
 * {@link composeDebateRoundBrief}). A debater that produces nothing in a round DROPS OUT of later rounds
 * (it never halts the debate). The hard budget + mission abort are checked at every ROUND BOUNDARY (and
 * the pool short-circuits mid-round too). The synthesis step is the neutral RESOLVER: it composes over each
 * debater's FINAL position — the final-round reports of the debaters still active, plus the last (opening)
 * report of any dropped debater, FLAGGED so the resolver knows they withdrew. No extra model call here.
 */
async function runDebate(ctx: TopologyContext): Promise<TopologyOutcome> {
  const rounds = clampDebateRounds(ctx.debateRounds);
  const producedReports: HubAgentReport[] = [];
  /** Each debater's latest produced report, keyed by its stable slot index (survives drop-out). */
  const latestBySlotIndex = new Map<number, HubAgentReport>();
  let active: TopologySlot[] = [...ctx.slots];
  let roundsCompleted = 0;

  for (let round = 1; round <= rounds; round++) {
    // Budget/abort is checked at the ROUND BOUNDARY — a trip between rounds ends the debate honestly
    // partial (the pool below also short-circuits a mid-round trip, dropping the un-run debaters).
    if (round > 1 && (ctx.missionAbort.aborted || ctx.isBudgetTripped())) break;
    if (active.length === 0) break;

    const roundActive = active;
    const briefFor =
      round === 1
        ? (): string | undefined => undefined // openings: the bare planned brief, no cross-visibility
        : (slot: TopologySlot, i: number): string | undefined =>
            composeDebateRoundBrief(slot.planned.brief, otherActiveLatestReports(roundActive, i, latestBySlotIndex));

    const results = await runSlotPool(ctx, roundActive, briefFor);

    const nextActive: TopologySlot[] = [];
    roundActive.forEach((slot, i) => {
      const report = results[i]?.report;
      if (report) {
        producedReports.push(report);
        latestBySlotIndex.set(slot.index, report);
        nextActive.push(slot); // still in the debate for the next round
      }
      // else: this debater produced nothing this round → it DROPS OUT (excluded from nextActive). Its
      // last produced report (if any) stays in latestBySlotIndex and is fed to the resolver, flagged.
    });
    roundsCompleted++;
    active = nextActive;
  }

  // The RESOLVER's inputs (deterministic slot order): each debater's FINAL position — the last report of a
  // still-active debater as-is, a dropped debater's last (opening) report FLAGGED.
  const stillActive = new Set(active.map((slot) => slot.index));
  const synthesisReports: HubAgentReport[] = [];
  for (const slot of ctx.slots) {
    const latest = latestBySlotIndex.get(slot.index);
    if (!latest) continue; // a debater that never produced anything is not in the resolution
    synthesisReports.push(stillActive.has(slot.index) ? latest : flagDroppedDebaterReport(latest));
  }

  const partial =
    ctx.missionAbort.aborted ||
    ctx.isBudgetTripped() ||
    roundsCompleted < rounds ||
    active.length < ctx.slots.length;

  return { producedReports, synthesisReports, partial, extraCostUsd: 0 };
}

/** The LATEST reports of every OTHER active debater (position `j !== i` in the round's active list) — the
 *  cross-visibility a rebuttal round needs, with the debater's OWN prior report deliberately excluded. */
function otherActiveLatestReports(
  active: readonly TopologySlot[],
  i: number,
  latestBySlotIndex: ReadonlyMap<number, HubAgentReport>,
): HubAgentReport[] {
  const out: HubAgentReport[] = [];
  active.forEach((slot, j) => {
    if (j === i) return;
    const report = latestBySlotIndex.get(slot.index);
    if (report) out.push(report);
  });
  return out;
}

// ── best_of_n (N independent attempts + a blind judge) ───────────────────────────────────────────────

/** N INDEPENDENT attempts of the same task (parallel scheduling — no hand-off, no cross-talk), then a
 *  BLIND judge selects the single best. The judge only ever sees ANONYMIZED attempts (label + rendered
 *  body — never the authoring model or role, R-SK7); the WINNING attempt becomes the mission's answer,
 *  while every attempt still surfaces on the board. A run is partial only when stopped/tripped or when no
 *  attempt succeeded — a losing attempt failing does NOT taint the best-of-N winner. */
async function runBestOfN(ctx: TopologyContext): Promise<TopologyOutcome> {
  const base = await runParallel(ctx);
  const produced = base.producedReports;
  if (produced.length === 0) {
    return { producedReports: [], synthesisReports: [], partial: true, extraCostUsd: 0 };
  }

  const attempts: HubJudgeAttempt[] = produced.map((report, i) => ({
    label: `Attempt ${i + 1}`,
    report: renderAnonymizedAttempt(report),
  }));

  let winnerIndex = 0;
  let extraCostUsd = 0;
  if (ctx.judge && produced.length > 1) {
    try {
      const verdict = await ctx.judge({
        question: ctx.ask,
        attempts,
        model: ctx.resolutionModel,
        ...(ctx.resolutionProviderCredentialId
          ? { providerCredentialId: ctx.resolutionProviderCredentialId }
          : {}),
      });
      winnerIndex = clampWinnerIndex(verdict.winnerIndex, produced.length);
      extraCostUsd = Math.max(0, verdict.costUsd ?? 0);
    } catch (error) {
      ctx.logger?.warn?.(
        `[hub best_of_n] the blind judge failed; falling back to the deterministic winner: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      winnerIndex = deterministicWinner(produced);
    }
  } else if (produced.length > 1) {
    winnerIndex = deterministicWinner(produced);
  }

  const winner = produced[winnerIndex]!;
  return {
    producedReports: produced,
    synthesisReports: [winner],
    partial: ctx.missionAbort.aborted || ctx.isBudgetTripped(),
    extraCostUsd,
  };
}

/** Render an attempt for the blind judge — the report body with NO heading, so the authoring role name is
 *  never printed (the report's `roleName`/`agentSessionId`/model live in fields `renderReportText` doesn't
 *  emit without a heading). This is the R-SK7 blindness boundary. */
function renderAnonymizedAttempt(report: HubAgentReport): string {
  return renderReportText(report);
}

/** Clamp a judge-returned winner index into range (a malformed index never crashes the mission). */
function clampWinnerIndex(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), count - 1);
}

const CONFIDENCE_RANK: Record<HubConfidence, number> = { high: 3, medium: 2, low: 1 };

/** The deterministic best-of-N fallback (no judge model wired / a judge failure): pick the
 *  highest-confidence attempt, tie-break by the fewest open questions, then by earliest order. Blind by
 *  construction — it only reads report substance, never the author/model. */
export function deterministicWinner(reports: readonly HubAgentReport[]): number {
  let best = 0;
  for (let i = 1; i < reports.length; i++) {
    const candidate = reports[i]!;
    const incumbent = reports[best]!;
    const cr = CONFIDENCE_RANK[candidate.confidence] ?? 0;
    const ir = CONFIDENCE_RANK[incumbent.confidence] ?? 0;
    if (cr > ir) best = i;
    else if (cr === ir && candidate.openQuestions.length < incumbent.openQuestions.length) best = i;
  }
  return best;
}

// ── Hand-off brief composition (pipeline / debate) ───────────────────────────────────────────────────

const HANDOFF_INTRO: Record<"pipeline" | "debate", string> = {
  pipeline:
    "## Upstream results from earlier pipeline stages\nBuild directly on these — do not repeat their work; extend, refine, or complete it:",
  debate:
    "## Prior arguments in this debate\nCritically CHALLENGE, rebut, or strengthen a counter-position to these — do not merely agree:",
};

/** Fold the settled upstream reports into the next stage's brief (pipeline builds on them, debate
 *  challenges them). The prior reports are STRUCTURED agent output — not the parent chat transcript — so
 *  this respects the isolation invariant (D-AH9): a child still only ever sees its own curated brief, now
 *  enriched with the earlier stages' findings. */
export function composeHandoffBrief(
  baseBrief: string,
  priorReports: readonly HubAgentReport[],
  mode: "pipeline" | "debate",
): string {
  const rendered = priorReports
    .map((report, i) => {
      const heading = report.roleName?.trim() || `Contributor ${i + 1}`;
      return renderReportText(report, { heading });
    })
    .join("\n\n");
  return `${baseBrief}\n\n${HANDOFF_INTRO[mode]}\n\n${rendered}`;
}

// ── Pure helpers shared with the orchestrator ────────────────────────────────────────────────────────

/** Collect the produced reports (in slot order) from a positional results array. */
function collectReports(results: readonly (HubAgentRunResult | undefined)[]): HubAgentReport[] {
  const reports: HubAgentReport[] = [];
  for (const result of results) if (result?.report) reports.push(result.report);
  return reports;
}

// ── Saved-crew instantiation (D-AH7 — instantiable by user OR planner) ────────────────────────────────

/**
 * Turn a SAVED CREW into a concrete `HubMissionPlan` (D-AH7): resolve each member's `agentId` against the
 * role library, apply the member's overrides (model / system-prompt / tool-grants / skills / target /
 * expected outcome / budgets) over the role's defaults, compose an isolated brief from the mission ask +
 * the role's focus, and carry the crew's topology. PURE + deterministic (no model call) — so a user can
 * launch a crew directly, and the planner can expand a crew it chose the same way. A member whose role was
 * deleted is skipped (mirrors `resolveAllowedSkills`); a crew with no usable roles is a 400. The result is
 * then re-clamped by `clampPlanToBudgets` (caps + budget fill + key de-dupe), so this need not.
 */
export function instantiateCrewPlan(args: {
  crew: HubCrew;
  roles: readonly HubAgentRole[];
  ask: string;
  autonomy: HubAutonomyLevel;
  /**
   * Crew nesting (WP2.1 / D-CN2) — resolve a nested-crew member's display name, best-effort (the
   * orchestrator threads its `resolveCrew` DI here). A crew-ref planned unit's label is only cosmetic at
   * plan time — the recursion engine resolves the REAL child crew name when it expands the sub-mission —
   * so an unresolved name falls back to a stable `Crew <id>` in {@link crewRefToPlannedAgent}.
   */
  resolveCrewName?: (crewId: string) => string | undefined;
}): HubMissionPlan {
  const { crew, ask, autonomy } = args;
  const roleById = new Map(args.roles.map((role) => [role.id, role]));
  const agents: HubPlannedAgent[] = [];

  crew.members.forEach((member, index) => {
    // Crew nesting (WP2.1 / D-CN2) — a member carrying a nested `crewId` (WP0.1 made `agentId` optional +
    // the schema enforces exactly-one) becomes a CREW-REF planned unit: the recursion engine (`runSubCrew`)
    // expands it into its own sub-mission under the child crew's topology and hands back ONE report. Mutually
    // exclusive with `agentId`, so branch it FIRST.
    if (member.crewId != null) {
      const crewName = args.resolveCrewName?.(member.crewId);
      agents.push(
        crewRefToPlannedAgent({
          crewId: member.crewId,
          index,
          ask,
          member,
          ...(crewName ? { crewName } : {}),
        }),
      );
      return;
    }
    const roleId = member.agentId;
    if (!roleId) return;
    const role = roleById.get(roleId);
    if (!role) return; // a deleted role — skipped, never thrown (attachment-resolution parity)
    agents.push(
      roleToPlannedAgent({
        role,
        index,
        ask,
        member,
        rationale: `From saved crew "${crew.name}" · role "${role.name}".`,
      }),
    );
  });

  if (agents.length === 0) {
    throw httpError(
      400,
      `Crew "${crew.name}" has no usable roles — every referenced library role has been deleted.`,
    );
  }

  return {
    topology: crew.topology,
    autonomy,
    agents,
    rationale: `Instantiated from saved crew "${crew.name}" (${crew.topology}).`,
  };
}

/**
 * End-user UX pass — turn an EXPLICIT list of saved agents (the `@`-mentions in a prompt) into a
 * concrete `HubMissionPlan`, deterministically (no model call). Each resolvable role → one plan agent
 * via {@link roleToPlannedAgent}; a deleted/unresolvable id is skipped (parity with crew instantiation).
 * One agent = a single direct handoff; N = a parallel team (default `parallel` topology). 400 if nothing
 * resolves. The result is re-clamped by `clampPlanToBudgets` (caps + budgets + key de-dupe) like a crew.
 */
export function instantiateAgentsPlan(args: {
  roles: readonly HubAgentRole[];
  ask: string;
  autonomy: HubAutonomyLevel;
  topology?: HubTopology;
}): HubMissionPlan {
  const { roles, ask, autonomy } = args;
  const agents = roles.map((role, index) =>
    roleToPlannedAgent({
      role,
      index,
      ask,
      keyPrefix: "agent",
      rationale: `Directly delegated via @mention · role "${role.name}".`,
    }),
  );
  if (agents.length === 0) {
    throw httpError(400, "None of the mentioned agents could be found — they may have been deleted.");
  }
  return {
    topology: args.topology ?? "parallel",
    autonomy,
    agents,
    rationale: `Handed off to ${agents.length} mentioned agent${agents.length === 1 ? "" : "s"}.`,
  };
}

/**
 * model-identity WP6.1 (F2 / F9 / F12) — **THE PIN-STALENESS RULE, in one place.**
 *
 * A `providerCredentialId` is only ever meaningful for the model it was picked *for*: the operator (or
 * the planner) chose "the subscription's Sonnet", never "the subscription" in the abstract. D-MI1's
 * whole point is that a model id alone is ambiguous — two credentials serve the byte-identical
 * `claude-sonnet-5` — so a pin and a model id are ONE choice, not two independent ones.
 *
 * It follows that whenever a layer OVERRIDES the model, carrying a lower layer's pin forward would hand
 * a credential chosen for model A to model B. That is the same class of silent mis-routing this
 * workstream exists to kill, and it is exactly why {@link hydratePlannedAgentFromRole} already drops the
 * planner's `estimatedCostUsd` ("it was priced for the model the planner guessed").
 *
 * **The rule: a pin survives only alongside the model it was authored with.** Layers are given
 * most-specific-first. A layer that names a pin *and* a model wins when that model is the effective one.
 * A layer that names a pin but NO model of its own pinned whatever model it inherited — that is the
 * legitimate "same model id, the OTHER credential" re-pin (acceptance criterion 2's twin case), so it
 * wins outright. A pin whose authoring model was overridden is DROPPED.
 *
 * Dropping lands on the documented absent-pin path (today's heuristic + a structured `log.warn`, D-MI1)
 * — deliberately NOT a 409, because the operator never made the stale choice; D-MI9's refusal is for a
 * pin someone actually asserted on this request, not one we inferred on their behalf.
 */
export function pinForModel(
  effectiveModel: string,
  layers: ReadonlyArray<{ model?: string | undefined; pin?: string | null | undefined }>,
): string | undefined {
  for (const layer of layers) {
    const pin = layer.pin?.trim();
    if (!pin) continue;
    const authoredFor = layer.model?.trim();
    // `undefined` ⇒ this layer authored no model of its own, so its pin re-pins the inherited model
    // (the twin case). A named model that is no longer the effective one ⇒ the pin is stale: drop it
    // (and stop — a pin BELOW a model-overriding layer is stale for the same reason).
    if (authoredFor !== undefined && authoredFor !== effectiveModel) return undefined;
    return pin;
  }
  return undefined;
}

/**
 * Project a saved library role into a concrete plan agent. Shared by {@link instantiateCrewPlan} (a
 * crew member, which may carry per-member overrides) and roster hydration (a standalone agent, no
 * overrides). Member overrides (model / system-prompt / tool-grants / skills / target / expected
 * outcome / budgets) win over the role's defaults; `key` is positional (`clampPlanToBudgets` de-dupes).
 *
 * model-identity WP6.1 (F2) — the member's/role's `providerCredentialId` is carried too, resolved by
 * {@link pinForModel} so the pin follows its model. Before this it was simply not copied, which made the
 * ONLY pin a UI operator can set (a saved agent's, or a crew member's override) **write-only**: it was
 * validated on write, persisted, and then discarded here, so every crew launch spawned its child with
 * `provider_credential_id = NULL` and fell back to the name heuristic → the metered key. That is
 * acceptance criterion 4's failure, and it is the original defect reproduced on the agent path.
 */
export function roleToPlannedAgent(args: {
  role: HubAgentRole;
  index: number;
  ask: string;
  member?: HubCrewMember;
  keyPrefix?: string;
  rationale: string;
}): HubPlannedAgent {
  const { role, index, ask, member, rationale } = args;
  const keyPrefix = args.keyPrefix ?? "member";
  const target = (member?.target ?? role.target).trim();
  const budgets = member?.budgets ?? role.budgets;
  const model = member?.model ?? role.defaultModel;
  const providerCredentialId = pinForModel(model, [
    { model: member?.model, pin: member?.providerCredentialId },
    { model: role.defaultModel, pin: role.providerCredentialId },
  ]);
  return {
    key: `${keyPrefix}-${index + 1}`,
    roleId: role.id,
    name: role.name,
    systemPrompt: member?.systemPromptOverride ?? role.systemPrompt,
    model,
    ...(providerCredentialId ? { providerCredentialId } : {}),
    toolGrants: member?.toolGrants ?? role.toolGrants,
    skillIds: member?.skillIds ?? role.skills.map((skill) => skill.skillId),
    brief: composeCrewBrief(ask, role.name, target),
    target,
    expectedOutcome: member?.expectedOutcome ?? role.expectedOutcome,
    ...(budgets ? { budgets } : {}),
    rationale,
  };
}

/**
 * Crew nesting (WP2.1 / D-CN2) — project a nested-crew member into a CREW-REF `HubPlannedAgent`: the plan
 * element that the recursion engine (`orchestrator.runSubCrew`) expands into its OWN sub-mission under the
 * child crew's topology, rolling the sub-mission's synthesised answer up into ONE report. A crew-ref carries
 * no single system prompt or concrete model of its own — its members carry theirs — so `systemPrompt`/
 * `expectedOutcome` are empty and `model` is a placeholder backfilled by `normalizePlannedModels` (from the
 * session model) so the container child session it spawns is wire-valid. The `crewId` field (WP0.1) is what
 * makes `runSlot` take the crew branch. The brief is the mission ask framed by the member's focus — the
 * mission ask, NEVER the parent transcript (D-CN9 isolation, at every level). The label is only cosmetic
 * here (`runSubCrew` re-stamps the report with the REAL resolved child crew name); an unresolved name is a
 * stable `Crew <id>` fallback.
 */
export function crewRefToPlannedAgent(args: {
  crewId: string;
  index: number;
  ask: string;
  member: HubCrewMember;
  crewName?: string;
}): HubPlannedAgent {
  const { crewId, index, ask, member, crewName } = args;
  const label = crewName?.trim() || `Crew ${crewId}`;
  const target = (member.target ?? "").trim();
  const emptyGrants: HubToolGrants = { servers: {}, builtins: [] };
  return {
    key: `crew-${index + 1}`,
    name: label,
    // A crew-ref delegates to a whole sub-mission — it has no single role prompt / model of its own.
    systemPrompt: "",
    model: "", // placeholder — `normalizePlannedModels` backfills it from the session model (WP2.1).
    toolGrants: member.toolGrants ?? emptyGrants,
    skillIds: member.skillIds ?? [],
    brief: composeCrewBrief(ask, label, target),
    target,
    expectedOutcome: (member.expectedOutcome ?? "").trim(),
    ...(member.budgets ? { budgets: member.budgets } : {}),
    crewId,
    rationale: `Nested crew "${label}".`,
  };
}

/**
 * Roster hydration (owner decision — the "preferred pool for the planner" choice): when the planner
 * chose to reuse a saved role (it set `roleId` on a planned agent), replace the model's PARAPHRASED
 * config with the saved role's REAL config — system prompt, model, tool grants, skills, target,
 * expected outcome, budgets, and canonical name — while KEEPING the planner's task-specific `key`,
 * `brief`, and `rationale`. Faithful reuse: the saved agent runs exactly as configured in the library,
 * not as the planner paraphrased it. A role's own budgets win; absent, the planner's per-agent budget
 * (if any) is kept. The planner's per-agent `estimatedCostUsd` is DROPPED — it was priced for the
 * model the planner guessed, not the saved role's `defaultModel` we just applied, so leaving it would
 * feed `clampPlanToBudgets`/`shouldAutoApprove` a figure for the wrong model (and could slip a costly
 * hydrated mission past the `threshold` cost gate). Dropping it makes `estimateAgentCostUsd` reprice
 * from the hydrated model.
 *
 * model-identity WP6.1 (F2, second half) — the `providerCredentialId` is now hydrated from the ROLE for
 * exactly the same reason, and the previous behaviour was the worse of the two possible bugs: the spread
 * KEPT the planner's pin while replacing `model` with `role.defaultModel`, so a credential the planner
 * chose for model A silently became authoritative for model B. Faithful reuse means the saved role's
 * real config wins — pin included — so the planner's pin is dropped unconditionally rather than
 * model-matched: on this path the role, not the planner, is the authority on both halves of the choice.
 * A role with no pin therefore hydrates to no pin (the documented heuristic path), never to a
 * planner-guessed credential the library entry never asked for.
 */
export function hydratePlannedAgentFromRole(
  planned: HubPlannedAgent,
  role: HubAgentRole,
): HubPlannedAgent {
  return {
    ...planned,
    roleId: role.id,
    name: role.name,
    systemPrompt: role.systemPrompt,
    model: role.defaultModel,
    // The role's pin owns the role's model (see docstring); `undefined` clears any planner-emitted pin,
    // which was chosen for the model we just replaced.
    providerCredentialId: role.providerCredentialId ?? undefined,
    toolGrants: role.toolGrants,
    skillIds: role.skills.map((skill) => skill.skillId),
    target: role.target.trim(),
    expectedOutcome: role.expectedOutcome,
    ...(role.budgets ? { budgets: role.budgets } : {}),
    // Reprice from the hydrated model (see docstring): drop the planner's stale per-model estimate.
    estimatedCostUsd: undefined,
  };
}

/** The isolated brief for a crew-instantiated agent: the mission ask (the task itself — NOT the parent
 *  chat transcript, so isolation holds) framed by the role's focus. */
export function composeCrewBrief(ask: string, roleName: string, target: string): string {
  const focus = target ? `\n\nYour focus as ${roleName}: ${target}` : "";
  return `${ask.trim()}${focus}`;
}

// ── Production judge seam (NOT gate-verified — no live provider; owner-acceptance) ────────────────────

const judgeVerdictSchema = z.object({
  winnerIndex: z.number().int().min(0),
  rationale: z.string().optional(),
});

/**
 * Production blind judge (best_of_n): a `generateObject` structured-output call that reads the ANONYMIZED
 * attempts and returns the winning index. The prompt states the blindness explicitly and the input it is
 * given carries only labels + rendered bodies — the authoring models/roles are never in scope, so the
 * judge cannot favor an author. A malformed index is clamped by the caller.
 */
export function createStructuredJudge(deps: {
  /** model-identity WP4.2 — widened to take the credential that owns the model (D-MI1). Additive: a
   *  one-argument stub still satisfies this type. */
  buildModel: (modelId: string, providerCredentialId?: string) => LanguageModel;
}): HubJudge {
  return async ({ question, attempts, model, providerCredentialId }) => {
    const system = [
      "You are a BLIND, impartial judge selecting the single best of several independent attempts at the",
      "same task. You do NOT know which model, author, or agent produced any attempt — judge ONLY the",
      "quality, correctness, completeness, and evidence of the work itself. Return the 0-based index of the",
      "single best attempt.",
    ].join(" ");
    const body = attempts
      .map((attempt, i) => `### ${attempt.label} (index ${i})\n${attempt.report}`)
      .join("\n\n");
    const prompt = `Task:\n${question}\n\nAttempts:\n${body}\n\nReturn the index of the single best attempt.`;
    const { object, usage } = await generateObject({
      model: deps.buildModel(model, providerCredentialId),
      schema: judgeVerdictSchema,
      system,
      prompt,
    });
    return {
      winnerIndex: object.winnerIndex,
      ...(object.rationale ? { rationale: object.rationale } : {}),
      costUsd: 0,
      usage: { tokensIn: usage?.inputTokens ?? 0, tokensOut: usage?.outputTokens ?? 0 },
    };
  };
}
