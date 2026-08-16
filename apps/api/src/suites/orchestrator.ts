import type {
  GraderId,
  RatingState,
  RunGrade,
  RunMode,
  RunPlanSource,
  RunStatus,
  SkippedSuiteMember,
  SuiteAggregates,
  SuiteCell,
  SuiteConfig,
  SuiteRun,
  SuiteVariant,
} from "@mcp-token-footprint/shared";
import type { GradeRepository } from "../grading/grade-repository.js";
import type { RunHandle } from "../testing/run-service.js";
import type { RunRepository } from "../testing/run-repository.js";
import {
  assertSkillOverridesResolvable,
  type SkillOverrides,
} from "../testing/scenario-service.js";
import type { SkillRepository } from "../skills/repository.js";
import { httpError } from "../utils/errors.js";
import {
  assertNoQlikAnswersVariants,
  checkMemberCompatibility,
  type MemberCompatibilityDeps,
} from "./member-compatibility.js";
import type { SuiteRepository } from "./repository.js";
import type { SuiteRunManager } from "./suite-run-manager.js";
import type { SuiteRunRepository } from "./suite-run-repository.js";

/**
 * Benchmarks (WP 3.2, B8) — the suite mass-run orchestrator. It executes a suite's test × scenario ×
 * repetition MATRIX by starting each cell as an ORDINARY persisted run through the existing run-service
 * start path (no shortcut execution): full persistence, replay, console, per-run guardrails, and the
 * existing auto-grading hook all fire per cell exactly as for a standalone run.
 *
 * Invariants it upholds (`roadmap/benchmarks/conventions.md`):
 *   - A cell IS a normal run — {@link SuiteRunStarter} is `runService.start` in production. Each run
 *     opens its OWN MCP sessions (that is what `runService.start` already does), so cells are isolated.
 *   - The aggregate cost cap is SOFT-STOP: on reaching it we stop SCHEDULING new cells, let in-flight
 *     ones finish, and mark the suite run `capped`. In-flight runs are never killed; partial results are
 *     first-class.
 *   - `aggregates_json` is DERIVED — recomputable from the child runs + their grades (see
 *     {@link computeSuiteAggregates}); it is cached on the suite run only on completion/cap/stop.
 *
 * Concurrency: a fixed worker pool of `config.maxConcurrency` workers pulls cells off a shared queue
 * (mutating the queue synchronously is atomic under Node's single thread), so in-flight cells never
 * exceed the cap, and no cell is started twice. Process-local by design (single container, no broker).
 *
 * WP 1.5 — a SECOND, narrower cap layers on top for `qlik_answers` cells only: no more than
 * {@link QLIK_ANSWERS_MAX_CONCURRENCY} may be in flight for the SAME provider credential at once
 * (Qlik's tenant rate limit), enforced by {@link SuiteOrchestrator.claimRunnableCell} instead of a plain
 * `queue.shift()`. Every other kind is unaffected — see that method's doc.
 */

/**
 * The injectable run STARTER. Production = `runService.start.bind(runService)`; tests inject a stub.
 * WP 5.1 grows an OPTIONAL trailing `skillOverrides` — a skill-effect variant cell passes its ± skill/
 * version override; a plain (non-variant) cell passes none, so the existing signature is unaffected.
 */
export type SuiteRunStarter = (
  testId: string,
  scenarioId: string,
  mode: RunMode,
  skillOverrides?: SkillOverrides,
) => RunHandle;

/** The injectable run STOPPER (aborts an in-flight child). Production = `runService.stop.bind(runService)`. */
export type SuiteRunStopper = (runId: string) => void;

/**
 * Auto-Rating (WP 4.1, AR7/AR11) — the injectable post-`finish()` suite-report hook. Production =
 * `SuiteReportService.generate` (bound). Called STRICTLY AFTER the suite run is finalized, and its
 * result is intentionally ignored here: report generation must NEVER block, fail, or mutate the suite
 * run (the service persists an honest `partial`/`error` row itself; the orchestrator only swallows). It
 * is awaited inside {@link SuiteOrchestrator.run} so `whenSettled` resolves after the report lands
 * (useful for tests), but the suite run's own status/aggregates/SSE were already emitted by `finish()`.
 */
export type SuiteReportHook = (suiteRunId: string) => Promise<unknown>;

/**
 * The DOCUMENTED per-run "outcome score" selection for the mean-grade aggregation. A run's single score
 * is the latest GRADED score of its PRIMARY grader, chosen by this priority order: `outcome_judge` (the
 * LLM judge of the final answer against the rubric — the closest single proxy for overall output
 * quality) first, then a fixed fallback so a run that lacks the primary grader still contributes a
 * score. A run with NO graded score in any of these is EXCLUDED from meanGrade/stdDev/passRate (counted
 * in neither numerator nor denominator) — it is never treated as a 0.
 */
export const PRIMARY_GRADER_PRIORITY: readonly GraderId[] = [
  "outcome_judge",
  "trajectory_judge",
  "rouge1",
  "value_match",
  "tool_hygiene",
  "skillflow_conformance",
];

