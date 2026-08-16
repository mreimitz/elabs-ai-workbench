import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { Button, TooltipProvider } from "@brand/ui";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  ASSISTANT_TOKEN_EXPIRY_WARNING_DAYS,
  type AssistantAuthStatus,
  type AssistantStarter,
  type AssistantStartersResponse,
  type AssistantStreamFrame,
  type AssistantThread,
} from "@mcp-token-footprint/shared";

// Dock integration test (WP 2.1) — mirrors WP 1.3's `vi.mock("../../lib/api")` harness. The heavy
// `@brand/ai` surface (shiki/mermaid) and `ChatMarkdown` are stubbed to keep jsdom light; the SSE
// stream is driven through the mocked `openAssistantStream` (no real EventSource). We assert the two
// WP 2.1 wire effects: the auto-accept toggle PATCHes the thread, and Allow POSTs the decision.

const hoisted = vi.hoisted(() => ({
  onFrame: null as ((frame: AssistantStreamFrame) => void) | null,
  // WP 3.1 (D-AS8/D-AS16) — the mocked stream's 4th arg, mirroring `openAssistantStream`'s real
  // `onReplayComplete` (the SSE `replay_complete` marker's client-side signal).
  onReplayComplete: null as (() => void) | null,
}));

// Stub every @brand/ai component the dock tree renders as a passthrough (children-only), so no
// shiki/mermaid enters the bundle. ToolInput → a plain JSON preview.
//
// WP R3.2 — two of these stubs are no longer bare passthroughs:
//   - `PromptInputProvider` now surfaces its `initialInput` prop as visible text (a real testid'd
//     node) instead of silently dropping it, so a starter-chip click's prefill is observable —
//     otherwise `initialInput` would vanish into the mock with no way to assert on it (the REAL
//     `Composer`/`PromptInput` below it is also stubbed to `null`, so nothing else would render it).
//   - `Suggestion`/`Suggestions` render as a real, clickable `@brand/ui` `Button` (imported below —
//     lightweight, already used unmocked elsewhere in this suite for `NavigateProbe`) rather than an
//     inert `Pass` div, so a test can actually click a chip and observe `onClick` firing — mirroring
//     the REAL `Suggestion` (`@brand/ai/src/suggestion.tsx`), which is itself just a styled `Button`.
vi.mock("@brand/ai", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const ChatShell = ({
    header,
    composer,
    children,
  }: { header?: ReactNode; composer?: ReactNode; children?: ReactNode }) => (
    <div>
      {header}
      {children}
      {composer}
    </div>
  );
  return {
    AgentMessage: Pass,
    AgentStep: Pass,
    AgentTimeline: Pass,
    ChatShell,
    // CodeSnippet (the permission card's diff preview) is now @brand/ai's CodeBlock (shiki — heavy).
    CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
    Conversation: Pass,
    ConversationContent: Pass,
    ConversationEmptyState: ({
      title,
      description,
      children,
    }: { title?: string; description?: string; children?: ReactNode }) => (
      <div>
        {children ?? (
          <>
            <h3>{title}</h3>
            <p>{description}</p>
          </>
        )}
      </div>
    ),
    ConversationScrollButton: () => null,
    MessageContent: Pass,
    // The composer is now composed from PromptInput* primitives (the closed Composer wrapper
    // hard-coded the send icon, hiding the streaming/stop state). Minimal stand-ins: the footer
    // tools render inline so the WP 2.1 auto-accept test can find and click the mode button.
    PromptInput: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    PromptInputBody: Pass,
    PromptInputButton: ({
      children,
      tooltip: _tooltip,
      variant: _variant,
      ...props
    }: { children?: ReactNode; tooltip?: unknown; variant?: string } & Record<string, unknown>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    PromptInputFooter: Pass,
    PromptInputSelect: Pass,
    PromptInputSelectContent: Pass,
    PromptInputSelectItem: Pass,
    PromptInputSelectTrigger: Pass,
    PromptInputSelectValue: () => null,
    PromptInputSubmit: ({ children }: { children?: ReactNode }) => (
      <button type="submit">{children}</button>
    ),
    PromptInputTextarea: (props: Record<string, unknown>) => <textarea {...props} />,
    PromptInputTools: Pass,
    PromptInputProvider: ({
      children,
      initialInput,
    }: { children?: ReactNode; initialInput?: string }) => (
      <div>
        <div data-testid="composer-initial-input">{initialInput}</div>
        {children}
      </div>
    ),
    Shimmer: Pass,
    Suggestion: ({
      suggestion,
      onClick,
    }: { suggestion: string; onClick?: (suggestion: string) => void }) => (
      <Button size="sm" onClick={() => onClick?.(suggestion)}>
        {suggestion}
      </Button>
    ),
    Suggestions: Pass,
    ToolDetails: Pass,
    ToolInput: ({ input }: { input: unknown }) => <pre>{JSON.stringify(input)}</pre>,
    ToolOutput: () => null,
    UserMessage: Pass,
  };
});

vi.mock("../testing/ChatMarkdown", () => ({
  ChatMarkdown: ({ text }: { text: string }) => <div>{text}</div>,
}));

