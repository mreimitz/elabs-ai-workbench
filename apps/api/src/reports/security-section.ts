// The posture section an EXPORTED document carries (planning/Roadmap/RM-20-security-posture/, WP 2.2).
//
// An exported report is what leaves the app: pasted into a PR, mailed to a vendor, attached to a
// review. Until this file existed it carried the token footprint and nothing about security posture.
//
// There is exactly ONE derivation of that section, in both shapes — the JSON object and the Markdown
// string — and every export calls it. That is the D-SP17 discipline ("one differ, and the CI gate
// re-projects it") applied to rendering: two renderers of the same section is how a scan export and a
// server export end up disagreeing in front of a reviewer with no way to tell which one is lying.
//
//   • **D-SP24 — a subject that cannot be scored says so IN the document.** It never fails the export
//     and it never renders as clean. `analyzeScan` refuses a non-`success` scan with a 400 (D-SP10)
//     and `analyzeSkillVersion` refuses an unreadable SKILL.md the same way (D-SP16); a refusal that
//     propagated out of here would make the TOKEN FOOTPRINT unobtainable for exactly the broken
//     servers an operator most wants to document, and a section that silently vanished would read as
//     "nothing found". So a refusal becomes an `unavailable` section carrying the refusal's own
//     sentence, and the Markdown prints one honest line naming why.
//   • **D-SP25 — the Markdown section is a FIXED, greppable shape.** One `## Security posture`
//     heading, a score line naming the analyzer version, a per-severity count line, then the findings
//     table and the evidence beneath it. Fixed because these documents get diffed and grepped by
//     people and by CI; a section whose shape moves with its content is a section nobody can automate
//     against. `renderAssertionMarkdown` in the CI workstream is the precedent.
//   • **D-SP3/D-SP6 — nothing here re-scores, re-sorts, re-bands or re-counts.** The score, the band,
//     the finding order and the counts are read off the report exactly as the analyzer produced them.
//     In particular the count line is read off `counts` and **never** off `findings.length`: `counts`
//     describes ALL findings, including any `capSecurityFindings` dropped, so a document that tallied
//     the list it printed would under-report a truncated report. And when a report IS truncated the
//     section says so — otherwise the table reads as the whole story, and the document lies.
//   • **D-SP4 — evidence is already redacted.** It is printed exactly as `redactSecurityEvidence`
//     produced it: invisible characters as `\uXXXX`, credential-shaped runs as «redacted». This file
//     does not un-escape it, does not re-escape it, and never widens what is exported.
//
// This module deliberately imports from `@mcp-token-footprint/shared` and NOTHING ELSE. `reports.ts`
// imports the renderer from here, so an import in the other direction would be a value-level cycle;
// the two small helpers below (`cell`, `fence`) exist for that reason rather than because
// `reports.ts`'s `escapeText` / `pushFenced` were unsuitable.

import type {
  SecurityFindingAnchor,
  SecurityPostureSection,
  SecurityReport,
} from "@mcp-token-footprint/shared";
import { SECURITY_FINDING_LIMIT } from "@mcp-token-footprint/shared";

/**
 * The ONE port an export needs to reach the analyzer — injected, never imported, exactly as the CI
 * assertions engine takes `security.analyze` (D-MCP4/D-SP7: re-project, don't reimplement). A plain
 * function, so a test hands it a fixture report or a throw instead of a database and an OAuth store.
 */
export type ReportSecurityPorts = {
  analyze: (scanId: string) => SecurityReport;
};

/**
 * Run the analyzer and turn whatever comes back — a report, or a refusal — into the section shape.
 *
 * The catch is D-SP24, and it is the whole point of this function. A refusal the analyzer authored
 * (a 4xx: "this scan is not `success`", "this SKILL.md cannot be read as text") is an operator-facing
 * sentence naming exactly what to fix, so it is quoted verbatim. Anything else is a defect in this
 * build, and its message is deliberately NOT quoted: an unexpected error can carry a stack, a local
 * path or a payload, and `.claude/rules/mcp-and-security.md` is clear that an exported document never
 * widens what leaves the app. Either way the export succeeds and the section is honest about being
 * unmeasured rather than clean.
 */
export function buildSecuritySection(analyze: () => SecurityReport): SecurityPostureSection {
  try {
    return { status: "analyzed", report: analyze() };
  } catch (error) {
    return { status: "unavailable", reason: refusalReason(error) };
  }
}

/** {@link buildSecuritySection} bound to one scan — what both scan-shaped exports call. */
export function securitySectionForScan(
  ports: ReportSecurityPorts,
  scanId: string,
): SecurityPostureSection {
  return buildSecuritySection(() => ports.analyze(scanId));
}

function refusalReason(error: unknown): string {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500 && error instanceof Error) {
    return oneLine(error.message);
  }
  return "the security analyzer failed unexpectedly while this document was produced.";
}

