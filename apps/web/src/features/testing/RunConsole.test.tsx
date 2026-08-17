import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { RunStep, Scenario, SessionCapabilities, Test } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";
// Type-only — erased before runtime, so this never touches the `vi.mock("./use-run-stream", ...)`
// module mock below.
import type { RunStreamState } from "./use-run-stream";

/**
 * WP 3.2 (Unified Sessions, D-US4) — the console-chrome half of the capability-driven rail: for a
 * manifest with `contextWindow: false` BOTH context-window surfaces are gated
 * OFF at the RunConsole render site — the `<ContextChart>` (which owns the never-fulfilling "No
 * context yet" turn-0 empty state) and the `<BaselineFootprint>` turn-0 card — because that kind has
 * no context window at all. Every manifest with `contextWindow: true` still renders both. This is
 * proven by mounting RunConsole in its lightest (pre-run) state with only the THREE module-load-heavy
 * children stubbed (ConversationPane, AnalyticsPanel — both pull `@brand/ai`/`@brand/charts` that
 * jsdom can't load — and ContextChart, stubbed to a sentinel so its presence/absence is directly
 * assertable). `BaselineFootprint` is a function LOCAL to RunConsole.tsx (unmockable), so it's
 * asserted by its real "Turn-0 baseline" text.
 */

