import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LOOP_THRESHOLD,
  SKILLFLOW_ALIGNER_VERSION,
  SKILLFLOW_ANNOTATION_PREFIX,
  SKILLFLOW_PROJECTOR_VERSION,
  SKILL_GRAPH_NODE_KINDS,
  TRACE_SOURCES,
  type SessionTrace,
  type SkillGraph,
  type TraceEvent,
  blankImportSchema,
  sessionTraceSchema,
  skillGraphResponseSchema,
  skillGraphSchema,
  skillImportSchema,
  traceEventSchema,
  traceVerdictSchema,
} from "@mcp-token-footprint/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.join(here, "fixtures/skillflow/runs");
const readRun = (name: string): RunStepRow[] =>
  JSON.parse(readFileSync(path.join(runsDir, name), "utf8")) as RunStepRow[];

// --- (1) Graph round-trip: a graph containing every node kind with anchors ---------------------

test("skillGraphSchema round-trips a graph with all node kinds and anchors", () => {
  const graph: SkillGraph = {
    nodes: [
      {
        id: "n_route",
        kind: "gatekeeper",
        label: "Route input by format",
        source: "inferred",
        anchor: { headingPath: ["Gather inputs"], startLine: 10, endLine: 18 },
      },
      {
        // Skill IDE WP 1.1 (I1) — the additive entry_point kind. Kept in the "all node kinds"
        // fixture so this test stays exhaustive over SKILL_GRAPH_NODE_KINDS as the union grows.
        id: "n_entry",
        kind: "entry_point",
        label: "/report",
        source: "inferred",
        trigger: { type: "command", value: "/report" },
        anchor: { headingPath: ["/report"], startLine: 4, endLine: 4 },
      },
      {
        id: "n_gather",
        kind: "subroutine",
        label: "Gather inputs",
        source: "inferred",
        anchor: { headingPath: ["Gather inputs"], startLine: 10, endLine: 24 },
      },
      {
        id: "n_template",
        kind: "asset",
        label: "template.html",
        source: "inferred",
        path: "assets/template.html",
        fileKind: "asset",
        anchor: { headingPath: ["Generate report"], startLine: 30, endLine: 30 },
      },
      {
        id: "n_validate",
        kind: "validation_gate",
        label: "Validate the input",
        source: "annotated",
        script: "scripts/validate.py",
        expectation: "exit code 0",
        anchor: { headingPath: ["Validate"], startLine: 40, endLine: 46 },
      },
      {
        id: "n_retry",
        kind: "loop_guard",
        label: "Retry until valid",
        source: "inferred",
        maxIterations: 3,
        anchor: { headingPath: ["Validate"], startLine: 47, endLine: 49 },
      },
      {
        // Skill IDE WP 8.1 (I9.2) — the additive tool_ref kind. Kept in the "all node kinds" fixture
        // so this test stays exhaustive over SKILL_GRAPH_NODE_KINDS as the union grows.
        id: "n_tool",
        kind: "tool_ref",
        label: "list_tables",
        source: "inferred",
        toolName: "list_tables",
        anchor: { headingPath: ["Gather inputs"], startLine: 12, endLine: 12 },
      },
    ],
    edges: [
      { id: "e1", from: "n_gather", to: "n_route" },
      { id: "e2", from: "n_route", to: "n_validate", condition: "input is CSV" },
      {
        id: "e3",
        from: "n_validate",
        to: "n_template",
        anchor: { headingPath: ["Generate report"], startLine: 30, endLine: 30 },
      },
    ],
    warnings: [],
  };

  const parsed = skillGraphSchema.parse(graph);
  assert.deepEqual(parsed, graph);

  // Every declared node kind is exercised by the fixture above.
  const kinds = new Set(parsed.nodes.map((n) => n.kind));
  for (const kind of SKILL_GRAPH_NODE_KINDS) {
    assert.ok(kinds.has(kind), `graph fixture is missing node kind ${kind}`);
  }

  // The graph response wrapper stamps the projector version.
  const response = skillGraphResponseSchema.parse({
    graph,
    projectorVersion: SKILLFLOW_PROJECTOR_VERSION,
  });
  assert.equal(response.projectorVersion, SKILLFLOW_PROJECTOR_VERSION);
});

test("skillGraphSchema rejects an unknown node kind", () => {
  const result = skillGraphSchema.safeParse({
    nodes: [
      {
        id: "n_bad",
        kind: "decision", // not one of SKILL_GRAPH_NODE_KINDS
        label: "Nope",
        source: "inferred",
        anchor: { headingPath: [], startLine: 1, endLine: 1 },
      },
    ],
    edges: [],
    warnings: [],
  });
  assert.equal(result.success, false);
});

// --- (2) Trace round-trip: a trace containing all eight event types ----------------------------

