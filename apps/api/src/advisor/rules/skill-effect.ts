// Rule 6 of 7 — SKILL EFFECT SUMMARY (WP 2.1).
//
// "Attaching skill S to this environment moved the mean grade +0.113 and the cost +$0.0042 per run,
// across the 4 tests of suite run <id>."
//
// The measurement already exists: benchmarks WP 5.1 runs a skill-effect suite as a VARIANT MATRIX
// (base vs ± skill/version) on one suite run and exposes per-test base-vs-variant deltas at
// `GET /api/suite-runs/:id/deltas`. This rule does NOT re-derive that arithmetic — it calls the same
// pure functions the endpoint does (`attributeVariant` for "which variant produced this run" and
// `computeSuiteDeltas` for the per-test delta rollup) and adds exactly one thing on top: the mean
// across the suite run's tests, phrased as advice with its provenance attached.
//
// ATTRIBUTION (inherited, not invented). A run is never stamped with its variant; WP 5.1 matches it
// by scenario + the skills it ACTUALLY resolved (`run_skills`) against the frozen config snapshot,
// most-specific-match-wins, and EXCLUDES a run that matches none or two equally. That is the only
// attribution used here, so an advisor delta and the delta the operator sees in the suite UI are the
// same number computed by the same code.
//
// WHAT IT REFUSES TO DO:
//   * average a grade delta over tests where either side was ungraded — `computeSuiteDeltas` already
//     returns `gradeDelta: null` there, and those rows are excluded from the mean rather than folded
//     in as zeros. When NO row has a grade delta, the finding carries a cost delta and says plainly
//     that the quality effect is unmeasured;
//   * call a cost INCREASE a saving. `savings` is attached only when the variant is genuinely
//     cheaper; a "better but pricier" result is a trade-off stated in the detail, not a saving.

import {
  GRADING_VERSION,
  type AdvisorEvidenceRef,
  type AdvisorRecommendation,
  type AdvisorSavings,
  type AdvisorSeverity,
  type SuiteRun,
  type SuiteVariant,
} from "@mcp-token-footprint/shared";
import { attributeVariant, computeSuiteDeltas, type DeltaChildRun } from "../../suites/analytics.js";
import { runEvidence, scenarioEvidence, skillEvidence } from "../evidence.js";
import type { AdvisorContext, AdvisorRule, AdvisorRuleResult } from "../types.js";
import {
  baseVariantLabel,
  formatSignedScore,
  formatSignedUsd,
  meanOrNull,
  observedSkillIds,
  recentSuiteRuns,
  runScore,
  singleGradingVersion,
  skillNamesById,
  SUITE_RUN_WINDOW,
  variantsOf,
} from "./grade-shared.js";
import { compareStrings, EVIDENCE_RUN_LIMIT, formatCount, plural } from "./shared.js";

export const SKILL_EFFECT_RULE_ID = "advisor.skill-effect";

/**
 * Severity, entirely from the two measured signs — no invented "meaningful difference" epsilon,
 * because any threshold there would be a tuning knob a reader could not check by hand:
 *   high   — the variant scored BETTER and cost no more (a free improvement).
 *   medium — the variant scored better but costs more (a trade-off), or scored WORSE (a warning).
 *   info   — no measurable grade movement, or no graded comparison at all.
 */
function severityFor(gradeDelta: number | null, costDelta: number): AdvisorSeverity {
  if (gradeDelta === null || gradeDelta === 0) return "info";
  if (gradeDelta > 0) return costDelta <= 0 ? "high" : "medium";
  return "medium";
}

/** One variant's mean effect across the suite run's tests. */
type VariantEffect = {
  variantLabel: string;
  baseLabel: string;
  /** Tests with a row for this variant (a test with no base-variant runs yields no row at all). */
  testCount: number;
  /** Of those, how many produced a graded comparison on BOTH sides. */
  gradedTestCount: number;
  /** Mean of the graded rows' `gradeDelta`; `null` when no row had one. */
  meanGradeDelta: number | null;
  meanTokensDelta: number;
  meanCostDelta: number;
};

