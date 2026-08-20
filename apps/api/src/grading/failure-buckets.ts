import {
  CLAUDE_CLI_PROVIDER_ID,
  FAILURE_BUCKET_SCORE_THRESHOLD,
  type FailureBucket,
  type GraderId,
  type JudgeSettings,
  type SuiteAggregates,
  type SuiteRun,
} from "@mcp-token-footprint/shared";
import { estimateCost, isModelPriced } from "../providers/pricing.js";
import { collectChildData, computeSuiteAggregates } from "../suites/orchestrator.js";
import type { SuiteRunRepository } from "../suites/suite-run-repository.js";
import type { RunRepository } from "../testing/run-repository.js";
import { httpError, toErrorMessage } from "../utils/errors.js";
import type { GradeRepository } from "./grade-repository.js";
import type { JudgeGenerate, JudgeGenerateResult } from "./judge.js";

/**
 * WP 3.5 (Benchmarks, B9.4) — the prototype's FAILURE TAXONOMY as an EXPLICITLY-TRIGGERED analysis.
 * Given a FINISHED suite run, it clusters the LOW-score judge reasons of its child runs into a small
 * failure taxonomy ({@link FailureBucket}[]) via ONE provider judge call, then persists that taxonomy as
 * DERIVED data onto the suite run's `aggregates_json`.
 *
 * HARD invariants (planning/Roadmap/RM-07-benchmarks/conventions.md + the WP 3.5 spec):
 *   - NEVER unprompted. There is NO auto-trigger path — the ONLY caller is the explicit
 *     `POST /api/suite-runs/:id/failure-buckets` route. The run/grade/orchestrator lifecycle never
 *     references this module (asserted by a static scan in the test).
 *   - It is a JUDGE call, so its cost lands ONLY on the GRADING side — folded into the DERIVED
 *     aggregate `judgeCostUsd` ledger (which is separate from `execCostUsd`/run cost). It NEVER touches
 *     any run's `cost_usd`, and it NEVER writes a `run_grades` row (grades stay byte-identical). The
 *     base `judgeCostUsd` is RECOMPUTED from the child grade rows on every trigger, then the ONE
 *     clustering call's estimated cost is added — so a re-trigger overwrites (never double-counts).
 *   - The clusters are DERIVED (recomputable by re-running the analysis), NEVER a source of truth. The
 *     grades it reads are UNTOUCHED. Re-triggering OVERWRITES the derived clusters.
 *   - Offline-testable: {@link FailureBucketDeps.generate} + {@link FailureBucketDeps.resolveJudge} are
 *     injected (production reuses the WP 1.3 judge infra — `createProviderJudgeGenerate` + `judgeResolver`;
 *     tests inject a stub, no network).
 */

/**
 * Default OUTER bound (ms) on the clustering-call invocation — includes the CLI judge chain's AR14
 * queue wait (the tight per-call bounds live inside the chain's legs; see
 * {@link import("./judge.js").DEFAULT_JUDGE_QUEUE_BACKSTOP_MS}). A genuinely stuck call surfaces as an
 * error, never a hang.
 */
export const DEFAULT_FAILURE_CLUSTER_TIMEOUT_MS = 15 * 60_000;

/** Longest per-reason snippet fed into the clustering prompt (keeps the prompt bounded on a big matrix). */
const MAX_REASON_CHARS = 500;

/** Frames the judge as a failure-taxonomy analyst producing a small set of clusters. */
export const FAILURE_CLUSTERING_SYSTEM =
  "You are a meticulous QA analyst reviewing failures from an automated test suite. You group the " +
  "low-scoring runs into a SMALL taxonomy of distinct failure clusters, each capturing one shared " +
  "failure characteristic. You respond with ONLY the requested JSON.";

/** One low-scoring grade row selected for clustering — its run, grader, normalized score, and reasoning. */
export type LowScoreReason = {
  runId: string;
  graderId: GraderId;
  score: number;
  reasoning: string;
};

/**
 * Collect the low-score grade rows for a suite run's child runs: for each child run, the LATEST row per
 * grader whose status is `graded`, whose score is below `threshold`, and which carries reasoning. A run
 * with no such row does not contribute (and is not a "low-score run"). Deleted child runs simply yield
 * no grades. This reads grades ONLY — it never mutates anything.
 */
export function collectLowScoreReasons(
  grades: GradeRepository,
  runIds: readonly string[],
  threshold: number = FAILURE_BUCKET_SCORE_THRESHOLD,
): LowScoreReason[] {
  const reasons: LowScoreReason[] = [];
  for (const runId of runIds) {
    for (const grade of grades.latestByGrader(runId)) {
      if (grade.status !== "graded" || grade.score === null || grade.score >= threshold) continue;
      const reasoning = (grade.reasoning ?? "").trim();
      if (!reasoning) continue;
      reasons.push({ runId, graderId: grade.graderId, score: grade.score, reasoning });
    }
  }
  return reasons;
}

