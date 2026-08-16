import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SegmentedField } from "./SegmentedField";

const options = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

describe("SegmentedField", () => {
  test("renders the label and every option", () => {
    render(
      <SegmentedField
        id="effort"
        label="Reasoning effort"
        value="medium"
        onChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByText("Reasoning effort")).toBeInTheDocument();
    for (const o of options) {
      expect(screen.getByRole("radio", { name: o.label })).toBeInTheDocument();
    }
  });

  test("selecting a different segment emits its value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedField
        id="effort"
        label="Reasoning effort"
        value="medium"
        onChange={onChange}
        options={options}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  test("clicking the already-selected segment does NOT clear it (sticky)", () => {
    const onChange = vi.fn();
    render(
      <SegmentedField
        id="effort"
        label="Reasoning effort"
        value="medium"
        onChange={onChange}
        options={options}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Medium" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("renders the help slot", () => {
    render(
      <SegmentedField
        id="loading"
        label="Tool loading"
        value="eager"
        onChange={() => {}}
        options={[
          { value: "eager", label: "Eager" },
          { value: "deferred", label: "Deferred" },
        ]}
        help="Deferred loading sends tool definitions only when first used."
      />,
    );
    expect(
      screen.getByText("Deferred loading sends tool definitions only when first used."),
    ).toBeInTheDocument();
  });
});
