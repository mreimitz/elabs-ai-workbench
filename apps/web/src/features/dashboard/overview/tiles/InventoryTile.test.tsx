import type { CSSProperties } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";

/**
 * dashboard-bento WP 2.1 — `InventoryTile`.
 *
 * `@elabs-ai/components-charts` is stubbed (its barrel resolves a broken deep `@visx/gradient`
 * subpath under jsdom) but the stub is **FAITHFUL**, per `planning/Roadmap/RM-11-dashboard-bento/conventions.md`:
 * it records `values` / `variant` / `emphasizeLast` / `label` / `className` / `preserveAspectRatio`
 * / `style.color` into readable attributes. An inert no-op mock — which is what the rest of this
 * repo's suites install — would let every one of the defects this tile exists to avoid pass the gate
 * silently: an un-normalised series (a flat line, because `Sparkline` is zero-baselined), a
 * sparkline left at its 80×20 default adrift in a wide card, a series colour that is not a
 * `var(--chart-N)` reference (silently ignored by the real component), or a label that dropped the
 * real figures. The negative control at the bottom mounts the stub directly to prove it reflects
 * props rather than ignoring them.
 *
 * Everything else — `BentoGridItem`, `Text`, the token utilities — is the REAL
 * `@elabs-ai/components-ui`.
 */

vi.mock("@elabs-ai/components-charts", () => ({
  Sparkline: ({
    values,
    variant,
    emphasizeLast,
    label,
    className,
    preserveAspectRatio,
    width,
    height,
    style,
  }: {
    values: number[];
    variant?: string;
    emphasizeLast?: boolean;
    label?: string;
    className?: string;
    preserveAspectRatio?: string;
    width?: number;
    height?: number;
    style?: CSSProperties;
  }) => (
    <svg
      role="img"
      aria-label={label}
      data-testid="sparkline"
      data-values={values.join(",")}
      data-variant={variant}
      data-emphasize-last={String(Boolean(emphasizeLast))}
      data-classname={className}
      data-preserve-aspect-ratio={preserveAspectRatio}
      data-viewbox={`${width}x${height}`}
      data-color={String(style?.color ?? "")}
    />
  ),
}));

import { InventoryTile } from "./InventoryTile";

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

function renderTile(props: Partial<Parameters<typeof InventoryTile>[0]> = {}) {
  return render(<InventoryTile servers={[]} scans={[]} {...props} />);
}

/** The cell for ONE of the four figures (`data-figure` on the cell root). */
function figure(container: HTMLElement, key: string): HTMLElement {
  const cell = container.querySelector(`[data-figure="${key}"]`);
  if (!cell) throw new Error(`No inventory figure cell for "${key}"`);
  return cell as HTMLElement;
}

/** Two successful scans of ONE server, a fortnight apart — the minimum shape that gives the figures
 *  a genuine prior comparison AND a two-point fleet series. */
function twoScanHistory(later: Partial<ScanSummary>): ScanSummary[] {
  return [
    scan({
      id: "scan-2",
      serverId: "srv-a",
      serverName: "Alpha",
      scannedAt: "2026-01-15T00:00:00Z",
      ...later,
    }),
    scan({
      id: "scan-1",
      serverId: "srv-a",
      serverName: "Alpha",
      scannedAt: "2026-01-01T00:00:00Z",
    }),
  ];
}

const ONE_SERVER = [server({ id: "srv-a", name: "Alpha" })];

describe("InventoryTile — self-hiding", () => {
  test("no servers and no scans renders NOTHING (the bento never shows an empty box)", () => {
    const { container } = renderTile();
    expect(container).toBeEmptyDOMElement();
  });

  test("a configured server with no scan yet still renders — the count is real information", () => {
    const { container } = renderTile({ servers: ONE_SERVER });
    expect(screen.getByText("Servers")).toBeInTheDocument();
    expect(figure(container, "servers").textContent).toContain("1");
  });
});

