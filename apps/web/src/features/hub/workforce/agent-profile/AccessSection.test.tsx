import { useState } from "react";
import type { HubToolGrants, ScanDetail, ServerConfig } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api")>();
  return {
    ...actual,
    listServers: vi.fn(),
    apiGet: vi.fn(),
  };
});

beforeAll(() => {
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
});

import * as api from "../../../../lib/api";
import { AccessSection } from "./AccessSection";

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

function server(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: "srv-1",
    name: "Search Server",
    transport: "stdio",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    ...overrides,
  };
}

function scanWithTools(tools: { name: string; tokens: number }[]): ScanDetail {
  return {
    id: "scan-1",
    serverId: "srv-1",
    status: "success",
    tokenProfile: "generic_o200k",
    countingVersion: 2,
    totalTools: tools.length,
    totalTokens: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    tools: tools.map((t, index) => ({
      id: `tool-${index}`,
      scanId: "scan-1",
      toolName: t.name,
      totalTokens: t.tokens,
      nameTokens: 0,
      descriptionTokens: 0,
      schemaTokens: 0,
      contributionPercent: 0,
    })),
    resources: [],
    prompts: [],
    events: [],
  } as unknown as ScanDetail;
}

function Harness({ initial = EMPTY_GRANTS }: { initial?: HubToolGrants }) {
  const [value, setValue] = useState<HubToolGrants>(initial);
  return <AccessSection value={value} onChange={setValue} />;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listServers).mockResolvedValue([server()]);
  vi.mocked(api.apiGet).mockImplementation(async (path: string) => {
    if (path === "/api/servers/srv-1/latest-scan") {
      return scanWithTools([
        { name: "search", tokens: 120 },
        { name: "fetch", tokens: 340 },
      ]);
    }
    throw new Error(`unexpected apiGet(${path})`);
  });
});

async function expandServer(): Promise<void> {
  // The server list loads async — wait for it before clicking to expand it.
  fireEvent.click(await screen.findByText("Search Server"));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "search" })).toBeInTheDocument());
}

describe("AccessSection — per-tool scan token cost + footprint total (D-HUX7)", () => {
  test("each tool row shows its scan-measured token cost", async () => {
    render(<Harness />);
    await expandServer();
    expect(screen.getByText("120 tok")).toBeInTheDocument();
    expect(screen.getByText("340 tok")).toBeInTheDocument();
  });

  test("the granted-set footprint total sums only the granted tools' tokens", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("Granted footprint")).toBeInTheDocument());
    // Nothing granted yet → 0.
    expect(screen.getByText("0")).toBeInTheDocument();

    await expandServer();
    // Grant one tool (120).
    fireEvent.click(screen.getByRole("checkbox", { name: "search" }));
    await waitFor(() => expect(screen.getByText("120")).toBeInTheDocument());

    // Grant the second (120 + 340 = 460).
    fireEvent.click(screen.getByRole("checkbox", { name: "fetch" }));
    await waitFor(() => expect(screen.getByText("460")).toBeInTheDocument());
  });

  test("granting All tools via the master tri-state checkbox counts every tool", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("Search Server")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "Grant all tools from Search Server" }));
    await waitFor(() => expect(screen.getByText("460")).toBeInTheDocument());
    expect(screen.getByText("All tools")).toBeInTheDocument();
  });
});

describe("AccessSection — tri-state server checkbox", () => {
  test("unchecked with no grant, indeterminate with a partial grant, checked with 'all'", async () => {
    render(<Harness initial={{ servers: { "srv-1": ["search"] }, builtins: [] }} />);
    const master = await screen.findByRole("checkbox", {
      name: "Grant all tools from Search Server",
    });
    // A partial (explicit-list) grant reads as mixed/indeterminate.
    expect(master).toBePartiallyChecked();

    // Toggling the master to on grants "all".
    fireEvent.click(master);
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Grant all tools from Search Server" }),
      ).toBeChecked(),
    );
  });

  test("unchecking a single tool while 'all' converts the grant to an explicit list (footprint drops)", async () => {
    render(<Harness initial={{ servers: { "srv-1": "all" }, builtins: [] }} />);
    await expandServer();
    expect(screen.getByText("460")).toBeInTheDocument();

    // Uncheck 'fetch' (340) — grant materializes to ['search'] and the footprint drops to 120.
    fireEvent.click(screen.getByRole("checkbox", { name: "fetch" }));
    await waitFor(() => expect(screen.getByText("120")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "search" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "fetch" })).not.toBeChecked();
  });
});

describe("AccessSection — per-server search + all/none", () => {
  test("the search filters the server's tool rows", async () => {
    render(<Harness />);
    await expandServer();
    fireEvent.change(screen.getByPlaceholderText("Filter tools…"), { target: { value: "fetch" } });
    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: "search" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("checkbox", { name: "fetch" })).toBeInTheDocument();
  });

  test("All grants everything; None clears the grant", async () => {
    render(<Harness />);
    await expandServer();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(screen.getByText("All tools")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "None" }));
    await waitFor(() => expect(screen.getByText("No tools")).toBeInTheDocument());
  });
});

describe("AccessSection — unscanned servers + built-ins", () => {
  test("a granted server with no scan is flagged as not counted in the footprint", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ id: "srv-2", name: "Unscanned" })]);
    vi.mocked(api.apiGet).mockRejectedValue(new api.ApiError(404, "not found"));

    render(<Harness initial={{ servers: { "srv-2": "all" }, builtins: [] }} />);
    // "their token cost" is unique to the footprint note (the accordion's own "No scan yet" copy
    // reads "run a scan from the Servers view"), so this can't collide with it.
    await waitFor(() => expect(screen.getByText(/their token cost/i)).toBeInTheDocument());
  });

  test("built-in tools toggle independently and carry no scan cost", async () => {
    render(<Harness />);
    const builtins = await screen.findByText("Built-in tools");
    expect(within(builtins.parentElement as HTMLElement).getByText(/no scan-measured token cost/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /Read a workspace file/ }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /Read a workspace file/ })).toBeChecked(),
    );
  });
});
