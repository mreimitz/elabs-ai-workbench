import assert from "node:assert/strict";
import { test } from "node:test";
import { createGracefulShutdown, type GracefulShutdownDeps } from "../src/shutdown.js";

/**
 * H-9 — graceful shutdown. A literal OS signal can't be delivered inside a unit test, so we drive the
 * function {@link createGracefulShutdown} returns (exactly what the SIGTERM/SIGINT handler runs) and
 * assert its effects on spied seams: the real teardown order, idempotency, fault-isolation, and exit(0).
 */

const silentLog = {
  info: () => undefined,
  error: () => undefined,
};

/** Build deps whose seams record their invocation order into `calls`; `exit` records the code. */
function makeDeps(overrides: Partial<GracefulShutdownDeps> = {}): {
  deps: GracefulShutdownDeps;
  calls: string[];
  exitCodes: number[];
} {
  const calls: string[] = [];
  const exitCodes: number[] = [];
  const deps: GracefulShutdownDeps = {
    closeServer: async () => {
      calls.push("server.close");
    },
    stopWatchScheduler: () => {
      calls.push("stopWatchScheduler");
    },
    stopActiveRuns: () => {
      calls.push("stopActiveRuns");
    },
    stopActiveSuiteRuns: () => {
      calls.push("stopActiveSuiteRuns");
    },
    cancelAuthFlow: () => {
      calls.push("cancelAuthFlow");
    },
    killAssistantSessions: () => {
      calls.push("killAssistantSessions");
    },
    checkpointDb: () => {
      calls.push("wal_checkpoint");
    },
    closeDb: () => {
      calls.push("db.close");
    },
    log: silentLog,
    exit: (code) => {
      exitCodes.push(code);
    },
    ...overrides,
  };
  return { deps, calls, exitCodes };
}

test("H-9: shutdown invokes every teardown seam, in order, then exits 0", async () => {
  const { deps, calls, exitCodes } = makeDeps();
  const shutdown = createGracefulShutdown(deps);

  await shutdown("SIGTERM");

  // Every mandated closer fired: server.close, run/suite stop, auth-flow cancel, killAllSessions,
  // wal_checkpoint(TRUNCATE), db.close — in the safe teardown order.
  assert.deepEqual(calls, [
    "server.close",
    "stopWatchScheduler",
    "stopActiveRuns",
    "stopActiveSuiteRuns",
    "cancelAuthFlow",
    "killAssistantSessions",
    "wal_checkpoint",
    "db.close",
  ]);
  assert.deepEqual(exitCodes, [0], "exits exactly once with code 0");
});

test("H-9: shutdown is idempotent — a second signal is a no-op", async () => {
  const { deps, calls, exitCodes } = makeDeps();
  const shutdown = createGracefulShutdown(deps);

  await shutdown("SIGTERM");
  const callsAfterFirst = [...calls];
  await shutdown("SIGINT"); // e.g. Ctrl-C after a container SIGTERM, or an impatient double Ctrl-C

  assert.deepEqual(calls, callsAfterFirst, "teardown does not run a second time");
  assert.deepEqual(exitCodes, [0], "exit fires only once across repeated signals");
});

test("H-9: a throwing/rejecting step is isolated — later steps and exit still run", async () => {
  // Make the FIRST step reject and a MIDDLE step throw synchronously; the WAL checkpoint + db.close +
  // exit must still happen (one failure can't strand the DB handle open or block the process exit).
  const { deps, calls, exitCodes } = makeDeps({
    closeServer: async () => {
      calls.push("server.close");
      throw new Error("server.close failed");
    },
    stopActiveRuns: () => {
      calls.push("stopActiveRuns");
      throw new Error("stopActiveRuns failed");
    },
  });
  const shutdown = createGracefulShutdown(deps);

  await shutdown("SIGTERM");

  // Despite two failures early, the critical DB teardown + exit still ran.
  assert.ok(calls.includes("wal_checkpoint"), "wal_checkpoint still runs after earlier failures");
  assert.ok(calls.includes("db.close"), "db.close still runs after earlier failures");
  assert.deepEqual(exitCodes, [0], "the process still exits 0 after isolated step failures");
  // Order is still preserved for the steps that did run.
  assert.deepEqual(calls, [
    "server.close",
    "stopWatchScheduler",
    "stopActiveRuns",
    "stopActiveSuiteRuns",
    "cancelAuthFlow",
    "killAssistantSessions",
    "wal_checkpoint",
    "db.close",
  ]);
});
