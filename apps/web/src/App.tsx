import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  Navigate,
  Route,
  Routes,
  matchPath,
  useLocation,
  useNavigate,
  type Location,
} from "react-router-dom";
import type {
  Collection,
  HealthPayload,
  OAuthClientInput,
  OAuthStartResponse,
  ScanDetail,
  ScanSummary,
  ServerConfig,
  ServerConfigInput,
  ServerProbeRequest,
  ServerProbeResponse,
  ServerConfigUpdate,
  ServerType,
  Skill,
  TokenProfileId,
} from "@mcp-token-footprint/shared";
import { DEFAULT_TOKEN_PROFILE, TOKEN_PROFILES } from "@mcp-token-footprint/shared";
import { Button, Spinner, StatePanel, toast } from "@elabs-ai/components-ui";
import { AppShell, type Crumb } from "./components/AppShell";
import { RouteCrumbProvider } from "./components/route-crumb";
import { ConfirmDialog } from "./components/dialogs";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useAssistant } from "./features/assistant/assistant-context";
import { FeatureGate } from "./features/feature-flags/FeatureGate";
import { CommandPalette } from "./features/command-palette/CommandPalette";
import { useAssistantStarters } from "./features/assistant/use-assistant-starters";
import {
  McpAuthContextProvider,
  useMcpAuthGate,
  type EnsureResult,
  type ReauthContext,
} from "./features/servers/McpAuthProvider";
import { ManageServerTypesDialog } from "./features/servers/ManageServerTypesDialog";
import { ServerWizard } from "./features/servers/ServerWizard";
import { SettingsDialog } from "./features/settings/SettingsView";
import { ServerReportDialog } from "./features/reports/ServerReportDialog";
import { ScaffoldFromServerWizard } from "./features/skills/ScaffoldFromServerWizard";
import { SkillWizard } from "./features/skills/SkillWizard";
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  createSkillFromBlank,
  createSkillFromGithub,
  createSkillFromUpload,
  deleteSkill as deleteSkillRequest,
  getComparison,
  listCollections,
  listServerTypes,
  listSkills,
  probeSkillRepo,
  pullSkill,
  testServerConnection,
} from "./lib/api";
import { useThemePreference } from "./lib/use-theme-preference";
import { getErrorMessage } from "./lib/errors";
import { formatDateTime } from "./lib/format";
import { notifyError } from "./lib/notify";

// ── Code-splitting (planning/Research/RS-07-full-validation 03-web-review H1 + M1) ──────────────────────────────
// The heavy leaf surfaces are `React.lazy`-loaded so their code — Monaco (`@elabs-ai/components-editor`), React
// Flow (`@xyflow/react` via `@elabs-ai/components-flow`), and charts (`@elabs-ai/components-charts`) — no longer lands in the
// eager entry chunk. Each `lazy()` is a dynamic-import split point, so the vendor weight is pulled
// only when the route that needs it is first visited. The parked Skill Design/Trace subtree (reached
// through `SkillsView` → `SkillInspector`) rides along inside the `SkillsView` chunk, so parking it
// costs zero first-paint bytes. Every lazy element renders under the `<Suspense>` boundary below
// (routes) or its own (the assistant dock), whose fallbacks are `@elabs-ai/components-*` components.
const AssistantDock = lazy(() =>
  import("./features/assistant/AssistantDock").then((m) => ({ default: m.AssistantDock })),
);
const CompareView = lazy(() =>
  import("./features/compare/CompareView").then((m) => ({ default: m.CompareView })),
);
const CompatibilityView = lazy(() =>
  import("./features/compatibility/CompatibilityView").then((m) => ({
    default: m.CompatibilityView,
  })),
);
// Advisor (planning/Roadmap/RM-01-advisor/, WP 1.3) — evidenced recommendations at `/advisor`. Read-only: the
// route renders suggestions + evidence links; nothing here is ever auto-applied.
const AdvisorView = lazy(() =>
  import("./features/advisor/AdvisorView").then((m) => ({ default: m.AdvisorView })),
);
const DashboardView = lazy(() =>
  import("./features/dashboard/DashboardView").then((m) => ({ default: m.DashboardView })),
);
// Illustrations (planning/Roadmap/RM-14-illustrations/, WP 0.3) — the asset repository at
// `/illustrations`: every catalogued illustration drawn LIVE in the current theme, plus the WP 0.2
// primitives sheet. Lazy like every other leaf: the package is only pulled when the route is
// visited. Two registries must know about this route — `ASSISTANT_ROUTE_MANIFEST` (gated by the
// `assistant-route-operability` test) and `PAGESHELL_EXACT_ROUTES` below (NOT gated in this
// direction — a missing entry mounts the page padded-and-scrolling with nothing going red).
const IllustrationsGallery = lazy(() =>
  import("./features/illustrations/IllustrationsGallery").then((m) => ({
    default: m.IllustrationsGallery,
  })),
);
// Assistant Hub (D-AH2) — the new full-page, multi-model, multi-agent assistant at `/assistant`.
// WP 0.4 ships the nav + shell scaffold only; the turn engine/conversation lands in later `hub` WPs.
const AssistantView = lazy(() =>
  import("./features/hub/AssistantView").then((m) => ({ default: m.AssistantView })),
);
// Assistant Hub (WP2.1, D-AH7) — the role library + saved crews at `/assistant/agents`.
const AgentsView = lazy(() =>
  import("./features/hub/agents/AgentsView").then((m) => ({ default: m.AgentsView })),
);
// Assistant Hub UX WP1.4 (D-HUX4) — session history as a sortable/filterable table at
// `/assistant/sessions`, replacing the permanent `SessionRail` (removed by WP1.1).
const SessionsView = lazy(() =>
  import("./features/hub/sessions/SessionsView").then((m) => ({ default: m.SessionsView })),
);
// Assistant Hub (WP3.1, D-AH11c) — the project library at `/assistant/projects`.
const ProjectsView = lazy(() =>
  import("./features/hub/projects/ProjectsView").then((m) => ({ default: m.ProjectsView })),
);
// Assistant Hub UX WP3.1 (D-HUX15) — `MemoryView`/`UsageView` are RETIRED from routing: nav
// consolidates 6 → 4, and `/assistant/memory` / `/assistant/usage` are now `<Navigate>` redirects
// (see the route declarations below) rather than routes to these views. No lazy import remains —
// WP3.4 deletes the now-dead `features/hub/{MemoryView,UsageView}.tsx` source files next.
// Assistant Hub (WP4.2, D-AH13) — the global, filterable Audit timeline at `/assistant/audit`.
const AuditView = lazy(() =>
  import("./features/hub/AuditView").then((m) => ({ default: m.AuditView })),
);
const ScansView = lazy(() =>
  import("./features/scans/ScansView").then((m) => ({ default: m.ScansView })),
);
const ServersView = lazy(() =>
  import("./features/servers/ServersView").then((m) => ({ default: m.ServersView })),
);
const ServersOverview = lazy(() =>
  import("./features/servers/ServersOverview").then((m) => ({ default: m.ServersOverview })),
);
const ServerReportRoute = lazy(() =>
  import("./features/reports/ServerReportView").then((m) => ({ default: m.ServerReportRoute })),
);
const DigestReportRoute = lazy(() =>
  import("./features/reports/DigestReportView").then((m) => ({ default: m.DigestReportRoute })),
);
const CollectionDetail = lazy(() =>
  import("./features/testing/collections/CollectionDetail").then((m) => ({
    default: m.CollectionDetail,
  })),
);
const CollectionsView = lazy(() =>
  import("./features/testing/collections/CollectionsView").then((m) => ({
    default: m.CollectionsView,
  })),
);
const CompareWorkspace = lazy(() =>
  import("./features/testing/compare/CompareWorkspace").then((m) => ({
    default: m.CompareWorkspace,
  })),
);
const RunConsoleRoute = lazy(() =>
  import("./features/testing/RunConsoleRoute").then((m) => ({ default: m.RunConsoleRoute })),
);
const RunsView = lazy(() =>
  import("./features/testing/RunsView").then((m) => ({ default: m.RunsView })),
);
const EnvironmentsView = lazy(() =>
  import("./features/testing/EnvironmentsView").then((m) => ({ default: m.EnvironmentsView })),
);
const SuiteRunConsoleRoute = lazy(() =>
  import("./features/testing/suites/SuiteRunConsoleRoute").then((m) => ({
    default: m.SuiteRunConsoleRoute,
  })),
);
const SuitesView = lazy(() =>
  import("./features/testing/suites/SuitesView").then((m) => ({ default: m.SuitesView })),
);
// design-remediation T8 — the suite DETAIL page (a real place, editor as an overlay), reached from
// the suites list / the collection's Suites tab / the suite-run console's "back to Suites".
const SuiteDetail = lazy(() =>
  import("./features/testing/suites/SuiteDetail").then((m) => ({ default: m.SuiteDetail })),
);
const SkillsView = lazy(() =>
  import("./features/skills/SkillsView").then((m) => ({ default: m.SkillsView })),
);
const SkillsOverview = lazy(() =>
  import("./features/skills/SkillsOverview").then((m) => ({ default: m.SkillsOverview })),
);
// RM-30 WP 7.1 — the Skill Studio, the full-viewport authoring workbench. Lazy like every other
// skills route: it pulls in Monaco + the flow canvas, which nothing else on a cold load needs.
const SkillStudioView = lazy(() =>
  import("./features/skills/studio/SkillStudioView").then((m) => ({ default: m.SkillStudioView })),
);
const WatchRulesView = lazy(() =>
  import("./features/watch/WatchRulesView").then((m) => ({ default: m.WatchRulesView })),
);
// Observability WP4.5 (review queue lite) — the review surface + its rubric management view.
const ReviewView = lazy(() =>
  import("./features/review/ReviewView").then((m) => ({ default: m.ReviewView })),
);
const RubricsView = lazy(() =>
  import("./features/review/RubricsView").then((m) => ({ default: m.RubricsView })),
);

