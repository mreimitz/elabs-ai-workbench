/**
 * hub-ux.ts — Shared design tokens & constants for Assistant Hub UX
 *
 * Single source of truth for values referenced across WP0.4+ implementations.
 * All values derived from locked decisions D-HUX3, D-HUX8, D-HUX12, D-HUX13.
 * No magic numbers scattered in component code.
 */

/**
 * D-HUX3: Meta-rail layout dimensions
 * The workspace's side surfaces collapse into one meta rail (360 px, shrink-0, own scroll).
 * Sheet fallback under ~1100 px content width.
 */
export const META_RAIL_WIDTH_PX = 360;
export const META_RAIL_SHEET_BREAKPOINT_PX = 1100;
/** Tailwind shrink intent: prevent the rail from shrinking below its fixed width */
export const META_RAIL_SHRINK_INTENT = "shrink-0";

/**
 * The chat reading column — the shared max-width the transcript content AND the docked composer both
 * center within, so a turn's edges line up with the composer's (one reading column, Claude/ChatGPT
 * style, instead of a full-bleed transcript floating over a narrower centered composer). `max-w-3xl`
 * (768px) reads at a comfortable chat line length. Both consumers pair it with a 16px horizontal
 * gutter (`px-4`) so their inner content shares the same left/right edge. Kept here as the single
 * source of truth so the two surfaces can never drift out of alignment.
 */
export const CHAT_READING_COLUMN_CLASS = "mx-auto w-full max-w-3xl";

/**
 * D-HUX8: Crew colors map to --chart-1…5 tokens (theme-aware)
 * Color appears ONLY as small accents: avatar ring, 3 px card top border, dot next to names,
 * org-chart group tint — never fills, never text color, always paired with crew name.
 *
 * Each chart token is mapped to its Tailwind class prefix for accent uses.
 * Consumers use these to compose accent classes dynamically (e.g., ring-{color}, border-{color}).
 */
export type ChartColorKey = "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5";

/** Chart token to Tailwind class base mapping for accent uses. */
export const CREW_COLORS: Record<ChartColorKey, string> = {
  "chart-1": "chart-1",
  "chart-2": "chart-2",
  "chart-3": "chart-3",
  "chart-4": "chart-4",
  "chart-5": "chart-5",
};

/** All valid crew color keys for iteration/validation. */
export const CREW_COLOR_KEYS: ChartColorKey[] = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];

/**
 * Helper to resolve a crew color to its accent-only classes.
 * Usage: const { ring, borderTop, dot } = crewAccentClasses(crew.color);
 *
 * @param colorKey The crew's color token (e.g., "chart-1")
 * @returns An object with composed Tailwind class strings for ring, border, and dot accents.
 */
export function crewAccentClasses(colorKey?: ChartColorKey | null): {
  ring: string;
  borderTop: string;
  dot: string;
} {
  if (!colorKey || !CREW_COLORS[colorKey]) {
    return {
      ring: "ring-border",
      borderTop: "border-t-border",
      dot: "bg-muted-foreground",
    };
  }
  // Accent classes use the chart-N token directly.
  // Example: "chart-1" → "ring-[var(--chart-1)]", "border-t-[var(--chart-1)]"
  // (Tailwind's arbitrary value support; @elabs-ai/components-tokens provides the CSS variable)
  const chartVar = `var(--${colorKey})`;
  return {
    ring: `ring-[${chartVar}]`,
    borderTop: `border-t-[${chartVar}]`,
    dot: `bg-[${chartVar}]`,
  };
}

/**
 * D-HUX12: Canvas grid decoration
 * Dot-grid canvas: 1 px radial-gradient dots on ~12 px cells using the --canvas-grid token,
 * mask-faded to transparent at the TOP (owner feedback 2026-07-26 — flipped), non-scrolling layer,
 * gated by DecorationProvider.
 *
 * Consumers compose the full CSS pattern using these dimensions and the --canvas-grid token.
 * Pattern: `radial-gradient(circle, var(--canvas-grid) 1px, transparent 1px)`
 *   sized to `12px 12px` cells (denser than the original 14 px — owner "more dots").
 * Mask: transparent at the top, ramping to fully opaque by ~45% and solid to the bottom.
 * Opacity: the whole layer is dialed to {@link CANVAS_GRID_OPACITY} ("a little less visible").
 */
export const CANVAS_GRID_CELL_SIZE_PX = 12;
export const CANVAS_GRID_DOT_SIZE_PX = 1;

/**
 * owner-feedback (2026-07-26) — the whole dot-grid layer is dialed a little quieter: denser dots
 * ({@link CANVAS_GRID_CELL_SIZE_PX}) but each less prominent, via a layer-level opacity `ChatCanvas`
 * applies ON TOP of the theme-aware `--canvas-grid` token and the fade mask. A plain multiplier, so it
 * reads identically in both themes (the token already carries each theme's dot color/alpha).
 */
export const CANVAS_GRID_OPACITY = 0.6;

/**
 * Canvas grid background pattern using CSS radial-gradient.
 * The pattern is rendered on the --canvas-grid token (a theme-aware dot color).
 * Usage: Apply to a non-scrolling layer behind the transcript content.
 */
