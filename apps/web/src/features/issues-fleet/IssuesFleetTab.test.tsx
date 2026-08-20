import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

// jsdom omits matchMedia/ResizeObserver — `IssueFilters`' `DateRangePicker`/`FacetFilter` (Radix
// popovers) reads matchMedia; ResizeObserver is already globally polyfilled in `vitest.setup.ts`
// (mirrors `CompareView.test.tsx`'s identical matchMedia polyfill).
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Same jsdom/@visx/gradient workaround as `DashboardView.test.tsx` — thin pass-throughs.
vi.mock("@elabs-ai/components-charts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarXAxis: () => null,
  ChartTooltip: () => null,
  Grid: () => null,
  Sparkline: () => null,
}));

const mockGetRunMetrics = vi.fn();
const mockGetAssistantAuthStatus = vi.fn();

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  const { FIXTURE_SERVERS, FIXTURE_SKILLS } = await import("./issue-fixtures");
  return {
    ...actual,
    getRunMetrics: (...args: unknown[]) => mockGetRunMetrics(...args),
    getAssistantAuthStatus: () => mockGetAssistantAuthStatus(),
    listServers: () => Promise.resolve(FIXTURE_SERVERS),
    listSkills: () => Promise.resolve(FIXTURE_SKILLS),
    // WP5.4 — the detail pane's verification-runs section fetches this; keep it deterministic (empty).
    listIssueVerificationRuns: () => Promise.resolve([]),
  };
});

import { AssistantProvider } from "../assistant/assistant-context";
import { resolveDashboardRange } from "../dashboard/dashboard-range";
import { ALL_FLEET_FIXTURES, OPEN_FLEET_ISSUE, REGRESSED_FLEET_ISSUE, SPARSE_RESOLVED_FLEET_ISSUE } from "./issue-fixtures";
import { IssuesFleetTab } from "./IssuesFleetTab";
import type { Loadable } from "../../lib/loadable";
import type { FleetIssue } from "./issue-lib";

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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

/**
 * The Dashboard's shared page range (dashboard-bento WP 2.2) — the Issues list is scoped by it now.
 * The fixtures' `fleet.lastSeenAt` values all land in July 2026, so the default range for these
 * tests is a pinned custom window wide enough to hold every one of them; the narrowing behaviour
 * itself gets its own test below rather than silently colouring every other assertion.
 */
const WIDE_RANGE = resolveDashboardRange({ kind: "custom", from: "2026-06-01", to: "2026-07-31" });

function renderTab(
  state: Loadable<FleetIssue[]> = { status: "data", data: ALL_FLEET_FIXTURES },
  {
    initialEntries = ["/dashboard"],
    range = WIDE_RANGE,
  }: { initialEntries?: string[]; range?: typeof WIDE_RANGE } = {},
) {
  const reloadIssues = vi.fn();
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <TooltipProvider>
        <AssistantProvider>
          <Routes>
            <Route
              path="*"
              element={
                <>
                  <LocationProbe />
                  <IssuesFleetTab range={range} issuesState={state} reloadIssues={reloadIssues} />
                </>
              }
            />
          </Routes>
        </AssistantProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { reloadIssues };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRunMetrics.mockResolvedValue(EMPTY_METRICS);
  mockGetAssistantAuthStatus.mockResolvedValue({ signedIn: false, fallbackConfigured: false, models: [] });
});

describe("IssuesFleetTab — loading/error/empty", () => {
  test("loading state renders before the list settles", async () => {
    renderTab({ status: "loading" });
    expect(screen.getByText("Loading issues…")).toBeInTheDocument();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });

  test("error state renders with a retry", async () => {
    renderTab({ status: "error", error: "network down" });
    expect(screen.getByText("Couldn’t load issues")).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });

  test("empty fleet renders the honest empty state", async () => {
    renderTab({ status: "data", data: [] });
    expect(screen.getByText("No fleet issues recorded")).toBeInTheDocument();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });
});

describe("IssuesFleetTab — default sort: regressed first, then occurrences", () => {
  test("the triage list orders regressed > open > resolved", async () => {
    renderTab();
    const rows = screen.getAllByRole("row");
    const indexOf = (title: string) =>
      rows.findIndex((row) => within(row).queryByText(title) !== null);
    const regressedIndex = indexOf(REGRESSED_FLEET_ISSUE.title);
    const openIndex = indexOf(OPEN_FLEET_ISSUE.title);
    const resolvedIndex = indexOf(SPARSE_RESOLVED_FLEET_ISSUE.title);
    expect(regressedIndex).toBeGreaterThan(-1);
    expect(openIndex).toBeGreaterThan(-1);
    expect(resolvedIndex).toBeGreaterThan(-1);
    expect(regressedIndex).toBeLessThan(openIndex);
    expect(openIndex).toBeLessThan(resolvedIndex);
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });
});

