// Observability WP2.7 — custom chart composer (`dashboard_charts`, migration v45, D-OB22).
//
// Proves (acceptance):
//   1. CRUD round-trip; a REAL partial update (PATCH); reorder round-trip (a full valid reorder
//      applies; a partial/foreign/duplicate id list 400s); clone; hard delete + position renumbering.
//   2. Invalid config -> 400 with detail: a mixed-unit `measures` array (same-unit constraint), an
//      invalid `filter` (fails the shared RunFilter zod), an unknown-key `.strict()` violation, and an
//      out-of-vocabulary `measures`/`chartType`/`source`.
//   3. A saved chart's config re-executes through `GET /api/metrics/{runs,scans}` IDENTICALLY after a
//      reload (same query -> byte-identical response) — the "renders ONLY what the metrics API
//      returns, no client-side aggregation" honesty rule and the "re-renders identically after
//      reload" acceptance criterion, proven at the API layer.
//   4. Migration v45 (both the fresh-DB `schema.ts` baseline path and the pre-v45 upgrade path) lands
//      `dashboard_charts`; idempotent; existing rows in neighboring tables survive.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { DashboardChart, DashboardChartInput } from "@mcp-token-footprint/shared";
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

function indexExists(db: AppDatabase, index: string): boolean {
  return (
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(index) as { n: number }
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

const RUNS_CHART: DashboardChartInput = {
  name: "Error rate by model",
  config: {
    source: "runs",
    measures: ["errorRate"],
    filter: { status: ["completed", "error"] },
    groupBy: "model",
    bucket: "day",
    chartType: "line",
  },
};

const SCANS_CHART: DashboardChartInput = {
  name: "Footprint tokens",
  config: {
    source: "scans",
    measures: ["totalTokens"],
    bucket: "day",
    chartType: "bar",
  },
};

// ── (1) CRUD round-trip ─────────────────────────────────────────────────────────────────────────

test("POST /api/dashboard-charts creates a chart at the next position; GET lists + fetches it", async () => {
  const { app } = await setup();

  const created = await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART });
  assert.equal(created.statusCode, 201);
  const chart = created.json() as DashboardChart;
  assert.equal(chart.name, RUNS_CHART.name);
  assert.deepEqual(chart.config, RUNS_CHART.config);
  assert.equal(chart.position, 0, "the first chart lands at position 0");
  assert.ok(chart.id);
  assert.equal(chart.createdAt, chart.updatedAt);

  const listed = await app.inject({ method: "GET", url: "/api/dashboard-charts" });
  assert.equal(listed.statusCode, 200);
  const list = listed.json() as DashboardChart[];
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, chart.id);

  const fetched = await app.inject({ method: "GET", url: `/api/dashboard-charts/${chart.id}` });
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(fetched.json(), chart);
});

test("a second chart lands at the next position; list is ordered by position", async () => {
  const { app } = await setup();
  const first = (
    await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })
  ).json() as DashboardChart;
  const second = (
    await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: SCANS_CHART })
  ).json() as DashboardChart;
  assert.equal(first.position, 0);
  assert.equal(second.position, 1);

  const list = (await app.inject({ method: "GET", url: "/api/dashboard-charts" })).json() as DashboardChart[];
  assert.deepEqual(
    list.map((c) => c.id),
    [first.id, second.id],
  );
});

