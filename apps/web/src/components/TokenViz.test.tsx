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

describe("facetSegments — the unitemised remainder is NAMED, never scaled away", () => {
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
    expect(segments[4]).toMatchObject({ label: "Output schema + envelope", value: 38_376 });
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
    expect(screen.getByText("Output schema + envelope")).toBeInTheDocument();
    expect(screen.getByText("38,376 · 59.5%")).toBeInTheDocument();
    expect(screen.getByText("17,330 · 26.9%")).toBeInTheDocument();
  });

  test("a tool row carries its split in the accessible name, not only in a hover tooltip", () => {
    renderDistribution();
    const row = screen.getByRole("button", { name: /qlik_create_data_object/ });
    // The row's own headline plus every facet — what a screen reader announces on focus. The
    // tooltip is a pointer convenience; `brand-ui docs Tooltip` forbids it being the only path.
    expect(row).toHaveAccessibleName(/Name 5, Description 2,002, Schema 1,905, Annotations 7/);
    expect(row).toHaveAccessibleName(/Output schema \+ envelope 877/);
  });

  test("a tool row's BAR is the same measurement as the percent printed beside it", () => {
    // The bar used to be scaled to the largest listed tool, so the top row drew a full-width bar
    // next to the number 6.9% — two denominators on one line, which is what made it read as broken.
    renderDistribution();
    const row = screen.getByRole("button", { name: /qlik_create_data_object/ });
    const fill = row.querySelector('span[style*="width"]');
    // 4,796 / 64,522 = 7.43%, and the row prints 7.4% — the bar and the number are one measurement.
    const width = Number(/width:\s*([\d.]+)%/.exec(fill?.getAttribute("style") ?? "")?.[1]);
    expect(width).toBeCloseTo((4796 / 64_522) * 100, 6);
    expect(screen.getByText("4,796 · 7.4%")).toBeInTheDocument();
    // Not 100%, which is what max-scaling drew for whichever tool happened to be first. (The SURFACE
    // bar above legitimately has a 100% Tools segment — this assertion is scoped to the row.)
    expect(row.querySelector('span[style="width: 100%;"]')).toBeNull();
  });

  test("each tool row DRAWS its five-part split, not only on hover", () => {
    // The owner asked twice to see the breakdown per tool in this list. Hover works, and a hover is
    // not "seeing it": it is invisible until the pointer lands, and it never opens on keyboard focus.
    renderDistribution();
    const row = screen.getByRole("button", { name: /qlik_create_data_object/ });
    const bars = [...row.querySelectorAll("span")].filter((el) =>
      /rounded-full bg-muted/.test(el.className),
    );
    expect(bars).toHaveLength(2); // share of server, then composition

    const composition = bars[1] as HTMLElement;
    const widths = [...composition.children].map((el) =>
      Number(/width:\s*([\d.]+)%/.exec(el.getAttribute("style") ?? "")?.[1]),
    );
    // Description 2,002 · Schema 1,905 · Output schema + envelope 877, over the tool's own 4,796.
    expect(widths[1]).toBeCloseTo((2002 / 4796) * 100, 4);
    expect(widths[2]).toBeCloseTo((1905 / 4796) * 100, 4);
    expect(widths.reduce((a, w) => a + w, 0)).toBeCloseTo(100, 6);
  });

  test("the composition bar is a part-to-whole of the TOOL, so it always spans the row", () => {
    // Painting the split inside the ~30px share bar above would make five unreadable slivers; the
    // two bars answer different questions and are scaled to different wholes on purpose.
    renderDistribution();
    const row = screen.getByRole("button", { name: /qlik_create_data_object/ });
    const bars = [...row.querySelectorAll("span")].filter((el) =>
      /rounded-full bg-muted/.test(el.className),
    );
    const share = Number(
      /width:\s*([\d.]+)%/.exec(bars[0]?.firstElementChild?.getAttribute("style") ?? "")?.[1],
    );
    expect(share).toBeLessThan(10); // share of the server
    expect(bars[1]?.children.length).toBeGreaterThan(1); // composition, several segments
  });

  test("the list states what it adds up to — a whole-server track cannot show that on its own", () => {
    renderDistribution();
    expect(screen.getByText(/These 1 are 7\.4% of the server’s tool tokens\./)).toBeInTheDocument();
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

  test("the note explains the fifth segment on the page, not in a tooltip", () => {
    renderDistribution();
    // The owner asked "what is wire structure ??" of an unexplained label. A tooltip cannot answer
    // that — it is invisible until hovered and unreachable by keyboard here.
    const note = screen.getByText(/Everything in the definition that the four parts above/);
    expect(note).toBeInTheDocument();
    // And it must not repeat the claim that was measured false: the remainder is mostly the tool's
    // output schema, which IS editable.
    expect(note.textContent).toMatch(/output schema/i);
    expect(note.textContent).toMatch(/editable/i);
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
