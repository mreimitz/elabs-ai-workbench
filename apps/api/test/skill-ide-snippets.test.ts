import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type {
  ProjectPreviewResponse,
  SkillFileNode,
  SkillGraph,
} from "@mcp-token-footprint/shared";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { registerSkillflowRoutes } from "../src/skillflow/routes.js";
import { SkillRepository } from "../src/skills/repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";
// Skill IDE WP 9.3 (I10.5) — the LOAD-BEARING acceptance: each authoring snippet inserts text that
// projects to the intended node kind, asserted via the real `project-preview` route. We import the
// EXACT snippet catalog the code editor's completion provider inserts (a pure, `import type`-only web
// module), so the text a snippet inserts and the text this test asserts on can never drift.
import {
  resolveSnippetText,
  SNIPPET_SPECS,
} from "../../web/src/features/skills/design/code-intel/snippet-specs.js";

// --- Test harness: an in-memory DB + the real stateless project-preview route --------------------

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

async function buildApp(): Promise<FastifyInstance> {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const repo = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const runs = new RunRepository(db);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerSkillflowRoutes(app, repo, runs);
  await app.ready();
  apps.push(app);
  return app;
}

async function projectPreview(
  app: FastifyInstance,
  content: string,
  files: SkillFileNode[],
): Promise<SkillGraph> {
  const res = await app.inject({
    method: "POST",
    url: "/api/skillflow/project-preview",
    payload: { content, files },
  });
  assert.equal(res.statusCode, 200, res.body);
  return (res.json() as ProjectPreviewResponse).graph;
}

// --- Fixtures ------------------------------------------------------------------------------------

function file(path: string, kind: SkillFileNode["kind"]): SkillFileNode {
  return { path, size: 0, isBinary: false, isSkillMd: path === "SKILL.md", kind, tokenTotal: 0 };
}

const FRONTMATTER = [
  "---",
  "name: snippet-fixture",
  "description: A fixture skill used to prove snippet projections; long enough to read as a real one.",
  "---",
].join("\n");

/** The resolved (defaults-accepted) inserted text for a snippet id. */
function resolved(id: string): string {
  const spec = SNIPPET_SPECS.find((s) => s.id === id);
  assert.ok(spec, `snippet spec "${id}" exists`);
  return resolveSnippetText(spec.insertText);
}

/**
 * Per-snippet host: the smallest document that embeds the snippet's inserted text in a legal context,
 * plus the files that context needs. Keyed by snippet id — the coverage test asserts EVERY spec has one.
 */
const HOSTS: Record<string, { content: string; files: SkillFileNode[] }> = {
  // Body snippets — insert directly into the body.
  section: { content: `${FRONTMATTER}\n\n${resolved("section")}`, files: [] },
  command: { content: `${FRONTMATTER}\n\n${resolved("command")}`, files: [] },
  gatekeeper: { content: `${FRONTMATTER}\n\n${resolved("gatekeeper")}`, files: [] },

  // Annotation snippets — the comment sits directly above a hosting heading.
  "annotation-gatekeeper": {
    content: `${FRONTMATTER}\n\n${resolved("annotation-gatekeeper")}## Decide the route\n\nPlain body text.\n`,
    files: [],
  },
  "annotation-gate": {
    content: `${FRONTMATTER}\n\n${resolved("annotation-gate")}## Check the output\n\nRun \`scripts/check.py\` and confirm it exits 0.\n`,
    files: [file("scripts/check.py", "script")],
  },
  "annotation-command": {
    content: `${FRONTMATTER}\n\n${resolved("annotation-command")}## /report\n\nProduce the report.\n`,
    files: [],
  },
  "annotation-servers": {
    content: `${FRONTMATTER}\n\n${resolved("annotation-servers")}\n## A section\n\nPlain body text.\n`,
    files: [],
  },

  // Frontmatter snippets — the block is inserted between the `---` fences.
  "frontmatter-keywords": {
    content: [
      "---",
      "name: snippet-fixture",
      "description: A fixture skill used to prove snippet projections; long enough to read as a real one.",
      resolved("frontmatter-keywords").trimEnd(),
      "---",
      "",
      "## Body",
      "",
      "Text.",
      "",
    ].join("\n"),
    files: [],
  },
  "frontmatter-servers": {
    content: [
      "---",
      "name: snippet-fixture",
      "description: A fixture skill used to prove snippet projections; long enough to read as a real one.",
      resolved("frontmatter-servers").trimEnd(),
      "---",
      "",
      "## Body",
      "",
      "Text.",
      "",
    ].join("\n"),
    files: [],
  },
};

