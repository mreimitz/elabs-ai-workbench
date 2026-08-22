import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SKILLFLOW_ALIGNER_VERSION,
  SKILLFLOW_PROJECTOR_VERSION,
  sessionTraceSchema,
  traceAlignmentSchema,
  type SessionTrace,
  type SkillFileNode,
  type SkillGraph,
  type TraceAlignment,
  type TraceEvent,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { alignTrace } from "../src/skillflow/aligner.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");
const runsDir = path.join(here, "fixtures/skillflow/runs");

// --- Fixture loading (same conventions as skillflow-projector.test.ts / skillflow-contract.test.ts) ---

/** Classify a file path the way `SkillRepository` does (fixture inputs match the real store). */
function classifyKind(p: string): SkillFileNode["kind"] {
  if (p === "SKILL.md") return "skill_md";
  if (p.startsWith("scripts/")) return "script";
  if (p.startsWith("reference/") || p.startsWith("references/")) return "reference";
  if (p.startsWith("assets/")) return "asset";
  const lower = p.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "reference";
  return "other";
}

function walkFiles(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

function loadFixtureGraph(name: string): SkillGraph {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const files: SkillFileNode[] = paths.sort().map((p) => ({
    path: p,
    size: statSync(path.join(dir, p)).size,
    isBinary: false,
    isSkillMd: p === "SKILL.md",
    kind: classifyKind(p),
    tokenTotal: 0,
  }));
  return projectSkillGraph(readFileSync(path.join(dir, "SKILL.md"), "utf8"), files);
}

// --- run_steps fixture → TraceEvent[] adapter (reused from skillflow-contract.test.ts) -----------

type RunStepRow = {
  idx: number;
  type: string;
  label: string;
  status: string;
  tool_name: string | null;
  turn_index: number;
  payload_json: Record<string, unknown>;
};

/**
 * Map a fixture `run_steps`-shaped row onto the trace vocabulary — the contract-test adapter: the
 * fixture rows carry `exitCode` payloads which map to `script_result` (the SESSION-sourced signal,
 * WP 3.1); internal runs never produce `script_result` (WP 2.1 ground truth), which the dedicated
 * degradation tests below cover with `tool_result`-only streams.
 */
function toTraceEvent(row: RunStepRow): TraceEvent {
  const p = row.payload_json;
  switch (row.type) {
    case "user_message":
      return { type: "user_message", idx: row.idx, payload: { text: String(p.text ?? "") } };
    case "llm_response":
      return {
        type: "turn",
        idx: row.idx,
        payload: { role: "assistant", text: String(p.text ?? "") },
      };
    case "context_event":
      return { type: "marker", idx: row.idx, payload: { raw: String(p.note ?? row.label) } };
    case "tool_call":
      if (row.tool_name === "read_skill_file") {
        return {
          type: "skill_file_read",
          idx: row.idx,
          payload: { skill: String(p.skill), path: String(p.path) },
        };
      }
      return { type: "tool_call", idx: row.idx, payload: { tool: String(row.tool_name), args: p } };
    case "tool_result":
      if (typeof p.exitCode === "number") {
        return {
          type: "script_result",
          idx: row.idx,
          payload: {
            ...(p.script === undefined ? {} : { script: String(p.script) }),
            exitCode: p.exitCode,
          },
        };
      }
      return {
        type: "tool_result",
        idx: row.idx,
        payload: {
          ...(row.tool_name ? { tool: row.tool_name } : {}),
          status: row.status,
          ...(typeof p.bytes === "number" ? { bytes: p.bytes } : {}),
        },
      };
    default:
      throw new Error(`unmapped run_step type: ${row.type}`);
  }
}

const readRunEvents = (name: string): TraceEvent[] =>
  (JSON.parse(readFileSync(path.join(runsDir, name), "utf8")) as RunStepRow[]).map(toTraceEvent);

// --- Shared invariant checker (test 9 applied to every alignment the suite produces) -------------

/** Schema-validate an alignment and check every cited evidence idx exists in the input events. */
function assertValidAlignment(
  alignment: TraceAlignment,
  events: TraceEvent[],
  graph?: SkillGraph,
): void {
  assert.doesNotThrow(() => traceAlignmentSchema.parse(alignment), "alignment is schema-valid");
  const idxs = new Set(events.map((e) => e.idx));
  for (const verdict of alignment.verdicts) {
    for (const idx of verdict.evidence) {
      assert.ok(idxs.has(idx), `verdict evidence idx ${idx} exists in the input events`);
    }
  }
  for (const idx of alignment.unmatchedEvents) {
    assert.ok(idxs.has(idx), `unmatched idx ${idx} exists in the input events`);
  }
  assert.equal(alignment.projectorVersion, SKILLFLOW_PROJECTOR_VERSION);
  assert.equal(alignment.alignerVersion, SKILLFLOW_ALIGNER_VERSION);
  if (graph) {
    // Every graph node gets exactly one node-keyed verdict.
    const nodeVerdicts = alignment.verdicts
      .filter((v) => v.nodeId !== undefined)
      .map((v) => v.nodeId);
    assert.deepEqual(nodeVerdicts.sort(), graph.nodes.map((n) => n.id).sort());
    assert.equal(new Set(nodeVerdicts).size, nodeVerdicts.length, "one verdict per node");
  }
}

const verdictOf = (alignment: TraceAlignment, nodeId: string) =>
  alignment.verdicts.find((v) => v.nodeId === nodeId);

// --- (1) clean pass -------------------------------------------------------------------------------

test("clean run over the zero-annotation graph: gate + assets ok, no fractures, honest unmatched list", () => {
  const graph = loadFixtureGraph("zero-annotation");
  const events = readRunEvents("clean-run.steps.json");
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events, graph);

  // The validation gate passed (exit 0) and both assets were read.
  assert.equal(verdictOf(alignment, "gate-validate-py")?.status, "ok");
  assert.deepEqual(verdictOf(alignment, "gate-validate-py")?.evidence, [9]);
  assert.equal(verdictOf(alignment, "asset-format-spec-md")?.status, "ok");
  assert.equal(verdictOf(alignment, "asset-template-html")?.status, "ok");

  // Sections implied by their accessories; the gatekeeper implied by downstream visits.
  assert.equal(verdictOf(alignment, "validate-the-data")?.status, "ok");
  assert.equal(verdictOf(alignment, "generate-the-report")?.status, "ok");
  assert.equal(verdictOf(alignment, "gather-inputs")?.status, "ok");

  // No fracture verdicts anywhere on a clean run.
  assert.equal(alignment.verdicts.filter((v) => v.status === "fracture").length, 0);

  // Sections with no accessory evidence stay honestly unvisited (no direct section signal — D7).
  assert.equal(verdictOf(alignment, "data-report")?.status, "unvisited");
  assert.equal(verdictOf(alignment, "verify-the-output")?.status, "unvisited");
  assert.equal(verdictOf(alignment, "validate-the-data-loop")?.status, "unvisited");

  // Visit + traversal accounting.
  assert.deepEqual(alignment.nodeVisits, {
    "gather-inputs": 1,
    "validate-the-data": 1,
    "gate-validate-py": 1,
    "generate-the-report": 2,
    "asset-template-html": 1,
    "asset-format-spec-md": 1,
  });
  assert.equal(alignment.edgeTraversals["e-validate-the-data-gate-validate-py"], 1);
  assert.equal(alignment.edgeTraversals["e-generate-the-report-asset-template-html"], 1);
  assert.equal(alignment.edgeTraversals["e-generate-the-report-asset-format-spec-md"], 1);
  // RM-30 WP 7.8 — this fixture's "If the input is CSV … Otherwise if JSON …" is an INTRA-STEP rule,
  // not routing, so the tightened `extractConditions` no longer lifts it into two condition edges
  // pointing at the same successor (the "fork that does not fork"). "Gather inputs" is still a
  // gatekeeper by prose, and it now has exactly ONE plain `then` successor, which the gatekeeper
  // inference follows instead — so the section is still implied visited, over one edge, not two.
  assert.equal(alignment.edgeTraversals["e-gather-inputs-validate-the-data"], 1);
  assert.equal(alignment.edgeTraversals["e-gather-inputs-validate-the-data-2"], undefined);

  // Unmatched = exactly the genuinely unmatchable events (turns, user_message, tool plumbing, the
  // SKILL.md read — not an asset node — and the raw no-gateId marker). No silent drops.
  assert.deepEqual(alignment.unmatchedEvents, [0, 1, 2, 3, 4, 6, 7, 8, 10, 12, 13, 14]);
});

