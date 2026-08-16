import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import { TagInput } from "./TagInput";

// The chip remove control is an `IconButton` (D-TB5), which renders a Radix `Tooltip` that needs a
// `TooltipProvider` ancestor (the app root mounts one; tests wrap it here).
function renderTagInput(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

function input() {
  return screen.getByLabelText("Tags") as HTMLInputElement;
}

describe("TagInput", () => {
  test("renders existing tags as chips", () => {
    renderTagInput(<TagInput value={["alpha", "beta"]} onChange={() => {}} aria-label="Tags" />);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  test("commits a tag on Enter", () => {
    const onChange = vi.fn();
    renderTagInput(<TagInput value={[]} onChange={onChange} aria-label="Tags" />);
    fireEvent.change(input(), { target: { value: "gamma" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["gamma"]);
  });

  test("commits a tag on comma keypress", () => {
    const onChange = vi.fn();
    renderTagInput(<TagInput value={["a"]} onChange={onChange} aria-label="Tags" />);
    fireEvent.change(input(), { target: { value: "b" } });
    fireEvent.keyDown(input(), { key: "," });
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });

  test("splits a pasted comma-separated blob into several tags", () => {
    const onChange = vi.fn();
    renderTagInput(<TagInput value={[]} onChange={onChange} aria-label="Tags" />);
    // A change event whose value already carries a delimiter commits immediately (paste path).
    fireEvent.change(input(), { target: { value: "one, two ,three" } });
    expect(onChange).toHaveBeenCalledWith(["one", "two", "three"]);
  });

  test("trims whitespace and drops empty tokens", () => {
    const onChange = vi.fn();
    renderTagInput(<TagInput value={[]} onChange={onChange} aria-label="Tags" />);
    fireEvent.change(input(), { target: { value: "  spaced  " } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["spaced"]);
  });

  test("dedupes by default", () => {
    const onChange = vi.fn();
    renderTagInput(<TagInput value={["dup"]} onChange={onChange} aria-label="Tags" />);
    fireEvent.change(input(), { target: { value: "dup" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("Backspace on an empty field removes the last chip", () => {
    const onChange = vi.fn();
    renderTagInput(<TagInput value={["x", "y"]} onChange={onChange} aria-label="Tags" />);
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith(["x"]);
  });

  test("removes a specific chip via its remove button", () => {
    const onChange = vi.fn();
    renderTagInput(<TagInput value={["x", "y"]} onChange={onChange} aria-label="Tags" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove x" }));
    expect(onChange).toHaveBeenCalledWith(["y"]);
  });
});
