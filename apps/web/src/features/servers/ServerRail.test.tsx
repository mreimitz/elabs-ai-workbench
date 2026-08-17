import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ScanSummary, ServerConfig, ServerType } from "@mcp-token-footprint/shared";
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
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}
if (typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver;
}

import { ServerRail } from "./ServerRail";

function server(id: string, name: string, typeId: string | null): ServerConfig {
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
    typeId
  };
}

const TYPES: ServerType[] = [
  {
    id: "t-saas",
    name: "Acme-SaaS",
    status: "production",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    memberCount: 1
  },
  {
    id: "t-stage",
    name: "acme-stage",
    status: "beta",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    memberCount: 1
  }
];

function renderRail(servers: ServerConfig[], serverTypes: ServerType[]) {
  return render(
    <TooltipProvider>
      <ServerRail
        isBusy={() => false}
        latestScansByServer={new Map<string, ScanSummary>()}
        selectedServerId={null}
        servers={servers}
        serverTypes={serverTypes}
        onAddServer={() => {}}
        onManageTypes={() => {}}
        onDeleteServer={() => {}}
        onEditServer={() => {}}
        onRunScan={() => {}}
        onSelectServer={() => {}}
        onTestServer={() => {}}
      />
    </TooltipProvider>
  );
}

describe("ServerRail — server-type grouping (WP 2.1)", () => {
  test("groups servers under type headers with status badges and an Untyped tail", () => {
    renderRail(
      [
        server("s1", "Prod alpha", "t-saas"),
        server("s2", "Stage beta", "t-stage"),
        server("s3", "Loose box", null)
      ],
      TYPES
    );

    // Type headers.
    expect(screen.getByText("Acme-SaaS")).toBeInTheDocument();
    expect(screen.getByText("acme-stage")).toBeInTheDocument();
    // The "Untyped" tail group for a server with no type.
    expect(screen.getByText("Untyped")).toBeInTheDocument();

    // Status badges (from the type's lifecycle status).
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();

    // Every server still renders as a row.
    expect(screen.getByText("Prod alpha")).toBeInTheDocument();
    expect(screen.getByText("Stage beta")).toBeInTheDocument();
    expect(screen.getByText("Loose box")).toBeInTheDocument();

    // The type filter control is present once ≥1 type is in use.
    expect(screen.getByLabelText("Filter servers by type")).toBeInTheDocument();
  });

  test("a fleet with no types renders the flat list with no headers or filter", () => {
    renderRail([server("s1", "Alpha", null), server("s2", "Beta box", null)], []);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta box")).toBeInTheDocument();
    // No grouping chrome when nothing can be grouped.
    expect(screen.queryByText("Untyped")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter servers by type")).not.toBeInTheDocument();
  });

  test("renders an empty state when there are no servers at all", () => {
    renderRail([], TYPES);
    expect(screen.getByText("No servers")).toBeInTheDocument();
  });
});

// T7 — server health was colour-only (a reddened token number), and a never-scanned server looked
// identical to a healthy one. Each state now carries a labelled StatusBadge (+ an aria-labelled dot),
// distinguishing never-scanned · healthy · last-scan-failed · auth-expired.
describe("ServerRail — server health (T7)", () => {
  function scanSummary(serverId: string, overrides: Partial<ScanSummary>): ScanSummary {
    return {
      id: `scan-${serverId}`,
      serverId,
      serverName: serverId,
      tokenProfile: "generic_o200k",
      scannedAt: "2026-01-02T00:00:00Z",
      status: "success",
      totalTools: 3,
      totalTokens: 1234,
      totalRawBytes: 0,
      averageTokensPerTool: 0,
      largestToolTokens: 0,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceTokens: 0,
      largestPromptTokens: 0,
      countingVersion: 2,
      ...overrides
    };
  }

  test("distinguishes never-scanned, healthy, last-scan-failed, and auth-expired", () => {
    const scans = new Map<string, ScanSummary>([
      ["s-ok", scanSummary("s-ok", { status: "success", totalTokens: 1234 })],
      ["s-fail", scanSummary("s-fail", { status: "failed" })],
      ["s-auth", scanSummary("s-auth", { status: "failed", authRequired: true })]
    ]);
    render(
      <TooltipProvider>
        <ServerRail
          isBusy={() => false}
          latestScansByServer={scans}
          selectedServerId={null}
          servers={[
            server("s-new", "Never", null),
            server("s-ok", "Healthy", null),
            server("s-fail", "Broken", null),
            server("s-auth", "Expired", null)
          ]}
          serverTypes={[]}
          onAddServer={() => {}}
          onManageTypes={() => {}}
          onDeleteServer={() => {}}
          onEditServer={() => {}}
          onRunScan={() => {}}
          onSelectServer={() => {}}
          onTestServer={() => {}}
        />
      </TooltipProvider>
    );

    // Attention states carry a labelled chip — never colour alone.
    expect(screen.getByText("Not scanned")).toBeInTheDocument();
    expect(screen.getByText("Scan failed")).toBeInTheDocument();
    expect(screen.getByText("Auth expired")).toBeInTheDocument();
    // A healthy server shows its token total (no green wall of chips) + an aria-labelled "Healthy" dot.
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByLabelText("Healthy")).toBeInTheDocument();
  });
});

// WP 3.2 (toolbar-reach Phase 3, D-TB5): the row menu trigger is now an IconButton (tooltip ===
// aria-label) wrapped by DropdownMenuTrigger asChild. Confirms the Radix Slot + Tooltip composition
// still opens the menu (IconButton forwards ref/props to the underlying Button via its own
// Tooltip/span wrapper — see components/IconButton.tsx's docblock).
describe("ServerRail — row menu trigger is an IconButton (WP 3.2)", () => {
  test("opening 'More actions' shows the row menu with Edit/Test connection/Delete", async () => {
    renderRail([server("s1", "Prod alpha", null)], []);

    // Radix's DropdownMenuTrigger only listens for pointerdown/keydown, not click (established
    // precedent — see WatchRulesView.test.tsx) — fireEvent.click alone never opens it in jsdom.
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions for Prod alpha" }), {
      key: "Enter",
    });

    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Test connection" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });
});
