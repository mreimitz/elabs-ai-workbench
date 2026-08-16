import type { FastifyInstance } from "fastify";
import {
  APP_SETTING_RUN_RETENTION_KEY,
  DIGEST_RETENTION_DAYS_DEFAULT,
  NOTIFICATION_RETENTION_DAYS_DEFAULT,
  runRetentionPolicySchema,
  type AssistantPruneResult,
  type DigestPruneResult,
  type HubPruneResult,
  type MaintenanceResult,
  type NotificationPruneResult,
  type RunPruneResult,
  type RunRetentionPolicy,
  type ScanRetentionResult,
  type SearchReindexResult,
} from "@mcp-token-footprint/shared";
import type { AssistantRepository } from "../assistant/repository.js";
import { pruneAssistantData } from "../assistant/retention.js";
import { config } from "../config/env.js";
import type { AppSettingsRepository } from "../grading/app-settings-repository.js";
import type { HubRepository } from "../hub/repository.js";
import { pruneHubData } from "../hub/retention.js";
import { reindexSearch } from "../observability/search.js";
import type { DigestReportRepository } from "../reports/digest.js";
import type { ScanRepository } from "../scans/repository.js";
import type { RunRepository } from "../testing/run-repository.js";
import type { NotificationRepository } from "../watch/notifications.js";
import type { AppDatabase } from "./database.js";

/**
 * DB maintenance (issue #19). SQLite in WAL mode accumulates a `-wal` sidecar; `VACUUM` rewrites the
 * main file to reclaim space from deleted rows. Neither is run automatically on every startup (VACUUM
 * rewrites the whole DB — too costly to do unconditionally); they are explicit, callable operations
 * exposed on a small maintenance surface so an operator (or a scheduled job) can trigger them.
 */

/**
 * Truncating WAL checkpoint: flush the write-ahead log back into the main DB and reset the `-wal`
 * file to zero length. Cheap and safe to call periodically. Returns a structured result.
 */
export function checkpointWal(db: AppDatabase): MaintenanceResult {
  // Returns [busy, log, checkpointed]; busy=0 means the checkpoint completed without contention.
  const row = db.pragma("wal_checkpoint(TRUNCATE)") as Array<Record<string, number>>;
  const busy = row?.[0]?.busy ?? 0;
  return {
    operation: "checkpoint",
    ok: busy === 0,
    message:
      busy === 0
        ? "WAL checkpoint (TRUNCATE) completed"
        : "WAL checkpoint could not fully complete (busy)",
  };
}

/**
 * `VACUUM` the database — rebuild the file to reclaim space freed by deleted scans/runs and defragment.
 * Cannot run inside a transaction (SQLite restriction); the caller must invoke it outside one.
 */
export function vacuumDatabase(db: AppDatabase): MaintenanceResult {
  db.exec("VACUUM");
  return { operation: "vacuum", ok: true, message: "VACUUM completed" };
}

/** The assistant deps `registerMaintenanceRoutes` needs for `POST /api/maintenance/prune-assistant`
 *  (WP 3.3) — a thin bag rather than the whole `AssistantSessionManager`, so this module doesn't need
 *  to import it (avoiding a `db` → `assistant` → … dependency-direction surprise). */
export interface MaintenanceAssistantDeps {
  repository: AssistantRepository;
  /** `AssistantSessionManager.isLive` — never prune a thread with a live session. */
  isThreadLive: (threadId: string) => boolean;
  assistantDataDir: string;
}

/** The hub deps `registerMaintenanceRoutes` needs for `POST /api/maintenance/prune-hub` (WP4.3) — a
 *  thin bag mirroring {@link MaintenanceAssistantDeps}, so this module doesn't need the whole
 *  `HubSessionService`/`HubMissionService` (a "live" turn is already excluded by
 *  `listPrunableRootSessionIds`'s own terminal-status filter — no separate liveness callback needed). */
export interface MaintenanceHubDeps {
  repository: HubRepository;
  dataDir: string;
}

/** Read the persisted {@link RunRetentionPolicy} (WP1.6), or the empty/default policy (`byStatus: {}`,
 *  pruning OFF) when nothing has been saved yet. */
function readRunRetentionPolicy(appSettings: AppSettingsRepository): RunRetentionPolicy {
  return runRetentionPolicySchema.parse(appSettings.get(APP_SETTING_RUN_RETENTION_KEY) ?? {});
}

/** Maintenance endpoints: WAL checkpoint, VACUUM, on-demand scan retention prune-all, assistant
 *  thread/workspace/session-transcript retention prune-all (WP 3.3), and run retention classes —
 *  pin-aware, per-status prune-all (WP1.6). */
