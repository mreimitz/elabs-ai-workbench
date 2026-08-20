// The security-posture service (planning/Roadmap/RM-20-security-posture/, WP 1.2 + WP 1.3) — turns a persisted scan,
// or a persisted skill version, into a `SecurityReport`.
//
// The split with `analyzer.ts` is D-SP7 and it is deliberate: the ANALYZER is pure (data in, findings
// out, no db/clock/network) so `planning/Roadmap/RM-08-ci/` WP 3.1 can call it with the `ScanDetail` its assertions
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
//     threshold is re-typed anywhere in `apps/api`. WP 1.3's `analyzeSkillVersion` therefore lives in
//     THIS file rather than a `skill-service.ts` of its own: a WP 1.2 test asserts that
//     `computeSecurityScore` appears in exactly one file across all of `apps/api/src`, and splitting
//     the skill service out would either break that test or force it to be weakened. The test is
//     right — one place applies the score, for a scan and for a skill alike.

import {
  capSecurityFindings,
  compareSecurityFindings,
  computeSecurityScore,
  diffSecurityReports,
  SECURITY_ANALYZER_VERSION,
  SECURITY_FINDING_LIMIT,
  type ScanDetail,
  type ScanSummary,
  type SecurityFinding,
  type SecurityFleetSummary,
  type SecurityPostureDiff,
  type SecurityReport,
  type SecurityRuleId,
  type ServerConfig,
  type Skill,
  type SkillFileContent,
  type SkillFileNode,
  type SkillVersion,
} from "@mcp-token-footprint/shared";
import { httpError } from "../utils/errors.js";
import { analyzeScanTools } from "./analyzer.js";
import { analyzeSkillFiles } from "./skill-analyzer.js";

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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// WP 1.3 — the skill side
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The narrow read ports the skill report needs. Structural rather than the real `SkillRepository`,
 * exactly like {@link SecurityAnalyzerPorts} above, so a test can hand it four functions instead of a
 * database — and so nothing here can reach for a repository method it did not ask for.
 */
export type SecuritySkillPorts = {
  skills: {
    /**
     * The REDACTED projection (`Skill`), **never `getInternal`**. `getInternal` decrypts the skill's
     * GitHub PAT; all this needs is a display name, and a report that reached for the internal row
     * would be one refactor away from carrying a credential into an exported document
     * (`.claude/rules/mcp-and-security.md`).
     */
    getPublic: (skillId: string) => Skill;
    getVersion: (versionId: string) => SkillVersion;
    listFiles: (versionId: string) => SkillFileNode[];
    /** D-SP15 — called for the SKILL.md and for nothing else. The tree is never opened wholesale. */
    getFileContent: (versionId: string, path: string) => SkillFileContent;
  };
  /** Injectable so a test can pin `generatedAt` — the one non-deterministic field in the report. */
  now?: () => Date;
  /** Injectable so the route can log a rule that threw on a malformed skill. */
  onRuleError?: (ruleId: SecurityRuleId, error: unknown) => void;
};

/**
 * A skill version's posture report. Same shape, same order, same score as a server's — that is
 * D-SP1, and it is what lets WP 1.4's diff and WP 2.1's UI treat the two the same way.
 *
 * The order of operations matters and mirrors {@link analyzeScan}'s exactly:
 *
 *   1. Load the version, and **404 a version that belongs to a different skill** — a version id from
 *      another skill must never be reportable under this skill's name.
 *   2. Find the SKILL.md and read it. Missing or binary is a **400** (D-SP16), not a clean report:
 *      five of the seven rules read that body, so scoring a version without it would hand it a
 *      near-clean bill of health on the strength of the two rules that happened to still run. That is
 *      the same posture D-SP10 takes for a non-`success` scan. A version that simply has NO findings
 *      is a different thing entirely, and still scores 100/`clean`.
 *   3. Analyse → order by `compareSecurityFindings` → cap → count **ALL** → score the same complete
 *      set. `counts` must describe every finding produced, including any the cap dropped, or a gate
 *      reading `counts.error` could be fooled by display truncation.
 */
