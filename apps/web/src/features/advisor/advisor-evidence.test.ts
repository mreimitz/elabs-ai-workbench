import { ADVISOR_EVIDENCE_KINDS, type AdvisorEvidenceRef } from "@mcp-token-footprint/shared";
import { describe, expect, it } from "vitest";
import {
  ADVISOR_EVIDENCE_KIND_LABELS,
  advisorEvidenceHref,
  advisorEvidenceKindLabel,
  splitToolScanId,
} from "./advisor-evidence";

// Advisor WP 1.3 — "evidence links resolve to the real scan / run / tool" is the acceptance
// criterion this file locks. The mapping is pure, so it is tested here rather than only through a
// rendered card.

const ref = (kind: AdvisorEvidenceRef["kind"], id: string): AdvisorEvidenceRef => ({
  kind,
  id,
  label: `${kind} label`,
});

describe("advisorEvidenceHref — every wire evidence kind lands somewhere real", () => {
  it("covers EVERY ADVISOR_EVIDENCE_KINDS member (a new kind can't ship link-less)", () => {
    for (const kind of ADVISOR_EVIDENCE_KINDS) {
      const href = advisorEvidenceHref(
        ref(kind, kind === "tool_scan" ? "sc_1:create_issue" : "id_1"),
      );
      expect(href, `evidence kind "${kind}" has no destination`).toBeTruthy();
    }
  });

  it("maps each kind to its route", () => {
    expect(advisorEvidenceHref(ref("server", "srv_1"))).toBe("/servers/srv_1");
    expect(advisorEvidenceHref(ref("scan", "sc_1"))).toBe("/scans/sc_1");
    expect(advisorEvidenceHref(ref("run", "run_1"))).toBe("/testing/runs/run_1");
    expect(advisorEvidenceHref(ref("skill", "sk_1"))).toBe("/skills/sk_1");
    // Environments have no per-entity route (selection lives in React state) — the list is the
    // honest destination, and the ref's own label names which environment.
    expect(advisorEvidenceHref(ref("scenario", "env_1"))).toBe("/testing/environments");
  });

  it("resolves a tool_scan ref to the SCAN plus the tool (?tool=), not merely the scan", () => {
    expect(advisorEvidenceHref(ref("tool_scan", "sc_1:create_issue"))).toBe(
      "/scans/sc_1?tool=create_issue",
    );
  });

  it("url-encodes ids and tool names rather than splicing them raw into the path", () => {
    expect(advisorEvidenceHref(ref("tool_scan", "sc_1:search files"))).toBe(
      "/scans/sc_1?tool=search%20files",
    );
    expect(advisorEvidenceHref(ref("server", "a/b"))).toBe("/servers/a%2Fb");
  });

  it("returns null for a malformed tool_scan id instead of a link that goes nowhere", () => {
    expect(advisorEvidenceHref(ref("tool_scan", "no-separator"))).toBeNull();
    expect(advisorEvidenceHref(ref("tool_scan", ":create_issue"))).toBeNull();
    expect(advisorEvidenceHref(ref("tool_scan", "sc_1:"))).toBeNull();
  });
});

describe("splitToolScanId", () => {
  it("splits on the FIRST colon so a tool name may contain one", () => {
    expect(splitToolScanId("sc_1:ns:create")).toEqual({ scanId: "sc_1", toolName: "ns:create" });
  });
});

describe("advisorEvidenceKindLabel", () => {
  it("labels every kind, and calls a scenario an Environment (the UI label)", () => {
    for (const kind of ADVISOR_EVIDENCE_KINDS) {
      expect(ADVISOR_EVIDENCE_KIND_LABELS[kind]).toBeTruthy();
    }
    expect(advisorEvidenceKindLabel("scenario")).toBe("Environment");
    expect(advisorEvidenceKindLabel("tool_scan")).toBe("Tool");
  });
});
