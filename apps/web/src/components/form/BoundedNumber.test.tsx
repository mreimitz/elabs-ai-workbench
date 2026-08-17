import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BoundedNumber } from "./BoundedNumber";

// NOTE: the clamp/round MATH is exhaustively covered in numeric.test.ts (BoundedNumber emits
// `normalizeNumber(...)`). These tests cover the composition this file owns: the no-limit empty
// state, the unit suffix, value display, and the disabled state — not NumberInput's internal
// keystroke/blur machinery (that's brand-ui's to test).

describe("BoundedNumber", () => {
  test("shows the no-limit placeholder when empty", () => {
    render(
      <BoundedNumber
        value={null}
        onChange={() => {}}
        aria-label="Max tokens"
        placeholder="No limit"
      />,
    );
    expect(screen.getByPlaceholderText("No limit")).toBeInTheDocument();
  });

  test("renders the unit suffix", () => {
    render(
      <BoundedNumber value={4096} onChange={() => {}} aria-label="Max tokens" unit="tokens" />,
    );
    expect(screen.getByText("tokens")).toBeInTheDocument();
  });

  test("is disabled when asked", () => {
    render(<BoundedNumber value={1} onChange={() => {}} aria-label="Count" disabled />);
    expect(screen.getByLabelText("Count")).toBeDisabled();
  });

  test("wires the aria-label onto a focusable input", () => {
    render(<BoundedNumber value={null} onChange={() => {}} aria-label="Optional" />);
    const field = screen.getByLabelText("Optional");
    expect(field.tagName).toBe("INPUT");
  });
});
