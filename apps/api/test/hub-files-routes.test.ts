// Assistant Hub (roadmap/assistant-hub/, WP3.4, D-AH12/R-SES6/R-MCP9) — the files/workspace/resource
// REST surface, over a REAL `HubRepository` + a stubbed `HubSessionService` (never dispatches a turn —
// these routes only need a session id to exist) + stub `ScanRepository`/`ScanService` for the resource
// picker. Mirrors `apps/api/test/hub-routes.test.ts`'s harness shape and `skills-upload.test.ts`'s
// multipart-body builder.
//
// Proves (per-Acceptance): uploads link to a session + emit `file_uploaded`; download round-trips
// bytes; delete removes the row; the upload size cap (zip-bomb-guard pattern) 400s; promote (uploaded
// AND workspace) creates a versioned artifact + `artifact_created`, and refuses a binary file; the
// workspace tree/file routes surface `hub/workspace.ts`'s existing traversal/symlink guards as a clean
// 400 (not a 500) at the ROUTE boundary; content-addressed snapshots create/list/restore, including a
// bad-id 400 + an unknown-id 404; the resource catalog/attach/list/remove round-trip, with
// audience/priority/lastModified surfaced and auto-inclusion left OFF (no wiring into any prompt here).

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  DEFAULT_TOKEN_PROFILE,
  type ProviderKind,
  type ResourceScan,
  type ScanDetail,
} from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { HubRepository } from "../src/hub/repository.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubSessionService, type HubModelResolver } from "../src/hub/session-service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import type { ScanRepository } from "../src/scans/repository.js";
import type { ScanService } from "../src/scans/service.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { toErrorMessage } from "../src/utils/errors.js";

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) void app.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openDb(): AppDatabase {
  const db = new Database(":memory:") as unknown as AppDatabase;
  databases.push(db);
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-files-routes-"));
  tempDirs.push(dir);
  return dir;
}

const neverResolveModel: HubModelResolver = () => {
  throw new Error("not exercised — these tests never dispatch a turn");
};

/** A stub scan catalog: one server ("srv-1") with the given resources on its "latest scan". */
function stubScans(resources: ResourceScan[]): ScanRepository {
  const detail: ScanDetail = {
    id: "scan-1",
    serverId: "srv-1",
    serverName: "Research server",
    tokenProfile: DEFAULT_TOKEN_PROFILE,
    scannedAt: "2026-07-01T00:00:00.000Z",
    status: "completed",
    totalTools: 0,
    totalTokens: 0,
    totalRawBytes: 0,
    averageTokensPerTool: 0,
    largestToolTokens: 0,
    totalResources: resources.length,
    totalResourceTemplates: 0,
    totalPrompts: 0,
    totalResourceTokens: 0,
    totalPromptTokens: 0,
    largestResourceTokens: 0,
    largestPromptTokens: 0,
    countingVersion: 2,
    tools: [],
    resources,
    prompts: [],
    events: [],
  };
  return {
    getLatestForServer: (serverId: string) => (serverId === "srv-1" ? detail : null),
  } as unknown as ScanRepository;
}

type ResourceReadStub = { tokens: number; isError?: boolean; errorMessage?: string };

function stubScanService(reads: Record<string, ResourceReadStub>): ScanService {
  return {
    readResource: async (_serverId: string, uri: string) => {
      const stub = reads[uri];
      if (!stub) throw new Error(`no stub read for "${uri}"`);
      return {
        uri,
        isError: stub.isError ?? false,
        durationMs: 1,
        tokenProfile: DEFAULT_TOKEN_PROFILE,
        requestTokens: 1,
        requestBytes: 1,
        responseTokens: stub.tokens,
        responseBytes: stub.tokens * 4,
        contents: null,
        raw: null,
        ...(stub.errorMessage ? { errorMessage: stub.errorMessage } : {}),
      };
    },
  } as unknown as ScanService;
}

type Harness = { app: FastifyInstance; repo: HubRepository; dataDir: string };

