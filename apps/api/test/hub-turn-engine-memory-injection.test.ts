// Assistant Hub UX (planning/Roadmap/completed/RM-04-assistant-hub-ux/, WP2.0b, closes WP1.R-B, D-HUX11) — proves the turn
// engine injects the session's RESOLVED effective memory stack (WP1.5's `buildSessionEffectiveMemory`),
// not a flat-global read of every active memory row. Companion to `hub-turn-engine.test.ts` (mirrors its
// harness) and `hub-memory-scopes.test.ts` (which proves the resolver + the context-inspector's
// DISPLAY-side `effectiveMemory` field over a real DB) — this file proves the INJECTION side reads the
// SAME resolved stack, closing the gap WP1.R-B flagged: "the WP1.5 resolver feeds only the display, not
// injection."
//
// Four invariants proved:
//   1. no cross-session leak — a memory scoped to session A's project/crew/agent never reaches session
//      B's prompt when B belongs to a DIFFERENT (or no) project/crew/agent;
//   2. an old/profile-only DB (every legacy session, or any session before scoped-memory creation ships
//      in WP2.7) injects the SAME content the pre-WP2.0b flat-global read produced (byte-identical for
//      the realistic ≤1-entry-per-kind case; content-set parity — no loss/duplication — for the rarer
//      2+-same-kind case, where the resolver's documented canonical order legitimately reorders bullets
//      within a kind section — see the turn-engine.ts injection comment);
//   3. most-specific-wins is reflected in the ACTUAL injected text (the winner's exact wording appears,
//      the shadowed loser's does not);
//   4. the injected memory body is exactly `summarizeMemory` of the session's OWN
//      `buildSessionEffectiveMemory(...).entries` — display/injection parity.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubAgentRole, HubSession } from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModel } from "ai";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { hubCapabilitiesForKind } from "../src/hub/capabilities.js";
import { buildSessionEffectiveMemory } from "../src/hub/memory-resolver.js";
import { HubRepository } from "../src/hub/repository.js";
import {
  HubSteeringQueue,
  runHubTurn,
  summarizeMemory,
  type HubTurnInput,
  type HubTurnSink,
} from "../src/hub/turn-engine.js";

type MockStreamResult = Awaited<ReturnType<NonNullable<MockLanguageModelV3["doStream"]>>>;
type V3Part = MockStreamResult["stream"] extends ReadableStream<infer P> ? P : never;

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
} as const;

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function openRepo(): { repo: HubRepository; db: AppDatabase } {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return { repo: new HubRepository(db), db };
}

/** A `MockLanguageModelV3` that records the assembled SYSTEM prompt off `doStream`'s `prompt` — the
 *  same recording shape `hub-session-service.test.ts`'s memory tests use (WP3.2) — and answers "ok". */
