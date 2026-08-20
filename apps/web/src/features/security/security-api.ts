import type {
  SecurityFleetSummary,
  SecurityPostureDiff,
  SecurityReport,
} from "@mcp-token-footprint/shared";
import { apiGet } from "../../lib/api";

// ── Security posture: READ-ONLY api helpers ──────────────────────────────────────────────────────
// Thin, typed wrappers over the five `/api/**/security*` read routes (apps/api/src/security/routes.ts,
// WP 1.2–1.4 + WP 2.1). They live HERE rather than in `lib/api.ts`, mirroring
// `skills-inspector-api.ts`: one feature's fetchers next to the feature, still on the shared `apiGet`
// wrapper so a non-2xx becomes an `ApiError` carrying the API's OWN message.
//
// That last part is load-bearing for D-SP19. Four pairings are refused with a 400 whose body IS the
// explanation ("the baseline belongs to …", "produced more than 200 findings …"); the diff panel
// renders that sentence verbatim rather than replacing it with a generic "couldn't load". Nothing
// here re-words, re-orders, re-tallies or re-scores anything — the report is the API's answer.

/** One scan's posture. **400** when the scan is not `success` (D-SP10). */
export const getScanSecurityReport = (scanId: string): Promise<SecurityReport> =>
  apiGet<SecurityReport>(`/api/scans/${scanId}/security`);

/** One skill version's posture. **400** when its SKILL.md is missing or binary (D-SP16). */
export const getSkillSecurityReport = (
  skillId: string,
  versionId: string,
): Promise<SecurityReport> =>
  apiGet<SecurityReport>(`/api/skills/${skillId}/versions/${versionId}/security`);

/** Two scans of ONE server. **400** on any of D-SP19's four refusals. */
export const getScanSecurityDiff = (
  scanId: string,
  baselineScanId: string,
): Promise<SecurityPostureDiff> =>
  apiGet<SecurityPostureDiff>(
    `/api/scans/${scanId}/security/diff?baseline=${encodeURIComponent(baselineScanId)}`,
  );

/** Two versions of ONE skill. **400** on any of D-SP19's four refusals. */
export const getSkillSecurityDiff = (
  skillId: string,
  versionId: string,
  baselineVersionId: string,
): Promise<SecurityPostureDiff> =>
  apiGet<SecurityPostureDiff>(
    `/api/skills/${skillId}/versions/${versionId}/security/diff?baseline=${encodeURIComponent(
      baselineVersionId,
    )}`,
  );

/**
 * The whole fleet's posture in ONE request (D-SP22) — a server with no `success` scan is **absent**
 * from the answer, which is why the list keys on it by id rather than expecting a row per server.
 */
export const getSecurityFleetSummary = (): Promise<SecurityFleetSummary[]> =>
  apiGet<SecurityFleetSummary[]>("/api/security/summary");
