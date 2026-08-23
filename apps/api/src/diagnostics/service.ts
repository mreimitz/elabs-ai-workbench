import fs from "node:fs";
import {
  APP_FEATURE_IDS,
  createDiagnosticsErrorEntry,
  DIAGNOSTICS_BUNDLE_VERSION,
  DIAGNOSTICS_ERROR_ENTRY_LIMIT,
  type AppFeatureFlags,
  type DiagnosticsBundle,
  type DiagnosticsDatabase,
  type DiagnosticsErrorEntry,
  type DiagnosticsErrorSource,
  type DiagnosticsErrors,
  type DiagnosticsFeatures,
  type DiagnosticsTableCount,
  PROVIDER_KINDS,
} from "@mcp-token-footprint/shared";
import { config } from "../config/env.js";
import { buildDiagnosticsDataPackGroup } from "../data-pack/status.js";
import { LATEST_SCHEMA_VERSION, type AppDatabase } from "../db/database.js";
import { buildEnvironmentGroup } from "./env-vars.js";

// ==================================================================================================
// The diagnostics builder — planning/Roadmap/RM-18-platform/ WP 1.3
// ==================================================================================================
//
// Composes the one document an operator can paste into a bug report. Read `packages/shared/src/
// diagnostics.ts` first: the payload's shape is where the secret-freedom argument is made, and this
// file is only the plumbing that fills it in.
//
// Everything here is computed ON READ. No table, no column, no migration, no feature flag, no new
// dependency — the bundle is a projection of state that already exists.
//
// Two habits are load-bearing and should survive any edit:
//
//   • **Counts and shapes, never content.** Row counts stand in for "how much is in here"; a
//     boolean per provider kind stands in for "is a credential configured". No server name, skill
//     title, scenario label, MCP command or URL is READ at any point, because all of those are free
//     text the owner typed and any of them can carry a hostname or a path. (One does still arrive
//     indirectly: an error message may quote a command the owner configured. That is a known,
//     documented boundary — see `packages/shared/src/diagnostics.ts` — not an oversight, and every
//     surface names it rather than claiming the bundle is name-free.)
//   • **Every error string goes through `createDiagnosticsErrorEntry`.** That constructor takes RAW
//     text and forces it through the shared `redactSecurityEvidence`; there is no way to hand it an
//     already-formatted message. Do not build a `DiagnosticsErrorEntry` literal here.

/** What the builder needs. Everything else it reads from `config`/`process` unless overridden. */
export type DiagnosticsPorts = {
  db: AppDatabase;
  /** The live feature-flag map (`FeatureFlagsService.getFlags`). */
  featureFlags: () => AppFeatureFlags;
  /** Overridable for tests so a bundle is reproducible. */
  now?: () => Date;
  /** Overridable for tests. NEVER read for a value — only for presence (see `env-vars.ts`). */
  env?: NodeJS.ProcessEnv;
  /** Overridable for tests; defaults to `config.databasePath`. Used only to `stat`, never emitted. */
  databasePath?: string;
};

// ── Database ────────────────────────────────────────────────────────────────────────────────────

/** Byte size of a path, or `null` when it cannot be stat'd (in-memory DB, missing sidecar, EACCES). */
function fileBytesOrNull(filePath: string): number | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

/**
 * Row counts for every non-internal table.
 *
 * The names come from `sqlite_master`, so they are whatever `db/schema.ts` and the migrations
 * declared — code-defined identifiers, never anything a user typed. A count that throws (an FTS5
 * shadow table can) reports `null` rather than aborting the whole bundle: a diagnostics document
 * that refuses to render because one table was awkward is a diagnostics document nobody gets.
 */
function readTableCounts(db: AppDatabase): DiagnosticsTableCount[] {
  let names: string[];
  try {
    names = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
  } catch {
    return [];
  }

  return names.map((name) => {
    try {
      // The name is an identifier read back from `sqlite_master`; quote it so an unusual (but
      // legal) table name cannot break the statement. It is never operator input.
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as
        | { n: number }
        | undefined;
      return { name, rows: row?.n ?? null };
    } catch {
      return { name, rows: null };
    }
  });
}

function readDatabaseGroup(db: AppDatabase, databasePath: string): DiagnosticsDatabase {
  let userVersion = 0;
  try {
    userVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  } catch {
    userVersion = 0;
  }

  return {
    userVersion,
    latestKnownVersion: LATEST_SCHEMA_VERSION,
    // Reported as BOTH numbers plus this derived flag, so a mid-upgrade install is legible at a
    // glance instead of leaving the reader to remember what the latest version is.
    upToDate: userVersion === LATEST_SCHEMA_VERSION,
    fileBytes: fileBytesOrNull(databasePath),
    walBytes: fileBytesOrNull(`${databasePath}-wal`),
    tables: readTableCounts(db),
  };
}

// ── Recent errors ───────────────────────────────────────────────────────────────────────────────

/**
 * One persisted error source: how many rows it has, and the newest few.
 *
 * `matched` is a real `COUNT(*)`, not `entries.length` — the entry list is capped for display and a
 * reader must not mistake the cap for the total. If the query throws (the table is not there on an
 * unmigrated database), the source is reported `not_captured` with the reason, which is a different
 * fact from "zero errors" and is typed as such.
 */
