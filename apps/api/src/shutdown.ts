/**
 * H-9 — graceful shutdown.
 *
 * `apps/api/src/index.ts` ends with `await server.listen(...)` and (before this) had no SIGTERM/SIGINT
 * handler anywhere in `apps/api/src`. On `docker compose stop` / a bare `pnpm start` Ctrl-C, in-flight
 * requests were dropped, the SQLite handle was never closed (the `-wal` sidecar left un-checkpointed),
 * and MCP stdio children + Agent-SDK children (and any in-flight `claude setup-token` PTY) were
 * orphaned. This factory builds an idempotent, ordered teardown that the process signal handlers run.
 *
 * The teardown logic lives here (not inline in `index.ts`) so it is unit-testable WITHOUT booting the
 * server: `index.ts` composes the real seams (Fastify `server`, the DB handle, the run/suite/assistant
 * singletons) into {@link GracefulShutdownDeps}; a test composes spies and asserts the effects — a
 * literal OS signal can't be delivered inside a unit test.
 */

/** Minimal logger shape (pino's `server.log` satisfies it; a test can pass a silent stub). */
export type ShutdownLogger = {
  info?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
};

/**
 * The teardown seams, in the order they are invoked. Each is a thin adapter over a real singleton so
 * this module never reaches across the runtime boundary itself:
 * - {@link closeServer} — Fastify `server.close()` (stop accepting new connections, drain in-flight).
 * - {@link stopWatchScheduler} — stop the windowed watch-rule ticker (WP4.2) so no evaluation fires mid-teardown.
 * - {@link stopActiveRuns} — abort every live provider/MCP agent loop so it stops spending.
 * - {@link stopActiveSuiteRuns} — halt suite scheduling + abort in-flight child runs.
 * - {@link cancelAuthFlow} — kill any in-flight `claude setup-token` PTY.
 * - {@link killAssistantSessions} — kill every live Agent-SDK child session.
 * - {@link checkpointDb} — `PRAGMA wal_checkpoint(TRUNCATE)` so the WAL is folded back into the DB file.
 * - {@link closeDb} — close the SQLite handle.
 */
export type GracefulShutdownDeps = {
  closeServer: () => Promise<void> | void;
  stopWatchScheduler: () => void;
  stopActiveRuns: () => void;
  stopActiveSuiteRuns: () => void;
  cancelAuthFlow: () => void;
  killAssistantSessions: () => void;
  checkpointDb: () => void;
  closeDb: () => void;
  log?: ShutdownLogger;
  /** Injectable so tests assert the exit code without actually terminating the test process. */
  exit?: (code: number) => void;
};

/**
 * Build the shutdown function. It is IDEMPOTENT (a second signal — e.g. SIGINT after SIGTERM, or an
 * impatient double Ctrl-C — is a no-op) and FAULT-ISOLATED (a throwing/rejecting step is logged and
 * skipped so it can't block the remaining teardown, e.g. a failed `wal_checkpoint` must not prevent
 * `db.close()`/exit). Steps run strictly in the {@link GracefulShutdownDeps} order; `exit(0)` fires
 * once, after every step has been attempted.
 */
export function createGracefulShutdown(
  deps: GracefulShutdownDeps,
): (signal?: string) => Promise<void> {
  let started = false;

  const step = async (name: string, run: () => Promise<void> | void): Promise<void> => {
    try {
      await run();
    } catch (error) {
      // Swallow so one failing step never blocks the rest of the teardown (or the exit).
      deps.log?.error?.({ err: error, step: name }, "graceful shutdown step failed (continuing)");
    }
  };

  return async (signal?: string): Promise<void> => {
    if (started) return; // idempotent: a second signal must not re-run teardown.
    started = true;
    deps.log?.info?.({ signal }, "graceful shutdown: tearing down");

    await step("server.close", () => deps.closeServer());
    await step("stopWatchScheduler", () => deps.stopWatchScheduler());
    await step("stopActiveRuns", () => deps.stopActiveRuns());
    await step("stopActiveSuiteRuns", () => deps.stopActiveSuiteRuns());
    await step("cancelAuthFlow", () => deps.cancelAuthFlow());
    await step("killAssistantSessions", () => deps.killAssistantSessions());
    await step("wal_checkpoint", () => deps.checkpointDb());
    await step("db.close", () => deps.closeDb());

    deps.log?.info?.({ signal }, "graceful shutdown: complete");
    (deps.exit ?? ((code: number) => process.exit(code)))(0);
  };
}

/**
 * Register the shutdown on SIGTERM (container stop / deploy) + SIGINT (Ctrl-C under bare `pnpm start`).
 * `process.once` means each signal fires at most once, and the {@link createGracefulShutdown} guard
 * covers the cross-signal case. Not called in unit tests (they drive the returned function directly).
 */
export function installShutdownHandlers(shutdown: (signal?: string) => Promise<void>): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}
