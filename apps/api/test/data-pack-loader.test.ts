// RM-38 WP 1.2 — the pack loader and the bundled→cache resolver.
//
// Every case runs against an IN-MEMORY pack tree seeded from the real `data-pack/` on disk. Seeded,
// not invented: a hand-written fixture pack would have to satisfy `model-entry.schema.json`, and a
// fixture written to satisfy a schema tests the fixture author, not the loader. Mutations are then
// surgical — flip a byte, bump a version, add a file — and nothing is ever written back to the
// repository.
//
// WHAT THESE TESTS ASSERT, AND WHAT THEY THEREFORE CANNOT SEE
// ----------------------------------------------------------
// They assert the loader's DECISIONS over a directory it is handed: which refusal, in which order,
// and which pack wins. They do NOT exercise `nodeDataPackFs`, so a bug in the three-line real
// filesystem adapter would pass here — that adapter is covered by every other test in this suite
// reading the real pack through `getDataPack()`, and by the built-API boot check.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  DATA_PACK_CONTENT_DIRS,
  DATA_PACK_SCHEMA_VERSION,
  type DataPackManifest,
  SECURITY_ANALYZER_VERSION,
  type SecurityReport,
  diffSecurityReports,
} from "@mcp-token-footprint/shared";
import type { DataPackDirEntry, DataPackFs } from "../src/data-pack/fs.js";
import { loadDataPack } from "../src/data-pack/loader.js";
import {
  BUNDLED_PACK_DIRNAME,
  DataPackUnavailableError,
  findBundledPackDir,
  resolveDataPack,
} from "../src/data-pack/resolve.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const REAL_PACK = path.join(REPO_ROOT, "data-pack");

/** A pack tree: pack-root-relative POSIX path → bytes. */
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

const BASE = readRealPack();
const clone = (): PackTree => new Map(BASE);

function manifestOf(tree: PackTree): DataPackManifest {
  return JSON.parse((tree.get("manifest.json") as Buffer).toString("utf8")) as DataPackManifest;
}

function setManifest(tree: PackTree, manifest: DataPackManifest): void {
  tree.set("manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
}

/** Recompute every digest from the tree, so a content mutation can be tested WITHOUT a digest hit. */
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

function setJson(tree: PackTree, rel: string, value: unknown): void {
  tree.set(rel, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function getJson<T>(tree: PackTree, rel: string): T {
  return JSON.parse((tree.get(rel) as Buffer).toString("utf8")) as T;
}

/** Mounts one or more pack trees at fake absolute directories. Nothing on disk is touched. */
function memFs(mounts: Record<string, PackTree>): DataPackFs {
  const files = new Map<string, Buffer>();
  for (const [dir, tree] of Object.entries(mounts)) {
    for (const [rel, bytes] of tree) files.set(path.join(dir, ...rel.split("/")), bytes);
  }
  const dirs = new Set<string>();
  for (const abs of files.keys()) {
    let parent = path.dirname(abs);
    while (parent && parent !== path.dirname(parent)) {
      dirs.add(parent);
      parent = path.dirname(parent);
    }
  }
  return {
    exists: (p) => files.has(p) || dirs.has(p),
    readFile: (p) => {
      const bytes = files.get(p);
      if (!bytes) throw new Error(`ENOENT: ${p}`);
      return bytes;
    },
    readDir: (p) => {
      if (!dirs.has(p)) throw new Error(`ENOTDIR: ${p}`);
      const out = new Map<string, DataPackDirEntry>();
      for (const abs of files.keys()) {
        if (!abs.startsWith(`${p}${path.sep}`)) continue;
        const rest = abs.slice(p.length + 1);
        const first = rest.split(path.sep)[0] as string;
        out.set(first, { name: first, isDirectory: rest.includes(path.sep) });
      }
      return [...out.values()];
    },
  };
}

const BUNDLED_DIR = path.join(path.sep, "mem", "bundled");
const CACHE_DIR = path.join(path.sep, "mem", "cache");

function load(tree: PackTree) {
  return loadDataPack({
    dir: BUNDLED_DIR,
    origin: "bundled",
    fs: memFs({ [BUNDLED_DIR]: tree }),
  });
}

// --- The happy path ------------------------------------------------------------------------------

test("the real pack loads whole: manifest, roster, cross-cutting limits and catalog", () => {
  const result = load(clone());
  assert.ok(result.ok, result.ok ? "" : `${result.refusal.reason}: ${result.refusal.detail}`);
  assert.equal(result.pack.origin, "bundled");
  assert.equal(result.pack.dir, BUNDLED_DIR);
  assert.equal(result.pack.manifest.schemaVersion, DATA_PACK_SCHEMA_VERSION);
  assert.equal(result.pack.documents.allModels.models.length, 55);
  assert.equal(
    (result.pack.documents.crossCutting as { clients?: { cursor?: { max_tools?: number } } }).clients
      ?.cursor?.max_tools,
    40,
  );
  assert.equal((result.pack.documents.testCatalog as { tests: unknown[] }).tests.length, 39);
});

// --- Refusals are values, never throws (D-DP4) ---------------------------------------------------

test("a truncated manifest.json refuses instead of throwing", () => {
  const tree = clone();
  const full = (tree.get("manifest.json") as Buffer).toString("utf8");
  tree.set("manifest.json", Buffer.from(full.slice(0, Math.floor(full.length / 2))));

  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "schema_violation");
  assert.match(result.ok === false ? result.refusal.detail : "", /not readable JSON/);
});

test("a missing manifest.json refuses — a directory without one is not a pack", () => {
  const tree = clone();
  tree.delete("manifest.json");
  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "schema_violation");
});

test("a manifest that fails the compiled-in zod contract refuses", () => {
  const tree = clone();
  const manifest = manifestOf(tree) as unknown as Record<string, unknown>;
  manifest.packVersion = "1.0"; // not a semver core
  setManifest(tree, manifest as unknown as DataPackManifest);
  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "schema_violation");
});

