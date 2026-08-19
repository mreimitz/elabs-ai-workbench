import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { FootprintData, SectionEnvelope } from "../overview-contract";
import { MoversTile, countFirstMeasured, deriveMovers, moverDiffHref } from "./MoversTile";

// Fixtures are LOCAL on purpose (WP 1.3): WP 1.1's hook is built in parallel, so this suite pins the
// tile against the committed CONTRACT only.

type Series = FootprintData["perServer"][number];

function series(serverId: string, serverName: string, values: number[]): Series {
  return {
    serverId,
    serverName,
    points: values.map((value, index) => ({
      bucketStart: `2026-08-0${index + 1}T00:00:00.000Z`,
      value,
    })),
  };
}

function footprint(perServer: Series[]): FootprintData {
  return {
    perServer,
    totalTokens: perServer.reduce((sum, s) => sum + (s.points[s.points.length - 1]?.value ?? 0), 0),
    deltaTokens: null,
    firstTimeServers: 0,
    mix: null,
  };
}

function ready(perServer: Series[]): SectionEnvelope<FootprintData> {
  return { state: "ready", data: footprint(perServer), error: null };
}

function renderTile(section: SectionEnvelope<FootprintData>, onRetry?: () => void) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <MoversTile section={section} onRetry={onRetry} />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("deriveMovers — what counts as a mover", () => {
  test("ranks by |Δ| between the last two measured points, biggest first", () => {
    const movers = deriveMovers([
      series("a", "Alpha", [10_000, 11_000]), // +1,000
      series("b", "Beta", [40_000, 28_000]), // −12,000
      series("c", "Gamma", [5_000, 8_000]), // +3,000
    ]);
    expect(movers.map((m) => m.serverId)).toEqual(["b", "c", "a"]);
    expect(movers.map((m) => m.deltaTokens)).toEqual([-12_000, 3_000, 1_000]);
    expect(movers[0]?.currentTokens).toBe(28_000);
  });

  test("a server measured only ONCE is not a mover — a Δ against no baseline is never invented", () => {
    expect(deriveMovers([series("a", "Alpha", [10_000])])).toEqual([]);
  });

  test("a server that held steady is not a mover", () => {
    expect(deriveMovers([series("a", "Alpha", [10_000, 10_000])])).toEqual([]);
  });

  test("a zero-filled bucket is NOT treated as a measurement (no fake −100% swing)", () => {
    // Whether the hook densifies with zeros or omits the bucket, the Δ must be 11,000 → 12,000.
    const movers = deriveMovers([series("a", "Alpha", [11_000, 0, 12_000])]);
    expect(movers).toHaveLength(1);
    expect(movers[0]?.deltaTokens).toBe(1_000);
  });

  test("points are ordered by bucket, not by array position", () => {
    const out = deriveMovers([
      {
        serverId: "a",
        serverName: "Alpha",
        points: [
          { bucketStart: "2026-08-03T00:00:00.000Z", value: 12_000 },
          { bucketStart: "2026-08-01T00:00:00.000Z", value: 10_000 },
        ],
      },
    ]);
    expect(out[0]?.deltaTokens).toBe(2_000);
    expect(out[0]?.currentTokens).toBe(12_000);
  });

  test("countFirstMeasured counts exactly the servers with one measured point", () => {
    expect(
      countFirstMeasured([
        series("a", "Alpha", [10_000]),
        series("b", "Beta", [1_000, 2_000]),
        series("c", "Gamma", [0, 5_000]),
      ]),
    ).toBe(2);
  });
});

describe("MoversTile — empty behaviour", () => {
  test("SELF-HIDES when the footprint section is empty", () => {
    const { container } = renderTile({ state: "empty", data: null, error: null });
    expect(container).toBeEmptyDOMElement();
  });

  test("SELF-HIDES when nothing has a comparable Δ — 'nothing moved' is not a movers list", () => {
    const { container } = renderTile(ready([series("a", "Alpha", [10_000])]));
    expect(container).toBeEmptyDOMElement();
  });

  test("an error is surfaced, never swallowed into an empty tile", () => {
    renderTile({ state: "error", data: null, error: "scan metrics unavailable" });
    expect(screen.getByText(/Couldn’t load footprint movers/)).toBeInTheDocument();
    expect(screen.getByText("scan metrics unavailable")).toBeInTheDocument();
  });

  test("loading renders a layout-shaped placeholder", () => {
    const { container } = renderTile({ state: "loading", data: null, error: null });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe("MoversTile — rows", () => {
  test("Δ tone comes from the app's ONE delta authority: growth amber, shrink green", () => {
    renderTile(
      ready([series("a", "Alpha", [10_000, 22_000]), series("b", "Beta", [40_000, 35_000])]),
    );

    // `ScanDeltaCell` → `deltaTextTone(delta, false)`: more tokens is WORSE → amber (never red,
    // which D-IC3 reserves for structural removal); fewer tokens is better → green.
    const grew = screen.getByText("+12,000");
    expect(grew.className).toContain("text-warning-text");
    expect(grew.className).not.toContain("text-destructive");

    const shrank = screen.getByText("-5,000");
    expect(shrank.className).toContain("text-success-text");
  });

  test("each row links to its server and to a diff of that server against its previous scan", () => {
    renderTile(ready([series("srv-a", "Alpha", [10_000, 22_000])]));

    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/servers/srv-a");
    expect(
      screen.getByRole("link", { name: "Diff Alpha against its previous scan" }),
    ).toHaveAttribute("href", "/compare/scans?serverA=srv-a&serverB=srv-a");
    expect(screen.getByRole("link", { name: "Open Alpha" })).toHaveAttribute(
      "href",
      "/servers/srv-a",
    );
  });

  test("moverDiffHref names the server on both sides — the compare workspace's diff-vs-previous default", () => {
    expect(moverDiffHref("srv-x")).toBe("/compare/scans?serverA=srv-x&serverB=srv-x");
  });

  test("the current footprint is stated alongside the Δ, with tabular digits", () => {
    renderTile(ready([series("srv-a", "Alpha", [10_000, 22_000])]));
    const figure = screen.getByText("22,000 tokens now");
    expect(figure.className).toContain("tabular-nums");
  });

  test("lists at most five movers", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      series(`srv-${i}`, `Server ${i}`, [1_000, 1_000 + (i + 1) * 100]),
    );
    renderTile(ready(many));
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  test("first-measured servers are DISCLOSED rather than silently dropped from the ranking", () => {
    renderTile(
      ready([series("srv-a", "Alpha", [10_000, 22_000]), series("srv-b", "Beta", [7_000])]),
    );
    expect(screen.queryByRole("link", { name: "Beta" })).not.toBeInTheDocument();
    expect(screen.getByText(/1 server was measured once in this window/)).toBeInTheDocument();
  });

  test("long server names truncate rather than overflow the tile", () => {
    renderTile(
      ready([series("srv-a", "A very long MCP server name that will not fit", [10_000, 22_000])]),
    );
    const link = screen.getByRole("link", {
      name: "A very long MCP server name that will not fit",
    });
    const span = link.querySelector("span");
    expect(span?.className).toContain("truncate");
    expect(span?.className).toContain("min-w-0");
  });
});
