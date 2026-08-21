import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useFeatureEnabled } from "../features/feature-flags/feature-flags-context";
import {
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Kbd,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  Text,
  TopNav,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@elabs-ai/components-ui";
import { AppIcon } from "@elabs-ai/components-icons";
import { BUILT_IN_THEME_META } from "@elabs-ai/components-tokens";
import {
  Bell,
  Bot,
  Boxes,
  Check,
  ClipboardCheck,
  Clock,
  Folder,
  Grid3x3,
  GitCompareArrows,
  History,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Monitor,
  Moon,
  PlayCircle,
  Plus,
  ScanLine,
  Search,
  Server,
  Settings,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { THEME_PREFERENCE_ORDER, type ThemePreference } from "../lib/theme";
import { BreadcrumbSlotProvider } from "./breadcrumb-slot";
import { IconButton } from "./IconButton";

/**
 * `children` (Assistant Hub UX WP3.1, D-HUX15) is optional and additive — every OTHER nav group
 * stays a flat array (no group has ever needed nesting before). Only the Assistant item uses it,
 * for its single Sessions child. Rendered as a static, always-visible `SidebarMenuSub` (no
 * expand/collapse chrome) since there's exactly one child today — no `@elabs-ai/components-ui` `Collapsible`
 * wiring needed for that.
 */
type NavItem = {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  children?: NavItem[];
};

/**
 * The command-palette shortcut hint shown on the top-bar search trigger — "⌘K" on Apple platforms,
 * "Ctrl K" elsewhere. Computed once at module load (the platform never changes within a session);
 * guarded so it degrades to the Ctrl form under SSR / a stubbed `navigator`.
 */
const SHORTCUT_HINT: string = (() => {
  const platform =
    typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl K";
})();

// Dashboard alone is the primary, unlabeled menu group — the app-wide overview sits above every
// labeled section (owner IA tweak 2026-07-17).
export const NAV_ITEMS: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
];

// The Assistant Hub (D-AH2) — the new full-page, multi-model, multi-agent assistant. Its own
// primary, unlabeled menu group directly below Dashboard (assistant-hub WP 0.4): a top-level peer
// to Dashboard, not a labeled category like MCP/Skills/Testing/Setup below. Distinct from the
// right-side dock (relabeled "App assistant" — see the TopNav toggle below).
//
// Assistant Hub UX WP3.1 (D-HUX15) — nav consolidates 6 → 4: "Assistant" (the workspace at
// `/assistant`) carries a nested "Sessions" child (`/assistant/sessions`, D-HUX4 — the session
// history table that replaced the permanent `SessionRail`); "Agents & Crews" (D-HUX5, the
// workforce section: role library + saved crews + org chart + usage tab) at `/assistant/agents`;
// "Projects" (D-AH11c) at `/assistant/projects`; "Audit" (D-AH13) at `/assistant/audit`. The old
// standalone "Memory" and "Usage" nav entries are RETIRED — Memory dissolved into scopes reached
// from the workspace (D-HUX11; `/assistant/memory` now redirects to the profile-memory dialog) and
// Usage dissolved into the workforce section's Usage tab (D-HUX10; `/assistant/usage` now
// redirects to `/assistant/agents?tab=usage`) — see the two `<Navigate>` routes in `App.tsx`.
// Exported (alongside `isPathActive` below) purely so the nav shape is unit-testable without
// rendering the full `AppShell` tree — see `AppShell.test.ts` — mirroring how `App.tsx` exports
// `PAGESHELL_EXACT_ROUTES`/`isPageShellRoute` for the same reason.
export const ASSISTANT_NAV_ITEMS: NavItem[] = [
  {
    path: "/assistant",
    label: "Assistant",
    icon: Bot,
    children: [{ path: "/assistant/sessions", label: "Sessions", icon: Clock }],
  },
  { path: "/assistant/agents", label: "Agents & Crews", icon: Users },
  { path: "/assistant/projects", label: "Projects", icon: Folder },
  { path: "/assistant/audit", label: "Audit", icon: History },
];

// The MCP analyzer views, grouped under their own "MCP" label (owner IA tweak 2026-07-17: these
// moved out of the top-level group so the section order reads MCP → Skills → Testing → Setup).
export const MCP_NAV_ITEMS: NavItem[] = [
  { path: "/servers", label: "MCP Servers", icon: Server },
  { path: "/scans", label: "Scans", icon: ScanLine },
  { path: "/compare/scans", label: "Compare", icon: GitCompareArrows },
  // Advisor (planning/Roadmap/RM-01-advisor/ WP 1.3) — evidenced recommendations over the measurements the MCP
  // group above produces (scans/footprints) plus the run history. It sits here rather than under
  // Testing so the four load-bearing Testing items stay as they are.
  { path: "/advisor", label: "Advisor", icon: Lightbulb },
];

// The Skills registry views, grouped under their own "Skills" label between the analyzer and the
// Testing groups (UI plan §1 — section order MCP analyzer → Skills → Testing).
export const SKILL_NAV_ITEMS: NavItem[] = [
  { path: "/skills", label: "Skills", icon: Sparkles },
];

// The Testing run-engine views, grouped under their own "Testing" label. design-remediation T8 built
// the nav from the real model — Collection → Test → Suite → Run, Environment as the harness — instead
// of "nouns we happened to have tables for": Collections is the test home, Runs is the unified results
// feed, **Review** is the review-queue surface (previously an orphan reachable only by URL — now a
// first-class peer at `/testing/review`), and Compatibility is the model×MCP matrix. The Run console
// (`/testing/runs/:runId`) and the Suites list (`/testing/suites`) are drilled into, not top-level nav.
// Collections is git-optional now, so it uses a plain Folder icon rather than FolderGit2.
export const TESTING_NAV_ITEMS: NavItem[] = [
  { path: "/testing/collections", label: "Collections", icon: Folder },
  { path: "/testing/runs", label: "Runs", icon: PlayCircle },
  { path: "/testing/review", label: "Review", icon: ClipboardCheck },
  { path: "/testing/compatibility", label: "Compatibility", icon: Grid3x3 },
];

// The Setup group is the settings-style home for Testing CONFIGURATION surfaces (design-remediation
// T8): `Environments` (the run harness — wire/type name stays `scenario`, see the `Scenario` shared
// type), plus the two surfaces that were orphaned off the nav and reachable only by typing a URL —
// `Watch rules` (`/testing/observability/rules`) and `Review rubrics`
// (`/testing/observability/review-rubrics`). Keeping them here (not as top-level Testing peers) holds
// the main Testing group at its four load-bearing items while still making the routes navigable.
export const SETUP_NAV_ITEMS: NavItem[] = [
  { path: "/testing/environments", label: "Environments", icon: Boxes },
  { path: "/testing/observability/rules", label: "Watch rules", icon: Bell },
  { path: "/testing/observability/review-rubrics", label: "Review rubrics", icon: ListChecks },
];

/** A route breadcrumb crumb. Non-leaf crumbs carry a `to` (a real link); the leaf omits it. */
export type Crumb = { label: string; to?: string };

/** URL match for the sidebar active state: exact path, or a nested route under it. */
export function isPathActive(pathname: string, itemPath: string): boolean {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

/** Active state for a nav item that may have CHILDREN (only "Assistant" does, WP3.1/D-HUX15): its
 *  own EXACT path or any child's path — NOT a prefix, which would also light up SIBLING top-level
 *  sections that happen to live under the same URL root (`/assistant/agents|projects|audit` are peers
 *  of Assistant, not its children — WP3.R-H1). Childless items keep the plain prefix match. */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.children && item.children.length > 0) {
    return (
      pathname === item.path || item.children.some((child) => isPathActive(pathname, child.path))
    );
  }
  return isPathActive(pathname, item.path);
}

