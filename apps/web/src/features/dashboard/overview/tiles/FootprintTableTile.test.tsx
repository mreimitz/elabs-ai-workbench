import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@elabs-ai/components-ui";
import type { ScanSummary, ServerConfig } from "@mcp-token-footprint/shared";
import { FootprintTableTile } from "./FootprintTableTile";

/**
 * dashboard-bento WP 2.1 — `FootprintTableTile`.
 *
 * The whole point of this tile is that it is `ScansTab.tsx`'s footprint table MOVED, not rebuilt, so
 * these tests lock the properties that a "subtly different second table" would quietly lose: the
 * seven columns and their exact headers, the tools-only "Tool tokens" label (T10), the Δ column's
 * refusal to invent a zero, the whole-row click target, pagination at the same page size, the
 * responsive horizontal scroll, and the excluded-servers footnote.
 *
 * Everything is the REAL `@elabs-ai/components-data` `DataTable` and the REAL
 * `@elabs-ai/components-ui`; `IconButton` renders a Radix `Tooltip`, hence the `TooltipProvider`.
 */

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

function renderTile(props: Partial<Parameters<typeof FootprintTableTile>[0]> = {}) {
  const onOpenServer = vi.fn();
  const result = render(
    <TooltipProvider>
      <FootprintTableTile servers={[]} scans={[]} onOpenServer={onOpenServer} {...props} />
    </TooltipProvider>,
  );
  return { ...result, onOpenServer };
}

/** N servers, each with one successful scan — the shape that drives the sizing + pagination rules. */
function fleet(count: number): { servers: ServerConfig[]; scans: ScanSummary[] } {
  const servers: ServerConfig[] = [];
  const scans: ScanSummary[] = [];
  for (let i = 0; i < count; i++) {
    const id = `srv-${i}`;
    const name = `Server ${i}`;
    servers.push(server({ id, name }));
    scans.push(scan({ id: `scan-${i}`, serverId: id, serverName: name, totalTokens: 1000 + i }));
  }
  return { servers, scans };
}

const COLUMN_HEADERS = [
  "Server",
  "Tools",
  "Tool tokens",
  "Δ vs previous",
  "Largest tool",
  "Last scan",
];

describe("FootprintTableTile — self-hiding", () => {
  test("no successful scans renders NOTHING (the bento never shows an empty box)", () => {
    const { container } = renderTile({ servers: [server({ id: "srv-a", name: "Alpha" })] });
    expect(container).toBeEmptyDOMElement();
  });

  test("a fleet whose only scan FAILED renders nothing — a failure is not a footprint", () => {
    const { container } = renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "s1", serverId: "srv-a", status: "failed" })],
    });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("FootprintTableTile — the columns carried across from ScansTab", () => {
  test("keeps every column, with the tools-only token label intact (T10)", () => {
    renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })],
    });
    for (const header of COLUMN_HEADERS) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
    // A bare "Tokens" would collide with the Overview's tools+resources+prompts headline.
    expect(screen.queryByText("Tokens")).not.toBeInTheDocument();
    // The actions column's header is visually hidden but announced.
    expect(screen.getByText("Open server")).toBeInTheDocument();
  });

  test("renders the row's real figures", () => {
    renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [
        scan({
          id: "s1",
          serverId: "srv-a",
          serverName: "Alpha",
          totalTools: 12,
          totalTokens: 4321,
          largestToolName: "create_pull_request",
        }),
      ],
    });
    const row = screen.getByRole("row", { name: /Alpha/ });
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("4,321")).toBeInTheDocument();
    expect(within(row).getByText("create_pull_request")).toBeInTheDocument();
  });

  test("Δ vs previous is an em dash on a first-ever scan — never a fabricated 0", () => {
    renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })],
    });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  test("Δ vs previous compares against the PREVIOUS successful same-server scan", () => {
    renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [
        scan({
          id: "s2",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-02-01T00:00:00Z",
          totalTokens: 1250,
        }),
        scan({
          id: "s1",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-01-01T00:00:00Z",
          totalTokens: 1000,
        }),
      ],
    });
    expect(screen.getByText("+250")).toBeInTheDocument();
  });

  test("only each server's LATEST successful scan is listed", () => {
    renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [
        scan({
          id: "s2",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-02-01T00:00:00Z",
          totalTokens: 1250,
        }),
        scan({
          id: "s1",
          serverId: "srv-a",
          serverName: "Alpha",
          scannedAt: "2026-01-01T00:00:00Z",
          totalTokens: 1000,
        }),
      ],
    });
    expect(
      screen.getAllByRole("row").filter((row) => row.textContent?.includes("Alpha")).length,
    ).toBe(1);
  });
});

