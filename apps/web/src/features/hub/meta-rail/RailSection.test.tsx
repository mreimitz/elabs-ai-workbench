import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { RailSection } from "./RailSection";

describe("RailSection (WP1.2, D-HUX3 — one stacked, individually collapsible rail section)", () => {
  test("renders its label and children when open", () => {
    render(
      <RailSection id="progress" label="Progress" open onOpenChange={() => {}}>
        <div>Progress body</div>
      </RailSection>,
    );
    expect(screen.getByText("Progress")).toBeInTheDocument();
    expect(screen.getByText("Progress body")).toBeInTheDocument();
  });

  test("shows the count badge, and it survives collapse (§8.3: collapsed keeps a count)", () => {
    const { rerender } = render(
      <RailSection id="outputs" label="Outputs" count={3} open onOpenChange={() => {}}>
        <div>Outputs body</div>
      </RailSection>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();

    rerender(
      <RailSection id="outputs" label="Outputs" count={3} open={false} onOpenChange={() => {}}>
        <div>Outputs body</div>
      </RailSection>,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  test("omits the count badge at zero", () => {
    render(
      <RailSection id="outputs" label="Outputs" count={0} open onOpenChange={() => {}}>
        <div>Outputs body</div>
      </RailSection>,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  test("clicking the trigger calls onOpenChange with the flipped state", () => {
    const onOpenChange = vi.fn();
    render(
      <RailSection id="context" label="Context" open onOpenChange={onOpenChange}>
        <div>Context body</div>
      </RailSection>,
    );
    fireEvent.click(screen.getByRole("button", { name: /context/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("the trigger label truncates and the row keeps min-w-0 (no mid-word clipping contract)", () => {
    render(
      <RailSection
        id="progress"
        label="A very long section label that would otherwise overflow the 360px rail column entirely"
        open
        onOpenChange={() => {}}
      >
        <div>body</div>
      </RailSection>,
    );
    const label = screen.getByText(/A very long section label/);
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("min-w-0");
    // The trigger row itself must also concede width (min-w-0) so the label's truncate can bite.
    const trigger = screen.getByRole("button", { name: /A very long section label/i });
    expect(trigger.className).toContain("min-w-0");
  });
});
