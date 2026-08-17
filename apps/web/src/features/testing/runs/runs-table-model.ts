import type { DateRange } from "@elabs-ai/components-ui";

/**
 * The interactive Runs-table view-model (Testing IA — Runs table rebuild). The unified feed
 * ({@link ../runs-api.buildRunsFeed}) yields two top-level row kinds — standalone single runs and
 * suite-run summaries; this module turns each into a flat, primitive {@link TopRowVM} and provides the
 * PURE search / facet / date / sort / group operations the table runs on.
 *
 * Deliberately free of React and the `@elabs-ai/components-*` component graph (only a type-only `DateRange` import,
 * erased at compile time) so it is unit-testable in isolation — the view derives the VMs (resolving
 * names + status via the component helpers) and feeds them through these functions. Suite MEMBER runs
 * are never top-level rows here: they stay nested under their suite (rendered from the FeedSuiteItem),
 * so sorting / filtering / grouping operate only on the top-level rows and never scatter a member away
 * from its parent.
 */

/**
 * Number of columns in the Runs table — used to `colSpan` full-width injected rows (the expanded KPI
 * rail + group-header rows). The select checkbox + expand chevron live INSIDE the pinned Name cell
 * (so the left edge pins as ONE column, S2), and the Grade column is dropped when nothing in view
 * carries an expectation grade OR a base-rating verdict (S9 + AR6, see {@link shouldShowGradeColumn}),
 * so the count is derived. Column order (keep in sync with `RunsView`'s header):
 *   Name(+select+expand) · Type · Environment · Status · Turns · Tools · Tokens · Cost ·
 *   [Grade?] · Started · Duration · Actions
 */
export function runsColumnCount(showGrade: boolean): number {
  // 11 fixed columns; the Grade column is the only conditional one.
  return showGrade ? 12 : 11;
}

/** Widest possible column count (Grade shown) — for callers needing a static upper bound. */
export const RUNS_TABLE_MAX_COLUMN_COUNT = 12;

export type SortKey =
  | "name"
  | "type"
  | "environment"
  | "status"
  | "turns"
  | "tools"
  | "tokens"
  | "cost"
  | "grade"
  | "started"
  | "duration";

export type SortDir = "asc" | "desc";

/**
 * Grouping axis (G8). `type` / `day` partition EVERY top-level row; `test` / `environment` partition
 * the single runs by their test / environment and gather suite rows (which span many tests AND many
 * environments) into one "Suite runs" bucket, so a suite is never scattered across test/env groups.
 */
export type GroupBy = "none" | "type" | "day" | "test" | "environment";

/** One top-level row reduced to sort/filter-ready primitives (no React, no live stream state). */
export type TopRowVM = {
  /** Stable row id — the run id (single) or `suite:<suiteRunId>` (suite summary). */
  id: string;
  kind: "run" | "suite";
  /** Display + search name: the test name (single) or the suite/plan name (suite). */
  name: string;
  /** The single run's test id (for `group by test`); `null` for a suite row (spans many tests). */
  testId: string | null;
  /** Type facet key. */
  typeKey: "single" | "suite";
  /** Coarse `@elabs-ai/components-*` status value (`complete`/`running`/`pending`/`failed`/`denied`) — the status facet. */
  statusFacet: string;
  /** Precise status label (for the global search haystack). */
  statusLabel: string;
  /** Environments (scenario names) this row touches — one for a single run, many for a suite. */
  environments: string[];
  /** Display + sort label for the Environment column (`"N environments"` for a multi-env suite). */
  environmentLabel: string;
  /** `startedAt` epoch-ms — the Started column + default (newest-first) sort key. */
  startedMs: number;
  /** `startedAt` ISO — for the Started cell + day grouping. */
  startedIso: string;
  turns: number;
  tools: number;
  tokens: number;
  cost: number;
  /** Grade sort proxy: `-1` = ungraded (sorts last); else 0–1 (single = primary score, suite = pass rate). */
  gradeSort: number;
  /**
   * AR6 (WP 3.2) — whether this row has a resolvable `answer_validation` base-rating verdict, a
   * SEPARATE dimension from `gradeSort` (the expectation grade). Only ever `true` for a standalone
   * single-run row; suite summary rows keep their existing rolled-up pass rate ONLY (no rolled-up base
   * verdict — cheaper, and the base verdict is a per-run signal a roll-up would blur) and are always
   * `false` here. Feeds {@link shouldShowGradeColumn} so the Grade column shows whenever EITHER
   * dimension has something to say, even for a test with no declared expectations (the common case,
   * since base rating runs on every terminal run regardless).
   */
  hasBaseVerdict: boolean;
  /** Duration ms, or `null` when the row has no settled duration yet. */
  durationMs: number | null;
};

