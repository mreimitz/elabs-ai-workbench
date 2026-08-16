import { describe, expect, test } from "vitest";
import { OPEN_FLEET_ISSUE, REGRESSED_FLEET_ISSUE } from "./issue-fixtures";
import { ISSUE_TRIAGE_STARTER_LABEL, buildIssueTriagePrompt } from "./issue-triage-prompt";

// Observability WP5.4 acceptance #1 — the "Triage this issue" STARTER + its documented context envelope
// (delivered as a prefilled prompt, SHARED-FREE). Pure fixture asserts: everything the API brief asks the
// envelope to carry is present, and the loop plan names the tools it must drive.

describe("buildIssueTriagePrompt — the documented issue context envelope + starter", () => {
  test("carries the issue identity, cluster, fix targets, drafted fix, affected + top linked runs", () => {
    const prompt = buildIssueTriagePrompt(OPEN_FLEET_ISSUE);

    // Envelope block delimiters + identity.
    expect(prompt).toContain("<issue-context>");
    expect(prompt).toContain("</issue-context>");
    expect(prompt).toContain(`Issue id: ${OPEN_FLEET_ISSUE.id}`);
    expect(prompt).toContain(OPEN_FLEET_ISSUE.title);
    expect(prompt).toContain(OPEN_FLEET_ISSUE.targetName);
    expect(prompt).toContain(OPEN_FLEET_ISSUE.targetId);

    // Cluster identity + lifecycle/severity.
    expect(prompt).toContain(OPEN_FLEET_ISSUE.fleet.clusterKey);
    expect(prompt).toContain(OPEN_FLEET_ISSUE.fleet.lifecycle);
    expect(prompt).toContain(OPEN_FLEET_ISSUE.severity);

    // Forensics fix target + drafted fix + summary.
    expect(prompt).toContain(OPEN_FLEET_ISSUE.fixTarget);
    expect(prompt).toContain(OPEN_FLEET_ISSUE.draftFix);
    expect(prompt).toContain(OPEN_FLEET_ISSUE.summary);

    // Affected entities (server id from the fleet block).
    expect(prompt).toContain(OPEN_FLEET_ISSUE.fleet.affected.servers[0] as string);

    // The top linked-run ids (both occurrences here).
    expect(prompt).toContain("run-1");
    expect(prompt).toContain("run-2");
  });

  test("names each loop tool the assistant must drive (draft fix → regression test → prove → resolve)", () => {
    const prompt = buildIssueTriagePrompt(OPEN_FLEET_ISSUE);
    expect(prompt).toContain("issues_get");
    expect(prompt).toContain("issues_linked_runs");
    expect(prompt).toContain("tests_create_draft");
    expect(prompt).toContain("runs_rerun");
    expect(prompt).toContain("issues_update");
    // It is explicit that everything is approval-gated (nothing auto-runs).
    expect(prompt).toMatch(/approval-gated/i);
  });

  test("a skill-targeted issue includes its first-seen skill version (pin candidate for the fork)", () => {
    const prompt = buildIssueTriagePrompt({
      ...REGRESSED_FLEET_ISSUE,
      skillVersionId: "skv-9",
    });
    expect(prompt).toContain("skv-9");
    expect(prompt).toContain("skill workspace");
  });

  test("the starter label is stable", () => {
    expect(ISSUE_TRIAGE_STARTER_LABEL).toBe("Triage this issue");
  });
});
