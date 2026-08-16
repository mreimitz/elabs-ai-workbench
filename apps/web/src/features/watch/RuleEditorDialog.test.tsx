import type { ComponentProps, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { WatchRule, WatchWindowPreview } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

// jsdom can't resolve @brand/charts' @visx deep imports (the established `GuardrailStopsPanel.test`/
// dashboard-panel precedent) — the Preview section's `WindowPreviewStrip` renders a real `BarChart`,
// so it's stubbed the same way here. Production is untouched; the real build proves the real chart.
vi.mock("@brand/charts", () => ({
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  BarXAxis: () => null,
  Grid: () => null,
  ChartTooltip: () => null,
}));

// The editor's option lists (RunFilterBar reuse) + collection pickers are best-effort fetches — stub
// them to empty so every test is deterministic and hits no real network. `createWatchRule`/
// `updateWatchRule`/`previewWatchWindow` are the round-trip surface under test.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listScenarios: vi.fn().mockResolvedValue([]),
    listSuites: vi.fn().mockResolvedValue([]),
    listServers: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    listCollections: vi.fn().mockResolvedValue([]),
    createWatchRule: vi.fn(),
    updateWatchRule: vi.fn(),
    previewWatchWindow: vi.fn(),
  };
});

import { ApiError, createWatchRule, previewWatchWindow, updateWatchRule } from "../../lib/api";
import { RuleEditorDialog } from "./RuleEditorDialog";

const mockCreate = vi.mocked(createWatchRule);
const mockUpdate = vi.mocked(updateWatchRule);
const mockPreview = vi.mocked(previewWatchWindow);

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockPreview.mockReset();
});

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

function renderEditor(props: Partial<ComponentProps<typeof RuleEditorDialog>> = {}) {
  const onSaved = vi.fn();
  const utils = render(
    <TooltipProvider>
      <RuleEditorDialog
        open
        onOpenChange={() => {}}
        mode="create"
        rule={null}
        onSaved={onSaved}
        {...props}
      />
    </TooltipProvider>,
  );
  return { ...utils, onSaved };
}

const RULE_WITH_WEBHOOK: WatchRule = {
  id: "rule-1",
  name: "High error rate",
  enabled: true,
  trigger: "on_terminal",
  filter: { outcome: ["error"] },
  actions: [{ type: "webhook", secretRef: "ref-1", template: "hi" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function samplePreview(fired: boolean): WatchWindowPreview {
  return {
    window: {
      measure: "errorRate",
      bucket: "hour",
      window: "1h",
      op: ">=",
      threshold: 0.3,
      cooldownMinutes: 60,
    },
    bucket: "hour",
    windows: [
      { windowStart: "2026-07-10T00:00:00Z", windowEnd: "2026-07-10T01:00:00Z", value: fired ? 0.5 : 0.1, n: 10, wouldHaveFired: fired },
    ],
  };
}

describe("RuleEditorDialog — create round-trip (on_terminal)", () => {
  test("fills name + enables an action, then Create rule builds the expected input", async () => {
    mockCreate.mockResolvedValueOnce({ ...RULE_WITH_WEBHOOK, id: "new-rule", actions: [{ type: "pin" }] });
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pin run" }));

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const input = mockCreate.mock.calls[0]?.[0];
    expect(input?.name).toBe("New rule");
    expect(input?.trigger).toBe("on_terminal");
    expect(input?.actions).toEqual([{ type: "pin" }]);
    expect(input?.window).toBeUndefined();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  test("Create rule stays disabled with no name", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();
  });
});

describe("RuleEditorDialog — windowed save is gated behind the historical preview", () => {
  test("Save is disabled before a preview runs, and after changing the config again", async () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Windowed rule" } });
    fireEvent.click(screen.getByRole("radio", { name: "Windowed threshold" }));

    // Preview tab now exists; Save is disabled with no preview yet.
    expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();

    mockPreview.mockResolvedValueOnce(samplePreview(false));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Run preview" }));

    await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create rule" })).not.toBeDisabled());

    // Changing the threshold after a preview invalidates it again (the signature no longer matches) —
    // back to the Trigger tab, where the window config lives. `NumberInput` only COMMITS on blur
    // (its `onChange` just updates the displayed text — see @brand/ui's `handleBlur`), so the change
    // must be followed by a blur for the new value to actually reach the form state.
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    const thresholdInput = screen.getByLabelText("Threshold");
    fireEvent.change(thresholdInput, { target: { value: "0.9" } });
    fireEvent.blur(thresholdInput);
    expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();
  });

  test("after a fresh preview, Create rule actually saves a windowed rule with a derived bucket", async () => {
    mockPreview.mockResolvedValueOnce(samplePreview(true));
    mockCreate.mockResolvedValueOnce({
      ...RULE_WITH_WEBHOOK,
      id: "new-rule",
      trigger: "windowed",
      actions: [{ type: "pin" }],
    });
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Windowed rule" } });
    fireEvent.click(screen.getByRole("radio", { name: "Windowed threshold" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pin run" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Run preview" }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const input = mockCreate.mock.calls[0]?.[0];
    expect(input?.trigger).toBe("windowed");
    expect(input?.window?.bucket).toBe("hour"); // derived from the default 1h window
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});

describe("RuleEditorDialog — edit round-trip preserves an untouched webhook secret", () => {
  test("editing only the name omits `actions` from the PATCH", async () => {
    mockUpdate.mockResolvedValueOnce(RULE_WITH_WEBHOOK);
    renderEditor({ mode: "edit", rule: RULE_WITH_WEBHOOK });

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "High error rate (renamed)" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [id, patch] = mockUpdate.mock.calls[0] ?? [];
    expect(id).toBe("rule-1");
    expect(patch?.name).toBe("High error rate (renamed)");
    expect("actions" in (patch ?? {})).toBe(false);
  });

  test("touching the Actions step includes `actions` in the PATCH", async () => {
    mockUpdate.mockResolvedValueOnce(RULE_WITH_WEBHOOK);
    renderEditor({ mode: "edit", rule: RULE_WITH_WEBHOOK });

    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    // The webhook action is enabled but write-only (url starts blank) — re-enter it to save cleanly.
    fireEvent.change(await screen.findByLabelText("URL"), {
      target: { value: "https://hooks.example.com/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    const [, patch] = mockUpdate.mock.calls[0] ?? [];
    expect(patch?.actions).toEqual([{ type: "webhook", url: "https://hooks.example.com/x", template: "hi" }]);
  });
});

describe("RuleEditorDialog — duplicate drops the webhook secret", () => {
  test("name is prefixed and the webhook action starts unchecked", async () => {
    renderEditor({ mode: "duplicate", rule: RULE_WITH_WEBHOOK });

    expect(screen.getByLabelText("Name")).toHaveValue("Copy of High error rate");
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByRole("checkbox", { name: "Webhook" })).not.toBeChecked();
  });
});

describe("RuleEditorDialog — invalid config surfaces zod detail inline", () => {
  test("a 400 with `issues` renders each field path + message in the dialog body", async () => {
    mockCreate.mockRejectedValueOnce(
      new ApiError(400, "Validation failed", [
        { path: ["filter", "dateFrom"], message: "Invalid datetime" },
      ]),
    );
    renderEditor();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad rule" } });
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pin run" }));
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));

    expect(await screen.findByText("filter.dateFrom: Invalid datetime")).toBeInTheDocument();
  });
});