test("an unsupported schemaVersion refuses as unsupported — BEFORE any digest is looked at", () => {
  // The ordering is the point (teeth 2): a pack from a future layout must be refused for the
  // reason an operator can act on, not buried under digest noise from files this build cannot
  // read. So this tree is corrupt in BOTH ways at once, and the version must win.
  const tree = clone();
  tree.set("limits/cross-cutting.json", Buffer.from("{}"));
  const manifest = manifestOf(tree);
  manifest.schemaVersion = DATA_PACK_SCHEMA_VERSION + 1;
  setManifest(tree, manifest);

  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(
    result.ok === false && result.refusal.reason,
    "unsupported_schema_version",
    "move the schemaVersion check after the digest walk and this goes red",
  );
});

test("a single flipped byte in a pack file refuses with digest_mismatch, naming the file", () => {
  const tree = clone();
  const target = "models/saas/anthropic.json";
  const doc = getJson<{ models: { id: string }[] }>(tree, target);
  (doc.models[0] as { id: string }).id = "tampered";
  setJson(tree, target, doc); // deliberately NOT resealed

  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "digest_mismatch");
  assert.deepEqual(result.ok === false && result.refusal.paths, [target]);
});

test("a file the manifest does not list refuses — an unlisted file would ride unverified", () => {
  const tree = clone();
  tree.set("limits/smuggled.json", Buffer.from("{}\n"));
  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "digest_mismatch");
  assert.deepEqual(result.ok === false && result.refusal.paths, ["limits/smuggled.json"]);
});

test("a pack file that violates its JSON Schema refuses, even with every digest correct", () => {
  const tree = clone();
  const target = "models/saas/anthropic.json";
  const doc = getJson<{ models: Record<string, unknown>[] }>(tree, target);
  Reflect.deleteProperty(doc.models[0] as Record<string, unknown>, "id");
  setJson(tree, target, doc);
  reseal(tree);

  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "schema_violation");
  assert.deepEqual(result.ok === false && result.refusal.paths, [target]);
});

test("an empty model roster refuses — a blank heatmap is worse than a refusal", () => {
  const tree = clone();
  const doc = getJson<Record<string, unknown>>(tree, "generated/all-models.json");
  doc.models = [];
  setJson(tree, "generated/all-models.json", doc);
  reseal(tree);

  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "schema_violation");
  assert.deepEqual(result.ok === false && result.refusal.paths, ["generated/all-models.json"]);
});