test("PATCH /api/dashboard-charts/:id is a REAL partial update — an omitted field keeps its stored value", async () => {
  const { app } = await setup();
  const created = (
    await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })
  ).json() as DashboardChart;

  // Patch ONLY the name — config must survive untouched.
  const renamed = await app.inject({
    method: "PATCH",
    url: `/api/dashboard-charts/${created.id}`,
    payload: { name: "Renamed chart" },
  });
  assert.equal(renamed.statusCode, 200);
  const renamedChart = renamed.json() as DashboardChart;
  assert.equal(renamedChart.name, "Renamed chart");
  assert.deepEqual(renamedChart.config, created.config);
  assert.ok(renamedChart.updatedAt >= created.updatedAt);

  // Patch ONLY the config — name must survive untouched.
  const reconfigured = await app.inject({
    method: "PATCH",
    url: `/api/dashboard-charts/${created.id}`,
    payload: { config: SCANS_CHART.config },
  });
  assert.equal(reconfigured.statusCode, 200);
  const reconfiguredChart = reconfigured.json() as DashboardChart;
  assert.equal(reconfiguredChart.name, "Renamed chart");
  assert.deepEqual(reconfiguredChart.config, SCANS_CHART.config);
  assert.equal(reconfiguredChart.position, created.position, "PATCH never touches position");
});

test("POST /api/dashboard-charts/:id/clone creates a NEW chart with the SAME config, appended at the end", async () => {
  const { app } = await setup();
  const original = (
    await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })
  ).json() as DashboardChart;
  const other = (
    await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: SCANS_CHART })
  ).json() as DashboardChart;

  const cloned = await app.inject({ method: "POST", url: `/api/dashboard-charts/${original.id}/clone` });
  assert.equal(cloned.statusCode, 201);
  const clone = cloned.json() as DashboardChart;
  assert.notEqual(clone.id, original.id);
  assert.equal(clone.name, `${original.name} (copy)`);
  assert.deepEqual(clone.config, original.config);
  assert.equal(clone.position, 2, "the clone is appended at the end");

  // The source is untouched.
  const refetchedOriginal = (
    await app.inject({ method: "GET", url: `/api/dashboard-charts/${original.id}` })
  ).json() as DashboardChart;
  assert.deepEqual(refetchedOriginal, original);
  void other;
});

test("DELETE /api/dashboard-charts/:id is a HARD delete and renumbers the remaining positions", async () => {
  const { app, db } = await setup();
  const a = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })).json() as DashboardChart;
  const b = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: SCANS_CHART })).json() as DashboardChart;
  const c = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })).json() as DashboardChart;
  assert.deepEqual([a.position, b.position, c.position], [0, 1, 2]);

  const deleted = await app.inject({ method: "DELETE", url: `/api/dashboard-charts/${b.id}` });
  assert.equal(deleted.statusCode, 204);

  const row = db.prepare("SELECT 1 FROM dashboard_charts WHERE id = ?").get(b.id);
  assert.equal(row, undefined, "the row is physically gone (hard delete)");

  const list = (await app.inject({ method: "GET", url: "/api/dashboard-charts" })).json() as DashboardChart[];
  assert.deepEqual(
    list.map((x) => ({ id: x.id, position: x.position })),
    [
      { id: a.id, position: 0 },
      { id: c.id, position: 1 },
    ],
    "the remaining charts are renumbered to a dense 0..N-1 sequence, order preserved",
  );

  const refetch = await app.inject({ method: "GET", url: `/api/dashboard-charts/${b.id}` });
  assert.equal(refetch.statusCode, 404);

  const redelete = await app.inject({ method: "DELETE", url: `/api/dashboard-charts/${b.id}` });
  assert.equal(redelete.statusCode, 404, "deleting an already-deleted chart 404s (not a silent no-op)");
});

// ── Reorder ──────────────────────────────────────────────────────────────────────────────────────

test("POST /api/dashboard-charts/reorder applies a full valid order round-trip", async () => {
  const { app } = await setup();
  const a = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })).json() as DashboardChart;
  const b = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: SCANS_CHART })).json() as DashboardChart;
  const c = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })).json() as DashboardChart;

  const reordered = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts/reorder",
    payload: { orderedIds: [c.id, a.id, b.id] },
  });
  assert.equal(reordered.statusCode, 200);
  const result = reordered.json() as DashboardChart[];
  assert.deepEqual(
    result.map((x) => ({ id: x.id, position: x.position })),
    [
      { id: c.id, position: 0 },
      { id: a.id, position: 1 },
      { id: b.id, position: 2 },
    ],
  );

  const list = (await app.inject({ method: "GET", url: "/api/dashboard-charts" })).json() as DashboardChart[];
  assert.deepEqual(
    list.map((x) => x.id),
    [c.id, a.id, b.id],
    "the reordered list persists and re-lists in the new order",
  );
});

