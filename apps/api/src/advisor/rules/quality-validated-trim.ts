// Rule 5 of 7 — QUALITY-VALIDATED TOOLSET TRIM (WP 2.1, the first grade-aware rule).
//
// "In environment E, these tools of server S were never called across the GRADED suite-run members
// of E — runs whose mean primary-grader score was X, at or above the quality bar — and they cost N
// tokens of the definition footprint E ships."
//
// HOW THIS DIFFERS FROM THE PHASE 1 TRIM (`unused-tool-trim.ts`), which it deliberately does not
// replace: that rule observes usage across EVERY completed run and makes no quality claim at all.
// This one narrows the evidence to the runs that (a) belong to a suite run and (b) actually earned a
// graded score, and then refuses to speak unless those runs held the bar. The two can therefore
// disagree — and when they do, this one is the conservative answer, because a tool that went unused
// in a *failing* run is not evidence that the tool is unnecessary.
//
// WHAT IT REFUSES TO DO (the WP's headline acceptance item):
//   * suggest a trim when the quality evidence is MISSING — no suite-run members, none of them
//     graded, or their grades spanning more than one `GRADING_VERSION`. Each is an explicit
//     `insufficientData` entry naming exactly what was absent. Never a trim, never a guess;
//   * suggest a trim when the quality evidence is present but the score does NOT hold — an
//     environment scoring below the bar has a quality problem, and "here is a way to spend fewer
//     tokens on it" is the wrong advice to lead with;
//   * claim the trimmed configuration was measured. It was not. What was measured is that the agent
//     reached these scores WITHOUT ever calling these tools.

import {
  ADVISOR_QUALITY_BAR,
  GRADING_VERSION,
  type AdvisorRecommendation,
  type AdvisorSavingsUnit,
  type AdvisorSeverity,
  type RunSummary,
  type ScanDetail,
  type Scenario,
  type ServerConfig,
  type ToolScan,
} from "@mcp-token-footprint/shared";
import {
  runEvidence,
  scanEvidence,
  scenarioEvidence,
  serverEvidence,
  toolScanEvidence,
} from "../evidence.js";
import type { AdvisorContext, AdvisorRule, AdvisorRuleResult } from "../types.js";
import {
  clearsQualityBar,
  formatScore,
  meanOrNull,
  PROVENANCE_SUITE_RUN_LIMIT,
  runScore,
  singleGradingVersion,
  sortedUniqueIds,
} from "./grade-shared.js";
import {
  allowedToolsOf,
  compareStrings,
  completedRuns,
  EVIDENCE_RUN_LIMIT,
  EVIDENCE_TOOL_LIMIT,
  formatCount,
  formatPercent,
  latestSuccessfulScan,
  plural,
  ratio,
  scanProvenance,
  scenariosInScope,
  serversById,
  sumBy,
  toolCallCounts,
} from "./shared.js";

export const QUALITY_VALIDATED_TRIM_RULE_ID = "advisor.quality-validated-trim";

/** Same severity bands as the Phase 1 trim, by the share of the server's allow-listed definition
 *  tokens that is never exercised — so the two rules' severities mean the same thing and a reader
 *  can check the band by hand from the numbers in the detail. */
const HIGH_WASTE_SHARE = 0.5;
const MEDIUM_WASTE_SHARE = 0.2;

function severityFor(wastedShare: number): AdvisorSeverity {
  if (wastedShare >= HIGH_WASTE_SHARE) return "high";
  if (wastedShare >= MEDIUM_WASTE_SHARE) return "medium";
  return "info";
}

/** The graded, suite-backed evidence base for one environment. */
type QualityEvidence = {
  /** Completed runs of the environment that belong to a suite run AND earned a graded score. */
  runs: RunSummary[];
  /** Per-run primary-grader scores, aligned with `runs`. */
  scores: number[];
  meanScore: number;
  /** The suite runs those members belong to, ascending + deduped. Never empty. */
  suiteRunIds: string[];
  gradingVersion: number;
};