// --- (2) failed gate ------------------------------------------------------------------------------

test("fractured run: validation gate fractures with the exit code and the event idx as evidence", () => {
  const graph = loadFixtureGraph("zero-annotation");
  const events = readRunEvents("fractured-run.steps.json");
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events, graph);

  const gate = verdictOf(alignment, "gate-validate-py");
  assert.equal(gate?.status, "fracture");
  assert.ok(gate?.reason.includes("exited 1"), "reason carries the exit code");
  assert.ok(gate?.evidence.includes(9), "the script_result event idx is cited as evidence");
});

// --- (3) never-visited asset ----------------------------------------------------------------------

test("fractured run: the never-read template asset is 'unvisited'", () => {
  const graph = loadFixtureGraph("zero-annotation");
  const alignment = alignTrace(graph, readRunEvents("fractured-run.steps.json"));

  const template = verdictOf(alignment, "asset-template-html");
  assert.equal(template?.status, "unvisited");
  assert.deepEqual(template?.evidence, []);
  assert.equal(alignment.nodeVisits["asset-template-html"], undefined, "no visit recorded");
});

// --- (4) loop detection ---------------------------------------------------------------------------

test("fractured run: the 4x format-spec re-read fractures with the visit count in the reason", () => {
  const graph = loadFixtureGraph("zero-annotation");
  const events = readRunEvents("fractured-run.steps.json");
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events, graph);

  // The re-read asset itself (no loop guard attached to its section) carries the loop fracture.
  const spec = verdictOf(alignment, "asset-format-spec-md");
  assert.equal(spec?.status, "fracture");
  assert.ok(spec?.reason.includes("4 times"), "visit count is in the reason");
  assert.ok(spec?.reason.includes("loop threshold"), "names the loop threshold rule");
  assert.deepEqual(spec?.evidence, [5, 11, 14, 17], "all four reads cited");
  assert.equal(alignment.nodeVisits["asset-format-spec-md"], 4);

  // The section re-entered 4x fractures too (documented: derived section visits count for loops).
  assert.equal(verdictOf(alignment, "generate-the-report")?.status, "fracture");

  // A custom threshold above the count suppresses the loop fracture (option is honored).
  const relaxed = alignTrace(graph, events, { loopThreshold: 10 });
  assert.equal(verdictOf(relaxed, "asset-format-spec-md")?.status, "ok");
});