/**
 * Qlik Answers (WP 1.5) — the per-provider CONCURRENCY CAP for `qlik_answers` cells. Qlik invoke/stream
 * endpoints are Tier 2 (research doc §3.4): **100 requests/min per tenant**. A mass-run's worker pool
 * (`config.maxConcurrency`) can be set far higher than that for ordinary providers, so left uncapped a
 * suite run could burst many simultaneous `qlik_answers` cells at the SAME tenant credential and blow
 * through its rate limit. Each cell is a multi-second call (thread create + invoke/stream), so only a
 * handful need to be in flight at once to stay comfortably under 100/min — **4** is conservative headroom
 * (4 concurrent multi-second calls is nowhere near 100/min) while still giving a mass-run real
 * parallelism. This is a PROCESS-LOCAL cap, keyed by provider CREDENTIAL id and shared across every
 * suite run this {@link SuiteOrchestrator} instance is concurrently driving (the tenant limit is per
 * credential, not per suite run) — see the `qlikAnswersInFlight`/`qlikAnswersWaiters` fields below. Every
 * OTHER provider kind is completely unaffected: {@link SuiteOrchestrator.qlikAnswersProviderIdFor} returns
 * `undefined` for them, which short-circuits every cap check as a no-op.
 */
export const QLIK_ANSWERS_MAX_CONCURRENCY = 4;

/**
 * A run is settled once it reaches one of these terminal statuses. Unified Sessions (roadmap/
 * unified-sessions/, WP1.6, passthrough) — `ended` joins this set: a suite/mass-run matrix cell is
 * always `mode:"automated"` in practice (so it should never actually reach `ended`, which is reserved
 * for an interactive "End session"), but forwarding the new terminal status here keeps this set in
 * lock-step with {@link RunStatus} rather than silently hanging a cell that somehow does.
 */
const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "completed",
  "stopped",
  "error",
  "aborted",
  "ended",
]);

function isTerminalRunStatus(status: string): boolean {
  return TERMINAL_RUN_STATUSES.has(status as RunStatus);
}

/** The per-child data the aggregation reads — derived purely from a child run row + its grade rows. */
export type ChildRunData = {
  runId: string;
  status: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** The run's primary-grader outcome score (0–1), or null when no grader produced a graded score. */
  outcomeScore: number | null;
  /** Σ `judge_cost_usd` over ALL of this run's grade rows (the true cumulative judge spend). */
  judgeCostUsd: number;
};

/** The primary-grader outcome score for a run, from its latest-per-grader grades (null if none graded). */
function pickOutcomeScore(latestByGrader: Map<GraderId, RunGrade>): number | null {
  for (const graderId of PRIMARY_GRADER_PRIORITY) {
    const grade = latestByGrader.get(graderId);
    if (grade && grade.status === "graded" && grade.score !== null) return grade.score;
  }
  return null;
}

/**
 * Collect the per-child aggregation inputs from persisted state ONLY — the run rows + their grade rows.
 * A run id that no longer resolves (deleted mid-flight) is skipped. `meanGrade`/`passRate` read the
 * LATEST grade per grader (display selection); `judgeCostUsd` sums EVERY grade row (actual spend, so a
 * re-grade's extra judge call is honestly counted). This is the single builder both the orchestrator's
 * cache and any independent recompute go through, so a fresh recompute equals the cached aggregates.
 */
export function collectChildData(
  runs: RunRepository,
  grades: GradeRepository,
  runIds: readonly string[],
): ChildRunData[] {
  const children: ChildRunData[] = [];
  for (const runId of runIds) {
    let summary: ReturnType<RunRepository["getSummary"]>;
    try {
      summary = runs.getSummary(runId);
    } catch {
      continue; // run was deleted — it no longer contributes to the derived aggregates
    }
    const allGrades = grades.listByRun(runId);
    const latestByGrader = new Map<GraderId, RunGrade>();
    for (const grade of allGrades) latestByGrader.set(grade.graderId, grade);
    children.push({
      runId,
      status: summary.status,
      tokensIn: summary.tokensIn,
      tokensOut: summary.tokensOut,
      costUsd: summary.costUsd,
      outcomeScore: pickOutcomeScore(latestByGrader),
      judgeCostUsd: allGrades.reduce((sum, grade) => sum + grade.judgeCostUsd, 0),
    });
  }
  return children;
}

/**
 * The pure aggregation: roll child data + `cellsTotal` into {@link SuiteAggregates}. Deterministic and
 * side-effect-free, so it is exercised in isolation and drives both the live SSE snapshot and the cached
 * `aggregates_json`. `gradeStdDev` is the POPULATION standard deviation (÷N) of the per-run outcome
 * scores; `meanGrade`/`gradeStdDev`/`passRateAt05` are null when no child produced a graded score.
 * `execCostUsd` = Σ run `cost_usd`; `judgeCostUsd` = Σ grade `judge_cost_usd` (a SEPARATE ledger, never
 * folded into exec cost); `totalTokens` = Σ (tokens_in + tokens_out).
 *
 * `skippedMembers` (WP 1.4, D-QA6) is an OPTIONAL trailing param — omitted (or empty) reproduces the
 * exact pre-WP-1.4 return shape (the key is entirely absent, never an empty array), so existing callers
 * that never skip a member see no change.
 */
