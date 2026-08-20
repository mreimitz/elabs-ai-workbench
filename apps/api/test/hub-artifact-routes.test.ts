// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.6, §1.4 / R-UX13) — the artifact REST surface over a REAL
// `HubRepository`, mirroring `hub-routes.test.ts`'s harness (a real `HubSessionService` with no model
// ever invoked — artifact routes never touch the turn engine, so `resolveModel` is never called here).
//
// Proves (acceptance): create/list/get; versions list + append (the direct-UI-edit "update" path,
// always `authorKind: "user"`); 404s on an unknown artifact id and on a bad `?version=`; `export`
// covers `format=md|html|json` with the right content-type/filename, `md` wraps non-markdown kinds in a
// fenced block, `html` renders headings/bold/lists/tables and PRESERVES `[^n]` footnote markers as a
// numbered, back-linked footnotes section; `share.html` is SELF-CONTAINED (no `<script>`, no external
// `<link>`/`<img src=http`, one inlined `<style>`) and VERSION-PINNED (names the exact version in its
// meta line, distinct per version); an `html`-kind artifact's own `<script>`/`onclick=` content is
// stripped from both `format=html` and `share.html`; `?version=` exports a HISTORICAL version, not just
// the latest.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { DEFAULT_TOKEN_PROFILE } from "@mcp-token-footprint/shared";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { registerHubRoutes } from "../src/hub/routes.js";
import { HubRepository } from "../src/hub/repository.js";
import { HubSessionService } from "../src/hub/session-service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { getTokenCounter } from "../src/token-counting/profiles.js";
import { toErrorMessage } from "../src/utils/errors.js";

const databases: AppDatabase[] = [];
const tempDirs: string[] = [];
const harnesses: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of harnesses.splice(0)) await app.close();
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-artifact-routes-"));
  tempDirs.push(dir);
  return dir;
}

type Harness = { baseUrl: string; repo: HubRepository };

async function makeApp(): Promise<Harness> {
  const db = openDb();
  const secrets = new SecretStore(crypto.randomBytes(32));
  const providerRepository = new ProviderRepository(db, secrets);
  const repo = new HubRepository(db);
  const service = new HubSessionService({
    repository: repo,
    tokenCounter: getTokenCounter(DEFAULT_TOKEN_PROFILE),
    resolveToolset: () => ({ tools: {} }),
    resolveModel: () => {
      throw new Error("artifact routes never resolve a model");
    },
    config: {
      maxActiveSessions: 4,
      idleReleaseMs: 0,
      autoTitle: false,
      dataDir: tempDataDir(),
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
  await registerHubRoutes(app, { repository: repo, sessionService: service, providers: providerRepository });
  await app.listen({ port: 0, host: "127.0.0.1" });
  harnesses.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, repo };
}

async function postJson(h: Harness, urlPath: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}${urlPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type ArtifactWire = { id: string; title: string; kind: string; latestVersion: number; currentVersionId?: string };
type VersionWire = { id: string; artifactId: string; version: number; content: string; authorKind: string };

async function createArtifact(
  h: Harness,
  overrides: Partial<{ kind: string; title: string; content: string; sessionId: string }> = {},
): Promise<ArtifactWire> {
  const res = await postJson(h, "/api/hub/artifacts", {
    kind: overrides.kind ?? "markdown",
    title: overrides.title ?? "My Report",
    content: overrides.content ?? "# Hello\n\nSome **bold** text.",
    ...(overrides.sessionId ? { sessionId: overrides.sessionId } : {}),
  });
  assert.equal(res.status, 201);
  return (await res.json()) as ArtifactWire;
}

// ── Create / list / get / versions ──────────────────────────────────────────────────────────────────

test("create makes v1 (authorKind user); list/get/versions reflect it", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, { title: "Findings" });
  assert.equal(artifact.title, "Findings");
  assert.equal(artifact.kind, "markdown");
  assert.equal(artifact.latestVersion, 1);
  assert.ok(artifact.currentVersionId);

  const listRes = await fetch(`${h.baseUrl}/api/hub/artifacts`);
  assert.equal(listRes.status, 200);
  const list = (await listRes.json()) as ArtifactWire[];
  assert.ok(list.some((a) => a.id === artifact.id));

  const getRes = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}`);
  assert.equal(getRes.status, 200);
  assert.equal(((await getRes.json()) as ArtifactWire).id, artifact.id);

  const versionsRes = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/versions`);
  assert.equal(versionsRes.status, 200);
  const versions = (await versionsRes.json()) as VersionWire[];
  assert.equal(versions.length, 1);
  assert.equal(versions[0]?.version, 1);
  assert.equal(versions[0]?.authorKind, "user", "the direct-UI-edit create path is always user-authored");
});

