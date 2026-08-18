import type { AdvisorRecommendation, AdvisorReport } from "@mcp-token-footprint/shared";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const getAdvisorReport = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, getAdvisorReport: (...args: unknown[]) => getAdvisorReport(...args) };
});

import { AdvisorPanel } from "./AdvisorPanel";

const recommendation: AdvisorRecommendation = {
  id: "advisor.description-bloat:srv_1",
  ruleId: "advisor.description-bloat",
  title: "3 descriptions are 41% of GitHub's footprint",
  detail: "The three largest tools spend most of their definition on prose.",
  severity: "medium",
  savings: {
    value: 4100,
    unit: "tokens",
    estimate: true,
    basis: "the flagged descriptions' tokens in scan sc_1 — a ceiling, not a promise",
  },
  evidence: [{ kind: "scan", id: "sc_1", label: "GitHub · scan 2026-08-01T10:00:00.000Z" }],
  assumptions: [],
};

const report = (over: Partial<AdvisorReport> = {}): AdvisorReport => ({
  advisorVersion: 1,
  generatedAt: "2026-08-18T09:00:00.000Z",
  scope: { kind: "server", id: "srv_1" },
  recommendations: [],
  insufficientData: [],
  ...over,
});

function renderPanel(props?: { fullReportHref?: string }) {
  return render(
    <MemoryRouter>
      <AdvisorPanel
        query={{ scope: "server", id: "srv_1" }}
        scopeLabel="GitHub"
        fullReportHref={props?.fullReportHref}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AdvisorPanel — the four states stay distinct", () => {
  it("renders a layout-shaped placeholder (not a spinner) before the first byte", () => {
    getAdvisorReport.mockReturnValue(new Promise(() => {}));
    const { container } = renderPanel();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it("surfaces a settled failure as a retryable error — NEVER as 'no advice'", async () => {
    getAdvisorReport.mockRejectedValue(new Error("advisor unavailable"));
    renderPanel();
    expect(await screen.findByText("Couldn’t load advisor recommendations")).toBeTruthy();
    expect(screen.getByText("advisor unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("No recommendations")).toBeNull();
  });

  it("renders the recommendations plus the report's provenance", async () => {
    getAdvisorReport.mockResolvedValue(report({ recommendations: [recommendation] }));
    renderPanel();
    expect(await screen.findByText(recommendation.title)).toBeTruthy();
    expect(screen.getByText("1 recommendation")).toBeTruthy();
    // The advisor version is stated: reports from different versions are never silently compared.
    expect(screen.getByText(/Advisor v1 · generated/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Advisor recommendations for GitHub" })).toBeTruthy();
  });
});

describe("AdvisorPanel — 'not enough data' is honest, never an empty list passed off as fine", () => {
  it("renders an EmptyState NAMING what is missing when only gaps came back", async () => {
    getAdvisorReport.mockResolvedValue(
      report({
        insufficientData: [
          {
            ruleId: "advisor.unused-tool-trim",
            reason: "no completed runs recorded for this environment yet",
          },
          {
            ruleId: "advisor.description-bloat",
            reason: "the server has no successful scan to read a footprint from",
          },
        ],
      }),
    );
    renderPanel();

    expect(await screen.findByText("Not enough data yet")).toBeTruthy();
    // The API's own reasons are printed verbatim — the UI never paraphrases or invents a gap.
    expect(screen.getByText("no completed runs recorded for this environment yet")).toBeTruthy();
    expect(
      screen.getByText("the server has no successful scan to read a footprint from"),
    ).toBeTruthy();
    // …attributed to the rule that reported it.
    expect(screen.getByText("Unused tool trim")).toBeTruthy();
    expect(screen.getByText("Description bloat")).toBeTruthy();
    expect(screen.getByText("2 data gaps")).toBeTruthy();
    // Crucially: this is NOT dressed up as a clean bill of health.
    expect(screen.queryByText("No recommendations")).toBeNull();
  });

  it("says 'no rule matched' — not 'all good' — when the report is genuinely empty", async () => {
    getAdvisorReport.mockResolvedValue(report());
    renderPanel();

    expect(await screen.findByText("No recommendations")).toBeTruthy();
    expect(
      screen.getByText(/none of them matched.*not that nothing could be improved/),
    ).toBeTruthy();
    expect(screen.getByText("0 recommendations")).toBeTruthy();
  });

  it("still shows the gaps BELOW the cards when a report is only partially blind", async () => {
    getAdvisorReport.mockResolvedValue(
      report({
        recommendations: [recommendation],
        insufficientData: [
          { ruleId: "advisor.loading-mode", reason: "only one tool-loading mode has been run" },
        ],
      }),
    );
    renderPanel();

    expect(await screen.findByText(recommendation.title)).toBeTruthy();
    expect(screen.getByText("Not enough data")).toBeTruthy();
    expect(screen.getByText("only one tool-loading mode has been run")).toBeTruthy();
  });
});

describe("AdvisorPanel — the inline-panel affordances", () => {
  it("links out to the full report when the host passes a href", async () => {
    getAdvisorReport.mockResolvedValue(report({ recommendations: [recommendation] }));
    renderPanel({ fullReportHref: "/advisor?scope=server&id=srv_1" });
    const link = await screen.findByRole("link", { name: "Open full report" });
    expect(link.getAttribute("href")).toBe("/advisor?scope=server&id=srv_1");
  });

  it("asks the API for exactly the scope it was given", async () => {
    getAdvisorReport.mockResolvedValue(report());
    renderPanel();
    await screen.findByText("No recommendations");
    expect(getAdvisorReport).toHaveBeenCalledWith({ scope: "server", id: "srv_1" });
  });
});