test("reorder with a MISSING id (partial reorder) 400s and applies NOTHING", async () => {
  const { app } = await setup();
  const a = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })).json() as DashboardChart;
  const b = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: SCANS_CHART })).json() as DashboardChart;

  const res = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts/reorder",
    payload: { orderedIds: [b.id] }, // missing `a.id`
  });
  assert.equal(res.statusCode, 400);

  const list = (await app.inject({ method: "GET", url: "/api/dashboard-charts" })).json() as DashboardChart[];
  assert.deepEqual(
    list.map((x) => ({ id: x.id, position: x.position })),
    [
      { id: a.id, position: 0 },
      { id: b.id, position: 1 },
    ],
    "an invalid reorder leaves positions untouched — never a silent partial apply",
  );
});

test("reorder with a FOREIGN (unknown) id 400s", async () => {
  const { app } = await setup();
  const a = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })).json() as DashboardChart;

  const res = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts/reorder",
    payload: { orderedIds: [a.id, "does-not-exist"] },
  });
  assert.equal(res.statusCode, 400);
});

test("reorder with a DUPLICATE id 400s", async () => {
  const { app } = await setup();
  const a = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })).json() as DashboardChart;
  const b = (await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: SCANS_CHART })).json() as DashboardChart;

  const res = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts/reorder",
    payload: { orderedIds: [a.id, a.id] }, // missing b.id entirely + a.id repeated
  });
  assert.equal(res.statusCode, 400);
  void b;
});

// ── (2) Validation — invalid config -> 400 with detail ─────────────────────────────────────────────

test("a mixed-unit `measures` array (the same-unit constraint) is rejected 400 with an actionable issue", async () => {
  const { app } = await setup();

  const res = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: {
      name: "Mixed units",
      config: {
        source: "runs",
        // tokensIn (unit "tokens") + costUsd (unit "usd") — a genuinely mixed-unit combo.
        measures: ["tokensIn", "costUsd"],
        filter: {},
        bucket: "day",
        chartType: "line",
      },
    },
  });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { issues?: Array<{ message: string }> };
  assert.ok(body.issues && body.issues.length > 0, "the 400 carries detail, not just a generic message");
  assert.match(body.issues?.[0]?.message ?? "", /Mixed units/);
});

test("a mixed-unit `scans` measures array is rejected 400 too", async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: {
      name: "Mixed scan units",
      config: {
        source: "scans",
        // totalTokens (unit "tokens") + totalTools (unit "count").
        measures: ["totalTokens", "totalTools"],
        bucket: "day",
        chartType: "bar",
      },
    },
  });
  assert.equal(res.statusCode, 400);
});

test("SAME-unit multi-measure is accepted (errorRate + guardrailRate are both `rate`)", async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: {
      name: "Rates",
      config: {
        source: "runs",
        measures: ["errorRate", "guardrailRate"],
        filter: {},
        bucket: "day",
        chartType: "line",
      },
    },
  });
  assert.equal(res.statusCode, 201);
});

test("an invalid `filter` (fails the shared RunFilter zod) is rejected 400 on create and on patch", async () => {
  const { app } = await setup();

  const badEnum = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: {
      name: "Bad filter",
      config: { source: "runs", measures: ["count"], filter: { status: ["not-a-real-status"] }, bucket: "day", chartType: "bar" },
    },
  });
  assert.equal(badEnum.statusCode, 400);

  const created = (
    await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })
  ).json() as DashboardChart;
  const badPatch = await app.inject({
    method: "PATCH",
    url: `/api/dashboard-charts/${created.id}`,
    payload: { config: { ...RUNS_CHART.config, filter: { status: ["nope"] } } },
  });
  assert.equal(badPatch.statusCode, 400);
});