// The context chart is the surface under test — stub it to a sentinel so we assert mount/absence
// directly (and so its real `@brand/charts` dependency never enters the jsdom bundle).
vi.mock("./ContextChart", () => ({
  ContextChart: () => <div data-testid="context-chart" />,
}));
// Heavy siblings imported at module load (they pull `@brand/ai` / `@brand/charts`) — neutralized so
// importing RunConsole doesn't drag Monaco/markdown/visx into jsdom. They never render in pre-run
// (ConversationPane is only on the running/replay left pane; AnalyticsPanel is a left tab), but the
// import still executes, so they must be stubbed.
vi.mock("./ConversationPane", () => ({ ConversationPane: () => <div /> }));
vi.mock("./AnalyticsPanel", () => ({ AnalyticsPanel: () => <div /> }));
// Right-pane bottom-zone + trace children that transitively pull `@brand/editor`/`@brand/ai` (the
// CodeSnippet / ArtifactPreview / markdown surfaces — a milkdown/monaco CSS import jsdom can't load).
// None are under test here; stub them so the import graph stays jsdom-safe.
vi.mock("./TraceTimeline", () => ({ TraceTimeline: () => <div /> }));
// WP3.4 — `selectedStepId` surfaced as a data attribute (instead of a no-op `<div/>`) so the
// "switching lenses preserves the scroll target" test can observe it directly, without depending on
// the real Sheet's internal markup.
vi.mock("./PacketInspector", () => ({
  PacketInspector: ({ selectedStepId }: { selectedStepId: string | null }) => (
    <div data-testid="packet-inspector-probe" data-selected-step-id={selectedStepId ?? ""} />
  ),
}));
vi.mock("./ConsolePanel", () => ({ ConsolePanel: () => <div /> }));
vi.mock("./ApplicationPanel", () => ({ ApplicationPanel: () => <div /> }));
// ReportTab's donut/radar module pulls `@brand/charts` (visx) — stubbed so importing RunConsole
// (→ ReportTab → report-charts) stays jsdom-safe.
vi.mock("./report-charts", () => ({
  ScoreDonut: () => <div />,
  ScoreRadar: () => <div />,
}));
// KpiRail (rendered unmocked here) now pulls `@brand/ai` for the Context usage popover — and the
// @brand/ai barrel imports xyflow CSS jsdom can't load. Stub the six Context parts it uses; the
// rail's own tile text stays real and assertable.
vi.mock("@brand/ai", () => ({
  Context: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ContextTrigger: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ContextContent: () => null,
  ContextContentHeader: () => null,
  ContextContentBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ContextContentFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// The SSE hook — return a stable empty stream so no real EventSource opens and the console renders
// its pre-run shell deterministically. Keep every other export (buildTimeline, answersPayloadOf,
// the gate helpers, types) as the real thing.
const EMPTY_STREAM = {
  status: null,
  ratingState: null,
  steps: [],
  kpis: null,
  deltas: { text: "", reasoning: "" },
  deltasByTurn: {},
  error: null,
  timeline: [],
  // Unified Sessions (WP3.3) — the folded live-phase facets; a pre-run stream has none of them yet.
  phase: null,
  queuePosition: null,
  phaseDeadlineAt: null,
} as const;
// WP3.fix (WP3.R Defect 1) — a per-test override so the "ended run opens in replay" test below can
// simulate a terminal `ended` stream without disturbing the pre-run tests above, which rely on the
// default EMPTY_STREAM.
let streamOverride: RunStreamState | null = null;
vi.mock("./use-run-stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-run-stream")>();
  return { ...actual, useRunStream: () => streamOverride ?? EMPTY_STREAM };
});

// WP3.fix — a terminal `ended` stream (the operator clicked "End session" mid-run, or the console was
// reopened after the fact): every field the REPLAY gating (`isTerminalRunStatus` in `lib/status.ts`,
// consumed via `RunConsole`'s `streamIsTerminal`) and the status badge need.
const ENDED_STREAM: RunStreamState = {
  status: "ended",
  outcome: "ended",
  stopReasonCode: "session_ended",
  phase: null,
  queuePosition: null,
  phaseDeadlineAt: null,
  ratingState: "rated",
  steps: [],
  kpis: null,
  deltas: { text: "", reasoning: "" },
  deltasByTurn: {},
  error: null,
  questions: [],
  timeline: [],
};

// The console reads only `ensureAuthenticated` off the MCP-auth context; stub it (never called on a
// pre-run mount, but the hook must resolve).
vi.mock("../servers/McpAuthProvider", () => ({
  useMcpAuth: () => ({ ensureAuthenticated: vi.fn(), requestReauth: vi.fn() }),
}));

// WP3.fix — an existing-run target (the "ended" replay test) fires the replay-KPI-snapshot fetch
// (`getRun`), the mount-time `markRunSeen` bookkeeping call, and (via the real, unmocked `GradePanel`
// the replay right-rail renders) `getRunGrades`; stub all three so the test never hits a real network
// call. Every other export (startRun, stopRun, endRun, …) stays real — none are invoked without a
// user action the test never performs.
// WP 2.5 — the real, unmocked `RunBar` now self-fetches its run-level feedback header
// (`listRunFeedback`) on mount; stub it too so it never hits a real network call.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getRun: vi.fn().mockRejectedValue(new Error("not needed for this test")),
    markRunSeen: vi.fn().mockResolvedValue(undefined),
    getRunGrades: vi.fn().mockResolvedValue({ grades: [], latest: [] }),
    listRunFeedback: vi.fn().mockResolvedValue([]),
  };
});

import {
  coerceLeftView,
  isLeftView,
  LEFT_VIEW_TABS,
  LEFT_VIEW_VALUES,
  paneToLeftView,
  RunConsole,
} from "./RunConsole";
import type { ConsolePane } from "./console-anchors";