/** The variant definitions this label attaches/detaches, for the evidence + detail text. */
function variantByLabel(
  variants: readonly SuiteVariant[],
  label: string,
): SuiteVariant | undefined {
  return variants.find((variant) => variant.label === label);
}

function describeOverrides(
  variant: SuiteVariant | undefined,
  skillNames: Map<string, string>,
): string {
  if (!variant) return "an unknown override set";
  const attach = (variant.skillOverrides.attach ?? [])
    .map((entry) => {
      const name = skillNames.get(entry.skillId) ?? entry.skillId;
      return entry.versionId === "latest" ? `+${name}` : `+${name}@${entry.versionId}`;
    })
    .sort(compareStrings);
  const detach = (variant.skillOverrides.detach ?? [])
    .map((skillId) => `-${skillNames.get(skillId) ?? skillId}`)
    .sort(compareStrings);
  const parts = [...attach, ...detach];
  return parts.length === 0 ? "no skill overrides" : parts.join(", ");
}

/** Skill evidence for a variant, ascending by skill id so the array is stable. */
function skillEvidenceFor(
  variant: SuiteVariant | undefined,
  skillNames: Map<string, string>,
): AdvisorEvidenceRef[] {
  if (!variant) return [];
  const ids = new Set<string>();
  for (const entry of variant.skillOverrides.attach ?? []) ids.add(entry.skillId);
  for (const skillId of variant.skillOverrides.detach ?? []) ids.add(skillId);
  return [...ids]
    .sort(compareStrings)
    .map((skillId) => skillEvidence(skillId, skillNames.get(skillId) ?? skillId));
}

function buildRecommendation(input: {
  suiteRun: SuiteRun;
  variants: readonly SuiteVariant[];
  effect: VariantEffect;
  gradingVersion: number;
  evidenceRuns: DeltaChildRun[];
  scenarioId: string;
  scenarioName: string;
  skillNames: Map<string, string>;
}): AdvisorRecommendation {
  const { suiteRun, variants, effect, gradingVersion, evidenceRuns, skillNames } = input;
  const variant = variantByLabel(variants, effect.variantLabel);
  const overrides = describeOverrides(variant, skillNames);

  const gradeClause =
    effect.meanGradeDelta === null
      ? `no graded comparison (neither side of any of the ${effect.testCount} ${plural(effect.testCount, "test")} produced a score on both variants), so the quality effect is UNMEASURED`
      : `mean grade ${formatSignedScore(effect.meanGradeDelta)} across ${effect.gradedTestCount} graded ${plural(effect.gradedTestCount, "test")}`;

  const cheaper = effect.meanCostDelta < 0;
  const savings: AdvisorSavings | undefined = cheaper
    ? {
        value: -effect.meanCostDelta,
        unit: "usd_per_run",
        estimate: true,
        basis:
          `mean over ${effect.testCount} ${plural(effect.testCount, "test")} of (variant "${effect.variantLabel}" mean cost per run ` +
          `− base "${effect.baseLabel}" mean cost per run) in suite run ${suiteRun.id}, from the persisted per-run cost_usd of ` +
          "each attributed member; the sign is flipped because the variant is the cheaper side",
      }
    : undefined;

  const evidence: AdvisorEvidenceRef[] = [
    scenarioEvidence({ id: input.scenarioId, name: input.scenarioName }),
    ...skillEvidenceFor(variant, skillNames),
    ...evidenceRuns.map((child) => runEvidence({ id: child.runId, startedAt: suiteRun.startedAt })),
  ];

  return {
    id: `${SKILL_EFFECT_RULE_ID}:${suiteRun.id}:${effect.variantLabel}`,
    ruleId: SKILL_EFFECT_RULE_ID,
    title: `Skill effect: "${effect.variantLabel}" vs "${effect.baseLabel}" — ${
      effect.meanGradeDelta === null ? "quality unmeasured" : formatSignedScore(effect.meanGradeDelta)
    } grade for ${formatSignedUsd(effect.meanCostDelta)} per run`,
    detail:
      `In suite run ${suiteRun.id}, variant "${effect.variantLabel}" (${overrides}) was compared against base ` +
      `"${effect.baseLabel}" over ${effect.testCount} ${plural(effect.testCount, "test")}: ${gradeClause}; ` +
      `mean cost ${formatSignedUsd(effect.meanCostDelta)} per run and mean ` +
      `${formatCount(Math.abs(effect.meanTokensDelta))} ${effect.meanTokensDelta >= 0 ? "more" : "fewer"} ` +
      `tokens per run. ` +
      (effect.meanGradeDelta === null
        ? "Grade the suite run's members to turn this into a quality-versus-cost decision."
        : effect.meanGradeDelta > 0
          ? cheaper
            ? "The variant is better AND cheaper on this evidence."
            : "The variant is better but costs more — decide whether the quality is worth the spend."
          : effect.meanGradeDelta < 0
            ? "The variant scored WORSE — this override is not paying for itself."
            : "No measured grade movement.") +
      ` Grading version ${gradingVersion}.`,
    severity: severityFor(effect.meanGradeDelta, effect.meanCostDelta),
    ...(savings ? { savings } : {}),
    evidence,
    assumptions: [
      `the base variant is "${effect.baseLabel}" — the FIRST variant in the suite run's frozen config snapshot, the same default GET /api/suite-runs/:id/deltas uses when no base is named`,
      "runs are attributed to a variant by scenario + the skills they actually resolved (run_skills) against the frozen overrides, most-specific match wins; a run matching none, or two equally specific variants, is excluded",
      "the mean is taken over the suite run's tests, each test's own value already meaned over its repetitions — so a test with more repetitions does not weigh more",
      ...(effect.gradedTestCount < effect.testCount
        ? [
            `${effect.testCount - effect.gradedTestCount} of the ${effect.testCount} ${plural(effect.testCount, "test")} lacked a graded score on one or both sides and ${plural(effect.testCount - effect.gradedTestCount, "was", "were")} excluded from the grade delta (never counted as 0); cost and token deltas still include ${plural(effect.testCount - effect.gradedTestCount, "it", "them")}`,
          ]
        : []),
      "cost is the persisted per-run cost_usd (an estimate from the app's pricing table), not a provider invoice",
    ],
    gradeProvenance: { gradingVersion, suiteRunIds: [suiteRun.id] },
  };
}

