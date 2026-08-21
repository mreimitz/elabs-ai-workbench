// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP0.2, D-AH1…D-AH20) — migration v47 + HubRepository.
//
// NOTE on file location: the WP text says "co-located `*.test.ts`" next to `hub/repository.ts`, but
// `apps/api`'s test script is `tsx --test test/*.test.ts` — a flat, non-recursive glob over
// `apps/api/test/` (verified: zero test files exist anywhere under `apps/api/src` today; all 222 do
// live in `apps/api/test/`). A file at `apps/api/src/hub/repository.test.ts` would never be picked
// up by `pnpm test` and would silently never run. This file lives at the ONLY path the gate actually
// executes, mirroring every other repository test in this app (e.g. `assistant-repository.test.ts`).
//
// Proves (acceptance):
//   1. Migration v47 (both the fresh-DB `schema.ts` baseline path and the pre-v47 upgrade path) lands
//      all 13 `hub_*` tables; idempotent; neighboring rows survive.
//   2. Append-only event writes: two events on one session get seq 1, 2; a second session restarts at
//      1 (per-session monotonic `seq`, not global).
//   3. The replay query (`listEvents`) returns a session's events in `seq` order.
//   4. CRUD round-trips for the remaining entities (projects, role library, crews, sessions incl. the
//      lifecycle/title-state paths, missions, artifacts + immutable versions, reviews + comment
//      decisions, files + links, memory, session summaries).
//   5. Domain isolation: every operation above touches ONLY hub_* tables — the testing tables
//      (runs/run_steps/run_events/suites) are never written.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import type { HubEvent, HubReviewComment } from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { type HubMissionCreateInput, HubRepository } from "../src/hub/repository.js";

const NOW = "2026-07-17T00:00:00.000Z";

const HUB_TABLES = [
  "hub_projects",
  "hub_agents",
  "hub_crews",
  "hub_sessions",
  "hub_missions",
  "hub_events",
  "hub_artifacts",
  "hub_artifact_versions",
  "hub_reviews",
  "hub_files",
  "hub_file_links",
  "hub_memory",
  "hub_session_summaries",
  // v48 (WP2.4) — SESSION-level skill attachment; added to this fixture alongside the original 13.
  "hub_session_skills",
] as const;

const databases: AppDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function track(db: AppDatabase): AppDatabase {
  databases.push(db);
  return db;
}

function tableExists(db: AppDatabase, table: string): boolean {
  return (
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { n: number }
    ).n === 1
  );
}

function rowCount(db: AppDatabase, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

function createRepo(): { db: AppDatabase; repo: HubRepository } {
  const db = openFresh();
  return { db, repo: new HubRepository(db) };
}

// ── (1) Migration v47 — BOTH the fresh-DB path and the pre-v47 upgrade path ────────────────────────

test("migration v47 — a fresh DB carries every hub_* table (schema.ts baseline)", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    60,
    "LATEST_SCHEMA_VERSION auto-derived to 60 (v47 = the 13 Assistant Hub hub_* tables, WP0.2; v48 = hub_session_skills, WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1; v59 = runs.cache_read_tokens/cache_write_tokens, the prompt-cache split on the run row, planning/Roadmap/RM-33-cache-aware-token-accounting WP 1.2; v60 = grade_feedback, human verdicts ON grades + the derived calibration set, planning/Roadmap/RM-07-benchmarks WP 6.1)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 60, "fresh DB stamped at 60");
  for (const table of HUB_TABLES) {
    assert.ok(tableExists(db, table), `fresh DB has ${table}`);
  }
});

test("migration v47 — a pre-v47 (v46) DB gains every hub_* table; neighboring rows survive; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. the hub_* tables…
  // …then rewind to a pre-v47 (v46) DB: drop every hub table and re-stamp user_version. FKs are
  // toggled OFF for the drop: hub_sessions <-> hub_missions is a genuine two-way reference (a
  // session can carry a mission_id, a mission always carries a session_id), so no drop order avoids
  // a moment where a live FK points at an already-dropped table (mirrors applyMigrations' own
  // foreign_keys OFF/ON wrap around its rebuild transactions).
  db.pragma("foreign_keys = OFF");
  db.exec(`
    DROP TABLE IF EXISTS hub_session_skills;
    DROP TABLE IF EXISTS hub_session_summaries;
    DROP TABLE IF EXISTS hub_memory;
    DROP TABLE IF EXISTS hub_file_links;
    DROP TABLE IF EXISTS hub_files;
    DROP TABLE IF EXISTS hub_reviews;
    DROP TABLE IF EXISTS hub_artifact_versions;
    DROP TABLE IF EXISTS hub_artifacts;
    DROP TABLE IF EXISTS hub_events;
    DROP TABLE IF EXISTS hub_missions;
    DROP TABLE IF EXISTS hub_sessions;
    DROP TABLE IF EXISTS hub_crews;
    DROP TABLE IF EXISTS hub_agents;
    DROP TABLE IF EXISTS hub_projects;
  `);
  db.pragma("foreign_keys = ON");
  // hub_session_skills didn't exist at v46 either (it's v48) — but this fixture created it via the
  // schemaSql baseline above, same as every other hub_* table, so it's dropped alongside them.
  db.pragma("user_version = 46");
  for (const table of HUB_TABLES) {
    assert.ok(!tableExists(db, table), `sanity: the v46 fixture lacks ${table}`);
  }

  // A pre-existing, unrelated row (hub_* is additive DDL only — it must survive untouched).
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-pre47','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to LATEST (60) after v47…v55",
  );
  for (const table of HUB_TABLES) {
    assert.ok(tableExists(db, table), `v47/v48 created ${table} on the existing (v46) DB`);
  }
  const provider = db
    .prepare("SELECT label FROM provider_credentials WHERE id = 'prov-pre47'")
    .get() as { label: string } | undefined;
  assert.equal(provider?.label, "Claude", "the additive migration preserves existing rows");

  // Usable immediately post-migration (exercises the forward-reference FKs too: a session with no
  // mission and an artifact with no version yet both insert cleanly).
  const repo = new HubRepository(db);
  const project = repo.createProject({ name: "Migrated project" });
  assert.equal(project.name, "Migrated project");

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v47…v55 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

test("migration v47 — forward FK references resolve correctly (hub_sessions.mission_id, hub_artifacts.current_version_id)", () => {
  const db = openFresh();
  const repo = new HubRepository(db);
  const chat = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const mission = repo.createMission({
    sessionId: chat.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan: { topology: "parallel", autonomy: "always_ask", agents: [] },
  });
  // A session can now legally reference the mission created AFTER it in table-declaration order.
  const agentSession = repo.createSession({
    mode: "mission",
    model: "claude-opus-4-8",
    kind: "agent",
    parentSessionId: chat.id,
    missionId: mission.id,
  });
  assert.equal(agentSession.missionId, mission.id);

  // An invalid forward reference is still rejected (the FK is real, not just syntactically legal).
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO hub_sessions (id, kind, title, mode, model, status, created_at, updated_at, mission_id) VALUES ('bad','chat','t','chat','m','pending',@now,@now,'nonexistent-mission')",
        )
        .run({ now: NOW }),
    /FOREIGN KEY constraint failed/,
  );
});

