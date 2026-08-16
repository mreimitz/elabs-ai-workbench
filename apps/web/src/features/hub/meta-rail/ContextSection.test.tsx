import type {
  HubContextInspector,
  HubFile,
  HubMcpServerStatusEntry,
  HubProject,
  HubSession,
} from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@brand/ui";
import { beforeEach, describe, expect, test, vi } from "vitest";

// hub-fixes WP1.2 (RC3) — the Tools header's "Manage tool scope" action renders the REAL
// `ManageToolScopeDialog` (which reuses the real `ToolGrantPicker`), so its `listServers()` fetch
// needs a mock the same way `ToolGrantPicker.test.tsx`/`NewSessionDialog.test.tsx` already do for
// that component. hub-fixes WP1.3 (RC3.4) additionally mocks `reconnectHubMcpServer` for the error
// chip's Retry action. Every other export stays real (`...actual`).
vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return {
    ...actual,
    listServers: vi.fn(),
    apiGet: vi.fn(),
    updateHubSession: vi.fn(),
    getHubSessionContext: vi.fn(),
    reconnectHubMcpServer: vi.fn(),
  };
});

import * as api from "../../../lib/api";
import { ContextSection } from "./ContextSection";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listServers).mockResolvedValue([]);
});

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

function project(overrides: Partial<HubProject> = {}): HubProject {
  return {
    id: "p1",
    name: "barc-benchmark",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function file(overrides: Partial<HubFile> & { id: string }): HubFile {
  return { sha256: "abc", mime: "text/plain", bytes: 512, createdAt: "2026-07-01T00:00:00Z", ...overrides };
}

function inspector(overrides: Partial<HubContextInspector> = {}): HubContextInspector {
  return {
    sessionId: "s1",
    model: "claude-sonnet-5",
    contextWindow: 200_000,
    promptSections: [
      { id: "identity", title: "Identity", tokens: 80, budgetTokens: 120, withinBudget: true },
    ],
    promptTotalTokens: 80,
    tools: {
      mode: "eager",
      totalTokens: 500,
      residentTokens: 500,
      savingsPercent: 0,
      resident: [],
      deferred: [],
      builtins: [],
    },
    skills: { usage: [], totalTokens: 0 },
    memory: { tokens: 0, itemCount: 0 },
    project: null,
    history: { tokens: 0, messageCount: 0 },
    estimatedTotalTokens: 580,
    ...overrides,
  };
}

describe("ContextSection (WP1.2, D-HUX3/D-HUX11 — project + servers/skills/memory + effective-memory slot)", () => {
  test("renders an EmptyState when no session is open", () => {
    render(<ContextSection session={null} project={null} inspector={null} />);
    expect(screen.getByText("No session open")).toBeInTheDocument();
  });

  test("renders a no-project EmptyState for a session with no projectId", () => {
    render(<ContextSection session={session()} project={null} inspector={inspector()} />);
    expect(screen.getByText("No project")).toBeInTheDocument();
  });

  test("renders the project block, pinned files, and delegates open via onOpenPinnedFile", () => {
    const onOpenPinnedFile = vi.fn();
    const pinnedFile = file({ id: "f1", filename: "style-guide.md" });
    render(
      <ContextSection
        session={session({ projectId: "p1" })}
        project={project()}
        pinnedFiles={[pinnedFile]}
        onOpenPinnedFile={onOpenPinnedFile}
        inspector={inspector()}
      />,
    );
    expect(screen.getByText("barc-benchmark")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /style-guide\.md/i }));
    expect(onOpenPinnedFile).toHaveBeenCalledWith(pinnedFile);
  });

  test("drops the token-heavy context-window and prompt-sections blocks entirely", () => {
    render(<ContextSection session={session()} project={null} inspector={inspector()} />);
    expect(screen.queryByText("Context window (est.)")).not.toBeInTheDocument();
    expect(screen.queryByText("Prompt sections")).not.toBeInTheDocument();
    expect(screen.queryByText("580 tok")).not.toBeInTheDocument();
  });

  test("Tools block lists the ACTIVE MCP SERVERS, grouping resident + deferred tools by server, name-sorted with singular/plural counts", () => {
    const insp = inspector({
      tools: {
        mode: "deferred",
        totalTokens: 0,
        residentTokens: 0,
        savingsPercent: 0,
        resident: [
          { serverId: "gh", serverName: "GitHub", name: "create_issue", tokens: 120 },
          { serverId: "gh", serverName: "GitHub", name: "list_issues", tokens: 90 },
        ],
        deferred: [
          { serverId: "gh", serverName: "GitHub", name: "close_issue", tokens: 80 },
          { serverId: "fs", serverName: "Filesystem", name: "read_file", tokens: 50 },
        ],
        builtins: [],
      },
    });
    render(<ContextSection session={session()} project={null} inspector={insp} />);

    expect(screen.queryByText("No MCP servers")).not.toBeInTheDocument();
    // GitHub = 2 resident + 1 deferred = 3 tools; Filesystem = 1 tool.
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("3 tools")).toBeInTheDocument();
    expect(screen.getByText("Filesystem")).toBeInTheDocument();
    expect(screen.getByText("1 tool")).toBeInTheDocument();
    // No token internals leak into this list.
    expect(screen.queryByText(/resident/i)).not.toBeInTheDocument();

    // Name-sorted: Filesystem before GitHub.
    const filesystem = screen.getByText("Filesystem");
    const github = screen.getByText("GitHub");
    expect(filesystem.compareDocumentPosition(github) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("Tools block shows its own empty state when no MCP servers are connected", () => {
    render(<ContextSection session={session()} project={null} inspector={inspector()} />);
    expect(screen.getByText("No MCP servers")).toBeInTheDocument();
    expect(screen.getByText("No MCP servers are connected to this session.")).toBeInTheDocument();
  });

  test("Skills block lists available skills like tools (name + a muted 'not yet invoked'), without the L1/L2/L3 breakdown", () => {
    const insp = inspector({
      skills: {
        totalTokens: 65,
        usage: [
          {
            skillId: "sk1",
            name: "pdf-fill",
            l1Tokens: 10,
            l2Tokens: 20,
            l3Tokens: 30,
            totalTokens: 60,
            invoked: true,
            loadedPaths: [],
          },
          {
            skillId: "sk2",
            name: "graphify",
            l1Tokens: 5,
            l2Tokens: 0,
            l3Tokens: 0,
            totalTokens: 5,
            invoked: false,
            loadedPaths: [],
          },
        ],
      },
    });
    render(<ContextSection session={session()} project={null} inspector={insp} />);

    expect(screen.getByText("pdf-fill")).toBeInTheDocument();
    expect(screen.getByText("graphify")).toBeInTheDocument();
    // Only the un-invoked skill carries the muted meta.
    expect(screen.getByText("not yet invoked")).toBeInTheDocument();
    // The L1/L2/L3 token breakdown is gone.
    expect(screen.queryByText(/^L1 /)).not.toBeInTheDocument();
    expect(screen.queryByText("No skills")).not.toBeInTheDocument();
  });

  test("Skills section is ALWAYS shown, with its own empty state when no skills are available", () => {
    render(<ContextSection session={session()} project={null} inspector={inspector()} />);
    expect(screen.getByText("Skills")).toBeInTheDocument();
    expect(screen.getByText("No skills")).toBeInTheDocument();
    expect(screen.getByText("No skills are available in this session.")).toBeInTheDocument();
  });

  test("renders a ghost Manage action in the Skills header when onManageSkills is supplied, and calls it on click", () => {
    const onManageSkills = vi.fn();
    render(
      <ContextSection
        session={session()}
        project={null}
        inspector={inspector()}
        onManageSkills={onManageSkills}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage skills" }));
    expect(onManageSkills).toHaveBeenCalledTimes(1);
  });

  test("omits the Skills Manage action when onManageSkills is absent", () => {
    render(<ContextSection session={session()} project={null} inspector={inspector()} />);
    expect(screen.queryByRole("button", { name: "Manage skills" })).not.toBeInTheDocument();
  });

  test("keeps the Memory & history block (Memory tok/items + History tok/messages) when the inspector is present", () => {
    const insp = inspector({
      memory: { tokens: 1234, itemCount: 3 },
      history: { tokens: 5678, messageCount: 1 },
    });
    render(<ContextSection session={session()} project={null} inspector={insp} />);
    expect(screen.getByText("Memory & history")).toBeInTheDocument();
    expect(screen.getByText(/1,234 tok · 3 items/)).toBeInTheDocument();
    expect(screen.getByText(/5,678 tok · 1 message/)).toBeInTheDocument();
  });

  test("with a null inspector: degrades to the servers & skills empty states and omits Memory & history", () => {
    render(<ContextSection session={session()} project={null} inspector={null} />);
    expect(screen.getByText("No MCP servers")).toBeInTheDocument();
    expect(screen.getByText("No skills")).toBeInTheDocument();
    expect(screen.queryByText("Memory & history")).not.toBeInTheDocument();
  });

  test("renders the effectiveMemory slot when supplied (D-HUX11, filled by WP2.7's EffectiveMemoryStack)", () => {
    render(
      <ContextSection
        session={session()}
        project={null}
        inspector={inspector()}
        effectiveMemory={<div>profile · project · crew · agent stack</div>}
      />,
    );
    expect(screen.getByText("Effective memory")).toBeInTheDocument();
    expect(screen.getByText("profile · project · crew · agent stack")).toBeInTheDocument();
  });

  test("omits the effectiveMemory heading entirely when the slot is absent", () => {
    render(<ContextSection session={session()} project={null} inspector={inspector()} />);
    expect(screen.queryByText("Effective memory")).not.toBeInTheDocument();
  });

  test("WP2.7 — renders a Manage action next to the Effective memory label when onManageMemory is supplied, and calls it on click", () => {
    const onManageMemory = vi.fn();
    render(
      <ContextSection
        session={session()}
        project={null}
        inspector={inspector()}
        effectiveMemory={<div>stack</div>}
        onManageMemory={onManageMemory}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(onManageMemory).toHaveBeenCalledTimes(1);
  });

  test("WP2.7 — omits the Manage action when onManageMemory is absent (even with effectiveMemory present)", () => {
    render(
      <ContextSection
        session={session()}
        project={null}
        inspector={inspector()}
        effectiveMemory={<div>stack</div>}
      />,
    );
    expect(screen.queryByRole("button", { name: "Manage" })).not.toBeInTheDocument();
  });

  test("no mid-word clipping contract: a long project name truncates inside a min-w-0 container", () => {
    render(
      <ContextSection
        session={session({ projectId: "p1" })}
        project={project({ name: "A very long project name that must not clip mid-word in the rail" })}
        inspector={inspector()}
      />,
    );
    const name = screen.getByText(/A very long project name/);
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("min-w-0");
  });

  // ── hub-fixes WP1.2 (RC3 — the display half + the write-once trap) ───────────────────────────────

  test("Tools header shows an 'Auto (all reachable)' badge when the inspector reports scopeMode: auto", () => {
    const insp = inspector({ tools: { ...inspector().tools, scopeMode: "auto" } });
    render(<ContextSection session={session()} project={null} inspector={insp} />);
    expect(screen.getByText("Auto (all reachable)")).toBeInTheDocument();
    expect(screen.queryByText("Scoped")).not.toBeInTheDocument();
  });

  test("Tools header shows a 'Scoped' badge when the inspector reports scopeMode: scoped", () => {
    const insp = inspector({ tools: { ...inspector().tools, scopeMode: "scoped" } });
    render(
      <ContextSection
        session={session({ toolScope: { servers: { "srv-a": "all" }, builtins: [] } })}
        project={null}
        inspector={insp}
      />,
    );
    expect(screen.getByText("Scoped")).toBeInTheDocument();
    expect(screen.queryByText("Auto (all reachable)")).not.toBeInTheDocument();
  });

  test("falls back to deriving the badge from session.toolScope when the inspector omits scopeMode (older/cached payload)", () => {
    render(
      <ContextSection
        session={session({ toolScope: { servers: { "srv-a": "all" }, builtins: [] } })}
        project={null}
        inspector={inspector()} // no scopeMode set
      />,
    );
    expect(screen.getByText("Scoped")).toBeInTheDocument();
  });

  test("Tools header shows the Auto badge with a null inspector, deriving from a null session.toolScope", () => {
    render(<ContextSection session={session()} project={null} inspector={null} />);
    expect(screen.getByText("Auto (all reachable)")).toBeInTheDocument();
  });

  test("clicking 'Manage tool scope' opens the ManageToolScopeDialog", async () => {
    render(<ContextSection session={session()} project={null} inspector={inspector()} />);
    expect(screen.queryByText("Manage tool scope")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manage tool scope" }));
    expect(await screen.findByRole("heading", { name: "Manage tool scope" })).toBeInTheDocument();
  });

  test("a successful scope save re-fetches the context inspector and reflects the fresh scopeMode without waiting for the caller", async () => {
    const scopedSession = session({ toolScope: { servers: {}, builtins: [] } });
    vi.mocked(api.updateHubSession).mockResolvedValue(scopedSession);
    vi.mocked(api.getHubSessionContext).mockResolvedValue(
      inspector({ tools: { ...inspector().tools, scopeMode: "scoped" } }),
    );
    render(<ContextSection session={session()} project={null} inspector={inspector()} />);
    expect(screen.getByText("Auto (all reachable)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manage tool scope" }));
    await screen.findByRole("heading", { name: "Manage tool scope" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.getHubSessionContext).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.getByText("Scoped")).toBeInTheDocument());
  });

  // ── hub-fixes WP1.3 (RC3.4) — per-server connection status chips + Retry ──────────────────────────

  function serverStatus(overrides: Partial<HubMcpServerStatusEntry> = {}): HubMcpServerStatusEntry {
    return { serverId: "gh", serverName: "GitHub", status: "connected", ...overrides };
  }

  test("a connected server gets a Connected chip alongside its tool count", () => {
    const insp = inspector({
      tools: {
        ...inspector().tools,
        resident: [{ serverId: "gh", serverName: "GitHub", name: "create_issue", tokens: 120 }],
        serverStatuses: [serverStatus({ status: "connected" })],
      },
    });
    render(
      <TooltipProvider>
        <ContextSection session={session()} project={null} inspector={insp} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("1 tool")).toBeInTheDocument();
  });

  test("a DROPPED server (zero resident/deferred tools) still shows a row with an Unreachable chip — the vanishing-server bug this WP fixes", () => {
    const insp = inspector({
      tools: {
        ...inspector().tools,
        resident: [],
        deferred: [],
        serverStatuses: [
          serverStatus({
            serverId: "qlik",
            serverName: "qlik-mreimitz",
            status: "error",
            message: "connection refused",
          }),
        ],
      },
    });
    render(
      <TooltipProvider>
        <ContextSection session={session()} project={null} inspector={insp} />
      </TooltipProvider>,
    );
    // The old bug: a dropped server had zero tools, so the whole rail showed "No MCP servers" — the
    // server had silently vanished. It must be visible now, with its name and an error chip.
    expect(screen.queryByText("No MCP servers")).not.toBeInTheDocument();
    expect(screen.getByText("qlik-mreimitz")).toBeInTheDocument();
    expect(screen.getByText("Unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry connecting to qlik-mreimitz" })).toBeInTheDocument();
  });

  test("clicking Retry reconnects the server, toasts, and re-fetches the inspector", async () => {
    vi.mocked(api.reconnectHubMcpServer).mockResolvedValue({ ok: true });
    const refreshed = inspector({
      tools: { ...inspector().tools, serverStatuses: [serverStatus({ serverId: "qlik", status: "connected" })] },
    });
    vi.mocked(api.getHubSessionContext).mockResolvedValue(refreshed);

    const insp = inspector({
      tools: {
        ...inspector().tools,
        serverStatuses: [
          serverStatus({ serverId: "qlik", serverName: "qlik-mreimitz", status: "error", message: "down" }),
        ],
      },
    });
    render(
      <TooltipProvider>
        <ContextSection session={session()} project={null} inspector={insp} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry connecting to qlik-mreimitz" }));

    await waitFor(() => expect(api.reconnectHubMcpServer).toHaveBeenCalledWith("qlik"));
    await waitFor(() => expect(api.getHubSessionContext).toHaveBeenCalledWith("s1"));
  });

  test("a failed Retry surfaces the error but does not crash the rail", async () => {
    vi.mocked(api.reconnectHubMcpServer).mockRejectedValue(new Error("network down"));
    const insp = inspector({
      tools: {
        ...inspector().tools,
        serverStatuses: [
          serverStatus({ serverId: "qlik", serverName: "qlik-mreimitz", status: "error", message: "down" }),
        ],
      },
    });
    render(
      <TooltipProvider>
        <ContextSection session={session()} project={null} inspector={insp} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry connecting to qlik-mreimitz" }));

    await waitFor(() => expect(api.reconnectHubMcpServer).toHaveBeenCalledWith("qlik"));
    // The rail stays intact — the chip and Retry button are still there for another attempt.
    expect(await screen.findByText("Unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry connecting to qlik-mreimitz" })).toBeInTheDocument();
  });

  test("a server with no known status (pre-WP1.3 session / never attempted) renders exactly like before — no chip", () => {
    const insp = inspector({
      tools: {
        ...inspector().tools,
        resident: [{ serverId: "gh", serverName: "GitHub", name: "create_issue", tokens: 120 }],
        // serverStatuses omitted entirely — an older/cached payload.
      },
    });
    render(
      <TooltipProvider>
        <ContextSection session={session()} project={null} inspector={insp} />
      </TooltipProvider>,
    );
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Unreachable")).not.toBeInTheDocument();
  });
});