// WP 2.2 — the dock now renders AssistantDiffCard, which reuses SkillDiffView.tsx's DeltaStrip; that
// file ALSO statically imports @brand/editor's Monaco CodeEditor/DiffEditor for its own (unused-here)
// per-file viewer. Stub it out so Monaco never enters this jsdom suite (same posture as elsewhere).
vi.mock("@brand/editor", () => ({ CodeEditor: () => null, DiffEditor: () => null }));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getAssistantAuthStatus: vi.fn(),
    listAssistantThreads: vi.fn(),
    getAssistantThread: vi.fn(),
    getAssistantModels: vi.fn(),
    getAssistantStarters: vi.fn(),
    createAssistantThread: vi.fn(),
    updateAssistantThread: vi.fn(),
    sendAssistantMessage: vi.fn(),
    sendAssistantPermissionDecision: vi.fn(),
    retrySourceAssistantThread: vi.fn(),
    stopAssistantThread: vi.fn(),
    openAssistantStream: (
      _threadId: string,
      onFrame: (frame: AssistantStreamFrame) => void,
      _onError?: (event: Event) => void,
      onReplayComplete?: () => void,
    ) => {
      hoisted.onFrame = onFrame;
      hoisted.onReplayComplete = onReplayComplete ?? null;
      return () => {
        hoisted.onFrame = null;
        hoisted.onReplayComplete = null;
      };
    },
  };
});

import * as api from "../../lib/api";
import { AssistantProvider, useAssistant } from "./assistant-context";
import { AssistantDock } from "./AssistantDock";

/** A harness that mounts the dock ONLY while open (mirrors AppShell's `showDock`), with a probe that
 *  performs a plain expand — so a mount that follows a fresh expand can be observed. */
function ExpandHarness() {
  const { isOpen, openAssistant } = useAssistant();
  return (
    <>
      <Button onClick={() => openAssistant()}>open dock</Button>
      {isOpen ? <AssistantDock /> : null}
    </>
  );
}

function renderExpandHarness(pathname = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <TooltipProvider>
        <AssistantProvider>
          <ExpandHarness />
        </AssistantProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const SIGNED_IN: AssistantAuthStatus = {
  signedIn: true,
  fallbackConfigured: false,
  models: ["claude-sonnet-4-5"],
};

const THREAD: AssistantThread = {
  id: "t-1",
  title: "Test thread",
  model: "claude-sonnet-4-5",
  authSource: "subscription",
  status: "idle",
  autoAccept: false,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

// R2.1 (D-AS24/D-AS26) fixtures — an unpinned (global) thread and one pinned to a `server` entity.
// Timestamps are real-clock-relative (hours ago, not a fixed literal) so `formatRelativeTime`'s render
// is deterministic without mocking system time: the offset is large enough that ordinary test latency
// never crosses an hour boundary.
function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

const GLOBAL_THREAD: AssistantThread = {
  id: "t-global",
  title: "Global thread",
  model: "claude-sonnet-4-5",
  authSource: "subscription",
  status: "idle",
  autoAccept: false,
  createdAt: hoursAgoIso(5),
  updatedAt: hoursAgoIso(5),
};

const SERVER_THREAD: AssistantThread = {
  id: "t-server",
  title: "Server thread",
  entityKind: "server",
  entityId: "server-1",
  model: "claude-sonnet-4-5",
  authSource: "subscription",
  status: "idle",
  autoAccept: false,
  createdAt: hoursAgoIso(2),
  updatedAt: hoursAgoIso(2),
};

function renderDock() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <TooltipProvider>
        <AssistantProvider>
          <AssistantDock />
        </AssistantProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** Like `renderDock`, but starting on a page that names an entity (D-AS24 pin/scope tests). */
function renderDockAtRoute(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <TooltipProvider>
        <AssistantProvider>
          <AssistantDock />
        </AssistantProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.pathname + location.search}</div>;
}

/** Like `renderDock`, plus a `useLocation()` probe so a live `ui_action`'s navigation is observable. */
function renderDockWithLocation() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <TooltipProvider>
        <AssistantProvider>
          <AssistantDock />
          <LocationProbe />
        </AssistantProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** A real `Button` (brand-ui — never a raw `<button>`) that navigates on click, so a test can drive an
 *  in-app route change WITHOUT remounting the dock (the correctness fix in requirement 3 only matters
 *  across a navigation the dock survives). */
function NavigateProbe({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <Button size="sm" onClick={() => navigate(to)}>
      navigate
    </Button>
  );
}

/** Like `renderDock`, but starting on `initialPath` with a `NavigateProbe` mounted alongside the dock
 *  so a test can navigate to `navigateTo` mid-test and observe the dock surviving it. */
function renderDockWithNavigation(initialPath: string, navigateTo: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TooltipProvider>
        <AssistantProvider>
          <AssistantDock />
          <NavigateProbe to={navigateTo} />
        </AssistantProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.onFrame = null;
  hoisted.onReplayComplete = null;
  window.localStorage.clear();
  vi.mocked(api.getAssistantAuthStatus).mockResolvedValue(SIGNED_IN);
  vi.mocked(api.listAssistantThreads).mockResolvedValue([THREAD]);
  // Default echo: whichever id is asked for comes back shaped like THREAD (title/model/authSource
  // unchanged) — good enough for every test that doesn't care about this specifically, since the dock
  // now calls this after EVERY turn settle (R2.1 requirement 6). Tests that DO care override it.
  vi.mocked(api.getAssistantThread).mockImplementation((id: string) =>
    Promise.resolve({ ...THREAD, id, events: [] }),
  );
  vi.mocked(api.getAssistantModels).mockResolvedValue({ models: [] });
  // WP R3.2 — no starters by default, so every EXISTING test (none of which care about the empty
  // state's chips) keeps seeing today's plain "Say something…" panel with nothing extra to trip over.
  vi.mocked(api.getAssistantStarters).mockResolvedValue({
    version: 1,
    surface: "global",
    starters: [],
  });
  vi.mocked(api.updateAssistantThread).mockResolvedValue({ ...THREAD, autoAccept: true });
  vi.mocked(api.sendAssistantPermissionDecision).mockResolvedValue(undefined);
});

