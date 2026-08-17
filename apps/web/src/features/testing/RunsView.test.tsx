import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RunSummary, Scenario, Test } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { RunsFeedData } from "./runs/runs-api";

// ── toolbar-reach WP0.2 (A-2) ────────────────────────────────────────────────────────────────────
// RunsView consumes the `?launch=1` flag that `RunConsoleRoute` / the command palette redirect a
// param-less new-run entry to: it opens the existing two-path launcher and strips the flag from the
// URL. The heavy `RunLauncher` wizard is stubbed to a probe that just reports its `open` state, and
// the two data loaders (the runs feed + the filter-bar option lists) are mocked so the view resolves
// to its empty state (the lightest branch that still mounts `RunLauncher`).
vi.mock("./run-launcher/RunLauncher", () => ({
  RunLauncher: (props: { open: boolean }) =>
    props.open ? <div data-testid="run-launcher-open" /> : null,
}));

// RunsView imports `suiteStatusBadge` from `./suites/SuiteRunConsole`, whose chart children pull
// `@elabs-ai/components-charts` (@visx) — which jsdom cannot resolve (see MEMORY: "Chart tests mock @elabs-ai/components-charts
// as no-op"). It is only used in the populated table branch (never the empty branch under test), so a
// no-op stub cuts the chart chain without affecting what we assert.
vi.mock("./suites/SuiteRunConsole", () => ({
  suiteStatusBadge: () => ({ status: "complete", label: "Complete" }),
}));

// toolbar-reach WP4.3 (B-6) — RunsView now mounts a "Suites" peer tab that renders the real
// `SuitesView` verbatim. That view fetches suites/tests/scenarios/collections and pulls the chart
// chain, none of which this file's tab-switch assertions care about, so it's stubbed to a probe.
vi.mock("./suites/SuitesView", () => ({
  SuitesView: () => <div data-testid="suites-view" />,
}));

vi.mock("./runs/runs-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runs/runs-api")>();
  return { ...actual, loadRunsFeed: vi.fn() };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listServers: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getRunGrades: vi.fn().mockResolvedValue({ latest: [] }),
  };
});

import { RunsView } from "./RunsView";
import { loadRunsFeed } from "./runs/runs-api";

// jsdom omits matchMedia — Radix Tooltip (the ViewToolbar info ⓘ) reads it (mirrors EnvironmentEditor.test).
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

const mockLoadRunsFeed = vi.mocked(loadRunsFeed);

const EMPTY_FEED: RunsFeedData = {
  items: [],
  tests: [],
  scenarios: [],
  providers: [],
  suites: [],
  testsById: new Map(),
  scenariosById: new Map(),
};

