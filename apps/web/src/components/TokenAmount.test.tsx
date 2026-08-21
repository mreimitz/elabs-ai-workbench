import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { TokenUsageActual } from "@mcp-token-footprint/shared";
import { describe, expect, it } from "vitest";
import { TokenAmount } from "./TokenAmount";

function renderAmount(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const exact: TokenUsageActual = {
  inputTokens: 1000,
  outputTokens: 100,
  cachedInputTokens: 900,
  cacheReadTokens: 800,
  cacheWriteTokens: 100,
};
const merged: TokenUsageActual = { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 900 };
const none: TokenUsageActual = { inputTokens: 1000, outputTokens: 100 };

describe("TokenAmount", () => {
  it("renders a bare figure with no usage — the pre-RM-33 markup, pixel-stable", () => {
    const { container } = renderAmount(<TokenAmount value={1234} direction="in" />);
    expect(container.textContent).toBe("1,234↑");
    // No tooltip trigger at all — not merely a silent one.
    expect(container.querySelector("[aria-describedby]")).toBeNull();
  });

  it("renders bare when the provider reported no cache at all", () => {
    const { container } = renderAmount(<TokenAmount value={1000} direction="in" usage={none} />);
    expect(container.textContent).toBe("1,000↑");
    expect(container.querySelector("[aria-describedby]")).toBeNull();
  });

  it("describes the exact split, naming a cache WRITE as a premium", () => {
    renderAmount(<TokenAmount value={1000} direction="in" usage={exact} />);
    // The durable copy — present without hover, which is the only version a touch or screen-reader
    // user ever gets.
    const description = document.querySelector(".sr-only")?.textContent ?? "";
    expect(description).toContain("Uncached: 100");
    expect(description).toContain("Cache read: 800");
    expect(description).toContain("0.1×");
    expect(description).toContain("Cache write: 100");
    expect(description).toContain("premium");
    expect(description).toContain("80.0% served from cache");
  });

  it("wires the description with aria-describedby WITHOUT adding a tab stop", () => {
    // A token count is a static readout and a table renders dozens of them; making each focusable
    // would turn scanning the table into an obstacle course (`a11y/noNoninteractiveTabindex`). The
    // breakdown stays reachable because the sr-only node is always in the DOM, not because of focus.
    const { container } = renderAmount(<TokenAmount value={1000} direction="in" usage={exact} />);
    const trigger = container.querySelector("[aria-describedby]") as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute("tabindex")).toBeNull();
    const describedBy = trigger.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)?.textContent).toContain("Cache read: 800");
  });

  it("omits the cache-write line entirely when nothing was written", () => {
    renderAmount(
      <TokenAmount
        value={1000}
        direction="in"
        usage={{ inputTokens: 1000, cacheReadTokens: 900, cacheWriteTokens: 0 }}
      />,
    );
    const description = document.querySelector(".sr-only")?.textContent ?? "";
    expect(description).toContain("Cache read: 900");
    expect(description).not.toContain("Cache write");
  });

  it("says the split is unavailable for a merged record rather than guessing", () => {
    // The failure this prevents: attributing a merged figure to `read` would show a 1.25× premium as
    // a 0.1× discount. Six runs in a real database carry exactly this shape.
    renderAmount(<TokenAmount value={1000} direction="in" usage={merged} />);
    const description = document.querySelector(".sr-only")?.textContent ?? "";
    expect(description).toContain("Cached: 900");
    expect(description).toContain("split unavailable");
    expect(description).not.toContain("Cache read");
    expect(description).not.toContain("served from cache");
  });

  it("never attaches an input breakdown to an OUTPUT figure", () => {
    // Output tokens were generated, not read — input cache economics do not apply to them.
    const { container } = renderAmount(<TokenAmount value={100} direction="out" usage={exact} />);
    expect(container.textContent).toBe("100↓");
    expect(container.querySelector("[aria-describedby]")).toBeNull();
  });

  it("renders without an affix when no direction is given", () => {
    const { container } = renderAmount(<TokenAmount value={4096} />);
    expect(container.textContent).toBe("4,096");
  });

  it("uses tabular-nums so digits line up in a column", () => {
    const { container } = renderAmount(<TokenAmount value={1234} />);
    expect(container.querySelector(".tabular-nums")).not.toBeNull();
  });

  it("keeps the gross figure it was given, never a net one", () => {
    // D-CT1 as a rendering invariant: the component decomposes, it does not subtract.
    renderAmount(<TokenAmount value={1000} direction="in" usage={exact} />);
    expect(screen.getByText(/1,000/)).toBeTruthy();
  });
});
