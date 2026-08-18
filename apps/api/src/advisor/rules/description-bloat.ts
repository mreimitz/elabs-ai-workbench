// Rule 2 of 4 (WP 1.2) — DESCRIPTION BLOAT.
//
// "On server S, the biggest tool definitions are mostly prose: these N tools spend X tokens on their
// descriptions, Y% of the whole scan." Footprint-only — it needs no runs, so it answers on a server
// scope too. When the scope IS an environment, each flagged tool additionally carries how often it
// was actually called there, which is the difference between "this description is long" and "this
// description is long AND nobody uses the tool".
//
// The savings figure is deliberately a CEILING, not a promise: the advisor cannot know how much
// shorter a description could be while still explaining the tool, so it reports what the flagged
// descriptions cost today and says in the basis that this is the most a rewrite could ever recover.

import type {
  AdvisorRecommendation,
  AdvisorSeverity,
  ScanDetail,
  Scenario,
  ServerConfig,
  ToolScan,
} from "@mcp-token-footprint/shared";
import { scanEvidence, scenarioEvidence, serverEvidence, toolScanEvidence } from "../evidence.js";
import type { AdvisorContext, AdvisorRule, AdvisorRuleResult } from "../types.js";
import {
  completedRuns,
  EVIDENCE_TOOL_LIMIT,
  formatCount,
  formatPercent,
  latestSuccessfulScan,
  plural,
  ratio,
  scanProvenance,
  scenariosInScope,
  serverIdsInScope,
  serversById,
  sumBy,
  toolCallCounts,
  toolsByTokensDesc,
} from "./shared.js";

export const DESCRIPTION_BLOAT_RULE_ID = "advisor.description-bloat";

/** How many of a scan's largest tools the rule looks at. "Bloat" is only worth acting on where the
 *  footprint actually is; a verbose description on the 40th-biggest tool is noise. */
const TOP_TOOLS = 5;

/** A tool is flagged when its description is at least this share of its OWN definition tokens — the
 *  prose, not the schema, is what makes it big. */
const DESCRIPTION_SHARE_THRESHOLD = 0.5;

/** …and only above this absolute size, so a 12-token tool whose description happens to be 8 tokens
 *  is never dressed up as a finding. */
const MIN_DESCRIPTION_TOKENS = 100;

/** Severity bands, by the share of the WHOLE scan the flagged descriptions occupy. */
const HIGH_SCAN_SHARE = 0.3;
const MEDIUM_SCAN_SHARE = 0.15;

function severityFor(scanShare: number): AdvisorSeverity {
  if (scanShare >= HIGH_SCAN_SHARE) return "high";
  if (scanShare >= MEDIUM_SCAN_SHARE) return "medium";
  return "info";
}

/** The flagged subset of a scan's biggest tools, biggest first (the input order is already total). */
function flaggedTools(scan: ScanDetail): ToolScan[] {
  return toolsByTokensDesc(scan.tools)
    .slice(0, TOP_TOOLS)
    .filter(
      (tool) =>
        tool.descriptionTokens >= MIN_DESCRIPTION_TOKENS &&
        tool.descriptionTokens >= DESCRIPTION_SHARE_THRESHOLD * tool.totalTokens,
    );
}

type UsageContext = {
  scenario: Scenario;
  runCount: number;
  callCounts: Map<string, number>;
};