/**
 * The Markdown section — the ONE renderer (D-SP25). Returns the lines to splice into a document, or
 * an EMPTY array when no section was supplied at all.
 *
 * "No section was supplied" is a genuinely different thing from "the subject could not be scored",
 * and it means exactly one thing here: the caller never asked for posture. The workbench's own MCP
 * report resources and `pnpm mcp:self-scan` call the scan builders with no analyzer, and printing
 * "not analysed" for them would be a lie about a question nobody asked — as well as a silent change
 * to documents those two surfaces already publish. Every HTTP export route supplies the port, so an
 * exported report always carries the section.
 *
 * Three states, each opening with its own greppable token, and each ending in a blank line so the
 * caller can splice the section anywhere in a document:
 *
 *   `Score: `        — the subject was analysed; then the count line, then the findings table.
 *   `No findings`    — analysed and clean (D-SP23: a clean subject gets a real answer, never an empty
 *                      table, which is indistinguishable from a broken one).
 *   `Not analysed: ` — the subject could not be scored, and the line says why (D-SP24).
 */
export function renderSecuritySection(section: SecurityPostureSection | undefined): string[] {
  if (section === undefined) return [];
  const lines = ["## Security posture", ""];
  if (section.status === "unavailable") {
    lines.push(
      `Not analysed: ${section.reason} This document reports no security posture — unmeasured, not clean.`,
      "",
    );
    return lines;
  }

  const { report } = section;
  const { counts, score } = report;
  lines.push(
    // RM-38 D-DP8 — the pack version is appended to the EXISTING score line rather than given a
    // line of its own, so D-SP25's fixed, greppable shape is unchanged: same heading, same score
    // line, same count line, same table. The version is read off the report; this renderer reaches
    // for no pack (it takes a payload and nothing else — see the header).
    `Score: ${score.value}/100 (${score.band}) · security analyzer version ${report.analyzerVersion}${
      report.dataPackVersion === undefined
        ? ""
        : ` · reference data pack ${cell(report.dataPackVersion)}`
    } · subject ${cell(report.subject.id)} · analysed ${cell(report.generatedAt)}`,
    "",
    `Findings: ${counts.total} total · ${counts.error} error · ${counts.warning} warning · ${counts.info} info`,
    "",
  );

  // Read off `counts`, never off the list: an empty LIST with a non-zero tally is a truncated report,
  // not a clean one, and this branch must not be the thing that hides it.
  if (counts.total === 0) {
    lines.push("No findings — the security analyzer matched no rule against this subject.", "");
    return lines;
  }

  lines.push("| Severity | Rule | Anchor | Message |", "|---|---|---|---|");
  for (const finding of report.findings) {
    lines.push(
      `| ${finding.severity} | \`${cell(finding.ruleId)}\` | ${anchorCell(finding.anchor)} | ${cell(finding.message)} |`,
    );
  }
  lines.push("");

  if (report.truncated) {
    lines.push(
      `Listing the first ${SECURITY_FINDING_LIMIT} findings of ${counts.total} — the counts above describe all of them.`,
      "",
    );
  }

  for (const finding of report.findings) {
    if (finding.evidence === undefined) continue;
    lines.push(
      `**Evidence · \`${cell(finding.ruleId)}\` · ${anchorCell(finding.anchor)}**${finding.evidence.truncated ? " (truncated)" : ""}`,
      "",
    );
    // Printed EXACTLY as the redactor produced it (D-SP4) — fenced so an excerpt full of Markdown
    // cannot restyle the document, with a fence long enough that the excerpt cannot close it early.
    fence(lines, finding.evidence.excerpt);
    lines.push("");
  }

  return lines;
}

/** Newlines collapsed (they would break a single-line construct) and pipes escaped (table cells). */
function cell(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").replaceAll("|", "\\|");
}

/** One line, for a refusal sentence spliced into prose. */
function oneLine(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}

/**
 * WHERE the finding lives, in the anchor union's own vocabulary — never a re-labelling of it. A
 * `skill` anchor says *skill version*, because D-SP12 added that kind precisely so a skill finding
 * would stop printing the word "server" in every UI, every export and every CI comment.
 */
function anchorCell(anchor: SecurityFindingAnchor): string {
  switch (anchor.kind) {
    case "server":
      return "this server";
    case "skill":
      return "this skill version";
    case "tool":
      return `tool \`${cell(anchor.toolName)}\``;
    case "parameter":
      return `tool \`${cell(anchor.toolName)}\` → \`${cell(anchor.parameterPath)}\``;
    case "file":
      return `file \`${cell(anchor.path)}\``;
    default: {
      const exhaustive: never = anchor;
      return exhaustive;
    }
  }
}

/** A fenced block whose fence is longer than any backtick run in the body (never closes early). */
function fence(lines: string[], body: string): void {
  const longest = (body.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  lines.push(ticks, body, ticks);
}
