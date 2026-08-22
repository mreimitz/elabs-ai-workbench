import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScanSummary, SecurityFleetSummary, ServerConfig } from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";

// jsdom omits matchMedia/ResizeObserver — Radix (Select/DropdownMenu) reads them.
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

vi.mock("./security-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./security-api")>();
  return { ...actual, getSecurityFleetSummary: () => getSecurityFleetSummary() };
});

import { ServersOverview } from "../servers/ServersOverview";

// The servers-OVERVIEW posture badge (A6 / D-SP22; moved off the deleted rail by RM-32 WP 2.1). Two
// claims are worth pinning, and they are the two a naive badge gets wrong: it is ONE request for the
// whole fleet, not one per card; and a server with no usable scan renders the card's existing
// missing-data treatment rather than a fabricated clean score.

afterEach(() => {
  vi.clearAllMocks();
});

function server(id: string, name: string): ServerConfig {
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
    typeId: null,
  };
}

function successScan(serverId: string): ScanSummary {
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
  };
}

const posture = (
  serverId: string,
  value: number,
  band: SecurityFleetSummary["score"]["band"],
  counts: SecurityFleetSummary["counts"] = { error: 1, warning: 0, info: 0, total: 1 },
): SecurityFleetSummary => ({
  serverId,
  serverName: serverId,
  scanId: `scan_${serverId}`,
  scannedAt: "2026-08-20T10:00:00.000Z",
  score: { value, band, analyzerVersion: 1 },
  counts,
});

function renderOverview(servers: ServerConfig[], scans: Map<string, ScanSummary>) {
  return render(
    <MemoryRouter initialEntries={["/servers"]}>
      <TooltipProvider>
        <ServersOverview
          isBusy={() => false}
          latestScansByServer={scans}
          servers={servers}
          serverTypes={[]}
          onAddServer={() => {}}
          onManageTypes={() => {}}
          onDeleteServer={() => {}}
          onEditServer={() => {}}
          onRunScan={() => {}}
          onTestServer={() => {}}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

/** The card for one server — `Card` renders no identifying attribute of its own, so `EntityCard`
 *  stamps `data-entity-card` with the title. */
function cardFor(name: string): HTMLElement {
  const card = document.querySelector(`[data-entity-card="${name}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return card;
}

describe("the servers overview's posture badge (D-SP22)", () => {
  it("makes ONE request for the whole fleet, not one per row", async () => {
    getSecurityFleetSummary.mockResolvedValue([
      posture("a", 70, "medium", { error: 1, warning: 2, info: 9, total: 12 }),
      posture("b", 100, "clean", { error: 0, warning: 0, info: 0, total: 0 }),
      posture("c", 40, "high", { error: 4, warning: 0, info: 1, total: 5 }),
    ]);
    renderOverview(
      [server("a", "Alpha"), server("b", "Beta"), server("c", "Gamma")],
      new Map([
        ["a", successScan("a")],
        ["b", successScan("b")],
        ["c", successScan("c")],
      ]),
    );

    expect(await screen.findByText("12 findings · 1 error")).toBeTruthy();
    expect(screen.getByText("0 findings")).toBeTruthy();
    expect(screen.getByText("5 findings · 4 error")).toBeTruthy();
    // Three cards, one request.
    expect(getSecurityFleetSummary).toHaveBeenCalledTimes(1);
  });

  // RM-37 WP 0.5 (action 4) — the fleet list states a MEASUREMENT, not a judgement, until the
  // owner has accepted this analyzer's banding on their own servers (RM-20's "false-positive rate
  // on YOUR real servers" box, gated by `FLEET_POSTURE_BAND_ACCEPTED`). The rule change that
  // prompted it was a getter, `qlik_get_set_expression`, scoring the analyzer's one `error`.
  it("states a finding COUNT, never a risk band, while the banding is unaccepted", async () => {
    getSecurityFleetSummary.mockResolvedValue([
      posture("a", 70, "medium", { error: 0, warning: 1, info: 6, total: 7 }),
    ]);
    renderOverview([server("a", "Alpha")], new Map([["a", successScan("a")]]));

    expect(await screen.findByText("7 findings")).toBeTruthy();
    for (const band of ["Clean", "Low risk", "Medium risk", "High risk"]) {
      expect(screen.queryByText(band)).toBeNull();
    }
  });

  it("reserves the loud tone for a card that really carries an error finding", async () => {
    getSecurityFleetSummary.mockResolvedValue([
      posture("a", 90, "low", { error: 0, warning: 0, info: 10, total: 10 }),
      posture("b", 55, "high", { error: 2, warning: 1, info: 4, total: 7 }),
    ]);
    renderOverview(
      [server("a", "Alpha"), server("b", "Beta")],
      new Map([
        ["a", successScan("a")],
        ["b", successScan("b")],
      ]),
    );

    // Ten hygiene notes read as ten hygiene notes; two real errors are the ones that get shouted.
    const quiet = await screen.findByText("10 findings");
    const loud = screen.getByText("7 findings · 2 error");
    expect(quiet.className).not.toEqual(loud.className);
    expect(loud.className).toContain("destructive");
    expect(quiet.className).not.toContain("destructive");
  });

  it("shows a server with no usable scan as not-scanned, never as a score", async () => {
    // The endpoint OMITS a server with no `success` scan, so this card simply has no posture. The
    // card's existing "Not scanned" chip already explains the absence — no fabricated clean badge,
    // and no second bespoke "unknown" treatment beside a chip that already said it.
    getSecurityFleetSummary.mockResolvedValue([]);
    renderOverview([server("a", "Alpha")], new Map());

    expect(await screen.findByText("Not scanned")).toBeTruthy();
    for (const band of ["Clean", "Low risk", "Medium risk", "High risk"]) {
      expect(screen.queryByText(band)).toBeNull();
    }
  });

  it("marks a scanned server the summary does not cover with the card's own missing-data em dash", async () => {
    // A healthy card shows its token total; when the fleet answer has no posture for it (a scan that
    // settled between the two reads, a failed summary request) the slot reads "—", exactly as the
    // metric does when it has no number.
    getSecurityFleetSummary.mockResolvedValue([]);
    renderOverview([server("a", "Alpha")], new Map([["a", successScan("a")]]));

    await screen.findByRole("link", { name: "Alpha" });
    const card = cardFor("Alpha");
    await waitFor(() => expect(within(card).getByText("—")).toBeTruthy());
    expect(within(card).getByText("1,200")).toBeTruthy();
  });

  it("does not crash the overview when the fleet request fails", async () => {
    getSecurityFleetSummary.mockRejectedValue(new Error("summary unavailable"));
    renderOverview([server("a", "Alpha")], new Map([["a", successScan("a")]]));

    // The overview is a navigation surface first — a posture badge that cannot load must never cost
    // the operator the fleet.
    expect(await screen.findByRole("link", { name: "Alpha" })).toBeTruthy();
    await waitFor(() => expect(within(cardFor("Alpha")).getByText("—")).toBeTruthy());
  });
});
