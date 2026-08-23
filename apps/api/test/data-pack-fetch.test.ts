// RM-38 WP 3.1 — the fetcher's own decisions, plus the pure path/URL guards.
//
// WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY IS NOT
// -----------------------------------------------------
// The five D-DP5 refusals are proved next door in `data-pack-fetch-http.test.ts`, control-and-case,
// against a real `node:http` listener — because a refusal proved only through a `fetch` stub is
// proved against a stub written by the same author to produce it. **Do not move a refusal case in
// here.**
//
// What IS here is the set of behaviours a socket cannot show, or can only show clumsily:
//
//   * that a DISABLED check opens no socket at all — which requires a `fetch` seam that counts, and
//     is the one place a stub is the right instrument rather than a compromise;
//   * the path and size guards, which run BEFORE anything is written and would otherwise need a
//     deliberately hostile listener (i.e. an authored failure — the thing the HTTP file forbids);
//   * the swap: what is on disk after a rename fails halfway, which needs a filesystem that can be
//     made to fail on command;
//   * the two pure helpers, exhaustively, as a table.
//
// EVERY refusal assertion below names the reason, never merely "something was refused" — and every
// one is paired with an accept that is one mutation away, for the same reason the HTTP file does it:
// "nothing was installed" is equally satisfied by a fetcher that fell over before it began.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  DATA_PACK_CONTENT_DIRS,
  DATA_PACK_MAX_REMOTE_FILE_BYTES,
  DATA_PACK_MAX_REMOTE_FILES,
  dataPackTotalBudgetMs,
  DATA_PACK_TOTAL_BUDGET_FACTOR,
  type DataPackManifest,
  isSafePackRelativePath,
  resolveDataPackFileUrl,
} from "@mcp-token-footprint/shared";
import { type DataPackWriteFs, nodeDataPackWriteFs } from "../src/data-pack/fs.js";
import { type DataPackFetchImpl, refreshDataPack } from "../src/data-pack/fetcher.js";
import { loadDataPack, type ResolvedDataPack } from "../src/data-pack/loader.js";
import {
  CACHE_PACK_DIRNAME,
  resolveDataPack,
  RETIRED_PACK_DIRNAME,
  STAGING_PACK_DIRNAME,
} from "../src/data-pack/resolve.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const REAL_PACK = path.join(REPO_ROOT, "data-pack");

const loadedBundle = loadDataPack({ dir: REAL_PACK, origin: "bundled" });
assert.ok(
  loadedBundle.ok,
  loadedBundle.ok ? "" : `${loadedBundle.refusal.reason}: ${loadedBundle.refusal.detail}`,
);
const BUNDLED: ResolvedDataPack = loadedBundle.pack;

type PackTree = Map<string, Buffer>;