export function analyzeSkillVersion(
  ports: SecuritySkillPorts,
  skillId: string,
  versionId: string,
): SecurityReport {
  // Unknown id: the repository throws its own 404, which the central error handler formats.
  const version = ports.skills.getVersion(versionId);
  if (version.skillId !== skillId) {
    throw httpError(
      404,
      `Skill version ${versionId} does not belong to skill ${skillId}. Name a version of this skill.`,
    );
  }

  const files = ports.skills.listFiles(versionId);
  const skillMdFile = files.find((file) => file.isSkillMd);
  if (skillMdFile === undefined) {
    throw httpError(
      400,
      `Skill version ${versionId} has no SKILL.md, so most of the skill rules have nothing to read. Scoring it would report a near-clean posture the analyzer cannot stand behind.`,
    );
  }

  const content = ports.skills.getFileContent(versionId, skillMdFile.path);
  if (content.isBinary) {
    throw httpError(
      400,
      `The SKILL.md of skill version ${versionId} is stored as binary, so it cannot be read as text. Scoring it would report a near-clean posture the analyzer cannot stand behind.`,
    );
  }

  const findings = analyzeSkillFiles({
    version,
    files,
    skillMd: { path: skillMdFile.path, body: content.text },
    ...(ports.onRuleError === undefined ? {} : { onRuleError: ports.onRuleError }),
  });

  const ordered = [...findings].sort(compareSecurityFindings);
  const capped = capSecurityFindings(ordered);

  return {
    analyzerVersion: SECURITY_ANALYZER_VERSION,
    generatedAt: (ports.now?.() ?? new Date()).toISOString(),
    subject: {
      kind: "skill",
      id: versionId,
      ownerId: skillId,
      name: skillDisplayName(ports, skillId, version),
      capturedAt: version.createdAt,
    },
    findings: capped.findings,
    counts: countBySeverity(ordered),
    score: computeSecurityScore(ordered),
    truncated: capped.truncated,
  };
}

/**
 * The skill's current display name, falling back to the name its own frontmatter carried, then to the
 * version label.
 *
 * Same reasoning `displayName` above carries for servers: `SecuritySubjectRef.name` is `min(1)` on
 * the wire, and a report that 500s because a skill row went missing mid-request is a worse answer
 * than one naming what it analysed. `getPublic` is the redacted projection — never `getInternal`.
 */