test("a loop_guard's maxIterations fires against its own section's visit count", () => {
  const graph = loadFixtureGraph("zero-annotation");
  // Four passing validations → the validate section is re-entered 4x, over the guard's maxIterations 3.
  const events: TraceEvent[] = [0, 1, 2, 3].map((i) => ({
    type: "script_result",
    idx: i,
    payload: { script: "scripts/validate.py", exitCode: 0 },
  }));
  const alignment = alignTrace(graph, events, { loopThreshold: 10 }); // generic rule silenced
  assertValidAlignment(alignment, events, graph);

  const guard = verdictOf(alignment, "validate-the-data-loop");
  assert.equal(guard?.status, "fracture");
  assert.ok(guard?.reason.includes("4 times"), "visit count in reason");
  assert.ok(guard?.reason.includes("maxIterations"), "names the guard rule");
});

// --- (5) marker match + mismatch ------------------------------------------------------------------

/** A minimal synthetic gatekeeper graph for the marker tests. */
function markerGraph(): SkillGraph {
  const anchor = { headingPath: ["Route"], startLine: 1, endLine: 4 };
  return {
    nodes: [
      { id: "route-input", kind: "gatekeeper", label: "Route input", source: "annotated", anchor },
      { id: "csv-path", kind: "subroutine", label: "CSV path", source: "inferred", anchor },
      { id: "json-path", kind: "subroutine", label: "JSON path", source: "inferred", anchor },
      {
        id: "a-notes",
        kind: "asset",
        label: "notes.md",
        source: "inferred",
        path: "reference/notes.md",
        fileKind: "reference",
        anchor,
      },
    ],
    edges: [
      { id: "r-csv", from: "route-input", to: "csv-path", condition: "input is CSV" },
      { id: "r-json", from: "route-input", to: "json-path", condition: "input is JSON" },
      { id: "e-csv-notes", from: "csv-path", to: "a-notes" },
    ],
    warnings: [],
  };
}