export function computeSuiteAggregates(
  children: readonly ChildRunData[],
  cellsTotal: number,
  skippedMembers: readonly SkippedSuiteMember[] = [],
): SuiteAggregates {
  const cellsCompleted = children.filter((child) => isTerminalRunStatus(child.status)).length;

  const scores = children
    .map((child) => child.outcomeScore)
    .filter((score): score is number => score !== null);
  const n = scores.length;
  const meanGrade = n > 0 ? scores.reduce((sum, score) => sum + score, 0) / n : null;
  const gradeStdDev =
    n > 0 && meanGrade !== null
      ? Math.sqrt(scores.reduce((acc, score) => acc + (score - meanGrade) ** 2, 0) / n)
      : null;
  const passRateAt05 = n > 0 ? scores.filter((score) => score >= 0.5).length / n : null;

  const totalTokens = children.reduce((sum, child) => sum + child.tokensIn + child.tokensOut, 0);
  const execCostUsd = children.reduce((sum, child) => sum + child.costUsd, 0);
  const judgeCostUsd = children.reduce((sum, child) => sum + child.judgeCostUsd, 0);

  return {
    cellsTotal,
    cellsCompleted,
    meanGrade,
    gradeStdDev,
    passRateAt05,
    totalTokens,
    execCostUsd,
    judgeCostUsd,
    ...(skippedMembers.length > 0 ? { skippedMembers: [...skippedMembers] } : {}),
  };
}

/** One matrix cell as the orchestrator tracks it (mutated in place as the run progresses). */
type OrchestratorCell = {
  testId: string;
  scenarioId: string;
  repetition: number;
  runId?: string;
  status: string; // "pending" → "running" → the child run's terminal status (or "error" if start failed)
  /** WP 5.1 — the skill-effect variant this cell belongs to (absent for a plain tests × scenarios cell). */
  variantLabel?: string;
  /** WP 5.1 — the variant's ± skill/version override threaded to the run starter (absent for a plain cell). */
  skillOverrides?: SkillOverrides;
  /** WP 1.4 (D-QA6) — this cell was never run: its test/environment pairing is incompatible with a
   * `qlik_answers` environment. `status` is `"skipped"` alongside this. */
  skipped?: SkippedSuiteMember["reason"];
  /**
   * WP 1.5 — set the moment this cell is CLAIMED off the queue, when (and only when) it resolves to a
   * `qlik_answers` provider credential (see {@link SuiteOrchestrator.qlikAnswersProviderIdFor}). Recorded
   * here (rather than recomputed later) so `runCell`'s release always frees the EXACT slot that was
   * reserved, even if the underlying scenario/provider row changes mid-run. Absent for every other kind.
   */
  qlikAnswersProviderId?: string;
};

/**
 * Qlik Answers (WP 1.4, D-QA6) — per-(testId, scenarioId) compatibility check, injected so
 * {@link buildScenarioCells} stays pure/testable independent of any repository. Returns the skip reason,
 * or `undefined` for a compatible (or non-`qlik_answers`) pairing.
 */
type MemberCompatibilityChecker = (testId: string, scenarioId: string) => SkippedSuiteMember["reason"] | undefined;

/**
 * Plain matrix (no variants): test × scenario × repetition. WP 1.4 (D-QA6) — an optional `compat`
 * checker marks EVERY repetition of an incompatible (testId, scenarioId) pairing `status:"skipped"` +
 * `skipped:<reason>` instead of `"pending"`, so the scheduler never starts a run for it. Absent `compat`
 * (the pre-WP-1.4 default) reproduces the exact previous cell shape.
 */
function buildScenarioCells(
  testIds: string[],
  scenarioIds: string[],
  repetitions: number,
  compat?: MemberCompatibilityChecker,
): OrchestratorCell[] {
  const cells: OrchestratorCell[] = [];
  for (const testId of testIds) {
    for (const scenarioId of scenarioIds) {
      const skipped = compat?.(testId, scenarioId);
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        cells.push({
          testId,
          scenarioId,
          repetition,
          status: skipped ? "skipped" : "pending",
          ...(skipped ? { skipped } : {}),
        });
      }
    }
  }
  return cells;
}

/**
 * Skill-effect matrix (WP 5.1): test × VARIANT × repetition. Each variant carries its OWN scenario, ±
 * skill/version override, and label — so the SAME test is run under each variant (e.g. base vs +skill)
 * to answer "does attaching skill X make it better/cheaper?". The suite's default `scenarioIds` are NOT
 * expanded here — a variant names its scenario explicitly.
 */