export async function registerMaintenanceRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  scans: ScanRepository,
  assistant: MaintenanceAssistantDeps,
  runs: RunRepository,
  appSettings: AppSettingsRepository,
  notifications: NotificationRepository,
  digests: DigestReportRepository,
  hub: MaintenanceHubDeps,
): Promise<void> {
  app.post("/api/maintenance/checkpoint", async () => checkpointWal(db));

  app.post("/api/maintenance/vacuum", async () => vacuumDatabase(db));

  // Observability (WP1.3, D-OB16) — DROP + rebuild the full-text search index (`run_search`) from the
  // authoritative runs/run_steps/run_grades rows. DERIVED state: safe to run anytime; restores the index
  // fully (e.g. after a manual DB edit, or to pick up a content-shape change). Returns the run/doc counts.
  app.post("/api/maintenance/reindex-search", async (): Promise<SearchReindexResult> =>
    reindexSearch(db),
  );

  // Prune every server down to the last N scans. `?keep=` overrides the configured default; both
  // 0/absent mean "use the configured retention" (which itself may be 0 = disabled → no-op).
  app.post("/api/maintenance/prune-scans", async (request): Promise<ScanRetentionResult> => {
    const raw = (request.query as { keep?: string }).keep;
    const parsed = raw === undefined ? NaN : Number(raw);
    const keep =
      Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : config.scanRetentionPerServer;
    return scans.pruneAllServers(keep);
  });

  // Prune assistant threads/events older than N days (+ orphaned workspace/scratch dirs + stale SDK
  // session transcripts under the app's own scoped CLAUDE_CONFIG_DIR — see retention.ts). `?days=`
  // overrides the configured default; both 0/absent mean "use the configured retention" (0 = disabled
  // for the day-gated passes; the orphan sweep still runs, since it's unconditional GC).
  app.post("/api/maintenance/prune-assistant", async (request): Promise<AssistantPruneResult> => {
    const raw = (request.query as { days?: string }).days;
    const parsed = raw === undefined ? NaN : Number(raw);
    const days =
      Number.isFinite(parsed) && parsed >= 0
        ? Math.floor(parsed)
        : config.assistantSessionRetentionDays;
    return pruneAssistantData({
      repository: assistant.repository,
      isThreadLive: assistant.isThreadLive,
      assistantDataDir: assistant.assistantDataDir,
      days,
    });
  });

  // Assistant Hub (roadmap/assistant-hub/, WP4.3) — prune root sessions/workspaces/files. `?days=`
  // overrides the configured default; both 0/absent mean "use the configured retention" (0 = disabled
  // for the day-gated root-session pass — the orphan workspace-dir + files sweeps still run
  // unconditionally, mirroring prune-assistant's convention).
  app.post("/api/maintenance/prune-hub", async (request): Promise<HubPruneResult> => {
    const raw = (request.query as { days?: string }).days;
    const parsed = raw === undefined ? NaN : Number(raw);
    const days =
      Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : config.hubSessionRetentionDays;
    return pruneHubData({ repository: hub.repository, dataDir: hub.dataDir, days });
  });

  // Observability (roadmap/observability/, WP1.6) — retention classes: the persisted per-status prune
  // policy an operator edits in Settings → Storage. Absent → the empty/default policy (pruning OFF).
  app.get("/api/maintenance/run-retention-policy", async (): Promise<RunRetentionPolicy> =>
    readRunRetentionPolicy(appSettings),
  );
  app.put("/api/maintenance/run-retention-policy", async (request): Promise<RunRetentionPolicy> => {
    const policy = runRetentionPolicySchema.parse(request.body);
    appSettings.put(APP_SETTING_RUN_RETENTION_KEY, policy);
    return policy;
  });

  // Prune runs per the retention policy. An explicit `{ policy }` in the body overrides the persisted
  // one for THIS call only (mirrors `?keep=` for prune-scans) — never persisted. Absent body → the
  // saved policy (default empty → no-op, no auto-prune without explicit configuration). A pinned run
  // is NEVER a victim (enforced in the repository); deletion goes through the SAME full run-delete
  // cascade `DELETE /api/runs/:id` uses (steps/events/grades/skills + the WP1.3 FTS purge).
  app.post("/api/maintenance/prune-runs", async (request): Promise<RunPruneResult> => {
    const body = (request.body ?? {}) as { policy?: unknown };
    const policy =
      body.policy !== undefined
        ? runRetentionPolicySchema.parse(body.policy)
        : readRunRetentionPolicy(appSettings);
    return runs.pruneRuns(policy);
  });

  // Observability (WP4.3) — prune READ notifications older than N days; an UNREAD one is NEVER a prune
  // victim regardless of age (an operator must see an alert at least once). `?days=` overrides the
  // default; both 0/absent mean "use the default" (mirrors prune-scans'/prune-assistant's convention —
  // note that unlike those, `0` here still means "use the default", not "disabled", since there is no
  // persisted override to fall back to).
  app.post("/api/maintenance/prune-notifications", async (request): Promise<NotificationPruneResult> => {
    const raw = (request.query as { days?: string }).days;
    const parsed = raw === undefined ? NaN : Number(raw);
    const days =
      Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : NOTIFICATION_RETENTION_DAYS_DEFAULT;
    return notifications.pruneRead(days);
  });

  // Observability (WP5.5, D-OB22) — prune digest reports older (by generated_at) than N days; `?days=`
  // overrides the default (mirrors prune-notifications' convention — `0`/absent means "use the
  // default", not "disabled", since there is no persisted override to fall back to).
  app.post("/api/maintenance/prune-digests", async (request): Promise<DigestPruneResult> => {
    const raw = (request.query as { days?: string }).days;
    const parsed = raw === undefined ? NaN : Number(raw);
    const days = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DIGEST_RETENTION_DAYS_DEFAULT;
    return digests.pruneOlderThan(days);
  });
}
