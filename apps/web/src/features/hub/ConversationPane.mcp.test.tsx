// Assistant Hub (WP1.4) — the MCP-interaction depth rendered in the transcript: annotation-informed
// approvals (R-MCP3), elicitation form + URL modes (R-MCP4), progress + cancel (R-MCP5), typed
// structured output (R-MCP6), the output-cap spill card (R-MCP7), and per-server chips (R-MCP11). The
// `@brand/ai` surface is stubbed (the shared hub mock) so jsdom never loads streamdown/shiki; the
// depth widgets themselves are `@brand/ui` (Alert/Progress/Descriptions/Badge) and render for real.

import type { HubSession, HubToolPart, HubToolPartState } from "@mcp-token-footprint/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

// WP3.4 — the produced-assets panel's promote action calls this; every test that never clicks an
// item never triggers it.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, promoteHubWorkspaceFile: vi.fn() };
});

import * as api from "../../lib/api";
import {
  AnnotationBadges,
  ConversationPane,
  deriveProducedAssets,
  ElicitationPanel,
  type ConversationHandlers,
  type ConversationStream,
  type HubElicitationRequest,
} from "./ConversationPane";
import type { HubTimelineAssistantTurn, HubTimelineItem } from "./use-hub-stream";

const EMPTY_STREAM: ConversationStream = {
  events: [],
  deltaText: {},
  deltaReasoning: {},
  liveMessageId: null,
  turnRunning: false,
  phase: null,
  queuePosition: null,
  phaseDeadlineAt: null,
  waitingReason: null,
  error: null,
  authRequired: false,
  pendingElicitation: null,
  openQuestions: [],
  timeline: [],
  tasks: [],
  pendingQueued: [],
};

function toolPart(state: HubToolPartState, over: Partial<HubToolPart> = {}): HubToolPart {
  return {
    type: "tool_call",
    toolCallId: "c1",
    toolName: "mcp__srv__search",
    source: "mcp",
    state,
    ...over,
  };
}
function turnWith(part: HubToolPart): HubTimelineAssistantTurn {
  return {
    kind: "assistant_turn",
    id: "turn-1",
    parts: [part],
    toolCalls: [{ id: part.toolCallId, part }],
    citations: [],
    streaming: false,
  };
}
function streamWith(part: HubToolPart): ConversationStream {
  return { ...EMPTY_STREAM, timeline: [turnWith(part)] };
}

function renderPane(stream: ConversationStream, handlers: ConversationHandlers = {}) {
  render(<ConversationPane stream={stream} onStarterSelect={vi.fn()} handlers={handlers} />);
}

// ── R-MCP3 — annotation-informed approvals ──────────────────────────────────────────────────────────

