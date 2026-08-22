import { z } from "zod";
import { redactSecurityEvidence, SECURITY_EVIDENCE_MAX_CHARS } from "./security-posture.js";

// ==================================================================================================
// Diagnostics bundle — planning/Roadmap/RM-18-platform/ WP 1.3
// ==================================================================================================
//
// One document an operator can paste into a bug report **without reading it line by line first**.
// That last clause is the product: the item's invariant is *"the diagnostics bundle is proven
// secret-free by an automated test … not by review"*, and a bundle that IS safe but cannot be SHOWN
// to be safe has not changed the decision the user actually has to make.
//
// Two rules make the guarantee STRUCTURAL rather than a regex nobody re-reads:
//
//  1. **The environment group never reads a value.** The builder walks a hard-coded list of the
//     variables `apps/api/src/config/env.ts` recognises and emits `{ name, status }`. There is no
//     code path from a variable's value into this payload — not truncated, not hashed, not
//     fingerprinted — so no redaction has to be trusted for the single largest secret surface.
//  2. **Names are user data too.** A server's name, a skill's title, a scenario's label and an MCP
//     command are all free text the owner typed, and any of them can carry a hostname, a client name
//     or a path. The versions, environment, database and feature groups therefore carry **counts and
//     shapes only** — row counts, booleans, versions — and no user-typed string at all.
//
// **The one exception, stated plainly because it is real.** The `errors` group quotes error text
// verbatim, and an error message can itself quote something the owner typed. This is not theoretical:
// a failed stdio scan produces `spawn /path/to/your-server ENOENT`, and that path is in the bundle.
// Credentials in it are masked and the text is length-capped, but a path or a URL an error mentions
// survives — because an ENOENT with the path stripped out is no longer worth putting in a bug report.
// So the trade is deliberate: the four derived groups are unconditionally safe, the errors group is
// the section to actually read before pasting, and every surface says so in those words. It is also
// exactly why the Settings action SHOWS the bundle instead of downloading it. Pinned by
// `apps/api/test/diagnostics.test.ts` — one test asserts the four groups stay clean, another asserts
// the errors group really does echo a quoted command, so neither half can drift into a lie.
//
// There is deliberately no second redactor. `redactSecurityEvidence` (D-SP4) already owns "turn an
// arbitrary string into something safe to publish, capped by construction"; two redactors would mean
// one of them is weaker and nobody would know which.

/**
 * Bumped when the payload's SHAPE changes in a way a reader must notice. A bug report pasted from an
 * older build should still say which shape it is.
 */
export const DIAGNOSTICS_BUNDLE_VERSION = 1;

// ── Versions ────────────────────────────────────────────────────────────────────────────────────

export type DiagnosticsVersions = {
  /** `config.appVersion` — the package version, never a path. */
  app: string;
  /** `process.version`, e.g. `v22.11.0`. */
  node: string;
  /** `process.platform` / `process.arch` — a fixed vocabulary, never a hostname. */
  platform: string;
  arch: string;
  /** `config.dockerMode`. */
  dockerMode: boolean;
};

export const diagnosticsVersionsSchema = z
  .object({
    app: z.string().min(1),
    node: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1),
    dockerMode: z.boolean(),
  })
  .strict();

// ── Environment ─────────────────────────────────────────────────────────────────────────────────

/**
 * What is known about one recognised variable — and it is deliberately the ONLY thing knowable.
 *
 *  - `set` — the variable is present in the process environment (its value is **not** read).
 *  - `default` — absent, and the app falls back to a built-in default, so it is still configured.
 *  - `unset` — absent, and the app has no fallback: the thing it configures is genuinely off.
 *
 * The `default`/`unset` split is what makes the group diagnostic rather than decorative: a missing
 * `MCP_SECRET_KEY` (`unset`) means something different from a missing `PORT` (`default`).
 */
export const DIAGNOSTICS_ENV_STATUSES = ["set", "default", "unset"] as const;
export type DiagnosticsEnvStatus = (typeof DIAGNOSTICS_ENV_STATUSES)[number];

export type DiagnosticsEnvVar = {
  name: string;
  status: DiagnosticsEnvStatus;
};