// --- RM-38 WP 2.2 — the three judgement tables ---------------------------------------------------
//
// These three documents have NO compiled fallback on the advisor side and only a merge FLOOR on the
// model/quality side, so a pack that carries a broken one must be refused whole rather than half
// applied. Each is checked twice over: by its own JSON Schema (step 4) and by a compiled-in zod
// contract (step 5). The zod layer is what these cases exercise — the schema layer is already
// covered by the case above.

test("a judgement table missing a required key refuses the whole pack", () => {
  for (const [rel, key] of [
    ["advisor/thresholds.json", "high_waste_share"],
    ["quality/thresholds.json", "default_compare_threshold"],
    ["models/overrides.json", "zero_price_models"],
  ] as const) {
    const tree = clone();
    const doc = getJson<Record<string, unknown>>(tree, rel);
    Reflect.deleteProperty(doc, key);
    setJson(tree, rel, doc);
    reseal(tree);

    const result = load(tree);
    assert.equal(result.ok, false, `${rel} without ${key} must refuse`);
    assert.equal(result.ok === false && result.refusal.reason, "schema_violation");
    assert.deepEqual(result.ok === false && result.refusal.paths, [rel]);
  }
});

test("a judgement table whose value has the wrong TYPE refuses, not coerces", () => {
  const tree = clone();
  const doc = getJson<Record<string, unknown>>(tree, "advisor/thresholds.json");
  doc.top_tools = "five";
  setJson(tree, "advisor/thresholds.json", doc);
  reseal(tree);

  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "schema_violation");
  assert.match(
    (result.ok === false && result.refusal.detail) || "",
    /top_tools/,
    "the refusal must name the offending field, not just the file",
  );
});

test("an UNKNOWN key in a judgement table refuses — a silently ignored knob is a lie", () => {
  // `.strict()` on the zod contract and `additionalProperties: false` in the JSON Schema both catch
  // this. It matters because the failure mode otherwise is an operator editing a misspelled key,
  // seeing the pack accepted, and concluding the threshold did not do anything.
  const tree = clone();
  const doc = getJson<Record<string, unknown>>(tree, "quality/thresholds.json");
  doc.defualt_compare_threshold = 0.9;
  setJson(tree, "quality/thresholds.json", doc);
  reseal(tree);

  const result = load(tree);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.refusal.reason, "schema_violation");
});

// --- The resolver: bundled → cache (D-DP2) -------------------------------------------------------

function resolveWith(cache: PackTree | null, bundled: PackTree = clone()) {
  const mounts: Record<string, PackTree> = { [BUNDLED_DIR]: bundled };
  if (cache) mounts[CACHE_DIR] = cache;
  return resolveDataPack({
    bundledDir: BUNDLED_DIR,
    cacheDir: cache ? CACHE_DIR : null,
    fs: memFs(mounts),
  });
}

function withPackVersion(version: string): PackTree {
  const tree = clone();
  const manifest = manifestOf(tree);
  manifest.packVersion = version;
  setManifest(tree, manifest);
  return tree;
}

test("no cache at all: the bundled pack serves, with no refusals", () => {
  const resolution = resolveWith(null);
  assert.equal(resolution.pack.origin, "bundled");
  assert.deepEqual(resolution.refusals, []);
});

test("a valid, strictly-newer cache wins over the bundled snapshot", () => {
  const resolution = resolveWith(withPackVersion("9.9.9"));
  assert.equal(resolution.pack.origin, "cache");
  assert.equal(resolution.pack.manifest.packVersion, "9.9.9");
  assert.deepEqual(resolution.refusals, []);
});

test("a cache at the SAME version is refused as a regression; the bundled pack keeps serving", () => {
  const bundled = clone();
  const resolution = resolveWith(withPackVersion(manifestOf(bundled).packVersion), bundled);
  assert.equal(resolution.pack.origin, "bundled");
  assert.equal(resolution.refusals.length, 1);
  assert.equal(resolution.refusals[0]?.reason, "version_regression");
});

