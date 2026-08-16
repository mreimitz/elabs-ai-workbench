import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import {
  ASSISTANT_WRITE_TOOL_NAMES,
  buildWriteToolDefinitions,
  type WriteToolDeps,
} from "../src/assistant/tools/write-tools.js";
import {
  autoAcceptEligible,
  classifyTool,
  requiresApproval,
} from "../src/assistant/permission-classifier.js";
import { CollectionRepository } from "../src/collections/repository.js";
import { ensureLocalCollection, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ServerRepository } from "../src/servers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { SkillRepository } from "../src/skills/repository.js";
import { SuiteRepository } from "../src/suites/repository.js";
import { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";

// Assistant (WP 2.3) — the app-data WRITE tools, exercised DIRECTLY against a seeded fixture DB (+ a
// real scratch attachments dir): each tool's `.handler(args, {})` is called exactly as the SDK would
// call it — no SDK session, no MCP protocol round-trip, no approval round-trip (the WP 2.1 gate is
// tested separately; this file proves what each tool DOES once allowed). Every write goes through the
// SAME repository/service the app's own HTTP routes use — this file's job is to prove the tool-shaped
// adapter forwards correctly and reports honestly, not to re-test repository logic already covered
// elsewhere (testing-crud.test.ts, benchmarks-*.test.ts, collections-*.test.ts, …).

const databases: AppDatabase[] = [];
const scratchDirs: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const dir of scratchDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  ensureLocalCollection(db); // seeds the reserved default "Local" collection (D-T4)
  databases.push(db);
  return db;
}

function tempAttachmentsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-assistant-write-attach-"));
  scratchDirs.push(dir);
  return dir;
}

const NOW = "2026-07-01T00:00:00.000Z";
const SECRET_ENV_VALUE = "sk-super-secret-server-token-should-never-leak";

