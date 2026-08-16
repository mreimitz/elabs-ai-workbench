import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository, type SkillFileInput } from "../src/skills/repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import {
  buildAvailableSkillsBlock,
  buildSkillDisclosureTools,
  READ_SKILL_FILE_TOOL,
  LIST_SKILL_FILES_TOOL,
  skillLocation,
  type ResolvedSkill,
  type SkillFileReader,
} from "../src/testing/skill-context.js";
import type { StepSink, ToolCallOutcome } from "../src/testing/tool-bridge.js";
import type { Tool } from "ai";

// ── Harness ───────────────────────────────────────────────────────────────────────────────────

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

function file(path: string, text: string): SkillFileInput {
  return { path, bytes: Buffer.from(text, "utf8") };
}

/** Seed a provider credential so a scenario's `provider_id` FK is satisfiable, and return its id. */
function seedProvider(db: AppDatabase): string {
  const id = "prov-x";
  const now = "2026-07-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES (@id, 'anthropic', 'Claude', NULL, 'enc:v1:x', @now, @now)`,
  ).run({ id, now });
  return id;
}

/** A recording StepSink so a disclosure read's metering (request/response) can be asserted. */
function recordingSink(): { sink: StepSink; calls: ToolCallOutcome[] } {
  const calls: ToolCallOutcome[] = [];
  return {
    calls,
    sink: {
      toolCall(outcome: ToolCallOutcome): void {
        calls.push(outcome);
      },
    },
  };
}

/** Invoke an AI-SDK tool's execute with the toolCallId the SDK would pass. */
async function callTool(
  tools: Record<string, Tool>,
  name: string,
  args: unknown,
): Promise<unknown> {
  const t = tools[name];
  assert.ok(t, `tool ${name} registered`);
  assert.ok(typeof t.execute === "function", `tool ${name} is executable (read-only)`);
  return t.execute!(args, { toolCallId: "call-1", messages: [] });
}

/** A resolved skill built directly (unit-level, no DB) for the pure block/tool assertions. */
function resolvedSkill(over: Partial<ResolvedSkill> = {}): ResolvedSkill {
  return {
    skillId: "sk-1",
    name: "pdf-processing",
    description: "Extract PDF text, fill forms, merge PDFs.",
    versionId: "ver-1",
    versionLabel: "v5",
    // Only the fields the block/tools read are exercised; cast the version record minimally.
    version: {
      versionLabel: "v5",
      manifest: { name: "pdf-processing", description: "" },
    } as ResolvedSkill["version"],
    manifest: { name: "pdf-processing", description: "" },
    files: [
      {
        path: "SKILL.md",
        size: 10,
        isBinary: false,
        isSkillMd: true,
        kind: "skill_md",
        tokenTotal: 3,
      },
      {
        path: "references/FORMS.md",
        size: 8,
        isBinary: false,
        isSkillMd: false,
        kind: "reference",
        tokenTotal: 2,
      },
    ],
    skillMdBody: "# PDF Processing\nStep 1. Read the file.",
    eager: false,
    ...over,
  };
}

// ── L1 block ─────────────────────────────────────────────────────────────────────────────────

test("buildAvailableSkillsBlock emits name + description + skill://name@version/SKILL.md location", () => {
  const block = buildAvailableSkillsBlock([resolvedSkill()]);
  assert.match(block, /<available_skills>/);
  assert.match(block, /<name>pdf-processing<\/name>/);
  assert.match(block, /<description>Extract PDF text, fill forms, merge PDFs\.<\/description>/);
  assert.match(block, /<location>skill:\/\/pdf-processing@v5\/SKILL\.md<\/location>/);
  assert.equal(skillLocation(resolvedSkill()), "skill://pdf-processing@v5/SKILL.md");
});

test("buildAvailableSkillsBlock returns empty string when no skills are attached (no prompt change)", () => {
  assert.equal(buildAvailableSkillsBlock([]), "");
});

test("eager off by default: the SKILL.md body is NOT inlined", () => {
  const block = buildAvailableSkillsBlock([resolvedSkill()]);
  assert.doesNotMatch(block, /Step 1\. Read the file\./);
  assert.doesNotMatch(block, /<eager_skill/);
});