describe("InventoryTile — the four figures", () => {
  test("merges Servers · Tools scanned · Resources · Prompts into ONE tile", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: [
        scan({
          id: "scan-1",
          serverId: "srv-a",
          serverName: "Alpha",
          totalTools: 12,
          totalResources: 4,
          totalResourceTemplates: 1,
          totalPrompts: 2,
        }),
      ],
    });
    for (const key of ["servers", "tools", "resources", "prompts"]) {
      expect(container.querySelector(`[data-figure="${key}"]`)).not.toBeNull();
    }
    expect(figure(container, "tools").textContent).toContain("12");
    // Resources counts resources AND templates — the same definition `ScansTab` totalled.
    expect(figure(container, "resources").textContent).toContain("5");
    expect(figure(container, "prompts").textContent).toContain("2");
  });

  test("figures the Overview already owns are NOT duplicated here", () => {
    renderTile({ servers: ONE_SERVER, scans: [scan({ id: "s1", serverId: "srv-a" })] });
    // StartupCostTile owns the headline token figure; AttentionTile owns unscanned/failed.
    expect(screen.queryByText("Total startup tokens")).not.toBeInTheDocument();
    expect(screen.queryByText("Unscanned")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  test("with servers configured but no SUCCESSFUL scan, the scan-derived figures read n/a", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: [scan({ id: "s1", serverId: "srv-a", status: "failed", totalTools: 9 })],
    });
    expect(figure(container, "tools").textContent).toContain("n/a");
    expect(figure(container, "servers").textContent).toContain("1");
  });
});

describe("InventoryTile — polarity: growth in startup context is the REGRESSION", () => {
  test("a GROWING tool count is unfavorable, never the success colour", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: twoScanHistory({ totalTools: 5 }),
    });
    const delta = figure(container, "tools").querySelector("[data-polarity]");
    expect(delta?.textContent).toContain("+2");
    expect(delta?.getAttribute("data-polarity")).toBe("bad");
    // Same accessible contract MetricCard emits, so the tile reads identically to its neighbours.
    expect(delta?.getAttribute("aria-label")).toBe("up +2, unfavorable");
    expect(delta?.className).toContain("text-warning-text");
    expect(delta?.className).not.toContain("text-success-text");
  });

  test("a SHRINKING footprint is favorable (the polarity is not merely 'always bad')", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: twoScanHistory({ totalTools: 1 }),
    });
    const delta = figure(container, "tools").querySelector("[data-polarity]");
    expect(delta?.textContent).toContain("-2");
    expect(delta?.getAttribute("data-polarity")).toBe("good");
    expect(delta?.getAttribute("aria-label")).toBe("down -2, favorable");
  });

  test("resources and prompts carry the same polarity — more startup context is worse there too", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: twoScanHistory({ totalResources: 3, totalPrompts: 4 }),
    });
    expect(
      figure(container, "resources")
        .querySelector("[data-polarity]")
        ?.getAttribute("data-polarity"),
    ).toBe("bad");
    expect(
      figure(container, "prompts").querySelector("[data-polarity]")?.getAttribute("data-polarity"),
    ).toBe("bad");
  });

  test("each figure's Δ measures its OWN quantity, not some shared token figure", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      // Tools unchanged (3 → 3); only resources moved.
      scans: twoScanHistory({ totalResources: 6 }),
    });
    expect(figure(container, "tools").querySelector('[data-polarity="bad"]')).toBeNull();
    expect(figure(container, "resources").querySelector("[data-polarity]")?.textContent).toContain(
      "+6",
    );
  });

  test("a genuine zero says 'No change' rather than floating a bare 0", () => {
    const { container } = renderTile({ servers: ONE_SERVER, scans: twoScanHistory({}) });
    const delta = figure(container, "tools").querySelector("[data-polarity]");
    expect(delta?.textContent).toBe("No change");
    expect(delta?.getAttribute("data-polarity")).toBe("neutral");
  });
});

