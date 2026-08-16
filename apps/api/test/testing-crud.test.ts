import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ScanRepository } from "../src/scans/repository.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { resolveProfiles, resolveSystemPrompt, unionProfiles } from "../src/testing/resolution.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import type { Scenario, Test } from "@mcp-token-footprint/shared";

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close();
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);
  return db;
}

function tempAttachmentsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-attach-"));
  tempDirs.push(dir);
  return dir;
}

function seedProvider(db: AppDatabase, id = "prov-1"): string {
  db.prepare(
    `INSERT INTO provider_credentials (id, kind, label, base_url, api_key_encrypted, created_at, updated_at)
     VALUES (@id, 'anthropic', 'Claude', NULL, 'enc:v1:abc', @ts, @ts)`,
  ).run({ id, ts: "2026-06-20T00:00:00.000Z" });
  return id;
}

function seedServer(db: AppDatabase, id = "srv-1"): string {
  db.prepare(
    `INSERT INTO mcp_servers (id, name, transport, command, args_json, url, headers_json, env_json, created_at, updated_at)
     VALUES (@id, 'Filesystem', 'stdio', 'npx', '[]', NULL, '{}', '{}', @ts, @ts)`,
  ).run({ id, ts: "2026-06-20T00:00:00.000Z" });
  return id;
}

// Seed a successful scan with the given tool names so resolveAllowedTools has scanned tools to read.
function seedScanWithTools(scans: ScanRepository, serverId: string, toolNames: string[]): void {
  const scan = scans.createRunningScan(serverId, "generic_o200k");
  scans.completeScan(
    scan.id,
    {
      totalTools: toolNames.length,
      totalTokens: 0,
      totalRawBytes: 0,
      averageTokensPerTool: 0,
      largestToolName: toolNames[0] ?? null,
      largestToolTokens: 0,
      totalResources: 0,
      totalResourceTemplates: 0,
      totalPrompts: 0,
      totalResourceTokens: 0,
      totalPromptTokens: 0,
      largestResourceName: null,
      largestResourceTokens: 0,
      largestPromptName: null,
      largestPromptTokens: 0,
    },
    toolNames.map((name) => ({
      toolName: name,
      description: `desc for ${name}`,
      inputSchema: { type: "object" },
      annotations: undefined,
      rawTool: { name },
      totalTokens: 0,
      nameTokens: 0,
      descriptionTokens: 0,
      schemaTokens: 0,
      annotationsTokens: 0,
      rawBytes: 0,
      contributionPercent: 0,
    })),
  );
}

test("scenario CRUD round-trips and upserts scenario_servers from the allow-list", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const server = seedServer(db);
  const repo = new ScenarioRepository(db);

  const created = repo.create({
    name: "Baseline",
    providerId: provider,
    model: "claude-sonnet-4-5",
    params: { temperature: 0 },
    systemPrompt: "You are helpful.",
    allowedServers: [{ serverId: server, allowedTools: ["read_file"] }],
    defaultProfiles: ["generic_o200k"],
    guardrails: { maxTurns: 10 },
  });

  assert.equal(created.name, "Baseline");
  assert.deepEqual(created.allowedServers, [{ serverId: server, allowedTools: ["read_file"] }]);

  // The scenario_servers row was written.
  const rows = db.prepare("SELECT * FROM scenario_servers WHERE scenario_id = ?").all(created.id);
  assert.equal(rows.length, 1);

  // get + list see it.
  assert.deepEqual(repo.get(created.id).allowedServers, created.allowedServers);
  assert.equal(repo.list().length, 1);

  // Update re-upserts the allow-list (null = all tools).
  const updated = repo.update(created.id, {
    name: "Baseline v2",
    providerId: provider,
    model: "claude-sonnet-4-5",
    params: {},
    systemPrompt: "Be concise.",
    allowedServers: [{ serverId: server, allowedTools: null }],
    defaultProfiles: ["generic_o200k", "generic_cl100k"],
    guardrails: {},
  });
  assert.equal(updated.name, "Baseline v2");
  assert.deepEqual(updated.allowedServers, [{ serverId: server, allowedTools: null }]);
  assert.equal(
    db
      .prepare("SELECT allowed_tools_json FROM scenario_servers WHERE scenario_id = ?")
      .get(created.id) !== undefined,
    true,
  );
  assert.equal(
    (
      db
        .prepare("SELECT allowed_tools_json FROM scenario_servers WHERE scenario_id = ?")
        .get(created.id) as { allowed_tools_json: string | null }
    ).allowed_tools_json,
    null,
  );

  // Delete cascades the scenario_servers rows.
  repo.delete(created.id);
  assert.equal(repo.list().length, 0);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM scenario_servers").get() as { n: number }).n,
    0,
  );
});