export const canvasGridBackgroundStyle = (): React.CSSProperties => ({
  backgroundImage: `radial-gradient(circle, var(--canvas-grid) ${CANVAS_GRID_DOT_SIZE_PX}px, transparent ${CANVAS_GRID_DOT_SIZE_PX}px)`,
  backgroundSize: `${CANVAS_GRID_CELL_SIZE_PX}px ${CANVAS_GRID_CELL_SIZE_PX}px`,
  backgroundPosition: "0 0",
});

/**
 * D-HUX13: First-prompt choreography animation
 * Fresh session: composer centered → on first send, animate to docked position (~240–280 ms,
 * duration-base/ease-standard, transform-based). Sessions with history start docked.
 * motion-reduce renders the docked state instantly.
 */

/** Duration for the first-prompt choreography animation in milliseconds. */
export const CHOREOGRAPHY_DURATION_MS = 240;
/** Tailwind duration class name for the choreography (base speed). */
export const CHOREOGRAPHY_DURATION_CLASS = "duration-200"; // ~240ms in typical configs

/** Easing function for the choreography animation (transform-based). */
export const CHOREOGRAPHY_EASING = "cubic-bezier(0.4, 0, 0.2, 1)"; // standard easing
/** Tailwind easing class name alternative (if a predefined class is preferred). */
export const CHOREOGRAPHY_EASING_CLASS = "ease-out";

/** CSS transition property for the choreography (typically transform). */
export const CHOREOGRAPHY_TRANSITION_PROPERTY = "transform";

/**
 * Composed Tailwind class string for choreography with motion-reduce support.
 * Usage: className={choreographyTransitionClass()}
 * Provides: transition on transform, duration, easing, and disables animation if motion-reduce is set.
 */
export function choreographyTransitionClass(): string {
  return `transition-transform ${CHOREOGRAPHY_DURATION_CLASS} ${CHOREOGRAPHY_EASING_CLASS} motion-reduce:transition-none`;
}

/**
 * Choreography center→dock animation distance (translateY offset).
 * The composer moves from the center of the viewport to the docked position (bottom).
 * This value is the Y offset to apply via transform: translateY(X).
 * Typically a positive value moving the element down into the dock.
 */
export const CHOREOGRAPHY_CENTER_TO_DOCK_OFFSET_PX = 120;

/**
 * D-HUX12 (WP1.3): the transcript's dot-grid mask. owner-feedback (2026-07-26) — FLIPPED: the grid now
 * fades to transparent toward the TOP of the canvas and stays solid toward the BOTTOM (it used to be
 * the reverse — opaque at top, faded before the composer). Transparent at the very top, ramping to
 * fully opaque by ~45% and solid to the bottom. Kept alongside {@link canvasGridBackgroundStyle} rather
 * than folded into it: `canvasGridBackgroundStyle`'s exact return shape
 * (`backgroundImage`/`backgroundSize`/`backgroundPosition` only) is pinned by `hub-ux.test.ts`, and
 * other consumers of the plain grid pattern shouldn't inherit a mask they didn't ask for. `ChatCanvas`
 * spreads both onto the same layer (plus {@link CANVAS_GRID_OPACITY}).
 */
export const canvasGridMaskStyle = (): React.CSSProperties => {
  const mask = "linear-gradient(to bottom, transparent, black 45%, black)";
  return { maskImage: mask, WebkitMaskImage: mask };
};

/**
 * WP4.2 (WP1.R-C) — floating docked-composer bottom clearance.
 *
 * The docked `Composer` floats OVER the transcript: `EmptySessionIntro` pins its composer wrap at
 * `bottom-6` (= {@link COMPOSER_DOCK_BOTTOM_INSET_PX}) above the transcript's bottom edge, so the
 * transcript must reserve matching bottom space or a tall composer (multi-line input, attachment
 * chips, the running Stop button) covers the last message. WP1.8 reserved a FIXED `h-40` (160 px),
 * which under-reserves for a tall composer — the deferred WP1.R-C defect. The fix measures the
 * composer's real height (a `ResizeObserver` in `EmptySessionIntro`) and reserves that height plus
 * this extra: the composer's own `bottom-6` gap to the transcript floor
 * ({@link COMPOSER_DOCK_BOTTOM_INSET_PX}) plus a small breathing gap
 * ({@link COMPOSER_CLEARANCE_BREATHING_PX}) so the last line clears the composer's top edge. Until
 * the composer is measured (first paint, or no `ResizeObserver` — e.g. jsdom) the transcript falls
 * back to `ConversationPane`'s fixed `h-40` reserve.
 */
export const COMPOSER_DOCK_BOTTOM_INSET_PX = 24; // matches EmptySessionIntro's `bottom-6`
export const COMPOSER_CLEARANCE_BREATHING_PX = 16;
export const COMPOSER_CLEARANCE_EXTRA_PX =
  COMPOSER_DOCK_BOTTOM_INSET_PX + COMPOSER_CLEARANCE_BREATHING_PX;

