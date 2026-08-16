import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Database from "better-sqlite3";
import {
  SKILLFLOW_ALIGNER_VERSION,
  type SkillFileNode,
  type SkillGraph,
  type TraceAlignment,
  type TraceEvent,
} from "@mcp-token-footprint/shared";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { alignTrace } from "../src/skillflow/aligner.js";
import { extractMarkers } from "../src/skillflow/markers.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { traceFromRun } from "../src/skillflow/run-trace.js";
import { RunRepository } from "../src/testing/run-repository.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");
const runsDir = path.join(here, "fixtures/skillflow/runs");

// --- Fixture helpers (mirrors skillflow-aligner.test.ts / skillflow-projector.test.ts) ------------

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

type RunStepRow = {
  idx: number;
  type: string;
  label: string;
  status: string;
  tool_name: string | null;
  turn_index: number;
  payload_json: Record<string, unknown>;
};

/** Same run_steps-fixture -> TraceEvent adapter as skillflow-aligner.test.ts (script_result via exitCode). */
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

function assertValidAlignment(alignment: TraceAlignment, events: TraceEvent[]): void {
  const idxs = new Set(events.map((e) => e.idx));
  for (const verdict of alignment.verdicts) {
    for (const idx of verdict.evidence) assert.ok(idxs.has(idx), `evidence idx ${idx} exists`);
  }
  assert.equal(alignment.alignerVersion, SKILLFLOW_ALIGNER_VERSION);
}

const verdictOf = (alignment: TraceAlignment, nodeId: string) =>
  alignment.verdicts.find((v) => v.nodeId === nodeId);

// ── (1) extractMarkers — the shared matcher ────────────────────────────────────────────────────────

test("extractMarkers: basic gate+route marker parses both ids", () => {
  const { markers } = extractMarkers(
    "Deciding now. [skillflow:gate=route-input route=r-csv] onward.",
  );
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.raw, "[skillflow:gate=route-input route=r-csv]");
  assert.equal(markers[0]?.gateId, "route-input");
  assert.equal(markers[0]?.routeId, "r-csv");
});

test("extractMarkers: whitespace variants around '=' and inside the brackets tolerate parsing", () => {
  const { markers } = extractMarkers("[skillflow:  gate = route-input   route=r-csv ]");
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.gateId, "route-input");
  assert.equal(markers[0]?.routeId, "r-csv");
});

test("extractMarkers: gate-only marker (no route=) parses gateId with routeId undefined", () => {
  const { markers } = extractMarkers("[skillflow:gate=check-output]");
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.gateId, "check-output");
  assert.equal(markers[0]?.routeId, undefined);
});

test("extractMarkers: multiple markers in the same text all extract, in order", () => {
  const { markers } = extractMarkers(
    "First [skillflow:gate=a route=x] then later [skillflow:gate=b route=y] done.",
  );
  assert.equal(markers.length, 2);
  assert.deepEqual(
    markers.map((m) => m.gateId),
    ["a", "b"],
  );
  assert.deepEqual(
    markers.map((m) => m.routeId),
    ["x", "y"],
  );
});

test("extractMarkers: malformed / unknown-key content keeps the raw marker with no ids (never throws)", () => {
  const empty = extractMarkers("nothing to see [skillflow:] here");
  assert.equal(empty.markers.length, 1);
  assert.equal(empty.markers[0]?.raw, "[skillflow:]");
  assert.equal(empty.markers[0]?.gateId, undefined);
  assert.equal(empty.markers[0]?.routeId, undefined);

  const unknownKey = extractMarkers("[skillflow:foo=bar]");
  assert.equal(unknownKey.markers.length, 1);
  assert.equal(unknownKey.markers[0]?.gateId, undefined);
  assert.equal(unknownKey.markers[0]?.routeId, undefined);

  const noEquals = extractMarkers("[skillflow:gate]");
  assert.equal(noEquals.markers.length, 1);
  assert.equal(noEquals.markers[0]?.gateId, undefined);
});

test("extractMarkers: no bracket at all -> zero markers (plain prose is never mistaken for one)", () => {
  assert.deepEqual(
    extractMarkers("skillflow:gate=route-input route=r-csv (no brackets)").markers,
    [],
  );
  assert.deepEqual(extractMarkers("").markers, []);
});

// ── (2) run-trace.ts emits marker events, idx continues after the max step idx ────────────────────