test("an unknown config field is rejected 400 (.strict())", async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: {
      name: "Unknown field",
      config: { ...RUNS_CHART.config, totallyUnknownField: true },
    },
  });
  assert.equal(res.statusCode, 400);
});

test("an out-of-vocabulary measure/chartType/source is rejected 400", async () => {
  const { app } = await setup();
  const badMeasure = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: { name: "Bad measure", config: { ...RUNS_CHART.config, measures: ["not-a-real-measure"] } },
  });
  assert.equal(badMeasure.statusCode, 400);

  const badChartType = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: { name: "Bad chart type", config: { ...RUNS_CHART.config, chartType: "pie" } },
  });
  assert.equal(badChartType.statusCode, 400);

  const badSource = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: { name: "Bad source", config: { ...RUNS_CHART.config, source: "everything" } },
  });
  assert.equal(badSource.statusCode, 400);
});

test("an empty `measures` array is rejected 400", async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: "POST",
    url: "/api/dashboard-charts",
    payload: { name: "No measures", config: { ...RUNS_CHART.config, measures: [] } },
  });
  assert.equal(res.statusCode, 400);
});

test("GET /api/dashboard-charts/:id 404s for an unknown id", async () => {
  const { app } = await setup();
  const res = await app.inject({ method: "GET", url: "/api/dashboard-charts/does-not-exist" });
  assert.equal(res.statusCode, 404);
});

// ── (3) A saved chart's config re-executes IDENTICALLY through GET /api/metrics/* after a reload ──

test("a saved runs-chart's config drives GET /api/metrics/runs identically before and after reload", async () => {
  const { app, db } = await setup();
  seedRunsForMetrics(db);

  const created = (
    await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RUNS_CHART })
  ).json() as DashboardChart;

  const queryFor = (config: DashboardChart["config"]) => {
    if (config.source !== "runs") throw new Error("expected a runs config");
    const params = new URLSearchParams();
    params.set("filter", JSON.stringify(config.filter));
    params.set("bucket", config.bucket);
    params.set("measures", config.measures.join(","));
    if (config.groupBy) params.set("groupBy", config.groupBy);
    return `/api/metrics/runs?${params.toString()}`;
  };

  const before = await app.inject({ method: "GET", url: queryFor(created.config) });
  assert.equal(before.statusCode, 200);

  // Reload: fetch the chart fresh (re-parses config_json through the shared zod on the way out).
  const reloaded = (
    await app.inject({ method: "GET", url: `/api/dashboard-charts/${created.id}` })
  ).json() as DashboardChart;
  assert.deepEqual(reloaded.config, created.config, "the config round-trips byte-for-byte through storage");

  const after = await app.inject({ method: "GET", url: queryFor(reloaded.config) });
  assert.equal(after.statusCode, 200);
  assert.deepEqual(after.json(), before.json(), "the SAME config queries the metrics API identically after reload");

  // Sanity: the query actually returns real series (not an accidentally-empty result).
  const body = after.json() as { series: unknown[] };
  assert.ok(body.series.length > 0, "the fixture actually produced series data");
});

