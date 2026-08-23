// The reference data pack contract (RM-38). Both ends read this: the API loads and verifies a pack
// against it, the web surfaces the resolved version, and the pack build stamps a manifest that
// satisfies it.
//
// HARD CONSTRAINT — this module imports `zod` and NOTHING else. No `node:fs`, no `node:crypto`, no
// network. It is a pure description of the contract plus pure helpers over already-computed values;
// reading bytes and hashing them is the API side's job (see `verifyManifestDigests` below, which
// takes digests as INPUT). `apps/api/test/data-pack.test.ts` scans this file's own source and fails
// on any other import specifier.

import { z } from "zod";

// --- Versioning ---------------------------------------------------------------------------------

/**
 * The pack layout/semantics version this build of the app writes and understands. An integer, not a
 * semver: it changes only when the SHAPE of a pack changes, never when its VALUES do (that is
 * `packVersion`). A pack whose `schemaVersion` is outside
 * [DATA_PACK_MIN_SUPPORTED_SCHEMA_VERSION, DATA_PACK_SCHEMA_VERSION] is refused whole (D-DP5).
 */
export const DATA_PACK_SCHEMA_VERSION = 1;

/** The oldest pack layout this build still accepts. */
export const DATA_PACK_MIN_SUPPORTED_SCHEMA_VERSION = 1;

/** True when this build can load a pack declaring `schemaVersion`. */
export function isSupportedDataPackSchemaVersion(schemaVersion: number): boolean {
  return (
    Number.isInteger(schemaVersion) &&
    schemaVersion >= DATA_PACK_MIN_SUPPORTED_SCHEMA_VERSION &&
    schemaVersion <= DATA_PACK_SCHEMA_VERSION
  );
}

// --- Pack layout (RM-38 WP 1.2) -----------------------------------------------------------------

/** The manifest's filename at the pack root. It is never listed in its own `files`. */
export const DATA_PACK_MANIFEST_FILENAME = "manifest.json";

/**
 * The directories whose `*.json` files ARE the pack, in manifest order. Everything else at the pack
 * root — `build/`, `package.json`, `tsconfig.json`, `relocation-ledger.json` — is repository
 * scaffolding, not pack content, and is neither digested nor shipped.
 *
 * `data-pack/build/manifest.ts` declares the same list as `PACK_CONTENT_DIRS` and deliberately does
 * NOT import it, so the pack build never needs `packages/shared` to be built first;
 * `apps/api/test/data-pack.test.ts` holds the two equal. Same pattern as
 * `PACK_SCHEMA_VERSION` / `DATA_PACK_SCHEMA_VERSION`.
 */
export const DATA_PACK_CONTENT_DIRS = [
  "advisor",
  "compatibility",
  "generated",
  "limits",
  // `models` holds `overrides.json` (the merge-chain layers); the per-provider model entries live in
  // the two subdirectories below. Listing all three is not double-counting — the directory walk only
  // takes `*.json` FILES, and a subdirectory is never a file.
  "models",
  "models/open-weight",
  "models/saas",
  "quality",
  "schema",
  "security",
] as const;

/**
 * Which schema (a pack-root-relative path) each pack file is validated against, or `null` for a
 * file that has no JSON Schema of its own.
 *
 * `generated/all-models.json` is deliberately `null`: it is a DERIVED artifact of the per-provider
 * model files, which each validate against `model-entry.schema.json`, and the loader checks it
 * structurally instead. `schema/*.json` are schemas, not instances — validating a schema against
 * itself proves nothing.
 */
export function dataPackSchemaFor(relPath: string): string | null {
  // ORDER MATTERS: `models/overrides.json` is under `models/` but is NOT a provider model-entry
  // file, so its exact match must be taken before the prefix rule below.
  if (relPath === "models/overrides.json") return "schema/model-overrides.schema.json";
  if (relPath.startsWith("models/")) return "schema/model-entry.schema.json";
  if (relPath === "advisor/thresholds.json") return "schema/advisor-thresholds.schema.json";
  if (relPath === "quality/thresholds.json") return "schema/quality-thresholds.schema.json";
  if (relPath === "limits/cross-cutting.json") return "schema/cross-cutting.schema.json";
  if (relPath === "compatibility/test-catalog.json") return "schema/test-catalog.schema.json";
  if (relPath === "security/rules.json") return "schema/security-rules.schema.json";
  if (relPath === "security/signatures.json") return "schema/security-signatures.schema.json";
  return null;
}

// --- Manifest -----------------------------------------------------------------------------------

/** One shipped pack file, addressed relative to the pack root with POSIX separators. */
export const DataPackManifestFileSchema = z
  .object({
    /** Pack-root-relative POSIX path, e.g. `models/saas/anthropic.json`. */
    path: z.string().min(1),
    /** Lowercase hex SHA-256 of the file's bytes. */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Byte length of the file on disk. */
    bytes: z.number().int().nonnegative(),
  })
  .strict();

export type DataPackManifestFile = z.infer<typeof DataPackManifestFileSchema>;