/**
 * Build the ONE clustering prompt. Groups the reasons by run (so each failing run appears once with all
 * its failing-grader reasons), enumerates them, and asks for a small taxonomy referencing the exact
 * runId strings. Deterministic + side-effect-free (unit-testable).
 */
export function buildFailureClusteringPrompt(reasons: readonly LowScoreReason[]): string {
  const order: string[] = [];
  const byRun = new Map<string, LowScoreReason[]>();
  for (const reason of reasons) {
    let bucket = byRun.get(reason.runId);
    if (!bucket) {
      bucket = [];
      byRun.set(reason.runId, bucket);
      order.push(reason.runId);
    }
    bucket.push(reason);
  }

  const failingRuns = order
    .map((runId, index) => {
      const items = (byRun.get(runId) ?? [])
        .map(
          (reason) =>
            `  - ${reason.graderId} (score ${reason.score.toFixed(2)}): ${snippet(reason.reasoning)}`,
        )
        .join("\n");
      return `[${index + 1}] runId: ${runId}\n${items}`;
    })
    .join("\n\n");

  return `Below are runs from a test suite that scored poorly, each with the grader's reasoning for the low score. Group the failing runs into a SMALL number of distinct failure clusters.

### Failing runs
${failingRuns}

### Instructions
* Identify between 1 and 6 clusters. Fewer is better — do NOT create one cluster per run; merge runs that failed for the same underlying reason.
* Each cluster has: a short "label" (a few words), a one-sentence "description", and "memberRunIds" — the exact runId strings from the list above that belong to it.
* Only use runId values that appear above. Assign each run to AT MOST one cluster.
* Respond with ONLY a JSON array of clusters, e.g.:
[{"label": "Wrong numeric value", "description": "The answer reported an incorrect figure.", "memberRunIds": ["<runId>", "<runId>"]}]
`;
}