type ServerFinding = {
  scenario: Scenario;
  server: ServerConfig;
  scan: ScanDetail;
  quality: QualityEvidence;
  allowed: ToolScan[];
  unused: ToolScan[];
};

function buildRecommendation(finding: ServerFinding): AdvisorRecommendation {
  const { scenario, server, scan, quality, allowed, unused } = finding;

  const unusedTokens = sumBy(unused, (tool) => tool.totalTokens);
  const allowedTokens = sumBy(allowed, (tool) => tool.totalTokens);
  const wastedShare = ratio(unusedTokens, allowedTokens);

  const unusedByName = new Set(unused.map((tool) => tool.toolName));
  const kept = allowed
    .filter((tool) => !unusedByName.has(tool.toolName))
    .map((tool) => tool.toolName)
    .sort(compareStrings);
  const unusedNames = [...unusedByName].sort(compareStrings);

  // Identical unit reasoning to the Phase 1 trim: `eager` re-sends every allowed definition in every
  // turn's prompt prefix (a per-turn cost); `deferred` withholds them (a one-off footprint).
  const eager = scenario.toolLoadingMode !== "deferred";
  const unit: AdvisorSavingsUnit = eager ? "tokens_per_turn" : "tokens";
  const modeClause = eager
    ? "this environment loads tools eagerly, so every allowed definition rides each turn's prompt prefix"
    : "this environment loads tools deferred, so the definitions are NOT resident in every turn and the figure is a one-off footprint, not a per-turn cost";
  const basis =
    `sum of the ${unused.length} never-called ${plural(unused.length, "tool")}' definition tokens in ` +
    `${scanProvenance(scan)}; ${modeClause}. Usage was observed across the ${quality.runs.length} ` +
    `graded suite-run ${plural(quality.runs.length, "member")} of this environment (mean primary-grader ` +
    `score ${formatScore(quality.meanScore)} >= the ${ADVISOR_QUALITY_BAR} quality bar), not across ` +
    "every completed run";

  const evidenceTools = unused.slice(0, EVIDENCE_TOOL_LIMIT);
  const trimmedTools = unused.length - evidenceTools.length;
  const evidenceRuns = quality.runs.slice(0, EVIDENCE_RUN_LIMIT);

  const listedSuiteRuns = quality.suiteRunIds.slice(0, PROVENANCE_SUITE_RUN_LIMIT);
  const trimmedSuiteRuns = quality.suiteRunIds.length - listedSuiteRuns.length;

  return {
    id: `${QUALITY_VALIDATED_TRIM_RULE_ID}:${scenario.id}:${server.id}`,
    ruleId: QUALITY_VALIDATED_TRIM_RULE_ID,
    title: `Quality-validated trim: ${unused.length} never-called ${plural(unused.length, "tool")} on "${server.name}" in "${scenario.name}"`,
    detail:
      `Across ${quality.runs.length} graded suite-run ${plural(quality.runs.length, "member")} of ` +
      `"${scenario.name}" — mean primary-grader score ${formatScore(quality.meanScore)}, at or above ` +
      `the ${ADVISOR_QUALITY_BAR} bar — ${kept.length} of the ${allowed.length} ` +
      `${plural(allowed.length, "tool")} "${server.name}" exposes to this environment ` +
      `${plural(kept.length, "was", "were")} called. The ${unused.length} that never ` +
      `${plural(unused.length, "was", "were")} cost ${formatCount(unusedTokens)} of the ` +
      `${formatCount(allowedTokens)} definition tokens this server contributes ` +
      `(${formatPercent(wastedShare)}). Never called: ${unusedNames.join(", ")}. ` +
      (kept.length === 0
        ? "No tool on this server was called in any graded member — consider detaching the server from this environment."
        : `Suggested allowedTools: ${kept.join(", ")}.`) +
      ` Read from suite ${plural(quality.suiteRunIds.length, "run")} ${listedSuiteRuns.join(", ")}` +
      (trimmedSuiteRuns > 0 ? ` (+${trimmedSuiteRuns} more)` : "") +
      ` under grading version ${quality.gradingVersion}.`,
    severity: severityFor(wastedShare),
    savings: { value: unusedTokens, unit, estimate: true, basis },
    evidence: [
      scenarioEvidence(scenario),
      serverEvidence(server),
      scanEvidence(scan),
      ...evidenceRuns.map((run) => runEvidence(run)),
      ...evidenceTools.map((tool) => toolScanEvidence(scan.id, tool.toolName)),
    ],
    assumptions: [
      `"the score holds" means the mean primary-grader score of the graded members (${formatScore(quality.meanScore)}) is at or above ${ADVISOR_QUALITY_BAR} — the same threshold the suite aggregates' passRateAt05 uses`,
      "the trimmed configuration was NOT run: what was measured is that the agent reached these scores without ever calling these tools, not that removing them leaves the score unchanged",
      `the ${quality.runs.length} graded suite-run ${plural(quality.runs.length, "member")} are representative of how this environment is normally used`,
      "tool calls are matched by NAME, so a name exposed by more than one of this environment's servers counts as used on all of them (this can hide a trim, never invent one)",
      `the footprint comes from ${scanProvenance(scan)} — the server's latest successful scan, which may be older than the runs`,
      ...(trimmedTools > 0
        ? [
            `${trimmedTools} further never-called ${plural(trimmedTools, "tool")} ${plural(trimmedTools, "is", "are")} named in the detail but not linked as evidence (the ${EVIDENCE_TOOL_LIMIT} largest are)`,
          ]
        : []),
      ...(trimmedSuiteRuns > 0
        ? [
            `${trimmedSuiteRuns} further suite ${plural(trimmedSuiteRuns, "run")} contributed members but ${plural(trimmedSuiteRuns, "is", "are")} not listed in the detail (the first ${PROVENANCE_SUITE_RUN_LIMIT} are); gradeProvenance carries the full list`,
          ]
        : []),
    ],
    gradeProvenance: {
      gradingVersion: quality.gradingVersion,
      suiteRunIds: quality.suiteRunIds,
    },
  };
}

