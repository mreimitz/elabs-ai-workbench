// Observability WP4.5 — review queue lite (`review_rubrics`, migration v46, D-OB22, FINAL WP of the
// observability workstream).
//
// Proves (acceptance):
//   1. Rubric CRUD round-trips (create/list/get/update/delete); a REAL partial update (PATCH, an
//      omitted field keeps its stored value; `keys` REPLACES the whole array); case-insensitive name
//      uniqueness (409); invalid input -> 400 (empty `keys`, too many keys, a duplicate key name within
//      one rubric, an unknown-key `.strict()` violation, an out-of-vocabulary `kind`).
//   2. The review flow writes ONE `run_feedback` row PER KEY PER RUN through the EXISTING WP1.5
//      `POST /api/runs/:id/feedback` route (never a new endpoint) — thumbs/scale5/note keys all land as
//      ordinary `run_feedback` rows keyed by the rubric key's own name; re-reviewing the SAME (run, key)
//      UPSERTS (same row id, WP1.5 upsert semantics) rather than appending.
//   3. SEPARATION (D-OB15/AR6): deleting a rubric never touches the `run_feedback` rows a review already
//      wrote under its key names (they're ordinary human feedback, independent of the rubric); this
//      module reads/writes ONLY `review_rubrics` — the WP1.5 separation regression test
//      (`run-feedback.test.ts`, unmodified by this WP) proves grading/suites/compare stay untouched.
//   4. Migration v46 (both the fresh-DB `schema.ts` baseline path and the pre-v46 upgrade path) lands
//      `review_rubrics`; idempotent; neighboring rows survive.
//
// Progress derivation ("N/M reviewed", incl. skips) is a pure CLIENT-side computation over
// `RunSummary.feedback` (no new API surface) — see apps/web/src/features/review/review-progress.ts and
// its own unit tests.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { ReviewRubric, ReviewRubricInput } from "@mcp-token-footprint/shared";
import { applyMigrations, LATEST_SCHEMA_VERSION, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { registerObservabilityRoutes } from "../src/observability/routes.js";
import { toErrorMessage } from "../src/utils/errors.js";

const NOW = "2026-07-17T00:00:00.000Z";

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

async function setup(): Promise<{ db: AppDatabase; app: FastifyInstance }> {
  const db = openFresh();

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    }
    const typed = error as Error & { statusCode?: number; code?: string };
    const code =
      typeof typed.statusCode === "number" && typeof typed.code === "string" ? typed.code : undefined;
    return reply
      .code(typed.statusCode ?? 500)
      .send({ error: toErrorMessage(error), ...(code ? { code } : {}) });
  });

  await registerObservabilityRoutes(app, db);
  await app.ready();
  apps.push(app);
  return { db, app };
}

let seq = 0;
/** Seed one provider/scenario/test + a run, returning the run id. Each call gets fresh ids (mirrors
 *  run-feedback.test.ts's `seedRun`). */