function seedRunsForMetrics(db: AppDatabase): void {
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

// ── (4) Migration v45 — BOTH the fresh-DB path and the pre-v45 upgrade path ────────────────────────

test("migration v45 — a fresh DB carries dashboard_charts (schema.ts baseline)", () => {
  const db = openFresh();
  assert.equal(
    LATEST_SCHEMA_VERSION,
    62,
    "LATEST_SCHEMA_VERSION auto-derived to 62 (v45 = dashboard_charts, custom chart composer; v46 = review_rubrics; v47 = hub_* tables, Assistant Hub WP0.2; v48 = hub_session_skills, Assistant Hub WP2.4; v49 = hub_memory.scope/scope_id + hub_agents.display_name + hub_crews.color + hub_sessions.archived_at, Assistant Hub UX WP1.0s; v50 = hub_sessions.tool_scope_json, end-user UX pass; v51 = hub_sessions.mode auto; v52 = hub_sessions.roster_json; v53 = hub_crews.icon, agent/crew avatar icons; v54 = hub_missions.parent_mission_id/depth/root_mission_id, crew-nesting mission-tree lineage; v55 = hub_sessions/hub_agents.provider_credential_id, model identity D-MI1; v56 = the acme_answers provider kind removed (purge + narrowed kind CHECK, mcp_server_id + scenarios.answers_mode dropped); v57 = notification/digest deep-link repair (stale /assistant/s/ + /testing/observability/issues/ paths rewritten); v58 = api_tokens, service tokens for headless/CI callers, planning/Roadmap/RM-08-ci WP 1.1; v59 = runs.cache_read_tokens/cache_write_tokens, the prompt-cache split on the run row, planning/Roadmap/RM-33-cache-aware-token-accounting WP 1.2; v60 = grade_feedback, human verdicts ON grades + the derived calibration set, planning/Roadmap/RM-07-benchmarks WP 6.1; v61 = watch_rules.paused_until + min_interval_minutes, watch-rule pause + on-terminal renotification interval, planning/Roadmap/RM-17-observability Phase 6 AM-OB10; v62 = skill_box_positions, canvas box positions kept APP-SIDE per skill so a position comment never inflates the metered SKILL.md body, planning/Roadmap/RM-30-ux-overhaul WP 7.8 decision 5)",
  );
  assert.equal(db.pragma("user_version", { simple: true }), 62, "fresh DB stamped at 62");
  assert.ok(tableExists(db, "dashboard_charts"), "fresh DB has the dashboard_charts table");
  assert.ok(indexExists(db, "idx_dashboard_charts_position"), "fresh DB has idx_dashboard_charts_position");

  // Immediately usable.
  db.prepare(
    "INSERT INTO dashboard_charts (id, name, config_json, position, created_at, updated_at) VALUES ('c1','Fresh chart','{}',0,@now,@now)",
  ).run({ now: NOW });
  const row = db.prepare("SELECT name FROM dashboard_charts WHERE id = 'c1'").get() as { name: string } | undefined;
  assert.equal(row?.name, "Fresh chart");
});

test("migration v45 — a pre-v45 (v44) DB gains dashboard_charts; neighboring rows survive; idempotent", () => {
  const db = track(new Database(":memory:"));
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql); // everything at latest, incl. dashboard_charts…
  db.exec("DROP TABLE IF EXISTS dashboard_charts;"); // …then rewind to a pre-v45 (v44) DB
  db.pragma("user_version = 44");
  assert.ok(!tableExists(db, "dashboard_charts"), "sanity: the v44 fixture lacks dashboard_charts");

  // A pre-existing, unrelated row (dashboard_charts is additive DDL only — it must survive untouched).
  db.prepare(
    "INSERT INTO provider_credentials (id, kind, label, created_at, updated_at) VALUES ('prov-pre45','anthropic','Claude',@now,@now)",
  ).run({ now: NOW });

  applyMigrations(db);

  assert.equal(db.pragma("user_version", { simple: true }), 62, "stamped to LATEST (62) after v45+v46");
  assert.ok(tableExists(db, "dashboard_charts"), "v45 created dashboard_charts on the existing (v44) DB");
  assert.ok(indexExists(db, "idx_dashboard_charts_position"), "v45 added idx_dashboard_charts_position");
  const provider = db.prepare("SELECT label FROM provider_credentials WHERE id = 'prov-pre45'").get() as
    | { label: string }
    | undefined;
  assert.equal(provider?.label, "Claude", "the additive migration preserves existing rows");

  // Usable immediately post-migration.
  db.prepare(
    "INSERT INTO dashboard_charts (id, name, config_json, position, created_at, updated_at) VALUES ('c1','Migrated chart','{}',0,@now,@now)",
  ).run({ now: NOW });
  const row = db.prepare("SELECT name FROM dashboard_charts WHERE id = 'c1'").get() as { name: string } | undefined;
  assert.equal(row?.name, "Migrated chart");

  // Idempotent: re-running is a no-op and leaves the version unchanged.
  assert.doesNotThrow(() => applyMigrations(db), "re-applying v45 is a no-op");
  assert.equal(db.pragma("user_version", { simple: true }), 62, "version unchanged after the re-run");
});

