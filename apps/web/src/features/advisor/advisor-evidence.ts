import type { AdvisorEvidenceKind, AdvisorEvidenceRef } from "@mcp-token-footprint/shared";

// ==================================================================================================
// Advisor WP 1.3 — evidence-ref → real in-app destination
// ==================================================================================================
// README invariant 1: "the app never auto-applies a recommendation. Each card links the scans/runs/
// grades it came from." That promise is only kept if a link actually LANDS somewhere — so the
// mapping from the wire's `AdvisorEvidenceRef` to a route lives here, as a pure function, and is
// unit-tested against every `ADVISOR_EVIDENCE_KINDS` member.
//
// The rule for a kind with no destination is to return `null`, NOT to invent one: a ref that cannot
// be resolved renders as plain labelled text rather than a link that quietly goes to the wrong page.

/** A tool-scan ref's id is `<scanId>:<toolName>` (see `apps/api/src/advisor/evidence.ts`). Split on
 *  the FIRST colon only — scan ids never contain one, but a tool name might. */
export function splitToolScanId(id: string): { scanId: string; toolName: string } | null {
  const separator = id.indexOf(":");
  if (separator <= 0) return null;
  const scanId = id.slice(0, separator);
  const toolName = id.slice(separator + 1);
  if (!scanId || !toolName) return null;
  return { scanId, toolName };
}

/**
 * The route an evidence ref drills into, or `null` when this app has no place to send the operator.
 *
 * - `server`    → the server detail page.
 * - `scan`      → the scan detail page.
 * - `tool_scan` → the scan detail page with the tool PRESELECTED (`?tool=` — `ScansView` opens the
 *                 tool sheet for a matching name), so a tool citation resolves to the real tool.
 * - `run`       → the run console.
 * - `skill`     → the skill inspector.
 * - `scenario`  → the Environments list. Environments hold their selection in React state rather
 *                 than the URL (there is no `/testing/environments/:id` route today — see the
 *                 `ASSISTANT_ROUTE_MANIFEST` entry's exemption), so the list IS the honest
 *                 destination; the link label names the environment.
 */
export function advisorEvidenceHref(ref: AdvisorEvidenceRef): string | null {
  switch (ref.kind) {
    case "server":
      return `/servers/${encodeURIComponent(ref.id)}`;
    case "scan":
      return `/scans/${encodeURIComponent(ref.id)}`;
    case "tool_scan": {
      const parts = splitToolScanId(ref.id);
      if (!parts) return null;
      return `/scans/${encodeURIComponent(parts.scanId)}?tool=${encodeURIComponent(parts.toolName)}`;
    }
    case "run":
      return `/testing/runs/${encodeURIComponent(ref.id)}`;
    case "skill":
      return `/skills/${encodeURIComponent(ref.id)}`;
    case "scenario":
      return "/testing/environments";
    default:
      return null;
  }
}

/** Human label for an evidence kind — the chip that says WHAT the operator is about to open. */
export const ADVISOR_EVIDENCE_KIND_LABELS: Record<AdvisorEvidenceKind, string> = {
  scan: "Scan",
  tool_scan: "Tool",
  run: "Run",
  scenario: "Environment",
  server: "Server",
  skill: "Skill",
};

export function advisorEvidenceKindLabel(kind: AdvisorEvidenceKind): string {
  return ADVISOR_EVIDENCE_KIND_LABELS[kind] ?? kind;
}