test("marker with matching gateId + routeId visits the gatekeeper and traverses the named edge", () => {
  const graph = markerGraph();
  const events: TraceEvent[] = [
    {
      type: "marker",
      idx: 0,
      payload: {
        raw: "skillflow:route-input route=r-csv",
        gateId: "route-input",
        routeId: "r-csv",
      },
    },
  ];
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events, graph);

  assert.equal(verdictOf(alignment, "route-input")?.status, "ok");
  assert.deepEqual(verdictOf(alignment, "route-input")?.evidence, [0]);
  assert.deepEqual(alignment.edgeTraversals, { "r-csv": 1 });
  assert.deepEqual(alignment.unmatchedEvents, [], "the marker matched — nothing unmatched");
});

test("marker routeId naming a non-existent edge fractures the gatekeeper with expected-vs-actual", () => {
  const graph = markerGraph();
  const events: TraceEvent[] = [
    {
      type: "marker",
      idx: 0,
      payload: {
        raw: "skillflow:route-input route=r-nope",
        gateId: "route-input",
        routeId: "r-nope",
      },
    },
  ];
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events, graph);

  const gk = verdictOf(alignment, "route-input");
  assert.equal(gk?.status, "fracture");
  assert.equal(gk?.edgeId, "r-nope", "the bogus route is named on edgeId");
  assert.ok(gk?.reason.includes("r-csv") && gk?.reason.includes("r-json"), "expected edges listed");
  assert.ok(gk?.reason.includes("r-nope"), "actual routeId in the reason");
  assert.deepEqual(gk?.evidence, [0]);
  assert.deepEqual(alignment.edgeTraversals, {}, "no edge traversed on a mismatch");
});

// --- (6) no-marker gatekeeper: conservative -------------------------------------------------------

test("gatekeeper without markers: implied by a visited branch, never fractured, silent when nothing implies it", () => {
  const graph = markerGraph();

  // Reading the CSV branch's asset implies exactly one branch → traverse it, gatekeeper ok.
  const csvRead: TraceEvent[] = [
    { type: "skill_file_read", idx: 0, payload: { skill: "s", path: "reference/notes.md" } },
  ];
  const implied = alignTrace(graph, csvRead);
  assertValidAlignment(implied, csvRead, graph);
  assert.equal(verdictOf(implied, "route-input")?.status, "ok");
  assert.ok(
    verdictOf(implied, "route-input")?.reason.includes("implied"),
    "reason documents the inference",
  );
  assert.equal(implied.edgeTraversals["r-csv"], 1, "only the implied branch is traversed");
  assert.equal(implied.edgeTraversals["r-json"], undefined);

  // No downstream evidence at all → the gatekeeper stays unvisited; no fracture is invented.
  const silent = alignTrace(graph, [
    { type: "turn", idx: 0, payload: { role: "assistant", text: "hello" } },
  ]);
  assert.equal(verdictOf(silent, "route-input")?.status, "unvisited");
  assert.equal(silent.verdicts.filter((v) => v.status === "fracture").length, 0);
});

