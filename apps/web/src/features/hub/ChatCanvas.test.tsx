import { TooltipProvider } from "@elabs-ai/components-ui";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";
import { ChatCanvas } from "./ChatCanvas";

// The floating "Show the rail" control is an `IconButton` (D-TB5), which wraps every control in a
// Radix `Tooltip` — that throws without an ancestor `TooltipProvider` (the app root mounts one).
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("ChatCanvas (WP1.3, D-HUX12)", () => {
  test("renders the dot-grid layer at the default (normal) decoration level", () => {
    render(
      <ChatCanvas>
        <div data-testid="transcript">transcript</div>
      </ChatCanvas>,
    );
    expect(screen.getByTestId("chat-canvas-grid")).toBeInTheDocument();
    expect(screen.getByTestId("transcript")).toBeInTheDocument();
  });

  test("the grid layer carries the semantic --canvas-grid token (no raw colors)", () => {
    render(
      <ChatCanvas>
        <div>transcript</div>
      </ChatCanvas>,
    );
    const grid = screen.getByTestId("chat-canvas-grid");
    const backgroundImage = grid.style.backgroundImage;
    expect(backgroundImage).toContain("var(--canvas-grid)");
    expect(backgroundImage).not.toMatch(/#[0-9a-fA-F]/);
    expect(backgroundImage).not.toMatch(/rgba?\(/);
  });

  test("decoration level minimal (0) removes the grid entirely — a real DOM removal, not a fade", () => {
    render(
      <ChatCanvas decorationLevel={0}>
        <div data-testid="transcript">transcript</div>
      </ChatCanvas>,
    );
    expect(screen.queryByTestId("chat-canvas-grid")).not.toBeInTheDocument();
    // The transcript itself is untouched by the decoration gate.
    expect(screen.getByTestId("transcript")).toBeInTheDocument();
  });

  test("any non-zero decoration level shows the grid", () => {
    render(
      <ChatCanvas decorationLevel={3}>
        <div>transcript</div>
      </ChatCanvas>,
    );
    expect(screen.getByTestId("chat-canvas-grid")).toBeInTheDocument();
  });

  test("the grid layer is non-interactive and hidden from assistive tech (decorative)", () => {
    render(
      <ChatCanvas>
        <div>transcript</div>
      </ChatCanvas>,
    );
    const grid = screen.getByTestId("chat-canvas-grid");
    expect(grid).toHaveAttribute("aria-hidden", "true");
    expect(grid.className).toContain("pointer-events-none");
  });

  test("renders exactly the caller's transcript content — no scroll container of its own", () => {
    render(
      <ChatCanvas>
        <div data-testid="only-child">the transcript owns its own scroll</div>
      </ChatCanvas>,
    );
    expect(screen.getByTestId("only-child")).toHaveTextContent(
      "the transcript owns its own scroll",
    );
  });

  test("no floating 'Show the rail' control by default (the rail is not hidden)", () => {
    render(
      <ChatCanvas>
        <div>transcript</div>
      </ChatCanvas>,
    );
    expect(screen.queryByRole("button", { name: "Show the rail" })).not.toBeInTheDocument();
  });

  test("the floating 'Show the rail' control appears only when railHidden and calls onShowRail", () => {
    const onShowRail = vi.fn();
    render(
      <ChatCanvas railHidden onShowRail={onShowRail}>
        <div data-testid="transcript">transcript</div>
      </ChatCanvas>,
    );
    const button = screen.getByRole("button", { name: "Show the rail" });
    expect(button).toBeInTheDocument();
    // It sits above the transcript layer (z-20 > the transcript's z-10) but doesn't block it.
    expect(button.className).toContain("z-20");
    fireEvent.click(button);
    expect(onShowRail).toHaveBeenCalledTimes(1);
  });

  test("no floating control when railHidden but no onShowRail handler is supplied", () => {
    render(
      <ChatCanvas railHidden>
        <div>transcript</div>
      </ChatCanvas>,
    );
    expect(screen.queryByRole("button", { name: "Show the rail" })).not.toBeInTheDocument();
  });
});