/** Shared fallback for a lazy route while its chunk loads. `@elabs-ai/components-*` StatePanel (loading kind). */
function RouteFallback() {
  return (
    <div className="flex min-h-64 w-full items-center justify-center p-8">
      <StatePanel kind="loading" loadingLabel="Loading…" />
    </div>
  );
}

const DEFAULT_PROFILE_STORAGE_KEY = "mcp-token-footprint.default-profile";

// UX-overhaul PageShell mounting registry (PM-OWNED — see `isPageShellRoute` below). The PM adds a
// route here as each Phase-2 view-migration WP merges. Exact full paths go in the Set; dynamic/child
// route families (e.g. "/scans/" for scan detail) go in the prefixes array.
export const PAGESHELL_EXACT_ROUTES = new Set<string>([
  "/testing/environments", // WP 1.2
  "/dashboard", // WP 2.1 (home root — no breadcrumb, consistent with other top-level roots)
  "/testing/compatibility", // WP 2.9
  "/advisor", // advisor WP 1.3 (recommendation cards, centered reading surface)
  "/illustrations", // RM-14 WP 0.3 — the illustration asset repository (full-bleed catalog grid)
  "/scans", // WP 2.3 (master-detail, in-view split)
  "/compare/scans", // WP 2.3
  "/skills", // RM-32 WP 2.2 — the registry OVERVIEW (grouped grid ⇄ table); no rail
  "/servers", // RM-32 WP 2.1 — the fleet OVERVIEW (grouped grid ⇄ table); no rail
  "/testing/runs", // WP 2.4 (unified runs feed, full-width)
  "/testing/runs/compare", // WP 4.1 (Compare Workspace — full PageShell surface)
  "/testing/collections", // WP 2.6 (collections list)
  "/testing/observability/rules", // Observability WP 4.4 (watch-rules list)
  "/testing/review", // design-remediation T8 — the review-queue surface (moved from /testing/runs/review)
  "/testing/observability/review-rubrics", // Observability WP 4.5 (rubric management list)
  // Assistant Hub UX WP0.2 (D-HUX1) — every `/assistant/*` route joins this registry as a
  // `fullBleed` mount. The routes below are the CURRENT `/assistant/*` `<Route>` declarations that
  // actually RENDER a view — keep this list 1:1 with them (no dead entries). WP3.1 (D-HUX15)
  // removed `/assistant/memory` and `/assistant/usage`: both are now `<Navigate>` redirects (see
  // below), which never paint anything at that path — a redirect route doesn't need a PageShell
  // mount, it immediately hands the router a new location.
  "/assistant", // WP0.2 (D-HUX1) — AssistantView (workspace)
  "/assistant/agents", // WP0.2 (D-HUX1) — AgentsView (workforce section — thin shell over WorkforceView)
  "/assistant/sessions", // WP1.4 (D-HUX4) — SessionsView (session history table; already on PageShell)
  "/assistant/projects", // WP0.2 (D-HUX1) — ProjectsView
  "/assistant/audit", // WP0.2 (D-HUX1) — AuditView
]);
const PAGESHELL_ROUTE_PREFIXES: string[] = [
  "/scans/", // WP 2.3 scan detail
  "/skills/", // WP 2.8 skill detail (inspector uses PageShell)
  "/servers/", // WP 2.2b server detail (PageShell width=master-detail)
  "/testing/collections/", // WP 2.6 collection detail
  "/testing/suites/", // design-remediation T8 — the suite detail page (PageShell width=full)
  // WP2.1 (D-HUX5) — the workforce section's node routes (`/assistant/agents/agent/:agentId` and
  // `/assistant/agents/crew/:crewId`, both declared below alongside the bare `/assistant/agents`
  // route already in the exact-match set above) — the profile-modal deep link stays full-bleed too.
  "/assistant/agents/",
];

/**
 * Assistant Hub UX WP0.2 (D-HUX1) — whether `pathname` mounts full-bleed via the PageShell
 * registry above. Extracted to a pure, exported function (mirrors `isTokenProfile` below) so the
 * registry↔route mapping is unit-testable without rendering the full `App` tree (see `App.test.ts`).
 */