test("eager on: additionally inlines the SKILL.md body (L2) up front", () => {
  const skill = resolvedSkill();
  const block = buildAvailableSkillsBlock([skill], { eagerIds: new Set([skill.skillId]) });
  // L1 still present …
  assert.match(block, /<location>skill:\/\/pdf-processing@v5\/SKILL\.md<\/location>/);
  // … plus the inlined body.
  assert.match(block, /<eager_skill name="pdf-processing"/);
  assert.match(block, /Step 1\. Read the file\./);
});

// ── Disclosure tools (read-only + metered + guarded) ────────────────────────────────────────────

/** A file reader over an in-memory map of the resolved skill's files. */
function readerFor(skill: ResolvedSkill, contents: Record<string, string>): SkillFileReader {
  return {
    listFiles: () => skill.files,
    readTextFile: (_versionId, path) => {
      const text = contents[path];
      if (text === undefined) throw new Error("Skill file not found");
      return { path, text };
    },
  };
}

test("read_skill_file returns file contents and is metered like an MCP tools/call", async () => {
  const skill = resolvedSkill();
  const { sink, calls } = recordingSink();
  const reader = readerFor(skill, { "SKILL.md": "# PDF Processing\nBody." });
  const tools = buildSkillDisclosureTools([skill], reader, sink);

  const result = (await callTool(tools, READ_SKILL_FILE_TOOL, {
    skill: "pdf-processing",
    path: "SKILL.md",
  })) as { contents?: string };
  assert.equal(result.contents, "# PDF Processing\nBody.");

  // Metered exactly like a tools/call: one settled StepSink outcome with args + result + timing.
  assert.equal(calls.length, 1);
  const outcome = calls[0]!;
  assert.equal(outcome.toolName, READ_SKILL_FILE_TOOL);
  assert.equal(outcome.isError, false);
  assert.deepEqual(outcome.args, { skill: "pdf-processing", path: "SKILL.md" });
  assert.ok(outcome.result, "result payload recorded for token accounting");
  assert.equal(outcome.toolCallId, "call-1");
  assert.ok(typeof outcome.durationMs === "number");
  assert.ok(outcome.startedAt <= outcome.endedAt);
});

test("read_skill_file refuses a path outside the skill (traversal + unknown-file) and unknown skills", async () => {
  const skill = resolvedSkill();
  const { sink, calls } = recordingSink();
  const reader = readerFor(skill, { "SKILL.md": "body" });
  const tools = buildSkillDisclosureTools([skill], reader, sink);

  const traversal = (await callTool(tools, READ_SKILL_FILE_TOOL, {
    skill: "pdf-processing",
    path: "../../etc/passwd",
  })) as { error?: string; contents?: string };
  assert.ok(traversal.error, "traversal refused");
  assert.equal(traversal.contents, undefined);

  const absolute = (await callTool(tools, READ_SKILL_FILE_TOOL, {
    skill: "pdf-processing",
    path: "/etc/passwd",
  })) as { error?: string };
  assert.ok(absolute.error, "absolute path refused");

  const notInSkill = (await callTool(tools, READ_SKILL_FILE_TOOL, {
    skill: "pdf-processing",
    path: "scripts/run.sh",
  })) as { error?: string };
  assert.ok(notInSkill.error, "a path not in the resolved version is refused");

  const unknownSkill = (await callTool(tools, READ_SKILL_FILE_TOOL, {
    skill: "not-attached",
    path: "SKILL.md",
  })) as { error?: string };
  assert.ok(unknownSkill.error, "unknown skill refused");

  // Every refusal is still metered (a real product pays the round-trip); none returned contents.
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.isError === true));
});

test("there is NO script-execution path: disclosure tools are read-only (only list/read exist)", () => {
  const skill = resolvedSkill();
  const { sink } = recordingSink();
  const reader = readerFor(skill, { "SKILL.md": "body" });
  const tools = buildSkillDisclosureTools([skill], reader, sink);

  // Only the two READ tools are registered — no run/exec/spawn tool exists.
  assert.deepEqual(Object.keys(tools).sort(), [LIST_SKILL_FILES_TOOL, READ_SKILL_FILE_TOOL].sort());
  for (const [name] of Object.entries(tools)) {
    assert.ok(
      name === LIST_SKILL_FILES_TOOL || name === READ_SKILL_FILE_TOOL,
      `no execution tool registered (got "${name}")`,
    );
  }
  // The reader contract itself exposes no execute method.
  assert.equal(typeof (reader as unknown as { execute?: unknown }).execute, "undefined");
});

