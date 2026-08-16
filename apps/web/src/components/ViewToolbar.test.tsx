import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import { ViewToolbar } from "./ViewToolbar";

// Locks the toolbar-standard (TB.0) contract for the shared one-row primitive: the slots render
// when given, the actions cluster pins right + never shrinks, the left cluster owns its own
// wrapping layout (D-TB7) and can collapse (`min-w-0`), the info slot is an accessible focusable
// tooltip trigger, and an omitted slot emits nothing (no empty wrapper). Also covers the D-TB6
// absorption of `TableToolbar`'s `results` + `activeFilters` slots. Pure presentation — no
// matchMedia/ResizeObserver needed.

// The info tooltip uses the Radix `Tooltip`, which reads from a `TooltipProvider` (the app root
// mounts one). Wrap the render the same way the real tree does.
function renderToolbar(ui: React.ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("ViewToolbar — the one-row toolbar primitive (TB.0)", () => {
  test("renders left, actions, and info content when provided", () => {
    renderToolbar(
      <ViewToolbar
        info="What this view is for."
        left={<span>left-slot</span>}
        actions={<span>action-slot</span>}
      />,
    );
    expect(screen.getByText("left-slot")).toBeInTheDocument();
    expect(screen.getByText("action-slot")).toBeInTheDocument();
    // The info trigger is the accessible surface for the description; the tooltip content itself
    // only mounts on hover/focus, so assert on the labelled trigger, not the transient content.
    expect(screen.getByRole("button", { name: "About this view" })).toBeInTheDocument();
  });

  test("the actions wrapper pins right and never shrinks (ml-auto + shrink-0)", () => {
    renderToolbar(<ViewToolbar actions={<span>action-slot</span>} />);
    const wrapper = screen.getByText("action-slot").parentElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain("ml-auto");
    expect(wrapper?.className).toContain("shrink-0");
  });

  test("the left cluster owns wrapping layout and can collapse (D-TB7: min-w-0 + flex-wrap)", () => {
    renderToolbar(<ViewToolbar left={<span>left-slot</span>} />);
    const wrapper = screen.getByText("left-slot").parentElement;
    expect(wrapper).not.toBeNull();
    // ViewToolbar renders `left` inside its own `min-w-0 flex-wrap` cluster (D-TB7) — consumers pass
    // controls, not layout.
    expect(wrapper?.className).toContain("min-w-0");
    expect(wrapper?.className).toContain("flex-wrap");
  });

  test("the info slot renders an accessible, focusable tooltip trigger (a real button)", () => {
    renderToolbar(<ViewToolbar info="Onboarding hint." />);
    const trigger = screen.getByRole("button", { name: "About this view" });
    // A real <button> is keyboard focusable by default (not a div-as-button) and is not disabled.
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).not.toBeDisabled();
  });

  test("omitting a slot renders nothing for it — no empty wrapper", () => {
    renderToolbar(<ViewToolbar left={<span>only-left</span>} />);
    // No info trigger and no actions cluster when neither is provided.
    expect(screen.queryByRole("button", { name: "About this view" })).not.toBeInTheDocument();
    // The single child is the left cluster — the row has no empty actions/info wrappers.
    const row = screen.getByText("only-left").parentElement?.parentElement;
    expect(row?.children).toHaveLength(1);
  });

  // ── D-TB6: results + activeFilters absorbed from the retired TableToolbar ──────────────────────

  test("renders the results slot as muted tabular-nums meta at the tail of the left cluster", () => {
    renderToolbar(
      <ViewToolbar left={<span>left-slot</span>} results={<span>12 of 51 scans</span>} />,
    );
    const results = screen.getByText("12 of 51 scans").parentElement;
    expect(results).not.toBeNull();
    expect(results?.className).toContain("tabular-nums");
    expect(results?.className).toContain("text-muted-foreground");
  });

  test("shows no active-filter chips or Clear all when there are no active filters", () => {
    renderToolbar(<ViewToolbar left={<span>search-slot</span>} />);
    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
  });

  test("renders a removable chip per active filter and fires onRemove", () => {
    const onRemove = vi.fn();
    renderToolbar(
      <ViewToolbar activeFilters={[{ id: "status", label: "Status: Failed", onRemove }]} />,
    );
    expect(screen.getByText("Status: Failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Status: Failed" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  test("renders Clear all only when there are active filters and a handler", () => {
    const onClearAll = vi.fn();
    const { rerender } = renderToolbar(
      <ViewToolbar
        activeFilters={[{ id: "a", label: "Server: alpha", onRemove: () => {} }]}
        onClearAll={onClearAll}
      />,
    );
    fireEvent.click(screen.getByText("Clear all"));
    expect(onClearAll).toHaveBeenCalledTimes(1);

    // No active filters → no Clear all even with a handler.
    rerender(
      <TooltipProvider>
        <ViewToolbar activeFilters={[]} onClearAll={onClearAll} />
      </TooltipProvider>,
    );
    expect(screen.queryByText("Clear all")).not.toBeInTheDocument();
  });
});
