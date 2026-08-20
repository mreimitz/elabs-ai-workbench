// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.1) — the session-service lifecycle orchestration, over a
// real repository + a STUBBED model (no provider). File at `apps/api/test/` (the api runner's glob).
//
// Proves: createSession persists the capability manifest; a dispatch runs a turn + sets a deterministic
// auto-title (and an injected refiner overrides it); a per-message model override flows to the effective
// model and is recorded; the active-session cap 409s a genuinely new session while one is live; a
// mid-run dispatch is queued as steering and injected; the default built-in toolset builds + runs.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_TOKEN_PROFILE,
  type HubEvent,
  type HubToolGrants,
  type ProviderKind,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { hubCapabilitiesForKind } from "../src/hub/capabilities.js";
import { HubRepository } from "../src/hub/repository.js";
import { missionProposePlan } from "../src/hub/tools/index.js";
import {
  canAutoRouteMission,
  grantMissionProposeForAuto,
  hubDeterministicTitle,
  HubResourcePool,
  HubSessionService,
  type HubModelResolver,
  type HubProposeMissionForTurn,
  type HubSessionServiceConfig,
  type HubSessionServiceDeps,
} from "../src/hub/session-service.js";
import type { HubTurnSink } from "../src/hub/turn-engine.js";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ws-"));
  tempDirs.push(dir);
  return dir;
}

function textModel(text: string): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
        ] as V3Part[],
      }),
    }),
  }) as unknown as LanguageModel;
}

function resolverFor(
  entries: Record<string, { kind: ProviderKind; model?: () => LanguageModel }>,
): HubModelResolver {
  return (modelId) => {
    const entry = entries[modelId];
    if (!entry) throw new Error(`no model resolution for "${modelId}"`);
    return {
      providerKind: entry.kind,
      modelId,
      contextWindow: 128000,
      ...(entry.model ? { buildModel: entry.model } : {}),
    };
  };
}

const silentSink: HubTurnSink = { onEvent: () => undefined, onDelta: () => undefined };

function makeService(over: Partial<HubSessionServiceDeps> & { resolveModel: HubModelResolver }): {
  service: HubSessionService;
  repo: HubRepository;
} {
  const repo = over.repository ?? openRepo();
  const config: HubSessionServiceConfig = {
    maxActiveSessions: 4,
    idleReleaseMs: 0,
    autoTitle: true,
    dataDir: tempDataDir(),
    toolLoadingDefault: "eager",
    autoFraction: 0.1,
    // WP2.4 defaults (mirror config/env.ts's own HUB_SKILL_* defaults) — most tests never attach a
    // skill, so these values are inert unless a test also supplies `skillCatalogProvider`.
    skillListingBudgetFraction: 0.01,
    skillEntryMaxChars: 1536,
    skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    ...over.config,
  };
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    // Default to an EMPTY toolset so most tests don't touch the filesystem; specific tests opt into the
    // real built-in resolver by omitting this.
    resolveToolset: () => ({ tools: {} }),
    config,
    ...over,
  });
  return { service, repo };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function assistantMessages(events: HubEvent[]) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "assistant_message" }> => e.type === "assistant_message",
  );
}

// ── createSession persists the capability manifest (D-US4) ─────────────────────────────────────────

