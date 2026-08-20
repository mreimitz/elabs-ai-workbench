import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ResolvedSkill } from "../src/testing/skill-context.js";
import {
  buildSubscriptionSkillToolDefinitions,
  buildSubscriptionSkillToolServer,
  LIST_SKILL_FILES_TOOL,
  materializeSkills,
  READ_SKILL_FILE_TOOL,
  SUBSCRIPTION_SKILLS_MCP_KEY,
  subscriptionSkillToolPatterns,
  type SkillFileBytesReader,
} from "../src/testing/subscription-skill-tools.js";

// WP 1.4 (planning/Roadmap/RM-09-claude-subscription/, D-CS9 — skills half) — the read-only skill-materialization +
// disclosure-tool helper the subscription executor wires. Exercised directly (no fake driver, no SDK
// `query()`) against the REAL filesystem under a throwaway temp dir — every test cleans its own dir up.

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcpfp-skill-tools-test-"));
  dirs.push(dir);
  return dir;
}

function jsonOf(result: CallToolResult): unknown {
  const first = result.content[0];
  assert.ok(first && first.type === "text", "tool result carries a text content block");
  return JSON.parse((first as { type: "text"; text: string }).text);
}

/** A stub `SkillFileBytesReader` backed by a plain in-memory map — no DB. */
function stubReader(bytesByVersion: Record<string, Record<string, string>>): SkillFileBytesReader {
  return {
    getFileBytes: (versionId, filePath) => {
      const text = bytesByVersion[versionId]?.[filePath];
      if (text === undefined) throw new Error(`no such file ${versionId}/${filePath}`);
      return { bytes: Buffer.from(text, "utf8"), isBinary: false };
    },
  };
}

function skill(over: Partial<ResolvedSkill> = {}): ResolvedSkill {
  return {
    skillId: "sk-1",
    name: "pdf-processing",
    description: "Extract PDF text, fill forms, merge PDFs.",
    versionId: "ver-1",
    versionLabel: "v1",
    version: {
      versionLabel: "v1",
      manifest: { name: "pdf-processing", description: "" },
    } as ResolvedSkill["version"],
    manifest: { name: "pdf-processing", description: "" },
    files: [
      { path: "SKILL.md", size: 20, isBinary: false, isSkillMd: true, kind: "skill_md", tokenTotal: 5 },
      { path: "reference.md", size: 10, isBinary: false, isSkillMd: false, kind: "reference", tokenTotal: 3 },
      { path: "scripts/run.sh", size: 30, isBinary: false, isSkillMd: false, kind: "script", tokenTotal: 8 },
    ],
    skillMdBody: "---\nname: pdf-processing\n---\nbody",
    eager: false,
    ...over,
  };
}

const FILE_TEXT: Record<string, Record<string, string>> = {
  "ver-1": {
    "SKILL.md": "---\nname: pdf-processing\n---\nbody",
    "reference.md": "See appendix for details.",
    "scripts/run.sh": "#!/bin/sh\necho never-run",
  },
};

// ── materializeSkills ────────────────────────────────────────────────────────────────────────────

test("materializeSkills: writes every resolved file, read-only, under <skillsDir>/<skillId>/<path>", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  await materializeSkills(skillsDir, [skill()], stubReader(FILE_TEXT));

  const skillMd = path.join(skillsDir, "sk-1", "SKILL.md");
  const reference = path.join(skillsDir, "sk-1", "reference.md");
  const script = path.join(skillsDir, "sk-1", "scripts", "run.sh");

  assert.equal(await fs.readFile(skillMd, "utf8"), FILE_TEXT["ver-1"]!["SKILL.md"]);
  assert.equal(await fs.readFile(reference, "utf8"), FILE_TEXT["ver-1"]!["reference.md"]);
  // A "script" kind file is materialized as plain DATA — its content is written and later read back as
  // TEXT, never spawned/evaluated (see the read_skill_file assertions below for the never-executed proof).
  assert.equal(await fs.readFile(script, "utf8"), FILE_TEXT["ver-1"]!["scripts/run.sh"]);

  // Best-effort read-only chmod: no write bits for anyone (skipped defensively if the sandbox/CI user
  // can't honor chmod at all — the assertion only fires when the mode actually changed from the default).
  const mode = (await fs.stat(skillMd)).mode;
  assert.equal(mode & 0o222, 0, "materialized file carries no write permission bits");
});

test("materializeSkills: a scenario with NO resolved skills writes nothing (dir never created)", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  await materializeSkills(skillsDir, [], stubReader(FILE_TEXT));
  await assert.rejects(fs.stat(skillsDir), /ENOENT/);
});

test("materializeSkills: a per-file read failure is skipped, not fatal (the run proceeds with what resolved)", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  // Only SKILL.md is in the reader's map — reference.md/scripts/run.sh throw on read.
  const partialReader = stubReader({ "ver-1": { "SKILL.md": FILE_TEXT["ver-1"]!["SKILL.md"]! } });
  await materializeSkills(skillsDir, [skill()], partialReader);
  assert.equal(await fs.readFile(path.join(skillsDir, "sk-1", "SKILL.md"), "utf8"), FILE_TEXT["ver-1"]!["SKILL.md"]);
  await assert.rejects(fs.stat(path.join(skillsDir, "sk-1", "reference.md")), /ENOENT/);
});

// ── buildSubscriptionSkillToolDefinitions (direct handler invocation — no SDK transport) ───────────

