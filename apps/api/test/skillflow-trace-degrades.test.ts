import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  sessionTraceSchema,
  type SessionTrace,
  type SkillGraph,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";
// The DETECTOR is web-side (it decides what the Trace tab paints); the alignment is api-side. This
// test imports both on purpose, because the coupling between them is the thing WP 7.8's spec §1.3
// says was read but never exercised. Importing a pure web module from an api test is the existing
// `skill-ide-explainers.test.ts` precedent.
import {
  describeTraceAlignmentDrift,
  detectTraceAlignmentDrift,
  hasTraceAlignmentDrift,
} from "../../web/src/features/skills/trace/trace-alignment-drift.js";

// ── RM-30 WP 7.8 §1.3 + decision 7 — THE COUPLING, ACTUALLY EXERCISED ────────────────────────────
//
// The design doc's author read the alignment code and did NOT run a trace against it, and the build
// spec says so out loud. This file runs one: real persisted `run_steps` rows in a real database, the
// real `GET …/trace?runId=` route (which normalizes, projects and aligns exactly as production
// does), and then the real drift detector over the SessionTrace the route returned.
//
// The scenario it reconstructs is the actual v4 → v5 break: before this work package the projector
// drew one asset box PER MENTION, so a file cited from two sections produced `asset-notes-md` and
// `asset-notes-md-2`. A run recorded then carries verdicts on BOTH ids. v5 merges them into one box,
// and the second id no longer exists.
//
// WHAT IS AND IS NOT PROVEN HERE, stated rather than implied: the `run_steps` rows are seeded, not
// produced by a live LLM run against a bound MCP server — no provider key exists in this environment.
// Everything DOWNSTREAM of those rows is the production path, unmocked: `traceFromRun`, `alignTrace`,
// the route, the detector, the message.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");
const NOW = "2026-08-22T09:00:00.000Z";

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

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

