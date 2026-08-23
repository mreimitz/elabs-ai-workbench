// RM-38 WP 3.1 — the five D-DP5 refusals and the two time bounds, over a REAL `node:http` socket.
//
// ==================================================================================================
// WHY THIS FILE EXISTS SEPARATELY FROM `data-pack-fetch.test.ts`
// ==================================================================================================
//
// The sibling file drives the fetcher through an injected `fetch` seam. That seam is a stub written
// by the same author as the code it exercises, encoding the same assumption — so **every refusal
// passes against a stub built to produce that refusal**, and the check cannot contradict what it
// checks. This item's ledger records that trap in advance, and RM-37 sharpened it: a local listener
// *written to satisfy a refusal* is the same self-fulfilling loop one layer down, with sockets. It
// would close "does the client survive a real socket" and close nothing about whether the refusal is
// the right refusal.
//
// So this file is CONTROL-AND-CASE, and no failing response is ever authored:
//
//   1. The listener serves a pack that is byte-valid and WOULD BE ACCEPTED.
//   2. Every case asserts that acceptance FIRST, from the same listener, in the same test.
//   3. Then exactly ONE mutation is applied to what the listener serves, and the refusal is
//      asserted BY NAME — not "a refusal happened", but that refusal, with its typed reason.
//
// Step 2 is not ceremony. A refusal is absence-shaped: "nothing was installed" is equally satisfied
// by a fetcher that threw before it built a URL, a listener that never started, a staging directory
// that was never written, or a verifier that was never called. The per-case accept is what rules all
// of those out, because the same server, the same client and the same code path produced an install
// moments earlier.
//
// --------------------------------------------------------------------------------------------------
// THE HALF THIS DOES NOT CLOSE — read this before quoting "now tested against real HTTP"
// --------------------------------------------------------------------------------------------------
// **It proves the client refuses a pack that differs from an accepted one by one mutation; it does
// NOT prove the mutation is the kind of change that ought to be refused, because the JSON Schemas,
// the rule-id ledger and the digest algorithm are all authored in this repository and travel with
// the fixture.** Concretely: an id renamed in `security/rules.json` *and* in the bundled registry
// would pass this file in silence, and a schema that states the wrong constraint is a schema this
// build agrees with. A second, independent statement of what a pack means — which does not exist and
// is not in this WP's scope — is the only thing that would close it. Second, no pack produced by the
// real publish path (WP 3.3) has ever been served here; the accepted base is this repository's own
// `data-pack/` with its version bumped.
//
// --------------------------------------------------------------------------------------------------
// PORTS
// --------------------------------------------------------------------------------------------------
// 8131–8134 are RM-38's allocation (see the ledger). Nothing else on the machine may be assumed
// free, and these are not port 0, deliberately: the allocation exists so concurrent sessions in this
// checkout do not collide, and a hard-coded port makes a collision a loud EADDRINUSE rather than a
// quiet reassignment.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  DATA_PACK_CONTENT_DIRS,
  DATA_PACK_SCHEMA_VERSION,
  type DataPackManifest,
} from "@mcp-token-footprint/shared";
import { refreshDataPack } from "../src/data-pack/fetcher.js";
import { loadDataPack, type ResolvedDataPack } from "../src/data-pack/loader.js";
import { CACHE_PACK_DIRNAME, STAGING_PACK_DIRNAME } from "../src/data-pack/resolve.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const REAL_PACK = path.join(REPO_ROOT, "data-pack");

const SERVE_PORT = 8131;
const HANG_PORT = 8132;
const SLOW_PORT = 8133;
const DEAD_PORT = 8134;

/** A pack tree: pack-root-relative POSIX path → bytes. Exactly what the listener serves. */
type PackTree = Map<string, Buffer>;

function readRealPack(): PackTree {
  const tree: PackTree = new Map();
  tree.set("manifest.json", readFileSync(path.join(REAL_PACK, "manifest.json")));
  for (const dir of DATA_PACK_CONTENT_DIRS) {
    const abs = path.join(REAL_PACK, ...dir.split("/"));
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      tree.set(`${dir}/${entry.name}`, readFileSync(path.join(abs, entry.name)));
    }
  }
  return tree;
}

function manifestOf(tree: PackTree): DataPackManifest {
  return JSON.parse((tree.get("manifest.json") as Buffer).toString("utf8")) as DataPackManifest;
}

function setManifest(tree: PackTree, manifest: DataPackManifest): void {
  tree.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
}

