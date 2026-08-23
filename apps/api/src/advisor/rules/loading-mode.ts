// Rule 3 of 4 (WP 1.2) — EAGER vs DEFERRED TOOL LOADING, measured.
//
// ── The trap this rule is built around ──────────────────────────────────────────────────────────
// `tool_loading_mode` lives on the `scenarios` table (db/schema.ts) and NOWHERE else. A run does not
// record the mode it ran under, and the environment's mode is mutable — an operator can flip it any
// time. So the obvious implementation ("read the environment's current mode, label all its historical
// runs with it, compare") would be a FABRICATED MEASUREMENT: it silently asserts something about the
// past that the database never recorded. Every number derived that way would be unfalsifiable.
//
// Two things keep this rule honest instead:
//
//   1. **The eligibility window.** `scenarios.updated_at` is bumped by EVERY edit, so a mode change
//      necessarily moves it. A completed run that started strictly AFTER the environment's last edit
//      therefore demonstrably ran under the mode the environment carries today — no attribution
//      guesswork, just an ordering fact. Runs from before the last edit are excluded outright; they
//      are not evidence about any mode.
//   2. **The comparison is ACROSS environments, never within one.** This rule never says "environment
//      X got cheaper when you switched it to deferred" — it cannot know that. It compares one
//      environment that is eager today against a different one that is deferred today, on the same
//      model and restricted to the tests BOTH have run, and it states plainly that everything else
//      about the two (prompt, servers, guardrails) may differ, so this is a side-by-side reading and
//      not a controlled experiment.
//
// When neither an eligible pair nor eligible runs exist, the rule reports an honest gap naming
// exactly what is missing. It never falls back to "compare anyway".

import type { AdvisorRecommendation, RunSummary, Scenario } from "@mcp-token-footprint/shared";
import { advisorThresholds } from "../../data-pack/thresholds.js";
import { runEvidence, scenarioEvidence } from "../evidence.js";
import type { AdvisorContext, AdvisorRule, AdvisorRuleResult } from "../types.js";
import {
  compareStrings,
  completedRuns,
  formatCount,
  plural,
  ratio,
  scenariosInScope,
  sumBy,
} from "./shared.js";

export const LOADING_MODE_RULE_ID = "advisor.loading-mode-comparison";

/** Strictly after: a run stamped the same instant as the edit is ambiguous (we cannot tell whether
 *  it read the config before or after), and an ambiguous run is not evidence. Unparsable timestamps
 *  are treated as ineligible rather than guessed at. */
function startedAfterLastEdit(run: RunSummary, scenario: Scenario): boolean {
  const started = Date.parse(run.startedAt);
  const edited = Date.parse(scenario.updatedAt);
  if (Number.isNaN(started) || Number.isNaN(edited)) return false;
  return started > edited;
}

type Side = {
  scenario: Scenario;
  /** Completed runs that started after the environment's last edit — the only runs attributable to
   *  the environment's current loading mode. */
  runs: RunSummary[];
};

type SideMetrics = {
  runs: RunSummary[];
  turns: number;
  tokensIn: number;
  promptTokensPerTurn: number;
  meanPeakContextTokens: number;
  meanCostUsd: number;
};

function metricsFor(runs: RunSummary[]): SideMetrics {
  const turns = sumBy(runs, (run) => run.turns);
  const tokensIn = sumBy(runs, (run) => run.tokensIn);
  return {
    runs,
    turns,
    tokensIn,
    promptTokensPerTurn: ratio(tokensIn, turns),
    meanPeakContextTokens: ratio(
      sumBy(runs, (run) => run.peakContextTokens),
      runs.length,
    ),
    meanCostUsd: ratio(
      sumBy(runs, (run) => run.costUsd),
      runs.length,
    ),
  };
}

function testIdsOf(runs: readonly RunSummary[]): Set<string> {
  return new Set(runs.map((run) => run.testId));
}