test("createSession resolves + persists the capability manifest (gated on capabilities, not kind)", async () => {
  const { service } = makeService({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  // A foreground chat session exposes the interactive `ask_user` tool (askUser:true) — a mission agent
  // child would not (createSession passes `session.kind !== "agent"`).
  assert.deepEqual(session.capabilities, hubCapabilitiesForKind("openai", true));
  assert.equal(session.capabilities?.askUser, true);
  assert.equal(session.status, "pending");
});

// ── createSession unions the roster's server grants into the tool scope (Defect 1a) ─────────────────

test("createSession (Defect 1a): a scoped-in server-bound role's MCP server is unioned into the session scope", async () => {
  const { service, repo } = makeService({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const analyst = repo.createAgentRole({
    name: "data-analyst-agent",
    systemPrompt: "You use my Acme MCP server.",
    defaultModel: "gpt-4o",
    target: "query Acme",
    expectedOutcome: "answers",
    toolGrants: { servers: { "srv-acme": "all" }, builtins: ["memory.propose_save"] },
  });
  const researcher = repo.createAgentRole({
    name: "data-researcher-agent",
    systemPrompt: "You research.",
    defaultModel: "gpt-4o",
    target: "research",
    expectedOutcome: "answers",
    toolGrants: { servers: { "srv-acme": ["search"] }, builtins: [] },
  });
  const crew = repo.createCrew({
    name: "analysts",
    topology: "parallel",
    members: [{ agentId: researcher.id }],
  });

  // A mission session scoped with an EMPTY server scope but a roster of the Acme-bound role + crew — the
  // exact shape that used to strip the Acme grant at plan time and leave the agent tool-less.
  const session = await service.createSession({
    mode: "mission",
    model: "gpt-4o",
    toolScope: { servers: {}, builtins: ["memory.propose_save"] },
    roster: { agentIds: [analyst.id], crewIds: [crew.id] },
  });

  // The Acme server both roles need is now REACHABLE from the session ("all" ∪ ["search"] = "all").
  assert.equal(
    session.toolScope?.servers["srv-acme"],
    "all",
    "the roster roles' Acme server was unioned into the session tool scope",
  );
  assert.deepEqual(session.toolScope?.builtins, ["memory.propose_save"], "built-ins are untouched");
});

test("createSession (Defect 1a): an auto (unscoped) session is left untouched — it already reaches every server", async () => {
  const { service, repo } = makeService({ resolveModel: resolverFor({ "gpt-4o": { kind: "openai" } }) });
  const role = repo.createAgentRole({
    name: "analyst",
    systemPrompt: "x",
    defaultModel: "gpt-4o",
    target: "x",
    expectedOutcome: "x",
    toolGrants: { servers: { "srv-acme": "all" }, builtins: [] },
  });
  // No toolScope ⇒ auto (null). The union is a no-op — auto already reaches every server.
  const session = await service.createSession({
    mode: "mission",
    model: "gpt-4o",
    roster: { agentIds: [role.id], crewIds: [] },
  });
  assert.equal(session.toolScope, null, "an auto session stays auto (no scope was synthesized)");
});

// ── dispatch runs a turn + deterministic auto-title ────────────────────────────────────────────────

test("dispatch runs a turn and sets a deterministic auto-title from the first message", async () => {
  const { service, repo } = makeService({
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("Paris.") } }),
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });

  const outcome = await service.dispatchMessage(
    session.id,
    { text: "What is the capital of France? Please be brief." },
    silentSink,
  );
  assert.equal(outcome.kind, "ran");
  if (outcome.kind === "ran") assert.equal(outcome.result.status, "completed");

  const titled = repo.getSession(session.id);
  assert.equal(
    titled.title,
    "What is the capital of France?",
    "deterministic first-sentence title",
  );
  assert.equal(titled.titleState, "auto");

  const ams = assistantMessages(repo.listEvents(session.id));
  assert.equal(ams.length, 1);
  assert.equal(ams[0]?.model, "gpt-4o");
});

test("an injected title refiner overrides the deterministic title after the first turn", async () => {
  const { service, repo } = makeService({
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("Paris.") } }),
    refineTitle: async () => "Capital cities Q&A",
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  await service.dispatchMessage(session.id, { text: "capital of france?" }, silentSink);
  await tick(); // the refine is fire-and-forget — let it settle
  assert.equal(repo.getSession(session.id).title, "Capital cities Q&A");
  assert.equal(repo.getSession(session.id).titleState, "auto");
});

// ── per-message model override (R-SES10 / D-AH4) ───────────────────────────────────────────────────

