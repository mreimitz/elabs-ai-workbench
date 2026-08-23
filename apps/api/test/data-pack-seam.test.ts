// RM-38 WP 1.2 — the install-at-boot seam.
//
// The interesting failure this WP had to avoid is not "the loader is wrong". It is "the loader is
// right and somebody reads the pack before it is installed". `compatibility/dataset.ts` and
// `catalog.ts` used to read their JSON at MODULE LOAD, and in ESM every import in `index.ts` is
// evaluated before the first statement of `index.ts` runs — so a module-load read can never observe
// an install performed in `index.ts`'s body. Swapping the file read for `getDataPack()` without
// making the read lazy would have moved the bug rather than fixed it, and the symptom would have
// been import-order dependent.
//
// Five guards, and what each one CANNOT see:
//
//   1. LAZINESS (runtime). Importing the readers in a fresh module registry must leave the source
//      slot empty. Cannot see: whether a THIRD module reads the pack at load time — only the two
//      readers are probed.
//   2. LATE INSTALL WINS (runtime). A pack installed AFTER the reader module was imported must be
//      the one the reader returns. This is the assertion that goes red the moment a module-load
//      read comes back. Cannot see: an eager read that happens to produce the same values — which
//      is why the installed pack carries a sentinel that exists in no real pack.
//   3. ONE READER (source scan). No file in `apps/api/src` outside `data-pack/` may name a pack
//      document. Cannot see: a read spelled through a computed path (`"all-" + "models.json"`), or
//      a read of a pack file by a different name. It is a tripwire against the obvious regression,
//      not a proof of exclusivity.
//   4. BOOT ORDER + SHIPPING (source scan). `index.ts` installs the pack before
//      `installPricingResolver`, the build still runs the copy step, and the copy script's
//      directory list still equals the shared one. Cannot see: whether the copied bytes are
//      correct — running the built API is what shows that, and it is not something a unit test in
//      this suite does.
//   5. THE REFRESH IS OFF THE BOOT PATH (source scan, RM-38 WP 3.1). `index.ts` calls
//      `refreshDataPack` AFTER `await server.listen(` and does NOT await it. Cannot see: a refresh
//      moved into some helper that `index.ts` awaits before `listen` — the scan reads one file and
//      matches one call site, so an indirection defeats it. See the guard's own comment block.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DATA_PACK_CONTENT_DIRS, type FlatModel } from "@mcp-token-footprint/shared";
import type { ResolvedDataPack } from "../src/data-pack/loader.js";
import { resolveDataPackFromDisk } from "../src/data-pack/resolve.js";
import {
  getDataPack,
  installDataPackSource,
  isDataPackInstalled,
  resetDataPackSourceForTests,
} from "../src/data-pack/source.js";

const API_ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(API_ROOT, "src");
const REPO_ROOT = path.resolve(API_ROOT, "../..");

// --- 1 + 2. The readers resolve lazily, and a late install wins ----------------------------------

const SENTINEL_MODEL_ID = "wp12-seam-sentinel";
const SENTINEL_CATALOG_VERSION = "wp12-seam-sentinel-catalog";

function doctoredPack(real: ResolvedDataPack): ResolvedDataPack {
  const first = real.documents.allModels.models[0] as FlatModel;
  return {
    ...real,
    documents: {
      ...real.documents,
      allModels: {
        ...real.documents.allModels,
        model_count: 1,
        models: [{ ...first, model_id: SENTINEL_MODEL_ID }],
      },
      testCatalog: {
        ...(real.documents.testCatalog as Record<string, unknown>),
        catalog_version: SENTINEL_CATALOG_VERSION,
      },
    },
  };
}

test("importing the compatibility readers resolves NOTHING — the pack stays uninstalled", async () => {
  resetDataPackSourceForTests();
  assert.equal(isDataPackInstalled(), false, "precondition");

  await import("../src/compatibility/dataset.js?seam=lazy");
  await import("../src/compatibility/catalog.js?seam=lazy");

  assert.equal(
    isDataPackInstalled(),
    false,
    "a reader read the pack at module load — put it back behind getDataPack()",
  );
  resetDataPackSourceForTests();
});