describe("InventoryTile — nothing is fabricated", () => {
  test("a first-ever successful scan renders NO delta at all (never a +0)", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })],
    });
    for (const key of ["tools", "resources", "prompts"]) {
      expect(figure(container, key).querySelector("[data-polarity]")).toBeNull();
      expect(figure(container, key).querySelector('[data-testid="sparkline"]')).toBeNull();
    }
  });

  test("'Servers' carries NO delta and NO sparkline — an earlier count cannot be reconstructed", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: twoScanHistory({ totalTools: 9 }),
    });
    // The trend-bearing figures DO have one, so this is a deliberate omission, not an empty history.
    expect(figure(container, "tools").querySelector('[data-testid="sparkline"]')).not.toBeNull();
    expect(figure(container, "servers").querySelector("[data-polarity]")).toBeNull();
    expect(figure(container, "servers").querySelector('[data-testid="sparkline"]')).toBeNull();
  });

  test("a first-measured server is DISCLOSED rather than letting its whole figure read as growth", () => {
    renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" }), server({ id: "srv-b", name: "Bravo" })],
      scans: [
        ...twoScanHistory({ totalTools: 4 }),
        scan({ id: "b-1", serverId: "srv-b", serverName: "Bravo", totalTools: 7 }),
      ],
    });
    expect(screen.getByText("Includes 1 server measured for the first time")).toBeInTheDocument();
  });
});

describe("InventoryTile — the sparkline (Sparkline is ZERO-baselined, so the series is normalised)", () => {
  /** Three scans of one server, ~2% apart — the realistic shape a zero-baselined sparkline would
   *  otherwise draw as a flat line in the top 2% of a 0..max box. */
  const threeScans = [
    scan({
      id: "s-3",
      serverId: "srv-a",
      serverName: "Alpha",
      scannedAt: "2026-01-03T00:00:00Z",
      totalTools: 590,
    }),
    scan({
      id: "s-2",
      serverId: "srv-a",
      serverName: "Alpha",
      scannedAt: "2026-01-02T00:00:00Z",
      totalTools: 585,
    }),
    scan({
      id: "s-1",
      serverId: "srv-a",
      serverName: "Alpha",
      scannedAt: "2026-01-01T00:00:00Z",
      totalTools: 580,
    }),
  ];

  test("normalises to the window minimum and keeps the REAL figures in the label", () => {
    const { container } = renderTile({ servers: ONE_SERVER, scans: threeScans });
    const spark = figure(container, "tools").querySelector('[data-testid="sparkline"]');
    const values = (spark?.getAttribute("data-values") ?? "").split(",").map(Number);
    expect(values).toEqual([0, 5, 10]);
    // Degenerate-shape guard: the drawn series must span the box. The absolutes (580, 585, 590)
    // would sit in the top 2% of a 0..590 box — a visually flat line.
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBeGreaterThan(0);
    expect(spark?.getAttribute("aria-label")).toBe(
      "Tools scanned: 580 → 590 across the last 3 scans",
    );
  });

  test("the sparkline FILLS the tile's width instead of floating at the 80×20 default", () => {
    const { container } = renderTile({ servers: ONE_SERVER, scans: threeScans });
    const spark = figure(container, "tools").querySelector('[data-testid="sparkline"]');
    expect(spark?.getAttribute("data-classname")).toContain("w-full");
    expect(spark?.getAttribute("data-classname")).toContain("h-6");
    // Half the fix: without `preserveAspectRatio="none"` the SVG BOX grows while the DRAWING keeps
    // its 4:1 aspect and letterboxes itself in the middle — the same thumbnail, wider frame.
    expect(spark?.getAttribute("data-preserve-aspect-ratio")).toBe("none");
    // …and the viewBox is sized to the real box, so the non-uniform scale stays near 1:1.
    expect(spark?.getAttribute("data-viewbox")).toBe("320x24");
    expect(spark?.getAttribute("data-variant")).toBe("line");
    // OFF on purpose: the marker is a `circle r=2` hard-coded to `--chart-1` — an ellipse under a
    // non-uniform scale, and the wrong colour on any other ramp slot.
    expect(spark?.getAttribute("data-emphasize-last")).toBe("false");
  });

  test("each series is drawn on its OWN ramp slot, always as a var(--chart-N) reference", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: [
        scan({
          id: "s-2",
          serverId: "srv-a",
          scannedAt: "2026-01-02T00:00:00Z",
          totalTools: 5,
          totalResources: 5,
          totalPrompts: 5,
        }),
        scan({
          id: "s-1",
          serverId: "srv-a",
          scannedAt: "2026-01-01T00:00:00Z",
          totalTools: 1,
          totalResources: 1,
          totalPrompts: 1,
        }),
      ],
    });
    const colors = ["tools", "resources", "prompts"].map((key) =>
      figure(container, key).querySelector('[data-testid="sparkline"]')?.getAttribute("data-color"),
    );
    // A colour that is not a `var(--chart-N)` reference is SILENTLY IGNORED by the real component
    // (`isPaletteFill`), so asserting the shape is what makes this meaningful.
    for (const color of colors) expect(color).toMatch(/^var\(--chart-\d+\)$/);
    // Three figures, three distinct slots — not three identical grey lines.
    expect(new Set(colors).size).toBe(3);
  });

  test("a single measurement draws NO sparkline (a series needs at least two points)", () => {
    const { container } = renderTile({
      servers: ONE_SERVER,
      scans: [scan({ id: "s-1", serverId: "srv-a", serverName: "Alpha" })],
    });
    expect(container.querySelectorAll('[data-testid="sparkline"]').length).toBe(0);
  });

  test("the fleet series carries a server's last known figure forward and steps when one is added", () => {
    const { container } = renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" }), server({ id: "srv-b", name: "Bravo" })],
      scans: [
        scan({
          id: "b-1",
          serverId: "srv-b",
          serverName: "Bravo",
          scannedAt: "2026-01-03T00:00:00Z",
          totalTools: 500,
        }),
        scan({
          id: "a-2",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-01-02T00:00:00Z",
          totalTools: 90,
        }),
        scan({
          id: "a-1",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-01-01T00:00:00Z",
          totalTools: 100,
        }),
      ],
    });
    const spark = figure(container, "tools").querySelector('[data-testid="sparkline"]');
    // absolutes 100 → 90 → 590, normalised to the window minimum (90). Adding a server is a STEP,
    // not an erased series.
    expect((spark?.getAttribute("data-values") ?? "").split(",").map(Number)).toEqual([10, 0, 500]);
    expect(spark?.getAttribute("aria-label")).toBe(
      "Tools scanned: 100 → 590 across the last 3 scans",
    );
  });
});