/**
 * `manifest.json` at the pack root. Generated by the pack build, never hand-edited; `files` covers
 * every shipped pack file EXCEPT the manifest itself (a manifest cannot digest itself).
 */
export const DataPackManifestSchema = z
  .object({
    /** Semver core, e.g. `1.0.0`. Ordered by `comparePackVersions`; a pack may not go backwards. */
    packVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    /** Pack LAYOUT version — see `DATA_PACK_SCHEMA_VERSION`. */
    schemaVersion: z.number().int().positive(),
    /** ISO date (YYYY-MM-DD) the newest fact in the pack was current as of. */
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Repo-relative path of the generator that wrote this manifest. */
    generator: z.string().min(1),
    files: z.array(DataPackManifestFileSchema).min(1),
  })
  .strict();

export type DataPackManifest = z.infer<typeof DataPackManifestSchema>;

// --- Refusals (D-DP5) ---------------------------------------------------------------------------

/**
 * The five ways a pack is refused. A pack is applied whole or not at all — there is no partial
 * trust and no per-file merge (D-DP2/D-DP5). Frozen tuple so the set is enumerable at runtime.
 */
export const DATA_PACK_REFUSAL_REASONS = [
  /** `schemaVersion` is missing, unparseable, or outside this build's supported range. */
  "unsupported_schema_version",
  /** A file's SHA-256 disagrees with the manifest, or the file set does not match it. */
  "digest_mismatch",
  /** A pack file failed its JSON Schema (or the manifest failed its own shape). */
  "schema_violation",
  /** `packVersion` is not greater than the pack currently in force. */
  "version_regression",
  /** The security rule-id ledger is not append-only against the bundled ledger (D-DP6). */
  "rule_ledger_not_append_only",
] as const;

export type DataPackRefusalReason = (typeof DATA_PACK_REFUSAL_REASONS)[number];

/** A refusal is a VALUE, never a throw — boot may not fail on data (D-DP4). */
export type DataPackRefusal = {
  reason: DataPackRefusalReason;
  /** One human sentence naming what was wrong, safe to log and to show in Settings. */
  detail: string;
  /** Pack-root-relative paths implicated, when the refusal is about specific files. */
  paths?: string[];
};

export const DataPackRefusalSchema = z
  .object({
    reason: z.enum(DATA_PACK_REFUSAL_REASONS),
    detail: z.string().min(1),
    paths: z.array(z.string()).optional(),
  })
  .strict();

// --- Pure helpers -------------------------------------------------------------------------------

/** A digest computed elsewhere (by `node:crypto` on the API side) for one pack-root-relative path. */
export type ComputedFileDigest = { sha256: string; bytes: number };

export type ManifestDigestVerification =
  | { ok: true }
  | { ok: false; refusal: DataPackRefusal & { reason: "digest_mismatch" } };

/**
 * Compare a manifest's `files` against digests computed from disk. PURE — it hashes nothing; the
 * caller supplies `computed`, keyed by the same pack-root-relative POSIX path.
 *
 * Fails on three distinct conditions, all of them `digest_mismatch`, because from a trust point of
 * view they are the same event — the bytes on disk are not the bytes the manifest describes:
 *   - a manifest entry with no file (missing),
 *   - a file present that the manifest does not list (unlisted — otherwise a pack could smuggle in
 *     an unverified file),
 *   - a digest or byte length that disagrees.
 */
export function verifyManifestDigests(
  files: readonly DataPackManifestFile[],
  computed: ReadonlyMap<string, ComputedFileDigest>,
): ManifestDigestVerification {
  const missing: string[] = [];
  const mismatched: string[] = [];
  const listed = new Set<string>();

  for (const entry of files) {
    listed.add(entry.path);
    const actual = computed.get(entry.path);
    if (!actual) {
      missing.push(entry.path);
      continue;
    }
    if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) {
      mismatched.push(entry.path);
    }
  }

  const unlisted: string[] = [];
  for (const path of computed.keys()) {
    if (!listed.has(path)) unlisted.push(path);
  }

  if (missing.length === 0 && mismatched.length === 0 && unlisted.length === 0) return { ok: true };

  const parts: string[] = [];
  if (mismatched.length > 0) parts.push(`${mismatched.length} file(s) do not match their digest`);
  if (missing.length > 0) parts.push(`${missing.length} manifest file(s) are missing from the pack`);
  if (unlisted.length > 0) parts.push(`${unlisted.length} pack file(s) are not listed in the manifest`);

  return {
    ok: false,
    refusal: {
      reason: "digest_mismatch",
      detail: `Pack contents disagree with manifest.json: ${parts.join("; ")}.`,
      paths: [...mismatched, ...missing, ...unlisted].sort(),
    },
  };
}

// --- Judgement tables (RM-38 WP 2.2) ------------------------------------------------------------
//
// Three documents whose values used to be hand-written literals in `apps/api` and `packages/shared`.
// Each has BOTH a JSON Schema in the pack AND a compiled-in zod contract here, for the same
// defence-in-depth reason the manifest does: the pack's own schema files are only trustworthy AFTER
// their digests verify, and a document the app then destructures must be shaped before it is read.
//
// Every field is REQUIRED and every object is `.strict()`. A pack that omits a threshold is refused
// whole rather than silently falling back — for `advisor/thresholds.json` there is nothing to fall
// back TO, and for the other two a partial document would mean half the app on one pack and half on
// another, which D-DP2 forbids.

