import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type {
  AssistantWorkspaceFileContent,
  AssistantWorkspaceFilesResponse,
} from "@mcp-token-footprint/shared";
import { AssistantRepository } from "../src/assistant/repository.js";
import { registerAssistantRoutes } from "../src/assistant/routes.js";
import { AssistantSessionManager } from "../src/assistant/session-manager.js";
import type {
  AgentSessionDriver,
  DriverSession,
  DriverStartOptions,
} from "../src/assistant/session-driver.js";
import { materializeWorkspace, workspaceRootFor } from "../src/assistant/workspace.js";
import type { AssistantAuthService } from "../src/assistant/auth-service.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Assistant R1.3 (D-AS13/D-AS22) — the LIVE-workspace read HTTP surface: `GET
// /api/assistant/threads/:id/workspace/:skillId/files` and `.../file?path=…`. These routes never touch
// the SDK/driver at all (no session needs to be live — they read straight off the filesystem a prior
// `skills_open_workspace` materialized), so the fake driver here is a bare stub that's never invoked.

class NoopDriver implements AgentSessionDriver {
  start(options: DriverStartOptions): DriverSession {
    return {
      send: () => undefined,
      events: (async function* () {})(),
      interrupt: async () => undefined,
      sessionId: () => undefined,
    };
  }
}

// ── Harness ───────────────────────────────────────────────────────────────────────────────────────
type Harness = {
  app: FastifyInstance;
  baseUrl: string;
  repo: AssistantRepository;
  dataDir: string;
};
const harnesses: Harness[] = [];
const databases: AppDatabase[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.app.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-assistant-ws-routes-"));
  dirs.push(dir);
  return dir;
}

async function makeApp(): Promise<Harness> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const secrets = new SecretStore(Buffer.alloc(32, 11));
  const repo = new AssistantRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  repo.createCredential({ kind: "claude_oauth", token: "sk-ant-oat01-testtoken1234" });

  const dataDir = tmpDataDir();
  const manager = new AssistantSessionManager({
    repository: repo,
    providers,
    driver: new NoopDriver(),
    buildTools: () => ({}),
    config: {
      maxTurns: 50,
      idleTimeoutMs: 60_000,
      maxActiveSessions: 2,
      assistantDataDir: dataDir,
      permissionTimeoutMs: 300_000,
    },
  });

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerAssistantRoutes(app, {
    auth: {} as unknown as AssistantAuthService,
    sessions: manager,
    models: [],
    assistantDataDir: dataDir,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const harness: Harness = { app, baseUrl: `http://127.0.0.1:${port}`, repo, dataDir };
  harnesses.push(harness);
  return harness;
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────

test("GET .../workspace/:skillId/files lists the LIVE (possibly agent-edited) tree, sorted, with isBinary", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [
    { path: "SKILL.md", bytes: Buffer.from("---\nname: demo\n---\nBody.", "utf8") },
    { path: "assets/logo.png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) },
  ]);
  // Simulate a native Edit having landed on disk AFTER the open (the route reads the LIVE tree, not a
  // snapshot from when the workspace was materialized).
  fs.writeFileSync(path.join(root, "skill-a", "SKILL.md"), "edited by the agent");

  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/skill-a/files`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as AssistantWorkspaceFilesResponse;
  assert.equal(body.skillId, "skill-a");
  assert.deepEqual(
    body.files.map((f) => f.path),
    ["assets/logo.png", "SKILL.md"],
    "sorted by path, same order readWorkspaceTree returns",
  );
  const skillMd = body.files.find((f) => f.path === "SKILL.md");
  assert.equal(skillMd?.isBinary, false);
  assert.equal(skillMd?.size, "edited by the agent".length);
  const logo = body.files.find((f) => f.path === "assets/logo.png");
  assert.equal(logo?.isBinary, true);
});

test("GET .../workspace/:skillId/files is 400 when that skill has no open workspace on this thread", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/never-opened/files`,
  );
  assert.equal(res.status, 400);
});