/** NEGATIVE CONTROL — proves the Sparkline stub reflects the props it is handed, so the assertions
 *  above are about the tile's series and not about an inert mock. */
describe("NEGATIVE CONTROL — the stub is not permissive", () => {
  test("a Sparkline mounted directly records exactly the props it received", async () => {
    const { Sparkline } = await import("@elabs-ai/components-charts");
    render(
      <Sparkline
        values={[7, 8, 9]}
        variant="bar"
        label="raw"
        className="h-2"
        preserveAspectRatio="xMidYMid"
        width={11}
        height={22}
        style={{ color: "var(--chart-9)" }}
      />,
    );
    const spark = screen.getByTestId("sparkline");
    expect(spark.getAttribute("data-values")).toBe("7,8,9");
    expect(spark.getAttribute("data-variant")).toBe("bar");
    expect(spark.getAttribute("data-emphasize-last")).toBe("false");
    expect(spark.getAttribute("aria-label")).toBe("raw");
    expect(spark.getAttribute("data-classname")).toBe("h-2");
    expect(spark.getAttribute("data-preserve-aspect-ratio")).toBe("xMidYMid");
    expect(spark.getAttribute("data-viewbox")).toBe("11x22");
    expect(spark.getAttribute("data-color")).toBe("var(--chart-9)");
  });
});
