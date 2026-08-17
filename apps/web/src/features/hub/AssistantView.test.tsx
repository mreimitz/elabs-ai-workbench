import type {
  HubEvent,
  HubMissionPlan,
  HubPlannedAgent,
  HubSession,
  HubSessionDetail,
  ProviderCredential,
} from "@mcp-token-footprint/shared";
import { type ReactNode, useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import { BreadcrumbSlotProvider } from "../../components/breadcrumb-slot";

// WP1.1/WP1.3 — mirrors AssistantDock.test.tsx / RunConsole.test.tsx: stub the heavy `@brand/ai`
// surface (shiki/mermaid/streamdown never enter jsdom) with a shared, reusable stub (see
// `test-support/brand-ai-mock.tsx`'s doc comment for what's a real passthrough vs. a working stand-in).
vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
    listHubSessions: vi.fn(),
    listHubProjects: vi.fn(),
    createHubSession: vi.fn(),
    getHubSession: vi.fn(),
    markHubSessionSeen: vi.fn(),
    sendHubMessage: vi.fn(),
    stopHubSession: vi.fn(),
    setHubAutonomy: vi.fn(),
    openHubSessionStream: vi.fn(() => () => undefined),
    // fix-web WP1.R GAP-E — the mission client wrappers (see `lib/api.ts`'s mission block).
    proposeHubMission: vi.fn(),
    approveHubMission: vi.fn(),
    editHubMissionPlan: vi.fn(),
    stopHubMission: vi.fn(),
    stopHubMissionAgent: vi.fn(),
    // WP1.8 integration — the meta rail's async data reads (Outputs + Context). `hubFileContentUrl`
    // stays REAL (a pure URL builder, not a fetch) via the `...actual` spread above.
    listHubArtifacts: vi.fn(),
    listHubSessionFiles: vi.fn(),
    listHubWorkspaceSnapshots: vi.fn(),
    restoreHubWorkspaceSnapshot: vi.fn(),
    getHubProject: vi.fn(),
    listHubProjectFiles: vi.fn(),
    getHubProjectFile: vi.fn(),
    getHubSessionContext: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { AssistantView } from "./AssistantView";

function credential(overrides: Partial<ProviderCredential> = {}): ProviderCredential {
  return {
    id: "cred-1",
    kind: "anthropic",
    label: "Anthropic",
    hasKey: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Scan comparison chat",
    titleState: "auto",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "completed",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T09:00:00.000Z",
    updatedAt: "2026-07-17T09:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

function detail(s: HubSession): HubSessionDetail {
  return { session: s, events: [] };
}

// WP1.8 integration — `EmptySessionIntro` (`useReducedMotion`) and the meta rail's `useMetaRailNarrow`
// both call `matchMedia` unconditionally on mount. jsdom omits it, so stub it for every test: `matches:
// false` means NOT reduced-motion (so a fresh session's centered intro paints + its starter chips join
// the a11y tree) AND NOT narrow (so the rail renders as an inline column, not a `Sheet`).
beforeEach(() => {
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
});

/** A minimal valid `HubContextInspector` for the meta rail's Context section (mirrors
 *  `meta-rail/ContextSection.test.tsx`'s fixture). */
function inspectorFixture(): import("@mcp-token-footprint/shared").HubContextInspector {
  return {
    sessionId: "s1",
    model: "claude-sonnet-5",
    contextWindow: 200_000,
    promptSections: [
      { id: "identity", title: "Identity", tokens: 80, budgetTokens: 120, withinBudget: true },
    ],
    promptTotalTokens: 80,
    tools: {
      mode: "eager",
      totalTokens: 500,
      residentTokens: 500,
      savingsPercent: 0,
      resident: [],
      deferred: [],
      builtins: [],
    },
    skills: { usage: [], totalTokens: 0 },
    memory: { tokens: 0, itemCount: 0 },
    project: null,
    history: { tokens: 0, messageCount: 0 },
    estimatedTotalTokens: 580,
  };
}

/** Resolve the meta rail's async data reads to empty/quiet defaults (each `stub*Configured` calls this
 *  so the wired `MetaRail` renders without touching the network). */
function stubRailData(): void {
  vi.mocked(api.listHubArtifacts).mockResolvedValue([]);
  vi.mocked(api.listHubSessionFiles).mockResolvedValue([]);
  vi.mocked(api.listHubWorkspaceSnapshots).mockResolvedValue([]);
  vi.mocked(api.listHubProjectFiles).mockResolvedValue([]);
  vi.mocked(api.getHubSessionContext).mockResolvedValue(inspectorFixture());
}

/** Reflects the current route so a "View all sessions" navigation is observable. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

/**
 * Session identity now lives in the breadcrumb switcher (end-user UX pass) — a `Popover` `Button`
 * with an explicit `aria-label="Switch session"`, relocated out of the toolbar. It's contributed
 * through the breadcrumb SLOT (see `breadcrumb-slot.tsx`), which the real app renders in `AppShell`'s
 * TopNav; the {@link BreadcrumbHarness} below stands in for that so the switcher mounts in this
 * standalone render. The trigger's text content is the active session's title.
 */
function switcherTrigger(): HTMLElement {
  return screen.getByRole("button", { name: "Switch session" });
}

/** Mirrors `AppShell`'s breadcrumb-slot ownership: a page contributes its trailing crumb via
 *  `useSetBreadcrumbSlot`, and the shell renders it. Here we render the slot node above the routed
 *  view so the relocated session switcher is present in the test DOM. */
function BreadcrumbHarness({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<ReactNode>(null);
  return (
    <BreadcrumbSlotProvider value={{ slot, setSlot }}>
      {slot}
      {children}
    </BreadcrumbSlotProvider>
  );
}

function renderView(initialEntry = "/assistant") {
  return render(
    // `AutonomyDial`'s helper text now rides a real `@brand/ui` `Tooltip` (WP1.1's clipping fix) —
    // Radix's `Tooltip` primitive requires a `TooltipProvider` ancestor (the app root mounts one for
    // real; this mirrors that for the standalone render, same as `ViewToolbar.test.tsx`'s own info
    // tooltip).
    <TooltipProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <BreadcrumbHarness>
          <Routes>
            <Route path="/assistant" element={<AssistantView />} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </BreadcrumbHarness>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("AssistantView — not configured", () => {
  test("no usable provider credential shows the not-configured gate, never the composer", async () => {
    vi.mocked(api.listProviders).mockResolvedValue([]);
    vi.mocked(api.listHubSessions).mockResolvedValue([]);

    renderView();

    await waitFor(() =>
      expect(screen.getByText("The Assistant isn't configured")).toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: /open settings/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ask the assistant/i)).not.toBeInTheDocument();
  });
});

describe("AssistantView — workspace shell & toolbar (WP1.1)", () => {
  function stubConfigured(sessions: HubSession[]): void {
    vi.mocked(api.listProviders).mockResolvedValue([credential()]);
    vi.mocked(api.listProviderModels).mockResolvedValue({
      source: "provider",
      models: [{ id: "claude-sonnet-5" }],
    });
    vi.mocked(api.listHubSessions).mockResolvedValue(sessions);
    vi.mocked(api.listHubProjects).mockResolvedValue([]);
    vi.mocked(api.markHubSessionSeen).mockResolvedValue(undefined);
    stubRailData();
  }

  test("no fixed-height inner frame remains (D-HUX1) — PageShell owns the viewport-filling height", async () => {
    const s = session();
    stubConfigured([s]);
    vi.mocked(api.getHubSession).mockResolvedValue(detail(s));

    const { container } = renderView();
    await waitFor(() =>
      expect(screen.getAllByText("Scan comparison chat").length).toBeGreaterThan(0),
    );

    // The old shell wrapped everything in a `min-h-[36rem]` fixed frame — assert it's gone.
    expect(container.innerHTML).not.toContain("min-h-[36rem]");
    // The local icon+Heading page header ("Assistant" as a visible h1 + description paragraph) is
    // also gone — the only "Assistant" heading left is the sr-only one for assistive tech.
    const heading = screen.getByRole("heading", { level: 1, name: "Assistant" });
    expect(heading.className).toContain("sr-only");
  });

  test("auto-selects the most recently updated session and renders the toolbar + composer", async () => {
    const older = session({ id: "s1", title: "Older chat", updatedAt: "2026-07-15T00:00:00.000Z" });
    const newer = session({ id: "s2", title: "Newer chat", updatedAt: "2026-07-17T00:00:00.000Z" });
    stubConfigured([newer, older]);

    renderView();

    // The switcher's trigger shows the AUTO-SELECTED (most recent) session's title.
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Newer chat"));
    // The composer input is a contenteditable MentionEditor; its placeholder is a span, not a
    // `placeholder` attribute — assert its presence by the placeholder text.
    expect(screen.getByText(/ask the assistant/i)).toBeInTheDocument();
    expect(api.markHubSessionSeen).toHaveBeenCalledWith("s2");
    // Autonomy now rides the composer footer (the `AutonomyModeSelect` mode menu), not the toolbar.
    // hub-fixes WP6.2 (RC7) — the trigger's accessible name carries the "Autonomy:" prefix now, so it
    // reads as distinct from the (separate) session mode chip next to the model chip.
    expect(screen.getByRole("button", { name: "Autonomy: Ask every time" })).toBeInTheDocument();
  });

  test("empty session list shows the switcher's placeholder and the 'no session open' empty state", async () => {
    stubConfigured([]);
    renderView();
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Select a session"));
    // "No session open" now appears in BOTH the main area and the rail's Context section (each region
    // gets its own empty state, D-HUX14); disambiguate on the main empty state's unique action button.
    expect(screen.getByRole("button", { name: "New session" })).toBeInTheDocument();
  });

  test("the switcher lists recent sessions and switching selects the chosen one", async () => {
    const older = session({ id: "s1", title: "Older chat", updatedAt: "2026-07-15T00:00:00.000Z" });
    const newer = session({ id: "s2", title: "Newer chat", updatedAt: "2026-07-17T00:00:00.000Z" });
    stubConfigured([newer, older]);
    vi.mocked(api.getHubSession).mockResolvedValue(detail(older));

    renderView();
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Newer chat"));

    fireEvent.click(switcherTrigger());
    // The popover lists every session as a row; "Older chat" appears only in the list (the header
    // shows the active "Newer chat"), so clicking that text selects the older session.
    fireEvent.click(await screen.findByText("Older chat"));

    await waitFor(() => expect(api.markHubSessionSeen).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Older chat"));
  });

  test("'View all sessions' in the switcher navigates to /assistant/sessions (D-HUX4)", async () => {
    const s = session();
    stubConfigured([s]);
    vi.mocked(api.getHubSession).mockResolvedValue(detail(s));

    renderView();
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Scan comparison chat"));

    fireEvent.click(switcherTrigger());
    fireEvent.click(await screen.findByRole("button", { name: "View all sessions →" }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/assistant/sessions"),
    );
  });

  test("'+ New session' in the switcher opens NewSessionDialog, and creating selects the fresh session", async () => {
    stubConfigured([]);
    const created = session({ id: "s-new", title: "New conversation" });
    vi.mocked(api.createHubSession).mockResolvedValue(created);

    renderView();
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Select a session"));

    fireEvent.click(switcherTrigger());
    // Scope to the switcher popover — the "no session open" empty state also renders a "New session"
    // button, so an unscoped role query would be ambiguous.
    const popover = await screen.findByTestId("session-switcher-popover");
    fireEvent.click(within(popover).getByRole("button", { name: "New session" }));
    expect(screen.getByRole("heading", { name: "New session" })).toBeInTheDocument(); // the dialog title

    fireEvent.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() =>
      // hub-fixes WP6.1 — the dialog now DEFAULTS to `auto` (mode left untouched here).
      // model-identity WP 3.1 (D-MI1) — the credential the model was picked from rides along.
      expect(api.createHubSession).toHaveBeenCalledWith({
        mode: "auto",
        model: "claude-sonnet-5",
        providerCredentialId: "cred-1",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/ask the assistant/i)).toBeInTheDocument(),
    );
  });

  test("landing with ?new=1 (the nav '＋ New session' target) opens NewSessionDialog", async () => {
    stubConfigured([]);
    renderView("/assistant?new=1");
    // The AppShell nav's hover action + collapsed-rail item both navigate to `/assistant?new=1`;
    // AssistantView consumes the param and opens the dialog on arrival.
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "New session" })).toBeInTheDocument(),
    );
  });

  test("the rail toggle shows/hides the meta rail region as a whole (D-HUX3)", async () => {
    const s = session();
    stubConfigured([s]);
    vi.mocked(api.getHubSession).mockResolvedValue(detail(s));

    renderView();
    // The wide rail stays MOUNTED and animates (it no longer unmounts) — presence is the wrapper
    // being NOT inert, and it carries its own header collapse control. (interface-craft WP 1.3 /
    // D-IC4 finding 8: the closed rail now uses `inert` — which removes pointer AND tab access in one
    // attribute — instead of the former `aria-hidden` + `pointer-events-none`; this cross-domain test
    // was updated by the PM at Batch H integration to assert the new, correct attribute.)
    await waitFor(() =>
      expect(screen.getByTestId("meta-rail-wide")).not.toHaveAttribute("inert"),
    );
    expect(screen.getByRole("button", { name: "Hide the rail" })).toBeInTheDocument();

    // Collapsing it (the rail's own header control) makes the wrapper `inert` and floats the chat
    // canvas's "Show the rail" expand button.
    fireEvent.click(screen.getByRole("button", { name: "Hide the rail" }));
    await waitFor(() =>
      expect(screen.getByTestId("meta-rail-wide")).toHaveAttribute("inert"),
    );
    const showRail = screen.getByRole("button", { name: "Show the rail" });

    // Re-opening from the canvas floating button restores the rail.
    fireEvent.click(showRail);
    await waitFor(() =>
      expect(screen.getByTestId("meta-rail-wide")).not.toHaveAttribute("inert"),
    );
  });

  test("changing the autonomy mode calls setHubAutonomy for the active session", async () => {
    const s = session();
    stubConfigured([s]);
    vi.mocked(api.getHubSession).mockResolvedValue(detail(s));
    vi.mocked(api.setHubAutonomy).mockResolvedValue({ ...s, autonomy: "auto" });

    renderView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Autonomy: Ask every time" })).toBeInTheDocument(),
    );

    // Open the composer-footer mode menu (a real @brand/ui Popover) and pick "Auto". `\b` keeps the
    // auto row's accessible name (`/^Auto\b/`) from also matching the trigger's "Autonomy: Ask every
    // time" (hub-fixes WP6.2/RC7 — the "Autonomy:" prefix).
    fireEvent.click(screen.getByRole("button", { name: "Autonomy: Ask every time" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Auto\b/ }));

    await waitFor(() => expect(api.setHubAutonomy).toHaveBeenCalledWith("s1", "auto"));
  });

  test("a starter chip click sends the prompt through sendHubMessage", async () => {
    const s = session();
    stubConfigured([s]);
    vi.mocked(api.getHubSession).mockResolvedValue(detail(s));
    vi.mocked(api.sendHubMessage).mockResolvedValue({ sessionId: s.id, streamUrl: "/x" });

    renderView();
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Scan comparison chat"));

    const starter = screen.getByRole("button", { name: "Summarize my last MCP scan" });
    fireEvent.click(starter);

    await waitFor(() =>
      expect(api.sendHubMessage).toHaveBeenCalledWith("s1", { text: "Summarize my last MCP scan" }),
    );
  });
});

// ── Wave-1 integration (WP1.8) — the REAL MetaRail · ChatCanvas · EmptySessionIntro are now wired into
// AssistantView's slots (the Wave-1 placeholders are gone). ────────────────────────────────────────────
describe("AssistantView — Wave-1 integration (WP1.8)", () => {
  function stubConfigured(sessions: HubSession[]): void {
    vi.mocked(api.listProviders).mockResolvedValue([credential()]);
    vi.mocked(api.listProviderModels).mockResolvedValue({
      source: "provider",
      models: [{ id: "claude-sonnet-5" }],
    });
    vi.mocked(api.listHubSessions).mockResolvedValue(sessions);
    vi.mocked(api.listHubProjects).mockResolvedValue([]);
    vi.mocked(api.markHubSessionSeen).mockResolvedValue(undefined);
    stubRailData();
    for (const s of sessions) vi.mocked(api.getHubSession).mockResolvedValue(detail(s));
  }

  /** Make the mocked SSE stream synchronously replay a fixed event log on connect. */
  function stubStreamEvents(events: HubEvent[]): void {
    vi.mocked(api.openHubSessionStream).mockImplementation((_sessionId, on) => {
      for (const event of events) on(event);
      return () => undefined;
    });
  }

  beforeEach(() => {
    // No streamed events by default (a fresh, empty session) — the history test overrides this.
    vi.mocked(api.openHubSessionStream).mockImplementation(() => () => undefined);
  });

  test("the real meta rail renders its Progress · Outputs · Context sections (not the Wave-1 placeholder)", async () => {
    const s = session();
    stubConfigured([s]);

    renderView();
    await waitFor(() => expect(screen.getByText("Progress")).toBeInTheDocument());
    expect(screen.getByText("Outputs")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    // The Wave-1 placeholder EmptyState is gone.
    expect(screen.queryByText("Meta rail")).not.toBeInTheDocument();
  });

  test("a fresh session (no history) opens the centered first-prompt intro (D-HUX13)", async () => {
    const s = session();
    stubConfigured([s]);

    renderView();
    await waitFor(() => expect(screen.getByTestId("empty-session-intro")).toBeInTheDocument());
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute(
      "data-dock-state",
      "centered",
    );
  });

  test("a session opened WITH history starts docked instantly (D-HUX13)", async () => {
    const s = session();
    stubConfigured([s]);
    // A single prior user message means the timeline is non-empty on open → docked from first render.
    stubStreamEvents([
      { type: "user_message", messageId: "u1", text: "earlier turn", seq: 1 } as HubEvent,
    ]);

    renderView();
    await waitFor(() => expect(screen.getByTestId("empty-session-intro")).toBeInTheDocument());
    expect(screen.getByTestId("empty-session-intro")).toHaveAttribute("data-dock-state", "docked");
  });
});

// ── T3 fix — at a mainstream laptop width (1280×800, BELOW the rail's ~1460px `Sheet`-fallback
// breakpoint: META_RAIL_SHEET_BREAKPOINT_PX 1100 + META_RAIL_WIDTH_PX 360), the meta rail must NOT
// auto-open over the conversation on load, and once dismissed it must stay reachable (no page reload
// required) at every width. Regression coverage for the defect: `useState(true)` unconditionally
// seeded `metaRailVisible`, and `railHidden={railNarrow ? false : !metaRailVisible}` suppressed the
// only reopen affordance whenever `railNarrow` was true — together they left the transcript dimmed/
// blurred/`pointer-events:none` behind a Sheet nobody opened, with no way back in short of a reload. ──
describe("AssistantView — narrow rail must not auto-open (T3 fix)", () => {
  function stubConfigured(sessions: HubSession[]): void {
    vi.mocked(api.listProviders).mockResolvedValue([credential()]);
    vi.mocked(api.listProviderModels).mockResolvedValue({
      source: "provider",
      models: [{ id: "claude-sonnet-5" }],
    });
    vi.mocked(api.listHubSessions).mockResolvedValue(sessions);
    vi.mocked(api.listHubProjects).mockResolvedValue([]);
    vi.mocked(api.markHubSessionSeen).mockResolvedValue(undefined);
    stubRailData();
    for (const s of sessions) vi.mocked(api.getHubSession).mockResolvedValue(detail(s));
  }

  beforeEach(() => {
    // A real 1280×800 viewport would also report these — set them alongside the `matchMedia` stub so
    // the fixture reads as a genuine narrow laptop, even though `useMetaRailNarrow` only consults
    // `matchMedia` (jsdom implements neither a real viewport nor the media-query cascade).
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    window.matchMedia = ((query: string) => ({
      matches: true, // narrow: true for every query this tree touches (mirrors the file's own default stub)
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    vi.mocked(api.openHubSessionStream).mockImplementation(() => () => undefined);
  });

  test("on first render at 1280×800 the transcript is interactive — no auto-opened Sheet, reopen control present", async () => {
    const s = session();
    stubConfigured([s]);

    renderView();
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Scan comparison chat"));

    // The rail must NOT have auto-opened as a Sheet/dialog over the conversation.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The reopen affordance is present — proof the rail is currently hidden AND reachable (this is
    // the control the old `railHidden={railNarrow ? false : …}` branch suppressed in narrow mode).
    expect(screen.getByRole("button", { name: "Show the rail" })).toBeInTheDocument();
    // The composer is reachable/focusable directly — nothing sits over it with `pointer-events:none`.
    const composer = screen.getByTestId("mention-editor");
    composer.focus();
    expect(composer).toHaveFocus();
  });

  test("after opening then closing the narrow rail, the reopen affordance survives — reopenable without a reload", async () => {
    const s = session();
    stubConfigured([s]);

    renderView();
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Scan comparison chat"));

    fireEvent.click(screen.getByRole("button", { name: "Show the rail" }));
    // Confirms D-HUX3's narrow contract: an overlay Sheet, not a permanent blocking split.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Progress")).toBeInTheDocument();

    // Radix's DismissableLayer listens for Escape at the document level (mirrors
    // `ArtifactCanvas.test.tsx`'s "Escape closes the expand dialog").
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // The reopen affordance is back — the rail is reachable again with NO page reload.
    expect(screen.getByRole("button", { name: "Show the rail" })).toBeInTheDocument();
    // Focus lands on the composer, not `<body>` (T3 fix — the Sheet's `onCloseAutoFocus` is
    // overridden since this Sheet has no `SheetTrigger` of its own to return focus to).
    await waitFor(() => expect(screen.getByTestId("mention-editor")).toHaveFocus());
  });
});

// ── Missions (fix-web WP1.R GAP-E) — the mission is user-triggerable end to end: the FIRST message in
// a mission-mode session proposes a plan instead of a plain chat turn, and the real (unmocked)
// `ConversationPane`/`MissionPlanCard`/`MissionBoard` render in-band from the SAME event log the
// session's SSE stream replays — so wiring `missionHandlers` all the way from `AssistantView` down to
// a clicked button is exercised for real, not just asserted against a mock prop. These now run through
// the WIRED `chatCanvas` composition (WP1.8: `ChatCanvas` + `ConversationPane` + `EmptySessionIntro`) —
// mission cards still render in-band in the transcript, so keeping these green proves the integration
// preserved the mission propose→approve→run→stop/steer contract end to end. ────────────────────────────

function agent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.name ?? over.key,
    systemPrompt: "sys",
    model: "gpt-4o",
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: `Brief for ${over.key}`,
    target: `Target ${over.key}`,
    expectedOutcome: "A report",
    ...over,
  };
}

const MISSION_PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "always_ask",
  agents: [agent({ key: "a", name: "Researcher A" }), agent({ key: "b", name: "Researcher B" })],
  rationale: "Two disjoint subtopics.",
};

let missionSeq = 0;
function missionEvent<T extends HubEvent["type"]>(e: Extract<HubEvent, { type: T }>): HubEvent {
  return { ...e, seq: ++missionSeq } as HubEvent;
}

/** A still-`proposed` mission's event log — replays into the in-band `MissionPlanCard`. */
function proposedMissionEvents(): HubEvent[] {
  missionSeq = 0;
  const missionId = "mis-1";
  return [
    missionEvent({ type: "user_message", messageId: "u1", text: "Research X and Y" }),
    missionEvent({ type: "plan_proposed", missionId, plan: MISSION_PLAN }),
    missionEvent({ type: "turn_done" }),
  ];
}

/** An approved, running mission — one agent reported, one still waiting — so the board renders BOTH
 *  the stop-all control and the waiting agent's per-agent stop control. */
function runningMissionEvents(): HubEvent[] {
  missionSeq = 0;
  const missionId = "mis-1";
  return [
    missionEvent({ type: "user_message", messageId: "u1", text: "Research X and Y" }),
    missionEvent({ type: "plan_proposed", missionId, plan: MISSION_PLAN }),
    missionEvent({
      type: "plan_approved",
      missionId,
      autonomy: "always_ask",
      approvedBy: "user",
      auto: false,
    }),
    missionEvent({
      type: "agent_spawned",
      missionId,
      agentSessionId: "child-a",
      key: "a",
      roleName: "Researcher A",
      model: "claude-sonnet-5",
      index: 0,
    }),
    missionEvent({
      type: "agent_spawned",
      missionId,
      agentSessionId: "child-b",
      key: "b",
      roleName: "Researcher B",
      model: "gpt-4o",
      index: 1,
    }),
    missionEvent({ type: "mission_started", missionId, agentSessionIds: ["child-a", "child-b"] }),
    missionEvent({
      type: "agent_report",
      missionId,
      agentSessionId: "child-a",
      report: {
        findings: [{ summary: "A finding" }],
        citations: [],
        artifacts: [],
        confidence: "high",
        openQuestions: [],
      },
    }),
  ];
}

/** Makes the mocked `openHubSessionStream` synchronously "replay" a fixed event log on connect —
 *  mirroring the server's own replay-then-live SSE contract closely enough for these tests. */
function stubHubStream(events: HubEvent[]): void {
  vi.mocked(api.openHubSessionStream).mockImplementation((_sessionId, on) => {
    for (const event of events) on(event);
    return () => undefined;
  });
}

describe("AssistantView — missions (fix-web WP1.R GAP-E)", () => {
  // This file's mocks aren't auto-reset between tests (no global `clearMocks`, mirrors
  // `FeedbackControl.test.tsx`'s convention) — a prior test's `sendHubMessage`/mission-fn calls
  // would otherwise leak into a LATER test's `.not.toHaveBeenCalled()`/`.toHaveBeenCalledWith`
  // assertions, so reset every mock this describe block touches before each test.
  beforeEach(() => {
    vi.mocked(api.sendHubMessage).mockReset();
    vi.mocked(api.proposeHubMission).mockReset();
    vi.mocked(api.approveHubMission).mockReset();
    vi.mocked(api.editHubMissionPlan).mockReset();
    vi.mocked(api.stopHubMission).mockReset();
    vi.mocked(api.stopHubMissionAgent).mockReset();
    vi.mocked(api.openHubSessionStream).mockImplementation(() => () => undefined);
  });

  function stubMissionConfigured(s: HubSession): void {
    vi.mocked(api.listProviders).mockResolvedValue([credential()]);
    vi.mocked(api.listProviderModels).mockResolvedValue({
      source: "provider",
      models: [{ id: "claude-sonnet-5" }],
    });
    vi.mocked(api.listHubSessions).mockResolvedValue([s]);
    vi.mocked(api.markHubSessionSeen).mockResolvedValue(undefined);
    vi.mocked(api.getHubSession).mockResolvedValue(detail(s));
    stubRailData();
  }

  test("sending the first message in a mission-mode session proposes a plan, not a chat message", async () => {
    const s = session({ id: "s1", mode: "mission", title: "Research mission" });
    stubMissionConfigured(s);
    vi.mocked(api.proposeHubMission).mockResolvedValue({ sessionId: s.id, streamUrl: "/x" });

    renderView();
    await waitFor(() => expect(switcherTrigger()).toHaveTextContent("Research mission"));

    const starter = screen.getByRole("button", { name: "Summarize my last MCP scan" });
    fireEvent.click(starter);

    // model-identity WP6.1 (F7) — the call takes an INPUT OBJECT now, not a bare string, so the
    // composer's model + credential can ride along (they used to be dropped, and the `.strict()` body
    // would have 400'd on them). A starter click carries no model selection, so neither field is sent.
    await waitFor(() =>
      expect(api.proposeHubMission).toHaveBeenCalledWith("s1", {
        text: "Summarize my last MCP scan",
      }),
    );
    expect(api.sendHubMessage).not.toHaveBeenCalled();
  });


  test("Approve on the in-band plan card calls approveHubMission with the mission id", async () => {
    const s = session({ id: "s1", mode: "mission", title: "Research mission" });
    stubMissionConfigured(s);
    vi.mocked(api.approveHubMission).mockResolvedValue({ missionId: "mis-1", streamUrl: "/x" });
    stubHubStream(proposedMissionEvents());

    renderView();
    await waitFor(() => expect(screen.getByTestId("mission-plan-card")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /approve & run/i }));

    await waitFor(() => expect(api.approveHubMission).toHaveBeenCalledWith("mis-1"));
  });

  test("removing an agent on the in-band plan card calls editHubMissionPlan with the edited plan", async () => {
    const s = session({ id: "s1", mode: "mission", title: "Research mission" });
    stubMissionConfigured(s);
    vi.mocked(api.editHubMissionPlan).mockResolvedValue({
      id: "mis-1",
      sessionId: "s1",
      status: "proposed",
      topology: "parallel",
      autonomy: "always_ask",
      plan: MISSION_PLAN,
      agentSessionIds: [],
      createdAt: "2026-07-17T09:00:00.000Z",
      updatedAt: "2026-07-17T09:00:00.000Z",
    });
    stubHubStream(proposedMissionEvents());

    renderView();
    await waitFor(() => expect(screen.getByTestId("mission-plan-card")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove researcher b/i }));

    await waitFor(() => expect(api.editHubMissionPlan).toHaveBeenCalledTimes(1));
    const [missionId, editedPlan] = vi.mocked(api.editHubMissionPlan).mock.calls[0]!;
    expect(missionId).toBe("mis-1");
    expect(editedPlan.agents.map((a) => a.key)).toEqual(["a"]);
  });

  test("Stop mission on the in-band board calls stopHubMission with the mission id", async () => {
    const s = session({ id: "s1", mode: "mission", title: "Research mission" });
    stubMissionConfigured(s);
    vi.mocked(api.stopHubMission).mockResolvedValue(undefined);
    stubHubStream(runningMissionEvents());

    renderView();
    await waitFor(() => expect(screen.getByTestId("mission-board")).toBeInTheDocument());

    // The rail's Progress section now ALSO renders a "Stop mission" control (its always-visible mission
    // summary, D-HUX3) — scope to the in-transcript board so we click that one specifically.
    const board = screen.getByTestId("mission-board");
    fireEvent.click(within(board).getByRole("button", { name: /stop mission/i }));

    await waitFor(() => expect(api.stopHubMission).toHaveBeenCalledWith("mis-1"));
  });

  test("stopping the waiting agent on the in-band board calls stopHubMissionAgent", async () => {
    const s = session({ id: "s1", mode: "mission", title: "Research mission" });
    stubMissionConfigured(s);
    vi.mocked(api.stopHubMissionAgent).mockResolvedValue(undefined);
    stubHubStream(runningMissionEvents());

    renderView();
    await waitFor(() => expect(screen.getByTestId("mission-board")).toBeInTheDocument());

    // Researcher A already reported; Researcher B is still in the waiting queue with its own Stop.
    // Scoped to the board itself — the composer ALSO renders a (turn-stop) "Stop" button while this
    // fixture's outer turn is still open (no `turn_done` event — the mission run is what's "live").
    const board = screen.getByTestId("mission-board");
    fireEvent.click(within(board).getByRole("button", { name: "Stop" }));

    await waitFor(() => expect(api.stopHubMissionAgent).toHaveBeenCalledWith("mis-1", "child-b"));
  });
});
