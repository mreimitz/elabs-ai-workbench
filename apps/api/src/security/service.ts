// The security-posture service (roadmap/security-posture/, WP 1.2) — turns a persisted scan into a
// `SecurityReport`.
//
// The split with `analyzer.ts` is D-SP7 and it is deliberate: the ANALYZER is pure (data in, findings
// out, no db/clock/network) so `roadmap/ci/` WP 3.1 can call it with the `ScanDetail` its assertions
// engine already holds; this file owns the I/O, the refusal, the ordering, the capping and the score.
//
//   • **D-SP8 — a report is computed on read and persisted NOWHERE.** It is a pure derivation of rows
//     that are already immutable (`mcp_scans` + `mcp_tool_scans` never change once a scan settles), so
//     a cache would be a second source of truth with a staleness bug waiting in it and a table would
//     be a migration for data we recompute in milliseconds. WP 1.4's diff recomputes both sides.
//   • **D-SP10 — a non-`success` scan is a 400, never a report.** A `running` or `failed` scan has a
//     partial or empty tool list; scoring it would hand a broken server a clean bill of health, which
//     is precisely the silent-wrong-answer this workstream exists to prevent. Same posture as the CI
//     assertions engine's refusal to assert against a non-`success` scan.
//   • **D-SP3 — the score is `computeSecurityScore` and nothing else.** No weight and no band
//     threshold is re-typed anywhere in `apps/api`.

import {
  capSecurityFindings,
  compareSecurityFindings,
  computeSecurityScore,
  SECURITY_ANALYZER_VERSION,
  type ScanDetail,
  type SecurityFinding,
  type SecurityReport,
  type SecurityRuleId,
  type ServerConfig,
} from "@mcp-token-footprint/shared";
import { httpError } from "../utils/errors.js";
import { analyzeScanTools } from "./analyzer.js";

/**
 * The narrow read ports this service needs. Deliberately structural rather than the real repository
 * classes — exactly like `AssertionPorts` in `apps/api/src/assertions/service.ts`: this WP adds no
 * repository and no migration, and a test can hand it three functions instead of a database.
 */
export type SecurityAnalyzerPorts = {
  scans: { getDetail: (scanId: string) => ScanDetail };
  /**
   * The REDACTED projection (`ServerConfig`), never `getInternal`. All this needs from it is a
   * display name, and a report that reached for the internal row would be one refactor away from
   * carrying a command line or a header value.
   */
  servers: { list: () => ServerConfig[] };
  /** D-SP9 — scope NAMES only. See `OAuthRepository.listGrantedScopes`. */
  oauth: { listGrantedScopes: (serverId: string) => string[] | null };
  /** Injectable so a test can pin `generatedAt` — the one non-deterministic field in the report. */
  now?: () => Date;
  /** Injectable so the route can log a rule that threw on a malformed tool definition. */
  onRuleError?: (ruleId: SecurityRuleId, error: unknown) => void;
};

/** Only a `success` scan may be scored: a failed or in-flight scan has a partial tool list. */
const USABLE_STATUS = "success";

export function analyzeScan(ports: SecurityAnalyzerPorts, scanId: string): SecurityReport {
  // Unknown id: the repository throws its own 404, which the central error handler formats.
  const scan = ports.scans.getDetail(scanId);
  if (scan.status !== USABLE_STATUS) {
    throw httpError(
      400,
      `Scan ${scan.id} has status "${scan.status}", so it has no complete tool list to analyse. Name a completed scan.`,
    );
  }

  const findings = analyzeScanTools({
    scan,
    oauthScopes: readScopes(ports, scan.serverId),
    onRuleError: ports.onRuleError,
  });

  // Order → cap → count ALL → score. The order matters:
  //   • sorting is `compareSecurityFindings` and nothing else (D-SP6), so the same scan always
  //     serializes byte-identically;
  //   • `counts` describes EVERY finding the analyzer produced, including any the cap dropped from
  //     `findings` — a CI gate reading `counts.error` must never be fooled by display truncation;
  //   • the score is computed over that same complete set, for the same reason.
  const ordered = [...findings].sort(compareSecurityFindings);
  const capped = capSecurityFindings(ordered);

  return {
    analyzerVersion: SECURITY_ANALYZER_VERSION,
    generatedAt: (ports.now?.() ?? new Date()).toISOString(),
    subject: {
      kind: "server",
      id: scan.id,
      ownerId: scan.serverId,
      name: displayName(ports, scan),
      capturedAt: scan.scannedAt,
    },
    findings: capped.findings,
    counts: countBySeverity(ordered),
    score: computeSecurityScore(ordered),
    truncated: capped.truncated,
  };
}

/**
 * The server's current display name, falling back to the name the scan captured. A server can be
 * renamed (or deleted) after a scan, and `SecuritySubjectRef.name` is `min(1)` on the wire — a report
 * that 500s because somebody deleted a server is a worse answer than one naming what it analysed.
 */
function displayName(ports: SecurityAnalyzerPorts, scan: ScanDetail): string {
  const current = ports.servers.list().find((server) => server.id === scan.serverId)?.name;
  return current ?? scan.serverName;
}

/**
 * D-SP9 — read scope names, and treat a failure as "we could not tell".
 *
 * A credential blob that will not decrypt (the key was rotated, the row is from another install) is
 * not evidence of a broad scope, so it produces `null` and the rule reports nothing. Turning an
 * unreadable credential into a finding would be a guess, and turning it into a 500 would make the
 * whole report unavailable for a reason that has nothing to do with the server's tool surface.
 */
function readScopes(ports: SecurityAnalyzerPorts, serverId: string): string[] | null {
  try {
    return ports.oauth.listGrantedScopes(serverId);
  } catch {
    return null;
  }
}

function countBySeverity(findings: readonly SecurityFinding[]): SecurityReport["counts"] {
  const counts = { error: 0, warning: 0, info: 0, total: findings.length };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}
