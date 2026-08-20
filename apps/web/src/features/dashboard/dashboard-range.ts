/**
 * dashboard-range — the Dashboard's ONE time range, shared by Overview, Testing and Issues
 * (dashboard-bento WP 2.2, Defect 2).
 * =============================================================================================
 * Owner feedback 2026-08-20: *"If we introduce a new toolbar with filter on timeline this need to
 * work for Testing and issues as well."*
 *
 * Before this module the Dashboard carried **two** independent windows, in two URL vocabularies,
 * with two different meanings — `?oRange=24h|7d|30d` (Overview, a trailing preset) and
 * `?tFrom=…&?tTo=…` (Testing, a pinned calendar range) — while the Issues tab had a *third*,
 * unpersisted one inside its own filter row. One page, three clocks. This is the single
 * replacement: one param, one parser, one resolver, read by all three tabs.
 *
 * Pure and React-free (the style `features/dashboard/testing/dashboard-url-state.ts` and
 * `overview-url-state.ts` — which this supersedes — established), so parse / serialize / window math
 * are unit-testable without mounting anything. `DashboardView` is the only component that calls
 * `useSearchParams()` for it; every tab receives the resolved {@link DashboardRange} as a prop.
 *
 * ── THE TWO MEANINGS, BOTH PRESERVED ON PURPOSE ──────────────────────────────────────────────────
 * A **preset** means "the trailing 24 hours / 7 days / 30 days **as of when you open it**". It is
 * stored as the preset TOKEN, never as instants: freezing `?range=7d` into two timestamps would turn
 * a shared link into a window that silently ages, showing last week's numbers to whoever opens it
 * next week.
 *
 * A **custom** range means "these exact days" and IS pinned — that is the whole reason to pick one.
 * It is stored as its two calendar dates (`?range=2026-08-01..2026-08-14`), so the link keeps
 * meaning what it meant when it was copied.
 *
 * Both meanings existed before (Overview owned the first, Testing the second) and both survive here;
 * what changes is that they are now ONE control instead of two contradictory ones.
 *
 * ── THE URL CONTRACT ─────────────────────────────────────────────────────────────────────────────
 *   `?range=24h` · `?range=7d` · `?range=30d`         — a trailing preset
 *   `?range=2026-08-01..2026-08-14`                   — a pinned custom range (inclusive, both ends)
 *   (absent)                                          — the default preset, deliberately kept OUT of
 *                                                       the URL so `/dashboard` stays the clean
 *                                                       canonical link the sidebar points at.
 *
 * **Legacy deep links keep resolving.** `?oRange=` (Overview's old preset key) and `?tFrom=`/`?tTo=`
 * (Testing's old pinned range) are still READ, in that order of precedence after `?range=`, so every
 * link already in someone's notes still lands on the window it named. They are never WRITTEN again:
 * the first time the control is touched, {@link writeDashboardRange} drops them and the URL converges
 * on the single `?range=` key. Reading a legacy link does not rewrite the URL by itself — a page
 * load must not have side effects.
 */

/** The three trailing windows the control offers as one-click presets. */
export type DashboardRangePreset = "24h" | "7d" | "30d";

/** In render order. */
export const DASHBOARD_RANGE_PRESETS: readonly DashboardRangePreset[] = ["24h", "7d", "30d"];

/** The window the Dashboard lands on. Kept out of the URL (see the module doc). */
export const DEFAULT_DASHBOARD_RANGE_PRESET: DashboardRangePreset = "7d";

/** The one query-param key. */
export const DASHBOARD_RANGE_KEY = "range";

/** Read-only compatibility keys — parsed, never written (see the module doc). */
export const LEGACY_RANGE_KEYS = ["oRange", "tFrom", "tTo"] as const;

/** Long-form preset labels — the picker's quick-pick rows AND its trigger text. */
export const DASHBOARD_RANGE_PRESET_LABELS: Record<DashboardRangePreset, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

