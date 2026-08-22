// Reads ONE reference data pack from ONE directory and either resolves it whole or refuses it whole
// (RM-38 WP 1.2, D-DP2/D-DP4/D-DP5).
//
// This module is the ONLY place in `apps/api` that reads pack bytes off disk. Everything else —
// `compatibility/dataset.ts`, `compatibility/catalog.ts` — goes through `source.ts`'s
// `getDataPack()`, and `apps/api/test/data-pack-seam.test.ts` fails on a `readFileSync` of a pack
// filename anywhere else.
//
// It NEVER throws on bad input. A refusal is a value (D-DP4: boot may not fail on data). The one
// thing that does throw lives next door in `resolve.ts`, and it is not a data failure: a MISSING
// BUNDLED SNAPSHOT is a broken build artifact, and serving an empty model roster would be worse
// than stopping.
//
// Order of checks is load-bearing, not stylistic:
//   1. manifest bytes → JSON → the COMPILED-IN zod contract. Never a schema file from the pack:
//      at this point nothing in the pack has been digest-verified, so a hostile pack could ship a
//      permissive `schema/manifest.schema.json` that validates its own lie.
//   2. `schemaVersion` support — BEFORE digests, so an unreadable future layout is refused as
//      `unsupported_schema_version` rather than as a pile of digest noise (teeth 2).
//   3. digests, in both directions (nothing missing, nothing unlisted).
//   4. per-file JSON Schema — now, and only now, the schema files themselves are digest-verified.
//   5. parse the three documents the app actually reads.

import path from "node:path";
import { createHash } from "node:crypto";
import {
  type AllModels,
  compileSchema,
  DATA_PACK_CONTENT_DIRS,
  DATA_PACK_MANIFEST_FILENAME,
  type DataPackManifest,
  DataPackManifestSchema,
  type DataPackRefusal,
  dataPackSchemaFor,
  formatViolations,
  isSupportedDataPackSchemaVersion,
  type JsonSchema,
  type SchemaValidator,
  verifyManifestDigests,
} from "@mcp-token-footprint/shared";
import { type DataPackFs, nodeDataPackFs } from "./fs.js";

/** Where a resolved pack came from. The fetched rung arrives in WP 3.1. */
export type DataPackOrigin = "bundled" | "cache";

/** The three documents the app reads out of a pack. Parsed once, at load. */
export type DataPackDocuments = {
  allModels: AllModels;
  crossCutting: Record<string, unknown>;
  /** Typed as `Catalog` by `compatibility/catalog.ts`, which owns that type. */
  testCatalog: unknown;
};

export type ResolvedDataPack = {
  manifest: DataPackManifest;
  origin: DataPackOrigin;
  /** Absolute directory the pack was read from. Provenance for logs and diagnostics. */
  dir: string;
  documents: DataPackDocuments;
};

export type DataPackLoadResult =
  | { ok: true; pack: ResolvedDataPack }
  | { ok: false; refusal: DataPackRefusal };

const MODELS_PATH_PREFIX = "models/";
const ALL_MODELS_PATH = "generated/all-models.json";
const CROSS_CUTTING_PATH = "limits/cross-cutting.json";
const TEST_CATALOG_PATH = "compatibility/test-catalog.json";

function refuse(refusal: DataPackRefusal): DataPackLoadResult {
  return { ok: false, refusal };
}

/** Pack-root-relative POSIX paths of every `*.json` under the content dirs, sorted. */
function listPackFiles(dir: string, fs: DataPackFs): string[] {
  const out: string[] = [];
  for (const contentDir of DATA_PACK_CONTENT_DIRS) {
    const abs = path.join(dir, ...contentDir.split("/"));
    // A missing content dir is NOT skipped silently: the manifest lists its files, so
    // `verifyManifestDigests` reports them as missing. Listing nothing here is what makes that so.
    if (!fs.exists(abs)) continue;
    for (const entry of fs.readDir(abs)) {
      if (entry.isDirectory) continue;
      if (!entry.name.endsWith(".json")) continue;
      out.push(`${contentDir}/${entry.name}`);
    }
  }
  return out.sort();
}