test("a per-message model override drives the effective model and is recorded on the turn", async () => {
  const { service, repo } = makeService({
    resolveModel: resolverFor({
      "gpt-4o": { kind: "openai", model: () => textModel("default-model answer") },
      "claude-sonnet-4": { kind: "anthropic", model: () => textModel("override-model answer") },
    }),
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });

  await service.dispatchMessage(session.id, { text: "hi", model: "claude-sonnet-4" }, silentSink);

  const events = repo.listEvents(session.id);
  const user = events.find(
    (e): e is Extract<HubEvent, { type: "user_message" }> => e.type === "user_message",
  );
  assert.equal(user?.model, "claude-sonnet-4", "the override is recorded on the user turn");
  const [am] = assistantMessages(events);
  assert.equal(
    am?.model,
    "claude-sonnet-4",
    "the assistant message is stamped with the override model",
  );
});

// ── active-session cap 409 ─────────────────────────────────────────────────────────────────────────

test("the active-session cap 409s a new session while another turn is live", async () => {
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const gatedModel = new MockLanguageModelV3({
    doStream: async () => {
      await gate;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "done" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;

  const { service } = makeService({
    config: {
      maxActiveSessions: 1,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
    resolveModel: resolverFor({
      gate: { kind: "openai", model: () => gatedModel },
      "gpt-4o": { kind: "openai", model: () => textModel("second") },
    }),
  });
  const a = await service.createSession({ mode: "chat", model: "gate" });
  const b = await service.createSession({ mode: "chat", model: "gpt-4o" });

  const running = service.dispatchMessage(a.id, { text: "slow" }, silentSink);
  await tick(); // let A acquire the only slot and block on the gate
  assert.equal(service.activeCount(), 1);
  await assert.rejects(
    () => service.dispatchMessage(b.id, { text: "blocked" }, silentSink),
    /already running 1 sessions/,
  );

  releaseGate();
  await running;
  assert.equal(service.activeCount(), 0, "the slot is released on reply (grace 0)");
});

// ── mid-run dispatch → durable steering, injected at a step boundary ───────────────────────────────

test("a dispatch while a turn is running is queued as steering and injected", async () => {
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let call = 0;
  const gatedModel = new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) await gate; // pass 1 blocks until we've queued the steering message
      const text = call === 1 ? "first answer" : "answer with steering";
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: text },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;

  const { service, repo } = makeService({
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => gatedModel } }),
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });

  const running = service.dispatchMessage(session.id, { text: "start" }, silentSink);
  await tick(); // let the turn acquire the slot and block on the gate

  const queued = await service.dispatchMessage(session.id, { text: "also this" }, silentSink);
  assert.equal(queued.kind, "queued", "a mid-run dispatch is queued, not a second turn");

  releaseGate();
  await running;

  const events = repo.listEvents(session.id);
  assert.ok(
    events.some((e) => e.type === "queued_user_message" && e.text === "also this"),
    "the steering message is persisted (durable)",
  );
  assert.ok(
    events.some((e) => e.type === "user_message" && e.text === "also this"),
    "the steering message was injected as a user turn",
  );
  assert.equal(assistantMessages(events).length, 2, "opener + steering continuation");
});

// ── model-identity WP4.4 — the STEERING branch is untouched by the resolution guard ─────────────────