describe("AssistantDock — WP 2.1 wiring", () => {
  test("toggling auto-accept PATCHes the thread with { autoAccept: true }", async () => {
    renderDock();
    // The mode control is an icon-only toggle BUTTON (aria-pressed), not a Switch (owner 2026-07-12).
    const toggle = await screen.findByRole("button", { name: /auto-accept writes/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(api.updateAssistantThread).toHaveBeenCalledWith("t-1", { autoAccept: true }),
    );
  });

  test("toggling auto-accept when the PATCH 404s (stale thread) CREATES a thread carrying the setting instead of erroring", async () => {
    // Repro of the owner's "Could not change auto-accept / Not found": the active thread's server row is
    // gone, so the PATCH 404s. The dock must recover by creating a thread with the chosen write mode
    // (mirrors the model-change 404 path), NOT surface an error toast.
    vi.mocked(api.updateAssistantThread).mockRejectedValue(new api.ApiError(404, "Not found"));
    vi.mocked(api.createAssistantThread).mockResolvedValue({
      ...THREAD,
      id: "t-fresh",
      autoAccept: true,
    });
    renderDock();
    const toggle = await screen.findByRole("button", { name: /auto-accept writes/i });

    fireEvent.click(toggle);

    // Falls through to create-with-setting (unpinned page → no entity pin) instead of toasting the 404
    // and giving up — the OLD code returned here without ever calling create.
    await waitFor(() =>
      expect(api.createAssistantThread).toHaveBeenCalledWith({ autoAccept: true }),
    );
  });

  test("a streamed permission_request renders an Allow card; clicking Allow POSTs the decision", async () => {
    renderDock();
    // Wait until the dock has subscribed to the thread's stream (the active thread resolved).
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "commit the workspace", seq: 1 });
      hoisted.onFrame?.({
        type: "permission_request",
        requestId: "req-9",
        toolName: "skills_commit_workspace",
        input: { skillId: "s1" },
        seq: 2,
      });
    });

    const allow = await screen.findByRole("button", { name: /allow/i });
    fireEvent.click(allow);

    await waitFor(() =>
      expect(api.sendAssistantPermissionDecision).toHaveBeenCalledWith("t-1", {
        requestId: "req-9",
        behavior: "allow",
      }),
    );
  });

  test("a replayed settled decision renders inert (no Allow/Deny buttons)", async () => {
    renderDock();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "commit", seq: 1 });
      hoisted.onFrame?.({
        type: "permission_request",
        requestId: "req-9",
        toolName: "skills_commit_workspace",
        input: { skillId: "s1" },
        seq: 2,
      });
      hoisted.onFrame?.({
        type: "permission_decision",
        requestId: "req-9",
        behavior: "deny",
        seq: 3,
      });
      hoisted.onFrame?.({ type: "turn_done", seq: 4 });
    });

    expect(await screen.findByText("Denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^allow$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^deny$/i })).not.toBeInTheDocument();
  });
});

