import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type {
  AllowedServer,
  ScanDetail,
  ServerConfig,
  ServerType,
  ToolScan,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@elabs-ai/components-ui";

import { AddServerModal } from "./AddServerModal";

// jsdom omits matchMedia — Radix (Dialog/RadioGroup) reads it (mirrors EnvironmentEditor.test.tsx).
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

function type(
  overrides: Partial<ServerType> & { id: string; name: string; status: ServerType["status"] },
): ServerType {
  return {
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    memberCount: 1,
    ...overrides,
  };
}

function tool(name: string, tokens: number): ToolScan {
  return {
    id: `tool-${name}`,
    scanId: "scan",
    toolName: name,
    totalTokens: tokens,
    nameTokens: 1,
    descriptionTokens: 1,
    schemaTokens: 1,
    annotationsTokens: 0,
    rawBytes: tokens * 4,
    rawTool: {},
    contributionPercent: 100,
  };
}

/** A minimal successful ScanDetail for a server, keyed into `latestScans` by `serverId`. */
function scan(overrides: {
  serverId: string;
  scannedAt: string;
  status?: ScanDetail["status"];
  tools?: ToolScan[];
}): ScanDetail {
  const tools = overrides.tools ?? [tool("query", 100), tool("load", 50)];
  return {
    id: `scan-${overrides.serverId}`,
    serverId: overrides.serverId,
    serverName: overrides.serverId,
    tokenProfile: "generic_o200k",
    scannedAt: overrides.scannedAt,
    status: overrides.status ?? "success",
    totalTools: tools.length,
    totalTokens: tools.reduce((sum, t) => sum + t.totalTokens, 0),
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
    tools,
    resources: [],
    prompts: [],
    events: [],
  };
}

function renderModal(args: {
  servers: ServerConfig[];
  serverTypes?: ServerType[];
  latestScans: Map<string, ScanDetail>;
  existing?: AllowedServer[];
}) {
  const onAdd = vi.fn<(entry: AllowedServer) => void>();
  render(
    <TooltipProvider>
      <AddServerModal
        open
        onOpenChange={() => {}}
        servers={args.servers}
        serverTypes={args.serverTypes ?? []}
        latestScans={args.latestScans}
        existing={args.existing ?? []}
        onAdd={onAdd}
      />
    </TooltipProvider>,
  );
  return { onAdd };
}

/** Switch the step-0 source toggle to "A server type". */
function selectTypeSource() {
  fireEvent.click(screen.getByRole("radio", { name: /a server type/i }));
}

describe("AddServerModal — attach by server type (WP 4.2)", () => {
  test("defaults to the server source and adds a plain server with a concrete id", () => {
    const { onAdd } = renderModal({
      servers: [server({ id: "srv-plain", name: "Plain server" })],
      latestScans: new Map([["srv-plain", scan({ serverId: "srv-plain", scannedAt: "2026-01-01T00:00:00Z" })]]),
    });
    // Server source is the default — pick the server, then confirm.
    fireEvent.click(screen.getByRole("button", { name: /Plain server/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[0]).toEqual({ serverId: "srv-plain", allowedTools: null });
  });

  test("attaching a type stores the D-ST3 representative's CONCRETE id (newest success scan)", () => {
    // Two members: EU scanned more recently than US → EU is the representative.
    const servers = [
      server({ id: "srv-eu", name: "Acme EU", typeId: "type-qs" }),
      server({ id: "srv-us", name: "Acme US", typeId: "type-qs" }),
    ];
    const latestScans = new Map<string, ScanDetail>([
      ["srv-eu", scan({ serverId: "srv-eu", scannedAt: "2026-02-01T00:00:00Z" })],
      ["srv-us", scan({ serverId: "srv-us", scannedAt: "2026-01-01T00:00:00Z" })],
    ]);
    const { onAdd } = renderModal({
      servers,
      serverTypes: [type({ id: "type-qs", name: "Acme-SaaS", status: "production", memberCount: 2 })],
      latestScans,
    });

    selectTypeSource();
    // The type row resolves transparently to the newer member.
    const typeRow = screen.getByRole("button", { name: /Acme-SaaS/i });
    expect(within(typeRow).getByText(/Resolves to Acme EU/i)).toBeInTheDocument();
    fireEvent.click(typeRow);

    // Step 1 shows the resolved "type → member", then confirm.
    expect(screen.getByRole("button", { name: "Add server" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[0]).toEqual({ serverId: "srv-eu", allowedTools: null });
  });

  test("D-ST3 tiebreak: equal scanned_at resolves to the member with the lower id (id ASC)", () => {
    // Same scanned_at for both members → id ASC wins ("srv-a" < "srv-b").
    const servers = [
      server({ id: "srv-b", name: "Member B", typeId: "type-qs" }),
      server({ id: "srv-a", name: "Member A", typeId: "type-qs" }),
    ];
    const latestScans = new Map<string, ScanDetail>([
      ["srv-b", scan({ serverId: "srv-b", scannedAt: "2026-01-01T00:00:00Z" })],
      ["srv-a", scan({ serverId: "srv-a", scannedAt: "2026-01-01T00:00:00Z" })],
    ]);
    const { onAdd } = renderModal({
      servers,
      serverTypes: [type({ id: "type-qs", name: "Acme-SaaS", status: "production", memberCount: 2 })],
      latestScans,
    });

    selectTypeSource();
    const typeRow = screen.getByRole("button", { name: /Acme-SaaS/i });
    expect(within(typeRow).getByText(/Resolves to Member A/i)).toBeInTheDocument();
    fireEvent.click(typeRow);
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[0]).toEqual({ serverId: "srv-a", allowedTools: null });
  });

  test("a type with no scanned member is disabled with an honest reason", () => {
    const servers = [server({ id: "srv-unscanned", name: "Unscanned", typeId: "type-beta" })];
    const { onAdd } = renderModal({
      servers,
      serverTypes: [type({ id: "type-beta", name: "Beta fleet", status: "beta", memberCount: 1 })],
      latestScans: new Map(), // no successful scan for the member
    });

    selectTypeSource();
    const typeRow = screen.getByRole("button", { name: /Beta fleet/i });
    expect(typeRow).toBeDisabled();
    expect(within(typeRow).getByText(/No scanned member/i)).toBeInTheDocument();

    // Clicking the disabled row cannot advance / add.
    fireEvent.click(typeRow);
    expect(screen.getByRole("button", { name: "Add server" })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("a type whose representative is already on the allow-list is disabled", () => {
    const servers = [server({ id: "srv-eu", name: "Acme EU", typeId: "type-qs" })];
    const latestScans = new Map<string, ScanDetail>([
      ["srv-eu", scan({ serverId: "srv-eu", scannedAt: "2026-02-01T00:00:00Z" })],
    ]);
    const { onAdd } = renderModal({
      servers,
      serverTypes: [type({ id: "type-qs", name: "Acme-SaaS", status: "production", memberCount: 1 })],
      latestScans,
      existing: [{ serverId: "srv-eu", allowedTools: null }], // the representative is already added
    });

    selectTypeSource();
    const typeRow = screen.getByRole("button", { name: /Acme-SaaS/i });
    expect(typeRow).toBeDisabled();
    expect(within(typeRow).getByText(/Representative already added/i)).toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  test("shows an empty state when there are no server types", () => {
    renderModal({
      servers: [server({ id: "srv-plain", name: "Plain" })],
      serverTypes: [],
      latestScans: new Map(),
    });
    selectTypeSource();
    expect(screen.getByText("No server types")).toBeInTheDocument();
  });
});