// --- (7) determinism ------------------------------------------------------------------------------

test("alignment is deterministic: aligning twice yields deep-equal results", () => {
  const graph = loadFixtureGraph("zero-annotation");
  for (const fixture of ["clean-run.steps.json", "fractured-run.steps.json"]) {
    const events = readRunEvents(fixture);
    assert.deepEqual(alignTrace(graph, events), alignTrace(graph, events), fixture);
  }
});

// --- (8) internal-run degradation (no script_result) ----------------------------------------------

test("internal-run degradation: a tool error with NO deterministic link leaves the gate 'unvisited'", () => {
  const graph = loadFixtureGraph("zero-annotation");
  // What an internal run actually offers (WP 2.1): tool_call + tool_result status, no exit codes,
  // and nothing deterministically tying the failed Bash call to scripts/validate.py.
  const events: TraceEvent[] = [
    {
      type: "skill_file_read",
      idx: 0,
      payload: { skill: "data-report", path: "reference/format-spec.md" },
    },
    { type: "tool_call", idx: 1, payload: { tool: "Bash" } },
    { type: "tool_result", idx: 2, payload: { tool: "Bash", status: "error", bytes: 40 } },
  ];
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events, graph);

  const gate = verdictOf(alignment, "gate-validate-py");
  assert.equal(gate?.status, "unvisited", "no guessing — the honest-degradation case");
  assert.ok(gate?.reason.includes("not judged"));
  assert.ok(alignment.unmatchedEvents.includes(1) && alignment.unmatchedEvents.includes(2));
});

test("internal-run degradation: a tool error IS bound when a deterministic link exists", () => {
  const graph = loadFixtureGraph("zero-annotation");

  // Link (a): the gate's script itself was read earlier in the trace.
  const viaRead: TraceEvent[] = [
    {
      type: "skill_file_read",
      idx: 0,
      payload: { skill: "data-report", path: "scripts/validate.py" },
    },
    { type: "tool_call", idx: 1, payload: { tool: "Bash" } },
    { type: "tool_result", idx: 2, payload: { tool: "Bash", status: "error" } },
  ];
  const boundA = alignTrace(graph, viaRead);
  assertValidAlignment(boundA, viaRead, graph);
  assert.equal(verdictOf(boundA, "gate-validate-py")?.status, "fracture");
  assert.deepEqual(verdictOf(boundA, "gate-validate-py")?.evidence, [0, 1, 2]);

  // Link (b): the tool name literally contains the script's basename.
  const viaName: TraceEvent[] = [
    { type: "tool_call", idx: 0, payload: { tool: "run_validate.py" } },
    { type: "tool_result", idx: 1, payload: { tool: "run_validate.py", status: "error" } },
  ];
  const boundB = alignTrace(graph, viaName);
  assertValidAlignment(boundB, viaName, graph);
  assert.equal(verdictOf(boundB, "gate-validate-py")?.status, "fracture");
  assert.deepEqual(verdictOf(boundB, "gate-validate-py")?.evidence, [0, 1]);

  // An 'ok' tool result is never gate-pass evidence, even when linked (documented asymmetry).
  const okOnly: TraceEvent[] = [
    { type: "tool_call", idx: 0, payload: { tool: "run_validate.py" } },
    { type: "tool_result", idx: 1, payload: { tool: "run_validate.py", status: "ok" } },
  ];
  assert.equal(verdictOf(alignTrace(graph, okOnly), "gate-validate-py")?.status, "unvisited");
});

