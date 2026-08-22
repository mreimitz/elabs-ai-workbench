// RM-38 WP 1.1 — the pack contract's teeth.
//
// Four things are pinned here, and each one exists because breaking it would let a bad pack through:
//   1. `manifest.json` is shaped right (JSON Schema AND the zod contract) and every digest it
//      claims matches the bytes on disk, in both directions (nothing missing, nothing unlisted).
//   2. every pack data file validates against its JSON Schema.
//   3. `packages/shared/src/data-pack.ts` imports nothing but `zod`, and
//      `packages/shared/src/json-schema.ts` imports nothing at all — the contract and its validator
//      have to stay loadable anywhere, so neither may reach for `node:fs`, `node:crypto` or the
//      network.
//   4. the small JSON Schema validator this repo owns is not vacuous — it rejects known-bad input.
//
// The drift guard (rebuild + byte-compare) lives next door in `compatibility-data.test.ts`.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  comparePackVersions,
  compileSchema,
  DATA_PACK_CONTENT_DIRS,
  DATA_PACK_MANIFEST_FILENAME,
  DATA_PACK_MIN_SUPPORTED_SCHEMA_VERSION,
  DATA_PACK_REFUSAL_REASONS,
  DATA_PACK_SCHEMA_VERSION,
  DataPackManifestSchema,
  dataPackSchemaFor,
  formatViolations,
  isSupportedDataPackSchemaVersion,
  isValidPackVersion,
  type JsonSchema,
  verifyManifestDigests,
} from "@mcp-token-footprint/shared";
import { PACK_ROOT, PACK_SCHEMA_VERSION } from "../../../data-pack/build/build-cli.js";
import {
  digestPackContents,
  listPackContentFiles,
  PACK_CONTENT_DIRS,
} from "../../../data-pack/build/manifest.js";

const readPack = (rel: string) => readFileSync(path.join(PACK_ROOT, rel), "utf8");
const readPackJson = <T>(rel: string): T => JSON.parse(readPack(rel)) as T;

const manifest = readPackJson<Record<string, unknown>>("manifest.json");
const manifestSchema = readPackJson<JsonSchema>("schema/manifest.schema.json");
const modelEntrySchema = readPackJson<JsonSchema>("schema/model-entry.schema.json");
const crossCuttingSchema = readPackJson<JsonSchema>("schema/cross-cutting.schema.json");
const testCatalogSchema = readPackJson<JsonSchema>("schema/test-catalog.schema.json");

// --- 1. The manifest ----------------------------------------------------------------------------

test("manifest.json validates against schema/manifest.schema.json", () => {
  const violations = compileSchema(manifestSchema)(manifest);
  assert.deepEqual(violations, [], formatViolations("manifest.json", violations));
});

test("manifest.json validates against the shared zod contract (.strict())", () => {
  const parsed = DataPackManifestSchema.safeParse(manifest);
  assert.ok(
    parsed.success,
    parsed.success ? "" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  );
});

test("manifest.schemaVersion equals the shared DATA_PACK_SCHEMA_VERSION and is supported", () => {
  // The pack build deliberately does NOT import `packages/shared` (so it never needs shared built
  // first); this test is what holds the two constants equal.
  assert.equal(PACK_SCHEMA_VERSION, DATA_PACK_SCHEMA_VERSION);
  assert.equal(manifest.schemaVersion, DATA_PACK_SCHEMA_VERSION);
  assert.ok(isSupportedDataPackSchemaVersion(DATA_PACK_SCHEMA_VERSION));
  assert.ok(isSupportedDataPackSchemaVersion(DATA_PACK_MIN_SUPPORTED_SCHEMA_VERSION));
  assert.equal(isSupportedDataPackSchemaVersion(DATA_PACK_SCHEMA_VERSION + 1), false);
  assert.equal(isSupportedDataPackSchemaVersion(DATA_PACK_MIN_SUPPORTED_SCHEMA_VERSION - 1), false);
});

test("manifest.packVersion equals data-pack/package.json version", () => {
  const pkg = readPackJson<{ version: string }>("package.json");
  assert.equal(manifest.packVersion, pkg.version);
  assert.ok(isValidPackVersion(pkg.version));
});

test("every manifest.files[].sha256 + bytes matches the file on disk (and nothing is unlisted)", () => {
  const parsed = DataPackManifestSchema.parse(manifest);
  const computed = digestPackContents(PACK_ROOT);
  const result = verifyManifestDigests(parsed.files, computed);
  assert.ok(
    result.ok,
    result.ok ? "" : `${result.refusal.detail} → ${(result.refusal.paths ?? []).join(", ")}`,
  );
});