function buildVariantCells(
  testIds: string[],
  variants: SuiteVariant[],
  repetitions: number,
): OrchestratorCell[] {
  const cells: OrchestratorCell[] = [];
  for (const testId of testIds) {
    for (const variant of variants) {
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        cells.push({
          testId,
          scenarioId: variant.scenarioId,
          repetition,
          status: "pending",
          variantLabel: variant.label,
          skillOverrides: variant.skillOverrides,
        });
      }
    }
  }
  return cells;
}

/**
 * Testing IA (WP 2.2, D-T5) — a RESOLVED run plan: the single input the orchestrator executes, whatever
 * its source (a saved `suite`, a `collection`, or an `adhoc`/interactive plan). The route layer resolves
 * a {@link import("@mcp-token-footprint/shared").RunPlanInput} into this shape (loading the suite, or
 * listing a collection's current tests, or reading explicit ids) so ONE code path — {@link
 * SuiteOrchestrator.startPlanRun} — builds the matrix and starts the suite-run. `config.variants` (WP 5.1)
 * still drives the skill-effect axis exactly as for a suite; `scenarioIds` is used only for a plain
 * (non-variant) matrix. `suiteId` is null for collection/adhoc (no Suite row is created); `planJson` is the
 * serialized inline plan for collection/adhoc (null for a suite, whose definition is the saved suite).
 */
export type ResolvedRunPlan = {
  source: RunPlanSource;
  suiteId: string | null;
  testIds: string[];
  scenarioIds: string[];
  config: SuiteConfig;
  planJson: string | null;
};

/** Per-active-suite-run control (process-local; dropped when the suite run settles). */
type SuiteControl = {
  suiteRunId: string;
  configSnapshot: SuiteRun["configSnapshot"];
  cells: OrchestratorCell[];
  cellsTotal: number;
  /** In-flight child run ids (so `stop`/`delete` can abort them). */
  activeRunIds: Set<string>;
  /** Cumulative Σ `cost_usd` of SETTLED children — the soft-stop cap is evaluated against this. */
  spentUsd: number;
  stopped: boolean;
  capped: boolean;
  errored: boolean;
  finished: boolean;
  /** Set by {@link SuiteOrchestrator.delete}: the suite_runs row is being removed, so NO suite report is generated. */
  deleted: boolean;
  /** Resolves when the suite run has fully settled (finalized + suite-report hook run). Exposed via {@link SuiteOrchestrator.whenSettled}. */
  done?: Promise<void>;
};

export class SuiteOrchestrator {
  private readonly controls = new Map<string, SuiteControl>();

  /**
   * WP 1.5 — live in-flight COUNT of `qlik_answers` cells per provider credential id. Only credentials
   * that currently have at least one cell in flight have an entry (removed, not zeroed, on release) so
   * `isQlikAnswersCapped` reads `0` for a resting provider without a map lookup miss ambiguity.
   */
  private readonly qlikAnswersInFlight = new Map<string, number>();

  /**
   * WP 1.5 — workers parked because EVERY remaining cell in their queue currently belongs to a
   * provider at {@link QLIK_ANSWERS_MAX_CONCURRENCY}. Woken (in FIFO order, all at once) the instant any
   * provider's count drops, so a parked worker re-scans rather than the pool deadlocking.
   */
  private qlikAnswersWaiters: Array<() => void> = [];

  constructor(
    private readonly startRun: SuiteRunStarter,
    private readonly stopRun: SuiteRunStopper,
    private readonly runs: RunRepository,
    private readonly suiteRuns: SuiteRunRepository,
    private readonly suites: SuiteRepository,
    private readonly grades: GradeRepository,
    private readonly manager: SuiteRunManager,
    /**
     * Skill registry (WP 5.1) — used ONLY to validate a suite's skill-effect variants UP FRONT (every
     * `attach` references an existing skill/version) before scheduling, so a deleted-skill variant fails
     * the whole suite run at START, not mid-suite. Optional so existing callers/tests that run no variants
     * keep working; when absent, variant validation is skipped (production always wires it).
     */
    private readonly skills?: SkillRepository,
    /**
     * Auto-Rating (WP 4.1) — the optional post-`finish()` suite-report hook (production =
     * `SuiteReportService.generate`). Optional so existing callers/tests that don't want a report keep
     * working; when absent, no report is generated (behavior is exactly as before this WP).
     */
    private readonly generateReport?: SuiteReportHook,
    /**
     * Qlik Answers (WP 1.4, D-QA6) — the clean-session member-compatibility deps (scenario/test/
     * provider lookups), used ONLY to (a) skip a `qlik_answers` member that is incompatible
     * (attachments/`systemPromptOverride`/legacy servers-or-skills) instead of running it, and (b)
     * reject a whole plan up front if any skill-effect variant targets a `qlik_answers` scenario.
     * Optional so existing callers/tests that run no `qlik_answers` scenarios keep working unchanged;
     * when absent, no member is ever skipped and no variant is ever kind-rejected (production always
     * wires it — see `index.ts`).
     */
    private readonly compat?: MemberCompatibilityDeps,
  ) {}

