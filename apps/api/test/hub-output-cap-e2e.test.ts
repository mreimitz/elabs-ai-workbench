// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP3.4, R-MCP7) — the output-cap SPILL TARGET wired into the
// LIVE turn, end-to-end. WP0.5 already unit-tests `applyOutputCap` in isolation (`hub-tool-policy.test.ts`)
// and WP1.4 already unit-tests the SpillCard given a hand-fed `HubToolArtifact` (web); this file proves
// the missing middle: a REAL oversized MCP `tools/call` result, driven through `HubSessionService` +
// `runHubTurn` over a stubbed model + a stubbed MCP session (no provider, no child process), actually
// (a) hands the MODEL only a short pointer string (never the huge payload), (b) writes the full result
// to the session workspace, and (c) attaches a `HubToolArtifact{kind:"spill"}` to the settled
// `tool_result` event the web's `SpillCard`/`ProducedAssetTree` render from. A second test proves the
// same `toolArtifacts` wiring for a BUILT-IN (`files.write`) that returns a `workspace_file` artifact.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import {
  DEFAULT_TOKEN_PROFILE,
  type HubEvent,
  type HubToolArtifact,
} from "@mcp-token-footprint/shared";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { HubRepository } from "../src/hub/repository.js";
import { DEFAULT_CHAT_BUILTIN_NAMES } from "../src/hub/tools/index.js";
import { HubSessionService, type HubMcpGrantInputs } from "../src/hub/session-service.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-output-cap-e2e-"));
  tempDirs.push(dir);
  return dir;
}

const silentSink: HubTurnSink = { onEvent: () => undefined, onDelta: () => undefined };

function toolResultEvents(events: HubEvent[]) {
  return events.filter(
    (e): e is Extract<HubEvent, { type: "tool_result" }> => e.type === "tool_result",
  );
}

// ── (1) a real oversized MCP result gets capped + spilled + artifact-tagged ─────────────────────────

/** A stub MCP session whose `callTool` returns an OBVIOUSLY oversized result (well past any sane
 *  warn/cap threshold, even the config's own low test thresholds below). */
function stubOversizedSession(): McpSession {
  const bigPayload = {
    rows: Array.from({ length: 400 }, (_, i) => ({ id: i, note: "x".repeat(40) })),
  };
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ structuredContent: bigPayload }),
    close: async () => undefined,
  };
}

function stubMcpGrants(session: McpSession): HubMcpGrantInputs {
  return {
    grants: { servers: { "srv-1": "all" }, builtins: DEFAULT_CHAT_BUILTIN_NAMES },
    catalog: new Map([
      [
        "srv-1",
        {
          serverName: "Big data server",
          tools: [
            {
              name: "dump",
              description: "Dump a big table.",
              inputSchema: { type: "object", properties: {} },
              raw: {},
            },
          ],
        },
      ],
    ]),
    sessions: new Map([["srv-1", session]]),
    sink: { toolCall: () => undefined },
  };
}

function mockCallDumpThenAnswer(): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      call += 1;
      if (call === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "tool-call", toolCallId: "tc-1", toolName: "dump", input: "{}" },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
                usage: USAGE,
              },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Done." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

test("an oversized live MCP result is capped for the model and spills a workspace file + artifact onto the settled tool_result event", async () => {
  const repo = openRepo();
  const dataDir = tempDataDir();
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => mockCallDumpThenAnswer() as never,
    }),
    mcpGrantsProvider: () => stubMcpGrants(stubOversizedSession()),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir,
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
      // Deliberately tiny thresholds — the ~400-row stub payload above is WAY past either, so this
      // exercises the "capped" branch deterministically without depending on exact token counts.
      outputCapWarnTokens: 20,
      outputCapMaxTokens: 50,
    },
  });

  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  const approveSink: HubTurnSink = {
    onEvent: (e) => {
      if (e.type === "approval_requested" && !e.isAutomatic) {
        service.decideApproval(session.id, e.toolCallId, "allow-once");
      }
    },
    onDelta: () => undefined,
  };
  const outcome = await service.dispatchMessage(
    session.id,
    { text: "dump the table" },
    approveSink,
  );
  assert.equal(outcome.kind, "ran");

  const events = repo.listEvents(session.id);
  const [result] = toolResultEvents(events);
  assert.ok(result, "a tool_result event was persisted");
  assert.equal(result.state, "output-available");
  assert.equal(
    result.isError,
    undefined,
    "a capped result is NOT an error — it's a successful, smaller result",
  );

  // The MODEL only ever saw a short pointer string, never the ~400-row payload.
  assert.equal(typeof result.modelContent, "string");
  assert.match(result.modelContent as string, /spilled to the session workspace file/);
  assert.ok(
    (result.modelContent as string).length < 2000,
    "modelContent is the compact pointer, not the payload",
  );

  // The UI-visible artifact channel carries the spill reference (what SpillCard/ProducedAssetTree render).
  const artifact = result.artifact as HubToolArtifact;
  assert.equal(artifact?.kind, "spill");
  assert.ok(artifact.spillPath, "spillPath present");

  // The full result actually landed on disk at that path, under the session's OWN workspace.
  const spillFile = path.join(dataDir, "hub", "ws", session.id, artifact.spillPath as string);
  assert.ok(fs.existsSync(spillFile), "the spilled file exists in the session workspace");
  const spilled = JSON.parse(fs.readFileSync(spillFile, "utf8"));
  assert.equal(spilled.structuredContent.rows.length, 400, "the FULL result was preserved on disk");
});

// ── (2) a built-in's produced artifact (files.write) reaches the settled tool_result event ──────────

function mockWriteFileThenAnswer(): MockLanguageModelV3 {
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
                // The provider only ever sees the sanitized tool name (the turn engine re-keys the
                // dotted internal `files.write` to `files_write` at the model boundary — the P0 fix), so
                // a faithful model calls it back by that safe name; the engine restores `files.write`
                // in the persisted tool_call/tool_result events via `toInternalName`.
                type: "tool-call",
                toolCallId: "tc-1",
                toolName: "files_write",
                input: JSON.stringify({ path: "out/notes.md", content: "# Notes\n\nGenerated." }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_use" },
                usage: USAGE,
              },
            ] as V3Part[],
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: "Wrote it." },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
          ] as V3Part[],
        }),
      };
    },
  });
}

test("files.write's produced-file artifact reaches the settled tool_result event (ProducedAssetTree's data source)", async () => {
  const repo = openRepo();
  const dataDir = tempDataDir();
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveModel: () => ({
      providerKind: "openai",
      modelId: "gpt-4o",
      contextWindow: 128000,
      buildModel: () => mockWriteFileThenAnswer() as never,
    }),
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir,
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });

  const session = await service.createSession({ mode: "chat", model: "gpt-4o" });
  const outcome = await service.dispatchMessage(
    session.id,
    { text: "write a notes file" },
    silentSink,
  );
  assert.equal(outcome.kind, "ran");

  const [result] = toolResultEvents(repo.listEvents(session.id));
  assert.ok(result);
  assert.equal(result.state, "output-available");
  const artifact = result.artifact as HubToolArtifact;
  assert.equal(artifact?.kind, "workspace_file");
  assert.equal(artifact.spillPath, "out/notes.md");

  const written = fs.readFileSync(
    path.join(dataDir, "hub", "ws", session.id, "out/notes.md"),
    "utf8",
  );
  assert.equal(written, "# Notes\n\nGenerated.");
});
