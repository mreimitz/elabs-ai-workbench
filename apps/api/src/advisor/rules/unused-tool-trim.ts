// Rule 1 of 4 (WP 1.2) — UNUSED-TOOL TRIM.
//
// "In environment E, these tools of server S were never called across E's completed runs, and they
// cost N tokens of the definition footprint E ships. Here is the `allowedTools` list that keeps only
// what was actually used."
//
// Two measurements, joined:
//   footprint — the server's latest SUCCESSFUL scan (`mcp_tool_scans.total_tokens`).
//   usage     — the tool-call steps of the environment's COMPLETED runs.
//
// What the rule refuses to do:
//   * report a trim from zero observations (no completed runs, or runs that called nothing at all)
//     — that is an honest gap, not a 100%-waste finding;
//   * count a tool it never measured (a name in the allow-list with no row in the scan);
//   * claim per-TURN savings for a `deferred` environment, whose definitions are not resident in
//     every prompt prefix — there the same number is a plain `tokens` figure.

import type {
  AdvisorRecommendation,
  AdvisorSavingsUnit,
  AdvisorSeverity,
  RunSummary,
  ScanDetail,
  Scenario,
  ServerConfig,
  ToolScan,
} from "@mcp-token-footprint/shared";
import { scanEvidence, scenarioEvidence, serverEvidence, toolScanEvidence } from "../evidence.js";
import type { AdvisorContext, AdvisorRule, AdvisorRuleResult } from "../types.js";
import {
  allowedToolsOf,
  compareStrings,
  completedRuns,
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

export const UNUSED_TOOL_TRIM_RULE_ID = "advisor.unused-tool-trim";

/** Severity bands, by the share of THIS SERVER's allow-listed definition tokens that is never
 *  exercised. Fixed constants, not tuning knobs: the same inputs must always produce the same
 *  severity, and a reader must be able to check the band by hand from the numbers in the detail. */
const HIGH_WASTE_SHARE = 0.5;
const MEDIUM_WASTE_SHARE = 0.2;

function severityFor(wastedShare: number): AdvisorSeverity {
  if (wastedShare >= HIGH_WASTE_SHARE) return "high";
  if (wastedShare >= MEDIUM_WASTE_SHARE) return "medium";
  return "info";
}

type ServerFinding = {
  scenario: Scenario;
  server: ServerConfig;
  scan: ScanDetail;
  runs: RunSummary[];
  allowed: ToolScan[];
  unused: ToolScan[];
};

function buildRecommendation(finding: ServerFinding): AdvisorRecommendation {
  const { scenario, server, scan, runs, allowed, unused } = finding;

  const unusedTokens = sumBy(unused, (tool) => tool.totalTokens);
  const allowedTokens = sumBy(allowed, (tool) => tool.totalTokens);
  const wastedShare = ratio(unusedTokens, allowedTokens);

  const unusedByName = new Set(unused.map((tool) => tool.toolName));
  const kept = allowed
    .filter((tool) => !unusedByName.has(tool.toolName))
    .map((tool) => tool.toolName)
    .sort(compareStrings);
  const unusedNames = [...unusedByName].sort(compareStrings);

  // `eager` re-sends every allowed definition in EVERY turn's prompt prefix, so the waste is a
  // per-turn cost. `deferred` withholds them until the model asks, so the same tokens are a
  // one-off definition footprint — the unit says which, and never pretends the deferred case
  // repeats per turn.
  const eager = scenario.toolLoadingMode !== "deferred";
  const unit: AdvisorSavingsUnit = eager ? "tokens_per_turn" : "tokens";
  const basis = eager
    ? `sum of the ${unused.length} never-called ${plural(unused.length, "tool")}' definition tokens in ${scanProvenance(scan)}; this environment loads tools eagerly, so every allowed definition rides each turn's prompt prefix`
    : `sum of the ${unused.length} never-called ${plural(unused.length, "tool")}' definition tokens in ${scanProvenance(scan)}; this environment loads tools deferred, so the definitions are NOT resident in every turn and the figure is a one-off footprint, not a per-turn cost`;

  const evidenceTools = unused.slice(0, EVIDENCE_TOOL_LIMIT);
  const trimmed = unused.length - evidenceTools.length;

  return {
    id: `${UNUSED_TOOL_TRIM_RULE_ID}:${scenario.id}:${server.id}`,
    ruleId: UNUSED_TOOL_TRIM_RULE_ID,
    title: `Trim ${unused.length} never-called ${plural(unused.length, "tool")} from "${server.name}" in "${scenario.name}"`,
    detail:
      `Across ${runs.length} completed ${plural(runs.length, "run")} of "${scenario.name}", ` +
      `${kept.length} of the ${allowed.length} ${plural(allowed.length, "tool")} "${server.name}" ` +
      `exposes to this environment ${plural(kept.length, "was", "were")} called. The ${unused.length} that ` +
      `never ${plural(unused.length, "was", "were")} cost ${formatCount(unusedTokens)} of the ` +
      `${formatCount(allowedTokens)} definition tokens this server contributes ` +
      `(${formatPercent(wastedShare)}). Never called: ${unusedNames.join(", ")}. ` +
      (kept.length === 0
        ? "No tool on this server was called at all — consider detaching the server from this environment."
        : `Suggested allowedTools: ${kept.join(", ")}.`),
    severity: severityFor(wastedShare),
    savings: { value: unusedTokens, unit, estimate: true, basis },
    evidence: [
      scenarioEvidence(scenario),
      serverEvidence(server),
      scanEvidence(scan),
      ...evidenceTools.map((tool) => toolScanEvidence(scan.id, tool.toolName)),
    ],
    assumptions: [
      `the environment's ${runs.length} completed ${plural(runs.length, "run")} are representative of how it is normally used`,
      "tool calls are matched by NAME, so a name exposed by more than one of this environment's servers counts as used on all of them (this can hide a trim, never invent one)",
      `the footprint comes from ${scanProvenance(scan)} — the server's latest successful scan, which may be older than the runs`,
      ...(trimmed > 0
        ? [
            `${trimmed} further never-called ${plural(trimmed, "tool")} ${plural(trimmed, "is", "are")} named in the detail but not linked as evidence (the ${EVIDENCE_TOOL_LIMIT} largest are)`,
          ]
        : []),
    ],
  };
}

export const unusedToolTrimRule: AdvisorRule = {
  id: UNUSED_TOOL_TRIM_RULE_ID,
  description:
    "Tools an environment allows but never called across its completed runs, with the definition tokens they cost.",
  // A bare server scope has no runs attached to it — usage is only ever observed per environment.
  appliesTo: (scope) => scope.kind === "scenario" || scope.kind === "fleet",

  run(ctx: AdvisorContext, scope): AdvisorRuleResult {
    const recommendations: AdvisorRecommendation[] = [];
    const insufficientData: AdvisorRuleResult["insufficientData"] = [];
    const gap = (reason: string) =>
      insufficientData.push({ ruleId: UNUSED_TOOL_TRIM_RULE_ID, reason });

    const servers = serversById(ctx);

    for (const scenario of scenariosInScope(ctx, scope)) {
      const runs = completedRuns(ctx, scenario.id);
      if (runs.length === 0) {
        gap(
          `environment "${scenario.name}" (${scenario.id}) has no completed runs, so which of its tools are actually used cannot be observed`,
        );
        continue;
      }

      const callCounts = toolCallCounts(ctx, runs);
      if (callCounts.size === 0) {
        // Every tool is technically "never called" here — and saying so would be a trim resting on
        // no positive evidence at all. Report the gap instead.
        gap(
          `environment "${scenario.name}" (${scenario.id}) has ${runs.length} completed ${plural(runs.length, "run")} but no tool calls in any of them, so no tool can be shown to be needed`,
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
        if (unused.length === 0) continue; // every allowed tool was exercised

        recommendations.push(
          buildRecommendation({ scenario, server, scan, runs, allowed, unused }),
        );
      }
    }

    return { recommendations, insufficientData };
  },
};
