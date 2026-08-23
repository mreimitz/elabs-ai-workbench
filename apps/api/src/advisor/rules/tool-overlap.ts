// Rule 4 of 4 (WP 1.2) — CROSS-SERVER TOOL OVERLAP.
//
// "Server A and server B expose N tools that are the same tool twice. Loading both into one prompt
// pays for both copies."
//
// The pairing is NOT re-implemented here: it is `matchTools` from `apps/api/src/compare/matching.ts`
// — the exact matcher the Compare workspace uses (exact name → normalized name → Jaccard similarity
// over name + description tokens). One matcher, one meaning of "the same tool", across the whole app.
//
// Two guards keep the arithmetic honest:
//   * a pair is only formed from each server's latest SUCCESSFUL scan;
//   * tokens from two scans are only ever added together when both were counted the SAME way (same
//     token profile, same `counting_version` — CLAUDE.md §7). When they were not, the overlap is
//     still reported (matching by name/description needs no arithmetic) but the savings figure is
//     withheld and the mismatch is named as a gap.

import type {
  AdvisorRecommendation,
  AdvisorSeverity,
  ScanDetail,
  ServerConfig,
  ToolScan,
} from "@mcp-token-footprint/shared";
import { advisorThresholds } from "../../data-pack/thresholds.js";
import { matchTools, type RawMatch } from "../../compare/matching.js";
import { scanEvidence, serverEvidence, toolScanEvidence } from "../evidence.js";
import type { AdvisorContext, AdvisorRule, AdvisorRuleResult } from "../types.js";
import {
  allowedToolsOf,
  comparablyCounted,
  compareStrings,
  formatCount,
  latestSuccessfulScan,
  plural,
  scanProvenance,
  scenariosInScope,
  serverIdsInScope,
  serversById,
  sumBy,
} from "./shared.js";

export const TOOL_OVERLAP_RULE_ID = "advisor.tool-overlap";

// Two thresholds, both read from `data-pack/advisor/thresholds.json` (RM-38 WP 2.2):
//   overlap_similarity_threshold  the Jaccard floor for calling two differently-named tools "the
//                                 same tool" — same default family as the Compare workspace's
//                                 threshold; exact and normalized-name matches are taken first
//                                 regardless. The rule's `assumptions` prose quotes this exact
//                                 resolved value, so the matcher and the sentence cannot disagree.
//   medium_overlap_count          at this many duplicated tools the overlap stops being a curiosity
//                                 and becomes worth acting on. Overlap is never `high`: two servers
//                                 legitimately covering the same ground is a design decision, not a
//                                 defect.

function severityFor(duplicateCount: number): AdvisorSeverity {
  return duplicateCount >= advisorThresholds().medium_overlap_count ? "medium" : "info";
}

type ServerScan = { server: ServerConfig; scan: ScanDetail; tools: ToolScan[] };

/** Duplicates ordered by what dropping one copy would save, biggest first — a total order (the
 *  A-side name breaks ties). */
function sortDuplicates(matches: RawMatch<ToolScan, ToolScan>[]): RawMatch<ToolScan, ToolScan>[] {
  return [...matches].sort((x, y) => {
    const byTokens = savedTokens(y) - savedTokens(x);
    if (byTokens !== 0) return byTokens;
    return compareStrings(x.a.toolName, y.a.toolName);
  });
}

/** What dropping ONE copy of a duplicated pair removes: the smaller of the two definitions. Taking
 *  the smaller side is the conservative reading — it is the least the removal can save, whichever
 *  copy the operator decides to keep. */
function savedTokens(match: RawMatch<ToolScan, ToolScan>): number {
  return Math.min(match.a.totalTokens, match.b.totalTokens);
}

