import {
  ANSWER_VALIDATION_VERDICTS,
  AUTO_RATING_VERSION,
  CLAUDE_CLI_PROVIDER_ID,
  ERROR_FINDING_CATEGORIES,
  FIX_TARGETS,
  ROOT_CAUSE_BUCKETS,
  type AnswerValidationVerdict,
  type CostBasis,
  type ErrorFinding,
  type ErrorFindingCategory,
  type FailureBucket,
  type FixTarget,
  type GraderId,
  type JudgeSettings,
  type RootCauseBucket,
  type RunDetail,
  type RunEvent,
  type RunGrade,
  type SkippedSuiteMember,
  type SuiteReport,
  type SuiteReportBaseline,
  type SuiteReportTestGroup,
  type SuiteReportVariance,
  type SuiteRootCauseRollupEntry,
  type SuiteTestGroupAgreement,
} from "@mcp-token-footprint/shared";
import { finalAssistantText } from "../grading/grader.js";
import type { GradeRepository } from "../grading/grade-repository.js";
import type { JudgeGenerate, JudgeGenerateResult } from "../grading/judge.js";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import type { RunRepository } from "../testing/run-repository.js";
import { PRIMARY_GRADER_PRIORITY } from "./orchestrator.js";
import type {
  SuiteReportRepository,
  SuiteReportStatus,
  SuiteRunReportRecord,
} from "./suite-report-repository.js";
import type { SuiteRunRepository } from "./suite-run-repository.js";

/**
 * Auto-Rating (WP 4.1/4.2, AR7/AR10–AR13/AR15) — generates the mandatory cross-run report for a suite
 * run with **≥2 members** (AR7).
 *
 * WP 4.1 built the DETERMINISTIC parts (per-test-group variance, tool-path variance, error clustering).
 * WP 4.2 (this pass) fills the remaining three facets:
 *   - `rootCauseRollup` — DETERMINISTIC (no judge): {@link computeRootCauseRollup} aggregates the
 *     members' `error_forensics` findings by `(bucket, fixTarget)`. Folded straight into
 *     {@link buildDeterministicSuiteReport} since it needs no judge call.
 *   - `testGroups[].agreement` — AR10: exactly ONE judge call per test-group (never pairwise),
 *     reusing the SAME judge-chain instances the graders use (`resolveJudge`/`generate`, WP 2.3,
 *     injected via {@link SuiteReportServiceDeps}). See {@link computeGroupAgreement}.
 *   - `narrative` — a DETERMINISTIC synthesis of the agreement verdicts + the root-cause roll-up (see
 *     {@link buildSuiteReportNarrative}). Documented choice: the narrative is NOT itself an LLM
 *     generation — it is assembled by the app from already-computed, cited data (the per-group
 *     agreement summaries + the top root-cause entries), so it can never assert anything the
 *     deterministic/judge-backed facets don't already support (no invented claims), and it degrades
 *     honestly (AR11) without a second judge call.
 *
 * HARD invariants (README "Invariants" + AR11):
 *   - Generation NEVER blocks, fails, or mutates the suite run. It is chained STRICTLY AFTER the
 *     orchestrator's `finish()` finalized the row (status + aggregates + SSE), so the suite run is already
 *     complete from every observer's perspective. A generation crash is swallowed into a `status:"error"`
 *     report row — the suite run's status/aggregates/SSE are never touched. A judge failure during the
 *     AGREEMENT step degrades ONLY that test-group's facet honestly — it never demotes the whole report
 *     to `status:"error"` (the deterministic analytics already succeeded).
 *   - APPEND-ONLY, latest wins ({@link SuiteReportRepository}); versioned (`ratingVersion` =
 *     {@link AUTO_RATING_VERSION}); judge cost is a SEPARATE ledger (B5) — summed ONLY from the
 *     per-test-group agreement calls (never folded with a run's own `cost_usd` or the base-grader
 *     judge ledger).
 *   - Suite `aggregates_json` stays the SOURCE OF TRUTH for cost/mean; the report is DERIVED.
 *
 * Ordering seam (the risk this WP closes): a member run is FULLY rated by the time `handle.done` resolves
 * (`run-service.ts` chains `evaluateRunAssertions → gradeRun` onto the settled promise), and the
 * orchestrator awaits each cell's `handle.done` before `Promise.all(workers)` → `finish()`. So in
 * production the members are already rated when generation runs. {@link waitForMemberGrades} is a BOUNDED
 * safety net: if a member's grades haven't landed within the timeout (e.g. AR14's rating semaphore serializes
 * a slow/queued CLI rating), the report is `partial` — NEVER a hang, NEVER a fake score.
 */

/** Default bound (ms) on the member-grade wait — a run whose grades never land yields a `partial` report, never a hang. */
export const DEFAULT_MEMBER_GRADE_WAIT_MS = 30_000;
/** Poll interval (ms) while waiting for member grades. In production the first check already passes (members are rated). */
export const DEFAULT_MEMBER_GRADE_POLL_MS = 250;
/**
 * Default OUTER bound (ms) on ONE per-test-group agreement invocation — includes the CLI judge chain's
 * AR14 queue wait (the tight per-call bounds live inside the chain's legs; see
 * `grading/judge.ts` `DEFAULT_JUDGE_QUEUE_BACKSTOP_MS`). A genuinely stuck judge degrades that group
 * honestly, never a hang.
 */
export const DEFAULT_AGREEMENT_TIMEOUT_MS = 15 * 60_000;

/** Dependencies for {@link SuiteReportService}. Persistence-only, PLUS (WP 4.2) the optional judge-chain seam. */
export type SuiteReportServiceDeps = {
  suiteRuns: SuiteRunRepository;
  runs: RunRepository;
  grades: GradeRepository;
  reports: SuiteReportRepository;
  /** Bound on the member-grade wait; defaults to {@link DEFAULT_MEMBER_GRADE_WAIT_MS}. */
  gradeWaitTimeoutMs?: number;
  /** Poll interval while waiting; defaults to {@link DEFAULT_MEMBER_GRADE_POLL_MS}. */
  gradeWaitPollMs?: number;
  /**
   * WP 4.2 (AR2/AR3/AR10) — the SAME judge-chain resolver instance the graders use (`chainJudgeResolver`
   * in `index.ts`), or a test double. Omitted, or returning `null`, means "no judge available" — the
   * per-test-group agreement facet degrades to an honest, neutral verdict (AR11); it NEVER throws.
   */
  resolveJudge?: () => JudgeSettings | null;
  /** WP 4.2 — the SAME judge-chain generate (`createJudgeChainGenerate`), paired with `resolveJudge`. */
  generate?: JudgeGenerate;
  /** Bound on a single per-test-group agreement call; defaults to {@link DEFAULT_AGREEMENT_TIMEOUT_MS}. */
  agreementTimeoutMs?: number;
};