describe("AssistantDock — WP 2.2 skill-workspace diff card", () => {
  test("a settled skills_commit_workspace result carrying a diff renders the diff card, linking to the skill", async () => {
    renderDock();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "edit the skill", seq: 1 });
      hoisted.onFrame?.({
        type: "tool_call",
        toolUseId: "tu-1",
        toolName: "mcp__assistant-app__skills_commit_workspace",
        input: { skillId: "skill-1" },
        seq: 2,
      });
      hoisted.onFrame?.({
        type: "tool_result",
        toolUseId: "tu-1",
        toolName: "mcp__assistant-app__skills_commit_workspace",
        result: {
          unchanged: false,
          skillId: "skill-1",
          versionId: "v2",
          versionLabel: "v2",
          diff: {
            skillId: "skill-1",
            fromVersionId: "v1",
            toVersionId: "v2",
            entries: [],
            rollup: {
              filesAdded: 0,
              filesRemoved: 0,
              filesModified: 1,
              filesRenamed: 0,
              bytesDelta: 5,
              l1Delta: 0,
              l2Delta: 5,
              l3Delta: 0,
              totalDelta: 5,
            },
            manifestDiff: [],
          },
        },
        isError: false,
        seq: 3,
      });
      hoisted.onFrame?.({ type: "turn_done", seq: 4 });
    });

    expect(await screen.findByText("Skill updated")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view skill/i });
    expect(link).toHaveAttribute("href", "/skills/skill-1");
  });

  test("an unchanged commit result (no diff to show) does NOT render the diff card", async () => {
    renderDock();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "commit", seq: 1 });
      hoisted.onFrame?.({
        type: "tool_call",
        toolUseId: "tu-1",
        toolName: "mcp__assistant-app__skills_commit_workspace",
        input: { skillId: "skill-1" },
        seq: 2,
      });
      hoisted.onFrame?.({
        type: "tool_result",
        toolUseId: "tu-1",
        toolName: "mcp__assistant-app__skills_commit_workspace",
        result: {
          unchanged: true,
          skillId: "skill-1",
          versionId: "v1",
          message: "No changes to commit.",
        },
        isError: false,
        seq: 3,
      });
      hoisted.onFrame?.({ type: "turn_done", seq: 4 });
    });

    // Wait for the turn to actually render before asserting the diff card is absent — otherwise the
    // assertion could pass merely because nothing rendered yet. The tool call is a COLLAPSED row now
    // (the raw args live behind the disclosure), so key off the always-visible one-line args summary.
    await screen.findByText('skillId: "skill-1"');
    expect(screen.queryByText("Skill updated")).not.toBeInTheDocument();
  });
});

// WP 3.1 (Assistant, D-AS8/D-AS16) — ui_* navigation: a LIVE ui_action navigates the browser instantly
// (through AssistantDockContent's executor effect → AssistantProvider's executeUiAction); a REPLAYED
// one renders as an inert AssistantUiActionChip and never touches the router.
describe("AssistantDock — WP 3.1 ui_action navigation", () => {
  test("a LIVE ui_action (after replay_complete) navigates the browser AND renders a chip", async () => {
    renderDockWithLocation();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());
    expect(screen.getByTestId("loc").textContent).toBe("/dashboard");

    act(() => {
      hoisted.onReplayComplete?.(); // this thread's history (none yet) is caught up
      hoisted.onFrame?.({ type: "user_message", text: "open the scan", seq: 1 });
      hoisted.onFrame?.({
        type: "ui_action",
        action: "navigate",
        params: { view: "scan", params: { scanId: "scan-1" } },
        seq: 2,
      });
      hoisted.onFrame?.({ type: "turn_done", seq: 3 });
    });

    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/scans/scan-1"));
    expect(screen.getByText(/Scan detail/)).toBeInTheDocument();
  });

  test("a REPLAYED ui_action (before replay_complete) renders an inert chip and never navigates", async () => {
    renderDockWithLocation();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    // No onReplayComplete() yet — everything below is history from the persisted log.
    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "open the scan", seq: 1 });
      hoisted.onFrame?.({
        type: "ui_action",
        action: "navigate",
        params: { view: "scan", params: { scanId: "scan-1" } },
        seq: 2,
      });
      hoisted.onFrame?.({ type: "turn_done", seq: 3 });
    });

    expect(await screen.findByText(/Scan detail/)).toBeInTheDocument();
    // Give any (incorrect) navigation a tick to happen before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("loc").textContent).toBe("/dashboard");
  });

  test("a live ui_action is executed exactly once even if the timeline re-renders", async () => {
    renderDockWithLocation();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    act(() => {
      hoisted.onReplayComplete?.();
      hoisted.onFrame?.({ type: "user_message", text: "open the scan", seq: 1 });
      hoisted.onFrame?.({
        type: "ui_action",
        action: "navigate",
        params: { view: "scan", params: { scanId: "scan-1" } },
        seq: 2,
      });
    });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/scans/scan-1"));

    // Navigate elsewhere manually (simulating the owner clicking around), then let the SAME turn
    // settle — the already-executed ui_action must NOT re-fire and yank the browser back.
    act(() => {
      hoisted.onFrame?.({ type: "assistant_message", text: "Done.", seq: 3 });
      hoisted.onFrame?.({ type: "turn_done", seq: 4 });
    });
    // R2.1's post-turn-settle refresh (requirement 6) now also fires here — wrap the tick in `act` so
    // its (mocked, best-effort) async state updates don't warn.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId("loc").textContent).toBe("/scans/scan-1");
  });
});

