// Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP3.R) — the label-table CONFORMANCE proof.
//
// REFUTES the claim that the console renders the new session model correctly across every backend kind
// and state. It seeds one persisted `runs` row per (kind × session state) DIRECTLY into a DB (the
// findings/08 pattern — NO provider key / NO engine), then drives the REAL `GET /api/runs/:id` route
// and feeds the returned body into the web console's ONE locked-table derivation
// (`apps/web/src/lib/status.ts` `deriveRunStatusView`), asserting the EXACT locked label + tone for each.
// This is the end-to-end persistence → API → derivation path proof the task asks for.
//
// `deriveRunStatusView` is pure (type-only imports from `@mcp-token-footprint/shared`), so importing the
// web module into this api test executes zero web runtime — it is the SAME function the console renders
// through. If WP3.1's table drifts from the seed harness's transcribed expectations, this test fails.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { RunDetail } from "@mcp-token-footprint/shared";
// The web console's ONE run/session status derivation — the exact function every console surface should
// render through (WP3.1 / D-US5). Imported across the package boundary for the review only (it has no
// runtime deps); production code never crosses this boundary.
import { deriveRunStatusView } from "../../web/src/lib/status.js";
import type { AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";
import { OAuthRepository } from "../src/oauth/repository.js";
import { OAuthService } from "../src/oauth/service.js";
import { ProviderRepository } from "../src/providers/repository.js";
import { ScanRepository } from "../src/scans/repository.js";
import { SecretStore } from "../src/secrets/secret-store.js";
import { ServerRepository } from "../src/servers/repository.js";
import { RunManager } from "../src/testing/run-manager.js";
import { RunRepository } from "../src/testing/run-repository.js";
import { RunService, type ModelFactory, type SessionOpener } from "../src/testing/run-service.js";
import { registerTestingRoutes } from "../src/testing/routes.js";
import { ScenarioRepository } from "../src/testing/scenario-repository.js";
import { ScenarioService } from "../src/testing/scenario-service.js";
import { TestRepository } from "../src/testing/test-repository.js";
import { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";
import {
  SEED_KINDS,
  SEED_STATES,
  SEED_STATE_SPECS,
  seedSessionGrid,
  type SeededRun,
} from "./support/session-seed-grid.js";

const databases: AppDatabase[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

/** A real Fastify app with the REAL testing routes over a fresh in-memory DB. GET-only tests never
 *  start a run, so the model factory / session opener are inert stubs (never invoked). */
async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  databases.push(db);

  const secrets = new SecretStore(crypto.randomBytes(32));
  const servers = new ServerRepository(db, secrets);
  const providers = new ProviderRepository(db, secrets);
  const oauthService = new OAuthService(servers, new OAuthRepository(db, secrets));
  const scenarioService = new ScenarioService(new ScenarioRepository(db), new ScanRepository(db));
  const testService = new TestService(new TestRepository(db));
  const runRepo = new RunRepository(db);
  const runManager = new RunManager(runRepo);
  // Never invoked (no run is started) — inert stubs so the GET route wiring is otherwise entirely real.
  const noop = (() => {
    throw new Error("executor stubs must not be called in a GET-only conformance test");
  }) as never;
  const runService = new RunService(
    scenarioService,
    testService,
    providers,
    servers,
    oauthService,
    runManager,
    runRepo,
    noop as ModelFactory,
    noop as SessionOpener,
  );

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "Validation failed" });
    const typed = error as Error & { statusCode?: number };
    return reply.code(typed.statusCode ?? 500).send({ error: toErrorMessage(error) });
  });
  await registerTestingRoutes(app, scenarioService, testService, runService, runRepo, runManager);
  apps.push(app);
  return { app, db };
}

/** Build the console's `RunStatusInput` from a `GET /api/runs/:id` body — the SAME facets the console
 *  threads into `deriveRunStatusView` (queuePosition is a LIVE-only detail, absent on a snapshot read). */
function inputFromDetail(detail: RunDetail) {
  return {
    status: detail.status,
    outcome: detail.outcome ?? null,
    stopReasonCode: detail.stopReasonCode ?? null,
    phase: detail.phase ?? null,
    ratingState: detail.ratingState ?? null,
  };
}

