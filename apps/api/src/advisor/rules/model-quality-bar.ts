// Rule 7 of 7 — CHEAPEST MODEL CLEARING A QUALITY BAR, PER SUITE (WP 2.1).
//
// "Suite run <id> ran the same tests on 3 models. Two cleared the 0.5 quality bar; the cheaper of
// them costs $0.0031 per run against $0.0142 — switching saves ~$0.0111 per run at a mean score
// that still clears the bar."
//
// THE JOIN. Three persisted facts meet here and none of them is re-derived:
//   grades       — each member run's primary-grader score (`selectRunScore`, the same selection the
//                  suite aggregates and the quality×cost scatter use).
//   cost         — each member run's persisted `cost_usd` (real metered spend, not a re-estimate).
//   compatibility— the bundled model dataset's context window, via the `models` port. A candidate
//                  must be a model the compatibility dataset actually knows, AND its window must
//                  cover the LARGEST peak context this suite run's workload was observed to need —
//                  on ANY model, not just its own runs, because switching the suite over means the
//                  new model has to carry every one of those workloads.
//
// WHICH MODEL A RUN USED. A run has no model column; its environment does (`Scenario.model`), and a
// suite matrix cell is a (test × environment) pair. So the model is read off the run's environment,
// and — stated as an assumption on every finding — an environment whose model was EDITED after the
// run would misattribute it. That is an ordering fact the advisor cannot see, which is exactly why
// it is declared rather than silently assumed away.
//
// WHAT IT REFUSES TO DO:
//   * compare a model against itself. A suite run with one model has no choice to offer, and is an
//     honest gap rather than a recommendation to keep doing what you are doing;
//   * recommend a model the compatibility dataset does not know, or one whose window is smaller than
//     the workload's observed peak — a cheaper model that truncates the context is not cheaper;
//   * treat an ungraded member as a zero. It is excluded from its model's mean, and a model with no
//     graded member at all simply cannot be a candidate.

import {
  ADVISOR_QUALITY_BAR,
  GRADING_VERSION,
  type AdvisorEvidenceRef,
  type AdvisorRecommendation,
  type AdvisorSavings,
  type AdvisorSeverity,
  type RunSummary,
  type SuiteRun,
} from "@mcp-token-footprint/shared";
import { runEvidence, scenarioEvidence } from "../evidence.js";
import type { AdvisorContext, AdvisorRule, AdvisorRuleResult } from "../types.js";
import {
  clearsQualityBar,
  formatScore,
  formatUsd,
  meanOrNull,
  recentSuiteRuns,
  runScore,
  singleGradingVersion,
  SUITE_RUN_WINDOW,
  suiteRunMembers,
} from "./grade-shared.js";
import { compareStrings, EVIDENCE_RUN_LIMIT, formatCount, plural } from "./shared.js";

export const MODEL_QUALITY_BAR_RULE_ID = "advisor.model-quality-bar";

/** One model's rolled-up performance inside one suite run. */
type ModelStats = {
  modelId: string;
  displayName: string;
  /** Every member run on this model, ascending by run id. */
  runs: RunSummary[];
  /** The environments the model was reached through, ascending by id. */
  scenarioIds: string[];
  gradedCount: number;
  /** Mean primary-grader score over the GRADED members; `null` when none was graded. */
  meanScore: number | null;
  /** Mean persisted `cost_usd` over ALL members (real spend counts even for an ungraded run). */
  meanCostUsd: number;
  /** The largest peak context this model's members were observed to need. */
  maxPeakContextTokens: number;
  /** `null` when the compatibility dataset does not know this model id at all. */
  contextWindowTokens: number | null;
  knownToDataset: boolean;
};

/** Why a model that cleared the bar was nonetheless not offered as a candidate. */
type Exclusion = { modelId: string; reason: string };

function severityFor(savingsUsd: number): AdvisorSeverity {
  // A real, positive per-run saving at unchanged quality is actionable; naming the only model that
  // clears the bar is useful context, not an action.
  return savingsUsd > 0 ? "high" : "info";
}

function evidenceFor(stats: ModelStats, scenarioNames: Map<string, string>): AdvisorEvidenceRef[] {
  return [
    ...stats.scenarioIds.map((id) =>
      scenarioEvidence({ id, name: scenarioNames.get(id) ?? id }),
    ),
    ...stats.runs.slice(0, EVIDENCE_RUN_LIMIT).map((run) => runEvidence(run)),
  ];
}