describe("FootprintTableTile — navigation", () => {
  test("the server cell's button opens that server", () => {
    const { onOpenServer } = renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })],
    });
    // CARRIED-OVER DEFECT, locked here so it is visible rather than silently reproduced: the row
    // exposes TWO controls named "Open Alpha" — the `navCol` name cell and the `actionsCol`
    // chevron — which is the duplicate accessible name `lib/table.tsx`'s own `actionsCol` doc warns
    // against on a `navCol` + `clickableRowTableProps` table. It is `ScansTab.tsx`'s existing
    // column set, and this WP is a MOVE, not a redesign; removing the chevron column is a change to
    // the table's columns and belongs to whoever owns that decision.
    const controls = screen.getAllByRole("button", { name: "Open Alpha" });
    expect(controls.length).toBe(2);
    for (const [index, control] of controls.entries()) {
      fireEvent.click(control);
      expect(onOpenServer).toHaveBeenNthCalledWith(index + 1, "srv-a");
    }
  });

  test("the WHOLE row is a click target (ui-wave U7), not just the name", () => {
    const { onOpenServer } = renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha", totalTools: 12 })],
    });
    // Click a plain, non-interactive cell — the delegation must re-dispatch to the row's nav control.
    fireEvent.click(screen.getByText("12"));
    expect(onOpenServer).toHaveBeenCalledWith("srv-a");
  });
});

describe("FootprintTableTile — the table recipe (pagination, responsive scroll, sizing)", () => {
  test("pagination appears only once the fleet exceeds one page of 10", () => {
    const small = renderTile(fleet(10));
    expect(small.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
    small.unmount();

    renderTile(fleet(11));
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
  });

  test("the table can scroll horizontally below `lg` instead of silently clipping columns", () => {
    const { container } = renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" })],
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })],
    });
    // `className` on an SVG is an `SVGAnimatedString`, so read the attribute rather than the prop.
    const classes = [...container.querySelectorAll("[class]")].map(
      (el) => el.getAttribute("class") ?? "",
    );
    expect(classes.some((c) => c.includes("overflow-x-auto!"))).toBe(true);
    // …and the row hover/cursor affordance that pairs with the whole-row click.
    expect(classes.some((c) => c.includes("cursor-pointer"))).toBe(true);
  });

  test("the tile spans the full bento width, and claims a second row once it has rows to show", () => {
    const wide = renderTile(fleet(8));
    const tile = wide.container.querySelector<HTMLElement>('[data-slot="bento-grid-item"]');
    expect(tile?.style.gridColumn).toBe("span 4 / span 4");
    expect(tile?.style.gridRow).toBe("span 2 / span 2");
    wide.unmount();

    // A two-server fleet must NOT claim a 29 rem box it cannot fill.
    const short = renderTile(fleet(2));
    const shortTile = short.container.querySelector<HTMLElement>('[data-slot="bento-grid-item"]');
    expect(shortTile?.style.gridColumn).toBe("span 4 / span 4");
    expect(shortTile?.style.gridRow).toBe("");
  });
});

describe("FootprintTableTile — the excluded-servers footnote (D3)", () => {
  test("names how many servers are missing from the table, in the singular", () => {
    renderTile({
      servers: [server({ id: "srv-a", name: "Alpha" }), server({ id: "srv-b", name: "Bravo" })],
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })],
    });
    expect(
      screen.getByText("1 server has no successful scan yet and is excluded above."),
    ).toBeInTheDocument();
  });

  test("…and in the plural", () => {
    renderTile({
      servers: [
        server({ id: "srv-a", name: "Alpha" }),
        server({ id: "srv-b", name: "Bravo" }),
        server({ id: "srv-c", name: "Charlie" }),
      ],
      scans: [scan({ id: "s1", serverId: "srv-a", serverName: "Alpha" })],
    });
    expect(
      screen.getByText("2 servers have no successful scan yet and are excluded above."),
    ).toBeInTheDocument();
  });

  test("no footnote when every configured server has a successful scan", () => {
    renderTile(fleet(3));
    expect(screen.queryByText(/excluded above/)).not.toBeInTheDocument();
  });
});