// --- (10) route: GET /api/skills/:id/versions/:vid/trace ------------------------------------------

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

const NOW = "2026-07-03T00:00:00.000Z";

/** Seed provider + scenario + test FK parents a `runs` row needs (the WP 2.1 harness). */
function seedParents(db: AppDatabase, scenarioId: string, testId: string): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', NULL, 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES (@id, 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ id: scenarioId, now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES (@id, 'Report', 'Generate the report.', '[]', @now, @now)`,
  ).run({ id: testId, now: NOW });
}

function seedRun(db: AppDatabase, runId: string, scenarioId: string, testId: string): void {
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES (@id, @testId, @scenarioId, 'automated', 'completed', @now)`,
  ).run({ id: runId, testId, scenarioId, now: NOW });
}

function seedStep(
  db: AppDatabase,
  runId: string,
  step: {
    idx: number;
    type: string;
    label: string;
    status?: string;
    toolName?: string;
    assistantText?: string;
    resultBytes?: number;
    payload?: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name, assistant_text, result_bytes, payload_json)
     VALUES (@id, @runId, @idx, @type, @label, @status, @toolName, @assistantText, @resultBytes, @payloadJson)`,
  ).run({
    id: `${runId}:step:${step.idx}`,
    runId,
    idx: step.idx,
    type: step.type,
    label: step.label,
    status: step.status ?? "ok",
    toolName: step.toolName ?? null,
    assistantText: step.assistantText ?? null,
    resultBytes: step.resultBytes ?? null,
    payloadJson: JSON.stringify(step.payload ?? {}),
  });
}

/** A Fastify app with ONLY the skillflow routes registered + the central-style error handler. */
async function makeRouteApp(
  skills: SkillRepository,
  runs: RunRepository,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillflowRoutes(app, skills, runs);
  apps.push(app);
  return app;
}