function readJson(dir: string, rel: string, fs: DataPackFs): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(fs.readFile(path.join(dir, ...rel.split("/"))).toString("utf8")) };
  } catch {
    return { ok: false };
  }
}

export function loadDataPack(args: {
  dir: string;
  origin: DataPackOrigin;
  fs?: DataPackFs;
}): DataPackLoadResult {
  const { dir, origin } = args;
  const fs = args.fs ?? nodeDataPackFs;

  // --- 1. The manifest, against the compiled-in contract -----------------------------------------

  const manifestAbs = path.join(dir, DATA_PACK_MANIFEST_FILENAME);
  if (!fs.exists(manifestAbs)) {
    return refuse({
      reason: "schema_violation",
      detail: `${DATA_PACK_MANIFEST_FILENAME} is missing from ${dir} — a directory without one is not a pack.`,
      paths: [DATA_PACK_MANIFEST_FILENAME],
    });
  }

  const rawManifest = readJson(dir, DATA_PACK_MANIFEST_FILENAME, fs);
  if (!rawManifest.ok) {
    // A truncated or corrupt manifest lands here (teeth 1). It is a shape failure — the document
    // cannot be read as the thing it claims to be.
    return refuse({
      reason: "schema_violation",
      detail: `${DATA_PACK_MANIFEST_FILENAME} in ${dir} is not readable JSON.`,
      paths: [DATA_PACK_MANIFEST_FILENAME],
    });
  }

  const parsed = DataPackManifestSchema.safeParse(rawManifest.value);
  if (!parsed.success) {
    return refuse({
      reason: "schema_violation",
      detail:
        `${DATA_PACK_MANIFEST_FILENAME} does not satisfy the pack manifest contract: ` +
        parsed.error.issues
          .slice(0, 4)
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; "),
      paths: [DATA_PACK_MANIFEST_FILENAME],
    });
  }
  const manifest = parsed.data;

  // --- 2. Layout version, before anything else is trusted ---------------------------------------

  if (!isSupportedDataPackSchemaVersion(manifest.schemaVersion)) {
    return refuse({
      reason: "unsupported_schema_version",
      detail:
        `Pack ${manifest.packVersion} declares schemaVersion ${manifest.schemaVersion}, which this ` +
        "build does not understand. Refused whole rather than partially loaded.",
    });
  }

  // --- 3. Digests, both directions --------------------------------------------------------------

  const computed = new Map<string, { sha256: string; bytes: number }>();
  for (const rel of listPackFiles(dir, fs)) {
    const bytes = fs.readFile(path.join(dir, ...rel.split("/")));
    computed.set(rel, {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.byteLength,
    });
  }
  const digests = verifyManifestDigests(manifest.files, computed);
  if (!digests.ok) return refuse(digests.refusal);

  // --- 4. Per-file JSON Schema, against now-verified schema files -------------------------------

  const validators = new Map<string, SchemaValidator>();
  const compile = (schemaRel: string): SchemaValidator | DataPackRefusal => {
    const cached = validators.get(schemaRel);
    if (cached) return cached;
    const schemaDoc = readJson(dir, schemaRel, fs);
    if (!schemaDoc.ok) {
      return {
        reason: "schema_violation",
        detail: `${schemaRel} is not readable JSON, so the files it governs cannot be validated.`,
        paths: [schemaRel],
      };
    }
    let validator: SchemaValidator;
    try {
      validator = compileSchema(schemaDoc.value as JsonSchema);
    } catch (error) {
      return {
        reason: "schema_violation",
        detail: `${schemaRel} uses a JSON Schema construct this build cannot evaluate: ${
          error instanceof Error ? error.message : String(error)
        }`,
        paths: [schemaRel],
      };
    }
    validators.set(schemaRel, validator);
    return validator;
  };

  const documentCache = new Map<string, unknown>();
  for (const entry of manifest.files) {
    const schemaRel = dataPackSchemaFor(entry.path);
    if (!schemaRel) continue;
    const validator = compile(schemaRel);
    if (typeof validator !== "function") return refuse(validator);

    const doc = readJson(dir, entry.path, fs);
    if (!doc.ok) {
      return refuse({
        reason: "schema_violation",
        detail: `${entry.path} is not readable JSON.`,
        paths: [entry.path],
      });
    }
    documentCache.set(entry.path, doc.value);

    const violations = validator(doc.value);
    if (violations.length > 0) {
      return refuse({
        reason: "schema_violation",
        detail: formatViolations(entry.path, violations),
        paths: [entry.path],
      });
    }
  }

  // --- 5. The three documents the app reads -----------------------------------------------------

  const readDoc = (rel: string): unknown | undefined => {
    if (documentCache.has(rel)) return documentCache.get(rel);
    const doc = readJson(dir, rel, fs);
    return doc.ok ? doc.value : undefined;
  };

  const allModelsDoc = readDoc(ALL_MODELS_PATH);
  const structural = checkAllModels(allModelsDoc);
  if (structural) return refuse(structural);

  const crossCuttingDoc = readDoc(CROSS_CUTTING_PATH);
  if (!crossCuttingDoc || typeof crossCuttingDoc !== "object" || Array.isArray(crossCuttingDoc)) {
    return refuse({
      reason: "schema_violation",
      detail: `${CROSS_CUTTING_PATH} must be a JSON object.`,
      paths: [CROSS_CUTTING_PATH],
    });
  }

  const testCatalogDoc = readDoc(TEST_CATALOG_PATH);
  if (!testCatalogDoc || typeof testCatalogDoc !== "object") {
    return refuse({
      reason: "schema_violation",
      detail: `${TEST_CATALOG_PATH} must be a JSON object.`,
      paths: [TEST_CATALOG_PATH],
    });
  }

  return {
    ok: true,
    pack: {
      manifest,
      origin,
      dir,
      documents: {
        allModels: allModelsDoc as AllModels,
        crossCutting: crossCuttingDoc as Record<string, unknown>,
        testCatalog: testCatalogDoc,
      },
    },
  };
}

