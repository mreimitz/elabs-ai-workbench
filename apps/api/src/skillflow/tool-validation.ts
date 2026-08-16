// Skill IDE WP 5.1 (I5) — validate skill text that references MCP tools against the LATEST persisted
// scans of registered servers. NEVER opens an MCP connection and NEVER triggers a scan: this module
// is PURE and deterministic over `(skillMd, servers)` — the caller (a read route) loads the persisted
// scan data through the existing scans repository and hands it in here. It imports no MCP client, no
// session opener, no database driver, and spawns no subprocess (asserted by a static import-scan test).
//
// ── Extraction (SINGLE implementation) ──────────────────────────────────────────────────────────────
// The conservative tool-reference extraction heuristic + the `skillflow:servers` scope parsing now live
// in the shared `extract-tools.ts` module (Skill IDE WP 8.1, I9.2) — the ONE implementation used by
// BOTH this validator and the projector's `tool_ref` nodes. This file re-exports `extractToolReferences`
// / `parseServerScope` / `ToolReference` so its existing consumers/tests keep their import site, and
// consumes `scanSkillForTools` for the single-pass (references + scope) it needs.
//
// ── Matching + diagnostics ─────────────────────────────────────────────────────────────────────────
// Candidates per scoped server come from its LATEST completed scan's tool names. Matching REUSES the
// compare feature's helpers (`normalizeName`, `similarity` — no local copies): exact equality →
// `exact`; `normalizeName` equality → `normalized`; Jaccard `similarity >= DEFAULT_COMPARE_THRESHOLD`
// → `fuzzy`. A reference exact/normalized-matched in some scoped server's latest scan is current
// (no diagnostic). Otherwise: `stale_tool` when it was exact/normalized-matched in an OLDER completed
// scan of a scoped server (present then, gone now), else `unknown_tool`. Both carry up to 3 close-match
// candidates (by score, then band, then server/tool name). Servers with zero completed scans are not
// turned into false unknowns — they are skipped and surfaced in `unscannedServers`.

import {
  DEFAULT_COMPARE_THRESHOLD,
  type ToolCandidateConfidence,
  type ToolDiagnostic,
  type ToolDiagnosticCandidate,
  type ToolDiagnosticsReport,
  TOOL_VALIDATION_VERSION,
} from "@mcp-token-footprint/shared";
import { normalizeName, similarity } from "../compare/matching.js";
import {
  extractToolReferences,
  parseServerScope,
  scanSkillForTools,
  type ToolReference,
} from "./extract-tools.js";

// Re-exported so existing consumers/tests keep importing them from `tool-validation.js` (the single
// implementation lives in `extract-tools.ts` — Skill IDE WP 8.1).
export { extractToolReferences, parseServerScope };
export type { ToolReference };

/** One completed scan's tool inventory (just the names — the matcher works on names). */
export type ToolScanSnapshot = {
  scanId: string;
  toolNames: string[];
};

/**
 * A registered server plus its COMPLETED scans, NEWEST-FIRST (`scans[0]` = the latest completed scan;
 * `scans[1..]` = history for the stale lookup). An empty `scans` means the server has never completed
 * a scan → it contributes no candidates and is reported in `unscannedServers`.
 */
export type ServerScanHistory = {
  serverId: string;
  serverName: string;
  scans: ToolScanSnapshot[];
};

/** Exact or `normalizeName`-equal match of `reference` against any of `toolNames`. */
function identityMatch(reference: string, toolNames: string[]): boolean {
  const norm = normalizeName(reference);
  return toolNames.some((tool) => tool === reference || normalizeName(tool) === norm);
}

type ScoredCandidate = ToolDiagnosticCandidate & { score: number; rank: number };

/** The best band for `reference` vs one candidate `tool`, or `null` when below the fuzzy threshold. */
function bestBand(
  reference: string,
  tool: string,
): { confidence: ToolCandidateConfidence; score: number; rank: number } | null {
  if (tool === reference) return { confidence: "exact", score: 1, rank: 0 };
  if (normalizeName(tool) === normalizeName(reference))
    return { confidence: "normalized", score: 1, rank: 1 };
  const score = similarity({ toolName: reference }, { toolName: tool });
  if (score >= DEFAULT_COMPARE_THRESHOLD) return { confidence: "fuzzy", score, rank: 2 };
  return null;
}

/** Up to 3 close-match candidates from the scoped servers' LATEST scans, best-first + deterministic. */
function topCandidates(reference: string, servers: ServerScanHistory[]): ToolDiagnosticCandidate[] {
  const scored: ScoredCandidate[] = [];
  for (const server of servers) {
    const latest = server.scans[0];
    if (!latest) continue;
    const seen = new Set<string>();
    for (const tool of latest.toolNames) {
      if (seen.has(tool)) continue;
      seen.add(tool);
      const band = bestBand(reference, tool);
      if (!band) continue;
      scored.push({
        server: server.serverName,
        tool,
        confidence: band.confidence,
        score: band.score,
        rank: band.rank,
      });
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.rank - b.rank ||
      a.server.localeCompare(b.server) ||
      a.tool.localeCompare(b.tool),
  );
  return scored.slice(0, 3).map(({ server, tool, confidence }) => ({ server, tool, confidence }));
}

/** Narrow the registered servers to the scope, or return them all when there is no scope annotation. */
function scopeServers(
  servers: ServerScanHistory[],
  scopeNames: string[] | null,
): ServerScanHistory[] {
  if (scopeNames === null) return servers;
  const wanted = new Set(scopeNames);
  return servers.filter((server) => wanted.has(server.serverName.trim().toLowerCase()));
}

/**
 * Validate every extracted tool reference against the scoped registered servers' persisted scans.
 * Deterministic and pure; stamped `TOOL_VALIDATION_VERSION`. `registeredServers` must carry each
 * server's completed scans NEWEST-FIRST.
 */
export function validateToolReferences(
  skillMd: string,
  registeredServers: ServerScanHistory[],
): ToolDiagnosticsReport {
  const { references, scope } = scanSkillForTools(skillMd);
  const scoped = scopeServers(registeredServers, scope);
  const scanned = scoped.filter((server) => server.scans.length > 0);
  const unscannedServers = [
    ...new Set(
      scoped.filter((server) => server.scans.length === 0).map((server) => server.serverName),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const diagnostics: ToolDiagnostic[] = [];
  for (const reference of references) {
    // Current: exact/normalized in ANY scoped server's latest completed scan → no diagnostic.
    const current = scanned.some((server) =>
      identityMatch(reference.name, server.scans[0]!.toolNames),
    );
    if (current) continue;

    // Stale: exact/normalized in an OLDER completed scan of a scoped server (gone from the latest).
    const stale = scanned.some((server) =>
      server.scans.slice(1).some((snapshot) => identityMatch(reference.name, snapshot.toolNames)),
    );

    diagnostics.push({
      kind: stale ? "stale_tool" : "unknown_tool",
      name: reference.name,
      anchor: reference.anchor,
      candidates: topCandidates(reference.name, scanned),
    });
  }

  diagnostics.sort(
    (a, b) =>
      (a.anchor?.startLine ?? 0) - (b.anchor?.startLine ?? 0) ||
      a.name.localeCompare(b.name) ||
      a.kind.localeCompare(b.kind),
  );

  const report: ToolDiagnosticsReport = {
    diagnostics,
    toolValidationVersion: TOOL_VALIDATION_VERSION,
  };
  if (unscannedServers.length > 0) report.unscannedServers = unscannedServers;
  return report;
}
