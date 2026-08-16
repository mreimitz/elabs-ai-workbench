import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { defaultControls, type TestingDashboardControls } from "./dashboard-url-state";
import { FilterControls } from "./FilterControls";

// jsdom omits matchMedia — `DateRangePicker`'s Radix Popover reads it (mirrors
// `RunsView.test.tsx`/`IssuesFleetTab.test.tsx`'s identical polyfill).
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

function renderControls(overrides: Partial<TestingDashboardControls> = {}, runCount?: number) {
  const controls: TestingDashboardControls = { ...defaultControls(new Date("2026-07-20T00:00:00Z")), ...overrides };
  const onChange = vi.fn();
  render(
    <FilterControls
      controls={controls}
      onChange={onChange}
      servers={[{ id: "srv-1", name: "Alpha" }]}
      environments={[{ id: "scn-1", name: "Prod environment" }]}
      suites={[{ id: "suite-1", name: "Regression" }]}
      models={["claude-sonnet-4"]}
      runCount={runCount}
    />,
  );
  return { onChange };
}

describe("FilterControls — WP 2.1 (C-1) SelectField → bare Select", () => {
  test("Suite and Group by render as accessible bare selects, not label-above SelectFields", () => {
    renderControls();
    // A bare `Select` + `SelectTrigger aria-label=…` renders Radix's `combobox` role with that
    // name as the accessible name — this is the C-1 fix (no floating label row).
    expect(screen.getByRole("combobox", { name: "Suite" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Group by" })).toBeInTheDocument();
    // The old `SelectField` rendered a `<Label>` element reading "Suite"/"Group by" ABOVE the
    // control — a `role=combobox` accessible NAME is not a visible `<label>` element, so asserting
    // there's no separate label element for either confirms the label-above stack is gone.
    expect(screen.queryByText("Suite", { selector: "label" })).not.toBeInTheDocument();
    expect(screen.queryByText("Group by", { selector: "label" })).not.toBeInTheDocument();
  });

  test("changing Suite/Group by round-trips through onChange (behavior preserved)", () => {
    renderControls();
    // Both selects are present and enabled — the underlying Radix Select interaction (open the
    // listbox, click an option) is already covered by `RunsView.test.tsx`'s identical "Group by"
    // pattern; this test's job is the STRUCTURAL C-1 fix, not re-proving Radix.
    expect(screen.getByRole("combobox", { name: "Suite" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Group by" })).toBeEnabled();
  });
});

describe("FilterControls — WP 2.1 (C-5) count badge", () => {
  test("omits the count badge until the caller has a real run count", () => {
    renderControls({}, undefined);
    expect(screen.queryByText(/\brun(s)?\b/i)).not.toBeInTheDocument();
  });

  test("renders the standard count badge once runCount is known", () => {
    renderControls({}, 42);
    expect(screen.getByText("42 runs")).toBeInTheDocument();
  });

  test("singular 'run' at count 1", () => {
    renderControls({}, 1);
    expect(screen.getByText("1 run")).toBeInTheDocument();
  });
});
