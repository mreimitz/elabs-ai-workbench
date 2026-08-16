// Assistant Hub (roadmap/assistant-hub/, WP4.3) — retention / pruning, mirroring the Assistant
// feature's `assistant/retention.ts` day-based + orphan-sweep pattern (`SCAN_RETENTION_PER_SERVER`'s
// day-based semantics — 0 = keep everything). `POST /api/maintenance/prune-hub` (`db/maintenance.ts`)
// calls `pruneHubData` below. Three independent passes, all reported honestly in the result:
//
//   1. Day-based ROOT-session retention: delete `hub_sessions` rows with no parent (a conversational
//      root — chat/research/mission mode — never a mission-agent child directly) whose OWN status has
//      settled to a terminal (the repository-side SQL filter, `listPrunableRootSessionIds`) AND whose
//      `updated_at` predates the window. `deleteSession` cascades `hub_events`/`hub_missions` (as
//      parent)/`hub_session_summaries`/agent children — artifacts/files pinned to it are `SET NULL`
//      (they survive, D-AH12). A root that started a mission is additionally skipped unless that
//      mission has ALSO reached a terminal status (`isTerminalMissionStatus`): a mission runs
//      INDEPENDENTLY of its parent's own per-turn status (`missions/orchestrator.ts` never touches the
//      root session's `status`), so an old-looking root can still have a mission genuinely in flight.
//      No-op when `days <= 0`.
//   2. Orphan workspace-dir sweep (UNCONDITIONAL, not day-gated): remove `hub/ws/<sessionId>/`
//      directories for a session id that no longer has a DB row — defensive GC for drift (a crash
//      before a commit, a manual DB edit, or simply the fact that `DELETE /api/hub/sessions/:id` does
//      not itself remove the workspace directory today). Always safe: a leftover directory is dead
//      weight the moment its session is gone.
//   3. Files sweep (UNCONDITIONAL): `hub_file_links` rows whose polymorphic target (session/project/
//      artifact — D-AH12's denormalized `target_id`, no real FK) no longer exists, then any
//      `hub_files` blob left with zero remaining links — reclaiming upload bytes a deleted
//      session/project/artifact left behind (nothing cascades this automatically).
import fs from "node:fs";
import path from "node:path";
import type { HubPruneResult } from "@mcp-token-footprint/shared";
import { isTerminalMissionStatus } from "./missions/index.js";
import type { HubRepository } from "./repository.js";
import { removeHubWorkspaceRoot } from "./workspace.js";

const MS_PER_DAY = 86_400_000;

export interface PruneHubDataOptions {
  repository: HubRepository;
  dataDir: string;
  /** `HUB_SESSION_RETENTION_DAYS` (or the route's `?days=` override). 0 = disabled. */
  days: number;
  /** Overridable for tests; defaults to the real clock. */
  now?: Date;
}

export function pruneHubData(options: PruneHubDataOptions): HubPruneResult {
  const { repository, days } = options;
  const now = options.now ?? new Date();
  const dataDir = path.resolve(options.dataDir);

  const prunedSessionIds: string[] = [];
  if (days > 0) {
    const cutoff = new Date(now.getTime() - days * MS_PER_DAY).toISOString();
    for (const id of repository.listPrunableRootSessionIds(cutoff)) {
      const mission = repository.getMissionBySession(id);
      if (mission && !isTerminalMissionStatus(mission.status)) continue; // a mission is still in flight
      const childIds = repository.listChildSessionIds(id); // read BEFORE the cascade removes the rows
      repository.deleteSession(id); // cascades events/missions(as parent)/summaries/agent children
      for (const sessionId of [id, ...childIds]) removeHubWorkspaceRoot(dataDir, sessionId);
      prunedSessionIds.push(id);
    }
  }

  // Orphan workspace-dir sweep — unconditional, independent of the retention window above.
  const liveSessionIds = new Set(repository.listAllSessionIds());
  const removedOrphanWorkspaceDirs = removeOrphanChildDirs(
    path.join(dataDir, "hub", "ws"),
    liveSessionIds,
  );

  // Files sweep — unconditional (dangling links first, then now-unreferenced blobs; order matters —
  // a file whose only link just got pruned above is caught by the second pass in the SAME call).
  const prunedDanglingFileLinks = repository.pruneDanglingFileLinks();
  const prunedUnlinkedFiles = repository.pruneUnlinkedFiles();

  return {
    retentionDays: days,
    prunedSessionIds,
    removedOrphanWorkspaceDirs,
    prunedDanglingFileLinks,
    prunedUnlinkedFiles,
  };
}

/** Remove every child directory of `dirPath` whose name isn't in `liveIds`. A missing `dirPath` -> 0
 *  (nothing has ever written a hub workspace yet). */
function removeOrphanChildDirs(dirPath: string, liveIds: ReadonlySet<string>): number {
  const entries = readDirSafe(dirPath);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || liveIds.has(entry.name)) continue;
    fs.rmSync(path.join(dirPath, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function readDirSafe(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return []; // the directory doesn't exist yet — nothing to sweep
  }
}