test("WP3.R conformance — persistence → GET /api/runs/:id → deriveRunStatusView renders the EXACT locked label+tone for every kind × state", async () => {
  const { app, db } = await makeApp();
  const seeded = seedSessionGrid(db);

  const rendered: string[] = [];
  const defects: string[] = [];

  for (const run of seeded) {
    const res = await app.inject({ method: "GET", url: `/api/runs/${run.runId}` });
    assert.equal(res.statusCode, 200, `GET ${run.runId} should 200`);
    const detail = res.json() as RunDetail;
    const view = deriveRunStatusView(inputFromDetail(detail));
    rendered.push(`${run.kind.padEnd(12)} ${run.state.padEnd(18)} → ${labelOf(view)}`);
    try {
      assert.deepEqual(view, run.expected);
    } catch {
      defects.push(
        `${run.kind}/${run.state}: expected ${JSON.stringify(run.expected)} but rendered ${JSON.stringify(view)}`,
      );
    }
  }

  // Emit the kind×state grid as evidence (visible in the test runner output / WP5.1 acceptance).
  console.log("\n── WP3.R seed grid — kind × state → rendered locked-table chip ──");
  for (const line of rendered) console.log("  " + line);
  console.log(`  (${seeded.length} rows: ${SEED_KINDS.length} kinds × ${SEED_STATES.length} states)\n`);

  assert.equal(defects.length, 0, `off-table renders:\n${defects.join("\n")}`);
});

test("WP3.R conformance — the same state renders an IDENTICAL chip across every backend kind (D-US5: kind never changes the label)", async () => {
  const { app, db } = await makeApp();
  const seeded = seedSessionGrid(db);

  const byState = new Map<string, SeededRun[]>();
  for (const run of seeded) {
    const list = byState.get(run.state) ?? [];
    list.push(run);
    byState.set(run.state, list);
  }

  for (const [state, runs] of byState) {
    const views: string[] = [];
    for (const run of runs) {
      const res = await app.inject({ method: "GET", url: `/api/runs/${run.runId}` });
      views.push(JSON.stringify(deriveRunStatusView(inputFromDetail(res.json() as RunDetail))));
    }
    const distinct = new Set(views);
    assert.equal(
      distinct.size,
      1,
      `state '${state}' rendered ${distinct.size} distinct chips across kinds: ${[...distinct].join(" | ")}`,
    );
  }
});

test("WP3.R conformance — a QUEUED run's live queue position renders 'Queued — position N' (live phase detail, not the snapshot read)", () => {
  const spec = SEED_STATE_SPECS.queued;
  assert.ok(spec.livePosition, "queued spec carries a live position");
  // The snapshot read (no position) is proven above → plain "Queued". The LIVE input threads the phase
  // event's `detail.position` — exactly what `use-run-stream` folds and forwards to `deriveRunStatusView`.
  const liveView = deriveRunStatusView({
    status: "pending",
    phase: "queued",
    queuePosition: spec.livePosition,
    ratingState: "pending",
  });
  assert.deepEqual(liveView, spec.expectedLive);
});

test("WP3.R conformance — GET reflects the seeded terminal triple faithfully (terminalFor round-trips through persistence)", async () => {
  const { app, db } = await makeApp();
  const seeded = seedSessionGrid(db);

  for (const run of seeded) {
    const res = await app.inject({ method: "GET", url: `/api/runs/${run.runId}` });
    const detail = res.json() as RunDetail;
    assert.equal(detail.status, run.persisted.status, `${run.runId} status`);
    assert.equal(detail.outcome ?? null, run.persisted.outcome, `${run.runId} outcome`);
    assert.equal(
      detail.stopReasonCode ?? null,
      run.persisted.stopReasonCode,
      `${run.runId} stopReasonCode`,
    );
    assert.equal(detail.phase ?? null, run.persisted.phase, `${run.runId} phase`);
    assert.equal(detail.ratingState, run.persisted.ratingState, `${run.runId} ratingState`);
    // Every seeded run carries a capability manifest (so the visual pass exercises the D-US4 KPI rail).
    assert.ok(detail.capabilities, `${run.runId} carries a capability manifest`);
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

function labelOf(view: ReturnType<typeof deriveRunStatusView>): string {
  if (view.kind === "none") return `— (no chip)`;
  const bits = [view.tone];
  if (view.spinner) bits.push("spinner");
  if (view.dashed) bits.push("dashed");
  return `"${view.label}"  [${bits.join(", ")}]`;
}
