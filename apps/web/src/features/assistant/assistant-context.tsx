import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  AssistantAuthStatus,
  AssistantContextEnvelope,
  AssistantEntityKind,
} from "@mcp-token-footprint/shared";
import { resolveAssistantUiAction } from "@mcp-token-footprint/shared";
import { getAssistantAuthStatus } from "../../lib/api";
import { useFeatureEnabled } from "../feature-flags/feature-flags-context";

const DOCK_OPEN_STORAGE_KEY = "mcp-token-footprint.assistant.dock-open";

/**
 * Where `openAssistant({ entity })` pins the new/reused thread. Deliberately the same shape as
 * `AssistantContextEnvelope`'s own `entityKind`/`entityId` pair, just grouped — see `ASSISTANT_ENTITY_KINDS`
 * in `packages/shared/src/constants.ts` for the frozen (WP 0.1) kind vocabulary.
 */
export type AssistantEntityRef = { kind: AssistantEntityKind; id: string };

/**
 * The public request shape `openAssistant()` accepts — FROZEN for WP 1.4 / 2.1 / 3.2 page hooks (see
 * the WP 1.3 handback). Both fields are optional: `openAssistant()` alone just opens the dock on
 * whatever thread was last active.
 */
export type AssistantOpenRequest = {
  /** A prefilled, still-editable prompt (e.g. "Analyze this run") — never auto-sent. */
  prompt?: string;
  /** Pin the dock to (an existing or freshly-created) thread pinned to this entity. */
  entity?: AssistantEntityRef;
};

/** One `openAssistant()` call, stamped with a `nonce` so the dock (which consumes it exactly once)
 *  can tell a repeat request with identical content apart from a stale one it already handled. */
export type AssistantPendingRequest = AssistantOpenRequest & { nonce: number };

