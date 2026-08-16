// Assistant Hub — the HITL seam: approval gate resolution, the MCP-elicitation/ask_user coordinator, and
// the turn-engine interception, driven END-TO-END over a STUBBED model + STUBBED MCP session (no provider,
// no child process, no live server). Proves:
//   1. per-tool approval was REMOVED (owner decision, feat/hub-free-run-tools-roster) — a granted MCP tool
//      (destructive / unannotated / read-only, trusted or not) RUNS with no approval card under EVERY
//      autonomy dial; `resolveApprovalGate` never gates a tool call.
//   2. an MCP `elicitation/create` → emits `elicitation_requested` + `waiting_input` → accept/decline;
//      a credential-shaped field is auto-declined (never collected — R-MCP4/R-MCP12);
//   3. the coordinator routes + settles pending decisions (elicitation, ask_user, session `always`) —
//      these are the tool/agent asking the USER for input, NOT a permission gate, so they are untouched.
// The LIVE round-trip against a REAL eliciting MCP server is owner-acceptance (no such server in tests).

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DEFAULT_TOKEN_PROFILE, type HubEvent } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { DEFAULT_CHAT_BUILTIN_NAMES } from "../src/hub/tools/index.js";
import {
  HubHitlCoordinator,
  credentialFieldName,
  normalizeElicitationRequest,
  resolveApprovalGate,
  type HubApprovalMeta,
  type NormalizedElicitationRequest,
} from "../src/hub/hitl.js";
import {
  HubSessionService,
  type HubMcpGrantInputs,
  type HubSessionServiceDeps,
} from "../src/hub/session-service.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";
import type { McpSession } from "../src/mcp/client.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as const;

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openRepo(): HubRepository {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return new HubRepository(db);
}
function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-hitl-"));
  tempDirs.push(dir);
  return dir;
}

// ── Unit — approval-gate resolution (policy × the autonomy dial) ────────────────────────────────────

test("resolveApprovalGate: first-party tools never gate (byte-identical auto-run)", () => {
  for (const source of ["builtin", "skill", "genui"] as const) {
    const gate = resolveApprovalGate({ source }, "always_ask");
    assert.equal(gate.gated, false, `${source} never gates`);
    assert.equal(gate.destructive, false);
  }
});

test("resolveApprovalGate: NEVER gates a tool call — mcp read-only/unannotated/destructive, trusted or not, any dial", () => {
  const metas: HubApprovalMeta[] = [
    { source: "mcp", serverId: "s1", serverTrusted: true, annotations: { readOnlyHint: true } },
    { source: "mcp", serverId: "s1", serverTrusted: false, annotations: { readOnlyHint: true } },
    { source: "mcp", serverId: "s1", annotations: { destructiveHint: true } },
    { source: "mcp", serverId: "s1" },
  ];
  for (const dial of ["always_ask", "threshold", "auto"] as const) {
    for (const meta of metas) {
      assert.equal(
        resolveApprovalGate(meta, dial).gated,
        false,
        `mcp never gates under ${dial} (${JSON.stringify(meta.annotations ?? "unannotated")})`,
      );
    }
  }
});

test("resolveApprovalGate: a destructive tool stays FLAGGED destructive (inert card context) but is not gated", () => {
  const gate = resolveApprovalGate(
    { source: "mcp", serverId: "s1", annotations: { destructiveHint: true } },
    "auto",
  );
  assert.equal(gate.gated, false, "destructive still runs — no per-call approval");
  assert.equal(gate.destructive, true, "but stays flagged destructive for the card context");
  assert.deepEqual(gate.options, ["allow-once"], "destructive never offers `always`");
});

// ── Unit — credential-shaped-field refusal (R-MCP4 / R-MCP12) ───────────────────────────────────────

