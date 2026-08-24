import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import {
  facetSegments,
  facetSum,
  surfaceSegments,
  TokenDistribution,
  type ContributorRow,
} from "./TokenViz";

const SPLIT = { name: 409, description: 7868, schema: 17_330, annotations: 539 };

describe("facetSegments — the wire structure is NAMED, never scaled away", () => {
  test("the fifth segment is exactly the tokens the four facets do not account for", () => {
    // `barc-benchmark`, measured: 64,522 tool tokens against a 26,146 facet sum.
    const segments = facetSegments(SPLIT, 64_522);
    expect(segments.map((s) => s.key)).toEqual([
      "name",
      "description",
      "schema",
      "annotations",
      "structure",
    ]);
    expect(facetSum(SPLIT)).toBe(26_146);
    expect(segments[4]).toMatchObject({ label: "Wire structure", value: 38_376 });
  });

  test("the segments add up to the tool total — the whole point of the fifth one", () => {
    const total = 64_522;
    const sum = facetSegments(SPLIT, total).reduce((acc, s) => acc + s.value, 0);
    expect(sum).toBe(total);
  });

  test("a total below the facet sum floors the remainder at 0 rather than drawing a negative slice", () => {
    // Can only happen across a counting-version skew, but a negative width is not a thing to ship.
    expect(facetSegments(SPLIT, 10).at(-1)).toMatchObject({ value: 0 });
  });
});

describe("surfaceSegments", () => {
  test("tools, resources and prompts stay three separate slices in a fixed order", () => {
    expect(surfaceSegments({ tools: 149_338, resources: 3595, prompts: 0 })).toEqual([
      { key: "tools", label: "Tools", value: 149_338 },
      { key: "resources", label: "Resources", value: 3595 },
      { key: "prompts", label: "Prompts", value: 0 },
    ]);
  });
});

const ROWS: ContributorRow[] = [
  {
    id: "t1",
    label: "qlik_create_data_object",
    total: 4796,
    percent: 7.4,
    split: { name: 5, description: 2002, schema: 1905, annotations: 7 },
  },
];

function renderDistribution() {
  return render(
    <TooltipProvider>
      <TokenDistribution
        facets={SPLIT}
        onSelect={() => {}}
        rows={ROWS}
        surface={{ tools: 64_522, resources: 0, prompts: 0 }}
      />
    </TooltipProvider>,
  );
}

describe("TokenDistribution", () => {
  test("states both totals: the three-surface sum, and the tool-only facet denominator", () => {
    renderDistribution();
    expect(screen.getByText("By surface")).toBeInTheDocument();
    expect(screen.getByText("By part of a tool definition")).toBeInTheDocument();
    // Both read 64,522 here because this server serves no resources or prompts — they are separate
    // figures over separate denominators, not one number shown twice.
    expect(screen.getAllByText("64,522").length).toBe(2);
  });

  test("every segment is labelled in place with its own tokens and share", () => {
    renderDistribution();
    expect(screen.getByText("Wire structure")).toBeInTheDocument();
    expect(screen.getByText("38,376 · 59.5%")).toBeInTheDocument();
    expect(screen.getByText("17,330 · 26.9%")).toBeInTheDocument();
  });

  test("a tool row carries its split in the accessible name, not only in a hover tooltip", () => {
    renderDistribution();
    const row = screen.getByRole("button", { name: /qlik_create_data_object/ });
    // The row's own headline plus every facet — what a screen reader announces on focus. The
    // tooltip is a pointer convenience; `brand-ui docs Tooltip` forbids it being the only path.
    expect(row).toHaveAccessibleName(/Name 5, Description 2,002, Schema 1,905, Annotations 7/);
    expect(row).toHaveAccessibleName(/Wire structure 877/);
  });

  test("a zero-valued slice does not shift the colours of the slices after it", () => {
    // Resources 0 but Prompts non-zero: the bar skips Resources, the legend still lists it. Keying
    // the fill to the DRAWN index would paint Prompts in the Resources colour, so the bar and its
    // own legend would disagree about which slice is which.
    const { container } = render(
      <TooltipProvider>
        <TokenDistribution
          facets={SPLIT}
          rows={[]}
          surface={{ tools: 900, resources: 0, prompts: 100 }}
        />
      </TooltipProvider>,
    );
    const bar = container.querySelector('[aria-label^="Startup tokens by surface"]');
    const fills = [...(bar?.children ?? [])].map((el) => el.className);
    expect(fills).toHaveLength(2);
    expect(fills[0]).toContain("bg-chart-1"); // Tools — slot 1
    expect(fills[1]).toContain("bg-chart-3"); // Prompts — slot 3, NOT slot 2
    // …and the legend swatches still name all three in their own fixed slots.
    const swatches = [...container.querySelectorAll("li span[aria-hidden]")].map((s) => s.className);
    expect(swatches.slice(0, 3).map((c) => /bg-chart-(\d+)/.exec(c)?.[1])).toEqual(["1", "2", "3"]);
  });

  test("renders nothing for the tool list when there are no tools to rank", () => {
    render(
      <TooltipProvider>
        <TokenDistribution
          facets={SPLIT}
          rows={[]}
          surface={{ tools: 64_522, resources: 0, prompts: 0 }}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByText(/Heaviest tools/)).not.toBeInTheDocument();
  });
});