test("the manifest lists every pack-content file except manifest.json itself", () => {
  const parsed = DataPackManifestSchema.parse(manifest);
  const listed = parsed.files.map((f) => f.path).sort();
  assert.deepEqual(listed, listPackContentFiles(PACK_ROOT));
  assert.equal(
    listed.includes("manifest.json"),
    false,
    "a manifest cannot carry its own digest",
  );
  // Sorted by path, so a rebuild is byte-reproducible regardless of readdir order.
  assert.deepEqual(listed, [...listed].sort());
});

// --- 2. Every pack data file against its schema -------------------------------------------------

test("every models/**/*.json validates against schema/model-entry.schema.json", () => {
  const validate = compileSchema(modelEntrySchema);
  const modelFiles = listPackContentFiles(PACK_ROOT).filter((p) => p.startsWith("models/"));
  assert.equal(modelFiles.length, 11, "expected 11 per-provider model files");
  for (const rel of modelFiles) {
    const violations = validate(readPackJson(rel));
    assert.deepEqual(violations, [], formatViolations(rel, violations));
  }
});

test("limits/cross-cutting.json validates against schema/cross-cutting.schema.json", () => {
  const violations = compileSchema(crossCuttingSchema)(readPackJson("limits/cross-cutting.json"));
  assert.deepEqual(violations, [], formatViolations("limits/cross-cutting.json", violations));
});

test("compatibility/test-catalog.json validates against schema/test-catalog.schema.json", () => {
  const violations = compileSchema(testCatalogSchema)(
    readPackJson("compatibility/test-catalog.json"),
  );
  assert.deepEqual(
    violations,
    [],
    formatViolations("compatibility/test-catalog.json", violations),
  );
});

// --- 3. The contract's import boundary ----------------------------------------------------------

function importSpecifiersOf(absPath: string): string[] {
  const source = readFileSync(absPath, "utf8");
  const specifiers = new Set<string>();
  for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g)) {
    specifiers.add(m[1] as string);
  }
  for (const m of source.matchAll(/(?:^|[^.\w])(?:import|require)\s*\(\s*["']([^"']+)["']/g)) {
    specifiers.add(m[1] as string);
  }
  return [...specifiers].sort();
}

test("packages/shared/src/data-pack.ts imports nothing but zod", () => {
  assert.deepEqual(
    importSpecifiersOf(path.resolve(PACK_ROOT, "../packages/shared/src/data-pack.ts")),
    ["zod"],
    "data-pack.ts is the portable pack contract — no node:fs, no node:crypto, no network",
  );
});

test("packages/shared/src/json-schema.ts imports nothing at all", () => {
  // WP 1.2 moved this validator out of `data-pack/build/` so the API's runtime loader can use the
  // SAME one (its rootDir is apps/api/src, which cannot reach data-pack/build/). It is now on the
  // browser bundle's side of the fence too, so a stray `node:*` import here would break the web
  // build rather than fail a test — which is exactly why this assertion is cheap and worth having.
  assert.deepEqual(
    importSpecifiersOf(path.resolve(PACK_ROOT, "../packages/shared/src/json-schema.ts")),
    [],
    "json-schema.ts is a pure validator — no zod, no node:*, no network",
  );
});

test("the shared DATA_PACK_CONTENT_DIRS equals the pack build's PACK_CONTENT_DIRS", () => {
  // Two declarations on purpose: `data-pack/build/` deliberately does not import `packages/shared`,
  // so the pack build never needs shared to be built first (same reasoning as PACK_SCHEMA_VERSION).
  // This is what holds them equal. WHAT IT CANNOT SEE: whether either list matches the directories
  // that actually exist on disk — the manifest/digest tests above cover that.
  assert.deepEqual([...DATA_PACK_CONTENT_DIRS], [...PACK_CONTENT_DIRS]);
  assert.equal(DATA_PACK_MANIFEST_FILENAME, "manifest.json");
});

test("dataPackSchemaFor maps every schema-governed pack file, and only those", () => {
  const governed = new Map<string, string | null>();
  for (const rel of listPackContentFiles(PACK_ROOT)) governed.set(rel, dataPackSchemaFor(rel));

  // Every models/** file is governed by the model-entry schema.
  const modelFiles = [...governed].filter(([rel]) => rel.startsWith("models/"));
  assert.equal(modelFiles.length, 11);
  for (const [rel, schema] of modelFiles) {
    assert.equal(schema, "schema/model-entry.schema.json", rel);
  }
  assert.equal(governed.get("limits/cross-cutting.json"), "schema/cross-cutting.schema.json");
  assert.equal(
    governed.get("compatibility/test-catalog.json"),
    "schema/test-catalog.schema.json",
  );
  // Ungoverned, on purpose: the derived index (checked structurally by the loader instead) and the
  // schemas themselves (validating a schema against itself proves nothing).
  assert.equal(governed.get("generated/all-models.json"), null);
  for (const [rel, schema] of governed) {
    if (rel.startsWith("schema/")) assert.equal(schema, null, rel);
  }
  // Every named schema must be a real, digest-verified pack file.
  for (const schema of new Set([...governed.values()].filter((v): v is string => v !== null))) {
    assert.ok(listPackContentFiles(PACK_ROOT).includes(schema), `${schema} is not a pack file`);
  }
});