test("an OLDER cache is refused as a regression", () => {
  const resolution = resolveWith(withPackVersion("0.0.1"));
  assert.equal(resolution.pack.origin, "bundled");
  assert.equal(resolution.refusals[0]?.reason, "version_regression");
});

test("an invalid cache is refused as a value and boot continues on the bundled pack", () => {
  const cache = withPackVersion("9.9.9");
  const full = (cache.get("manifest.json") as Buffer).toString("utf8");
  cache.set("manifest.json", Buffer.from(full.slice(0, 40)));

  const resolution = resolveWith(cache);
  assert.equal(resolution.pack.origin, "bundled", "a bad cache must never take the pack down");
  assert.equal(resolution.refusals.length, 1);
  assert.equal(resolution.refusals[0]?.reason, "schema_violation");
  assert.equal(resolution.refusals[0]?.origin, "cache");
});

test("a newer cache whose CONTENT is tampered is refused; the bundled pack keeps serving", () => {
  const cache = withPackVersion("9.9.9");
  cache.set("limits/cross-cutting.json", Buffer.from("{}\n"));
  const resolution = resolveWith(cache);
  assert.equal(resolution.pack.origin, "bundled");
  assert.equal(resolution.refusals[0]?.reason, "digest_mismatch");
});

// --- The one thing that DOES throw: a broken build artifact --------------------------------------

test("a missing bundled snapshot throws, naming where it looked", () => {
  assert.throws(
    () =>
      resolveDataPack({
        bundledDir: null,
        bundledSearched: ["/app/apps/api/dist/data-pack-bundled"],
        fs: memFs({}),
      }),
    (error: unknown) =>
      error instanceof DataPackUnavailableError &&
      /data-pack-bundled/.test(error.message) &&
      /copy-data-pack/.test(error.message),
    "a missing snapshot must stop boot, not serve an empty model list",
  );
});

test("an unusable bundled snapshot throws rather than degrading", () => {
  const bundled = clone();
  bundled.set("limits/cross-cutting.json", Buffer.from("{}\n"));
  assert.throws(
    () =>
      resolveDataPack({
        bundledDir: BUNDLED_DIR,
        cacheDir: null,
        fs: memFs({ [BUNDLED_DIR]: bundled }),
      }),
    (error: unknown) =>
      error instanceof DataPackUnavailableError && /digest_mismatch/.test(error.message),
  );
});

// --- Where the bundled snapshot is looked for ----------------------------------------------------

test("compiled code looks ONLY beside dist; it never falls back to the repository's data-pack/", () => {
  // This is teeth 3 in unit form. Running `node apps/api/dist/index.js` inside a checkout, a
  // fallback chain would find the repository's own `data-pack/` and a missing
  // `dist/data-pack-bundled/` would ship undetected.
  const distModuleDir = path.join(path.sep, "app", "apps", "api", "dist", "data-pack");
  const expected = path.join(path.sep, "app", "apps", "api", "dist", BUNDLED_PACK_DIRNAME);
  const repoPack = path.join(path.sep, "app", "data-pack");

  const present = findBundledPackDir(distModuleDir, {
    exists: (p) => p === path.join(expected, "manifest.json"),
    readFile: () => Buffer.alloc(0),
    readDir: () => [],
  });
  assert.equal(present.dir, expected);
  assert.deepEqual(present.searched, [expected]);

  const missing = findBundledPackDir(distModuleDir, {
    // The repository copy exists and is a perfectly good pack — and must still not be used.
    exists: (p) => p === path.join(repoPack, "manifest.json"),
    readFile: () => Buffer.alloc(0),
    readDir: () => [],
  });
  assert.equal(missing.dir, null);
  assert.deepEqual(missing.searched, [expected]);
});

test("source code (tsx / tests) looks at the repository's data-pack/", () => {
  const srcModuleDir = path.join(REPO_ROOT, "apps", "api", "src", "data-pack");
  const found = findBundledPackDir(srcModuleDir);
  assert.equal(found.dir, REAL_PACK);
});

