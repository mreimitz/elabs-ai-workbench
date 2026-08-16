import type { ReactNode } from "react";
import type { DigestReport } from "@mcp-token-footprint/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Observability WP5.5 (D-OB22) — the routed digest view: fetches the structured JSON (KPI header)
// + the Markdown twin (rendered inline via the shared ChatMarkdown), reusing the "existing report
// render path" per the WP spec. `@brand/ai`'s Streamdown (`MessageResponse`) can't load in jsdom
// (mirrors ChatMarkdown.test.tsx's own mock) — mocked to a passthrough that exposes the raw markdown
// text so this test can assert on it without exercising the real markdown engine.
vi.mock("@brand/ai", () => ({
  MessageResponse: ({ children }: { children?: ReactNode }) => (
    <div data-testid="markdown-body">{children}</div>
  ),
}));

vi.mock("../../lib/api", () => ({
  getDigestReport: vi.fn(),
  getDigestMarkdown: vi.fn(),
}));

import * as api from "../../lib/api";
import { DigestReportView } from "./DigestReportView";

const REPORT: DigestReport = {
  id: "d1",
  windowKind: "daily",
  windowFrom: "2026-07-02T00:00:00.000Z",
  windowTo: "2026-07-03T00:00:00.000Z",
  prevWindowFrom: "2026-07-01T00:00:00.000Z",
  prevWindowTo: "2026-07-02T00:00:00.000Z",
  generatedAt: "2026-07-03T08:00:00.000Z",
  late: false,
  headline: {
    runs: { current: 4, previous: 2, delta: 2 },
    errorRate: { current: 0.25, previous: 0.5, delta: -0.25 },
    costByBasis: { api_exact: { current: 8.3, previous: 1.5, delta: 6.8 } },
  },
  newIssues: [
    {
      id: "issue-1",
      title: "A new issue",
      severity: "medium",
      targetKind: "mcp_server",
      targetName: "Server One",
      linkPath: "/testing/observability/issues/issue-1",
    },
  ],
  regressedIssues: [],
  resolvedIssues: [],
  movers: [
    {
      dimension: "server",
      key: "srv-1",
      label: "Server One",
      errorRate: { current: 0.33, previous: 0.5, delta: -0.17 },
      costUsd: { current: 8.1, previous: 1.5, delta: 6.6 },
    },
  ],
  notableRuns: [],
  scanMovers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DigestReportView (WP5.5)", () => {
  test("shows a loading state, then the KPI header + the markdown body", async () => {
    vi.mocked(api.getDigestReport).mockResolvedValue(REPORT);
    vi.mocked(api.getDigestMarkdown).mockResolvedValue("# Daily digest\n\nSome briefing text.");

    render(<DigestReportView id="d1" onBack={() => {}} />);

    expect(screen.getByText(/loading digest/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Daily digest")).toBeInTheDocument());

    // KPI header — figures come straight from the JSON, formatted.
    expect(screen.getByText("4")).toBeInTheDocument(); // runs.current
    expect(screen.getByText("0 regressed · 0 resolved")).toBeInTheDocument(); // New issues card description

    // The markdown body is rendered via the shared ChatMarkdown/MessageResponse path.
    const body = screen.getByTestId("markdown-body");
    expect(body.textContent).toContain("Some briefing text.");
  });

  test("an honest empty digest shows a null error-rate as an em dash, never a fabricated 0%", async () => {
    const empty: DigestReport = {
      ...REPORT,
      headline: { runs: { current: 0, previous: 0, delta: 0 }, errorRate: null, costByBasis: {} },
      newIssues: [],
      movers: [],
    };
    vi.mocked(api.getDigestReport).mockResolvedValue(empty);
    vi.mocked(api.getDigestMarkdown).mockResolvedValue("# Daily digest\n\nno runs in either window.");

    render(<DigestReportView id="d1" onBack={() => {}} />);

    await waitFor(() => expect(screen.getByText("Daily digest")).toBeInTheDocument());
    const body = screen.getByTestId("markdown-body");
    expect(within(body).getByText(/no runs in either window/i)).toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  test("a fetch failure shows an inline error state, not a blank page", async () => {
    vi.mocked(api.getDigestReport).mockRejectedValue(new Error("boom"));
    vi.mocked(api.getDigestMarkdown).mockResolvedValue("# Daily digest");

    render(<DigestReportView id="d1" onBack={() => {}} />);

    expect(await screen.findByText(/couldn.t load the digest/i)).toBeInTheDocument();
    expect(screen.getByText("boom Try again.")).toBeInTheDocument();
  });

  test("the 'late' flag renders the while-you-were-away chip", async () => {
    vi.mocked(api.getDigestReport).mockResolvedValue({ ...REPORT, late: true });
    vi.mocked(api.getDigestMarkdown).mockResolvedValue("# Daily digest");

    render(<DigestReportView id="d1" onBack={() => {}} />);

    expect(await screen.findByText(/while you were away/i)).toBeInTheDocument();
  });
});