// --- 4. Pure helpers ----------------------------------------------------------------------------

test("verifyManifestDigests refuses a mismatch, a missing file and an unlisted file", () => {
  const files = [
    { path: "a.json", sha256: "a".repeat(64), bytes: 1 },
    { path: "b.json", sha256: "b".repeat(64), bytes: 2 },
  ];
  const good = new Map([
    ["a.json", { sha256: "a".repeat(64), bytes: 1 }],
    ["b.json", { sha256: "b".repeat(64), bytes: 2 }],
  ]);
  assert.deepEqual(verifyManifestDigests(files, good), { ok: true });

  const wrongDigest = new Map(good).set("b.json", { sha256: "c".repeat(64), bytes: 2 });
  const r1 = verifyManifestDigests(files, wrongDigest);
  assert.equal(r1.ok, false);
  assert.equal(r1.ok === false && r1.refusal.reason, "digest_mismatch");
  assert.deepEqual(r1.ok === false && r1.refusal.paths, ["b.json"]);

  // A right digest with the wrong byte length is still a mismatch.
  const wrongBytes = new Map(good).set("b.json", { sha256: "b".repeat(64), bytes: 3 });
  assert.equal(verifyManifestDigests(files, wrongBytes).ok, false);

  const missing = new Map(good);
  missing.delete("a.json");
  const r2 = verifyManifestDigests(files, missing);
  assert.equal(r2.ok, false);
  assert.deepEqual(r2.ok === false && r2.refusal.paths, ["a.json"]);

  const unlisted = new Map(good).set("smuggled.json", { sha256: "d".repeat(64), bytes: 9 });
  const r3 = verifyManifestDigests(files, unlisted);
  assert.equal(r3.ok, false, "an unlisted pack file must refuse — otherwise it rides unverified");
  assert.deepEqual(r3.ok === false && r3.refusal.paths, ["smuggled.json"]);
});

test("comparePackVersions orders semver cores and answers null on an unorderable input", () => {
  assert.equal(comparePackVersions("1.0.0", "1.0.0"), 0);
  assert.equal(comparePackVersions("1.0.0", "1.0.1"), -1);
  assert.equal(comparePackVersions("1.2.0", "1.10.0"), -1, "numeric, not lexicographic");
  assert.equal(comparePackVersions("2.0.0", "1.99.99"), 1);
  assert.equal(comparePackVersions("1.0", "1.0.0"), null);
  assert.equal(comparePackVersions("1.0.0-rc.1", "1.0.0"), null);
  assert.equal(comparePackVersions("", "1.0.0"), null);
  assert.equal(isValidPackVersion("1.0.0"), true);
  assert.equal(isValidPackVersion("v1.0.0"), false);
});

test("the five D-DP5 refusal reasons are the frozen set", () => {
  assert.deepEqual(
    [...DATA_PACK_REFUSAL_REASONS],
    [
      "unsupported_schema_version",
      "digest_mismatch",
      "schema_violation",
      "version_regression",
      "rule_ledger_not_append_only",
    ],
  );
});

// --- 5. The validator itself is not vacuous -----------------------------------------------------