// --- RM-38 WP 2.1 · the security registry, refused at LOAD ---------------------------------------
//
// These are the WP's six teeth in their real wiring: not the pure functions (those are pinned in
// `security-tables.test.ts`) but the loader and the resolver, driven over an in-memory pack tree
// seeded from the real one. Every mutation below is re-sealed, so the digests are correct and the
// refusal really is the security check firing rather than a byte mismatch in disguise.
//
// WHAT THEY CANNOT SEE: whether the BUNDLED pack is itself sound. Both checks compare a candidate
// against the bundled registry, so a bundled pack that shipped with a renamed id would be the new
// reference and nothing here would notice. That is what `security-tables.test.ts`'s hand-written
// eighteen-id assertions and `packages/shared/src/security-posture.test.ts`'s FROZEN_RULES table
// are for — they compare the bundled registry against literals a human typed.

/** The smallest report the differ will look at, stamped with a chosen analyzer version. */
function reportAtVersion(analyzerVersion: number): SecurityReport {
  return {
    analyzerVersion,
    generatedAt: "2026-08-23T00:00:00.000Z",
    subject: {
      kind: "server",
      id: "scan_1",
      ownerId: "srv_1",
      name: "Fixture server",
      capturedAt: "2026-08-23T00:00:00.000Z",
    },
    findings: [],
    counts: { error: 0, warning: 0, info: 0, total: 0 },
    score: { value: 100, band: "clean", analyzerVersion },
    truncated: false,
  };
}

function securityRules(tree: PackTree): {
  analyzerVersion: number;
  idLedger: string[];
  rules: { id: string; severity: string }[];
} {
  return getJson(tree, "security/rules.json");
}

/** A cache pack at 9.9.9 whose `security/rules.json` has been mutated and re-sealed. */
function cacheWithRules(mutate: (doc: ReturnType<typeof securityRules>) => void): PackTree {
  const cache = withPackVersion("9.9.9");
  const doc = securityRules(cache);
  mutate(doc);
  setJson(cache, "security/rules.json", doc);
  return reseal(cache);
}

test("teeth 1 (D-DP6) — a RENAMED rule id in the pack refuses the pack", () => {
  const resolution = resolveWith(
    cacheWithRules((doc) => {
      doc.idLedger[0] = "poisoning.injection-phrasing-v2";
      const first = doc.rules[0];
      if (first) first.id = "poisoning.injection-phrasing-v2";
    }),
  );
  assert.equal(resolution.pack.origin, "bundled", "a renamed id must never take effect");
  assert.equal(resolution.refusals[0]?.reason, "rule_ledger_not_append_only");
  assert.match(resolution.refusals[0]?.detail ?? "", /diverges at position 0/);
});

test("teeth 5 (D-DP6) — REMOVING an id from the ledger while keeping the rule refuses", () => {
  const resolution = resolveWith(cacheWithRules((doc) => doc.idLedger.splice(3, 1)));
  assert.equal(resolution.pack.origin, "bundled");
  assert.equal(resolution.refusals[0]?.reason, "rule_ledger_not_append_only");
  assert.match(resolution.refusals[0]?.detail ?? "", /append-only|diverges/);
});

test("D-DP6 — APPENDING to the ledger is fine, and the pack is accepted", () => {
  // The negative control for the two above: the ledger is append-only, not frozen. Without this a
  // check that refused every ledger would look identical from the outside.
  const resolution = resolveWith(
    cacheWithRules((doc) => doc.idLedger.push("poisoning.some-future-rule")),
  );
  assert.equal(resolution.pack.origin, "cache");
  assert.deepEqual(resolution.refusals, []);
});

test("teeth 2 (D-DP7) — LOWERING a severity without bumping analyzerVersion refuses", () => {
  const resolution = resolveWith(
    cacheWithRules((doc) => {
      const target = doc.rules.find((rule) => rule.severity === "error");
      if (target) target.severity = "info";
    }),
  );
  assert.equal(resolution.pack.origin, "bundled", "a silent re-score must never take effect");
  assert.equal(resolution.refusals[0]?.reason, "schema_violation");
  assert.match(resolution.refusals[0]?.detail ?? "", /analyzerVersion is 4, not greater/);
});