test("credentialFieldName flags secret-shaped fields (by name or password format) and clears clean schemas", () => {
  assert.equal(
    credentialFieldName({ type: "object", properties: { apiKey: { type: "string" } } }),
    "apiKey",
  );
  assert.equal(
    credentialFieldName({ type: "object", properties: { password: { type: "string" } } }),
    "password",
  );
  assert.equal(
    credentialFieldName({ type: "object", properties: { pin: { type: "string", format: "password" } } }),
    "pin",
  );
  assert.equal(
    credentialFieldName({ type: "object", properties: { branch: { type: "string" }, confirm: { type: "boolean" } } }),
    undefined,
  );
});

test("normalizeElicitationRequest distinguishes form vs URL mode", () => {
  const form = normalizeElicitationRequest(
    { message: "Pick a branch", requestedSchema: { type: "object", properties: {} } },
    { serverId: "s1", serverName: "Server 1" },
  );
  assert.equal(form.mode, "form");
  assert.equal(form.serverId, "s1");
  assert.ok(form.requestedSchema);

  const url = normalizeElicitationRequest({ mode: "url", message: "Sign in", url: "https://x.example" });
  assert.equal(url.mode, "url");
  assert.equal(url.url, "https://x.example");
});

// ── Unit — the coordinator (pending mailboxes, "always", routing, teardown) ─────────────────────────

test("HubHitlCoordinator: approval mailbox resolves; a decision for nothing pending returns false", async () => {
  const c = new HubHitlCoordinator();
  const pending = c.waitForApproval("sess", "tc-1");
  assert.equal(c.hasPendingApproval("sess", "tc-1"), true);
  assert.equal(c.resolveApproval("sess", "tc-1", "allow-once"), true);
  assert.equal(await pending, "allow-once");
  // A second resolve (or an unknown one) is a no-op.
  assert.equal(c.resolveApproval("sess", "tc-1", "deny"), false);
  assert.equal(c.resolveApproval("sess", "unknown", "deny"), false);
});

test("HubHitlCoordinator: session-scoped `always` is recorded + read back", () => {
  const c = new HubHitlCoordinator();
  assert.equal(c.hasAlways("sess", "mcp__s__t"), false);
  c.recordAlways("sess", "mcp__s__t");
  assert.equal(c.hasAlways("sess", "mcp__s__t"), true);
  assert.equal(c.hasAlways("other", "mcp__s__t"), false, "scoped to the session");
});

test("HubHitlCoordinator: releaseTurn settles dangling decisions + drops routing", async () => {
  const c = new HubHitlCoordinator();
  const pendingApproval = c.waitForApproval("sess", "tc-1");
  const pendingElicit = c.waitForElicitation("sess", "el-1");
  c.bindElicitationResponder("sess", async () => ({ action: "accept" }), ["srv-1"]);
  c.releaseTurn("sess");
  assert.equal(await pendingApproval, "deny", "a dangling approval settles to deny");
  assert.deepEqual(await pendingElicit, { action: "cancel" }, "a dangling elicitation settles to cancel");
  // Routing is gone → an elicitation on that server now declines (nothing to route to).
  assert.deepEqual(
    await c.handleElicitation("srv-1", { mode: "form", message: "?" }),
    { action: "decline" },
  );
});

test("HubHitlCoordinator: question mailbox resolves with the answer; unknown returns false", async () => {
  const c = new HubHitlCoordinator();
  const pending = c.waitForQuestion("sess", "q-1");
  assert.equal(c.hasPendingQuestion("sess", "q-1"), true);
  assert.equal(c.resolveQuestion("sess", "q-1", "staging"), true);
  assert.equal(await pending, "staging");
  // A second resolve (or an unknown one) is a no-op.
  assert.equal(c.resolveQuestion("sess", "q-1", "prod"), false);
  assert.equal(c.resolveQuestion("sess", "unknown", "x"), false);
});

test("HubHitlCoordinator: releaseTurn settles a dangling question to null (stopped without answering)", async () => {
  const c = new HubHitlCoordinator();
  const pending = c.waitForQuestion("sess", "q-1");
  c.releaseTurn("sess");
  assert.equal(await pending, null, "a dangling question settles to null");
  assert.equal(c.hasPendingQuestion("sess", "q-1"), false);
});