test("the JSON Schema validator rejects known-bad documents", () => {
  const validateModel = compileSchema(modelEntrySchema);
  const good = readPackJson<Record<string, unknown>>("models/saas/anthropic.json");

  const clone = () => JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
  type Model = Record<string, unknown> & { context: Record<string, unknown> };
  const firstModel = (doc: Record<string, unknown>) => (doc.models as Model[])[0] as Model;

  assert.deepEqual(validateModel(good), [], "the real file must be valid");

  // required missing. NOTE: this must genuinely REMOVE the key. Biome's noDelete autofix would
  // write `= undefined`, which leaves `Object.hasOwn` true and silently makes this assertion
  // vacuous — so `Reflect.deleteProperty`, which deletes without the flagged operator.
  const noId = clone();
  Reflect.deleteProperty(firstModel(noId), "id");
  assert.ok(validateModel(noId).length > 0, "a missing required `id` must be caught");

  // enum violation
  const badStatus = clone();
  firstModel(badStatus).status = "totally-shipped";
  assert.ok(validateModel(badStatus).length > 0, "an out-of-enum `status` must be caught");

  // const violation
  const badSchemaVersion = clone();
  badSchemaVersion.schema_version = "9.9";
  assert.ok(validateModel(badSchemaVersion).length > 0, "a wrong `schema_version` const");

  // type violation
  const badType = clone();
  firstModel(badType).id = 42;
  assert.ok(validateModel(badType).length > 0, "a non-string `id` must be caught");

  // additionalProperties: false inside $defs/provenanced
  const smuggled = clone();
  (firstModel(smuggled).context.context_window_tokens as Record<string, unknown>).surprise = true;
  assert.ok(
    validateModel(smuggled).length > 0,
    "an unknown field inside a provenanced node must be caught",
  );

  // minItems
  const noModels = clone();
  noModels.models = [];
  assert.ok(validateModel(noModels).length > 0, "an empty `models` array must be caught");

  // pattern (test-catalog test ids)
  const validateCatalog = compileSchema(testCatalogSchema);
  const catalog = readPackJson<{ tests: { id: string }[] }>("compatibility/test-catalog.json");
  assert.deepEqual(validateCatalog(catalog), []);
  const badId = JSON.parse(JSON.stringify(catalog)) as { tests: { id: string }[] };
  (badId.tests[0] as { id: string }).id = "lower case id";
  assert.ok(validateCatalog(badId).length > 0, "a test id violating its pattern must be caught");

  // manifest digest shape
  const validateManifest = compileSchema(manifestSchema);
  const badManifest = JSON.parse(JSON.stringify(manifest)) as {
    files: { sha256: string }[];
    packVersion: string;
  };
  (badManifest.files[0] as { sha256: string }).sha256 = "not-a-digest";
  assert.ok(validateManifest(badManifest).length > 0, "a malformed sha256 must be caught");
  const badVersion = JSON.parse(JSON.stringify(manifest)) as { packVersion: string };
  badVersion.packVersion = "1.0";
  assert.ok(validateManifest(badVersion).length > 0, "a non-semver packVersion must be caught");
});

test("compileSchema refuses a schema keyword it does not implement", () => {
  assert.throws(
    () => compileSchema({ type: "object", properties: { a: { allOf: [{ type: "string" }] } } }),
    /Unsupported JSON Schema keyword "allOf"/,
    "an unimplemented keyword must fail loudly, never be silently ignored",
  );
});

// --- 7. The relocation is verified by hash, not by eye ------------------------------------------

test("every relocated pack file still has the exact bytes it had before the move", () => {
  // WP 1.1's entire claim is "this is a move; content cannot have changed". The drift test proves
  // that for the two GENERATED artifacts, but the generator's output can be identical while its
  // INPUTS are not — a stray formatter, a trailing-newline change or an encoding normalisation on a
  // hand-curated model file would pass unnoticed. So the pre-move git blob hash of every moved file
  // is recorded in data-pack/relocation-ledger.json and re-asserted here.
  //
  // WHEN THIS GOES RED: a pack file's bytes changed. That is not automatically wrong — these files
  // are MEANT to change; that is the point of RM-38. It is wrong to change them by ACCIDENT. Update
  // the entry's `gitBlobSha1` in the SAME commit as the content change, and say why in the message.
  // Never normalise a file to make this pass.
  const ledger = readPackJson<{
    baseCommit: string;
    files: { from: string; to: string; gitBlobSha1: string }[];
  }>("relocation-ledger.json");

  assert.equal(ledger.files.length, 15, "11 model files + cross-cutting + catalog + 2 schemas");

  const repoRoot = path.resolve(PACK_ROOT, "..");
  const mismatches: string[] = [];
  for (const entry of ledger.files) {
    const bytes = readFileSync(path.join(PACK_ROOT, entry.to));
    // git's blob object id: sha1("blob " + byteLength + "\0" + content).
    const actual = createHash("sha1")
      .update(`blob ${bytes.byteLength}\0`)
      .update(bytes)
      .digest("hex");
    if (actual !== entry.gitBlobSha1) {
      mismatches.push(`${entry.to}: expected ${entry.gitBlobSha1}, got ${actual}`);
    }
    assert.equal(
      existsSync(path.join(repoRoot, entry.from)),
      false,
      `${entry.from} must not still exist — a move leaves no copy behind (D-DP1)`,
    );
  }
  assert.deepEqual(mismatches, [], mismatches.join("; "));
});

test("the relocation ledger is provenance, not pack content — the manifest does not list it", () => {
  assert.equal(listPackContentFiles(PACK_ROOT).includes("relocation-ledger.json"), false);
});

// --- 6. The transitional duplication is GONE ----------------------------------------------------
//
// WP 1.1 shipped a third copy of three pack files at `apps/api/src/compatibility/data/` and pinned
// it byte-identical here, because the compatibility engine still read that address. WP 1.2 moved
// the engine onto the resolved pack and DELETED the directory in the same change, so the assertion
// that replaces this one lives in `compatibility-data.test.ts` and asserts the directory's absence.