// ══ AM-OB4 — the ratio measure over the WIRE ══════════════════════════════════════════════════════
//
// The service-level maths is pinned in `metrics-runs.test.ts`. What these prove is the wire: that
// `?ratio=` reaches the aggregation as a second JSON param (rather than forcing this GET to a POST),
// that a saved chart carries its ratio through `dashboard_charts` unchanged, and that a
// HALF-CONFIGURED ratio is refused identically wherever it is expressed.

const RATIO_CHART: DashboardChartInput = {
  name: "Guardrail share of failures",
  config: {
    source: "runs",
    measures: ["ratio"],
    filter: {},
    bucket: "day",
    chartType: "line",
    ratio: {
      denominator: { outcome: ["error", "stopped_guardrail"] },
      numerator: { outcome: ["stopped_guardrail"] },
    },
  },
};

test("GET /api/metrics/runs accepts ?ratio= and returns the share, echoing the config back", async () => {
  const { app, db } = await setup();
  seedRunsForMetrics(db); // one completed run + one errored run, same day

  const params = new URLSearchParams();
  params.set("filter", "{}");
  params.set("bucket", "day");
  params.set("measures", "ratio");
  params.set("ratio", JSON.stringify({ numerator: { hasError: true } }));

  const res = await app.inject({ method: "GET", url: `/api/metrics/runs?${params.toString()}` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    series: { measure: string; points: { value: number; n: number }[] }[];
    unavailableMeasures: string[];
    ratio?: unknown;
  };
  const ratioSeries = body.series.filter((s) => s.measure === "ratio");
  assert.equal(ratioSeries.length, 1);
  // Hand-counted: `run-bad` of { `run-ok`, `run-bad` }.
  assert.deepEqual(
    (ratioSeries[0] as { points: { value: number; n: number }[] }).points.map((p) => [p.value, p.n]),
    [[0.5, 2]],
  );
  assert.deepEqual(body.unavailableMeasures, []);
  assert.deepEqual(body.ratio, { numerator: { hasError: true } }, "the config is echoed for transparency");
});

test("GET /api/metrics/runs 400s on a half-configured or FTS-bearing ratio", async () => {
  const { app } = await setup();
  const query = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ filter: "{}", bucket: "day", ...extra });
    return `/api/metrics/runs?${params.toString()}`;
  };

  // `ratio` selected with nothing to divide — a 400, not a silently empty chart.
  const missing = await app.inject({ method: "GET", url: query({ measures: "ratio" }) });
  assert.equal(missing.statusCode, 400);
  assert.match((missing.json() as { error: string }).error, /numerator/i);

  // A config with no `ratio` measure to plot it — the stale-config direction.
  const stray = await app.inject({
    method: "GET",
    url: query({ measures: "count", ratio: JSON.stringify({ numerator: {} }) }),
  });
  assert.equal(stray.statusCode, 400);

  // `q` on a ratio side. The metrics service has NO full-text path, so accepting this would answer a
  // different question than the one asked — exactly as the query's own `filter.q` is already refused.
  const withQ = await app.inject({
    method: "GET",
    url: query({ measures: "ratio", ratio: JSON.stringify({ numerator: { q: "timeout" } }) }),
  });
  assert.equal(withQ.statusCode, 400);
  assert.match((withQ.json() as { error: string }).error, /full-text/i);

  // Malformed JSON, and an unknown key inside (the `.strict()` shape).
  assert.equal((await app.inject({ method: "GET", url: query({ measures: "ratio", ratio: "{oops" }) })).statusCode, 400);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: query({ measures: "ratio", ratio: JSON.stringify({ numerator: {}, nope: 1 }) }),
      })
    ).statusCode,
    400,
  );
});