test("a pack installed AFTER the readers were imported is the pack they return", async () => {
  resetDataPackSourceForTests();

  // Import FIRST, install SECOND. This is exactly the order ESM forces on `index.ts`, and exactly
  // the order a module-load read cannot survive.
  const dataset = (await import("../src/compatibility/dataset.js?seam=late")) as {
    listModelIds: () => string[];
    getModel: (id: string) => FlatModel | undefined;
  };
  const catalog = (await import("../src/compatibility/catalog.js?seam=late")) as {
    getCatalog: () => { catalog_version: string };
  };

  const real = resolveDataPackFromDisk().pack;
  resetDataPackSourceForTests();
  installDataPackSource(doctoredPack(real));

  assert.deepEqual(
    dataset.listModelIds(),
    [SENTINEL_MODEL_ID],
    "dataset.ts is answering from something other than the installed pack",
  );
  assert.ok(dataset.getModel(SENTINEL_MODEL_ID), "the id index must rebuild for a swapped pack");
  assert.equal(catalog.getCatalog().catalog_version, SENTINEL_CATALOG_VERSION);

  resetDataPackSourceForTests();
});

test("getDataPack() with nothing installed performs the SAME resolution boot performs", () => {
  // Order-independence, stated as an equality: whoever asks first gets the same pack, including the
  // DATA_DIR cache rung — not a quietly bundled-only answer.
  resetDataPackSourceForTests();
  const lazy = getDataPack();
  const boot = resolveDataPackFromDisk().pack;
  assert.equal(lazy.origin, boot.origin);
  assert.equal(lazy.dir, boot.dir);
  assert.equal(lazy.manifest.packVersion, boot.manifest.packVersion);
  assert.deepEqual(lazy.manifest.files, boot.manifest.files);
  assert.equal(isDataPackInstalled(), true, "a lazy resolution must install what it resolved");
});

// --- 3. One reader --------------------------------------------------------------------------