const kinds = (graph: SkillGraph): string[] => graph.nodes.map((n) => n.kind);

// --- (1) resolveSnippetText: Monaco tabstops → the defaults-accepted plain text -------------------

test("resolveSnippetText strips tabstops and keeps placeholder defaults", () => {
  assert.equal(resolveSnippetText("## ${1:Title}\n\n${2:Body.}\n$0"), "## Title\n\nBody.\n");
  assert.equal(
    resolveSnippetText("<!-- skillflow:gate id=${1:x} -->\n$0"),
    "<!-- skillflow:gate id=x -->\n",
  );
  assert.equal(resolveSnippetText("- ${1:a}\n- ${2:b}"), "- a\n- b");
});

// --- (2) every snippet spec has a host (no drift between the catalog and this test) ----------------

test("every SNIPPET_SPEC has a projection host", () => {
  for (const spec of SNIPPET_SPECS) {
    assert.ok(HOSTS[spec.id], `snippet "${spec.id}" has a host`);
  }
  assert.equal(Object.keys(HOSTS).length, SNIPPET_SPECS.length, "no orphan hosts");
});

// --- (3) each snippet projects to its intended node kind (via project-preview) ---------------------

for (const spec of SNIPPET_SPECS) {
  test(`snippet "${spec.id}" projects to ${spec.projectsTo ?? "tolerated metadata (no node)"}`, async () => {
    const app = await buildApp();
    const host = HOSTS[spec.id]!;
    const graph = await projectPreview(app, host.content, host.files);

    if (spec.projectsTo !== null) {
      assert.ok(
        kinds(graph).includes(spec.projectsTo),
        `expected a "${spec.projectsTo}" node — got [${kinds(graph).join(", ")}]`,
      );
    } else {
      // Tolerated metadata (`skillflow:servers`, frontmatter `servers:`): adds NO node of its own and
      // is not flagged — the hosting `## …` section still projects, and no warning names it.
      assert.ok(kinds(graph).includes("subroutine"), "the hosting section still projects");
      assert.ok(
        !graph.warnings.some((w) => /server|unknown annotation|not directly above/i.test(w)),
        `no warning about the metadata — got [${graph.warnings.join(" | ")}]`,
      );
      assert.ok(!kinds(graph).includes("entry_point"), "metadata created no entry point");
    }
  });
}

// --- (4) trigger-kind specifics (commands → command trigger; keywords → keyword trigger) -----------

test("the /command snippet projects a command-triggered entry point", async () => {
  const app = await buildApp();
  const host = HOSTS.command!;
  const graph = await projectPreview(app, host.content, host.files);
  const entry = graph.nodes.find((n) => n.kind === "entry_point");
  assert.ok(entry && entry.kind === "entry_point", "an entry point projected");
  assert.equal(entry.trigger.type, "command");
  assert.equal(entry.trigger.value, "/command");
});

test("the annotation:command snippet pins a command entry point (source annotated)", async () => {
  const app = await buildApp();
  const host = HOSTS["annotation-command"]!;
  const graph = await projectPreview(app, host.content, host.files);
  const entry = graph.nodes.find((n) => n.kind === "entry_point");
  assert.ok(entry && entry.kind === "entry_point", "an entry point projected");
  assert.equal(entry.trigger.type, "command");
  assert.equal(entry.source, "annotated");
});

test("the frontmatter keywords snippet projects keyword-triggered entry points", async () => {
  const app = await buildApp();
  const host = HOSTS["frontmatter-keywords"]!;
  const graph = await projectPreview(app, host.content, host.files);
  const keywordEntries = graph.nodes.filter(
    (n) => n.kind === "entry_point" && n.trigger.type === "keyword",
  );
  assert.equal(keywordEntries.length, 2, "two keyword entry points (one per keyword)");
  assert.deepEqual(
    keywordEntries.map((n) => (n.kind === "entry_point" ? n.trigger.value : "")).sort(),
    ["another trigger phrase", "phrase users type"],
  );
});

// --- (5) relative-path (asset-ref) completion: an inserted path projects an asset node -------------

test("a relative-path asset reference (path completion) projects an asset node", async () => {
  const app = await buildApp();
  const content = `${FRONTMATTER}\n\n## Load the input\n\nRead \`reference/spec.md\` for the exact layout before parsing.\n`;
  const graph = await projectPreview(app, content, [file("reference/spec.md", "reference")]);
  const asset = graph.nodes.find((n) => n.kind === "asset");
  assert.ok(asset && asset.kind === "asset", "an asset node projected from the relative reference");
  assert.equal(asset.path, "reference/spec.md");
});