export function isPageShellRoute(pathname: string): boolean {
  return (
    PAGESHELL_EXACT_ROUTES.has(pathname) ||
    PAGESHELL_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/** What renders BEHIND the settings modal on a direct `/settings` load (no prior in-app view). */
const SETTINGS_BACKDROP_LOCATION: Location = {
  pathname: "/dashboard",
  search: "",
  hash: "",
  state: null,
  key: "settings-backdrop",
};

export function App() {
  const navigate = useNavigate();
  const rawLocation = useLocation();
  const assistant = useAssistant();
  // NOTE — deliberately NO feature-flag read here. The App-assistant dock is gated by its own
  // `app_assistant` flag at the two sites that OWN it: `AppShell` (the toggle, the split column and
  // the mobile Sheet) and `useAssistantStarters` (the `/api/assistant/starters` fetch). Reading a
  // flag here as well is how the dock got wired to the WORKSPACE's `assistant` flag by mistake —
  // turning the full-page Assistant off then took the unrelated dock with it. Two features, two
  // switches, and each one read only where it is enforced. The workspace's flag still gates its own
  // `/assistant/*` routes, via the `FeatureGate feature="assistant"` wrappers in the route table.
  // The collapsed dock toggle's hint pill: how many suggested interactions (session starters) the
  // current page has. Fetched here (not in the dock, which is unmounted while collapsed) off the same
  // envelope primitives the dock's own empty state uses; best-effort by construction (see the hook).
  const { starters: assistantStarters } = useAssistantStarters({
    entityKind: assistant.currentEnvelope.entityKind,
    entityId: assistant.currentEnvelope.entityId,
    tab: assistant.currentEnvelope.tab,
    route: assistant.currentEnvelope.route,
  });

  // ── Settings modal over the current view ─────────────────────────────────────────────────────
  // `/settings/:section?` stays a real, deep-linkable URL, but it renders as a MODAL over the last
  // content view (owner decision 2026-07-11; supersedes WP 1.2's settings *page*). `location` below
  // is what the router — and every view-derived flag — actually renders: the last non-settings
  // location, falling back to the dashboard on a direct `/settings` load.
  const settingsMatch = useMemo(
    () => matchPath("/settings/:section?", rawLocation.pathname),
    [rawLocation.pathname],
  );
  const contentLocationRef = useRef<Location>(SETTINGS_BACKDROP_LOCATION);
  useEffect(() => {
    if (settingsMatch == null) contentLocationRef.current = rawLocation;
  }, [settingsMatch, rawLocation]);
  const location = settingsMatch != null ? contentLocationRef.current : rawLocation;

  // ── URL-derived selection (item 3: selection lives in the URL, not localStorage) ─────────────
  // `matchPath` against the effective location — NOT `useMatch`, which reads the raw URL and would
  // drop the selection behind an open settings modal.
  const serverMatch = useMemo(
    () => matchPath("/servers/:serverId", location.pathname),
    [location.pathname],
  );
  const skillMatch = useMemo(
    () => matchPath("/skills/:skillId", location.pathname),
    [location.pathname],
  );
  // RM-30 WP 7.1 — the Studio is a CHILD of a skill, so `/skills/:skillId` (an exact match) does not
  // cover it; match it separately so the selection + breadcrumb still name the right skill.
  const skillStudioMatch = useMemo(
    () => matchPath("/skills/:skillId/studio", location.pathname),
    [location.pathname],
  );
  const scanMatch = useMemo(
    () => matchPath("/scans/:scanId", location.pathname),
    [location.pathname],
  );
  const collectionMatch = useMemo(
    () => matchPath("/testing/collections/:collectionId", location.pathname),
    [location.pathname],
  );
  // design-remediation T8 — the suite detail route (`/testing/suites/:suiteId`); the page publishes
  // the suite name as its breadcrumb leaf via `RouteCrumbProvider` (same channel the run console uses).
  const suiteDetailMatch = useMemo(
    () => matchPath("/testing/suites/:suiteId", location.pathname),
    [location.pathname],
  );
  const selectedServerId = serverMatch?.params.serverId ?? null;
  const selectedSkillId = skillMatch?.params.skillId ?? null;
  const routeScanId = scanMatch?.params.scanId ?? null;

  // The Run console owns its own layout/scroll → full-bleed content (shell chrome stays mounted).
  // `/testing/runs/compare` lives under this prefix but is the Compare Workspace (a PageShell route,
  // WP 4.1), not a console — excluded here and mounted via PAGESHELL_EXACT_ROUTES. `/testing/runs/
  // review` is a compat REDIRECT to `/testing/review` (design-remediation T8) — excluded so the brief
  // redirect frame is never treated as a console.
  const isRunConsoleRoute =
    location.pathname.startsWith("/testing/runs/") &&
    location.pathname !== "/testing/runs/compare" &&
    location.pathname !== "/testing/runs/review";
  // The suite-run console mirrors the run console: a definite-height column that owns its own
  // layout/scroll (§S22), so it mounts full-bleed too (its tab bodies are the scroll containers).
  const isSuiteRunConsoleRoute = location.pathname.startsWith("/testing/suite-runs/");
  // Routes migrated onto the shared PageShell (WP 1.2) own their gutter + scroll, so they mount into
  // the same edge-to-edge (no-padding, no-scroll) `<main>` the run console uses.
  // PM-OWNED (UX-overhaul): the PM adds each route here as its Phase-2 migration WP merges — this keeps
  // App.tsx mounting conflict-free across parallel WPs (agents adopt PageShell in their view and report
  // the route to mark, they do NOT edit this set). Exact paths in the Set; path prefixes in the predicate.
  const isCurrentRoutePageShell = isPageShellRoute(location.pathname);
  // A report route prints only its content; the shell chrome is hidden from print (not unmounted).
  const isReportRoute = location.pathname.startsWith("/reports/");

  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [servers, setServers] = useState<ServerConfig[]>([]);
  // Server types (planning/Roadmap/completed/RM-21-server-types) — the overview groups + filters by them; the wizard picker
  // assigns them; the Manage-types dialog (below) creates/renames/restatuses/deletes them.
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [manageTypesOpen, setManageTypesOpen] = useState(false);
  // ⌘K command palette open state — lifted here (not inside the palette) so the top-bar search
  // trigger can open it too; the global ⌘K key listener lives in the palette component itself.
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // ── Focus restoration for URL/state-opened overlays (design-remediation T5, item 2) ────────────
  // The command palette and the Settings modal open WITHOUT a Radix trigger (a state flag / a URL),
  // so Radix has no trigger element to hand focus back to on close — it lands on <body>, stranding a
  // keyboard user (exactly the ⌘K operator). Track the last element focused OUTSIDE any overlay, and
  // restore focus to it whenever one of those overlays closes. (The notification popover has a real
  // trigger and restores itself — see `NotificationBell`.)
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const OVERLAY_SELECTOR =
      '[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],[data-sonner-toaster]';
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target === document.body) return;
      // Focus inside an overlay is NOT a restore target — keep the pre-overlay opener instead.
      if (typeof target.closest === "function" && target.closest(OVERLAY_SELECTOR)) return;
      lastFocusedRef.current = target;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  const restoreLastFocus = useCallback(() => {
    const el = lastFocusedRef.current;
    if (!el) return;
    // Defer so this wins over Radix/cmdk's own close-focus handling (which lands on <body> here).
    requestAnimationFrame(() => {
      if (el.isConnected) el.focus();
    });
  }, []);
  const handleCommandPaletteOpenChange = useCallback(
    (open: boolean) => {
      setCommandPaletteOpen(open);
      if (!open) restoreLastFocus();
    },
    [restoreLastFocus],
  );
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [selectedScan, setSelectedScan] = useState<ScanDetail | null>(null);
  // interface-craft WP 4.3 FIX 1 (P0) — the scan-detail 404 dead-end. A settled failure loading
  // `/scans/:scanId` (missing/deleted scan, transport error) sets this so `ScansView` can render a
  // TERMINAL error StatePanel + "Back to scans" instead of an infinite loading pane (which is what
  // it showed before, since the load effect only pushed a toast). Mirrors RunConsoleRoute's `error`
  // state for `/testing/runs/:runId`. `null` = no error (loading or loaded).
  const [scanLoadError, setScanLoadError] = useState<string | null>(null);
  const [selectedServerLatestScan, setSelectedServerLatestScan] = useState<ScanDetail | null>(null);
  const [serverWizardOpen, setServerWizardOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerConfig | null>(null);
  // Reauth vs. normal add/edit — drives the ServerWizard's `reason`/`reauthContext` so an expired-token
  // sign-in doesn't read as "Edit MCP server" (P0). Set by `openReauth`; cleared by add/edit opens.
  const [wizardReason, setWizardReason] = useState<"reauth" | undefined>(undefined);
  const [reauthContext, setReauthContext] = useState<ReauthContext | undefined>(undefined);
  const [pendingDeleteServer, setPendingDeleteServer] = useState<ServerConfig | null>(null);
  // Per-action / per-entity busy keys (e.g. `server:scan:<id>`), NOT a single global slot: two
  // different actions (scan server A while testing server B, refresh while a scan runs) must be
  // independently in-flight, and each affordance shows "busy" for ITS key only. `beginBusy` on
  // entry, `endBusy` on completion, `isBusy(key)` to read.
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());
  const beginBusy = useCallback((key: string) => {
    setBusyKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);
  const endBusy = useCallback((key: string) => {
    setBusyKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);
  const isBusy = useCallback((key: string) => busyKeys.has(key), [busyKeys]);
  // First-load signal: true until the initial `refreshAll` settles, so landing views can show a
  // loading state that's visually distinct from a genuine "no data yet" empty state.
  const [initialLoading, setInitialLoading] = useState(true);
  // Theme preference (light | dark | system) → resolved theme on @elabs-ai/components-tokens' provider.
  // Mounted here (always-on) so the OS prefers-color-scheme listener stays live across routes.
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();
  const [defaultProfile, setDefaultProfileState] = useState<TokenProfileId>(() => {
    const stored = window.localStorage.getItem(DEFAULT_PROFILE_STORAGE_KEY);
    return isTokenProfile(stored) ? stored : DEFAULT_TOKEN_PROFILE;
  });

  // --- Skills registry -------------------------------------------------------------------------
  const [skills, setSkills] = useState<Skill[]>([]);
  // Collections list — kept in App state (like servers/scans/skills) so the breadcrumb can name a
  // collection-detail route (WP 2.6 T7). Small list; refreshed with everything else.
  const [collections, setCollections] = useState<Collection[]>([]);
  const [skillWizardOpen, setSkillWizardOpen] = useState(false);
  // D-UX1 (K6) — the "From server" scaffold wizard, handed off to from the Add-skill modal's 4th tile.
  const [scaffoldSkillOpen, setScaffoldSkillOpen] = useState(false);
  const [pendingDeleteSkill, setPendingDeleteSkill] = useState<Skill | null>(null);

  // Export-report flow: the picker dialog (which scan to report on). Generating navigates to the
  // report route (rendered inside the shell) or downloads Markdown directly.
  const [reportDialogScan, setReportDialogScan] = useState<ScanDetail | null>(null);

  // Leaf-crumb override (run-console header redesign): deep routes that resolve their own identity
  // (the run console's "test · model") publish it via RouteCrumbProvider; null ⇒ static fallback.
  const [routeCrumb, setRouteCrumb] = useState<string | null>(null);

  const pushToast = useCallback((tone: ToastTone, title: string, detail?: string) => {
    const options = detail ? { description: detail } : undefined;
    if (tone === "success") toast.success(title, options);
    else if (tone === "danger") notifyError(title, options);
    else toast(title, options);
  }, []);

  // The shared MCP reauth gate. When a server needs (re)authentication we route the user to the SAME
  // settings window they'd use to configure it (the ServerWizard below) — there is no separate reauth
  // modal. `openReauth` opens that dialog for one server and resolves once the user finishes (a
  // confirmed sign-in fires `onComplete`) or closes it (a cancel). A ref keeps the gate API stable
  // inside the server-action callbacks without re-creating them when `servers` changes.
  const reauthResolverRef = useRef<((result: EnsureResult) => void) | null>(null);
  const reauthServerIdRef = useRef<string | null>(null);

  const resolveReauth = useCallback((result: EnsureResult) => {
    const resolve = reauthResolverRef.current;
    reauthResolverRef.current = null;
    reauthServerIdRef.current = null;
    resolve?.(result);
  }, []);

  const openReauth = useCallback(
    (server: ServerConfig, context?: ReauthContext): Promise<EnsureResult> => {
      return new Promise<EnsureResult>((resolve) => {
        // A new reauth request supersedes any still-pending one (resolve the old one as cancelled).
        reauthResolverRef.current?.({ ok: false, cancelled: true });
        reauthResolverRef.current = resolve;
        reauthServerIdRef.current = server.id;
        // The wizard is a portal Dialog rendered regardless of the active route (it opens over the run
        // console too), so don't navigate here — that would yank the user away from where they were.
        setEditingServer(server);
        setWizardReason("reauth");
        setReauthContext(context);
        setServerWizardOpen(true);
      });
    },
    [],
  );

  const mcpAuth = useMcpAuthGate(servers, openReauth);
  const mcpAuthRef = useRef(mcpAuth.api);
  mcpAuthRef.current = mcpAuth.api;

  // The settings window drives reauth completion: a successful sign-in/save fires `onComplete`
  // (→ resolve ok so the caller retries); closing it any other way is a cancel.
  const handleWizardComplete = useCallback(
    (serverId: string) => {
      if (reauthServerIdRef.current === serverId) resolveReauth({ ok: true });
    },
    [resolveReauth],
  );

  const handleWizardOpenChange = useCallback(
    (open: boolean) => {
      setServerWizardOpen(open);
      if (!open) resolveReauth({ ok: false, cancelled: true });
    },
    [resolveReauth],
  );

  const refreshAll = useCallback(async () => {
    beginBusy("refresh");
    try {
      const [
        healthPayload,
        serverPayload,
        serverTypePayload,
        scanPayload,
        skillPayload,
        collectionPayload,
      ] = await Promise.all([
        apiGet<HealthPayload>("/api/health"),
        apiGet<ServerConfig[]>("/api/servers"),
        listServerTypes(),
        apiGet<ScanSummary[]>("/api/scans"),
        listSkills(),
        listCollections(),
      ]);
      setHealth(healthPayload);
      setServers(serverPayload);
      setServerTypes(serverTypePayload);
      setScans(scanPayload);
      setSkills(skillPayload);
      setCollections(collectionPayload);
    } catch (error) {
      pushToast("danger", "Couldn’t refresh the app data.", `${getErrorMessage(error)} Try again.`);
    } finally {
      endBusy("refresh");
    }
  }, [pushToast, beginBusy, endBusy]);

  useEffect(() => {
    void refreshAll().finally(() => setInitialLoading(false));
  }, []);

  const selectedServer = useMemo(() => {
    return servers.find((server) => server.id === selectedServerId) ?? null;
  }, [selectedServerId, servers]);

  const latestScansByServer = useMemo(() => {
    const latest = new Map<string, ScanSummary>();
    const sortedScans = [...scans].sort(
      (left, right) => Date.parse(right.scannedAt) - Date.parse(left.scannedAt),
    );
    for (const scan of sortedScans) {
      if (!latest.has(scan.serverId)) latest.set(scan.serverId, scan);
    }
    return latest;
  }, [scans]);

  const selectedServerScanHistory = useMemo(() => {
    if (!selectedServer) return [];
    return scans
      .filter((scan) => scan.serverId === selectedServer.id)
      .sort((left, right) => Date.parse(right.scannedAt) - Date.parse(left.scannedAt));
  }, [scans, selectedServer]);

  const selectedServerLatestScanId = selectedServerScanHistory[0]?.id ?? null;

  useEffect(() => {
    let active = true;

    async function loadLatestServerScan() {
      if (!selectedServer || !selectedServerLatestScanId) {
        setSelectedServerLatestScan(null);
        return;
      }

      try {
        const scan = await apiGet<ScanDetail>(`/api/servers/${selectedServer.id}/latest-scan`);
        if (!active) return;
        setSelectedServerLatestScan(scan);
      } catch (error) {
        if (!active) return;
        setSelectedServerLatestScan(null);
        pushToast(
          "danger",
          "Couldn’t load the latest scan.",
          `${getErrorMessage(error)} Try again.`,
        );
      }
    }

    void loadLatestServerScan();
    return () => {
      active = false;
    };
  }, [selectedServer, selectedServerLatestScanId, pushToast]);

  // Load the scan detail for `/scans/:scanId` (selection comes from the URL, deep-linkable).
  useEffect(() => {
    if (!routeScanId) {
      setSelectedScan(null);
      setScanLoadError(null);
      return;
    }
    let active = true;
    const key = `scan:${routeScanId}`;
    // A fresh load starts clean: clear any prior error so the pane shows LOADING, not a stale
    // error, while this request is in flight (interface-craft WP 4.3 FIX 1).
    setScanLoadError(null);
    beginBusy(key);
    apiGet<ScanDetail>(`/api/scans/${routeScanId}`)
      .then((scan) => {
        if (active) {
          setSelectedScan(scan);
          setScanLoadError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          // Settled failure: drop any stale detail so the pane's `selectedScan.id === scanId`
          // guard is false and the fallback renders, and record the TERMINAL error so that
          // fallback is an error StatePanel (not the infinite loading pane) — the toast stays.
          setSelectedScan(null);
          setScanLoadError(getErrorMessage(error, "Couldn’t load the scan."));
          pushToast("danger", "Couldn’t load the scan.", `${getErrorMessage(error)} Try again.`);
        }
      })
      .finally(() => {
        endBusy(key);
      });
    return () => {
      active = false;
    };
  }, [routeScanId, pushToast, beginBusy, endBusy]);

  const setDefaultProfile = useCallback((profile: TokenProfileId) => {
    window.localStorage.setItem(DEFAULT_PROFILE_STORAGE_KEY, profile);
    setDefaultProfileState(profile);
  }, []);

  // Open a scan by navigating to its deep link; the effect above loads the detail.
  const openScan = useCallback((scanId: string) => navigate(`/scans/${scanId}`), [navigate]);

  const compareScans = useCallback(
    (a: string, b: string, threshold: number) => getComparison(a, b, threshold),
    [],
  );

  const probeServer = useCallback((input: ServerProbeRequest) => {
    return apiPost<ServerProbeResponse>("/api/servers/probe", input);
  }, []);

  const startOAuth = useCallback((serverId: string, oauthClient?: OAuthClientInput) => {
    return apiPost<OAuthStartResponse>("/api/oauth/start", { serverId, oauthClient });
  }, []);

  const createServer = useCallback(
    async (input: ServerConfigInput) => {
      beginBusy("server:create");
      try {
        const server = await apiPost<ServerConfig>("/api/servers", input);
        pushToast("success", "Server saved");
        await refreshAll();
        navigate(`/servers/${server.id}`);
        return server;
      } catch (error) {
        pushToast("danger", "Couldn’t save the server.", `${getErrorMessage(error)} Try again.`);
        throw error;
      } finally {
        endBusy("server:create");
      }
    },
    [navigate, pushToast, refreshAll, beginBusy, endBusy],
  );

  const updateServer = useCallback(
    async (id: string, input: ServerConfigUpdate) => {
      const key = `server:update:${id}`;
      beginBusy(key);
      try {
        const server = await apiPut<ServerConfig>(`/api/servers/${id}`, input);
        pushToast("success", "Server updated");
        await refreshAll();
        return server;
      } catch (error) {
        pushToast("danger", "Couldn’t update the server.", `${getErrorMessage(error)} Try again.`);
        throw error;
      } finally {
        endBusy(key);
      }
    },
    [pushToast, refreshAll, beginBusy, endBusy],
  );

  const deleteServer = useCallback(
    async (id: string) => {
      const key = `server:delete:${id}`;
      beginBusy(key);
      try {
        await apiDelete(`/api/servers/${id}`);
        pushToast("success", "Server deleted");
        // RM-32 D-OD1 — deleting the server you are LOOKING AT returns you to the fleet overview.
        // It used to teleport to whichever server sorted next, which (now that `/servers` is a real
        // place) silently swapped the page's subject for an unrelated one.
        if (selectedServerId === id) {
          navigate("/servers", { replace: true });
        }
        await refreshAll();
      } catch (error) {
        pushToast("danger", "Couldn’t delete the server.", `${getErrorMessage(error)} Try again.`);
      } finally {
        endBusy(key);
      }
    },
    [navigate, pushToast, refreshAll, selectedServerId, beginBusy, endBusy],
  );

  const testServer = useCallback(
    async (id: string) => {
      const key = `server:test:${id}`;
      beginBusy(key);
      try {
        let result = await testServerConnection(id);
        // Reactive reauth: an expired OAuth token comes back as authRequired → open the modal, then
        // re-test once after the user signs in.
        if (result.authRequired) {
          const gate = await mcpAuthRef.current.requestReauth(id, {
            action: "the connection test",
          });
          if (gate.ok) result = await testServerConnection(id);
        }
        if (result.ok) {
          pushToast(
            "success",
            "Connection OK",
            `${result.tools} tools listed in ${result.durationMs} ms`,
          );
        } else {
          pushToast(
            "danger",
            "Couldn’t connect to the server.",
            `${result.errorMessage ?? "Unknown error"} Check its connection settings and try again.`,
          );
        }
        return result;
      } catch (error) {
        pushToast(
          "danger",
          "Couldn’t connect to the server.",
          `${getErrorMessage(error)} Check its connection settings and try again.`,
        );
        throw error;
      } finally {
        endBusy(key);
      }
    },
    [pushToast, beginBusy, endBusy],
  );

  const runScan = useCallback(
    async (id: string) => {
      const key = `server:scan:${id}`;
      beginBusy(key);
      try {
        let scan = await apiPost<ScanDetail>(`/api/servers/${id}/scan`, {
          tokenProfile: defaultProfile,
        });
        // Reactive reauth: a scan that failed because the OAuth token expired comes back as
        // authRequired → open the modal, then re-scan once after the user signs in.
        if (scan.status === "failed" && scan.authRequired) {
          const gate = await mcpAuthRef.current.requestReauth(id, {
            action: "the scan you started",
          });
          if (gate.ok) {
            scan = await apiPost<ScanDetail>(`/api/servers/${id}/scan`, {
              tokenProfile: defaultProfile,
            });
          }
        }
        setSelectedServerLatestScan(scan);
        navigate(`/servers/${id}`);
        await refreshAll();
        if (scan.status === "success") {
          pushToast(
            "success",
            "Scan completed",
            `${scan.totalTools} tools, ${scan.totalTokens} tokens`,
          );
        } else {
          pushToast(
            "danger",
            "Couldn’t complete the scan.",
            `${scan.errorMessage ?? "Unknown error"} Check the server and try again.`,
          );
        }
      } catch (error) {
        pushToast("danger", "Couldn’t complete the scan.", `${getErrorMessage(error)} Try again.`);
      } finally {
        endBusy(key);
      }
    },
    [defaultProfile, navigate, pushToast, refreshAll, beginBusy, endBusy],
  );

  const openCreateServer = useCallback(() => {
    setEditingServer(null);
    setWizardReason(undefined);
    setReauthContext(undefined);
    setServerWizardOpen(true);
  }, []);

  const openEditServer = useCallback((server: ServerConfig) => {
    setEditingServer(server);
    setWizardReason(undefined);
    setReauthContext(undefined);
    setServerWizardOpen(true);
  }, []);

  const confirmDeleteServer = useCallback((server: ServerConfig) => {
    setPendingDeleteServer(server);
  }, []);

  const performPendingDelete = useCallback(() => {
    if (pendingDeleteServer) void deleteServer(pendingDeleteServer.id);
    setPendingDeleteServer(null);
  }, [deleteServer, pendingDeleteServer]);

  // --- Skills handlers -------------------------------------------------------------------------
  const openCreateSkill = useCallback(() => {
    setSkillWizardOpen(true);
  }, []);

  // D-UX1 (K6): the Add-skill modal's "From server" tile hands off to the scaffold wizard — close the
  // modal, open the dedicated flow. The list "+" stays the single create entry point.
  const openScaffoldFromServer = useCallback(() => {
    setSkillWizardOpen(false);
    setScaffoldSkillOpen(true);
  }, []);

  const handleSkillScaffolded = useCallback(
    async (skillId: string) => {
      pushToast("success", "Skill created", "Scaffolded from the server's tool surface.");
      await refreshAll();
      navigate(`/skills/${skillId}`);
    },
    [navigate, pushToast, refreshAll],
  );

  const createSkillBlank = useCallback(
    async (input: { name: string; description: string; displayName?: string }): Promise<Skill> => {
      beginBusy("skill:create");
      try {
        const skill = await createSkillFromBlank(input);
        pushToast("success", "Skill created", skill.displayName);
        await refreshAll();
        navigate(`/skills/${skill.id}`);
        return skill;
      } catch (error) {
        pushToast("danger", "Couldn’t create the skill.", `${getErrorMessage(error)} Try again.`);
        throw error;
      } finally {
        endBusy("skill:create");
      }
    },
    [navigate, pushToast, refreshAll, beginBusy, endBusy],
  );

  const createSkillUpload = useCallback(
    async (file: File, displayName?: string): Promise<Skill> => {
      beginBusy("skill:create");
      try {
        const skill = await createSkillFromUpload(file, displayName);
        pushToast("success", "Skill registered", skill.displayName);
        await refreshAll();
        navigate(`/skills/${skill.id}`);
        return skill;
      } catch (error) {
        pushToast("danger", "Couldn’t upload the skill.", `${getErrorMessage(error)} Try again.`);
        throw error;
      } finally {
        endBusy("skill:create");
      }
    },
    [navigate, pushToast, refreshAll, beginBusy, endBusy],
  );

  const createSkillGithub = useCallback(
    async (input: {
      repoUrl: string;
      ref: string;
      subpath: string;
      token?: string;
      displayName?: string;
    }): Promise<Skill> => {
      beginBusy("skill:create");
      try {
        const skill = await createSkillFromGithub(input);
        pushToast("success", "Skill registered", skill.displayName);
        await refreshAll();
        navigate(`/skills/${skill.id}`);
        return skill;
      } catch (error) {
        pushToast(
          "danger",
          "Couldn’t import the skill from GitHub.",
          `${getErrorMessage(error)} Check the repository URL and try again.`,
        );
        throw error;
      } finally {
        endBusy("skill:create");
      }
    },
    [navigate, pushToast, refreshAll, beginBusy, endBusy],
  );

  const pullSkillLatest = useCallback(
    async (id: string) => {
      const key = `skill:pull:${id}`;
      beginBusy(key);
      try {
        const result = await pullSkill(id);
        if ("unchanged" in result) {
          pushToast("info", "Already up to date", "No new upstream version.");
        } else {
          pushToast("success", "Pulled latest", `New version v${result.seq}.`);
        }
        navigate(`/skills/${id}`);
        await refreshAll();
      } catch (error) {
        pushToast(
          "danger",
          "Couldn’t pull the latest version.",
          `${getErrorMessage(error)} Try again.`,
        );
      } finally {
        endBusy(key);
      }
    },
    [navigate, pushToast, refreshAll, beginBusy, endBusy],
  );

  const deleteSkill = useCallback(
    async (id: string) => {
      const key = `skill:delete:${id}`;
      beginBusy(key);
      try {
        await deleteSkillRequest(id);
        pushToast("success", "Skill deleted");
        // RM-32 D-OD1 — same as servers: back to the registry overview, not to an unrelated skill.
        if (selectedSkillId === id) {
          navigate("/skills", { replace: true });
        }
        await refreshAll();
      } catch (error) {
        pushToast("danger", "Couldn’t delete the skill.", `${getErrorMessage(error)} Try again.`);
      } finally {
        endBusy(key);
      }
    },
    [navigate, pushToast, refreshAll, selectedSkillId, beginBusy, endBusy],
  );

  const confirmDeleteSkill = useCallback((skill: Skill) => {
    setPendingDeleteSkill(skill);
  }, []);

  const performPendingSkillDelete = useCallback(() => {
    if (pendingDeleteSkill) void deleteSkill(pendingDeleteSkill.id);
    setPendingDeleteSkill(null);
  }, [deleteSkill, pendingDeleteSkill]);

  // ── Route-derived breadcrumbs (item 4). Depth-1 top-level views render none. ──────────────────
  const breadcrumbs = useMemo<Crumb[]>(() => {
    // RM-32 D-OD5 — the server LEAF is contributed by `ServersView` as an interactive switcher
    // through the breadcrumb slot; App only owns the parent crumb back to the overview.
    if (serverMatch && selectedServer) {
      return [{ label: "MCP Servers", to: "/servers" }];
    }
    if (scanMatch) {
      return [
        { label: "Scans", to: "/scans" },
        {
          label: selectedScan
            ? `${selectedScan.serverName} · ${formatDateTime(selectedScan.scannedAt)}`
            : "Scan",
        },
      ];
    }
    // RM-30 WP 7.1 — the Studio's own crumb: Skills / <skill> / Studio. Unlike the inspector, the
    // skill here is a real, linked PARENT (back to the inspector), and "Studio" is the leaf, so the
    // page contributes no breadcrumb slot of its own.
    if (skillStudioMatch) {
      const studioSkill = skills.find(
        (entry) => entry.id === skillStudioMatch.params.skillId,
      );
      return [
        { label: "Skills", to: "/skills" },
        {
          label: studioSkill?.displayName ?? "Skill",
          to: `/skills/${skillStudioMatch.params.skillId}`,
        },
        { label: "Studio" },
      ];
    }
    // RM-32 D-OD5 — the skill LEAF is the switcher `SkillsView` contributes through the breadcrumb
    // slot; App owns only the parent crumb back to the registry overview.
    if (skillMatch) {
      return [{ label: "Skills", to: "/skills" }];
    }
    if (location.pathname === "/testing/runs/compare") {
      return [{ label: "Runs", to: "/testing/runs" }, { label: "Compare" }];
    }
    if (isRunConsoleRoute) {
      // The leaf is the run's IDENTITY ("<test> · <model>", published by RunConsoleRoute once the
      // run resolves) — not a generic "Console". Falls back while loading / on the pre-run surface.
      const isNew = location.pathname === "/testing/runs/new";
      return [
        { label: "Runs", to: "/testing/runs" },
        { label: routeCrumb ?? (isNew ? "New run" : "Run") },
      ];
    }
    if (location.pathname.startsWith("/testing/suite-runs/")) {
      return [{ label: "Suites", to: "/testing/suites" }, { label: "Suite run" }];
    }
    // design-remediation T8 — the suite detail page. `/testing/suites` is now a REAL list route (no
    // longer a redirect to Collections), so this crumb — and the suite-run console's "back to Suites"
    // above — land on the suites list, not on Collections. The leaf is the suite name (published by
    // `SuiteDetail` via `RouteCrumbProvider`), falling back to "Suite" while it loads.
    if (suiteDetailMatch) {
      return [{ label: "Suites", to: "/testing/suites" }, { label: routeCrumb ?? "Suite" }];
    }
    // RM-32 D-OD5 — the collection LEAF is the switcher `CollectionDetail` contributes through the
    // breadcrumb slot; App owns only the parent crumb back to the overview.
    if (collectionMatch) {
      return [{ label: "Collections", to: "/testing/collections" }];
    }
    if (isReportRoute) {
      return [{ label: "Reports" }, { label: reportDialogScan?.serverName ?? "Server report" }];
    }
    // PageShell routes (WP 1.2) are top-level, but the shell contract (audit §C) requires the top
    // bar to always carry the breadcrumb. WP 2.7 / audit B-4: rather than root these at a synthetic
    // "Home" that names no real page, root them at the SIDEBAR SECTION label the operator already
    // sees in the nav — the exact `SidebarGroupLabel` text from `AppShell.tsx` ("MCP" / "Skills" /
    // "Testing" / "Setup"; note `/testing/environments` sits in the "Setup" group there, not
    // "Testing", despite its URL prefix). A section has no single route of its own, so its crumb
    // carries no `to` — `BreadcrumbItemFragment`'s `!crumb.to` fallback renders it as plain,
    // non-linked text, same as the leaf. (Settings is no longer here — it is a modal over the
    // current view, so the breadcrumb keeps showing the page behind it.)
    if (location.pathname === "/testing/environments") {
      return [{ label: "Setup" }, { label: "Environments" }];
    }
    if (location.pathname === "/testing/compatibility") {
      return [{ label: "Testing" }, { label: "Compatibility" }];
    }
    if (location.pathname === "/advisor") {
      return [{ label: "MCP" }, { label: "Advisor" }];
    }
    // RM-14 WP 0.3 — the illustration gallery has no sidebar section of its own (it deliberately
    // adds no nav item; where an asset repository belongs in the IA is an owner decision), so its
    // crumb roots at Home the way the unlabeled-group routes above do, which is also its way back.
    if (location.pathname === "/illustrations") {
      return [{ label: "Home", to: "/dashboard" }, { label: "Illustrations" }];
    }
    // Depth-1 list roots also root at their section so the top bar always carries a breadcrumb (S16).
    if (location.pathname === "/testing/runs") {
      return [{ label: "Testing" }, { label: "Runs" }];
    }
    if (location.pathname === "/compare/scans") {
      return [{ label: "MCP" }, { label: "Compare" }];
    }
    if (location.pathname === "/scans") {
      return [{ label: "MCP" }, { label: "Scans" }];
    }
    if (location.pathname === "/servers") {
      return [{ label: "MCP" }, { label: "MCP Servers" }];
    }
    if (location.pathname === "/skills") {
      return [{ label: "Skills" }, { label: "Skills" }];
    }
    if (location.pathname === "/testing/collections") {
      return [{ label: "Testing" }, { label: "Collections" }];
    }
    // design-remediation T8 — the suites LIST is a real route now (its breadcrumb + the suite-run
    // console's back button both target it); root it at "Testing" like the other depth-1 roots.
    if (location.pathname === "/testing/suites") {
      return [{ label: "Testing" }, { label: "Suites" }];
    }
    // design-remediation T8 — the review-queue surface is now a first-class Testing peer at its own
    // `/testing/review` (moved off the buried `/testing/runs/review`, which redirects here), so it
    // roots at the "Testing" section label like every other depth-1 Testing root.
    if (location.pathname === "/testing/review") {
      return [{ label: "Testing" }, { label: "Review" }];
    }
    // Watch rules + Review rubrics live in the "Setup" nav group (design-remediation T8), so their
    // crumbs root at that section label — matching the Environments crumb above (also Setup).
    if (location.pathname === "/testing/observability/rules") {
      return [{ label: "Setup" }, { label: "Watch rules" }];
    }
    if (location.pathname === "/testing/observability/review-rubrics") {
      return [{ label: "Setup" }, { label: "Review rubrics" }];
    }
    // Assistant Hub UX WP3.1 (D-HUX15) — hub breadcrumbs. `/assistant/sessions` is the one nav
    // CHILD (nested under Assistant, not a Home-rooted sibling), so its crumb reflects that
    // hierarchy instead of the flat "Home > X" the other depth-1 roots use below.
    if (location.pathname === "/assistant/sessions") {
      return [{ label: "Assistant", to: "/assistant" }, { label: "Sessions" }];
    }
    // WP 2.7 / audit B-4 deliberately leaves the four blocks below at "Home": Assistant/Agents &
    // Crews/Projects/Audit sit in the UNLABELED nav group in `AppShell.tsx` (a top-level peer of
    // Dashboard — `SidebarGroup` with no `SidebarGroupLabel`, unlike the "MCP"/"Skills"/"Testing"/
    // "Setup" groups above), so there is no real section label to substitute. Replacing "Home" here
    // with e.g. "Assistant" would also resurrect the retracted audit finding that Agents & Crews /
    // Projects / Audit should read as children of Assistant — they are sidebar PEERS, not children
    // (`AppShell.tsx:167-170`), and the breadcrumbs already mirror that IA correctly. Don't change.
    if (location.pathname === "/assistant") {
      return [{ label: "Home", to: "/dashboard" }, { label: "Assistant" }];
    }
    // Agent/crew profiles (D-HUX5/D-HUX6) open as a `WideDialog` MODAL over the Directory — same
    // treatment as `/settings/:section` above: the modal doesn't get its own breadcrumb leaf, the
    // underlying Directory's crumb keeps showing through. Matches on the `/assistant/agents` prefix
    // (bare list + both `/assistant/agents/{agent,crew}/:id` node routes) for that reason.
    if (location.pathname.startsWith("/assistant/agents")) {
      return [{ label: "Home", to: "/dashboard" }, { label: "Agents & Crews" }];
    }
    if (location.pathname === "/assistant/projects") {
      return [{ label: "Home", to: "/dashboard" }, { label: "Projects" }];
    }
    if (location.pathname === "/assistant/audit") {
      return [{ label: "Home", to: "/dashboard" }, { label: "Audit" }];
    }
    // /dashboard is the home root itself — no up-navigation, so it intentionally has no breadcrumb.
    return [];
  }, [
    serverMatch,
    selectedServer,
    scanMatch,
    selectedScan,
    skillMatch,
    skillStudioMatch,
    selectedSkillId,
    skills,
    collectionMatch,
    collections,
    suiteDetailMatch,
    isRunConsoleRoute,
    isReportRoute,
    location.pathname,
    reportDialogScan,
    routeCrumb,
  ]);

  // ── Per-route document.title + a polite route announcer (design-remediation T5, item 3) ─────────
  // Every route used to read the constant "AI Workbench" in the tab, and a route change was silent to
  // assistive tech. Derive a page name from the breadcrumb LEAF (already the human name of the current
  // page, incl. the resolved entity — "<server> · <time>"), with the two breadcrumb-less cases named
  // explicitly, so the tab reads "Runs · AI Workbench" and an SPA navigation is announced.
  const pageTitle = useMemo(
    () =>
      derivePageTitle({
        isSettings: settingsMatch != null,
        breadcrumbs,
        pathname: location.pathname,
      }),
    [settingsMatch, breadcrumbs, location.pathname],
  );

  useEffect(() => {
    document.title = formatDocumentTitle(pageTitle);
  }, [pageTitle]);

  // The polite live region's text — updated a beat after the title so the region (always mounted
  // below) fires an SPA-navigation announcement for screen readers.
  const [routeAnnouncement, setRouteAnnouncement] = useState("");
  useEffect(() => {
    setRouteAnnouncement(pageTitle);
  }, [pageTitle]);

  return (
    <ErrorBoundary>
      <McpAuthContextProvider api={mcpAuth.api}>
        {/* Polite route announcer (design-remediation T5, item 3): always-mounted visually-hidden
            live region; its text changes on navigation so a screen reader announces the new page. */}
        <div
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
          data-testid="route-announcer"
        >
          {routeAnnouncement}
        </div>
        <RouteCrumbProvider onChange={setRouteCrumb}>
          <AppShell
            breadcrumbs={breadcrumbs}
            fullBleed={isRunConsoleRoute || isSuiteRunConsoleRoute || isCurrentRoutePageShell}
            hideChromeForPrint={isReportRoute}
            themePreference={themePreference}
            onThemePreferenceChange={setThemePreference}
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            dockAvailable={assistant.authConfigured}
            dockOpen={assistant.isOpen}
            onDockOpenChange={(open) =>
              open ? assistant.openAssistant() : assistant.closeAssistant()
            }
            dockContent={
              // The dock is `React.lazy` (it transitively pulls Monaco via the skill-diff card), so it
              // no longer weighs on the entry chunk; a small `@elabs-ai/components-*` Spinner covers its chunk load.
              <Suspense
                fallback={
                  <div className="flex h-full w-full items-center justify-center p-6">
                    <Spinner label="Loading assistant…" />
                  </div>
                }
              >
                <AssistantDock />
              </Suspense>
            }
            dockHintCount={assistantStarters.length}
          >
            {/* Rendered against the EFFECTIVE location — while the settings modal is open the router
              keeps showing the page behind it (see the settings block at the top of App). Every route
              element is `React.lazy` (see the lazy block above), so one Suspense boundary here catches
              the chunk load for whichever route is active; the fallback is a `@elabs-ai/components-*` StatePanel. */}
            <Suspense fallback={<RouteFallback />}>
              <Routes location={location}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route
                  path="/dashboard"
                  element={
                    <DashboardView
                      initialLoading={initialLoading}
                      servers={servers}
                      scans={scans}
                      onOpenScan={openScan}
                      onOpenServer={(serverId) => navigate(`/servers/${serverId}`)}
                      onRunScan={(id) => void runScan(id)}
                    />
                  }
                />
                {/* Assistant Hub (D-AH2) — WP 0.4 nav + shell scaffold; no transport/session logic yet. */}
                <Route
                  path="/assistant"
                  element={
                    <FeatureGate feature="assistant">
                      <AssistantView />
                    </FeatureGate>
                  }
                />
                {/* Assistant Hub (WP2.1 D-AH7 / Assistant Hub UX WP2.1 D-HUX5) — the workforce
                section: the bare route renders the Directory tab; the two node routes below open a
                profile modal OVER it (agent/crew use distinct param names on purpose — see
                `WorkforceView.tsx`'s frame-API doc comment). All three render the same thin
                `<AgentsView />` shell — `WorkforceView` reads its own state from the URL. */}
                <Route
                  path="/assistant/agents"
                  element={
                    <FeatureGate feature="assistant">
                      <AgentsView />
                    </FeatureGate>
                  }
                />
                <Route
                  path="/assistant/agents/agent/:agentId"
                  element={
                    <FeatureGate feature="assistant">
                      <AgentsView />
                    </FeatureGate>
                  }
                />
                <Route
                  path="/assistant/agents/crew/:crewId"
                  element={
                    <FeatureGate feature="assistant">
                      <AgentsView />
                    </FeatureGate>
                  }
                />
                {/* Assistant Hub UX WP1.4 (D-HUX4) — session history table (replaces SessionRail). */}
                <Route
                  path="/assistant/sessions"
                  element={
                    <FeatureGate feature="assistant">
                      <SessionsView />
                    </FeatureGate>
                  }
                />
                {/* Assistant Hub (WP3.1, D-AH11c) — the project library (instructions + pinned files). */}
                <Route
                  path="/assistant/projects"
                  element={
                    <FeatureGate feature="assistant">
                      <ProjectsView />
                    </FeatureGate>
                  }
                />
                {/* Assistant Hub UX WP3.1 (D-HUX11/D-HUX15, P3) — Memory dissolved into scopes; the
                old standalone page redirects to the workspace's profile-memory dialog deep link
                (WP2.7 already wires `?memory=profile` in `AssistantView` to open it). */}
                <Route
                  path="/assistant/memory"
                  element={<Navigate to="/assistant?memory=profile" replace />}
                />
                {/* Assistant Hub UX WP3.1 (D-HUX10/D-HUX15) — Usage dissolved into the workforce
                section's Usage tab; the old standalone page redirects there (`WorkforceView` reads
                `?tab=usage` off the `/assistant/agents` route). */}
                <Route
                  path="/assistant/usage"
                  element={<Navigate to="/assistant/agents?tab=usage" replace />}
                />
                {/* Assistant Hub (WP4.2, D-AH13) — the global, filterable Audit timeline. */}
                <Route
                  path="/assistant/audit"
                  element={
                    <FeatureGate feature="assistant">
                      <AuditView />
                    </FeatureGate>
                  }
                />
                {/* RM-32 D-OD1 — `/servers` is the OVERVIEW (a grouped grid ⇄ table of the whole
                fleet), not a redirect to whichever server sorted first; `/servers/:serverId` is the
                full-width detail, whose breadcrumb leaf switches servers. */}
                <Route
                  path="/servers"
                  element={
                    <ServersOverview
                      isBusy={isBusy}
                      initialLoading={initialLoading}
                      servers={servers}
                      serverTypes={serverTypes}
                      latestScansByServer={latestScansByServer}
                      onAddServer={openCreateServer}
                      onManageTypes={() => setManageTypesOpen(true)}
                      onDeleteServer={confirmDeleteServer}
                      onEditServer={openEditServer}
                      onRunScan={(id) => void runScan(id)}
                      onTestServer={(id) => void testServer(id)}
                    />
                  }
                />
                <Route
                  path="/servers/:serverId"
                  element={<ServersRoute {...serversRouteProps()} />}
                />
                <Route
                  path="/scans"
                  element={
                    <ScansView
                      selectedScan={selectedScan}
                      scanLoadError={scanLoadError}
                      scans={scans}
                      onLoadScan={openScan}
                    />
                  }
                />
                <Route
                  path="/scans/:scanId"
                  element={
                    <ScansView
                      selectedScan={selectedScan}
                      scanLoadError={scanLoadError}
                      scans={scans}
                      onLoadScan={openScan}
                    />
                  }
                />
                <Route
                  path="/compare/scans"
                  element={<CompareView scans={scans} servers={servers} onCompare={compareScans} />}
                />
                {/* Bare parent → the section's default view, not the dashboard catch-all (WP 0.3 / C1). */}
                <Route path="/compare" element={<Navigate to="/compare/scans" replace />} />
                {/* RM-32 D-OD1 — `/skills` is the registry OVERVIEW; `/skills/:skillId` is the
                inspector, whose breadcrumb leaf switches skills. */}
                <Route
                  path="/skills"
                  element={
                    <SkillsOverview
                      skills={skills}
                      isBusy={isBusy}
                      onAddSkill={openCreateSkill}
                      onPullSkill={(id) => void pullSkillLatest(id)}
                      onDeleteSkill={confirmDeleteSkill}
                    />
                  }
                />
                <Route
                  path="/skills/:skillId"
                  element={
                    <SkillsView
                      skills={skills}
                      selectedSkillId={selectedSkillId}
                      onAddSkill={openCreateSkill}
                    />
                  }
                />
                {/* RM-30 WP 7.1 — the Skill Studio. A place, not an action (D-TB10): its whole view
                state (`?mode=&file=&sel=`) rides the URL, and it renders a usable workbench with no
                query params at all. `/skills/` is already a PageShell prefix, so it mounts
                full-bleed like the inspector. */}
                <Route path="/skills/:skillId/studio" element={<SkillStudioView />} />
                {/* Environments — the run-harness home (wire/type name stays `scenario`; see the
                `Scenario` shared type + `/testing/scenarios` redirect below). */}
                <Route path="/testing/environments" element={<EnvironmentsView />} />
                <Route path="/testing/runs" element={<RunsView />} />
                <Route path="/testing/runs/new" element={<RunConsoleRoute />} />
                {/* The Compare Workspace (WP 4.1). A static path outranks the dynamic
                `/testing/runs/:runId` in react-router's matcher, so order is not load-bearing. */}
                <Route path="/testing/runs/compare" element={<CompareWorkspace />} />
                {/* design-remediation T8 — the review-queue surface got promoted to its own top-level
                `/testing/review` (a Testing nav peer); the old buried `/testing/runs/review` path stays
                as a compat redirect so any bookmark still resolves. */}
                <Route path="/testing/review" element={<ReviewView />} />
                <Route
                  path="/testing/runs/review"
                  element={<Navigate to="/testing/review" replace />}
                />
                <Route path="/testing/runs/:runId" element={<RunConsoleRoute />} />
                {/* design-remediation T8 — the suites LIST is a real route (breadcrumb + suite-run
                console back-button target), and `:suiteId` is a real DETAIL page (editor as an
                overlay), not the list-with-a-modal that used to teleport to Collections on cancel. */}
                <Route path="/testing/suites" element={<SuitesView />} />
                <Route path="/testing/suites/:suiteId" element={<SuiteDetail />} />
                <Route path="/testing/suite-runs/:suiteRunId" element={<SuiteRunConsoleRoute />} />
                <Route path="/testing/collections" element={<CollectionsView />} />
                <Route path="/testing/collections/:collectionId" element={<CollectionDetail />} />
                {/* Watch-rules management. design-remediation T8 gave it a "Watch rules" nav item in
                the Setup group (it was previously URL-only, reachable just from Settings → Testing);
                the route path is unchanged. */}
                <Route path="/testing/observability/rules" element={<WatchRulesView />} />
                {/* Review-rubric management. design-remediation T8 gave it a "Review rubrics" nav item
                in the Setup group (also previously URL-only); route path unchanged. The review SURFACE
                itself is the promoted `/testing/review` (a Testing nav peer). */}
                <Route path="/testing/observability/review-rubrics" element={<RubricsView />} />
                <Route
                  path="/testing/compatibility"
                  element={<CompatibilityView scans={scans} />}
                />
                {/* Advisor (planning/Roadmap/RM-01-advisor/ WP 1.3) — the scope lives in the URL (`?scope=&id=`)
                so a report is bookmarkable/shareable, and the bare route renders the FLEET report,
                i.e. something useful with zero query params (D-TB10). */}
                <Route path="/advisor" element={<AdvisorView />} />
                {/* Illustrations (planning/Roadmap/RM-14-illustrations/ WP 0.3) — the asset repository. A real
                place, not a task, so it is a route (D-TB10); a cold load with zero query params
                renders the whole catalog, and drilling into one component opens a dialog rather
                than a second route (see `IllustrationDetail`'s docstring for why). */}
                <Route path="/illustrations" element={<IllustrationsGallery />} />
                {/* Bare `/testing` parent → the testing home (Collections), not the dashboard catch-all
                (WP 0.3 / C1). Collections is the test home per the IA nav order. */}
                <Route path="/testing" element={<Navigate to="/testing/collections" replace />} />
                {/* `/testing/scenarios` → `/testing/environments` is a legitimate SAME-CONCEPT compat
                redirect (the Environment rename kept the `scenario` wire type; only the label moved).
                design-remediation T8 DELETED the `/testing/tests → collections` and
                `/testing/suites → collections` redirects: tests and suites are NOT collections, so
                those "nouns we happened to have tables for" redirects pointed at an unrelated place.
                `/testing/suites` is now a real route (above); `/testing/tests` correctly falls through
                to the 404 catch-all (there is no per-test detail route to send it to). */}
                <Route
                  path="/testing/scenarios"
                  element={<Navigate to="/testing/environments" replace />}
                />
                {/* `/testing/compare` → `/testing/runs/compare` is a same-concept relocation of the
                run-compare workspace (kept; the scan-compare front door is the sidebar "Compare"). */}
                <Route
                  path="/testing/compare"
                  element={<Navigate to="/testing/runs/compare" replace />}
                />
                {/* No `/settings` route: the Routes above never see a settings URL — App substitutes the
                last content location and renders the SettingsDialog (below) over it. */}
                <Route path="/reports/scans/:scanId" element={<ServerReportRoute />} />
                <Route path="/reports/digest/:id" element={<DigestReportRoute />} />
                {/* item 5: a mistyped/dead URL renders a real 404 (with a way back) instead of the
                    old silent `<Navigate to="/dashboard">` teleport — same StatePanel pattern the
                    scan-not-found dead end (`/scans/:missing`) uses. */}
                <Route path="*" element={<NotFoundRoute />} />
              </Routes>
            </Suspense>
          </AppShell>
        </RouteCrumbProvider>

        {/* Settings — a deep-linkable modal (`/settings/:section?`) rendered OVER the current view.
            Closing navigates back to the content location the modal covers (replace, not push). */}
        <SettingsDialog
          open={settingsMatch != null}
          section={settingsMatch?.params.section ?? null}
          onSectionChange={(id) => navigate(`/settings/${id}`, { replace: true })}
          onOpenChange={(open) => {
            if (!open) {
              const target = contentLocationRef.current;
              navigate(
                { pathname: target.pathname, search: target.search, hash: target.hash },
                { replace: true },
              );
              // item 2: Settings opens from a URL (no Radix trigger) — restore focus to the opener.
              restoreLastFocus();
            }
          }}
          // Radix's own close-focus lands on <body> (no DialogTrigger); prevent it and restore to the
          // opener AFTER Radix would have moved focus, so a keyboard user isn't stranded on close.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreLastFocus();
          }}
          defaultProfile={defaultProfile}
          health={health}
          onDefaultProfileChange={setDefaultProfile}
          onNavigateToRoute={(path) => navigate(path)}
          // WP 4.4 (D-5): thread the SAME lifted theme preference the top bar + command palette use,
          // so the Settings theme Select and the top-bar control stay in lockstep (one source).
          themePreference={themePreference}
          onThemePreferenceChange={setThemePreference}
        />

        {/* ⌘K global command palette — keyboard-first navigation + search over servers/skills/
            collections/recent scans + top-level actions. Owns the global ⌘K key listener; the
            top-bar search button opens it via the lifted `commandPaletteOpen` state above. */}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={handleCommandPaletteOpenChange}
          servers={servers}
          scans={scans}
          skills={skills}
          collections={collections}
          themePreference={themePreference}
          onThemePreferenceChange={setThemePreference}
          onAddServer={openCreateServer}
          onAddSkill={openCreateSkill}
        />

        <ServerWizard
          open={serverWizardOpen}
          server={editingServer}
          serverTypes={serverTypes}
          reason={wizardReason}
          reauthContext={reauthContext}
          onComplete={handleWizardComplete}
          onCreateServer={createServer}
          onOpenChange={handleWizardOpenChange}
          onProbeServer={probeServer}
          onStartOAuth={startOAuth}
          // Plain connection test for the wizard's own "I completed login" verify — NOT the reauth-
          // wrapped testServer, which would try to re-open this very window on an authRequired result.
          onTestServer={testServerConnection}
          onUpdateServer={updateServer}
        />
        {/* Manage server types (planning/Roadmap/completed/RM-21-server-types WP 2.2). `onChanged` = the app's refreshAll so
            BOTH server types AND servers reload (a delete detaches members → their typeId changes). */}
        <ManageServerTypesDialog
          open={manageTypesOpen}
          onOpenChange={setManageTypesOpen}
          serverTypes={serverTypes}
          onChanged={refreshAll}
        />
        {/* SV3 · WP 1.5: server delete is a Tier-1 ConfirmDialog, triggered only from the registry
            row menu (it left the edit wizard footer). */}
        <ConfirmDialog
          open={pendingDeleteServer !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteServer(null);
          }}
          tone="destructive"
          title={`Delete ${pendingDeleteServer?.name ?? "server"}?`}
          description={`This permanently removes “${
            pendingDeleteServer?.name ?? "this server"
          }” and its scan history. This action cannot be undone.`}
          confirmLabel="Delete server"
          onConfirm={performPendingDelete}
        />
        <SkillWizard
          open={skillWizardOpen}
          onOpenChange={setSkillWizardOpen}
          onCreateUpload={createSkillUpload}
          onCreateBlank={createSkillBlank}
          onProbeRepo={probeSkillRepo}
          onCreateGithub={createSkillGithub}
          onUseServerSource={openScaffoldFromServer}
        />
        {/* D-UX1 (K6): the "New skill from server" flow, opened from the Add-skill modal's 4th tile. */}
        <ScaffoldFromServerWizard
          open={scaffoldSkillOpen}
          onOpenChange={setScaffoldSkillOpen}
          onCreated={(result) => void handleSkillScaffolded(result.skill.id)}
        />
        {/* WP 1.5 reference adoption: the modal-tier ConfirmDialog (Tier 1). */}
        <ConfirmDialog
          open={pendingDeleteSkill !== null}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteSkill(null);
          }}
          tone="destructive"
          title={`Delete ${pendingDeleteSkill?.displayName ?? "skill"}?`}
          description={`This permanently removes “${
            pendingDeleteSkill?.displayName ?? "this skill"
          }” and all of its versions. This action cannot be undone.`}
          confirmLabel="Delete skill"
          onConfirm={performPendingSkillDelete}
        />
        <ServerReportDialog
          open={reportDialogScan !== null}
          scan={reportDialogScan}
          onOpenChange={(open) => {
            if (!open) setReportDialogScan(null);
          }}
          onGenerate={({ scanId, modelIds, client, detail, format }) => {
            if (format === "markdown") {
              // Download the single markdown document directly (mirrors the scan/run markdown <a href>
              // exports; content-disposition: attachment makes it download rather than navigate).
              const q = new URLSearchParams();
              if (modelIds.length > 0) q.set("models", modelIds.join(","));
              if (client) q.set("client", client);
              q.set("detail", detail);
              const a = document.createElement("a");
              a.href = `/api/reports/server/${scanId}/markdown?${q.toString()}`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setReportDialogScan(null);
              return;
            }
            // HTML report → navigate to the in-shell report route (item 5), deep-linkable.
            const q = new URLSearchParams();
            if (modelIds.length > 0) q.set("models", modelIds.join(","));
            if (client) q.set("client", client);
            q.set("detail", detail);
            if (reportDialogScan?.serverName) q.set("serverName", reportDialogScan.serverName);
            setReportDialogScan(null);
            navigate(`/reports/scans/${scanId}?${q.toString()}`);
          }}
        />
        {/* No separate reauth modal: the gate routes (re)authentication through the ServerWizard
            settings window above (App's own handlers + any descendant via useMcpAuth). */}
      </McpAuthContextProvider>
    </ErrorBoundary>
  );

  function serversRouteProps() {
    return {
      isBusy,
      initialLoading,
      latestScan: selectedServerLatestScan,
      scanHistory: selectedServerScanHistory,
      selectedServer,
      servers,
      latestScansByServer,
      serverTypes,
      onAddServer: openCreateServer,
      onEditServer: openEditServer,
      onExportReport: (scan: ScanDetail) => setReportDialogScan(scan),
      onRunScan: (id: string) => void runScan(id),
      onTestServer: (id: string) => void testServer(id),
    };
  }
}

