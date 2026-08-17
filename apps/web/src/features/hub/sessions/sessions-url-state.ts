import type { DateRange } from "@elabs-ai/components-ui";
import { HUB_SESSION_MODES, RUN_STATUSES } from "@mcp-token-footprint/shared";

/**
 * Assistant Hub UX WP2.8 — URL-persisted filter state for `/assistant/sessions`, pure and React-free
 * (mirrors `workforce/usage/usage-url-state.ts`'s parse/serialize house pattern so it is unit-testable
 * without mounting anything). `SessionsView.tsx` is the only consumer: it seeds its local filter state
 * from {@link parseSessionsFilter} once on mount, then writes changes back through
 * {@link serializeSessionsFilter} so the current filter is deep-linkable / shareable / reloadable.
 *
 * WHY THIS EXISTS (WP2.6 drill links): the workforce Usage tab's ranked table links a `model` row to
 * `/assistant/sessions?model=<id>` and a `mode` row to `?mode=<mode>` (see `usage/usage-links.ts`),
 * and `sessionsHrefForFilter` links `?projectId=<id>`. Before WP2.8, `SessionsView` read NO
 * `useSearchParams()`, so those links landed unfiltered. These param names are chosen to match those
 * links exactly (`mode`, `projectId`), plus the view's own facets (`status`) + search (`q`).
 *
 * PARAM SCHEME:
 *   • `q`        — free-text search (title / model / last-error / project name).
 *   • `model`    — INPUT alias only: a `model` drill-link value seeds `q` when `q` is absent (the
 *                  Sessions table has no dedicated model facet — search matches `session.model`).
 *                  Never WRITTEN back (normalised to `q`), so a `?model=` link cleans up to `?q=`.
 *   • `status`   — comma-separated `RunStatus` values (validated; unknowns dropped).
 *   • `mode`     — comma-separated `HubSessionMode` values (validated; unknowns dropped).
 *   • `projectId`— comma-separated project ids (incl. the "no project" sentinel — NOT validated here,
 *                  the project list loads async; an id matching nothing simply filters to zero rows).
 *   • `from`/`to`— inclusive `YYYY-MM-DD` local date bounds for the updated-at range.
 *
 * `showArchived` is deliberately NOT in the URL — it drives a re-FETCH (`includeArchived`), not a
 * client-side filter, and no drill link sets it; it stays local to the view.
 */

export type SessionsFilterState = {
  search: string;
  status: string[];
  mode: string[];
  project: string[];
  dateRange: DateRange | undefined;
};

export function emptySessionsFilter(): SessionsFilterState {
  return { search: "", status: [], mode: [], project: [], dateRange: undefined };
}

const KEYS = {
  search: "q",
  model: "model",
  status: "status",
  mode: "mode",
  project: "projectId",
  from: "from",
  to: "to",
} as const;

const RUN_STATUS_SET = new Set<string>(RUN_STATUSES);
const SESSION_MODE_SET = new Set<string>(HUB_SESSION_MODES);

/** Collect a repeatable/CSV param into a de-duplicated, order-preserving, non-empty list. */
function readList(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of params.getAll(key)) {
    for (const part of raw.split(",")) {
      const value = part.trim();
      if (value.length > 0 && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

function fromDateOnly(value: string | null): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, y, m, d] = match;
  // Local midnight — the view's own range filter buckets by local start/end of day.
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Local `YYYY-MM-DD` for a Date (round-trips with {@link fromDateOnly}; no UTC shift). */
function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parse the sessions filter from the URL; every field falls back to empty (never throws). */
export function parseSessionsFilter(params: URLSearchParams): SessionsFilterState {
  const q = params.get(KEYS.search);
  const model = params.get(KEYS.model);
  const search = (q ?? model ?? "").trim();

  const status = readList(params, KEYS.status).filter((value) => RUN_STATUS_SET.has(value));
  const mode = readList(params, KEYS.mode).filter((value) => SESSION_MODE_SET.has(value));
  const project = readList(params, KEYS.project);

  const from = fromDateOnly(params.get(KEYS.from));
  const to = fromDateOnly(params.get(KEYS.to));
  const dateRange: DateRange | undefined = from ? { from, ...(to ? { to } : {}) } : undefined;

  return { search, status, mode, project, dateRange };
}

function setOrDelete(params: URLSearchParams, key: string, value: string): void {
  if (value.length === 0) params.delete(key);
  else params.set(key, value);
}

/**
 * Serialize `state` onto a COPY of `params` (input never mutated), preserving unrelated keys. Empty
 * fields are DELETED so the clean/no-filter case stays a bare `/assistant/sessions` URL. The `model`
 * INPUT alias is always cleared — search always round-trips through `q`.
 */
export function serializeSessionsFilter(
  params: URLSearchParams,
  state: SessionsFilterState,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(KEYS.model); // input-only alias — never persisted
  setOrDelete(next, KEYS.search, state.search.trim());
  setOrDelete(next, KEYS.status, state.status.join(","));
  setOrDelete(next, KEYS.mode, state.mode.join(","));
  setOrDelete(next, KEYS.project, state.project.join(","));
  setOrDelete(next, KEYS.from, state.dateRange?.from ? toDateOnly(state.dateRange.from) : "");
  setOrDelete(next, KEYS.to, state.dateRange?.to ? toDateOnly(state.dateRange.to) : "");
  return next;
}
