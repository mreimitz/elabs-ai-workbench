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

// --- The remote refresh (RM-38 WP 3.1) ----------------------------------------------------------
//
// Everything below describes the STARTUP FETCH: the bounds it runs under, what a pack file's path
// is allowed to look like when it arrives from somewhere else, and the shape of the answer the check
// hands back. It is still pure — no `fetch`, no `node:*`, no timers. The API side owns the socket.
//
// D-DP4 is the constraint the whole design serves: the fetch is an OPTIMISATION THAT CAN ALWAYS
// FAIL. Every bound here exists so that "the network misbehaved" has a finite cost.

/** Per-request bound, in milliseconds, when `DATA_PACK_TIMEOUT_MS` is unset. */
export const DATA_PACK_DEFAULT_TIMEOUT_MS = 5000;

/**
 * How many per-request timeouts the WHOLE check may take.
 *
 * These are two genuinely different bounds and the pack needs both. The per-request timeout stops
 * ONE hung socket; it does nothing at all about a server that answers every request just under the
 * timeout — with ~24 files, a peer sitting at 99% of the per-request bound costs 24x the timeout,
 * and nothing would notice. The total budget is the bound on the check as a whole.
 */
export const DATA_PACK_TOTAL_BUDGET_FACTOR = 12;

/** The total wall-clock budget for one refresh, derived from the per-request timeout. */
export function dataPackTotalBudgetMs(perRequestTimeoutMs: number): number {
  return Math.max(1, Math.floor(perRequestTimeoutMs)) * DATA_PACK_TOTAL_BUDGET_FACTOR;
}

/**
 * Byte and count caps on what a remote pack may make this process download. The largest real pack
 * file today is `generated/all-models.json` at ~1.8 MB against a pack of ~24 files, so these are
 * roughly 4x and 10x headroom — big enough that a legitimate pack never trips them, small enough
 * that a hostile or broken endpoint cannot fill the data volume.
 */
export const DATA_PACK_MAX_REMOTE_FILE_BYTES = 8 * 1024 * 1024;
export const DATA_PACK_MAX_REMOTE_TOTAL_BYTES = 32 * 1024 * 1024;
export const DATA_PACK_MAX_REMOTE_FILES = 256;

const PACK_FILE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;
/**
 * True when `value` carries a control character, DEL, or a backslash.
 *
 * A code-point loop rather than a character class, because a regex expressing this range IS a
 * control character in the source, and Biome's `noControlCharactersInRegex` refuses it — correctly,
 * since an invisible byte in a pattern is unreviewable. Backslash rides along because it is the
 * separator POSIX does not treat as one: `models\\saas\\x.json` is one legal POSIX filename and a
 * two-level path on Windows, and a guard that reads it as a filename is a guard that can be walked
 * past on the platform where it matters.
 */
function hasHostilePathCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Is `rel` a path a pack file is allowed to occupy?
 *
 * This is a WRITE-SIDE guard, and that is the reason it exists at all. The loader's digest check
 * compares a manifest against a directory listing, which is a fine answer once the bytes are on
 * disk — but the fetcher has to WRITE the bytes before anything can verify them, and the only thing
 * telling it where to put each file is the manifest it just downloaded from the network. A manifest
 * listing `../../../etc/cron.d/x.json` would be a remote write outside `DATA_DIR`, performed before
 * a single refusal has had a chance to run.
 *
 * So the rule is a whitelist, not a sanitiser: exactly `<content dir>/<name>.json`, where the
 * directory is one of {@link DATA_PACK_CONTENT_DIRS} and the name carries no separator of any kind.
 * `..`, absolute paths, backslashes, percent-encoding, NUL bytes and empty segments all fail by
 * construction rather than by enumeration.
 */
export function isSafePackRelativePath(rel: string): boolean {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 255) return false;
  if (hasHostilePathCharacter(rel)) return false;
  if (rel.includes("%")) return false;
  const cut = rel.lastIndexOf("/");
  if (cut <= 0) return false;
  const dir = rel.slice(0, cut);
  const base = rel.slice(cut + 1);
  if (!(DATA_PACK_CONTENT_DIRS as readonly string[]).includes(dir)) return false;
  return PACK_FILE_BASENAME.test(base);
}

/**
 * Where one pack file lives, given the URL the manifest came from. Returns `null` when the result
 * would not be a plain `http(s)` URL under the manifest's own directory.
 *
 * Belt and braces over {@link isSafePackRelativePath}: that one governs where a byte is WRITTEN,
 * this one governs where it is READ FROM. They fail for different reasons — a relative path can be
 * perfectly safe on disk and still resolve onto a different origin if the manifest URL carries
 * something odd — so neither substitutes for the other.
 */
