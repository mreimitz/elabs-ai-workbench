import type { ReactNode } from "react";
import { Badge, cn } from "@elabs-ai/components-ui";

/**
 * ResultCount — the ONE stable, always-present readout for a filtered result count (interface-craft
 * WP 1.2, finding 7; hardened further in T10 — see "THE MISUSE THIS PREVENTS" below).
 * =============================================================================================
 *
 * WHY IT EXISTS
 *   Audit finding 7: every filtered-result count in the app ("12 of 90 rows", "33 of 101 scans")
 *   rendered as a plain `Badge` inside an otherwise inert `<div>` — a screen-reader user filtering a
 *   list gets no signal that the count just changed. Every OTHER dynamic readout in the app
 *   (`role="alert"`) is CONDITIONALLY MOUNTED (appears/disappears with the event it reports), which is
 *   unreliable across AT/browser pairs for exactly this kind of steady-state text. `ResultCount` is
 *   the opposite shape on purpose: it is the SAME element, in the SAME place, on every render — only
 *   its text content changes — so a screen reader's "polite" live-region queue reliably picks up the
 *   update instead of racing a mount/unmount.
 *
 * WHAT IT IS
 *   A native `<output>` (the same semantic-element choice `ReportTab.tsx`'s "Loading run report…"
 *   status already uses — implicit `role="status"`, so no raw `role="status"` attribute on a
 *   non-semantic element; `check-tokens`/Biome's `useSemanticElements` rule is what steered this
 *   choice) wrapping the app's standard count `Badge` (`variant="secondary"`, `tabular-nums`) for the
 *   visual. `aria-live`/`aria-atomic` are set explicitly too, so behaviour doesn't depend on a
 *   browser's implicit-role table. It never internally branches on its own content (no
 *   `count === 0 ? null : …` inside), so re-rendering it with new text is a props update on the SAME
 *   element, never an unmount/remount — the guarantee the WP 1.2 acceptance test locks in.
 *
 * THE MISUSE THIS PREVENTS (2026-07-25 critique, "numbers that don't reconcile")
 *   The original API took only `children: ReactNode`, so every call site hand-assembled its own
 *   "N of M noun" ternary. One of them got it wrong — the filtered/total comparison was built from
 *   the wrong variable — and the badge announced the UNFILTERED total ("101 scans") over a table that
 *   was actually showing zero rows. Six near-identical ternaries across six files is exactly the
 *   shape of bug that recurs, because there is nothing stopping call site #7 from copy-pasting the
 *   same mistake. The fix: give the component the raw `filteredCount`/`totalCount` numbers and a
 *   `noun`, and let it compose the ONE "N of M noun" string itself — a caller can no longer hand it a
 *   string that claims to be filtered while actually being the bare total, because it never gets to
 *   write that string. `children` still exists as an escape hatch for counts with no filtered/total
 *   distinction (e.g. a single computed metric — see `FilterControls`'s run count), but it is
 *   mutually exclusive with `filteredCount`/`totalCount`/`noun` (TypeScript's excess-property check on
 *   object literals rejects passing both), and a caller reaching for a count that DOES have a
 *   filtered/total pair should prefer the structured form every time.
 *
 * USAGE
 *   Preferred — the count has a filtered/total distinction:
 *     <ViewToolbar results={<ResultCount filteredCount={filtered.length} totalCount={total} noun="scans" />} />
 *   Escape hatch — a single computed count with no "of a total" relationship:
 *     <ViewToolbar results={<ResultCount>{runCount} run{runCount === 1 ? "" : "s"}</ResultCount>} />
 */

interface FilteredResultCountProps {
  /** Count of items once filters/search are applied. */
  filteredCount: number;
  /** Count of items BEFORE filters/search are applied — the unfiltered total. */
  totalCount: number;
  /** Already-pluralized noun for what's being counted, e.g. "scans", "issues", "runs". */
  noun: string;
  /** Layout-only escape hatch — merged after the standard count-badge classes. */
  className?: string;
}

interface RawResultCountProps {
  /** A pre-formatted count string/node. Only for counts with no filtered/total relationship — prefer
   *  `filteredCount`/`totalCount`/`noun` whenever a total exists (see the docstring above). */
  children: ReactNode;
  /** Layout-only escape hatch — merged after the standard count-badge classes. */
  className?: string;
}

export type ResultCountProps = FilteredResultCountProps | RawResultCountProps;

function hasFilteredCount(props: ResultCountProps): props is FilteredResultCountProps {
  return "filteredCount" in props;
}

/** The single place "N of M noun" is composed — see "THE MISUSE THIS PREVENTS" above. Exported for
 *  tests; not meant to be called from a view (pass the raw numbers to `ResultCount` instead so the
 *  text and the live-region update stay in one component). */
export function formatFilteredCount(filteredCount: number, totalCount: number, noun: string): string {
  return filteredCount === totalCount
    ? `${totalCount} ${noun}`
    : `${filteredCount} of ${totalCount} ${noun}`;
}

export function ResultCount(props: ResultCountProps) {
  const content = hasFilteredCount(props)
    ? formatFilteredCount(props.filteredCount, props.totalCount, props.noun)
    : props.children;

  return (
    // `<output>` carries an IMPLICIT `role="status"` (the semantic-element choice, not a raw `role`
    // attribute) — the same live-region primitive `ReportTab.tsx` already uses. `aria-live`/
    // `aria-atomic` are set explicitly so the live-region behaviour doesn't depend on a browser's
    // implicit-role table. The `Badge` inside is purely visual (no role/aria of its own).
    <output aria-live="polite" aria-atomic="true">
      <Badge variant="secondary" className={cn("shrink-0 tabular-nums", props.className)}>
        {content}
      </Badge>
    </output>
  );
}
