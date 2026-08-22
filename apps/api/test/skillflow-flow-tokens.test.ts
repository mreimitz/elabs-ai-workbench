import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  isSectionKind,
  reachFromEntry,
  SKILLFLOW_PROJECTOR_VERSION,
  skillFlowTokensResponseSchema,
  type SkillFileNode,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { computeFlowNodeCosts } from "../src/skillflow/flow-tokens.js";
import { projectSkillGraph } from "../src/skillflow/projector.js";
import { countLevels, type SkillFootprintFile } from "../src/skills/footprint.js";
import { parseSkillManifest } from "../src/skills/manifest.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

// RM-30 WP 7.8 — the token figure behind the entry-point flow view. The number is the deliverable of
// the work package, so this file pins WHERE each number comes from: a section's own SKILL.md span
// counted with the version's own profile, and a bundled file's ALREADY-PERSISTED footprint total. No
// second counter, and an unmeasurable box is OMITTED rather than reported as free.

const here = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.join(here, "fixtures/skillflow/skills");

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

/**
 * Seed a fixture skill THE WAY PRODUCTION DOES — computing `countLevels` and handing it to
 * `createVersion` as the version's footprint, exactly as `ingest-service.ts` / `git-service.ts` /
 * the edits route all do. That matters here specifically: without the footprint, every
 * `skill_files.token_total` persists as 0, and the route would report a bundled file as free.
 */
async function seedFixtureSkill(
  skills: SkillRepository,
  name: string,
): Promise<{ skillId: string; versionId: string }> {
  const dir = path.join(skillsDir, name);
  const paths: string[] = [];
  walkFiles(dir, dir, paths);
  const inputs: SkillFileInput[] = paths
    .sort()
    .map((p) => ({ path: p, bytes: readFileSync(path.join(dir, p)) }));

  const skillMd = inputs.find((input) => input.path === "SKILL.md")?.bytes.toString("utf8") ?? "";
  const parsed = parseSkillManifest(skillMd);
  const footprintFiles: SkillFootprintFile[] = inputs.map((input) => ({
    path: input.path,
    isBinary: false,
    text: input.bytes.toString("utf8"),
  }));
  const levels = await countLevels(footprintFiles, parsed.manifest, parsed.body);

  const skill = skills.create({ name, sourceType: "upload" });
  const created = skills.createVersion(skill.id, inputs, {
    sourceKind: "upload",
    importedFrom: "upload",
    tokenProfile: levels.tokenProfile,
    footprint: {
      l1: levels.l1,
      l2: levels.l2,
      l3: levels.l3,
      total: levels.total,
      byPath: new Map(levels.files.map((file) => [file.path, file.tokenTotal] as const)),
    },
  });
  return { skillId: skill.id, versionId: created.version.id };
}

test("GET …/versions/:vid/flow-tokens: a section's cost is its OWN span, counted with the app's one counter", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId, versionId } = await seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);

  const response = await app.inject({
    method: "GET",
    url: `/api/skills/${skillId}/versions/${versionId}/flow-tokens`,
  });
  assert.equal(response.statusCode, 200, response.body);
  const report = skillFlowTokensResponseSchema.parse(response.json());
  assert.equal(report.projectorVersion, SKILLFLOW_PROJECTOR_VERSION);
  assert.ok(report.nodes.length > 0, "the fixture has measurable nodes");

  // Independently recount one section's span with the SAME `TokenCounter` the footprint uses. If the
  // route ever grew its own counting path, this equality is what would break.
  const version = skills.getVersion(versionId);
  const files = skills.listFiles(versionId);
  const skillMd = skills.getFileContent(versionId, "SKILL.md").text as string;
  const graph = projectSkillGraph(skillMd, files);
  const lines = skillMd.split(/\r?\n/);
  const section = graph.nodes.find((node) => node.id === "gather-inputs");
  assert.ok(section, "the fixture projects the Gather inputs section");
  const expected = await getTokenCounter(version.tokenProfile).countText(
    lines.slice(section.anchor.startLine - 1, section.anchor.endLine).join("\n"),
  );
  const actual = report.nodes.find((n) => n.nodeId === "gather-inputs")?.tokens;
  assert.equal(actual, expected, "the section's cost is exactly its own span");
  assert.ok(expected > 0, "and it is a real, non-trivial number");
});

test("a bundled file's cost is the footprint's ALREADY-PERSISTED per-file total, not a recount", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId, versionId } = await seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);

  const report = skillFlowTokensResponseSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: `/api/skills/${skillId}/versions/${versionId}/flow-tokens`,
      })
    ).json(),
  );
  const files = skills.listFiles(versionId);
  const skillMd = skills.getFileContent(versionId, "SKILL.md").text as string;
  const graph = projectSkillGraph(skillMd, files);

  const asset = graph.nodes.find((node) => node.kind === "asset");
  assert.ok(asset && asset.kind === "asset", "the fixture projects an asset box");
  const persisted = files.find((file) => file.path === asset.path)?.tokenTotal;
  assert.ok(persisted !== undefined && persisted > 0, "the footprint persisted a total for it");
  assert.equal(report.nodes.find((n) => n.nodeId === asset.id)?.tokens, persisted);
});