function seedRun(db: AppDatabase): string {
  const n = seq++;
  const providerId = `prov-${n}`;
  const scenarioId = `scn-${n}`;
  const testId = `test-${n}`;
  const runId = `run-${n}`;
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(providerId, "anthropic", "Claude", NOW, NOW);
  db.prepare(
    "INSERT INTO scenarios (id, name, provider_id, model, created_at, updated_at) VALUES (?,?,?,?,?,?)",
  ).run(scenarioId, `Scenario ${n}`, providerId, "claude-sonnet-4", NOW, NOW);
  db.prepare(
    "INSERT INTO tests (id, name, user_prompt, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run(testId, `Test ${n}`, "go", NOW, NOW);
  db.prepare(
    "INSERT INTO runs (id, test_id, scenario_id, mode, status, started_at) VALUES (?,?,?,'automated','completed',?)",
  ).run(runId, testId, scenarioId, NOW);
  return runId;
}

const QUALITY_RUBRIC: ReviewRubricInput = {
  name: "Answer quality",
  instructions: "Judge the final answer against the prompt.",
  keys: [
    { key: "helpful", description: "Did it answer the question?", kind: "thumbs" },
    { key: "clarity", description: "How clear was the writing (1-5)?", kind: "scale5" },
    { key: "notes", description: "Anything else worth flagging?", kind: "note" },
  ],
};

// ── (1) CRUD round-trip ─────────────────────────────────────────────────────────────────────────

test("POST /api/review-rubrics creates a rubric; GET lists + fetches it", async () => {
  const { app } = await setup();

  const created = await app.inject({ method: "POST", url: "/api/review-rubrics", payload: QUALITY_RUBRIC });
  assert.equal(created.statusCode, 201);
  const rubric = created.json() as ReviewRubric;
  assert.equal(rubric.name, QUALITY_RUBRIC.name);
  assert.equal(rubric.instructions, QUALITY_RUBRIC.instructions);
  assert.deepEqual(rubric.keys, QUALITY_RUBRIC.keys);
  assert.ok(rubric.id);
  assert.equal(rubric.createdAt, rubric.updatedAt);

  const listed = await app.inject({ method: "GET", url: "/api/review-rubrics" });
  assert.equal(listed.statusCode, 200);
  const list = listed.json() as ReviewRubric[];
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, rubric.id);

  const fetched = await app.inject({ method: "GET", url: `/api/review-rubrics/${rubric.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(fetched.json(), rubric);
});

test("a rubric with no `instructions` omits the field (not an empty string)", async () => {
  const { app } = await setup();
  const created = await app.inject({
    method: "POST",
    url: "/api/review-rubrics",
    payload: { name: "Minimal", keys: [{ key: "ok", kind: "thumbs" }] },
  });
  assert.equal(created.statusCode, 201);
  const rubric = created.json() as ReviewRubric;
  assert.equal("instructions" in rubric, false);
});

test("PATCH /api/review-rubrics/:id is a REAL partial update — an omitted field keeps its stored value", async () => {
  const { app } = await setup();
  const created = (
    await app.inject({ method: "POST", url: "/api/review-rubrics", payload: QUALITY_RUBRIC })
  ).json() as ReviewRubric;

  // Patch ONLY the name — instructions/keys must survive untouched.
  const renamed = await app.inject({
    method: "PATCH",
    url: `/api/review-rubrics/${created.id}`,
    payload: { name: "Renamed rubric" },
  });
  assert.equal(renamed.statusCode, 200);
  const renamedRubric = renamed.json() as ReviewRubric;
  assert.equal(renamedRubric.name, "Renamed rubric");
  assert.equal(renamedRubric.instructions, created.instructions);
  assert.deepEqual(renamedRubric.keys, created.keys);
  assert.ok(renamedRubric.updatedAt >= created.updatedAt);

  // Patch ONLY `keys` — it REPLACES the whole array (not a per-key merge); name/instructions survive.
  const newKeys = [{ key: "verdict", kind: "thumbs" as const }];
  const reconfigured = await app.inject({
    method: "PATCH",
    url: `/api/review-rubrics/${created.id}`,
    payload: { keys: newKeys },
  });
  assert.equal(reconfigured.statusCode, 200);
  const reconfiguredRubric = reconfigured.json() as ReviewRubric;
  assert.equal(reconfiguredRubric.name, "Renamed rubric");
  assert.deepEqual(reconfiguredRubric.keys, newKeys);
});

test("DELETE /api/review-rubrics/:id is a hard delete; deleting is idempotent-error (404 twice)", async () => {
  const { app, db } = await setup();
  const created = (
    await app.inject({ method: "POST", url: "/api/review-rubrics", payload: QUALITY_RUBRIC })
  ).json() as ReviewRubric;

  const deleted = await app.inject({ method: "DELETE", url: `/api/review-rubrics/${created.id}` });
  assert.equal(deleted.statusCode, 204);

  const row = db.prepare("SELECT 1 FROM review_rubrics WHERE id = ?").get(created.id);
  assert.equal(row, undefined, "the row is physically gone (hard delete)");

  const refetch = await app.inject({ method: "GET", url: `/api/review-rubrics/${created.id}` });
  assert.equal(refetch.statusCode, 404);

  const redelete = await app.inject({ method: "DELETE", url: `/api/review-rubrics/${created.id}` });
  assert.equal(redelete.statusCode, 404, "deleting an already-deleted rubric 404s (not a silent no-op)");
});

test("a duplicate name (case-insensitive) 409s on create and on rename", async () => {
  const { app } = await setup();
  await app.inject({ method: "POST", url: "/api/review-rubrics", payload: QUALITY_RUBRIC });

  const dup = await app.inject({
    method: "POST",
    url: "/api/review-rubrics",
    payload: { ...QUALITY_RUBRIC, name: "ANSWER QUALITY" },
  });
  assert.equal(dup.statusCode, 409);

  const other = (
    await app.inject({
      method: "POST",
      url: "/api/review-rubrics",
      payload: { name: "Other rubric", keys: [{ key: "ok", kind: "thumbs" }] },
    })
  ).json() as ReviewRubric;
  const renameDup = await app.inject({
    method: "PATCH",
    url: `/api/review-rubrics/${other.id}`,
    payload: { name: "answer quality" },
  });
  assert.equal(renameDup.statusCode, 409);

  // Renaming to its OWN (unchanged-case) name is a no-op, not a self-conflict 409.
  const renameSelf = await app.inject({
    method: "PATCH",
    url: `/api/review-rubrics/${other.id}`,
    payload: { name: "Other rubric" },
  });
  assert.equal(renameSelf.statusCode, 200);
});

// ── (2) Invalid input -> 400 ────────────────────────────────────────────────────────────────────

test("invalid rubric input 400s: empty keys, duplicate key name, unknown kind, unknown top-level field", async () => {
  const { app } = await setup();

  const empty = await app.inject({
    method: "POST",
    url: "/api/review-rubrics",
    payload: { name: "Empty", keys: [] },
  });
  assert.equal(empty.statusCode, 400, "at least one key is required");

  const dupKey = await app.inject({
    method: "POST",
    url: "/api/review-rubrics",
    payload: {
      name: "Dup key",
      keys: [
        { key: "verdict", kind: "thumbs" },
        { key: "Verdict", kind: "scale5" }, // case-insensitive collision
      ],
    },
  });
  assert.equal(dupKey.statusCode, 400, "a duplicate key name (case-insensitive) within one rubric 400s");

  const badKind = await app.inject({
    method: "POST",
    url: "/api/review-rubrics",
    payload: { name: "Bad kind", keys: [{ key: "x", kind: "stars" }] },
  });
  assert.equal(badKind.statusCode, 400, "an out-of-vocabulary key kind 400s");

  const unknownField = await app.inject({
    method: "POST",
    url: "/api/review-rubrics",
    payload: { ...QUALITY_RUBRIC, bogus: true },
  });
  assert.equal(unknownField.statusCode, 400, ".strict() rejects an unknown top-level field");
});

test("too many keys (beyond the cap) 400s", async () => {
  const { app } = await setup();
  const tooMany = Array.from({ length: 21 }, (_, i) => ({ key: `k${i}`, kind: "thumbs" as const }));
  const res = await app.inject({
    method: "POST",
    url: "/api/review-rubrics",
    payload: { name: "Too many", keys: tooMany },
  });
  assert.equal(res.statusCode, 400);
});

// ── (3) The review flow writes THROUGH the existing WP1.5 run_feedback API ────────────────────────

test("reviewing a run writes ONE run_feedback row per rubric key, keyed by the rubric key's own name", async () => {
  const { app, db } = await setup();
  const rubric = (
    await app.inject({ method: "POST", url: "/api/review-rubrics", payload: QUALITY_RUBRIC })
  ).json() as ReviewRubric;
  const runId = seedRun(db);

  // A reviewer answers each key via the EXISTING WP1.5 feedback route — never a bespoke review endpoint.
  const helpful = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "helpful", score: 1 },
  });
  assert.equal(helpful.statusCode, 201);
  const clarity = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "clarity", score: 4 },
  });
  assert.equal(clarity.statusCode, 201);
  const notes = await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "notes", comment: "Cited the wrong table once." },
  });
  assert.equal(notes.statusCode, 201);

  const list = (await app.inject({ method: "GET", url: `/api/runs/${runId}/feedback` })).json() as Array<{
    key: string;
    score?: number;
    comment?: string;
    source: string;
  }>;
  assert.equal(list.length, 3, "one row per rubric key — no extra, no fewer");
  const byKey = new Map(list.map((row) => [row.key, row]));
  for (const keyDef of rubric.keys) {
    assert.ok(byKey.has(keyDef.key), `a row exists for rubric key "${keyDef.key}"`);
    assert.equal(byKey.get(keyDef.key)?.source, "human", "every review verdict is source='human'");
  }
  assert.equal(byKey.get("helpful")?.score, 1);
  assert.equal(byKey.get("clarity")?.score, 4);
  assert.equal(byKey.get("notes")?.comment, "Cited the wrong table once.");
});

test("re-reviewing the SAME run UPSERTS each key (same row id) rather than appending", async () => {
  const { app, db } = await setup();
  await app.inject({ method: "POST", url: "/api/review-rubrics", payload: QUALITY_RUBRIC });
  const runId = seedRun(db);

  const first = (
    await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/feedback`,
      payload: { key: "helpful", score: 1 },
    })
  ).json() as { id: string };

  // The reviewer changes their mind on a second pass over the same run.
  const second = (
    await app.inject({
      method: "POST",
      url: `/api/runs/${runId}/feedback`,
      payload: { key: "helpful", score: -1 },
    })
  ).json() as { id: string };

  assert.equal(second.id, first.id, "the SAME row is updated (WP1.5 upsert semantics), not a new one");
  const list = (await app.inject({ method: "GET", url: `/api/runs/${runId}/feedback` })).json() as Array<{
    key: string;
    score?: number;
  }>;
  assert.equal(list.filter((row) => row.key === "helpful").length, 1, "still exactly one row for the key");
  assert.equal(list.find((row) => row.key === "helpful")?.score, -1, "the row reflects the latest answer");
});