/**
 * The active nav-item state cue (design-remediation T5, item 4). brand-ui's default active style is
 * `bg-sidebar-accent` only, which measured a 1.17:1 wash against the rail in light (1.29:1 in
 * dark) with the SAME text color as inactive items — WCAG 1.4.11 wants ≥3:1 for a non-text state
 * indicator, and a same-grey wash gives a keyboard / low-vision operator nothing to lock onto in a
 * 16-item rail. This layers a token-driven accent LEFT-BAR (`bg-primary` against `bg-sidebar` is
 * high-contrast in BOTH themes — the WCAG-satisfying non-text indicator) plus a semibold label, so
 * the current section is unmistakable WITHOUT darkening the grey wash. Applied via `data-[active=true]:`
 * so it rides the `SidebarMenuButton`/`SidebarMenuSubButton` active data-attribute; `relative` anchors
 * the `before` bar. Exported so the `active-nav-contrast` guardrail can assert the cue is an accent
 * (a `bg-primary` border), not another grey wash.
 */
export const ACTIVE_NAV_INDICATOR_CLASS =
  "relative data-[active=true]:font-semibold " +
  "data-[active=true]:before:pointer-events-none data-[active=true]:before:absolute " +
  "data-[active=true]:before:inset-y-1.5 data-[active=true]:before:left-0 data-[active=true]:before:w-1 " +
  "data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary";

export type AppShellProps = {
  /** Route-derived breadcrumbs. Rendered only at drill depth ≥ 2; the leaf is the current page. */
  breadcrumbs?: Crumb[];
  /**
   * Render `<main>` edge-to-edge (no padding, no inner scroll) so a surface that owns its own
   * layout/scroll — like the Run console — gets the room. The sidebar + TopNav stay mounted and
   * interactive (unlike the old takeover): only the content padding is dropped.
   */
  fullBleed?: boolean;
  /**
   * Hide the shell chrome (sidebar + TopNav) from PRINT via `.app-non-printable` so a report route
   * prints only its content — the shell stays on screen (item 5: report renders inside the shell).
   */
  hideChromeForPrint?: boolean;
  /** The app's theme preference — drives the always-present top-bar theme control (F0/ST2). */
  themePreference: ThemePreference;
  /** Apply a new theme preference (kept in lockstep with the Settings mirror — one source). */
  onThemePreferenceChange: (preference: ThemePreference) => void;
  /**
   * Open the ⌘K command palette. When provided, the top bar renders a search-field-styled trigger
   * (the palette's discoverable, mouse-first entry point; the ⌘K shortcut itself is wired globally by
   * `CommandPalette`). Optional/additive — omitting it renders no trigger (every prior caller is
   * byte-identical), and the button is a thin affordance that owns no palette state.
   */
  onOpenCommandPalette?: () => void;
  /**
   * The Assistant dock's content (`AssistantDock`) — a flex sibling AFTER `<main>`, resizable,
   * collapsed by default. OPTIONAL and ADDITIVE: every existing
   * caller omits it, so the dock simply doesn't render (no toggle, no aside, no behavior change).
   */
  dockContent?: ReactNode;
  /** Whether the dock is currently open. Ignored (treated as closed) unless `dockAvailable`. */
  dockOpen?: boolean;
  onDockOpenChange?: (open: boolean) => void;
  /**
   * Whether the Assistant is reachable AT ALL right now — hides both the TopNav toggle and the dock
   * itself when false (D-AS: "until an auth source exists the dock toggle is hidden", `planning/Roadmap/RM-02-assistant/00-plan.md` §3.5).
   * Defaults to false so every existing `AppShell` caller (which passes none of the dock props) renders
   * byte-identical to before this WP.
   */
  dockAvailable?: boolean;
  /**
   * How many suggested interactions (session starters) the current page has — rendered as a small
   * count pill on the collapsed dock toggle so the owner can see there's something to ask about
   * without opening the dock. Ignored while the dock is open (the chips themselves are visible then).
   */
  dockHintCount?: number;
  children: ReactNode;
};