test("list_skill_files lists the attached skills' files (read-only) and is metered", async () => {
  const skill = resolvedSkill();
  const { sink, calls } = recordingSink();
  const reader = readerFor(skill, {});
  const tools = buildSkillDisclosureTools([skill], reader, sink);

  const result = (await callTool(tools, LIST_SKILL_FILES_TOOL, {})) as {
    skills: Array<{ skill: string; files: Array<{ path: string }> }>;
  };
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0]!.skill, "pdf-processing");
  assert.deepEqual(result.skills[0]!.files.map((f) => f.path).sort(), [
    "SKILL.md",
    "references/FORMS.md",
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.toolName, LIST_SKILL_FILES_TOOL);
});

// ── Resolution: latest vs pinned via the real repository + scenario service ─────────────────────

test("resolveAllowedSkills: latest resolves at run time; pinned resolves to the fixed version", () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 7)));
  const scans = new ScanRepository(db);
  const scenarioRepo = new ScenarioRepository(db);
  const service = new ScenarioService(scenarioRepo, scans, skills);
  seedProvider(db);

  const skill = skills.create({ name: "pdf", sourceType: "upload", description: "Work with PDFs" });
  const v1 = skills.createVersion(
    skill.id,
    [file("SKILL.md", "---\nname: pdf\ndescription: v1 desc\n---\nbody v1")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf", description: "v1 desc" },
    },
  );
  assert.equal(v1.unchanged, false);
  const v2 = skills.createVersion(
    skill.id,
    [file("SKILL.md", "---\nname: pdf\ndescription: v2 desc\n---\nbody v2")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf", description: "v2 desc" },
    },
  );
  assert.equal(v2.unchanged, false);

  // latest attachment → resolves to the current (v2) version at run time.
  const latestScenario = scenarioRepo.create({
    name: "Latest",
    providerId: "prov-x",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "sys",
    allowedServers: [],
    allowedSkills: [{ skillId: skill.id, versionMode: "latest" }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
  });
  const latestResolved = service.resolveAllowedSkills(latestScenario.id);
  assert.equal(latestResolved.length, 1);
  assert.equal(latestResolved[0]!.versionId, v2.version.id, "latest tracks currentVersionId");
  assert.equal(latestResolved[0]!.name, "pdf");
  assert.equal(latestResolved[0]!.skillMdBody.includes("body v2"), true);

  // pinned attachment → resolves to v1 regardless of what is current.
  const pinnedScenario = scenarioRepo.create({
    name: "Pinned",
    providerId: "prov-x",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "sys",
    allowedServers: [],
    allowedSkills: [{ skillId: skill.id, versionMode: "pinned", pinnedVersionId: v1.version.id }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
  });
  const pinnedResolved = service.resolveAllowedSkills(pinnedScenario.id);
  assert.equal(pinnedResolved.length, 1);
  assert.equal(pinnedResolved[0]!.versionId, v1.version.id, "pinned stays on the fixed version");
  assert.equal(pinnedResolved[0]!.skillMdBody.includes("body v1"), true);

  // The L1 block for the resolved skill carries the right per-mode location label.
  const latestBlock = buildAvailableSkillsBlock(latestResolved);
  assert.match(latestBlock, new RegExp(`skill://pdf@${latestResolved[0]!.versionLabel}/SKILL.md`));
});

