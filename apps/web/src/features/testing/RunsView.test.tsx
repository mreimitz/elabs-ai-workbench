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
    // AM-OB1 — the saved-view picker fetches `run_views` on mount; stubbed so the `?view=<id>`
    // resolution tests below are deterministic (and so the other suites don't hit the network).
    listRunViews: vi.fn().mockResolvedValue([]),
  };
});

import { RunsView } from "./RunsView";
import { listRunViews } from "../../lib/api";
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
const mockListRunViews = vi.mocked(listRunViews);

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
  mockListRunViews.mockReset().mockResolvedValue([]);
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

/**
 * RM-17 Phase 6 · AM-OB1 — the WHOLE feed state serializes into the URL, so a pasted link reproduces
 * exactly what the sender was looking at and a saved view is a shareable named URL.
 *
 * Before this work only the `RunFilter` (`filter=`, WP 2.3) round-tripped; the applied view, the
 * sort, the grouping axis, the Type facet and the visible columns / preview mode lived in component
 * `useState` and were silently lost on every reload. These tests pin BOTH directions: a URL hydrates
 * the feed, and a control's change lands back in the URL.
 */
describe("RunsView — full feed state in the URL (AM-OB1)", () => {
  beforeEach(() => {
    mockLoadRunsFeed.mockResolvedValue(POPULATED_FEED);
  });

  test("a zero-query-param URL still renders the default feed and writes NOTHING (D-TB10)", async () => {
    renderRuns("/testing/runs");

    // Default columns (status · cost · started · duration) — `type`/`tokens` are hidden by default…
    expect(await screen.findByRole("columnheader", { name: /Status/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Tokens/ })).not.toBeInTheDocument();
    // …default sort is Started, descending…
    expect(screen.getByRole("columnheader", { name: /Started/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    // …and nothing has been written to the URL just by rendering.
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/testing\/runs$/);
  });

  test("a pasted URL reproduces sort, grouping, columns and the preview mode", async () => {
    renderRuns("/testing/runs?sort=cost:asc&group=type&cols=tokens,cost&preview=cost");

    // Sort — the Cost header carries the active ascending sort (default is Started/descending).
    const costHeader = await screen.findByRole("columnheader", { name: /Cost/ });
    expect(costHeader).toHaveAttribute("aria-sort", "ascending");
    expect(screen.queryByRole("columnheader", { name: /Started/ })).not.toBeInTheDocument();

    // Columns — exactly the two named, not the default set.
    expect(screen.getByRole("columnheader", { name: /Tokens/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Status/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Duration/ })).not.toBeInTheDocument();

    // Grouping — the Group-by control shows the restored axis…
    expect(screen.getByRole("combobox", { name: "Group by" })).toHaveTextContent("Group by type");
    // …and the grouped table renders its group header row.
    expect(screen.getByText("Single runs")).toBeInTheDocument();

    // Preview mode — a non-"none" mode is what puts the per-row disclosure on the row at all.
    expect(
      screen.getByRole("button", { name: "Expand preview for List files" }),
    ).toBeInTheDocument();
  });

  test("the Type facet rides in the URL and narrows the feed on arrival", async () => {
    renderRuns("/testing/runs?type=suite");

    // The one row in the feed is a SINGLE run, so a suite-only facet hides it — and the count chip
    // says so rather than the table silently looking empty.
    expect(await screen.findByText("0 of 1 rows")).toBeInTheDocument();
  });

  test("sorting a column writes the sort into the URL (and flips direction on a second click)", async () => {
    renderRuns("/testing/runs");

    const costSort = await screen.findByRole("button", { name: "Cost" });
    fireEvent.click(costSort);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("sort=cost%3Adesc"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Cost" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("sort=cost%3Aasc"));
  });

  test("returning the sort to its default REMOVES the param rather than writing the default", async () => {
    renderRuns("/testing/runs?sort=cost:asc");

    const startedSort = await screen.findByRole("button", { name: "Started" });
    fireEvent.click(startedSort); // → started:desc, which is the default
    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("sort="));
  });

  test("a malformed URL opens a working feed on the defaults instead of crashing", async () => {
    renderRuns("/testing/runs?sort=by-vibes&group=sideways&preview=telepathy&filter=%7Bnope");

    // Default sort, default grouping, default columns — every bad value degraded on its own, and the
    // run is still there to click.
    expect(await screen.findByRole("columnheader", { name: /Started/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByRole("combobox", { name: "Group by" })).toHaveTextContent("No grouping");
    expect(screen.getByRole("link", { name: "Open List files run console" })).toBeInTheDocument();
    // `preview=telepathy` fell back to "none", which is what removes the per-row disclosure entirely.
    expect(
      screen.queryByRole("button", { name: "Expand preview for List files" }),
    ).not.toBeInTheDocument();
  });

  test("a `cols=` naming only unknown columns hides every optional column rather than guessing", async () => {
    // Deliberate, documented behaviour: unknown keys are dropped, and an empty result is a real
    // "hide every optional column" choice (the same state the column chooser can produce), not a
    // signal to silently restore the default set.
    renderRuns("/testing/runs?cols=not-a-column");

    expect(await screen.findByRole("link", { name: "Open List files run console" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Started/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Status/ })).not.toBeInTheDocument();
  });
});

describe("RunsView — a saved view is a shareable named URL (AM-OB1)", () => {
  beforeEach(() => {
    mockLoadRunsFeed.mockResolvedValue(POPULATED_FEED);
  });

  test("`?view=preset:failures` alone resolves the preset and writes the state it implies", async () => {
    renderRuns("/testing/runs?view=preset%3Afailures");

    // The picker shows the view's NAME (not the generic "Views" label)…
    expect(await screen.findByRole("button", { name: /Failures/ })).toBeInTheDocument();
    // …and the short named URL has been expanded into the self-describing form, so the recipient's
    // own copy of the link needs no lookup.
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("hasError%22%3Atrue"),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("view=preset%3Afailures");
  });

  test("`?view=<id>` alone resolves a PERSISTED view once its list loads", async () => {
    mockListRunViews.mockResolvedValue([
      {
        id: "view-abc",
        name: "My failing runs",
        filter: { status: ["error"] },
        columns: { visible: ["tokens"], previewMode: "none" },
        sort: { key: "tokens", dir: "asc" },
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-01T00:00:00Z",
      },
    ]);
    renderRuns("/testing/runs?view=view-abc");

    // Its filter, its columns AND its sort are all restored — a view is the whole presentation.
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("sort=tokens%3Aasc"),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("cols=tokens");
    expect(screen.getByTestId("location")).toHaveTextContent("error");
    expect(screen.getByRole("columnheader", { name: /Tokens/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    // …and the picker shows the view's NAME, not the generic "Views" label. (Applying the view
    // re-fetches the feed, which remounts the toolbar, so wait for the picker to settle.)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /My failing runs/ })).toBeInTheDocument(),
    );
  });

  test("a `view=` id that no longer exists drops out of the URL instead of showing a nameless label", async () => {
    renderRuns("/testing/runs?view=deleted-view");

    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("view="));
    expect(screen.getByRole("button", { name: /Views/ })).toBeInTheDocument();
  });

  test("a URL that already describes its state is reproduced VERBATIM — `view=` is only the label", async () => {
    // `hasError` is the Failures preset's filter; this link carries a DIFFERENT one alongside the
    // preset id (what the app writes after the operator tweaks a filter under an applied view).
    renderRuns("/testing/runs?view=preset%3Afailures&filter=%7B%22pinned%22%3Atrue%7D");

    expect(await screen.findByRole("button", { name: /Failures/ })).toBeInTheDocument();
    // The preset was NOT re-applied over the explicit filter…
    await waitFor(() => expect(mockLoadRunsFeed).toHaveBeenCalled());
    expect(screen.getByTestId("location")).toHaveTextContent("pinned%22%3Atrue");
    expect(screen.getByTestId("location")).not.toHaveTextContent("hasError");
  });

  test("editing the bar after applying a view DROPS the view id (the label stops lying)", async () => {
    renderRuns("/testing/runs?view=preset%3Afailures");

    await screen.findByRole("button", { name: /Failures/ });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("hasError"));

    // Any hand-edit means the bar has drifted from the named view — `RunSavedViewsProps.activeId`
    // has always documented that, and nothing implemented it until the id became shareable.
    fireEvent.click(screen.getByRole("button", { name: "Show forks" }));

    await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("view="));
    expect(screen.getByRole("button", { name: /Views/ })).toBeInTheDocument();
  });
});