test("SEPARATION: deleting a rubric never touches run_feedback rows already written under its key names", async () => {
  const { app, db } = await setup();
  const rubric = (
    await app.inject({ method: "POST", url: "/api/review-rubrics", payload: QUALITY_RUBRIC })
  ).json() as ReviewRubric;
  const runId = seedRun(db);
  await app.inject({
    method: "POST",
    url: `/api/runs/${runId}/feedback`,
    payload: { key: "helpful", score: 1 },
  });

  const deleted = await app.inject({ method: "DELETE", url: `/api/review-rubrics/${rubric.id}` });
  assert.equal(deleted.statusCode, 204);

  const list = (await app.inject({ method: "GET", url: `/api/runs/${runId}/feedback` })).json() as Array<{
    key: string;
    score?: number;
  }>;
  assert.equal(list.length, 1, "the run_feedback row survives the rubric's deletion untouched");
  assert.equal(list[0]?.key, "helpful");
  assert.equal(list[0]?.score, 1);
});

// ── (4) Migration v46 — BOTH the fresh-DB path and the pre-v46 upgrade path ────────────────────────

test("migration v46 — a fresh DB carries review_rubrics (schema.ts baseline)", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    58,
    "LATEST_SCHEMA_VERSION auto-derived to 58 (v46 = review_rubrics, review queue lite; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 58, "fresh DB stamped at 58");
  assert.ok(tableExists(db, "review_rubrics"), "fresh DB has the review_rubrics table");

  // Immediately usable + the case-insensitive UNIQUE name constraint holds.
  db.prepare(
    "INSERT INTO review_rubrics (id, name, keys_json, created_at, updated_at) VALUES ('r1','Fresh rubric','[]',@now,@now)",
  ).run({ now: NOW });
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO review_rubrics (id, name, keys_json, created_at, updated_at) VALUES ('r2','fresh rubric','[]',@now,@now)",
        )
        .run({ now: NOW }),
    /UNIQUE/,
    "the UNIQUE COLLATE NOCASE constraint backstops a case-insensitive duplicate at the DB level",
  );
});