test("list filters by session", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "gpt-4o" });
  const scoped = await createArtifact(h, { title: "Scoped", sessionId: session.id });
  const unscoped = await createArtifact(h, { title: "Unscoped" });

  const filtered = (await (
    await fetch(`${h.baseUrl}/api/hub/artifacts?session=${session.id}`)
  ).json()) as ArtifactWire[];
  assert.ok(filtered.some((a) => a.id === scoped.id));
  assert.ok(!filtered.some((a) => a.id === unscoped.id));
});

test("POST .../versions appends a new IMMUTABLE version (the direct-UI-edit update path)", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, { content: "v1 content" });

  const res = await postJson(h, `/api/hub/artifacts/${artifact.id}/versions`, { content: "v2 content" });
  assert.equal(res.status, 201);
  const v2 = (await res.json()) as VersionWire;
  assert.equal(v2.version, 2);
  assert.equal(v2.authorKind, "user");

  const refreshed = (await (await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}`)).json()) as ArtifactWire;
  assert.equal(refreshed.latestVersion, 2);
  assert.equal(refreshed.currentVersionId, v2.id);

  const versions = (await (
    await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/versions`)
  ).json()) as VersionWire[];
  assert.equal(versions.length, 2);
  assert.equal(versions[0]?.content, "v1 content", "v1 is preserved, not overwritten");
  assert.equal(versions[1]?.content, "v2 content");
});

// ── Session event flow (R-SES1) — a direct-UI-edit create/update is visible in the session's own
// replayable event log exactly like the model's `artifacts.create`/`.update` built-ins are. ───────────

test("a session-scoped create appends a durable artifact_created event to that session's log", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "gpt-4o" });
  const artifact = await createArtifact(h, { title: "Findings", sessionId: session.id });

  const events = h.repo.listEvents(session.id);
  const created = events.find((e) => e.type === "artifact_created");
  assert.ok(created, "expected an artifact_created event on the session log");
  assert.equal(created?.type === "artifact_created" && created.artifactId, artifact.id);
  assert.equal(created?.type === "artifact_created" && created.title, "Findings");
  assert.equal(created?.type === "artifact_created" && created.version, 1);
});

test("a session-scoped version append appends a durable artifact_updated event to that session's log", async () => {
  const h = await makeApp();
  const session = h.repo.createSession({ mode: "chat", model: "gpt-4o" });
  const artifact = await createArtifact(h, { content: "v1", sessionId: session.id });

  await postJson(h, `/api/hub/artifacts/${artifact.id}/versions`, { content: "v2", note: "revised" });

  const events = h.repo.listEvents(session.id);
  const updated = events.find((e) => e.type === "artifact_updated");
  assert.ok(updated, "expected an artifact_updated event on the session log");
  assert.equal(updated?.type === "artifact_updated" && updated.artifactId, artifact.id);
  assert.equal(updated?.type === "artifact_updated" && updated.version, 2);
  assert.equal(updated?.type === "artifact_updated" && updated.note, "revised");
});

test("a project-only (session-less) artifact create/update never throws — nothing to append to", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, { title: "No session" });
  const res = await postJson(h, `/api/hub/artifacts/${artifact.id}/versions`, { content: "v2" });
  assert.equal(res.status, 201);
});

// ── 404s ─────────────────────────────────────────────────────────────────────────────────────────────

test("404 on an unknown artifact id (get, versions, export, share); 404 on a bad ?version=", async () => {
  const h = await makeApp();
  const missing = "does-not-exist";
  assert.equal((await fetch(`${h.baseUrl}/api/hub/artifacts/${missing}`)).status, 404);
  assert.equal((await fetch(`${h.baseUrl}/api/hub/artifacts/${missing}/versions`)).status, 404);
  assert.equal(
    (await fetch(`${h.baseUrl}/api/hub/artifacts/${missing}/export?format=json`)).status,
    404,
  );
  assert.equal((await fetch(`${h.baseUrl}/api/hub/artifacts/${missing}/share`)).status, 404);

  const artifact = await createArtifact(h);
  const badVersion = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/export?format=json&version=99`);
  assert.equal(badVersion.status, 404);
});

test("export rejects an unsupported format (share.html is a distinct route, not format=share)", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h);
  const res = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/export?format=share`);
  assert.equal(res.status, 400);
});

// ── Export: json / md / html ────────────────────────────────────────────────────────────────────────

test("export format=json returns the artifact + version envelope", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, { content: "# Title\n\nBody." });
  const res = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/export?format=json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = (await res.json()) as { artifact: ArtifactWire; version: VersionWire };
  assert.equal(body.artifact.id, artifact.id);
  assert.equal(body.version.version, 1);
  assert.equal(body.version.content, "# Title\n\nBody.");
});