const NOW = "2026-07-03T00:00:00.000Z";

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  return db;
}

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
    toolName?: string;
    assistantText?: string;
    payload?: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name, assistant_text, result_bytes, payload_json)
     VALUES (@id, @runId, @idx, @type, @label, 'ok', @toolName, @assistantText, NULL, @payloadJson)`,
  ).run({
    id: `${runId}:step:${step.idx}`,
    runId,
    idx: step.idx,
    type: step.type,
    label: step.label,
    toolName: step.toolName ?? null,
    assistantText: step.assistantText ?? null,
    payloadJson: JSON.stringify(step.payload ?? {}),
  });
}

test("traceFromRun: a breadcrumb in assistant_text becomes an ADDITIONAL marker event, idx after the max step idx", () => {
  const db = createDatabase();
  seedParents(db, "scn-1", "test-1");
  seedRun(db, "run-1", "scn-1", "test-1");
  seedStep(db, "run-1", { idx: 0, type: "user_message", label: "u", payload: { text: "Go." } });
  seedStep(db, "run-1", {
    idx: 1,
    type: "llm_response",
    label: "Routing",
    assistantText:
      "Checking the input. [skillflow:gate=route-input route=r-csv] Continuing with CSV.",
  });
  // idx 2 skipped in the mapping (context_event) — proves markers still land AFTER the true max (2), not just 1.
  seedStep(db, "run-1", {
    idx: 2,
    type: "context_event",
    label: "checkpoint",
    payload: { note: "x" },
  });
  seedStep(db, "run-1", {
    idx: 3,
    type: "llm_response",
    label: "Done",
    assistantText: "All done, no marker here.",
  });

  const runs = new RunRepository(db);
  const events = traceFromRun({ runs }, "run-1");

  // Base events: user_message(0), turn(1), turn(3) — context_event(2) is skipped as before.
  assert.deepEqual(
    events.filter((e) => e.type !== "marker").map((e) => e.idx),
    [0, 1, 3],
  );

  const markers = events.filter((e) => e.type === "marker");
  assert.equal(markers.length, 1, "exactly one breadcrumb across both llm_response steps");
  const marker = markers[0] as Extract<TraceEvent, { type: "marker" }>;
  assert.equal(marker.idx, 4, "continues after the highest idx already produced (3), not after 1");
  assert.equal(marker.payload.raw, "[skillflow:gate=route-input route=r-csv]");
  assert.equal(marker.payload.gateId, "route-input");
  assert.equal(marker.payload.routeId, "r-csv");

  // Every idx in the returned array is unique (no collision with a real run_steps.idx).
  const allIdxs = events.map((e) => e.idx);
  assert.equal(new Set(allIdxs).size, allIdxs.length, "idxs are unique across the returned events");
});

test("traceFromRun: multiple breadcrumbs across turns get sequential idxs in encounter order", () => {
  const db = createDatabase();
  seedParents(db, "scn-1", "test-1");
  seedRun(db, "run-1", "scn-1", "test-1");
  seedStep(db, "run-1", {
    idx: 0,
    type: "llm_response",
    label: "t1",
    assistantText: "First check. [skillflow:gate=a route=x] then [skillflow:gate=b route=y]",
  });
  seedStep(db, "run-1", {
    idx: 1,
    type: "llm_response",
    label: "t2",
    assistantText: "Second turn. [skillflow:gate=c]",
  });

  const runs = new RunRepository(db);
  const events = traceFromRun({ runs }, "run-1");
  const markers = events.filter((e) => e.type === "marker") as Array<
    Extract<TraceEvent, { type: "marker" }>
  >;
  assert.deepEqual(
    markers.map((m) => [m.idx, m.payload.gateId]),
    [
      [2, "a"],
      [3, "b"],
      [4, "c"],
    ],
  );
});

// ── (3) aligner: marker-backed exact match, mismatch fracture, confidence semantics ────────────────

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

test("aligner: a marker-backed gatekeeper visit + route traversal is confidence 'exact'", () => {
  const graph = markerGraph();
  const events: TraceEvent[] = [
    {
      type: "marker",
      idx: 0,
      payload: {
        raw: "[skillflow:gate=route-input route=r-csv]",
        gateId: "route-input",
        routeId: "r-csv",
      },
    },
  ];
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events);

  const verdict = verdictOf(alignment, "route-input");
  assert.equal(verdict?.status, "ok");
  assert.equal(verdict?.confidence, "exact", "backed by a marker event -> exact");
  assert.equal(alignment.edgeTraversals["r-csv"], 1);
});

test("aligner: a marker routeId mismatch fractures with expected-vs-actual AND is confidence 'exact'", () => {
  const graph = markerGraph();
  const events: TraceEvent[] = [
    {
      type: "marker",
      idx: 0,
      payload: {
        raw: "[skillflow:gate=route-input route=r-nope]",
        gateId: "route-input",
        routeId: "r-nope",
      },
    },
  ];
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events);

  const verdict = verdictOf(alignment, "route-input");
  assert.equal(verdict?.status, "fracture");
  assert.equal(verdict?.edgeId, "r-nope");
  assert.ok(
    verdict?.reason.includes("r-csv") && verdict?.reason.includes("r-json"),
    "expected routes listed",
  );
  assert.ok(verdict?.reason.includes("r-nope"), "actual (bogus) route named");
  // A marker route-mismatch fracture is STILL backed by the marker event itself — exact.
  assert.equal(
    verdict?.confidence,
    "exact",
    "the mismatch itself is deterministic marker evidence",
  );
});

test("aligner: a gatekeeper implied WITHOUT a marker (downstream asset visit only) is confidence 'inferred'", () => {
  const graph = markerGraph();
  // Reading the CSV branch's asset (a skill_file_read — no marker, no script_result anywhere in this
  // trace) implies exactly one branch, per the existing WP 2.2 conservative-inference rule.
  const events: TraceEvent[] = [
    { type: "skill_file_read", idx: 0, payload: { skill: "s", path: "reference/notes.md" } },
  ];
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events);

  const gk = verdictOf(alignment, "route-input");
  assert.equal(gk?.status, "ok");
  assert.ok(gk?.reason.includes("implied"));
  assert.equal(
    gk?.confidence,
    "inferred",
    "implied by a plain asset read — no hard evidence anywhere",
  );
});

test("aligner: a script_result-backed gate verdict is confidence 'exact' (hard evidence, not just markers)", () => {
  const graph = loadFixtureGraph("zero-annotation");
  const events = readRunEvents("clean-run.steps.json");
  const alignment = alignTrace(graph, events);
  assertValidAlignment(alignment, events);

  const gate = verdictOf(alignment, "gate-validate-py");
  assert.equal(gate?.status, "ok");
  assert.equal(gate?.confidence, "exact", "script_result evidence is deterministic hard evidence");
});

test("aligner: an internal run with NO script_result/marker anywhere (WP 2.1 ground truth) is 'inferred' for every verdict — the real zero-hard-evidence case", () => {
  const graph = loadFixtureGraph("zero-annotation");
  // What an internal run actually offers (no exit codes, no breadcrumbs) — reused from the WP 2.2
  // degradation fixture: skill_file_read + tool_call + a failed tool_result with no deterministic
  // link. Zero marker/script_result events anywhere in this trace.
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
  assertValidAlignment(alignment, events);

  assert.ok(alignment.verdicts.length > 0);
  for (const verdict of alignment.verdicts) {
    assert.equal(
      verdict.confidence,
      "inferred",
      `${verdict.nodeId ?? verdict.edgeId} should be 'inferred' — no marker/script_result exists in this trace at all`,
    );
  }
  // Same WP 2.2 status shape (no regression): the gate honestly degrades to unvisited.
  assert.equal(verdictOf(alignment, "gate-validate-py")?.status, "unvisited");
});

test("aligner: zero-annotation fixture runs keep the exact WP 2.2 status/reason shapes (confidence is purely additive)", () => {
  const graph = loadFixtureGraph("zero-annotation");

  const clean = alignTrace(graph, readRunEvents("clean-run.steps.json"));
  assert.equal(verdictOf(clean, "gate-validate-py")?.status, "ok");
  assert.equal(verdictOf(clean, "gate-validate-py")?.confidence, "exact", "script_result-backed");
  assert.equal(verdictOf(clean, "asset-format-spec-md")?.status, "ok");
  assert.equal(
    verdictOf(clean, "asset-format-spec-md")?.confidence,
    "inferred",
    "plain skill_file_read only",
  );
  assert.equal(verdictOf(clean, "asset-template-html")?.status, "ok");
  assert.equal(verdictOf(clean, "asset-template-html")?.confidence, "inferred");
  assert.equal(clean.verdicts.filter((v) => v.status === "fracture").length, 0);

  const fractured = alignTrace(graph, readRunEvents("fractured-run.steps.json"));
  const gate = verdictOf(fractured, "gate-validate-py");
  assert.equal(gate?.status, "fracture");
  assert.ok(gate?.reason.includes("exited 1"));
  assert.equal(gate?.confidence, "exact", "the fracture is script_result-backed too");
});

// ── (4) annotation id stability across a heading move ──────────────────────────────────────────────

const GATEKEEPER_SKILL_HEAD =
  "---\nname: route-demo\ndescription: A tiny fixture for id-stability.\n---\n\n# Route demo\n\n";

const GATEKEEPER_SECTION =
  "<!-- skillflow:gatekeeper id=route-input -->\n## Route the input\n\nIf the input is CSV, do X. Otherwise if JSON, do Y.\n\n";

const OTHER_SECTION = "## Other section\n\nSome unrelated prose that adds a second heading.\n\n";

test("annotations: a skillflow:gatekeeper id survives its section moving to a different position", () => {
  const before = GATEKEEPER_SKILL_HEAD + GATEKEEPER_SECTION + OTHER_SECTION;
  const after = GATEKEEPER_SKILL_HEAD + OTHER_SECTION + GATEKEEPER_SECTION;

  const graphBefore = projectSkillGraph(before, []);
  const graphAfter = projectSkillGraph(after, []);

  const gateBefore = graphBefore.nodes.find((n) => n.kind === "gatekeeper");
  const gateAfter = graphAfter.nodes.find((n) => n.kind === "gatekeeper");
  assert.ok(gateBefore && gateAfter, "both projections found a gatekeeper node");
  assert.equal(gateBefore?.id, "route-input");
  assert.equal(
    gateAfter?.id,
    "route-input",
    "the annotation-pinned id is unchanged by the section's reorder",
  );
  assert.equal(gateBefore?.source, "annotated");
  assert.equal(gateAfter?.source, "annotated");

  // The anchor DID move (proving this is a genuine reorder, not a no-op).
  assert.notEqual(gateBefore?.anchor.startLine, gateAfter?.anchor.startLine);
});