function skillDisplayName(
  ports: SecuritySkillPorts,
  skillId: string,
  version: SkillVersion,
): string {
  try {
    const name = ports.skills.getPublic(skillId).displayName;
    if (typeof name === "string" && name.length > 0) return name;
  } catch {
    // Fall through to the version's own metadata.
  }
  const manifestName = version.manifest?.name;
  if (typeof manifestName === "string" && manifestName.length > 0) return manifestName;
  return version.versionLabel;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// WP 1.4 — the posture DIFF
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Both diffs are three lines of orchestration each, and that is the whole point: **the arithmetic is
// `diffSecurityReports` in the shared contract, and there is no second differ** (D-SP1, and the same
// D-MCP4 "re-project, don't reimplement" instinct the assertions engine already runs on). This file
// analyses two subjects and hands the two reports over; it does not decide what "new" means, does not
// re-tally a count, and does not touch the score.
//
// **D-SP8 still holds, unchanged: nothing is persisted.** A diff is a pure derivation of two reports,
// each of which is itself a pure derivation of immutable rows, so it recomputes both sides on every
// request rather than caching either. No migration, no table, no column.
//
// The one thing that lives HERE rather than in the contract is the HTTP translation. The shared
// differ throws a plain `Error` for the four pairings it refuses (different kinds, different owners,
// different analyzer versions, a truncated side), because `packages/shared` has no idea it is behind
// a web server. A plain throw would reach the central error handler as a **500**, which would read as
// "the workbench broke" when the truth is "you asked for a comparison that cannot mean anything". So
// {@link requireDiffable} asks the same four questions first and answers them with a **400** — the
// same posture D-SP10 takes for a non-`success` scan and D-SP16 for an unreadable SKILL.md.

/**
 * Two scans of ONE server, diffed.
 *
 * The subject is analysed first so that an unknown *subject* id 404s before an unknown baseline does
 * — the caller asked about the subject, and that is the error they can act on.
 *
 * A scan diffed against itself is legal and yields everything `unchanged`; the two ids are not
 * required to differ, only to belong to the same server.
 */
export function diffScanPosture(
  ports: SecurityAnalyzerPorts,
  scanId: string,
  baselineScanId: string,
): SecurityPostureDiff {
  const subject = analyzeScan(ports, scanId);
  const baseline = analyzeScan(ports, baselineScanId);
  requireDiffable(baseline, subject);
  return diffSecurityReports(baseline, subject);
}

/**
 * Two versions of ONE skill, diffed.
 *
 * Both sides go through {@link analyzeSkillVersion} with the SAME `skillId`, so its own 404 already
 * refuses a version belonging to another skill on either side — a cross-skill diff is unreachable
 * here rather than merely rejected, which is the stronger of the two.
 */
export function diffSkillPosture(
  ports: SecuritySkillPorts,
  skillId: string,
  versionId: string,
  baselineVersionId: string,
): SecurityPostureDiff {
  const subject = analyzeSkillVersion(ports, skillId, versionId);
  const baseline = analyzeSkillVersion(ports, skillId, baselineVersionId);
  requireDiffable(baseline, subject);
  return diffSecurityReports(baseline, subject);
}

/**
 * The HTTP face of the shared differ's four refusals — asked here so an unmeaningful comparison is a
 * **400 naming what is wrong**, never a 500, and never a plausible-looking diff.
 *
 * The questions are asked in the differ's own order (kind → owner → version → truncation), so the two
 * can never disagree about which problem a bad pairing has. Everything after this call is guarded
 * twice on purpose: the throws in `diffSecurityReports` are the backstop for a future caller that
 * forgets to come through here.
 */
function requireDiffable(baseline: SecurityReport, subject: SecurityReport): void {
  if (baseline.subject.kind !== subject.subject.kind) {
    throw httpError(
      400,
      `Cannot diff security posture: the baseline is a "${baseline.subject.kind}" report and the subject a "${subject.subject.kind}" report. ` +
        "A posture diff compares two scans of one server, or two versions of one skill.",
    );
  }
  if (baseline.subject.ownerId !== subject.subject.ownerId) {
    throw httpError(
      400,
      `Cannot diff security posture: baseline ${baseline.subject.id} belongs to "${baseline.subject.name}" (${baseline.subject.ownerId}), ` +
        `not to the subject's "${subject.subject.name}" (${subject.subject.ownerId}). ` +
        "A posture diff compares two scans of ONE server, or two versions of ONE skill.",
    );
  }
  if (baseline.analyzerVersion !== subject.analyzerVersion) {
    // Unreachable while both sides are analysed by one running build, which is exactly why it is
    // here: the day a report is persisted, cached or fetched from another instance, a silently
    // cross-version diff would be the wrong answer nobody could see. Same guard, same words, as the
    // CI gate's D-C22 refusal.
    throw httpError(
      400,
      `Cannot diff security posture: baseline ${baseline.subject.id} was analysed by security analyzer version ${baseline.analyzerVersion}, ` +
        `and subject ${subject.subject.id} by version ${subject.analyzerVersion}. ` +
        "Findings produced under different analyzer versions are not on the same scale, so a rule's meaning may have changed underneath the comparison.",
    );
  }
  const truncated = [
    ...(baseline.truncated ? [`baseline ${baseline.subject.id}`] : []),
    ...(subject.truncated ? [`subject ${subject.subject.id}`] : []),
  ];
  if (truncated.length > 0) {
    throw httpError(
      400,
      `Cannot diff security posture: ${truncated.join(" and ")} produced more than ${SECURITY_FINDING_LIMIT} findings, ` +
        `so the report lists only the first ${SECURITY_FINDING_LIMIT} of them ` +
        `(baseline ${baseline.counts.total}, subject ${subject.counts.total} in total). ` +
        'Diffing a truncated list would answer "what changed among the ones we listed", which is not a verdict. ' +
        "Fix the findings the reports do list, then diff again.",
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// WP 2.1 — the FLEET summary (D-SP22)
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// The servers list wants one posture chip per row. The naive way to get it is one
// `GET /api/scans/:scanId/security` per row, which turns a fleet of forty servers into forty
// requests every time the rail paints. So there is ONE endpoint for the whole list, and it answers
// with the band + score + counts each row needs — never the findings, which are a drill-in.
//
// It re-projects {@link analyzeScan} rather than reading the scan rows a second way (D-MCP4), so the
// chip in the list and the tab it drills into can never disagree about one server's posture. And it
// persists nothing, exactly like every other posture answer (D-SP8).

/**
 * {@link SecurityAnalyzerPorts} plus the ONE extra read the fleet summary needs: a server's scan
 * history, so it can find the latest **`success`** scan rather than assuming the newest scan is one.
 *
 * It is a separate type rather than a widened `SecurityAnalyzerPorts` on purpose. WP 1.2's
 * `apps/api/test/security-analyzer.test.ts` builds its ports as a hand-written `{ scans, servers,
 * oauth }` and is D-SP14's proof that WP 1.3's extraction preserved WP 1.2's behaviour — it has to
 * stay byte-identical, so a required member could not be added to the type it constructs.
 *
 * `listSummariesByServer` is an EXISTING `ScanRepository` method (`GET /api/servers/:id` already
 * serves it); this WP adds no repository, no query and no migration.
 */
export type SecurityFleetPorts = SecurityAnalyzerPorts & {
  scans: SecurityAnalyzerPorts["scans"] & {
    /** Newest `scannedAt` first — the repository's own order, which is what "latest" here means. */
    listSummariesByServer: (serverId: string) => ScanSummary[];
  };
};

/**
 * Every server that HAS a posture, with the posture of its latest `success` scan.
 *
 * A server whose scan history holds no `success` scan — never scanned, only ever failed, currently
 * running its first — is **omitted**, not zero-scored and not carried as a neutral 100. It has no
 * posture, and inventing one would be the same confidently-wrong answer D-SP10 refuses for a
 * non-`success` scan; the list renders the absence with the "not scanned" treatment it already has
 * for a server with no token total.
 *
 * The order is `servers.list()`'s own, and the whole answer is a pure function of immutable rows, so
 * two calls a millisecond apart return byte-identical JSON (D-SP6).
 */
export function summarizeFleetPosture(ports: SecurityFleetPorts): SecurityFleetSummary[] {
  const summaries: SecurityFleetSummary[] = [];
  for (const server of ports.servers.list()) {
    const latestSuccess = ports.scans
      .listSummariesByServer(server.id)
      .find((scan) => scan.status === USABLE_STATUS);
    if (latestSuccess === undefined) continue;

    // Straight through the report, so the name, the captured instant, the score and the counts are
    // the report's own values rather than a second derivation off the summary row.
    const report = analyzeScan(ports, latestSuccess.id);
    summaries.push({
      serverId: server.id,
      serverName: report.subject.name,
      scanId: report.subject.id,
      scannedAt: report.subject.capturedAt,
      score: report.score,
      counts: report.counts,
    });
  }
  return summaries;
}