function recordingModel(captured: { system?: string }): LanguageModel {
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

function baseInput(
  over: {
    session: HubSession;
    model: HubTurnInput["model"];
    sink: HubTurnSink;
    steering: HubSteeringQueue;
  } & Partial<HubTurnInput>,
): HubTurnInput {
  return {
    promptMode: "chat",
    providerKind: "openai",
    modelId: "gpt-4o",
    capabilities: hubCapabilitiesForKind("openai"),
    contextWindow: 128000,
    toolset: { tools: {} },
    abortSignal: new AbortController().signal,
    ...over,
  };
}

/** Persist the opener `user_message` (what the session-service does before a turn), run ONE turn on a
 *  recording model, and return the captured SYSTEM prompt text. */
async function runAndCapture(repo: HubRepository, session: HubSession, text: string): Promise<string> {
  repo.appendEvent(session.id, { type: "user_message", messageId: `u-${session.id}`, text });
  const fresh = repo.getSession(session.id);
  const captured: { system?: string } = {};
  const model = recordingModel(captured);
  const sink: HubTurnSink = { onEvent: () => {}, onDelta: () => {} };
  const steering = new HubSteeringQueue(session.id, repo);
  const result = await runHubTurn(
    { repository: repo },
    baseInput({ session: fresh, model, sink, steering }),
  );
  assert.equal(result.status, "completed", "the stubbed turn completes");
  return captured.system ?? "";
}

function makeRole(repo: HubRepository, name: string): HubAgentRole {
  return repo.createAgentRole({
    name,
    systemPrompt: "You do work.",
    defaultModel: "test-model",
    target: "the task",
    expectedOutcome: "a completed task",
  });
}

/** An `agent`-kind mission-child session whose role resolves (via its mission plan) to `role`. */
function makeAgentSession(repo: HubRepository, role: HubAgentRole): HubSession {
  const parent = repo.createSession({ mode: "mission", model: "test-model" });
  const mission = repo.createMission({
    sessionId: parent.id,
    topology: "parallel",
    autonomy: "auto",
    plan: {
      topology: "parallel",
      autonomy: "auto",
      agents: [
        {
          key: "a1",
          roleId: role.id,
          name: role.name,
          systemPrompt: "Do the work.",
          model: "test-model",
          toolGrants: { servers: {}, builtins: [] },
          skillIds: [],
          brief: "Do the work.",
          target: "the dataset",
          expectedOutcome: "a checked summary",
        },
      ],
    },
  });
  const child = repo.createSession({
    mode: "chat",
    model: "test-model",
    kind: "agent",
    parentSessionId: parent.id,
    missionId: mission.id,
  });
  repo.updateMission(mission.id, { agentSessionIds: [child.id] });
  return repo.getSession(child.id);
}

// ── (1) No cross-session leak ────────────────────────────────────────────────────────────────────────

test("no cross-session leak — a PROJECT-scoped memory reaches only sessions in ITS project", async () => {
  const { repo } = openRepo();
  const projectA = repo.createProject({ name: "Project A" });
  const projectB = repo.createProject({ name: "Project B" });
  repo.createMemory({
    kind: "instruction",
    content: "Project A secret directive.",
    scope: "project",
    scopeId: projectA.id,
  });
  repo.createMemory({
    kind: "instruction",
    content: "Project B secret directive.",
    scope: "project",
    scopeId: projectB.id,
  });
  repo.createMemory({ kind: "preference", content: "Global preference for everyone." });

  const sessionA = repo.createSession({ mode: "chat", model: "gpt-4o", projectId: projectA.id });
  const sessionB = repo.createSession({ mode: "chat", model: "gpt-4o", projectId: projectB.id });

  const systemA = await runAndCapture(repo, sessionA, "hi from A");
  const systemB = await runAndCapture(repo, sessionB, "hi from B");

  assert.match(systemA, /Project A secret directive\./);
  assert.doesNotMatch(
    systemA,
    /Project B secret directive\./,
    "session B's project memory must NOT leak into session A's prompt",
  );
  assert.match(systemB, /Project B secret directive\./);
  assert.doesNotMatch(
    systemB,
    /Project A secret directive\./,
    "session A's project memory must NOT leak into session B's prompt",
  );
  // Profile-scope memory is global by design — both see it.
  assert.match(systemA, /Global preference for everyone\./);
  assert.match(systemB, /Global preference for everyone\./);
});

test("no cross-session leak — a CREW-scoped memory reaches only sessions bound to ITS crew", async () => {
  const { repo } = openRepo();
  const crewAlpha = repo.createCrew({ name: "Alpha crew", topology: "parallel", members: [] });
  const crewBeta = repo.createCrew({ name: "Beta crew", topology: "parallel", members: [] });
  repo.createMemory({
    kind: "preference",
    content: "Alpha crew debates before answering.",
    scope: "crew",
    scopeId: crewAlpha.id,
  });
  repo.createMemory({
    kind: "preference",
    content: "Beta crew answers fast, no debate.",
    scope: "crew",
    scopeId: crewBeta.id,
  });

  const sessionAlpha = repo.createSession({ mode: "mission", model: "gpt-4o", crewId: crewAlpha.id });
  const sessionBeta = repo.createSession({ mode: "mission", model: "gpt-4o", crewId: crewBeta.id });

  const systemAlpha = await runAndCapture(repo, sessionAlpha, "hi alpha");
  const systemBeta = await runAndCapture(repo, sessionBeta, "hi beta");

  assert.match(systemAlpha, /Alpha crew debates before answering\./);
  assert.doesNotMatch(systemAlpha, /Beta crew answers fast, no debate\./);
  assert.match(systemBeta, /Beta crew answers fast, no debate\./);
  assert.doesNotMatch(systemBeta, /Alpha crew debates before answering\./);
});

test("no cross-session leak — an AGENT-scoped memory reaches only mission-children bound to ITS role", async () => {
  const { repo } = openRepo();
  const analyst = makeRole(repo, "Analyst");
  const writer = makeRole(repo, "Writer");
  repo.createMemory({
    kind: "instruction",
    content: "The Analyst always double-checks figures.",
    scope: "agent",
    scopeId: analyst.id,
  });
  repo.createMemory({
    kind: "instruction",
    content: "The Writer always uses active voice.",
    scope: "agent",
    scopeId: writer.id,
  });

  const analystSession = makeAgentSession(repo, analyst);
  const writerSession = makeAgentSession(repo, writer);

  const systemAnalyst = await runAndCapture(repo, analystSession, "hi analyst");
  const systemWriter = await runAndCapture(repo, writerSession, "hi writer");

  assert.match(systemAnalyst, /The Analyst always double-checks figures\./);
  assert.doesNotMatch(systemAnalyst, /The Writer always uses active voice\./);
  assert.match(systemWriter, /The Writer always uses active voice\./);
  assert.doesNotMatch(systemWriter, /The Analyst always double-checks figures\./);
});

test("no cross-session leak — a plain chat session (no project/crew) sees ONLY profile memory", async () => {
  const { repo } = openRepo();
  const project = repo.createProject({ name: "Some project" });
  const crew = repo.createCrew({ name: "Some crew", topology: "parallel", members: [] });
  repo.createMemory({
    kind: "instruction",
    content: "Only for the project.",
    scope: "project",
    scopeId: project.id,
  });
  repo.createMemory({ kind: "preference", content: "Only for the crew.", scope: "crew", scopeId: crew.id });
  repo.createMemory({ kind: "preference", content: "Everyone sees this." });

  const bareSession = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const system = await runAndCapture(repo, bareSession, "hi");

  assert.match(system, /Everyone sees this\./);
  assert.doesNotMatch(system, /Only for the project\./);
  assert.doesNotMatch(system, /Only for the crew\./);
});

// ── (2) Old / profile-only sessions unaffected ───────────────────────────────────────────────────────

test("a profile-only DB with ONE entry per kind injects the SAME content as the pre-WP2.0b flat-global read (regression-safe)", async () => {
  const { repo } = openRepo();
  repo.createMemory({ kind: "profile", content: "Name: Ada." });
  repo.createMemory({ kind: "preference", content: "Prefers concise answers." });
  repo.createMemory({ kind: "instruction", content: "Always cite sources." });

  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });

  // The EXACT pre-WP2.0b computation this WP replaced (`turn-engine.ts` used to call this directly).
  const oldStyleSummary = summarizeMemory(repo.listMemory({ status: "active" }));
  assert.ok(oldStyleSummary, "seeded memory produces a summary");

  const system = await runAndCapture(repo, session, "hi");

  assert.ok(
    system.includes(oldStyleSummary as string),
    "the injected prompt carries the EXACT pre-WP2.0b summarized text, byte-for-byte",
  );
});

