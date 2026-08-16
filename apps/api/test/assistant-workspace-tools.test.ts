import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import { ASSISTANT_EDIT_SOURCE_REF } from "@mcp-token-footprint/shared";
import {
  ASSISTANT_WORKSPACE_TOOL_NAMES,
  buildWorkspaceToolDefinitions,
} from "../src/assistant/tools/workspace-tools.js";
import { ensureWorkspaceRoot, skillWorkspaceDir } from "../src/assistant/workspace.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository } from "../src/skills/repository.js";

// Assistant (WP 2.2) — the workspace TOOLS, exercised DIRECTLY against a seeded fixture DB + a REAL
// temp filesystem (local fs, not network — allowed by the ground rules): each tool's `.handler(args, {})`
// is called exactly as the SDK would call it, no SDK session, no MCP protocol round-trip. Native
// file-tool edits (Read/Edit/Write/Glob/Grep) are simulated by writing to the real scratch fs directly —
// that IS what those tools do at the SDK level; this file proves `skills_commit_workspace` picks up
// whatever's actually on disk, not some in-memory snapshot from `skills_open_workspace`.

const databases: AppDatabase[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function tmpWorkspaceRoot(threadId = "thread-fixture"): string {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-assistant-wst-"));
  dirs.push(dataDir);
  return ensureWorkspaceRoot(dataDir, threadId);
}

type ToolDefs = ReturnType<typeof buildWorkspaceToolDefinitions>;

function toolFor(defs: ToolDefs, name: string) {
  const def = defs.find((d) => d.name === name);
  if (!def) throw new Error(`no workspace tool registered named "${name}"`);
  return def;
}

async function call<T = unknown>(
  defs: ToolDefs,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const def = toolFor(defs, name);
  const result = await def.handler(args as never, {});
  assert.equal(
    result.isError,
    undefined,
    `${name} unexpectedly errored: ${JSON.stringify(result.content)}`,
  );
  const block = result.content[0] as { type: "text"; text: string };
  assert.equal(block.type, "text");
  return JSON.parse(block.text) as T;
}

async function callExpectError(
  defs: ToolDefs,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const def = toolFor(defs, name);
  const result = await def.handler(args as never, {});
  assert.equal(result.isError, true, `${name} was expected to error`);
  const block = result.content[0] as { type: "text"; text: string };
  return (JSON.parse(block.text) as { error: string }).error;
}

const SKILL_MD_V1 = "---\nname: pdf-tools\ndescription: Work with PDFs\n---\nOriginal body.";

function seedSkill(skills: SkillRepository): { skillId: string; versionId: string } {
  const skill = skills.create({
    name: "pdf-tools",
    sourceType: "upload",
    description: "Work with PDFs",
  });
  const v1 = skills.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from(SKILL_MD_V1, "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
    },
  );
  if (v1.unchanged) throw new Error("fixture setup expected a fresh version");
  return { skillId: skill.id, versionId: v1.version.id };
}

test("ASSISTANT_WORKSPACE_TOOL_NAMES matches the actual tool definitions exactly, no duplicates", () => {
  const skills = new SkillRepository(createDatabase(), new SecretStore(Buffer.alloc(32, 7)));
  const defs = buildWorkspaceToolDefinitions({ skills, workspaceRoot: tmpWorkspaceRoot() });
  const names = defs.map((d) => d.name);
  assert.deepEqual([...names].sort(), [...ASSISTANT_WORKSPACE_TOOL_NAMES].sort());
  assert.equal(new Set(names).size, names.length);
  for (const def of defs)
    assert.ok(def.description.length > 10, `${def.name} needs a real description`);
});

test("skills_open_workspace materializes the CURRENT version's files onto disk and returns the tree", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const { skillId, versionId } = seedSkill(skills);
  const root = tmpWorkspaceRoot();
  const defs = buildWorkspaceToolDefinitions({ skills, workspaceRoot: root });

  const out = await call<{
    skillId: string;
    versionId: string;
    versionLabel: string;
    workspacePath: string;
    files: Array<{ path: string; size: number; isBinary: boolean }>;
    fileCount: number;
  }>(defs, "skills_open_workspace", { skillId });

  assert.equal(out.skillId, skillId);
  assert.equal(out.versionId, versionId);
  assert.equal(out.fileCount, 1);
  assert.equal(out.files[0]?.path, "SKILL.md");
  assert.equal(
    out.workspacePath,
    skillWorkspaceDir(root, skillId),
    "workspacePath is the absolute on-disk path",
  );
  assert.ok(
    fs.existsSync(path.join(out.workspacePath, "SKILL.md")),
    "the file is actually on disk",
  );
  assert.equal(fs.readFileSync(path.join(out.workspacePath, "SKILL.md"), "utf8"), SKILL_MD_V1);
});

test("skills_open_workspace with an explicit versionId materializes THAT version, not the current one", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const { skillId, versionId: v1Id } = seedSkill(skills);
  const v2 = skills.createVersion(
    skillId,
    [
      {
        path: "SKILL.md",
        bytes: Buffer.from(
          "---\nname: pdf-tools\ndescription: Work with PDFs\n---\nV2 body.",
          "utf8",
        ),
      },
    ],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
    },
  );
  if (v2.unchanged) throw new Error("fixture setup expected a second version");
  const root = tmpWorkspaceRoot();
  const defs = buildWorkspaceToolDefinitions({ skills, workspaceRoot: root });

  const out = await call<{ versionId: string; workspacePath: string }>(
    defs,
    "skills_open_workspace",
    {
      skillId,
      versionId: v1Id,
    },
  );
  assert.equal(out.versionId, v1Id, "opened the explicitly requested (non-current) version");
  assert.equal(fs.readFileSync(path.join(out.workspacePath, "SKILL.md"), "utf8"), SKILL_MD_V1);
});