test("traceEventSchema round-trips all eight event types", () => {
  const events: TraceEvent[] = [
    { type: "user_message", idx: 0, payload: { text: "Generate the report." } },
    {
      type: "turn",
      idx: 1,
      at: "2026-07-03T10:00:00.000Z",
      payload: { role: "assistant", text: "Planning." },
    },
    {
      type: "tool_call",
      idx: 2,
      payload: { tool: "Bash", args: { command: "python3 scripts/validate.py" } },
    },
    { type: "tool_result", idx: 3, payload: { tool: "read_skill_file", status: "ok", bytes: 320 } },
    {
      type: "skill_file_read",
      idx: 4,
      payload: { skill: "data-report", path: "SKILL.md", bytes: 1450 },
    },
    { type: "script_result", idx: 5, payload: { script: "scripts/validate.py", exitCode: 0 } },
    { type: "subagent_spawn", idx: 6, payload: { label: "verifier", prompt: "Check the output." } },
    {
      type: "marker",
      idx: 7,
      payload: { raw: "skillflow:route input=csv", gateId: "route-input", routeId: "csv" },
    },
  ];

  for (const event of events) {
    assert.deepEqual(traceEventSchema.parse(event), event);
  }
  assert.equal(events.length, 8);
});

test("traceEventSchema rejects a negative idx", () => {
  const result = traceEventSchema.safeParse({
    type: "user_message",
    idx: -1,
    payload: { text: "bad" },
  });
  assert.equal(result.success, false);
});

// --- (3) Session-trace / alignment round-trip: all three verdict statuses ----------------------

test("sessionTraceSchema round-trips an alignment with all three verdict statuses + unmatched events", () => {
  const trace: SessionTrace = {
    source: "run",
    ref: "run_123",
    skillVersionId: "sv_1",
    events: [
      { type: "user_message", idx: 0, payload: { text: "Go." } },
      { type: "skill_file_read", idx: 1, payload: { skill: "data-report", path: "SKILL.md" } },
      { type: "script_result", idx: 2, payload: { script: "scripts/validate.py", exitCode: 1 } },
    ],
    alignment: {
      nodeVisits: { n_gather: 1, n_validate: 1 },
      edgeTraversals: { e1: 1 },
      verdicts: [
        { nodeId: "n_gather", status: "ok", reason: "Section reached.", evidence: [0] },
        {
          nodeId: "n_validate",
          status: "fracture",
          reason: "validate.py exited 1.",
          evidence: [2],
        },
        {
          edgeId: "e_report",
          status: "unvisited",
          reason: "Report never generated.",
          evidence: [],
        },
      ],
      unmatchedEvents: [1],
      projectorVersion: SKILLFLOW_PROJECTOR_VERSION,
      alignerVersion: SKILLFLOW_ALIGNER_VERSION,
    },
  };

  const parsed = sessionTraceSchema.parse(trace);
  assert.deepEqual(parsed, trace);

  const statuses = new Set(parsed.alignment.verdicts.map((v) => v.status));
  assert.deepEqual(statuses, new Set(["ok", "fracture", "unvisited"]));
});

test("traceVerdictSchema rejects a verdict with neither nodeId nor edgeId", () => {
  const result = traceVerdictSchema.safeParse({
    status: "ok",
    reason: "dangling",
    evidence: [],
  });
  assert.equal(result.success, false);

  // ...but accepts one keyed on either side.
  assert.equal(
    traceVerdictSchema.safeParse({ nodeId: "n1", status: "ok", reason: "" }).success,
    true,
  );
  assert.equal(
    traceVerdictSchema.safeParse({ edgeId: "e1", status: "ok", reason: "" }).success,
    true,
  );
});

// --- Blank-skill create body -------------------------------------------------------------------

test("skillImportSchema accepts the additive blank source without breaking upload/github", () => {
  const blank = skillImportSchema.parse({
    source: "blank",
    name: "my-skill",
    description: "Does a thing.",
  });
  assert.equal(blank.source, "blank");

  // The dedicated member validates the same shape.
  assert.equal(
    blankImportSchema.safeParse({ source: "blank", name: "x", description: "y" }).success,
    true,
  );
  // Existing members still validate through the extended union.
  assert.equal(skillImportSchema.safeParse({ source: "upload" }).success, true);
  assert.equal(
    skillImportSchema.safeParse({ source: "github", repoUrl: "https://github.com/o/r" }).success,
    true,
  );
  // A blank body missing its required description is rejected.
  assert.equal(skillImportSchema.safeParse({ source: "blank", name: "x" }).success, false);
});

test("TRACE_SOURCES is exactly the app's own test runs (owner decision 2026-07-03 removed session upload)", () => {
  // The external session-upload source ('session_upload') was removed — Trace Mode sources are ONLY
  // this app's own runs. sessionTraceSchema.source therefore accepts 'run' and rejects the old value.
  assert.deepEqual([...TRACE_SOURCES], ["run"]);
  assert.equal(sessionTraceSchema.shape.source.safeParse("run").success, true);
  assert.equal(sessionTraceSchema.shape.source.safeParse("session_upload").success, false);
});