test("GET .../workspace/:skillId/files is 404 for an unknown thread id", async () => {
  const h = await makeApp();
  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/does-not-exist/workspace/skill-a/files`,
  );
  assert.equal(res.status, 404);
});

test("GET .../workspace/:skillId/file?path=… returns inline text for a text file", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [
    { path: "references/API.md", bytes: Buffer.from("# API reference", "utf8") },
  ]);

  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/skill-a/file?path=${encodeURIComponent("references/API.md")}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as AssistantWorkspaceFileContent;
  assert.deepEqual(body, { path: "references/API.md", isBinary: false, text: "# API reference" });
});

test("GET .../workspace/:skillId/file?path=… flags a binary file with size, never inline text", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
  materializeWorkspace(root, "skill-a", [{ path: "assets/logo.png", bytes }]);

  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/skill-a/file?path=${encodeURIComponent("assets/logo.png")}`,
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as AssistantWorkspaceFileContent;
  assert.deepEqual(body, { path: "assets/logo.png", isBinary: true, size: bytes.byteLength });
});

test("GET .../workspace/:skillId/file is 400 when 'path' is missing", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const res = await fetch(`${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/skill-a/file`);
  assert.equal(res.status, 400);
});

test("GET .../workspace/:skillId/file is 404 for a path that doesn't exist in an OPEN workspace", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [{ path: "SKILL.md", bytes: Buffer.from("x", "utf8") }]);

  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/skill-a/file?path=${encodeURIComponent("nope.md")}`,
  );
  assert.equal(res.status, 404);
});

test("GET .../workspace/:skillId/file rejects path traversal (.., absolute, NUL) with a 400 — never escapes the skill dir", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [{ path: "SKILL.md", bytes: Buffer.from("x", "utf8") }]);
  // A real secret file OUTSIDE the entire workspace root the traversal attempt targets.
  fs.writeFileSync(path.join(h.dataDir, "outside-secret.txt"), "not part of any skill");

  for (const badPath of ["../outside-secret.txt", "/etc/passwd", "a/../../outside-secret.txt"]) {
    const res = await fetch(
      `${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/skill-a/file?path=${encodeURIComponent(badPath)}`,
    );
    assert.equal(
      res.status,
      400,
      `expected 400 for path traversal attempt ${JSON.stringify(badPath)}`,
    );
  }
});

test("GET .../workspace/:skillId/file refuses a symlink that resolves OUTSIDE the skill workspace dir (400)", async () => {
  // R1.3 review finding 3: the `..`/absolute guards above stop textual traversal; this covers the
  // realpath/symlink-escape guard — a link created INSIDE the skill dir that points at a real file
  // outside it must be refused, never followed off the workspace onto the host filesystem.
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const root = workspaceRootFor(h.dataDir, thread.id);
  materializeWorkspace(root, "skill-a", [{ path: "SKILL.md", bytes: Buffer.from("x", "utf8") }]);
  const secret = path.join(h.dataDir, "outside-secret.txt");
  fs.writeFileSync(secret, "not part of any skill");
  fs.symlinkSync(secret, path.join(root, "skill-a", "escape.md"));

  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/skill-a/file?path=${encodeURIComponent("escape.md")}`,
  );
  assert.equal(
    res.status,
    400,
    "a symlink escaping the skill workspace dir must be refused, not followed",
  );
});

test("GET .../workspace/:skillId/file is 400 when that skill has no open workspace on this thread", async () => {
  const h = await makeApp();
  const thread = h.repo.createThread({});
  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/${thread.id}/workspace/never-opened/file?path=${encodeURIComponent("SKILL.md")}`,
  );
  assert.equal(res.status, 400);
});

test("GET .../workspace/:skillId/file is 404 for an unknown thread id", async () => {
  const h = await makeApp();
  const res = await fetch(
    `${h.baseUrl}/api/assistant/threads/does-not-exist/workspace/skill-a/file?path=${encodeURIComponent("SKILL.md")}`,
  );
  assert.equal(res.status, 404);
});