export const diagnosticsEnvVarSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(DIAGNOSTICS_ENV_STATUSES),
  })
  .strict();

// ── Database ────────────────────────────────────────────────────────────────────────────────────

/** One table's row count. `rows` is `null` when the count could not be taken (e.g. a shadow table). */
export type DiagnosticsTableCount = {
  /** A table name from `sqlite_master` — declared in `db/schema.ts`, never anything a user typed. */
  name: string;
  rows: number | null;
};

export const diagnosticsTableCountSchema = z
  .object({
    name: z.string().min(1),
    rows: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type DiagnosticsDatabase = {
  /** `PRAGMA user_version` — the level this database is actually at. */
  userVersion: number;
  /** `LATEST_SCHEMA_VERSION` — the level this binary knows how to reach. */
  latestKnownVersion: number;
  /** Both are reported so a mid-upgrade install is legible rather than merely "a number". */
  upToDate: boolean;
  /** Size on disk in bytes; `null` when the file could not be stat'd (in-memory, or no permission). */
  fileBytes: number | null;
  /** The `-wal` sidecar's size; `null` when absent or unreadable. */
  walBytes: number | null;
  tables: DiagnosticsTableCount[];
};

export const diagnosticsDatabaseSchema = z
  .object({
    userVersion: z.number().int().nonnegative(),
    latestKnownVersion: z.number().int().nonnegative(),
    upToDate: z.boolean(),
    fileBytes: z.number().int().nonnegative().nullable(),
    walBytes: z.number().int().nonnegative().nullable(),
    tables: z.array(diagnosticsTableCountSchema),
  })
  .strict();

// ── Recent errors — the one genuinely risky group ───────────────────────────────────────────────
//
// This is the only place in the bundle where free-form strings from anywhere in the system are
// emitted, so it is the only place a secret can plausibly reach the document. Every entry is built
// by `createDiagnosticsErrorEntry`, which takes the RAW text and forces it through
// `redactSecurityEvidence` — the same signature trick `createSecurityFinding` uses, so redaction is
// a property of the constructor and not of whoever remembered to call it.

/** Where an error entry came from. A fixed vocabulary — never a user-typed label. */
export const DIAGNOSTICS_ERROR_SOURCE_IDS = [
  /** `scan_events` rows at `level = 'error'` — the app's only level-tagged persisted log. */
  "scan_events",
  /** `mcp_scans.error_message` on a `failed` scan. */
  "scans",
  /** `runs.error_message` on an `error` run. */
  "runs",
  /**
   * The API process's own pino log. It is written to **stdout** and nothing persists it, so this
   * source is always reported `not_captured` — see {@link DiagnosticsErrorSource}. A silent gap that
   * read as "no errors" would be exactly the class of lie this bundle exists to avoid.
   */
  "process_log",
] as const;
export type DiagnosticsErrorSourceId = (typeof DIAGNOSTICS_ERROR_SOURCE_IDS)[number];

/**
 * Per-source capture state, as a DISCRIMINATED UNION on purpose: "we looked and found none"
 * (`captured` with `matched: 0`) and "there is nothing here to look at" (`not_captured`) are
 * different facts, and a shape that could express them identically would eventually be read as a
 * clean bill of health when it is actually a blind spot.
 */
export type DiagnosticsErrorSource =
  | { id: DiagnosticsErrorSourceId; status: "captured"; matched: number }
  | { id: DiagnosticsErrorSourceId; status: "not_captured"; reason: string };

export const diagnosticsErrorSourceSchema = z.discriminatedUnion("status", [
  z
    .object({
      id: z.enum(DIAGNOSTICS_ERROR_SOURCE_IDS),
      status: z.literal("captured"),
      matched: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      id: z.enum(DIAGNOSTICS_ERROR_SOURCE_IDS),
      status: z.literal("not_captured"),
      reason: z.string().min(1),
    })
    .strict(),
]);

/** How many error entries the bundle may LIST. `sources[].matched` still reports the true totals. */
export const DIAGNOSTICS_ERROR_ENTRY_LIMIT = 20;

/**
 * How long one entry's text may be. Not a second number: it IS the shared redactor's cap, so the
 * bundle cannot drift to a laxer bound than the security surface uses.
 */
export const DIAGNOSTICS_ERROR_MAX_CHARS = SECURITY_EVIDENCE_MAX_CHARS;

export type DiagnosticsErrorEntry = {
  source: DiagnosticsErrorSourceId;
  /** ISO 8601 instant. A clock reading, not user data. */
  at: string;
  /** Already through `redactSecurityEvidence`. Never construct this by hand. */
  message: string;
  /** True when the redactor truncated at {@link DIAGNOSTICS_ERROR_MAX_CHARS}. */
  truncated: boolean;
};

export const diagnosticsErrorEntrySchema = z
  .object({
    source: z.enum(DIAGNOSTICS_ERROR_SOURCE_IDS),
    at: z.string().min(1),
    message: z.string(),
    truncated: z.boolean(),
  })
  .strict();

/**
 * The only sanctioned way to build a {@link DiagnosticsErrorEntry} — the D-SP4 signature, reused.
 *
 * There is no `message` parameter: the caller hands over the RAW text and gets back an entry whose
 * message has already been escaped, credential-masked and capped. A builder physically cannot emit
 * an unredacted error string through this function, which is the difference between a redaction
 * that holds and a redaction that held the day someone reviewed it.
 */
export function createDiagnosticsErrorEntry(input: {
  source: DiagnosticsErrorSourceId;
  at: string;
  raw: string;
}): DiagnosticsErrorEntry {
  const evidence = redactSecurityEvidence(input.raw);
  return {
    source: input.source,
    at: input.at,
    message: evidence.excerpt,
    truncated: evidence.truncated,
  };
}

export type DiagnosticsErrors = {
  sources: DiagnosticsErrorSource[];
  /** Newest first, capped at {@link DIAGNOSTICS_ERROR_ENTRY_LIMIT}. */
  entries: DiagnosticsErrorEntry[];
  /** True when the cap dropped entries; `sources[].matched` still describes all of them. */
  truncated: boolean;
};

export const diagnosticsErrorsSchema = z
  .object({
    sources: z.array(diagnosticsErrorSourceSchema),
    entries: z.array(diagnosticsErrorEntrySchema).max(DIAGNOSTICS_ERROR_ENTRY_LIMIT),
    truncated: z.boolean(),
  })
  .strict();

// ── Feature state ───────────────────────────────────────────────────────────────────────────────

export type DiagnosticsFeatures = {
  /** One row per `APP_FEATURE_IDS` member, in registry order. */
  flags: { id: string; enabled: boolean }[];
  /**
   * One row per `PROVIDER_KINDS` member. A BOOLEAN per kind — never a credential id, never the
   * operator's own label for it, and obviously never the key.
   */
  providerKinds: { kind: string; configured: boolean }[];
};

export const diagnosticsFeaturesSchema = z
  .object({
    flags: z.array(z.object({ id: z.string().min(1), enabled: z.boolean() }).strict()),
    providerKinds: z.array(z.object({ kind: z.string().min(1), configured: z.boolean() }).strict()),
  })
  .strict();

// ── The bundle ──────────────────────────────────────────────────────────────────────────────────

export type DiagnosticsBundle = {
  bundleVersion: number;
  /** ISO 8601 instant the bundle was composed. */
  generatedAt: string;
  versions: DiagnosticsVersions;
  /** `{ name, status }` per recognised variable. No value, at any status, ever. */
  environment: DiagnosticsEnvVar[];
  database: DiagnosticsDatabase;
  errors: DiagnosticsErrors;
  features: DiagnosticsFeatures;
};

export const diagnosticsBundleSchema = z
  .object({
    bundleVersion: z.number().int().positive(),
    generatedAt: z.string().min(1),
    versions: diagnosticsVersionsSchema,
    environment: z.array(diagnosticsEnvVarSchema),
    database: diagnosticsDatabaseSchema,
    errors: diagnosticsErrorsSchema,
    features: diagnosticsFeaturesSchema,
  })
  .strict();