test("migration v46 — a pre-v46 (v45) DB gains review_rubrics; neighboring rows survive; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. review_rubrics…
  db.exec("DROP TABLE IF EXISTS review_rubrics;"); // …then rewind to a pre-v46 (v45) DB
  db.pragma("user_version = 45");
  assert.ok(!tableExists(db, "review_rubrics"), "sanity: the v45 fixture lacks review_rubrics");

  // A pre-existing, unrelated row (review_rubrics is additive DDL only — it must survive untouched).
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-pre46','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(db.pragma("user_version", { simple: true }), 58, "stamped to LATEST (58) after v46");
  assert.ok(tableExists(db, "review_rubrics"), "v46 created review_rubrics on the existing (v45) DB");
  const provider = db.prepare("SELECT label FROM provider_credentials WHERE id = 'prov-pre46'").get() as
    | { label: string }
    | undefined;
  assert.equal(provider?.label, "Claude", "the additive migration preserves existing rows");

  // Usable immediately post-migration.
  db.prepare(
    "INSERT INTO review_rubrics (id, name, keys_json, created_at, updated_at) VALUES ('r1','Migrated rubric','[]',@now,@now)",
  ).run({ now: NOW });
  const row = db.prepare("SELECT name FROM review_rubrics WHERE id = 'r1'").get() as
    | { name: string }
    | undefined;
  assert.equal(row?.name, "Migrated rubric");

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v46 is a no-op");
  assert.equal(db.pragma("user_version", { simple: true }), 58, "version unchanged after the re-run");
});