// --- Fixture representability: run_steps → TraceEvent[] via a light adapter --------------------

type RunStepRow = {
  idx: number;
  type: string;
  label: string;
  status: string;
  tool_name: string | null;
  turn_index: number;
  payload_json: Record<string, unknown>;
};

// Map a persisted `run_steps`-shaped row onto the normalized trace-event vocabulary. This is the
// deliberately-light stand-in for the real Phase-2 normalizer — it exists only to prove the WP 1.0
// contract can REPRESENT the provisional fixture corpus (README: "Tests own the final mapping").
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
      // A script result carries an exit code; a skill-file read-back is a plain tool_result.
      if (typeof p.exitCode === "number") {
        return {
          type: "script_result",
          idx: row.idx,
          payload: {
            script: p.script === undefined ? undefined : String(p.script),
            exitCode: p.exitCode,
          },
        };
      }
      return {
        type: "tool_result",
        idx: row.idx,
        payload: {
          tool: row.tool_name ?? undefined,
          status: row.status,
          bytes: typeof p.bytes === "number" ? p.bytes : undefined,
        },
      };
    default:
      throw new Error(`unmapped run_step type: ${row.type}`);
  }
}

test("the clean run fixture maps into a schema-valid SessionTrace", () => {
  const events = readRun("clean-run.steps.json").map(toTraceEvent);
  // Each event validates individually...
  for (const event of events) {
    traceEventSchema.parse(event);
  }
  // ...and the whole thing composes into a valid SessionTrace.
  const trace = sessionTraceSchema.parse({
    source: "run",
    ref: "run_clean",
    skillVersionId: "sv_zero_annotation",
    events,
    alignment: {
      nodeVisits: {},
      edgeTraversals: {},
      verdicts: [],
      unmatchedEvents: [],
      projectorVersion: SKILLFLOW_PROJECTOR_VERSION,
      alignerVersion: SKILLFLOW_ALIGNER_VERSION,
    },
  });
  // The clean run has a passing validation gate (exit code 0).
  const script = trace.events.find((e) => e.type === "script_result");
  assert.ok(script && script.type === "script_result" && script.payload.exitCode === 0);
});

test("the fractured run fixture maps into a schema-valid SessionTrace with a failed gate", () => {
  const events = readRun("fractured-run.steps.json").map(toTraceEvent);
  const trace = sessionTraceSchema.parse({
    source: "run",
    ref: "run_fractured",
    skillVersionId: "sv_zero_annotation",
    events,
    alignment: {
      nodeVisits: {},
      edgeTraversals: {},
      verdicts: [],
      unmatchedEvents: [],
      projectorVersion: SKILLFLOW_PROJECTOR_VERSION,
      alignerVersion: SKILLFLOW_ALIGNER_VERSION,
    },
  });
  const script = trace.events.find((e) => e.type === "script_result");
  assert.ok(script && script.type === "script_result" && script.payload.exitCode === 1);
  // The format spec is re-read 4× (the loop-guard signal) — proving repeated skill_file_read events.
  const specReads = trace.events.filter(
    (e) => e.type === "skill_file_read" && e.payload.path === "reference/format-spec.md",
  );
  assert.equal(specReads.length, 4);
});

// --- Constants sanity -------------------------------------------------------------------------

test("SkillFlow constants carry the WP 1.0 defaults", () => {
  // Bumped -> 3 in Skill IDE WP 1.2: the projector emits per-command entry_point nodes + per-node
  // `flowId`s + `SkillGraph.flows` + keyword triggers (flow semantics change what a graph MEANS).
  // Bumped -> 4 in Skill IDE WP 8.1: the projector emits text-projected `tool_ref` accessory nodes
  // + `calls` edges (a skill citing no tool projects identically to v3 — regression-locked).
  // Bumped -> 5 in RM-30 WP 7.8: every edge carries a `kind` (the reading-order grammar), duplicate
  // file/tool boxes MERGE (one box per path / per tool name, so node IDS moved), and narrative prose
  // no longer becomes a branch label. All three change what a graph means and what its ids are.
  assert.equal(SKILLFLOW_PROJECTOR_VERSION, 5);
  // Bumped 1 -> 2 in WP 3.2: verdicts gained the additive `confidence` field (conventions.md's
  // version-stamp rule — a real change to what a TraceAlignment's verdicts mean, never silently
  // compared against pre-WP-3.2 alignments).
  assert.equal(SKILLFLOW_ALIGNER_VERSION, 2);
  assert.equal(SKILLFLOW_ANNOTATION_PREFIX, "skillflow:");
  assert.equal(DEFAULT_LOOP_THRESHOLD, 3);
});
