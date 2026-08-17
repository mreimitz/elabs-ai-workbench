import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { InlineError } from "./InlineError";
import { KpiStat } from "./KpiStat";

// Light render smoke tests proving the harness can mount `@elabs-ai/components-ui`-based components in jsdom.
// (Heavy `@elabs-ai/components-editor`/`@elabs-ai/components-charts` surfaces are deliberately NOT exercised here.)

describe("InlineError", () => {
  test("renders the title + detail and wires the retry callback", () => {
    const onRetry = vi.fn();
    render(<InlineError title="Couldn't load findings" detail="HTTP 500" onRetry={onRetry} />);

    expect(screen.getByText("Couldn't load findings")).toBeInTheDocument();
    expect(screen.getByText("HTTP 500")).toBeInTheDocument();
    // Semantic alert role from the brand Alert (variant="destructive").
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("omits the retry affordance when no handler is given", () => {
    render(<InlineError title="Couldn't load" />);
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});

describe("KpiStat", () => {
  test("renders the label, value, and optional unit as a term/definition pair", () => {
    render(<KpiStat label="Tokens" value="1,234" sub="in" />);
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("in")).toBeInTheDocument();
  });
});