export type AssistantContextValue = {
  isOpen: boolean;
  /** THE STABLE PUBLIC API — see {@link AssistantOpenRequest}. Opens the dock and, when given,
   *  registers a one-shot pin/prefill request the dock resolves (see {@link pendingRequest}). */
  openAssistant: (request?: AssistantOpenRequest) => void;
  closeAssistant: () => void;
  toggleAssistant: () => void;
  /** The one-shot open request the dock has not yet consumed; `null` once idle/consumed. */
  pendingRequest: AssistantPendingRequest | null;
  /** The dock calls this once it has acted on {@link pendingRequest} (thread resolved / prompt applied). */
  clearPendingRequest: () => void;
  /** `null` while the first check is in flight; redacted (never the token) — see `AssistantAuthStatus`. */
  authStatus: AssistantAuthStatus | null;
  /** `signedIn || fallbackConfigured` — mirrors the API's own `isAuthConfigured()` gate
   *  (`apps/api/src/assistant/session-manager.ts`). `false` while `authStatus` is still loading. */
  authConfigured: boolean;
  /** Re-check auth status (called on every `openAssistant()`, and available for the dock/Settings to
   *  call after the owner signs in/out so the toggle reacts without a full reload). */
  refreshAuthStatus: () => Promise<void>;
  /** The CURRENT route's envelope (route + entity/tab where inferable) — attach this to every
   *  outgoing message so "this run"/"this skill" resolves without the user pasting ids (D-AS7). */
  currentEnvelope: AssistantContextEnvelope;
  /**
   * WP 3.1 (D-AS8/D-AS16) — THE CLIENT EXECUTOR for a `ui_*` navigation tool. Call this for a
   * `ui_action` event ONLY once it is known to be LIVE (`!uiAction.isReplay` — see
   * `use-assistant-stream.ts`'s `liveSinceSeq`); a replayed one must render as an inert chip instead
   * (`AssistantUiActionChip.tsx`) and must NEVER call this. Re-resolves `{action, params}` against the
   * SAME shared addressable-view registry (`packages/shared/src/assistant-ui-registry.ts`) the API
   * tool validated before ever emitting the event, then navigates via react-router `navigate()` — a
   * normal history push, so browser Back still works. A resolution failure here would mean the two
   * call sites of the registry disagree (a bug, since the event could only exist if the API's OWN
   * resolution already succeeded) — logged, never a navigation to nowhere.
   */
  executeUiAction: (action: string, params: Record<string, unknown>) => void;
  /**
   * WP R1.4 (D-AS22) — the dock's currently active thread id, reported by `AssistantDock` while it is
   * mounted (i.e. the dock is open) AND has picked/created a thread; `null` while the dock is closed
   * (unmounted — see `AppShell`'s `showDock`) or before it has resolved one. Lets a page surface OUTSIDE
   * the dock (the Skills Files view, WP R1.4) know which thread's live skill-workspace to read/subscribe
   * to, without reaching into any dock internals — see `AssistantDock.tsx`'s report effect.
   */
  activeAssistantThreadId: string | null;
  /** Called by `AssistantDock` only — every other consumer just reads {@link activeAssistantThreadId}. */
  setActiveAssistantThreadId: (id: string | null) => void;
  /**
   * One-shot "the dock was just EXPANDED from closed with no page-hook payload" flag — the owner's
   * "opening the panel starts a fresh session" behavior. `AssistantDock` reads (and clears) it ONCE at
   * mount: `true` → open on the blank "Start a conversation" state instead of auto-selecting the last
   * thread; `false` → the pre-existing behavior (auto-select the most recent). A page-hook
   * `openAssistant({entity/prompt})` never sets it (that path pins/prefills a thread via `pendingRequest`).
   * Consumed rather than a snapshot value because the flag is set BEFORE the dock (re)mounts, so only a
   * consume-once read can tell a fresh expand apart from an ordinary mount (e.g. a page reload).
   */
  consumeFreshSessionOpen: () => boolean;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(DOCK_OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredOpen(open: boolean): void {
  try {
    window.localStorage.setItem(DOCK_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // localStorage unavailable (private mode / disabled) — the open state just won't persist.
  }
}

/**
 * `/testing/runs/new` and `/testing/runs/compare` are static siblings of the dynamic
 * `/testing/runs/:runId` route (see `App.tsx`'s own `isRunConsoleRoute` exclusion, which this
 * mirrors) — neither names a real run, so they must not resolve to a `run` entity pin.
 */
const NON_RUN_ID_SEGMENTS = new Set(["new", "compare"]);

/** Match `pathname` against one `/prefix/:id` shape; returns the id or `undefined`. */
function matchId(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  const rest = pathname.slice(prefix.length);
  const id = rest.split("/")[0];
  return id && id.length > 0 ? id : undefined;
}

/**
 * Reconcile the entity PIN a route carries with the R1.1 page-scope lock (D-AS19). The pin's
 * `{kind, id}` becomes the envelope's `entityKind`/`entityId`, which `deriveAssistantScope`
 * (`@mcp-token-footprint/shared`) turns into the thread's WRITE scope; `SCOPE_WRITE_TOOLS[kind]` is
 * then the set of writes allowed on that page. So a kind is only USEFUL to scope if (a) it has write
 * tools and (b) the URL names a single entity id for it.
 *
 * Mapping — the 9 `ASSISTANT_ENTITY_KINDS` ↔ `SCOPE_WRITE_TOOLS` keys ↔ what a URL can derive TODAY:
 *   - server      → `/servers/:serverId`               ✓ derivable · writes: servers_update_config
 *   - scan        → `/scans/:scanId`                    ✓ derivable · writes: [] (read-only surface)
 *   - skill       → `/skills/:skillId`                  ✓ derivable · writes: skills_open/commit_workspace
 *   - collection  → `/testing/collections/:collectionId`✓ derivable · writes: collections_modify
 *   - suite_run   → `/testing/suite-runs/:suiteRunId`   ✓ derivable · writes: suites_* (allowlist-only —
 *                     a suite_run's id is a suite-RUN id, not a suiteId, so no id-match; see shared)
 *   - run         → `/testing/runs/:runId`              ✓ derivable · writes: [] (read-only surface)
 *   - scenario    → `/testing/environments`             ✗ NOT derivable — the view holds the selected
 *                     environment/test in internal React state, no `:id` route and no `?…` param today.
 *                     Its environment/test write tools are therefore never in-scope from the URL yet.
 *   - test        → (no per-test detail route; `/testing/tests` redirects to collections) ✗ NOT derivable.
 *   - compare     → `/compare/scans`, `/testing/runs/compare` ✗ INHERENTLY unscoped — a compare view's
 *                     URL names NO single entity id. That is correct BY DESIGN: `SCOPE_WRITE_TOOLS.compare`
 *                     is `[]`, so compare is read-only regardless; `deriveAssistantScope` returns null
 *                     (unscoped) for it, which is the intended read-only posture. We deliberately do NOT
 *                     fabricate a `compare` pin.
 *
 * Deferred / drift (see the R1.1 handback), NOT worked around here:
 *   - scenario/test pins are a follow-up once EnvironmentsView encodes the selected env/test in the URL.
 *   - `/testing/suites/:suiteId` DOES carry a suite id, but there is no `suite` entity kind in the
 *     frozen 9-kind vocabulary (only `suite_run`, whose id is a suite-run id) — so a suite-DEFINITION
 *     edit page can't be pinned today without touching the frozen kind list (out of scope for R1.1).
 *
 * `/reports/scans/:scanId` (assistant-operability WP 4.2, D-AO4 upgrade) is a scan-REPORT page, but it
 * names the same scan id a `/scans/:scanId` detail page would — so it pins to the EXISTING `scan` kind
 * (no new entity kind, D-AO3). `matchId` is prefix-based, so this checks the `/reports/scans/` prefix
 * specifically and can never collide with the `/scans/` prefix above (a `/reports/scans/…` path does not
 * start with `/scans/`) nor with the sibling `/reports/digest/:id` route, which stays unpinned.
 *
 * Only a real id in the URL yields a pin — never a fabricated one.
 */
function resolveEntityPin(pathname: string): AssistantEntityRef | undefined {
  const server = matchId(pathname, "/servers/");
  if (server) return { kind: "server", id: server };
  const scan = matchId(pathname, "/scans/");
  if (scan) return { kind: "scan", id: scan };
  const reportScan = matchId(pathname, "/reports/scans/");
  if (reportScan) return { kind: "scan", id: reportScan };
  const skill = matchId(pathname, "/skills/");
  if (skill) return { kind: "skill", id: skill };
  const collection = matchId(pathname, "/testing/collections/");
  if (collection) return { kind: "collection", id: collection };
  const suiteRun = matchId(pathname, "/testing/suite-runs/");
  if (suiteRun) return { kind: "suite_run", id: suiteRun };
  const run = matchId(pathname, "/testing/runs/");
  if (run && !NON_RUN_ID_SEGMENTS.has(run)) return { kind: "run", id: run };
  // scenario / test / compare / suite-definition: no single entity id in the URL today (see the doc
  // block above) — deliberately unpinned (compare stays read-only by design; the others are deferred).
  return undefined;
}

/**
 * Derive the current route's {@link AssistantContextEnvelope} — route + entity kind/id (where the URL
 * names one) + `tab` (a `?tab=` query param, where present; this app doesn't yet encode a tab in every
 * route, so this is honestly best-effort, not a full per-route tab registry). Pure and unit-tested
 * without React — see `assistant-context.test.tsx`.
 */
export function deriveAssistantEnvelope(
  pathname: string,
  search: string,
): AssistantContextEnvelope {
  const envelope: AssistantContextEnvelope = { route: pathname };
  const tab = new URLSearchParams(search).get("tab");
  if (tab) envelope.tab = tab;
  const pin = resolveEntityPin(pathname);
  if (pin) return { ...envelope, entityKind: pin.kind, entityId: pin.id };
  return envelope;
}

/**
 * Mounted once near the app root (`main.tsx`, inside the router). Owns the dock's open/close state
 * (persisted to `localStorage`) and the auth-status check that gates the feature's visibility
 * (D-AS-alignment: "hidden entirely while signed out" — see `AppShell`'s `dockAvailable`). Exposes the
 * FROZEN `openAssistant()` API via {@link useAssistant}; `AssistantDock` (mounted only while the dock
 * is open — see `AppShell`) does the actual thread/stream IO.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState<boolean>(() => readStoredOpen());
  const [pendingRequest, setPendingRequest] = useState<AssistantPendingRequest | null>(null);
  const [authStatus, setAuthStatus] = useState<AssistantAuthStatus | null>(null);
  const nonceRef = useRef(0);
  // "Start a fresh session on expand" (owner refinement) — set true on a closed→open plain expand,
  // consumed once by the dock at mount (see `consumeFreshSessionOpen`).
  const freshOpenPendingRef = useRef(false);
  // Latest `isOpen`, read inside stable callbacks so they can tell a closed→open transition apart from
  // an open that's already open without depending on (and churning with) the `isOpen` state.
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);
  // WP R1.4 (D-AS22) — see `activeAssistantThreadId`'s doc on `AssistantContextValue`.
  const [activeAssistantThreadId, setActiveAssistantThreadId] = useState<string | null>(null);

  // Settings › Features — the operator's Assistant on/off switch. While it is off the API answers
  // 403 for `/api/assistant/*`, so this provider stops polling auth status entirely (a pointless
  // request whose only outcome would be a rejection) and force-closes the dock below.
  const assistantFeatureEnabled = useFeatureEnabled("assistant");

  const refreshAuthStatus = useCallback(async () => {
    if (!assistantFeatureEnabled) {
      setAuthStatus(null);
      return;
    }
    try {
      setAuthStatus(await getAssistantAuthStatus());
    } catch {
      // Best-effort — fail closed: the toggle/dock simply stay hidden until the next successful check.
    }
  }, [assistantFeatureEnabled]);

  useEffect(() => {
    void refreshAuthStatus();
  }, [refreshAuthStatus]);

  // Turning the feature off with the dock open closes (and un-persists) it immediately.
  useEffect(() => {
    if (!assistantFeatureEnabled) setIsOpen(false);
  }, [assistantFeatureEnabled]);

  useEffect(() => {
    writeStoredOpen(isOpen);
  }, [isOpen]);

  const authConfigured =
    authStatus !== null && (authStatus.signedIn || authStatus.fallbackConfigured);

  // Force-close (and un-persist) an already-open dock the moment auth status resolves to "not
  // configured" — e.g. the owner just signed out via Settings in another tab. Skipped while
  // `authStatus` is still loading (`null`) so a fresh page load never flash-closes a persisted-open
  // dock before the first status check has even resolved.
  useEffect(() => {
    if (authStatus !== null && !authConfigured) setIsOpen(false);
  }, [authStatus, authConfigured]);

  const closeAssistant = useCallback(() => setIsOpen(false), []);
  const clearPendingRequest = useCallback(() => setPendingRequest(null), []);

  const openAssistant = useCallback(
    (request: AssistantOpenRequest = {}) => {
      // A "plain" expand carries no page-hook payload → start a fresh session. A closed→open plain
      // expand flags the next dock mount to open BLANK instead of resuming the last thread (owner
      // refinement). A page-hook open (entity/prompt) pins/prefills a thread instead, so never flags it.
      const plainExpand = request.prompt === undefined && request.entity === undefined;
      if (plainExpand && !isOpenRef.current) freshOpenPendingRef.current = true;
      setIsOpen(true);
      // Re-check on every open — the owner may have signed in/out via Settings since this provider
      // (mounted once, near the app root) last checked.
      void refreshAuthStatus();
      if (!plainExpand) {
        nonceRef.current += 1;
        setPendingRequest({ ...request, nonce: nonceRef.current });
      }
    },
    [refreshAuthStatus],
  );

  // ⌘J / the TopNav toggle route their OPEN through `openAssistant()` so a fresh session starts (see
  // above); only the close half stays a bare state flip.
  const toggleAssistant = useCallback(() => {
    if (isOpenRef.current) setIsOpen(false);
    else openAssistant();
  }, [openAssistant]);

  // Read + clear the fresh-expand flag exactly once (the dock calls this at mount). See its doc on
  // `AssistantContextValue`.
  const consumeFreshSessionOpen = useCallback(() => {
    const wasFresh = freshOpenPendingRef.current;
    freshOpenPendingRef.current = false;
    return wasFresh;
  }, []);

  // Global ⌘J / Ctrl+J — also reclaims the browser's own Ctrl+J (Downloads) binding, so it's only
  // wired once the feature is actually reachable (an invisible feature stealing a browser shortcut for
  // nothing would be a regression, not a convenience).
  // Settings › Features adds a second condition: a switched-off Assistant must not keep the binding
  // either — the shortcut would open a dock that is no longer mounted, and would still be stealing
  // Ctrl+J from the browser.
  useEffect(() => {
    if (!authConfigured || !assistantFeatureEnabled) return;
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        toggleAssistant();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authConfigured, assistantFeatureEnabled, toggleAssistant]);

  const currentEnvelope = deriveAssistantEnvelope(location.pathname, location.search);

  // WP 3.1 (D-AS8/D-AS16) — see the `executeUiAction` doc comment on `AssistantContextValue`.
  const executeUiAction = useCallback(
    (action: string, params: Record<string, unknown>) => {
      const resolution = resolveAssistantUiAction(action, params);
      if (!resolution.ok) {
        // The API tool already validated this exact { action, params } pair before the ui_action
        // event was ever emitted (session-manager.ts only relays a SUCCESSFUL ui_* result) — a
        // failure to re-resolve it here means the two registry call sites disagree, a bug to surface
        // loudly rather than a runtime condition to silently swallow. Never navigate on a failure.
        console.error(`Assistant ui_action could not be resolved: ${resolution.error}`);
        return;
      }
      navigate(resolution.target.route);
    },
    [navigate],
  );

  const value: AssistantContextValue = {
    isOpen,
    openAssistant,
    closeAssistant,
    toggleAssistant,
    pendingRequest,
    clearPendingRequest,
    authStatus,
    authConfigured,
    refreshAuthStatus,
    currentEnvelope,
    executeUiAction,
    activeAssistantThreadId,
    setActiveAssistantThreadId,
    consumeFreshSessionOpen,
  };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

/** The dock's + every page hook's entry point. Throws outside an `AssistantProvider` (a mounting bug,
 *  not a runtime condition to handle gracefully). */
export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within an AssistantProvider");
  return ctx;
}