// ── interface-craft WP 0.4 (finding 2) — the populated toolbar ─────────────────────────────────────
// A minimal one-run feed so the full one-row `ViewToolbar` (search/saved-views/Type/RunFilterBar/
// Show-forks/count) mounts — the empty-feed branch above never reaches it.
function makeTest(): Test {
  return {
    id: "test-1",
    name: "List files",
    userPrompt: "List the files in the workspace.",
    addedProfiles: [],
    attachments: [],
    tags: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

function makeScenario(): Scenario {
  return {
    id: "scn-1",
    name: "Baseline",
    providerId: "prov-1",
    model: "assistant-abc123",
    params: {},
    systemPrompt: "You are a helpful analyst.",
    allowedServers: [],
    allowedSkills: [],
    defaultProfiles: [],
    guardrails: {},
    toolLoadingMode: "eager",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

function makeRun(): RunSummary {
  return {
    id: "run-1",
    testId: "test-1",
    scenarioId: "scn-1",
    mode: "automated",
    status: "completed",
    outcome: "completed",
    startedAt: "2026-07-13T00:00:00.000Z",
    durationMs: 4200,
    turns: 2,
    toolCalls: 1,
    peakContextTokens: 500,
    tokensIn: 100,
    tokensOut: 20,
    costUsd: 0.5,
    ratingState: "rated",
  };
}

const RUN = makeRun();
const POPULATED_FEED: RunsFeedData = {
  items: [{ kind: "run", sortMs: Date.parse(RUN.startedAt), run: RUN }],
  tests: [makeTest()],
  scenarios: [makeScenario()],
  providers: [],
  suites: [],
  testsById: new Map([["test-1", makeTest()]]),
  scenariosById: new Map([["scn-1", makeScenario()]]),
};

/** Reflects the current route (path + search) so the flag-stripping is observable. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderRuns(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <TooltipProvider>
        <LocationProbe />
        <Routes>
          <Route path="/testing/runs" element={<RunsView />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockLoadRunsFeed.mockReset().mockResolvedValue(EMPTY_FEED);
});

describe("RunsView — A-2 launcher-open param (?launch=1)", () => {
  test("opens the run launcher and strips the flag from the URL", async () => {
    renderRuns("/testing/runs?launch=1");

    // The launcher opens on arrival…
    expect(await screen.findByTestId("run-launcher-open")).toBeInTheDocument();
    // …and the transient flag is removed so a reload/close can't reopen it (other params, had there
    // been any, are preserved — here there are none, so the search clears entirely).
    await waitFor(() =>
      expect(screen.getByTestId("location")).not.toHaveTextContent("launch"),
    );
  });

  test("does not open the launcher without the flag", async () => {
    renderRuns("/testing/runs");

    // Let the feed resolve so the empty branch (which mounts RunLauncher, closed) has rendered.
    await waitFor(() => expect(mockLoadRunsFeed).toHaveBeenCalled());
    expect(screen.queryByTestId("run-launcher-open")).not.toBeInTheDocument();
  });
});

// Radix Tabs use automatic activation (activate on focus), so a bare `fireEvent.click` doesn't
// switch tabs in jsdom — `mouseDown` with the primary button is the repo's established pattern
// (see DashboardView / WorkforceView tests).
function clickTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

describe("RunsView — Suites peer tab (B-6)", () => {
  test("defaults to the runs feed; the Suites tab surfaces the suites catalog without a URL", async () => {
    renderRuns("/testing/runs");

    // Both peer tabs are present; the runs feed is active by default (zero query params, D-TB10) so
    // the suites catalog is NOT mounted yet.
    const runsTab = await screen.findByRole("tab", { name: "Runs" });
    screen.getByRole("tab", { name: "Suites" });
    await waitFor(() => expect(mockLoadRunsFeed).toHaveBeenCalled());
    expect(screen.queryByTestId("suites-view")).not.toBeInTheDocument();
    expect(runsTab).toHaveAttribute("aria-selected", "true");

    // Activating the tab (no URL knowledge needed) mounts the real SuitesView and records the
    // bookmarkable `?feed=suites` state.
    clickTab("Suites");
    expect(await screen.findByTestId("suites-view")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("feed=suites"));

    // Back to Runs — the suites catalog unmounts and the param clears (clean default URL).
    clickTab("Runs");
    await waitFor(() => expect(screen.queryByTestId("suites-view")).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).not.toHaveTextContent("feed=suites");
  });

  test("a `?feed=suites` deep link opens directly on the suites catalog", async () => {
    renderRuns("/testing/runs?feed=suites");

    expect(await screen.findByTestId("suites-view")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Suites" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("RunsView — Show-forks toggle (interface-craft WP 0.4 / finding 2)", () => {
  test("renders as a Toggle (not a filled-primary Button) and tracks pressed state", async () => {
    mockLoadRunsFeed.mockResolvedValue(POPULATED_FEED);
    renderRuns("/testing/runs");

    const toggle = await screen.findByRole("button", { name: "Show forks" });

    // It is a real Radix Toggle (carries `data-state`/`aria-pressed`, which a plain `Button` never
    // sets) — the fix replaced the `Button variant={… ? "default" : "outline"}` that borrowed the
    // filled-primary green on press.
    expect(toggle).toHaveAttribute("data-state", "off");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    // The `Toggle` component's pressed treatment is an accent fill (`data-[state=on]:bg-accent`) +
    // a `border-primary` boundary — never the unconditional `bg-primary text-primary-foreground` a
    // `Button variant="default"` carries. Assert the defect's exact class is gone.
    expect(toggle.className).not.toMatch(/(?:^|\s)bg-primary(?:\s|$)/);
    expect(toggle.className).toMatch(/data-\[state=on\]:bg-accent/);

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute("data-state", "on"));
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    // Same class list before and after — the pressed look comes from the `data-state`-keyed CSS, not
    // from swapping in a different (filled-primary) variant.
    expect(toggle.className).not.toMatch(/(?:^|\s)bg-primary(?:\s|$)/);
  });

  test("the hand-rolled overflow-x-auto scroller is gone; the filter cluster is plain wrapping children", async () => {
    mockLoadRunsFeed.mockResolvedValue(POPULATED_FEED);
    const { container } = renderRuns("/testing/runs");

    await screen.findByRole("button", { name: "Show forks" });

    // Scoped to the APP's own chrome. Since v4 the library's `TabsList` carries `overflow-x-auto`
    // itself (a scrollable tab strip), so a container-wide query would now match that shipped
    // component rather than the hand-rolled scroller this test was written to keep out.
    const libraryScrollers = [...container.querySelectorAll('[role="tablist"]')];
    const appScrollers = [...container.querySelectorAll(".overflow-x-auto")].filter(
      (el) => !libraryScrollers.some((list) => list === el || list.contains(el)),
    );
    expect(appScrollers, "the app must not hand-roll a horizontal scroller here").toHaveLength(0);
    expect(container.querySelector('[class*="scrollbar-width"]')).not.toBeInTheDocument();
  });
});

/**
 * P0 mobile audit T4 (2026-07-25 critique) — below 768px the wide interactive table (11+ columns,
 * sticky-pinned Name/Actions) is replaced by one Card per run/suite; "New run" stays reachable. The
 * DESKTOP path (every other describe block above, at jsdom's default 1024px `innerWidth`) is
 * untouched by any of this — these tests only exercise the `isMobile` branch.
 */
describe("RunsView — mobile card list below 768px (P0 mobile audit T4)", () => {
  const ORIGINAL_INNER_WIDTH = window.innerWidth;

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  });
  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: ORIGINAL_INNER_WIDTH });
  });

  test("renders a tappable Card per run instead of the desktop table element", async () => {
    mockLoadRunsFeed.mockResolvedValue(POPULATED_FEED);
    renderRuns("/testing/runs");

    const card = await screen.findByRole("button", { name: "Open List files run console" });
    // No desktop table at all at this width — the card list fully replaces it.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(card.closest("table")).toBeNull();
  });

  test("'New run' stays visible and reachable alongside the card list", async () => {
    mockLoadRunsFeed.mockResolvedValue(POPULATED_FEED);
    renderRuns("/testing/runs");

    await screen.findByRole("button", { name: "Open List files run console" });
    expect(screen.getByRole("button", { name: "New run" })).toBeInTheDocument();
  });

  test("tapping a run Card opens its run console (mirrors the desktop row's whole-row click)", async () => {
    mockLoadRunsFeed.mockResolvedValue(POPULATED_FEED);
    renderRuns("/testing/runs");

    const card = await screen.findByRole("button", { name: "Open List files run console" });
    fireEvent.click(card);

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/testing/runs/run-1"),
    );
  });
});
