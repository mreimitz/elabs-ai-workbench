import type { AdvisorRecommendation } from "@mcp-token-footprint/shared";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RecommendationCard } from "./RecommendationCard";

// Advisor WP 1.3 acceptance — "cards show severity, estimated savings LABELED AS ESTIMATES,
// assumptions, and evidence links that resolve to the real scan / run / tool."

const recommendation: AdvisorRecommendation = {
  id: "advisor.unused-tool-trim:env_1",
  ruleId: "advisor.unused-tool-trim",
  title: "Trim 12 never-called tools from Nightly regression",
  detail: "Across the last 20 completed runs, 12 of the 31 allowed tools were never called.",
  severity: "high",
  savings: {
    value: 9240,
    unit: "tokens_per_turn",
    estimate: true,
    basis: "sum of the 12 never-called tools' definition tokens in scan sc_1",
  },
  evidence: [
    { kind: "scenario", id: "env_1", label: "Nightly regression" },
    { kind: "scan", id: "sc_1", label: "GitHub · scan 2026-08-01T10:00:00.000Z" },
    { kind: "tool_scan", id: "sc_1:create_issue", label: "create_issue" },
    { kind: "run", id: "run_1", label: "run 2026-08-02T10:00:00.000Z" },
    { kind: "server", id: "srv_1", label: "GitHub" },
    { kind: "skill", id: "sk_1", label: "Release notes" },
  ],
  assumptions: ["the last 20 runs are representative of normal use"],
};

function renderCard(over: Partial<AdvisorRecommendation> = {}) {
  return render(
    <MemoryRouter>
      <RecommendationCard recommendation={{ ...recommendation, ...over }} />
    </MemoryRouter>,
  );
}

describe("RecommendationCard", () => {
  it("leads with the severity as TEXT (not colour alone) plus the rule that produced it", () => {
    renderCard();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Unused tool trim")).toBeTruthy();
  });

  it("renders the title and the detail", () => {
    renderCard();
    expect(screen.getByText(recommendation.title)).toBeTruthy();
    expect(screen.getByText(recommendation.detail)).toBeTruthy();
  });

  it("labels the savings figure as an ESTIMATE and prints the basis that reproduces it", () => {
    renderCard();
    // The word is in the sentence itself, so the number can never be read as a measurement…
    expect(screen.getByText("Estimated saving ≈ 9,240 tokens/turn")).toBeTruthy();
    // …and again as a chip beside the "Estimated saving" heading.
    expect(screen.getByText("Estimate")).toBeTruthy();
    expect(
      screen.getByText(
        "How it was estimated: sum of the 12 never-called tools' definition tokens in scan sc_1",
      ),
    ).toBeTruthy();
  });

  it("omits the estimate block entirely when the rule named no defensible number", () => {
    renderCard({ savings: undefined });
    expect(screen.queryByText("Estimate")).toBeNull();
    expect(screen.queryByText(/Estimated saving/)).toBeNull();
  });

  it("states the assumptions the suggestion rests on", () => {
    renderCard();
    expect(screen.getByText("Assumptions")).toBeTruthy();
    expect(screen.getByText("the last 20 runs are representative of normal use")).toBeTruthy();
  });

  it("renders every evidence ref as a link that resolves to the real entity", () => {
    renderCard();
    const hrefFor = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");

    expect(hrefFor(/^Scan: GitHub/)).toBe("/scans/sc_1");
    // A tool citation lands on the TOOL, not merely on the scan that contains it.
    expect(hrefFor(/^Tool: create_issue/)).toBe("/scans/sc_1?tool=create_issue");
    expect(hrefFor(/^Run: run 2026-08-02/)).toBe("/testing/runs/run_1");
    expect(hrefFor(/^Server: GitHub$/)).toBe("/servers/srv_1");
    expect(hrefFor(/^Skill: Release notes/)).toBe("/skills/sk_1");
    expect(hrefFor(/^Environment: Nightly regression/)).toBe("/testing/environments");
  });

  it("groups the evidence under an accessible list naming the recommendation", () => {
    renderCard();
    const list = screen.getByRole("list", { name: `Evidence for ${recommendation.title}` });
    expect(list.querySelectorAll("li")).toHaveLength(recommendation.evidence.length);
  });

  it("degrades an unresolvable ref to plain labelled text rather than a dead link", () => {
    renderCard({
      evidence: [{ kind: "tool_scan", id: "malformed-no-colon", label: "create_issue" }],
    });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Tool: create_issue")).toBeTruthy();
  });

  it("offers no way to APPLY the advice — the app never auto-applies a recommendation", () => {
    renderCard();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