  /**
   * COMPAT wrapper (WP 2.2) — start a run of a SAVED suite. Resolves the suite into a {@link
   * ResolvedRunPlan} (`source:'suite'`, its stored membership + config, no serialized plan) and delegates
   * to {@link startPlanRun}, so the existing `POST /api/suites/:id/run` path is unchanged for callers.
   * 404s if the suite is unknown.
   */
  startSuiteRun(suiteId: string): SuiteRun {
    const suite = this.suites.get(suiteId); // 404 if unknown
    return this.startPlanRun({
      source: "suite",
      suiteId,
      testIds: suite.testIds,
      scenarioIds: suite.scenarioIds,
      config: suite.config,
      planJson: null,
    });
  }

  /**
   * Start a run from a resolved PLAN (WP 2.2, D-T5) — the ONE execution entry for all three sources
   * (`suite` · `collection` · `adhoc`). Builds the full matrix, snapshots the config onto a new
   * `suite_runs` row (`pending` → `running`, stamping `source` + the serialized `plan_json`), kicks off
   * the async scheduling loop, and returns the `running` suite run immediately (the loop drives everything
   * else through the {@link SuiteRunManager} + persistence). Downstream — matrix, KPI rail, soft-stop cost
   * cap, analytics, replay, persistence — is IDENTICAL to a suite run; nothing here is source-specific.
   */
  startPlanRun(plan: ResolvedRunPlan): SuiteRun {
    const configSnapshot = plan.config;
    const variants = configSnapshot.variants ?? [];

    // WP 5.1 — fail the WHOLE suite run at START (before any row/schedule) if a variant's `attach`
    // references a deleted skill/version. This is the "not mid-suite" guarantee: validation is up front,
    // so you never get a half-run matrix with a dud variant. `configSnapshot` (incl. `variants`) is
    // frozen onto the suite_runs row below, so a replay reads the exact variant definitions used.
    if (this.skills) {
      for (const variant of variants) {
        assertSkillOverridesResolvable(this.skills, variant.skillOverrides, variant.label);
      }
    }

    // WP 1.4 (D-QA6) — same fail-fast guarantee: a skill-effect variant plan can't target a
    // `qlik_answers` scenario (its skill overrides are meaningless for a skill-less kind).
    if (this.compat) {
      assertNoQlikAnswersVariants(this.compat, variants);
    }

    // Cells: with skill-effect variants (WP 5.1) the matrix is test × VARIANT × repetition (each variant
    // carries its own scenario + ± skill override + label); otherwise the plain test × scenario × rep.
    // WP 1.4 (D-QA6) — the plain matrix additionally marks an incompatible (testId, scenarioId) pairing
    // `skipped` (never variant cells: a variant targeting the kind was just rejected above).
    const compatChecker = this.compat
      ? (testId: string, scenarioId: string) => checkMemberCompatibility(this.compat!, testId, scenarioId)
      : undefined;
    const cells =
      variants.length > 0
        ? buildVariantCells(plan.testIds, variants, configSnapshot.repetitions)
        : buildScenarioCells(
            plan.testIds,
            plan.scenarioIds,
            configSnapshot.repetitions,
            compatChecker,
          );

    // WP 1.4 (D-QA6) — a plan whose every member is incompatible has nothing to run; mirror the existing
    // empty-collection 400 (`plan-routes.ts`) instead of starting a suite run with zero real cells.
    if (cells.length > 0 && cells.every((cell) => cell.skipped)) {
      throw httpError(
        400,
        "Every member of this plan is incompatible with its Qlik Answers environment(s) — nothing to run.",
      );
    }

    const created = this.suiteRuns.create(plan.suiteId, configSnapshot, plan.source, plan.planJson);
    const control: SuiteControl = {
      suiteRunId: created.id,
      configSnapshot,
      cells,
      cellsTotal: cells.length,
      activeRunIds: new Set(),
      spentUsd: 0,
      stopped: false,
      capped: false,
      errored: false,
      finished: false,
      deleted: false,
    };
    this.controls.set(created.id, control);
    this.manager.create(created.id);
    this.suiteRuns.updateStatus(created.id, "running");
    this.manager.emit(created.id, { type: "status", status: "running" });

    // WP 1.4 (D-QA6) — skipped cells are never scheduled (see `run()`'s runnable-only queue below), so
    // emit them once up front rather than waiting on a worker that will never reach them.
    for (const cell of cells) {
      if (cell.skipped) this.emitCell(control, cell);
    }

    // Kick off async scheduling. The synchronous prefix of `run` starts the first wave before this
    // returns; the rest proceeds off the microtask/IO queue. Never awaited here.
    control.done = this.run(control);

    return this.suiteRuns.getRun(created.id);
  }

  /** True while the suite run is live (registered with the manager and not yet settled). */
  isActive(suiteRunId: string): boolean {
    return this.manager.isActive(suiteRunId);
  }

  /** For tests / callers that need to await full settlement of a started suite run (else resolves immediately). */
  whenSettled(suiteRunId: string): Promise<void> {
    return this.controls.get(suiteRunId)?.done ?? Promise.resolve();
  }