test("export format=md returns raw markdown as text/markdown with a download filename", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, { title: "My Report", content: "# Title\n\nBody." });
  const res = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/export?format=md`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
  assert.match(res.headers.get("content-disposition") ?? "", /my-report-v1\.md/);
  assert.equal(await res.text(), "# Title\n\nBody.");
});

test("export format=md wraps a non-markdown kind (code/json) in a fenced block", async () => {
  const h = await makeApp();
  const code = await createArtifact(h, { kind: "code", content: "const x = 1;" });
  const codeMd = await (await fetch(`${h.baseUrl}/api/hub/artifacts/${code.id}/export?format=md`)).text();
  assert.equal(codeMd, "```\nconst x = 1;\n```\n");

  const json = await createArtifact(h, { kind: "json", content: '{"a":1}' });
  const jsonMd = await (await fetch(`${h.baseUrl}/api/hub/artifacts/${json.id}/export?format=md`)).text();
  assert.equal(jsonMd, '```json\n{\n  "a": 1\n}\n```\n');
});

test("export format=html renders headings/bold/lists/tables and preserves [^n] footnote markers", async () => {
  const h = await makeApp();
  const content = [
    "# Title",
    "",
    "A claim with a footnote[^1] and **bold** text.",
    "",
    "- one",
    "- two",
    "",
    "| A | B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "[^1]: https://example.com/source",
  ].join("\n");
  const artifact = await createArtifact(h, { content });
  const res = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/export?format=html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th>A<\/th>/);
  assert.match(html, /<td>1<\/td>/);
  // Citation footnote preserved: an inline back-reference AND a numbered footnotes section.
  assert.match(html, /<sup id="fnref-1"><a href="#fn-1">1<\/a><\/sup>/);
  assert.match(html, /<li id="fn-1">/);
  assert.match(html, /example\.com\/source/);
  assert.doesNotMatch(html, /<script/i);
});

test("export format=html sanitizes an html-kind artifact's own <script>/onclick content", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, {
    kind: "html",
    content: '<p onclick="alert(1)">hi</p><script>alert(2)</script><a href="javascript:alert(3)">x</a>',
  });
  const html = await (
    await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/export?format=html`)
  ).text();
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onclick/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /<p>hi<\/p>/, "the safe markup itself is preserved");
});

test("?version= exports a HISTORICAL version, not just the latest", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, { content: "v1 content" });
  await postJson(h, `/api/hub/artifacts/${artifact.id}/versions`, { content: "v2 content" });

  const v1 = await (
    await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/export?format=md&version=1`)
  ).text();
  assert.equal(v1, "v1 content");

  const latest = await (
    await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/export?format=md`)
  ).text();
  assert.equal(latest, "v2 content", "omitting ?version= exports the current (latest) version");
});

// ── share.html: self-contained + version-pinned ─────────────────────────────────────────────────────

test("share.html is self-contained (no script, no external link/img, one inlined style) and version-pinned", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, { title: "Shareable Doc", content: "# Title\n\nBody text." });

  const res = await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/share`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const disposition = res.headers.get("content-disposition") ?? "";
  assert.match(disposition, /attachment/, "share.html is always a forced download");
  assert.match(disposition, /shareable-doc-v1\.share\.html/);

  const html = await res.text();
  assert.doesNotMatch(html, /<script/i, "no script");
  assert.doesNotMatch(html, /<link[^>]+href/i, "no external stylesheet reference");
  assert.doesNotMatch(html, /<img[^>]+src\s*=\s*["']?https?:/i, "no external image dependency");
  assert.doesNotMatch(html, /@import\s+url\(\s*["']?https?:/i, "no external CSS import");
  assert.equal((html.match(/<style>/g) ?? []).length, 1, "exactly one inlined style block");
  assert.match(html, /version 1 of 1/, "version-pinned in the meta line");
  assert.match(html, /<h1>Shareable Doc<\/h1>/);

  await postJson(h, `/api/hub/artifacts/${artifact.id}/versions`, { content: "v2 body" });
  const v2Html = await (await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/share`)).text();
  assert.match(v2Html, /version 2 of 2/, "a later export pins the NEW version");
  const v1Html = await (
    await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/share?version=1`)
  ).text();
  assert.match(v1Html, /version 1 of 2/, "?version=1 still pins v1 even though the artifact moved on");
});

test("share.html sanitizes an html-kind artifact's own script content too", async () => {
  const h = await makeApp();
  const artifact = await createArtifact(h, {
    kind: "html",
    content: "<p>hi</p><script>alert(1)</script>",
  });
  const html = await (await fetch(`${h.baseUrl}/api/hub/artifacts/${artifact.id}/share`)).text();
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<p>hi<\/p>/);
});
