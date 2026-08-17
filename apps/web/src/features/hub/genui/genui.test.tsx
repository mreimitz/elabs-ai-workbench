// Assistant Hub (WP2.6, R-GUI1–8) — the web declarative-GenUI renderer: the allowlisted registry (the
// render-time security boundary), streaming/recovery states, and the two-tier interactivity state hook.
// `@elabs-ai/components-charts` (AutoChart → @visx crashes in jsdom) + the heavy `@elabs-ai/components-ai` message parts are stubbed
// with faithful DIV/SPAN stubs (no raw table/button — brand-ui-only applies to test files too); `@elabs-ai/components-ui`
// is REAL (Card/Alert/Heading/Text/MetricCard render fine in jsdom). Interactivity is exercised via the
// pure `useGenuiWidgetState` hook (renderHook), not by driving the stubbed MessageForm.
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@elabs-ai/components-charts", () => ({
  AutoChart: ({ spec }: { spec: { type?: string } }) => (
    <div data-testid="chart">chart:{spec?.type ?? "auto"}</div>
  ),
}));

vi.mock("@elabs-ai/components-ai", () => ({
  Shimmer: ({ children }: { children?: ReactNode }) => <output>{children}</output>,
  MessageTable: ({
    spec,
  }: {
    spec: { columns?: { key: string; label?: string }[]; rows?: Record<string, unknown>[] };
  }) => (
    <div data-testid="table">
      {(spec?.rows ?? []).map((r, i) => (
        <div key={i}>
          {(spec?.columns ?? []).map((c) => (
            <span key={c.key}>{String(r[c.key] ?? "")}</span>
          ))}
        </div>
      ))}
    </div>
  ),
  MessageForm: ({ spec, submitted }: { spec: { formName: string }; submitted?: boolean }) => (
    <div data-testid="form" data-form-name={spec.formName}>
      {submitted ? <span>submitted</span> : null}
    </div>
  ),
}));

import type { HubToolPart } from "@mcp-token-footprint/shared";
import { HUB_GENUI_COMPONENT_IDS } from "@mcp-token-footprint/shared";
import { GenUiPart } from "./GenUiPart";
import { GENUI_RENDERER_IDS } from "./registry";
import { useGenuiWidgetState } from "./use-genui-state";

// ── R-GUI1: the renderer registry covers EXACTLY the shared catalog (can't drift) ───────────────────

test("R-GUI1: the web renderer registry covers exactly the shared catalog ids", () => {
  expect([...GENUI_RENDERER_IDS].sort()).toEqual([...HUB_GENUI_COMPONENT_IDS].sort());
});

function genuiToolPart(root: unknown, over: Partial<HubToolPart> = {}): HubToolPart {
  return {
    type: "tool_call",
    toolCallId: "w1",
    toolName: "present",
    source: "genui",
    state: "output-available",
    args: { root },
    ...over,
  };
}

// ── R-GUI2/3/4: allowlist + valid rendering + streaming + recovery ──────────────────────────────────