function walkFiles(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

async function makeRouteApp(
  skills: SkillRepository,
  runs: RunRepository,
): Promise<FastifyInstance> {
  const { registerSkillflowRoutes } = await import("../src/skillflow/routes.js");
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

function seedFixtureSkill(
  skills: SkillRepository,
  name: string,
): { skillId: string; versionId: string } {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const inputs: SkillFileInput[] = paths
    .sort()
    .map((p) => ({ path: p, bytes: readFileSync(path.join(dir, p)) }));
  const skill = skills.create({ name, sourceType: "upload" });
  const created = skills.createVersion(skill.id, inputs, {
    sourceKind: "upload",
    importedFrom: "upload",
  });
  return { skillId: skill.id, versionId: created.version.id };
}

/** A real run row with real `run_steps` — the agent reading two bundled files and running the check. */
function seedRealRun(db: AppDatabase, runId: string, skillId: string, versionId: string): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Test', 'enc:v1:fixture-placeholder-not-a-secret', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO scenarios (id, name, provider_id, model, params_json, system_prompt, default_profiles_json, guardrails_json, created_at, updated_at)
     VALUES ('scn-1', 'Baseline', 'prov-1', 'claude-sonnet-4', '{}', '', '[]', '{}', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO tests (id, name, user_prompt, added_profiles_json, created_at, updated_at)
     VALUES ('test-1', 'Report', 'Generate the report.', '[]', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at)
     VALUES (@id, 'test-1', 'scn-1', 'automated', 'completed', @now)`,
  ).run({ id: runId, now: NOW });
  db.prepare(
    `INSERT INTO run_skills (run_id, skill_id, skill_version_id, version_label, eager)
     VALUES (@runId, @skillId, @versionId, 'v1', 0)`,
  ).run({ runId, skillId, versionId });

  const steps: Array<{
    idx: number;
    type: string;
    label: string;
    toolName?: string;
    payload: unknown;
  }> = [
    { idx: 0, type: "user_message", label: "User request", payload: { text: "Generate it." } },
    {
      idx: 1,
      type: "tool_call",
      label: "read_skill_file",
      toolName: "read_skill_file",
      payload: { skill: "zero-annotation", path: "reference/format-spec.md" },
    },
    {
      idx: 2,
      type: "tool_call",
      label: "read_skill_file",
      toolName: "read_skill_file",
      payload: { skill: "zero-annotation", path: "assets/template.html" },
    },
    {
      idx: 3,
      type: "tool_result",
      label: "validate.py",
      toolName: "Bash",
      payload: { script: "scripts/validate.py", exitCode: 0 },
    },
  ];
  for (const step of steps) {
    db.prepare(
      `INSERT INTO run_steps (id, run_id, idx, type, label, status, tool_name, payload_json)
       VALUES (@id, @runId, @idx, @type, @label, 'ok', @toolName, @payloadJson)`,
    ).run({
      id: `${runId}:step:${step.idx}`,
      runId,
      idx: step.idx,
      type: step.type,
      label: step.label,
      toolName: step.toolName ?? null,
      payloadJson: JSON.stringify(step.payload),
    });
  }
}

/** Re-shape a v5 graph the way v4 drew it: one asset box PER MENTION, not per file. */
function asPreMergeGraph(graph: SkillGraph): SkillGraph {
  const asset = graph.nodes.find((node) => node.kind === "asset");
  assert.ok(asset, "the fixture projects at least one asset box to duplicate");
  return {
    ...graph,
    // The duplicate the OLD projector would have emitted for a second mention of the same file.
    nodes: [...graph.nodes, { ...asset, id: `${asset.id}-2` }],
    edges: [
      ...graph.edges,
      { id: `e-dup-${asset.id}`, from: "generate-the-report", to: `${asset.id}-2` },
    ],
  };
}

test("a REAL trace over REAL run_steps aligns against the v5 graph with no drift at all", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId, versionId } = seedFixtureSkill(skills, "zero-annotation");
  seedRealRun(db, "run-1", skillId, versionId);
  const app = await makeRouteApp(skills, runs);

  // The PRODUCTION route: it normalizes the persisted run_steps, projects the current graph, and
  // aligns them. Nothing here is stubbed.
  const response = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/trace?runId=run-1`,
  });
  assert.equal(response.statusCode, 200, response.body);
  const trace: SessionTrace = sessionTraceSchema.parse(response.json());

  // The alignment is real: the run read two bundled files, and the aligner attributed both.
  const verdicts = new Map(
    trace.alignment.verdicts.filter((v) => v.nodeId).map((v) => [v.nodeId as string, v.status]),
  );
  assert.equal(verdicts.get("asset-format-spec-md"), "ok", "the file the agent read is ok");
  assert.equal(verdicts.get("asset-template-html"), "ok");
  // …and the validation gate stays `unvisited`, which is the HONEST answer, not a gap in this test:
  // `run-trace.ts` deliberately does not invent exit codes from a `tool_result` ("there is no
  // reliable, structured exit-code field across MCP tools"), so an internal run offers a gate no hard
  // evidence. Pinned here so a future change that starts synthesising exit codes is a visible one.
  assert.equal(
    verdicts.get("gate-validate-py"),
    "unvisited",
    "an internal run carries no structured exit code, so the gate is honestly unvisited",
  );
  // The section the agent's reads DO imply is visited — the coupling under test still works.
  assert.equal(verdicts.get("generate-the-report"), "ok", "implied by its visited accessories");

  const graphResponse = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/graph`,
  });
  const { graph, projectorVersion } = graphResponse.json() as {
    graph: SkillGraph;
    projectorVersion: number;
  };

  const drift = detectTraceAlignmentDrift(graph, trace, projectorVersion);
  assert.equal(
    hasTraceAlignmentDrift(drift),
    false,
    "a trace aligned NOW against the graph NOW has nothing to warn about",
  );
  assert.equal(drift.unresolvedNodeVerdicts, 0);
  assert.equal(drift.unresolvedEdgeTraversals, 0);
  assert.ok(drift.totalNodeVerdicts > 0, "and the check was not vacuous — there were verdicts");
});

test("decision 7 EXERCISED: a v4-shaped replay degrades WITH A NOTICE, and the notice counts it", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId, versionId } = seedFixtureSkill(skills, "zero-annotation");
  seedRealRun(db, "run-1", skillId, versionId);
  const app = await makeRouteApp(skills, runs);

  const skillMd = skills.getFileContent(versionId, "SKILL.md").text as string;
  const v5Graph = projectSkillGraph(skillMd, skills.listFiles(versionId));

  // Align the SAME real run against the graph AS v4 DREW IT — one asset box per mention. This is the
  // shape a trace recorded before WP 7.8 was aligned against, and the extra box is exactly the id
  // that stopped existing when the merge landed.
  const { alignTrace } = await import("../src/skillflow/aligner.js");
  const { traceFromRun } = await import("../src/skillflow/run-trace.js");
  const preMerge = asPreMergeGraph(v5Graph);
  const events = traceFromRun({ runs }, "run-1");
  assert.ok(events.length > 0, "the persisted run really normalized into events");
  const oldAlignment = alignTrace(preMerge, events, { projectorVersion: 4 });

  const recordedTrace: SessionTrace = {
    source: "run",
    ref: "run-1",
    skillVersionId: versionId,
    events,
    alignment: oldAlignment,
  };

  // The duplicate box was genuinely visited by the real run (both mentions point at the same file),
  // so the old alignment carries a verdict on an id the v5 graph does not have. That is the loss.
  const drift = detectTraceAlignmentDrift(v5Graph, recordedTrace, 5);
  assert.equal(hasTraceAlignmentDrift(drift), true, "the drift is detected, not swallowed");
  assert.equal(drift.versionMismatch, true, "v4 alignment vs a v5 graph");
  assert.ok(
    drift.unresolvedNodeVerdicts >= 1,
    `at least the merged-away box no longer resolves (got ${drift.unresolvedNodeVerdicts})`,
  );
  assert.ok(drift.totalNodeVerdicts > drift.unresolvedNodeVerdicts, "most of it still lines up");

  // And the notice a reader sees says HOW MUCH, in plain language, and that nothing was altered.
  const notice = describeTraceAlignmentDrift(drift);
  assert.match(notice, /no longer has|no longer exist/);
  assert.match(notice, /Nothing recorded has been changed/);
  assert.match(
    notice,
    new RegExp(`${drift.unresolvedNodeVerdicts} of ${drift.totalNodeVerdicts}`),
    "the notice quotes the real numerator and denominator",
  );

  // The point of decision 7, asserted directly: the overlay is INCOMPLETE, never silently thinner.
  // Without a notice the reader would see fewer verdicts and conclude the run touched less.
  const resolvable = recordedTrace.alignment.verdicts.filter(
    (v) => v.nodeId && v5Graph.nodes.some((n) => n.id === v.nodeId),
  );
  assert.ok(
    resolvable.length < drift.totalNodeVerdicts,
    "the overlay really would paint fewer verdicts than the run recorded",
  );
});
