import type { RunFilter } from "@mcp-token-footprint/shared";
import { parseRunFilter, serializeRunFilter } from "@mcp-token-footprint/shared";
import { SESSION_COLUMNS_PREFERENCE, type RunColumnsPreference } from "./run-columns";

/**
 * Runs feed — URL-persisted {@link RunFilter} state (Observability WP 2.3). Pure, React-free (mirrors
 * `dashboard-url-state.ts`'s style) so the parse/serialize logic is unit-testable without mounting
 * anything. `RunsView` is the only consumer; it owns the `useSearchParams()` call and reads/writes
 * through these helpers.
 *
 * The URL param is the CANONICAL `filter` key (`RUN_FILTER_PARAM` in shared/constants.ts) carrying the
 * shared `serializeRunFilter` JSON — the SAME helper the WP 2.2 dashboard drill-down links
 * (`dashboard-url-state.ts` `drillDownHref`) already build with, so a drill-down link hydrates this
 * bar byte-for-byte with no translation layer.
 */

const FILTER_PARAM = "filter";

/** Parse the `filter=` search param into a validated {@link RunFilter}. Absent or malformed (bad JSON,
 *  a ZodError from an unknown/mistyped field) falls back to `{}` (no constraint) rather than throwing —
 *  a stale/hand-edited URL never crashes the feed. */
export function parseFilterFromSearchParams(params: URLSearchParams): RunFilter {
  const raw = params.get(FILTER_PARAM);
  if (raw === null) return {};
  try {
    return parseRunFilter(raw);
  } catch {
    return {};
  }
}

/** True for the schema-normalized "no constraint" filter — routed through the shared serializer (so an
 *  object carrying only `undefined`-valued keys, e.g. a just-cleared field, correctly reads as empty)
 *  rather than a hand-rolled key count. Shared by the URL writer below, `runs-api.ts` (skip the second
 *  filtered fetch when nothing narrows the feed), and `RunsView` (tell "no runs exist" apart from "no
 *  runs match the active filter" for the empty state, interaction-guidelines §"empty states"). */
export function isEmptyRunFilter(filter: RunFilter): boolean {
  return serializeRunFilter(filter) === "{}";
}

/**
 * Write `filter` onto a COPY of `params` (the input is never mutated). An empty filter (`{}`, the
 * schema-normalized "no constraint" value) OMITS the param entirely so the common "no filters" case
 * stays a clean URL; round-tripping an absent param back through {@link parseFilterFromSearchParams}
 * yields `{}` again, so `writeFilterToSearchParams` → `parseFilterFromSearchParams` is idempotent.
 */
export function writeFilterToSearchParams(
  params: URLSearchParams,
  filter: RunFilter,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const serialized = serializeRunFilter(filter);
  if (serialized === "{}") next.delete(FILTER_PARAM);
  else next.set(FILTER_PARAM, serialized);
  return next;
}

/** A client-side saved-view PRESET (D-OB… — WP 2.3 spec): not a `run_views` DB row, always available,
 *  never editable/deletable. Applying one replaces the active filter wholesale (never merges). */
export type RunViewPreset = {
  id: string;
  name: string;
  filter: RunFilter;
  /**
   * Sessions lens (Observability WP 2.4) — when present, applying this preset ALSO switches the
   * column set wholesale (mirrors the filter's own "replace, never merge" semantics); every other
   * preset omits this and keeps whatever columns are currently active (today's WP2.3 behavior,
   * unchanged).
   */
  columns?: RunColumnsPreference;
};

/** The default preset set the spec calls out by name. Order is the menu's display order. "Guardrail
 *  stops" uses `outcome: ["stopped_guardrail"]` — every guardrail-tripped stop (whatever its precise
 *  `stopReasonCode`) is stamped with that ONE outcome by the engine's terminal mapping
 *  (`apps/api/src/testing/session-terminal.ts` `guardrailStop`), so filtering on the outcome is the
 *  robust, exhaustive way to express "any guardrail stop" without hand-enumerating stop-reason codes.
 *  "Sessions" (WP 2.4, D-US11 — label only, the wire stays `runs`) is the threads-table analog: every
 *  interactive run, switched to the Sessions column set (turn count, active/waiting duration split,
 *  last activity, seen marker). */
export const RUN_VIEW_PRESETS: readonly RunViewPreset[] = [
  { id: "preset:all", name: "All", filter: {} },
  {
    id: "preset:sessions",
    name: "Sessions",
    filter: { interactiveOnly: true },
    columns: SESSION_COLUMNS_PREFERENCE,
  },
  { id: "preset:failures", name: "Failures", filter: { hasError: true } },
  { id: "preset:guardrail-stops", name: "Guardrail stops", filter: { outcome: ["stopped_guardrail"] } },
  { id: "preset:waiting-for-you", name: "Waiting for you", filter: { phase: ["waiting_input"] } },
  // Owner-requested — "Needs attention" as a one-click preset: everything the (removed) feed card used
  // to list, expressed as the single shared `RunFilter.needsAttention` property (paused-on-you OR
  // unseen-not-running). Broader than "Waiting for you" (which is only the live `waiting_input` pause).
  { id: "preset:needs-attention", name: "Needs attention", filter: { needsAttention: true } },
  { id: "preset:pinned", name: "Pinned", filter: { pinned: true } },
];

/** The exact filter the "Waiting for you" preset above uses — re-exported so the Dashboard Testing-tab
 *  KPI card (WP 2.4) counts against the LITERAL SAME `RunFilter` the lens preset applies, rather than a
 *  hand-duplicated copy that could drift. */
export const WAITING_FOR_YOU_FILTER: RunFilter = { phase: ["waiting_input"] };

/** True when `id` names one of the built-in {@link RUN_VIEW_PRESETS} (as opposed to a persisted
 *  `run_views` row, whose ids are server-generated and never carry the `preset:` prefix). */
export function isPresetViewId(id: string): boolean {
  return id.startsWith("preset:");
}
