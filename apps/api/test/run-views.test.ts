// Observability WP1.4 — saved views (`run_views`): name + reuse ANY RunFilter.
//
// Proves (acceptance):
//   1. CRUD round-trips; invalid `filter` (fails the shared RunFilter zod) -> 400; duplicate name
//      (case-insensitive) -> 409; delete is HARD (the row is gone, not soft-deleted/archived).
//   2. A stored filter re-executes through `GET /api/runs` IDENTICALLY to the same inline filter: a
//      saved view is created, then `GET /api/runs?filter=<inline filter>` is compared byte-for-byte
//      against `GET /api/runs?filter=<view.filter re-serialized>`. The `/api/runs` route used here is
//      a byte-identical mirror of `apps/api/src/testing/routes.ts`'s `GET /api/runs` handler (same
//      shared helpers + the same `RunRepository.queryRuns` call) — this WP's file allowlist forbids
//      modifying `testing/routes.ts` (and the full route needs RunService/RunManager wiring it doesn't
//      use for this GET), so the handler is reproduced verbatim here to drive the real repository
//      method over real HTTP without touching that file.
//   3. Migration v34 (both the fresh-DB `schema.ts` baseline path and the pre-v34 upgrade path) lands
//      `run_views`; idempotent; existing rows in neighboring tables survive.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  hasRunQueryParams,
  parseRunFilterFromQuery,
  parseRunPagination,
  parseRunSort,
  type RunFilter,
  type RunView,
  serializeRunFilter,
} from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { registerObservabilityRoutes } from "../src/observability/routes.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { toErrorMessage } from "../src/utils/errors.js";

const NOW = "2026-07-16T00:00:00.000Z";

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
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

function openFresh(): AppDatabase {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  return db;
}

async function setup(): Promise<{ db: AppDatabase; app: FastifyInstance; runs: RunRepository }> {
  const db = openFresh();
  const runs = new RunRepository(db);

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    const code =
      typeof typed.statusCode === "number" && typeof typed.code === "string"
        ? typed.code
        : undefined;
    return reply
      .code(typed.statusCode ?? 500)
      .send({ error: toErrorMessage(error), ...(code ? { code } : {}) });
  });

  await registerObservabilityRoutes(app, db);

  // A byte-identical mirror of testing/routes.ts's `GET /api/runs` handler (see file header — this WP
  // may not modify that file, and the full route needs RunService/RunManager this GET never touches).
  app.get("/api/runs", async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    if (!hasRunQueryParams(query)) return runs.listRuns();
    const filter = parseRunFilterFromQuery(query);
    const sort = parseRunSort(typeof query.sort === "string" ? query.sort : undefined);
    const { limit, offset } = parseRunPagination(query);
    return runs.queryRuns(filter, { sort, limit, offset });
  });

  await app.ready();
  apps.push(app);
  return { db, app, runs };
}

/** Seed one provider/scenario/test + two runs (one 'completed', one 'error') for acceptance #2. */
function seedRuns(db: AppDatabase): void {
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-1','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES ('scn-1','Baseline','prov-1','claude-sonnet-4',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES ('test-1','List files','Use the tools.',@now,@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at) VALUES ('run-ok','test-1','scn-1','automated','completed',@now)",
  ).run({ now: NOW });
  db.prepare(
    "INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at) VALUES ('run-bad','test-1','scn-1','automated','error',@now)",
  ).run({ now: NOW });
}

// ── (1) CRUD round-trip ──────────────────────────────────────────────────────────────────────────