test("a mid-run dispatch with an UNUSABLE credential still QUEUES — the WP4.4 guard sits below the steering branch", async () => {
  // The steering short-circuit returns BEFORE any model is resolved (a queued message is injected at the
  // running turn's next step boundary and resolved then, by the turn already in flight). WP4.4's guard
  // must therefore never fire here: moving it above the branch would turn every mid-run keystroke into a
  // credential check — refusing a message that the running turn would have accepted.
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let call = 0;
  const gatedModel = new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) await gate;
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: call === 1 ? "first" : "with steering" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;

  const resolveCalls: Array<string | undefined> = [];
  const { service, repo } = makeService({
    resolveModel: (modelId, providerCredentialId) => {
      resolveCalls.push(providerCredentialId);
      if (providerCredentialId === "prov-refused") {
        throw Object.assign(new Error("refused pin"), { statusCode: 409 });
      }
      return {
        providerKind: "openai" as const,
        modelId,
        contextWindow: 128000,
        buildModel: () => gatedModel,
      };
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  resolveCalls.length = 0; // `createSession` resolves too — only the DISPATCHES matter here

  const running = service.dispatchMessage(session.id, { text: "start" }, silentSink);
  await tick(); // let the turn take the slot and block on the gate

  const queued = await service.dispatchMessage(
    session.id,
    { text: "also this", providerCredentialId: "prov-refused" },
    silentSink,
  );
  assert.equal(queued.kind, "queued", "a mid-run dispatch is STILL queued, not refused");
  assert.deepEqual(
    resolveCalls,
    [undefined],
    "and the guard never ran for it — only the first (live) turn resolved a model",
  );

  releaseGate();
  await running;

  const events = repo.listEvents(session.id);
  assert.ok(
    events.some((e) => e.type === "queued_user_message" && e.text === "also this"),
    "the steering message is still persisted (durable)",
  );
  assert.ok(!events.some((e) => e.type === "error"), "and nothing was refused");

  // model-identity WP6.1 (F4) — and the credential the caller SENT is no longer discarded: it is
  // recorded on the queued event as the operator's ask. It is deliberately not APPLIED (the running
  // turn's resolution is fixed before the queue drains), which is exactly why recording it matters —
  // otherwise a mid-turn "Retry on the other auth source" leaves no trace anywhere that it was asked.
  const queuedEvent = events.find(
    (e): e is Extract<HubEvent, { type: "queued_user_message" }> =>
      e.type === "queued_user_message" && e.text === "also this",
  );
  assert.equal(queuedEvent?.providerCredentialId, "prov-refused");
});

// ── the DEFAULT built-in toolset builds + runs (no injected toolset) ───────────────────────────────

test("the default built-in toolset resolves and a turn runs over it", async () => {
  const repo = openRepo();
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    // No `resolveToolset` override → exercises the real built-in resolver + workspace creation.
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("hi there") } }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  const outcome = await service.dispatchMessage(session.id, { text: "say hi" }, silentSink);
  assert.equal(outcome.kind, "ran");
  if (outcome.kind === "ran") assert.equal(outcome.result.status, "completed");
});

// ── WP2.6 (R-GUI1/2): the default toolset grants `present`/`prompt_user` + injects the catalog ───────

