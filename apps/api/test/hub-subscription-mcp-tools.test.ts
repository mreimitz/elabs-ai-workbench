// model-identity WP3.2 (locked decision **D-MI3**) — REAL MCP tools in the Hub subscription adapter.
//
// WP2.1 made the Hub model resolver honor an explicit `providerCredentialId`, which made the
// `claude_subscription` branch in `hub/session-service.ts` reachable for the first time — exposing that
// `hub/subscription-adapter.ts` wired ONLY the `ask_user` bridge and passed `tools: {}` to the prompt
// assembler while `hubCapabilitiesForKind` reports `toolCalls: true`. This file locks the fix.
//
// Everything runs through the SAME DI-seam discipline `hub-subscription-adapter.test.ts` uses: a
// SCRIPTED FAKE `AgentSessionDriver`, a stub auth resolver, a fake throwaway-workspace factory, and
// stub server/scan/OAuth reads. NO SDK is imported, NO child is spawned, NO MCP server is contacted,
// NO Anthropic endpoint is called, and the real filesystem is never touched.
//
// Locks (per the WP's Acceptance):
//   1. a subscription-routed session with granted MCP servers produces `mcpServers` entries AND the
//      matching `mcp__<serverKey>__<toolName>` allow patterns;
//   2. the REAL tool set reaches `assembleSessionPrompt` — the hardcoded `tools: {}` is gone (the
//      assembled system prompt names the granted tools and no longer claims "No MCP tools are granted");
//   3. the `ask_user` bridge still works and COEXISTS with real servers (neither displaces the other);
//   4. a session with NO granted servers still behaves — no crash, no bogus patterns, byte-identical
//      tool-less driver options;
//   5. SECRETS DO NOT LEAK: decrypted stdio `env` / http auth `headers` appear ONLY in the child config,
//      never in the prompt, a persisted event, a returned payload, or a log line.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubEvent, HubSession, HubToolPart } from "@mcp-token-footprint/shared";
import type {
  AgentSessionDriver,
  DriverEvent,
  DriverSession,
  DriverStartOptions,
  DriverUserMessage,
} from "../src/assistant/session-driver.js";
import type { AssistantAuthSource } from "../src/assistant/spawn-env.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import { createHubSubscriptionAdapter } from "../src/hub/subscription-adapter.js";
import {
  createHubSubscriptionMcpResolver,
  parseSubscriptionToolName,
  type HubSubscriptionMcpResolverDeps,
} from "../src/hub/subscription-tools.js";
import { HubSteeringQueue, type HubTurnSink } from "../src/hub/turn-engine.js";
import type { InternalServerConfig } from "../src/servers/repository.js";
import type { CreateThrowawayWorkspace } from "../src/testing/claude-subscription-executor.js";
import { AsyncSemaphore } from "../src/testing/subscription-concurrency.js";

// ── Secrets used ONLY to prove they never escape the child config ────────────────────────────────
const STDIO_ENV_SECRET = "stdio-env-secret-ZZZ-9911";
const HTTP_HEADER_SECRET = "http-header-secret-YYY-2277";
const OAUTH_TOKEN_SECRET = "oauth-access-token-XXX-4455";

const AUTH: AssistantAuthSource = { kind: "claude_oauth", token: "sk-ant-oat01-fake-1234" };
const MODEL = "claude-sonnet-4-5";
const USAGE: DriverEvent = {
  type: "turn_done",
  usage: {
    inputTokens: 100,
    outputTokens: 40,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  },
};

