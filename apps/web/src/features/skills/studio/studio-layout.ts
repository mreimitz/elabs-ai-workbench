// ── Skill Studio (RM-30 WP 7.1) — the workbench's layout constants ─────────────────────────────────
// The Studio's acceptance bar is a MEASUREMENT ("the centre surface is ≥60% of the width with both
// rails open"), so the widths are declared here as numbers rather than buried in class strings, and
// `studioCentreShare()` is the arithmetic a test can run. The Tailwind classes below are the same
// numbers spelled as utilities — kept beside them so the two can't drift.

/** The left rail (Files · Tools · Settings) when expanded. */
export const STUDIO_LEFT_RAIL_WIDTH_PX = 240;
export const STUDIO_LEFT_RAIL_CLASS = "w-60";

/** The right context panel when expanded. It is COLLAPSED by default (never a reserved blank
 *  column), so this width only applies once an author opens it. */
export const STUDIO_CONTEXT_PANEL_WIDTH_PX = 256;
export const STUDIO_CONTEXT_PANEL_CLASS = "w-64";

/** A collapsed rail: a slim vertical strip carrying just the re-open control. */
export const STUDIO_COLLAPSED_RAIL_WIDTH_PX = 40;
export const STUDIO_COLLAPSED_RAIL_CLASS = "w-10";

/** The app's global navigation sidebar (`SidebarProvider`'s `--sidebar-width`, 16rem). The Studio
 *  does not own it, but it eats into the width the centre surface can claim — so the honest
 *  arithmetic below subtracts it rather than pretending the route owns the whole viewport. */
export const APP_SIDEBAR_WIDTH_PX = 256;

export type StudioRailState = { leftCollapsed: boolean; contextCollapsed: boolean };

/**
 * The width the centre surface gets, in px, at a given viewport width — the same subtraction the
 * flex row performs (`flex-1` on the centre, fixed widths on the rails).
 */
export function studioCentreWidthPx(
  viewportWidthPx: number,
  state: StudioRailState,
  options?: { appSidebarOpen?: boolean },
): number {
  const sidebar = options?.appSidebarOpen === false ? 0 : APP_SIDEBAR_WIDTH_PX;
  const left = state.leftCollapsed ? STUDIO_COLLAPSED_RAIL_WIDTH_PX : STUDIO_LEFT_RAIL_WIDTH_PX;
  const right = state.contextCollapsed
    ? STUDIO_COLLAPSED_RAIL_WIDTH_PX
    : STUDIO_CONTEXT_PANEL_WIDTH_PX;
  return Math.max(viewportWidthPx - sidebar - left - right, 0);
}

/** The centre surface's share of the width available to the ROUTE (viewport minus the app's global
 *  nav sidebar) — the denominator the Studio can actually influence. */
export function studioCentreShareOfPage(
  viewportWidthPx: number,
  state: StudioRailState,
  options?: { appSidebarOpen?: boolean },
): number {
  const sidebar = options?.appSidebarOpen === false ? 0 : APP_SIDEBAR_WIDTH_PX;
  const page = Math.max(viewportWidthPx - sidebar, 1);
  return studioCentreWidthPx(viewportWidthPx, state, options) / page;
}

/** The centre surface's share of the whole VIEWPORT. */
export function studioCentreShareOfViewport(
  viewportWidthPx: number,
  state: StudioRailState,
  options?: { appSidebarOpen?: boolean },
): number {
  return studioCentreWidthPx(viewportWidthPx, state, options) / Math.max(viewportWidthPx, 1);
}

// ── collapse-state persistence ───────────────────────────────────────────────────────────────────
// Mirrors the Design surface's own per-panel flags (`mcpfp.skill-ide.design.panel-collapsed:*`):
// view state only, so a blocked/absent `localStorage` degrades to the default rather than throwing.

const STUDIO_RAIL_STORE_PREFIX = "mcpfp.skill-studio.rail-collapsed:";

/** Read one rail's persisted collapsed flag. `fallback` is what an unset/blocked store means. */
export function readStudioRailCollapsed(railKey: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(`${STUDIO_RAIL_STORE_PREFIX}${railKey}`);
    if (raw === null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

/** Persist one rail's collapsed flag (failures ignored — this is view state). */
export function writeStudioRailCollapsed(railKey: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(`${STUDIO_RAIL_STORE_PREFIX}${railKey}`, collapsed ? "1" : "0");
  } catch {
    /* private mode / quota — the session state still works, it just won't persist */
  }
}