test("the default toolset wires the GenUI tools + LAYER-4 catalog into a chat turn", async () => {
  const repo = openRepo();
  const captured: { system?: string; toolNames: string[] } = { toolNames: [] };
  const recordingModel = new MockLanguageModelV3({
    doStream: async (options: unknown) => {
      const opts = options as { prompt: Array<{ role: string; content: unknown }>; tools?: Array<{ name: string }> };
      const sys = opts.prompt.find((m) => m.role === "system");
      captured.system = typeof sys?.content === "string" ? sys.content : JSON.stringify(sys?.content);
      captured.toolNames = (opts.tools ?? []).map((t) => t.name);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;

  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => recordingModel } }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      genuiMaxRepairAttempts: 2,
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  await service.dispatchMessage(session.id, { text: "show me revenue" }, silentSink);

  assert.ok(captured.toolNames.includes("present"), "present tool granted");
  assert.ok(captured.toolNames.includes("prompt_user"), "prompt_user tool granted");
  assert.match(captured.system ?? "", /present/, "the GenUI contract is in the system prompt");
  assert.match(captured.system ?? "", /`Chart`/, "the compiled catalog is injected");
});

// ── WP3.1 (D-AH11c): a project's instructions + pinned files inject into LAYER 6b ──────────────────

/** A `MockLanguageModelV3` that records the assembled SYSTEM prompt off `doStream`'s `prompt` — the
 *  same recording shape `hub-session-service.test.ts`'s GenUI test above already established. */
function recordingModelAnd(captured: { system?: string }): LanguageModel {
  return new MockLanguageModelV3({
    doStream: async (options: unknown) => {
      const opts = options as { prompt: Array<{ role: string; content: unknown }> };
      const sys = opts.prompt.find((m) => m.role === "system");
      captured.system = typeof sys?.content === "string" ? sys.content : JSON.stringify(sys?.content);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

test("a session in a project inherits the project's instructions + pinned files (LAYER 6b + LAYER 2 name)", async () => {
  const repo = openRepo();
  const project = repo.createProject({
    name: "Q3 Launch",
    instructions: "Always cite the internal ticket number when relevant.",
  });
  const fileContent = Buffer.from("# Style guide\n\nUse tabular-nums for numbers.", "utf8");
  const file = repo.createFile({ sha256: "abc", mime: "text/plain", filename: "style.md", content: fileContent });
  repo.linkFile({ fileId: file.id, role: "pinned", targetKind: "project", targetId: project.id });

  const captured: { system?: string } = {};
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => recordingModelAnd(captured) } }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o", projectId: project.id });
  await service.dispatchMessage(session.id, { text: "hi" }, silentSink);

  assert.match(captured.system ?? "", /Q3 Launch/, "the project name reaches LAYER 2 session context");
  assert.match(
    captured.system ?? "",
    /Always cite the internal ticket number/,
    "the project's instructions reach LAYER 6b",
  );
  assert.match(captured.system ?? "", /style\.md/, "the pinned file's name is injected");
  assert.match(captured.system ?? "", /Use tabular-nums for numbers/, "the pinned file's content is injected");
});

test("a session in an EMPTY project (no instructions, no pinned files) still shows the project layer's placeholder", async () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Empty Project" });
  const captured: { system?: string } = {};
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => recordingModelAnd(captured) } }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o", projectId: project.id });
  await service.dispatchMessage(session.id, { text: "hi" }, silentSink);

  assert.match(captured.system ?? "", /Empty Project/);
  assert.match(captured.system ?? "", /no project instructions/);
});

test("a plain (non-project) session omits the project layer entirely", async () => {
  const repo = openRepo();
  const captured: { system?: string } = {};
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => recordingModelAnd(captured) } }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  await service.dispatchMessage(session.id, { text: "hi" }, silentSink);

  assert.doesNotMatch(captured.system ?? "", /Project instructions/, "no project layer heading at all");
});

test("the project context body is truncated at `projectContextMaxChars` (never silently blows the window)", async () => {
  const repo = openRepo();
  const project = repo.createProject({ name: "Big Project", instructions: "x".repeat(500) });
  const captured: { system?: string } = {};
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => recordingModelAnd(captured) } }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      projectContextMaxChars: 100,
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o", projectId: project.id });
  await service.dispatchMessage(session.id, { text: "hi" }, silentSink);

  assert.match(captured.system ?? "", /truncated at 100 characters/);
  assert.ok(
    (captured.system ?? "").match(/x{101,}/) === null,
    "the run of x's itself never exceeds the cap",
  );
});

// ── WP3.2 (D-AH11): active memory is injected into LAYER 6a, nothing hidden ────────────────────────