// WP 3.3 (D-AS14) — the terminal limit-error banner + explicit retry-on-other-source, and the dock's
// token-expiry warning badge.
describe("AssistantDock — WP 3.3 limit-error banner + retry-source", () => {
  test("a terminal auth limit_error with NO fallback configured shows the re-sign-in hint and a Settings link, no retry button", async () => {
    renderDock();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "hi", seq: 1 });
      hoisted.onFrame?.({
        type: "limit_error",
        message: "Auth failed",
        source: "subscription",
        kind: "auth",
        seq: 2,
      });
      hoisted.onFrame?.({ type: "turn_done", seq: 3 });
    });

    expect(await screen.findByText("Subscription limit reached")).toBeInTheDocument();
    expect(screen.getByText(/sign in again in settings/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /configure api key in settings/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry on/i })).not.toBeInTheDocument();
  });

  test("a terminal limit_error WITH a fallback configured shows a Retry on API key button that POSTs retry-source", async () => {
    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue({
      signedIn: true,
      fallbackConfigured: true,
      models: [],
    });
    vi.mocked(api.retrySourceAssistantThread).mockResolvedValue({
      ...THREAD,
      authSource: "api_key",
    });
    renderDock();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "hi", seq: 1 });
      hoisted.onFrame?.({
        type: "limit_error",
        message: "Usage limit reached",
        source: "subscription",
        kind: "rate_limit",
        seq: 2,
      });
      hoisted.onFrame?.({ type: "turn_done", seq: 3 });
    });

    const retryButton = await screen.findByRole("button", { name: /retry on api key/i });
    fireEvent.click(retryButton);

    await waitFor(() =>
      expect(api.retrySourceAssistantThread).toHaveBeenCalledWith("t-1", "api_key"),
    );
  });

  test("only the TRAILING limit_error is interactive — an older one (superseded by a later turn) has no retry button", async () => {
    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue({
      signedIn: true,
      fallbackConfigured: true,
      models: [],
    });
    renderDock();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "first", seq: 1 });
      hoisted.onFrame?.({
        type: "limit_error",
        message: "First failure",
        source: "subscription",
        kind: "rate_limit",
        seq: 2,
      });
      hoisted.onFrame?.({ type: "turn_done", seq: 3 });
      hoisted.onFrame?.({ type: "user_message", text: "second", seq: 4 });
      hoisted.onFrame?.({ type: "assistant_message", text: "All good now.", seq: 5 });
      hoisted.onFrame?.({ type: "turn_done", seq: 6 });
    });

    await screen.findByText("First failure");
    // The historical banner shows the message but not an actionable retry button (only the trailing
    // turn — which succeeded, and carries no limitError at all — is interactive).
    expect(screen.queryByRole("button", { name: /retry on/i })).not.toBeInTheDocument();
  });

  test("the dock shows an 'Expiring soon' badge when the subscription token is past the warning threshold", async () => {
    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue({
      signedIn: true,
      fallbackConfigured: false,
      tokenAgeDays: ASSISTANT_TOKEN_EXPIRY_WARNING_DAYS,
      models: [],
    });
    renderDock();
    expect(await screen.findByText("Expiring soon")).toBeInTheDocument();
  });

  test("no 'Expiring soon' badge when the token is well within its expiry window", async () => {
    vi.mocked(api.getAssistantAuthStatus).mockResolvedValue({
      signedIn: true,
      fallbackConfigured: false,
      tokenAgeDays: 10,
      models: [],
    });
    renderDock();
    await screen.findByText("Subscription"); // wait for the header to settle before asserting absence
    expect(screen.queryByText("Expiring soon")).not.toBeInTheDocument();
  });
});