function buildRecommendation(
  a: ServerScan,
  b: ServerScan,
  duplicates: RawMatch<ToolScan, ToolScan>[],
): AdvisorRecommendation {
  const countable = comparablyCounted(a.scan, b.scan);
  const overlapTokens = sumBy(duplicates, savedTokens);

  const lines = duplicates
    .slice(0, advisorThresholds().evidence_tool_limit)
    .map(
      (match) =>
        `${match.a.toolName} ↔ ${match.b.toolName} (${match.basis}${match.basis === "fuzzy" ? `, ${match.similarity.toFixed(2)} similar` : ""}; ${formatCount(match.a.totalTokens)} / ${formatCount(match.b.totalTokens)} tokens)`,
    );
  const hidden = duplicates.length - lines.length;

  return {
    id: `${TOOL_OVERLAP_RULE_ID}:${a.server.id}:${b.server.id}`,
    ruleId: TOOL_OVERLAP_RULE_ID,
    title: `${duplicates.length} overlapping ${plural(duplicates.length, "tool")} between "${a.server.name}" and "${b.server.name}"`,
    detail:
      `"${a.server.name}" and "${b.server.name}" expose ${duplicates.length} overlapping ` +
      `${plural(duplicates.length, "tool")}: ${lines.join("; ")}` +
      (hidden > 0 ? `; and ${hidden} more` : "") +
      ". " +
      (countable
        ? `Dropping one copy of each would remove ${formatCount(overlapTokens)} definition tokens from a prompt that carries both servers.`
        : `The two scans were counted differently (${scanProvenance(a.scan)} vs ${scanProvenance(b.scan)}), so no token figure is given — adding tokens across counting methods would not mean anything.`),
    severity: severityFor(duplicates.length),
    ...(countable
      ? {
          savings: {
            value: overlapTokens,
            unit: "tokens" as const,
            estimate: true,
            basis: `sum over the ${duplicates.length} duplicated ${plural(duplicates.length, "pair")} of the SMALLER side's definition tokens, from ${scanProvenance(a.scan)} and ${scanProvenance(b.scan)}`,
          },
        }
      : {}),
    evidence: [
      serverEvidence(a.server),
      serverEvidence(b.server),
      scanEvidence(a.scan),
      scanEvidence(b.scan),
      ...duplicates
        .slice(0, advisorThresholds().evidence_tool_limit)
        .flatMap((match) => [
          toolScanEvidence(a.scan.id, match.a.toolName),
          toolScanEvidence(b.scan.id, match.b.toolName),
        ]),
    ],
    assumptions: [
      `tools are paired by exact name, then normalized name, then Jaccard similarity ≥ ${advisorThresholds().overlap_similarity_threshold} over name + description tokens — the same matcher the Compare view uses`,
      "duplication only costs tokens when both servers are loaded into the same prompt; two servers that are never used together cost nothing extra",
      "a near-duplicate by name and description is not proof of identical behavior — check both tools before dropping either",
    ],
  };
}

export const toolOverlapRule: AdvisorRule = {
  id: TOOL_OVERLAP_RULE_ID,
  description:
    "Near-duplicate tools exposed by two different servers, paired with the shared compare matcher.",
  appliesTo: () => true,

  run(ctx: AdvisorContext, scope): AdvisorRuleResult {
    const recommendations: AdvisorRecommendation[] = [];
    const insufficientData: AdvisorRuleResult["insufficientData"] = [];
    const gap = (reason: string) => insufficientData.push({ ruleId: TOOL_OVERLAP_RULE_ID, reason });

    const servers = serversById(ctx);

    // A `scenario` scope compares only what that environment actually exposes (its allow-lists);
    // `server`/`fleet` compare the servers' full tool surface.
    const allowedToolsByServer = new Map<string, string[] | null>();
    if (scope.kind === "scenario") {
      const [scenario] = scenariosInScope(ctx, scope);
      for (const entry of scenario?.allowedServers ?? []) {
        allowedToolsByServer.set(entry.serverId, entry.allowedTools);
      }
    }

    /** The servers this scope compares against the focus/each other, loaded once. */
    const loaded: ServerScan[] = [];
    // A `server` scope compares the named server against EVERY other configured server; the other
    // scopes compare within their own set.
    const candidateIds =
      scope.kind === "server"
        ? [...servers.keys()].sort(compareStrings)
        : serverIdsInScope(ctx, scope);

    for (const serverId of candidateIds) {
      const server = servers.get(serverId);
      if (!server) continue;
      const scan = latestSuccessfulScan(ctx, serverId);
      if (!scan) {
        // Named servers get an honest gap; in a fleet sweep an unscanned server is simply not a
        // candidate (one summary gap below covers "there is nothing to compare").
        if (scope.kind !== "fleet") {
          gap(
            `server "${server.name}" (${server.id}) has no successful scan, so its tools cannot be compared against another server's`,
          );
        }
        continue;
      }
      const tools = allowedToolsOf(scan, allowedToolsByServer.get(serverId) ?? null);
      if (tools.length === 0) continue;
      loaded.push({ server, scan, tools });
    }

    if (loaded.length < 2) {
      gap(
        scope.kind === "server"
          ? `fewer than two servers (including this one) have a successful scan with tools, so there is nothing to compare against`
          : "fewer than two of the servers in scope have a successful scan with tools, so no cross-server overlap can be computed",
      );
      return { recommendations, insufficientData };
    }

    const ordered = [...loaded].sort((x, y) => compareStrings(x.server.id, y.server.id));
    const focusId = scope.kind === "server" ? scope.id : undefined;

    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];
        if (!a || !b) continue;
        // Under a `server` scope only pairs that include the named server are relevant. The pair is
        // still ordered by server id, so the SAME pair carries the same recommendation id whether it
        // was found from the server scope or from the fleet sweep.
        if (focusId !== undefined && a.server.id !== focusId && b.server.id !== focusId) continue;

        const duplicates = sortDuplicates(
          matchTools(a.tools, b.tools, advisorThresholds().overlap_similarity_threshold).matched,
        );
        if (duplicates.length === 0) continue;

        if (!comparablyCounted(a.scan, b.scan)) {
          gap(
            `${scanProvenance(a.scan)} and ${scanProvenance(b.scan)} were produced by different counting methods, so the overlap between "${a.server.name}" and "${b.server.name}" is reported without a token estimate`,
          );
        }
        recommendations.push(buildRecommendation(a, b, duplicates));
      }
    }

    return { recommendations, insufficientData };
  },
};
