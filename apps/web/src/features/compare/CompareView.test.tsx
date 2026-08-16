import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  ScanComparison,
  ScanSummary,
  ServerConfig,
  ServerType,
} from "@mcp-token-footprint/shared";
import { TooltipProvider } from "@brand/ui";

// CompareView self-fetches server types via `listServerTypes` (WP 4.1) — stub it so the test never
// makes a real request (mirrors EnvironmentEditor.test.tsx's api mock).
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listServerTypes: vi.fn(),
  };
});

import { listServerTypes } from "../../lib/api";
import { CompareView } from "./CompareView";

// jsdom omits matchMedia/ResizeObserver — Radix (Select) reads them (mirrors ServerWizard.test.tsx).
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

const listServerTypesMock = vi.mocked(listServerTypes);

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

function serverType(
  overrides: Partial<ServerType> & { id: string; name: string; status: ServerType["status"] },
): ServerType {
  return {
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    memberCount: 1,
    ...overrides,
  };
}

function scan(serverId: string, id: string): ScanSummary {
  return {
    id,
    serverId,
    serverName: serverId,
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
  };
}

/** Render CompareView inside a router + tooltip provider, flushing the mount `listServerTypes()`
 *  effect so the type filter (which depends on the fetched types) has resolved. `onCompare` returns
 *  a never-settling promise: the header/filter renders synchronously and we only assert on it, so
 *  the comparison body staying in "loading" is irrelevant to these tests. */
async function renderCompare(servers: ServerConfig[], scans: ScanSummary[]) {
  const onCompare = vi.fn(() => new Promise<ScanComparison>(() => {}));
  render(
    <MemoryRouter>
      <TooltipProvider>
        <CompareView servers={servers} scans={scans} onCompare={onCompare} />
      </TooltipProvider>
    </MemoryRouter>,
  );
  // Flush the listServerTypes() microtask so setServerTypes lands and the filter recomputes.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { onCompare };
}

describe("CompareView — type filter (WP 4.1)", () => {
  beforeEach(() => {
    listServerTypesMock.mockReset();
  });

  test("shows the type filter when a type is in use among servers with scans", async () => {
    listServerTypesMock.mockResolvedValue([
      serverType({ id: "type-beta", name: "qlik-stage", status: "beta" }),
    ]);
    await renderCompare(
      [
        server({ id: "srv-a", name: "Alpha", typeId: "type-beta" }),
        server({ id: "srv-b", name: "Bravo", typeId: "type-beta" }),
      ],
      [scan("srv-a", "scan-a"), scan("srv-b", "scan-b")],
    );
    expect(
      screen.getByRole("combobox", { name: "Filter servers by type" }),
    ).toBeInTheDocument();
  });

  test("hides the type filter when no server (with scans) has a known type", async () => {
    // Types exist but no eligible server references them → nothing to group by → no control.
    listServerTypesMock.mockResolvedValue([
      serverType({ id: "type-prod", name: "Qlik-SaaS", status: "production" }),
    ]);
    await renderCompare(
      [
        server({ id: "srv-a", name: "Alpha" }),
        server({ id: "srv-b", name: "Bravo", typeId: "type-gone" }), // dangling → untyped
      ],
      [scan("srv-a", "scan-a"), scan("srv-b", "scan-b")],
    );
    expect(
      screen.queryByRole("combobox", { name: "Filter servers by type" }),
    ).not.toBeInTheDocument();
  });

  test("hides the type filter when the types API fails (degrades to no types)", async () => {
    listServerTypesMock.mockRejectedValue(new Error("boom"));
    await renderCompare(
      [server({ id: "srv-a", name: "Alpha", typeId: "type-beta" })],
      [scan("srv-a", "scan-a"), scan("srv-a", "scan-a2")],
    );
    expect(
      screen.queryByRole("combobox", { name: "Filter servers by type" }),
    ).not.toBeInTheDocument();
    // The compare surface still renders (best-effort, no crash) — the A-side server picker is present.
    expect(screen.getByRole("combobox", { name: "Server A" })).toBeInTheDocument();
  });
});