// R2.1 (D-AS24 + the render half of D-AS26) — threads pinned to the current entity, an entity-scoped
// switcher with an "All threads" escape hatch, title + relative date rendering, inline rename, and a
// post-turn refresh. Radix's `DropdownMenuTrigger` only listens for pointerdown/keydown (not click), so
// every "open the switcher" step below uses `fireEvent.keyDown(trigger, { key: "Enter" })` — verified
// against a scratch repro before writing these; `fireEvent.click` alone never opens it in jsdom.
describe("AssistantDock — R2.1 entity-scoped threads (D-AS24/D-AS26 render half)", () => {
  test("on an entity page, the switcher shows only the server-filtered threads for that entity", async () => {
    vi.mocked(api.listAssistantThreads).mockImplementation((entity) =>
      Promise.resolve(entity ? [SERVER_THREAD] : [GLOBAL_THREAD]),
    );
    renderDockAtRoute("/servers/server-1");

    await waitFor(() =>
      expect(api.listAssistantThreads).toHaveBeenCalledWith({ kind: "server", id: "server-1" }),
    );

    const trigger = await screen.findByRole("button", { name: /server thread/i });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(await screen.findByText("Threads for this server")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText("Server thread").length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.queryByText("Global thread")).not.toBeInTheDocument();
  });

  test("'New thread' on an entity page creates a thread PINNED to that entity", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([]);
    vi.mocked(api.createAssistantThread).mockResolvedValue({ ...SERVER_THREAD, id: "t-new" });
    renderDockAtRoute("/servers/server-1");

    await waitFor(() =>
      expect(api.listAssistantThreads).toHaveBeenCalledWith({ kind: "server", id: "server-1" }),
    );

    const trigger = await screen.findByRole("button", { name: /new conversation/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByText("New thread"));

    await waitFor(() =>
      expect(api.createAssistantThread).toHaveBeenCalledWith({
        entityKind: "server",
        entityId: "server-1",
      }),
    );
  });

  test("'New thread' on a global (unscoped) page creates an UNPINNED thread", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([]);
    vi.mocked(api.createAssistantThread).mockResolvedValue({ ...GLOBAL_THREAD, id: "t-new" });
    renderDock();

    await waitFor(() => expect(api.listAssistantThreads).toHaveBeenCalledWith());

    const trigger = await screen.findByRole("button", { name: /new conversation/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByText("New thread"));

    await waitFor(() => expect(api.createAssistantThread).toHaveBeenCalledWith({}));
  });

  test("the 'All threads' toggle switches an entity page's switcher to the global list", async () => {
    vi.mocked(api.listAssistantThreads).mockImplementation((entity) =>
      Promise.resolve(entity ? [SERVER_THREAD] : [GLOBAL_THREAD]),
    );
    renderDockAtRoute("/servers/server-1");

    await waitFor(() =>
      expect(api.listAssistantThreads).toHaveBeenCalledWith({ kind: "server", id: "server-1" }),
    );

    const trigger = await screen.findByRole("button", { name: /server thread/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(await screen.findByText("Threads for this server")).toBeInTheDocument();

    const toggle = await screen.findByRole("switch", { name: /show all threads/i });
    fireEvent.click(toggle);

    await waitFor(() => expect(api.listAssistantThreads).toHaveBeenCalledWith());
    // Toggling the LIST never changes the SELECTION (requirement 3's correctness fix) — the header
    // keeps showing the still-active "Server thread" (queried by TEXT, not role: while the menu is
    // open Radix marks the rest of the page `aria-hidden`, so the header's own role="button" is
    // deliberately excluded from the accessibility tree — that's correct hide-background-from-AT
    // behavior, not a bug). The now-global list/label show up in the still-open menu (the Switch's own
    // onSelect calls preventDefault so it never auto-closes).
    expect(screen.getByText("Server thread")).toBeInTheDocument();
    expect(await screen.findByText("All threads")).toBeInTheDocument();
    expect(await screen.findByText("Global thread")).toBeInTheDocument();
  });

  test("an unscoped (global) page never shows the 'All threads' toggle", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([GLOBAL_THREAD]);
    renderDock();
    await waitFor(() => expect(api.listAssistantThreads).toHaveBeenCalledWith());

    const trigger = await screen.findByRole("button", { name: /global thread/i });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(await screen.findByText("All threads")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /show all threads/i })).not.toBeInTheDocument();
  });

  test("the switcher row and the header render the thread's title with a relative date", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([SERVER_THREAD]);
    renderDockAtRoute("/servers/server-1");
    await waitFor(() =>
      expect(api.listAssistantThreads).toHaveBeenCalledWith({ kind: "server", id: "server-1" }),
    );

    // The header shows the (auto-selected) active thread's real relative date ("2h ago" — SERVER_THREAD
    // was stamped `hoursAgoIso(2)`, comfortably far from any minute/hour rollover during the test).
    await waitFor(() => expect(screen.getAllByText("2h ago").length).toBeGreaterThanOrEqual(1));

    const trigger = screen.getByRole("button", { name: /server thread/i });
    fireEvent.keyDown(trigger, { key: "Enter" });

    // The switcher ROW shows its own date too — now at least 2 occurrences (header + row).
    await waitFor(() => expect(screen.getAllByText("2h ago").length).toBeGreaterThanOrEqual(2));
  });

  test("inline rename PATCHes { title } and updates the header", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([THREAD]);
    vi.mocked(api.updateAssistantThread).mockResolvedValue({ ...THREAD, title: "Renamed thread" });
    renderDock();

    const renameButton = await screen.findByRole("button", { name: /rename thread/i });
    fireEvent.click(renameButton);

    const input = screen.getByRole("textbox", { name: /thread title/i });
    fireEvent.change(input, { target: { value: "Renamed thread" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.updateAssistantThread).toHaveBeenCalledWith("t-1", { title: "Renamed thread" }),
    );
    // The header re-renders the switcher trigger with the new title (proves BOTH the active-thread
    // object AND the underlying `threads` row were updated — the trigger derives its label from the
    // former, and reopening the switcher would show the latter).
    expect(await screen.findByRole("button", { name: /renamed thread/i })).toBeInTheDocument();
  });

  test("an empty (trimmed) rename cancels instead of sending", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([THREAD]);
    renderDock();

    const renameButton = await screen.findByRole("button", { name: /rename thread/i });
    fireEvent.click(renameButton);

    const input = screen.getByRole("textbox", { name: /thread title/i });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(api.updateAssistantThread).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /test thread/i })).toBeInTheDocument();
  });

  test("Escape cancels a rename in progress without sending", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([THREAD]);
    renderDock();

    const renameButton = await screen.findByRole("button", { name: /rename thread/i });
    fireEvent.click(renameButton);

    const input = screen.getByRole("textbox", { name: /thread title/i });
    fireEvent.change(input, { target: { value: "Abandoned edit" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(api.updateAssistantThread).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /test thread/i })).toBeInTheDocument();
  });

  test("the switcher list AND the active thread's row re-fetch once a turn settles", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([THREAD]);
    vi.mocked(api.getAssistantThread).mockResolvedValue({
      ...THREAD,
      title: "Refined title",
      events: [],
    });
    renderDock();
    await waitFor(() => expect(hoisted.onFrame).not.toBeNull());

    const listCallsBefore = vi.mocked(api.listAssistantThreads).mock.calls.length;

    act(() => {
      hoisted.onFrame?.({ type: "user_message", text: "hi", seq: 1 });
    });
    // Still awaiting a response — no refresh yet.
    expect(vi.mocked(api.listAssistantThreads).mock.calls.length).toBe(listCallsBefore);
    expect(api.getAssistantThread).not.toHaveBeenCalled();

    act(() => {
      hoisted.onFrame?.({ type: "assistant_message", text: "hello", seq: 2 });
      hoisted.onFrame?.({ type: "turn_done", seq: 3 });
    });

    await waitFor(() =>
      expect(vi.mocked(api.listAssistantThreads).mock.calls.length).toBeGreaterThan(
        listCallsBefore,
      ),
    );
    await waitFor(() => expect(api.getAssistantThread).toHaveBeenCalledWith("t-1"));
    expect(await screen.findByRole("button", { name: /refined title/i })).toBeInTheDocument();
  });

  test("the active thread keeps rendering its real title in the header after navigating to a different entity's scoped page (the correctness fix)", async () => {
    vi.mocked(api.listAssistantThreads).mockImplementation((entity) =>
      Promise.resolve(entity ? [SERVER_THREAD] : [GLOBAL_THREAD]),
    );
    renderDockWithNavigation("/dashboard", "/servers/server-1");

    // The global thread becomes active by default (the only thread in the unscoped list).
    expect(await screen.findByRole("button", { name: /global thread/i })).toBeInTheDocument();

    // Navigate to a DIFFERENT entity's page — the switcher's list becomes server-scoped (excluding the
    // still-active global thread), but the header must keep the real title, never "New conversation".
    fireEvent.click(screen.getByRole("button", { name: "navigate" }));

    await waitFor(() =>
      expect(api.listAssistantThreads).toHaveBeenCalledWith({ kind: "server", id: "server-1" }),
    );
    expect(screen.getByRole("button", { name: /global thread/i })).toBeInTheDocument();
    expect(screen.queryByText("New conversation")).not.toBeInTheDocument();
  });
});