export function resolveDataPackFileUrl(manifestUrl: string, rel: string): string | null {
  if (!isSafePackRelativePath(rel)) return null;
  let base: URL;
  try {
    base = new URL(manifestUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return null;
  const dirHref = new URL(".", base).href;
  const resolved = new URL(rel, base);
  if (resolved.protocol !== base.protocol || resolved.host !== base.host) return null;
  if (!resolved.href.startsWith(dirHref)) return null;
  return resolved.href;
}

/**
 * How a startup check ended. Five outcomes, and the split between them is the operator-facing point:
 *
 *   - `disabled`     — no URL, or the check is switched off. Zero outbound requests.
 *   - `unreachable`  — the network produced no usable answer (DNS, connect, non-2xx, timeout,
 *                      budget, oversize). NOT a data problem, and on an offline install it is the
 *                      NORMAL outcome — which is why it is logged at info rather than warn.
 *   - `up_to_date`   — an answer arrived and the pack in force is already at least as new.
 *   - `refused`      — an answer arrived and was REJECTED by one of the five D-DP5 refusals. This is
 *                      the one an operator has to see: something published a pack this build will
 *                      not trust.
 *   - `installed`    — a newer pack verified and is now in force.
 */
export const DATA_PACK_FETCH_STATUSES = [
  "disabled",
  "unreachable",
  "up_to_date",
  "refused",
  "installed",
] as const;

export type DataPackFetchStatus = (typeof DATA_PACK_FETCH_STATUSES)[number];

/** The answer one startup check hands back. A VALUE — the check never throws (D-DP4). */
export type DataPackFetchOutcome = {
  status: DataPackFetchStatus;
  /** One human sentence, always present, safe to log and (WP 3.2) to show in Settings. */
  detail: string;
  /** The manifest URL that was checked. Absent only when the check was disabled with no URL. */
  url?: string;
  /** `packVersion` the remote manifest declared, when one was read. */
  remoteVersion?: string;
  /** `packVersion` that was in force when the check started. */
  currentVersion?: string;
  /** The refusal, when `status` is `refused`. */
  refusal?: DataPackRefusal;
  /** Files downloaded, when a pack was installed. */
  files?: number;
  /** Wall-clock milliseconds the whole check took. */
  durationMs?: number;
};

export const DataPackFetchOutcomeSchema = z
  .object({
    status: z.enum(DATA_PACK_FETCH_STATUSES),
    detail: z.string().min(1),
    url: z.string().optional(),
    remoteVersion: z.string().optional(),
    currentVersion: z.string().optional(),
    refusal: DataPackRefusalSchema.optional(),
    files: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict();

// --- The stamp (D-DP8, RM-38 WP 3.2) ------------------------------------------------------------
//
// **A verdict document that cannot name the data it was computed against is not reproducible.**
// Every document a verdict travels in carries the resolved pack version, and this module is the ONE
// place in the repository that spells that field.
//
// WHY ONE DEFINITION, AND WHY IT IS A CORRECTNESS REQUIREMENT RATHER THAN TIDINESS: a document that
// names its data version is worthless if two builders can disagree about the version. Eight builders
// hand-assembling the field is eight independent answers to "which pack?", and the first time one of
// them reads a stale memo the stamp becomes a confident lie — strictly worse than no stamp at all,
// because a reader would then TRUST it.
//
// The enforcement is a two-sided guard in `apps/api/test/data-pack-stamp.test.ts`:
//   * a BAN — the field literal appears in no source file under `apps/api/src`, and in exactly this
//     one file under `packages/shared/src`, comments stripped first;
//   * a NON-VACUITY half, because a ban is itself an absence assertion and passes over an empty
//     corpus: the scan asserts it walked a non-empty tree, every named builder is read by an
//     absolute path (so a moved file throws rather than silently dropping out of the set), and each
//     one is asserted to carry the sanctioned call.
// Neither half is evidence on its own.

/** The additive field every verdict document carries. */
export type DataPackStamp = { dataPackVersion: string };

/**
 * Build the stamp. Takes an ALREADY-RESOLVED version — this module may not read a pack (see the
 * header's hard constraint), so "which pack is in force" is answered exactly once, on the API side,
 * by `apps/api/src/data-pack/stamp.ts`, which is the only caller in production API code.
 */
export function stampDataPackVersion(packVersion: string): DataPackStamp {
  return { dataPackVersion: packVersion };
}

/**
 * The stamp for a document DERIVED from another already-stamped document (the security posture
 * diff). It is not a second source of truth: the version travels IN the input, and an input with no
 * stamp produces no stamp rather than a guess.
 */
export function inheritedDataPackStamp(
  from: { dataPackVersion?: string } | undefined,
): DataPackStamp | Record<string, never> {
  const version = from?.dataPackVersion;
  return version === undefined ? {} : stampDataPackVersion(version);
}

// --- The resolved-pack status surface (RM-38 WP 3.2) --------------------------------------------

/**
 * The display projection of ONE security rule.
 *
 * Deliberately not the whole `SecurityRule`: the browser's Security tab renders a rule's `title`
 * and its `rationale` and counts the registry, and takes severity off the finding — so those four
 * fields are what travel. `category` / `subject` / `deprecated` are analyzer-side facts and stay on
 * the API side of the wire.
 *
 * The strings are **free text from the pack**, rendered verbatim to an operator. Whether a
 * user-visible pack field should carry a content constraint in the JSON Schema is an open owner
 * question recorded in RM-38's ledger; this contract deliberately neither adds one nor forecloses
 * one — it constrains presence only, exactly as the pack's own schema already does.
 */
export type DataPackSecurityRuleView = {
  id: string;
  severity: string;
  title: string;
  rationale: string;
};

export const DataPackSecurityRuleViewSchema = z
  .object({
    id: z.string().min(1),
    severity: z.string().min(1),
    title: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();

/**
 * The pack-derived VALUES the browser needs, so `apps/web` stops rendering the compiled floor while
 * the API answers from a fetched pack (RM-38 WP 3.2 scope item 6, owner ruling 2026-08-23).
 *
 * These are exactly the four things `apps/web` reads today, measured rather than assumed — the
 * context-window map (`allow-list.ts`, `RunConsole.tsx`), the two thresholds (`CompareView.tsx`,
 * `FailureBuckets.tsx`) and the security rule registry (`SecurityPanel.tsx`). The MODEL DATASET is
 * deliberately not here: the browser needs a `Record<string, number>`, not the ~1.8 MB
 * `generated/all-models.json` it is derived from.
 *
 * They are produced from the SAME read of the resolved pack as the metadata beside them, so the
 * browser can never show one pack's values next to another pack's version.
 */
export type DataPackValues = {
  /** Model id to context window in tokens, merged in the same order the API merges it. */
  modelContextLimits: Record<string, number>;
  /** The compare matcher's Jaccard floor. */
  defaultCompareThreshold: number;
  /** Suite failure buckets — a run scoring below this is a low-score candidate. */
  failureBucketScoreThreshold: number;
  /** The security rule registry, keyed by rule id, as the Security tab renders it. */
  securityRules: Record<string, DataPackSecurityRuleView>;
};

export const DataPackValuesSchema = z
  .object({
    modelContextLimits: z.record(z.number()),
    defaultCompareThreshold: z.number(),
    failureBucketScoreThreshold: z.number(),
    securityRules: z.record(DataPackSecurityRuleViewSchema),
  })
  .strict();

/** Which rung a pack, or a refusal, came from. */
export const DATA_PACK_ORIGINS = ["bundled", "cache", "fetched"] as const;
export type DataPackOriginName = (typeof DATA_PACK_ORIGINS)[number];

/**
 * A refusal, dated, and naming the pack version that was refused.
 *
 * It is a SEPARATE member from the last check's outcome on purpose. An operator's question is not
 * "what happened last time" but "is something out there this build will not trust" — and a refusal
 * that scrolled off behind a later successful `up_to_date` check would answer the first question
 * and hide the second.
 */
export type DataPackRefusalRecord = {
  reason: DataPackRefusalReason;
  detail: string;
  paths?: string[];
  /** ISO 8601 instant the refusal was recorded. */
  at: string;
  /** The pack version that was refused, when the manifest got far enough to declare one. */
  refusedVersion?: string;
  /** Which rung refused it: the boot-time cache read, or a startup/on-demand fetch. */
  origin: "cache" | "fetched";
};

export const DataPackRefusalRecordSchema = z
  .object({
    reason: z.enum(DATA_PACK_REFUSAL_REASONS),
    detail: z.string().min(1),
    paths: z.array(z.string()).optional(),
    at: z.string().min(1),
    refusedVersion: z.string().optional(),
    origin: z.enum(["cache", "fetched"]),
  })
  .strict();

/**
 * `GET /api/data-pack` and `POST /api/data-pack/refresh` — the same shape from both.
 *
 * `lastRefusal` is the member the Settings row exists to show. A failed check must never look like
 * a successful one (the RM-17 lesson, where an empty window reported as "recovered"), so this
 * payload keeps the refusal ALIVE alongside the pack in force rather than letting a later
 * `up_to_date` overwrite it.
 */
export type DataPackStatus = {
  packVersion: string;
  schemaVersion: number;
  asOf: string;
  /** Which rung the pack in force came from. */
  source: DataPackOriginName;
  /** How many files the manifest lists. */
  files: number;
  /** The security analyzer version this pack's rule registry declares (D-DP7). */
  analyzerVersion: number;
  /** Whether a remote check is configured at all, so the UI can say "no URL" rather than "never". */
  checkConfigured: boolean;
  /** ISO 8601 instant of the most recent completed check, absent when none has run. */
  lastCheckedAt?: string;
  /** The most recent check's own outcome, absent when none has run. */
  lastCheck?: DataPackFetchOutcome;
  /** The most recent refusal, from any rung, which a later successful check does NOT clear. */
  lastRefusal?: DataPackRefusalRecord;
  values: DataPackValues;
};

export const DataPackStatusSchema = z
  .object({
    packVersion: z.string().min(1),
    schemaVersion: z.number().int(),
    asOf: z.string().min(1),
    source: z.enum(DATA_PACK_ORIGINS),
    files: z.number().int().nonnegative(),
    analyzerVersion: z.number().int(),
    checkConfigured: z.boolean(),
    lastCheckedAt: z.string().optional(),
    lastCheck: DataPackFetchOutcomeSchema.optional(),
    lastRefusal: DataPackRefusalRecordSchema.optional(),
    values: DataPackValuesSchema,
  })
  .strict();