function readErrorSource(
  db: AppDatabase,
  spec: {
    id: DiagnosticsErrorSource["id"];
    countSql: string;
    rowsSql: string;
  },
): { source: DiagnosticsErrorSource; entries: DiagnosticsErrorEntry[] } {
  try {
    const count = db.prepare(spec.countSql).get() as { n: number } | undefined;
    const rows = db.prepare(spec.rowsSql).all() as Array<{ at: string | null; raw: string | null }>;
    const entries = rows
      .filter((row): row is { at: string | null; raw: string } => typeof row.raw === "string")
      .map((row) =>
        createDiagnosticsErrorEntry({ source: spec.id, at: row.at ?? "", raw: row.raw }),
      );
    return {
      source: { id: spec.id, status: "captured", matched: count?.n ?? entries.length },
      entries,
    };
  } catch (error) {
    return {
      source: {
        id: spec.id,
        status: "not_captured",
        reason: `Could not be read on this database (${error instanceof Error ? error.name : "unknown error"}).`,
      },
      entries: [],
    };
  }
}

function readErrorsGroup(db: AppDatabase): DiagnosticsErrors {
  const limit = DIAGNOSTICS_ERROR_ENTRY_LIMIT;
  const collected = [
    readErrorSource(db, {
      id: "scan_events",
      countSql: "SELECT COUNT(*) AS n FROM scan_events WHERE level = 'error'",
      rowsSql: `SELECT created_at AS at, message AS raw FROM scan_events WHERE level = 'error' ORDER BY created_at DESC LIMIT ${limit}`,
    }),
    readErrorSource(db, {
      id: "scans",
      countSql:
        "SELECT COUNT(*) AS n FROM mcp_scans WHERE status = 'failed' AND error_message IS NOT NULL",
      rowsSql: `SELECT scanned_at AS at, error_message AS raw FROM mcp_scans WHERE status = 'failed' AND error_message IS NOT NULL ORDER BY scanned_at DESC LIMIT ${limit}`,
    }),
    readErrorSource(db, {
      id: "runs",
      countSql:
        "SELECT COUNT(*) AS n FROM runs WHERE status = 'error' AND error_message IS NOT NULL",
      rowsSql: `SELECT started_at AS at, error_message AS raw FROM runs WHERE status = 'error' AND error_message IS NOT NULL ORDER BY started_at DESC LIMIT ${limit}`,
    }),
  ];

  const sources: DiagnosticsErrorSource[] = collected.map((entry) => entry.source);
  // The API's own pino log goes to stdout and nothing persists it. Saying so explicitly is the
  // point: a section that silently omitted the process log would read as "the app logged no
  // errors", which is a claim this bundle is not entitled to make.
  sources.push({
    id: "process_log",
    status: "not_captured",
    reason:
      "The API logs to stdout (pino) and nothing persists it, so process-level errors are not in this bundle. This is a blind spot, not a clean bill of health.",
  });

  const all = collected
    .flatMap((entry) => entry.entries)
    // Newest first across sources. A missing timestamp sorts last rather than throwing.
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const entries = all.slice(0, limit);

  // `truncated` is measured against the sources' TRUE totals, not against what the per-source `LIMIT
  // ?` happened to hand back. Each query already caps at `limit`, so `all.length > limit` would read
  // false on a database with a thousand scan errors and one source — the reader would then take a
  // twenty-row list for the whole story. The counts are the authority; the list is the display.
  const totalMatched = sources.reduce(
    (sum, source) => (source.status === "captured" ? sum + source.matched : sum),
    0,
  );

  return {
    sources,
    entries,
    truncated: totalMatched > entries.length,
  };
}

// ── Feature state ───────────────────────────────────────────────────────────────────────────────

function readFeaturesGroup(db: AppDatabase, flags: AppFeatureFlags): DiagnosticsFeatures {
  let configuredKinds = new Set<string>();
  try {
    const rows = db.prepare("SELECT DISTINCT kind FROM provider_credentials").all() as Array<{
      kind: string;
    }>;
    // Only the KIND column is selected — never the label the operator typed, never the id, and
    // obviously never `api_key_encrypted`.
    configuredKinds = new Set(rows.map((row) => row.kind));
  } catch {
    configuredKinds = new Set();
  }

  return {
    flags: APP_FEATURE_IDS.map((id) => ({ id, enabled: flags[id] })),
    providerKinds: PROVIDER_KINDS.map((kind) => ({
      kind,
      configured: configuredKinds.has(kind),
    })),
  };
}

// ── The bundle ──────────────────────────────────────────────────────────────────────────────────

/** Compose the whole bundle. Pure with respect to its ports; nothing is written anywhere. */
export function buildDiagnosticsBundle(ports: DiagnosticsPorts): DiagnosticsBundle {
  const now = ports.now?.() ?? new Date();
  const databasePath = ports.databasePath ?? config.databasePath;

  return {
    bundleVersion: DIAGNOSTICS_BUNDLE_VERSION,
    generatedAt: now.toISOString(),
    versions: {
      app: config.appVersion,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      dockerMode: config.dockerMode,
    },
    environment: buildEnvironmentGroup(ports.env ?? process.env),
    database: readDatabaseGroup(ports.db, databasePath),
    errors: readErrorsGroup(ports.db),
    features: readFeaturesGroup(ports.db, ports.featureFlags()),
    // RM-38 WP 3.2 — which reference data pack this install is running. Counts, enums, versions and
    // booleans only: the group carries no `DATA_PACK_URL` (it is in the Environment catalogue as
    // `{ name, status }` like every other variable) and no refusal SENTENCE, because the fetcher
    // composes those with the checked URL inside them. See `data-pack/status.ts`.
    dataPack: buildDiagnosticsDataPackGroup(),
  };
}
