import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ScanSummary } from "@mcp-token-footprint/shared";
import { RecentScansTile } from "./RecentScansTile";

/**
 * dashboard-bento WP 2.1 — `RecentScansTile`.
 *
 * `ScansTab.tsx`'s "Recent scan activity" table MOVED onto the bento, so these tests lock what a
 * rebuild would quietly lose: the five columns and their exact headers, the eight-row cap, the
 * tools-only "Tool tokens" label (T10), the quiet-success status treatment (D-TB11), failures NOT
 * being filtered out of an activity feed, the whole-row click target and the responsive horizontal
 * scroll.
 *
 * Everything is the REAL `@elabs-ai/components-data` `DataTable` and the REAL
 * `@elabs-ai/components-ui`; `IconButton` renders a Radix `Tooltip`, hence the `TooltipProvider`.
 */

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
    largestToolName: "search_repositories",
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

function renderTile(props: Partial<Parameters<typeof RecentScansTile>[0]> = {}) {
  const onOpenScan = vi.fn();
  const result = render(
    <TooltipProvider>
      <RecentScansTile scans={[]} onOpenScan={onOpenScan} {...props} />
    </TooltipProvider>,
  );
  return { ...result, onOpenScan };
}

/** `count` scans of one server, newest first — the order `/api/scans` returns. */
function feed(count: number): ScanSummary[] {
  return Array.from({ length: count }, (_, i) =>
    scan({
      id: `scan-${i}`,
      serverId: "srv-a",
      serverName: `Scan ${i}`,
      scannedAt: new Date(Date.UTC(2026, 0, 30 - i)).toISOString(),
    }),
  );
}

describe("RecentScansTile — self-hiding", () => {
  test("no scan activity renders NOTHING (the bento never shows an empty box)", () => {
    const { container } = renderTile();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("RecentScansTile — the columns carried across from ScansTab", () => {
  test("keeps every column, with the tools-only token label intact (T10)", () => {
    renderTile({ scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })] });
    for (const header of ["Server", "Status", "Tool tokens", "Date"]) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
    // The actions column's header is visually hidden but announced.
    expect(screen.getByText("Open scan")).toBeInTheDocument();
  });

  test("shows the eight most recent scans and no more", () => {
    renderTile({ scans: feed(12) });
    // 8 body rows + 1 header row.
    expect(screen.getAllByRole("row").length).toBe(9);
    expect(screen.getByText("Scan 0")).toBeInTheDocument();
    expect(screen.getByText("Scan 7")).toBeInTheDocument();
    expect(screen.queryByText("Scan 8")).not.toBeInTheDocument();
  });

  test("this is an ACTIVITY feed — a failed scan is a row, not a filtered-out one", () => {
    renderTile({
      scans: [
        scan({ id: "s1", serverId: "srv-a", serverName: "Alpha", status: "failed" }),
        scan({ id: "s2", serverId: "srv-b", serverName: "Bravo", status: "success" }),
      ],
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  test("D-TB11: a SUCCESS reads as quiet muted text, while a failure keeps its tone chip", () => {
    const { container } = renderTile({
      scans: [
        scan({ id: "s1", serverId: "srv-a", serverName: "Alpha", status: "success" }),
        scan({ id: "s2", serverId: "srv-b", serverName: "Bravo", status: "failed" }),
      ],
    });
    for (const node of screen.getAllByText("Completed")) {
      expect(node.closest("[data-status]")).toBeNull();
    }
    // `data-status` carries the resolved TONE, not the raw wire value — a failed scan is `danger`.
    expect(container.querySelector('[data-status="danger"]')?.textContent).toBe("Failed");
  });

  test("renders the row's real figures", () => {
    renderTile({
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha", totalTokens: 4321 })],
    });
    const row = screen.getByRole("row", { name: /Alpha/ });
    expect(within(row).getByText("4,321")).toBeInTheDocument();
  });
});

describe("RecentScansTile — navigation", () => {
  test("the server cell's button opens that SCAN (not the server)", () => {
    const { onOpenScan } = renderTile({
      scans: [scan({ id: "scan-9", serverId: "srv-a", serverName: "Alpha" })],
    });
    // CARRIED-OVER DEFECT, locked here so it is visible rather than silently reproduced: the row
    // exposes TWO controls named "Open scan of Alpha" — the `navCol` name cell and the `actionsCol`
    // chevron — the duplicate accessible name `lib/table.tsx`'s `actionsCol` doc warns against.
    // It is `ScansTab.tsx`'s existing column set and this WP is a MOVE, not a redesign.
    const controls = screen.getAllByRole("button", { name: "Open scan of Alpha" });
    expect(controls.length).toBe(2);
    for (const [index, control] of controls.entries()) {
      fireEvent.click(control);
      expect(onOpenScan).toHaveBeenNthCalledWith(index + 1, "scan-9");
    }
  });

  test("the WHOLE row is a click target (ui-wave U7), not just the name", () => {
    const { onOpenScan } = renderTile({
      scans: [scan({ id: "scan-9", serverId: "srv-a", serverName: "Alpha", totalTokens: 4321 })],
    });
    fireEvent.click(screen.getByText("4,321"));
    expect(onOpenScan).toHaveBeenCalledWith("scan-9");
  });
});

describe("RecentScansTile — the table recipe and sizing", () => {
  test("the table can scroll horizontally below `lg` instead of silently clipping columns", () => {
    const { container } = renderTile({ scans: [scan({ id: "s1", serverId: "srv-a" })] });
    // `className` on an SVG is an `SVGAnimatedString`, so read the attribute rather than the prop.
    const classes = [...container.querySelectorAll("[class]")].map(
      (el) => el.getAttribute("class") ?? "",
    );
    expect(classes.some((c) => c.includes("overflow-x-auto!"))).toBe(true);
    expect(classes.some((c) => c.includes("cursor-pointer"))).toBe(true);
  });

  test("the tile spans the full bento width, and only claims a second row once it has rows to show", () => {
    const wide = renderTile({ scans: feed(8) });
    const tile = wide.container.querySelector<HTMLElement>('[data-slot="bento-grid-item"]');
    expect(tile?.style.gridColumn).toBe("span 4 / span 4");
    expect(tile?.style.gridRow).toBe("span 2 / span 2");
    wide.unmount();

    const short = renderTile({ scans: feed(2) });
    const shortTile = short.container.querySelector<HTMLElement>('[data-slot="bento-grid-item"]');
    expect(shortTile?.style.gridColumn).toBe("span 4 / span 4");
    expect(shortTile?.style.gridRow).toBe("");
  });

  test("an eight-row feed needs no pagination chrome", () => {
    renderTile({ scans: feed(8) });
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });
});
