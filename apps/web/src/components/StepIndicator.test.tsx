import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { StepIndicator } from "./StepIndicator";

// a11y (critique 2026-07-25T20-00-10Z, T9 item 6): the wizard step rail had no list semantics, no
// aria-current, and no "Step N of M" announcement — a screen-reader user got three unlabelled chips.

const STEPS = [
  { id: "connection", label: "Connection" },
  { id: "details", label: "Details" },
  { id: "review", label: "Review" },
];

describe("StepIndicator — list semantics + current step (a11y)", () => {
  test("renders a real ordered list with one item per step", () => {
    render(<StepIndicator steps={STEPS} current="details" />);
    const list = screen.getByRole("list", { name: "Progress" });
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  test("aria-current=\"step\" marks exactly the active step", () => {
    render(<StepIndicator steps={STEPS} current="details" />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[2]).not.toHaveAttribute("aria-current");
  });

  test("each step announces its position + label — 'Step N of M: <label>'", () => {
    render(<StepIndicator steps={STEPS} current="connection" />);
    expect(screen.getByText("Step 1 of 3: Connection")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3: Details")).toBeInTheDocument();
    expect(screen.getByText("Step 3 of 3: Review")).toBeInTheDocument();
  });

  test("the visible badge/label are aria-hidden — only the sr-only sentence is exposed to assistive tech", () => {
    render(<StepIndicator steps={STEPS} current="connection" />);
    const items = screen.getAllByRole("listitem");
    const firstItem = items[0] as HTMLElement;
    // The visible number badge and the visible label text are hidden from the a11y tree — a
    // screen reader must hear "Step 1 of 3: Connection" ONCE, not "1" then "Connection" then the
    // full sentence again.
    expect(within(firstItem).getByText("1")).toHaveAttribute("aria-hidden");
    expect(within(firstItem).getByText("Connection")).toHaveAttribute("aria-hidden");
    const srOnly = within(firstItem).getByText("Step 1 of 3: Connection");
    expect(srOnly).not.toHaveAttribute("aria-hidden");
    expect(srOnly).toHaveClass("sr-only");
  });

  test("an unknown `current` id highlights nothing (activeIndex -1) without crashing", () => {
    render(<StepIndicator steps={STEPS} current="not-a-step" />);
    const items = screen.getAllByRole("listitem");
    expect(items.every((item) => !item.hasAttribute("aria-current"))).toBe(true);
  });
});
