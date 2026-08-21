import type { RunFilter } from "@mcp-token-footprint/shared";
import {
  ALL_RUN_TABLE_COLUMNS,
  DEFAULT_RUN_COLUMNS_PREFERENCE,
  PREVIEW_MODES,
  type PreviewMode,
  type RunColumnsPreference,
  type RunTableColumnKey,
} from "./run-columns";
import {
  GROUP_BY_OPTIONS,
  TYPE_FACETS,
  type GroupBy,
  type SortDir,
  type SortKey,
} from "./runs-table-model";
import { parseFilterFromSearchParams, writeFilterToSearchParams } from "./run-filter-url";

/**
 * Runs feed — the COMPLETE view state as URL query params (RM-17 Phase 6 · AM-OB1). Pure and
 * React-free (same style as `run-filter-url.ts`, which this module builds on) so the whole
 * serialize → parse → deep-equal round-trip is unit-testable without mounting anything.
 *
 * **What was already URL-persisted before this module** (`run-filter-url.ts`, WP 2.3): the entire
 * {@link RunFilter} — every field including the `q` search — under the canonical `filter=` param,
 * byte-stable via the shared `serializeRunFilter`. That half is untouched here; this module owns the
 * REST of the feed's state, which lived in component `useState` and was lost on every reload:
 *
 * | Param     | Feed state                                    |
 * | --------- | --------------------------------------------- |
 * | `filter`  | the {@link RunFilter} (delegated, unchanged)   |
 * | `view`    | the applied saved view / preset id             |
 * | `type`    | the single-vs-suite row-shape facet            |
 * | `group`   | the grouping axis                              |
 * | `sort`    | the table sort, as `<key>:<dir>`               |
 * | `cols`    | visible optional columns, comma-joined         |
 * | `preview` | the per-row preview disclosure's content mode  |
 *
 * Two rules make this safe to paste around:
 *
 * 1. **A default is OMITTED, never written.** The zero-query-param `/testing/runs` therefore still
 *    renders the exact default feed (routes rule D-TB10), and today's clean URLs stay clean.
 * 2. **A malformed value degrades to its default, never throws.** A hand-edited or stale URL (an
 *    unknown column key, a deleted sort key, a `group=nonsense`) opens a working feed rather than a
 *    crashed one — the same forgiving contract `parseFilterFromSearchParams` already had.
 *
 * `view=` is the shareable name: it records WHICH named view is applied, and `RunsView` re-applies it
 * on arrival when no other state param is present (the short "named URL" form, `?view=<id>`). Once a
 * view is applied the resolved filter/columns/sort are ALSO written out, so an ordinary shared URL is
 * self-describing and needs no lookup to reproduce.
 */

/** Every query param this module owns. `filter` is included: it is part of the feed's view state even
 *  though its codec lives next door. Used to tell a bare `?view=<id>` (re-apply the named view) from a
 *  fully-specified URL (reproduce it verbatim). */
export const RUN_FEED_STATE_PARAMS = [
  "filter",
  "view",
  "type",
  "group",
  "sort",
  "cols",
  "preview",
] as const;

const VIEW_PARAM = "view";
const TYPE_PARAM = "type";
const GROUP_PARAM = "group";
const SORT_PARAM = "sort";
const COLS_PARAM = "cols";
const PREVIEW_PARAM = "preview";

/** The table sort as the feed holds it — the same `{ key, dir }` shape a saved view's opaque `sort`
 *  presentation hint carries, so one parser ({@link parseRunTableSort}) serves both. */
export type RunTableSort = { key: SortKey; dir: SortDir };

/** The feed's complete, URL-serializable view state. */
export type RunFeedViewState = {
  filter: RunFilter;
  /** The applied saved-view / preset id, or `null` once the bar has drifted from any named view. */
  viewId: string | null;
  /** Row-shape facet values (`single` / `suite`); empty means "no facet". */
  typeFacet: string[];
  groupBy: GroupBy;
  sort: RunTableSort;
  columns: RunColumnsPreference;
};

/** The state a zero-query-param `/testing/runs` renders (D-TB10). Every writer compares against this
 *  to decide which params to omit. */
export const DEFAULT_RUN_FEED_VIEW_STATE: RunFeedViewState = {
  filter: {},
  viewId: null,
  typeFacet: [],
  groupBy: "none",
  sort: { key: "started", dir: "desc" },
  columns: DEFAULT_RUN_COLUMNS_PREFERENCE,
};

const GROUP_BY_VALUES = new Set<string>(GROUP_BY_OPTIONS.map((option) => option.value));
const TYPE_FACET_VALUES = new Set<string>(TYPE_FACETS.map((option) => option.value));
const SORT_KEYS = new Set<string>([
  "name",
  "type",
  "environment",
  "status",
  "turns",
  "tools",
  "tokens",
  "cost",
  "grade",
  "started",
  "duration",
] satisfies SortKey[]);

/**
 * Give meaning to an OPAQUE sort blob — a saved {@link import("@mcp-token-footprint/shared").RunView}'s
 * `sort` field (which the API only round-trips, never interprets) or anything else. Anything that is
 * not the `{ key: SortKey, dir: SortDir }` shape this app writes returns `null`, so applying a view
 * from an older/foreign client never crashes the feed over a presentation hint.
 */
export function parseRunTableSort(raw: unknown): RunTableSort | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const { key, dir } = obj;
  if (typeof key !== "string" || !SORT_KEYS.has(key)) return null;
  if (dir !== "asc" && dir !== "desc") return null;
  return { key: key as SortKey, dir };
}