/**
 * The window spelled out for prose ("Showing …", "Nothing landed in …"), so a reader never has to
 * decode a token to know what they are looking at.
 */
const PRESET_DESCRIPTIONS: Record<DashboardRangePreset, string> = {
  // Non-breaking spaces keep each number with its unit (interaction-guidelines micro-typography).
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
};

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** How far back each preset reaches from "now". */
const PRESET_SPAN_MS: Record<DashboardRangePreset, number> = {
  "24h": 24 * MS_PER_HOUR,
  "7d": 7 * MS_PER_DAY,
  "30d": 30 * MS_PER_DAY,
};

/**
 * What the operator chose — the thing that round-trips through the URL. A preset is a *rule*
 * ("trailing N"); a custom range is two *dates*. Resolving either into instants is
 * {@link resolveDashboardRange}'s job, and only it reads the clock.
 */
export type DashboardRangeSelection =
  | { kind: "preset"; preset: DashboardRangePreset }
  /** Inclusive calendar dates, `YYYY-MM-DD`, `from <= to`. */
  | { kind: "custom"; from: string; to: string };

export const DEFAULT_DASHBOARD_RANGE_SELECTION: DashboardRangeSelection = {
  kind: "preset",
  preset: DEFAULT_DASHBOARD_RANGE_PRESET,
};

/**
 * The resolved window every tab reads. `from`/`to` are inclusive ISO-8601 instants — the ONE
 * definition of "this window", so the Overview's pass rate, the Testing tab's KPI row and the Issues
 * list can no longer be measuring different spans under one label.
 */
export type DashboardRange = {
  /** What produced this window (so a control can render the choice, not just its consequence). */
  selection: DashboardRangeSelection;
  /** Inclusive lower bound, ISO-8601. */
  from: string;
  /** Inclusive upper bound, ISO-8601. */
  to: string;
  /**
   * `"24h" | "7d" | "30d"` for a preset, `"custom"` for a pinned range. Bucket granularity keys off
   * this (a `24h` preset must bucket hourly even though its span rounds to one day).
   */
  preset: DashboardRangePreset | "custom";
  /** The window in prose, e.g. "the last 7 days" / "Aug 1 – Aug 14, 2026". */
  description: string;
};

export function isDashboardRangePreset(
  value: string | null | undefined,
): value is DashboardRangePreset {
  return value != null && (DASHBOARD_RANGE_PRESETS as readonly string[]).includes(value);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string | null | undefined): value is string {
  return value != null && DATE_ONLY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/**
 * Serialize a selection to its `?range=` value. A preset is its token; a custom range is
 * `from..to`. The default preset still serializes (callers decide whether to omit it — see
 * {@link writeDashboardRange}).
 */
export function serializeDashboardRange(selection: DashboardRangeSelection): string {
  return selection.kind === "preset"
    ? selection.preset
    : `${selection.from}..${selection.to}`;
}

/** Parse a raw `?range=` value. Returns `null` for anything unrecognised — never throws. */
export function parseDashboardRangeValue(
  raw: string | null | undefined,
): DashboardRangeSelection | null {
  if (raw == null || raw.length === 0) return null;
  if (isDashboardRangePreset(raw)) return { kind: "preset", preset: raw };
  const [from, to] = raw.split("..");
  return normalizeCustom(from, to);
}

/**
 * Build a custom selection from two raw dates, or `null` when either is unusable. A reversed pair
 * (someone hand-editing the URL) is SWAPPED rather than rejected — the intent is unambiguous and a
 * silent fallback to the default would be the more confusing outcome.
 */
function normalizeCustom(
  from: string | null | undefined,
  to: string | null | undefined,
): DashboardRangeSelection | null {
  if (!isValidDateOnly(from) || !isValidDateOnly(to)) return null;
  return from <= to ? { kind: "custom", from, to } : { kind: "custom", from: to, to: from };
}

/**
 * Read the page range out of the URL. Precedence: the current `?range=` key, then Testing's legacy
 * pinned `?tFrom=`/`?tTo=` pair, then Overview's legacy `?oRange=` preset, then the default. An
 * absent or malformed value falls through to the next source rather than throwing.
 */
export function parseDashboardRange(params: URLSearchParams): DashboardRangeSelection {
  const current = parseDashboardRangeValue(params.get(DASHBOARD_RANGE_KEY));
  if (current) return current;
  const legacyCustom = normalizeCustom(params.get("tFrom"), params.get("tTo"));
  if (legacyCustom) return legacyCustom;
  const legacyPreset = params.get("oRange");
  if (isDashboardRangePreset(legacyPreset)) return { kind: "preset", preset: legacyPreset };
  return DEFAULT_DASHBOARD_RANGE_SELECTION;
}

/**
 * Write `selection` onto a COPY of `params` (the input is never mutated). Every unrelated key —
 * `?tab=`, `?issue=`, the Testing tab's remaining `t*` facets — is carried through untouched; the
 * legacy range keys are dropped so the URL converges on one param; and the DEFAULT preset writes
 * nothing at all, keeping `/dashboard` clean.
 */
export function writeDashboardRange(
  params: URLSearchParams,
  selection: DashboardRangeSelection,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of LEGACY_RANGE_KEYS) next.delete(key);
  if (selection.kind === "preset" && selection.preset === DEFAULT_DASHBOARD_RANGE_PRESET) {
    next.delete(DASHBOARD_RANGE_KEY);
  } else {
    next.set(DASHBOARD_RANGE_KEY, serializeDashboardRange(selection));
  }
  return next;
}