function describeModel(stats: ModelStats): string {
  return (
    `"${stats.displayName}" (${stats.modelId}) — mean score ` +
    `${stats.meanScore === null ? "ungraded" : formatScore(stats.meanScore)} over ${stats.gradedCount} graded ` +
    `${plural(stats.gradedCount, "member")} of ${stats.runs.length}, ${formatUsd(stats.meanCostUsd)} per run`
  );
}

function buildRecommendation(input: {
  suiteRun: SuiteRun;
  cheapest: ModelStats;
  reference: ModelStats | null;
  candidates: ModelStats[];
  excluded: Exclusion[];
  workloadPeakTokens: number;
  gradingVersion: number;
  scenarioNames: Map<string, string>;
}): AdvisorRecommendation {
  const {
    suiteRun,
    cheapest,
    reference,
    candidates,
    excluded,
    workloadPeakTokens,
    gradingVersion,
    scenarioNames,
  } = input;

  const savingsUsd = reference ? reference.meanCostUsd - cheapest.meanCostUsd : 0;

  const savings: AdvisorSavings | undefined =
    reference && savingsUsd > 0
      ? {
          value: savingsUsd,
          unit: "usd_per_run",
          estimate: true,
          basis:
            `mean persisted cost_usd per member run of "${reference.modelId}" (${formatUsd(reference.meanCostUsd)}) ` +
            `− that of "${cheapest.modelId}" (${formatUsd(cheapest.meanCostUsd)}) inside suite run ${suiteRun.id}; ` +
            "both models cleared the quality bar on the same tests, and the figure is per RUN, not per suite",
        }
      : undefined;

  return {
    id: `${MODEL_QUALITY_BAR_RULE_ID}:${suiteRun.id}`,
    ruleId: MODEL_QUALITY_BAR_RULE_ID,
    title: reference
      ? `Cheapest model clearing the quality bar in suite run ${suiteRun.id}: "${cheapest.displayName}" (saves ${formatUsd(savingsUsd)} per run vs "${reference.displayName}")`
      : `Only "${cheapest.displayName}" clears the quality bar in suite run ${suiteRun.id}`,
    detail:
      `Suite run ${suiteRun.id} ran on ${candidates.length + excluded.length} ` +
      `${plural(candidates.length + excluded.length, "model")} that cleared the ${ADVISOR_QUALITY_BAR} quality bar` +
      (excluded.length > 0
        ? ` (${excluded.length} of which ${plural(excluded.length, "is", "are")} not usable: ${excluded
            .map((entry) => `${entry.modelId} — ${entry.reason}`)
            .join("; ")})`
        : "") +
      `. Cheapest usable: ${describeModel(cheapest)}.` +
      (reference
        ? ` Most expensive that also clears: ${describeModel(reference)}. Difference: ${formatUsd(savingsUsd)} per run.`
        : " No other model cleared the bar, so there is no cheaper alternative to switch to — this is the floor.") +
      ` The workload's largest observed peak context in this suite run is ${formatCount(workloadPeakTokens)} tokens; ` +
      `"${cheapest.modelId}" carries ` +
      (cheapest.contextWindowTokens === null
        ? "an unknown window in the compatibility dataset"
        : `${formatCount(cheapest.contextWindowTokens)} tokens`) +
      `. Grading version ${gradingVersion}.`,
    severity: severityFor(savingsUsd),
    ...(savings ? { savings } : {}),
    evidence: [
      ...evidenceFor(cheapest, scenarioNames),
      ...(reference ? evidenceFor(reference, scenarioNames) : []),
    ],
    assumptions: [
      `"clears the quality bar" means the model's mean primary-grader score over its graded members in THIS suite run is at or above ${ADVISOR_QUALITY_BAR} — the same threshold the suite aggregates' passRateAt05 uses`,
      "a run's model is read from its environment's current `model` field; an environment whose model was changed after the run would be misattributed (runs do not record the model they used)",
      "cost is the mean persisted cost_usd per member run (the app's estimated pricing), so a model with fewer/cheaper members is compared on its per-run average, not its total",
      `compatibility: a candidate must be known to the bundled model dataset and its context window must cover the workload's largest observed peak (${formatCount(workloadPeakTokens)} tokens) across ALL models in this suite run, not just its own`,
      "the comparison is within ONE suite run, so both models ran the same tests under the same config snapshot; it is not a claim about any other workload",
      ...(cheapest.contextWindowTokens === null
        ? [
            `the compatibility dataset carries no context window for "${cheapest.modelId}", so the window check could not be applied to it — it was accepted on the dataset knowing the model at all`,
          ]
        : []),
    ],
    gradeProvenance: { gradingVersion, suiteRunIds: [suiteRun.id] },
  };
}

