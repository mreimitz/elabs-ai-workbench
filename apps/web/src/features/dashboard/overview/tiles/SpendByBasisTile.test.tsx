import type { ReactNode } from "react";
import { render as rtlRender, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { RunHealthData, SectionEnvelope } from "../overview-contract";
import { SpendByBasisTile } from "./SpendByBasisTile";

/**
 * dashboard-bento WP 1.2 — `SpendByBasisTile`.
 *
 * The load-bearing assertion here is **D-OB14**: `api_exact` (money billed) and
 * `subscription_reference` (a shadow price for a run that cost $0 at the margin) are different kinds
 * of number and must never be added. This suite therefore does not merely check that two rows
 * render — it asserts the SUM never appears anywhere in the tile, which is the only way a blended
 * total could reach an operator's eye.
 *
 * No chart is stubbed because this tile draws none: it is figures and text, so nothing here is
 * hidden behind the charts mock.
 */

function render(ui: ReactNode) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

function runHealth(over: Partial<RunHealthData> = {}): RunHealthData {
  return {
    runCount: 12,
    passRatePercent: 90,
    passRateDeltaPoints: null,
    runsOverTime: [],
    costByBasis: [
      { basis: "api_exact", currentUsd: 12.5, previousUsd: 9.25 },
      { basis: "subscription_reference", currentUsd: 3.25, previousUsd: 4.0 },
    ],
    ...over,
  };
}

function ready(over: Partial<RunHealthData> = {}): SectionEnvelope<RunHealthData> {
  return { state: "ready", data: runHealth(over), error: null };
}

describe("SpendByBasisTile — self-hiding", () => {
  test("an EMPTY section renders nothing", () => {
    const { container } = render(
      <SpendByBasisTile section={{ state: "empty", data: null, error: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("a ready section with NO cost recorded renders nothing (a header with no rows is an empty box)", () => {
    const { container } = render(<SpendByBasisTile section={ready({ costByBasis: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SpendByBasisTile — one row per basis, never a blend (D-OB14)", () => {
  test("renders each basis with its own figure", () => {
    render(<SpendByBasisTile section={ready()} />);
    expect(screen.getByText("$ Exact (API-metered)")).toBeInTheDocument();
    expect(screen.getByText("$ Est. (subscription reference)")).toBeInTheDocument();
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText("$3.25")).toBeInTheDocument();
  });

  test("the SUM of the two bases appears nowhere — the tile has no blended total", () => {
    render(<SpendByBasisTile section={ready()} />);
    // 12.50 + 3.25 = 15.75, and the previous windows 9.25 + 4.00 = 13.25.
    expect(screen.queryByText(/15\.75/)).not.toBeInTheDocument();
    expect(screen.queryByText(/13\.25/)).not.toBeInTheDocument();
    // …nor a summed Δ (3.25 + −0.75 = 2.50); each row's Δ stands alone.
    expect(screen.queryByText(/\$2\.50$/)).not.toBeInTheDocument();
  });

  test("each row's Δ is computed against ITS OWN previous window", () => {
    render(<SpendByBasisTile section={ready()} />);
    expect(screen.getByText("+$3.25")).toBeInTheDocument(); // 12.50 − 9.25
    expect(screen.getByText("-$0.75")).toBeInTheDocument(); // 3.25 − 4.00
  });

  test("spend going UP is the worse outcome; going down is better (D-IC3 tones, sign always in text)", () => {
    render(<SpendByBasisTile section={ready()} />);
    expect(screen.getByText("+$3.25").className).toContain("text-warning-text");
    expect(screen.getByText("-$0.75").className).toContain("text-success-text");
  });

  test("no comparable previous window renders NO delta — never '+$0.00'", () => {
    render(
      <SpendByBasisTile
        section={ready({
          costByBasis: [{ basis: "api_exact", currentUsd: 12.5, previousUsd: null }],
        })}
      />,
    );
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.queryByText(/\+\$/)).not.toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  test("an unchanged basis says so in words", () => {
    render(
      <SpendByBasisTile
        section={ready({
          costByBasis: [{ basis: "api_exact", currentUsd: 12.5, previousUsd: 12.5 }],
        })}
      />,
    );
    expect(screen.getByText("No change")).toBeInTheDocument();
  });

  test("the subscription row carries the app's accuracy marker, so the distinction is stated not implied", () => {
    render(<SpendByBasisTile section={ready()} />);
    expect(screen.getByText("est.")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("subscription reference"),
    );
  });

  test("an API-only window shows no subscription marker", () => {
    render(
      <SpendByBasisTile
        section={ready({ costByBasis: [{ basis: "api_exact", currentUsd: 1, previousUsd: null }] })}
      />,
    );
    expect(screen.queryByText("est.")).not.toBeInTheDocument();
  });

  test("an unknown basis still gets a readable label rather than a raw id", () => {
    render(
      <SpendByBasisTile
        section={ready({
          costByBasis: [{ basis: "future_basis", currentUsd: 2, previousUsd: null }],
        })}
      />,
    );
    expect(screen.getByText("Future basis")).toBeInTheDocument();
  });
});

describe("SpendByBasisTile — load and error states", () => {
  test("loading renders a layout-shaped placeholder, announced once, with no figures", () => {
    const { container } = render(
      <SpendByBasisTile section={{ state: "loading", data: null, error: null }} />,
    );
    // `<output>` is the app's semantic live region (implicit role="status").
    expect(container.querySelector("output")).not.toBeNull();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByText("Spend")).toBeInTheDocument();
  });

  test("an errored section surfaces its message", () => {
    render(
      <SpendByBasisTile section={{ state: "error", data: null, error: "cost metrics failed" }} />,
    );
    expect(screen.getByText("Cost unavailable")).toBeInTheDocument();
    expect(screen.getByText("cost metrics failed")).toBeInTheDocument();
  });
});
