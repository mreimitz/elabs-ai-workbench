import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { KeyValueEditor, type KeyValuePair } from "./KeyValueEditor";

// The reveal/remove controls are `IconButton`s (D-TB5), which render a Radix `Tooltip` that needs a
// `TooltipProvider` ancestor (the app root mounts one; tests wrap it here).
function renderKeyValueEditor(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

const rows: KeyValuePair[] = [
  { key: "API_KEY", value: "secret-1" },
  { key: "REGION", value: "eu" },
];

describe("KeyValueEditor", () => {
  test("renders one editable pair per row", () => {
    renderKeyValueEditor(<KeyValueEditor value={rows} onChange={() => {}} />);
    expect(screen.getByDisplayValue("API_KEY")).toBeInTheDocument();
    expect(screen.getByDisplayValue("eu")).toBeInTheDocument();
  });

  test("adds a blank row", () => {
    const onChange = vi.fn();
    renderKeyValueEditor(
      <KeyValueEditor value={rows} onChange={onChange} addLabel="Add variable" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add variable" }));
    expect(onChange).toHaveBeenCalledWith([...rows, { key: "", value: "" }]);
  });

  test("removes a row by index", () => {
    const onChange = vi.fn();
    renderKeyValueEditor(<KeyValueEditor value={rows} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(onChange).toHaveBeenCalledWith([{ key: "REGION", value: "eu" }]);
  });

  test("edits a key/value and emits the patched list", () => {
    const onChange = vi.fn();
    renderKeyValueEditor(<KeyValueEditor value={rows} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Value 2"), { target: { value: "us" } });
    expect(onChange).toHaveBeenCalledWith([
      { key: "API_KEY", value: "secret-1" },
      { key: "REGION", value: "us" },
    ]);
  });

  test("masks values as password and reveals per row when secret", () => {
    renderKeyValueEditor(<KeyValueEditor value={rows} onChange={() => {}} secret />);
    const value1 = screen.getByLabelText("Value 1");
    expect(value1).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show value 1" }));
    expect(value1).toHaveAttribute("type", "text");
    // The other row stays masked.
    expect(screen.getByLabelText("Value 2")).toHaveAttribute("type", "password");
  });

  test("renders an empty state with no rows", () => {
    renderKeyValueEditor(<KeyValueEditor value={[]} onChange={() => {}} />);
    expect(screen.getByText("No rows yet.")).toBeInTheDocument();
  });

  test("does not mask values when not secret", () => {
    renderKeyValueEditor(<KeyValueEditor value={rows} onChange={() => {}} />);
    expect(screen.getByLabelText("Value 1")).toHaveAttribute("type", "text");
    expect(screen.queryByRole("button", { name: /Show value/ })).not.toBeInTheDocument();
  });
});