test("a tool reference is ABSENT from the map — a scan's cost is not the skill's, and 0 would lie", async () => {
  // Two sections, one citing a tool. The tool box must NOT appear with `tokens: 0`, which would read
  // as "this tool is free"; its definition tokens come from the bound server's scan instead.
  const skillMd = [
    "---",
    "name: cites-a-tool",
    "description: A skill that cites one MCP tool, used to pin the tool-cost boundary.",
    "---",
    "",
    "# Cites a tool",
    "",
    "## Step",
    "",
    "First call the `acme_search` tool to enumerate the exports.",
    "",
  ].join("\n");
  const files: SkillFileNode[] = [
    {
      path: "SKILL.md",
      size: 1,
      isBinary: false,
      isSkillMd: true,
      kind: "skill_md",
      tokenTotal: 0,
    },
  ];
  const graph = projectSkillGraph(skillMd, files);
  const toolNode = graph.nodes.find((node) => node.kind === "tool_ref");
  assert.ok(toolNode, "the fixture projects a tool_ref");

  const costs = await computeFlowNodeCosts(graph, skillMd, files, "generic_o200k");
  assert.equal(
    costs.find((cost) => cost.nodeId === toolNode.id),
    undefined,
    "absent means UNKNOWN — never a zero that reads as free",
  );
});

test("a loop guard costs 0 and SAYS 0 — it is a construct, not prose", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const { skillId, versionId } = await seedFixtureSkill(skills, "zero-annotation");
  const app = await makeRouteApp(skills, runs);
  const report = skillFlowTokensResponseSchema.parse(
    (
      await app.inject({
        method: "GET",
        url: `/api/skills/${skillId}/versions/${versionId}/flow-tokens`,
      })
    ).json(),
  );
  const entry = report.nodes.find((node) => node.nodeId === "validate-the-data-loop");
  assert.ok(entry, "the loop guard is present in the map");
  assert.equal(entry.tokens, 0, "explicitly 0, not omitted — its cost is genuinely nothing");
});

test("summing an entry point's ALWAYS set never double-counts a nested section", async () => {
  // Section spans are disjoint by construction (a section ends at the line before the next heading),
  // so the reachability sum is a real total rather than an over-count of nested prose. Prove it: the
  // always-set's sum must equal the tokens of the union of those spans, counted once.
  const skillMd = [
    "---",
    "name: nested",
    "description: A command with a nested subsection, used to prove spans do not overlap.",
    "---",
    "",
    "# Nested",
    "",
    "## /go",
    "",
    "Start here and work down.",
    "",
    "### Step one",
    "",
    "The first thing to do, at some length so the count is not trivially small.",
    "",
    "### Step two",
    "",
    "The second thing to do, also at some length so the count is not trivially small.",
    "",
  ].join("\n");
  const files: SkillFileNode[] = [
    {
      path: "SKILL.md",
      size: 1,
      isBinary: false,
      isSkillMd: true,
      kind: "skill_md",
      tokenTotal: 0,
    },
  ];
  const graph = projectSkillGraph(skillMd, files);
  const entry = graph.nodes.find((node) => node.kind === "entry_point");
  assert.ok(entry, "the fixture projects a /go entry point");

  const costs = await computeFlowNodeCosts(graph, skillMd, files, "generic_o200k");
  const byId = new Map(costs.map((cost) => [cost.nodeId, cost.tokens] as const));
  const reach = reachFromEntry(graph, entry.id);
  assert.deepEqual(reach.maybe, [], "nothing here is a maybe — it is one certain chain");

  const sum = reach.always.reduce((total, id) => total + (byId.get(id) ?? 0), 0);
  const lines = skillMd.split(/\r?\n/);
  const spans = graph.nodes
    .filter((node) => reach.always.includes(node.id))
    .map((node) => [node.anchor.startLine, node.anchor.endLine] as const)
    .sort((a, b) => a[0] - b[0]);
  // The spans must tile without overlap…
  for (let i = 1; i < spans.length; i += 1) {
    assert.ok(
      (spans[i] as readonly [number, number])[0] > (spans[i - 1] as readonly [number, number])[1],
      "section spans are disjoint",
    );
  }
  // …so the per-node sum equals counting each span once, independently.
  const counter = getTokenCounter("generic_o200k");
  let independent = 0;
  for (const [start, end] of spans) {
    independent += await counter.countText(lines.slice(start - 1, end).join("\n"));
  }
  assert.equal(sum, independent);
  assert.ok(sum > 0);

  // And every always-read box IS a section or the entry point — nothing accessory sneaks into the floor.
  for (const id of reach.always) {
    const node = graph.nodes.find((n) => n.id === id);
    assert.ok(
      node && (node.kind === "entry_point" || isSectionKind(node.kind)),
      `${id} is a section`,
    );
  }
});

test("404s on an unknown skill and on a version belonging to a different skill", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);
  const first = await seedFixtureSkill(skills, "zero-annotation");
  const second = await seedFixtureSkill(skills, "annotated");
  const app = await makeRouteApp(skills, runs);

  const unknownSkill = await app.inject({
    method: "GET",
    url: `/api/skills/does-not-exist/versions/${first.versionId}/flow-tokens`,
  });
  assert.equal(unknownSkill.statusCode, 404);

  const crossed = await app.inject({
    method: "GET",
    url: `/api/skills/${first.skillId}/versions/${second.versionId}/flow-tokens`,
  });
  assert.equal(crossed.statusCode, 404);
});