test("a profile-only DB with MULTIPLE memories of the SAME kind: every statement still reaches the prompt exactly once (no leak, no loss, no duplication)", async () => {
  const { repo, db } = openRepo();
  const p1 = repo.createMemory({ kind: "preference", content: "Prefers metric units." });
  const p2 = repo.createMemory({ kind: "preference", content: "Prefers dark mode." });
  const p3 = repo.createMemory({ kind: "preference", content: "Prefers terse replies." });
  // Force distinct, deterministic timestamps — three `createMemory` calls in the same test tick can tie
  // on the millisecond, which would make this test non-deterministic without this.
  for (const [row, at] of [
    [p1, "2026-07-01T00:00:01.000Z"],
    [p2, "2026-07-01T00:00:02.000Z"],
    [p3, "2026-07-01T00:00:03.000Z"],
  ] as const) {
    db.prepare("UPDATE hub_memory SET created_at = ?, updated_at = ? WHERE id = ?").run(at, at, row.id);
  }

  const session = repo.createSession({ mode: "chat", model: "gpt-4o" });
  const system = await runAndCapture(repo, session, "hi");

  const statements = ["Prefers metric units.", "Prefers dark mode.", "Prefers terse replies."];
  for (const statement of statements) {
    assert.ok(system.includes(statement), `"${statement}" reaches the prompt`);
    assert.equal(
      system.split(statement).length - 1,
      1,
      `"${statement}" appears exactly once (no duplication)`,
    );
  }
  // NOTE: the resolver orders survivors by `createdAt` ASCENDING (its own documented, tested contract)
  // while the pre-WP2.0b flat read ordered by `updated_at DESC` — so the BULLET ORDER within this
  // same-kind section legitimately differs from the old behavior. That reorder is intentional (it makes
  // injection match the Context panel's canonical order, the whole point of this WP) — content parity,
  // proved above, is the invariant that actually matters and is preserved.
});

