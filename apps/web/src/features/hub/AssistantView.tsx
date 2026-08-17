import {
  type ReactNode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  EmptyState,
  Heading,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Spinner,
  toast,
} from "@elabs-ai/components-ui";
import type {
  HubAgentRole,
  HubApprovalResolution,
  HubAutonomyLevel,
  HubCrew,
  HubFile,
  HubMissionPlan,
  HubProject,
  HubSendMessageInput,
  HubSession,
  HubSessionCreateInput,
} from "@mcp-token-footprint/shared";
import { Bot, Settings } from "lucide-react";
import {
  approveHubMission,
  createHubSession,
  decideHubApproval,
  editHubMissionPlan,
  getHubSession,
  hubFileContentUrl,
  listHubAgentRoles,
  listHubCrews,
  listHubProjects,
  listHubSessions,
  markHubSessionSeen,
  proposeHubMission,
  reconnectHubMcpServer,
  respondHubElicitation,
  sendHubMessage,
  setHubAutonomy,
  steerHubMissionAgent,
  stopHubMission,
  stopHubMissionAgent,
  stopHubSession,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { loadableData, useLoadable } from "../../lib/loadable";
import { buildMissionCrewLookup, buildMissionRoleLookup } from "./lib/mission-agent-icon";
import { useMcpAuthOptional } from "../servers/McpAuthProvider";
import { PageShell } from "../../components/PageShell";
import { useSetBreadcrumbSlot } from "../../components/breadcrumb-slot";
import { deriveRunStatusView } from "../../lib/status";
import { ChatCanvas } from "./ChatCanvas";
import {
  ConversationPane,
  type ConversationHandlers,
  type MissionHandlers,
} from "./ConversationPane";
import { Composer } from "./Composer";
import { EmptySessionIntro } from "./EmptySessionIntro";
import { composerClearancePx, resolveIntroDockState } from "./lib/hub-ux";
import { HubPinnedFileDialog } from "./HubPinnedFileDialog";
import { MetaRail } from "./meta-rail";
import { useMetaRailData } from "./meta-rail/use-meta-rail-data";
import { useMetaRailNarrow } from "./meta-rail/use-meta-rail-narrow";
import { EffectiveMemoryStack } from "./memory/EffectiveMemoryStack";
import { ProfileMemoryDialog } from "./memory/ProfileMemoryDialog";
import { reconstructMissionBoard } from "./MissionBoard";
import { NewSessionDialog } from "./NewSessionDialog";
import { SessionSkillsPanel } from "./SessionSkillsPanel";
import { SessionBreadcrumbSwitcher } from "./SessionBreadcrumbSwitcher";
import { HUB_PROVIDER_KIND_PROSE, useHubModelRoster } from "./use-hub-models";
import { useHubStream } from "./use-hub-stream";
import { notifyError } from "../../lib/notify";

// WP1.8 integration — the full artifact experience (`ArtifactCanvas`) is opened on demand from the meta
// rail's Outputs section, so it is code-split: it pulls in the heavy `@elabs-ai/components-editor` Monaco/Milkdown
// stack, which only needs to load the first time the owner opens an artifact — never on the workspace's
// first paint. (Keeping it out of the static import graph also keeps this view's unit tests light.)
const ArtifactCanvas = lazy(() =>
  import("./ArtifactCanvas").then((module) => ({ default: module.ArtifactCanvas })),
);

/**
 * Assistant Hub UX WP1.1 (D-HUX1/D-HUX2/D-HUX3/D-HUX4) — the workspace shell + toolbar, and the Wave-1
 * SEAM OWNER of this file (WP1.2's meta rail and WP1.3's chat canvas / first-prompt choreography build
 * their OWN new components in parallel worktrees and integrate through the slot props below — see the
 * doc comment on {@link AssistantViewProps}).
 *
 * Rebuilt on `PageShell scroll="fill"` per the concept's §7.1 wireframe: a HEADER-LESS full-bleed body
 * (page identity comes from the nav + breadcrumb) over a two-column layout — the conversation region
 * (the only scroll owner) and the 360px meta rail. The obsolete `ViewToolbar` row was removed entirely
 * per owner feedback: Autonomy moved into the composer (an `AutonomyModeSelect` mode menu next to "Plan
 * first"), the rail's show/hide moved to a collapse control in the rail header plus a floating "Show the
 * rail" button on the chat canvas (`ChatCanvas` `railHidden`/`onShowRail`), and skills management moved
 * to a "Manage" affordance in the meta rail's Context → Skills block (`onManageSkills`). Also deleted for
 * good per the concept's delta list (§7.1 "Remove:"): the local icon+Heading `PageHeader` block (D-HUX2),
 * the `min-h-[36rem]` fixed frame (D-HUX1 — PageShell owns the viewport-filling height), the permanent
 * `SessionRail` column (D-HUX4 — session history is now the `/assistant/sessions` table, WP1.4; the
 * breadcrumb switcher covers "jump back"), and the three-way `activeAside` switch + its
 * `ArtifactCanvas`/`SessionContextPanel`/`WorkspaceFilesPanel` triad (D-HUX3 — folded into WP1.2's meta
 * rail sections). Kept: every conversation and mission card, the composer, the `?session`/`?message`
 * deep links, and the skills dialog.
 *
 * Gated like the Assistant dock (`AssistantDock.tsx`'s `SignedOutPanel`): no hub-eligible provider
 * credential → a "not configured" empty state pointing at Settings, never a 409 surprise on first send.
 */

/**
 * The Wave-1 integration seam. WP1.2 (meta rail) and WP1.3 (chat canvas + first-prompt choreography)
 * built brand-new files in PARALLEL isolated worktrees; WP1.8 (this integration) now WIRES them in as
 * the DEFAULT rendering of each slot (see `metaRailContent`/`chatCanvasContent` below). The three slot
 * props are RETAINED as optional override seams — a caller (a test, or a future re-composition) can
 * inject its own node — but the Wave-1 "placeholder" defaults are gone: leaving a slot `undefined` now
 * renders the real `MetaRail` · `ChatCanvas` + `EmptySessionIntro` · the no-session `EmptyState`.
 */
export type AssistantViewProps = {
  /**
   * Override for the meta rail (D-HUX3). `undefined` (the default) renders the real `MetaRail` —
   * stacked, individually collapsible Progress · Outputs · Context sections (own scroll, ~1100px `Sheet`
   * fallback), driven `open`/`onOpenChange` by the toolbar's rail `Toggle`, and fed from the live stream
   * (Progress) + `useMetaRailData` (Outputs/Context). `MetaRail` is self-contained (its own 360px width,
   * border, scroll, and Sheet breakpoint), so it is placed directly as the body's right column.
   */
  metaRail?: ReactNode;
  /**
   * The page-level empty state for "no session selected/open" — nothing chosen yet, or the session list
   * is itself empty. `undefined` (the default) renders the existing EmptyState (pick a recent session
   * via the switcher, or start a new one). This is NOT D-HUX13's first-prompt choreography (a fresh but
   * ALREADY-SELECTED session opening with a centered composer + greeting + starter chips) — that lives
   * inside the `chatCanvas` slot below (a session IS selected in that case).
   */
  emptyIntro?: ReactNode;
  /**
   * Override for the conversation region of a SELECTED session. `undefined` (the default) renders the
   * real composition: the dot-grid `ChatCanvas` (D-HUX12) wrapping the `ConversationPane` transcript
   * (with in-stream mission cards), plus `EmptySessionIntro` (D-HUX13) layered on top as the single
   * composer host — centered greeting + starter chips for a fresh session, gliding ONCE to docked on the
   * first turn (`motion-reduce` instant), docked immediately for a session opened with history. Every
   * handler it needs (`onSend`/`onStop`, the conversation/mission/elicitation handlers,
   * `scrollToMessageId`) is built HERE and threaded down.
   */
  chatCanvas?: ReactNode;
};

export function AssistantView({ metaRail, emptyIntro, chatCanvas }: AssistantViewProps = {}) {
  const roster = useHubModelRoster();
  const navigate = useNavigate();
  // WP4.2 (D-AH13) — the Audit view's "deep-link into session replay": `?session=<id>` (a chat
  // session's own id — an audit row's `rootSessionId`) opens that session; `?message=<id>`
  // additionally scrolls the transcript to that turn (`ConversationPane`'s `scrollToMessageId`).
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkSessionId = searchParams.get("session");
  const scrollToMessageId = searchParams.get("message");
  // WP2.7 (D-HUX11, P3) — `/assistant/memory` redirects to `/assistant?memory=profile` (the redirect
  // itself is WP3.1's wiring); `?memory=profile` lands here as the initial state of the profile-memory
  // manage dialog, which the Context section's "Memory · manage" affordance also opens.
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(
    () => searchParams.get("memory") === "profile",
  );

  const [sessions, setSessions] = useState<HubSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<HubSession | null>(null);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  // WP3.1 (D-AH11c) — the project library, used by the new-session picker. Loaded once alongside the
  // session list; refreshed whenever the owner returns to this view (mirrors `refreshSessions`'s own
  // "cheap, idempotent" posture — no realtime project events to react to).
  const [projects, setProjects] = useState<HubProject[]>([]);
  // Session skills panel (WP2.4, R-SK1…R-SK6/R-SK8) — a per-SESSION settings dialog, closed by
  // default; opened from the toolbar's Skills button.
  const [showSkills, setShowSkills] = useState(false);
  // T3 fix (2026-07-25) — mirrors the meta rail's own `Sheet`-fallback heuristic. MUST be read BEFORE
  // seeding `metaRailVisible` below: on any mainstream laptop/mobile width (<1460px, i.e. narrow) the
  // rail is an overlay `Sheet`, and a `Sheet` must never auto-open over the conversation on load — the
  // previous unconditional `useState(true)` did exactly that, landing every /assistant visit at
  // 1280×800/1366×768/1440×900 with the transcript dimmed/blurred/`pointer-events:none` behind a panel
  // nobody opened. `useMetaRailNarrow`'s initial value is computed synchronously (from `matchMedia`) in
  // its own lazy `useState` initializer, so it's already correct on this very first render — safe to
  // fold into the lazy initializer below with no extra effect (and so NO resize-driven effect ever
  // forces the rail open/closed after mount; only the ONE-TIME initial default changes here).
  const railNarrow = useMetaRailNarrow();
  // Assistant Hub UX WP1.1 (D-HUX3) — the meta rail's ONE master show/hide toggle (the Cowork-panel
  // pattern). Wide layout (≥1460px) still opens by default, as before; narrow layout (the `Sheet`
  // fallback) defaults CLOSED (T3 fix) so it never covers the transcript uninvited.
  const [metaRailVisible, setMetaRailVisible] = useState(() => !railNarrow);
  // WP1.8 integration — the meta rail's Outputs "Open" (artifact) + Context "open pinned file" surfaces.
  // The rail lists; the caller shows (`ArtifactCanvas` in a Sheet · a project file in a light Dialog).
  const [artifactSheetOpen, setArtifactSheetOpen] = useState(false);
  const [pinnedFileTarget, setPinnedFileTarget] = useState<HubFile | null>(null);
  // WP4.2 (WP1.R-C) — the docked composer's measured height (from `EmptySessionIntro`'s
  // ResizeObserver); `null` until first measured. Drives the transcript's bottom clearance so a tall
  // composer (multi-line / attachments / running Stop) never covers the last message (the WP1.8 fixed
  // `h-40` reserve under-reserves). See `composerClearancePx`.
  const [composerHeight, setComposerHeight] = useState<number | null>(null);

  // T3 fix — the conversation region's own DOM node, used ONLY to find and refocus the composer's
  // editable field once the meta rail closes. Previously, closing the rail dropped focus to `<body>`:
  // in WIDE mode the rail wrapper gains the `inert` attribute on close, which forces the browser to
  // blur whatever was focused inside it (e.g. the rail's own "Hide the rail" button); in NARROW mode
  // the rail is a Radix `Sheet`/Dialog with no `SheetTrigger` to return focus to (it's driven
  // externally via `open`/`onOpenChange`), so Radix's default close-focus restoration has nothing to
  // land on either. Querying by the composer's existing stable `data-testid` (owned by `MentionEditor`,
  // out of this WP's file set) avoids needing a ref threaded through `ChatCanvas`/`EmptySessionIntro`/
  // `Composer` — none of which this WP may edit.
  const chatRegionRef = useRef<HTMLDivElement>(null);
  const focusComposer = useCallback(() => {
    chatRegionRef.current
      ?.querySelector<HTMLElement>('[data-testid="mention-editor"]')
      ?.focus();
  }, []);
  // WIDE mode's rail close (the rail's own "Hide the rail" header control, or the canvas's floating
  // "Show the rail" toggling back off) is a plain `inert` flip, not a Radix dialog — there's no
  // `onCloseAutoFocus` hook for it, so a falling-edge effect on `metaRailVisible` covers it. NARROW
  // mode's `Sheet` close is handled separately (and more robustly, given Radix's own async unmount
  // timing) via `onNarrowCloseAutoFocus` passed to `MetaRail` below — this effect deliberately skips
  // narrow mode so the two mechanisms never race each other.
  const prevMetaRailVisibleRef = useRef(metaRailVisible);
  useEffect(() => {
    const wasVisible = prevMetaRailVisibleRef.current;
    prevMetaRailVisibleRef.current = metaRailVisible;
    if (wasVisible && !metaRailVisible && !railNarrow) focusComposer();
  }, [metaRailVisible, railNarrow, focusComposer]);

  const activeSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const stream = useHubStream(activeSessionId);
  // WP1.7/fix-web GAP-E — reconstructed PURELY from the session's own event log (R-SES1), the same
  // pure derivation `ConversationPane` uses to decide plan-card vs. board. `undefined` means this
  // session has never proposed a mission yet — the signal `handleSend` uses to route the FIRST message
  // in a mission-mode session to the planner instead of a plain chat turn.
  const missionBoard = useMemo(() => reconstructMissionBoard(stream.events), [stream.events]);

  // The role library, fetched once, so the mission surfaces (progress rail, report cards, graph nodes)
  // can resolve each agent's custom avatar icon — by `roleId` (a reused saved role) OR by NAME (a
  // planner-invented agent whose name matches a saved role). Absent/loading ⇒ `RoleAvatar` falls back
  // to the model logo / a generic glyph, so this never blocks.
  const { state: rolesState } = useLoadable<HubAgentRole[]>(
    () => listHubAgentRoles({ includeArchived: true }),
    [],
  );
  const roleLookup = useMemo(
    () => buildMissionRoleLookup(loadableData(rolesState) ?? []),
    [rolesState],
  );
  // crew-nesting WP4.3 (D-CN5) — the saved-crew library, fetched once alongside the role library, so a
  // `crewId`-bearing PRE-RUN plan row (`MissionPlanCard`'s `PlannedCrewCard`) can resolve the crew's own
  // name/icon/topology preview. Absent/loading ⇒ the card falls back to the plan's own agent name and
  // shows the crew as not-found, so this never blocks.
  const { state: crewsState } = useLoadable<HubCrew[]>(() => listHubCrews(), []);
  const crewLookup = useMemo(
    () => buildMissionCrewLookup(loadableData(crewsState) ?? []),
    [crewsState],
  );
  const [missionBusy, setMissionBusy] = useState(false);

  // WP1.8 integration — the meta rail's async data (Outputs: artifacts/files/snapshots · Context:
  // project/pinned files/context inspector + WP1.5 effective memory), moved out of the retired asides
  // into one hook. Re-fetches on session switch AND on the falling edge of the live turn.
  const railData = useMetaRailData(activeSession, stream.turnRunning);

  const refreshSessions = useCallback(async (): Promise<void> => {
    try {
      const list = await listHubSessions({ kind: "chat" });
      setSessions(list);
    } catch (error) {
      notifyError("Couldn’t load sessions", { description: getErrorMessage(error) });
    } finally {
      setSessionsLoaded(true);
    }
  }, []);

  // WP3.1 — best-effort: a failed project fetch just means the new-session picker falls back to its
  // flat, ungrouped list (never blocks the session list itself from loading).
  const refreshProjects = useCallback(async (): Promise<void> => {
    try {
      setProjects(await listHubProjects());
    } catch {
      // Swallowed — see the comment above.
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    void refreshProjects();
  }, [refreshSessions, refreshProjects]);

  const selectSession = useCallback((session: HubSession) => {
    setActiveSessionId(session.id);
    setActiveSession(session);
    void markHubSessionSeen(session.id).catch(() => undefined); // best-effort
  }, []);

  // Session identity lives in the breadcrumb (`Home › Assistant › [Session ▾]`) — the switcher popover
  // leads with this session, then a searchable list of the rest. The status view is memoized on its
  // primitive inputs (not rebuilt every streamed token) so contributing the crumb doesn't thrash the
  // shell during a live turn. Placed above the provider-not-configured early return so the hook order
  // is stable. The toolbar no longer carries a session switcher or a status chip (both live here now).
  const breadcrumbStatusView = useMemo(
    () =>
      activeSession
        ? deriveRunStatusView({
            status: activeSession.status,
            ...(activeSession.stopReasonCode
              ? { stopReasonCode: activeSession.stopReasonCode }
              : {}),
            phase: stream.phase,
            queuePosition: stream.queuePosition,
          })
        : null,
    [activeSession, stream.phase, stream.queuePosition],
  );
  const sessionBreadcrumb = useMemo(
    () => (
      <SessionBreadcrumbSwitcher
        sessions={sessions}
        activeSessionId={activeSessionId}
        activeStatusView={breadcrumbStatusView}
        loading={!sessionsLoaded}
        onSelect={selectSession}
        onNewSession={() => setNewSessionOpen(true)}
        onViewAll={() => navigate("/assistant/sessions")}
      />
    ),
    [sessions, activeSessionId, breadcrumbStatusView, sessionsLoaded, selectSession, navigate],
  );
  useSetBreadcrumbSlot(sessionBreadcrumb);

  // Nav "＋ New session" (the hover action AND the collapsed-rail item, both in `AppShell`) navigate
  // here with `?new=1`; open the dialog and consume the param so a refresh/back doesn't reopen it.
  const openNewParam = searchParams.get("new");
  useEffect(() => {
    if (openNewParam === null) return;
    setNewSessionOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }, [openNewParam, setSearchParams]);

  // WP4.2 — resolve the `?session=` deep link once the session list has loaded. Consumed once per
  // distinct value (`consumedDeepLinkRef`) so switching sessions afterward via the switcher isn't fought
  // by a stale param on every re-render; an id that no longer resolves (the session was deleted) gets
  // an honest toast rather than a silent no-op.
  const consumedDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkSessionId || !sessionsLoaded) return;
    if (consumedDeepLinkRef.current === deepLinkSessionId) return;
    consumedDeepLinkRef.current = deepLinkSessionId;
    const target = sessions.find((s) => s.id === deepLinkSessionId);
    if (!target) {
      notifyError("Couldn’t open that session", { description: "It may have been deleted." });
      return;
    }
    selectSession(target);
  }, [deepLinkSessionId, sessionsLoaded, sessions, selectSession]);

  // Default selection once sessions load: the most recently active session, if any — skipped while a
  // `?session=` deep link is still pending (the effect above owns that case).
  useEffect(() => {
    if (activeSessionId !== null || !sessionsLoaded || deepLinkSessionId) return;
    const [mostRecent] = sessions;
    if (mostRecent) selectSession(mostRecent);
  }, [activeSessionId, sessionsLoaded, sessions, selectSession, deepLinkSessionId]);

  const refreshActiveSession = useCallback(async (id: string): Promise<void> => {
    try {
      const detail = await getHubSession(id);
      if (activeSessionIdRef.current !== id) return; // stale — the owner switched sessions meanwhile
      setActiveSession(detail.session);
      setSessions((current) =>
        current.some((s) => s.id === id)
          ? current.map((s) => (s.id === id ? detail.session : s))
          : current,
      );
    } catch {
      // Best-effort — the toolbar just keeps showing the last known title/status.
    }
  }, []);

  // Refresh the session list + the active session's own row once a turn SETTLES (title auto-refine,
  // updatedAt, token/cost totals) — mirrors the Assistant dock's identical settle-triggered refresh, and
  // keeps the toolbar's switcher/status badge fresh without the caller needing to poll.
  const prevRunningRef = useRef(false);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = stream.turnRunning;
    if (!wasRunning || stream.turnRunning) return;
    void refreshSessions();
    const id = activeSessionIdRef.current;
    if (id) void refreshActiveSession(id);
  }, [stream.turnRunning, refreshSessions, refreshActiveSession]);

  const handleCreateSession = useCallback(
    async (input: HubSessionCreateInput): Promise<void> => {
      const created = await createHubSession(input);
      setSessions((current) => [created, ...current.filter((s) => s.id !== created.id)]);
      selectSession(created);
    },
    [selectSession],
  );

  const handleSend = useCallback(
    async (input: HubSendMessageInput): Promise<void> => {
      const id = activeSessionIdRef.current;
      if (!id) return;
      // GAP-E — a mission-mode session's FIRST message runs the in-band planner turn (proposes a
      // team) instead of a plain chat turn; `missionBoard` is undefined until this session has
      // proposed one. Once a mission exists, sending falls through to the normal chat turn — where,
      // per v1-fixes (F4), the MODEL now holds `mission.propose_plan` (post-terminal) and the routing
      // bridge turns its call into a real proposal; the board's follow-up chips (F7) are the
      // deterministic UI path to the same thing.
      if (activeSession?.mode === "mission" && !missionBoard) {
        // model-identity WP6.1 (F7) — carry the composer's model chip (and the credential behind it)
        // into the planner turn. Previously only `text` was sent, so an explicit "run this on the
        // Anthropic CLI Sonnet" was discarded and the planner ran on the session's pair instead.
        await proposeHubMission(id, {
          text: input.text,
          ...(input.model ? { model: input.model } : {}),
          ...(input.providerCredentialId
            ? { providerCredentialId: input.providerCredentialId }
            : {}),
        });
        return;
      }
      await sendHubMessage(id, input);
    },
    [activeSession, missionBoard],
  );

  const handleStarterSelect = useCallback(
    (text: string) => {
      void handleSend({ text }).catch((error: unknown) => {
        notifyError("Couldn’t send message", { description: getErrorMessage(error) });
      });
    },
    [handleSend],
  );

  const handleStop = useCallback(() => {
    const id = activeSessionIdRef.current;
    if (!id) return;
    void stopHubSession(id).catch((error: unknown) => {
      notifyError("Couldn’t stop the assistant", { description: getErrorMessage(error) });
    });
  }, []);

  // WP2.3 (R-MCP3/R-UX1) — decide an approval-gated tool call. The `approval_requested`/`_responded`
  // + settled `tool_result` all arrive back on the session's SSE stream — this only fires the decision.
  const handleToolDecision = useCallback((toolCallId: string, decision: HubApprovalResolution) => {
    const id = activeSessionIdRef.current;
    if (!id) return;
    void decideHubApproval(id, toolCallId, decision).catch((error: unknown) => {
      notifyError("Couldn’t record your decision", { description: getErrorMessage(error) });
    });
  }, []);
  const conversationHandlers: ConversationHandlers = { onToolDecision: handleToolDecision };

  // WP2.3 (R-MCP4) — respond to a pending MCP elicitation (form submit or decline/URL).
  const handleElicitationRespond = useCallback(
    (values: Record<string, unknown>) => {
      const id = activeSessionIdRef.current;
      const elicitationId = stream.pendingElicitation?.elicitationId;
      if (!id || !elicitationId) return;
      // The MCP `ElicitResult.content` contract is flat primitives — keep only those (arrays of strings
      // allowed); anything else is coerced to a string so the response still round-trips.
      const content: Record<string, string | number | boolean | string[]> = {};
      for (const [key, value] of Object.entries(values)) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          (Array.isArray(value) && value.every((v) => typeof v === "string"))
        ) {
          content[key] = value as string | number | boolean | string[];
        } else if (value !== undefined && value !== null) {
          content[key] = String(value);
        }
      }
      void respondHubElicitation(id, { elicitationId, action: "accept", content }).catch(
        (error: unknown) => {
          notifyError("Couldn’t submit", { description: getErrorMessage(error) });
        },
      );
    },
    [stream.pendingElicitation],
  );
  const handleElicitationDecline = useCallback(() => {
    const id = activeSessionIdRef.current;
    const elicitationId = stream.pendingElicitation?.elicitationId;
    if (!id || !elicitationId) return;
    void respondHubElicitation(id, { elicitationId, action: "decline" }).catch((error: unknown) => {
      notifyError("Couldn’t decline", { description: getErrorMessage(error) });
    });
  }, [stream.pendingElicitation]);

  // Authenticate an MCP server that failed with an auth error this turn — opens the SAME ServerWizard
  // reauth window the Servers view uses (the sanctioned path; never a bespoke modal), then evicts the
  // cached session so the fresh token is used on the next turn. Mirrors App.tsx's testServer reauth→retry.
  const mcpAuth = useMcpAuthOptional();
  const handleAuthenticateServer = useCallback(
    (serverId: string, serverName: string) => {
      if (!mcpAuth) return;
      void (async () => {
        try {
          const result = await mcpAuth.requestReauth(serverId);
          if (!result.ok) return; // cancelled, or not a reauth-able (oauth-http) server
          await reconnectHubMcpServer(serverId);
          toast.success(`Authenticated ${serverName}`, {
            description: "It'll be used on your next message in this session.",
          });
        } catch (error) {
          notifyError(`Couldn’t authenticate ${serverName}`, {
            description: getErrorMessage(error),
          });
        }
      })();
    },
    [mcpAuth],
  );

  // WP2.3 (D-AH6) — the autonomy dial. Optimistic (updates local state), restored on failure. Rendered
  // in the toolbar now (D-HUX2/§7.1), not inside the conversation header.
  const handleAutonomyChange = useCallback(
    (next: HubAutonomyLevel) => {
      const current = activeSession;
      if (!current || current.autonomy === next) return;
      setActiveSession({ ...current, autonomy: next });
      void setHubAutonomy(current.id, next)
        .then((updated) => {
          if (activeSessionIdRef.current === updated.id) setActiveSession(updated);
        })
        .catch((error: unknown) => {
          setActiveSession(current); // restore the previous dial on failure
          notifyError("Couldn’t change autonomy", { description: getErrorMessage(error) });
        });
    },
    [activeSession],
  );

  // WP1.7/fix-web GAP-E — mission-control actions (approve/edit/stop), wired into `ConversationPane`'s
  // in-band `MissionPlanCard`/`MissionBoard`. Every settled effect (plan_updated/plan_approved/
  // agent_*/mission_synthesis) arrives back on the session's own SSE stream — these handlers only fire
  // the request and surface a failure; they never optimistically mutate local state.
  const runMissionAction = useCallback(
    async (action: () => Promise<unknown>, errorTitle: string): Promise<void> => {
      setMissionBusy(true);
      try {
        await action();
      } catch (error) {
        notifyError(errorTitle, { description: getErrorMessage(error) });
      } finally {
        setMissionBusy(false);
      }
    },
    [],
  );

  const handleApproveMission = useCallback(
    (missionId: string) => {
      void runMissionAction(() => approveHubMission(missionId), "Couldn’t approve the mission");
    },
    [runMissionAction],
  );

  const handleEditMissionPlan = useCallback(
    (missionId: string, plan: HubMissionPlan) => {
      void runMissionAction(() => editHubMissionPlan(missionId, plan), "Couldn’t update the plan");
    },
    [runMissionAction],
  );

  // The plan card's Cancel and the board's Stop-all both settle through the SAME stop route (it
  // cancels a still-proposed mission, or aborts a running one) — see `lib/api.ts#stopHubMission`.
  const handleCancelMission = useCallback(
    (missionId: string) => {
      void runMissionAction(() => stopHubMission(missionId), "Couldn’t cancel the mission");
    },
    [runMissionAction],
  );

  const handleStopMission = useCallback(
    (missionId: string) => {
      void runMissionAction(() => stopHubMission(missionId), "Couldn’t stop the mission");
    },
    [runMissionAction],
  );

  const handleStopAgent = useCallback(
    (missionId: string, agentSessionId: string) => {
      void runMissionAction(
        () => stopHubMissionAgent(missionId, agentSessionId),
        "Couldn’t stop the agent",
      );
    },
    [runMissionAction],
  );

  // WP2.3 — steer a running mission agent (R-SES3/R-UX4); not routed through `runMissionAction` (it
  // shouldn't disable the whole board's controls) — a lightweight fire-and-toast.
  const handleSteerAgent = useCallback(
    (missionId: string, agentSessionId: string, text: string) => {
      void steerHubMissionAgent(missionId, agentSessionId, text).catch((error: unknown) => {
        notifyError("Couldn’t steer the agent", { description: getErrorMessage(error) });
      });
    },
    [],
  );

  // v1-fixes (F7) — one-click follow-up mission from a report's open question. The server allows a new
  // proposal once the previous mission is terminal (the 409 gate protects a still-running one), and the
  // planner receives the previous mission's digest as context, so the follow-up team builds on results.
  const handleProposeFollowup = useCallback(
    (question: string) => {
      const id = activeSessionIdRef.current;
      if (!id) return;
      void runMissionAction(
        () =>
          // No model/credential here on purpose: a follow-up chip carries no composer selection, so it
          // runs on the session's own pair (the unchanged default).
          proposeHubMission(id, {
            text: `Investigate this open question from the previous mission: ${question}`,
          }),
        "Couldn’t propose the follow-up mission",
      );
    },
    [runMissionAction],
  );

  const missionHandlers: MissionHandlers = {
    onApproveMission: handleApproveMission,
    onEditMissionPlan: handleEditMissionPlan,
    onCancelMission: handleCancelMission,
    onStopMission: handleStopMission,
    onStopAgent: handleStopAgent,
    onSteerAgent: handleSteerAgent,
    onProposeFollowup: handleProposeFollowup,
    busy: missionBusy,
  };

  if (!roster.loading && !roster.hasCredential) {
    return (
      <PageShell scroll="fill" contentClassName="items-center justify-center">
        <Heading level={1} className="sr-only">
          Assistant
        </Heading>
        <EmptyState
          icon={<Bot aria-hidden />}
          title="The Assistant isn't configured"
          description={`Add a provider credential (${HUB_PROVIDER_KIND_PROSE}) in Settings first.`}
          actions={
            <Button asChild>
              <Link to="/settings">
                <Settings aria-hidden />
                <span>Open Settings</span>
              </Link>
            </Button>
          }
        />
      </PageShell>
    );
  }

  // WP1.8 integration — the REAL meta rail (D-HUX3), superseding the Wave-1 placeholder. Progress reads
  // synchronously from the live stream + mission handlers this file already owns; Outputs/Context read
  // from `railData`. `MetaRail` is self-contained (its own 360px width, border, scroll, and ~1100px
  // `Sheet` fallback) and animates `open` in wide mode — so it's rendered directly as the body's right
  // column, NOT wrapped in this file's old width div. The context-window/prompt-sections meter was
  // removed per owner feedback; the Context section now surfaces the active MCP servers + skills instead.
  const metaRailContent = metaRail ?? (
    <MetaRail
      open={metaRailVisible}
      onOpenChange={setMetaRailVisible}
      isNarrow={railNarrow}
      // T3 fix — the narrow `Sheet` has no `SheetTrigger` to return focus to on close (it's driven
      // externally), so Radix's default `onCloseAutoFocus` would otherwise land focus on `<body>`.
      // Cancel the default and send it to the composer instead.
      onNarrowCloseAutoFocus={(event) => {
        event.preventDefault();
        focusComposer();
      }}
      progress={{
        tasks: stream.tasks,
        missionBoard,
        roleLookup,
        ...(missionBoard?.plan.budgets ? { missionBudgets: missionBoard.plan.budgets } : {}),
        busy: missionBusy,
        onStopMission: handleStopMission,
        onStopAgent: handleStopAgent,
        onSteerAgent: handleSteerAgent,
      }}
      outputs={{
        artifacts: railData.artifacts,
        onOpenArtifact: () => setArtifactSheetOpen(true),
        files: railData.files,
        getFileDownloadUrl: (file) => hubFileContentUrl(file.id),
        snapshots: railData.snapshots,
        onRestoreSnapshot: (snapshotId) => void railData.restoreSnapshot(snapshotId),
        busy: railData.restoring,
      }}
      context={{
        session: activeSession,
        project: railData.project,
        projectLoaded: railData.projectLoaded,
        projectError: railData.projectError,
        pinnedFiles: railData.pinnedFiles,
        onOpenPinnedFile: (file) => setPinnedFileTarget(file),
        inspector: railData.inspector,
        // The session skills panel — a small ghost "Manage" action in the Context's Skills header.
        onManageSkills: () => setShowSkills(true),
        ...(railData.effectiveMemory
          ? {
              effectiveMemory: (
                <EffectiveMemoryStack
                  memory={railData.effectiveMemory}
                  onManageProfile={() => setMemoryDialogOpen(true)}
                />
              ),
              onManageMemory: () => setMemoryDialogOpen(true),
            }
          : {}),
      }}
    />
  );

  // WP1.8 integration — the SELECTED session's conversation region (D-HUX12/D-HUX13): the dot-grid
  // `ChatCanvas` behind the transcript, with `EmptySessionIntro` layered on top as the ONE composer
  // host for the session's whole life. A fresh session opens centered (greeting + starter chips) and
  // glides ONCE to docked on the first turn (`introDocked`); a session opened WITH history starts
  // docked instantly. Because `EmptySessionIntro` owns the composer through that transition via its
  // render-prop, the composer is a SINGLE instance that never remounts (no focus loss) — it only
  // remounts on a real session switch (`key`). `ConversationPane` yields its generic empty state to the
  // intro and reserves bottom clearance for the floating docked composer.
  // Seeded from the session's own settled `turns` (synchronous with a session switch), so a freshly
  // opened EMPTY session reliably starts CENTERED (welcome emblem) instead of inheriting the previous
  // session's docked state from the stream — which resets a render late. See `resolveIntroDockState`.
  const introDocked =
    resolveIntroDockState({
      turns: activeSession?.turns,
      turnRunning: stream.turnRunning,
      timelineLength: stream.timeline.length,
    }) === "docked";
  const chatCanvasContent =
    chatCanvas ??
    (activeSession ? (
      <ChatCanvas
        className="h-full"
        // T3 fix — ALWAYS pass the real hidden state (never force `false` in narrow mode). The rail's
        // Sheet has no toolbar toggle of its own, so this floating "Show the rail" affordance is the
        // ONLY way to reopen it after it's dismissed at any width — without it, a narrow-mode dismissal
        // was permanent until a page reload.
        railHidden={!metaRailVisible}
        onShowRail={() => setMetaRailVisible(true)}
      >
        <ConversationPane
          stream={stream}
          session={activeSession}
          onStarterSelect={handleStarterSelect}
          handlers={conversationHandlers}
          mission={missionHandlers}
          roleLookup={roleLookup}
          crewLookup={crewLookup}
          elicitation={stream.pendingElicitation}
          onElicitationRespond={handleElicitationRespond}
          onElicitationDecline={handleElicitationDecline}
          {...(mcpAuth ? { onAuthenticateServer: handleAuthenticateServer } : {})}
          scrollToMessageId={activeSession.id === deepLinkSessionId ? scrollToMessageId : undefined}
          hideGenericEmptyState
          // WP4.2 (WP1.R-C) — reserve the MEASURED composer clearance once known; fall back to the
          // fixed `h-40` (`composerInset` = true) until `EmptySessionIntro` reports a height.
          composerInset={composerHeight != null ? composerClearancePx(composerHeight) : true}
        />
        <EmptySessionIntro
          key={activeSession.id}
          onSelectStarter={handleStarterSelect}
          dockState={introDocked ? "docked" : "centered"}
          onComposerHeightChange={setComposerHeight}
          composer={(dock) => (
            <Composer
              session={activeSession}
              turnRunning={stream.turnRunning}
              onSend={handleSend}
              onStop={handleStop}
              models={roster.models}
              modelsLoading={roster.loading}
              unavailableCredentials={roster.unavailable}
              autonomy={activeSession.autonomy ?? "always_ask"}
              onAutonomyChange={handleAutonomyChange}
              dockPosition={dock}
            />
          )}
        />
      </ChatCanvas>
    ) : null);

  const emptyIntroContent = emptyIntro ?? (
    <div className="flex h-full min-h-0 flex-col items-center justify-center p-6">
      {!sessionsLoaded ? (
        <Spinner className="size-5" />
      ) : (
        <EmptyState
          icon={<Bot aria-hidden />}
          title="No session open"
          description="Pick a recent session above, or start a new one."
          actions={<Button onClick={() => setNewSessionOpen(true)}>New session</Button>}
        />
      )}
    </div>
  );

  return (
    <PageShell
      width="full"
      scroll="fill"
      bodyGutter="none"
      contentClassName="gap-0"
    >
      {/* The AppShell breadcrumb (Assistant) names the page; keep the H1 for AT only (D-HUX2/§8.2). */}
      <Heading level={1} className="sr-only">
        Assistant
      </Heading>

      <div className="flex min-h-0 flex-1">
        {/* Conversation region — the ONLY scroll region (D-HUX1/§7.1); the transcript pane owns that
            scroll internally, this column just fills the remaining width. Also the anchor `focusComposer`
            (T3 fix) searches from when the meta rail closes. */}
        <div ref={chatRegionRef} className="relative flex min-w-0 flex-1 flex-col">
          {activeSession ? chatCanvasContent : emptyIntroContent}
        </div>

        {/* Meta rail (D-HUX3) — self-contained 360px `shrink-0` column (own scroll + border + ~1100px
            `Sheet` fallback); the toolbar toggle drives its `open`. Renders nothing when hidden in wide
            mode, a right `Sheet` when narrow — so it's placed directly, not in a width wrapper. */}
        {metaRailContent}
      </div>

      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        models={roster.models}
        modelsLoading={roster.loading}
        unavailableCredentials={roster.unavailable}
        onCreate={handleCreateSession}
        projects={projects}
      />

      {/* WP2.7 (D-HUX11, P3) — the profile-memory manage dialog: Context's "Memory · manage" AND the
          `/assistant?memory=profile` deep link (the eventual `/assistant/memory` redirect target). */}
      <ProfileMemoryDialog open={memoryDialogOpen} onOpenChange={setMemoryDialogOpen} />

      {activeSession ? (
        <SessionSkillsPanel
          sessionId={activeSession.id}
          open={showSkills}
          onOpenChange={setShowSkills}
        />
      ) : null}

      {/* WP1.8 integration — the meta rail's Outputs "Open" action shows the full artifact experience
          (browse/version/review/revert/export/share) in a right `Sheet`; the rail only lists. */}
      {activeSession ? (
        <Sheet open={artifactSheetOpen} onOpenChange={setArtifactSheetOpen}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
            <SheetHeader className="sr-only">
              <SheetTitle>Artifacts</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center p-6">
                    <Spinner className="size-5" />
                  </div>
                }
              >
                <ArtifactCanvas
                  sessionId={activeSession.id}
                  turnRunning={stream.turnRunning}
                  onClose={() => setArtifactSheetOpen(false)}
                />
              </Suspense>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}

      {/* WP1.8 integration — the Context section's "open pinned file" shows the project file's text. */}
      <HubPinnedFileDialog
        projectId={activeSession?.projectId ?? null}
        file={pinnedFileTarget}
        onClose={() => setPinnedFileTarget(null)}
      />
    </PageShell>
  );
}
