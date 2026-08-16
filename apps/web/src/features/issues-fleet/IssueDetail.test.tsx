import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";

// `@brand/charts` — the occurrences panel + sparkline pull real chart components; jsdom breaks on the
// barrel's deep `@visx/gradient` import (see `DashboardView.test.tsx`'s note). Thin pass-throughs.
vi.mock("@brand/charts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarXAxis: () => null,
  ChartTooltip: () => null,
  Grid: () => null,
  Sparkline: () => null,
}));

const mockGetRunMetrics = vi.fn();
const mockResolveIssue = vi.fn();
const mockIgnoreIssue = vi.fn();
const mockReopenIssue = vi.fn();
const mockGetAssistantAuthStatus = vi.fn();
const mockListVerificationRuns = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getRunMetrics: (...args: unknown[]) => mockGetRunMetrics(...args),
    resolveIssue: (...args: unknown[]) => mockResolveIssue(...args),
    ignoreIssue: (...args: unknown[]) => mockIgnoreIssue(...args),
    reopenIssue: (...args: unknown[]) => mockReopenIssue(...args),
    getAssistantAuthStatus: () => mockGetAssistantAuthStatus(),
    listIssueVerificationRuns: (...args: unknown[]) => mockListVerificationRuns(...args),
  };
});

import { AssistantProvider } from "../assistant/assistant-context";
import { OPEN_FLEET_ISSUE, REGRESSED_FLEET_ISSUE } from "./issue-fixtures";
import { IssueDetail } from "./IssueDetail";

const EMPTY_METRICS = {
  bucket: "day" as const,
  timezone: "UTC" as const,
  from: null,
  to: null,
  groupBy: null,
  measures: [],
  unavailableMeasures: [],
  series: [],
};

function renderDetail(overrides: Partial<Parameters<typeof IssueDetail>[0]> = {}) {
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <AssistantProvider>
          <IssueDetail
            issue={OPEN_FLEET_ISSUE}
            onChanged={onChanged}
            entityLabel={(id) => (id === "srv-1" ? "Qlik-SaaS" : id)}
            {...overrides}
          />
        </AssistantProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRunMetrics.mockResolvedValue(EMPTY_METRICS);
  mockGetAssistantAuthStatus.mockResolvedValue({ signedIn: false, fallbackConfigured: false, models: [] });
  mockListVerificationRuns.mockResolvedValue([]);
});

describe("IssueDetail — renders every WP5.1 field somewhere", () => {
  test("identity, lifecycle, severity, bucket, summary, target", async () => {
    renderDetail();
    expect(screen.getByRole("heading", { name: OPEN_FLEET_ISSUE.title })).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    // The bucket chip renders in BOTH the header and the drafted-fix section (context in each place).
    expect(screen.getAllByText("MCP server").length).toBeGreaterThan(0);
    expect(screen.getByText(OPEN_FLEET_ISSUE.summary)).toBeInTheDocument();
    // "Qlik-SaaS" appears both in the target line and the Affected chip — assert presence, not count.
    expect(screen.getAllByText(/Qlik-SaaS/).length).toBeGreaterThan(0);
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });

  test("affected entities, drafted fix, occurrences count, first/last seen, cluster key", async () => {
    renderDetail();
    // Affected chips (server name resolved + test id + model). "Qlik-SaaS" also appears in the
    // target line above, so assert at least one (the chip) rather than a brittle exact single match.
    expect(screen.getAllByText("Qlik-SaaS").length).toBeGreaterThan(0);
    expect(screen.getByText(`Test ${OPEN_FLEET_ISSUE.fleet.affected.tests[0]}`)).toBeInTheDocument();
    expect(screen.getByText("claude-opus-4")).toBeInTheDocument();
    // Draft fix text + fix-target chip.
    expect(screen.getByText(OPEN_FLEET_ISSUE.draftFix)).toBeInTheDocument();
    expect(screen.getByText("Fix in MCP server")).toBeInTheDocument();
    // Descriptions block.
    expect(screen.getByText(String(OPEN_FLEET_ISSUE.fleet.occurrenceCount))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(OPEN_FLEET_ISSUE.fleet.clusterKey))).toBeInTheDocument();
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });

  test("linked runs render each occurrence with a direct run link", async () => {
    renderDetail();
    expect(screen.getByRole("link", { name: /Run run-1/ })).toHaveAttribute(
      "href",
      "/testing/runs/run-1",
    );
    // The label truncates a long id (`shortId`); the href always carries the FULL id.
    expect(screen.getByRole("link", { name: /Suite run/ })).toHaveAttribute(
      "href",
      "/testing/suite-runs/suite-run-1",
    );
    // Failure evidence (tool/args/error) surfaces for the occurrence that carries it. "run_query"
    // also appears in the issue title, so assert the evidence block specifically.
    expect(screen.getByText(/Sent parameters.*run_query/)).toBeInTheDocument();
    expect(screen.getByText(/Invalid parameter: date must match pattern/)).toBeInTheDocument();
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });

  test("AI-assisted provenance renders when the wire carries aiAssisted:true, not otherwise", async () => {
    const flagged = { ...OPEN_FLEET_ISSUE, aiAssisted: true } as typeof OPEN_FLEET_ISSUE;
    renderDetail({ issue: flagged });
    expect(screen.getByText("AI-refined")).toBeInTheDocument();
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });

  test("no AI-assisted mark for a plain issue", async () => {
    renderDetail();
    expect(screen.queryByText("AI-refined")).not.toBeInTheDocument();
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });

  test("a resolved issue's resolution note and resolvedAt render in Details", async () => {
    renderDetail({ issue: REGRESSED_FLEET_ISSUE });
    expect(screen.getByText("Fixed in skill v3")).toBeInTheDocument();
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });
});