/** The dock's resizable width in px — persisted so a chosen width survives reload. Pixel-based (not
 *  a panel percentage) because the dock now animates open/closed by transitioning its `width`, the
 *  exact mechanic the left navigation `Sidebar` uses (its gap div transitions `width` over 200ms),
 *  so both panels reflow the app identically. */
const DOCK_WIDTH_STORAGE_KEY = "mcp-token-footprint.assistant.dock-width-px";
const DEFAULT_DOCK_WIDTH_PX = 400;
const DOCK_MIN_WIDTH_PX = 300;
const DOCK_MAX_WIDTH_PX = 720;
/** Keep at least this much room for the main content when dragging the dock wider. */
const DOCK_MIN_MAIN_PX = 480;
/** Dock open/close animation duration — must match the `duration-200` utility on the aside. */
const DOCK_ANIMATION_MS = 200;
/**
 * Below this viewport width the Assistant dock renders as an overlay Sheet, NOT a permanent split
 * (design-remediation T5, item 8b). A permanent split at a narrow width starves the content column —
 * at 768px with the dock open the content once measured 112px and an `<h1>` rendered 1px wide. The
 * brand-ui `useIsMobile` breakpoint (768px) is too low for the dock (a 400px dock + 768px viewport
 * still leaves only ~360px of content), so the dock has its OWN, higher breakpoint here.
 */
const DOCK_SHEET_MAX_WIDTH_PX = 1100;

/**
 * True when the viewport is narrow enough (< {@link DOCK_SHEET_MAX_WIDTH_PX}) that the dock must be an
 * overlay Sheet rather than a permanent right split. matchMedia-driven; when it's unavailable (SSR /
 * the jsdom test polyfill, which reports `matches: false`) this is `false`, i.e. the desktop split
 * path — matching every existing render harness.
 */