beforeAll(() => {
  // The @brand/ui layout (AdaptivePanelGroup → useIsMobile; ResizablePanelGroup) reads matchMedia +
  // ResizeObserver, which jsdom doesn't implement. Minimal no-op stubs so the split can mount.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function makeTest(): Test {
  return {
    id: "test-1",
    name: "Flights on-time",
    userPrompt: "How on-time are flights?",
    addedProfiles: [],
    attachments: [],
    tags: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

function makeScenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: "env-1",
    name: "BARC on-time",
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
    ...over,
  };
}

const ENGINE_CAPS: SessionCapabilities = {
  liveText: true,
  liveReasoning: "raw",
  toolCalls: true,
  contextWindow: true,
  tokens: "exact",
  costBasis: "api_exact",
  followUps: true,
  askUser: true,
};

const NO_CONTEXT_CAPS: SessionCapabilities = {
  liveText: true,
  liveReasoning: "none",
  toolCalls: true,
  contextWindow: false,
  tokens: "exact",
  costBasis: "subscription_reference",
  followUps: true,
  askUser: false,
};

function renderConsole(
  capabilities: SessionCapabilities = ENGINE_CAPS,
  scenario: Scenario = makeScenario(),
) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <RunConsole
          target={{ kind: "prerun", test: makeTest(), scenario }}
          providerLabel="Anthropic"
          capabilities={capabilities}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("RunConsole — capability-driven context-window chrome (WP 3.2, D-US4)", () => {
  test("contextWindow:true manifest: BOTH the context chart and the turn-0 baseline render", () => {
    renderConsole(ENGINE_CAPS);

    expect(screen.getByTestId("context-chart")).toBeInTheDocument();
    expect(screen.getByText("Turn-0 baseline")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
  });

  test("contextWindow:false manifest: NEITHER the context chart nor the turn-0 baseline renders", () => {
    renderConsole(NO_CONTEXT_CAPS);

    expect(screen.queryByTestId("context-chart")).not.toBeInTheDocument();
    expect(screen.queryByText("Turn-0 baseline")).not.toBeInTheDocument();
    // the meaningless "Context" tile is gone from the rail too.
    expect(screen.queryByText("Context")).not.toBeInTheDocument();
  });
});

// interface-craft WP 1.2 (finding 7) — the SSE run stream had no live region: streamed turns/tool-
// calls/status transitions were silent to a screen reader. The Chat tab's transcript region is now
// wrapped in `role="log" aria-live="polite"` (the same pattern `AgentTranscript.tsx:62-64` already
// uses). This is a STRUCTURAL assertion only — jsdom can't tell us whether a real screen reader
// actually ANNOUNCES the region; that half is owner-acceptance (needs a live AT/browser pair).
// `renderConsole`'s default `target: {kind: "prerun"}` never mounts the Chat tab at all (it shows
// the "Ready to run" launcher instead) — the tabbed body only exists once a run has started, so this
// reuses the same `target: {kind: "run", ...}` + `streamOverride` shape the "ended run" describe
// block below already established.
describe("RunConsole — the transcript region is a live region (interface-craft WP 1.2, finding 7)", () => {
  afterEach(() => {
    streamOverride = null;
  });

  function renderRunningConsole() {
    streamOverride = ENDED_STREAM;
    return render(
      <MemoryRouter>
        <TooltipProvider>
          <RunConsole
            target={{
              kind: "run",
              runId: "run-log-region-1",
              test: makeTest(),
              scenario: makeScenario(),
              mode: "interactive",
              replay: false,
            }}
            providerLabel="Anthropic"
            capabilities={ENGINE_CAPS}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
  }

  test("the Chat tab's transcript wrapper carries role=log + aria-live=polite (structural — SR announcement not tested)", async () => {
    renderRunningConsole();

    // Chat is the default `leftView`, so its `TabPanelContent` is mounted once the console leaves
    // the pre-run shell. `findBy*` flushes the mocked replay-KPI/grades fetches (see the "ended run"
    // describe above) before asserting.
    const log = await screen.findByTestId("run-console-transcript-log");
    expect(log).toHaveAttribute("role", "log");
    expect(log).toHaveAttribute("aria-live", "polite");
  });

  test("only ONE transcript log region renders (no duplicate live region fighting for AT attention)", async () => {
    renderRunningConsole();
    await screen.findByTestId("run-console-transcript-log");
    expect(screen.getAllByRole("log")).toHaveLength(1);
  });
});

// WP3.fix (WP3.R Defect 1) — `ended` was missing from `RunConsole.tsx`'s private `isTerminalRunStatus`
// copy, so an operator-ended interactive session never flipped into replay: it kept the live shell (an
// active composer, Stop/End-session controls, no Locked chip) instead of read-only replay. Fixed by
// routing through the shared `isTerminalRunStatus` (`lib/status.ts`), which correctly includes `ended`.
describe("RunConsole — an ended run opens in replay/read-only mode (WP3.fix, WP3.R Defect 1)", () => {
  afterEach(() => {
    streamOverride = null;
  });

  test("stream status `ended` renders the Locked chip + Replay controls, never Stop/End session", async () => {
    streamOverride = ENDED_STREAM;
    render(
      <MemoryRouter>
        <TooltipProvider>
          <RunConsole
            target={{
              kind: "run",
              runId: "run-ended-1",
              test: makeTest(),
              scenario: makeScenario(),
              mode: "interactive",
              // Deliberately FALSE: this exercises RunConsole's OWN terminal check (fed by the live
              // stream's `status`), not the `replay` hint a caller like `RunConsoleRoute` would also
              // set for an already-persisted terminal run.
              replay: false,
            }}
            providerLabel="Anthropic"
            capabilities={ENGINE_CAPS}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );

    // Replay/read-only chrome renders (async: `findBy*` flushes the mocked `getRun`/`getRunGrades`
    // promises inside `act`, so the right-rail GradePanel's post-mount state update doesn't warn).
    expect(await screen.findByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("Replay")).toBeInTheDocument();
    expect(screen.getByText("Export session log")).toBeInTheDocument();
    // …and the live-shell controls are gone (never offer Stop/End on a finished session).
    expect(screen.queryByText("Stop")).not.toBeInTheDocument();
    expect(screen.queryByText("End session")).not.toBeInTheDocument();
  });
});

// Observability WP 3.4 — in-run search + view lenses. Exercises the REAL `StepLog`/`TurnsLens`
// (unmocked — only `ConversationPane`/`AnalyticsPanel`/`TraceTimeline`/`PacketInspector`/`ConsolePanel`
// stay stubbed, per the file-level mocks above) against a LIVE (non-terminal, non-replay) run so no
// `getRun`/`getRunGrades`/FTS network call is ever needed.
function LocationProbe() {
  const [params] = useSearchParams();
  return <div data-testid="url-probe">{params.toString()}</div>;
}

function treeStep(over: Partial<RunStep> & Pick<RunStep, "id" | "type">): RunStep {
  return {
    runId: "run-search-1",
    index: 0,
    label: over.type,
    status: "ok",
    profileTokens: {},
    payload: {},
    ...over,
  } as RunStep;
}

describe("RunConsole — in-run search + view lenses (Observability WP3.4)", () => {
  afterEach(() => {
    streamOverride = null;
  });

  function renderRunningConsole(initialEntry = "/") {
    const toolCallStep = treeStep({
      id: "run:step:1",
      type: "tool_call",
      toolName: "search_docs",
      label: "search_docs",
      payload: { toolCallId: "c1", args: { query: "widgets" } },
    });
    streamOverride = {
      status: "running",
      ratingState: null,
      phase: null,
      queuePosition: null,
      phaseDeadlineAt: null,
      steps: [
        toolCallStep,
        treeStep({
          id: "run:mcp:1:io",
          type: "context_event",
          spanKind: "tool_io",
          parentStepId: "run:step:1",
          label: "tool_io detail",
        }),
      ],
      kpis: null,
      deltas: { text: "", reasoning: "" },
      deltasByTurn: {},
      error: null,
      questions: [],
      // `collectLiveSearchHits` (the in-run search) reads the TIMELINE, not the raw steps — mirror
      // what `buildTimeline` would produce for this run's one tool call so the "widgets" query can
      // actually find it (the mocked `useRunStream` bypasses the real hook's own timeline derivation).
      timeline: [
        {
          kind: "assistant_turn",
          id: "turn-0",
          turnIndex: 0,
          toolCalls: [{ id: "c1", toolName: "search_docs", call: toolCallStep }],
          status: "running",
          streaming: false,
        },
      ],
    };
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <TooltipProvider>
          <LocationProbe />
          <RunConsole
            target={{
              kind: "run",
              runId: "run-search-1",
              test: makeTest(),
              scenario: makeScenario(),
              mode: "automated",
              replay: false,
            }}
            providerLabel="Anthropic"
            capabilities={ENGINE_CAPS}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
  }

  test("the lens switcher + search box are seeded from `?lens=&find=` on mount", async () => {
    renderRunningConsole("/?lens=turns&find=widgets");

    // Turns lens is showing (its real, unmocked one-card render for this run's single tool-call turn)
    // — proves `?lens=turns` was consumed at mount, not the default "Conversation". `findBy*` flushes
    // TurnsLens's mocked `listRunFeedback` promise inside `act` (mirrors the other async-lookup tests).
    expect(await screen.findByText("Turn 1")).toBeInTheDocument();
    // The search box seeded its value from `?find=`.
    const input = screen.getByLabelText("Search this run") as HTMLInputElement;
    expect(input.value).toBe("widgets");
  });

  // A-1 (toolbar-reach WP 0.1) — Steps/Turns/Chat are now pills in the ONE merged `TabPanel` strip
  // (the "Console view" ToggleGroup was deleted), so drive them as tabs, not radios. Radix tabs
  // select on pointer/mousedown (the same pattern DashboardView/SuiteRunConsole tests use).
  const clickTab = (name: string) =>
    fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

  test("switching the view tab writes `?lens=` back to the URL (round-trip)", () => {
    renderRunningConsole("/");
    expect(screen.getByTestId("url-probe").textContent).toBe("");

    clickTab("Steps");
    expect(screen.getByTestId("url-probe").textContent).toBe("lens=steps");

    clickTab("Turns");
    expect(screen.getByTestId("url-probe").textContent).toBe("lens=turns");

    // A non-chat view persists as `?lens=<value>` too — proving the write side restores across the
    // full merged strip, not just the former Steps/Turns lenses.
    clickTab("Trace");
    expect(screen.getByTestId("url-probe").textContent).toBe("lens=raw");

    // Back to "Chat" (the default) clears `?lens=` entirely rather than writing `lens=chat`.
    clickTab("Chat");
    expect(screen.getByTestId("url-probe").textContent).toBe("");
  });

  test("typing a query finds a live tool-call match, shows the count + prev/next, and n/p cycles it", () => {
    renderRunningConsole("/");
    const input = screen.getByLabelText("Search this run");
    fireEvent.change(input, { target: { value: "widgets" } });

    // One live hit (the tool_call's args), surfaced as a count chip.
    expect(screen.getByText("1 / 1")).toBeInTheDocument();

    // `n`/`p` are wired at the window level; typing them while focus is OUTSIDE any text field must
    // not throw and must leave the single match active (nothing to cycle TO with just one hit).
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
  });

  test('the Steps lens\' "Filtered only"/"Show all" toggle reflects the SAME query the search box drives', () => {
    renderRunningConsole("/?lens=steps");
    const input = screen.getByLabelText("Search this run");
    fireEvent.change(input, { target: { value: "widgets" } });

    // The toggle only appears once a query is active, and appears in EVERY StepLog mount driven by
    // this same query (the left-pane Steps lens here; the right-pane Network tab renders a second
    // copy, so `getAllByText` — not `getByText` — is correct).
    expect(screen.getAllByText("Filtered only").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Show all").length).toBeGreaterThan(0);
  });

  test("switching lenses preserves the selected step (the scroll/inspector anchor stays put)", () => {
    renderRunningConsole("/?lens=steps");

    // Select the tool_call row in the Steps lens.
    const [stepsLensRow] = screen.getAllByTitle("search_docs");
    expect(stepsLensRow).toBeDefined();
    fireEvent.click(stepsLensRow as HTMLElement);
    const probe = () => screen.getByTestId("packet-inspector-probe");
    expect(probe().dataset.selectedStepId).toBe("run:step:1");

    // Switch to Turns, then to Chat — the selection must survive both hops untouched.
    clickTab("Turns");
    expect(probe().dataset.selectedStepId).toBe("run:step:1");
    clickTab("Chat");
    expect(probe().dataset.selectedStepId).toBe("run:step:1");
  });
});

// A-1 (toolbar-reach WP 0.1) — the invariants that make the switcher-merge safe: the run console has
// exactly ONE view switcher, every tab has a panel and every panel a tab, and NO code path can put
// `leftView` on a value that switcher does not render. These are structural (they read the source +
// the exported allow-list/coercers), so they hold without a provider key or a live run.
describe("RunConsole — left-view strip invariants (A-1, toolbar-reach WP 0.1)", () => {
  const EXPECTED = ["chat", "steps", "turns", "raw", "analytics", "report"] as const;
  // Read RunConsole.tsx's own source to assert source-level invariants. vitest runs with cwd =
  // apps/web (its config's `include` is a package-relative glob); fall back to the repo-root-relative
  // path so this is robust to the cwd. (`import.meta.url` isn't a `file:` URL under jsdom vitest.)
  const readSource = () => {
    const rel = "src/features/testing/RunConsole.tsx";
    const path = existsSync(resolve(rel)) ? resolve(rel) : resolve("apps/web", rel);
    return readFileSync(path, "utf8");
  };

  test("LEFT_VIEW_TABS is the ordered strip Chat · Steps · Turns · Trace · Analytics · Report", () => {
    expect(LEFT_VIEW_TABS.map((t) => t.value)).toEqual(EXPECTED);
    expect(LEFT_VIEW_TABS.map((t) => t.label)).toEqual([
      "Chat",
      "Steps",
      "Turns",
      "Trace", // historical mapping: the Trace pill's value is `raw`
      "Analytics",
      "Report",
    ]);
    expect(LEFT_VIEW_VALUES).toEqual(EXPECTED);
  });

  test("the strip's tab-value set === the TabPanelContent panel-value set (no orphan on either side)", () => {
    const source = readSource();
    // The strip is BUILT from LEFT_VIEW_TABS (not a hand-written array that could drift), so its tab
    // values are exactly LEFT_VIEW_VALUES…
    expect(source).toMatch(/tabs=\{LEFT_VIEW_TABS\.map\(/);
    // …and every rendered `<TabPanelContent value="X">` must be one of those values, and vice versa.
    const panelValues = [...source.matchAll(/<TabPanelContent value="([a-z]+)"/g)].map((m) => m[1]);
    expect(new Set(panelValues)).toEqual(new Set(LEFT_VIEW_VALUES));
    // exactly six panels, one per tab (no duplicate/extra panel on the JSX side).
    expect([...panelValues].sort()).toEqual([...LEFT_VIEW_VALUES].sort());
  });

  test("the deleted `ToggleGroup` switcher and its coercing ternary are gone (grep-clean)", () => {
    const source = readSource();
    // No second switcher renders…
    expect(source).not.toMatch(/<ToggleGroup[\s/>]/);
    // …it is no longer imported…
    expect(source).not.toMatch(/^\s*ToggleGroup(Item)?,\s*$/m);
    // …and the old `leftView === "steps" || leftView === "turns" ? …` coercing ternary is removed.
    expect(source).not.toMatch(/leftView === "steps"/);
  });

  test("coerceLeftView (the `?lens=` mount seam) never yields a value outside the strip", () => {
    // legacy alias, absent, junk, and a non-strip pane name all fall back to a real strip value…
    for (const input of ["conversation", null, undefined, "", "bogus", "trace", "CHAT", "Steps"]) {
      expect(LEFT_VIEW_VALUES).toContain(coerceLeftView(input));
    }
    // …the legacy lens name maps to chat, and anything unknown defaults to chat…
    expect(coerceLeftView("conversation")).toBe("chat");
    expect(coerceLeftView(null)).toBe("chat");
    expect(coerceLeftView("bogus")).toBe("chat");
    // …and every real strip value round-trips unchanged (so a deep link restores it).
    for (const v of LEFT_VIEW_VALUES) {
      expect(coerceLeftView(v)).toBe(v);
      expect(isLeftView(v)).toBe(true);
    }
  });

  test("paneToLeftView (the navigateTo mapping) only ever yields a strip value", () => {
    const panes: ConsolePane[] = ["chat", "trace"];
    for (const pane of panes) {
      expect(LEFT_VIEW_VALUES).toContain(paneToLeftView(pane));
    }
    // the specific mapping the console relies on: Trace ↔ the `raw` pill; every other link → chat.
    expect(paneToLeftView("trace")).toBe("raw");
    expect(paneToLeftView("chat")).toBe("chat");
  });
});