// WP R1.5 (D-AS23) — the header's "Scope" chip: what the assistant may WRITE to, derived from the
// current envelope (`scopeChipCopy` in `assistant-scope-chip.ts`, unit-tested directly there without
// React). These tests just confirm the dock actually renders the right copy in each state.
describe("AssistantDock — WP R1.5 scope chip (D-AS23)", () => {
  test("an unscoped (global) page shows the read-only chip copy", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([GLOBAL_THREAD]);
    renderDock();
    expect(
      await screen.findByText("Read-only — open an entity to enable edits"),
    ).toBeInTheDocument();
  });

  test("an entity-pinned page shows 'Scope: <Kind> <id>'", async () => {
    vi.mocked(api.listAssistantThreads).mockImplementation((entity) =>
      Promise.resolve(entity ? [SERVER_THREAD] : [GLOBAL_THREAD]),
    );
    renderDockAtRoute("/servers/server-1");
    expect(await screen.findByText("Scope: Server server-1")).toBeInTheDocument();
  });

  test("the chip re-derives on navigation from an unscoped to an entity-pinned page", async () => {
    vi.mocked(api.listAssistantThreads).mockImplementation((entity) =>
      Promise.resolve(entity ? [SERVER_THREAD] : [GLOBAL_THREAD]),
    );
    renderDockWithNavigation("/dashboard", "/servers/server-1");

    expect(
      await screen.findByText("Read-only — open an entity to enable edits"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));

    expect(await screen.findByText("Scope: Server server-1")).toBeInTheDocument();
    expect(
      screen.queryByText("Read-only — open an entity to enable edits"),
    ).not.toBeInTheDocument();
  });
});

// WP R3.2 (D-AS27/D-AS28/D-AS29) — session-starter chips in the dock's empty state: fetched for the
// current envelope, rendered as `@brand/ai` `Suggestion` chips, click → prefill (never send), graceful
// fallback to today's plain empty state on loading/error/empty, and a refetch on envelope change.
function starterFixture(overrides: Partial<AssistantStarter> = {}): AssistantStarter {
  return {
    id: "scan.reduce-token-footprint",
    label: "Reduce token footprint",
    prompt: "Analyze this scan and identify ways to reduce the server's token footprint.",
    kind: "analysis",
    ...overrides,
  };
}

function startersResponse(
  starters: AssistantStarter[],
  surface: AssistantStartersResponse["surface"] = "scan",
): AssistantStartersResponse {
  return { version: 1, surface, starters };
}