test("an active memory row is injected into the chat turn's system prompt; a proposed row is not", async () => {
  const repo = openRepo();
  const captured: { system?: string } = {};
  const recordingModel = new MockLanguageModelV3({
    doStream: async (options: unknown) => {
      const opts = options as { prompt: Array<{ role: string; content: unknown }> };
      const sys = opts.prompt.find((m) => m.role === "system");
      captured.system = typeof sys?.content === "string" ? sys.content : JSON.stringify(sys?.content);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;

  repo.createMemory({ kind: "preference", content: "Prefers concise answers.", source: "user" });
  // An assistant-proposed row still awaiting an explicit accept must NOT leak into the prompt.
  repo.createMemory({
    kind: "instruction",
    content: "Never mention this unaccepted instruction.",
    source: "assistant_proposed",
  });

  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => recordingModel } }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  await service.dispatchMessage(session.id, { text: "hi" }, silentSink);

  assert.match(captured.system ?? "", /Prefers concise answers\./, "active memory reaches the prompt");
  assert.doesNotMatch(
    captured.system ?? "",
    /Never mention this unaccepted instruction\./,
    "an un-accepted proposal never leaks into the prompt (D-AH11)",
  );
});

test("with no saved memory, the prompt carries no memory content (byte-identical to pre-WP3.2 behavior)", async () => {
  const repo = openRepo();
  const captured: { system?: string } = {};
  const recordingModel = new MockLanguageModelV3({
    doStream: async (options: unknown) => {
      const opts = options as { prompt: Array<{ role: string; content: unknown }> };
      const sys = opts.prompt.find((m) => m.role === "system");
      captured.system = typeof sys?.content === "string" ? sys.content : JSON.stringify(sys?.content);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "ok" },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;

  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => recordingModel } }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
    },
  });
  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  await service.dispatchMessage(session.id, { text: "hi" }, silentSink);

  assert.doesNotMatch(captured.system ?? "", /## Memory/, "the memory layer is omitted entirely");
});

// ── the deterministic title helper (pure) ──────────────────────────────────────────────────────────

test("hubDeterministicTitle prefers the opening sentence and clips long input", () => {
  assert.equal(
    hubDeterministicTitle("What is the capital of France? More text."),
    "What is the capital of France?",
  );
  assert.equal(hubDeterministicTitle("   "), "");
  const long = hubDeterministicTitle("a".repeat(200));
  assert.ok(long.length <= 60 && long.endsWith("…"));
});

// ── HubResourcePool (hub-fixes WP1.3, RC3.4) — the pooled-resource cache the reconnect route evicts ──
//
// Pulled out of what used to be a bare `Map` + closure inline in `index.ts`'s `hubMcpSessions` so the
// eviction behavior `POST /api/hub/servers/:id/reconnect` needs is provable in isolation, not just
// end-to-end through a live MCP server (which this test suite deliberately never spins up).

type FakeResource = { id: number; closed: boolean; close: () => Promise<void> };

function fakeResource(id: number): FakeResource {
  const resource: FakeResource = { id, closed: false, close: async () => undefined };
  resource.close = async () => {
    resource.closed = true;
  };
  return resource;
}

test("HubResourcePool.get() opens once and caches the SAME in-flight promise for concurrent callers", async () => {
  const pool = new HubResourcePool<FakeResource>();
  let opens = 0;
  const open = () => {
    opens += 1;
    return Promise.resolve(fakeResource(opens));
  };
  const [a, b] = await Promise.all([pool.get("srv-1", open), pool.get("srv-1", open)]);
  assert.equal(opens, 1, "a concurrent second get() reuses the same in-flight open, not a second one");
  assert.equal(a, b);
});

test("HubResourcePool auto-evicts a FAILED open so the next get() retries — the failing-then-working case", async () => {
  const pool = new HubResourcePool<FakeResource>();
  let attempt = 0;
  const open = () => {
    attempt += 1;
    if (attempt === 1) return Promise.reject(new Error("ECONNREFUSED"));
    return Promise.resolve(fakeResource(attempt));
  };

  await assert.rejects(() => pool.get("srv-1", open), /ECONNREFUSED/);
  const resource = await pool.get("srv-1", open);
  assert.equal(attempt, 2, "the failed open was auto-evicted, so the retry actually opened fresh");
  assert.equal(resource.id, 2);
});

