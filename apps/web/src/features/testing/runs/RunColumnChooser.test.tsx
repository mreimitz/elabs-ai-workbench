import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@brand/ui";
import { DEFAULT_RUN_COLUMNS_PREFERENCE, RUN_TABLE_COLUMNS } from "./run-columns";
import { RunColumnChooser } from "./RunColumnChooser";

// jsdom omits matchMedia — Radix (DropdownMenu/Select) reads it.
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

function openViaKeyboard(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

function renderChooser(preference = DEFAULT_RUN_COLUMNS_PREFERENCE) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <RunColumnChooser preference={preference} onChange={onChange} />
    </TooltipProvider>,
  );
  return { onChange };
}

describe("RunColumnChooser", () => {
  // design-remediation T8 — every optional column is still OFFERED (the capability isn't deleted),
  // but the default no longer checks all of them: it leads with the triage set (Status/Cost/Started/
  // Duration), leaving Type/Environment/Turns/Tools/Tokens available-but-off by default.
  test("every optional column is offered; the default-visible triage set is checked, the rest unchecked", async () => {
    renderChooser();
    openViaKeyboard(screen.getByRole("button", { name: "Columns" }));
    for (const label of ["Type", "Environment", "Status", "Turns", "Tools", "Tokens", "Cost", "Started", "Duration"]) {
      const checkbox = await screen.findByRole("checkbox", { name: label });
      const expectedChecked = ["Status", "Cost", "Started", "Duration"].includes(label);
      expect(checkbox).toHaveAttribute("data-state", expectedChecked ? "checked" : "unchecked");
    }
  });

  test("unchecking a default-visible column removes it from `visible`", async () => {
    const { onChange } = renderChooser();
    openViaKeyboard(screen.getByRole("button", { name: "Columns" }));
    // Cost is in the default-visible set — unchecking it removes it.
    const costCheckbox = await screen.findByRole("checkbox", { name: "Cost" });
    fireEvent.click(costCheckbox);
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_RUN_COLUMNS_PREFERENCE,
      visible: DEFAULT_RUN_COLUMNS_PREFERENCE.visible.filter((c) => c !== "cost"),
    });
  });

  test("checking a column that's off by default adds it to `visible`", async () => {
    const { onChange } = renderChooser();
    openViaKeyboard(screen.getByRole("button", { name: "Columns" }));
    // Tools is NOT default-visible now — checking it opts it back in. The chooser re-canonicalizes
    // `visible` to the fixed RUN_TABLE_COLUMNS order, so compute the expectation the same way.
    const toolsCheckbox = await screen.findByRole("checkbox", { name: "Tools" });
    fireEvent.click(toolsCheckbox);
    const expectedVisible = RUN_TABLE_COLUMNS.filter((k) =>
      [...DEFAULT_RUN_COLUMNS_PREFERENCE.visible, "tools"].includes(k),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_RUN_COLUMNS_PREFERENCE,
      visible: expectedVisible,
    });
  });

  test("a column already hidden shows unchecked", async () => {
    renderChooser({ visible: ["status"], previewMode: "none" });
    openViaKeyboard(screen.getByRole("button", { name: "Columns" }));
    const statusCheckbox = await screen.findByRole("checkbox", { name: "Status" });
    expect(statusCheckbox).toHaveAttribute("data-state", "checked");
    const turnsCheckbox = screen.getByRole("checkbox", { name: "Turns" });
    expect(turnsCheckbox).toHaveAttribute("data-state", "unchecked");
  });

  test("changing the preview-cell mode calls onChange with the new mode", async () => {
    const { onChange } = renderChooser();
    openViaKeyboard(screen.getByRole("button", { name: "Columns" }));
    const select = await screen.findByRole("combobox", { name: "Preview cell content" });
    openViaKeyboard(select);
    fireEvent.click(await screen.findByRole("option", { name: "Search snippet" }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_RUN_COLUMNS_PREFERENCE, previewMode: "snippet" });
  });
});