/** Rough comment strip. Good enough to tell a documented filename from a read of one. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(abs, out);
    else if (entry.name.endsWith(".ts")) out.push(abs);
  }
  return out;
}

test("only apps/api/src/data-pack/ names a pack document — nothing else reads one", () => {
  const needles = [
    "all-models.json",
    "cross-cutting-limits.json",
    "cross-cutting.json",
    "test-catalog.json",
    // Trailing slash on purpose: `compatibility/dataset.js` is an import every consumer makes.
    "compatibility/data/",
    // RM-38 WP 2.2 — path-qualified, because `thresholds.json` alone names two different documents.
    "advisor/thresholds.json",
    "quality/thresholds.json",
    "models/overrides.json",
  ];
  const allowed = path.join(SRC, "data-pack");

  const offenders: string[] = [];
  for (const file of walkTs(SRC)) {
    if (file.startsWith(`${allowed}${path.sep}`)) continue;
    const code = stripComments(readFileSync(file, "utf8"));
    for (const needle of needles) {
      if (code.includes(needle)) offenders.push(`${path.relative(REPO_ROOT, file)} → ${needle}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "the resolved pack is the one address (D-DP1); read it through getDataPack()",
  );
});

test("the compatibility engine does not touch the filesystem at all", () => {
  const offenders: string[] = [];
  for (const file of walkTs(path.join(SRC, "compatibility"))) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (/from\s+["']node:fs["']/.test(code)) offenders.push(path.relative(REPO_ROOT, file));
  }
  assert.deepEqual(offenders, [], "compatibility/* reads the resolved pack, never a path");
});

// --- 4. Boot order and shipping ------------------------------------------------------------------

test("index.ts installs the data pack before it installs the pricing resolver", () => {
  // stripComments: a guard a COMMENT can satisfy is a guard documentation keeps alive after the
  // code is gone. Proved on this file 2026-08-23 — see the sibling test below.
  const source = stripComments(readFileSync(path.join(SRC, "index.ts"), "utf8"));
  const installPack = source.indexOf("installDataPackSource(dataPackResolution.pack)");
  const installPricing = source.indexOf("installPricingResolver(pricingRepository)");
  assert.ok(installPack > 0, "index.ts must install a resolved data pack at boot");
  assert.ok(installPricing > 0, "index.ts must still install the pricing resolver");
  assert.ok(
    installPack < installPricing,
    "the pack is resolved first, so a cache refusal is logged before anything can serve",
  );
});

test("index.ts fires the data-pack refresh AFTER listen(), and does not await it", () => {
  // RM-38 WP 3.1, D-DP4: boot never waits on the network and never fails on it. That is not a
  // property of the fetcher — every failure path in it could be perfect and boot would still block
  // for the whole budget if this call moved four lines up. The guarantee is entirely POSITIONAL, and
  // `index.ts` says so in a comment: "AFTER `listen()`, and NOT awaited. That position is the entire
  // D-DP4 guarantee and it is structural rather than promised."
  //
  // Until this test existed, nothing enforced it. Inserting `await refreshDataPack({...})` above
  // `await server.listen(...)` — which destroys the guarantee completely — left the whole api suite
  // at "# pass 3964 # fail 0", EXIT=0. A live boot measurement (health at 1075 ms while the fetch ran
  // 5003 ms) proved the property on the day it was taken; it is not a standing guard, which is
  // exactly the distinction this item's ledger keeps drawing between a hand check and the gate.
  //
  // stripComments is NOT decoration here. This is a PRESENCE assertion — the shape this item has
  // already lost one guard to — and `index.ts` carries a comment block naming `refreshDataPack` a
  // few lines above the call. Without stripping, deleting the call and leaving the prose would pass.
  //
  // WHAT THIS CANNOT SEE, stated rather than implied:
  //   * a refresh moved into a helper that `index.ts` awaits before `listen` — the scan reads ONE
  //     file and matches ONE call site BY NAME, so any indirection walks straight past it;
  //   * whether the call is genuinely non-blocking at runtime — a `refreshDataPack` that did its
  //     work synchronously before returning a promise would satisfy every assertion below;
  //   * anything about the fetcher's own bounds. `data-pack-fetch-http.test.ts` owns those, and each
  //     is proved against a real listener with an elapsed-wall-clock assertion.
  // It is a tripwire against the regression that is actually likely — someone tidying boot order —
  // not a proof that the network is off the critical path.
  const source = stripComments(readFileSync(path.join(SRC, "index.ts"), "utf8"));

  const listenAt = source.indexOf("await server.listen(");
  assert.ok(listenAt > 0, "index.ts must still await server.listen(...)");

  const calls = [...source.matchAll(/refreshDataPack\(/g)].map((match) => match.index as number);
  assert.equal(
    calls.length,
    1,
    "index.ts must call refreshDataPack exactly once — a second call site is how the first one " +
      "quietly moves back onto the boot path while the original still reads as correct",
  );
  const callAt = calls[0] as number;

  assert.ok(
    callAt > listenAt,
    "the data-pack refresh must be fired AFTER server.listen() — D-DP4 is positional, and a call " +
      "above listen() blocks boot on the network for the whole budget",
  );

  const prefix = source.slice(Math.max(0, callAt - 32), callAt);
  assert.ok(
    !/\bawait\s+$/.test(prefix),
    "the data-pack refresh must NOT be awaited — an await here turns a hung URL into a hung boot " +
      "sequence, which is the one thing D-DP4 forbids",
  );
  assert.ok(
    /\bvoid\s+$/.test(prefix),
    "the refresh is fired with `void`, so a deliberate fire-and-forget reads as deliberate rather " +
      "than as a forgotten await somebody will later 'fix'",
  );
});

test("the api build still ships the pack into dist", () => {
  const pkg = JSON.parse(readFileSync(path.join(API_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(
    pkg.scripts.build as string,
    /copy-data-pack\.mjs/,
    "only apps/api/dist is copied into the runtime image — drop this step and the built API cannot boot",
  );
});

test("copy-data-pack.mjs ships exactly the directories the contract calls pack content", () => {
  // The script is a plain .mjs run by `tsc && node`, so it repeats the list rather than importing
  // it. This is what holds the two equal. WHAT IT CANNOT SEE: whether the copy actually happened —
  // only that the script intends to copy the right set.
  // stripComments is NOT decoration. Probed 2026-08-23: deleting the two lines that actually copy
  // the manifest, and adding one comment saying the script copies it, left this test GREEN. A guard
  // that reads un-stripped source asserts "someone wrote this string", not "the code does this".
  const source = stripComments(readFileSync(path.join(API_ROOT, "scripts/copy-data-pack.mjs"), "utf8"));
  const block = /const CONTENT_DIRS = \[([\s\S]*?)\];/.exec(source);
  assert.ok(block, "copy-data-pack.mjs must declare CONTENT_DIRS");
  const declared = [...(block[1] as string).matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  assert.deepEqual(declared, [...DATA_PACK_CONTENT_DIRS]);
  assert.match(source, /manifest\.json/, "the manifest must ship too — a pack without one is not one");
});
