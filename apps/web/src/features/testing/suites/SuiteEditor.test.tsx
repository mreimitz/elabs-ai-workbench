import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Suite } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { SuiteEditor } from "./SuiteEditor";

// jsdom omits matchMedia — Radix (Dialog) reads it (mirrors RunLauncher.test.tsx's identical stub).
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

const EXISTING_SUITE: Suite = {
  id: "suite-1",
  name: "Regression suite",
  config: { repetitions: 1, maxConcurrency: 3 },
  testIds: [],
  scenarioIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function renderEditor(suite: Suite | null) {
  return render(
    <TooltipProvider>
      <SuiteEditor
        open
        suite={suite}
        tests={[]}
        scenarios={[]}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("SuiteEditor — cost cap defaults (T11, Error Prevention)", () => {
  test("a NEW suite seeds a modest default cap rather than 'no cap'", async () => {
    renderEditor(null);
    const capField = (await screen.findByLabelText("Cost cap (USD)")) as HTMLInputElement;
    expect(capField.value).toBe("5");
  });

  test("an EXISTING suite with no cap keeps its 'no cap' — the default never overwrites it", async () => {
    renderEditor(EXISTING_SUITE);
    const capField = (await screen.findByLabelText("Cost cap (USD)")) as HTMLInputElement;
    expect(capField.value).toBe("");
    expect(capField).toHaveAttribute("placeholder", "No cap");
  });

  test("an EXISTING suite's own cap is preserved exactly", async () => {
    renderEditor({ ...EXISTING_SUITE, config: { ...EXISTING_SUITE.config, aggregateCostCapUsd: 42 } });
    const capField = (await screen.findByLabelText("Cost cap (USD)")) as HTMLInputElement;
    expect(capField.value).toBe("42");
  });
});

/**
 * Edit-suite name-selection (design-remediation T11, P1) — the dialog used to open with the name
 * field focused AND fully selected (Radix's default `FocusScope` behavior calls
 * `element.focus({select: true})` on the first tabbable descendant), so one keystroke replaced the
 * suite's existing name. `SuiteEditor` now overrides `onOpenAutoFocus` to focus WITHOUT selecting.
 */
describe("SuiteEditor — Edit suite does not auto-select the name field (T11)", () => {
  test("the name field receives focus, but its text is NOT selected (a collapsed caret, not a range)", async () => {
    renderEditor(EXISTING_SUITE);
    const nameField = (await screen.findByLabelText("Name")) as HTMLInputElement;

    await waitFor(() => expect(document.activeElement).toBe(nameField));
    // A collapsed caret (start === end) — Radix's default `{ select: true }` would instead select the
    // whole value (selectionStart 0, selectionEnd === value.length), which the bug depended on.
    expect(nameField.selectionStart).toBe(nameField.selectionEnd);
  });
});
