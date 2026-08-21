// ── Skill Studio (RM-30 WP 7.1) — the workbench's layout constants ─────────────────────────────────
// The Studio's acceptance bar is a MEASUREMENT ("the centre surface is ≥60% of the viewport width at
// 1600×1000 with both rails open, more when collapsed"), so the widths are declared here as numbers
// a test can do arithmetic on rather than being buried in class strings — and the Tailwind class is
// kept beside each one so the two can never drift.
//
// The px figures are derived from the `rem` the Tailwind class actually names, through the design
// system's root font size — NOT the browser's 16px default. That distinction is load-bearing: at a
// 16px root a `w-60` rail is 240px, but this app paints it at 197px, and an arithmetic check written
// against 240 would have "passed" while describing a layout that does not exist.

/**
 * The design system's root font size in px, MEASURED against the running app
 * (`getBoundingClientRect` on the rails at 1600×1000: a `w-60` / 15rem rail rendered 197px, a `w-64`
 * / 16rem panel 210px, a `w-10` / 2.5rem strip 33px — all exactly 15/16/2.5 × 13.125).
 *
 * If the tokens ever re-base the root size, this constant and the assertions over it go stale
 * together, which is the point: the numbers below are then wrong in a way a test can catch.
 */
export const STUDIO_ROOT_FONT_PX = 13.125;

const remToPx = (rem: number): number => rem * STUDIO_ROOT_FONT_PX;

/** The left rail (Files · Tools · Settings) when expanded — 14rem. */
export const STUDIO_LEFT_RAIL_CLASS = "w-56";
export const STUDIO_LEFT_RAIL_WIDTH_PX = remToPx(14);

/** The right context panel when expanded — 14rem. It is COLLAPSED by default (never a reserved
 *  blank column), so this width only applies once an author opens it. */
export const STUDIO_CONTEXT_PANEL_CLASS = "w-56";
export const STUDIO_CONTEXT_PANEL_WIDTH_PX = remToPx(14);

/** A collapsed rail: a slim vertical strip carrying just the re-open control — 2.5rem. */
export const STUDIO_COLLAPSED_RAIL_CLASS = "w-10";
export const STUDIO_COLLAPSED_RAIL_WIDTH_PX = remToPx(2.5);

/**
 * The app's global navigation sidebar, MEASURED at 1600×1000 (the centre surface started at x=453
 * with a 197px left rail beside it). The Studio does not own it — it belongs to `AppShell` and the
 * operator can collapse it from the top bar — but it eats into the width the centre surface can
 * claim, so the arithmetic below subtracts it rather than pretending the route owns the viewport.
 */
export const APP_SIDEBAR_WIDTH_PX = 256;

export type StudioRailState = { leftCollapsed: boolean; contextCollapsed: boolean };

/**
 * The width the centre surface gets, in px, at a given viewport width — the same subtraction the
 * flex row performs (`flex-1 min-w-0` on the centre, fixed widths on the rails).
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

/** The centre surface's share of the whole VIEWPORT — the acceptance bar's own denominator. */
export function studioCentreShareOfViewport(
  viewportWidthPx: number,
  state: StudioRailState,
  options?: { appSidebarOpen?: boolean },
): number {
  return studioCentreWidthPx(viewportWidthPx, state, options) / Math.max(viewportWidthPx, 1);
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