test("eager attachment round-trips through resolve → eagerIds → inlined SKILL.md body (end-to-end)", () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 11)));
  const scans = new ScanRepository(db);
  const scenarioRepo = new ScenarioRepository(db);
  const service = new ScenarioService(scenarioRepo, scans, skills);
  seedProvider(db);

  const skill = skills.create({ name: "pdf", sourceType: "upload", description: "Work with PDFs" });
  const v1 = skills.createVersion(
    skill.id,
    [file("SKILL.md", "---\nname: pdf\ndescription: v1 desc\n---\nEAGER BODY MARKER")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf", description: "v1 desc" },
    },
  );
  assert.equal(v1.unchanged, false);

  // Attach the skill with eager = true.
  const scenario = scenarioRepo.create({
    name: "Eager",
    providerId: "prov-x",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "sys",
    allowedServers: [],
    allowedSkills: [{ skillId: skill.id, versionMode: "latest", eager: true }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
  });

  // The persisted attachment carries eager (0/1 → boolean) through hydrate.
  assert.equal(scenarioRepo.get(scenario.id).allowedSkills[0]!.eager, true);

  // resolveAllowedSkills carries the eager flag onto the ResolvedSkill.
  const resolved = service.resolveAllowedSkills(scenario.id);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]!.eager, true, "resolve carries the attachment's eager flag");

  // run-service builds eagerIds from resolved.eager; that inlines the L2 body up front.
  const eagerIds = new Set<string>(resolved.filter((s) => s.eager).map((s) => s.skillId));
  assert.equal(eagerIds.has(skill.id), true);
  const block = buildAvailableSkillsBlock(resolved, { eagerIds });
  assert.match(block, /<eager_skill name="pdf"/);
  assert.match(block, /EAGER BODY MARKER/);

  // A non-eager attachment does NOT inline the body.
  const plain = scenarioRepo.create({
    name: "Plain",
    providerId: "prov-x",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "sys",
    allowedServers: [],
    allowedSkills: [{ skillId: skill.id, versionMode: "latest", eager: false }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
  });
  const plainResolved = service.resolveAllowedSkills(plain.id);
  assert.equal(plainResolved[0]!.eager, false);
  const plainEagerIds = new Set<string>(plainResolved.filter((s) => s.eager).map((s) => s.skillId));
  const plainBlock = buildAvailableSkillsBlock(plainResolved, { eagerIds: plainEagerIds });
  assert.doesNotMatch(plainBlock, /<eager_skill/);
  assert.doesNotMatch(plainBlock, /EAGER BODY MARKER/);
});

test("resolveAllowedSkills skips a skill/version that no longer exists (graceful)", () => {
  const db = createDatabase();
  const skills = new SkillRepository(db, new SecretStore(Buffer.alloc(32, 9)));
  const scans = new ScanRepository(db);
  const scenarioRepo = new ScenarioRepository(db);
  const service = new ScenarioService(scenarioRepo, scans, skills);
  seedProvider(db);

  // A `latest` attachment to a skill with NO current version yet resolves to nothing (skipped, no throw).
  const empty = skills.create({ name: "empty", sourceType: "upload" });
  const scenario = scenarioRepo.create({
    name: "Ghost",
    providerId: "prov-x",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "sys",
    allowedServers: [],
    allowedSkills: [{ skillId: empty.id, versionMode: "latest" }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
  });
  assert.deepEqual(service.resolveAllowedSkills(scenario.id), []);

  // A `pinned` attachment whose version is later deleted (cascading the scenario_skills row away) also
  // yields nothing — the run proceeds gracefully with the remaining skills.
  const skill = skills.create({ name: "pdf", sourceType: "upload" });
  const v1 = skills.createVersion(
    skill.id,
    [file("SKILL.md", "---\nname: pdf\ndescription: d\n---\nb")],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf", description: "d" },
    },
  );
  const pinned = scenarioRepo.create({
    name: "Pinned-ghost",
    providerId: "prov-x",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "sys",
    allowedServers: [],
    allowedSkills: [{ skillId: skill.id, versionMode: "pinned", pinnedVersionId: v1.version.id }],
    defaultProfiles: ["generic_o200k"],
    guardrails: {},
  });
  assert.equal(service.resolveAllowedSkills(pinned.id).length, 1);
  // Delete the whole skill → the scenario_skills row cascades away; resolution is empty, no throw.
  skills.delete(skill.id);
  assert.deepEqual(service.resolveAllowedSkills(pinned.id), []);
});

test("read_skill_file returns a binary marker (never raw bytes, never execution)", async () => {
  const skill = resolvedSkill({
    files: [
      {
        path: "logo.png",
        size: 100,
        isBinary: true,
        isSkillMd: false,
        kind: "asset",
        tokenTotal: 0,
      },
    ],
    skillMdBody: "",
  });
  const { sink } = recordingSink();
  const reader: SkillFileReader = {
    listFiles: () => skill.files,
    readTextFile: (_v, path) => ({ path, isBinary: true, size: 100 }),
  };
  const tools = buildSkillDisclosureTools([skill], reader, sink);
  const result = (await callTool(tools, READ_SKILL_FILE_TOOL, {
    skill: "pdf-processing",
    path: "logo.png",
  })) as {
    isBinary?: boolean;
    contents?: string;
  };
  assert.equal(result.isBinary, true);
  assert.equal(result.contents, undefined);
});