test("a saved ratio chart round-trips through dashboard_charts and re-executes identically", async () => {
  const { app, db } = await setup();
  seedRunsForMetrics(db);

  const created = (
    await app.inject({ method: "POST", url: "/api/dashboard-charts", payload: RATIO_CHART })
  ).json() as DashboardChart;
  assert.equal(created.config.source, "runs");

  const reloaded = (
    await app.inject({ method: "GET", url: `/api/dashboard-charts/${created.id}` })
  ).json() as DashboardChart;
  assert.deepEqual(reloaded.config, created.config, "the ratio config survives storage byte-for-byte");

  const queryFor = (config: DashboardChart["config"]) => {
    if (config.source !== "runs") throw new Error("expected a runs config");
    const params = new URLSearchParams();
    params.set("filter", JSON.stringify(config.filter));
    params.set("bucket", config.bucket);
    params.set("measures", config.measures.join(","));
    if (config.ratio) params.set("ratio", JSON.stringify(config.ratio));
    return `/api/metrics/runs?${params.toString()}`;
  };

  const before = await app.inject({ method: "GET", url: queryFor(created.config) });
  const after = await app.inject({ method: "GET", url: queryFor(reloaded.config) });
  assert.equal(before.statusCode, 200);
  assert.deepEqual(after.json(), before.json());
});

test("a chart config with a half-configured ratio is a 400 — in BOTH directions", async () => {
  const { app } = await setup();
  const post = (config: unknown) =>
    app.inject({ method: "POST", url: "/api/dashboard-charts", payload: { name: "x", config } });

  // "ratio" selected, no config.
  const missing = await post({
    source: "runs",
    measures: ["ratio"],
    filter: {},
    bucket: "day",
    chartType: "line",
  });
  assert.equal(missing.statusCode, 400);

  // A config carried by a chart that does not plot a ratio — the stale-numerator direction, which is
  // the one that misleads a reader rather than merely rendering nothing.
  const stray = await post({
    source: "runs",
    measures: ["errorRate"],
    filter: {},
    bucket: "day",
    chartType: "line",
    ratio: { numerator: { hasError: true } },
  });
  assert.equal(stray.statusCode, 400);

  // A `scans` chart has no `ratio` key at all — `.strict()` refuses it before the rule is reached.
  const scans = await post({
    source: "scans",
    measures: ["scanCount"],
    bucket: "day",
    chartType: "line",
    ratio: { numerator: {} },
  });
  assert.equal(scans.statusCode, 400);
});

test("ratio joins the same-unit family: it may share a chart with the other rates, not with tokens", async () => {
  const { app } = await setup();
  const post = (measures: string[], ratio?: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/dashboard-charts",
      payload: {
        name: "x",
        config: {
          source: "runs",
          measures,
          filter: {},
          bucket: "day",
          chartType: "line",
          ...(ratio !== undefined ? { ratio } : {}),
        },
      },
    });

  const ok = await post(["ratio", "errorRate"], { numerator: { hasError: true } });
  assert.equal(ok.statusCode, 201, "ratio is a `rate`, so it shares an axis with errorRate");

  const mixed = await post(["ratio", "tokensIn"], { numerator: { hasError: true } });
  assert.equal(mixed.statusCode, 400, "a share and a token count must never imply a shared axis");
});