/** `<key>:<dir>` — the compact URL form. */
function formatSort(sort: RunTableSort): string {
  return `${sort.key}:${sort.dir}`;
}

function parseSortParam(raw: string | null): RunTableSort | null {
  if (raw === null) return null;
  const [key, dir] = raw.split(":");
  return parseRunTableSort({ key, dir });
}

/** Split a comma-joined param, trimming and dropping empties. `null` (absent) is distinguished from
 *  `""` (present but empty) by the callers below — an empty `cols=` is a real "hide every optional
 *  column" choice, not a missing param. */
function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isRunTableColumnKey(value: string): value is RunTableColumnKey {
  return (ALL_RUN_TABLE_COLUMNS as readonly string[]).includes(value);
}

function isPreviewMode(value: string): value is PreviewMode {
  return (PREVIEW_MODES as readonly string[]).includes(value);
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Read the complete feed view state out of a `URLSearchParams`. Never throws: every field falls back
 * to its {@link DEFAULT_RUN_FEED_VIEW_STATE} value when absent, and an unrecognized value is dropped
 * (unknown column keys, an unknown facet value) or replaced by the default (an unknown group axis or
 * sort key) rather than surfaced as an error.
 */
export function parseRunFeedViewState(params: URLSearchParams): RunFeedViewState {
  const rawView = params.get(VIEW_PARAM);
  const viewId = rawView !== null && rawView.trim().length > 0 ? rawView.trim() : null;

  const rawType = params.get(TYPE_PARAM);
  const typeFacet =
    rawType === null
      ? DEFAULT_RUN_FEED_VIEW_STATE.typeFacet
      : splitList(rawType).filter((value) => TYPE_FACET_VALUES.has(value));

  const rawGroup = params.get(GROUP_PARAM);
  const groupBy =
    rawGroup !== null && GROUP_BY_VALUES.has(rawGroup)
      ? (rawGroup as GroupBy)
      : DEFAULT_RUN_FEED_VIEW_STATE.groupBy;

  const sort = parseSortParam(params.get(SORT_PARAM)) ?? DEFAULT_RUN_FEED_VIEW_STATE.sort;

  const rawCols = params.get(COLS_PARAM);
  const visible =
    rawCols === null
      ? DEFAULT_RUN_COLUMNS_PREFERENCE.visible
      : [...new Set(splitList(rawCols).filter(isRunTableColumnKey))];

  const rawPreview = params.get(PREVIEW_PARAM);
  const previewMode =
    rawPreview !== null && isPreviewMode(rawPreview)
      ? rawPreview
      : DEFAULT_RUN_COLUMNS_PREFERENCE.previewMode;

  return {
    filter: parseFilterFromSearchParams(params),
    viewId,
    typeFacet,
    groupBy,
    sort,
    columns: { visible, previewMode },
  };
}

/**
 * Write the complete feed view state onto a COPY of `params` (the input is never mutated; params this
 * module does not own — `feed`, `launch` — are preserved verbatim). A field equal to its default is
 * DELETED rather than written, so writing {@link DEFAULT_RUN_FEED_VIEW_STATE} onto an empty query
 * yields an empty query, and the round-trip is idempotent in both directions.
 */
export function writeRunFeedViewState(
  params: URLSearchParams,
  state: RunFeedViewState,
): URLSearchParams {
  const next = writeFilterToSearchParams(params, state.filter);

  if (state.viewId === null) next.delete(VIEW_PARAM);
  else next.set(VIEW_PARAM, state.viewId);

  if (state.typeFacet.length === 0) next.delete(TYPE_PARAM);
  else next.set(TYPE_PARAM, state.typeFacet.join(","));

  if (state.groupBy === DEFAULT_RUN_FEED_VIEW_STATE.groupBy) next.delete(GROUP_PARAM);
  else next.set(GROUP_PARAM, state.groupBy);

  if (
    state.sort.key === DEFAULT_RUN_FEED_VIEW_STATE.sort.key &&
    state.sort.dir === DEFAULT_RUN_FEED_VIEW_STATE.sort.dir
  ) {
    next.delete(SORT_PARAM);
  } else {
    next.set(SORT_PARAM, formatSort(state.sort));
  }

  if (sameStringList(state.columns.visible, DEFAULT_RUN_COLUMNS_PREFERENCE.visible)) {
    next.delete(COLS_PARAM);
  } else {
    // An empty list is a real choice ("hide every optional column"), so it is written as an empty
    // param — `?cols=` — which `parseRunFeedViewState` reads back as `[]`, not as "absent".
    next.set(COLS_PARAM, state.columns.visible.join(","));
  }

  if (state.columns.previewMode === DEFAULT_RUN_COLUMNS_PREFERENCE.previewMode) {
    next.delete(PREVIEW_PARAM);
  } else {
    next.set(PREVIEW_PARAM, state.columns.previewMode);
  }

  return next;
}

/**
 * True when `params` carries any feed-state param OTHER than `view` — i.e. the URL already describes
 * the state explicitly. `RunsView` uses this to tell the two shapes of a `view=` URL apart: the short
 * named form (`?view=<id>` alone → resolve the view and apply it) from a fully-specified shared URL
 * (`?view=<id>&filter=…&cols=…` → reproduce it verbatim, `view` being only the picker's label).
 */
export function hasExplicitRunFeedState(params: URLSearchParams): boolean {
  return RUN_FEED_STATE_PARAMS.some((key) => key !== VIEW_PARAM && params.has(key));
}