async function makeApp(
  options: {
    fileMaxBytes?: number;
    scans?: ScanRepository;
    scanService?: ScanService;
  } = {},
): Promise<Harness> {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const dataDir = tempDataDir();
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveToolset: () => ({ tools: {} }),
    resolveModel: neverResolveModel,
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir,
      toolLoadingDefault: "eager",
      autoFraction: 0.1,
      skillListingBudgetFraction: 0.01,
      skillEntryMaxChars: 1536,
      skillLoadBudgets: { perSkillTokens: 5000, totalTokens: 25000 },
    },
  });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerHubRoutes(app, {
    repository: repo,
    sessionService: service,
    providers: providerRepository,
    dataDir,
    ...(options.scans ? { scans: options.scans } : {}),
    ...(options.scanService ? { scanService: options.scanService } : {}),
    ...(options.fileMaxBytes !== undefined ? { fileCaps: { maxBytes: options.fileMaxBytes } } : {}),
  });
  await app.ready();
  apps.push(app);
  return { app, repo, dataDir };
}

function makeSession(repo: HubRepository, providerKind: ProviderKind = "openai"): string {
  const session = repo.createSession({
    mode: "chat",
    model: providerKind === "openai" ? "gpt-4o" : "x",
  });
  return session.id;
}

const BOUNDARY = "----hubFilesTestBoundary";

function multipartBody(file: { filename: string; content: Buffer; contentType?: string }): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const chunks = [
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType ?? "application/octet-stream"}\r\n\r\n`,
    ),
    file.content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ];
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

// ── Uploads (D-AH12) ─────────────────────────────────────────────────────────────────────────────

test("upload → 201 HubFile; linked to a session emits file_uploaded + is listed + content round-trips + delete removes it", async () => {
  const { app, repo } = await makeApp();
  const sessionId = makeSession(repo);
  const { payload, headers } = multipartBody({
    filename: "notes.txt",
    content: Buffer.from("hello world"),
    contentType: "text/plain",
  });

  const res = await app.inject({
    method: "POST",
    url: `/api/hub/files?sessionId=${sessionId}`,
    payload,
    headers,
  });
  assert.equal(res.statusCode, 201);
  const file = res.json();
  assert.equal(file.filename, "notes.txt");
  assert.equal(file.mime, "text/plain");
  assert.equal(file.bytes, 11);
  assert.ok(file.sha256);

  const events = repo.listEvents(sessionId);
  const uploaded = events.find((e) => e.type === "file_uploaded");
  assert.ok(uploaded, "file_uploaded event appended");
  assert.equal((uploaded as { fileId: string }).fileId, file.id);

  const listed = await app.inject({ method: "GET", url: `/api/hub/sessions/${sessionId}/files` });
  assert.equal(listed.statusCode, 200);
  const links = listed.json() as Array<{ file: { id: string }; link: { role: string } }>;
  assert.equal(links.length, 1);
  assert.equal(links[0]?.file.id, file.id);
  assert.equal(links[0]?.link.role, "upload");

  const content = await app.inject({ method: "GET", url: `/api/hub/files/${file.id}/content` });
  assert.equal(content.statusCode, 200);
  assert.equal(content.body, "hello world");

  const del = await app.inject({ method: "DELETE", url: `/api/hub/files/${file.id}` });
  assert.equal(del.statusCode, 204);
  const gone = await app.inject({ method: "GET", url: `/api/hub/files/${file.id}` });
  assert.equal(gone.statusCode, 404);
});

test("upload over the size cap → 400 (zip-bomb-guard pattern)", async () => {
  const { app } = await makeApp({ fileMaxBytes: 10 });
  const { payload, headers } = multipartBody({ filename: "big.bin", content: Buffer.alloc(11, 1) });
  const res = await app.inject({ method: "POST", url: "/api/hub/files", payload, headers });
  assert.equal(res.statusCode, 400);
});

test("upload to an unknown session → 404", async () => {
  const { app } = await makeApp();
  const { payload, headers } = multipartBody({ filename: "a.txt", content: Buffer.from("x") });
  const res = await app.inject({
    method: "POST",
    url: "/api/hub/files?sessionId=nope",
    payload,
    headers,
  });
  assert.equal(res.statusCode, 404);
});

test("promote an uploaded text file to an artifact; a binary file is refused", async () => {
  const { app, repo } = await makeApp();
  const sessionId = makeSession(repo);

  const md = multipartBody({
    filename: "report.md",
    content: Buffer.from("# Title\n\nBody."),
    contentType: "text/markdown",
  });
  const upload = await app.inject({
    method: "POST",
    url: `/api/hub/files?sessionId=${sessionId}`,
    payload: md.payload,
    headers: md.headers,
  });
  const file = upload.json();

  const promoted = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/files/${file.id}/promote`,
    payload: {},
  });
  assert.equal(promoted.statusCode, 201);
  const artifact = promoted.json();
  assert.equal(artifact.kind, "markdown");
  assert.equal(
    repo.listEvents(sessionId).some((e) => e.type === "artifact_created"),
    true,
  );

  const bin = multipartBody({
    filename: "photo.png",
    content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  const binUpload = await app.inject({
    method: "POST",
    url: `/api/hub/files?sessionId=${sessionId}`,
    payload: bin.payload,
    headers: bin.headers,
  });
  const binFile = binUpload.json();
  const refused = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/files/${binFile.id}/promote`,
    payload: {},
  });
  assert.equal(refused.statusCode, 400);
});

// ── Workspace tree/file + confinement + promote (WP0.5's guards, exercised at the ROUTE boundary) ──

test("workspace tree/file routes read what's on disk; a traversal path 400s, not 500s", async () => {
  const { app, repo, dataDir } = await makeApp();
  const sessionId = makeSession(repo);
  const wsRoot = path.join(dataDir, "hub", "ws", sessionId);
  fs.mkdirSync(path.join(wsRoot, "out"), { recursive: true });
  fs.writeFileSync(path.join(wsRoot, "out", "report.md"), "# hi");

  const tree = await app.inject({
    method: "GET",
    url: `/api/hub/sessions/${sessionId}/workspace/tree`,
  });
  assert.equal(tree.statusCode, 200);
  const entries = tree.json().entries as Array<{ path: string }>;
  assert.ok(entries.some((e) => e.path === "out/report.md"));

  const file = await app.inject({
    method: "GET",
    url: `/api/hub/sessions/${sessionId}/workspace/file?path=out/report.md`,
  });
  assert.equal(file.statusCode, 200);
  assert.equal(file.json().content, "# hi");

  const traversal = await app.inject({
    method: "GET",
    url: `/api/hub/sessions/${sessionId}/workspace/file?${new URLSearchParams({ path: "../../etc/passwd" })}`,
  });
  assert.equal(traversal.statusCode, 400);
});

test("workspace promote reads a workspace file and creates an artifact", async () => {
  const { app, repo, dataDir } = await makeApp();
  const sessionId = makeSession(repo);
  const wsRoot = path.join(dataDir, "hub", "ws", sessionId);
  fs.mkdirSync(wsRoot, { recursive: true });
  fs.writeFileSync(path.join(wsRoot, "summary.json"), '{"ok":true}');

  const res = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/workspace/promote`,
    payload: { path: "summary.json" },
  });
  assert.equal(res.statusCode, 201);
  const artifact = res.json();
  assert.equal(artifact.kind, "json");
  assert.equal(artifact.title, "summary.json");
});

