import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { API_TOKEN_AUTH_REQUIRED_ERROR_CODE } from "@mcp-token-footprint/shared";
import {
  isTrustedLocalPeer,
  parseDefaultGateway,
  resolveTrustedLocalPeers,
} from "../src/api-tokens/docker-host.js";
import { decideApiTokenAccess, registerApiTokenGuard } from "../src/api-tokens/guard.js";
import { ApiTokenRepository } from "../src/api-tokens/repository.js";
import { ApiTokenService } from "../src/api-tokens/service.js";
import { applyMigrations, type AppDatabase } from "../src/db/database.js";
import { schemaSql } from "../src/db/schema.js";

// RM-40 — the amendment to D-C2 that lets the Docker host's browser in. In a container, Docker
// Desktop delivers the host browser's connections from the container network's GATEWAY, so the
// loopback-only rule refused the whole containerized UI. These tests pin the widening to exactly one
// address, behind two switches, failing closed everywhere else.

/** The table read from the real running container (gateway `172.25.0.1`, container `172.25.0.2`). */
const CONTAINER_ROUTE_TABLE = [
  "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
  "eth0\t00000000\t010019AC\t0003\t0\t0\t0\t00000000\t0\t0\t0",
  "eth0\t000019AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0",
  "",
].join("\n");

const GATEWAY = "172.25.0.1";
const SIBLING_CONTAINER = "172.25.0.3";

test("parses the default gateway out of a real container's /proc/net/route", () => {
  assert.equal(parseDefaultGateway(CONTAINER_ROUTE_TABLE), GATEWAY);
});

test("no default route, a gateway-less default route, or garbage ⇒ no gateway", () => {
  const header = CONTAINER_ROUTE_TABLE.split("\n")[0];
  // Only the subnet route — no default.
  assert.equal(parseDefaultGateway(`${header}\neth0\t000019AC\t00000000\t0001\t0\t0\t0\t0000FFFF`), undefined);
  // A default route WITHOUT the RTF_GATEWAY flag.
  assert.equal(parseDefaultGateway(`${header}\neth0\t00000000\t010019AC\t0001\t0\t0\t0\t00000000`), undefined);
  // A zero gateway, a malformed hex value, an empty table.
  assert.equal(parseDefaultGateway(`${header}\neth0\t00000000\t00000000\t0003\t0\t0\t0\t00000000`), undefined);
  assert.equal(parseDefaultGateway(`${header}\neth0\t00000000\tZZZZZZZZ\t0003\t0\t0\t0\t00000000`), undefined);
  assert.equal(parseDefaultGateway(""), undefined);
});

test("trust needs BOTH the opt-in and Docker mode, and fails closed on an unreadable table", () => {
  const read = () => CONTAINER_ROUTE_TABLE;
  assert.deepEqual(
    [...resolveTrustedLocalPeers({ trustDockerHost: true, dockerMode: true, readRouteTable: read })],
    [GATEWAY],
  );
  assert.equal(
    resolveTrustedLocalPeers({ trustDockerHost: false, dockerMode: true, readRouteTable: read }).size,
    0,
  );
  assert.equal(
    resolveTrustedLocalPeers({ trustDockerHost: true, dockerMode: false, readRouteTable: read }).size,
    0,
  );
  const unreadable = () => {
    throw new Error("ENOENT: /proc/net/route");
  };
  assert.equal(
    resolveTrustedLocalPeers({ trustDockerHost: true, dockerMode: true, readRouteTable: unreadable })
      .size,
    0,
  );
});

test("a trusted peer matches in plain and IPv4-mapped IPv6 form, and nothing else does", () => {
  const trusted = new Set([GATEWAY]);
  assert.equal(isTrustedLocalPeer(GATEWAY, trusted), true);
  assert.equal(isTrustedLocalPeer(`::ffff:${GATEWAY}`, trusted), true);
  assert.equal(isTrustedLocalPeer(SIBLING_CONTAINER, trusted), false);
  assert.equal(isTrustedLocalPeer(undefined, trusted), false);
  assert.equal(isTrustedLocalPeer(GATEWAY, new Set()), false);
});

// ── The decision itself ─────────────────────────────────────────────────────────────────────────

function decide(remoteAddress: string, trustedLocalPeers?: ReadonlySet<string>, authRequired = false) {
  return decideApiTokenAccess({
    method: "GET",
    url: "/api/scans",
    remoteAddress,
    authorization: undefined,
    authRequired,
    authenticate: () => ({ ok: false, reason: "unknown" }) as never,
    ...(trustedLocalPeers ? { trustedLocalPeers } : {}),
  });
}

test("the Docker gateway passes like loopback only when it is trusted", () => {
  const trusted = new Set([GATEWAY]);
  assert.deepEqual(decide(GATEWAY, trusted), { kind: "pass" });
  // Without the widening — the defect: the host's own browser is refused.
  const refused = decide(GATEWAY);
  assert.equal(refused.kind, "refused");
});

test("a sibling container on the same network is still remote, even with the gateway trusted", () => {
  const result = decide(SIBLING_CONTAINER, new Set([GATEWAY]));
  assert.equal(result.kind, "refused");
  assert.equal(result.kind === "refused" && result.code, API_TOKEN_AUTH_REQUIRED_ERROR_CODE);
});

test("API_AUTH_REQUIRED still wins over a trusted peer, exactly as it wins over loopback", () => {
  assert.equal(decide(GATEWAY, new Set([GATEWAY]), true).kind, "refused");
});

// ── Over a real Fastify app, through the real socket address ────────────────────────────────────

const apps: FastifyInstance[] = [];
const databases: AppDatabase[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

async function makeApp(trustedLocalPeers?: ReadonlySet<string>) {
  const db = new Database(":memory:") as unknown as AppDatabase;
  db.pragma("foreign_keys = ON");
  db.exec(schemaSql);
  applyMigrations(db);
  databases.push(db);
  const app = Fastify({ logger: false });
  registerApiTokenGuard(app, new ApiTokenService(new ApiTokenRepository(db)), {
    authRequired: false,
    ...(trustedLocalPeers ? { trustedLocalPeers } : {}),
  });
  app.get("/api/scans", async () => ({ ok: true }));
  await app.ready();
  apps.push(app);
  return app;
}

test("end to end: the host browser via the Docker gateway reaches the API once trusted", async () => {
  const trustedApp = await makeApp(new Set([GATEWAY]));
  const allowed = await trustedApp.inject({ method: "GET", url: "/api/scans", remoteAddress: GATEWAY });
  assert.equal(allowed.statusCode, 200);

  const sibling = await trustedApp.inject({
    method: "GET",
    url: "/api/scans",
    remoteAddress: SIBLING_CONTAINER,
  });
  assert.equal(sibling.statusCode, 401);

  const untrustedApp = await makeApp();
  const refused = await untrustedApp.inject({ method: "GET", url: "/api/scans", remoteAddress: GATEWAY });
  assert.notEqual(refused.statusCode, 200);
});