test("test CRUD round-trips and stores a base64 attachment blob + row", () => {
  const db = createDatabase();
  const repo = new TestRepository(db);
  const dir = tempAttachmentsDir();
  const service = new TestService(repo, dir);

  const created = service.create({
    name: "List files",
    userPrompt: "List the files in /tmp",
    systemPromptOverride: undefined,
    addedProfiles: ["generic_o200k"],
  });
  assert.equal(created.name, "List files");
  assert.deepEqual(created.attachments, []);

  // Update round-trip.
  const updated = service.update(created.id, {
    name: "List files v2",
    userPrompt: "List the files in /var",
    systemPromptOverride: "Override prompt",
    addedProfiles: [],
  });
  assert.equal(updated.name, "List files v2");
  assert.equal(updated.systemPromptOverride, "Override prompt");

  // Attachment via base64-in-JSON: blob is written to disk, row inserted.
  const content = "hello attachment world";
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");
  const attachment = service.addAttachment(created.id, {
    kind: "text",
    name: "note.txt",
    contentBase64,
  });

  assert.equal(attachment.kind, "text");
  assert.equal(attachment.name, "note.txt");
  assert.equal(attachment.bytes, Buffer.byteLength(content, "utf8"));

  // Blob exists on disk at ATTACHMENTS_DIR/<id> with the decoded contents.
  const blobPath = path.join(dir, attachment.id);
  assert.equal(fs.existsSync(blobPath), true);
  assert.equal(fs.readFileSync(blobPath, "utf8"), content);

  // Row is queryable and reflected on the test.
  const rows = db.prepare("SELECT * FROM test_attachments WHERE test_id = ?").all(created.id);
  assert.equal(rows.length, 1);
  assert.equal(service.get(created.id).attachments.length, 1);

  // Delete removes the blob and the rows.
  service.delete(created.id);
  assert.equal(fs.existsSync(blobPath), false);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tests").get() as { n: number }).n, 0);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM test_attachments").get() as { n: number }).n,
    0,
  );
});

test("addAttachment rejects invalid base64 and a missing test", () => {
  const db = createDatabase();
  const repo = new TestRepository(db);
  const service = new TestService(repo, tempAttachmentsDir());
  const created = service.create({
    name: "T",
    userPrompt: "p",
    systemPromptOverride: undefined,
    addedProfiles: [],
  });

  assert.throws(
    () =>
      service.addAttachment(created.id, {
        kind: "text",
        name: "x",
        contentBase64: "!!!not base64!!!",
      }),
    /valid base64/,
  );
  assert.throws(
    () =>
      service.addAttachment("missing-test", {
        kind: "text",
        name: "x",
        contentBase64: Buffer.from("hi").toString("base64"),
      }),
    /Test not found/,
  );
});

test("resolveAllowedTools returns exactly the selected tools; toggles change the set; null = all", () => {
  const db = createDatabase();
  const provider = seedProvider(db);
  const server = seedServer(db);
  const scans = new ScanRepository(db);
  seedScanWithTools(scans, server, ["read_file", "write_file", "list_dir"]);

  const scenarioRepo = new ScenarioRepository(db);
  const service = new ScenarioService(scenarioRepo, scans);

  // Per-tool allow-list selects exactly two of the three scanned tools.
  const selective = scenarioRepo.create({
    name: "Selective",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [{ serverId: server, allowedTools: ["read_file", "list_dir"] }],
    defaultProfiles: [],
    guardrails: {},
  });
  const selectiveResolved = service.resolveAllowedTools(selective.id);
  assert.equal(selectiveResolved.length, 1);
  assert.equal(selectiveResolved[0]?.serverId, server);
  assert.deepEqual(selectiveResolved[0]?.tools.map((t) => t.name).sort(), [
    "list_dir",
    "read_file",
  ]);

  // Flipping a toggle (drop list_dir, add write_file) changes the resolved set.
  scenarioRepo.update(selective.id, {
    name: "Selective",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [{ serverId: server, allowedTools: ["read_file", "write_file"] }],
    defaultProfiles: [],
    guardrails: {},
  });
  assert.deepEqual(
    service
      .resolveAllowedTools(selective.id)[0]
      ?.tools.map((t) => t.name)
      .sort(),
    ["read_file", "write_file"],
  );

  // null allowed_tools = all of the server's scanned tools.
  const all = scenarioRepo.create({
    name: "All",
    providerId: provider,
    model: "m",
    params: {},
    systemPrompt: "",
    allowedServers: [{ serverId: server, allowedTools: null }],
    defaultProfiles: [],
    guardrails: {},
  });
  assert.deepEqual(
    service
      .resolveAllowedTools(all.id)[0]
      ?.tools.map((t) => t.name)
      .sort(),
    ["list_dir", "read_file", "write_file"],
  );

  // Resolved tools carry the normalized definition shape (name + description + schema + raw).
  const firstTool = service
    .resolveAllowedTools(all.id)[0]
    ?.tools.find((t) => t.name === "read_file");
  assert.equal(firstTool?.description, "desc for read_file");
  assert.deepEqual(firstTool?.inputSchema, { type: "object" });
});

test("effective profiles union/dedupe and system-prompt override resolution", () => {
  // unionProfiles dedupes, scenario defaults first.
  assert.deepEqual(unionProfiles(["generic_o200k"], ["generic_o200k", "generic_cl100k"]), [
    "generic_o200k",
    "generic_cl100k",
  ]);
  assert.deepEqual(unionProfiles([], []), []);
  assert.deepEqual(unionProfiles(["generic_cl100k"], ["generic_o200k"]), [
    "generic_cl100k",
    "generic_o200k",
  ]);

  const scenario = {
    defaultProfiles: ["generic_o200k"],
    systemPrompt: "scenario prompt",
  } as unknown as Scenario;
  const testWithAdds = {
    addedProfiles: ["raw_json_rough"],
    systemPromptOverride: undefined,
  } as unknown as Test;
  assert.deepEqual(resolveProfiles(scenario, testWithAdds), ["generic_o200k", "raw_json_rough"]);

  // System prompt: override wins when present (including empty string); undefined falls back.
  assert.equal(resolveSystemPrompt("scenario prompt", undefined), "scenario prompt");
  assert.equal(resolveSystemPrompt("scenario prompt", "test override"), "test override");
  assert.equal(resolveSystemPrompt("scenario prompt", ""), "");
});