test("skills_open_workspace on an unknown skill, or a version belonging to a different skill, returns isError", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const { skillId } = seedSkill(skills);
  const other = skills.create({ name: "other-skill", sourceType: "upload" });
  const otherV = skills.createVersion(
    other.id,
    [{ path: "SKILL.md", bytes: Buffer.from("x", "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "other-skill", description: "x" },
    },
  );
  if (otherV.unchanged) throw new Error("fixture setup expected a version");
  const defs = buildWorkspaceToolDefinitions({ skills, workspaceRoot: tmpWorkspaceRoot() });

  const unknownErr = await callExpectError(defs, "skills_open_workspace", {
    skillId: "does-not-exist",
  });
  assert.match(unknownErr, /not found/i);

  const mismatchErr = await callExpectError(defs, "skills_open_workspace", {
    skillId,
    versionId: otherV.version.id,
  });
  assert.match(mismatchErr, /does not belong/i);
});

test("skills_commit_workspace with NO edits is unchanged: true — no new version, and the workspace stays open", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const { skillId, versionId } = seedSkill(skills);
  const root = tmpWorkspaceRoot();
  const defs = buildWorkspaceToolDefinitions({ skills, workspaceRoot: root });

  await call(defs, "skills_open_workspace", { skillId });
  const out = await call<{ unchanged: true; versionId: string; message: string }>(
    defs,
    "skills_commit_workspace",
    {
      skillId,
    },
  );

  assert.equal(out.unchanged, true);
  assert.equal(out.versionId, versionId, "still the same (unchanged) version id");
  assert.match(out.message, /no changes/i);
  assert.equal(skills.listVersions(skillId).length, 1, "no new version was minted");
  assert.ok(
    fs.existsSync(skillWorkspaceDir(root, skillId)),
    "the workspace stays open on an unchanged commit",
  );
});

test("skills_commit_workspace after a native-tool-style edit mints a new version (ASSISTANT_EDIT_SOURCE_REF), returns a diff, and cleans up the skill's workspace dir", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const { skillId, versionId: v1Id } = seedSkill(skills);
  const root = tmpWorkspaceRoot();
  const defs = buildWorkspaceToolDefinitions({ skills, workspaceRoot: root });

  const opened = await call<{ workspacePath: string }>(defs, "skills_open_workspace", { skillId });
  // Simulate the agent's native Edit tool mutating SKILL.md, and its native Write tool adding a new
  // reference file — both are just real fs writes at the SDK level.
  const editedBody = "---\nname: pdf-tools\ndescription: Work with PDFs\n---\nEdited by the agent.";
  fs.writeFileSync(path.join(opened.workspacePath, "SKILL.md"), editedBody);
  fs.mkdirSync(path.join(opened.workspacePath, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(opened.workspacePath, "references", "NOTES.md"),
    "New reference file.",
  );

  const out = await call<{
    unchanged: false;
    skillId: string;
    versionId: string;
    versionLabel: string;
    skillLink: string;
    diff: { rollup: { filesAdded: number; filesModified: number } };
  }>(defs, "skills_commit_workspace", { skillId, note: "agent edit" });

  assert.equal(out.unchanged, false);
  assert.equal(out.skillId, skillId);
  assert.notEqual(out.versionId, v1Id, "a NEW version was minted");
  assert.equal(out.skillLink, `/skills/${skillId}`);
  assert.equal(out.diff.rollup.filesModified, 1, "SKILL.md counted as modified");
  assert.equal(out.diff.rollup.filesAdded, 1, "references/NOTES.md counted as added");

  const newVersion = skills.getVersion(out.versionId);
  assert.equal(
    newVersion.sourceRef,
    ASSISTANT_EDIT_SOURCE_REF,
    "stamped with the assistant edit source ref",
  );
  assert.equal(newVersion.note, "agent edit");
  assert.equal(skills.listVersions(skillId).length, 2, "exactly one new version");

  const committedFiles = skills.getVersionFiles(out.versionId);
  assert.equal(
    committedFiles.find((f) => f.path === "SKILL.md")?.bytes.toString("utf8"),
    editedBody,
  );
  assert.ok(
    committedFiles.some((f) => f.path === "references/NOTES.md"),
    "the newly-written file was committed",
  );

  assert.equal(
    fs.existsSync(skillWorkspaceDir(root, skillId)),
    false,
    "the skill's workspace dir was cleaned up on commit",
  );
});

test("skills_commit_workspace on a skill that was never opened in this workspace returns isError", async () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const { skillId } = seedSkill(skills);
  const defs = buildWorkspaceToolDefinitions({ skills, workspaceRoot: tmpWorkspaceRoot() });

  const err = await callExpectError(defs, "skills_commit_workspace", { skillId });
  assert.match(err, /skills_open_workspace/i);
});
