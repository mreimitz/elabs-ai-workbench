// RM-34 WP 1.3 (D-ET5) — the estimate says where its turn model came from.
//
// Pins the two things that make the line trustworthy: the operator wording for all four bases, and
// the weakest-basis rule for a plan spanning several environments (one unmeasured environment makes
// the summed band partly assumed — the same "one unknown makes the total unknown" rule RM-33 applied
// to suite cache rollups). Plus the case that must claim NOTHING: a response with no measurement on
// it at all, which is every response produced before RM-34 WP 1.2 lands.

import { render, screen } from "@testing-library/react";
import type {
  RunPlanEstimate,
  RunPlanEstimateEnvironment,
  RunPlanTurnBasis,
  RunPlanTurnProfile,
} from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { TurnBasisNote, weakestTurnProfile } from "./turn-basis";

function profile(basis: RunPlanTurnBasis, sampleSize: number): RunPlanTurnProfile {
  return {
    basis,
    sampleSize,
    turns: { low: 4, mid: 6, high: 16 },
    outputTokensPerTurn: 1148,
  };
}

function environment(
  id: string,
  turnProfile?: RunPlanTurnProfile,
): RunPlanEstimateEnvironment {
  return {
    environmentId: id,
    name: `Env ${id}`,
    model: "claude-sonnet-4",
    priced: true,
    footprintTokens: 2000,
    hasCostCap: true,
    tokens: { low: 1000, mid: 2000, high: 4000 },
    costUsd: { low: 0.1, mid: 0.2, high: 0.4 },
    ...(turnProfile ? { turnProfile } : {}),
  };
}

function estimate(environments: RunPlanEstimateEnvironment[]): RunPlanEstimate {
  return {
    testCount: 1,
    environmentCount: environments.length,
    repetitions: 1,
    totalRuns: environments.length,
    tokens: { low: 1000, mid: 2000, high: 4000 },
    costUsd: { low: 0.1, mid: 0.2, high: 0.4 },
    unpricedEnvironmentCount: 0,
    uncappedEnvironmentCount: 0,
    environments,
  };
}

/** The note's sentence spans a `<span className="tabular-nums">`, so match on the whole line. */
function noteText(): string {
  const line = screen.getByRole("paragraph");
  return line.textContent ?? "";
}

describe("TurnBasisNote — the four bases, in operator language", () => {
  test("pair — the narrowest measurement names both the test and the environment", () => {
    render(<TurnBasisNote estimate={estimate([environment("a", profile("pair", 51))])} />);
    expect(noteText()).toBe("Turn count from 51 past runs of this test on this environment.");
  });

  test("environment — measured on the environment, across its tests", () => {
    render(<TurnBasisNote estimate={estimate([environment("a", profile("environment", 79))])} />);
    expect(noteText()).toBe("Turn count from 79 past runs on this environment.");
  });

  test("global — measured across every environment", () => {
    render(<TurnBasisNote estimate={estimate([environment("a", profile("global", 122))])} />);
    expect(noteText()).toBe("Turn count from 122 past runs across all environments.");
  });

  test("default — says plainly that nothing was measured, and gives no count", () => {
    render(<TurnBasisNote estimate={estimate([environment("a", profile("default", 0))])} />);
    expect(noteText()).toBe("Turn count is an assumption — no past runs to measure.");
    // The honest label carries no sample size at all — there is no sample.
    expect(screen.queryByText(/past runs of|past runs on|across all environments/)).toBeNull();
  });

  test("the sample count is tabular-nums and thousands-separated", () => {
    const { container } = render(
      <TurnBasisNote estimate={estimate([environment("a", profile("global", 1234))])} />,
    );
    const count = container.querySelector(".tabular-nums");
    expect(count?.textContent).toBe("1,234");
  });

  test("it is a sentence, not a control — no new tab stop", () => {
    const { container } = render(
      <TurnBasisNote estimate={estimate([environment("a", profile("pair", 51))])} />,
    );
    expect(container.querySelectorAll("button, a, [tabindex]")).toHaveLength(0);
  });
});

describe("TurnBasisNote — claims nothing when there is nothing measured", () => {
  test("an estimate whose environments carry no turnProfile renders exactly as today: nothing", () => {
    const { container } = render(<TurnBasisNote estimate={estimate([environment("a")])} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("a whole plan of unannotated environments (the pre-WP-1.2 wire) renders nothing", () => {
    const { container } = render(
      <TurnBasisNote estimate={estimate([environment("a"), environment("b")])} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("an estimate with no environments at all renders nothing", () => {
    const { container } = render(<TurnBasisNote estimate={estimate([])} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("a null estimate renders nothing", () => {
    const { container } = render(<TurnBasisNote estimate={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("a PARTLY annotated plan claims nothing — one measured environment cannot speak for the sum", () => {
    const { container } = render(
      <TurnBasisNote
        estimate={estimate([environment("a", profile("pair", 51)), environment("b")])}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("weakestTurnProfile — the weakest basis present wins", () => {
  test("a pair environment mixed with a default environment reports DEFAULT", () => {
    const result = weakestTurnProfile(
      estimate([environment("a", profile("pair", 51)), environment("b", profile("default", 0))]),
    );
    expect(result?.basis).toBe("default");
  });

  test("the same mix renders the assumption wording, not the 51-run wording", () => {
    render(
      <TurnBasisNote
        estimate={estimate([
          environment("a", profile("pair", 51)),
          environment("b", profile("default", 0)),
        ])}
      />,
    );
    expect(noteText()).toBe("Turn count is an assumption — no past runs to measure.");
    expect(screen.queryByText(/51/)).toBeNull();
  });

  test("global beats environment beats pair", () => {
    expect(
      weakestTurnProfile(
        estimate([
          environment("a", profile("pair", 51)),
          environment("b", profile("environment", 79)),
        ]),
      )?.basis,
    ).toBe("environment");
    expect(
      weakestTurnProfile(
        estimate([
          environment("a", profile("environment", 79)),
          environment("b", profile("global", 122)),
        ]),
      )?.basis,
    ).toBe("global");
  });

  test("order on the response does not decide it — the weakest wins from either side", () => {
    expect(
      weakestTurnProfile(
        estimate([environment("a", profile("default", 0)), environment("b", profile("pair", 51))]),
      )?.basis,
    ).toBe("default");
  });

  test("a tie on basis is broken by the SMALLEST sample — the least evidence behind the number", () => {
    const result = weakestTurnProfile(
      estimate([
        environment("a", profile("environment", 79)),
        environment("b", profile("environment", 4)),
      ]),
    );
    expect(result?.sampleSize).toBe(4);
  });

  test("a single measured environment reports itself unchanged", () => {
    const result = weakestTurnProfile(estimate([environment("a", profile("pair", 51))]));
    expect(result).toEqual(profile("pair", 51));
  });
});