// ── Fake driver (SDK-free) ───────────────────────────────────────────────────────────────────────
class Pushable<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private ended = false;
  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.buffer.push(item);
  }
  end(): void {
    if (this.ended) return;
    this.ended = true;
    let w = this.waiters.shift();
    while (w) {
      w({ value: undefined as unknown as T, done: true });
      w = this.waiters.shift();
    }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const b = this.buffer.shift();
        if (b !== undefined) return Promise.resolve({ value: b, done: false });
        if (this.ended) return Promise.resolve({ value: undefined as unknown as T, done: true });
        return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class FakeSession implements DriverSession {
  readonly out = new Pushable<DriverEvent>();
  readonly sent: string[] = [];
  readonly options: DriverStartOptions;
  onSend?: (text: string, session: FakeSession) => void;
  constructor(options: DriverStartOptions) {
    this.options = options;
    this.out.push({ type: "session", sessionId: "sess-fake" });
    options.abortController.signal.addEventListener("abort", () => this.out.end(), { once: true });
  }
  get events(): AsyncIterable<DriverEvent> {
    return this.out;
  }
  send(message: DriverUserMessage): void {
    this.sent.push(message.text);
    this.onSend?.(message.text, this);
  }
  async interrupt(): Promise<void> {}
  sessionId(): string | undefined {
    return "sess-fake";
  }
  emit(event: DriverEvent): void {
    this.out.push(event);
  }
}

class FakeDriver implements AgentSessionDriver {
  readonly sessions: FakeSession[] = [];
  onStart?: (session: FakeSession) => void;
  start(options: DriverStartOptions): DriverSession {
    const session = new FakeSession(options);
    this.sessions.push(session);
    this.onStart?.(session);
    return session;
  }
  async supportedModels(): Promise<never[]> {
    return [];
  }
}

function fakeWorkspaces(): CreateThrowawayWorkspace {
  let n = 0;
  return async () => ({ dir: `/fake/tmp/ws-${n++}`, cleanup: async () => {} });
}

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}

function seedSession(
  repo: HubRepository,
  text: string,
  toolScope?: HubSession["toolScope"],
): HubSession {
  const session = repo.createSession({
    mode: "chat",
    model: MODEL,
    ...(toolScope ? { toolScope } : {}),
  });
  repo.appendEvent(session.id, { type: "user_message", messageId: "u1", text });
  return repo.getSession(session.id);
}

function collectSink(): { sink: HubTurnSink; events: HubEvent[] } {
  const events: HubEvent[] = [];
  return { sink: { onEvent: (e) => events.push(e), onDelta: () => {} }, events };
}

// ── Stub server/scan/OAuth stores for the resolver ───────────────────────────────────────────────