describe("IssueDetail — linked runs 'open in feed' carries the exact RunFilter", () => {
  test("the href encodes buildIssueRunFilter(issue)'s exact filter", async () => {
    renderDetail();
    const link = screen.getByRole("link", { name: /Open in feed/ });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("/testing/runs?filter=")).toBe(true);
    const filterParam = new URLSearchParams(href.split("?")[1]).get("filter") ?? "";
    const decoded = JSON.parse(filterParam);
    expect(decoded).toEqual({
      dateFrom: OPEN_FLEET_ISSUE.fleet.firstSeenAt,
      dateTo: OPEN_FLEET_ISSUE.fleet.lastSeenAt,
      serverId: OPEN_FLEET_ISSUE.fleet.affected.servers,
      testId: OPEN_FLEET_ISSUE.fleet.affected.tests,
      model: OPEN_FLEET_ISSUE.fleet.affected.models,
    });
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });
});

describe("IssueDetail — lifecycle actions round-trip through a CONFIRM tier", () => {
  test("Resolve opens a confirm dialog; confirming calls resolveIssue and onChanged", async () => {
    mockResolveIssue.mockResolvedValue({ ...OPEN_FLEET_ISSUE, fleet: { ...OPEN_FLEET_ISSUE.fleet, lifecycle: "resolved" } });
    const { onChanged } = renderDetail();

    // Clicking "Resolve…" must NOT immediately call the API — it opens a confirm dialog first.
    fireEvent.click(screen.getByRole("button", { name: "Resolve…" }));
    expect(mockResolveIssue).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Resolve this issue?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resolve issue" }));
    await waitFor(() => expect(mockResolveIssue).toHaveBeenCalledWith(OPEN_FLEET_ISSUE.id, undefined));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  test("Resolve with a note passes the trimmed note through", async () => {
    mockResolveIssue.mockResolvedValue(OPEN_FLEET_ISSUE);
    renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Resolve…" }));
    const noteField = await screen.findByLabelText("Note (optional)");
    fireEvent.change(noteField, { target: { value: "  Loosened the schema  " } });
    fireEvent.click(screen.getByRole("button", { name: "Resolve issue" }));
    await waitFor(() =>
      expect(mockResolveIssue).toHaveBeenCalledWith(OPEN_FLEET_ISSUE.id, "Loosened the schema"),
    );
  });

  test("Reopen is offered for a resolved issue and round-trips", async () => {
    mockReopenIssue.mockResolvedValue({ ...REGRESSED_FLEET_ISSUE, fleet: { ...REGRESSED_FLEET_ISSUE.fleet, lifecycle: "open" } });
    const resolvedIssue = {
      ...REGRESSED_FLEET_ISSUE,
      fleet: { ...REGRESSED_FLEET_ISSUE.fleet, lifecycle: "resolved" as const },
    };
    const { onChanged } = renderDetail({ issue: resolvedIssue });
    expect(screen.queryByRole("button", { name: "Resolve…" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reopen issue" }));
    await waitFor(() => expect(mockReopenIssue).toHaveBeenCalledWith(resolvedIssue.id));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  test("Ignore round-trips through the confirm tier", async () => {
    mockIgnoreIssue.mockResolvedValue(OPEN_FLEET_ISSUE);
    const { onChanged } = renderDetail();
    fireEvent.click(screen.getByRole("button", { name: "Ignore…" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ignore issue" }));
    await waitFor(() => expect(mockIgnoreIssue).toHaveBeenCalledWith(OPEN_FLEET_ISSUE.id, undefined));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe("IssueDetail — 'Analyze with Assistant' mount", () => {
  test("hidden when the assistant is not configured", async () => {
    renderDetail();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Analyze with assistant/i })).not.toBeInTheDocument();
  });

  test("mounted and ENABLED once the assistant is configured (WP5.4 — the loop entry point is live)", async () => {
    mockGetAssistantAuthStatus.mockResolvedValue({ signedIn: true, fallbackConfigured: false, models: [] });
    renderDetail();
    const button = await screen.findByRole("button", { name: /Analyze with assistant/i });
    expect(button).toBeEnabled();
  });
});

describe("IssueDetail — verification runs section", () => {
  test("renders the section with an empty state when none are recorded", async () => {
    renderDetail();
    expect(await screen.findByText(/No verification runs yet/i)).toBeInTheDocument();
    await waitFor(() => expect(mockListVerificationRuns).toHaveBeenCalledWith(OPEN_FLEET_ISSUE.id));
  });

  test("renders each verification run with a run-console link + live status", async () => {
    mockListVerificationRuns.mockResolvedValue([
      { runId: "run-fork-1", sourceRunId: "run-1", note: "pin skill v4", at: "2026-07-15T00:00:00.000Z", status: "completed", outcome: "completed" },
    ]);
    renderDetail();
    const link = await screen.findByRole("link", { name: /Run run-fork/ });
    expect(link).toHaveAttribute("href", "/testing/runs/run-fork-1");
    expect(screen.getByText("Verification runs (1)")).toBeInTheDocument();
    expect(screen.getByText(/pin skill v4/)).toBeInTheDocument();
  });
});