/** Seed the zero-annotation fixture skill (real files from disk) as a stored skill version. */
function seedFixtureSkill(skills: SkillRepository): { skillId: string; versionId: string } {
  const dir = path.join(skillsDir, "zero-annotation");
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const inputs: SkillFileInput[] = paths
    .sort()
    .map((p) => ({ path: p, bytes: readFileSync(path.join(dir, p)) }));
  const skill = skills.create({ name: "data-report", sourceType: "upload" });
  const created = skills.createVersion(skill.id, inputs, {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  return { skillId: skill.id, versionId: created.version.id };
}

/** Seed run steps in the REAL persisted shape (read_skill_file args nested; no exit codes). */
function seedInternalRunSteps(db: AppDatabase, runId: string): void {
  seedStep(db, runId, {
    idx: 0,
    type: "user_message",
    label: "User request",
    payload: { text: "Go." },
  });
  seedStep(db, runId, {
    idx: 1,
    type: "llm_response",
    label: "Plan",
    assistantText: "Reading the skill.",
  });
  seedStep(db, runId, {
    idx: 2,
    type: "tool_call",
    label: "read_skill_file",
    toolName: "read_skill_file",
    payload: { toolCallId: "c1", args: { skill: "data-report", path: "reference/format-spec.md" } },
  });
  seedStep(db, runId, {
    idx: 3,
    type: "tool_result",
    label: "format-spec.md contents",
    toolName: "read_skill_file",
    resultBytes: 320,
    payload: { toolCallId: "c1", result: { contents: "…" } },
  });
  seedStep(db, runId, {
    idx: 4,
    type: "tool_call",
    label: "Bash",
    toolName: "Bash",
    payload: { toolCallId: "c2", args: { command: "python3 scripts/validate.py input.csv" } },
  });
  // Internal-run reality: a failed tool result with NO structured exit code (WP 2.1 ground truth).
  seedStep(db, runId, {
    idx: 5,
    type: "tool_result",
    label: "validate.py result",
    status: "error",
    toolName: "Bash",
    resultBytes: 40,
    payload: { toolCallId: "c2", result: { isError: true } },
  });
  seedStep(db, runId, {
    idx: 6,
    type: "tool_call",
    label: "read_skill_file",
    toolName: "read_skill_file",
    payload: { toolCallId: "c3", args: { skill: "data-report", path: "assets/template.html" } },
  });
  seedStep(db, runId, {
    idx: 7,
    type: "tool_result",
    label: "template.html contents",
    toolName: "read_skill_file",
    resultBytes: 410,
    payload: { toolCallId: "c3", result: { contents: "…" } },
  });
  seedStep(db, runId, {
    idx: 8,
    type: "llm_response",
    label: "Done",
    assistantText: "Report complete.",
  });
}

test("GET …/versions/:vid/trace: 200 happy path returns a schema-valid SessionTrace; 409 on version mismatch", async () => {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 9));
  const skills = new SkillRepository(db, secrets);
  const runs = new RunRepository(db);

  const { skillId, versionId } = seedFixtureSkill(skills);
  // A second, different version of the same skill (the run did NOT run this one).
  const other = skills.createVersion(
    skillId,
    [
      {
        path: "SKILL.md",
        bytes: Buffer.from("# Data Report v2\n\n## Steps\n\nDo the thing.\n", "utf8"),
      },
    ],
    { sourceKind: "upload", importedFrom: "upload" },
  );

  seedParents(db, "scn-1", "test-1");
  seedRun(db, "run-1", "scn-1", "test-1");
  seedInternalRunSteps(db, "run-1");
  db.prepare(
    `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
     VALUES ('run-1', @skillId, @versionId, 'v1', 0)`,
  ).run({ skillId, versionId });

  const app = await makeRouteApp(skills, runs);

  // Happy path: the full aligned SessionTrace, schema-valid, both versions stamped.
  const ok = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/trace?runId=run-1`,
  });
  assert.equal(ok.statusCode, 200);
  const trace: SessionTrace = sessionTraceSchema.parse(ok.json());
  assert.equal(trace.source, "run");
  assert.equal(trace.ref, "run-1");
  assert.equal(trace.skillVersionId, versionId);
  assert.equal(trace.alignment.projectorVersion, SKILLFLOW_PROJECTOR_VERSION);
  assert.equal(trace.alignment.alignerVersion, SKILLFLOW_ALIGNER_VERSION);
  assertValidAlignment(trace.alignment, trace.events);

  // The internal run's deterministic signals landed: assets visited…
  const spec = trace.alignment.verdicts.find((v) => v.nodeId === "asset-format-spec-md");
  const template = trace.alignment.verdicts.find((v) => v.nodeId === "asset-template-html");
  assert.equal(spec?.status, "ok");
  assert.equal(template?.status, "ok");
  // …and the gate honestly degrades to 'unvisited' (no script_result, no deterministic tool link).
  const gate = trace.alignment.verdicts.find((v) => v.nodeId === "gate-validate-py");
  assert.equal(gate?.status, "unvisited");

  // 409: aligning against a version the run did not run is surfaced, not silently accepted.
  const mismatch = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${other.version.id}/trace?runId=run-1`,
  });
  assert.equal(mismatch.statusCode, 409);
  assert.ok(
    String((mismatch.json() as { error: string }).error).includes("did not run skill version"),
    "clear version-mismatch message",
  );

  // Missing runId → 400; unknown run → 404; unknown version → 404.
  const noRun = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/trace`,
  });
  assert.equal(noRun.statusCode, 400);
  const badRun = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/trace?runId=nope`,
  });
  assert.equal(badRun.statusCode, 404);
  const badVersion = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/not-a-version/trace?runId=run-1`,
  });
  assert.equal(badVersion.statusCode, 404);
});
