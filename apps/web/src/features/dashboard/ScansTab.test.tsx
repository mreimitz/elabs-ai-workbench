import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";

// `MetricGrid`/`Sparkline` are real `@elabs-ai/components-charts` exports, but importing ANYTHING from that
// package's barrel under Vitest/jsdom resolves a broken deep `@visx/gradient` subpath used by its
// (unrelated, unused here) Gantt chart — a pre-existing, environment-only issue (confirmed:
// `import { MetricGrid } from "@elabs-ai/components-charts"` alone fails identically in a scratch test;
// `AreaChart` from the same package does not). `RunConsole.test.tsx` hits the same class of issue
// ("AnalyticsPanel — pulls `@elabs-ai/components-charts` that jsdom can't load") and mocks around it; mirrored
// here. The real `MetricCard`/`@elabs-ai/components-ui` children are kept intact, so every delta/emphasis
// assertion below runs against the REAL component.
//
// WP 0.3 — this stub is FAITHFUL, not inert (dashboard-bento `conventions.md`: an inert chart mock
// lets a wrong chart prop pass the gate silently). It reproduces the two contracts this file now
// depends on: `MetricGrid`'s `featured` is an INDEX into its children (the real component clones the
// child at that index with a `col-span` class — here each child is wrapped and tagged instead, so a
// test can ask *which tile* is featured, not merely that some number was passed), and `Sparkline`
// renders the `values` series it was handed. Both record the props they received.
const captured = vi.hoisted(() => ({
  grid: [] as { columns?: number; featured?: number; featuredSpan?: number }[],
}));

vi.mock("@elabs-ai/components-charts", () => ({
  MetricGrid: ({
    children,
    columns,
    featured,
    featuredSpan,
  }: {
    children: ReactNode;
    columns?: number;
    featured?: number;
    featuredSpan?: number;
  }) => {
    captured.grid.push({ columns, featured, featuredSpan });
    const tiles = Array.isArray(children) ? children : [children];
    return (
      <div data-testid="metric-grid">
        {tiles.map((tile, index) => (
          <div
            key={index}
            data-testid="metric-tile"
            data-index={index}
            data-featured={featured === index ? "true" : "false"}
          >
            {tile}
          </div>
        ))}
      </div>
    );
  },
  Sparkline: ({
    values,
    variant,
    emphasizeLast,
    label,
  }: {
    values: number[];
    variant?: string;
    emphasizeLast?: boolean;
    label?: string;
  }) => (
    <svg
      role="img"
      aria-label={label}
      data-testid="sparkline"
      data-values={values.join(",")}
      data-variant={variant}
      data-emphasize-last={String(Boolean(emphasizeLast))}
    />
  ),
}));

import { ScansTab } from "./ScansTab";

// WP 2.1 — ScansTab is the pre-WP-2.1 `DashboardView` body moved VERBATIM into the Dashboard's
// "Scans" tab (extraction, no redesign). These are smoke tests locking that the moved content still
// renders its cards/KPIs/tables (there were no pre-existing `DashboardView` tests in this repo to
// "update" — `features/dashboard/` had no test file before this WP).

