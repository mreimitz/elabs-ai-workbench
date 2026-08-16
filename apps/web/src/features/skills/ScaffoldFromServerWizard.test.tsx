import type { ScanDetail, ScanSummary, ServerConfig, ToolScan } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// M5 — `pickServer` → `loadToolsForServer` called `apiGet<ScanDetail>(...).then((detail) =>
// setTools(detail.tools))` with no latest-wins guard. Picking server A then quickly re-picking
// server B could let A's (slower) response resolve AFTER B's and overwrite the tool list with the
// wrong server's tools. Locks the request-token fix: the latest pick always wins.

// jsdom omits matchMedia — Radix (Dialog/Select) + @brand/data's DataTable toolbar read it.
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

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    apiGet: vi.fn(),
    listServerTypes: vi.fn().mockResolvedValue([]),
  };
});

import * as api from "../../lib/api";
import { ScaffoldFromServerWizard } from "./ScaffoldFromServerWizard";

function makeServer(id: string, name: string): ServerConfig {
  return {
    id,
    name,
    transport: "stdio",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function makeScanSummary(id: string, serverId: string, serverName: string): ScanSummary {
  return {
    id,
    serverId,
    serverName,
    tokenProfile: "generic_o200k",
    scannedAt: "2026-01-01T00:00:00Z",
    status: "success",
    totalTools: 1,
    totalTokens: 10,
    totalRawBytes: 10,
    averageTokensPerTool: 10,
    largestToolTokens: 10,
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

function makeTool(name: string): ToolScan {
  return {
    id: `tool-row-${name}`,
    scanId: "scan",
    toolName: name,
    totalTokens: 5,
    nameTokens: 1,
    descriptionTokens: 1,
    schemaTokens: 1,
    annotationsTokens: 0,
    rawBytes: 20,
    rawTool: {},
    contributionPercent: 100,
  };
}

function makeScanDetail(
  id: string,
  serverId: string,
  serverName: string,
  tools: ToolScan[],
): ScanDetail {
  return {
    ...makeScanSummary(id, serverId, serverName),
    tools,
    resources: [],
    prompts: [],
    events: [],
  };
}

describe("ScaffoldFromServerWizard — pickServer stale-server race (M5)", () => {
  afterEach(() => {
    vi.mocked(api.apiGet).mockReset();
    vi.restoreAllMocks();
  });

  it("keeps the LATEST picked server's tools even when the earlier pick's scan detail resolves later", async () => {
    const serverA = makeServer("server-a", "Server A");
    const serverB = makeServer("server-b", "Server B");
    const scanA = makeScanSummary("scan-a", "server-a", "Server A");
    const scanB = makeScanSummary("scan-b", "server-b", "Server B");

    let resolveScanA!: (value: ScanDetail) => void;
    const scanAPromise = new Promise<ScanDetail>((resolve) => {
      resolveScanA = resolve;
    });
    const scanBDetail = makeScanDetail("scan-b", "server-b", "Server B", [makeTool("tool-b")]);

    vi.mocked(api.apiGet).mockImplementation((path: string) => {
      if (path === "/api/servers") return Promise.resolve([serverA, serverB]) as Promise<unknown>;
      if (path === "/api/scans") return Promise.resolve([scanA, scanB]) as Promise<unknown>;
      if (path === "/api/scans/scan-a") return scanAPromise as Promise<unknown>;
      if (path === "/api/scans/scan-b") return Promise.resolve(scanBDetail) as Promise<unknown>;
      throw new Error(`unexpected apiGet(${path})`);
    });

    render(<ScaffoldFromServerWizard open onOpenChange={() => {}} onCreated={() => {}} />);

    const pickA = await screen.findByRole("button", { name: /Server A/ });
    fireEvent.click(pickA); // starts the SLOWER scan-a fetch (never resolves yet)

    const pickB = await screen.findByRole("button", { name: /Server B/ });
    fireEvent.click(pickB); // starts + resolves the FASTER scan-b fetch

    // "Continue" (server -> tools) is disabled while `loadingTools` is true; wait for it to clear,
    // which happens once B's (faster) fetch settles.
    const continueButton = await screen.findByRole("button", { name: "Continue" });
    await waitFor(() => expect(continueButton).not.toBeDisabled());
    fireEvent.click(continueButton);

    expect(await screen.findByRole("checkbox", { name: "Select tool-b" })).toBeInTheDocument();

    // Now resolve the STALE server-a scan — it must NOT overwrite the tool list with A's tools.
    resolveScanA(makeScanDetail("scan-a", "server-a", "Server A", [makeTool("tool-a")]));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByRole("checkbox", { name: "Select tool-a" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select tool-b" })).toBeInTheDocument();
  });
});
