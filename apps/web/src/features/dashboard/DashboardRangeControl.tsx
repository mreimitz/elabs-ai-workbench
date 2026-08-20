import { useMemo, useRef } from "react";
import type { DateRange, DateRangePreset } from "@elabs-ai/components-ui";
import { DateRangePicker, Text } from "@elabs-ai/components-ui";
import {
  DASHBOARD_RANGE_PRESET_LABELS,
  DASHBOARD_RANGE_PRESETS,
  type DashboardRange,
  type DashboardRangePreset,
  type DashboardRangeSelection,
  resolveDashboardRange,
  toCalendarDate,
} from "./dashboard-range";

/**
 * DashboardRangeControl — the Dashboard's ONE time-range control (dashboard-bento WP 2.2, Defect 2).
 * =============================================================================================
 * It lives in the page-level `ViewToolbar` (`DashboardView`), above the tab strip, and the window it
 * produces scopes **Overview, Testing and Issues** alike. It replaces two controls: the Overview's
 * preset-only `ToggleGroup` and the Testing tab's in-band `DateRangePicker`.
 *
 * The WP names the richer of the two as the survivor, and this is it — `@elabs-ai/components-ui`'s
 * `DateRangePicker`, which offers the three trailing quick-picks **and** a two-month calendar for a
 * pinned custom range in one popover.
 *
 * ── THE ONE MECHANISM WORTH READING ──────────────────────────────────────────────────────────────
 * `DateRangePicker` reports a *selection* (`onValueChange(range)`), never *which affordance produced
 * it* — a preset row and two calendar clicks arrive identically, as two `Date`s. That is exactly the
 * distinction this page must keep: a preset means "trailing N **as of now**" and must NOT be frozen
 * to instants, while a custom range is pinned (`dashboard-range.ts`'s module doc). Collapsing them
 * would silently turn every shared `?range=7d` link into a window that ages out.
 *
 * So the preset rows announce themselves. `getRange` is OUR closure, and upstream calls it
 * SYNCHRONOUSLY immediately before `onValueChange` (`setRange(preset.getRange())` — verified in the
 * package source), so a ref set inside it is read, and cleared, on the very next line of the same
 * click. No timers, no heuristics, no guessing "did those two dates look like 7 days?".
 *
 * ── WHY THE PICKER IS ALWAYS CONTROLLED ──────────────────────────────────────────────────────────
 * `value` is passed for a preset too, resolved to the window it currently means. Upstream is
 * controlled only while `value !== undefined`; hand it `undefined` for presets and it silently falls
 * back to its own internal state, which still holds the LAST custom range — so switching custom →
 * preset would leave the trigger showing two stale dates. Always passing a value removes that state
 * entirely. It also keeps the ordinary two-click calendar flow intact: react-day-picker's
 * `addToRange` completes a range on the FIRST click (`{from: d, to: d}`, `min` unset) and extends it
 * on the second, which only works while the component is reading OUR value back.
 *
 * The consequence is that the trigger shows the window's dates rather than the word "preset" — so
 * the toolbar states the window's NATURE beside it ("Showing the last 7 days" vs. "Showing Aug 1,
 * 2026 – Aug 14, 2026"), which is where a reader learns whether it trails or is pinned.
 *
 * Every visible element is `@elabs-ai/components-*`; `className` is layout-only; no raw colour;
 * reads in both themes.
 */
export type DashboardRangeControlProps = {
  /** The resolved page range (its `selection` is what this control edits). */
  range: DashboardRange;
  /** Commit a new selection. The caller owns URL persistence. */
  onChange: (next: DashboardRangeSelection) => void;
};

export function DashboardRangeControl({ range, onChange }: DashboardRangeControlProps) {
  // Set by a preset row's `getRange()` and consumed by the very next `onValueChange` (see the doc).
  const claimedPreset = useRef<DashboardRangePreset | null>(null);

  const presets: DateRangePreset[] = useMemo(
    () =>
      DASHBOARD_RANGE_PRESETS.map((preset) => ({
        label: DASHBOARD_RANGE_PRESET_LABELS[preset],
        getRange: () => {
          claimedPreset.current = preset;
          const resolved = resolveDashboardRange({ kind: "preset", preset });
          return { from: new Date(resolved.from), to: new Date(resolved.to) };
        },
      })),
    [],
  );

  const value: DateRange = useMemo(
    () => ({ from: new Date(range.from), to: new Date(range.to) }),
    [range.from, range.to],
  );

  return (
    // `DateRangePicker` exposes no `aria-label` (its trigger names itself by its value), so the
    // group names what the control is FOR. The muted prefix is the same label-in-row treatment every
    // other toolbar control in this app uses (`FilterControls`' "Suite:", "Group by:").
    <div
      role="group"
      aria-label="Dashboard date range"
      className="flex min-w-0 shrink-0 items-center gap-1.5"
    >
      <Text as="span" variant="meta" tone="muted" aria-hidden>
        Range:
      </Text>
      <DateRangePicker
        value={value}
        onValueChange={(next) => {
          const preset = claimedPreset.current;
          claimedPreset.current = null;
          if (preset) {
            onChange({ kind: "preset", preset });
            return;
          }
          // Clearing the selection (clicking the single selected day again) yields `undefined` —
          // there is no such thing as "no window" here, so the current one simply stands.
          if (!next?.from) return;
          onChange({
            kind: "custom",
            from: toCalendarDate(next.from),
            to: toCalendarDate(next.to ?? next.from),
          });
        }}
        presets={presets}
        numberOfMonths={2}
        placeholder="Date range"
        className="w-auto min-w-[10rem] shrink-0"
      />
    </div>
  );
}