test("HubHitlCoordinator: handleElicitation routes to the bound session's responder", async () => {
  const c = new HubHitlCoordinator();
  let seen: NormalizedElicitationRequest | undefined;
  c.bindElicitationResponder(
    "sess",
    async (req) => {
      seen = req;
      return { action: "accept", content: { ok: true } };
    },
    ["srv-1"],
  );
  const decision = await c.handleElicitation("srv-1", { mode: "form", message: "Confirm" });
  assert.deepEqual(decision, { action: "accept", content: { ok: true } });
  assert.equal(seen?.message, "Confirm");
  // An unrouted server declines.
  assert.deepEqual(await c.handleElicitation("srv-x", { mode: "form", message: "?" }), {
    action: "decline",
  });
});

// ── Integration — the turn engine, driven through the session-service ───────────────────────────────

function baseConfig(): HubSessionServiceDeps["config"] {
  return {
    maxActiveSessions: 4,
    idleReleaseMs: 0,
    autoTitle: false,
    dataDir: tempDataDir(),
    toolLoadingDefault: "eager",
    autoFraction: 0.1,
    skillListingBudgetFraction: 0.01,
    skillEntryMaxChars: 1536,
    skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
  };
}

/** A model that calls the granted `act` tool once, then answers. */
function mockCallThenAnswer(toolName: string): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "tc-1", toolName, input: JSON.stringify({ x: 1 }) },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "done." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

/** Grant one server with a single tool carrying the given annotations; `callTool` records + echoes. */
function grantsWith(
  toolName: string,
  annotations: Record<string, unknown> | undefined,
  callTool: McpSession["callTool"],
): HubMcpGrantInputs {
  return {
    grants: { servers: { "srv-1": "all" }, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
    catalog: new Map([
      [
        "srv-1",
        {
          serverName: "Ops server",
          tools: [
            {
              name: toolName,
              description: "Act on something.",
              inputSchema: { type: "object", properties: { x: { type: "number" } } },
              ...(annotations ? { annotations } : {}),
              raw: {},
            },
          ],
        },
      ],
    ]),
    sessions: new Map([["srv-1", { listTools: async () => ({ tools: [] }), callTool, close: async () => undefined }]]),
    sink: { toolCall: () => undefined },
  };
}

function makeService(
  buildModel: () => MockLanguageModelV3,
  grants: HubMcpGrantInputs,
  overrides: Partial<HubSessionServiceDeps> = {},
): HubSessionService {
  return new HubSessionService({
    repository: overrides.repository ?? openRepo(),
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => buildModel() as never,
    }),
    mcpGrantsProvider: () => grants,
    config: baseConfig(),
    ...overrides,
  });
}

const silentSink: HubTurnSink = { onEvent: () => undefined, onDelta: () => undefined };

test("Acceptance 1 — a destructive tool RUNS with no approval card (granted ⇒ run, owner decision)", async () => {
  const repo = openRepo();
  let ran = 0;
  const grants = grantsWith("delete_thing", { destructiveHint: true }, async () => {
    ran += 1;
    return { structuredContent: { deleted: true } };
  });
  const service = makeService(() => mockCallThenAnswer("delete_thing"), grants, { repository: repo });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });

  await service.dispatchMessage(session.id, { text: "delete it" }, silentSink);

  const events = repo.listEvents(session.id);
  assert.ok(
    !events.some((e) => e.type === "approval_requested"),
    "no approval card is surfaced — even for a destructive tool",
  );
  assert.ok(
    !events.some(
      (e) => e.type === "phase" && e.phase === "waiting_input" && e.detail?.reason === "approval",
    ),
    "the session never entered approval waiting_input",
  );
  const result = events.find((e) => e.type === "tool_result");
  assert.equal(result?.type === "tool_result" && result.state, "output-available", "the tool ran");
  assert.equal(ran, 1, "the underlying MCP tool executed once, unprompted");
});