  /**
   * Stop a suite run (WP 3.2). Halts scheduling of NEW cells and aborts every in-flight child via the
   * injected stopper (soft on each — a child that already settled is a no-op). In-flight children wind
   * down to their aborted terminal, and the suite run finalizes as `stopped`. 404 if not active.
   */
  stop(suiteRunId: string): void {
    const control = this.controls.get(suiteRunId);
    if (!control || control.finished) {
      throw httpError(404, "Suite run is not active");
    }
    control.stopped = true;
    for (const runId of [...control.activeRunIds]) this.safeStop(runId);
  }

  /**
   * Delete a suite run (LOCKED: KEEP its child runs). If it is still active, stop scheduling + abort
   * in-flight children first, then detach the live stream so a late event can't race the row delete, and
   * finally CLEAR the children's `suite_run_id` linkage + delete only the `suite_runs` row (repository).
   * 404 if the suite run is unknown.
   */
  delete(suiteRunId: string): void {
    const control = this.controls.get(suiteRunId);
    if (control && !control.finished) {
      control.stopped = true;
      // Short-circuit the eventual `finish()` so it doesn't finalize a row we're about to delete.
      control.finished = true;
      // Suppress the post-`finish()` suite-report hook (WP 4.1) — the suite_runs row is being removed.
      control.deleted = true;
      for (const runId of [...control.activeRunIds]) this.safeStop(runId);
    }
    this.manager.detach(suiteRunId);
    this.controls.delete(suiteRunId);
    this.suiteRuns.delete(suiteRunId); // unlink children (KEEP them) + delete the suite_runs row; 404 if unknown
  }

  // --- scheduling ------------------------------------------------------------------------------

  /** Drive the whole matrix through a bounded worker pool, then finalize + (WP 4.1) generate the suite report. */
  private async run(control: SuiteControl): Promise<void> {
    try {
      // WP 1.4 (D-QA6) — skipped cells are already emitted (see `startPlanRun`) and never started as a
      // run; the worker pool only ever pulls RUNNABLE cells off the queue.
      const runnable = control.cells.filter((cell) => !cell.skipped);
      const workerCount = Math.min(control.configSnapshot.maxConcurrency, runnable.length);
      const queue = [...runnable];
      const workers = Array.from({ length: workerCount }, () => this.worker(control, queue));
      await Promise.all(workers);
    } catch {
      control.errored = true;
    } finally {
      this.finish(control);
    }
    // Auto-Rating (WP 4.1, AR7/AR11) — STRICTLY AFTER the suite run is finalized (status + aggregates +
    // SSE already emitted by `finish()`), generate + persist the cross-run suite report — now wrapped
    // in the additive suite-level rating axis (`rating` → a GUARANTEED settled state). It runs post-
    // finalize and fully guarded, so it can NEVER block, fail, or mutate the suite run; the AR7 ≥2-member
    // gate + the deterministic analytics live in the injected hook (SuiteReportService.generate).
    await this.rateSuiteRun(control);
  }

  /**
   * AR11 — the suite-level review phase around the post-`finish()` report hook, mirroring the
   * run-service rating axis:
   *
   *   - Deleted mid-flight → nothing to settle (the suite_runs row is being removed; the manager was
   *     already detached, so any emit here would be a no-op anyway).
   *   - No {@link SuiteReportHook} injected → the axis settles `skipped` (no review can happen).
   *   - Otherwise → `rating` is persisted + emitted, the hook runs (it itself triggers/awaits member
   *     ratings), then `rated` — or `failed` on an escaped throw (still swallowed: report generation
   *     must never affect the already-finalized suite run; the hook's own service persists an honest
   *     `partial`/`error` row on its own).
   *
   * The `finally` GUARANTEES a settled state is always persisted + emitted — the suite SSE close
   * semantics and the {@link SuiteRunManager}'s terminal cleanup both wait for it.
   */
  private async rateSuiteRun(control: SuiteControl): Promise<void> {
    if (control.deleted) return;
    if (!this.generateReport) {
      this.transitionRating(control.suiteRunId, "skipped");
      return;
    }
    this.transitionRating(control.suiteRunId, "rating");
    let settled: RatingState = "rated";
    try {
      await this.generateReport(control.suiteRunId);
    } catch {
      settled = "failed"; // the report hook threw — the suite run's own result is untouched (AR11)
    } finally {
      this.transitionRating(control.suiteRunId, settled);
    }
  }

  /**
   * Persist + emit one suite-level rating-axis transition (AR11). The persistence write is guarded (a
   * suite run deleted mid-review updates 0 rows; nothing here may throw past `rateSuiteRun`), and the
   * emit goes through the SAME {@link SuiteRunManager} channel as `status` events, so the live stream
   * + bounded replay buffer carry it (a detached/deleted suite run's emit is a no-op).
   */
  private transitionRating(suiteRunId: string, state: RatingState): void {
    try {
      this.suiteRuns.setRatingState(suiteRunId, state);
    } catch {
      // Never let rating bookkeeping throw out of the settled scheduling chain.
    }
    this.manager.emit(suiteRunId, { type: "rating", state });
  }