/** Collapse whitespace + bound a single reason so a verbose judge rationale can't blow up the prompt. */
function snippet(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_REASON_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_REASON_CHARS)}…`;
}

/**
 * Parse the judge's clustering response into {@link FailureBucket}[], fence/truncation-tolerant. MEMBERSHIP
 * INTEGRITY: every `memberRunId` MUST be one of `validRunIds` (the low-score run set) — a hallucinated id
 * is DROPPED — and each run is assigned to at most one cluster (first cluster wins). A cluster left with
 * zero valid members is dropped. `share` = a cluster's unique valid members ÷ the total low-score runs.
 * Returns `[]` when nothing parses (the call was still spent + priced honestly; there is simply no taxonomy).
 */
export function parseFailureBuckets(
  text: string,
  validRunIds: ReadonlySet<string>,
): FailureBucket[] {
  const total = validRunIds.size;
  if (total === 0) return [];
  const raw = extractJsonArray(text);
  if (!raw) return [];

  const assigned = new Set<string>();
  const buckets: FailureBucket[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim()
        : "Unlabeled failures";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const rawMembers = Array.isArray(record.memberRunIds) ? record.memberRunIds : [];

    const members: string[] = [];
    for (const member of rawMembers) {
      if (typeof member !== "string") continue;
      if (!validRunIds.has(member)) continue; // membership integrity — drop a hallucinated id
      if (assigned.has(member)) continue; // a run belongs to at most one cluster
      assigned.add(member);
      members.push(member);
    }
    if (members.length === 0) continue; // an empty / all-hallucinated cluster is dropped
    buckets.push({ label, description, memberRunIds: members, share: members.length / total });
  }
  return buckets;
}

/** Strip a Markdown code fence, then take the outermost `[ … ]` and JSON.parse it. Null on any failure. */
function extractJsonArray(text: string): unknown[] | null {
  if (!text) return null;
  const cleaned = stripFences(text);
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
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

/** Dependencies for {@link FailureBucketService}. `resolveJudge`/`generate` reuse the WP 1.3 judge infra. */
export type FailureBucketDeps = {
  suiteRuns: SuiteRunRepository;
  runs: RunRepository;
  grades: GradeRepository;
  /** The configured default judge (same resolver as the outcome/trajectory judges), or null when unset. */
  resolveJudge: () => JudgeSettings | null;
  /** The one provider round-trip (production: `createProviderJudgeGenerate`; tests: a stub). */
  generate: JudgeGenerate;
  /** Low-score cutoff; defaults to {@link FAILURE_BUCKET_SCORE_THRESHOLD}. */
  threshold?: number;
  /** Bound on the single clustering call; defaults to {@link DEFAULT_FAILURE_CLUSTER_TIMEOUT_MS}. */
  timeoutMs?: number;
};

/**
 * The opt-in failure-bucket clustering service. Its only entry point is {@link analyze}, called ONLY by
 * the explicit route — never from a run/grade/orchestrator path.
 */
export class FailureBucketService {
  private readonly threshold: number;
  private readonly timeoutMs: number;

  constructor(private readonly deps: FailureBucketDeps) {
    this.threshold = deps.threshold ?? FAILURE_BUCKET_SCORE_THRESHOLD;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_FAILURE_CLUSTER_TIMEOUT_MS;
  }

  /**
   * Cluster the suite run's low-score judge reasons and persist the taxonomy onto its DERIVED aggregates.
   * 404 if the suite run is unknown; a clear 400 if a judge call is needed but none is configured (or its
   * model is unpriced); a 502 if the provider call itself fails/times out. No low-score grades → an empty
   * taxonomy with NO judge call (no cost). Returns the updated {@link SuiteRun} (its aggregates now carry
   * `failureBuckets` + the recomputed `judgeCostUsd`).
   */
  async analyze(suiteRunId: string): Promise<SuiteRun> {
    const suiteRun = this.deps.suiteRuns.getRun(suiteRunId); // 404 for an unknown id (repo throws)
    const childRunIds = this.deps.suiteRuns.listChildRunIds(suiteRunId);
    const reasons = collectLowScoreReasons(this.deps.grades, childRunIds, this.threshold);

    // Nothing scored below the threshold → an empty taxonomy, and NO judge call is made (no cost).
    if (reasons.length === 0) {
      return this.persist(suiteRun, childRunIds, [], 0);
    }

    // A clustering call IS needed → require a configured, priced judge (mirrors the re-grade guards).
    const settings = this.deps.resolveJudge();
    if (!settings || !settings.providerCredentialId || !settings.model) {
      throw httpError(
        400,
        "No default judge is configured; set one in grading settings before analyzing failures.",
      );
    }
    // The CLI sentinel runs on the subscription (cost 0), so the unpriced-model guard does NOT apply to
    // it — mirrors the mandatory base graders' CLI-aware guard (WP 2.3).
    if (settings.providerCredentialId !== CLAUDE_CLI_PROVIDER_ID && !isModelPriced(settings.model)) {
      throw httpError(
        400,
        `The configured judge model "${settings.model}" has no known pricing; refusing to run failure ` +
          "clustering (the judge cost ledger would read 0 and spend would be uncapped). Pick a priced model.",
      );
    }

    const validRunIds = new Set(reasons.map((reason) => reason.runId));
    const prompt = buildFailureClusteringPrompt(reasons);

    let gen: JudgeGenerateResult;
    try {
      gen = await callWithTimeout(
        (signal) =>
          this.deps.generate(settings, prompt, { system: FAILURE_CLUSTERING_SYSTEM, signal }),
        this.timeoutMs,
      );
    } catch (error) {
      // A stuck/failed provider call surfaces cleanly (never a hang) — nothing is persisted on this path.
      throw httpError(502, `Failure clustering judge call failed: ${toErrorMessage(error)}`);
    }

    const clusteringCostUsd = estimateCost(settings.model, {
      inputTokens: gen.usage.inputTokens,
      outputTokens: gen.usage.outputTokens,
    });
    const buckets = parseFailureBuckets(gen.text, validRunIds);
    return this.persist(suiteRun, childRunIds, buckets, clusteringCostUsd);
  }

  /**
   * Merge the derived taxonomy into the suite run's cached aggregates. The base aggregates are the cached
   * snapshot (or a fresh recompute if none) — preserving `cellsTotal`/`meanGrade`/`execCostUsd` — with
   * `judgeCostUsd` RESET to the child grades' cumulative judge cost PLUS this trigger's clustering cost
   * (so a re-trigger overwrites rather than double-counts), and `failureBuckets` overwritten. Grades and
   * every run's own cost are untouched.
   */
  private persist(
    suiteRun: SuiteRun,
    childRunIds: readonly string[],
    failureBuckets: FailureBucket[],
    clusteringCostUsd: number,
  ): SuiteRun {
    const children = collectChildData(this.deps.runs, this.deps.grades, childRunIds);
    const childJudgeCostUsd = children.reduce((sum, child) => sum + child.judgeCostUsd, 0);
    const base: SuiteAggregates =
      suiteRun.aggregates ?? computeSuiteAggregates(children, childRunIds.length);
    const merged: SuiteAggregates = {
      ...base,
      judgeCostUsd: childJudgeCostUsd + clusteringCostUsd,
      failureBuckets,
    };
    return this.deps.suiteRuns.saveAggregates(suiteRun.id, merged);
  }
}

/**
 * Race the clustering call (given a fresh abort signal) against a timeout: on timeout the signal aborts
 * AND the race rejects, so `analyze()` ALWAYS settles even if the provider ignores the abort. The timer
 * is always cleared. Mirrors the outcome/trajectory judges' bound (kept local so judge.ts stays read-only).
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
      reject(new Error(`failure clustering call timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