function readRealPack(): PackTree {
  const tree: PackTree = new Map();
  tree.set("manifest.json", readFileSync(path.join(REAL_PACK, "manifest.json")));
  for (const dir of DATA_PACK_CONTENT_DIRS) {
    for (const entry of readdirSync(path.join(REAL_PACK, ...dir.split("/")), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      tree.set(`${dir}/${entry.name}`, readFileSync(path.join(REAL_PACK, ...dir.split("/"), entry.name)));
    }
  }
  return tree;
}

const BASE = readRealPack();

function manifestOf(tree: PackTree): DataPackManifest {
  return JSON.parse((tree.get("manifest.json") as Buffer).toString("utf8")) as DataPackManifest;
}

function setManifest(tree: PackTree, manifest: DataPackManifest): void {
  tree.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
}

/** The accepted base — see the HTTP file: the version bump is the precondition for an accept. */
function acceptedTree(): PackTree {
  const tree = new Map(BASE);
  const manifest = manifestOf(tree);
  manifest.packVersion = "9.9.9";
  setManifest(tree, manifest);
  return tree;
}

const tempDirs: string[] = [];
function tempDataDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aiwb-datapack-seam-"));
  tempDirs.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** A `fetch` double that serves a tree and COUNTS every call. The counting is the point. */
function servingFetch(tree: PackTree): { impl: DataPackFetchImpl; calls: string[] } {
  const calls: string[] = [];
  const impl: DataPackFetchImpl = async (url) => {
    calls.push(url);
    const rel = decodeURIComponent(new URL(url).pathname.replace(/^\/pack\//, ""));
    const bytes = tree.get(rel);
    if (!bytes) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { impl, calls };
}

const URL_BASE = "http://packs.invalid/pack/manifest.json";

async function run(options: {
  tree: PackTree;
  url?: string;
  enabled?: boolean;
  dataDirectory?: string;
  writeFs?: DataPackWriteFs;
}) {
  const dataDirectory = options.dataDirectory ?? tempDataDir();
  const { impl, calls } = servingFetch(options.tree);
  const result = await refreshDataPack({
    url: options.url ?? URL_BASE,
    enabled: options.enabled ?? true,
    timeoutMs: 5000,
    dataDirectory,
    inForce: BUNDLED,
    bundled: BUNDLED,
    deps: { fetchImpl: impl, ...(options.writeFs ? { writeFs: options.writeFs } : {}) },
  });
  return { result, calls, dataDirectory };
}

// --- Zero outbound requests when the check is off -------------------------------------------------

test("DATA_PACK_CHECK_ON_START=false makes ZERO outbound requests", async () => {
  // The control comes first: the same tree, the same seam, enabled → one request per file. So a
  // zero below means "the disabled path opened nothing", not "the double never worked".
  const control = await run({ tree: acceptedTree() });
  assert.equal(control.result.outcome.status, "installed", control.result.outcome.detail);
  assert.ok(control.calls.length > 1, "the control must actually have fetched something");

  const { result, calls, dataDirectory } = await run({ tree: acceptedTree(), enabled: false });
  assert.equal(result.outcome.status, "disabled");
  assert.deepEqual(calls, [], "a disabled check must not open a socket");
  assert.equal(readdirSync(dataDirectory).length, 0, "and must not touch DATA_DIR");
});

test("an EMPTY DATA_PACK_URL makes ZERO outbound requests — the air-gapped switch", async () => {
  const { result, calls } = await run({ tree: acceptedTree(), url: "" });
  assert.equal(result.outcome.status, "disabled");
  assert.match(result.outcome.detail, /DATA_PACK_URL is empty/);
  assert.deepEqual(calls, []);
});

test("a whitespace-only DATA_PACK_URL is empty, not a URL", async () => {
  const { result, calls } = await run({ tree: acceptedTree(), url: "   " });
  assert.equal(result.outcome.status, "disabled");
  assert.deepEqual(calls, []);
});

// --- The write-side path guard ---------------------------------------------------------------------

test("a manifest listing a traversal path is refused BEFORE any file is downloaded", async () => {
  const control = await run({ tree: acceptedTree() });
  assert.equal(control.result.outcome.status, "installed", control.result.outcome.detail);

  const tree = acceptedTree();
  const manifest = manifestOf(tree);
  // ONE entry's path. The manifest is untrusted input that decides where this process WRITES, and
  // it decides that before any digest, schema or ledger check can run.
  (manifest.files[0] as { path: string }).path = "../../../../etc/cron.d/evil.json";
  setManifest(tree, manifest);

  const { result, calls, dataDirectory } = await run({ tree });
  assert.equal(result.outcome.status, "refused");
  assert.equal(result.outcome.refusal?.reason, "schema_violation");
  assert.match(result.outcome.refusal?.detail ?? "", /will not fetch or write/);
  assert.deepEqual(
    calls,
    [URL_BASE],
    "only the manifest may have been fetched — the refusal precedes every file request",
  );
  assert.equal(readdirSync(dataDirectory).length, 0, "and nothing was written anywhere");
});

test("a manifest listing an absolute path, a backslash path or an unknown directory is refused", async () => {
  for (const hostile of [
    "/etc/passwd.json",
    "models\\saas\\evil.json",
    "not-a-content-dir/thing.json",
    "models/saas/../../../evil.json",
  ]) {
    const tree = acceptedTree();
    const manifest = manifestOf(tree);
    (manifest.files[0] as { path: string }).path = hostile;
    setManifest(tree, manifest);
    const { result } = await run({ tree });
    assert.equal(result.outcome.status, "refused", `${hostile} must be refused`);
    assert.equal(result.outcome.refusal?.reason, "schema_violation");
  }
});

// --- The size and count caps -----------------------------------------------------------------------

test("a manifest declaring an oversized file is refused before it is downloaded", async () => {
  const tree = acceptedTree();
  const manifest = manifestOf(tree);
  (manifest.files[0] as { bytes: number }).bytes = DATA_PACK_MAX_REMOTE_FILE_BYTES + 1;
  setManifest(tree, manifest);

  const { result, calls } = await run({ tree });
  assert.equal(result.outcome.status, "refused");
  assert.equal(result.outcome.refusal?.reason, "schema_violation");
  assert.match(result.outcome.refusal?.detail ?? "", /per-file cap/);
  assert.deepEqual(calls, [URL_BASE]);
});

test("a manifest listing more files than the cap is refused before it is downloaded", async () => {
  const tree = acceptedTree();
  const manifest = manifestOf(tree);
  const one = manifest.files[0] as DataPackManifest["files"][number];
  manifest.files = Array.from({ length: DATA_PACK_MAX_REMOTE_FILES + 1 }, () => ({ ...one }));
  setManifest(tree, manifest);

  const { result, calls } = await run({ tree });
  assert.equal(result.outcome.status, "refused");
  assert.equal(result.outcome.refusal?.reason, "schema_violation");
  assert.match(result.outcome.refusal?.detail ?? "", /file cap/);
  assert.deepEqual(calls, [URL_BASE]);
});

// --- The steady state ------------------------------------------------------------------------------

test("a pack at the SAME version is up_to_date, NOT a downgrade", async () => {
  // The distinction matters: equal is what every healthy install sees on every boot after the first
  // successful refresh. Reporting it as a refusal would fill the log with alarm about nothing, and
  // would make a genuine downgrade unfindable.
  const { result } = await run({ tree: new Map(BASE) });
  assert.equal(result.outcome.status, "up_to_date");
  assert.equal(result.outcome.remoteVersion, BUNDLED.manifest.packVersion);
  assert.equal(result.pack, undefined);
});

// --- The swap ---------------------------------------------------------------------------------------

test("when the swap-in rename fails, the PREVIOUS cache is put back", async () => {
  // The one moment `DATA_DIR/data-pack/` does not exist is between the two renames of a swap
  // (`rename(2)` onto a non-empty directory is ENOTEMPTY, so it cannot be one call). If the second
  // rename fails, the first must be undone — otherwise a failed refresh would have DELETED a
  // perfectly good cache, which is a strictly worse outcome than not refreshing.
  const dataDirectory = tempDataDir();

  // First, a real successful refresh, so there is a cache to protect.
  const seeded = await run({ tree: acceptedTree(), dataDirectory });
  assert.equal(seeded.result.outcome.status, "installed", seeded.result.outcome.detail);
  const cacheDir = path.join(dataDirectory, CACHE_PACK_DIRNAME);
  const before = loadDataPack({ dir: cacheDir, origin: "cache" });
  assert.ok(before.ok);
  assert.equal(before.pack.manifest.packVersion, "9.9.9");

  // Now a refresh whose swap-in rename throws. `staging → cache` is the second rename; the first,
  // `cache → retired`, is allowed through, so this reproduces exactly the half-completed state.
  const brokenSwap: DataPackWriteFs = {
    ...nodeDataPackWriteFs,
    rename: (from, to) => {
      if (path.basename(to) === CACHE_PACK_DIRNAME && path.basename(from) === STAGING_PACK_DIRNAME) {
        throw new Error("simulated rename failure");
      }
      nodeDataPackWriteFs.rename(from, to);
    },
  };
  const newer = acceptedTree();
  const manifest = manifestOf(newer);
  manifest.packVersion = "9.9.10";
  setManifest(newer, manifest);

  const { result } = await run({ tree: newer, dataDirectory, writeFs: brokenSwap });
  assert.equal(result.outcome.status, "unreachable");
  assert.match(result.outcome.detail, /could not be written/);

  const after = loadDataPack({ dir: cacheDir, origin: "cache" });
  assert.ok(after.ok, "the previous cache must still be loadable after a failed swap");
  assert.equal(after.pack.manifest.packVersion, "9.9.9", "and must be the version it was before");
  assert.ok(
    !readdirSync(dataDirectory).includes(RETIRED_PACK_DIRNAME),
    "the retired directory is not left behind",
  );
  assert.ok(!readdirSync(dataDirectory).includes(STAGING_PACK_DIRNAME), "nor the staging one");
});

test("resolveDataPack never looks at the staging directory, whatever is in it", async () => {
  // The structural half of "an interrupted download can never become the pack in force". Staging
  // holds a COMPLETE, VALID, NEWER pack — the most favourable leftover imaginable — and the boot
  // resolver still serves the bundled pack, because it reads `DATA_DIR/data-pack/` and nothing else.
  const dataDirectory = tempDataDir();
  const stagingDir = path.join(dataDirectory, STAGING_PACK_DIRNAME);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  for (const [rel, bytes] of acceptedTree()) {
    const abs = path.join(stagingDir, ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
  }

  const resolution = resolveDataPack({
    bundledDir: REAL_PACK,
    cacheDir: path.join(dataDirectory, CACHE_PACK_DIRNAME),
  });
  assert.equal(resolution.pack.origin, "bundled");
  assert.equal(resolution.pack.manifest.packVersion, BUNDLED.manifest.packVersion);
  assert.deepEqual(resolution.refusals, []);

  // The control that makes the above mean something: the SAME tree, at the cache path, DOES win.
  // Without it, "bundled served" would also be consistent with a resolver that ignores every cache.
  const cacheDir = path.join(dataDirectory, CACHE_PACK_DIRNAME);
  for (const [rel, bytes] of acceptedTree()) {
    const abs = path.join(cacheDir, ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
  }
  const withCache = resolveDataPack({ bundledDir: REAL_PACK, cacheDir });
  assert.equal(withCache.pack.origin, "cache");
  assert.equal(withCache.pack.manifest.packVersion, "9.9.9");
});

test("a successful refresh does not mutate the pack it replaced", async () => {
  // "In-flight work keeps the pack it started with" rests on exactly this: a `ResolvedDataPack` is
  // never edited in place, so anything holding a reference is unaffected by a swap. The seam that
  // publishes the new one (`installDataPackSource`) is a single assignment.
  //
  // WHAT THIS DOES NOT CLAIM: per-REQUEST isolation. A consumer that calls `getDataPack()` twice
  // inside one operation, straddling the swap, gets two different packs. Holding one reference for
  // the duration is the contract, and `compatibility/dataset.ts` already does it.
  const beforeVersion = BUNDLED.manifest.packVersion;
  const beforeModels = BUNDLED.documents.allModels.models.length;
  const beforeDir = BUNDLED.dir;

  const { result } = await run({ tree: acceptedTree() });
  assert.equal(result.outcome.status, "installed", result.outcome.detail);
  assert.notEqual(result.pack, BUNDLED, "a new pack is a new object");
  assert.equal(BUNDLED.manifest.packVersion, beforeVersion);
  assert.equal(BUNDLED.documents.allModels.models.length, beforeModels);
  assert.equal(BUNDLED.dir, beforeDir);
});

// --- The pure helpers, as a table --------------------------------------------------------------------

test("isSafePackRelativePath accepts exactly <content dir>/<name>.json", () => {
  for (const good of [
    "models/saas/anthropic.json",
    "models/open-weight/meta.json",
    "models/overrides.json",
    "limits/cross-cutting.json",
    "security/rules.json",
    "schema/manifest.schema.json",
    "generated/all-models.json",
  ]) {
    assert.equal(isSafePackRelativePath(good), true, `${good} is a legitimate pack path`);
  }

  for (const bad of [
    "",
    "manifest.json", // the manifest is never listed in its own files
    "/models/saas/a.json",
    "../models/saas/a.json",
    "models/saas/../../../a.json",
    "models/saas/a.json/../../b.json",
    "models\\saas\\a.json",
    "models/saas/a.txt",
    "models/saas/.json",
    "models/saas/.hidden.json",
    "models/nested/deeper/a.json",
    "elsewhere/a.json",
    "models/saas/%2e%2e/a.json",
    "models/saas/a .json",
    `models/saas/${"a".repeat(300)}.json`,
  ]) {
    assert.equal(isSafePackRelativePath(bad), false, `${JSON.stringify(bad)} must be refused`);
  }
});

test("resolveDataPackFileUrl stays under the manifest's own directory, on the same origin", () => {
  const base = "https://example.test/packs/v2/manifest.json";
  assert.equal(
    resolveDataPackFileUrl(base, "models/saas/anthropic.json"),
    "https://example.test/packs/v2/models/saas/anthropic.json",
  );
  // A path the write-side guard already rejects can never produce a URL either — the two guards are
  // independent, and neither is allowed to be the only one.
  assert.equal(resolveDataPackFileUrl(base, "../../../etc/passwd.json"), null);
  assert.equal(resolveDataPackFileUrl(base, "/etc/passwd.json"), null);
  // Non-http(s) schemes never resolve, so a manifest URL cannot become a file read or an FTP call.
  assert.equal(resolveDataPackFileUrl("file:///tmp/manifest.json", "limits/cross-cutting.json"), null);
  assert.equal(resolveDataPackFileUrl("not a url", "limits/cross-cutting.json"), null);
});

test("the total budget is a multiple of the per-request timeout, and never zero", () => {
  assert.equal(dataPackTotalBudgetMs(5000), 5000 * DATA_PACK_TOTAL_BUDGET_FACTOR);
  assert.equal(dataPackTotalBudgetMs(1), DATA_PACK_TOTAL_BUDGET_FACTOR);
  assert.ok(dataPackTotalBudgetMs(0) > 0, "a zero timeout must not produce a zero budget");
  assert.ok(dataPackTotalBudgetMs(-5) > 0);
});
