import type { OverviewRange } from "./overview-contract";

/**
 * Overview tab — URL-persisted window control (dashboard-bento WP 1.4). Pure and React-free
 * (mirroring `features/dashboard/testing/dashboard-url-state.ts`), so parse/serialize/window-math is
 * unit-testable without mounting anything. `OverviewTab` is the only consumer; it owns the
 * `useSearchParams()` call and reads/writes through these helpers with `{ replace: true }`.
 *
 * ── WHAT LIVES IN THE URL, AND WHAT DELIBERATELY DOES NOT ─────────────────────────────────────────
 * Only the PRESET (`?oRange=24h|30d`) is persisted — never the resolved `from`/`to` instants. A
 * preset means "the trailing 24 hours / 7 days / 30 days **as of when you open it**"; freezing the
 * instants into the link would turn a shared "/dashboard?oRange=24h" into a window that silently
 * ages, showing yesterday's 24 hours to whoever opens it tomorrow. (The Testing tab makes the
 * opposite choice on purpose — it offers a custom calendar range, so its window has to be pinned to
 * stay shareable. The Overview offers three trailing presets and nothing else.)
 *
 * The key is namespaced `oRange` so it coexists with the Dashboard host's own `?tab=`
 * (`DashboardView.tsx`) and with the Testing tab's `t*` keys, exactly as that module's own comment
 * requires. The DEFAULT preset is kept OUT of the URL, so `/dashboard` stays the clean canonical
 * link the sidebar points at.
 */

export type OverviewPreset = OverviewRange["preset"];

/** The three windows the control offers, in the order they are rendered. */
export const OVERVIEW_PRESETS: readonly OverviewPreset[] = ["24h", "7d", "30d"];

/** The window the tab lands on. Kept out of the URL (see the module doc). */
export const DEFAULT_OVERVIEW_PRESET: OverviewPreset = "7d";

/** The query-param key. Namespaced so it can never collide with `?tab=` or the Testing tab's `t*`. */
export const OVERVIEW_RANGE_KEY = "oRange";

/** Segment labels — short, because they sit in a three-way segmented control on a toolbar row. */
export const OVERVIEW_PRESET_LABELS: Record<OverviewPreset, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
};

/**
 * The window spelled out. Used for the toolbar's context line and for empty-state copy, so a reader
 * never has to decode "30d" to know what they are looking at. A non-breaking space keeps the number
 * and its unit on one line (interaction-guidelines micro-typography).
 */
export const OVERVIEW_PRESET_DESCRIPTIONS: Record<OverviewPreset, string> = {
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** How far back each preset reaches from "now". */
const PRESET_SPAN_MS: Record<OverviewPreset, number> = {
  "24h": 24 * MS_PER_HOUR,
  "7d": 7 * MS_PER_DAY,
  "30d": 30 * MS_PER_DAY,
};

export function isOverviewPreset(value: string | null | undefined): value is OverviewPreset {
  return value != null && (OVERVIEW_PRESETS as readonly string[]).includes(value);
}

/** Read the preset from the URL. An absent or unrecognised value falls back — it never throws. */
export function parseOverviewPreset(params: URLSearchParams): OverviewPreset {
  const raw = params.get(OVERVIEW_RANGE_KEY);
  return isOverviewPreset(raw) ? raw : DEFAULT_OVERVIEW_PRESET;
}

/**
 * Write `preset` onto a COPY of `params` (the input is never mutated), deleting the key when the
 * preset is the default so `/dashboard` stays clean. Every unrelated param — `?tab=`, the Testing
 * tab's `t*` keys, an issue deep-link — is carried through untouched.
 */
export function writeOverviewPreset(
  params: URLSearchParams,
  preset: OverviewPreset,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (preset === DEFAULT_OVERVIEW_PRESET) next.delete(OVERVIEW_RANGE_KEY);
  else next.set(OVERVIEW_RANGE_KEY, preset);
  return next;
}

/**
 * Resolve a preset into the contract's {@link OverviewRange}: the trailing window ending at `now`.
 *
 * `now` is injectable so tests pin it; production passes the real clock. The result carries the
 * preset itself, because the contract's consumers (`resolveOverviewBucket`, the run-health previous
 * window) branch on it rather than re-deriving the span from the instants.
 */
export function resolveOverviewRange(
  preset: OverviewPreset,
  now: Date = new Date(),
): OverviewRange {
  const to = now.getTime();
  return {
    from: new Date(to - PRESET_SPAN_MS[preset]).toISOString(),
    to: new Date(to).toISOString(),
    preset,
  };
}