test("Acceptance 1 — an UNANNOTATED tool under the default always_ask dial RUNS with no approval card", async () => {
  const repo = openRepo();
  let ran = 0;
  const grants = grantsWith("do_thing", undefined, async () => {
    ran += 1;
    return { ok: true };
  });
  const service = makeService(() => mockCallThenAnswer("do_thing"), grants, { repository: repo });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  // The autonomy dial still resolves (it governs mission PLAN-launch now), but no longer gates a tool call.
  assert.equal(service.resolveAutonomy(session), "always_ask");

  await service.dispatchMessage(session.id, { text: "do it" }, silentSink);

  const events = repo.listEvents(session.id);
  assert.ok(
    !events.some((e) => e.type === "approval_requested"),
    "always_ask no longer gates an individual tool call",
  );
  const result = events.find((e) => e.type === "tool_result");
  assert.equal(result?.type === "tool_result" && result.state, "output-available", "the tool ran");
  assert.equal(ran, 1, "the underlying MCP tool executed once, unprompted");
});

test("Acceptance 2 — an MCP elicitation PAUSES for the operator; accept flows the content back", async () => {
  const repo = openRepo();
  // The stub tool ELICITS mid-call (simulating a server's `elicitation/create`) via the service's own
  // handler — the exact seam index.ts wires to a live MCP connection. It closes over `service`, resolved
  // lazily (the provider is only invoked during dispatch, after construction).
  let service!: HubSessionService;
  const grants = grantsWith("configure", undefined, async () => {
    const decision = await service.handleElicitation(
      "srv-1",
      { message: "Which branch?", requestedSchema: { type: "object", properties: { branch: { type: "string" } } } },
      { serverName: "Ops server" },
    );
    return { structuredContent: { decision } };
  });
  service = makeService(() => mockCallThenAnswer("configure"), grants, { repository: repo });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });

  const sink: HubTurnSink = {
    onEvent: (e) => {
      // `configure` (an unannotated MCP tool) itself gates under the default always_ask dial — approve
      // it so it can run and elicit.
      if (e.type === "approval_requested" && !e.isAutomatic) {
        service.decideApproval(session.id, e.toolCallId, "allow-once");
      }
      if (e.type === "elicitation_requested") {
        service.respondElicitation(session.id, e.elicitationId, {
          action: "accept",
          content: { branch: "main" },
        });
      }
    },
    onDelta: () => undefined,
  };
  await service.dispatchMessage(session.id, { text: "configure it" }, sink);

  const events = repo.listEvents(session.id);
  const requested = events.find((e) => e.type === "elicitation_requested");
  assert.equal(requested?.type === "elicitation_requested" && requested.mode, "form");
  assert.equal(requested?.type === "elicitation_requested" && requested.message, "Which branch?");
  const waiting = events.find(
    (e) => e.type === "phase" && e.phase === "waiting_input" && e.detail?.reason === "elicitation",
  );
  assert.ok(waiting, "the session entered waiting_input (reason elicitation)");
  const responded = events.find((e) => e.type === "elicitation_responded");
  assert.equal(responded?.type === "elicitation_responded" && responded.action, "accept");
});