  /**
   * One worker: pull the next pending RUNNABLE cell off the shared queue and run it to settlement,
   * repeating until the queue drains OR scheduling is halted (stop/cap). The `stopped`/`capped` checks
   * gate only NEW cells — a cell already inside {@link runCell} always finishes (soft-stop).
   *
   * WP 1.5 — "next pending cell" is no longer always `queue[0]`: {@link claimRunnableCell} skips over a
   * `qlik_answers` cell whose provider is currently at {@link QLIK_ANSWERS_MAX_CONCURRENCY} (for every
   * OTHER kind it always returns `queue[0]`, i.e. exactly the old `queue.shift()` behavior — a no-op).
   * If EVERY remaining cell is capped right now (queue non-empty but nothing claimable), the worker
   * parks on {@link waitForQlikAnswersSlot} instead of busy-looping or giving up — it is woken the
   * instant any provider's in-flight count drops (a cell always eventually settles, so this can't
   * deadlock) and re-scans the queue from the top.
   */
  private async worker(control: SuiteControl, queue: OrchestratorCell[]): Promise<void> {
    while (!control.stopped && !control.capped) {
      if (queue.length === 0) return; // truly nothing left — done (never wait on an empty queue)
      const cell = this.claimRunnableCell(queue);
      if (!cell) {
        await this.waitForQlikAnswersSlot();
        continue; // re-check stopped/capped, then re-scan — a freed slot may still be taken by another worker
      }
      await this.runCell(control, cell);
    }
  }

  /**
   * Run one cell AS A NORMAL RUN: start it via the injected starter, stamp its suite linkage, await the
   * run to settle, then accrue its settled cost toward the soft-stop cap and emit a cell transition +
   * a recomputed aggregate snapshot. Never throws (a failed start/await is recorded on the cell).
   *
   * WP 1.5 — the whole body is wrapped in a `finally` that releases this cell's `qlik_answers` provider
   * slot (reserved by {@link claimRunnableCell} before this was ever called) on EVERY exit path — the
   * early return on a start failure included — so a slot is never leaked and the next parked worker
   * always eventually wakes.
   */
  private async runCell(control: SuiteControl, cell: OrchestratorCell): Promise<void> {
    try {
      cell.status = "running";
      let handle: RunHandle;
      try {
        handle = this.startRun(cell.testId, cell.scenarioId, "automated", cell.skillOverrides);
      } catch {
        cell.status = "error";
        this.emitCell(control, cell);
        return;
      }
      cell.runId = handle.runId;
      control.activeRunIds.add(handle.runId);
      // Stamp the suite linkage on the just-started run (additive; tolerates a raced delete).
      this.runs.linkRunToSuite(handle.runId, control.suiteRunId, cell.repetition);
      this.emitCell(control, cell); // cell started (running)

      try {
        const result = await handle.done;
        cell.status = result.status;
      } catch {
        cell.status = "error";
      } finally {
        control.activeRunIds.delete(handle.runId);
      }

      // Accrue the settled child's cost, then evaluate the soft-stop cap (the run row's cost_usd is
      // finalized on its terminal status, before `done` resolves, so this reads the real spend).
      const summary = this.safeSummary(handle.runId);
      if (summary) control.spentUsd += summary.costUsd;
      const cap = control.configSnapshot.aggregateCostCapUsd;
      if (typeof cap === "number" && control.spentUsd >= cap) control.capped = true;

      this.emitCell(control, cell); // cell settled
      this.emitAggregates(control); // live progress snapshot (no DB write — cache is written on finalize)
    } finally {
      if (cell.qlikAnswersProviderId !== undefined) {
        this.releaseQlikAnswersSlot(cell.qlikAnswersProviderId);
      }
    }
  }

  // --- qlik_answers per-provider concurrency cap (WP 1.5) ---------------------------------------

  /**
   * Scan the queue in order for the first cell that is runnable RIGHT NOW, splice it out, and (for a
   * `qlik_answers` cell) reserve its provider slot before returning it. Returns `undefined` only when
   * EVERY remaining cell's provider is currently at cap (never when the queue is merely empty — the
   * caller checks that separately). For a non-`qlik_answers` cell (or when `compat` isn't wired at all)
   * `qlikAnswersProviderIdFor` returns `undefined`, so the very first scan iteration always matches —
   * i.e. this reduces to exactly `queue.shift()` whenever no cell in the queue is `qlik_answers`.
   */
  private claimRunnableCell(queue: OrchestratorCell[]): OrchestratorCell | undefined {
    for (let i = 0; i < queue.length; i++) {
      const cell = queue[i];
      if (cell === undefined) continue;
      const providerId = this.qlikAnswersProviderIdFor(cell);
      if (providerId !== undefined) {
        if (this.isQlikAnswersCapped(providerId)) continue; // this provider is saturated — try the next cell
        this.acquireQlikAnswersSlot(providerId);
        cell.qlikAnswersProviderId = providerId; // remembered so runCell releases the SAME slot on settle
      }
      queue.splice(i, 1);
      return cell;
    }
    return undefined;
  }

