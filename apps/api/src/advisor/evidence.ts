// Evidence-ref builders (WP 1.1). Every `AdvisorEvidenceRef` is constructed through one of these,
// so a rule cannot hand-roll a ref with the wrong `kind`, a blank label, or an id it never actually
// read. A recommendation's evidence is the operator's drill-through path — if it is malformed, the
// suggestion is unverifiable, which the README's first invariant forbids.

import type {
  AdvisorEvidenceKind,
  AdvisorEvidenceRef,
  RunSummary,
  ScanSummary,
  Scenario,
  ServerConfig,
} from "@mcp-token-footprint/shared";

/** Rejects blanks at construction time rather than letting an unusable link reach the UI. */
function ref(kind: AdvisorEvidenceKind, id: string, label: string): AdvisorEvidenceRef {
  const trimmedId = id.trim();
  const trimmedLabel = label.trim();
  if (!trimmedId) throw new Error(`Advisor evidence ref (${kind}) needs a non-empty id`);
  if (!trimmedLabel) throw new Error(`Advisor evidence ref (${kind}) needs a non-empty label`);
  return { kind, id: trimmedId, label: trimmedLabel };
}

export function serverEvidence(server: Pick<ServerConfig, "id" | "name">): AdvisorEvidenceRef {
  return ref("server", server.id, server.name);
}

export function scanEvidence(
  scan: Pick<ScanSummary, "id" | "serverName" | "scannedAt">,
): AdvisorEvidenceRef {
  return ref("scan", scan.id, `${scan.serverName} · scan ${scan.scannedAt}`);
}

/** A tool inside a scan. `mcp_tool_scans` rows have no stable public id of their own, so the ref is
 *  keyed by `<scanId>:<toolName>` — stable for the same scan, and enough for the UI to open the
 *  scan and highlight the tool. */
export function toolScanEvidence(scanId: string, toolName: string): AdvisorEvidenceRef {
  return ref("tool_scan", `${scanId.trim()}:${toolName.trim()}`, toolName);
}

export function runEvidence(run: Pick<RunSummary, "id" | "startedAt">): AdvisorEvidenceRef {
  return ref("run", run.id, `run ${run.startedAt}`);
}

export function scenarioEvidence(scenario: Pick<Scenario, "id" | "name">): AdvisorEvidenceRef {
  return ref("scenario", scenario.id, scenario.name);
}

export function skillEvidence(skillId: string, skillName: string): AdvisorEvidenceRef {
  return ref("skill", skillId, skillName);
}
