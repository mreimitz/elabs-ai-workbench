import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { SliderNumber } from "./SliderNumber";

// jsdom has no ResizeObserver; the Radix Slider observes its track size. Stub it for these tests.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

// The reset control is an `IconButton` (D-TB5), which renders a Radix `Tooltip` that needs a
// `TooltipProvider` ancestor (the app root mounts one; tests wrap it here).
function renderSliderNumber(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

// Both the slider (role=slider, a span) and the numeric input (an <input>) carry the same
// accessible name — good a11y, so disambiguate by tag when we want the input.
function numericInput(name: string): HTMLInputElement {
  const el = screen.getAllByLabelText(name).find((e) => e.tagName === "INPUT");
  if (!el) throw new Error(`no numeric input labelled "${name}"`);
  return el as HTMLInputElement;
}

describe("SliderNumber", () => {
  test("renders a slider and a synced numeric input", () => {
    renderSliderNumber(
      <SliderNumber
        value={0.7}
        onChange={() => {}}
        min={0}
        max={1}
        step={0.05}
        aria-label="Temperature"
      />,
    );
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(numericInput("Temperature").value.replace(/[^\d.]/g, "")).toBe("0.7");
  });

  test("shows the provider-default marker and no reset when value is null", () => {
    renderSliderNumber(
      <SliderNumber
        value={null}
        onChange={() => {}}
        min={0}
        max={1}
        step={0.05}
        allowDefault
        aria-label="Temperature"
      />,
    );
    expect(screen.getByText("Provider default")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /reset to provider default/i }),
    ).not.toBeInTheDocument();
  });

  test("shows a reset control once a concrete value is set; clicking it emits null", () => {
    const onChange = vi.fn();
    renderSliderNumber(
      <SliderNumber
        value={0.5}
        onChange={onChange}
        min={0}
        max={1}
        step={0.05}
        allowDefault
        aria-label="Temperature"
      />,
    );
    expect(screen.queryByText("Provider default")).not.toBeInTheDocument();
    const reset = screen.getByRole("button", { name: /reset to provider default/i });
    fireEvent.click(reset);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  test("no reset control and no marker when allowDefault is off", () => {
    renderSliderNumber(
      <SliderNumber
        value={0.5}
        onChange={() => {}}
        min={0}
        max={1}
        step={0.05}
        aria-label="Top P"
      />,
    );
    expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Provider default")).not.toBeInTheDocument();
  });
});