function getJson<T>(tree: PackTree, rel: string): T {
  return JSON.parse((tree.get(rel) as Buffer).toString("utf8")) as T;
}

function setJson(tree: PackTree, rel: string, value: unknown): void {
  tree.set(rel, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

/**
 * Re-derive every digest from the tree.
 *
 * This is BOOKKEEPING, not a second mutation, and the distinction is load-bearing for two of the
 * cases below. `manifest.json` is a GENERATED file — this repository's own rule for it is "never
 * hand-merge it; take a side and re-derive" — and it is derived by exactly this function for the
 * accepted control as well as for the case. So a case that changes a file's CONTENT and re-seals is
 * serving an internally consistent pack that differs from the accepted one in one place only, which
 * is what makes the resulting refusal attributable to the content change rather than to a stale
 * digest the fixture forgot to update.
 */
function reseal(tree: PackTree): PackTree {
  const manifest = manifestOf(tree);
  manifest.files = [...tree.keys()]
    .filter((p) => p !== "manifest.json")
    .sort()
    .map((p) => {
      const bytes = tree.get(p) as Buffer;
      return {
        path: p,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      };
    });
  setManifest(tree, manifest);
  return tree;
}

/**
 * The ACCEPTED base: this repository's real pack with `packVersion` raised so it is strictly newer
 * than the one in force.
 *
 * The bump is not a mutation under test — it is the precondition for an accept to be possible at
 * all. A pack at the same version is `up_to_date` by design (that is the steady state of every
 * healthy install), so without it there would be no control to be one mutation away from.
 * `packVersion` lives in the manifest, which digests everything except itself, so no reseal is
 * needed and no other byte moves.
 */
const ACCEPTED_VERSION = "9.9.9";
function acceptedTree(): PackTree {
  const tree = new Map(readRealPack());
  const manifest = manifestOf(tree);
  manifest.packVersion = ACCEPTED_VERSION;
  setManifest(tree, manifest);
  return tree;
}

// --- The listener ---------------------------------------------------------------------------------

let served: PackTree = acceptedTree();
let requestLog: string[] = [];
const servers: http.Server[] = [];
const sockets = new Set<Socket>();

function track(server: http.Server): http.Server {
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  servers.push(server);
  return server;
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      assert.equal(address.port, port, "the listener must be on RM-38's allocated port");
      resolve();
    });
  });
}

/** Serves `served` under `/pack/`. Anything not in the tree is a real 404. */
const packServer = track(
  http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "").replace(/^\/pack\//, ""));
    requestLog.push(rel);
    const bytes = served.get(rel);
    if (!bytes) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "content-length": bytes.byteLength });
    res.end(bytes);
  }),
);

/** Accepts the connection and never answers. The one thing a stub cannot honestly imitate. */
const hangServer = track(http.createServer(() => {}));

/** Answers every request correctly, but slowly — each one still well under the per-request bound. */
const SLOW_DELAY_MS = 150;
const slowServer = track(
  http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "").replace(/^\/pack\//, ""));
    const bytes = served.get(rel);
    setTimeout(() => {
      if (!bytes) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(bytes);
    }, SLOW_DELAY_MS);
  }),
);

/** Serves a real 404 for everything. */
const deadServer = track(
  http.createServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("no pack here");
  }),
);

const MANIFEST_URL = `http://127.0.0.1:${SERVE_PORT}/pack/manifest.json`;

let bundled: ResolvedDataPack;
const tempDirs: string[] = [];

function tempDataDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiwb-datapack-http-"));
  tempDirs.push(dir);
  return dir;
}

before(async () => {
  const loaded = loadDataPack({ dir: REAL_PACK, origin: "bundled" });
  assert.ok(loaded.ok, loaded.ok ? "" : `${loaded.refusal.reason}: ${loaded.refusal.detail}`);
  bundled = loaded.pack;
  await listen(packServer, SERVE_PORT);
  await listen(hangServer, HANG_PORT);
  await listen(slowServer, SLOW_PORT);
  await listen(deadServer, DEAD_PORT);
});