test("subscriptionSkillToolPatterns: the mcp__skills__{list,read} allow patterns", () => {
  assert.deepEqual(subscriptionSkillToolPatterns(), [
    `mcp__${SUBSCRIPTION_SKILLS_MCP_KEY}__${LIST_SKILL_FILES_TOOL}`,
    `mcp__${SUBSCRIPTION_SKILLS_MCP_KEY}__${READ_SKILL_FILE_TOOL}`,
  ]);
});

test("list_skill_files: returns every attached skill's file paths/kinds/token sizes, reads no contents", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  await materializeSkills(skillsDir, [skill()], stubReader(FILE_TEXT));
  const [listDef] = buildSubscriptionSkillToolDefinitions(skillsDir, [skill()]);

  const result = jsonOf(await listDef!.handler({}, {})) as {
    skills: Array<{ skill: string; version: string; files: Array<{ path: string; binary: boolean }> }>;
  };
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0]!.skill, "pdf-processing");
  assert.equal(result.skills[0]!.version, "v1");
  assert.deepEqual(
    result.skills[0]!.files.map((f) => f.path),
    ["SKILL.md", "reference.md", "scripts/run.sh"],
  );
});

test("read_skill_file: returns a text file's MATERIALIZED contents (read from disk, never the DB)", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  await materializeSkills(skillsDir, [skill()], stubReader(FILE_TEXT));
  const [, readDef] = buildSubscriptionSkillToolDefinitions(skillsDir, [skill()]);

  const result = jsonOf(
    await readDef!.handler({ skill: "pdf-processing", path: "reference.md" }, {}),
  ) as { contents?: string };
  assert.equal(result.contents, FILE_TEXT["ver-1"]!["reference.md"]);
});

test("read_skill_file on a SCRIPT file: returns its TEXT verbatim — proves it is treated as data, never executed", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  await materializeSkills(skillsDir, [skill()], stubReader(FILE_TEXT));
  const [, readDef] = buildSubscriptionSkillToolDefinitions(skillsDir, [skill()]);

  const result = jsonOf(
    await readDef!.handler({ skill: "pdf-processing", path: "scripts/run.sh" }, {}),
  ) as { contents?: string };
  // The shell script's literal source text comes back — no side effect (no output file, no process),
  // and specifically NOT the string "never-run" the script would print if it had actually been run.
  assert.equal(result.contents, "#!/bin/sh\necho never-run");
});

test("read_skill_file: a BINARY file's contents are never inlined — only an isBinary note", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  const binarySkill = skill({
    files: [
      { path: "SKILL.md", size: 20, isBinary: false, isSkillMd: true, kind: "skill_md", tokenTotal: 5 },
      { path: "logo.png", size: 128, isBinary: true, isSkillMd: false, kind: "asset", tokenTotal: 0 },
    ],
  });
  await materializeSkills(skillsDir, [binarySkill], {
    getFileBytes: (versionId, filePath) => {
      if (filePath === "logo.png") return { bytes: Buffer.from([0, 1, 2, 3]), isBinary: true };
      return { bytes: Buffer.from(FILE_TEXT[versionId]?.[filePath] ?? "", "utf8"), isBinary: false };
    },
  });
  const [, readDef] = buildSubscriptionSkillToolDefinitions(skillsDir, [binarySkill]);

  const result = jsonOf(await readDef!.handler({ skill: "pdf-processing", path: "logo.png" }, {})) as {
    isBinary?: boolean;
    contents?: string;
    note?: string;
  };
  assert.equal(result.isBinary, true);
  assert.equal(result.contents, undefined, "binary bytes are never inlined into the model-visible result");
  assert.match(result.note ?? "", /never executes/);
});

test("read_skill_file: an unknown skill name refuses with {error}, never a throw", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  const [, readDef] = buildSubscriptionSkillToolDefinitions(skillsDir, [skill()]);
  const raw = await readDef!.handler({ skill: "nope", path: "SKILL.md" }, {});
  assert.equal(raw.isError, true);
  const result = jsonOf(raw) as { error?: string };
  assert.match(result.error ?? "", /No attached skill named/);
});

test("read_skill_file: path traversal is refused, never escapes the skill's own directory", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  await materializeSkills(skillsDir, [skill()], stubReader(FILE_TEXT));
  const [, readDef] = buildSubscriptionSkillToolDefinitions(skillsDir, [skill()]);

  for (const evilPath of ["../secret.txt", "/etc/passwd", "a/../../escape.txt"]) {
    const raw = await readDef!.handler({ skill: "pdf-processing", path: evilPath }, {});
    assert.equal(raw.isError, true, `traversal path "${evilPath}" is refused`);
    const result = jsonOf(raw) as { error?: string };
    assert.match(result.error ?? "", /Invalid path|not part of skill/);
  }
});

test("read_skill_file: a path not part of the resolved skill's known files is refused", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  await materializeSkills(skillsDir, [skill()], stubReader(FILE_TEXT));
  const [, readDef] = buildSubscriptionSkillToolDefinitions(skillsDir, [skill()]);
  const raw = await readDef!.handler({ skill: "pdf-processing", path: "unknown.md" }, {});
  assert.equal(raw.isError, true);
  const result = jsonOf(raw) as { error?: string };
  assert.match(result.error ?? "", /not part of skill/);
});

// ── buildSubscriptionSkillToolServer (the createSdkMcpServer wiring) ───────────────────────────────

test("buildSubscriptionSkillToolServer: builds an SDK-native in-process MCP server instance (no network, no child)", async () => {
  const root = await tempDir();
  const skillsDir = path.join(root, "skills");
  await materializeSkills(skillsDir, [skill()], stubReader(FILE_TEXT));
  const server = buildSubscriptionSkillToolServer(skillsDir, [skill()]);
  assert.equal(typeof server, "object");
  assert.notEqual(server, null);
});