test("teeth 3 (D-DP7) — bump the version AND lower a severity, and the pack is ACCEPTED", () => {
  const cache = cacheWithRules((doc) => {
    doc.analyzerVersion = 5;
    const target = doc.rules.find((rule) => rule.severity === "error");
    if (target) target.severity = "info";
  });
  const resolution = resolveWith(cache);
  assert.equal(resolution.pack.origin, "cache", "with the bump, the change is legitimate");
  assert.deepEqual(resolution.refusals, []);
  assert.equal(resolution.pack.documents.securityTables.analyzerVersion, 5);

  // …and the second half of teeth 3: a report computed under the new version is NOT comparable to a
  // baseline computed under the old one, which is exactly what the version exists to signal. The
  // posture differ is the thing that refuses; asserted here against the two versions this pack
  // straddles rather than by re-running a scan, because `diffSecurityReports` is the one definition
  // of that refusal and it reads `analyzerVersion` alone.
  const baseline = reportAtVersion(SECURITY_ANALYZER_VERSION);
  const subject = reportAtVersion(resolution.pack.documents.securityTables.analyzerVersion);
  assert.throws(
    () => diffSecurityReports(baseline, subject),
    /analyzer version|analyzerVersion/i,
    "a diff across an analyzer-version change must be refused, not silently computed",
  );
});

test("teeth 6 — a rule the analyzers do not implement refuses the pack", () => {
  const resolution = resolveWith(
    cacheWithRules((doc) => {
      doc.idLedger.push("poisoning.invented-rule");
      doc.rules.push({
        id: "poisoning.invented-rule",
        category: "poisoning",
        subject: "server",
        severity: "info",
        title: "Invented",
        rationale: "A rule no analyzer implements would be declared and never emitted, forever.",
      } as never);
    }),
  );
  assert.equal(resolution.pack.origin, "bundled");
  assert.equal(resolution.refusals[0]?.reason, "schema_violation");
  assert.match(resolution.refusals[0]?.detail ?? "", /no analyzer implements/);
});

test("teeth 4 (D-DP9) — a pattern beyond the source cap refuses at LOAD, not at scan", () => {
  const cache = withPackVersion("9.9.9");
  const signatures = getJson<Record<string, unknown>>(cache, "security/signatures.json");
  // Nested quantifiers, and long: the classic catastrophic-backtracking shape, well past the cap.
  signatures.secretParameterPattern = { source: `(${"a+".repeat(200)})+$`, flags: "" };
  setJson(cache, "security/signatures.json", signatures);
  const resolution = resolveWith(reseal(cache));

  assert.equal(resolution.pack.origin, "bundled");
  assert.equal(resolution.refusals[0]?.reason, "schema_violation");
  assert.match(resolution.refusals[0]?.detail ?? "", /security\/signatures\.json/);
  // The point of the whole decision: the failure is a VALUE at load, never a throw mid-scan. The
  // bundled analyzer is still fully usable afterwards.
  assert.ok(resolution.pack.documents.securityTables.signatures.secretParameterPattern.test("api_key"));
});

test("a pattern that does not COMPILE refuses the pack the same way", () => {
  const cache = withPackVersion("9.9.9");
  const signatures = getJson<Record<string, unknown>>(cache, "security/signatures.json");
  signatures.openWorldPhrase = { source: "([unclosed", flags: "i" };
  setJson(cache, "security/signatures.json", signatures);
  const resolution = resolveWith(reseal(cache));
  assert.equal(resolution.pack.origin, "bundled");
  assert.equal(resolution.refusals[0]?.reason, "schema_violation");
  assert.match(resolution.refusals[0]?.detail ?? "", /openWorldPhrase/);
});

test("the loader hands back COMPILED tables, not raw JSON", () => {
  const result = load(clone());
  assert.ok(result.ok);
  if (!result.ok) return;
  const tables = result.pack.documents.securityTables;
  assert.equal(tables.analyzerVersion, SECURITY_ANALYZER_VERSION);
  assert.equal(Object.keys(tables.rules).length, 18);
  assert.ok(tables.signatures.injectionPatterns.length > 0);
  for (const { pattern } of tables.signatures.injectionPatterns) {
    assert.ok(pattern instanceof RegExp);
  }
});