  /**
   * The `qlik_answers` provider CREDENTIAL id a cell's scenario resolves to, or `undefined` for every
   * other kind (never capped) — including when `compat` isn't wired (pre-WP-1.5 callers/tests: every
   * cell is then treated as uncapped, exactly the old behavior) or the scenario/provider no longer
   * resolves (never this cap's concern — the run starter's own lookup surfaces that honestly).
   */
  private qlikAnswersProviderIdFor(cell: OrchestratorCell): string | undefined {
    if (!this.compat) return undefined;
    try {
      const scenario = this.compat.scenarios.get(cell.scenarioId);
      const kind = this.compat.providers.get(scenario.providerId).kind;
      return kind === "qlik_answers" ? scenario.providerId : undefined;
    } catch {
      return undefined;
    }
  }

  private isQlikAnswersCapped(providerId: string): boolean {
    return (this.qlikAnswersInFlight.get(providerId) ?? 0) >= QLIK_ANSWERS_MAX_CONCURRENCY;
  }

  private acquireQlikAnswersSlot(providerId: string): void {
    this.qlikAnswersInFlight.set(providerId, (this.qlikAnswersInFlight.get(providerId) ?? 0) + 1);
  }

  /** Release one slot and wake EVERY parked worker — each re-scans its own queue for a now-claimable cell. */
  private releaseQlikAnswersSlot(providerId: string): void {
    const next = (this.qlikAnswersInFlight.get(providerId) ?? 1) - 1;
    if (next <= 0) this.qlikAnswersInFlight.delete(providerId);
    else this.qlikAnswersInFlight.set(providerId, next);
    const waiters = this.qlikAnswersWaiters;
    this.qlikAnswersWaiters = [];
    for (const wake of waiters) wake();
  }

  private waitForQlikAnswersSlot(): Promise<void> {
    return new Promise((resolve) => this.qlikAnswersWaiters.push(resolve));
  }

  /** Finalize the suite run: persist status + derived aggregates, emit the terminal snapshot. Idempotent. */
  private finish(control: SuiteControl): void {
    if (control.finished) return;
    control.finished = true;
    const status = control.stopped
      ? "stopped"
      : control.capped
        ? "capped"
        : control.errored
          ? "error"
          : "completed";
    const aggregates = this.aggregatesFor(control);
    this.suiteRuns.finalize(control.suiteRunId, status, aggregates);
    this.manager.emit(control.suiteRunId, { type: "aggregates", aggregates });
    this.manager.emit(control.suiteRunId, { type: "status", status });
    this.controls.delete(control.suiteRunId);
  }

  // --- aggregates + emit -----------------------------------------------------------------------

  /** Recompute the suite aggregates from the started cells' persisted runs + grades. */
  private aggregatesFor(control: SuiteControl): SuiteAggregates {
    const runIds = control.cells
      .map((cell) => cell.runId)
      .filter((runId): runId is string => runId !== undefined);
    return computeSuiteAggregates(
      collectChildData(this.runs, this.grades, runIds),
      control.cellsTotal,
      this.skippedMembersFor(control),
    );
  }

  /**
   * WP 1.4 (D-QA6) — the plan's skipped-incompatible members, one entry per DISTINCT (testId,
   * scenarioId) pairing (not per repetition — every repetition of a skipped pairing shares one reason).
   */
  private skippedMembersFor(control: SuiteControl): SkippedSuiteMember[] {
    const seen = new Set<string>();
    const result: SkippedSuiteMember[] = [];
    for (const cell of control.cells) {
      if (!cell.skipped) continue;
      const key = `${cell.testId}::${cell.scenarioId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ testId: cell.testId, scenarioId: cell.scenarioId, reason: cell.skipped });
    }
    return result;
  }

  private emitAggregates(control: SuiteControl): void {
    if (control.finished) return;
    this.manager.emit(control.suiteRunId, {
      type: "aggregates",
      aggregates: this.aggregatesFor(control),
    });
  }

  private emitCell(control: SuiteControl, cell: OrchestratorCell): void {
    const suiteCell: SuiteCell = {
      testId: cell.testId,
      scenarioId: cell.scenarioId,
      repetition: cell.repetition,
      status: cell.status,
    };
    if (cell.runId !== undefined) suiteCell.runId = cell.runId;
    if (cell.variantLabel !== undefined) suiteCell.variantLabel = cell.variantLabel; // WP 5.1 skill-effect axis
    if (cell.skipped !== undefined) suiteCell.skipped = cell.skipped; // WP 1.4 (D-QA6)
    this.manager.emit(control.suiteRunId, { type: "cell", cell: suiteCell });
  }

  private safeStop(runId: string): void {
    try {
      this.stopRun(runId);
    } catch {
      // The child already settled (or isn't active) — nothing to abort.
    }
  }

  private safeSummary(runId: string): ReturnType<RunRepository["getSummary"]> | undefined {
    try {
      return this.runs.getSummary(runId);
    } catch {
      return undefined; // the run row was deleted — no cost to accrue
    }
  }
}