test("HubResourcePool.evict() force-drops a SUCCESSFULLY open entry, closing it best-effort, so the next get() opens fresh", async () => {
  const pool = new HubResourcePool<FakeResource>();
  let attempt = 0;
  const open = () => {
    attempt += 1;
    return Promise.resolve(fakeResource(attempt));
  };

  const first = await pool.get("srv-1", open);
  assert.equal(attempt, 1);
  assert.equal(first.closed, false);

  await pool.evict("srv-1");
  assert.equal(first.closed, true, "evict() closed the previously-open resource (best-effort)");

  const second = await pool.get("srv-1", open);
  assert.equal(attempt, 2, "the NEXT get() after evict() opened a fresh connection, not the stale one");
  assert.notEqual(second.id, first.id);
});

test("HubResourcePool.evict() on an unknown id is a harmless no-op", async () => {
  const pool = new HubResourcePool<FakeResource>();
  await pool.evict("never-opened"); // must not throw
});

test("HubResourcePool.evict() on a currently-FAILING (rejected, not yet caught) entry never throws", async () => {
  const pool = new HubResourcePool<FakeResource>();
  const pending = pool.get("srv-1", () => Promise.reject(new Error("down")));
  pending.catch(() => undefined); // avoid a Node unhandled-rejection warning while evict() races it below
  await pool.evict("srv-1"); // races the in-flight rejection — must still resolve cleanly
  await assert.rejects(() => pending, /down/); // the ORIGINAL caller still observes the real failure
});

// ── hub-fixes WP6.1 (RC7) — `auto` session mode: the mission-propose grant + the routing bridge ──────

/** A minimal wire-valid `HubMissionPlan` for the `mission.propose_plan` builtin's argument validation. */
const VALID_ROUTING_PLAN = {
  topology: "parallel",
  autonomy: "always_ask",
  rationale: "One angle is enough.",
  agents: [
    {
      key: "a",
      name: "A",
      systemPrompt: "s",
      model: "gpt-4o",
      toolGrants: { servers: {}, builtins: [] },
      skillIds: [],
      brief: "b",
      target: "t",
      expectedOutcome: "e",
    },
  ],
};

/** A model whose FIRST step calls the provider-safe `mission_propose_plan` builtin, then (after the tool
 *  result) answers with a short line — the shape an `auto` session's routing turn takes for a mission-
 *  shaped ask. */
function mockProposesThenText(): LanguageModel {
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
                toolCallId: "propose-1",
                toolName: "mission_propose_plan",
                input: JSON.stringify(VALID_ROUTING_PLAN),
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
            { type: "text-delta", id: "t1", delta: "Setting up a mission." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  }) as unknown as LanguageModel;
}

test("grantMissionProposeForAuto grants mission.propose_plan for top-level auto AND mission sessions (v1-fixes F4)", () => {
  const base: HubToolGrants = { servers: {}, builtins: ["files.read"] };
  const auto = grantMissionProposeForAuto(base, { mode: "auto", kind: "chat" });
  assert.ok(auto.builtins?.includes(missionProposePlan.name), "auto/chat gets the mission-propose builtin");
  assert.ok(auto.builtins?.includes("files.read"), "the existing grants are preserved");

  // v1-fixes (F4) — a mission session's ordinary (post-mission) turns can also propose: the observed
  // failure was a terminal mission with NO path to a second one, so the model faked agents via tasks.
  const mission = grantMissionProposeForAuto(base, { mode: "mission", kind: "chat" });
  assert.ok(
    mission.builtins?.includes(missionProposePlan.name),
    "mission/chat gets the mission-propose builtin",
  );
  assert.equal(canAutoRouteMission({ mode: "mission", kind: "chat" }), true);

  // Idempotent — never doubled.
  const again = grantMissionProposeForAuto(auto, { mode: "auto", kind: "chat" });
  assert.equal(
    again.builtins?.filter((b) => b === missionProposePlan.name).length,
    1,
    "the mission-propose builtin is granted at most once",
  );

  // Every OTHER mode/kind is returned UNCHANGED (referentially identical) — no toolset shape moves.
  for (const session of [
    { mode: "chat", kind: "chat" },
    { mode: "research", kind: "chat" },
    { mode: "auto", kind: "agent" }, // an auto MISSION-AGENT child never proposes
    { mode: "mission", kind: "agent" }, // a mission-mode AGENT child never proposes either
  ] as const) {
    assert.equal(grantMissionProposeForAuto(base, session), base, `${session.mode}/${session.kind} unchanged`);
    assert.equal(canAutoRouteMission(session), false);
  }
  assert.equal(canAutoRouteMission({ mode: "auto", kind: "chat" }), true);
});