const STDIO_SERVER: InternalServerConfig = {
  id: "srv-stdio",
  name: "Files",
  transport: "stdio",
  command: "node",
  args: ["files-server.js"],
  env: { FILES_TOKEN: STDIO_ENV_SECRET },
  authType: "none",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const HTTP_SERVER: InternalServerConfig = {
  id: "srv-http",
  name: "Acme",
  transport: "streamable_http",
  url: "https://tenant.example/mcp",
  headers: { "X-Api-Key": HTTP_HEADER_SECRET },
  authType: "api_key",
  authHeaderName: "X-Api-Key",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** A stdio row with NO command — the "unusable server" case the resolver must skip, not throw on. */
const BROKEN_SERVER: InternalServerConfig = {
  id: "srv-broken",
  name: "Broken",
  transport: "stdio",
  env: { BROKEN_TOKEN: "broken-secret-never-logged" },
  authType: "none",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

type StubStores = {
  deps: HubSubscriptionMcpResolverDeps;
  warnings: string[];
};

function stubStores(
  configs: readonly InternalServerConfig[],
  scans: Record<string, string[]>,
  opts?: { oauthFor?: string },
): StubStores {
  const warnings: string[] = [];
  return {
    warnings,
    deps: {
      listServers: () => configs.map((c) => ({ id: c.id, name: c.name })),
      getServerConfig: (id) => {
        const found = configs.find((c) => c.id === id);
        if (!found) throw new Error(`unknown server ${id}`);
        return found;
      },
      listScannedToolNames: (id) => scans[id] ?? [],
      oauthAccessToken: (cfg) =>
        opts?.oauthFor && cfg.id === opts.oauthFor ? OAUTH_TOKEN_SECRET : undefined,
      logger: { warn: (m) => warnings.push(m) },
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (A) The resolver — which servers/tools a session grants, and how they map onto the SDK config
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("an AUTO session (no toolScope) wires every scanned server + a pattern per scanned tool", () => {
  const repo = openRepo();
  const session = seedSession(repo, "hi");
  const { deps } = stubStores([STDIO_SERVER, HTTP_SERVER], {
    "srv-stdio": ["read_file", "write_file"],
    "srv-http": ["run_query"],
  });

  const wiring = createHubSubscriptionMcpResolver(deps)(session);
  assert.ok(wiring, "an auto session with scanned servers grants tools");
  assert.deepEqual(Object.keys(wiring.mcpServers).sort(), ["srv-http", "srv-stdio"]);
  assert.deepEqual(wiring.allowedTools.slice().sort(), [
    "mcp__srv-http__run_query",
    "mcp__srv-stdio__read_file",
    "mcp__srv-stdio__write_file",
  ]);
  assert.deepEqual(wiring.mcpServers["srv-stdio"], {
    type: "stdio",
    command: "node",
    args: ["files-server.js"],
    env: { FILES_TOKEN: STDIO_ENV_SECRET },
  });
  assert.deepEqual(wiring.mcpServers["srv-http"], {
    type: "http",
    url: "https://tenant.example/mcp",
    headers: { "X-Api-Key": HTTP_HEADER_SECRET },
  });
});

test("a SCOPED session grants only its listed servers, intersected with the scanned catalog", () => {
  const repo = openRepo();
  // `srv-stdio` is narrowed to ONE tool (plus a since-removed one that must NOT get a pattern);
  // `srv-http` is scoped out entirely.
  const session = seedSession(repo, "hi", {
    servers: { "srv-stdio": ["read_file", "since_deleted_tool"] },
    builtins: [],
  });
  const { deps } = stubStores([STDIO_SERVER, HTTP_SERVER], {
    "srv-stdio": ["read_file", "write_file"],
    "srv-http": ["run_query"],
  });

  const wiring = createHubSubscriptionMcpResolver(deps)(session);
  assert.ok(wiring);
  assert.deepEqual(Object.keys(wiring.mcpServers), ["srv-stdio"], "the scoped-out server is absent");
  assert.deepEqual(
    wiring.allowedTools,
    ["mcp__srv-stdio__read_file"],
    "only the named-AND-scanned tool gets a pattern (no bogus pattern for a removed tool)",
  );
});

test("a never-scanned / empty-catalog server is skipped entirely (nothing to grant)", () => {
  const repo = openRepo();
  const session = seedSession(repo, "hi");
  const { deps } = stubStores([STDIO_SERVER, HTTP_SERVER], { "srv-http": ["run_query"] });

  const wiring = createHubSubscriptionMcpResolver(deps)(session);
  assert.ok(wiring);
  assert.deepEqual(Object.keys(wiring.mcpServers), ["srv-http"]);
});

test("no granted server at all resolves to null (never an empty-but-present wiring)", () => {
  const repo = openRepo();
  assert.equal(
    createHubSubscriptionMcpResolver(stubStores([], {}).deps)(seedSession(repo, "hi")),
    null,
    "no registered servers",
  );
  assert.equal(
    createHubSubscriptionMcpResolver(stubStores([STDIO_SERVER], {}).deps)(seedSession(repo, "hi")),
    null,
    "registered but unscanned",
  );
  assert.equal(
    createHubSubscriptionMcpResolver(stubStores([STDIO_SERVER], { "srv-stdio": ["read_file"] }).deps)(
      seedSession(repo, "hi", { servers: {}, builtins: [] }),
    ),
    null,
    "an explicitly empty scope grants nothing",
  );
});

test("an unusable server is skipped with a NAME-ONLY warning; the others still wire", () => {
  const repo = openRepo();
  const session = seedSession(repo, "hi");
  const { deps, warnings } = stubStores([BROKEN_SERVER, STDIO_SERVER], {
    "srv-broken": ["boom"],
    "srv-stdio": ["read_file"],
  });

  const wiring = createHubSubscriptionMcpResolver(deps)(session);
  assert.ok(wiring, "one broken server never breaks the turn");
  assert.deepEqual(Object.keys(wiring.mcpServers), ["srv-stdio"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /Broken/, "the warning names the server");
  assert.ok(
    !warnings.join("\n").includes("broken-secret-never-logged"),
    "the warning never carries the server's decrypted env",
  );
});

test("an OAuth streamable-HTTP server's current access token is folded into the CHILD's headers", () => {
  const repo = openRepo();
  const session = seedSession(repo, "hi");
  const { deps } = stubStores([HTTP_SERVER], { "srv-http": ["run_query"] }, { oauthFor: "srv-http" });

  const wiring = createHubSubscriptionMcpResolver(deps)(session);
  assert.deepEqual(wiring?.mcpServers["srv-http"], {
    type: "http",
    url: "https://tenant.example/mcp",
    headers: { "X-Api-Key": HTTP_HEADER_SECRET, Authorization: `Bearer ${OAUTH_TOKEN_SECRET}` },
  });
});

test("parseSubscriptionToolName round-trips a qualified name and rejects a non-MCP one", () => {
  assert.deepEqual(parseSubscriptionToolName("mcp__srv-stdio__read_file"), {
    serverId: "srv-stdio",
    toolName: "read_file",
  });
  assert.deepEqual(
    parseSubscriptionToolName("mcp__srv-stdio__weird__tool"),
    { serverId: "srv-stdio", toolName: "weird__tool" },
    "a tool name containing `__` survives (the FIRST separator wins)",
  );
  assert.equal(parseSubscriptionToolName("Bash"), null);
  assert.equal(parseSubscriptionToolName("mcp__only"), null);
  assert.equal(parseSubscriptionToolName("mcp__srv__"), null);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// (B) The adapter — the wiring actually reaches the child + the prompt
// ══════════════════════════════════════════════════════════════════════════════════════════════

type RunOpts = {
  scope?: HubSession["toolScope"];
  ask?: boolean;
  configs?: readonly InternalServerConfig[];
  scans?: Record<string, string[]>;
  resolveThrows?: boolean;
  script?: (session: FakeSession) => void;
  /** web-access-fix (2026-07-27) — the `HUB_WEB_TOOLS` kill switch. Absent ⇒ on, the env default. */
  webToolsEnabled?: boolean;
};

async function runTurn(opts: RunOpts = {}): Promise<{
  driverOptions: DriverStartOptions;
  events: HubEvent[];
  warnings: string[];
  repo: HubRepository;
  sessionId: string;
  result: unknown;
}> {
  const repo = openRepo();
  const session = seedSession(repo, "do the thing", opts.scope);
  const { sink, events } = collectSink();
  const steering = new HubSteeringQueue(session.id, repo);
  const driver = new FakeDriver();
  driver.onStart = (s) => {
    s.onSend = () => {
      opts.script?.(s);
      s.emit({ type: "assistant_message", text: "done." });
      s.emit(USAGE);
    };
  };
  const { deps: storeDeps, warnings } = stubStores(
    opts.configs ?? [STDIO_SERVER, HTTP_SERVER],
    opts.scans ?? { "srv-stdio": ["read_file", "write_file"], "srv-http": ["run_query"] },
    { oauthFor: "srv-http" },
  );
  const adapterWarnings: string[] = [];

  const executor = createHubSubscriptionAdapter({
    repository: repo,
    driver,
    resolveAuth: () => AUTH,
    concurrency: new AsyncSemaphore(1),
    createWorkspace: fakeWorkspaces(),
    ...(opts.webToolsEnabled !== undefined ? { webToolsEnabled: opts.webToolsEnabled } : {}),
    resolveMcpTools: opts.resolveThrows
      ? () => {
          throw new Error("scan store unavailable");
        }
      : createHubSubscriptionMcpResolver(storeDeps),
    logger: { warn: (m) => adapterWarnings.push(m) },
  });

  const result = await executor({
    session,
    modelId: MODEL,
    abortSignal: new AbortController().signal,
    steering,
    sink,
    ...(opts.ask ? { waitForQuestion: async () => "yes" } : {}),
  });

  return {
    driverOptions: driver.sessions[0]!.options,
    events,
    warnings: [...warnings, ...adapterWarnings],
    repo,
    sessionId: session.id,
    result,
  };
}

test("(1) a granted session reaches the child with mcpServers entries AND the matching allow patterns", async () => {
  const { driverOptions } = await runTurn();

  assert.deepEqual(
    Object.keys(driverOptions.mcpServers).sort(),
    ["srv-http", "srv-stdio"],
    "both granted servers are wired into the child",
  );
  assert.deepEqual((driverOptions.allowedTools ?? []).slice().sort(), [
    // web-access-fix (2026-07-27): the gate is default-deny BY NAME, so the SDK's own web tools must
    // ride the list too or they are refused — see test (1c).
    "WebFetch",
    "WebSearch",
    "mcp__srv-http__run_query",
    "mcp__srv-stdio__read_file",
    "mcp__srv-stdio__write_file",
  ]);
  assert.ok(driverOptions.canUseTool, "a default-deny gate is wired over the same set");
});

test("(1b) the default-deny gate allows a granted tool and denies everything else", async () => {
  const { driverOptions } = await runTurn();
  const gate = driverOptions.canUseTool;
  assert.ok(gate);
  const ask = (toolName: string) =>
    gate({ toolName, input: {}, toolUseId: "tu-x", signal: new AbortController().signal });

  assert.equal((await ask("mcp__srv-stdio__read_file")).behavior, "allow");
  // A tool the server exposes but the session never granted (nor scanned) must be uncallable.
  assert.equal((await ask("mcp__srv-stdio__delete_everything")).behavior, "deny");
  assert.equal((await ask("Bash")).behavior, "deny");
});

// ── web-access-fix (2026-07-27, follow-up) — THE GATED PATH ────────────────────────────────────────
//
// The defect this locks, and the one the first attempt missed. Removing WebSearch/WebFetch from the
// disallow list was necessary but not sufficient: `makeAllowListGate` is default-deny BY EXACT TOOL
// NAME, so the instant a session has any MCP grant the gate is installed and refuses `WebSearch` with
// "Tool "WebSearch" is not on this run's allow-list and cannot be used." — the model could finally SEE
// web search and still not use it. The first fix's test only exercised the tool-LESS path, where no
// gate is installed at all, so it passed while the real (granted) sessions stayed broken.

test("(1c) a GRANTED session can actually call WebSearch/WebFetch — the gate no longer refuses them", async () => {
  const { driverOptions } = await runTurn();
  const gate = driverOptions.canUseTool;
  assert.ok(gate, "this session HAS grants, so the default-deny gate is installed");
  const ask = (toolName: string) =>
    gate({ toolName, input: {}, toolUseId: "tu-web", signal: new AbortController().signal });

  assert.equal((await ask("WebSearch")).behavior, "allow", "WebSearch is callable");
  assert.equal((await ask("WebFetch")).behavior, "allow", "WebFetch is callable");
  assert.ok(!driverOptions.disallowedTools.includes("WebSearch"), "and not blocked either");
  // The sandbox is otherwise untouched — this widened exactly two names, not the gate's posture.
  assert.equal((await ask("Bash")).behavior, "deny");
  assert.equal((await ask("Read")).behavior, "deny");
});

test("(1d) HUB_WEB_TOOLS=off keeps them off BOTH lists on the gated path", async () => {
  const { driverOptions } = await runTurn({ webToolsEnabled: false });
  const patterns = driverOptions.allowedTools ?? [];
  assert.ok(!patterns.includes("WebSearch"), "not allow-listed");
  assert.ok(driverOptions.disallowedTools.includes("WebSearch"), "and blocked outright");
  assert.ok(driverOptions.disallowedTools.includes("WebFetch"));
  const gate = driverOptions.canUseTool;
  assert.ok(gate);
  assert.equal(
    (
      await gate({
        toolName: "WebSearch",
        input: {},
        toolUseId: "tu-off",
        signal: new AbortController().signal,
      })
    ).behavior,
    "deny",
  );
});

test("(2) the REAL tool set reaches assembleSessionPrompt — `tools: {}` is gone", async () => {
  const { driverOptions } = await runTurn();
  const prompt = driverOptions.systemPrompt;

  assert.ok(
    prompt.includes("mcp__srv-stdio__read_file"),
    "the prompt names the granted tool by its fully-qualified SDK name",
  );
  assert.ok(prompt.includes("mcp__srv-http__run_query"));
  assert.ok(prompt.includes("Files") && prompt.includes("Acme"), "grouped by server display name");
  assert.ok(
    !prompt.includes("No MCP tools are granted in this session"),
    "the tool-less fallback line is gone — that was the D-MI3 defect",
  );
});

test("(2b) a tool-less session still gets the honest tool-less prompt line", async () => {
  const { driverOptions } = await runTurn({ configs: [], scans: {} });
  assert.ok(
    driverOptions.systemPrompt.includes("No MCP tools are granted in this session"),
    "nothing granted ⇒ the layer's honest fallback, not a fabricated list",
  );
});

test("(3) the ask_user bridge still works and COEXISTS with the real servers", async () => {
  const { driverOptions } = await runTurn({ ask: true });

  assert.deepEqual(
    Object.keys(driverOptions.mcpServers).sort(),
    ["ask", "srv-http", "srv-stdio"],
    "the in-process ask bridge sits alongside the granted servers — neither displaces the other",
  );
  const patterns = driverOptions.allowedTools ?? [];
  assert.ok(patterns.includes("mcp__ask__ask_user"), "ask_user stays allow-listed");
  assert.ok(patterns.includes("mcp__srv-stdio__read_file"), "…and so do the real tools");
  assert.ok(
    driverOptions.disallowedTools.includes("AskUserQuestion"),
    "the SDK-native AskUserQuestion is still blocked",
  );
  const gate = driverOptions.canUseTool;
  assert.ok(gate);
  const askDecision = await gate({
    toolName: "mcp__ask__ask_user",
    input: {},
    toolUseId: "tu-ask",
    signal: new AbortController().signal,
  });
  assert.equal(askDecision.behavior, "allow");
});

test("(4) NO granted servers + no ask bridge ⇒ byte-identical tool-less driver options", async () => {
  const { driverOptions, result } = await runTurn({ configs: [], scans: {} });

  assert.deepEqual(driverOptions.mcpServers, {}, "no servers");
  assert.equal(driverOptions.allowedTools, undefined, "no allow-list — not an empty array");
  assert.equal(driverOptions.canUseTool, undefined, "no gate over an empty set");
  assert.equal((result as { status: string }).status, "completed", "the turn still completes");
});

test("(4b) a resolver that THROWS degrades the turn to tool-less instead of failing it", async () => {
  const { driverOptions, warnings, result } = await runTurn({ resolveThrows: true });

  assert.deepEqual(driverOptions.mcpServers, {});
  assert.equal(driverOptions.allowedTools, undefined);
  assert.equal((result as { status: string }).status, "completed");
  assert.ok(
    warnings.some((w) => /could not be resolved/.test(w)),
    "the degradation is visible, not silent",
  );
});

/** Cycle-safe deep search for a literal string anywhere in a value (keys or values). The in-process
 *  `ask_user` SDK server object is self-referential, so `JSON.stringify` cannot be used here. */
function deepContains(value: unknown, needle: string, seen = new WeakSet<object>()): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (typeof value === "function") return value.toString().includes(needle);
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((v) => deepContains(v, needle, seen));
  for (const [key, entry] of Object.entries(value)) {
    if (key.includes(needle)) return true;
    if (deepContains(entry, needle, seen)) return true;
  }
  return false;
}

test("(5) SECRETS: decrypted env/headers/oauth token live ONLY in the child config", async () => {
  const { driverOptions, events, warnings, repo, sessionId, result } = await runTurn({ ask: true });
  const secrets = [STDIO_ENV_SECRET, HTTP_HEADER_SECRET, OAUTH_TOKEN_SECRET];

  // Present exactly where they belong: the spawned child's MCP server config.
  for (const secret of secrets) {
    assert.ok(
      deepContains(driverOptions.mcpServers, secret),
      `the child config carries ${secret.slice(0, 12)}…`,
    );
  }

  // Absent everywhere else — including the ask bridge's own in-process server object.
  const forbidden: Array<[string, unknown]> = [
    ["the assembled system prompt", driverOptions.systemPrompt],
    ["the allow patterns", driverOptions.allowedTools ?? []],
    ["the child env", driverOptions.env],
    ["the in-process ask_user server", driverOptions.mcpServers.ask],
    ["the live-streamed events", events],
    ["the persisted event log", repo.listEvents(sessionId)],
    ["the persisted session row", repo.getSession(sessionId)],
    ["the returned turn result", result],
    ["the log lines", warnings.join("\n")],
  ];
  for (const [where, haystack] of forbidden) {
    for (const secret of secrets) {
      assert.ok(
        !deepContains(haystack, secret),
        `${secret.slice(0, 12)}… must not appear in ${where}`,
      );
    }
  }
});

test("a settled tool_call is attributed to its origin server (bare name + serverId)", async () => {
  const { repo, sessionId } = await runTurn({
    script: (s) => {
      s.emit({
        type: "tool_call",
        toolUseId: "tu-1",
        toolName: "mcp__srv-stdio__read_file",
        input: { path: "a.txt" },
      });
      s.emit({ type: "tool_result", toolUseId: "tu-1", result: "ok" });
    },
  });

  const call = repo
    .listEvents(sessionId)
    .find((e): e is Extract<HubEvent, { type: "tool_call" }> => e.type === "tool_call");
  assert.ok(call, "the tool call is persisted as a settled event");
  const part = call.part as HubToolPart;
  assert.equal(part.toolName, "read_file", "the opaque mcp__ prefix is unwrapped for display");
  assert.equal(part.serverId, "srv-stdio", "…and attributed to the granting server");
  assert.equal(part.source, "mcp");
});