describe("IssuesFleetTab — filtering + search narrow the list", () => {
  // T10: this badge used to render a BARE number ("3", then "1 / 3") with no noun — an
  // aria-live region announcing just a digit is meaningless out of context. It now routes through
  // `ResultCount`'s structured `filteredCount`/`totalCount`/`noun` API, which composes "N issues" /
  // "N of M issues" in one place (see `ResultCount.tsx`'s "THE MISUSE THIS PREVENTS" doc).
  test("typing in the search box narrows the visible list and updates the count badge", async () => {
    renderTab();
    // Unfiltered: count === total, so the badge reads "N issues".
    expect(screen.getByText("3 issues")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Filter issues…"), {
      target: { value: "retired tool" },
    });
    expect(screen.getByText(REGRESSED_FLEET_ISSUE.title)).toBeInTheDocument();
    expect(screen.queryByText(OPEN_FLEET_ISSUE.title)).not.toBeInTheDocument();
    // Filtered: count !== total, so the badge reads "N of M issues".
    expect(screen.getByText("1 of 3 issues")).toBeInTheDocument();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });
});

describe("IssuesFleetTab — the page range scopes the list (dashboard-bento WP 2.2, Defect 2)", () => {
  test("a window that excludes every fixture empties the list, and the count says so", async () => {
    // The fixtures' `fleet.lastSeenAt` all land in July 2026; this window is August.
    renderTab(
      { status: "data", data: ALL_FLEET_FIXTURES },
      { range: resolveDashboardRange({ kind: "custom", from: "2026-08-01", to: "2026-08-31" }) },
    );
    expect(screen.queryByText(OPEN_FLEET_ISSUE.title)).not.toBeInTheDocument();
    // Honest disclosure: the badge names how much of the fleet is being hidden, so a narrowed list
    // can never be mistaken for the whole one.
    expect(screen.getByText("0 of 3 issues")).toBeInTheDocument();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });

  test("a window that includes only ONE fixture shows exactly that one", async () => {
    // `SPARSE_RESOLVED_FLEET_ISSUE` was last seen 2026-07-02; the other two on 2026-07-10 / 07-15.
    renderTab(
      { status: "data", data: ALL_FLEET_FIXTURES },
      { range: resolveDashboardRange({ kind: "custom", from: "2026-07-01", to: "2026-07-05" }) },
    );
    expect(screen.getByText(SPARSE_RESOLVED_FLEET_ISSUE.title)).toBeInTheDocument();
    expect(screen.queryByText(REGRESSED_FLEET_ISSUE.title)).not.toBeInTheDocument();
    expect(screen.getByText("1 of 3 issues")).toBeInTheDocument();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });

  test("the upper bound is genuinely INCLUSIVE of its final day", async () => {
    // The bound is an ISO instant (`…T23:59:59.999Z`), not `YYYY-MM-DD`: `filterFleetIssues`
    // compares lexically, and a date-only upper bound sorts BEFORE every timestamp on that day, so
    // it used to drop the whole of its own last day.
    renderTab(
      { status: "data", data: ALL_FLEET_FIXTURES },
      { range: resolveDashboardRange({ kind: "custom", from: "2026-07-10", to: "2026-07-10" }) },
    );
    expect(screen.getByText(OPEN_FLEET_ISSUE.title)).toBeInTheDocument();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });

  test("the tab renders NO date control of its own — the range lives in the page toolbar", async () => {
    renderTab();
    // `DateRangePicker`'s trigger is the only `aria-haspopup="dialog"` control this row rendered.
    // (The table still has a "Last seen" COLUMN — that is a sort header, not a filter.)
    expect(document.querySelector('[aria-haspopup="dialog"]')).toBeNull();
    await waitFor(() => expect(mockGetAssistantAuthStatus).toHaveBeenCalled());
  });
});

describe("IssuesFleetTab — selecting a row opens the detail drawer + updates the URL", () => {
  test("clicking a row opens the Sheet showing its detail and writes ?issue=", async () => {
    renderTab();
    // Before selection, the drawer is closed — no dialog in the document.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `Open ${OPEN_FLEET_ISSUE.title}` }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: OPEN_FLEET_ISSUE.title })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`issue=${OPEN_FLEET_ISSUE.id}`);
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });

  test("closing the Sheet (✕) clears ?issue= and unmounts the detail", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: `Open ${OPEN_FLEET_ISSUE.title}` }));
    expect(screen.getByTestId("location")).toHaveTextContent(`issue=${OPEN_FLEET_ISSUE.id}`);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).not.toHaveTextContent(`issue=${OPEN_FLEET_ISSUE.id}`),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("IssuesFleetTab — deep-link handling (notification landing)", () => {
  test("landing with ?issue=<id> opens that issue's detail Sheet directly", async () => {
    renderTab(
      { status: "data", data: ALL_FLEET_FIXTURES },
      { initialEntries: [`/dashboard?tab=issues&issue=${REGRESSED_FLEET_ISSUE.id}`] },
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: REGRESSED_FLEET_ISSUE.title })).toBeInTheDocument();
    await waitFor(() => expect(mockGetRunMetrics).toHaveBeenCalled());
  });

  test("an unresolvable ?issue= id clears itself instead of showing a dead detail forever", async () => {
    renderTab(
      { status: "data", data: ALL_FLEET_FIXTURES },
      { initialEntries: ["/dashboard?issue=does-not-exist"] },
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).not.toHaveTextContent("issue=does-not-exist"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