/**
 * The `error_forensics` base grader id (Auto-Rating WP 1.3). Kept as a compile-time-checked literal
 * (`satisfies GraderId`) instead of importing from the grading module, so the suites layer stays
 * decoupled from the graders while a rename of the wire id still fails typecheck here.
 */
const ERROR_FORENSICS_GRADER_ID = "error_forensics" satisfies GraderId;

/** The `answer_validation` base grader id — same decoupling rationale as {@link ERROR_FORENSICS_GRADER_ID}. */
const ANSWER_VALIDATION_GRADER_ID = "answer_validation" satisfies GraderId;

export class SuiteReportService {
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly agreementTimeoutMs: number;

  constructor(private readonly deps: SuiteReportServiceDeps) {
    this.timeoutMs = deps.gradeWaitTimeoutMs ?? DEFAULT_MEMBER_GRADE_WAIT_MS;
    this.pollMs = deps.gradeWaitPollMs ?? DEFAULT_MEMBER_GRADE_POLL_MS;
    this.agreementTimeoutMs = deps.agreementTimeoutMs ?? DEFAULT_AGREEMENT_TIMEOUT_MS;
  }

  /**
   * Generate + persist the suite report for a finished suite run. Returns the appended record, or `null`
   * when the AR7 gate isn't met (<2 members → the per-run report suffices) or the suite run was deleted.
   * NEVER throws — a build crash is caught and persisted as a `status:"error"` row (the suite run is
   * already finalized, so nothing about it is touched).
   */
  async generate(suiteRunId: string): Promise<SuiteRunReportRecord | null> {
    let memberRunIds: string[];
    try {
      memberRunIds = this.deps.suiteRuns.listChildRunIds(suiteRunId);
    } catch {
      return null; // suite run gone (raced delete) — nothing to report on
    }
    // AR7 — a suite report is generated ONLY for ≥2 members; a single-member run relies on the per-run report.
    if (memberRunIds.length < 2) return null;

    // The ordering seam: bounded-wait until every member is rated → a slow rating yields `partial`, never a hang.
    const complete = await this.waitForMemberGrades(memberRunIds);

    let status: SuiteReportStatus = complete ? "ready" : "partial";
    let report: SuiteReport;
    try {
      report = buildDeterministicSuiteReport(
        this.deps.runs,
        this.deps.grades,
        suiteRunId,
        memberRunIds,
      );
    } catch {
      // Generation crashed AFTER the suite run finalized — degrade to an honest empty `error` report.
      report = emptySuiteReport(suiteRunId);
      status = "error";
    }

    // WP 4.2 — the per-test-group agreement calls + narrative are a SEPARATE, independently-guarded step:
    // a judge failure here must NEVER demote an otherwise-successful deterministic build to `status:"error"`
    // (AR11). A crash in this step (unexpected — each group is already internally guarded) just leaves the
    // report's honest 4.1-era placeholders in place rather than losing the deterministic analytics.
    let judgeLedger: JudgeLedgerTotals = NEUTRAL_JUDGE_LEDGER;
    // Claude subscription (roadmap/claude-subscription/, WP 2.2, D-CS4/D-CS8) — the member run ids
    // whose `costUsd` is a subscription SHADOW-price estimate (never billed), read from the SAME
    // member data `enrichWithAgreement` already fetches (no extra I/O). Stays the empty set — never a
    // throw — when enrichment didn't run or found none; the findings/narrative markers below simply
    // omit the note in that case (honest degradation, mirrors every other best-effort step here).
    let subscriptionRunIds: ReadonlySet<string> = new Set();
    if (status !== "error") {
      try {
        const enriched = await this.enrichWithAgreement(report, memberRunIds);
        report = enriched.report;
        judgeLedger = enriched.ledger;
        subscriptionRunIds = enriched.subscriptionRunIds;
      } catch {
        // Leave `report` as the deterministic build produced it (honest placeholders) — never throw.
      }
    }

    // Qlik Answers (WP 1.4, D-QA6) — echo the suite run's ALREADY-FINALIZED skipped-incompatible
    // members (cached on `aggregates_json` by the orchestrator's `finalize()`, no separate query/table)
    // onto the persisted report, so the operator sees "N skipped: incompatible" here too. Best-effort:
    // an unreadable suite run here can't ordinarily happen (its child ids were just read above), but
    // this step must never fail generation — it just leaves the report's `skippedMembers` honestly `[]`.
    report = { ...report, skippedMembers: this.readSkippedMembers(suiteRunId) };

    // Suite-report enrichment — per-test-group findings highlights: DETERMINISTIC, evidence-grounded
    // sentences derived ONLY from the already-computed facets (agreement contradiction, score spread,
    // tool-path divergence, cost outlier, error-cluster membership — see computeTestGroupFindings).
    // Guarded: a crash here just leaves the groups without `findings`, never fails generation.
    try {
      report = {
        ...report,
        testGroups: report.testGroups.map((group) => ({
          ...group,
          findings: computeTestGroupFindings(group, report.errorClustering, subscriptionRunIds),
        })),
      };
    } catch {
      // findings stay absent — never fail generation on a highlights computation
    }

    // Suite-report enrichment — cross-suite-run baseline delta: compare against the most recent
    // EARLIER comparable suite run that has a persisted report (same suiteId; else identical sorted
    // member-testId set). BEST-EFFORT (guarded): any failure just omits `baseline`, never fails
    // generation (mirrors the skipped-members echo above).
    try {
      const baseline = this.computeBaseline(suiteRunId, report);
      if (baseline) report = { ...report, baseline };
    } catch {
      // baseline omitted — never fail generation on a baseline lookup/compute
    }

    // Stamp the row's status INSIDE the persisted report too (additive), so a report read out of the
    // JSON export carries it directly; the GET route still echoes the row's status for pre-stamp rows.
    report = { ...report, status };

    try {
      return this.deps.reports.insert({
        suiteRunId,
        status,
        report,
        ratingVersion: AUTO_RATING_VERSION,
        judgeProviderId: judgeLedger.judgeProviderId,
        judgeModel: judgeLedger.judgeModel,
        judgeTokensIn: judgeLedger.judgeTokensIn,
        judgeTokensOut: judgeLedger.judgeTokensOut,
        judgeCostUsd: judgeLedger.judgeCostUsd,
      });
    } catch {
      return null; // FK gone (the suite run was deleted mid-generation) — never propagate
    }
  }