/** Thin wrapper so both `/servers` and `/servers/:serverId` render the same view with one prop set. */
function ServersRoute(props: ComponentProps<typeof ServersView>) {
  return <ServersView {...props} />;
}

/**
 * The router-level 404 (design-remediation T5, item 5). A mistyped or dead URL used to be a silent
 * `<Navigate to="/dashboard">` teleport — the operator's address vanished with no acknowledgement.
 * This renders a real not-found surface with a way back, reusing the SAME `@elabs-ai/components-ui` `StatePanel`
 * error pattern the scan-not-found dead end (`/scans/:missing`) uses, inside the app shell (so the
 * whole nav is also available as a way out). The attempted path is echoed so the mistype is visible.
 */
function NotFoundRoute() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-8">
      <StatePanel
        kind="error"
        title="Page not found"
        description={`There’s nothing at ${pathname}. The address may be mistyped, or the page may have moved.`}
        actions={
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </Button>
        }
      />
    </div>
  );
}

type ToastTone = "success" | "danger" | "info";

/** Exported for unit testing (see App.test.ts) — locks the fix for the dropped `generic_estimate` profile. */
export function isTokenProfile(value: string | null): value is TokenProfileId {
  return value !== null && (TOKEN_PROFILES as readonly string[]).includes(value);
}

/**
 * The human name of the current page (design-remediation T5, item 3). Derived from the breadcrumb
 * LEAF (already the resolved name of the page, incl. the entity — "<server> · <time>"), with the two
 * breadcrumb-less cases named explicitly. Pure + exported so the `route-title` guardrail can prove two
 * different routes yield two different titles without rendering the whole `App` (mirrors the
 * `isTokenProfile`/`isPageShellRoute` pure-function test precedent in this repo).
 */
export function derivePageTitle(params: {
  isSettings: boolean;
  breadcrumbs: Crumb[];
  pathname: string;
}): string {
  if (params.isSettings) return "Settings";
  const leaf =
    params.breadcrumbs.length > 0
      ? params.breadcrumbs[params.breadcrumbs.length - 1]?.label
      : undefined;
  if (leaf) return leaf;
  if (params.pathname === "/dashboard") return "Dashboard";
  // The catch-all (item 5) and any transient redirect frame — nothing matched.
  return "Page not found";
}

/** `document.title` for a page name — "<page> · AI Workbench" (never the bare app-name constant). */
export function formatDocumentTitle(pageTitle: string): string {
  return `${pageTitle} · AI Workbench`;
}
