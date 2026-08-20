import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";

// jsdom omits matchMedia — `DateRangePicker`'s Radix Popover reads it (mirrors
// `FilterControls.test.tsx`/`IssuesFleetTab.test.tsx`'s identical polyfill).
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { DashboardRangeControl } from "./DashboardRangeControl";
import { resolveDashboardRange, type DashboardRangeSelection } from "./dashboard-range";

/**
 * dashboard-bento WP 2.2 (Defect 2) — the Dashboard's ONE range control.
 *
 * The thing worth testing here is the mechanism the component exists for: `DateRangePicker` reports
 * a *selection* (two `Date`s), never *which affordance produced it*, yet a preset and a calendar
 * pick MUST commit different things — a preset stays relative ("trailing N as of now"), a custom
 * range stays pinned. The control tells them apart by having its own `getRange` closures announce
 * themselves, and that is what these tests exercise, through the real popover.
 */

function renderControl(selection: DashboardRangeSelection, now = new Date("2026-08-20T12:00:00.000Z")) {
  const onChange = vi.fn<(next: DashboardRangeSelection) => void>();
  render(
    <TooltipProvider>
      <DashboardRangeControl range={resolveDashboardRange(selection, now)} onChange={onChange} />
    </TooltipProvider>,
  );
  return { onChange };
}

const control = () => screen.getByRole("group", { name: "Dashboard date range" });
const openPicker = () => fireEvent.click(within(control()).getByRole("button"));

describe("DashboardRangeControl — presets stay RELATIVE", () => {
  test("offers the three trailing quick-picks", () => {
    renderControl({ kind: "preset", preset: "7d" });
    openPicker();
    for (const label of ["Last 24 hours", "Last 7 days", "Last 30 days"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  test("clicking a preset commits the PRESET, not the two dates it happens to resolve to today", () => {
    const { onChange } = renderControl({ kind: "preset", preset: "7d" });
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "preset", preset: "30d" });
  });

  test("each preset row commits its own token", () => {
    const { onChange } = renderControl({ kind: "preset", preset: "7d" });
    openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Last 24 hours" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "preset", preset: "24h" });
  });
});

/** Click a specific calendar day. The `td` carries `data-day="YYYY-MM-DD"`, which is unambiguous
 *  across the two months the picker shows (a bare "14" would match September's too). */
function clickDay(dateOnly: string) {
  const cell = document.querySelector(`[role="gridcell"][data-day="${dateOnly}"]`);
  if (!cell) throw new Error(`No calendar cell for ${dateOnly}`);
  fireEvent.click(within(cell as HTMLElement).getByRole("button"));
}

describe("DashboardRangeControl — a calendar pick is PINNED", () => {
  test("extending the range on the calendar commits CUSTOM calendar dates", () => {
    const { onChange } = renderControl({ kind: "custom", from: "2026-08-10", to: "2026-08-12" });
    openPicker();
    clickDay("2026-08-14");

    // react-day-picker extends an existing complete range forward from its start.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ kind: "custom", from: "2026-08-10", to: "2026-08-14" });
  });

  test("picking on the calendar while a PRESET is active switches the window to pinned", () => {
    // This is the transition the ref mechanism has to get right in the other direction: no preset
    // row was clicked, so nothing claims the change and it must commit as a pinned custom range.
    const { onChange } = renderControl({ kind: "preset", preset: "7d" });
    openPicker();
    clickDay("2026-08-17");

    const committed = onChange.mock.calls[0]?.[0];
    expect(committed?.kind).toBe("custom");
    expect(committed).toEqual({ kind: "custom", from: "2026-08-13", to: "2026-08-17" });
  });

  test("a custom range's own dates are what the trigger shows", () => {
    renderControl({ kind: "custom", from: "2026-08-01", to: "2026-08-14" });
    const trigger = within(control()).getByRole("button");
    // Rebuilt from the CALENDAR dates, not from the resolved UTC day bounds: reading
    // `2026-08-14T23:59:59.999Z` in a positive-offset timezone would render "Aug 15" and show a
    // window one day wider than the one actually applied.
    expect(trigger.textContent).toContain("Aug 1, 2026");
    expect(trigger.textContent).toContain("Aug 14, 2026");
    expect(trigger.textContent).not.toContain("Aug 15, 2026");
  });
});

describe("DashboardRangeControl — accessibility", () => {
  test("the control names what it is FOR, not just the value it currently holds", () => {
    renderControl({ kind: "preset", preset: "7d" });
    // `DateRangePicker` exposes no `aria-label` of its own (its trigger names itself by its value),
    // so the group carries the purpose — otherwise a screen-reader user hears two dates and nothing
    // about what they control.
    expect(control()).toBeInTheDocument();
    expect(within(control()).getByRole("button")).toHaveAttribute("aria-haspopup", "dialog");
  });
});