/** `true` when two selections name the same window (so a re-pick can be ignored). */
export function sameDashboardRange(
  a: DashboardRangeSelection,
  b: DashboardRangeSelection,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "preset" && b.kind === "preset") return a.preset === b.preset;
  if (a.kind === "custom" && b.kind === "custom") return a.from === b.from && a.to === b.to;
  return false;
}

/** Short human date for custom-range prose, e.g. "Aug 1, 2026". */
function formatRangeDate(dateOnly: string): string {
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateOnly;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * Resolve a selection into the window every tab reads.
 *
 * A **preset** is measured from `now` (injectable so tests pin it; production passes the real
 * clock) — the trailing span, ending at this instant.
 *
 * A **custom** range is measured from its two calendar dates, expanded to UTC day bounds
 * (`T00:00:00.000Z` … `T23:59:59.999Z`). UTC rather than local because the metrics API's own bucket
 * floors are UTC (D-OB14), and because it reproduces EXACTLY the bounds the Testing tab's
 * `metricsWindow` produced before this module existed — so a legacy `?tFrom=/?tTo=` link resolves to
 * the byte-identical window it always did.
 */
export function resolveDashboardRange(
  selection: DashboardRangeSelection,
  now: Date = new Date(),
): DashboardRange {
  if (selection.kind === "preset") {
    const to = now.getTime();
    return {
      selection,
      from: new Date(to - PRESET_SPAN_MS[selection.preset]).toISOString(),
      to: new Date(to).toISOString(),
      preset: selection.preset,
      description: PRESET_DESCRIPTIONS[selection.preset],
    };
  }
  const sameDay = selection.from === selection.to;
  return {
    selection,
    from: `${selection.from}T00:00:00.000Z`,
    to: `${selection.to}T23:59:59.999Z`,
    preset: "custom",
    description: sameDay
      ? formatRangeDate(selection.from)
      : `${formatRangeDate(selection.from)} – ${formatRangeDate(selection.to)}`,
  };
}

/** Parse + resolve in one call — the shape `DashboardView` uses. */
export function resolveDashboardRangeFromParams(
  params: URLSearchParams,
  now: Date = new Date(),
): DashboardRange {
  return resolveDashboardRange(parseDashboardRange(params), now);
}

/** `YYYY-MM-DD` for a `Date`, read in the viewer's own timezone — what they clicked is what they
 *  get back. Used to turn a calendar selection into a pinned custom range. */
export function toCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