export const modelQualityBarRule: AdvisorRule = {
  id: MODEL_QUALITY_BAR_RULE_ID,
  description:
    "Per suite run, the cheapest model whose mean graded score clears the quality bar and whose context window covers the workload's observed peak.",
  // The comparison is BETWEEN models, so it needs a suite run spanning several environments. A single
  // environment has exactly one model, and a server has none — neither scope can answer the question.
  appliesTo: (scope) => scope.kind === "fleet",
  gradeAware: true,

  run(ctx: AdvisorContext, _scope): AdvisorRuleResult {
    const recommendations: AdvisorRecommendation[] = [];
    const insufficientData: AdvisorRuleResult["insufficientData"] = [];
    const gap = (reason: string) =>
      insufficientData.push({ ruleId: MODEL_QUALITY_BAR_RULE_ID, reason });

    const scenarios = ctx.scenarios.list();
    const scenarioModels = new Map(scenarios.map((s) => [s.id, s.model] as const));
    const scenarioNames = new Map(scenarios.map((s) => [s.id, s.name] as const));

    const suiteRuns = recentSuiteRuns(ctx);
    if (suiteRuns.length === 0) {
      gap(
        "no suite run has been recorded, so no two models have been measured on the same tests and none can be called cheapest at a quality bar",
      );
      return { recommendations, insufficientData };
    }

    for (const suiteRun of suiteRuns) {
      const members = suiteRunMembers(ctx, suiteRun.id);
      if (members.length === 0) continue; // an empty/aborted matrix says nothing

      // Group members by the model of the environment they ran on.
      const byModel = new Map<string, RunSummary[]>();
      let unknownModelMembers = 0;
      for (const member of members) {
        const modelId = scenarioModels.get(member.scenarioId);
        if (modelId === undefined) {
          unknownModelMembers += 1; // environment deleted after the run — excluded honestly
          continue;
        }
        const bucket = byModel.get(modelId);
        if (bucket) bucket.push(member);
        else byModel.set(modelId, [member]);
      }

      if (byModel.size < 2) {
        gap(
          `suite run ${suiteRun.id} ran on ${byModel.size === 0 ? "no resolvable model" : `only one model (${[...byModel.keys()][0]})`}` +
            (unknownModelMembers > 0
              ? `, and ${unknownModelMembers} of its ${plural(unknownModelMembers, "member")} ran on an environment that no longer exists`
              : "") +
            ", so there is no cheaper alternative to compare against",
        );
        continue;
      }

      const gradingVersion = singleGradingVersion(
        ctx,
        members.map((member) => member.id),
      );
      if (gradingVersion === null) {
        const anyGraded = members.some((member) => runScore(ctx, member.id) !== null);
        gap(
          anyGraded
            ? `suite run ${suiteRun.id}'s members carry grades from more than one grading version, and scores computed under different grading versions are never compared, so no model can be shown to clear the bar`
            : `suite run ${suiteRun.id} ran on ${byModel.size} models but none of its members carries a graded score, so no model can be shown to clear the quality bar`,
        );
        continue;
      }

      // The largest peak context ANY member needed — the requirement a replacement model must meet.
      const workloadPeakTokens = members.reduce(
        (max, member) => Math.max(max, member.peakContextTokens),
        0,
      );

      const statsById = new Map<string, ModelStats>();
      for (const [modelId, modelRuns] of byModel) {
        const sortedRuns = [...modelRuns].sort((a, b) => compareStrings(a.id, b.id));
        const scores = sortedRuns
          .map((run) => runScore(ctx, run.id))
          .filter((score): score is number => score !== null);
        const info = ctx.models.get(modelId);
        statsById.set(modelId, {
          modelId,
          displayName: info?.displayName ?? modelId,
          runs: sortedRuns,
          scenarioIds: [...new Set(sortedRuns.map((run) => run.scenarioId))].sort(compareStrings),
          gradedCount: scores.length,
          meanScore: meanOrNull(scores),
          meanCostUsd: meanOrNull(sortedRuns.map((run) => run.costUsd)) ?? 0,
          maxPeakContextTokens: sortedRuns.reduce(
            (max, run) => Math.max(max, run.peakContextTokens),
            0,
          ),
          contextWindowTokens: info?.contextWindowTokens ?? null,
          knownToDataset: info !== null,
        });
      }

      // Ascending by model id, so candidate selection and the excluded list are both deterministic.
      const ordered = [...statsById.values()].sort((a, b) => compareStrings(a.modelId, b.modelId));
      const clearing = ordered.filter((stats) => clearsQualityBar(stats.meanScore));
      if (clearing.length === 0) {
        gap(
          `no model in suite run ${suiteRun.id} reached the ${ADVISOR_QUALITY_BAR} quality bar (best mean score: ` +
            `${
              ordered
                .map((stats) => stats.meanScore)
                .filter((score): score is number => score !== null)
                .sort((a, b) => b - a)[0] !== undefined
                ? formatScore(
                    ordered
                      .map((stats) => stats.meanScore)
                      .filter((score): score is number => score !== null)
                      .sort((a, b) => b - a)[0] as number,
                  )
                : "none graded"
            }), so there is no cheapest model that clears it`,
        );
        continue;
      }

      // Compatibility gate — applied only to models that already cleared the quality bar.
      const candidates: ModelStats[] = [];
      const excluded: Exclusion[] = [];
      for (const stats of clearing) {
        if (!stats.knownToDataset) {
          excluded.push({
            modelId: stats.modelId,
            reason: "not in the compatibility dataset, so its limits are unknown",
          });
          continue;
        }
        if (
          stats.contextWindowTokens !== null &&
          stats.contextWindowTokens < workloadPeakTokens
        ) {
          excluded.push({
            modelId: stats.modelId,
            reason: `context window ${formatCount(stats.contextWindowTokens)} tokens is smaller than the workload's observed peak of ${formatCount(workloadPeakTokens)}`,
          });
          continue;
        }
        candidates.push(stats);
      }

      if (candidates.length === 0) {
        gap(
          `every model clearing the ${ADVISOR_QUALITY_BAR} quality bar in suite run ${suiteRun.id} fails the compatibility check ` +
            `(${excluded.map((entry) => `${entry.modelId} — ${entry.reason}`).join("; ")}), so none can be recommended`,
        );
        continue;
      }

      // Cheapest by mean cost per run; model id ascending breaks a cost tie so the winner is stable.
      const cheapest = candidates.reduce((best, stats) => {
        if (stats.meanCostUsd !== best.meanCostUsd) {
          return stats.meanCostUsd < best.meanCostUsd ? stats : best;
        }
        return compareStrings(stats.modelId, best.modelId) < 0 ? stats : best;
      });
      // The dearest clearing candidate — switching FROM it to `cheapest` is the biggest safe saving.
      const reference = candidates.reduce((worst, stats) => {
        if (stats.meanCostUsd !== worst.meanCostUsd) {
          return stats.meanCostUsd > worst.meanCostUsd ? stats : worst;
        }
        return compareStrings(stats.modelId, worst.modelId) > 0 ? stats : worst;
      });

      recommendations.push(
        buildRecommendation({
          suiteRun,
          cheapest,
          reference: reference.modelId === cheapest.modelId ? null : reference,
          candidates,
          excluded,
          workloadPeakTokens,
          gradingVersion,
          scenarioNames,
        }),
      );
    }

    if (recommendations.length === 0 && insufficientData.length === 0) {
      gap(
        `none of the ${SUITE_RUN_WINDOW} most recent suite runs had any member runs to compare models over`,
      );
    }

    return { recommendations, insufficientData };
  },
};

/** Re-exported for the tests that pin the stamped version against the constant. */
export const MODEL_QUALITY_BAR_GRADING_VERSION = GRADING_VERSION;
