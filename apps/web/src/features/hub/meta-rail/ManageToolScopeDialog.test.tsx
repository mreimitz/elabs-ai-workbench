import type { HubSession, HubToolGrants } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listServers: vi.fn(),
    apiGet: vi.fn(),
    updateHubSession: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { ManageToolScopeDialog } from "./ManageToolScopeDialog";

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "running",
    seen: false,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listServers).mockResolvedValue([]);
});

describe("ManageToolScopeDialog (hub-fixes WP1.2, RC3 — the write-once-trap fix)", () => {
  test("defaults to Auto for a session with no toolScope; Save PATCHes toolScope: null", async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    vi.mocked(api.updateHubSession).mockResolvedValue(session());
    render(
      <ManageToolScopeDialog
        open
        onOpenChange={onOpenChange}
        sessionId="s1"
        initialScope={null}
        onSaved={onSaved}
      />,
    );

    expect(screen.getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateHubSession).toHaveBeenCalledWith("s1", { toolScope: null }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  test("defaults to Scoped and pre-populates the picker for a session with an existing toolScope", async () => {
    const existingScope: HubToolGrants = {
      servers: { "srv-a": "all" },
      builtins: ["tasks.list"],
    };
    render(
      <ManageToolScopeDialog
        open
        onOpenChange={vi.fn()}
        sessionId="s1"
        initialScope={existingScope}
      />,
    );
    expect(screen.getByRole("radio", { name: "Scoped" })).toHaveAttribute("aria-checked", "true");
    // The ToolGrantPicker is rendered (its "MCP servers" heading only shows in Scoped mode).
    expect(screen.getByText("MCP servers")).toBeInTheDocument();
  });

  test("switching to Scoped and saving PATCHes the picked toolScope object", async () => {
    vi.mocked(api.listServers).mockResolvedValue([
      {
        id: "srv-a",
        name: "Server A",
        transport: "stdio",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        hasEnvSecrets: false,
        hasHeaderSecrets: false,
        authType: "none",
      },
    ]);
    vi.mocked(api.apiGet).mockRejectedValue(new Error("no scan"));
    vi.mocked(api.updateHubSession).mockResolvedValue(session());
    const onSaved = vi.fn();
    render(
      <ManageToolScopeDialog
        open
        onOpenChange={vi.fn()}
        sessionId="s1"
        initialScope={null}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Scoped" }));
    await waitFor(() => expect(screen.getByText("Server A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Server A")); // expand the accordion item
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "All tools" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "All tools" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.updateHubSession).toHaveBeenCalledWith("s1", {
        toolScope: { servers: { "srv-a": "all" }, builtins: [] },
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  test("a failed PATCH shows an inline error and keeps the dialog open", async () => {
    const onOpenChange = vi.fn();
    vi.mocked(api.updateHubSession).mockRejectedValue(new Error("network down"));
    render(
      <ManageToolScopeDialog open onOpenChange={onOpenChange} sessionId="s1" initialScope={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("network down"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  test("Cancel closes without writing", () => {
    const onOpenChange = vi.fn();
    render(
      <ManageToolScopeDialog open onOpenChange={onOpenChange} sessionId="s1" initialScope={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.updateHubSession).not.toHaveBeenCalled();
  });

  test("re-opening resets the form to the (possibly new) initialScope, not the previous session's edits", async () => {
    const { rerender } = render(
      <ManageToolScopeDialog open={false} onOpenChange={vi.fn()} sessionId="s1" initialScope={null} />,
    );
    rerender(
      <ManageToolScopeDialog
        open
        onOpenChange={vi.fn()}
        sessionId="s1"
        initialScope={{ servers: {}, builtins: [] }}
      />,
    );
    expect(screen.getByRole("radio", { name: "Scoped" })).toHaveAttribute("aria-checked", "true");
  });
});