// ── Migration v49 (Assistant Hub UX WP1.0s, D-HUX4/D-HUX8/D-HUX11, P2/P4) — the Wave-1 additive
// hub_* columns: hub_memory.scope/scope_id, hub_agents.display_name, hub_crews.color,
// hub_sessions.archived_at. See db/database.ts's v49 migration block for the full rationale.

function columns(db: AppDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

test("migration v49 — a fresh DB carries the 4 Wave-1 hub_* columns (schema.ts baseline)", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    60,
    "LATEST_SCHEMA_VERSION auto-derived to 60 (v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1; v59 = runs.cache_read_tokens/cache_write_tokens, the prompt-cache split on the run row, planning/Roadmap/RM-33-cache-aware-token-accounting WP 1.2; v60 = grade_feedback, human verdicts ON grades + the derived calibration set, planning/Roadmap/RM-07-benchmarks WP 6.1)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 60, "fresh DB stamped at 60");

  assert.ok(columns(db, "hub_memory").includes("scope"), "fresh DB hub_memory has scope");
  assert.ok(columns(db, "hub_memory").includes("scope_id"), "fresh DB hub_memory has scope_id");
  assert.ok(
    columns(db, "hub_agents").includes("display_name"),
    "fresh DB hub_agents has display_name",
  );
  assert.ok(columns(db, "hub_crews").includes("color"), "fresh DB hub_crews has color");
  assert.ok(
    columns(db, "hub_sessions").includes("archived_at"),
    "fresh DB hub_sessions has archived_at",
  );

  // A memory row inserted (raw SQL — HubRepository itself does not read/write `scope` yet; wiring
  // it through the repository/API is Wave-1 API work, out of scope for this DB-substrate WP) with no
  // explicit scope defaults to 'profile' (D-HUX11) via the column DEFAULT.
  db.prepare(
    `INSERT INTO hub_memory (id, kind, content, source, status, created_at, updated_at)
     VALUES ('mem-fresh','preference','likes concise answers','user','active',@now,@now)`,
  ).run({ now: NOW });
  const memory = db
    .prepare("SELECT scope, scope_id FROM hub_memory WHERE id = 'mem-fresh'")
    .get() as {
    scope: string;
    scope_id: string | null;
  };
  assert.equal(memory.scope, "profile", "a fresh memory row defaults to profile scope");
  assert.equal(memory.scope_id, null, "a fresh memory row has no scope_id");
});