test("Acceptance 2 — a credential-shaped elicitation is auto-declined without ever asking (R-MCP4)", async () => {
  const repo = openRepo();
  let service!: HubSessionService;
  let decisionSeen: unknown;
  const grants = grantsWith("configure", undefined, async () => {
    decisionSeen = await service.handleElicitation("srv-1", {
      message: "Enter your API key",
      requestedSchema: { type: "object", properties: { apiKey: { type: "string" } } },
    });
    return { ok: true };
  });
  service = makeService(() => mockCallThenAnswer("configure"), grants, { repository: repo });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });

  let respondedTo = false;
  const sink: HubTurnSink = {
    onEvent: (e) => {
      if (e.type === "approval_requested" && !e.isAutomatic) {
        service.decideApproval(session.id, e.toolCallId, "allow-once");
      }
      if (e.type === "elicitation_requested") {
        // The guard must have ALREADY auto-declined — an operator response would be a leak of a secret prompt.
        respondedTo = true;
      }
    },
    onDelta: () => undefined,
  };
  await service.dispatchMessage(session.id, { text: "configure it" }, sink);

  assert.deepEqual(decisionSeen, { action: "decline" }, "the elicitation was auto-declined");
  const events = repo.listEvents(session.id);
  const responded = events.find((e) => e.type === "elicitation_responded");
  assert.equal(
    responded?.type === "elicitation_responded" && responded.autoDeclined,
    true,
    "the response is marked auto-declined (credential guard)",
  );
  const waiting = events.find(
    (e) => e.type === "phase" && e.phase === "waiting_input" && e.detail?.reason === "elicitation",
  );
  assert.equal(waiting, undefined, "the session NEVER entered waiting_input — the operator was never asked");
  assert.equal(respondedTo, true, "the request was still surfaced as an event (visible, just auto-declined)");
});

// ── Integration — interactive `ask_user` (the reused Testing primitive, on the AI-SDK path) ───────────

/** A model that calls the built-in `ask_user` tool once (with options), then answers. */
function mockAskThenAnswer(): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tc-ask",
                toolName: "ask_user",
                input: JSON.stringify({
                  question: "Which environment should I target?",
                  options: [{ label: "staging" }, { label: "prod" }],
                  allowOther: false,
                }),
              },
              { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Targeting staging." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

/** Minimal grants — no MCP server tool; `ask_user` is a first-party builtin the engine injects itself. */
function builtinOnlyGrants(): HubMcpGrantInputs {
  return {
    grants: { servers: {}, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
    catalog: new Map(),
    sessions: new Map(),
    sink: { toolCall: () => undefined },
  };
}

test("ask_user — an interactive foreground session PAUSES on a question; answering resumes the turn", async () => {
  const repo = openRepo();
  const service = makeService(() => mockAskThenAnswer(), builtinOnlyGrants(), { repository: repo });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  // The capability is advertised so the UI + engine gate on it (D-US4).
  assert.equal(session.capabilities?.askUser, true, "a foreground chat session exposes ask_user");

  const sink: HubTurnSink = {
    onEvent: (e) => {
      // Answer on a LATER tick — exactly as production does (the answer arrives via an HTTP POST after
      // the tool has emitted the question and registered its mailbox). A synchronous answer would race
      // ahead of the mailbox registration and be dropped.
      if (e.type === "question") {
        const questionId = e.questionId;
        setTimeout(() => service.answerQuestion(session.id, questionId, "staging"), 0);
      }
    },
    onDelta: () => undefined,
  };
  await service.dispatchMessage(session.id, { text: "deploy the app" }, sink);

  const events = repo.listEvents(session.id);
  const question = events.find((e) => e.type === "question");
  assert.ok(question, "the agent emitted a question");
  assert.equal(question?.type === "question" && question.prompt, "Which environment should I target?");
  assert.deepEqual(
    question?.type === "question" ? question.options?.map((o) => o.label) : [],
    ["staging", "prod"],
    "the predefined options were carried through",
  );
  const waiting = events.find(
    (e) => e.type === "phase" && e.phase === "waiting_input" && e.detail?.reason === "question",
  );
  assert.ok(waiting, "the session entered waiting_input (reason question)");
  const resolved = events.find((e) => e.type === "question_resolved");
  assert.equal(resolved?.type === "question_resolved" && resolved.answer, "staging", "the answer settled it");
  // The ask_user tool call itself is a first-party builtin — never gated, so no approval was asked.
  assert.equal(
    events.some((e) => e.type === "approval_requested"),
    false,
    "ask_user is a builtin — it never triggers an approval card",
  );
});
