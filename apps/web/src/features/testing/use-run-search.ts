import { useEffect, useMemo, useState } from "react";
import { searchRunScoped } from "../../lib/api";
import { collectLiveSearchHits, hitFromFtsSummary, type SearchHit } from "./run-search";
import type { TimelineItem } from "./use-run-stream";

export type UseRunSearchResult = {
  /** All current matches: the live scan, plus (in replay) the one FTS supplement when present. */
  hits: SearchHit[];
  /** -1 when there are no hits; otherwise a valid index into `hits`. */
  activeIndex: number;
  activeHit: SearchHit | null;
  /** Advance to the next match, wrapping around. No-op when there are no hits. */
  next: () => void;
  /** Step back to the previous match, wrapping around. No-op when there are no hits. */
  prev: () => void;
  /** True while the replay-only FTS supplement is in flight. */
  ftsLoading: boolean;
  /** Set on a genuine FTS request failure — never blocks the (always-available) live hits. */
  ftsError: string | null;
};

/**
 * Observability (WP3.4) — the run console's in-run search. LIVE hits are recomputed synchronously
 * from the accumulated `timeline`/`runError` (client-side, over whatever the run has streamed so
 * far). A REPLAYED (terminal) run ADDITIONALLY queries the WP1.3 full-text index, scoped as tightly
 * as the `RunFilter` grammar allows, so content the client's own (possibly truncation-capped) step
 * payloads don't carry still turns up. Both sources feed ONE hit list built through the ONE
 * `findMatch`/`hitFromFtsSummary` primitives in `run-search.ts` — see that module's header comment
 * for why re-implementing the match logic twice is exactly what this hook avoids.
 */
export function useRunSearch(params: {
  query: string;
  timeline: TimelineItem[];
  runError: string | null;
  isReplay: boolean;
  runId: string | null;
  testId: string;
}): UseRunSearchResult {
  const { query, timeline, runError, isReplay, runId, testId } = params;

  const liveHits = useMemo(
    () => collectLiveSearchHits({ timeline, runError, query }),
    [timeline, runError, query],
  );

  const [ftsHit, setFtsHit] = useState<SearchHit | null>(null);
  const [ftsLoading, setFtsLoading] = useState(false);
  const [ftsError, setFtsError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!isReplay || !runId || trimmed.length === 0) {
      setFtsHit(null);
      setFtsLoading(false);
      setFtsError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setFtsLoading(true);
    setFtsError(null);
    searchRunScoped(testId, trimmed, controller.signal)
      .then((runs) => {
        if (cancelled) return;
        setFtsHit(hitFromFtsSummary(runId, runs));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFtsHit(null);
        setFtsError(error instanceof Error ? error.message : "Full-text search failed.");
      })
      .finally(() => {
        if (!cancelled) setFtsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isReplay, runId, testId, query]);

  // The live scan ALWAYS runs; the FTS hit (replay-only) is merged in ADDITION to it, never instead —
  // it exists to catch what the local scan can't see, not to replace it.
  const hits = useMemo(() => (ftsHit ? [...liveHits, ftsHit] : liveHits), [liveHits, ftsHit]);

  const [activeIndex, setActiveIndex] = useState(0);
  // Reset the navigation pointer to the FIRST match whenever the QUERY TEXT changes (an intentional
  // search, like Cmd+F) — but NOT merely because `hits` changed shape (e.g. new live data streamed
  // in while the query stayed the same). That distinction matters: a query change is the operator
  // asking "take me to the first match of THIS"; new steps arriving mid-read must never steal focus
  // out from under them.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const clampedIndex = hits.length === 0 ? -1 : Math.min(activeIndex, hits.length - 1);
  const activeHit = clampedIndex >= 0 ? (hits[clampedIndex] ?? null) : null;

  const next = (): void => {
    if (hits.length === 0) return;
    setActiveIndex((i) => (Math.min(i, hits.length - 1) + 1) % hits.length);
  };
  const prev = (): void => {
    if (hits.length === 0) return;
    setActiveIndex((i) => (Math.min(i, hits.length - 1) - 1 + hits.length) % hits.length);
  };

  return { hits, activeIndex: clampedIndex, activeHit, next, prev, ftsLoading, ftsError };
}
