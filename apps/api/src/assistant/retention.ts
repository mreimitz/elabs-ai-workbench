// Assistant (WP 3.3) — retention / pruning, mirroring `SCAN_RETENTION_PER_SERVER`'s day-based
// semantics (0 = keep everything). `POST /api/maintenance/prune-assistant` (`db/maintenance.ts`) calls
// `pruneAssistantData` below. Three independent passes, all reported honestly in the result:
//
//   1. Day-based thread retention: delete `assistant_threads` rows (+ cascade `assistant_events`)
//      whose `updated_at` is older than the window, skipping any thread with a LIVE session (never
//      prune something in use — checked via the session manager's `isLive`). No-op when `days <= 0`.
//   2. Orphan sweep (UNCONDITIONAL, not day-gated): remove `ws/<threadId>` / `threads/<threadId>`
//      directories left behind for a thread id that no longer has a DB row — defensive GC for drift
//      (e.g. a crash before a commit, or a build predating the `deleteThread` scratch-dir fix this WP
//      also made). Always safe: these directories are dead weight the moment their thread is gone.
//   3. Stale SDK session-transcript sweep: the Agent SDK writes each session's JSONL transcript under
//      `<CLAUDE_CONFIG_DIR>/projects/<sanitized-cwd>/...` (confirmed against the installed
//      `@anthropic-ai/claude-agent-sdk@0.3.206` `sdk.d.ts`'s `listSessions`/`deleteSession`/
//      `getSessionInfo` docs). Those SDK functions resolve their storage root from
//      `process.env.CLAUDE_CONFIG_DIR`/`HOME` at CALL TIME with no per-call override — calling them
//      from THIS process (which never sets those env vars; only the spawned child's env does, via
//      `spawn-env.ts`) would target the OPERATOR's real `~/.claude`, not the child's scoped one. That
//      would violate `.claude/rules/mcp-and-security.md`'s "never touches the operator's real
//      ~/.claude state" rule, so this deliberately does NOT call them. Instead it sweeps
//      `<assistantDataDir>/claude/projects/*` directly by directory mtime — bounded strictly to the
//      app's OWN scoped `CLAUDE_CONFIG_DIR` (`spawn-env.ts`'s `claudeConfigDir`), independent of which
//      thread a project directory maps to (no need to reverse-engineer the SDK's undocumented cwd→
//      dirname sanitization). Day-gated by the same window as pass 1.
import fs from "node:fs";
import path from "node:path";
import type { AssistantPruneResult } from "@mcp-token-footprint/shared";
import { threadScratchDir } from "./session-manager.js";
import type { AssistantRepository } from "./repository.js";
import { removeWorkspaceRoot } from "./workspace.js";

const MS_PER_DAY = 86_400_000;

export interface PruneAssistantDataOptions {
  repository: AssistantRepository;
  /** Never prune a thread with a live session (`AssistantSessionManager.isLive`). */
  isThreadLive: (threadId: string) => boolean;
  assistantDataDir: string;
  /** `ASSISTANT_SESSION_RETENTION_DAYS` (or the route's `?days=` override). 0 = disabled. */
  days: number;
  /** Overridable for tests; defaults to the real clock. */
  now?: Date;
}

export function pruneAssistantData(options: PruneAssistantDataOptions): AssistantPruneResult {
  const { repository, isThreadLive, days } = options;
  const now = options.now ?? new Date();
  const dataDir = path.resolve(options.assistantDataDir);

  const prunedThreadIds: string[] = [];
  if (days > 0) {
    const cutoff = new Date(now.getTime() - days * MS_PER_DAY).toISOString();
    for (const id of repository.listThreadIdsUpdatedBefore(cutoff)) {
      if (isThreadLive(id)) continue; // never prune a thread currently in use
      repository.deleteThread(id); // cascades assistant_events
      removeWorkspaceRoot(dataDir, id);
      fs.rmSync(threadScratchDir(dataDir, id), { recursive: true, force: true });
      prunedThreadIds.push(id);
    }
  }

  // Orphan sweep — unconditional, independent of the retention window above.
  const liveThreadIds = new Set(repository.listThreads().map((thread) => thread.id));
  const removedOrphanWorkspaceDirs = removeOrphanChildDirs(path.join(dataDir, "ws"), liveThreadIds);
  const removedOrphanScratchDirs = removeOrphanChildDirs(
    path.join(dataDir, "threads"),
    liveThreadIds,
  );

  let removedStaleSessionDirs = 0;
  if (days > 0) {
    const cutoffMs = now.getTime() - days * MS_PER_DAY;
    removedStaleSessionDirs = removeStaleDirs(path.join(dataDir, "claude", "projects"), cutoffMs);
  }

  return {
    retentionDays: days,
    prunedThreadIds,
    removedOrphanWorkspaceDirs,
    removedOrphanScratchDirs,
    removedStaleSessionDirs,
  };
}

/** Remove every child directory of `dirPath` whose name isn't in `liveIds`. Missing `dirPath` → 0. */
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

/** Remove every child directory of `dirPath` whose newest file mtime is older than `cutoffMs`. */
function removeStaleDirs(dirPath: string, cutoffMs: number): number {
  const entries = readDirSafe(dirPath);
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dirPath, entry.name);
    if (newestMtimeMs(full) < cutoffMs) {
      fs.rmSync(full, { recursive: true, force: true });
      removed += 1;
    }
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

/** The newest mtime (ms) anywhere in `target`'s tree (itself included); 0 if it can't be stat'd. */
function newestMtimeMs(target: string): number {
  let newest = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(current);
    } catch {
      continue;
    }
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
    if (stat.isDirectory()) {
      for (const child of readDirNamesSafe(current)) stack.push(path.join(current, child));
    }
  }
  return newest;
}

function readDirNamesSafe(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}