function buildRecommendation(
  eager: { scenario: Scenario; metrics: SideMetrics },
  deferred: { scenario: Scenario; metrics: SideMetrics },
  sharedTestIds: string[],
): AdvisorRecommendation {
  const eagerMetrics = eager.metrics;
  const deferredMetrics = deferred.metrics;

  // Rounded to whole tokens so the published figure is one an operator can check by hand against the
  // two divisions spelled out in the basis.
  const delta = Math.round(eagerMetrics.promptTokensPerTurn - deferredMetrics.promptTokensPerTurn);
  const deferredIsCheaper = delta > 0;

  const basis =
    `mean prompt tokens per turn over the ${sharedTestIds.length} ${plural(sharedTestIds.length, "test")} both environments have run: ` +
    `eager ${formatCount(eagerMetrics.tokensIn)} tokens in / ${eagerMetrics.turns} ${plural(eagerMetrics.turns, "turn")} ` +
    `minus deferred ${formatCount(deferredMetrics.tokensIn)} / ${deferredMetrics.turns}, rounded to whole tokens`;

  const detail =
    `"${eager.scenario.name}" (eager) vs "${deferred.scenario.name}" (deferred) on model ` +
    `${eager.scenario.model}, over the ${sharedTestIds.length} ${plural(sharedTestIds.length, "test")} both have run since ` +
    `each was last edited. Prompt tokens per turn: ${formatCount(eagerMetrics.promptTokensPerTurn)} vs ` +
    `${formatCount(deferredMetrics.promptTokensPerTurn)}. Mean peak context: ` +
    `${formatCount(eagerMetrics.meanPeakContextTokens)} vs ${formatCount(deferredMetrics.meanPeakContextTokens)} tokens. ` +
    `Mean cost per run: $${eagerMetrics.meanCostUsd.toFixed(4)} vs $${deferredMetrics.meanCostUsd.toFixed(4)}. ` +
    `Based on ${eagerMetrics.runs.length} eager and ${deferredMetrics.runs.length} deferred ${plural(deferredMetrics.runs.length, "run")}.`;

  return {
    id: `${LOADING_MODE_RULE_ID}:${eager.scenario.id}:${deferred.scenario.id}`,
    ruleId: LOADING_MODE_RULE_ID,
    title: deferredIsCheaper
      ? `Deferred tool loading reads ${formatCount(delta)} tokens/turn cheaper in "${deferred.scenario.name}" than eager in "${eager.scenario.name}"`
      : `Eager vs deferred tool loading: "${eager.scenario.name}" and "${deferred.scenario.name}" side by side`,
    detail: deferredIsCheaper
      ? detail
      : `${detail} Deferred did not read cheaper here, so no saving is claimed.`,
    severity: deferredIsCheaper ? "medium" : "info",
    ...(deferredIsCheaper
      ? { savings: { value: delta, unit: "tokens_per_turn" as const, estimate: true, basis } }
      : {}),
    evidence: [
      scenarioEvidence(eager.scenario),
      scenarioEvidence(deferred.scenario),
      ...eagerMetrics.runs.slice(0, advisorThresholds().evidence_run_limit).map(runEvidence),
      ...deferredMetrics.runs.slice(0, advisorThresholds().evidence_run_limit).map(runEvidence),
    ],
    assumptions: [
      "the tool-loading mode is a property of the ENVIRONMENT and is never recorded on a run, so only runs that started after each environment was last edited are counted — those demonstrably ran under the mode the environment carries now",
      `both sides are restricted to the ${sharedTestIds.length} ${plural(sharedTestIds.length, "test")} they have both run, on the same model (${eager.scenario.model})`,
      "everything else about the two environments — system prompt, attached servers, skills, guardrails — may differ; this is a side-by-side reading of two environments, not a controlled experiment on one",
    ],
  };
}

export const loadingModeComparisonRule: AdvisorRule = {
  id: LOADING_MODE_RULE_ID,
  description:
    "Eager vs deferred tool loading compared across two environments on the same model, using only runs attributable to their current mode.",
  appliesTo: (scope) => scope.kind === "scenario" || scope.kind === "fleet",

  run(ctx: AdvisorContext, scope): AdvisorRuleResult {
    const recommendations: AdvisorRecommendation[] = [];
    const insufficientData: AdvisorRuleResult["insufficientData"] = [];
    const gap = (reason: string) => insufficientData.push({ ruleId: LOADING_MODE_RULE_ID, reason });

    const focus = scope.kind === "scenario" ? scenariosInScope(ctx, scope)[0] : undefined;
    if (scope.kind === "scenario" && !focus) return { recommendations, insufficientData };

    // Every environment is a candidate peer, even under a `scenario` scope — a comparison needs the
    // OTHER side, and that side is by definition a different environment.
    const sides: Side[] = [];
    for (const scenario of [...ctx.scenarios.list()].sort((a, b) => compareStrings(a.id, b.id))) {
      const runs = completedRuns(ctx, scenario.id).filter((run) =>
        startedAfterLastEdit(run, scenario),
      );
      if (runs.length > 0) sides.push({ scenario, runs });
    }

    const eagerSides = sides.filter((side) => side.scenario.toolLoadingMode !== "deferred");
    const deferredSides = sides.filter((side) => side.scenario.toolLoadingMode === "deferred");

    for (const eager of eagerSides) {
      for (const deferred of deferredSides) {
        if (eager.scenario.model !== deferred.scenario.model) continue;
        if (focus && eager.scenario.id !== focus.id && deferred.scenario.id !== focus.id) continue;

        const deferredTests = testIdsOf(deferred.runs);
        const sharedTestIds = [...testIdsOf(eager.runs)]
          .filter((testId) => deferredTests.has(testId))
          .sort(compareStrings);
        if (sharedTestIds.length === 0) continue;

        const shared = new Set(sharedTestIds);
        const eagerMetrics = metricsFor(eager.runs.filter((run) => shared.has(run.testId)));
        const deferredMetrics = metricsFor(deferred.runs.filter((run) => shared.has(run.testId)));
        // A side with no turns has no per-turn cost to report; dividing by zero would produce a 0
        // that looks like a measurement.
        if (eagerMetrics.turns === 0 || deferredMetrics.turns === 0) continue;

        recommendations.push(
          buildRecommendation(
            { scenario: eager.scenario, metrics: eagerMetrics },
            { scenario: deferred.scenario, metrics: deferredMetrics },
            sharedTestIds,
          ),
        );
      }
    }

    if (recommendations.length === 0) {
      if (focus) {
        const focusSide = sides.find((side) => side.scenario.id === focus.id);
        if (!focusSide) {
          gap(
            `environment "${focus.name}" (${focus.id}) has no completed runs that started after it was last edited (${focus.updatedAt}), so none of its runs can be attributed to its current tool-loading mode — the mode is never recorded on a run`,
          );
        } else {
          const opposite = focus.toolLoadingMode === "deferred" ? "eager" : "deferred";
          gap(
            `no ${opposite}-loading environment on model "${focus.model}" has completed runs started after its own last edit AND a test in common with "${focus.name}" (${focus.id}), so eager and deferred cannot be compared for it`,
          );
        }
      } else {
        gap(
          "no two environments on the same model differ in tool-loading mode while both have completed runs started after their last edit and at least one test in common — the loading mode is a mutable environment setting that is never recorded on a run, so older runs cannot be attributed to a mode",
        );
      }
    }

    return { recommendations, insufficientData };
  },
};
