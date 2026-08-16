import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { MAX_COMPARE_RUNS, isCompareMode, type CompareMode } from "./compare-runs";

/**
 * The Compare Workspace's URL state (audit §H2 — "state lives in the URL"). The whole workspace is
 * reconstructable from the query string, so every comparison is shareable, restorable on reload, and
 * the foundation of the drill-down/up loop (H5).
 *
 * URL CONTRACT (`/testing/runs/compare?…`):
 *   • `ids`         — comma-separated run ids in comparison order. Position drives the letter
 *                     (ids[0] → Ⓐ). Deduped, capped at {@link MAX_COMPARE_RUNS}. Absent ⇒ empty set.
 *   • `baseline`    — the run id every Δ is measured against. Must be one of `ids`; when absent or
 *                     stale it defaults (in the resolver) to the first id.
 *   • `mode`        — `summary` | `flow` | `metrics` | `suite`. Absent/invalid ⇒ `summary`.
 *   • `focus`       — opaque focus token for the drill loop (e.g. `B@t3.s2`); WP 4.1 only round-trips
 *                     it (Flow mode / the step drawer consume it in WP 4.3/4.4).
 *   • `suiteRunIds` — the suite-compare seam from the Runs feed (WP 2.4). Presence routes the
 *                     workspace to suite mode (WP 4.6); WP 4.1 preserves it verbatim.
 *
 * WRITES never scroll the page (react-router `setSearchParams` mutates the query in place) and never
 * touch unrelated params — they read-modify-write the current search string. Chip/mode/baseline
 * changes PUSH a history entry (so browser Back walks the comparison), which reload then restores.
 */

export type CompareUrlState = {
  ids: string[];
  baseline: string | null;
  mode: CompareMode;
  focus: string | null;
  suiteRunIds: string[];
};

export type CompareStateApi = CompareUrlState & {
  /** Replace the whole ordered id set (deduped + capped). Clears a stale baseline/focus. */
  setIds: (ids: string[]) => void;
  /** Append a run to the end of the set (no-op if present or at the cap). */
  addId: (id: string) => void;
  /** Remove a run; if it was the baseline, the baseline falls back to the new first id. */
  removeId: (id: string) => void;
  setBaseline: (id: string) => void;
  setMode: (mode: CompareMode) => void;
  setFocus: (focus: string | null) => void;
};

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function useCompareState(): CompareStateApi {
  const [searchParams, setSearchParams] = useSearchParams();

  const ids = useMemo(
    () => parseList(searchParams.get("ids")).slice(0, MAX_COMPARE_RUNS),
    [searchParams],
  );
  const suiteRunIds = useMemo(() => parseList(searchParams.get("suiteRunIds")), [searchParams]);
  const baselineRaw = searchParams.get("baseline");
  const baseline = baselineRaw && ids.includes(baselineRaw) ? baselineRaw : (ids[0] ?? null);
  const modeRaw = searchParams.get("mode");
  // The suite seam forces suite mode; otherwise honour a valid mode param, defaulting to summary.
  const mode: CompareMode =
    suiteRunIds.length > 0 ? "suite" : isCompareMode(modeRaw) ? modeRaw : "summary";
  const focus = searchParams.get("focus");

  // Read-modify-write the current params so unrelated keys survive; `next` mutates a fresh copy.
  const patch = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          mutate(next);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const writeIds = useCallback(
    (nextIds: string[], nextBaseline?: string | null) => {
      const capped = nextIds.slice(0, MAX_COMPARE_RUNS);
      patch((params) => {
        if (capped.length > 0) params.set("ids", capped.join(","));
        else params.delete("ids");
        // Keep the baseline valid against the new set.
        const resolvedBaseline =
          nextBaseline && capped.includes(nextBaseline) ? nextBaseline : (capped[0] ?? null);
        if (resolvedBaseline) params.set("baseline", resolvedBaseline);
        else params.delete("baseline");
        // A focus into a run that just left the set is stale — drop it.
        const focusTarget = params.get("focus");
        if (focusTarget && !capped.some((id) => focusTarget.startsWith(id))) params.delete("focus");
      });
    },
    [patch],
  );

  const setIds = useCallback(
    (nextIds: string[]) => writeIds(parseList(nextIds.join(","))),
    [writeIds],
  );

  const addId = useCallback(
    (id: string) => {
      if (!id || ids.includes(id) || ids.length >= MAX_COMPARE_RUNS) return;
      writeIds([...ids, id], baseline);
    },
    [ids, baseline, writeIds],
  );

  const removeId = useCallback(
    (id: string) => {
      const nextIds = ids.filter((existing) => existing !== id);
      writeIds(nextIds, baseline === id ? null : baseline);
    },
    [ids, baseline, writeIds],
  );

  const setBaseline = useCallback(
    (id: string) => {
      if (!ids.includes(id)) return;
      patch((params) => params.set("baseline", id));
    },
    [ids, patch],
  );

  const setMode = useCallback(
    (nextMode: CompareMode) => {
      patch((params) => params.set("mode", nextMode));
    },
    [patch],
  );

  const setFocus = useCallback(
    (nextFocus: string | null) => {
      patch((params) => {
        if (nextFocus) params.set("focus", nextFocus);
        else params.delete("focus");
      });
    },
    [patch],
  );

  return {
    ids,
    baseline,
    mode,
    focus,
    suiteRunIds,
    setIds,
    addId,
    removeId,
    setBaseline,
    setMode,
    setFocus,
  };
}