after(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(servers.map((server) => new Promise<void>((r) => server.close(() => r()))));
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** One refresh against the real listener, into a fresh `DATA_DIR`. */
async function refresh(options?: { url?: string; timeoutMs?: number; totalBudgetMs?: number }) {
  const dataDirectory = tempDataDir();
  const result = await refreshDataPack({
    url: options?.url ?? MANIFEST_URL,
    enabled: true,
    timeoutMs: options?.timeoutMs ?? 5000,
    ...(options?.totalBudgetMs === undefined ? {} : { totalBudgetMs: options.totalBudgetMs }),
    dataDirectory,
    inForce: bundled,
    bundled,
  });
  return { result, dataDirectory };
}

// --- The control, on its own ----------------------------------------------------------------------

test("CONTROL — the listener serves a pack that is accepted, verified and installed", async () => {
  served = acceptedTree();
  requestLog = [];
  const { result, dataDirectory } = await refresh();

  assert.equal(
    result.outcome.status,
    "installed",
    `expected an install, got ${result.outcome.status}: ${result.outcome.detail}`,
  );
  assert.equal(result.outcome.remoteVersion, ACCEPTED_VERSION);
  assert.equal(result.outcome.currentVersion, bundled.manifest.packVersion);
  assert.equal(result.pack?.manifest.packVersion, ACCEPTED_VERSION);
  assert.equal(result.pack?.origin, "fetched");

  // Every listed file really crossed the socket — otherwise "installed" could be reported by a
  // fetcher that verified the bundled pack it already had.
  assert.ok(requestLog.includes("manifest.json"));
  for (const entry of manifestOf(served).files) {
    assert.ok(requestLog.includes(entry.path), `${entry.path} was never requested`);
  }

  // …and it landed in the cache directory, loadable on its own, so the NEXT boot serves it.
  const cacheDir = path.join(dataDirectory, CACHE_PACK_DIRNAME);
  const reloaded = loadDataPack({ dir: cacheDir, origin: "cache" });
  assert.ok(reloaded.ok, reloaded.ok ? "" : reloaded.refusal.detail);
  assert.equal(reloaded.pack.manifest.packVersion, ACCEPTED_VERSION);
  assert.equal(result.pack?.dir, cacheDir, "the installed pack must name where its bytes are");

  // Nothing partial survives the successful path either.
  assert.equal(
    readdirSync(dataDirectory).sort().join(","),
    CACHE_PACK_DIRNAME,
    "a completed swap leaves the cache directory and nothing else",
  );
});

// --- The five refusals, each control-and-case from the same listener -------------------------------

/**
 * Assert the accept, apply ONE mutation, assert the refusal BY NAME.
 *
 * Both halves run against the same listener, the same client and the same code path, seconds apart.
 * The per-case accept is what makes "not installed" mean the refusal rather than a broken fetcher.
 */
async function controlThenCase(options: {
  mutate: (tree: PackTree) => PackTree;
  reason: string;
  detail: RegExp;
}): Promise<void> {
  served = acceptedTree();
  const control = await refresh();
  assert.equal(
    control.result.outcome.status,
    "installed",
    "CONTROL FAILED: the unmutated pack must be accepted, or the case below proves nothing " +
      `(${control.result.outcome.detail})`,
  );

  served = options.mutate(acceptedTree());
  const { result, dataDirectory } = await refresh();

  assert.equal(
    result.outcome.status,
    "refused",
    `expected a refusal, got ${result.outcome.status}: ${result.outcome.detail}`,
  );
  assert.equal(result.outcome.refusal?.reason, options.reason);
  assert.match(result.outcome.refusal?.detail ?? "", options.detail);
  assert.equal(result.pack, undefined, "a refused pack is never handed back for installation");

  // The refusal is not just a value: nothing was left on disk for a later boot to pick up. Both
  // directories are named explicitly, because "the cache is absent" alone would also be true of a
  // fetcher that fell over before it wrote anything.
  assert.equal(
    readdirSync(dataDirectory).length,
    0,
    "a refused pack leaves neither a cache nor a staging tree",
  );
}

test("REFUSAL 1 — a future schemaVersion is refused as unsupported_schema_version", async () => {
  await controlThenCase({
    mutate: (tree) => {
      // ONE field, in the manifest, which digests everything except itself — so no reseal, and no
      // other byte in the pack differs from the accepted control.
      const manifest = manifestOf(tree);
      manifest.schemaVersion = DATA_PACK_SCHEMA_VERSION + 1;
      setManifest(tree, manifest);
      return tree;
    },
    reason: "unsupported_schema_version",
    detail: /does not understand/,
  });
});

test("REFUSAL 2 — one flipped byte in one file is refused as digest_mismatch", async () => {
  await controlThenCase({
    mutate: (tree) => {
      // ONE byte, and deliberately NOT resealed: the manifest still describes the original bytes,
      // which is exactly the tamper-in-transit shape this refusal exists for.
      const target = "limits/cross-cutting.json";
      const bytes = Buffer.from(tree.get(target) as Buffer);
      const at = Math.floor(bytes.length / 2);
      bytes[at] = (bytes[at] as number) ^ 0x01;
      tree.set(target, bytes);
      return tree;
    },
    reason: "digest_mismatch",
    detail: /do not match their digest/,
  });
});

test("REFUSAL 3a — a malformed manifest field is refused as schema_violation", async () => {
  await controlThenCase({
    mutate: (tree) => {
      const manifest = manifestOf(tree) as unknown as Record<string, unknown>;
      manifest.asOf = "the day before yesterday";
      setManifest(tree, manifest as unknown as DataPackManifest);
      return tree;
    },
    reason: "schema_violation",
    detail: /manifest contract/,
  });
});

test("REFUSAL 3b — a model entry that violates its JSON Schema is refused as schema_violation", async () => {
  await controlThenCase({
    mutate: (tree) => {
      // The per-file JSON Schema path, which 3a cannot reach: 3a never gets past the manifest.
      // One content change, then the manifest re-derived by the SAME function that derives it for
      // the accepted control — so the pack stays internally consistent and the refusal cannot be an
      // artefact of a digest the fixture forgot to update. Without the reseal this would be caught
      // one step earlier, as `digest_mismatch`, and would silently stop testing the schema pass.
      const rel = [...tree.keys()].find((key) => key.startsWith("models/saas/")) as string;
      const doc = getJson<{ models: { status?: unknown }[] }>(tree, rel);
      (doc.models[0] as { status?: unknown }).status = "totally-shipped";
      setJson(tree, rel, doc);
      return reseal(tree);
    },
    reason: "schema_violation",
    detail: /status/,
  });
});

test("REFUSAL 4 — a packVersion below the one in force is refused as version_regression", async () => {
  await controlThenCase({
    mutate: (tree) => {
      const manifest = manifestOf(tree);
      manifest.packVersion = "0.0.1";
      setManifest(tree, manifest);
      return tree;
    },
    reason: "version_regression",
    detail: /not newer/,
  });
});

test("REFUSAL 5 — dropping a rule id from idLedger is refused as rule_ledger_not_append_only", async () => {
  await controlThenCase({
    mutate: (tree) => {
      // D-DP6. Same reseal reasoning as 3b — the content change is the mutation, the manifest is
      // re-derived rather than hand-edited.
      const doc = getJson<{ idLedger: string[] }>(tree, "security/rules.json");
      doc.idLedger.splice(3, 1);
      setJson(tree, "security/rules.json", doc);
      return reseal(tree);
    },
    reason: "rule_ledger_not_append_only",
    detail: /append-only|diverges/,
  });
});

test("the negative control for refusal 5 — APPENDING to the ledger is still accepted", async () => {
  // Without this, a check that refused every ledger would be indistinguishable from one that
  // refuses only a non-append-only one, and refusal 5 would look identically green either way.
  served = reseal(
    (() => {
      const tree = acceptedTree();
      const doc = getJson<{ idLedger: string[] }>(tree, "security/rules.json");
      doc.idLedger.push("poisoning.some-future-rule");
      setJson(tree, "security/rules.json", doc);
      return tree;
    })(),
  );
  const { result } = await refresh();
  assert.equal(
    result.outcome.status,
    "installed",
    `an append-only ledger must still be accepted: ${result.outcome.detail}`,
  );
});

// --- The two time bounds, each with a listener the other bound cannot explain ----------------------

test(
  "BOUND 1 — a server that accepts and never answers is cut off by the PER-REQUEST timeout",
  { timeout: 20_000 },
  async () => {
    // The control first: the same client, against a server that DOES answer, installs. So "the
    // request did not complete" below is about the hang, not about a fetcher that cannot fetch.
    served = acceptedTree();
    const control = await refresh();
    assert.equal(control.result.outcome.status, "installed", control.result.outcome.detail);

    // The budget is set two orders of magnitude above the per-request bound, so it CANNOT be what
    // fires. Exactly one bound can explain this result.
    const startedAt = Date.now();
    const { result, dataDirectory } = await refresh({
      url: `http://127.0.0.1:${HANG_PORT}/pack/manifest.json`,
      timeoutMs: 250,
      totalBudgetMs: 20_000,
    });
    const elapsed = Date.now() - startedAt;

    assert.equal(result.outcome.status, "unreachable");
    assert.match(result.outcome.detail, /did not answer within 250 ms/);
    // The assertion that actually bites. Without it the test passes even if the timeout does
    // nothing at all, because `node:test` would eventually kill the whole file and a status
    // assertion cannot tell "aborted at 250 ms" from "aborted at 20 s".
    assert.ok(
      elapsed < 5_000,
      `the per-request timeout did not bound the request: ${elapsed} ms elapsed against a 250 ms bound`,
    );
    assert.equal(readdirSync(dataDirectory).length, 0);
  },
);

test(
  "BOUND 2 — a server that answers every request just under the timeout is cut off by the TOTAL budget",
  { timeout: 30_000 },
  async () => {
    // This is the case the per-request timeout is blind to, and it is why there are two bounds.
    // Every single response arrives well inside the per-request bound; it is the SUM that is
    // unreasonable. The per-request timeout is set an order of magnitude above the delay so it
    // cannot fire, leaving exactly one explanation for the result.
    served = acceptedTree();
    const fileCount = served.size;
    const wouldTake = fileCount * SLOW_DELAY_MS;
    const budget = 900;
    assert.ok(
      wouldTake > budget * 2,
      `the fixture must genuinely overrun the budget: ${fileCount} files x ${SLOW_DELAY_MS} ms = ` +
        `${wouldTake} ms against a ${budget} ms budget`,
    );

    const startedAt = Date.now();
    const { result, dataDirectory } = await refresh({
      url: `http://127.0.0.1:${SLOW_PORT}/pack/manifest.json`,
      timeoutMs: 5_000,
      totalBudgetMs: budget,
    });
    const elapsed = Date.now() - startedAt;

    assert.equal(result.outcome.status, "unreachable");
    assert.match(result.outcome.detail, /total time budget/);
    assert.ok(
      elapsed < wouldTake / 2,
      `the total budget did not bound the check: ${elapsed} ms elapsed against a ${budget} ms budget ` +
        `(an unbounded run would take about ${wouldTake} ms)`,
    );
    assert.equal(readdirSync(dataDirectory).length, 0);
  },
);

// --- The ordinary network failures ----------------------------------------------------------------

test("a 404 from a real server is unreachable, not a refusal — and the pack in force is untouched", async () => {
  const before = bundled.manifest.packVersion;
  const { result, dataDirectory } = await refresh({
    url: `http://127.0.0.1:${DEAD_PORT}/pack/manifest.json`,
  });
  assert.equal(result.outcome.status, "unreachable");
  assert.match(result.outcome.detail, /HTTP 404/);
  assert.equal(result.pack, undefined);
  assert.equal(bundled.manifest.packVersion, before, "the pack in force is never mutated");
  assert.equal(readdirSync(dataDirectory).length, 0);
});

test("a closed port is unreachable — the app is expected to boot with no network at all", async () => {
  // Port 1 on loopback: nothing listens, and the connection is refused rather than hanging.
  const { result } = await refresh({ url: "http://127.0.0.1:1/pack/manifest.json", timeoutMs: 2000 });
  assert.equal(result.outcome.status, "unreachable");
  assert.equal(result.pack, undefined);
});

test("a staged tree from an interrupted run is discarded, never promoted", async () => {
  // The crash-recovery half of teeth 6, over the real listener. A previous process is simulated by
  // leaving a COMPLETE, VALID, NEWER pack in the staging directory — the most favourable possible
  // leftover — and the next refresh must still not promote it: `DATA_DIR/data-pack/` only ever
  // comes into existence through a rename of a tree THIS run verified.
  served = acceptedTree();
  const dataDirectory = tempDataDir();
  const stagingDir = path.join(dataDirectory, STAGING_PACK_DIRNAME);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  for (const [rel, bytes] of acceptedTree()) {
    const abs = path.join(stagingDir, ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
  }

  // With the check DISABLED, nothing runs at all — and the leftover is still not the pack in force,
  // because nothing ever reads that directory.
  const untouched = await refreshDataPack({
    url: "",
    enabled: false,
    timeoutMs: 5000,
    dataDirectory,
    inForce: bundled,
    bundled,
  });
  assert.equal(untouched.outcome.status, "disabled");
  assert.ok(
    !readdirSync(dataDirectory).includes(CACHE_PACK_DIRNAME),
    "a leftover staging tree must never appear as the cache",
  );

  // And a real run sweeps it before it downloads anything.
  const result = await refreshDataPack({
    url: MANIFEST_URL,
    enabled: true,
    timeoutMs: 5000,
    dataDirectory,
    inForce: bundled,
    bundled,
  });
  assert.equal(result.outcome.status, "installed", result.outcome.detail);
  assert.deepEqual(readdirSync(dataDirectory).sort(), [CACHE_PACK_DIRNAME]);
});