  /**
   * Poll `run_grades` for the member run ids until each has landed at least one grade row (rated) or the
   * bound elapses. Returns `true` when all members are rated (→ `ready`), `false` on timeout (→ `partial`).
   * In production the first check already passes (members are rated when `handle.done` resolved), so this
   * adds no real delay; it is purely the never-hang safety net for a queued/slow rating (AR14).
   */
  private async waitForMemberGrades(runIds: readonly string[]): Promise<boolean> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      if (runIds.every((runId) => this.isRated(runId))) return true;
      if (Date.now() >= deadline) return false;
      await delay(this.pollMs);
    }
  }

  /** A member is "rated" once it carries ≥1 grade row (AR5 guarantees error_forensics always emits one). */
  private isRated(runId: string): boolean {
    try {
      return this.deps.grades.listByRun(runId).length > 0;
    } catch {
      return true; // a member that no longer resolves cannot gate the report (never hang on it)
    }
  }

  /**
   * Qlik Answers (WP 1.4, D-QA6) — read the skipped-incompatible members the orchestrator already
   * cached on this suite run's `aggregates_json` at `finalize()` time. Never throws: an unreadable
   * suite run (or one with no skipped members) yields `[]`, never blocking report generation.
   */
  private readSkippedMembers(suiteRunId: string): SkippedSuiteMember[] {
    try {
      return this.deps.suiteRuns.getRun(suiteRunId).aggregates?.skippedMembers ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Suite-report enrichment — resolve the baseline for cross-suite-run comparability: the most recent
   * EARLIER suite run (by `started_at`) that (a) is comparable — same `suiteId` when the current run
   * has one, else an identical sorted set of member test ids (derived from the runs' summaries) —
   * and (b) has a persisted report. Returns the computed per-test deltas, or `null` when no
   * comparable baseline exists. Callers guard this (best-effort — it must never fail generation).
   */
  private computeBaseline(suiteRunId: string, report: SuiteReport): SuiteReportBaseline | null {
    const current = this.deps.suiteRuns.getRun(suiteRunId);
    const candidates = this.deps.suiteRuns.listRunsStartedBefore(current.startedAt, current.id);
    // The current run's member-testId key is only needed for the suite-less (collection/adhoc) path.
    const currentTestKey = current.suiteId === undefined ? this.memberTestKey(suiteRunId) : null;
    for (const candidate of candidates) {
      if (current.suiteId !== undefined) {
        if (candidate.suiteId !== current.suiteId) continue;
      } else if (currentTestKey === null || this.memberTestKey(candidate.id) !== currentTestKey) {
        continue;
      }
      const baselineRecord = this.deps.reports.latest(candidate.id);
      if (!baselineRecord) continue; // comparable, but never reported on — keep looking further back
      return {
        suiteRunId: candidate.id,
        generatedAt: baselineRecord.report.generatedAt || baselineRecord.createdAt,
        perTest: computeBaselineDeltas(report, baselineRecord.report),
      };
    }
    return null;
  }

  /**
   * The DISTINCT member test ids of a suite run, sorted and joined into one comparable key (derived
   * from the child runs' summaries). `null` when the suite run is unreadable — a candidate that can't
   * be keyed is simply not comparable (never a thrown baseline failure).
   */
  private memberTestKey(suiteRunId: string): string | null {
    try {
      const testIds = new Set<string>();
      for (const runId of this.deps.suiteRuns.listChildRunIds(suiteRunId)) {
        try {
          testIds.add(this.deps.runs.getSummary(runId).testId);
        } catch {
          // member deleted mid-flight — it no longer contributes a test id (mirrors collectChildData)
        }
      }
      return [...testIds].sort().join("\u0000");
    } catch {
      return null;
    }
  }

  /**
   * WP 4.2 (AR10) — fill `testGroups[].agreement` (ONE judge call per test-group, sequential so the call
   * order is stable + never pairwise) and derive `narrative`/`judgeProvenance` from the results. Returns
   * the enriched report plus the SEPARATE judge-cost ledger totals summed across every agreement call that
   * actually ran (whether its response parsed or not — a spent call is always accounted for honestly).
   *
   * Claude subscription (WP 2.2, D-CS4/D-CS8) — also returns `subscriptionRunIds`: the member run ids
   * whose `costUsd` is a subscription shadow-price estimate, read off {@link collectGroupMemberAnswers}'s
   * ALREADY-fetched `RunDetail.events` (no extra DB round trip). This makes NO judge call and is
   * unaffected by whether a judge is configured — it degrades to the empty set on its own (e.g. every
   * member is unresolvable), never throwing, so a judge failure elsewhere still can't hide it.
   */
  private async enrichWithAgreement(
    report: SuiteReport,
    memberRunIds: readonly string[],
  ): Promise<{ report: SuiteReport; ledger: JudgeLedgerTotals; subscriptionRunIds: ReadonlySet<string> }> {
    const memberAnswers = collectGroupMemberAnswers(this.deps.runs, this.deps.grades, memberRunIds);
    const answersByRunId = new Map(memberAnswers.map((member) => [member.runId, member]));
    const subscriptionRunIds = new Set(
      memberAnswers
        .filter((member) => member.costBasis === SUBSCRIPTION_COST_BASIS)
        .map((member) => member.runId),
    );

    const testGroups: SuiteReportTestGroup[] = [];
    const outcomes: AgreementOutcome[] = [];
    for (const group of report.testGroups) {
      const members = group.runIds
        .map((runId) => answersByRunId.get(runId))
        .filter((member): member is GroupMemberAnswer => member !== undefined);

      let outcome: AgreementOutcome;
      try {
        outcome = await computeGroupAgreement(
          { resolveJudge: this.deps.resolveJudge, generate: this.deps.generate },
          group.testId,
          members,
          group.runIds.length,
          this.agreementTimeoutMs,
        );
      } catch {
        // Defensive only — computeGroupAgreement already catches every failure path internally.
        outcome = {
          agreement: honestNeutralAgreement(group.runIds.length, JUDGE_CALL_FAILED_SUMMARY),
          evaluated: false,
        };
      }
      outcomes.push(outcome);
      testGroups.push({ ...group, agreement: outcome.agreement });
    }

    const evaluatedGroupCount = outcomes.filter((outcome) => outcome.evaluated).length;
    const narrative = buildSuiteReportNarrative({
      testGroups,
      evaluatedGroupCount,
      rootCauseRollup: report.rootCauseRollup,
      subscriptionRunCount: subscriptionRunIds.size,
    });

    const ledgers = outcomes
      .map((outcome) => outcome.ledger)
      .filter((ledger): ledger is JudgeLedgerTotals => ledger !== undefined);
    const totals = ledgers.reduce(mergeJudgeLedger, NEUTRAL_JUDGE_LEDGER);

    return {
      report: {
        ...report,
        testGroups,
        narrative,
        judgeProvenance: { judgeProviderId: totals.judgeProviderId, judgeModel: totals.judgeModel },
      },
      ledger: totals,
      subscriptionRunIds,
    };
  }
}

// ── Deterministic analytics (pure, read-only — unit-testable) ──────────────────────────────────────

/** One member run's data the deterministic analytics reads (resolvable runs only; a deleted run is skipped). */
type MemberDatum = {
  runId: string;
  testId: string;
  /** Primary-grader outcome score (same selection as `computeSuiteAggregates`'s meanGrade — AR15), or null. */
  score: number | null;
  costUsd: number;
  turns: number;
  /** The ordered tool-call SHAPE signature (tool names joined) — powers `toolPathVariance`. */
  toolPath: string;
};

const TOOL_PATH_SEP = "";

/**
 * Build the DETERMINISTIC {@link SuiteReport} — per-test-group variance (score/cost/turns), tool-path
 * variance, deterministic error clustering, AND (WP 4.2) the deterministic cross-run root-cause roll-up
 * (no judge call needed for any of these). `testGroups[].agreement` and `narrative` are still honest
 * placeholders here — {@link SuiteReportService.enrichWithAgreement} fills them (they need the judge
 * chain / the agreement results, which this pure function has no access to).
 *
 * SCORE selection (AR15 — never mixed): the per-group `score` variance uses the SAME primary-grader
 * outcome score as {@link import("./orchestrator.js").computeSuiteAggregates}'s `meanGrade`
 * ({@link PRIMARY_GRADER_PRIORITY}), NOT the base-rating scores (which stay a separate dimension, AR6).
 *
 * Deterministic-vs-judge split (AR12): error clustering here keys on the grader-owned, DETERMINISTIC
 * {@link ErrorFinding.category} of each member's `error_forensics` findings — no judge call. The
 * root-cause ROLL-UP ({@link computeRootCauseRollup}) is likewise deterministic — it keys on the
 * grader-owned `bucket`/`fixTarget` classification the `error_forensics` grader already assigned (that
 * grader's OWN LLM call is the one judge involvement; this WP adds no second call for it). The
 * JUDGE-BACKED per-test-group AGREEMENT is the one facet that genuinely needs a live call (WP 4.2).
 *
 * Resolution policy: a member run that no longer resolves (`getSummary` 404 — deleted mid-flight) is
 * SKIPPED (like `collectChildData`); a SYSTEMIC read failure propagates to {@link SuiteReportService.generate}'s
 * guard → a `status:"error"` row.
 */
export function buildDeterministicSuiteReport(
  runs: RunRepository,
  grades: GradeRepository,
  suiteRunId: string,
  memberRunIds: readonly string[],
): SuiteReport {
  const members: MemberDatum[] = [];
  for (const runId of memberRunIds) {
    let summary: ReturnType<RunRepository["getSummary"]>;
    try {
      summary = runs.getSummary(runId);
    } catch {
      continue; // deleted mid-flight — it no longer contributes (mirrors collectChildData)
    }
    members.push({
      runId,
      testId: summary.testId,
      score: pickOutcomeScore(grades.latestByGrader(runId)),
      costUsd: summary.costUsd,
      turns: summary.turns,
      toolPath: runs.getToolCallSequence(runId).join(TOOL_PATH_SEP),
    });
  }

  // Group members by testId — one test's runs across the suite matrix form a test group. Sorted for stability.
  const byTest = new Map<string, MemberDatum[]>();
  for (const member of members) {
    const group = byTest.get(member.testId) ?? [];
    group.push(member);
    byTest.set(member.testId, group);
  }
  const testGroups: SuiteReportTestGroup[] = [...byTest.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([testId, group]) => ({
      testId,
      runIds: group.map((m) => m.runId),
      score: computeVariance(group.map((m) => m.score)),
      costUsd: computeVariance(group.map((m) => m.costUsd)),
      turns: computeVariance(group.map((m) => m.turns)),
      toolPathVariance: new Set(group.map((m) => m.toolPath)).size,
      // Filled by SuiteReportService.enrichWithAgreement (needs the judge chain) — honest placeholder here.
      agreement: { summary: "", agreeCount: 0, totalCount: group.length, contradicts: false },
    }));

  return {
    suiteRunId,
    testGroups,
    errorClustering: clusterErrorsByCategory(grades, memberRunIds),
    // WP 4.2 — deterministic (no judge call): aggregates the members' error_forensics findings.
    rootCauseRollup: computeRootCauseRollup(grades, memberRunIds),
    narrative: "", // Filled by SuiteReportService.enrichWithAgreement (depends on the agreement results).
    // Filled by SuiteReportService.enrichWithAgreement from the agreement calls' ACTUAL provenance.
    judgeProvenance: { judgeProviderId: null, judgeModel: null },
    ratingVersion: AUTO_RATING_VERSION,
    generatedAt: new Date().toISOString(),
    skippedMembers: [], // Filled by SuiteReportService.generate (reads the suite run's cached aggregates).
  };
}

/**
 * Mean + POPULATION standard deviation (÷N — matches `computeSuiteAggregates`'s `gradeStdDev`) over the
 * NON-NULL values. Both null when there is no evaluable value (e.g. zero graded members) — never a forced 0.
 */
export function computeVariance(values: readonly (number | null)[]): SuiteReportVariance {
  const nums = values.filter((v): v is number => v !== null);
  const n = nums.length;
  if (n === 0) return { mean: null, stdDev: null };
  const mean = nums.reduce((sum, v) => sum + v, 0) / n;
  const stdDev = Math.sqrt(nums.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n);
  return { mean, stdDev };
}

/** Score stdDev above this is called out as a high-spread finding. */
export const FINDING_SCORE_STDDEV_THRESHOLD = 0.15;
/** Cost stdDev/mean (coefficient of variation) above this is called out as a cost-outlier finding. */
export const FINDING_COST_CV_THRESHOLD = 0.5;

/**
 * Suite-report enrichment — DETERMINISTIC, evidence-grounded findings highlights for ONE test group.
 * Every sentence is derived from an already-computed facet (never invented, mirroring the narrative's
 * grounding rule): agreement contradiction, high score spread (stdDev > 0.15), tool-path divergence
 * (>1 distinct shape), a cost outlier (stdDev/mean > 0.5 when mean > 0), and membership of any
 * deterministic error cluster. `[]` when nothing stands out — an honest quiet group.
 */
export function computeTestGroupFindings(
  group: Pick<
    SuiteReportTestGroup,
    "runIds" | "score" | "costUsd" | "toolPathVariance" | "agreement"
  >,
  errorClustering: readonly FailureBucket[],
  /**
   * Claude subscription (WP 2.2, D-CS4/D-CS8) — member run ids whose `costUsd` is a subscription
   * shadow-price ESTIMATE (never billed). Optional/defaults to none, so every pre-existing 2-arg call
   * site is unchanged. Reuses the existing `findings` field (no new shared type) — the SAME
   * hit-counting pattern as the error-cluster loop below.
   */
  subscriptionRunIds: ReadonlySet<string> = new Set(),
): string[] {
  const findings: string[] = [];

  if (group.agreement.contradicts) {
    findings.push(
      group.agreement.summary.trim().length > 0
        ? `Runs contradict: ${group.agreement.summary.trim()}`
        : `Runs contradict: only ${group.agreement.agreeCount}/${group.agreement.totalCount} run(s) side with the majority conclusion.`,
    );
  }

  if (group.score.stdDev !== null && group.score.stdDev > FINDING_SCORE_STDDEV_THRESHOLD) {
    findings.push(
      `High score variance (± ${group.score.stdDev.toFixed(2)}) across ${group.runIds.length} runs`,
    );
  }

  if (group.toolPathVariance > 1) {
    findings.push(`${group.toolPathVariance} distinct tool-call paths for the same test`);
  }

  if (
    group.costUsd.mean !== null &&
    group.costUsd.stdDev !== null &&
    group.costUsd.mean > 0 &&
    group.costUsd.stdDev / group.costUsd.mean > FINDING_COST_CV_THRESHOLD
  ) {
    findings.push(
      `Cost varies widely: ±$${group.costUsd.stdDev.toFixed(4)} around a $${group.costUsd.mean.toFixed(4)} mean`,
    );
  }

  // Error-cluster membership — one sentence per deterministic cluster that contains ≥1 of this
  // group's runs, in the clusters' canonical order (stable, cites the cluster's own label).
  const groupRunIds = new Set(group.runIds);
  for (const bucket of errorClustering) {
    const hits = bucket.memberRunIds.filter((runId) => groupRunIds.has(runId)).length;
    if (hits > 0) findings.push(`${hits} run(s) hit ${bucket.label}`);
  }

  // Claude subscription (WP 2.2, D-CS4/D-CS8) — flag when any of this group's runs priced through the
  // subscription's shadow-cost estimate, so the (existing, reused) score/cost-variance figures above
  // are read with the right accuracy expectation. Mirrors the "est. · subscription" marker convention.
  const subscriptionHits = group.runIds.filter((runId) => subscriptionRunIds.has(runId)).length;
  if (subscriptionHits > 0) {
    findings.push(
      `${subscriptionHits} of ${group.runIds.length} run(s) priced via the Claude subscription's shadow-reference estimate (est. · subscription) — not a billed charge.`,
    );
  }

  return findings;
}

/**
 * Suite-report enrichment — per-test CURRENT-minus-BASELINE deltas between two reports' testGroups
 * (pure). A test absent from the baseline report gets null deltas + `agreementFlipped: false`; a
 * delta is null whenever either side's mean is null (never a fabricated 0). `agreementFlipped` is
 * true when the group's `contradicts` verdict changed vs. the baseline.
 */
export function computeBaselineDeltas(
  current: Pick<SuiteReport, "testGroups">,
  baseline: Pick<SuiteReport, "testGroups">,
): SuiteReportBaseline["perTest"] {
  const baseGroups = new Map(baseline.testGroups.map((group) => [group.testId, group]));
  return current.testGroups.map((group) => {
    const base = baseGroups.get(group.testId);
    return {
      testId: group.testId,
      scoreMeanDelta: meanDelta(group.score.mean, base?.score.mean ?? null),
      costMeanDelta: meanDelta(group.costUsd.mean, base?.costUsd.mean ?? null),
      turnsMeanDelta: meanDelta(group.turns.mean, base?.turns.mean ?? null),
      agreementFlipped: base ? group.agreement.contradicts !== base.agreement.contradicts : false,
    };
  });
}

/** Current-minus-baseline, or null when either side is unevaluable (never a fabricated 0-delta). */
function meanDelta(current: number | null, baseline: number | null): number | null {
  return current === null || baseline === null ? null : current - baseline;
}

/**
 * DETERMINISTIC error clustering (AR12) — cluster the member runs by the grader-owned
 * {@link ErrorFinding.category} of their latest `error_forensics` grade. One {@link FailureBucket} per
 * observed category: its members are the runs that carried ≥1 finding in that category; `share` = those
 * runs ÷ ALL members. No judge call (the LLM-backed clustering is WP 4.2). Categories are emitted in the
 * canonical {@link ERROR_FINDING_CATEGORIES} order for stability.
 */
export function clusterErrorsByCategory(
  grades: GradeRepository,
  memberRunIds: readonly string[],
): FailureBucket[] {
  const total = memberRunIds.length;
  if (total === 0) return [];

  const runsByCategory = new Map<ErrorFindingCategory, Set<string>>();
  for (const runId of memberRunIds) {
    for (const category of memberErrorCategories(grades, runId)) {
      const set = runsByCategory.get(category) ?? new Set<string>();
      set.add(runId);
      runsByCategory.set(category, set);
    }
  }

  const buckets: FailureBucket[] = [];
  for (const category of ERROR_FINDING_CATEGORIES) {
    const runSet = runsByCategory.get(category);
    if (!runSet || runSet.size === 0) continue;
    buckets.push({
      label: humanCategoryLabel(category),
      description: `${runSet.size} of ${total} run(s) hit a ${category.replace(/_/g, " ")} signal.`,
      memberRunIds: [...runSet],
      share: runSet.size / total,
    });
  }
  return buckets;
}

/** The distinct DETERMINISTIC error categories a run's latest `error_forensics` grade recorded (grader-owned; never the LLM bucket). */
function memberErrorCategories(grades: GradeRepository, runId: string): Set<ErrorFindingCategory> {
  const categories = new Set<ErrorFindingCategory>();
  const grade = grades.latestByGrader(runId).find((g) => g.graderId === ERROR_FORENSICS_GRADER_ID);
  for (const finding of errorFindingsOf(grade)) {
    if ((ERROR_FINDING_CATEGORIES as readonly string[]).includes(finding.category)) {
      categories.add(finding.category);
    }
  }
  return categories;
}

/** Defensively read an `error_forensics` grade's evidence as {@link ErrorFinding}[]. */
function errorFindingsOf(grade: RunGrade | undefined): ErrorFinding[] {
  if (!grade || !Array.isArray(grade.evidence)) return [];
  return grade.evidence.filter(
    (f): f is ErrorFinding =>
      typeof f === "object" && f !== null && typeof (f as ErrorFinding).category === "string",
  );
}

/**
 * WP 4.2 — DETERMINISTIC cross-run root-cause roll-up. Aggregates every member run's LATEST
 * `error_forensics` findings by `(bucket, fixTarget)` — the grader-owned LLM root-cause classification
 * (AR4) already assigned per finding; this function makes NO judge call of its own, it only clusters
 * data that already exists. `frequency` counts the qualifying FINDINGS (a run with two findings in the
 * same cluster contributes 2); `memberRunIds` is the distinct set of runs that contributed ≥1 finding to
 * the cluster; `draftFix` is the most-frequent `draftFix` string within the cluster (ties keep the
 * first-seen one, for determinism). Ranked by `frequency` desc, then by the canonical
 * {@link ROOT_CAUSE_BUCKETS}/{@link FIX_TARGETS} order for a fully stable tie-break.
 */
export function computeRootCauseRollup(
  grades: GradeRepository,
  memberRunIds: readonly string[],
): SuiteRootCauseRollupEntry[] {
  type ClusterAccumulator = {
    bucket: RootCauseBucket;
    fixTarget: FixTarget;
    frequency: number;
    runIds: Set<string>;
    draftFixCounts: Map<string, number>;
  };

  const byKey = new Map<string, ClusterAccumulator>();
  for (const runId of memberRunIds) {
    const grade = grades
      .latestByGrader(runId)
      .find((g) => g.graderId === ERROR_FORENSICS_GRADER_ID);
    for (const finding of errorFindingsOf(grade)) {
      const key = `${finding.bucket}::${finding.fixTarget}`;
      let cluster = byKey.get(key);
      if (!cluster) {
        cluster = {
          bucket: finding.bucket,
          fixTarget: finding.fixTarget,
          frequency: 0,
          runIds: new Set(),
          draftFixCounts: new Map(),
        };
        byKey.set(key, cluster);
      }
      cluster.frequency += 1;
      cluster.runIds.add(runId);
      cluster.draftFixCounts.set(
        finding.draftFix,
        (cluster.draftFixCounts.get(finding.draftFix) ?? 0) + 1,
      );
    }
  }

  const rollup: SuiteRootCauseRollupEntry[] = [...byKey.values()].map((cluster) => ({
    bucket: cluster.bucket,
    fixTarget: cluster.fixTarget,
    draftFix: mostFrequentDraftFix(cluster.draftFixCounts),
    frequency: cluster.frequency,
    memberRunIds: [...cluster.runIds],
  }));

  const bucketRank = new Map(ROOT_CAUSE_BUCKETS.map((bucket, index) => [bucket, index]));
  const fixRank = new Map(FIX_TARGETS.map((fixTarget, index) => [fixTarget, index]));
  rollup.sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    const bucketDiff = (bucketRank.get(a.bucket) ?? 0) - (bucketRank.get(b.bucket) ?? 0);
    if (bucketDiff !== 0) return bucketDiff;
    return (fixRank.get(a.fixTarget) ?? 0) - (fixRank.get(b.fixTarget) ?? 0);
  });
  return rollup;
}