function server(overrides: Partial<ServerConfig> & { id: string; name: string }): ServerConfig {
  return {
    transport: "streamable_http",
    url: "https://example.com/mcp",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function scan(overrides: Partial<ScanSummary> & { id: string; serverId: string }): ScanSummary {
  return {
    serverName: overrides.serverId,
    tokenProfile: "generic_o200k",
    scannedAt: "2026-01-02T00:00:00Z",
    status: "success",
    totalTools: 3,
    totalTokens: 1000,
    totalRawBytes: 4000,
    averageTokensPerTool: 333,
    largestToolTokens: 500,
    totalResources: 0,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    ...overrides,
  };
}

function renderScansTab(props: Partial<Parameters<typeof ScansTab>[0]> = {}) {
  const onOpenScan = vi.fn();
  const onOpenServer = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ScansTab
          servers={[]}
          scans={[]}
          onOpenScan={onOpenScan}
          onOpenServer={onOpenServer}
          lastVisitAt={null}
          {...props}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onOpenScan, onOpenServer };
}

/** The wrapper the faithful `MetricGrid` stub puts around each tile, found via the tile's label. */
function tileFor(label: string): HTMLElement {
  const tile = screen.getByText(label).closest('[data-testid="metric-tile"]');
  if (!tile) throw new Error(`No metric tile found for label "${label}"`);
  return tile as HTMLElement;
}

/** Two successful scans of ONE server, a fortnight apart — the minimum shape that gives the tiles a
 *  genuine prior-period comparison AND a two-point fleet series. */
function twoScanHistory(later: Partial<ScanSummary>): ScanSummary[] {
  return [
    scan({
      id: "scan-2",
      serverId: "srv-a",
      serverName: "Alpha",
      scannedAt: "2026-01-15T00:00:00Z",
      totalTokens: 1000,
      totalTools: 3,
      ...later,
    }),
    scan({
      id: "scan-1",
      serverId: "srv-a",
      serverName: "Alpha",
      scannedAt: "2026-01-01T00:00:00Z",
      totalTokens: 1000,
      totalTools: 3,
    }),
  ];
}

describe("ScansTab", () => {
  beforeEach(() => {
    captured.grid.length = 0;
  });

  test("renders the change/attention cards, the KPI grid, and both tables", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "scan-1", serverId: "srv-a", serverName: "Alpha" })],
    });
    expect(screen.getByText("Since your last visit")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Biggest movers")).toBeInTheDocument();
    expect(screen.getByText("Servers")).toBeInTheDocument(); // MetricCard label
    expect(screen.getByText("Latest server footprint")).toBeInTheDocument();
    expect(screen.getByText("Recent scan activity")).toBeInTheDocument();
    // The one configured server's latest scan renders in the footprint table.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
  });

  test("first-visit welcome copy when no last-visit reference is stored", () => {
    renderScansTab({ lastVisitAt: null });
    expect(
      screen.getByText(/Welcome\. Footprint changes to your servers will show up here/),
    ).toBeInTheDocument();
  });

  test("'no changes' copy when a last-visit reference exists but nothing changed since", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [
        scan({
          id: "scan-1",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2020-01-01T00:00:00Z", // long before lastVisitAt
        }),
      ],
      lastVisitAt: Date.parse("2026-01-01T00:00:00Z"),
    });
    expect(screen.getByText(/No changes since/)).toBeInTheDocument();
  });

  test("attention queue lists an unscanned server with a Scan CTA when onRunScan is wired", () => {
    const onRunScan = vi.fn();
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [],
      onRunScan,
    });
    expect(screen.getByText("No scan yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan now" })).toBeInTheDocument();
  });

  test("empty state: no servers, no scans still renders the page frame without crashing", () => {
    renderScansTab();
    expect(
      screen.getByText("All configured servers have a successful latest scan."),
    ).toBeInTheDocument();
    expect(screen.getByText("No completed scans yet.")).toBeInTheDocument();
    expect(screen.getByText("No scan activity yet.")).toBeInTheDocument();
  });

  // D-TB11 / audit D-3: the "quiet success text, chip for everything else" split still holds, now
  // expressed through StatusBadge's `quiet` prop instead of an inline <Text> exception (WP 2.6).
  test("recent scan activity renders a success status as quiet muted text (no chip), while the attention queue still shows a status chip", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" }), server({ id: "srv-b", name: "Beta" })],
      scans: [scan({ id: "scan-1", serverId: "srv-a", serverName: "Alpha", status: "success" })],
    });
    // Recent scan activity: the success row reads "Completed" as plain muted text — not a chip.
    const completedNodes = screen.getAllByText("Completed");
    expect(completedNodes.length).toBeGreaterThan(0);
    for (const node of completedNodes) {
      expect(node.closest("[data-status]")).toBeNull();
    }
    // Attention queue: Beta has no scan yet -> a real StatusBadge chip still renders (Pending, dashed).
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(document.querySelector('[data-status="pending"]')).not.toBeNull();
  });

  // T10: the KPI ("Total startup tokens … Tools + resources + prompts") and the two tables' token
  // column used to share the bare label "Tokens" while meaning two different quantities (tools-only
  // vs tools+resources+prompts) — a silent gap. The column is now labelled "Tool tokens" so the two
  // figures can never be read as the same thing, and the KPI still states its own composition.
  test("the footprint tables label the tools-only column distinctly from the tools+resources+prompts KPI", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [
        scan({
          id: "scan-1",
          serverId: "srv-a",
          serverName: "Alpha",
          totalTokens: 1000,
          totalResourceTokens: 200,
          totalPromptTokens: 50,
        }),
      ],
    });
    // The KPI states its own definition explicitly.
    expect(screen.getByText("Total startup tokens")).toBeInTheDocument();
    expect(screen.getByText(/Tools \+ resources \+ prompts/)).toBeInTheDocument();
    // Neither table column is labelled with the bare, ambiguous "Tokens" — both name the tools-only
    // scope so they can't be misread as the KPI's broader total.
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
    expect(screen.getAllByText("Tool tokens").length).toBe(2); // footprint table + recent activity table
  });

  // ---------------------------------------------------------------------------------------------
  // WP 0.3 (findings F3 + F8) — the inventory band carries rank and trend.
  // ---------------------------------------------------------------------------------------------

  test("the headline number leads the band as the featured, headline-emphasis tile", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: twoScanHistory({}),
    });
    expect(captured.grid[0]).toEqual({ columns: 3, featured: 0, featuredSpan: 2 });
    // `featured` is an INDEX into the grid's children, so passing a number proves nothing on its
    // own — the tile AT that index must be the product's headline figure, not the count of
    // configuration rows that used to sit first.
    expect(tileFor("Total startup tokens").getAttribute("data-index")).toBe("0");
    expect(tileFor("Total startup tokens").getAttribute("data-featured")).toBe("true");
    expect(tileFor("Servers").getAttribute("data-featured")).toBe("false");
    // `emphasis="headline"` — the REAL MetricCard renders the value at the KPI type scale.
    expect(within(tileFor("Total startup tokens")).getByText("1,000").className).toContain(
      "text-kpi",
    );
  });

  test("a GROWING token footprint reads as a regression, never as success", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: twoScanHistory({ totalTokens: 1250 }),
    });
    const delta = tileFor("Total startup tokens").querySelector("[data-polarity]");
    expect(delta).not.toBeNull();
    expect(delta?.textContent).toContain("+250");
    // The real MetricCard derives polarity from deltaDirection × positiveIsGood. "bad" is ONLY
    // reachable with `positiveIsGood={false}`; the component's default (`true`) would paint a
    // growing footprint in the success colour — the exact way round this is easy to get wrong.
    expect(delta?.getAttribute("data-polarity")).toBe("bad");
    expect(delta?.getAttribute("aria-label")).toBe("up +250, unfavorable");
  });

  test("a SHRINKING token footprint reads as favorable", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: twoScanHistory({ totalTokens: 750 }),
    });
    const delta = tileFor("Total startup tokens").querySelector("[data-polarity]");
    expect(delta?.textContent).toContain("-250");
    expect(delta?.getAttribute("data-polarity")).toBe("good");
    expect(delta?.getAttribute("aria-label")).toBe("down -250, favorable");
  });

  test("the Δ measures the tile's OWN quantity, not the tools-only figure", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: twoScanHistory({ totalResourceTokens: 300, totalPromptTokens: 100 }),
    });
    // Tool tokens are unchanged (1,000 → 1,000); the startup footprint grew by exactly the resource
    // + prompt tokens this tile's own value counts. A tile whose value and Δ denote different
    // quantities is the collision T10 removed — lock that they agree.
    const delta = tileFor("Total startup tokens").querySelector("[data-polarity]");
    expect(delta?.textContent).toContain("+400");
    expect(delta?.getAttribute("data-polarity")).toBe("bad");
  });

  test("a server with no earlier successful scan gets NO delta and NO sparkline (never a fabricated 0)", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "scan-1", serverId: "srv-a", serverName: "Alpha" })],
    });
    for (const label of ["Total startup tokens", "Resources", "Prompts", "Tools scanned"]) {
      expect(tileFor(label).querySelector("[data-polarity]")).toBeNull();
      expect(tileFor(label).querySelector('[data-testid="sparkline"]')).toBeNull();
    }
  });

  test("sparklines are backed by a real series and normalized so the shape is legible", () => {
    // Three scans of one server, ~2% apart — the realistic shape. `Sparkline` is ZERO-baselined
    // (`max = Math.max(...values, 0)`, no min), so handing it the absolute totals would draw a flat
    // line: 580k..590k inside a 0..590k box is a ~2% wiggle. The series is normalized to its own
    // window minimum so the variation uses the full height, and the LABEL keeps the real figures.
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [
        scan({
          id: "s-3",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-01-03T00:00:00Z",
          totalTokens: 590000,
        }),
        scan({
          id: "s-2",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-01-02T00:00:00Z",
          totalTokens: 585000,
        }),
        scan({
          id: "s-1",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-01-01T00:00:00Z",
          totalTokens: 580000,
        }),
      ],
    });
    const spark = tileFor("Total startup tokens").querySelector('[data-testid="sparkline"]');
    const values = (spark?.getAttribute("data-values") ?? "").split(",").map(Number);
    expect(values).toEqual([0, 5000, 10000]);
    // Degenerate-shape guard: the drawn series must actually span the box, not sit in the top 2% of
    // it. Passing the raw absolutes (580000,585000,590000) fails both of these.
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBeGreaterThan(0);
    expect(spark?.getAttribute("data-variant")).toBe("line");
    expect(spark?.getAttribute("data-emphasize-last")).toBe("true");
    // The accessible label describes the REAL quantities, not the normalized ones.
    expect(spark?.getAttribute("aria-label")).toBe(
      "Total startup tokens: 580,000 → 590,000 across the last 3 scans",
    );
  });

  test("the four footprint tiles carry a sparkline; the four state tiles carry neither trend", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: twoScanHistory({ totalTokens: 1250, totalTools: 5 }),
    });
    for (const label of ["Total startup tokens", "Resources", "Prompts", "Tools scanned"]) {
      expect(tileFor(label).querySelector('[data-testid="sparkline"]')).not.toBeNull();
    }
    // The state tiles have no reconstructable history (deletions are not recorded) or would compare
    // unlike things ("largest single tool" can be a different tool at every point) — so neither a
    // delta nor a series is invented for them.
    for (const label of ["Servers", "Largest single tool", "Unscanned", "Failed"]) {
      expect(tileFor(label).querySelector('[data-testid="sparkline"]')).toBeNull();
      expect(tileFor(label).querySelector("[data-polarity]")).toBeNull();
    }
  });

  test("adding and scanning a NEW server cannot make a grown fleet read as an improvement", () => {
    // The core workflow, and the most common way startup footprint grows: Alpha shrinks slightly,
    // then a second server is added and scanned. The fleet went 100,000 → 590,000. A Δ summed only
    // over servers that HAVE a previous scan would report "↓ 10,000, favorable" — a green tile on a
    // fleet that nearly sextupled. The Δ covers the same population the VALUE totals, so it can't.
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" }), server({ id: "srv-b", name: "Beta" })],
      scans: [
        scan({
          id: "b-1",
          serverId: "srv-b",
          serverName: "Beta",
          scannedAt: "2026-03-01T00:00:00Z",
          totalTokens: 500000,
        }),
        scan({
          id: "a-2",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-02-01T00:00:00Z",
          totalTokens: 90000,
        }),
        scan({
          id: "a-1",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-01-01T00:00:00Z",
          totalTokens: 100000,
        }),
      ],
    });
    const tile = tileFor("Total startup tokens");
    expect(within(tile).getByText("590,000")).toBeInTheDocument();
    const delta = tile.querySelector("[data-polarity]");
    expect(delta?.getAttribute("data-polarity")).not.toBe("good");
    expect(delta?.getAttribute("data-polarity")).toBe("bad");
    expect(delta?.textContent).toContain("+490,000");
    // value − Δ is the fleet's previous measured total: 590,000 − 490,000 = 100,000.
    expect(delta?.getAttribute("aria-label")).toBe("up +490,000, unfavorable");
    // …and the part of that Δ which is a first measurement rather than a change is disclosed.
    expect(
      within(tile).getByText("Includes 1 server measured for the first time"),
    ).toBeInTheDocument();
    // The series must NOT vanish at the moment it matters most — it shows the step.
    const spark = tile.querySelector('[data-testid="sparkline"]');
    expect((spark?.getAttribute("data-values") ?? "").split(",").map(Number)).toEqual([
      10000, 0, 500000,
    ]);
  });

  test("an unchanged figure reads as 'No change', not a bare unlabeled 0", () => {
    renderScansTab({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: twoScanHistory({}), // both scans identical
    });
    const delta = tileFor("Total startup tokens").querySelector("[data-polarity]");
    expect(delta?.getAttribute("data-polarity")).toBe("neutral");
    // MetricCard gives a neutral delta no arrow and no aria-label, so the STRING has to carry the
    // meaning. "0" on its own does not.
    expect(delta?.textContent?.trim()).toBe("No change");
    expect(delta?.textContent?.trim()).not.toBe("0");
  });
});