/**
 * Whether the Grade column should render at all (S9): true when at least one row in view carries
 * either an expectation grade (`gradeSort >= 0`) or a base-rating verdict (`hasBaseVerdict`, AR6) — the
 * two dimensions share ONE column slot in the table (the cell renders both chips side by side), but
 * either one alone is enough to justify showing it.
 */
export function shouldShowGradeColumn(rows: TopRowVM[]): boolean {
  return rows.some((row) => row.gradeSort >= 0 || row.hasBaseVerdict);
}

export type RunsTableFilters = {
  /** Global fuzzy search over name / status / environment / type. */
  search: string;
  /** Selected type facet values (empty = all). */
  types: string[];
  /** Selected coarse status facet values (empty = all). */
  statuses: string[];
  /** Selected environment (scenario name) facet values (empty = all). */
  environments: string[];
  /** Started-date range (inclusive of both endpoint days); absent / empty = unbounded. */
  dateRange?: DateRange;
};

/** One rendered group: its stable key, an optional header label (`null` = ungrouped), and its rows. */
export type RunsTableGroup = { key: string; label: string | null; rows: TopRowVM[] };

/** Type facet options (stable order). */
export const TYPE_FACETS: { value: string; label: string }[] = [
  { value: "single", label: "Single run" },
  { value: "suite", label: "Suite run" },
];

/** Coarse status facet options (stable order) — the union across single + suite rows. */
export const STATUS_FACETS: { value: string; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "pending", label: "Pending" },
  { value: "complete", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "denied", label: "Stopped" },
];

/** Group-by options for the toolbar Select. */
export const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "type", label: "Group by type" },
  { value: "test", label: "Group by test" },
  { value: "environment", label: "Group by environment" },
  { value: "day", label: "Group by day" },
];

/** Bucket key + label for the single "Suite runs" group that `test` / `environment` grouping collects
 *  every suite row into (a suite spans many tests and environments, so it has no single bucket). */
const SUITE_BUCKET_KEY = "__suite__";
const SUITE_BUCKET_LABEL = "Suite runs";

/** Aggregate totals across a set of top-level rows — the feed's monitor strip (G8): total spend,
 *  tokens and the outcome failure rate for the CURRENT filter. `failureRate` is `null` for an empty
 *  set (no rows ⇒ no meaningful rate); otherwise the fraction of rows whose status is `failed` (0–1). */
export type RunsTotals = {
  rows: number;
  tokens: number;
  cost: number;
  failed: number;
  failureRate: number | null;
};

export function summarizeRows(rows: TopRowVM[]): RunsTotals {
  let tokens = 0;
  let cost = 0;
  let failed = 0;
  for (const row of rows) {
    tokens += row.tokens;
    cost += row.cost;
    if (row.statusFacet === "failed") failed += 1;
  }
  return {
    rows: rows.length,
    tokens,
    cost,
    failed,
    failureRate: rows.length === 0 ? null : failed / rows.length,
  };
}

/** True when any filter is narrowing the feed — drives the "Clear filters" affordance. */
export function hasActiveFilters(filters: RunsTableFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.types.length > 0 ||
    filters.statuses.length > 0 ||
    filters.environments.length > 0 ||
    filters.dateRange?.from != null ||
    filters.dateRange?.to != null
  );
}

