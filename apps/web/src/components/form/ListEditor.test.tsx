import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { ListEditor } from "./ListEditor";

// The remove-row control is an `IconButton` (D-TB5), which renders a Radix `Tooltip` that needs a
// `TooltipProvider` ancestor (the app root mounts one; tests wrap it here).
function renderListEditor(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("ListEditor", () => {
  test("renders one input per string", () => {
    renderListEditor(<ListEditor value={["--verbose", "--port=8080"]} onChange={() => {}} />);
    expect(screen.getByDisplayValue("--verbose")).toBeInTheDocument();
    expect(screen.getByDisplayValue("--port=8080")).toBeInTheDocument();
  });

  test("appends a blank row", () => {
    const onChange = vi.fn();
    renderListEditor(
      <ListEditor value={["--verbose"]} onChange={onChange} addLabel="Add arg" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add arg" }));
    expect(onChange).toHaveBeenCalledWith(["--verbose", ""]);
  });

  test("removes a row by index", () => {
    const onChange = vi.fn();
    renderListEditor(<ListEditor value={["a", "b", "c"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove item 2" }));
    expect(onChange).toHaveBeenCalledWith(["a", "c"]);
  });

  test("edits a row in place", () => {
    const onChange = vi.fn();
    renderListEditor(<ListEditor value={["a", "b"]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Item 1"), { target: { value: "A!" } });
    expect(onChange).toHaveBeenCalledWith(["A!", "b"]);
  });

  test("turns spellcheck off by default on arg/identifier content", () => {
    renderListEditor(<ListEditor value={["--flag"]} onChange={() => {}} />);
    expect(screen.getByLabelText("Item 1")).toHaveAttribute("spellcheck", "false");
  });

  test("renders an empty state with no items", () => {
    renderListEditor(<ListEditor value={[]} onChange={() => {}} />);
    expect(screen.getByText("No items yet.")).toBeInTheDocument();
  });
});