export const skillEffectRule: AdvisorRule = {
  id: SKILL_EFFECT_RULE_ID,
  description:
    "Mean grade delta versus cost delta for each ± skill variant of a skill-effect suite run (benchmarks WP 5.1 variant axis).",
  // Variants are scenario-scoped, so a scenario report shows the ones touching that environment; a
  // server scope has no variant axis at all.
  appliesTo: (scope) => scope.kind === "scenario" || scope.kind === "fleet",
  gradeAware: true,

  run(ctx: AdvisorContext, scope): AdvisorRuleResult {
    const recommendations: AdvisorRecommendation[] = [];
    const insufficientData: AdvisorRuleResult["insufficientData"] = [];
    const gap = (reason: string) => insufficientData.push({ ruleId: SKILL_EFFECT_RULE_ID, reason });

    const skillNames = skillNamesById(ctx);
    const scenarioNames = new Map(ctx.scenarios.list().map((s) => [s.id, s.name] as const));

    let sawVariantSuite = false;

    for (const suiteRun of recentSuiteRuns(ctx)) {
      const allVariants = variantsOf(suiteRun);
      if (allVariants.length === 0) continue; // not a skill-effect suite run

      // Scope filter: a scenario report only speaks about variants defined on THAT environment.
      const variants =
        scope.kind === "scenario"
          ? allVariants.filter((variant) => variant.scenarioId === scope.id)
          : allVariants;
      if (variants.length === 0) continue;
      sawVariantSuite = true;

      const baseLabel = baseVariantLabel(variants);
      if (baseLabel === null) continue; // unreachable — `variants` is non-empty

      // Collect the attributed children through the SAME pure attribution the deltas endpoint uses.
      const children: DeltaChildRun[] = [];
      for (const runId of ctx.suiteRuns.listChildRunIds(suiteRun.id)) {
        let summary: ReturnType<AdvisorContext["runs"]["getSummary"]>;
        try {
          summary = ctx.runs.getSummary(runId);
        } catch {
          continue; // member deleted after the matrix ran
        }
        const variantLabel = attributeVariant(
          variants,
          summary.scenarioId,
          observedSkillIds(ctx, runId),
        );
        if (variantLabel === null) continue; // unattributable → excluded (honest omission)
        children.push({
          runId,
          testId: summary.testId,
          variantLabel,
          score: runScore(ctx, runId),
          tokens: summary.tokensIn + summary.tokensOut,
          costUsd: summary.costUsd,
        });
      }

      if (children.length === 0) {
        gap(
          `suite run ${suiteRun.id} defines a ± skill variant axis, but none of its member runs could be attributed ` +
            "to a variant from the skills they actually resolved, so no skill effect can be summarized",
        );
        continue;
      }

      const gradingVersion = singleGradingVersion(
        ctx,
        children.map((child) => child.runId),
      );
      if (gradingVersion === null) {
        const anyGraded = children.some((child) => child.score !== null);
        gap(
          anyGraded
            ? `suite run ${suiteRun.id}'s attributed members carry grades from more than one grading version, and scores computed under different grading versions are never compared, so its skill effect cannot be summarized`
            : `suite run ${suiteRun.id} defines a ± skill variant axis but none of its attributed members carries a graded score, so the quality half of the skill effect is unmeasured`,
        );
        continue;
      }

      const rows = computeSuiteDeltas(children, baseLabel);
      if (rows.length === 0) {
        gap(
          `suite run ${suiteRun.id} has attributed members but no test ran under BOTH the base variant "${baseLabel}" and another variant, ` +
            "so there is nothing to compare",
        );
        continue;
      }

      // Roll the per-test rows up into one effect per variant label.
      const byVariant = new Map<string, typeof rows>();
      for (const row of rows) {
        const bucket = byVariant.get(row.variantLabel);
        if (bucket) bucket.push(row);
        else byVariant.set(row.variantLabel, [row]);
      }

      const labels = [...byVariant.keys()].sort(compareStrings);
      for (const variantLabel of labels) {
        const variantRows = byVariant.get(variantLabel) ?? [];
        const gradedDeltas = variantRows
          .map((row) => row.gradeDelta)
          .filter((delta): delta is number => delta !== null);

        const effect: VariantEffect = {
          variantLabel,
          baseLabel,
          testCount: variantRows.length,
          gradedTestCount: gradedDeltas.length,
          meanGradeDelta: meanOrNull(gradedDeltas),
          meanTokensDelta: meanOrNull(variantRows.map((row) => row.tokensDelta)) ?? 0,
          meanCostDelta: meanOrNull(variantRows.map((row) => row.costDelta)) ?? 0,
        };

        const variant = variantByLabel(variants, variantLabel);
        const scenarioId = variant?.scenarioId ?? "";
        if (scenarioId === "") continue; // a label with no definition cannot be described honestly

        const evidenceRuns = children
          .filter((child) => child.variantLabel === variantLabel)
          .sort((a, b) => compareStrings(a.runId, b.runId))
          .slice(0, EVIDENCE_RUN_LIMIT);

        recommendations.push(
          buildRecommendation({
            suiteRun,
            variants,
            effect,
            gradingVersion,
            evidenceRuns,
            scenarioId,
            scenarioName: scenarioNames.get(scenarioId) ?? scenarioId,
            skillNames,
          }),
        );
      }
    }

    if (!sawVariantSuite) {
      gap(
        `no suite run in the ${SUITE_RUN_WINDOW} most recent defines a ± skill variant axis` +
          (scope.kind === "scenario" ? " for this environment" : "") +
          ", so there is no A/B comparison to summarize (run a skill-effect suite — benchmarks WP 5.1)",
      );
    }

    return { recommendations, insufficientData };
  },
};

/** Re-exported for the tests that pin the stamped version against the constant. */
export const SKILL_EFFECT_GRADING_VERSION = GRADING_VERSION;