test("migration v49 — a pre-v49 (v48) DB gains the 4 columns; existing hub_memory rows read scope='profile'; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. the v49 columns…
  // …then rewind hub_memory/hub_agents/hub_crews/hub_sessions to their pre-v49 (v48) shape via the
  // documented 12-step-style rebuild (DROP COLUMN is unavailable on this better-sqlite3/SQLite build
  // for a column with no CHECK — use CREATE-copy-drop-rename, mirroring rebuildCollectionsForOptionalRepo).
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE hub_memory_v48 (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL CHECK (kind IN ('profile','preference','instruction')),
      content     TEXT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('user','assistant_proposed')),
      status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','archived')),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    INSERT INTO hub_memory_v48 (id, kind, content, source, status, created_at, updated_at)
      SELECT id, kind, content, source, status, created_at, updated_at FROM hub_memory;
    DROP TABLE hub_memory;
    ALTER TABLE hub_memory_v48 RENAME TO hub_memory;

    CREATE TABLE hub_agents_v48 (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT,
      icon              TEXT,
      system_prompt     TEXT NOT NULL,
      default_model     TEXT NOT NULL,
      tool_grants_json  TEXT NOT NULL DEFAULT '{"servers":{},"builtins":[]}',
      skill_ids_json    TEXT NOT NULL DEFAULT '[]',
      target            TEXT NOT NULL,
      expected_outcome  TEXT NOT NULL,
      budgets_json      TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      archived_at       TEXT
    );
    INSERT INTO hub_agents_v48 (id, name, description, icon, system_prompt, default_model, tool_grants_json, skill_ids_json, target, expected_outcome, budgets_json, created_at, updated_at, archived_at)
      SELECT id, name, description, icon, system_prompt, default_model, tool_grants_json, skill_ids_json, target, expected_outcome, budgets_json, created_at, updated_at, archived_at FROM hub_agents;
    DROP TABLE hub_agents;
    ALTER TABLE hub_agents_v48 RENAME TO hub_agents;
    CREATE INDEX IF NOT EXISTS idx_hub_agents_archived ON hub_agents(archived_at);

    CREATE TABLE hub_crews_v48 (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      description  TEXT,
      topology     TEXT NOT NULL CHECK (topology IN ('parallel','pipeline','debate','best_of_n')),
      members_json TEXT NOT NULL DEFAULT '[]',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    INSERT INTO hub_crews_v48 (id, name, description, topology, members_json, created_at, updated_at)
      SELECT id, name, description, topology, members_json, created_at, updated_at FROM hub_crews;
    DROP TABLE hub_crews;
    ALTER TABLE hub_crews_v48 RENAME TO hub_crews;

    ALTER TABLE hub_sessions DROP COLUMN archived_at;
  `);
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 48");
  assert.ok(!columns(db, "hub_memory").includes("scope"), "sanity: the v48 fixture lacks scope");
  assert.ok(!columns(db, "hub_agents").includes("display_name"), "sanity: no display_name yet");
  assert.ok(!columns(db, "hub_crews").includes("color"), "sanity: no color yet");
  assert.ok(!columns(db, "hub_sessions").includes("archived_at"), "sanity: no archived_at yet");

  // A pre-existing hub_memory row (written before v49 — no scope column existed at write time).
  db.prepare(
    `INSERT INTO hub_memory (id, kind, content, source, status, created_at, updated_at)
     VALUES ('mem-pre49','preference','dark mode','user','active',@now,@now)`,
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to LATEST (60) after v49…v55",
  );
  assert.ok(columns(db, "hub_memory").includes("scope"), "v49 added hub_memory.scope");
  assert.ok(columns(db, "hub_memory").includes("scope_id"), "v49 added hub_memory.scope_id");
  assert.ok(
    columns(db, "hub_agents").includes("display_name"),
    "v49 added hub_agents.display_name",
  );
  assert.ok(columns(db, "hub_crews").includes("color"), "v49 added hub_crews.color");
  assert.ok(
    columns(db, "hub_sessions").includes("archived_at"),
    "v49 added hub_sessions.archived_at",
  );

  const existing = db
    .prepare("SELECT content, scope, scope_id FROM hub_memory WHERE id = 'mem-pre49'")
    .get() as { content: string; scope: string; scope_id: string | null };
  assert.equal(existing.content, "dark mode", "existing memory row preserved across the migration");
  assert.equal(
    existing.scope,
    "profile",
    "a pre-v49 memory row backfills to scope='profile' (D-HUX11)",
  );
  assert.equal(existing.scope_id, null, "a profile-scope row has no scope_id");

  // Usable immediately post-migration: a NEW row can set scope/scope_id explicitly (raw SQL — see the
  // note above on why this isn't routed through HubRepository), and the table stays writable via the
  // repository for every column it already knows about.
  db.prepare(
    `INSERT INTO hub_memory (id, kind, content, source, status, scope, scope_id, created_at, updated_at)
     VALUES ('mem-scoped','instruction','x','user','active','agent','ag-1',@now,@now)`,
  ).run({ now: NOW });
  const scoped = db
    .prepare("SELECT scope, scope_id FROM hub_memory WHERE id = 'mem-scoped'")
    .get() as { scope: string; scope_id: string | null };
  assert.equal(scoped.scope, "agent");
  assert.equal(scoped.scope_id, "ag-1");

  const repo = new HubRepository(db);
  const viaRepo = repo.createMemory({ kind: "preference", content: "still usable" });
  assert.equal(
    viaRepo.content,
    "still usable",
    "HubRepository.createMemory still works post-migration",
  );

  // Idempotent: re-running is a no-op and leaves the version + data unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v49 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM hub_memory").get() as { n: number }).n,
    3,
    "no row duplication on re-run (mem-pre49 + mem-scoped + the repo-created row)",
  );
});

// ── Migration v50 (Assistant Hub end-user UX pass) — hub_sessions.tool_scope_json + the create-time
//    scoping round-trip (MCP tool scope persisted; "Pick" skills seeded at create). ─────────────────
test("migration v50 — a fresh DB carries hub_sessions.tool_scope_json; upgrade adds it, idempotent", () => {
  const db = openFresh();
  assert.ok(
    columns(db, "hub_sessions").includes("tool_scope_json"),
    "fresh DB hub_sessions has tool_scope_json",
  );

  // Rewind to a pre-v50 (v49) shape: drop the column and re-stamp, then migrate forward.
  db.exec("ALTER TABLE hub_sessions DROP COLUMN tool_scope_json;");
  db.pragma("user_version = 49");
  assert.ok(
    !columns(db, "hub_sessions").includes("tool_scope_json"),
    "sanity: the v49 fixture lacks tool_scope_json",
  );

  applyMigrations(db);
  assert.equal(db.pragma("user_version", { simple: true }), 60, "stamped to LATEST (60) after v50");
  assert.ok(
    columns(db, "hub_sessions").includes("tool_scope_json"),
    "v50 added hub_sessions.tool_scope_json on the existing (v49) DB",
  );

  assert.doesNotThrow(() => applyMigrations(db), "re-applying v50 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

test("createSession round-trips toolScope (scoped) and defaults to null (auto)", () => {
  const { repo } = createRepo();

  // Auto (default) — no toolScope ⇒ the session reads back as `null` (all-reachable + tool_search).
  const auto = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  assert.equal(auto.toolScope, null, "an auto session has no persisted tool scope");

  // Scoped — the picked grants persist and round-trip verbatim as HubSession.toolScope.
  const scope = { servers: { "srv-1": "all" as const, "srv-2": ["read", "search"] }, builtins: [] };
  const scoped = repo.createSession({ mode: "chat", model: "claude-opus-4-8", toolScope: scope });
  assert.deepEqual(scoped.toolScope, scope, "a scoped session round-trips its tool grants");
  // And re-reading it fresh from the DB (not the create return) matches too.
  assert.deepEqual(repo.getSession(scoped.id).toolScope, scope, "toolScope survives a re-read");
});

// ── (2) + (3) Events: append-only per-session seq + replay ordering ────────────────────────────────

test("appendEvent stamps a PER-SESSION monotonic seq starting at 1; a second session restarts at 1", () => {
  const { repo } = createRepo();
  const sessionA = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  const sessionB = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  const a1 = repo.appendEvent(sessionA.id, { type: "user_message", messageId: "m1", text: "hi" });
  const a2 = repo.appendEvent(sessionA.id, { type: "reasoning", text: "thinking" });
  assert.equal(a1.seq, 1, "the first event on session A gets seq 1");
  assert.equal(a2.seq, 2, "the second event on session A gets seq 2");

  const b1 = repo.appendEvent(sessionB.id, { type: "user_message", messageId: "m2", text: "hey" });
  assert.equal(b1.seq, 1, "a DIFFERENT session's first event restarts at seq 1, not 3");

  // Persisted, not just echoed on the return value.
  const replayedA = repo.listEvents(sessionA.id);
  assert.deepEqual(
    replayedA.map((e) => e.seq),
    [1, 2],
  );
});

test("listEvents replays a session's events in seq ASCENDING order regardless of insertion order interleaving", () => {
  const { repo } = createRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  const inputs: Array<{ type: HubEvent["type"] }> = [
    { type: "user_message" },
    { type: "reasoning" },
    { type: "assistant_message" },
    { type: "turn_done" },
  ];
  for (const input of inputs) {
    if (input.type === "user_message") {
      repo.appendEvent(session.id, { type: "user_message", messageId: "m1", text: "hi" });
    } else if (input.type === "reasoning") {
      repo.appendEvent(session.id, { type: "reasoning", text: "..." });
    } else if (input.type === "assistant_message") {
      repo.appendEvent(session.id, {
        type: "assistant_message",
        messageId: "am1",
        parts: [{ type: "text", text: "hello" }],
        citations: [],
      });
    } else {
      repo.appendEvent(session.id, { type: "turn_done" });
    }
  }

  const replay = repo.listEvents(session.id);
  assert.deepEqual(
    replay.map((e) => e.type),
    ["user_message", "reasoning", "assistant_message", "turn_done"],
  );
  assert.deepEqual(
    replay.map((e) => e.seq),
    [1, 2, 3, 4],
    "seq is strictly ascending — the AG-UI replay contract (R-SES1)",
  );
  for (const event of replay) {
    assert.ok(event.at, "every replayed event carries its persisted timestamp");
  }
});

test("appendEvent 404s against a nonexistent session (never silently orphans an event)", () => {
  const { repo } = createRepo();
  assert.throws(
    () => repo.appendEvent("does-not-exist", { type: "ping" }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 404,
  );
});

// ── (4) CRUD round-trips ────────────────────────────────────────────────────────────────────────

test("hub_projects CRUD: create/get/list/update(archive)/delete", () => {
  const { repo } = createRepo();
  const project = repo.createProject({ name: "Research", description: "d", instructions: "i" });
  assert.equal(project.name, "Research");
  assert.equal(repo.getProject(project.id).description, "d");
  assert.equal(repo.listProjects().length, 1);

  const archived = repo.updateProject(project.id, { archived: true });
  assert.ok(archived.archivedAt);
  assert.equal(repo.listProjects().length, 0, "archived projects are excluded by default");
  assert.equal(repo.listProjects({ includeArchived: true }).length, 1);

  repo.deleteProject(project.id);
  assert.throws(() => repo.getProject(project.id));
});

test("hub_agents (role library) CRUD, incl. tool grants + skill attachments round-trip", () => {
  const { repo } = createRepo();
  const role = repo.createAgentRole({
    name: "Researcher",
    systemPrompt: "You research.",
    defaultModel: "claude-opus-4-8",
    toolGrants: { servers: { "server-1": "all" }, builtins: ["workspace.read"] },
    skills: [{ skillId: "skill-1", invocationMode: "model_invocable" }],
    target: "Find sources",
    expectedOutcome: "A findings list",
    budgets: { maxTurns: 10 },
  });
  assert.deepEqual(role.toolGrants, {
    servers: { "server-1": "all" },
    builtins: ["workspace.read"],
  });
  // WP2.4 — defaults fill in server-side (versionMode "latest" here, since none was given).
  assert.deepEqual(role.skills, [
    { skillId: "skill-1", versionMode: "latest", invocationMode: "model_invocable" },
  ]);
  assert.equal(role.budgets?.maxTurns, 10);

  const patched = repo.updateAgentRole(role.id, { name: "Senior Researcher", archived: true });
  assert.equal(patched.name, "Senior Researcher");
  assert.ok(patched.archivedAt);
  assert.equal(repo.listAgentRoles().length, 0);
  assert.equal(repo.listAgentRoles({ includeArchived: true }).length, 1);

  repo.deleteAgentRole(role.id);
  assert.equal(repo.listAgentRoles({ includeArchived: true }).length, 0);
});

// WP1.7 (Assistant Hub UX, D-HUX8/P2) — the optional persona `displayName`: absent on create ⇒
// undefined on read (falls back to `name`, the role title); settable on create/patch; `null` on
// patch clears it back. No avatar field — the avatar reuses the existing `icon` column (unchanged
// by this WP).
test("hub_agents: displayName is absent by default, settable on create, updatable + clearable via patch", () => {
  const { repo } = createRepo();
  const noPersona = repo.createAgentRole({
    name: "Researcher",
    systemPrompt: "You research.",
    defaultModel: "claude-opus-4-8",
    target: "Find sources",
    expectedOutcome: "A findings list",
  });
  assert.equal(noPersona.displayName, undefined, "no displayName given ⇒ undefined, not null");

  const withPersona = repo.createAgentRole({
    name: "Researcher",
    displayName: "Ada",
    systemPrompt: "You research.",
    defaultModel: "claude-opus-4-8",
    target: "Find sources",
    expectedOutcome: "A findings list",
  });
  assert.equal(withPersona.displayName, "Ada");
  assert.equal(repo.getAgentRole(withPersona.id).displayName, "Ada", "GET reflects it");
  assert.ok(
    repo.listAgentRoles().some((r) => r.id === withPersona.id && r.displayName === "Ada"),
    "list reflects it",
  );

  const renamed = repo.updateAgentRole(withPersona.id, { displayName: "Ada Lovelace" });
  assert.equal(renamed.displayName, "Ada Lovelace");

  const cleared = repo.updateAgentRole(withPersona.id, { displayName: null });
  assert.equal(cleared.displayName, undefined, "null clears the persona name back to the fallback");

  // Patching an unrelated field leaves an existing displayName untouched.
  const untouched = repo.updateAgentRole(noPersona.id, { name: "Senior Researcher" });
  assert.equal(untouched.displayName, undefined);
});

test("hub_crews CRUD, incl. members round-trip", () => {
  const { repo } = createRepo();
  const crew = repo.createCrew({
    name: "Research team",
    topology: "parallel",
    members: [{ agentId: "role-1" }, { agentId: "role-2", model: "claude-haiku-4-5" }],
  });
  assert.equal(crew.members.length, 2);
  assert.equal(repo.listCrews().length, 1);

  const updated = repo.updateCrew(crew.id, { topology: "pipeline" });
  assert.equal(updated.topology, "pipeline");

  repo.deleteCrew(crew.id);
  assert.equal(repo.listCrews().length, 0);
});

// WP1.7 (D-HUX8) — the optional `--chart-1…5` crew accent: absent on create ⇒ undefined on read (no
// explicit accent); settable on create/patch; `null` on patch clears it back.
test("hub_crews: color is absent by default, settable on create, updatable + clearable via patch", () => {
  const { repo } = createRepo();
  const noAccent = repo.createCrew({
    name: "Research team",
    topology: "parallel",
    members: [{ agentId: "role-1" }],
  });
  assert.equal(noAccent.color, undefined, "no color given ⇒ undefined, not null");

  const withAccent = repo.createCrew({
    name: "Ops team",
    color: "chart-3",
    topology: "pipeline",
    members: [{ agentId: "role-1" }],
  });
  assert.equal(withAccent.color, "chart-3");
  assert.equal(repo.getCrew(withAccent.id).color, "chart-3", "GET reflects it");
  assert.ok(
    repo.listCrews().some((c) => c.id === withAccent.id && c.color === "chart-3"),
    "list reflects it",
  );

  const recolored = repo.updateCrew(withAccent.id, { color: "chart-5" });
  assert.equal(recolored.color, "chart-5");

  const cleared = repo.updateCrew(withAccent.id, { color: null });
  assert.equal(cleared.color, undefined, "null clears the accent back to no explicit color");

  // Patching an unrelated field leaves an existing color untouched.
  const untouched = repo.updateCrew(noAccent.id, { topology: "debate" });
  assert.equal(untouched.color, undefined);
});

// WP1.7 — old-row null handling: a role/crew row written before display_name/color existed at the
// APP layer (raw INSERT bypassing the repository, mirroring how a pre-v49 row reads back post-
// migration — the column exists post-v49 but is NULL) must serialize cleanly through the repository
// read paths — no crash, and the wire field is omitted (undefined), never a literal `null` leaking
// through JSON.stringify as a "set to null" signal.
test("hub_agents/hub_crews: a pre-existing NULL display_name/color row reads back cleanly (no crash, field omitted)", () => {
  const { db, repo } = createRepo();

  db.prepare(
    `INSERT INTO hub_agents (
       id, name, system_prompt, default_model, target, expected_outcome, created_at, updated_at
     ) VALUES ('role-old', 'Legacy Role', 'sp', 'claude-opus-4-8', 't', 'eo', @now, @now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO hub_crews (id, name, topology, members_json, created_at, updated_at)
     VALUES ('crew-old', 'Legacy Crew', 'parallel', '[]', @now, @now)`,
  ).run({ now: NOW });

  const role = repo.getAgentRole("role-old");
  assert.equal(role.displayName, undefined);
  assert.equal(
    JSON.stringify(role).includes('"displayName"'),
    false,
    "omitted, not null, on the wire",
  );
  assert.ok(repo.listAgentRoles().some((r) => r.id === "role-old" && r.displayName === undefined));

  const crew = repo.getCrew("crew-old");
  assert.equal(crew.color, undefined);
  assert.equal(JSON.stringify(crew).includes('"color"'), false, "omitted, not null, on the wire");
  assert.ok(repo.listCrews().some((c) => c.id === "crew-old" && c.color === undefined));
});

test("hub_sessions: create defaults (chat), lifecycle transition, title-state discipline, markSeen, delete", () => {
  const { repo } = createRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8", title: "  " });
  assert.equal(session.kind, "chat", "defaults to a user-facing chat session");
  assert.equal(session.title, "New session", "a blank title falls back to the default");
  assert.equal(session.titleState, "pending");
  assert.equal(session.status, "pending");
  assert.equal(session.seen, false);

  // Auto-title never flips a later manual title back, and vice versa (manual wins forever).
  const autoTitled = repo.setAutoTitle(session.id, "Auto: quarterly report");
  assert.equal(autoTitled.titleState, "auto");
  const manuallyTitled = repo.updateSession(session.id, { title: "My title" });
  assert.equal(manuallyTitled.titleState, "manual");
  assert.equal(manuallyTitled.title, "My title");

  const running = repo.setSessionLifecycle(session.id, {
    status: "running",
    phase: "starting",
    capabilities: {
      liveText: true,
      liveReasoning: "raw",
      toolCalls: true,
      contextWindow: true,
      tokens: "exact",
      costBasis: "api_exact",
      followUps: true,
      askUser: false,
    },
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.01,
  });
  assert.equal(running.status, "running");
  assert.equal(running.phase, "starting");
  assert.equal(running.capabilities?.liveText, true);
  assert.equal(running.tokensIn, 100);

  const seen = repo.markSeen(session.id);
  assert.equal(seen.seen, true);
  // markSeen must not clobber the lifecycle fields it didn't touch.
  assert.equal(seen.status, "running");

  const listed = repo.listSessions({ kind: "chat" });
  assert.equal(listed.length, 1);

  repo.deleteSession(session.id);
  assert.throws(() => repo.getSession(session.id));
});

test("hub_sessions: an agent (mission-child) session carries parentSessionId + missionId; listMissionAgentSessions", () => {
  const { repo } = createRepo();
  const chat = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const mission = repo.createMission({
    sessionId: chat.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan: { topology: "parallel", autonomy: "always_ask", agents: [] },
  });
  const agent1 = repo.createSession({
    mode: "mission",
    model: "claude-haiku-4-5",
    kind: "agent",
    parentSessionId: chat.id,
    missionId: mission.id,
  });
  const agent2 = repo.createSession({
    mode: "mission",
    model: "claude-haiku-4-5",
    kind: "agent",
    parentSessionId: chat.id,
    missionId: mission.id,
  });

  const children = repo.listMissionAgentSessions(mission.id);
  assert.deepEqual(children.map((s) => s.id).sort(), [agent1.id, agent2.id].sort());
  for (const child of children) {
    assert.equal(child.kind, "agent");
    assert.equal(child.parentSessionId, chat.id);
  }

  // Deleting the parent chat session CASCADES to its agent children (ON DELETE CASCADE).
  repo.deleteSession(chat.id);
  assert.throws(() => repo.getSession(agent1.id));
  assert.throws(() => repo.getSession(agent2.id));
});

// ── WP1.4 (D-HUX4, P4) — the Sessions table's list-stats projection + topLevelOnly + archive ───────

test("listSessions: WP1.4 list-stats projection — turns counts user_message events, lastError is the MOST RECENT error/limit_error event's message, absent when none", () => {
  const { repo } = createRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });

  repo.appendEvent(session.id, { type: "user_message", messageId: "m1", text: "hi" });
  repo.appendEvent(session.id, {
    type: "assistant_message",
    messageId: "m1",
    model: "claude-opus-4-8",
    parts: [],
    citations: [],
    artifactsTouched: [],
  });
  repo.appendEvent(session.id, { type: "user_message", messageId: "m2", text: "again" });

  const beforeErrors = repo.listSessions().find((s) => s.id === session.id);
  assert.equal(
    beforeErrors?.turns,
    2,
    "turns counts ONLY user_message events, not assistant_message",
  );
  assert.equal(
    beforeErrors?.lastError,
    undefined,
    "no error/limit_error event yet ⇒ lastError absent",
  );

  repo.appendEvent(session.id, { type: "error", message: "first failure" });
  repo.appendEvent(session.id, { type: "limit_error", message: "second failure — limit" });

  const afterErrors = repo.listSessions().find((s) => s.id === session.id);
  assert.equal(
    afterErrors?.lastError,
    "second failure — limit",
    "lastError is the MOST RECENT of either error/limit_error type, not the first",
  );
});

test("listSessions: topLevelOnly excludes mission-agent children (D-HUX4 — they surface via missions/audit, never the Sessions table)", () => {
  const { repo } = createRepo();
  const chat = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const mission = repo.createMission({
    sessionId: chat.id,
    topology: "parallel",
    autonomy: "always_ask",
    plan: { topology: "parallel", autonomy: "always_ask", agents: [] },
  });
  const agent = repo.createSession({
    mode: "mission",
    model: "claude-haiku-4-5",
    kind: "agent",
    parentSessionId: chat.id,
    missionId: mission.id,
  });

  const all = repo.listSessions();
  assert.ok(all.some((s) => s.id === chat.id) && all.some((s) => s.id === agent.id));

  const topLevel = repo.listSessions({ topLevelOnly: true });
  assert.ok(
    topLevel.some((s) => s.id === chat.id),
    "the root chat session stays",
  );
  assert.ok(!topLevel.some((s) => s.id === agent.id), "the agent child is excluded");
});

test("updateSession archive/restore (P4 — additive archived_at, no hard delete); listSessions includeArchived is TRI-STATE (omitted/true = unfiltered, false = excludes archived — usage.ts/audit.ts/orphan-sweep safety)", () => {
  const { repo } = createRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  assert.equal(session.archived, false, "a fresh session is never archived");

  const archived = repo.updateSession(session.id, { archived: true });
  assert.equal(archived.archived, true);

  assert.ok(
    repo.listSessions({ includeArchived: false }).every((s) => s.id !== session.id),
    "includeArchived:false excludes the archived session",
  );
  assert.ok(
    repo.listSessions().some((s) => s.id === session.id),
    "omitting includeArchived does NOT filter by archive state (other callers must see it unchanged)",
  );
  assert.ok(
    repo.listSessions({ includeArchived: true }).some((s) => s.id === session.id),
    "includeArchived:true is equivalent to omitting it",
  );

  const restored = repo.updateSession(session.id, { archived: false });
  assert.equal(restored.archived, false);
  assert.ok(repo.listSessions({ includeArchived: false }).some((s) => s.id === session.id));

  // A patch that never mentions `archived` leaves the current archive state untouched (mirrors
  // `updateProject`/`updateAgentRole`'s own "undefined = leave unchanged" discipline).
  const rearchived = repo.updateSession(session.id, { archived: true });
  const renamedOnly = repo.updateSession(session.id, { title: "Renamed, still archived" });
  assert.equal(renamedOnly.title, "Renamed, still archived");
  assert.equal(renamedOnly.archived, true, "a title-only patch does not clear archived");
  assert.equal(rearchived.archived, true);
});

// hub-fixes WP1.2 (RC3 — the write-once trap): `updateSession` now honors `toolScope` with the SAME
// three-way undefined/null/value convention `budgets` already uses on `updateAgentRole` — a session's
// scope is no longer fixed forever at create time. This is the "PATCH round-trip" acceptance test at
// the repository layer (the HTTP-level round-trip through the context inspector is
// `hub-context-inspector.test.ts`'s own RC3 regression test).
test("updateSession round-trips toolScope: undefined leaves it unchanged, an object replaces it, null clears it back to auto", () => {
  const { repo } = createRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  assert.equal(session.toolScope, null, "a fresh session starts auto (no scope)");

  // A patch that never mentions toolScope leaves it untouched (the undefined convention).
  const untouched = repo.updateSession(session.id, { title: "Renamed" });
  assert.equal(untouched.toolScope, null, "a title-only patch does not implicitly scope the session");

  // Setting an explicit scope persists it and survives a fresh re-read (kills the write-once trap:
  // this session was NOT created with a scope, yet can now be scoped after the fact).
  const scope = { servers: { "srv-1": "all" as const }, builtins: ["tasks.list"] };
  const scoped = repo.updateSession(session.id, { toolScope: scope });
  assert.deepEqual(scoped.toolScope, scope);
  assert.deepEqual(repo.getSession(session.id).toolScope, scope, "toolScope survives a re-read");

  // A patch that never mentions toolScope again leaves the now-scoped session scoped.
  const stillScoped = repo.updateSession(session.id, { autonomy: "auto" });
  assert.deepEqual(stillScoped.toolScope, scope, "an unrelated patch does not clear the scope");

  // Explicit null clears it back to auto.
  const cleared = repo.updateSession(session.id, { toolScope: null });
  assert.equal(cleared.toolScope, null, "null clears the scope back to auto");
  assert.equal(repo.getSession(session.id).toolScope, null, "the clear survives a re-read");
});

test("hub_missions CRUD: create/get/getMissionBySession/update", () => {
  const { repo } = createRepo();
  const chat = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const mission = repo.createMission({
    sessionId: chat.id,
    topology: "parallel",
    autonomy: "threshold",
    plan: { topology: "parallel", autonomy: "threshold", agents: [] },
    budgets: { maxAgents: 3 },
  });
  assert.equal(mission.status, "proposed");
  assert.equal(mission.budgets?.maxAgents, 3);
  assert.deepEqual(repo.getMissionBySession(chat.id), mission);

  const approved = repo.updateMission(mission.id, {
    status: "approved",
    agentSessionIds: ["a1", "a2"],
    startedAt: NOW,
  });
  assert.equal(approved.status, "approved");
  assert.deepEqual(approved.agentSessionIds, ["a1", "a2"]);
  assert.equal(approved.startedAt, NOW);
});

// ── Migration v54 (crew-nesting, D-CN6) — hub_missions gains parent_mission_id/depth/root_mission_id,
//    the runtime-recursive-tree lineage. Both the fresh-DB baseline path and the pre-v54 upgrade path,
//    plus the repository create/read helpers (root self-reference, listChildMissions, getMissionTree,
//    parent ON DELETE CASCADE, create-time-immutability). ────────────────────────────────────────────

/** A minimal mission-create input for the given session, plus any crew-nesting lineage. Passing no
 *  lineage yields a ROOT (createMission then self-references root_mission_id + depth 0). */
function missionInput(
  sessionId: string,
  lineage?: { parentMissionId?: string; depth?: number; rootMissionId?: string },
): HubMissionCreateInput {
  return {
    sessionId,
    topology: "parallel",
    autonomy: "always_ask",
    plan: { topology: "parallel", autonomy: "always_ask", agents: [] },
    ...lineage,
  };
}

/** Reads the three lineage columns straight off the DB row (they are not all on the wire — root_mission_id
 *  is DB-internal per D-CN5). */
function lineageOf(
  db: AppDatabase,
  id: string,
): { parent_mission_id: string | null; depth: number; root_mission_id: string | null } {
  return db
    .prepare("SELECT parent_mission_id, depth, root_mission_id FROM hub_missions WHERE id = ?")
    .get(id) as { parent_mission_id: string | null; depth: number; root_mission_id: string | null };
}

test("migration v54 — a fresh DB carries hub_missions.parent_mission_id/depth/root_mission_id; LATEST is 55", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    60,
    "LATEST_SCHEMA_VERSION auto-derived to 60 (v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1; v59 = runs.cache_read_tokens/cache_write_tokens, the prompt-cache split on the run row, planning/Roadmap/RM-33-cache-aware-token-accounting WP 1.2; v60 = grade_feedback, human verdicts ON grades + the derived calibration set, planning/Roadmap/RM-07-benchmarks WP 6.1)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 60, "fresh DB stamped at 60");
  const cols = columns(db, "hub_missions");
  assert.ok(cols.includes("parent_mission_id"), "fresh DB hub_missions has parent_mission_id");
  assert.ok(cols.includes("depth"), "fresh DB hub_missions has depth");
  assert.ok(cols.includes("root_mission_id"), "fresh DB hub_missions has root_mission_id");
});

test("migration v54 — a pre-v54 (v53) DB gains the 3 lineage columns; a legacy mission reads back parent=undefined/depth=0; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. the v54 lineage columns…
  // …then rewind hub_missions to its pre-v54 (v53) shape: recreate it WITHOUT the 3 columns. FKs are
  // toggled OFF for the drop (hub_sessions.mission_id forward-references hub_missions — mirrors
  // applyMigrations' own foreign_keys OFF window).
  db.pragma("foreign_keys = OFF");
  db.exec(`
    DROP TABLE hub_missions;
    CREATE TABLE hub_missions (
      id                       TEXT PRIMARY KEY,
      session_id               TEXT NOT NULL REFERENCES hub_sessions(id) ON DELETE CASCADE,
      status                   TEXT NOT NULL DEFAULT 'proposed'
                                CHECK (status IN ('proposed','approved','running','synthesizing','completed','stopped','failed')),
      topology                 TEXT NOT NULL CHECK (topology IN ('parallel','pipeline','debate','best_of_n')),
      autonomy                 TEXT NOT NULL CHECK (autonomy IN ('always_ask','threshold','auto')),
      plan_json                TEXT NOT NULL,
      budgets_json             TEXT,
      cost_usd                 REAL NOT NULL DEFAULT 0,
      agent_session_ids_json   TEXT NOT NULL DEFAULT '[]',
      started_at               TEXT,
      ended_at                 TEXT,
      created_at               TEXT NOT NULL,
      updated_at               TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hub_missions_session ON hub_missions(session_id);
  `);
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 53");
  assert.ok(
    !columns(db, "hub_missions").includes("parent_mission_id"),
    "sanity: the v53 fixture lacks parent_mission_id",
  );

  // A pre-existing (legacy) session + mission, written before v54 (no lineage columns existed then).
  db.prepare(
    `INSERT INTO hub_sessions (id, kind, title, mode, model, created_at, updated_at)
     VALUES ('sess-legacy','chat','Legacy','mission','gpt-4o',@now,@now)`,
  ).run({ now: NOW });
  db.prepare(
    `INSERT INTO hub_missions (id, session_id, status, topology, autonomy, plan_json, cost_usd, agent_session_ids_json, created_at, updated_at)
     VALUES ('mis-legacy','sess-legacy','proposed','parallel','always_ask','{"topology":"parallel","autonomy":"always_ask","agents":[]}',0,'[]',@now,@now)`,
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(db.pragma("user_version", { simple: true }), 60, "stamped to LATEST (60) after v54");
  const cols = columns(db, "hub_missions");
  assert.ok(cols.includes("parent_mission_id"), "v54 added parent_mission_id on the existing DB");
  assert.ok(cols.includes("depth"), "v54 added depth");
  assert.ok(cols.includes("root_mission_id"), "v54 added root_mission_id");

  // The legacy row survives and reads back as a root: parent undefined, depth 0 (the NOT NULL DEFAULT 0
  // backfill), root_mission_id NULL (a pre-v54 root was never stamped) — and getMissionTree still
  // returns it via the `id = @root` arm.
  const repo = new HubRepository(db);
  const legacy = repo.getMission("mis-legacy");
  assert.equal(legacy.parentMissionId, undefined, "legacy mission has no parentMissionId");
  assert.equal(legacy.depth, 0, "legacy mission backfills depth 0");
  assert.equal(
    lineageOf(db, "mis-legacy").root_mission_id,
    null,
    "a migrated legacy root has NULL root_mission_id (never stamped)",
  );
  const tree = repo.getMissionTree("mis-legacy");
  assert.deepEqual(
    tree.map((m) => m.id),
    ["mis-legacy"],
    "getMissionTree returns a legacy NULL-root mission via the id = @root arm",
  );

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v54 is a no-op");
  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "version unchanged after the re-run",
  );
});

test("createMission — a root self-references root_mission_id; a child persists parent/depth/root; rootMissionId is not on the wire; update leaves lineage immutable", () => {
  const { db, repo } = createRepo();
  const chat = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });

  // A ROOT (no lineage input): parent NULL, depth 0, root = its OWN id (the load-bearing self-reference).
  const root = repo.createMission(missionInput(chat.id));
  assert.equal(root.parentMissionId, undefined, "a root has no parentMissionId on the wire");
  assert.equal(root.depth, 0, "a root has depth 0 on the wire");
  const rootRow = lineageOf(db, root.id);
  assert.equal(rootRow.parent_mission_id, null, "root DB row parent_mission_id IS NULL");
  assert.equal(rootRow.depth, 0, "root DB row depth = 0");
  assert.equal(rootRow.root_mission_id, root.id, "root DB row root_mission_id self-references its id");

  // A CHILD: all three lineage inputs persist; only parentMissionId + depth surface on the wire.
  const child = repo.createMission(
    missionInput(chat.id, { parentMissionId: root.id, depth: 1, rootMissionId: root.id }),
  );
  assert.equal(child.parentMissionId, root.id, "child surfaces parentMissionId");
  assert.equal(child.depth, 1, "child surfaces depth");
  assert.ok(!("rootMissionId" in child), "rootMissionId is DB-internal, never on the HubMission wire");
  const childRow = lineageOf(db, child.id);
  assert.equal(childRow.parent_mission_id, root.id, "child DB row parent_mission_id = root.id");
  assert.equal(childRow.depth, 1, "child DB row depth = 1");
  assert.equal(childRow.root_mission_id, root.id, "child DB row root_mission_id = the parent's root");

  // updateMission never writes the lineage columns — they are create-time-immutable and preserved.
  repo.updateMission(child.id, { status: "approved", costUsd: 1.23 });
  const afterUpdate = lineageOf(db, child.id);
  assert.equal(afterUpdate.parent_mission_id, root.id, "update preserves parent_mission_id");
  assert.equal(afterUpdate.depth, 1, "update preserves depth");
  assert.equal(afterUpdate.root_mission_id, root.id, "update preserves root_mission_id");
  assert.equal(repo.getMission(child.id).parentMissionId, root.id, "wire lineage preserved post-update");
});

test("listChildMissions returns only direct children; getMissionTree returns the whole tree ordered by depth", () => {
  const { repo } = createRepo();
  const chat = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const root = repo.createMission(missionInput(chat.id));
  const mk = (parentId: string, depth: number) =>
    repo.createMission(
      missionInput(chat.id, { parentMissionId: parentId, depth, rootMissionId: root.id }),
    );
  const childA = mk(root.id, 1);
  const childB = mk(root.id, 1);
  const grand = mk(childA.id, 2); // grandchild — a child of childA, NOT a direct child of root

  // listChildMissions = the direct children only (grandchild excluded).
  const kids = repo.listChildMissions(root.id);
  assert.deepEqual(
    kids.map((m) => m.id).sort(),
    [childA.id, childB.id].sort(),
    "listChildMissions(root) = its direct children",
  );
  assert.ok(!kids.some((m) => m.id === grand.id), "the grandchild is not a direct child of root");
  assert.deepEqual(
    repo.listChildMissions(childA.id).map((m) => m.id),
    [grand.id],
    "listChildMissions(childA) = [grandchild]",
  );

  // getMissionTree = the whole tree including the root, ordered by depth then created_at.
  const tree = repo.getMissionTree(root.id);
  assert.equal(tree.length, 4, "the tree is root + 2 children + 1 grandchild");
  assert.deepEqual(
    tree.map((m) => m.id).sort(),
    [root.id, childA.id, childB.id, grand.id].sort(),
    "getMissionTree returns every node in the tree",
  );
  assert.equal(tree[0]?.id, root.id, "root first (depth 0)");
  assert.equal(tree.at(-1)?.id, grand.id, "the grandchild is last (deepest)");
  const depths = tree.map((m) => m.depth ?? 0);
  for (let i = 1; i < depths.length; i++) {
    assert.ok((depths[i] ?? 0) >= (depths[i - 1] ?? 0), "getMissionTree is ordered by non-decreasing depth");
  }
});

test("hub_missions cascade — deleting a parent drops its subtree (siblings untouched); deleting the owning session drops the whole tree", () => {
  const { db, repo } = createRepo();
  const chat = repo.createSession({ mode: "mission", model: "claude-opus-4-8" });
  const root = repo.createMission(missionInput(chat.id));
  const child = repo.createMission(
    missionInput(chat.id, { parentMissionId: root.id, depth: 1, rootMissionId: root.id }),
  );
  const grand = repo.createMission(
    missionInput(chat.id, { parentMissionId: child.id, depth: 2, rootMissionId: root.id }),
  );
  // An UNRELATED root on the same session (parent NULL) — the cascade must not touch it.
  const other = repo.createMission(missionInput(chat.id));

  const exists = (id: string) =>
    db.prepare("SELECT 1 FROM hub_missions WHERE id = ?").get(id) !== undefined;

  // Deleting the parent (root) row cascades recursively via parent_mission_id ON DELETE CASCADE.
  db.prepare("DELETE FROM hub_missions WHERE id = ?").run(root.id);
  assert.equal(exists(root.id), false, "root deleted");
  assert.equal(exists(child.id), false, "direct child cascaded");
  assert.equal(exists(grand.id), false, "grandchild cascaded recursively");
  assert.equal(exists(other.id), true, "an unrelated sibling root is untouched");

  // Deleting the owning chat session cascades every mission sharing its session_id (hub_missions.session_id
  // ON DELETE CASCADE) — the whole tree, since all nested missions share the root chat session.
  db.prepare("DELETE FROM hub_sessions WHERE id = ?").run(chat.id);
  assert.equal(rowCount(db, "hub_missions"), 0, "deleting the session dropped every mission it owned");
});

test("hub_artifacts + hub_artifact_versions: create makes v1; addArtifactVersion appends immutably", () => {
  const { repo } = createRepo();
  const artifact = repo.createArtifact({
    kind: "markdown",
    title: "Findings",
    content: "# v1",
    authorKind: "assistant",
  });
  assert.equal(artifact.latestVersion, 1);
  const v1 = repo.getArtifactVersion(artifact.currentVersionId as string);
  assert.equal(v1.content, "# v1");
  assert.equal(v1.version, 1);

  const v2 = repo.addArtifactVersion(artifact.id, { content: "# v2", authorKind: "user" });
  assert.equal(v2.version, 2);
  const refreshed = repo.getArtifact(artifact.id);
  assert.equal(refreshed.latestVersion, 2);
  assert.equal(refreshed.currentVersionId, v2.id);

  const versions = repo.listArtifactVersions(artifact.id);
  assert.deepEqual(
    versions.map((v) => v.version),
    [1, 2],
  );
  assert.equal(versions[0]?.content, "# v1", "v1 is untouched — versions are immutable");

  repo.deleteArtifact(artifact.id);
  assert.throws(() => repo.getArtifactVersion(v1.id), "cascade-deleted with its artifact");
});

test("hub_reviews: create + decideReviewComment updates one comment's decision in place", () => {
  const { repo } = createRepo();
  const artifact = repo.createArtifact({
    kind: "markdown",
    title: "Draft",
    content: "body",
    authorKind: "assistant",
  });
  const comment: HubReviewComment = {
    id: "c1",
    body: "Fix this sentence",
    decision: "pending",
    authorKind: "agent",
    createdAt: NOW,
  };
  const review = repo.createReview({
    artifactId: artifact.id,
    baseVersion: 1,
    reviewerKind: "agent",
    comments: [comment],
  });
  assert.equal(review.status, "open");
  assert.equal(review.comments[0]?.decision, "pending");

  const decided = repo.decideReviewComment(review.id, "c1", "accepted");
  assert.equal(decided.comments[0]?.decision, "accepted");
  assert.equal(repo.listReviews(artifact.id).length, 1);

  const resolved = repo.updateReview(review.id, { status: "resolved" });
  assert.equal(resolved.status, "resolved");
});

test("hub_files + hub_file_links: content-addressed create, getFileContent is separate from listing, links round-trip", () => {
  const { repo } = createRepo();
  const content = Buffer.from("hello world");
  const file = repo.createFile({
    sha256: "abc123",
    mime: "text/plain",
    filename: "hi.txt",
    content,
  });
  assert.equal(file.bytes, content.byteLength);
  assert.equal("content" in file, false, "the redacted HubFile never carries the blob");
  assert.deepEqual(repo.getFileContent(file.id), content);
  assert.equal(repo.listFiles().length, 1);

  const link = repo.linkFile({
    fileId: file.id,
    role: "upload",
    targetKind: "session",
    targetId: "session-1",
  });
  assert.equal(repo.listFileLinksForTarget("session", "session-1").length, 1);
  assert.equal(repo.listFileLinksForFile(file.id).length, 1);

  repo.unlinkFile(link.id);
  assert.equal(repo.listFileLinksForFile(file.id).length, 0);

  repo.deleteFile(file.id);
  assert.throws(() => repo.getFile(file.id));
});

test("hub_memory: user rows are active immediately; assistant-proposed rows start proposed (never silent)", () => {
  const { repo } = createRepo();
  const userMemory = repo.createMemory({ kind: "preference", content: "Prefers concise answers" });
  assert.equal(userMemory.source, "user");
  assert.equal(userMemory.status, "active");

  const proposed = repo.createMemory({
    kind: "instruction",
    content: "Always cite sources",
    source: "assistant_proposed",
  });
  assert.equal(proposed.status, "proposed", "the assistant may only PROPOSE — D-AH11");

  const saved = repo.updateMemory(proposed.id, { status: "active" });
  assert.equal(saved.status, "active");
  assert.equal(repo.listMemory({ status: "active" }).length, 2);

  repo.deleteMemory(userMemory.id);
  assert.equal(repo.listMemory().length, 1);
});

test("hub_session_summaries: create + listSessionSummaries + getLatestSessionSummary", () => {
  const { repo } = createRepo();
  const session = repo.createSession({ mode: "chat", model: "claude-opus-4-8" });
  repo.createSessionSummary({
    sessionId: session.id,
    uptoSeq: 10,
    content: "Summary A",
    tokens: 50,
  });
  const latest = repo.createSessionSummary({
    sessionId: session.id,
    uptoSeq: 20,
    content: "Summary B",
    tokens: 80,
  });

  const all = repo.listSessionSummaries(session.id);
  assert.deepEqual(
    all.map((s) => s.uptoSeq),
    [10, 20],
  );
  assert.deepEqual(repo.getLatestSessionSummary(session.id), latest);
});

// ── (5) Domain isolation: the hub never writes the testing tables ─────────────────────────────────

test("domain isolation: a full hub workflow never inserts into runs/run_steps/run_events/suites", () => {
  const { db, repo } = createRepo();
  const before = {
    runs: rowCount(db, "runs"),
    run_steps: rowCount(db, "run_steps"),
    run_events: rowCount(db, "run_events"),
    suites: rowCount(db, "suites"),
  };

  const project = repo.createProject({ name: "Isolation check" });
  const session = repo.createSession({
    mode: "chat",
    model: "claude-opus-4-8",
    projectId: project.id,
  });
  repo.appendEvent(session.id, { type: "user_message", messageId: "m1", text: "hi" });
  repo.appendEvent(session.id, {
    type: "assistant_message",
    messageId: "am1",
    parts: [{ type: "text", text: "hello" }],
    citations: [],
  });
  const artifact = repo.createArtifact({
    kind: "markdown",
    title: "Note",
    content: "x",
    authorKind: "assistant",
    sessionId: session.id,
  });
  repo.createReview({ artifactId: artifact.id, baseVersion: 1, reviewerKind: "user" });
  repo.createMemory({ kind: "preference", content: "x" });
  repo.createFile({ sha256: "s", mime: "text/plain", content: Buffer.from("x") });

  assert.deepEqual(
    {
      runs: rowCount(db, "runs"),
      run_steps: rowCount(db, "run_steps"),
      run_events: rowCount(db, "run_events"),
      suites: rowCount(db, "suites"),
    },
    before,
    "the hub touches ONLY hub_* tables — the testing tables are untouched",
  );
});