/**
 * The transcript's bottom clearance (px) for a MEASURED composer height — the reserved-space value
 * `ConversationPane`'s `composerInset` spacer takes when a real measurement is available. Rounds
 * the measured border-box height and adds {@link COMPOSER_CLEARANCE_EXTRA_PX}; never negative, and
 * a non-finite/negative input clamps to just the extra so the last message always clears.
 */
export function composerClearancePx(composerHeightPx: number): number {
  const measured = Number.isFinite(composerHeightPx)
    ? Math.max(0, Math.round(composerHeightPx))
    : 0;
  return measured + COMPOSER_CLEARANCE_EXTRA_PX;
}

/**
 * Transcript fade scrims — the transcript dissolves into the page ground at its top and bottom edges
 * (the same immersive-chat treatment the run console gets from `@elabs-ai/components-ai`'s `ChatShell variant="bare"`)
 * instead of hitting a hard edge or sliding visibly BEHIND the floating docked composer. Two inert
 * (`pointer-events-none`, `aria-hidden`) `from-background to-transparent` overlays sit above the
 * scrolling content: a fixed-height top scrim, and a bottom scrim sized to the SAME band the floating
 * composer occupies so content fades to nothing before it reaches the composer's card.
 */
export const TRANSCRIPT_TOP_SCRIM_PX = 32; // matches ChatShell bare's top `h-8`
/** The bottom scrim's fallback height when the composer hasn't been measured yet — the `h-40` reserve
 *  `ConversationPane`'s `composerInset={true}` uses. */
export const TRANSCRIPT_BOTTOM_SCRIM_FALLBACK_PX = 160;
/** A gentle bottom fade even when no composer floats over the transcript (`composerInset={false}`) —
 *  mirrors ChatShell bare's bottom `h-12`. */
export const TRANSCRIPT_BOTTOM_SCRIM_MIN_PX = 48;

/**
 * The bottom fade-scrim height (px) for a given `composerInset` (`ConversationPane`'s prop): a measured
 * clearance (px) covers exactly the floating composer's band, so content fades out just above it; the
 * `true` fallback matches the `h-40` reserve; `false` (no floating composer) still gets a small default
 * fade. Never below {@link TRANSCRIPT_BOTTOM_SCRIM_MIN_PX}.
 */
export function transcriptBottomScrimPx(composerInset: boolean | number): number {
  if (typeof composerInset === "number") {
    return Math.max(TRANSCRIPT_BOTTOM_SCRIM_MIN_PX, Math.round(composerInset));
  }
  return composerInset ? TRANSCRIPT_BOTTOM_SCRIM_FALLBACK_PX : TRANSCRIPT_BOTTOM_SCRIM_MIN_PX;
}

/**
 * D-HUX13 (WP1.3): decide whether the fresh-session intro should mount DOCKED (a session with real
 * history — composer pinned at the bottom, no welcome emblem) or CENTERED (the welcome emblem +
 * greeting + starter chips).
 *
 * The INITIAL seed is driven by the session's own settled `turns` count — a value that is
 * synchronous with a session switch — NOT by the live stream's timeline. The stream (`useHubStream`)
 * resets a render behind the switch, so seeding off it let a just-opened EMPTY session inherit the
 * previous session's "docked" state and silently hide the welcome ring (the reported "only shows
 * sometimes"). `turns > 0` ⇒ real history ⇒ docked instantly, no ring flash. A fresh session
 * (`turns` 0/absent) stays centered until the live stream reports the first turn — `turnRunning` /
 * a non-empty `timelineLength` — which is what carries the one-time centered→docked glide.
 */
export function resolveIntroDockState(input: {
  turns?: number | null;
  turnRunning: boolean;
  timelineLength: number;
}): "docked" | "centered" {
  const hasHistory = (input.turns ?? 0) > 0;
  return hasHistory || input.turnRunning || input.timelineLength > 0 ? "docked" : "centered";
}

/**
 * D-HUX12 (WP1.3): `ChatCanvas`'s own default decoration ambient for the dot-grid layer, applied
 * via a LOCAL `DecorationProvider` (`@elabs-ai/components-tokens`'s scoped `data-decoration` override — see its
 * own doc: "give a diagram, panel, page, or modal a uniform […] level without changing the document
 * theme"). Both reference themes carry a document-level decoration of 0, so the chat canvas
 * establishes its own "normal" level locally rather than inheriting the (currently always-0)
 * document ambient; a caller passes `decorationLevel={0}` ("minimal") to drop the grid entirely,
 * matching D-HUX12's "off at minimal." 10 is the top of the 0–10 dial — the library's own ink-alpha
 * formulas are calibrated assuming 10 reads as a tasteful maximum, not a literal full-strength value.
 *
 * Still correct after v4 narrowed the dial's scope to backgrounds and chart fills only (buttons,
 * inputs, badges, menu items and timeline dots now render identically at 0 and 10): this layer IS a
 * background, and it supplies its own `--canvas-grid`-driven paint, so the narrowing is a no-op here.
 */
export const CHAT_CANVAS_DECORATION_LEVEL = 10;