/**
 * `generated/all-models.json` has no JSON Schema of its own (it is derived from the `models/**`
 * files, which do). It is still the single most load-bearing document in the pack — an empty
 * `models` array would leave every heatmap silently blank — so its shape is checked here rather
 * than assumed. Returns a refusal, or `null` when the document is usable.
 */
function checkAllModels(doc: unknown): DataPackRefusal | null {
  const bad = (detail: string): DataPackRefusal => ({
    reason: "schema_violation",
    detail,
    paths: [ALL_MODELS_PATH],
  });
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return bad(`${ALL_MODELS_PATH} must be a JSON object.`);
  }
  const models = (doc as { models?: unknown }).models;
  if (!Array.isArray(models) || models.length === 0) {
    return bad(`${ALL_MODELS_PATH} carries no models — a pack with an empty roster is refused.`);
  }
  for (const [index, model] of models.entries()) {
    if (!model || typeof model !== "object") {
      return bad(`${ALL_MODELS_PATH}: models[${index}] is not an object.`);
    }
    const id = (model as { model_id?: unknown }).model_id;
    if (typeof id !== "string" || id.length === 0) {
      return bad(`${ALL_MODELS_PATH}: models[${index}] has no \`model_id\`.`);
    }
  }
  return null;
}

/** Exported for tests: the pack-root-relative paths this module treats as the app's documents. */
export const DATA_PACK_DOCUMENT_PATHS = {
  allModels: ALL_MODELS_PATH,
  crossCutting: CROSS_CUTTING_PATH,
  testCatalog: TEST_CATALOG_PATH,
  modelsPrefix: MODELS_PATH_PREFIX,
} as const;