// ── (3) Most-specific-wins is reflected in the ACTUAL injected text ─────────────────────────────────

test("most-specific-wins is reflected in the injected text: the winner's wording appears, the shadowed loser's does not", async () => {
  const { repo } = openRepo();
  const project = repo.createProject({ name: "Winner Project" });
  repo.createMemory({ kind: "instruction", content: "Answer in English." }); // profile — shadowed
  repo.createMemory({
    kind: "instruction",
    content: "ANSWER IN ENGLISH.", // same normalized statement, more specific scope — wins
    scope: "project",
    scopeId: project.id,
  });

  const session = repo.createSession({ mode: "chat", model: "gpt-4o", projectId: project.id });
  const system = await runAndCapture(repo, session, "hi");

  assert.ok(system.includes("ANSWER IN ENGLISH."), "the more-specific (project) wording is injected");
  assert.ok(!system.includes("Answer in English."), "the shadowed profile wording is never injected");
});

// ── (4) Display/injection parity ─────────────────────────────────────────────────────────────────────

test("the injected memory body is EXACTLY summarizeMemory(buildSessionEffectiveMemory(...).entries) — display/injection parity", async () => {
  const { repo } = openRepo();
  const project = repo.createProject({ name: "Demo" });
  const crew = repo.createCrew({ name: "Alpha crew", topology: "parallel", members: [] });
  repo.createMemory({ kind: "preference", content: "Profile-level fact." });
  repo.createMemory({
    kind: "instruction",
    content: "Project-level directive.",
    scope: "project",
    scopeId: project.id,
  });
  repo.createMemory({ kind: "preference", content: "Crew-level habit.", scope: "crew", scopeId: crew.id });

  const session = repo.createSession({
    mode: "chat",
    model: "gpt-4o",
    projectId: project.id,
    crewId: crew.id,
  });

  // Compute the DISPLAY side exactly as the Context panel / `GET .../context` route does (WP1.5's
  // repository-backed builder) — entirely independent of the turn engine's own call.
  const displayStack = buildSessionEffectiveMemory(repo, session.id);
  assert.deepEqual(displayStack.order, ["profile", "project", "crew"]);
  assert.equal(displayStack.entries.length, 3, "all three non-conflicting facts survive");
  const expectedBody = summarizeMemory(displayStack.entries);
  assert.ok(expectedBody);

  const system = await runAndCapture(repo, session, "hi");

  assert.ok(
    system.includes(expectedBody as string),
    "the injected text is EXACTLY the display-side summarized body — nothing more, nothing less",
  );
});
