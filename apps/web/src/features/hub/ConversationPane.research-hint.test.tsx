// hub-fixes WP5.2 (RC5, D-HF2) — the research-mode "no research-capable server" hint (R-MCP13, now
// extended past the empty-transcript case) and the mission plan-card's web-capability notice
// (`MissionPlanCard.tsx`'s own render logic is unit-tested directly in `MissionPlanCard.test.tsx`;
// this file proves the ConversationPane-owned WIRING: the condition matrix that decides whether a
// hint/notice is even a candidate, the `listServers`/model-roster fetches that resolve it, and the
// deep link's destination). A separate file from the other `ConversationPane.*.test.tsx` suites
// (mirrors `ConversationPane.limit-error.test.tsx`'s own rationale) so this suite's
// `listServers`/`listProviders`/`listProviderModels` mocking doesn't leak into their module graphs.

import type { HubEvent, HubMissionPlan, HubPlannedAgent, HubSession, ProviderCredential, ServerConfig } from "@mcp-token-footprint/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@brand/ai", () => import("./test-support/brand-ai-mock"));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listServers: vi.fn(),
    listProviders: vi.fn(),
    listProviderModels: vi.fn(),
  };
});

import * as api from "../../lib/api";
import { ConversationPane, type ConversationStream } from "./ConversationPane";

function session(overrides: Partial<HubSession> = {}): HubSession {
  return {
    id: "s1",
    kind: "chat",
    title: "Untitled session",
    titleState: "pending",
    mode: "research",
    model: "claude-sonnet-5",
    status: "running",
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    createdAt: "2026-07-19T12:00:00.000Z",
    updatedAt: "2026-07-19T12:00:00.000Z",
    seen: true,
    ...overrides,
  };
}

function server(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: "srv-1",
    name: "Server",
    transport: "stdio",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    hasEnvSecrets: false,
    hasHeaderSecrets: false,
    authType: "none",
    ...overrides,
  };
}

function credential(overrides: Partial<ProviderCredential> = {}): ProviderCredential {
  return {
    id: "cred-1",
    kind: "anthropic",
    label: "Anthropic",
    hasKey: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

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

function nonEmptyStream(): ConversationStream {
  return {
    ...EMPTY_STREAM,
    timeline: [{ kind: "user", id: "u1", text: "What happened in the news today?" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no hub-eligible provider credential at all, so any model-roster-dependent resolution
  // settles to "unsupported" deterministically instead of hanging on `loading`.
  vi.mocked(api.listProviders).mockResolvedValue([]);
  vi.mocked(api.listProviderModels).mockResolvedValue({ source: "provider", models: [] });
});

function renderPane(stream: ConversationStream, sess?: HubSession) {
  return render(
    <MemoryRouter>
      <ConversationPane stream={stream} session={sess} onStarterSelect={vi.fn()} />
    </MemoryRouter>,
  );
}

// ── the empty-transcript hint (R-MCP13, pre-existing) ──────────────────────────────────────────────

describe("ConversationPane — research empty-state hint (R-MCP13)", () => {
  test("renders + deep-links to /servers when research mode has an empty transcript and no research-capable server", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    renderPane(EMPTY_STREAM, session());
    expect(await screen.findByText("No research-capable server yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add mcp server/i })).toHaveAttribute("href", "/servers");
  });

  test("does NOT render once a research-capable server IS registered", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Tavily Search" })]);
    renderPane(EMPTY_STREAM, session());
    await waitFor(() => expect(api.listServers).toHaveBeenCalled());
    expect(screen.queryByText("No research-capable server yet")).not.toBeInTheDocument();
    // Falls back to the ordinary empty state instead of a dead end.
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
  });

  test("never renders outside research mode (chat mode, same empty catalog)", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    renderPane(EMPTY_STREAM, session({ mode: "chat" }));
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
    expect(api.listServers).not.toHaveBeenCalled();
  });
});

// ── the NEW compact hint for a non-empty transcript ─────────────────────────────────────────────────

describe("ConversationPane — research compact hint on a non-empty transcript (WP5.2, RC5)", () => {
  test("renders (compact) once the research session already has a transcript — it used to just vanish", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    renderPane(nonEmptyStream(), session());
    const hint = await screen.findByTestId("research-compact-hint");
    expect(hint).toHaveTextContent("No research-capable server yet");
    expect(screen.getByRole("link", { name: /add mcp server/i })).toHaveAttribute("href", "/servers");
  });

  test("suppressed once a research-capable MCP server is registered", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Brave Search" })]);
    renderPane(nonEmptyStream(), session());
    await waitFor(() => expect(api.listServers).toHaveBeenCalled());
    expect(screen.queryByTestId("research-compact-hint")).not.toBeInTheDocument();
  });

  test("suppressed when the session already explicitly grants web.search (no MCP research server needed)", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    renderPane(
      nonEmptyStream(),
      session({ toolScope: { servers: {}, builtins: ["web.search"] } }),
    );
    await waitFor(() => expect(api.listServers).toHaveBeenCalled());
    expect(screen.queryByTestId("research-compact-hint")).not.toBeInTheDocument();
    // An explicit, non-empty builtins grant is decidable WITHOUT the model roster.
    expect(api.listProviders).not.toHaveBeenCalled();
  });

  test("suppressed when the session is default-scoped on a model whose provider backs web.search", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    vi.mocked(api.listProviders).mockResolvedValue([credential({ kind: "anthropic" })]);
    vi.mocked(api.listProviderModels).mockResolvedValue({
      source: "provider",
      models: [{ id: "claude-sonnet-5" }],
    });
    renderPane(nonEmptyStream(), session({ model: "claude-sonnet-5" }));
    await waitFor(() => expect(screen.queryByTestId("research-compact-hint")).not.toBeInTheDocument());
  });

  test("still renders on a default-scoped session whose model's provider does NOT back web.search", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    vi.mocked(api.listProviders).mockResolvedValue([credential({ kind: "ollama" })]);
    vi.mocked(api.listProviderModels).mockResolvedValue({
      source: "provider",
      models: [{ id: "llama3" }],
    });
    renderPane(nonEmptyStream(), session({ model: "llama3" }));
    expect(await screen.findByTestId("research-compact-hint")).toBeInTheDocument();
  });

  test("never fetches the model roster when there is nothing to suppress (no candidate hint)", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Tavily Search" })]);
    renderPane(nonEmptyStream(), session());
    await waitFor(() => expect(api.listServers).toHaveBeenCalled());
    expect(api.listProviders).not.toHaveBeenCalled();
  });
});

