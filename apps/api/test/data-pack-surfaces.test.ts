import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import {
  DataPackStatusSchema,
  requiredScopesForMethod,
  requiredScopesForRoute,
  type DataPackFetchOutcome,
} from "@mcp-token-footprint/shared";
import { registerDataPackRoutes } from "../src/data-pack/routes.js";
import { getDataPack } from "../src/data-pack/source.js";
import {
  getLastDataPackCheck,
  getLastDataPackRefusal,
  recordDataPackCheck,
  recordDataPackRefusal,
  resetDataPackStateForTests,
} from "../src/data-pack/state.js";
import {
  buildDataPackStatus,
  buildDiagnosticsDataPackGroup,
  dataPackCheckConfigured,
} from "../src/data-pack/status.js";
import { modelContextLimitsFor, qualityThresholds } from "../src/data-pack/thresholds.js";

// ==================================================================================================
// The data-pack surfaces — RM-38 WP 3.2
// ==================================================================================================
//
// `GET /api/data-pack`, `POST /api/data-pack/refresh`, and the `dataPack` group in the diagnostics
// bundle. Three claims are load-bearing and each is tested for its own reason:
//
//   1. **One read, one pack.** The metadata and the `values` block come from a SINGLE
//      `ResolvedDataPack`, so the browser can never render one pack's numbers beside another pack's
//      version. Proved by building the status over a doctored pack object and watching BOTH halves
//      move together.
//   2. **A failed check never looks like a successful one.** A refusal survives a later routine
//      check — the RM-17 lesson, where an empty window returned `breached:false` so the not-breached
//      branch wrote `window_recover` and a silent bench reported as "recovered".
//   3. **`DATA_PACK_URL`'s VALUE never reaches the diagnostics bundle.** WP 1.3 of RM-18 made that
//      structural for every environment variable; the fetcher composes its refusal sentences with
//      the checked URL inside them, so the group carries the refusal REASON and not the sentence.
//      Tested with a sentinel that is deliberately not credential-shaped, so it cannot come back
//      masked and pass for the wrong reason.

const apps: FastifyInstance[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  resetDataPackStateForTests();
});

/**
 * The routes, with the CHECK switched off.
 *
 * Deliberate: `config.dataPackUrl` defaults to the published release asset, so a refresh with
 * production settings would open a socket to GitHub from the test suite — slow, flaky offline, and
 * a network dependency the gate must not acquire. WP 3.1's own tests already exercise every fetch
 * path against a real `node:http` listener; what this file is about is the SURFACE.
 */