describe("GenUiPart rendering", () => {
  test("renders a valid mixed widget (Heading/Text/Table/StatGroup/Chart)", async () => {
    render(
      <GenUiPart
        toolPart={genuiToolPart({
          $type: "Stack",
          children: [
            { $type: "Heading", props: { text: "Quarterly revenue" } },
            { $type: "Text", props: { text: "Up and to the right." } },
            {
              $type: "Table",
              props: { columns: [{ key: "m", label: "Month" }], rows: [{ m: "Jan" }, { m: "Feb" }] },
            },
            { $type: "StatGroup", props: { stats: [{ label: "MRR", value: "$42k", delta: "+12%" }] } },
            { $type: "Chart", props: { spec: { type: "bar", x: "m", series: ["v"], data: [{ m: "Jan", v: 1 }] } } },
          ],
        })}
        messageId="m1"
      />,
    );
    expect(screen.getByText("Quarterly revenue")).toBeTruthy();
    expect(screen.getByText("Up and to the right.")).toBeTruthy();
    expect(screen.getByTestId("table")).toBeTruthy();
    expect(screen.getByText("Jan")).toBeTruthy();
    expect(screen.getByText("$42k")).toBeTruthy();
    // The chart lazy-loads @elabs-ai/components-charts — resolve the Suspense boundary before asserting.
    expect((await screen.findByTestId("chart")).textContent).toContain("bar");
  });

  test("R-GUI2 security: an unknown component renders NOTHING (allowlist)", () => {
    const { container } = render(<GenUiPart toolPart={genuiToolPart({ $type: "script", props: { src: "x" } })} />);
    expect(container.querySelector("[role='group']")).toBeNull();
    expect(container.textContent).toBe("");
  });

  test("R-GUI4: valid portions still render when a child is invalid (no null holes)", () => {
    render(
      <GenUiPart
        toolPart={genuiToolPart({
          $type: "Stack",
          children: [
            { $type: "Heading", props: { text: "Kept heading" } },
            { $type: "Bogus", props: {} },
            { $type: "Text", props: { text: "Kept text" } },
          ],
        })}
      />,
    );
    expect(screen.getByText("Kept heading")).toBeTruthy();
    expect(screen.getByText("Kept text")).toBeTruthy();
    expect(screen.queryByText("Bogus")).toBeNull();
  });

  test("R-GUI4: an exhausted-repair tool part renders the honest recovery card", () => {
    render(
      <GenUiPart
        toolPart={genuiToolPart(
          { $type: "Nope" },
          { modelContent: { presented: false, recovery: "exhausted" }, state: "output-available" },
        )}
      />,
    );
    expect(screen.getByText("Couldn’t render this widget")).toBeTruthy();
  });

  test("a settled output-error (repairing) renders nothing", () => {
    const { container } = render(
      <GenUiPart toolPart={genuiToolPart({ $type: "Nope" }, { state: "output-error", isError: true })} />,
    );
    expect(container.textContent).toBe("");
  });

  test("R-GUI3: a still-streaming, not-yet-renderable widget shows a shimmer", () => {
    render(<GenUiPart toolPart={genuiToolPart({}, { state: "input-streaming", args: undefined })} streaming />);
    expect(screen.getByText("Preparing a widget…")).toBeTruthy();
  });
});

// ── R-GUI5: two-tier interactivity (client ops never re-enter the model; submit is dual-audience) ────

describe("useGenuiWidgetState (R-GUI5)", () => {
  test("a field change persists ui_state (client op) but does NOT submit to the model", () => {
    const onPersistUiState = vi.fn();
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useGenuiWidgetState({ messageId: "m1", widgetKey: "w1", handlers: { onPersistUiState, onSubmit } }),
    );
    act(() => result.current.ctx.onFormChange("f", { a: 1 }));
    expect(onPersistUiState).toHaveBeenCalledWith("m1", "w1", { forms: { f: { values: { a: 1 } } } });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a submit sends a DUAL-AUDIENCE message (human line + stamped formState) and marks submitted", () => {
    const onPersistUiState = vi.fn();
    const onSubmit = vi.fn();
    const { result } = renderHook(() =>
      useGenuiWidgetState({ messageId: "m1", widgetKey: "w1", handlers: { onPersistUiState, onSubmit } }),
    );
    act(() =>
      result.current.ctx.onFormSubmit({
        formName: "classify",
        values: { label: "bug" },
        humanMessage: "Classified as bug.",
        llmMessage: "User classified the item.",
      }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0]![0] as string;
    expect(sent).toMatch(/^Classified as bug\./);
    expect(sent).toMatch(/User classified the item\./);
    expect(sent).toMatch(/\[Current state of "classify" \(id: w1\): \{"label":"bug"\}\]/);
    expect(result.current.state.forms.classify?.submitted).toBe(true);
  });

  test("rehydrates from replayed ui_state; is read-only without handlers", () => {
    const { result } = renderHook(() =>
      useGenuiWidgetState({ messageId: "m1", initialState: { forms: { f: { values: { a: 2 } } } } }),
    );
    expect(result.current.ctx.formValues("f")).toEqual({ a: 2 });
    expect(result.current.ctx.interactive).toBe(false);
  });
});