function buildRecommendation(
  server: ServerConfig,
  scan: ScanDetail,
  flagged: ToolScan[],
  usage: UsageContext | null,
): AdvisorRecommendation {
  const descriptionTokens = sumBy(flagged, (tool) => tool.descriptionTokens);
  const scanShare = ratio(descriptionTokens, scan.totalTokens);

  const lines = flagged.map((tool) => {
    const own = formatPercent(ratio(tool.descriptionTokens, tool.totalTokens));
    const base = `${tool.toolName}: ${formatCount(tool.totalTokens)} tokens, ${formatCount(tool.descriptionTokens)} of them description (${own})`;
    if (!usage) return base;
    const calls = usage.callCounts.get(tool.toolName) ?? 0;
    return `${base}, called ${formatCount(calls)} ${plural(calls, "time")} in ${usage.runCount} completed ${plural(usage.runCount, "run")}`;
  });

  return {
    id: `${DESCRIPTION_BLOAT_RULE_ID}:${server.id}`,
    ruleId: DESCRIPTION_BLOAT_RULE_ID,
    title: `Shorten ${flagged.length} oversized tool ${plural(flagged.length, "description")} on "${server.name}"`,
    detail:
      `${flagged.length} of the ${TOP_TOOLS} largest tool ${plural(flagged.length, "definition")} on "${server.name}" ` +
      `spend most of their tokens on prose, ${formatCount(descriptionTokens)} tokens in total — ` +
      `${formatPercent(scanShare)} of the scan's ${formatCount(scan.totalTokens)} tool tokens. ` +
      lines.join("; ") +
      ".",
    severity: severityFor(scanShare),
    savings: {
      value: descriptionTokens,
      unit: "tokens",
      estimate: true,
      basis: `combined description tokens of the ${flagged.length} flagged ${plural(flagged.length, "tool")} in ${scanProvenance(scan)} — the CEILING on what shortening them could recover, not a predicted saving (the advisor does not guess how short a description can safely get)`,
    },
    evidence: [
      serverEvidence(server),
      scanEvidence(scan),
      ...flagged
        .slice(0, EVIDENCE_TOOL_LIMIT)
        .map((tool) => toolScanEvidence(scan.id, tool.toolName)),
      ...(usage ? [scenarioEvidence(usage.scenario)] : []),
    ],
    assumptions: [
      `"bloat" means a description is at least ${formatPercent(DESCRIPTION_SHARE_THRESHOLD)} of its own tool's definition tokens and at least ${MIN_DESCRIPTION_TOKENS} tokens, measured over the ${TOP_TOOLS} largest tools in ${scanProvenance(scan)}`,
      "a shorter description is only a saving if the tool is still described well enough for the model to pick it correctly — this rule measures size, not quality",
      ...(usage
        ? [
            `call counts come from the ${usage.runCount} completed ${plural(usage.runCount, "run")} of environment "${usage.scenario.name}" and are matched by tool NAME across that environment's servers`,
          ]
        : []),
    ],
  };
}

export const descriptionBloatRule: AdvisorRule = {
  id: DESCRIPTION_BLOAT_RULE_ID,
  description:
    "Tools whose description dominates their definition footprint, among the largest tools of a server's latest scan.",
  appliesTo: () => true,

  run(ctx: AdvisorContext, scope): AdvisorRuleResult {
    const recommendations: AdvisorRecommendation[] = [];
    const insufficientData: AdvisorRuleResult["insufficientData"] = [];
    const gap = (reason: string) =>
      insufficientData.push({ ruleId: DESCRIPTION_BLOAT_RULE_ID, reason });

    const servers = serversById(ctx);

    // Usage enrichment exists ONLY for an environment scope: runs are recorded per environment, so
    // there is no honest way to attribute a call count to a bare server or to the fleet.
    let usage: UsageContext | null = null;
    if (scope.kind === "scenario") {
      const [scenario] = scenariosInScope(ctx, scope);
      if (scenario) {
        const runs = completedRuns(ctx, scenario.id);
        if (runs.length > 0) {
          usage = { scenario, runCount: runs.length, callCounts: toolCallCounts(ctx, runs) };
        }
      }
    }

    for (const serverId of serverIdsInScope(ctx, scope)) {
      const server = servers.get(serverId);
      if (!server) {
        gap(`server ${serverId} is no longer configured, so it has no scan to read`);
        continue;
      }

      const scan = latestSuccessfulScan(ctx, serverId);
      if (!scan) {
        gap(
          `server "${server.name}" (${server.id}) has no successful scan, so its tool descriptions have never been measured`,
        );
        continue;
      }

      const flagged = flaggedTools(scan);
      if (flagged.length === 0) continue; // the rule ran fine and found nothing — not a data gap

      recommendations.push(buildRecommendation(server, scan, flagged, usage));
    }

    return { recommendations, insufficientData };
  },
};
