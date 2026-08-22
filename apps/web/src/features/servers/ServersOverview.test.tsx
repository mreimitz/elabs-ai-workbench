import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@elabs-ai/components-ui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ScanSummary, ServerConfig, ServerType } from "@mcp-token-footprint/shared";

// jsdom omits matchMedia/ResizeObserver — Radix (Select/DropdownMenu/ToggleGroup) reads them.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

const getSecurityFleetSummary = vi.fn();
vi.mock("../security/security-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../security/security-api")>();
  return { ...actual, getSecurityFleetSummary: () => getSecurityFleetSummary() };
});

import { ServersOverview } from "./ServersOverview";

// The fleet OVERVIEW (RM-32 WP 2.1) — this file carries the behaviours the deleted `ServerRail.test`
// pinned, because they were never about the rail: grouping by type with an `Untyped` TAIL, a type
// filter whose options come from the WHOLE fleet, the five health states, and "—" rather than a
// fabricated "0" for a server that has never been scanned successfully.

function server(id: string, name: string, typeId: string | null = null): ServerConfig {
  return {
    id,
    name,
    transport: "streamable_http",
    url: `https://${id}.example.com/mcp`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    typeId,
  };
}

function scan(serverId: string, overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    id: `scan_${serverId}`,
    serverId,
    serverName: serverId,
    tokenProfile: "generic_o200k",
    scannedAt: "2026-08-20T10:00:00.000Z",
    status: "success",
    totalTools: 3,
    totalTokens: 1200,
    totalRawBytes: 4000,
    averageTokensPerTool: 400,
    largestToolTokens: 600,
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

function serverType(id: string, name: string): ServerType {
  return {
    id,
    name,
    status: "production",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    memberCount: 1,
  };
}

function mount(options?: {
  servers?: ServerConfig[];
  serverTypes?: ServerType[];
  scans?: Map<string, ScanSummary>;
  onAddServer?: () => void;
  onRunScan?: (id: string) => void;
}) {
  return render(
    <MemoryRouter initialEntries={["/servers"]}>
      <TooltipProvider>
        <ServersOverview
          isBusy={() => false}
          servers={options?.servers ?? []}
          serverTypes={options?.serverTypes ?? []}
          latestScansByServer={options?.scans ?? new Map()}
          onAddServer={options?.onAddServer ?? (() => {})}
          onManageTypes={() => {}}
          onDeleteServer={() => {}}
          onEditServer={() => {}}
          onRunScan={options?.onRunScan ?? (() => {})}
          onTestServer={() => {}}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function cardFor(name: string): HTMLElement {
  const card = document.querySelector(`[data-entity-card="${name}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return card;
}

function groupLabels(): (string | null)[] {
  return screen.getAllByRole("region").map((section) => section.getAttribute("aria-label"));
}

beforeEach(() => {
  window.localStorage.clear();
  getSecurityFleetSummary.mockResolvedValue([]);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("ServersOverview — grouping", () => {
  test("groups by server type with the Untyped tail LAST", async () => {
    const prod = serverType("t1", "Production");
    const beta = serverType("t2", "Beta");
    mount({
      servers: [server("a", "Alpha", "t1"), server("b", "Beta srv", "t2"), server("c", "Gamma")],
      serverTypes: [prod, beta],
    });
    await screen.findByRole("link", { name: "Alpha" });
    expect(groupLabels()).toEqual(["Production", "Beta", "Untyped"]);
  });

  test("a dangling typeId reads as untyped rather than crashing", async () => {
    // `Alpha` points at a type that was deleted out from under it; `Beta srv` keeps a real one, so
    // grouping is active and the dangling server has somewhere visible to land.
    mount({
      servers: [server("a", "Alpha", "deleted-type"), server("b", "Beta srv", "t1")],
      serverTypes: [serverType("t1", "Production")],
    });
    await screen.findByRole("link", { name: "Alpha" });
    expect(groupLabels()).toEqual(["Production", "Untyped"]);
    expect(within(screen.getAllByRole("region")[1] as HTMLElement).getByRole("link", { name: "Alpha" })).toBeTruthy();
  });

  test("a fleet with no types at all renders flat, with no grouping headers", async () => {
    mount({ servers: [server("a", "Alpha"), server("b", "Beta srv")] });
    await screen.findByRole("link", { name: "Alpha" });
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });
});

describe("ServersOverview — the type filter", () => {
  test("its options come from the WHOLE fleet, so searching never removes a choice", async () => {
    mount({
      servers: [server("a", "Alpha", "t1"), server("b", "Beta srv", "t2")],
      serverTypes: [serverType("t1", "Production"), serverType("t2", "Beta")],
    });
    await screen.findByRole("link", { name: "Alpha" });
    fireEvent.change(screen.getByLabelText("Search servers"), { target: { value: "Alpha" } });
    // Only Alpha is visible, but BOTH types are still selectable.
    expect(screen.queryByRole("link", { name: "Beta srv" })).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Filter servers by type"), { key: "Enter" });
    expect(await screen.findByRole("option", { name: "Beta" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Production" })).toBeTruthy();
  });

  test("shows an em dash, never a 0, for a server that has never been scanned successfully", async () => {
    mount({
      servers: [server("a", "Alpha"), server("b", "Beta srv")],
      scans: new Map([["b", scan("b", { status: "failed" })]]),
    });
    await screen.findByRole("link", { name: "Alpha" });
    expect(within(cardFor("Alpha")).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(cardFor("Alpha")).queryByText("0")).toBeNull();
    expect(within(cardFor("Beta srv")).getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("ServersOverview — health states", () => {
  test("never scanned reads Not scanned", async () => {
    mount({ servers: [server("a", "Alpha")] });
    expect(await within(cardFor("Alpha")).findByText("Not scanned")).toBeTruthy();
  });

  test("a failed scan reads Scan failed; an auth-expired failure says so instead", async () => {
    mount({
      servers: [server("a", "Alpha"), server("b", "Beta srv")],
      scans: new Map([
        ["a", scan("a", { status: "failed" })],
        ["b", scan("b", { status: "failed", authRequired: true })],
      ]),
    });
    await screen.findByRole("link", { name: "Alpha" });
    expect(within(cardFor("Alpha")).getByText("Scan failed")).toBeTruthy();
    expect(within(cardFor("Beta srv")).getByText("Auth expired")).toBeTruthy();
  });

  test("a healthy server carries its token total and an aria-labelled dot instead of a chip", async () => {
    mount({ servers: [server("a", "Alpha")], scans: new Map([["a", scan("a")]]) });
    await screen.findByRole("link", { name: "Alpha" });
    const card = cardFor("Alpha");
    expect(within(card).getByText("1,200")).toBeTruthy();
    expect(within(card).getByRole("img", { name: "Healthy" })).toBeTruthy();
    expect(within(card).queryByText("Healthy", { selector: "span.inline-flex" })).toBeNull();
  });
});

describe("ServersOverview — actions and states", () => {
  test("an empty fleet offers Add server and Manage types", async () => {
    const onAddServer = vi.fn();
    mount({ onAddServer });
    const [addButton] = await screen.findAllByRole("button", { name: "Add server" });
    fireEvent.click(addButton as HTMLElement);
    expect(onAddServer).toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Manage types" }).length).toBeGreaterThan(0);
  });

  test("a card's Scan action runs a scan for THAT server without navigating", async () => {
    const onRunScan = vi.fn();
    mount({ servers: [server("a", "Alpha")], onRunScan });
    await screen.findByRole("link", { name: "Alpha" });
    fireEvent.click(screen.getByRole("button", { name: "Scan Alpha" }));
    expect(onRunScan).toHaveBeenCalledWith("a");
  });

  test("the card title links to that server's detail route", async () => {
    mount({ servers: [server("a", "Alpha")] });
    expect(await screen.findByRole("link", { name: "Alpha" })).toHaveAttribute(
      "href",
      "/servers/a",
    );
  });

  test("switching to the table keeps the same groups", async () => {
    mount({
      servers: [server("a", "Alpha", "t1"), server("c", "Gamma")],
      serverTypes: [serverType("t1", "Production")],
    });
    await screen.findByRole("link", { name: "Alpha" });
    fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
    await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2));
    expect(groupLabels()).toEqual(["Production", "Untyped"]);
  });
});

/**
 * RM-36 WP 2.2 · P2-2 — a card must not repeat what its own group heading already states.
 *
 * The measured defect: the section header reads `QLIK-SAAS · [Production] · 2`, and then EVERY card
 * inside it repeats `[qlik-saas] [Production]` as chips. By the reduction filter that is removable
 * without loss — the grouping IS the statement. The FINDINGS chip stays, because it varies within a
 * group. And because the status chips sat in the card's top-right `shrink-0` slot, they squeezed the
 * title: `mcp-assets` clipped to `mcp-ass…` (81px shown against 90px needed).
 */
describe("ServersOverview — P2-2: cards don't repeat their group heading (RM-36 WP 2.2)", () => {
  const STORAGE_PREFIX = "mcp-token-footprint.entity-browser.servers";
  const qlik = serverType("t1", "qlik-saas");

  test("drops the type + type-status chips from a card under a heading that names them", async () => {
    mount({ servers: [server("a", "mcp-assets", "t1")], serverTypes: [qlik] });
    await screen.findByRole("link", { name: "mcp-assets" });

    // The section header states the type and its lifecycle status once, for the whole section…
    const section = screen.getByRole("region", { name: "qlik-saas" });
    const header = within(section).getByText("qlik-saas");
    expect(within(header.parentElement as HTMLElement).getByText("Production")).toBeTruthy();

    // …and the card inside it no longer repeats either.
    const card = cardFor("mcp-assets");
    expect(within(card).queryByText("qlik-saas")).toBeNull();
    expect(within(card).queryByText("Production")).toBeNull();
  });

  test("KEEPS the findings chip on the card — it varies within a group", async () => {
    getSecurityFleetSummary.mockResolvedValue([
      {
        serverId: "a",
        serverName: "mcp-assets",
        scanId: "scan_a",
        scannedAt: "2026-08-20T10:00:00.000Z",
        score: { value: 70, band: "medium" as const, analyzerVersion: 1 },
        counts: { error: 1, warning: 0, info: 0, total: 1 },
      },
    ]);
    mount({
      servers: [server("a", "mcp-assets", "t1")],
      serverTypes: [qlik],
      scans: new Map([["a", scan("a")]]),
    });
    // RM-37 WP 0.5 — a COUNT, not a band word, while `FLEET_POSTURE_BAND_ACCEPTED` is false.
    expect(await within(cardFor("mcp-assets")).findByText("1 finding · 1 error")).toBeTruthy();
  });

  test("keeps the type chips when NOTHING else states them (grouping switched off)", async () => {
    window.localStorage.setItem(`${STORAGE_PREFIX}.group-by`, "none");
    mount({ servers: [server("a", "mcp-assets", "t1")], serverTypes: [qlik] });
    const card = cardFor("mcp-assets");
    expect(await within(card).findByText("qlik-saas")).toBeTruthy();
    expect(within(card).getByText("Production")).toBeTruthy();
  });

  test("gives the title row its width back — the status chips are no longer beside the name", async () => {
    mount({ servers: [server("a", "mcp-assets", "t1")], serverTypes: [qlik] });
    const title = await screen.findByRole("link", { name: "mcp-assets" });

    // The card's header row is `[ title + badges column ][ shrink-0 action cluster ]`. The status
    // chips used to live in that shrink-0 cluster, stealing width from the title beside it.
    const titleColumn = title.parentElement as HTMLElement;
    const headerRow = titleColumn.parentElement as HTMLElement;
    const actionCluster = headerRow.lastElementChild as HTMLElement;
    expect(actionCluster).not.toBe(titleColumn);

    // Nothing but the per-card actions competes with the title for the row's width…
    expect(within(actionCluster).queryByText("Not scanned")).toBeNull();
    expect(within(actionCluster).getByRole("button", { name: "Scan mcp-assets" })).toBeTruthy();
    // …and the chip is still rendered — it moved down onto the badges line under the title.
    expect(within(titleColumn).getByText("Not scanned")).toBeTruthy();
  });
});