/**
 * Assemble the environment's graded, suite-backed evidence — or say what is missing.
 *
 * The three `null` outcomes are DIFFERENT gaps and are reported as different reasons, because
 * "you have never benchmarked this environment" and "you benchmarked it and it scored badly" call
 * for different actions from the operator.
 */
function collectQualityEvidence(
  ctx: AdvisorContext,
  scenario: Scenario,
): QualityEvidence | { missing: string } {
  const completed = completedRuns(ctx, scenario.id);
  const suiteMembers = completed.filter((run) => run.suiteRunId !== undefined);
  if (suiteMembers.length === 0) {
    return {
      missing:
        `environment "${scenario.name}" (${scenario.id}) has no completed runs belonging to a suite run, ` +
        "so there is no suite score to validate a trim against (run it as part of a suite or a collection first)",
    };
  }

  const runs: RunSummary[] = [];
  const scores: number[] = [];
  for (const run of suiteMembers) {
    const score = runScore(ctx, run.id);
    if (score === null) continue; // ungraded — excluded from the mean, never counted as a 0
    runs.push(run);
    scores.push(score);
  }
  if (runs.length === 0) {
    return {
      missing:
        `environment "${scenario.name}" (${scenario.id}) has ${suiteMembers.length} completed suite-run ` +
        `${plural(suiteMembers.length, "member")}, but none of them carries a graded score from any grader, ` +
        "so a trim cannot be validated against the suite score",
    };
  }

  const gradingVersion = singleGradingVersion(
    ctx,
    runs.map((run) => run.id),
  );
  if (gradingVersion === null) {
    return {
      missing:
        `environment "${scenario.name}" (${scenario.id}) has graded suite-run members spanning more than one ` +
        "grading version, and scores computed under different grading versions are never averaged together, " +
        "so a trim cannot be validated against a single suite score (re-grade the environment's runs under one version)",
    };
  }

  const meanScore = meanOrNull(scores) as number; // `scores` is non-empty by the guard above
  if (!clearsQualityBar(meanScore)) {
    return {
      missing:
        `environment "${scenario.name}" (${scenario.id}) scores ${formatScore(meanScore)} across its ` +
        `${runs.length} graded suite-run ${plural(runs.length, "member")}, below the ${ADVISOR_QUALITY_BAR} ` +
        "quality bar, so no trim is suggested — the quality problem comes first",
    };
  }

  return {
    runs,
    scores,
    meanScore,
    suiteRunIds: sortedUniqueIds(runs.map((run) => run.suiteRunId as string)),
    gradingVersion,
  };
}