function seedProvider(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, api_key_encrypted, created_at, updated_at)
     VALUES ('prov-1', 'anthropic', 'Claude', 'enc:v1:abc', @now, @now)`,
  ).run({ now: NOW });
}

type Fixture = {
  deps: WriteToolDeps;
  db: AppDatabase;
  servers: ServerRepository;
  environments: ScenarioRepository;
  tests: TestRepository;
  testService: TestService;
  collections: CollectionRepository;
  suites: SuiteRepository;
  suiteRuns: SuiteRunRepository;
  runs: RunRepository;
  skills: SkillRepository;
  serverId: string;
  environmentId: string;
  testId: string;
  skillId: string;
  skillVersionId: string;
};

function buildFixture(): Fixture {
  const db = createDatabase();
  const secrets = new SecretStore(Buffer.alloc(32, 7));
  const servers = new ServerRepository(db, secrets);
  const environments = new ScenarioRepository(db);
  const tests = new TestRepository(db);
  const testService = new TestService(tests, tempAttachmentsDir());
  const collections = new CollectionRepository(db, secrets);
  const suites = new SuiteRepository(db);
  const suiteRuns = new SuiteRunRepository(db);
  const runs = new RunRepository(db);
  const skills = new SkillRepository(db, secrets);

  seedProvider(db);

  const server = servers.create({
    name: "Filesystem MCP",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    env: { API_TOKEN: SECRET_ENV_VALUE },
  });

  const environment = environments.create({
    name: "Baseline environment",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    params: {},
    systemPrompt: "You are a test harness.",
    allowedServers: [{ serverId: server.id, allowedTools: null }],
    allowedSkills: [],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 10 },
    toolLoadingMode: "eager",
  });

  const testRow = tests.create({
    name: "List files",
    userPrompt: "List the files, then answer.",
    addedProfiles: [],
    tags: ["smoke"],
  });

  const skill = skills.create({
    name: "pdf-tools",
    sourceType: "upload",
    description: "Work with PDFs",
  });
  const v1 = skills.createVersion(
    skill.id,
    [{ path: "SKILL.md", bytes: Buffer.from("---\nname: pdf-tools\n---\nBody.", "utf8") }],
    {
      sourceKind: "upload",
      importedFrom: "upload",
      manifest: { name: "pdf-tools", description: "Work with PDFs" },
    },
  );
  if (v1.unchanged) throw new Error("fixture setup expected a fresh version");

  const deps: WriteToolDeps = {
    tests: testService,
    environments,
    servers,
    collections,
    suites,
    skills,
  };

  return {
    deps,
    db,
    servers,
    environments,
    tests,
    testService,
    collections,
    suites,
    suiteRuns,
    runs,
    skills,
    serverId: server.id,
    environmentId: environment.id,
    testId: testRow.id,
    skillId: skill.id,
    skillVersionId: v1.version.id,
  };
}

type ToolDefs = ReturnType<typeof buildWriteToolDefinitions>;

function toolFor(defs: ToolDefs, name: string) {
  const def = defs.find((d) => d.name === name);
  if (!def) throw new Error(`no write tool registered named "${name}"`);
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

// ── Tool inventory sanity ───────────────────────────────────────────────────────────────────────────

test("ASSISTANT_WRITE_TOOL_NAMES matches the actual tool definitions exactly, no duplicates", () => {
  const { deps } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const names = defs.map((d) => d.name);
  assert.deepEqual([...names].sort(), [...ASSISTANT_WRITE_TOOL_NAMES].sort());
  assert.equal(new Set(names).size, names.length, "no duplicate tool names");
  for (const def of defs)
    assert.ok(def.description.length > 10, `${def.name} needs a real description`);
});

// ── The no-secrets belt-and-braces test (rule 5) ────────────────────────────────────────────────────
//
// Every write tool's top-level input-schema KEYS must not look secret-shaped. A naive unanchored
// substring test against /env|header|secret|token|key|password|credential/i would FALSE-POSITIVE on
// this WP's OWN legitimate `environmentId` argument (used by every `environments_*` tool) — "env" is a
// substring of "environment", but "environment" the word is not an abbreviation of "env" the secret
// field name. So this splits each key into words (camelCase-aware) and requires a WHOLE-WORD match
// against the secret vocabulary, which still catches every real secret-shaped field name used
// elsewhere in this app (`env`, `headers`, `token`, `key`/`apiKey`, `clientSecret`, `password`,
// `credential`, `pat`) without flagging `environmentId`/`environmentsLink`/`pinnedVersionId`/etc.
const SECRET_WORDS = new Set([
  "env",
  "envs",
  "header",
  "headers",
  "secret",
  "secrets",
  "token",
  "tokens",
  "key",
  "keys",
  "password",
  "passwords",
  "credential",
  "credentials",
  "pat",
]);

function wordsOf(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

test("environmentId (and every other legitimate id/name field) does NOT trip the secret-word matcher", () => {
  // Guards the guard: proves wordsOf/SECRET_WORDS itself is word-bounded, not a substring test — the
  // exact false positive this test suite must avoid (see the banner above).
  assert.deepEqual(wordsOf("environmentId"), ["environment", "id"]);
  assert.equal(
    wordsOf("environmentId").some((w) => SECRET_WORDS.has(w)),
    false,
  );
  for (const benign of [
    "pinnedVersionId",
    "repoUrl",
    "contentBase64",
    "collectionId",
    "suiteId",
    "testId",
  ]) {
    assert.equal(
      wordsOf(benign).some((w) => SECRET_WORDS.has(w)),
      false,
      `${benign} must not be flagged as secret-shaped`,
    );
  }
  // And the matcher DOES catch the real thing, proving it's not just permissive.
  for (const realSecret of [
    "env",
    "headers",
    "token",
    "apiKey",
    "clientSecret",
    "password",
    "pat",
  ]) {
    assert.equal(
      wordsOf(realSecret).some((w) => SECRET_WORDS.has(w)),
      true,
      `${realSecret} must be flagged as secret-shaped`,
    );
  }
});

test("no write-tool input schema declares a secret-shaped top-level key (rule 5)", () => {
  const { deps } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  for (const def of defs) {
    const flagged = Object.keys(def.inputSchema).filter((key) =>
      wordsOf(key).some((w) => SECRET_WORDS.has(w)),
    );
    assert.deepEqual(flagged, [], `${def.name} must not declare a secret-shaped key`);
  }
});

test("servers_update_config's schema declares NO env/headers/auth key at all (by construction, not merely unset)", () => {
  const { deps } = buildFixture();
  const def = toolFor(buildWriteToolDefinitions(deps), "servers_update_config");
  const keys = Object.keys(def.inputSchema);
  assert.deepEqual([...keys].sort(), ["args", "command", "name", "serverId", "transport", "url"]);
});

test("collections_modify's schema declares NO pat key at all (by construction)", () => {
  const { deps } = buildFixture();
  const def = toolFor(buildWriteToolDefinitions(deps), "collections_modify");
  assert.equal(Object.hasOwn(def.inputSchema, "pat"), false);
});

// ── tests_create / tests_update / tests_delete / expectations_set / attachments_manage ────────────

test("tests_create creates a real test row and returns a compact confirmation", async () => {
  const { deps, tests } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const out = await call<{ testId: string; name: string; collectionId: string | null }>(
    defs,
    "tests_create",
    {
      name: "New test",
      userPrompt: "Do the thing.",
      tags: ["a", "b"],
    },
  );
  assert.equal(out.name, "New test");
  const row = tests.get(out.testId);
  assert.equal(row.userPrompt, "Do the thing.");
  assert.deepEqual(row.tags, ["a", "b"]);
  assert.equal(
    row.collectionId,
    out.collectionId,
    "defaulted to the local collection, reported back",
  );
});

test("tests_create with a missing required field errors (reuses testInputSchema's own validation)", async () => {
  const { deps } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "tests_create", { name: "No prompt" });
  assert.match(err, /userPrompt|required|invalid/i);
});

test("tests_update is a FULL REPLACE — an omitted optional field is cleared, not preserved", async () => {
  const { deps, tests, testId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  tests.update(testId, {
    name: "List files",
    userPrompt: "List the files, then answer.",
    addedProfiles: [],
    tags: ["keep-me"],
    category: "filesystem",
  });

  await call(defs, "tests_update", {
    testId,
    name: "List files",
    userPrompt: "List the files, then answer.",
    addedProfiles: [],
    tags: [],
    // category omitted — must be cleared, not preserved.
  });

  const row = tests.get(testId);
  assert.equal(row.category, undefined, "category was cleared by the full-replace update");
});

test("tests_update on an unknown testId errors (404 from the repository)", async () => {
  const { deps } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "tests_update", {
    testId: "does-not-exist",
    name: "x",
    userPrompt: "y",
    addedProfiles: [],
    tags: [],
  });
  assert.match(err, /not found/i);
});

test("tests_delete removes the row, its attachment blob files, and CASCADES to its runs", async () => {
  const { deps, tests, testService, testId, environmentId, runs } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);

  const attachment = testService.addAttachment(testId, {
    kind: "text",
    name: "notes.txt",
    contentBase64: Buffer.from("hello", "utf8").toString("base64"),
  });
  const blobPath = tests.listAttachmentRecords(testId)[0]?.path;
  assert.ok(blobPath && fs.existsSync(blobPath), "attachment blob is on disk before delete");

  const runId = "run-under-test";
  runs.createRun(runId, { testId, scenarioId: environmentId, mode: "automated" });

  await call(defs, "tests_delete", { testId });

  assert.throws(() => tests.get(testId), /not found/i);
  assert.throws(() => runs.getRun(runId), /not found/i, "the run cascaded away with its test");
  assert.equal(
    fs.existsSync(blobPath as string),
    false,
    "the attachment blob was removed from disk",
  );
  void attachment;
});

test("expectations_set changes ONLY the expectations block, preserving every other field", async () => {
  const { deps, tests, testId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  tests.update(testId, {
    name: "List files",
    userPrompt: "List the files, then answer.",
    addedProfiles: [],
    tags: ["keep-me"],
    category: "filesystem",
  });

  const out = await call<{ testId: string; expectations: { expectedInsight?: string } }>(
    defs,
    "expectations_set",
    { testId, expectations: { expectedInsight: "There are 3 files." } },
  );
  assert.equal(out.expectations.expectedInsight, "There are 3 files.");

  const row = tests.get(testId);
  assert.equal(row.expectations?.expectedInsight, "There are 3 files.");
  assert.equal(row.category, "filesystem", "category preserved");
  assert.deepEqual(row.tags, ["keep-me"], "tags preserved");
});

test("expectations_set on an unknown testId errors (404)", async () => {
  const { deps } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "expectations_set", { testId: "nope", expectations: {} });
  assert.match(err, /not found/i);
});

test("attachments_manage (action: add) writes a real blob to disk and records it on the test", async () => {
  const { deps, tests, testId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const content = "line one\nline two";
  const out = await call<{
    testId: string;
    attachment: { id: string; name: string; bytes: number };
  }>(defs, "attachments_manage", {
    testId,
    action: "add",
    kind: "text",
    name: "notes.txt",
    contentBase64: Buffer.from(content, "utf8").toString("base64"),
  });
  assert.equal(out.attachment.name, "notes.txt");
  const record = tests.listAttachmentRecords(testId).find((r) => r.id === out.attachment.id);
  assert.ok(record, "attachment row exists");
  assert.equal(fs.readFileSync(record!.path, "utf8"), content, "the blob's actual bytes match");
});

test("attachments_manage rejects invalid base64 (reuses TestService's own validation)", async () => {
  const { deps, testId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "attachments_manage", {
    testId,
    action: "add",
    kind: "text",
    name: "bad.txt",
    contentBase64: "not-valid-base64!!!",
  });
  assert.match(err, /base64/i);
});

// ── environments_create / environments_update / environments_delete ────────────────────────────────

test("environments_create creates a real scenario row", async () => {
  const { deps, environments } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const out = await call<{ environmentId: string; name: string }>(defs, "environments_create", {
    name: "Second environment",
    providerId: "prov-1",
    model: "claude-sonnet-4",
    systemPrompt: "Be terse.",
    allowedServers: [],
    allowedSkills: [],
    toolLoadingMode: "eager",
  });
  const row = environments.get(out.environmentId);
  assert.equal(row.name, "Second environment");
  assert.equal(row.systemPrompt, "Be terse.");
});

test("environments_update is a FULL REPLACE — omitting allowedSkills CLEARS every skill attachment", async () => {
  const { deps, environments, environmentId, skillId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const current = environments.get(environmentId);
  environments.update(environmentId, {
    ...current,
    allowedSkills: [{ skillId, versionMode: "latest", eager: false }],
  });
  assert.equal(environments.get(environmentId).allowedSkills.length, 1);

  await call(defs, "environments_update", {
    environmentId,
    name: current.name,
    providerId: current.providerId,
    model: current.model,
    systemPrompt: current.systemPrompt,
    allowedServers: current.allowedServers,
    // allowedSkills intentionally omitted.
    toolLoadingMode: current.toolLoadingMode,
  });

  assert.equal(
    environments.get(environmentId).allowedSkills.length,
    0,
    "cleared by the full-replace update",
  );
});

test("environments_update on an unknown environmentId errors (404)", async () => {
  const { deps } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "environments_update", {
    environmentId: "does-not-exist",
    name: "x",
    providerId: "prov-1",
    model: "m",
    systemPrompt: "",
    allowedServers: [],
    allowedSkills: [],
    toolLoadingMode: "eager",
  });
  assert.match(err, /not found/i);
});

test("environments_delete removes the row and CASCADES to its runs", async () => {
  const { deps, environments, environmentId, testId, runs } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const runId = "run-under-env";
  runs.createRun(runId, { testId, scenarioId: environmentId, mode: "automated" });

  await call(defs, "environments_delete", { environmentId });

  assert.throws(() => environments.get(environmentId), /not found/i);
  assert.throws(
    () => runs.getRun(runId),
    /not found/i,
    "the run cascaded away with its environment",
  );
});

// ── environments_attach_skill / environments_detach_skill ──────────────────────────────────────────

test("environments_attach_skill (latest) attaches without disturbing an already-attached OTHER skill", async () => {
  const { deps, environments, skills, environmentId, skillId } = buildFixture();
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
  const current = environments.get(environmentId);
  environments.update(environmentId, {
    ...current,
    allowedSkills: [{ skillId: other.id, versionMode: "latest", eager: false }],
  });

  const defs = buildWriteToolDefinitions(deps);
  const out = await call<{ allowedSkillsCount: number }>(defs, "environments_attach_skill", {
    environmentId,
    skillId,
    versionMode: "latest",
  });
  assert.equal(out.allowedSkillsCount, 2);
  const row = environments.get(environmentId);
  assert.ok(
    row.allowedSkills.some((s) => s.skillId === other.id),
    "the pre-existing attachment survives",
  );
  assert.ok(
    row.allowedSkills.some((s) => s.skillId === skillId),
    "the new attachment was added",
  );
});

test("environments_attach_skill (pinned) re-pins an already-attached skill in place (no duplicate entry)", async () => {
  const { deps, environments, environmentId, skillId, skillVersionId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  await call(defs, "environments_attach_skill", { environmentId, skillId, versionMode: "latest" });
  const out = await call<{ allowedSkillsCount: number }>(defs, "environments_attach_skill", {
    environmentId,
    skillId,
    versionMode: "pinned",
    pinnedVersionId: skillVersionId,
    eager: true,
  });
  assert.equal(out.allowedSkillsCount, 1, "re-attach updates in place, no duplicate");
  const row = environments.get(environmentId);
  assert.equal(row.allowedSkills.length, 1);
  assert.equal(row.allowedSkills[0]?.versionMode, "pinned");
  assert.equal(row.allowedSkills[0]?.pinnedVersionId, skillVersionId);
  assert.equal(row.allowedSkills[0]?.eager, true);
});

test("environments_attach_skill (pinned) without pinnedVersionId errors before mutating anything", async () => {
  const { deps, environments, environmentId, skillId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "environments_attach_skill", {
    environmentId,
    skillId,
    versionMode: "pinned",
  });
  assert.match(err, /pinnedVersionId is required/i);
  assert.equal(environments.get(environmentId).allowedSkills.length, 0, "no mutation happened");
});

test("environments_attach_skill on an unknown skill errors (reuses assertSkillOverridesResolvable)", async () => {
  const { deps, environmentId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "environments_attach_skill", {
    environmentId,
    skillId: "does-not-exist",
    versionMode: "latest",
  });
  assert.match(err, /no longer exists/i);
});

test("environments_detach_skill removes the attachment; detaching an unattached skill is a harmless no-op", async () => {
  const { deps, environments, environmentId, skillId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  await call(defs, "environments_attach_skill", { environmentId, skillId, versionMode: "latest" });

  const out = await call<{ wasAttached: boolean; allowedSkillsCount: number }>(
    defs,
    "environments_detach_skill",
    { environmentId, skillId },
  );
  assert.equal(out.wasAttached, true);
  assert.equal(out.allowedSkillsCount, 0);
  assert.equal(environments.get(environmentId).allowedSkills.length, 0);

  const again = await call<{ wasAttached: boolean }>(defs, "environments_detach_skill", {
    environmentId,
    skillId,
  });
  assert.equal(again.wasAttached, false, "already-detached is a no-op, not an error");
});

// ── servers_update_config ───────────────────────────────────────────────────────────────────────────

test("servers_update_config renames a server WITHOUT touching its secret env/headers", async () => {
  const { deps, servers, serverId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const out = await call<{ serverId: string; name: string; serverLink: string }>(
    defs,
    "servers_update_config",
    {
      serverId,
      name: "Renamed server",
    },
  );
  assert.equal(out.name, "Renamed server");
  assert.equal(out.serverLink, `/servers/${serverId}`);

  const internal = servers.getInternal(serverId);
  assert.equal(internal.env?.API_TOKEN, SECRET_ENV_VALUE, "the secret env var is untouched");
  assert.equal(servers.getPublic(serverId).hasEnvSecrets, true);
});

test("servers_update_config surfaces the underlying schema's own validation error (stdio -> http with no url)", async () => {
  const { deps, serverId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "servers_update_config", {
    serverId,
    transport: "streamable_http",
  });
  assert.match(err, /url is required/i);
});

test("servers_update_config on an unknown serverId errors (404)", async () => {
  const { deps } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "servers_update_config", { serverId: "nope", name: "x" });
  assert.match(err, /not found/i);
});

// ── collections_modify ─────────────────────────────────────────────────────────────────────────────

test("collections_modify update_metadata renames a collection and NEVER touches its PAT", async () => {
  const { deps, collections } = buildFixture();
  const created = collections.create({
    name: "Nightly",
    repoUrl: "https://github.com/acme/skills",
    repoPath: "",
    branch: "main",
    pat: "ghp_original_secret",
  });
  const originalPat = collections.decryptPat(created.id);

  const defs = buildWriteToolDefinitions(deps);
  const out = await call<{ name: string; collectionLink: string }>(defs, "collections_modify", {
    action: "update_metadata",
    collectionId: created.id,
    name: "Nightly (renamed)",
  });
  assert.equal(out.name, "Nightly (renamed)");
  assert.equal(out.collectionLink, `/testing/collections/${created.id}`);

  const row = collections.get(created.id);
  assert.equal(row.name, "Nightly (renamed)");
  assert.equal(
    row.repoUrl,
    "https://github.com/acme/skills",
    "binding preserved (omitted, not cleared)",
  );
  assert.equal(row.hasPat, true);
  assert.equal(
    collections.decryptPat(created.id),
    originalPat,
    "the PAT itself is byte-identical — never touched",
  );
});

test("collections_modify update_metadata without collectionId errors before touching anything", async () => {
  const { deps } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "collections_modify", {
    action: "update_metadata",
    name: "x",
  });
  assert.match(err, /collectionId.*required/i);
});

test('collections_modify update_metadata on the reserved default "Local" collection is rejected', async () => {
  const { deps, collections } = buildFixture();
  const local = collections.list().find((c) => c.isDefault);
  assert.ok(local, "fixture DB has the seeded default Local collection");
  const defs = buildWriteToolDefinitions(deps);
  const err = await callExpectError(defs, "collections_modify", {
    action: "update_metadata",
    collectionId: local!.id,
    name: "Hijacked",
  });
  assert.match(err, /cannot be renamed|reserved/i);
});

test("collections_modify assign_test / remove_test move a test's membership (reversible, not a delete)", async () => {
  const { deps, collections, testId } = buildFixture();
  const target = collections.create({ name: "Target collection" });
  const defs = buildWriteToolDefinitions(deps);

  await call(defs, "collections_modify", {
    action: "assign_test",
    collectionId: target.id,
    testId,
  });
  assert.equal(collections.get(target.id) !== undefined, true);

  const removed = await call<{ action: string; testId: string }>(defs, "collections_modify", {
    action: "remove_test",
    testId,
  });
  assert.equal(removed.action, "remove_test");
});

test("collections_modify assign_suite / remove_suite move a suite's membership", async () => {
  const { deps, collections, suites, testId, environmentId } = buildFixture();
  const suite = suites.create({
    name: "Nightly suite",
    config: { repetitions: 1, maxConcurrency: 1 },
    testIds: [testId],
    scenarioIds: [environmentId],
  });
  const target = collections.create({ name: "Suite home" });
  const defs = buildWriteToolDefinitions(deps);

  await call(defs, "collections_modify", {
    action: "assign_suite",
    collectionId: target.id,
    suiteId: suite.id,
  });
  assert.equal(suites.get(suite.id).collectionId, target.id);

  await call(defs, "collections_modify", { action: "remove_suite", suiteId: suite.id });
  assert.equal(suites.get(suite.id).collectionId, null);
});

// ── suites_create / suites_update / suites_delete ───────────────────────────────────────────────────

test("suites_create creates a real suite row", async () => {
  const { deps, suites, testId, environmentId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const out = await call<{ suiteId: string; suiteLink: string; testCount: number }>(
    defs,
    "suites_create",
    {
      name: "Nightly suite",
      config: { repetitions: 2, maxConcurrency: 1 },
      testIds: [testId],
      scenarioIds: [environmentId],
    },
  );
  assert.equal(out.suiteLink, `/testing/suites/${out.suiteId}`);
  assert.equal(out.testCount, 1);
  const row = suites.get(out.suiteId);
  assert.equal(row.config.repetitions, 2);
});

test("suites_update requires the full membership/config — an incomplete payload fails validation, not silent clearing", async () => {
  const { deps, testId, environmentId } = buildFixture();
  const defs = buildWriteToolDefinitions(deps);
  const made = await call<{ suiteId: string }>(defs, "suites_create", {
    name: "Suite",
    config: { repetitions: 1, maxConcurrency: 1 },
    testIds: [testId],
    scenarioIds: [environmentId],
  });
  // testIds/scenarioIds/config are all REQUIRED (no `.optional()`/`.default()`) on suiteInputSchema —
  // omitting them fails zod parse rather than silently wiping the suite's membership.
  const err = await callExpectError(defs, "suites_update", {
    suiteId: made.suiteId,
    name: "Suite",
  });
  assert.match(err, /required|invalid/i);
});

test("suites_delete removes the suite + its suite_runs, but member RUNS survive (denormalized, not FK'd)", async () => {
  const { deps, suites, suiteRuns, runs, testId, environmentId } = buildFixture();
  const suite = suites.create({
    name: "Nightly suite",
    config: { repetitions: 1, maxConcurrency: 1 },
    testIds: [testId],
    scenarioIds: [environmentId],
  });
  const suiteRun = suiteRuns.create(suite.id, { repetitions: 1, maxConcurrency: 1 }, "suite");
  const runId = "run-under-suite";
  runs.createRun(runId, { testId, scenarioId: environmentId, mode: "automated" });
  runs.linkRunToSuite(runId, suiteRun.id, 1);

  const defs = buildWriteToolDefinitions(deps);
  await call(defs, "suites_delete", { suiteId: suite.id });

  assert.throws(() => suites.get(suite.id), /not found/i);
  assert.throws(
    () => suiteRuns.getRun(suiteRun.id),
    /not found/i,
    "the suite run cascaded away with its suite",
  );
  const survivingRun = runs.getRun(runId);
  assert.equal(survivingRun.id, runId, "the member run itself survives suite deletion");
});

// ── Permission classification (WP 2.1 wiring — EXPLICIT_DELETE_TOOLS) ─────────────────────────────

test("every WP 2.3 write tool classifies as write, except the three *_delete tools which are delete (always ask)", () => {
  const deleteTools = new Set(["tests_delete", "environments_delete", "suites_delete"]);
  for (const name of ASSISTANT_WRITE_TOOL_NAMES) {
    const expected = deleteTools.has(name) ? "delete" : "write";
    assert.equal(classifyTool(name), expected, `${name} bare`);
    assert.equal(classifyTool(`mcp__assistant-app__${name}`), expected, `${name} prefixed`);
    assert.equal(requiresApproval(expected), true, `${name} must require approval either way`);
  }
});

test("the three delete tools never auto-accept, even though every other write tool may", () => {
  for (const name of ["tests_delete", "environments_delete", "suites_delete"]) {
    assert.equal(autoAcceptEligible(classifyTool(name)), false, `${name} must never auto-accept`);
  }
  for (const name of ASSISTANT_WRITE_TOOL_NAMES) {
    if (["tests_delete", "environments_delete", "suites_delete"].includes(name)) continue;
    assert.equal(
      autoAcceptEligible(classifyTool(name)),
      true,
      `${name} should be auto-accept-eligible`,
    );
  }
});