describe("AssistantDock — WP R3.2 session-starter chips", () => {
  test("renders the fetched starters as chips for the current (pinned) envelope", async () => {
    vi.mocked(api.getAssistantStarters).mockResolvedValue(startersResponse([starterFixture()]));
    renderDockAtRoute("/scans/scan-1");

    await waitFor(() =>
      expect(api.getAssistantStarters).toHaveBeenCalledWith({
        entityKind: "scan",
        entityId: "scan-1",
        tab: undefined,
        route: "/scans/scan-1",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Reduce token footprint" }),
    ).toBeInTheDocument();
  });

  test("clicking a chip prefills the composer with the starter's prompt, pinned to the entity — and never sends", async () => {
    vi.mocked(api.getAssistantStarters).mockResolvedValue(startersResponse([starterFixture()]));
    vi.mocked(api.listAssistantThreads).mockImplementation((entity) =>
      Promise.resolve(
        entity ? [{ ...THREAD, id: "t-scan", entityKind: "scan", entityId: "scan-1" }] : [THREAD],
      ),
    );
    renderDockAtRoute("/scans/scan-1");

    const chip = await screen.findByRole("button", { name: "Reduce token footprint" });
    fireEvent.click(chip);

    // The dock resolved/pinned a thread for the scan entity (the same mechanism every other
    // `openAssistant({ entity })` call site uses) — proves the click passed the RIGHT entity through.
    await waitFor(() =>
      expect(api.listAssistantThreads).toHaveBeenCalledWith({ kind: "scan", id: "scan-1" }),
    );

    // The composer's prefill carries the starter's exact prompt text — proves the click passed the
    // RIGHT prompt through (not the chip's shorter `label`).
    expect(await screen.findByTestId("composer-initial-input")).toHaveTextContent(
      "Analyze this scan and identify ways to reduce the server's token footprint.",
    );

    // Prefill only — a click must never itself send a message.
    expect(api.sendAssistantMessage).not.toHaveBeenCalled();
  });

  test("falls back to the plain empty state while the starters fetch is still loading", async () => {
    let resolveFetch: (value: AssistantStartersResponse) => void = () => {};
    vi.mocked(api.getAssistantStarters).mockReturnValue(
      new Promise<AssistantStartersResponse>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    renderDockAtRoute("/scans/scan-1");

    expect(await screen.findByText("Say something to get started")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reduce token footprint" }),
    ).not.toBeInTheDocument();

    // Resolving late must not retroactively break anything already rendered.
    await act(async () => {
      resolveFetch(startersResponse([starterFixture()]));
    });
    expect(
      await screen.findByRole("button", { name: "Reduce token footprint" }),
    ).toBeInTheDocument();
  });

  test("falls back to the plain empty state when the starters fetch rejects", async () => {
    vi.mocked(api.getAssistantStarters).mockRejectedValue(new Error("network error"));
    renderDockAtRoute("/scans/scan-1");

    expect(await screen.findByText("Say something to get started")).toBeInTheDocument();
    await waitFor(() => expect(api.getAssistantStarters).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Reduce token footprint" }),
    ).not.toBeInTheDocument();
  });

  test("falls back to the plain empty state when the endpoint returns zero starters", async () => {
    vi.mocked(api.getAssistantStarters).mockResolvedValue(startersResponse([]));
    renderDockAtRoute("/scans/scan-1");

    expect(await screen.findByText("Say something to get started")).toBeInTheDocument();
    await waitFor(() => expect(api.getAssistantStarters).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /reduce/i })).not.toBeInTheDocument();
  });

  test("refetches with new query params when the page/entity changes", async () => {
    vi.mocked(api.getAssistantStarters).mockResolvedValue(startersResponse([]));
    renderDockWithNavigation("/dashboard", "/scans/scan-1");

    await waitFor(() =>
      expect(api.getAssistantStarters).toHaveBeenCalledWith({
        entityKind: undefined,
        entityId: undefined,
        tab: undefined,
        route: "/dashboard",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigate" }));

    await waitFor(() =>
      expect(api.getAssistantStarters).toHaveBeenCalledWith({
        entityKind: "scan",
        entityId: "scan-1",
        tab: undefined,
        route: "/scans/scan-1",
      }),
    );
  });
});

describe("AssistantDock — fresh session on expand (owner refinement)", () => {
  test("expanding the dock opens a BLANK new session, not the most-recent thread", async () => {
    vi.mocked(api.listAssistantThreads).mockResolvedValue([THREAD]);
    renderExpandHarness();

    // The dock is not mounted yet (closed). Expand it via a plain openAssistant() (toggle / ⌘J path).
    fireEvent.click(screen.getByRole("button", { name: /open dock/i }));

    // It opens on the blank "Start a conversation" state instead of auto-selecting "Test thread".
    expect(await screen.findByText(/start a conversation/i)).toBeInTheDocument();
    // No active thread → the header trigger is "New conversation", NOT the most-recent thread's title,
    // and the dock never subscribed to a thread's stream.
    expect(screen.queryByRole("button", { name: /test thread/i })).not.toBeInTheDocument();
    expect(hoisted.onFrame).toBeNull();
  });

  test("a directly-mounted dock (no expand) still auto-selects the most-recent thread", async () => {
    // Regression guard: the fresh-on-expand behavior must not change the pre-existing default for a cold
    // mount (a page reload, or these direct-render tests) — the most-recent thread is still resumed.
    vi.mocked(api.listAssistantThreads).mockResolvedValue([THREAD]);
    renderDock();
    expect(await screen.findByRole("button", { name: /test thread/i })).toBeInTheDocument();
  });
});