export const qualityValidatedTrimRule: AdvisorRule = {
  id: QUALITY_VALIDATED_TRIM_RULE_ID,
  description:
    "Tools an environment allows but never called across its GRADED suite-run members, suggested only when those members' mean score holds at the quality bar.",
  // Usage and grades are both observed per environment; a bare server scope has neither.
  appliesTo: (scope) => scope.kind === "scenario" || scope.kind === "fleet",
  gradeAware: true,

  run(ctx: AdvisorContext, scope): AdvisorRuleResult {
    const recommendations: AdvisorRecommendation[] = [];
    const insufficientData: AdvisorRuleResult["insufficientData"] = [];
    const gap = (reason: string) =>
      insufficientData.push({ ruleId: QUALITY_VALIDATED_TRIM_RULE_ID, reason });

    const servers = serversById(ctx);

    for (const scenario of scenariosInScope(ctx, scope)) {
      const quality = collectQualityEvidence(ctx, scenario);
      if ("missing" in quality) {
        gap(quality.missing);
        continue; // NEVER a trim without quality evidence — the WP's headline invariant.
      }

      const callCounts = toolCallCounts(ctx, quality.runs);
      if (callCounts.size === 0) {
        // Every tool would be "never called" — a trim resting on no positive evidence at all.
        gap(
          `environment "${scenario.name}" (${scenario.id}) has ${quality.runs.length} graded suite-run ` +
            `${plural(quality.runs.length, "member")} but no tool calls in any of them, so no tool can be shown to be needed`,
        );
        continue;
      }

      const allowedServers = [...scenario.allowedServers].sort((a, b) =>
        compareStrings(a.serverId, b.serverId),
      );

      for (const entry of allowedServers) {
        const server = servers.get(entry.serverId);
        if (!server) {
          gap(
            `environment "${scenario.name}" (${scenario.id}) references server ${entry.serverId}, which is no longer configured`,
          );
          continue;
        }

        const scan = latestSuccessfulScan(ctx, entry.serverId);
        if (!scan) {
          gap(
            `server "${server.name}" (${server.id}), used by environment "${scenario.name}", has no successful scan, so the tokens its tools cost are unknown`,
          );
          continue;
        }

        const allowed = allowedToolsOf(scan, entry.allowedTools);
        if (allowed.length === 0) continue; // nothing exposed → nothing to trim

        const unused = allowed.filter((tool) => !callCounts.has(tool.toolName));
        if (unused.length === 0) continue; // every allowed tool was exercised in a graded member

        recommendations.push(
          buildRecommendation({ scenario, server, scan, quality, allowed, unused }),
        );
      }
    }

    return { recommendations, insufficientData };
  },
};

/** Re-exported so a test can assert the rule stamps the CURRENT constant when the fixture's grade
 *  rows carry it (the rule itself always reads the version off the rows it actually read). */
export const CURRENT_GRADING_VERSION = GRADING_VERSION;