/** `data-pack/advisor/thresholds.json` — every tunable number the deterministic advisor rules read. */
export const DataPackAdvisorThresholdsSchema = z
  .object({
    description_share_threshold: z.number().min(0).max(1),
    min_description_tokens: z.number().int().positive(),
    top_tools: z.number().int().positive(),
    high_scan_share: z.number().min(0).max(1),
    medium_scan_share: z.number().min(0).max(1),
    overlap_similarity_threshold: z.number().min(0).max(1),
    medium_overlap_count: z.number().int().positive(),
    /** ONE entry for what used to be an identical pair of constants in two rule files. */
    high_waste_share: z.number().min(0).max(1),
    medium_waste_share: z.number().min(0).max(1),
    suite_run_window: z.number().int().positive(),
    provenance_suite_run_limit: z.number().int().positive(),
    evidence_tool_limit: z.number().int().positive(),
    evidence_run_limit: z.number().int().positive(),
  })
  .strict();

export type DataPackAdvisorThresholds = z.infer<typeof DataPackAdvisorThresholdsSchema>;

/** `data-pack/quality/thresholds.json` — the shared skill-quality / compare / loop / budget numbers. */
export const DataPackQualityThresholdsSchema = z
  .object({
    skill_quality_l1_token_ceiling: z.number().int().positive(),
    skill_quality_l2_token_ceiling: z.number().int().positive(),
    quality_severity_weights: z
      .object({
        error: z.number().int().nonnegative(),
        warning: z.number().int().nonnegative(),
        info: z.number().int().nonnegative(),
      })
      .strict(),
    default_compare_threshold: z.number().min(0).max(1),
    default_loop_threshold: z.number().int().positive(),
    failure_bucket_score_threshold: z.number().min(0).max(1),
    workbench_mcp_definition_token_budget: z.number().int().positive(),
  })
  .strict();

export type DataPackQualityThresholds = z.infer<typeof DataPackQualityThresholdsSchema>;

/** One per-1M-token USD price. Superset-free: the DB resolver's `cacheWritePer1M` is NOT a pack fact. */
export const DataPackModelPriceSchema = z
  .object({
    inPer1M: z.number().nonnegative(),
    outPer1M: z.number().nonnegative(),
    cachedInPer1M: z.number().nonnegative().optional(),
  })
  .strict();

export type DataPackModelPrice = z.infer<typeof DataPackModelPriceSchema>;

/**
 * `data-pack/models/overrides.json` — the merge-chain layers that sit UNDER the generated dataset.
 *
 * The precedence these participate in is contract and is asserted by test: legacy → roster-gap →
 * generated dataset, on top of a compiled floor (D-DP3), with the DB-backed `PricingRepository`
 * resolver winning over all of it.
 */
export const DataPackModelOverridesSchema = z
  .object({
    legacy_context_limits: z.record(z.number().int().positive()),
    roster_gap_context_limits: z.record(z.number().int().positive()),
    legacy_pricing: z.record(DataPackModelPriceSchema),
    roster_gap_pricing: z.record(DataPackModelPriceSchema),
    zero_price_models: z.array(z.string().min(1)),
    model_id_aliases: z.record(z.string().min(1)),
    default_heatmap_models: z.array(z.string().min(1)).min(1),
    assistant_default_model_roster: z.array(z.string().min(1)).min(1),
    assistant_default_title_model: z.string().min(1),
  })
  .strict();

export type DataPackModelOverrides = z.infer<typeof DataPackModelOverridesSchema>;

/** Pack-root-relative paths of the three WP 2.2 documents, so nothing spells them twice. */
export const DATA_PACK_JUDGEMENT_PATHS = {
  advisorThresholds: "advisor/thresholds.json",
  qualityThresholds: "quality/thresholds.json",
  modelOverrides: "models/overrides.json",
} as const;

const SEMVER_CORE = /^(\d+)\.(\d+)\.(\d+)$/;

/** True when `value` is a semver core (`MAJOR.MINOR.PATCH`, no prerelease, no build metadata). */
export function isValidPackVersion(value: string): boolean {
  return SEMVER_CORE.test(value);
}

/**
 * Order two pack versions. Returns `-1` when `a` precedes `b`, `0` when equal, `1` when `a` follows
 * `b`, and **`null` when either side is not a valid pack version** — an unorderable version must
 * refuse the pack (D-DP5 `version_regression`), never silently compare as equal.
 */
export function comparePackVersions(a: string, b: string): -1 | 0 | 1 | null {
  const ma = SEMVER_CORE.exec(a);
  const mb = SEMVER_CORE.exec(b);
  if (!ma || !mb) return null;
  for (let i = 1; i <= 3; i++) {
    const na = Number(ma[i]);
    const nb = Number(mb[i]);
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}