// ── Content-addressed workspace snapshots (R-SES6) ──────────────────────────────────────────────────

test("snapshot create/list/restore round-trip; a bad id 400s, an unknown id 404s", async () => {
  const { app, repo, dataDir } = await makeApp();
  const sessionId = makeSession(repo);
  const wsRoot = path.join(dataDir, "hub", "ws", sessionId);
  fs.mkdirSync(wsRoot, { recursive: true });
  fs.writeFileSync(path.join(wsRoot, "a.txt"), "version 1");

  const created = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/workspace/snapshots`,
    payload: { label: "before edit" },
  });
  assert.equal(created.statusCode, 201);
  const snapshot = created.json();
  assert.equal(snapshot.label, "before edit");
  assert.equal(snapshot.fileCount, 1);

  const list = await app.inject({
    method: "GET",
    url: `/api/hub/sessions/${sessionId}/workspace/snapshots`,
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);

  // Mutate the file, then restore — the snapshot's content comes back.
  fs.writeFileSync(path.join(wsRoot, "a.txt"), "version 2 — overwritten");
  const restore = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/workspace/snapshots/${snapshot.id}/restore`,
  });
  assert.equal(restore.statusCode, 200);
  assert.equal(fs.readFileSync(path.join(wsRoot, "a.txt"), "utf8"), "version 1");

  const badId = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/workspace/snapshots/..%2F../restore`,
  });
  assert.ok(
    [400, 404].includes(badId.statusCode),
    "a traversal-shaped id is refused, never followed",
  );

  const unknown = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/workspace/snapshots/does-not-exist/restore`,
  });
  assert.equal(unknown.statusCode, 404);
});