describe("AnnotationBadges (R-MCP3)", () => {
  test("renders every declared behavior hint", () => {
    render(
      <AnnotationBadges
        annotations={{
          readOnlyHint: true,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        }}
      />,
    );
    for (const label of ["read-only", "destructive", "idempotent", "open-world"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test("renders nothing when no annotations are declared", () => {
    const { container } = render(<AnnotationBadges />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("approval card (R-MCP3 / R-UX1)", () => {
  test("shows the annotations and the destructive warning; Approve/Deny fire the decision handler", () => {
    const onToolDecision = vi.fn();
    renderPane(
      streamWith(
        toolPart("approval-requested", {
          approval: { options: ["allow-once", "always"] },
          annotations: { destructiveHint: true, openWorldHint: true },
        }),
      ),
      { onToolDecision },
    );
    // The approval card names the destructive risk (annotation-informed copy).
    expect(screen.getByText(/hard to undo/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onToolDecision).toHaveBeenCalledWith("c1", "allow-once");
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    expect(onToolDecision).toHaveBeenCalledWith("c1", "deny");
  });

  test("Approve/Deny are disabled (honest, no dead click) when no handler is wired", () => {
    renderPane(
      streamWith(toolPart("approval-requested", { approval: { options: ["allow-once"] } })),
    );
    expect(screen.getByRole("button", { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /deny/i })).toBeDisabled();
  });
});

// ── R-MCP11 — per-server chip ─────────────────────────────────────────────────────────────────────

test("a per-server chip (R-MCP11) names the origin server on an mcp tool row", () => {
  renderPane(
    streamWith(toolPart("output-available", { serverId: "research-server", modelContent: {} })),
  );
  expect(screen.getByText("research-server")).toBeInTheDocument();
});

// ── R-MCP5 — progress + cancel ────────────────────────────────────────────────────────────────────

describe("tool progress + cancel (R-MCP5)", () => {
  test("renders a progress bar and a working cancel button on a running tool", () => {
    const onCancelTool = vi.fn();
    renderPane(
      streamWith(
        toolPart("input-available", {
          progress: {
            progressToken: "p1",
            progress: 2,
            total: 4,
            message: "halfway",
            cancellable: true,
          },
        }),
      ),
      { onCancelTool },
    );
    expect(screen.getByTestId("tool-progress")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancelTool).toHaveBeenCalledWith("c1");
  });
});

// ── R-MCP6 — typed structured output; isError → failed step ──────────────────────────────────────────

describe("structured output (R-MCP6)", () => {
  test("renders structuredContent as typed label↔value rows", () => {
    renderPane(
      streamWith(
        toolPart("output-available", {
          modelContent: { structuredContent: { city: "Paris", population: 2140526 } },
        }),
      ),
    );
    const block = screen.getByTestId("structured-output");
    expect(block).toHaveTextContent("city");
    expect(block).toHaveTextContent("Paris");
    expect(block).toHaveTextContent("population");
  });

  test("an isError result renders as a failed step, not a session error", () => {
    renderPane(
      streamWith(
        toolPart("output-error", { isError: true, errorText: "rate limited by upstream" }),
      ),
    );
    expect(screen.getByTestId("tool-error")).toHaveTextContent("rate limited by upstream");
  });
});

// ── R-MCP7 — output-cap spill card ────────────────────────────────────────────────────────────────

test("an oversized result renders the spill reference card (R-MCP7)", () => {
  renderPane(
    streamWith(
      toolPart("output-available", {
        artifact: { kind: "spill", spillPath: "_tool-output-spills/c1.json", text: '{"rows":9999' },
      }),
    ),
  );
  const card = screen.getByTestId("spill-card");
  expect(card).toHaveTextContent("_tool-output-spills/c1.json");
  expect(card).toHaveTextContent(/files\.read/);
});

// ── WP3.4 — produced-assets panel (D-AH12) ──────────────────────────────────────────────────────────

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "sess-1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "chat",
    model: "claude-sonnet-5",
    status: "completed",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-17T12:00:00.000Z",
    updatedAt: "2026-07-17T12:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

describe("deriveProducedAssets (WP3.4)", () => {
  test("collects workspace_file and spill artifacts, deduped by path (last write wins)", () => {
    const timeline: HubTimelineItem[] = [
      turnWith(
        toolPart("output-available", {
          toolCallId: "c1",
          toolName: "files.write",
          source: "builtin",
          artifact: { kind: "workspace_file", spillPath: "out/notes.md", mimeType: "text/plain" },
        }),
      ),
      turnWith(
        toolPart("output-available", {
          toolCallId: "c2",
          toolName: "mcp__srv__dump",
          artifact: { kind: "spill", spillPath: "_tool-output-spills/c2.json" },
        }),
      ),
      turnWith(
        toolPart("output-available", {
          toolCallId: "c3",
          toolName: "files.edit",
          source: "builtin",
          artifact: { kind: "workspace_file", spillPath: "out/notes.md" }, // same path — re-edited
        }),
      ),
    ];
    const assets = deriveProducedAssets(timeline);
    const paths = assets.map((a) => a.path);
    expect(paths).toContain("out/notes.md");
    expect(paths).toContain("_tool-output-spills/c2.json");
    expect(paths.filter((p) => p === "out/notes.md")).toHaveLength(1);
    const notes = assets.find((a) => a.path === "out/notes.md");
    expect(notes?.type).toBe("markdown");
    expect(notes?.id).toBe("c3"); // the LATEST write's toolCallId
  });

  test("ignores tool calls with no artifact", () => {
    expect(deriveProducedAssets([turnWith(toolPart("output-available"))])).toEqual([]);
  });
});

describe("ProducedAssetsPanel (WP3.4)", () => {
  test("renders nothing when the session has produced no files", () => {
    render(
      <ConversationPane stream={EMPTY_STREAM} session={session()} onStarterSelect={vi.fn()} />,
    );
    expect(screen.queryByTestId("produced-assets-panel")).not.toBeInTheDocument();
  });

  test("lists a produced file and promotes it to an artifact on select", async () => {
    vi.mocked(api.promoteHubWorkspaceFile).mockResolvedValue({
      id: "art-1",
      kind: "markdown",
      title: "notes.md",
      latestVersion: 1,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    render(
      <ConversationPane
        stream={streamWith(
          toolPart("output-available", {
            toolCallId: "c1",
            toolName: "files.write",
            source: "builtin",
            artifact: { kind: "workspace_file", spillPath: "out/notes.md" },
          }),
        )}
        session={session({ id: "sess-42" })}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("produced-assets-panel")).toHaveTextContent("notes.md");

    fireEvent.click(screen.getByTestId("produced-asset-item"));
    await waitFor(() =>
      expect(api.promoteHubWorkspaceFile).toHaveBeenCalledWith("sess-42", "out/notes.md"),
    );
  });
});

// ── WP1.3 follow-up (RC3.4, folded into WP6.1) — the inline "unreachable server" transcript notice ────

describe("inline unreachable-server notice (WP1.3 data → WP6.1 render)", () => {
  const issue = { serverId: "srv-1", serverName: "qlik-mreimitz", message: "OAuth expired" };
  function turnWithIssues(
    streaming: boolean,
    mcpServerIssues: { serverId: string; serverName: string; message?: string }[],
  ): HubTimelineAssistantTurn {
    return {
      kind: "assistant_turn",
      id: "turn-1",
      parts: [],
      toolCalls: [],
      citations: [],
      streaming,
      mcpServerIssues,
    };
  }

  test("a SETTLED turn renders the notice from turn.mcpServerIssues (server name + reason)", () => {
    renderPane({ ...EMPTY_STREAM, timeline: [turnWithIssues(false, [issue])] });
    expect(screen.getByText(/an mcp server was unreachable this turn/i)).toBeInTheDocument();
    expect(screen.getByText("qlik-mreimitz")).toBeInTheDocument();
    expect(screen.getByText(/OAuth expired/)).toBeInTheDocument();
  });

  test("a STREAMING (not-yet-settled) turn does NOT render the notice (terminal-only, loading-states.md)", () => {
    renderPane({ ...EMPTY_STREAM, timeline: [turnWithIssues(true, [issue])] });
    expect(screen.queryByText("qlik-mreimitz")).not.toBeInTheDocument();
    expect(screen.queryByText(/unreachable this turn/i)).not.toBeInTheDocument();
  });

  test("multiple unreachable servers get a pluralized title and each is listed", () => {
    renderPane({
      ...EMPTY_STREAM,
      timeline: [turnWithIssues(false, [issue, { serverId: "srv-2", serverName: "postgres-prod" }])],
    });
    expect(screen.getByText(/2 mcp servers were unreachable this turn/i)).toBeInTheDocument();
    expect(screen.getByText("qlik-mreimitz")).toBeInTheDocument();
    expect(screen.getByText("postgres-prod")).toBeInTheDocument();
  });

  test("no notice when the settled turn had no unreachable servers", () => {
    renderPane({ ...EMPTY_STREAM, timeline: [turnWithIssues(false, [])] });
    expect(screen.queryByText(/unreachable this turn/i)).not.toBeInTheDocument();
  });
});

// ── R-MCP4 — elicitation (form + URL modes; credential refusal; decline first-class) ──────────────────

describe("elicitation (R-MCP4)", () => {
  const base: HubElicitationRequest = { message: "The tool needs details.", mode: "form" };

  test("form mode renders fields from the schema and submits collected values; decline is first-class", () => {
    const onRespond = vi.fn();
    const onDecline = vi.fn();
    render(
      <ElicitationPanel
        request={{
          ...base,
          schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        }}
        onRespond={onRespond}
        onDecline={onDecline}
      />,
    );
    expect(screen.getByTestId("elicitation-form")).toBeInTheDocument();
    // Required + empty → an inline error, no submit.
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByText(/this field is required/i)).toBeInTheDocument();
    // Fill + submit → the values flow back.
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: "Berlin" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));
    expect(onRespond).toHaveBeenCalledWith({ city: "Berlin" });
    fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(onDecline).toHaveBeenCalled();
  });

  test("a credential-shaped field is refused outright (never a form)", () => {
    render(
      <ElicitationPanel
        request={{
          ...base,
          schema: {
            type: "object",
            properties: { api_key: { type: "string" } },
            required: ["api_key"],
          },
        }}
      />,
    );
    expect(screen.getByTestId("elicitation-refused")).toBeInTheDocument();
    expect(screen.queryByTestId("elicitation-form")).not.toBeInTheDocument();
  });

  test("URL mode shows the full https URL + domain and never auto-opens it", () => {
    render(
      <ElicitationPanel
        request={{
          message: "Authorize here",
          mode: "url",
          url: "https://auth.example.com/grant?x=1",
        }}
      />,
    );
    const panel = screen.getByTestId("elicitation-url");
    expect(panel).toHaveTextContent("auth.example.com");
    expect(panel).toHaveTextContent("https://auth.example.com/grant?x=1");
    // The link is a plain anchor the operator must click — never auto-opened/prefetched.
    expect(screen.getByRole("link", { name: /open link/i })).toHaveAttribute(
      "href",
      "https://auth.example.com/grant?x=1",
    );
  });

  test("a non-https elicitation URL is not turned into a link", () => {
    render(
      <ElicitationPanel
        request={{ message: "x", mode: "url", url: "http://insecure.example.com" }}
      />,
    );
    expect(screen.queryByRole("link", { name: /open link/i })).not.toBeInTheDocument();
  });

  test("the session shows a waiting notice while blocked on a tool's question", () => {
    renderPane({ ...EMPTY_STREAM, phase: "waiting_input", waitingReason: "question" });
    expect(screen.getByTestId("elicitation-waiting")).toBeInTheDocument();
  });
});

// ── Interactive question card + Qlik-Answers disambiguation → clickable choices ─────────────────────

function assistantTextTurn(text: string): HubTimelineAssistantTurn {
  return {
    kind: "assistant_turn",
    id: "turn-txt",
    parts: [{ type: "text", text }],
    toolCalls: [],
    citations: [],
    streaming: false,
  };
}

const QLIK_DISAMBIGUATION = `Your question could be answered by more than one app or assistant. Reply with the number — or the name — to choose:

1. Sales Analytics (assistant) — HSBC: Indexed Qlik assistant.
2. MCP Sales (assistant) — MCP Demo: Indexed Qlik assistant.`;

describe("interactive ask_user question card", () => {
  test("renders the open question when askUser:true; hidden when askUser:false", () => {
    const stream: ConversationStream = {
      ...EMPTY_STREAM,
      openQuestions: [{ questionId: "q1", prompt: "Which environment?", options: [{ label: "prod" }] }],
    };
    const { rerender } = render(
      <ConversationPane
        stream={stream}
        session={session({ capabilities: { askUser: true } as HubSession["capabilities"] })}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Which environment?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "prod" })).toBeInTheDocument();

    rerender(
      <ConversationPane
        stream={stream}
        session={session({ capabilities: { askUser: false } as HubSession["capabilities"] })}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText("Which environment?")).not.toBeInTheDocument();
  });
});

describe("Qlik-Answers disambiguation → clickable choices", () => {
  test("renders choice buttons from the trailing assistant text; clicking submits the picked name", () => {
    const onStarterSelect = vi.fn();
    render(
      <ConversationPane
        stream={{ ...EMPTY_STREAM, timeline: [assistantTextTurn(QLIK_DISAMBIGUATION)] }}
        session={session()}
        onStarterSelect={onStarterSelect}
      />,
    );
    // The choice NAMES render as buttons (context shown separately as muted detail).
    const button = screen.getByRole("button", { name: /MCP Sales \(assistant\)/ });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onStarterSelect).toHaveBeenCalledWith("MCP Sales (assistant)");
  });

  test("does NOT render choices while the turn is still streaming", () => {
    render(
      <ConversationPane
        stream={{ ...EMPTY_STREAM, turnRunning: true, timeline: [assistantTextTurn(QLIK_DISAMBIGUATION)] }}
        session={session()}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText("Choose one to continue")).not.toBeInTheDocument();
  });
});

// ── MCP reachability: quiet auto mode + actionable "Authenticate" affordance ────────────────────────

function turnWithMcpIssues(
  issues: NonNullable<HubTimelineAssistantTurn["mcpServerIssues"]>,
): HubTimelineAssistantTurn {
  return {
    kind: "assistant_turn",
    id: "turn-mcp",
    parts: [{ type: "text", text: "reply" }],
    toolCalls: [],
    citations: [],
    streaming: false,
    mcpServerIssues: issues,
  };
}

describe("MCP reachability notices", () => {
  const transportIssue = { serverId: "s1", serverName: "srv-1", message: "fetch failed" };
  const authIssue = {
    serverId: "s2",
    serverName: "qlik-stage",
    message: "Unauthorized",
    authRequired: true,
  };

  test("auto mode: a transport failure is silently skipped (no unreachable warning)", () => {
    render(
      <ConversationPane
        stream={{ ...EMPTY_STREAM, timeline: [turnWithMcpIssues([transportIssue])] }}
        session={session()}
        onAuthenticateServer={vi.fn()}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText(/unreachable this turn/i)).not.toBeInTheDocument();
    expect(screen.queryByText("srv-1")).not.toBeInTheDocument();
  });

  test("scoped mode: a transport failure for a scoped-in server DOES warn", () => {
    render(
      <ConversationPane
        stream={{ ...EMPTY_STREAM, timeline: [turnWithMcpIssues([transportIssue])] }}
        session={session({ toolScope: { servers: { s1: "all" }, builtins: [] } })}
        onAuthenticateServer={vi.fn()}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/unreachable this turn/i)).toBeInTheDocument();
    expect(screen.getByText("srv-1")).toBeInTheDocument();
  });

  test("auth failure (auto mode): renders an Authenticate card; clicking fires onAuthenticateServer", () => {
    const onAuth = vi.fn();
    render(
      <ConversationPane
        stream={{ ...EMPTY_STREAM, timeline: [turnWithMcpIssues([authIssue])] }}
        session={session()}
        onAuthenticateServer={onAuth}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.getByText(/needs authentication/i)).toBeInTheDocument();
    // No plain "unreachable" warning for the auth failure — it's actionable instead.
    expect(screen.queryByText(/unreachable this turn/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Authenticate qlik-stage/i }));
    expect(onAuth).toHaveBeenCalledWith("s2", "qlik-stage");
  });

  test("mixed (auto): auth failure shows an Authenticate card; the transport failure stays silent", () => {
    render(
      <ConversationPane
        stream={{ ...EMPTY_STREAM, timeline: [turnWithMcpIssues([authIssue, transportIssue])] }}
        session={session()}
        onAuthenticateServer={vi.fn()}
        onStarterSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Authenticate qlik-stage/i })).toBeInTheDocument();
    expect(screen.queryByText("srv-1")).not.toBeInTheDocument();
  });
});