async function harness(overrides?: { enabled?: boolean }): Promise<string> {
  const app = Fastify({ logger: false });
  registerDataPackRoutes(app, { enabled: overrides?.enabled ?? false, url: "" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

/** A refusal outcome whose `detail` quotes the checked URL, exactly as `fetcher.ts` composes one. */
function refusedOutcome(url: string): DataPackFetchOutcome {
  return {
    status: "refused",
    detail: `The manifest served at ${url} does not satisfy the pack manifest contract: files: Required`,
    url,
    remoteVersion: "9.9.9",
    currentVersion: "1.0.0",
    refusal: {
      reason: "schema_violation",
      detail: `The manifest served at ${url} is not readable JSON.`,
      paths: ["manifest.json"],
    },
    durationMs: 12,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The payload
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("GET /api/data-pack answers the shared contract, with the pack in force", async () => {
  const baseUrl = await harness();
  const response = await fetch(`${baseUrl}/api/data-pack`);
  assert.equal(response.status, 200);

  const status = DataPackStatusSchema.parse(await response.json());
  const pack = getDataPack();
  assert.equal(status.packVersion, pack.manifest.packVersion);
  assert.equal(status.schemaVersion, pack.manifest.schemaVersion);
  assert.equal(status.asOf, pack.manifest.asOf);
  assert.equal(status.source, pack.origin);
  assert.equal(status.files, pack.manifest.files.length);
  assert.equal(status.analyzerVersion, pack.documents.securityTables.analyzerVersion);

  // The values block is the pack's, not the compiled floor's — asserted against the API's own
  // merge, which is the thing `apps/web` is now supposed to agree with.
  assert.deepEqual(status.values.modelContextLimits, modelContextLimitsFor(pack));
  assert.equal(
    status.values.defaultCompareThreshold,
    qualityThresholds().default_compare_threshold,
  );
  assert.equal(
    status.values.failureBucketScoreThreshold,
    qualityThresholds().failure_bucket_score_threshold,
  );
  assert.deepEqual(
    Object.keys(status.values.securityRules).sort(),
    Object.keys(pack.documents.securityTables.rules).sort(),
  );

  // Non-vacuity: these are real, populated tables, not empty objects that would satisfy any
  // comparison against each other.
  assert.ok(Object.keys(status.values.modelContextLimits).length > 20);
  assert.ok(Object.keys(status.values.securityRules).length >= 18);
});

test("the values block and the metadata come from ONE read of the pack", () => {
  const pack = getDataPack();
  // A doctored pack: a different version AND a different compare threshold. If the builder read the
  // pack twice (once for metadata, once for values) only one half would move.
  const doctored = {
    ...pack,
    manifest: { ...pack.manifest, packVersion: "7.7.7" },
    documents: {
      ...pack.documents,
      qualityThresholds: { ...pack.documents.qualityThresholds, default_compare_threshold: 0.11 },
    },
  };
  const status = buildDataPackStatus(doctored);
  assert.equal(status.packVersion, "7.7.7");
  assert.equal(status.values.defaultCompareThreshold, 0.11);
  // …and the process-wide pack is untouched, so this test cannot leak into another.
  assert.notEqual(getDataPack().manifest.packVersion, "7.7.7");
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A failed check must never read as a successful one
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("a refusal is recorded, and a LATER successful check does not clear it", () => {
  recordDataPackCheck(refusedOutcome("https://packs.example/manifest.json"));
  const refusal = getLastDataPackRefusal();
  assert.ok(refusal, "the refusal was not recorded at all");
  assert.equal(refusal.reason, "schema_violation");
  assert.equal(refusal.refusedVersion, "9.9.9");
  assert.equal(refusal.origin, "fetched");

  recordDataPackCheck({
    status: "up_to_date",
    detail: "The published pack is 1.0.0, the same version already in force.",
    currentVersion: "1.0.0",
  });

  // The CONTROL half: the later check really did land, so "the refusal survived" is not the same
  // statement as "nothing was recorded".
  assert.equal(getLastDataPackCheck()?.outcome.status, "up_to_date");
  assert.equal(
    getLastDataPackRefusal()?.reason,
    "schema_violation",
    "a routine check erased the refusal — a bench that went silent would read as recovered",
  );

  const status = buildDataPackStatus();
  assert.equal(status.lastCheck?.status, "up_to_date");
  assert.ok(status.lastRefusal, "the payload dropped the refusal the state still holds");
});

test("a boot-time CACHE refusal reaches the same slot, tagged by origin, without inventing a check", () => {
  recordDataPackRefusal(
    { reason: "digest_mismatch", detail: "Pack contents disagree with manifest.json." },
    "cache",
  );
  assert.equal(getLastDataPackRefusal()?.origin, "cache");
  // No remote check happened, and the payload does not pretend one did.
  assert.equal(getLastDataPackCheck(), null);
  assert.equal(buildDataPackStatus().lastCheck, undefined);
  assert.equal(buildDataPackStatus().lastCheckedAt, undefined);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The diagnostics group — no URL, structurally
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("the diagnostics group carries the refusal REASON and never the checked URL", () => {
  // Short and NOT credential-shaped, for the reason `diagnostics.test.ts` spells out: a realistic
  // 40-character token comes back masked whether or not it leaked, and the sweep would then pass for
  // the wrong reason.
  const sentinel = "https://Zq7Leak.example/manifest.json";
  recordDataPackCheck(refusedOutcome(sentinel));

  const group = buildDiagnosticsDataPackGroup();
  const serialized = JSON.stringify(group);

  assert.equal(
    serialized.includes("Zq7Leak"),
    false,
    `the checked URL reached the diagnostics group: ${serialized}`,
  );

  // The CONTROL — without it, "the sentinel is absent" would also be satisfied by a group that
  // recorded nothing at all.
  assert.equal(group.lastRefusal?.reason, "schema_violation");
  assert.equal(group.lastRefusal?.refusedVersion, "9.9.9");
  assert.equal(group.lastCheckStatus, "refused");
  assert.equal(
    "detail" in (group.lastRefusal ?? {}),
    false,
    "the group carries a free-text sentence, which is where a URL rides in",
  );
});

test("the diagnostics group carries no free text at all", () => {
  recordDataPackCheck(refusedOutcome("https://packs.example/manifest.json"));
  const group = buildDiagnosticsDataPackGroup();
  // Every string member is a version, a date, an origin word or a frozen enum member. None of them
  // is a sentence, and a sentence is what an operator-configured value rides in on.
  const strings = Object.values(group)
    .concat(Object.values(group.lastRefusal ?? {}))
    .filter((value): value is string => typeof value === "string");
  assert.ok(strings.length > 0);
  for (const value of strings) {
    assert.equal(
      value.includes(" "),
      false,
      `"${value}" is a sentence; the diagnostics group is counts, enums and versions only`,
    );
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The refresh route
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("POST /api/data-pack/refresh answers the SAME shape, and records the check it ran", async () => {
  const baseUrl = await harness();
  const response = await fetch(`${baseUrl}/api/data-pack/refresh`, { method: "POST" });
  assert.equal(response.status, 200);

  const status = DataPackStatusSchema.parse(await response.json());
  // The harness switches the check off, so the honest answer is `disabled` — and it is RECORDED
  // rather than silently dropped, which is what makes "no check has run" distinguishable from "a
  // check ran and found nothing".
  assert.equal(status.lastCheck?.status, "disabled");
  assert.ok(status.lastCheckedAt);
  assert.equal(status.packVersion, getDataPack().manifest.packVersion);
  // The route did not fabricate a success, and did not invent a refusal either.
  assert.equal(status.lastRefusal, undefined);
});

test("checkConfigured reports the real configuration, not the last outcome", () => {
  // `config.dataPackUrl` defaults to the published release asset and `DATA_PACK_CHECK_ON_START`
  // defaults to on, so an install that has configured nothing still HAS an update source. That is a
  // different fact from "the last check succeeded", and the payload keeps them apart.
  assert.equal(buildDataPackStatus().checkConfigured, dataPackCheckConfigured());
  assert.equal(typeof dataPackCheckConfigured(), "boolean");
});

test("the refresh needs an EXECUTE scope from a token — the coarse rule, deliberately not relaxed", () => {
  // A refresh reaches the network and REPLACES the data every verdict in this install is computed
  // against. That is heavier than a read even though it creates no row, so it is left on
  // `requiredScopesForMethod`'s POST answer rather than relaxed through `API_TOKEN_ROUTE_SCOPES`
  // (the only direction that table can move). Relaxing it would let a read-only token change what
  // the CI gate says.
  const coarse = requiredScopesForMethod("POST");
  const routed = requiredScopesForRoute(
    "POST",
    (rulePath) => rulePath === "/api/data-pack/refresh",
  );
  assert.deepEqual(routed, coarse);
  assert.equal(routed?.includes("read"), false);

  // And the read is a read.
  assert.deepEqual(
    requiredScopesForRoute("GET", (rulePath) => rulePath === "/api/data-pack"),
    ["read"],
  );
});