test("an auto routing turn that calls mission.propose_plan INVOKES the bridge with the ask (RC7)", async () => {
  const calls: Array<{ sessionId: string; text: string }> = [];
  const proposeMissionForTurn: HubProposeMissionForTurn = async ({ sessionId, text }) => {
    calls.push({ sessionId, text });
  };
  const { service, repo } = makeService({
    // Omit `resolveToolset` → the REAL resolver runs, so `mission.propose_plan` is actually granted for
    // the auto session (via grantMissionProposeForAuto) and callable by the mock model.
    resolveToolset: undefined as unknown as HubSessionServiceDeps["resolveToolset"],
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => mockProposesThenText() } }),
    proposeMissionForTurn,
  });

  const session = await service.createSession({ mode: "auto", model: "gpt-4o" });
  const outcome = await service.dispatchMessage(session.id, { text: "compare three servers" }, silentSink);
  assert.equal(outcome.kind, "ran");

  // The routing turn persisted the mission.propose_plan tool_call (translated back from the safe name)…
  assert.ok(
    repo.listEvents(session.id).some(
      (e) => e.type === "tool_call" && e.part.toolName === missionProposePlan.name,
    ),
    "the routing turn called mission.propose_plan",
  );
  // …and the bridge fired exactly once with THIS session + the user's ask.
  assert.equal(calls.length, 1, "the mission bridge was invoked once");
  assert.equal(calls[0]?.sessionId, session.id);
  assert.equal(calls[0]?.text, "compare three servers");
});

test("a TRIVIAL auto turn (no propose call) does NOT invoke the mission bridge", async () => {
  const calls: Array<{ sessionId: string }> = [];
  const { service, repo } = makeService({
    resolveToolset: undefined as unknown as HubSessionServiceDeps["resolveToolset"],
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("2 plus 2 is 4.") } }),
    proposeMissionForTurn: async ({ sessionId }) => {
      calls.push({ sessionId });
    },
  });

  const session = await service.createSession({ mode: "auto", model: "gpt-4o" });
  await service.dispatchMessage(session.id, { text: "what is 2+2?" }, silentSink);

  assert.equal(calls.length, 0, "no mission.propose_plan call ⇒ no proposal");
  assert.equal(
    repo.listEvents(session.id).some((e) => e.type === "plan_proposed"),
    false,
    "a trivial auto turn produces no mission",
  );
});

test("a CHAT session never grants mission.propose_plan and never routes a mission (pre-fix behavior unchanged)", async () => {
  const calls: Array<{ sessionId: string }> = [];
  const { service, repo } = makeService({
    resolveToolset: undefined as unknown as HubSessionServiceDeps["resolveToolset"],
    // Even if a chat model somehow emitted a propose call, the bridge only fires for auto sessions.
    resolveModel: resolverFor({ "gpt-4o": { kind: "openai", model: () => textModel("Hello.") } }),
    proposeMissionForTurn: async ({ sessionId }) => {
      calls.push({ sessionId });
    },
  });

  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  await service.dispatchMessage(session.id, { text: "hi" }, silentSink);

  assert.equal(calls.length, 0, "a chat session never invokes the mission bridge");
  assert.equal(
    repo.listEvents(session.id).some((e) => e.type === "plan_proposed"),
    false,
    "pre-fix chat replay is unaffected — no mission events appear",
  );
});