/** The most-frequent draftFix string in a cluster; ties keep the first-seen (Map insertion order). */
function mostFrequentDraftFix(counts: ReadonlyMap<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [draftFix, count] of counts) {
    if (count > bestCount) {
      best = draftFix;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The primary-grader outcome score for a run (same selection as `computeSuiteAggregates`'s `meanGrade` —
 * {@link PRIMARY_GRADER_PRIORITY}), or null when no grader produced a graded score. Kept in sync with the
 * orchestrator's aggregation so the report's score variance never mixes methods (AR15).
 */
function pickOutcomeScore(latestGrades: readonly RunGrade[]): number | null {
  const byGrader = new Map<GraderId, RunGrade>();
  for (const grade of latestGrades) byGrader.set(grade.graderId, grade);
  for (const graderId of PRIMARY_GRADER_PRIORITY) {
    const grade = byGrader.get(graderId);
    if (grade && grade.status === "graded" && grade.score !== null) return grade.score;
  }
  return null;
}

function humanCategoryLabel(category: ErrorFindingCategory): string {
  const words = category.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An honest EMPTY report shell — used for a `status:"error"` row when deterministic generation crashed. */
export function emptySuiteReport(suiteRunId: string): SuiteReport {
  return {
    suiteRunId,
    testGroups: [],
    errorClustering: [],
    rootCauseRollup: [],
    narrative: "",
    judgeProvenance: { judgeProviderId: null, judgeModel: null },
    ratingVersion: AUTO_RATING_VERSION,
    generatedAt: new Date().toISOString(),
    skippedMembers: [], // Filled by SuiteReportService.generate (reads the suite run's cached aggregates).
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── WP 4.2 — per-test-group LLM agreement (AR10) ────────────────────────────────────────────────────

/** One member run's answer inputs for the agreement prompt — a run that no longer resolves is simply absent. */
type GroupMemberAnswer = {
  runId: string;
  /** The `answer_validation` grade's verdict, when that grader ran and produced typed evidence; else null. */
  verdict: AnswerValidationVerdict | null;
  /** The run's full produced answer (`finalAssistantText`), possibly empty. */
  answer: string;
  /**
   * Claude subscription (WP 2.2, D-CS4/D-CS8) — this member run's {@link CostBasis}, read from its
   * persisted `kpi` `run_events` (the run summary row itself doesn't carry it — WP 0.1/1.5 stamped it
   * on the LIVE event stream only). `undefined` for every ordinary (`"api_exact"`) run, i.e. every run
   * before this marker existed.
   */
  costBasis: CostBasis | undefined;
};

/** D-CS8's marker value — kept as a local const so a typo can't silently desync from the shared literal. */
const SUBSCRIPTION_COST_BASIS: CostBasis = "subscription_reference";

/**
 * Claude subscription (WP 2.2) — the run's `costBasis`, read off its LATEST persisted `kpi` event (the
 * kpi is re-emitted with cumulative totals through the run, so the last one is authoritative — mirrors
 * how {@link import("../testing/run-repository.js").RunRepository}'s own cursor treats it). `undefined`
 * when the run carries no `kpi` event with a `costBasis` (every ordinary API-keyed run).
 */
function memberCostBasis(events: readonly RunEvent[]): CostBasis | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "kpi" && event.costBasis) return event.costBasis;
  }
  return undefined;
}

/** The judge ledger fields carried on the persisted report row (WP 4.2's SEPARATE ledger, B5). */
type JudgeLedgerTotals = {
  judgeProviderId: string | null;
  judgeModel: string | null;
  judgeTokensIn: number;
  judgeTokensOut: number;
  judgeCostUsd: number;
};

const NEUTRAL_JUDGE_LEDGER: JudgeLedgerTotals = {
  judgeProviderId: null,
  judgeModel: null,
  judgeTokensIn: 0,
  judgeTokensOut: 0,
  judgeCostUsd: 0,
};

function mergeJudgeLedger(acc: JudgeLedgerTotals, next: JudgeLedgerTotals): JudgeLedgerTotals {
  return {
    // The FIRST call that stamped a real provider wins (mirrors run-report.ts's pickJudgeProvenance) —
    // in practice every call within one suite run resolves to the same live judge source.
    judgeProviderId: acc.judgeProviderId ?? next.judgeProviderId,
    judgeModel: acc.judgeModel ?? next.judgeModel,
    judgeTokensIn: acc.judgeTokensIn + next.judgeTokensIn,
    judgeTokensOut: acc.judgeTokensOut + next.judgeTokensOut,
    judgeCostUsd: acc.judgeCostUsd + next.judgeCostUsd,
  };
}

/** One test-group's agreement computation result. `ledger` is present only when a real judge call ran. */
type AgreementOutcome = {
  agreement: SuiteTestGroupAgreement;
  ledger?: JudgeLedgerTotals;
  /** True only when a real judge call ran AND its response parsed into a genuine verdict (feeds the narrative). */
  evaluated: boolean;
};

const NO_JUDGE_SUMMARY = "No judge is available; per-test-group agreement was not evaluated.";
const NO_ANSWERS_SUMMARY =
  "No resolvable member answers for this test group; agreement was not evaluated.";
const UNPRICED_JUDGE_SUMMARY =
  "The configured judge model has no known pricing; refusing to run the agreement call (no spend).";
const JUDGE_CALL_FAILED_SUMMARY =
  "The judge agreement call failed for this test group; treating it as unevaluated.";
const JUDGE_UNPARSEABLE_SUMMARY =
  "The judge produced no parseable agreement verdict for this test group; treating it as unevaluated.";

function honestNeutralAgreement(totalCount: number, summary: string): SuiteTestGroupAgreement {
  return { summary, agreeCount: 0, totalCount, contradicts: false };
}

/**
 * Collect each resolvable member run's `answer_validation` verdict + full produced answer — the inputs
 * the agreement prompt reads. A run that no longer resolves (deleted mid-flight) is skipped; a grade read
 * failure degrades to `verdict: null` rather than dropping the member (its answer text still matters).
 */
function collectGroupMemberAnswers(
  runs: RunRepository,
  grades: GradeRepository,
  runIds: readonly string[],
): GroupMemberAnswer[] {
  const members: GroupMemberAnswer[] = [];
  for (const runId of runIds) {
    let detail: RunDetail;
    try {
      detail = runs.getRun(runId);
    } catch {
      continue; // deleted mid-flight — this member no longer contributes an answer
    }
    const answer = finalAssistantText(detail);
    let verdict: AnswerValidationVerdict | null = null;
    try {
      const grade = grades
        .latestByGrader(runId)
        .find((g) => g.graderId === ANSWER_VALIDATION_GRADER_ID);
      verdict = answerValidationVerdictOf(grade);
    } catch {
      verdict = null;
    }
    // Claude subscription (WP 2.2, D-CS4/D-CS8) — reuses `detail.events`, already fetched above, so
    // this adds NO extra DB round trip.
    members.push({ runId, verdict, answer, costBasis: memberCostBasis(detail.events) });
  }
  return members;
}

/** Defensively read an `answer_validation` grade's evidence for its `verdict`, or null if absent/invalid. */
function answerValidationVerdictOf(grade: RunGrade | undefined): AnswerValidationVerdict | null {
  if (!grade || typeof grade.evidence !== "object" || grade.evidence === null) return null;
  const verdict = (grade.evidence as Record<string, unknown>).verdict;
  return typeof verdict === "string" &&
    (ANSWER_VALIDATION_VERDICTS as readonly string[]).includes(verdict)
    ? (verdict as AnswerValidationVerdict)
    : null;
}

/**
 * AR10 — compute ONE test-group's agreement. Makes AT MOST one judge call (never retried, never
 * pairwise): honest-neutral with NO call when there's nothing to compare, no judge configured, or the
 * configured provider model is unpriced (no spend); a failed/timed-out call degrades honestly with no
 * ledger entry (nothing was usefully spent); an unparseable-but-spent response still stamps the ledger
 * (the call genuinely ran) but reports honestly that no verdict could be read.
 */
async function computeGroupAgreement(
  deps: { resolveJudge?: () => JudgeSettings | null; generate?: JudgeGenerate },
  testId: string,
  members: readonly GroupMemberAnswer[],
  totalCount: number,
  timeoutMs: number,
): Promise<AgreementOutcome> {
  if (members.length === 0) {
    return { agreement: honestNeutralAgreement(totalCount, NO_ANSWERS_SUMMARY), evaluated: false };
  }
  if (!deps.resolveJudge || !deps.generate) {
    return { agreement: honestNeutralAgreement(totalCount, NO_JUDGE_SUMMARY), evaluated: false };
  }
  // Captured into `const`s so the closure below is soundly narrowed as defined (TS can't narrow a
  // mutable object property across an async closure boundary).
  const resolveJudge = deps.resolveJudge;
  const generate = deps.generate;

  let settings: JudgeSettings | null;
  try {
    settings = resolveJudge();
  } catch {
    settings = null;
  }
  if (!settings || !settings.providerCredentialId || !settings.model) {
    return { agreement: honestNeutralAgreement(totalCount, NO_JUDGE_SUMMARY), evaluated: false };
  }
  // Unpriced PROVIDER model → refuse the call (no spend). The CLI sentinel runs on the subscription
  // (cost 0), so this guard does NOT apply to it — mirrors the mandatory base graders' CLI-aware guard.
  if (settings.providerCredentialId !== CLAUDE_CLI_PROVIDER_ID && !isModelPriced(settings.model)) {
    return {
      agreement: honestNeutralAgreement(totalCount, UNPRICED_JUDGE_SUMMARY),
      evaluated: false,
    };
  }

  const prompt = buildGroupAgreementPrompt(testId, members);
  let gen: JudgeGenerateResult;
  try {
    gen = await callWithTimeout(
      (signal) =>
        generate(settings as JudgeSettings, prompt, {
          system: SUITE_AGREEMENT_JUDGE_SYSTEM,
          signal,
        }),
      timeoutMs,
    );
  } catch {
    // A thrown/timed-out call has no usage — nothing to ledger, and the group degrades honestly.
    return {
      agreement: honestNeutralAgreement(totalCount, JUDGE_CALL_FAILED_SUMMARY),
      evaluated: false,
    };
  }

  const ledger = buildJudgeLedgerEntry(settings, gen);
  const parsed = parseAgreementResponse(gen.text, totalCount);
  if (!parsed) {
    // The call spent real tokens even though the response didn't parse — the ledger still records it.
    return {
      agreement: honestNeutralAgreement(totalCount, JUDGE_UNPARSEABLE_SUMMARY),
      ledger,
      evaluated: false,
    };
  }
  return {
    agreement: {
      summary: parsed.summary,
      agreeCount: parsed.agreeCount,
      totalCount,
      contradicts: parsed.contradicts,
    },
    ledger,
    evaluated: true,
  };
}

/** The SEPARATE judge ledger entry (B5/AR13) for one agreement call — provenance PREFERS the chain's actual source. */
function buildJudgeLedgerEntry(
  settings: JudgeSettings,
  gen: JudgeGenerateResult,
): JudgeLedgerTotals {
  const judgeProviderId = gen.judgeProviderId ?? settings.providerCredentialId;
  const judgeModel = gen.judgeModel ?? settings.model;
  return {
    judgeProviderId,
    judgeModel,
    judgeTokensIn: gen.usage.inputTokens,
    judgeTokensOut: gen.usage.outputTokens,
    judgeCostUsd: gen.judgeCostUsd ?? (judgeModel ? estimateCost(judgeModel, gen.usage) : 0),
  };
}

/** Longest per-member answer snippet fed into the agreement prompt (keeps the prompt bounded). */
const MAX_MEMBER_ANSWER_CHARS = 800;

/** Frames the judge as comparing repeated runs of the SAME test for substantive agreement/contradiction. */
export const SUITE_AGREEMENT_JUDGE_SYSTEM =
  "You are a meticulous QA analyst comparing repeated runs of the SAME automated test. You decide " +
  "whether the runs' final answers AGREE (substantively converge on the same conclusion) or " +
  "CONTRADICT one another, and count how many of the runs side with the majority conclusion. You " +
  "respond with ONLY the requested JSON.";

/** Build the ONE per-test-group agreement prompt. Deterministic + side-effect-free (unit-testable). */
export function buildGroupAgreementPrompt(
  testId: string,
  members: readonly GroupMemberAnswer[],
): string {
  const body = members
    .map((member, index) => {
      const verdictNote = member.verdict ? ` (answer_validation verdict: ${member.verdict})` : "";
      return `[${index + 1}] runId: ${member.runId}${verdictNote}\n${answerSnippet(member.answer)}`;
    })
    .join("\n\n");

  return `Below are ${members.length} independent runs of the SAME automated test (id "${testId}"). Each ran the identical prompt; compare their FINAL answers.

### Runs
${body}

### Instructions
* Decide whether these runs substantively AGREE (converge on the same conclusion/value) or CONTRADICT one another (a material, factual disagreement — not just wording differences).
* "agreeCount": an integer 0-${members.length} — how many of the runs side with the majority conclusion.
* "contradicts": true if there is a genuine, material disagreement among the runs; false if they substantively agree.
* "summary": one short sentence, e.g. "3/3 runs conclude the missing fields param causes the failure" or "2/3 runs agree; 1 run reports a different figure."

Respond with ONLY raw JSON (no markdown code fences), exactly:
{"agreeCount": <integer>, "contradicts": <boolean>, "summary": "<one sentence>"}`;
}

/** Collapse whitespace + bound one member's answer so a long transcript can't blow up the prompt. */
function answerSnippet(answer: string): string {
  const collapsed = (answer || "(the run produced no final answer)").replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_MEMBER_ANSWER_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_MEMBER_ANSWER_CHARS)}…`;
}

/**
 * Parse the judge's agreement response, fence/truncation-tolerant. `agreeCount` is clamped to
 * `[0, totalCount]` (the app owns `totalCount`, never trusts the judge for it); `contradicts` falls back
 * to `agreeCount < totalCount` when the judge omits it; `summary` falls back to a templated sentence when
 * blank. Returns `null` only when there is no usable `agreeCount` at all (an honestly unparseable call).
 */
export function parseAgreementResponse(
  text: string,
  totalCount: number,
): { agreeCount: number; contradicts: boolean; summary: string } | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const rawAgree = obj.agreeCount;
  const agreeCountNum =
    typeof rawAgree === "number"
      ? rawAgree
      : typeof rawAgree === "string"
        ? Number.parseFloat(rawAgree)
        : Number.NaN;
  if (!Number.isFinite(agreeCountNum)) return null;
  const agreeCount = Math.max(0, Math.min(totalCount, Math.round(agreeCountNum)));
  const contradicts =
    typeof obj.contradicts === "boolean" ? obj.contradicts : agreeCount < totalCount;
  const summaryRaw = typeof obj.summary === "string" ? obj.summary.trim() : "";
  const summary =
    summaryRaw || `${agreeCount}/${totalCount} run(s) agree with the majority conclusion.`;
  return { agreeCount, contradicts, summary };
}

/** Strip a Markdown code fence, then take the outermost `{ … }` and JSON.parse it. Null on any failure. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * The DETERMINISTIC narrative (documented choice — see the file banner): assembled from already-computed
 * data only (the per-group agreement verdicts + the top root-cause roll-up entries), never a second judge
 * call. Honest when nothing was evaluated (AR11); grounded (cites only counts/ids the data supports) when
 * it was.
 */
export function buildSuiteReportNarrative(input: {
  testGroups: readonly Pick<SuiteReportTestGroup, "testId" | "agreement">[];
  evaluatedGroupCount: number;
  rootCauseRollup: readonly SuiteRootCauseRollupEntry[];
  /**
   * Claude subscription (WP 2.2, D-CS4/D-CS8) — count of member runs priced via the subscription
   * shadow-cost estimate. Optional/defaults to 0 (omits the sentence), so every pre-existing call site
   * is unchanged.
   */
  subscriptionRunCount?: number;
}): string {
  const { testGroups, evaluatedGroupCount, rootCauseRollup, subscriptionRunCount = 0 } = input;
  if (testGroups.length === 0) return "No test groups to summarize.";

  let consistencyLine: string;
  if (evaluatedGroupCount === 0) {
    consistencyLine =
      "Cross-run agreement was not evaluated for any test group (no judge available, or every agreement call failed).";
  } else {
    const contradicting = testGroups.filter((group) => group.agreement.contradicts);
    consistencyLine =
      contradicting.length === 0
        ? `All ${evaluatedGroupCount} evaluated test group(s) showed consistent conclusions across their repeated runs.`
        : `${contradicting.length} of ${evaluatedGroupCount} evaluated test group(s) showed contradicting conclusions across their repeated runs (${contradicting
            .map((group) => group.testId)
            .join(", ")}).`;
  }

  const top = [...rootCauseRollup].slice(0, 3);
  const rollupLine =
    top.length === 0
      ? "No recurring root causes were found across the suite's error_forensics findings."
      : `Top root cause(s): ${top.map((entry) => `${entry.bucket}/${entry.fixTarget} (${entry.frequency}×)`).join(", ")}.`;

  // Claude subscription (WP 2.2, D-CS4/D-CS8) — an honest, evidence-grounded accuracy note (never
  // invented: cites only the count `enrichWithAgreement` actually computed) so a reader of the
  // narrative alone still learns the report includes reference-priced, not billed, cost figures.
  const subscriptionLine =
    subscriptionRunCount > 0
      ? ` ${subscriptionRunCount} run(s) in this report were priced via the Claude subscription's shadow-reference estimate (est. · subscription); their cost is a reference figure, not a billed charge.`
      : "";

  return `${consistencyLine} ${rollupLine}${subscriptionLine}`;
}

/**
 * Race `run` (given a fresh abort signal) against a timeout: on timeout the signal aborts AND the race
 * rejects, so the caller ALWAYS settles even if the provider ignores the abort ("never a hang"). Mirrors
 * the identical local helper in `judge.ts`/`base-rating-judge.ts`/`failure-buckets.ts` — kept local here
 * too so none of those judge-calling modules need to change for this WP.
 */
async function callWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`suite agreement judge call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
