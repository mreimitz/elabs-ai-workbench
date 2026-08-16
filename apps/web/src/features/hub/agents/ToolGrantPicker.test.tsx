import { useState } from "react";
import type { HubToolGrants, ScanDetail, ServerConfig } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listServers: vi.fn(),
    apiGet: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { ToolGrantPicker } from "./ToolGrantPicker";

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

function scanWithTools(toolNames: string[]): ScanDetail {
  return {
    id: "scan-1",
    serverId: "srv-1",
    status: "success",
    tokenProfile: "generic_o200k",
    countingVersion: 2,
    totalTools: toolNames.length,
    totalTokens: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    tools: toolNames.map((name, index) => ({
      id: `tool-${index}`,
      scanId: "scan-1",
      toolName: name,
      totalTokens: 0,
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
  return <ToolGrantPicker idPrefix="test" value={value} onChange={setValue} />;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ToolGrantPicker — no servers", () => {
  test("shows an empty-state message", async () => {
    vi.mocked(api.listServers).mockResolvedValue([]);
    render(<Harness />);
    await waitFor(() =>
      expect(
        screen.getByText("No MCP servers are registered yet. Add one from the Servers view to grant its tools here."),
      ).toBeInTheDocument(),
    );
  });
});

describe("ToolGrantPicker — a scanned server", () => {
  beforeEach(() => {
    vi.mocked(api.listServers).mockResolvedValue([server()]);
    vi.mocked(api.apiGet).mockImplementation(async (path: string) => {
      if (path === "/api/servers/srv-1/latest-scan") return scanWithTools(["search", "fetch"]);
      throw new Error(`unexpected apiGet(${path})`);
    });
  });

  test("expanding the server lists its scanned tools; toggling one grants only that tool", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("Search Server")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Search Server"));
    await waitFor(() => expect(screen.getByText("search")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "search" }));

    // The server badge reflects the grant summary once toggled.
    await waitFor(() => expect(screen.getByText("1 tool")).toBeInTheDocument());
  });

  test("checking 'All tools' grants everything and disables the per-tool checkboxes", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("Search Server")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Search Server"));
    await waitFor(() => expect(screen.getByText("search")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox", { name: "All tools" }));

    await waitFor(() => expect(screen.getAllByText("All tools").length).toBeGreaterThan(0));
    expect(screen.getByRole("checkbox", { name: "search" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "search" })).toBeChecked();
  });

  test("toggling a built-in tool grants it independently of server grants", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("Search Server")).toBeInTheDocument());

    // The checkbox's accessible name also carries the trailing raw tool-name span (`files.list`) —
    // matched with a regex rather than an exact string for that reason.
    fireEvent.click(screen.getByRole("checkbox", { name: /List workspace files/ }));

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /List workspace files/ })).toBeChecked(),
    );
  });
});

describe("ToolGrantPicker — a server with no scan yet", () => {
  test("still allows granting 'All tools' even though individual tools can't be listed", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ id: "srv-2", name: "Unscanned Server" })]);
    vi.mocked(api.apiGet).mockRejectedValue(new api.ApiError(404, "not found"));

    render(<Harness />);
    await waitFor(() => expect(screen.getByText("Unscanned Server")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Unscanned Server"));

    await waitFor(() =>
      expect(
        screen.getByText(
          "No scan yet — run a scan from the Servers view to grant individual tools. “All tools” still grants everything once one exists.",
        ),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "All tools" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "All tools" })).toBeChecked());
  });
});
