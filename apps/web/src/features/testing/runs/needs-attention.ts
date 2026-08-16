import type { RunSummary } from "@mcp-token-footprint/shared";
import { runNeedsAttention } from "@mcp-token-footprint/shared";

/**
 * Unified Sessions (roadmap/unified-sessions/, WP3.3) — the "Needs attention" rule. The canonical
 * predicate now lives ONCE in `packages/shared` (`run-filter.ts` `runNeedsAttention`) so the web feed
 * and the `RunFilter.needsAttention` filter (owner-requested follow-up) express the rule's MEANING in
 * exactly one place; this module re-exports it (structurally: a `RunSummary` carries the
 * `status`/`phase`/`seen` facets the shared predicate reads) plus the small list helper below.
 *
 * The rule: a run needs attention when it is a LIVE run paused on the operator (`running` +
 * `waiting_input`) OR an unseen run that isn't currently running (`seen === false && !running`).
 */
export { runNeedsAttention };

/** Filter a run list down to the ones needing attention, PRESERVING input order (the feed is already
 *  newest-first — see `runs-api.ts` `buildRunsFeed`). */
export function selectRunsNeedingAttention(runs: RunSummary[]): RunSummary[] {
  return runs.filter((run) => runNeedsAttention(run));
}