// ── the mission plan-card's web-capability notice, wired end-to-end from ConversationPane ──────────

function agent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.name ?? over.key,
    systemPrompt: "You are a specialist.",
    model: "gpt-4o",
    toolGrants: { servers: {}, builtins: [] },
    skillIds: [],
    brief: `Brief ${over.key}`,
    target: `Target ${over.key}`,
    expectedOutcome: "A report.",
    ...over,
  };
}

const WEB_WANTING_PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "always_ask",
  agents: [agent({ key: "a", name: "Researcher", brief: "Research competitor pricing on the web." })],
};

let seq = 0;
function ev<T extends HubEvent["type"]>(e: Extract<HubEvent, { type: T }>): HubEvent {
  return { ...e, seq: ++seq } as HubEvent;
}

function proposedMissionStream(plan: HubMissionPlan): ConversationStream {
  seq = 0;
  const events: HubEvent[] = [
    ev({ type: "user_message", messageId: "u1", text: "Research competitors" }),
    ev({ type: "plan_proposed", missionId: "mis-1", plan }),
    ev({ type: "turn_done" }),
  ];
  return { ...EMPTY_STREAM, events, timeline: [{ kind: "user", id: "u1", text: "Research competitors" }] };
}

describe("ConversationPane — mission plan-card web-capability notice (WP5.2, RC5)", () => {
  test("a proposed mission wanting the web, with no research-capable server in the catalog, shows the notice", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    renderPane(proposedMissionStream(WEB_WANTING_PLAN), session({ mode: "mission" }));
    expect(await screen.findByTestId("mission-web-capability-notice")).toBeInTheDocument();
  });

  test("the SAME proposed mission shows NO notice once a research-capable server is registered", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Exa Search" })]);
    renderPane(proposedMissionStream(WEB_WANTING_PLAN), session({ mode: "mission" }));
    await waitFor(() => expect(api.listServers).toHaveBeenCalled());
    expect(screen.queryByTestId("mission-web-capability-notice")).not.toBeInTheDocument();
  });
});

// ── WP6.1 follow-up B — ConversationPane threads parentScope=session.toolScope into MissionPlanCard ────
// (the per-agent effective-grant SUBTITLE logic itself is unit-tested in MissionPlanCard.test.tsx; this
//  proves the ConversationPane-owned WIRING — that the session's own scope reaches the card.)

const SCOPE_NARROWING_PLAN: HubMissionPlan = {
  topology: "parallel",
  autonomy: "always_ask",
  agents: [
    agent({
      key: "a",
      name: "Analyst",
      toolGrants: { servers: { acme: ["search", "list_apps", "delete_app"] }, builtins: [] },
    }),
  ],
};

describe("ConversationPane — WP6.1 follow-up B: MissionPlanCard parentScope threading", () => {
  test("a SCOPED session lights up the per-agent effective-grant subtitle (parentScope threaded from session.toolScope)", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    renderPane(
      proposedMissionStream(SCOPE_NARROWING_PLAN),
      session({ mode: "auto", toolScope: { servers: { acme: ["search", "list_apps"] }, builtins: [] } }),
    );
    expect(await screen.findByTestId("agent-effective-access-a")).toHaveTextContent(
      "2 of 3 tools after session scope",
    );
  });

  test("an UNSCOPED (auto) session threads parentScope=null ⇒ no subtitle (D-HF5 pass-through)", async () => {
    vi.mocked(api.listServers).mockResolvedValue([server({ name: "Postgres" })]);
    renderPane(proposedMissionStream(SCOPE_NARROWING_PLAN), session({ mode: "auto" }));
    expect(await screen.findByTestId("mission-plan-card")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-effective-access-a")).not.toBeInTheDocument();
  });
});
