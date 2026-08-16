import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { RunDetail, RunStep, Test, ToolHygieneFinding } from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import type { GradeContext } from "../src/grading/grader.js";
import { checkArgsAgainstSchema } from "../src/grading/schema-check.js";
import { ToolHygieneGrader } from "../src/grading/tool-hygiene.js";
import { ScanRepository } from "../src/scans/repository.js";

const NOW = "2026-07-04T00:00:00.000Z";
const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

// ── Fixture schemas ───────────────────────────────────────────────────────────────────────────────

const SEARCH_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string" },
    limit: { type: "integer" },
    mode: { type: "string", enum: ["fast", "slow"] },
  },
  required: ["query"],
  additionalProperties: false,
};
const FETCH_SCHEMA = {
  type: "object",
  properties: { url: { type: "string" } },
  required: ["url"],
};

// ── DB seeding — a server + its latest completed scan carrying tool inputSchemas ─────────────────────

function seedServer(db: AppDatabase, id: string, name: string): void {
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, created_at, updated_at)
     VALUES (@id, @name, 'stdio', @now, @now)`,
  ).run({ id, name, now: NOW });
}

function seedScan(
  db: AppDatabase,
  opts: {
    serverId: string;
    scanId: string;
    tools: Array<{ toolName: string; inputSchema: unknown }>;
  },
): void {
  db.prepare(
    `INSERT INTO mcp_scans (id, server_id, token_profile, scanned_at, status, total_tools, counting_version)
     VALUES (@id, @serverId, 'generic_o200k', @now, 'success', @n, 2)`,
  ).run({ id: opts.scanId, serverId: opts.serverId, now: NOW, n: opts.tools.length });
  const insert = db.prepare(
    `INSERT INTO mcp_tool_scans (
       id, scan_id, tool_name, input_schema_json, raw_tool_json,
       total_tokens, name_tokens, description_tokens, schema_tokens, annotations_tokens, raw_bytes, contribution_percent
     ) VALUES (@id, @scanId, @toolName, @schema, '{}', 0, 0, 0, 0, 0, 0, 0)`,
  );
  opts.tools.forEach((t, i) => {
    insert.run({
      id: `${opts.scanId}-t${i}`,
      scanId: opts.scanId,
      toolName: t.toolName,
      schema: JSON.stringify(t.inputSchema),
    });
  });
}

/** A server "srv-a" whose latest scan knows the `search` + `fetch` tools. */
function seedSrvA(db: AppDatabase): void {
  seedServer(db, "srv-a", "Server A");
  seedScan(db, {
    serverId: "srv-a",
    scanId: "scan-a",
    tools: [
      { toolName: "search", inputSchema: SEARCH_SCHEMA },
      { toolName: "fetch", inputSchema: FETCH_SCHEMA },
    ],
  });
}

// ── RunDetail / step fixture builders ────────────────────────────────────────────────────────────────

let stepSeq = 0;
function toolCall(opts: {
  toolName: string;
  args: unknown;
  serverId?: string;
  toolCallId?: string;
  index?: number;
}): RunStep {
  const index = opts.index ?? stepSeq++;
  return {
    id: `s${index}`,
    runId: "run-x",
    index,
    type: "tool_call",
    label: opts.toolName,
    status: "running",
    toolName: opts.toolName,
    ...(opts.serverId ? { serverId: opts.serverId } : {}),
    profileTokens: {},
    payload: { ...(opts.toolCallId ? { toolCallId: opts.toolCallId } : {}), args: opts.args },
  };
}

/** The MCP-sink duplicate `tool_call` step: carries serverId + status, NO args (correlated by toolCallId). */
function mcpSink(opts: {
  toolName: string;
  serverId: string;
  toolCallId: string;
  error?: boolean;
  index?: number;
}): RunStep {
  const index = opts.index ?? stepSeq++;
  return {
    id: `s${index}`,
    runId: "run-x",
    index,
    type: "tool_call",
    label: opts.toolName,
    status: opts.error ? "error" : "ok",
    serverId: opts.serverId,
    toolName: opts.toolName,
    profileTokens: {},
    payload: { toolCallId: opts.toolCallId, isError: opts.error === true },
  };
}

function toolResult(opts: {
  toolName: string;
  error?: boolean;
  toolCallId?: string;
  index?: number;
}): RunStep {
  const index = opts.index ?? stepSeq++;
  return {
    id: `s${index}`,
    runId: "run-x",
    index,
    type: "tool_result",
    label: opts.toolName,
    status: opts.error ? "error" : "ok",
    toolName: opts.toolName,
    profileTokens: {},
    payload: {
      ...(opts.toolCallId ? { toolCallId: opts.toolCallId } : {}),
      result: opts.error ? { isError: true } : "ok",
    },
  };
}

function llmResponse(text: string, index?: number): RunStep {
  const idx = index ?? stepSeq++;
  return {
    id: `s${idx}`,
    runId: "run-x",
    index: idx,
    type: "llm_response",
    label: "answer",
    status: "ok",
    assistantText: text,
    profileTokens: {},
    payload: null,
  };
}

function makeCtx(steps: RunStep[]): GradeContext {
  const run = { id: "run-x", steps, events: [], skills: [] } as unknown as RunDetail;
  return { run, test: {} as Test, finalAssistantText: "" };
}

function grader(db: AppDatabase): ToolHygieneGrader {
  return new ToolHygieneGrader(new ScanRepository(db));
}

function evidence(result: { evidence?: unknown }): ToolHygieneFinding[] {
  return (result.evidence as ToolHygieneFinding[]) ?? [];
}
function has(findings: ToolHygieneFinding[], checkId: string, stepIdx: number): boolean {
  return findings.some((f) => f.checkId === checkId && f.stepIdx === stepIdx);
}

// ── (0) schema-check subset validator — direct unit coverage ─────────────────────────────────────────

test("schema-check: clean args produce no violations; each violation kind is detected", () => {
  assert.deepEqual(
    checkArgsAgainstSchema(SEARCH_SCHEMA, { query: "x", limit: 5, mode: "fast" }),
    [],
  );

  const missing = checkArgsAgainstSchema(SEARCH_SCHEMA, { limit: 5 });
  assert.equal(
    missing.filter((v) => v.checkId === "missing-required" && v.property === "query").length,
    1,
  );

  const wrong = checkArgsAgainstSchema(SEARCH_SCHEMA, { query: 123 });
  assert.equal(wrong.filter((v) => v.checkId === "wrong-type" && v.property === "query").length, 1);

  const unknown = checkArgsAgainstSchema(SEARCH_SCHEMA, { query: "x", extra: "y" });
  assert.equal(
    unknown.filter((v) => v.checkId === "unknown-property" && v.property === "extra").length,
    1,
  );

  const badEnum = checkArgsAgainstSchema(SEARCH_SCHEMA, { query: "x", mode: "medium" });
  assert.equal(
    badEnum.filter((v) => v.checkId === "enum-violation" && v.property === "mode").length,
    1,
  );

  // integer arg satisfies an `integer` schema; a non-integer does not.
  assert.deepEqual(checkArgsAgainstSchema(SEARCH_SCHEMA, { query: "x", limit: 3 }), []);
  assert.equal(
    checkArgsAgainstSchema(SEARCH_SCHEMA, { query: "x", limit: 3.5 })[0]?.checkId,
    "wrong-type",
  );

  // An open schema (no additionalProperties:false) tolerates extra keys.
  assert.deepEqual(checkArgsAgainstSchema(FETCH_SCHEMA, { url: "u", extra: 1 }), []);
  // A non-object / absent schema abstains.
  assert.deepEqual(checkArgsAgainstSchema(undefined, { anything: true }), []);
});

// ── (1) Clean run scores 1.0 ──────────────────────────────────────────────────────────────────────

test("clean run: valid args, tools in scan, no repeats/errors → graded 1.0", () => {
  const db = createDatabase();
  seedSrvA(db);
  const result = grader(db).grade(
    makeCtx([
      toolCall({
        toolName: "search",
        args: { query: "hi", limit: 5, mode: "fast" },
        serverId: "srv-a",
        toolCallId: "c1",
        index: 0,
      }),
      toolResult({ toolName: "search", toolCallId: "c1", index: 1 }),
      toolCall({
        toolName: "fetch",
        args: { url: "http://x" },
        serverId: "srv-a",
        toolCallId: "c2",
        index: 2,
      }),
      toolResult({ toolName: "fetch", toolCallId: "c2", index: 3 }),
      llmResponse("done", 4),
    ]),
  );
  assert.equal(result.status, "graded");
  assert.equal(result.score, 1);
  assert.equal(result.method, "tool_hygiene_v1");
  assert.deepEqual(evidence(result), []);
});

// ── (2) Each check fires ────────────────────────────────────────────────────────────────────────────

test("check missing-required fires at the call step, score < 1", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(
    makeCtx([
      toolCall({ toolName: "search", args: { limit: 5 }, serverId: "srv-a", index: 0 }),
      toolResult({ toolName: "search", index: 1 }),
    ]),
  );
  assert.equal(r.status, "graded");
  assert.ok(has(evidence(r), "missing-required", 0));
  assert.ok((r.score as number) < 1);
});

test("check wrong-type fires", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(
    makeCtx([toolCall({ toolName: "search", args: { query: 123 }, serverId: "srv-a", index: 0 })]),
  );
  assert.ok(has(evidence(r), "wrong-type", 0));
  assert.ok((r.score as number) < 1);
});

test("check unknown-property fires (additionalProperties:false)", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(
    makeCtx([
      toolCall({
        toolName: "search",
        args: { query: "x", extra: "y" },
        serverId: "srv-a",
        index: 0,
      }),
    ]),
  );
  assert.ok(has(evidence(r), "unknown-property", 0));
  assert.ok((r.score as number) < 1);
});

test("check enum-violation fires", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(
    makeCtx([
      toolCall({
        toolName: "search",
        args: { query: "x", mode: "medium" },
        serverId: "srv-a",
        index: 0,
      }),
    ]),
  );
  assert.ok(has(evidence(r), "enum-violation", 0));
  assert.ok((r.score as number) < 1);
});

test("check tool-not-in-scan fires for a called tool absent from the scan", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(
    makeCtx([toolCall({ toolName: "ghost", args: {}, serverId: "srv-a", index: 0 })]),
  );
  assert.equal(r.status, "graded"); // a scan existed, so the call was checkable
  assert.ok(has(evidence(r), "tool-not-in-scan", 0));
  assert.ok((r.score as number) < 1);
});

test("check tool-error-rate fires when >50% of tool_result steps error", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(
    makeCtx([
      toolCall({ toolName: "search", args: { query: "x" }, serverId: "srv-a", index: 0 }),
      toolResult({ toolName: "search", error: true, index: 1 }),
      toolCall({ toolName: "fetch", args: { url: "u" }, serverId: "srv-a", index: 2 }),
      toolResult({ toolName: "fetch", error: true, index: 3 }),
    ]),
  );
  assert.equal(r.status, "graded");
  assert.ok(has(evidence(r), "tool-error-rate", 1)); // anchored on the first error result step
  assert.ok((r.score as number) < 1);
});

test("check identical-repeat fires on the repeated call", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(
    makeCtx([
      toolCall({ toolName: "search", args: { query: "x" }, serverId: "srv-a", index: 0 }),
      toolResult({ toolName: "search", index: 1 }),
      toolCall({ toolName: "search", args: { query: "x" }, serverId: "srv-a", index: 2 }),
      toolResult({ toolName: "search", index: 3 }),
    ]),
  );
  assert.ok(has(evidence(r), "identical-repeat", 2)); // second (repeat) occurrence
  assert.ok((r.score as number) < 1);
});

test("check error-then-retry fires when an errored call is retried with identical args", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(
    makeCtx([
      toolCall({
        toolName: "search",
        args: { query: "x" },
        serverId: "srv-a",
        toolCallId: "c1",
        index: 0,
      }),
      toolResult({ toolName: "search", error: true, toolCallId: "c1", index: 1 }),
      toolCall({
        toolName: "search",
        args: { query: "x" },
        serverId: "srv-a",
        toolCallId: "c2",
        index: 2,
      }),
      toolResult({ toolName: "search", toolCallId: "c2", index: 3 }),
    ]),
  );
  assert.ok(has(evidence(r), "error-then-retry", 2)); // the retry call step
  assert.ok((r.score as number) < 1);
});

// ── (2b) Split-step reality: serverId on the MCP-sink step, args on the engine step ─────────────────

test("split steps: serverId is correlated from the MCP-sink step by toolCallId", () => {
  const db = createDatabase();
  seedSrvA(db);
  // Engine tool_call has args but NO serverId; the MCP-sink tool_call has serverId but no args.
  const r = grader(db).grade(
    makeCtx([
      toolCall({ toolName: "search", args: { query: "x" }, toolCallId: "c1", index: 0 }), // no serverId
      mcpSink({ toolName: "search", serverId: "srv-a", toolCallId: "c1", index: 1 }),
      toolResult({ toolName: "search", toolCallId: "c1", index: 2 }),
    ]),
  );
  assert.equal(r.status, "graded", "serverId resolved via correlation → the call was checkable");
  assert.equal(r.score, 1, "valid args, tool present → clean");
});

// ── (3) Determinism ─────────────────────────────────────────────────────────────────────────────────

test("determinism: same input → identical result twice", () => {
  const db = createDatabase();
  seedSrvA(db);
  const steps = [
    toolCall({
      toolName: "search",
      args: { query: 123, extra: "y" },
      serverId: "srv-a",
      toolCallId: "c1",
      index: 0,
    }),
    toolResult({ toolName: "search", error: true, toolCallId: "c1", index: 1 }),
    toolCall({
      toolName: "search",
      args: { query: 123, extra: "y" },
      serverId: "srv-a",
      toolCallId: "c2",
      index: 2,
    }),
    toolResult({ toolName: "search", error: true, toolCallId: "c2", index: 3 }),
  ];
  const g = grader(db);
  const a = g.grade(makeCtx(steps));
  const b = g.grade(makeCtx(steps));
  assert.deepEqual(a, b);
});

// ── (4) Unevaluable, never 0 ────────────────────────────────────────────────────────────────────────

test("no tool calls → unevaluable (score null, never 0)", () => {
  const db = createDatabase();
  seedSrvA(db);
  const r = grader(db).grade(makeCtx([llmResponse("just prose, no tools", 0)]));
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.notStrictEqual(r.score, 0);
});

test("no scan for the server → schema checks don't fire; nothing checkable → unevaluable (never 0)", () => {
  const db = createDatabase();
  seedServer(db, "srv-none", "No Scan Server"); // server exists but has NO completed scan
  const r = grader(db).grade(
    makeCtx([
      // Args are invalid (missing required `query`), but with no scan the schema check must NOT fire.
      toolCall({ toolName: "search", args: { limit: 5 }, serverId: "srv-none", index: 0 }),
      toolResult({ toolName: "search", index: 1 }),
    ]),
  );
  assert.equal(r.status, "unevaluable");
  assert.strictEqual(r.score, null);
  assert.notStrictEqual(r.score, 0);
  assert.equal(evidence(r).length, 0, "no schema violations were counted");
});

// ── (5) Never-execute — static import assertion on the grader sources ────────────────────────────────

test("never-execute: tool-hygiene.ts + schema-check.ts import no MCP/session/tool-bridge/child_process", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const gradingDir = path.resolve(here, "../src/grading");
  const forbidden = [
    /openSession/,
    /from ["'][^"']*mcp\//,
    /tool-bridge/,
    /callTool/,
    /child_process/,
  ];
  for (const file of ["tool-hygiene.ts", "schema-check.ts"]) {
    const source = fs.readFileSync(path.join(gradingDir, file), "utf8");
    for (const pattern of forbidden) {
      assert.ok(
        !pattern.test(source),
        `${file} must not reference ${pattern} (the grader never executes anything)`,
      );
    }
  }
});