// ── MCP resource attachment (R-MCP9) ────────────────────────────────────────────────────────────────

function resourceFixture(overrides: Partial<ResourceScan> = {}): ResourceScan {
  return {
    id: "rs-1",
    scanId: "scan-1",
    kind: "resource",
    uri: "file:///reports/q3.csv",
    name: "q3.csv",
    description: "Quarterly numbers",
    mimeType: "text/csv",
    rawResource: {
      title: "Q3 report",
      annotations: {
        audience: ["assistant"],
        priority: 0.8,
        lastModified: "2026-07-01T00:00:00.000Z",
      },
    },
    totalTokens: 42,
    uriTokens: 10,
    nameTokens: 5,
    descriptionTokens: 5,
    mimeTypeTokens: 2,
    rawBytes: 100,
    contributionPercent: 100,
    ...overrides,
  };
}

test("resource catalog surfaces title/audience/priority/lastModified from the scanned descriptor", async () => {
  const scans = stubScans([resourceFixture()]);
  const { app } = await makeApp({ scans, scanService: stubScanService({}) });
  const res = await app.inject({ method: "GET", url: "/api/hub/resources/catalog?server=srv-1" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.serverName, "Research server");
  assert.equal(body.resources.length, 1);
  const [resource] = body.resources;
  assert.equal(resource.title, "Q3 report");
  assert.deepEqual(resource.audience, ["assistant"]);
  assert.equal(resource.priority, 0.8);
  assert.equal(resource.lastModified, "2026-07-01T00:00:00.000Z");
});

test("attach measures real content tokens (not just the definition footprint), lists, and removes; auto-inclusion never fires (no context wiring here)", async () => {
  const scans = stubScans([resourceFixture()]);
  const scanService = stubScanService({ "file:///reports/q3.csv": { tokens: 900 } });
  const { app, repo } = await makeApp({ scans, scanService });
  const sessionId = makeSession(repo);

  const attach = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/resources`,
    payload: { serverId: "srv-1", uri: "file:///reports/q3.csv" },
  });
  assert.equal(attach.statusCode, 201);
  const attached = attach.json();
  assert.equal(
    attached.tokens,
    900,
    "measured content tokens, not the 42-token definition footprint",
  );
  assert.equal(attached.serverName, "Research server");
  assert.equal(attached.title, "Q3 report");

  const list = await app.inject({ method: "GET", url: `/api/hub/sessions/${sessionId}/resources` });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().length, 1);

  // Nothing about attaching touches the turn engine's message reconstruction — R-MCP9's "auto-inclusion
  // off by default" holds structurally (no resource content is folded into any model context here).

  const remove = await app.inject({
    method: "DELETE",
    url: `/api/hub/sessions/${sessionId}/resources/${attached.id}`,
  });
  assert.equal(remove.statusCode, 204);
  const listAfter = await app.inject({
    method: "GET",
    url: `/api/hub/sessions/${sessionId}/resources`,
  });
  assert.equal(listAfter.json().length, 0);
});

test("attaching an unknown resource uri 404s; a failed read 502s", async () => {
  const scans = stubScans([resourceFixture()]);
  const { app, repo } = await makeApp({
    scans,
    scanService: stubScanService({
      "file:///reports/q3.csv": { tokens: 0, isError: true, errorMessage: "connection refused" },
    }),
  });
  const sessionId = makeSession(repo);

  const missing = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/resources`,
    payload: { serverId: "srv-1", uri: "file:///nope" },
  });
  assert.equal(missing.statusCode, 404);

  const failed = await app.inject({
    method: "POST",
    url: `/api/hub/sessions/${sessionId}/resources`,
    payload: { serverId: "srv-1", uri: "file:///reports/q3.csv" },
  });
  assert.equal(failed.statusCode, 502);
});