function useDockAsSheet(): boolean {
  const query = `(max-width: ${DOCK_SHEET_MAX_WIDTH_PX - 1}px)`;
  const [isNarrow, setIsNarrow] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsNarrow(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return isNarrow;
}

function readStoredDockWidthPx(): number {
  try {
    const raw = window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(parsed) && parsed >= DOCK_MIN_WIDTH_PX && parsed <= DOCK_MAX_WIDTH_PX)
      return parsed;
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return DEFAULT_DOCK_WIDTH_PX;
}

export function AppShell({
  breadcrumbs = [],
  fullBleed = false,
  hideChromeForPrint = false,
  themePreference,
  onThemePreferenceChange,
  onOpenCommandPalette,
  dockContent,
  dockOpen = false,
  onDockOpenChange,
  dockAvailable: dockAvailableProp = false,
  dockHintCount = 0,
  children,
}: AppShellProps) {
  const { pathname } = useLocation();
  // Settings › Features — TWO independent switches, one per assistant surface. `assistant` is the
  // full-page workspace and owns the sidebar group; `app_assistant` is the right-hand dock and owns
  // the toggle, the split column and the mobile Sheet. They are read separately on purpose: turning
  // the workspace off must leave the dock alone, and vice versa. Read here rather than drilled as
  // props so every dock/nav site in this file agrees; outside a provider both read ENABLED, so unit
  // tests that render `AppShell` bare behave exactly like a stock install.
  const assistantEnabled = useFeatureEnabled("assistant");
  const appAssistantEnabled = useFeatureEnabled("app_assistant");
  const dockAvailable = dockAvailableProp && appAssistantEnabled;
  // Only render a breadcrumb when there is real drill depth (≥2 crumbs): a top-level view + a
  // detail. On top-level views we render nothing (never a single crumb that repeats the page H1).
  const hasDrillDepth = breadcrumbs.length >= 2;
  const chromePrintClass = hideChromeForPrint ? "app-non-printable" : undefined;

  // An interactive trailing breadcrumb crumb a routed page can contribute (the Assistant session
  // switcher) — see `breadcrumb-slot.tsx`. Owned here so both the TopNav (which renders it) and the
  // page `children` (which set it) sit under the one provider around the whole shell subtree.
  const [breadcrumbSlot, setBreadcrumbSlot] = useState<ReactNode>(null);


  // Assistant dock width (desktop only — the mobile Sheet is always full-width). Persisted so a
  // chosen size survives reload; re-read lazily (not on every render) via `useState`'s initializer.
  const [dockWidthPx, setDockWidthPx] = useState<number>(readStoredDockWidthPx);
  // Below ~1100px the dock is an overlay Sheet, not a permanent split (see `useDockAsSheet`) — so a
  // narrow viewport can never squeeze the content column down to nothing (item 8b).
  const dockAsSheet = useDockAsSheet();
  // True while the owner is dragging the resize handle — suppresses the width TRANSITION so the
  // dock tracks the pointer 1:1 (a transition mid-drag would make it lag and rubber-band).
  const [dockResizing, setDockResizing] = useState(false);
  const handleDockResize = useCallback((widthPx: number) => {
    setDockWidthPx(widthPx);
    try {
      window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(widthPx));
    } catch {
      // localStorage unavailable — the width just won't persist across reloads.
    }
  }, []);
  // Re-clamp the persisted dock width against the LIVE viewport (item 8a). The drag handler clamps
  // during a drag, but a window shrink with the dock already open did not — so the split could leave
  // the content column below `DOCK_MIN_MAIN_PX` (112px at 768px in the audit). This keeps at least
  // that much room whenever the viewport changes. (Above ~1100px only; below that the dock is a Sheet.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    function clampToViewport() {
      setDockWidthPx((current) => {
        const max = Math.max(
          DOCK_MIN_WIDTH_PX,
          Math.min(DOCK_MAX_WIDTH_PX, window.innerWidth - DOCK_MIN_MAIN_PX),
        );
        const next = Math.min(current, max);
        if (next !== current) {
          try {
            window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(next));
          } catch {
            // localStorage unavailable — the clamp still applies in-memory.
          }
        }
        return next;
      });
    }
    window.addEventListener("resize", clampToViewport);
    clampToViewport();
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);
  const showDock = dockAvailable && dockOpen && dockContent != null;

  // Dock open/close MOTION (desktop): identical mechanic to the left navigation `Sidebar` — the
  // dock column's `width` transitions between 0 and the chosen width, so the whole app reflows
  // smoothly in both directions, exactly like collapsing/expanding the left rail. The content is
  // kept mounted while the close transition plays (`dockRendered` lags `showDock` by the duration)
  // and only THEN unmounts. `motion-reduce:transition-none` keeps both directions instant for
  // owners who ask the OS for reduced motion.
  const [dockRendered, setDockRendered] = useState(showDock);
  useEffect(() => {
    if (showDock) {
      setDockRendered(true);
      return;
    }
    if (!dockRendered) return;
    const timer = window.setTimeout(() => setDockRendered(false), DOCK_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [showDock, dockRendered]);

  // The shell's existing content region (unchanged from before this WP) — extracted to a variable so
  // it can be reparented under the dock's `ResizablePanelGroup` when the dock is open, and rendered
  // exactly as before when it's not (see the two render paths below).
  const mainRegion = fullBleed ? (
    // Edge-to-edge: no padding, no inner scroll — the surface owns its own layout/scroll (a
    // PageShell route, the run console). The sidebar + TopNav above stay mounted and interactive.
    <div className="app-shell-main min-h-0 flex-1 overflow-hidden">{children}</div>
  ) : (
    <div className="app-shell-main min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
  );

  // The TopNav element, extracted so BOTH dock branches render the identical bar: when the dock is
  // open it lives INSIDE the main (left) resizable panel — the dock is a full-height right column
  // mirroring the left navigation sidebar's shape, so the top bar must not span across it.
  const topNav = (
    <TopNav
      className={cn("h-14 border-b border-border px-3", chromePrintClass)}
      start={
        <div className="flex items-center gap-2">
          {/* The Toggle-Sidebar control is the ONLY navigation entry point on a phone (the rail is
              collapsed there). brand-ui's `SidebarTrigger` is a 28px icon button — below the 44px
              minimum tap target. Floor it at 44×44 under a COARSE pointer only (touch), so mouse/
              desktop density is untouched (item 8c). Wrapper + trigger classes are layout-only. */}
          <span className="inline-flex items-center justify-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11">
            <SidebarTrigger className="[@media(pointer:coarse)]:size-11" />
          </span>
          {hasDrillDepth || breadcrumbSlot ? (
            <Breadcrumb>
              <BreadcrumbList>
                {breadcrumbs.map((crumb, index) => {
                  // With a page-contributed trailing crumb, the last STATIC crumb is no longer the
                  // leaf — it gets a trailing separator and the slot becomes the leaf.
                  const isLast = index === breadcrumbs.length - 1 && !breadcrumbSlot;
                  return (
                    <BreadcrumbItemFragment
                      key={`${crumb.label}-${index}`}
                      crumb={crumb}
                      isLast={isLast}
                    />
                  );
                })}
                {breadcrumbSlot ? <BreadcrumbItem>{breadcrumbSlot}</BreadcrumbItem> : null}
              </BreadcrumbList>
            </Breadcrumb>
          ) : null}
        </div>
      }
      end={
        <div className="flex items-center gap-2">
          {/* The ⌘K command-palette trigger — a search-field-styled button (the discoverable,
              pointer-first entry point; the global ⌘K key itself is wired by CommandPalette). Only
              rendered when the app wires `onOpenCommandPalette`, so the AppShell contract stays
              additive. On sm+ it's a full-width field (left-aligned label, shortcut pinned right);
              on narrow viewports it collapses to the icon alone. Default size (h-9) so it lines up
              with the icon buttons beside it. */}
          {onOpenCommandPalette ? (
            <Button
              variant="outline"
              onClick={onOpenCommandPalette}
              className="gap-2 sm:w-60 sm:justify-start"
              aria-label="Search — open the command palette"
              title={`Search (${SHORTCUT_HINT})`}
            >
              <Search aria-hidden />
              <span className="hidden sm:inline">Search…</span>
              <Kbd className="ms-auto hidden sm:inline-flex">{SHORTCUT_HINT}</Kbd>
            </Button>
          ) : null}
          {/* Toolbar tweak 2026-07-11 (owner): the top-bar Refresh button is gone entirely —
              views own their data lifecycles; a manual page-scoped refresh earned no chrome. */}
          {/* Observability WP4.3 (D-OB19) — the notification center bell: unread badge, a popover of
              recent notifications, deep-link + mark-read on click, "mark all read". Always mounted
              (no auth gate, unlike the Assistant dock below) — every install has watch rules. */}
          <NotificationBell />
          {/* F0/ST2: the theme control lives here — reachable in two clicks from ANY route.
              Driven by the app's theme PREFERENCE (the single source `useThemePreference` owns),
              so it stays in lockstep with the Settings mirror and only shipped themes are offered. */}
          <ThemeMenu preference={themePreference} onPreferenceChange={onThemePreferenceChange} />
          {/* The Assistant dock toggle — rendered ONLY once the feature is reachable (D-AS:
              invisible until an auth source is configured). ⌘J/Ctrl+J is wired globally by
              `AssistantProvider` (no DOM position needed for a `window`-level key listener). */}
          {dockAvailable ? (
            <div className="relative">
              <IconButton
                variant={dockOpen ? "secondary" : "ghost"}
                onClick={() => onDockOpenChange?.(!dockOpen)}
                label={
                  !dockOpen && dockHintCount > 0
                    ? `Open App assistant (⌘J) — ${dockHintCount} suggested ${dockHintCount === 1 ? "action" : "actions"} for this page`
                    : dockOpen
                      ? "Close App assistant (⌘J)"
                      : "Open App assistant (⌘J)"
                }
                aria-pressed={dockOpen}
              >
                <Sparkles aria-hidden />
              </IconButton>
              {/* The collapsed-state hint pill: how many suggested interactions the current page
                  has (session starters). Decorative overlay — the count is already carried by the
                  button's own aria-label above, so the badge itself stays aria-hidden and inert. */}
              {!dockOpen && dockHintCount > 0 ? (
                <Badge
                  aria-hidden
                  className="pointer-events-none absolute -right-0.5 -top-0.5 h-4 min-w-4 justify-center px-1 tabular-nums"
                >
                  {dockHintCount}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      }
    />
  );

  return (
    // Bound the shell to the viewport so `main` is the scroll container (not the body). The
    // `app-shell-*` classes only take effect in print (see app.css) to let a report route flow.
    // The breadcrumb-slot provider wraps the whole subtree so the TopNav (renders the slot) and the
    // page `children` (set it) share one context.
    <BreadcrumbSlotProvider value={{ slot: breadcrumbSlot, setSlot: setBreadcrumbSlot }}>
      <SidebarProvider className={cn("app-shell-root h-dvh overflow-hidden")}>
        {/* Skip link (D-IC4 / finding 3) — the FIRST focusable element in the shell, before the
          sidebar. A real in-page navigation anchor: visually hidden until focused, then a
          token-styled pill with a visible focus ring, letting a keyboard user bypass the 16-item
          sidebar and jump straight into the single `<main>` (`#main-content`, the SidebarInset).
          Plain `<a>` for navigation (brand-ui-only allows it); styled with semantic tokens only, so
          it reads in both themes. */}
        <a
          href="#main-content"
          className="sr-only rounded-md bg-primary px-4 py-2 text-body font-medium text-primary-foreground shadow-md outline-none focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Skip to content
        </a>
        {/* The main navigation always renders at COMFORTABLE density, regardless of the app-wide
          `compact` setting — there's plenty of room in this rail. `data-density` resets `--spacing`
          to the identity for the whole sidebar subtree (see @elabs-ai/components-tokens density.css), which also
          fixes the collapsed icon buttons: their `size-8`/`p-2` scale with `--spacing`, so under
          compact they shrank below the fixed 3rem icon rail and sat visibly off-center. */}
        <Sidebar collapsible="icon" data-density="comfortable" className={chromePrintClass}>
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-1.5">
              {/* AppIcon is the canonical app-chrome brand mark: theme-correct via BrandLogo tokens.
                morph="mark" pins it to the GLYPH ALONE. The default "auto" renders the full lockup —
                glyph + a wordmark taken from `title`, which defaults to the literal string "Brand" —
                and this app already renders its own product name in the block to the right, so the
                lockup printed a stray "Brand" next to "AI Workbench". Mark-only also keeps the
                collapsed state correct without the morph: the text block beside it is already hidden
                by group-data-[collapsible=icon]:hidden. aria-hidden because that text names the app.
                `title` still defaults to "Brand" and lands in the SVG <title> (the accessible name),
                so it is set to the product name too — invisible either way, but nothing should read
                "Brand" if the aria-hidden is ever lifted. */}
              <AppIcon
                morph="mark"
                title="AI Workbench"
                height={20}
                aria-hidden
                className="shrink-0"
              />
              {/* Ink comes from the SIDEBAR token family, not the page's. `Text` has no sidebar
                tone (its `tone` is default | primary | muted, all page-ink), and in the light theme
                the rail is a DARK navy (`--sidebar` 0.3) while `--foreground` is a near-identical
                dark grey — so the default page ink rendered this wordmark invisible against its own
                background. `--sidebar-foreground` / `--sidebar-muted-foreground` are the tokens the
                surface actually defines, and every `SidebarMenuButton` below already uses them. */}
              <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
                <Text className="truncate font-semibold leading-tight text-sidebar-foreground">
                  AI Workbench
                </Text>
                <Text
                  variant="meta"
                  className="truncate leading-tight text-sidebar-muted-foreground"
                >
                  elabs - systems
                </Text>
              </div>
            </div>
          </SidebarHeader>
          {/* The primary navigation landmark (D-IC4 / finding 3). Wrapping `SidebarContent` (not the
            whole `Sidebar`, which is the `SidebarInset` layout `peer`) names the app's actual
            navigation `<nav aria-label="Sections">` — the in-repo precedent is
            `SettingsView.tsx` `<nav aria-label="Settings sections">`. `flex min-h-0 flex-1 flex-col`
            passes the bounded height down so `SidebarContent`'s own `flex-1 overflow-auto` scroll is
            preserved. */}
          {/* `display:contents` — the nav is a navigation LANDMARK (kept in the a11y tree) but has no
              layout box, so `SidebarContent` stays the sidebar column's direct flex child and keeps
              its native `flex-1 min-h-0 overflow-auto` scroll. Wrapping it in a laid-out flex box
              instead broke that scroll: once the Setup group grew to 3 items the nav overflowed past
              the viewport and the sticky footer drew over the last items at ~900px tall (T8 + T5). */}
          <nav aria-label="Sections" className="contents">
            {/* Explicit `min-h-0 overflow-y-auto`: as the flex-1 child of the sidebar column,
                SidebarContent must clip+scroll its own overflow so the sticky SidebarFooter never
                draws over the last nav items on a short (~900px) viewport once the section list is
                tall (Setup grew to 3 items in T8). The shadcn default didn't resolve to a scroll here. */}
            <SidebarContent className="min-h-0 overflow-y-auto">
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {NAV_ITEMS.map((item) => (
                      <NavMenuItem
                        key={item.path}
                        item={item}
                        active={isPathActive(pathname, item.path)}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              {/* Settings › Features — the whole Assistant nav group disappears while the feature is
                  switched off (the routes still exist and explain themselves; see FeatureDisabledView). */}
              {assistantEnabled ? (
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {ASSISTANT_NAV_ITEMS.map((item) => {
                      const isAssistant = item.path === "/assistant";
                      const node = (
                        <NavMenuItem
                          item={item}
                          active={isNavItemActive(pathname, item)}
                          pathname={pathname}
                          // Only the Assistant item grows a hover "＋ New session" action (expanded rail).
                          action={
                            isAssistant
                              ? { label: "New session", to: "/assistant?new=1", icon: Plus }
                              : undefined
                          }
                        />
                      );
                      if (!isAssistant) return <Fragment key={item.path}>{node}</Fragment>;
                      return (
                        <Fragment key={item.path}>
                          {node}
                          {/* Collapsed-icon rail only: the Sessions CHILD lives in a `SidebarMenuSub`
                          that brand-ui hides when collapsed — so it would vanish from the rail
                          entirely (item 7). Mirror the "New session" pattern below: a dedicated
                          collapsed-only Sessions icon item keeps it reachable, with its active state. */}
                          {item.children?.map((child) => {
                            const ChildIcon = child.icon;
                            return (
                              <SidebarMenuItem
                                key={child.path}
                                className="hidden group-data-[collapsible=icon]:block"
                              >
                                <SidebarMenuButton
                                  asChild
                                  isActive={isPathActive(pathname, child.path)}
                                  tooltip={child.label}
                                  className={ACTIVE_NAV_INDICATOR_CLASS}
                                >
                                  <NavLink to={child.path}>
                                    <ChildIcon aria-hidden />
                                    <span>{child.label}</span>
                                  </NavLink>
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })}
                          {/* Collapsed-icon rail only: the hover action above is hidden when collapsed, so
                          a dedicated "New session" icon item sits directly under Assistant there. */}
                          <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
                            <SidebarMenuButton asChild tooltip="New session">
                              <Link to="/assistant?new=1">
                                <Plus aria-hidden />
                                <span>New session</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        </Fragment>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              ) : null}
              <SidebarGroup>
                {/* item 7: brand-ui's collapsed label is `opacity-0 -mt-8` — invisible but still
                    boxed, leaving a run of unexplained gaps in the icon rail. `hidden` takes it out
                    of flow entirely (display:none) so the collapsed rail has NO phantom height. */}
                <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">MCP</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {MCP_NAV_ITEMS.map((item) => (
                      <NavMenuItem
                        key={item.path}
                        item={item}
                        active={isPathActive(pathname, item.path)}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">Skills</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SKILL_NAV_ITEMS.map((item) => (
                      <NavMenuItem
                        key={item.path}
                        item={item}
                        active={isPathActive(pathname, item.path)}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">Testing</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {TESTING_NAV_ITEMS.map((item) => (
                      <NavMenuItem
                        key={item.path}
                        item={item}
                        active={isPathActive(pathname, item.path)}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">Setup</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SETUP_NAV_ITEMS.map((item) => (
                      <NavMenuItem
                        key={item.path}
                        item={item}
                        active={isPathActive(pathname, item.path)}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </nav>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={isPathActive(pathname, "/settings")}
                  tooltip="Settings"
                  className={ACTIVE_NAV_INDICATOR_CLASS}
                >
                  <NavLink to="/settings">
                    <Settings aria-hidden />
                    <span>Settings</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            {/* Sidebar ink, not page ink — see the SidebarHeader note above. */}
            <Text
              variant="meta"
              className="px-2 text-sidebar-muted-foreground group-data-[collapsible=icon]:hidden"
            >
              Local / dev mode
            </Text>
          </SidebarFooter>
        </Sidebar>

        {/* `min-w-0`: the inset is a flex item; without it a wide catalog table's nowrap min-content
          blows the scroll box past the viewport (clipping right-pinned columns) instead of scrolling
          internally. This one class fixes every wide PageShell table (WP 2.4 finding). */}
        {/* `SidebarInset` is the app's single `<main>` landmark (finding 3 fix): it renders a
          `<main>` internally (the inner `app-shell-main` regions are now `<div>`s, so exactly one
          `<main>` exists in the DOM). `id="main-content"` is the skip-link target; `tabIndex={-1}`
          makes it programmatically focusable so activating the skip link actually moves focus here
          (bypassing the sidebar) without adding a tab stop. */}
        <SidebarInset id="main-content" tabIndex={-1} className="app-shell-inset min-w-0">
          {!dockAsSheet && dockAvailable && dockContent != null ? (
            // Wide viewport: the dock is a FULL-HEIGHT right column — the mirror image of the left
            // navigation sidebar (same `bg-sidebar` surface, same full-height shape, and the SAME
            // open/close mechanic: the column's `width` transitions between 0 and the chosen width,
            // so the app reflows exactly like it does when the left rail collapses/expands) — with
            // the one difference that it is RESIZABLE via the drag handle on its edge. The TopNav
            // renders INSIDE the main column so the bar never spans across the dock, exactly as it
            // never spans across the left sidebar. The aside stays mounted (at width 0) while the
            // feature is available so both transition directions actually animate.
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {topNav}
                {mainRegion}
              </div>
              {showDock ? (
                <DockResizeHandle
                  widthPx={dockWidthPx}
                  onResize={handleDockResize}
                  onResizingChange={setDockResizing}
                />
              ) : null}
              <aside
                aria-label="App assistant"
                aria-hidden={!showDock}
                style={{ width: showDock ? `${dockWidthPx}px` : 0 }}
                className={cn(
                  "flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
                  !dockResizing &&
                    "transition-[width] duration-200 ease-linear motion-reduce:transition-none",
                )}
              >
                {/* Fixed-width inner column (like the Sheet/Sidebar pattern): the content keeps its
                  final width while the outer column's width animates, so it slides out of/into the
                  clipped edge instead of squishing mid-transition. */}
                <div
                  style={{ width: `${dockWidthPx}px` }}
                  className="flex h-full min-h-0 min-w-0 flex-col border-l border-border"
                >
                  {dockRendered ? dockContent : null}
                </div>
              </aside>
            </div>
          ) : (
            <>
              {topNav}
              {mainRegion}
            </>
          )}

          {/* Narrow viewports (< 1100px): the dock reuses the SAME right-`Sheet` pattern the left rail
            uses on mobile (above) instead of a permanent split, which would starve the content column
            (item 8b). Its own breakpoint is `dockAsSheet` (~1100px), not brand-ui's 768px. */}
          {dockAsSheet ? (
            <Sheet
              open={dockAvailable && dockOpen}
              onOpenChange={(open) => onDockOpenChange?.(open)}
            >
              <SheetContent side="right" className="flex w-full max-w-sm flex-col p-0">
                <SheetHeader className="shrink-0 border-b border-border p-3 text-left">
                  <SheetTitle>App assistant</SheetTitle>
                  <SheetDescription className="sr-only">
                    The embedded app assistant.
                  </SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {dockAvailable ? dockContent : null}
                </div>
              </SheetContent>
            </Sheet>
          ) : null}
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbSlotProvider>
  );
}

/**
 * The dock's edge resize handle. Deliberately NOT `@elabs-ai/components-ui`'s `ResizableHandle`: that component
 * only works inside a `ResizablePanelGroup`, whose flex-basis sizing cannot TRANSITION — and the
 * whole point of the dock's layout is that its width animates open/closed exactly like the left
 * navigation sidebar. A thin separator with pointer-drag + arrow-key resizing (the dock sits on the
 * right, so ArrowLeft widens it) replaces the panel-group handle; visuals mirror `ResizableHandle`
 * (a 1px `bg-border` line with a wider invisible hit area and a visible focus ring).
 */
function DockResizeHandle({
  widthPx,
  onResize,
  onResizingChange,
}: {
  widthPx: number;
  onResize: (widthPx: number) => void;
  onResizingChange: (resizing: boolean) => void;
}) {
  const clamp = (value: number): number =>
    Math.min(
      Math.max(value, DOCK_MIN_WIDTH_PX),
      Math.max(
        DOCK_MIN_WIDTH_PX,
        Math.min(DOCK_MAX_WIDTH_PX, window.innerWidth - DOCK_MIN_MAIN_PX),
      ),
    );
  return (
    // brand-ui-allow: ResizableHandle requires a ResizablePanelGroup, which cannot width-transition —
    // this separator exists purely so the dock can animate like the left Sidebar AND stay resizable.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the App assistant dock"
      aria-valuenow={Math.round(widthPx)}
      aria-valuemin={DOCK_MIN_WIDTH_PX}
      aria-valuemax={DOCK_MAX_WIDTH_PX}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onResizingChange(true);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onResize(clamp(window.innerWidth - event.clientX));
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onResizingChange(false);
      }}
      onPointerCancel={() => onResizingChange(false)}
      onKeyDown={(event) => {
        // The dock is the RIGHT column: moving the divider left = widening the dock.
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onResize(clamp(widthPx + 16));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onResize(clamp(widthPx - 16));
        }
      }}
      className={cn(
        // ZERO width: the visible line is the dock's own `border-l` (one gentle 1px line, exactly
        // like the left sidebar's border) — this element only contributes the invisible hit area
        // straddling it, plus hover/focus feedback. A visible width here doubled the border.
        "relative z-10 w-0 shrink-0 cursor-col-resize outline-none",
        "after:absolute after:inset-y-0 after:-left-1.5 after:w-3 after:cursor-col-resize",
        "hover:after:bg-ring/30 focus-visible:after:bg-ring/40",
      )}
    />
  );
}

/** One breadcrumb crumb + its trailing separator (non-leaf crumbs link; the leaf is the page). */
function BreadcrumbItemFragment({ crumb, isLast }: { crumb: Crumb; isLast: boolean }) {
  return (
    <>
      <BreadcrumbItem>
        {isLast || !crumb.to ? (
          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
        ) : (
          <BreadcrumbLink asChild>
            <Link to={crumb.to}>{crumb.label}</Link>
          </BreadcrumbLink>
        )}
      </BreadcrumbItem>
      {isLast ? null : <BreadcrumbSeparator />}
    </>
  );
}

/** Glyph per theme preference — the trigger shows the active one; the menu labels each choice. */
const THEME_PREFERENCE_ICON: Record<ThemePreference, typeof Sun> = {
  system: Monitor,
  "light": Sun,
  "dark": Moon,
};

/** Human label for a preference — "System" plus the two reference-theme labels from `@elabs-ai/components-tokens`. */
function themePreferenceLabel(preference: ThemePreference): string {
  return preference === "system" ? "System" : (BUILT_IN_THEME_META[preference]?.label ?? preference);
}

/**
 * The top-bar theme control (F0/ST2). A compact icon-trigger dropdown over the app's three theme
 * PREFERENCES — System (first) · Light · Dark — reachable in two clicks from any route.
 * It's a thin view over `useThemePreference` (lifted to App), NOT the uncontrolled `@elabs-ai/components-ui`
 * ThemeSwitcher: the app's single source of truth is the preference key that `main.tsx` re-applies
 * on boot, so driving the switch through that keeps the Settings mirror in sync, persists across
 * reload, and keeps the offered set to what the app actually ships.
 */
function ThemeMenu({
  preference,
  onPreferenceChange,
}: {
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
}) {
  const CurrentIcon = THEME_PREFERENCE_ICON[preference];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Icon-only trigger (owner tweak 2026-07-11): the glyph carries the meaning; the name
            lives in the `IconButton` `label` (D-TB5 — one tooltip mechanism, tooltip === aria-label)
            and on the dropdown's items. */}
        <IconButton variant="ghost" label={`Theme: ${themePreferenceLabel(preference)}`}>
          <CurrentIcon aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {THEME_PREFERENCE_ORDER.map((choice) => {
          const Icon = THEME_PREFERENCE_ICON[choice];
          const active = choice === preference;
          return (
            <DropdownMenuItem key={choice} onSelect={() => onPreferenceChange(choice)}>
              <Icon aria-hidden />
              <span>{themePreferenceLabel(choice)}</span>
              {active ? <Check className="ms-auto size-4" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An optional hover-revealed row action on a nav item (only the Assistant item uses it — a "＋ New
 *  session" affordance). `SidebarMenuAction showOnHover` naturally hides in the collapsed icon rail,
 *  so a dedicated collapsed-only item covers that mode (see the Assistant group render). */
type NavItemAction = { label: string; to: string; icon: typeof LayoutDashboard };

/**
 * `pathname` is optional/additive — only the Assistant item (D-HUX15) passes it, to compute its
 * Sessions child's own active state; every other nav group's items have no `children` and never
 * render the `SidebarMenuSub` block below, so they're unaffected.
 */
function NavMenuItem({
  item,
  active,
  pathname,
  action,
}: {
  item: NavItem;
  active: boolean;
  pathname?: string;
  action?: NavItemAction;
}) {
  const Icon = item.icon;
  const ActionIcon = action?.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={item.label}
        className={ACTIVE_NAV_INDICATOR_CLASS}
      >
        <NavLink to={item.path}>
          <Icon aria-hidden />
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
      {action && ActionIcon ? (
        // Not a `Button`, so `IconButton` can't wrap it — `SidebarMenuAction` is the sidebar's own
        // hover-revealed row-action primitive. Same D-TB5 mechanism applied directly: one Radix
        // Tooltip, its text equal to the `aria-label`, no native `title`.
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarMenuAction asChild showOnHover aria-label={action.label}>
              <Link to={action.to}>
                <ActionIcon aria-hidden />
              </Link>
            </SidebarMenuAction>
          </TooltipTrigger>
          <TooltipContent>{action.label}</TooltipContent>
        </Tooltip>
      ) : null}
      {item.children && item.children.length > 0 && pathname !== undefined ? (
        <SidebarMenuSub>
          {item.children.map((child) => {
            const ChildIcon = child.icon;
            return (
              <SidebarMenuSubItem key={child.path}>
                <SidebarMenuSubButton
                  asChild
                  isActive={isPathActive(pathname, child.path)}
                  className={ACTIVE_NAV_INDICATOR_CLASS}
                >
                  <NavLink to={child.path}>
                    <ChildIcon aria-hidden />
                    <span>{child.label}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}