function startOfDayMs(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDayMs(date: Date): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Apply search + facets + date range. Returns a NEW array; input order is preserved for stable sorts. */
export function filterRows(rows: TopRowVM[], filters: RunsTableFilters): TopRowVM[] {
  const q = filters.search.trim().toLowerCase();
  const from = filters.dateRange?.from ?? null;
  // A single-day pick (only `from`) bounds the whole of that day; a real range bounds [from, to].
  const to = filters.dateRange?.to ?? filters.dateRange?.from ?? null;
  const fromMs = from ? startOfDayMs(from) : null;
  const toMs = to ? endOfDayMs(to) : null;

  return rows.filter((row) => {
    if (filters.types.length > 0 && !filters.types.includes(row.typeKey)) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(row.statusFacet)) return false;
    if (
      filters.environments.length > 0 &&
      !row.environments.some((env) => filters.environments.includes(env))
    ) {
      return false;
    }
    if (fromMs !== null && row.startedMs < fromMs) return false;
    if (toMs !== null && row.startedMs > toMs) return false;
    if (q.length > 0) {
      const haystack = [
        row.name,
        row.statusLabel,
        row.environmentLabel,
        ...row.environments,
        row.typeKey,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function sortValue(row: TopRowVM, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "type":
      return row.typeKey;
    case "environment":
      return row.environmentLabel.toLowerCase();
    case "status":
      return row.statusLabel.toLowerCase();
    case "turns":
      return row.turns;
    case "tools":
      return row.tools;
    case "tokens":
      return row.tokens;
    case "cost":
      return row.cost;
    case "grade":
      return row.gradeSort;
    case "started":
      return row.startedMs;
    case "duration":
      return row.durationMs ?? -1;
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

/** Sort a COPY of `rows` by one column. Ties break newest-first then by id, so the order is stable. */
export function sortRows(rows: TopRowVM[], key: SortKey, dir: SortDir): TopRowVM[] {
  const factor = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    if (cmp !== 0) return cmp * factor;
    // Stable tiebreak — newest first, then descending id (independent of the sort direction).
    if (b.startedMs !== a.startedMs) return b.startedMs - a.startedMs;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/** A local-time `YYYY-MM-DD` key for day grouping. */
function dayKey(startedMs: number): string {
  const d = new Date(startedMs);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A human day-group label (e.g. "Jul 4, 2026"), locale-formatted. */
function dayLabel(startedMs: number): string {
  return new Date(startedMs).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Partition already-sorted rows into groups. Group order follows each group's FIRST appearance in the
 * (sorted) input, so grouping never fights the active sort. `"none"` yields a single unlabeled group.
 */
export function groupRows(rows: TopRowVM[], groupBy: GroupBy): RunsTableGroup[] {
  if (groupBy === "none") return [{ key: "all", label: null, rows }];

  const order: string[] = [];
  const byKey = new Map<string, { label: string; rows: TopRowVM[] }>();
  for (const row of rows) {
    const { key, label } = groupKeyLabel(row, groupBy);
    const bucket = byKey.get(key);
    if (bucket) bucket.rows.push(row);
    else {
      byKey.set(key, { label, rows: [row] });
      order.push(key);
    }
  }
  return order.map((key) => {
    const bucket = byKey.get(key);
    return { key, label: bucket?.label ?? key, rows: bucket?.rows ?? [] };
  });
}

function typeGroupLabel(typeKey: "single" | "suite"): string {
  return typeKey === "single" ? "Single runs" : "Suite runs";
}

/** The bucket a row falls into for a given axis. Suite rows collapse into ONE "Suite runs" bucket for
 *  the `test` / `environment` axes (they span many of each); single runs bucket by test / environment. */
function groupKeyLabel(
  row: TopRowVM,
  groupBy: Exclude<GroupBy, "none">,
): { key: string; label: string } {
  switch (groupBy) {
    case "type":
      return { key: row.typeKey, label: typeGroupLabel(row.typeKey) };
    case "day":
      return { key: dayKey(row.startedMs), label: dayLabel(row.startedMs) };
    case "test":
      return row.testId
        ? { key: `test:${row.testId}`, label: row.name }
        : { key: SUITE_BUCKET_KEY, label: SUITE_BUCKET_LABEL };
    case "environment":
      // A single run touches exactly one environment; a suite spans many → the suite bucket.
      return row.kind === "run" && row.environments.length === 1
        ? { key: `env:${row.environments[0]}`, label: row.environments[0] ?? "Unknown environment" }
        : { key: SUITE_BUCKET_KEY, label: SUITE_BUCKET_LABEL };
    default: {
      const _exhaustive: never = groupBy;
      return _exhaustive;
    }
  }
}