test("POST /api/run-views creates a view; GET lists + fetches it; the filter round-trips exactly", async () => {
  const { app } = await setup();

  const created = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Completed runs", filter: { status: ["completed"] } },
  });
  assert.equal(created.statusCode, 201);
  const view = created.json() as RunView;
  assert.equal(view.name, "Completed runs");
  assert.deepEqual(view.filter, { status: ["completed"] });
  assert.ok(view.id);
  assert.ok(view.createdAt);
  assert.equal(view.createdAt, view.updatedAt);

  const listed = await app.inject({ method: "GET", url: "/api/run-views" });
  assert.equal(listed.statusCode, 200);
  const list = listed.json() as RunView[];
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, view.id);

  const fetched = await app.inject({ method: "GET", url: `/api/run-views/${view.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(fetched.json(), view);
});

test("PATCH /api/run-views/:id is a REAL partial update — an omitted field keeps its stored value", async () => {
  const { app } = await setup();
  const created = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: {
      name: "My view",
      filter: { status: ["completed"] },
      columns: ["startedAt", "status"],
      sort: { field: "startedAt", direction: "desc" },
    },
  });
  const view = created.json() as RunView;

  // Patch ONLY the name — filter/columns/sort must survive untouched.
  const renamed = await app.inject({
    method: "PATCH",
    url: `/api/run-views/${view.id}`,
    payload: { name: "Renamed view" },
  });
  assert.equal(renamed.statusCode, 200);
  const renamedView = renamed.json() as RunView;
  assert.equal(renamedView.name, "Renamed view");
  assert.deepEqual(renamedView.filter, view.filter);
  assert.deepEqual(renamedView.columns, view.columns);
  assert.deepEqual(renamedView.sort, view.sort);
  assert.ok(
    renamedView.updatedAt >= view.updatedAt,
    "updatedAt advances (or stays equal under fast-clock test timing)",
  );

  // Patch ONLY the filter — name/columns/sort must survive untouched.
  const refiltered = await app.inject({
    method: "PATCH",
    url: `/api/run-views/${view.id}`,
    payload: { filter: { status: ["error"] } },
  });
  assert.equal(refiltered.statusCode, 200);
  const refilteredView = refiltered.json() as RunView;
  assert.equal(refilteredView.name, "Renamed view");
  assert.deepEqual(refilteredView.filter, { status: ["error"] });
  assert.deepEqual(refilteredView.columns, view.columns);
});

test("DELETE /api/run-views/:id is a HARD delete (never soft) — the row is gone, not archived", async () => {
  const { app, db } = await setup();
  const created = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Temp view", filter: {} },
  });
  const view = created.json() as RunView;

  const deleted = await app.inject({ method: "DELETE", url: `/api/run-views/${view.id}` });
  assert.equal(deleted.statusCode, 204);

  const row = db.prepare("SELECT 1 FROM run_views WHERE id = ?").get(view.id);
  assert.equal(row, undefined, "the row is physically gone (hard delete, no soft-delete column)");

  const refetch = await app.inject({ method: "GET", url: `/api/run-views/${view.id}` });
  assert.equal(refetch.statusCode, 404);

  const redelete = await app.inject({ method: "DELETE", url: `/api/run-views/${view.id}` });
  assert.equal(redelete.statusCode, 404, "deleting an already-deleted view 404s (not a silent no-op)");
});

// ── (2) Validation + uniqueness ──────────────────────────────────────────────────────────────────

test("an invalid filter (fails the shared RunFilter zod) is rejected 400 on create and on patch", async () => {
  const { app } = await setup();

  const badEnum = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Bad", filter: { status: ["not-a-real-status"] } },
  });
  assert.equal(badEnum.statusCode, 400);

  const unknownField = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Bad2", filter: { totallyUnknownField: true } },
  });
  assert.equal(unknownField.statusCode, 400, "runFilterSchema is .strict() — an unknown key 400s");

  const created = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Valid", filter: { status: ["completed"] } },
  });
  const view = created.json() as RunView;
  const badPatch = await app.inject({
    method: "PATCH",
    url: `/api/run-views/${view.id}`,
    payload: { filter: { status: ["nope"] } },
  });
  assert.equal(badPatch.statusCode, 400);
});

test("a duplicate name (case-insensitive) is rejected 409 on create and on rename", async () => {
  const { app } = await setup();
  const first = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Errors this week", filter: { status: ["error"] } },
  });
  assert.equal(first.statusCode, 201);

  const dup = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "errors this week", filter: { status: ["completed"] } },
  });
  assert.equal(dup.statusCode, 409, "case-insensitive duplicate name 409s on create");

  const second = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Something else", filter: {} },
  });
  const secondView = second.json() as RunView;
  const renameToDup = await app.inject({
    method: "PATCH",
    url: `/api/run-views/${secondView.id}`,
    payload: { name: "ERRORS THIS WEEK" },
  });
  assert.equal(renameToDup.statusCode, 409, "renaming into an existing name 409s too");

  // A same-name (no-op / case-only) rename to itself is allowed.
  const renameSelf = await app.inject({
    method: "PATCH",
    url: `/api/run-views/${secondView.id}`,
    payload: { name: "Something Else" },
  });
  assert.equal(renameSelf.statusCode, 200);
});

test("an oversized columns/sort presentation hint is rejected 400 (the byte-size cap)", async () => {
  const { app } = await setup();
  // RUN_VIEW_PRESENTATION_MAX_BYTES is 20 KB; a 30 KB string blob comfortably exceeds it.
  const oversized = "x".repeat(30 * 1024);
  const res = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Too big", filter: {}, columns: oversized },
  });
  assert.equal(res.statusCode, 400);
});

test("GET /api/run-views/:id 404s for an unknown id", async () => {
  const { app } = await setup();
  const res = await app.inject({ method: "GET", url: "/api/run-views/does-not-exist" });
  assert.equal(res.statusCode, 404);
});

// ── (3) Acceptance #2 — the stored filter re-executes IDENTICALLY through GET /api/runs ────────────

test("a saved view's filter re-executes through GET /api/runs IDENTICALLY to the same inline filter", async () => {
  const { app, db } = await setup();
  seedRuns(db);

  const filter: RunFilter = { status: ["completed"] };

  const inline = await app.inject({
    method: "GET",
    url: `/api/runs?filter=${encodeURIComponent(serializeRunFilter(filter))}`,
  });
  assert.equal(inline.statusCode, 200);
  const inlineResult = inline.json();
  // Sanity: the filter actually discriminates (only 'run-ok' matches, not 'run-bad').
  assert.equal(inlineResult.length, 1);
  assert.equal(inlineResult[0].id, "run-ok");

  const created = await app.inject({
    method: "POST",
    url: "/api/run-views",
    payload: { name: "Completed only", filter },
  });
  assert.equal(created.statusCode, 201);
  const view = created.json() as RunView;

  const fetched = await app.inject({ method: "GET", url: `/api/run-views/${view.id}` });
  const storedView = fetched.json() as RunView;

  const viaView = await app.inject({
    method: "GET",
    url: `/api/runs?filter=${encodeURIComponent(serializeRunFilter(storedView.filter))}`,
  });
  assert.equal(viaView.statusCode, 200);
  const viaViewResult = viaView.json();

  assert.deepEqual(
    viaViewResult,
    inlineResult,
    "GET /api/runs driven by the stored view's filter is byte-for-byte identical to the inline filter",
  );
});

// ── (4) Migration v34 — BOTH the fresh-DB path and the pre-v34 upgrade path ────────────────────────

test("migration v34 — a fresh DB carries run_views (schema.ts baseline)", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    61,
    "LATEST_SCHEMA_VERSION auto-derived to 61 (v34 = run_views; v35 = runs.pinned; v36 = run_feedback; v37 = run_steps hierarchy; v38 = watch_rules; v39 = watch_rules.last_evaluated_at; v40 = notifications; v41 = fleet issue aggregation; v42 = runs fork lineage; v43 = digest reports; v44 = model pricing; v45 = dashboard charts; v46 = review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1; v59 = runs.cache_read_tokens/cache_write_tokens, the prompt-cache split on the run row, planning/Roadmap/RM-33-cache-aware-token-accounting WP 1.2; v60 = grade_feedback, human verdicts ON grades + the derived calibration set, planning/Roadmap/RM-07-benchmarks WP 6.1; v61 = watch_rules.paused_until + min_interval_minutes, watch-rule pause + on-terminal renotification interval, planning/Roadmap/RM-17-observability Phase 6 AM-OB10)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 61, "fresh DB stamped at 61");
  assert.ok(tableExists(db, "run_views"), "fresh DB has the run_views table");

  // The table is immediately usable (INSERT + case-insensitive UNIQUE name).
  db.prepare(
    "INSERT INTO run_views (id, name, filter_json, created_at, updated_at) VALUES ('v1','Fresh view','{}',@now,@now)",
  ).run({ now: NOW });
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO run_views (id, name, filter_json, created_at, updated_at) VALUES ('v2','fresh view','{}',@now,@now)",
        )
        .run({ now: NOW }),
    /UNIQUE/,
    "the UNIQUE COLLATE NOCASE constraint backstops a case-insensitive duplicate at the DB level",
  );
});

test("migration v34 — a pre-v34 (v33) DB gains run_views; neighboring rows survive; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. run_views…
  db.exec("DROP TABLE IF EXISTS run_views;"); // …then rewind to a pre-v34 (v33) DB
  db.pragma("user_version = 33");
  assert.ok(!tableExists(db, "run_views"), "sanity: the v33 fixture lacks run_views");

  // A pre-existing, unrelated row (run_views is additive DDL only — it must survive untouched).
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-pre34','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(
    db.pragma("user_version", { simple: true }),
    LATEST_SCHEMA_VERSION,
    "stamped to latest after v34 + v35 + v36 + v37 + v38 + v39 + v40 + v41 + v42 + v43 + v44 + v45 + v46",
  );
  assert.ok(tableExists(db, "run_views"), "v34 created run_views on the existing (v33) DB");
  const provider = db.prepare("SELECT label FROM provider_credentials WHERE id = 'prov-pre34'").get() as
    | { label: string }
    | undefined;
  assert.equal(provider?.label, "Claude", "the additive migration preserves existing rows");

  // Usable immediately post-migration.
  db.prepare(
    "INSERT INTO run_views (id, name, filter_json, created_at, updated_at) VALUES ('v1','Migrated view','{}',@now,@now)",
  ).run({ now: NOW });
  const row = db.prepare("SELECT name FROM run_views WHERE id = 'v1'").get() as
    | { name: string }
    | undefined;
  assert.equal(row?.name, "Migrated view");

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v34 is a no-op");
  assert.equal(db.pragma("user_version", { simple: true }), 61, "version unchanged after the re-run");
});
