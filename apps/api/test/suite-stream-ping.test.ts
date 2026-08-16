import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { SuiteRunEvent } from "@mcp-token-footprint/shared";
import type { FailureBucketService } from "../src/grading/failure-buckets.js";
import type { GradeRepository } from "../src/grading/grade-repository.js";
import { registerSuiteRoutes, setSseHeartbeatMsForTesting } from "../src/suites/routes.js";
import type { SuiteOrchestrator } from "../src/suites/orchestrator.js";
import type { SuiteService } from "../src/suites/service.js";
import { SuiteRunManager } from "../src/suites/suite-run-manager.js";
import type { SuiteRunRepository } from "../src/suites/suite-run-repository.js";
import type { SuiteReportRepository } from "../src/suites/suite-report-repository.js";
import type { SuiteReportService } from "../src/suites/suite-report-service.js";
import type { RunRepository } from "../src/testing/run-repository.js";
import type { TestService } from "../src/testing/test-service.js";
import { toErrorMessage } from "../src/utils/errors.js";

// Unified Sessions WP2.3 (D-US8 follow-up) — the suite-stream ping parity fix: the `GET
// /api/suite-runs/:id/stream` heartbeat now emits a real `{type:"ping"}` SuiteRunEvent (was a raw
// `: ping\n\n` SSE comment, invisible to `EventSource.onmessage`). Exercised over a REAL Fastify server
// + `fetch`, mirroring `run-stream-routes.test.ts`'s WP2.1 ping test, but with the suite run driven
// directly through a real `SuiteRunManager` (no DB, no orchestrator, no provider/MCP session needed) —
// `streamSuiteRun` only ever calls `orchestrator.isActive()` and `manager.subscribe()`/`suiteRuns.getRun()`
// (the latter only on the NOT-active branch, never reached here since the stub orchestrator stays
// "active" until the test itself emits the terminal + settled-rating events).

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  // Always restore the true production heartbeat cadence, mirroring the run-stream test's afterEach.
  setSseHeartbeatMsForTesting(15_000);
});

type Harness = { baseUrl: string; manager: SuiteRunManager };

async function makeApp(): Promise<Harness> {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "Validation failed", issues: error.issues });
    const typed = error as Error & { statusCode?: number };
    return reply
      .code(typeof typed.statusCode === "number" ? typed.statusCode : 500)
      .send({ error: toErrorMessage(error) });
  });

  const manager = new SuiteRunManager();
  // The stream route only ever calls `.isActive()` on the orchestrator; stay "active" for the whole
  // test window (mirrors a real in-flight suite run) so `suiteRuns`/every other dep is never touched.
  const orchestrator = { isActive: () => true } as unknown as SuiteOrchestrator;

  await registerSuiteRoutes(
    app,
    {} as unknown as SuiteService,
    orchestrator,
    {} as unknown as SuiteRunRepository,
    manager,
    {} as unknown as RunRepository,
    {} as unknown as GradeRepository,
    {} as unknown as TestService,
    {} as unknown as FailureBucketService,
    {} as unknown as SuiteReportService,
    {} as unknown as SuiteReportRepository,
  );
  apps.push(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { baseUrl: `http://127.0.0.1:${port}`, manager };
}

type SseFrame = { id: string | undefined; event: SuiteRunEvent };

/** Parse `data:`/`id:` SSE frames off a fetch response body, same framing loop as the run-stream test. */
async function readFrames(
  res: Response,
  opts: { until: (frames: SseFrame[]) => boolean; timeoutMs: number },
): Promise<SseFrame[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: SseFrame[] = [];
  const deadline = Date.now() + opts.timeoutMs;
  while (!opts.until(frames) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let id: string | undefined;
      let event: SuiteRunEvent | undefined;
      for (const line of frame.split("\n")) {
        if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) event = JSON.parse(line.slice(5).trim()) as SuiteRunEvent;
      }
      if (event) frames.push({ id, event });
    }
  }
  await reader.cancel().catch(() => undefined);
  return frames;
}

test('a `{type:"ping"}` keepalive is emitted on the suite SSE heartbeat interval and never carries an id:', async () => {
  // Shrink the heartbeat cadence for this test only (restored in `afterEach`).
  setSseHeartbeatMsForTesting(30);

  const h = await makeApp();
  const suiteRunId = "suite-run-ping-1";
  h.manager.create(suiteRunId);

  const res = await fetch(`${h.baseUrl}/api/suite-runs/${suiteRunId}/stream`);
  assert.equal(res.status, 200);

  const frames = await readFrames(res, {
    until: (fs) => fs.some((f) => f.event.type === "ping"),
    timeoutMs: 3000,
  });

  // Cleanly settle the suite run so the server-side listener/heartbeat tear down (mirrors a real
  // terminal suite run — terminal status THEN a settled rating).
  h.manager.emit(suiteRunId, { type: "status", status: "completed" });
  h.manager.emit(suiteRunId, { type: "rating", state: "rated" });

  const pingFrame = frames.find((f) => f.event.type === "ping");
  assert.ok(pingFrame, 'a `{type:"ping"}` event arrived within the shortened heartbeat window');
  assert.equal(pingFrame?.id, undefined, "a ping never carries an `id:` line (no seq, no cursor advance)");
  assert.equal(pingFrame?.event.seq, undefined, "a ping's payload carries no `seq` either");
});

test("a ping is a no-op alongside real cell/aggregates/status/rating events on the same stream", async () => {
  setSseHeartbeatMsForTesting(30);

  const h = await makeApp();
  const suiteRunId = "suite-run-ping-2";
  h.manager.create(suiteRunId);

  const res = await fetch(`${h.baseUrl}/api/suite-runs/${suiteRunId}/stream`);
  assert.equal(res.status, 200);

  h.manager.emit(suiteRunId, { type: "status", status: "running" });
  h.manager.emit(suiteRunId, {
    type: "cell",
    cell: { testId: "t1", scenarioId: "s1", repetition: 0, status: "running" },
  });

  // Wait for BOTH a ping AND the real `cell` event: the ping can arrive in the very first flushed
  // chunk (concurrently with the response headers), so stopping on "any ping" alone would race ahead
  // of the `status`/`cell` writes this test issues moments later — an artifact of this test's polling
  // loop, not the server (a single TCP stream delivers everything written, in order; this predicate
  // just has to wait long enough to observe it).
  const frames = await readFrames(res, {
    until: (fs) => fs.some((f) => f.event.type === "ping") && fs.some((f) => f.event.type === "cell"),
    timeoutMs: 3000,
  });

  h.manager.emit(suiteRunId, { type: "status", status: "completed" });
  h.manager.emit(suiteRunId, { type: "rating", state: "rated" });

  // Every real (seq-carrying) event still gets a matching `id:` line; only the ping doesn't.
  const nonPing = frames.filter((f) => f.event.type !== "ping");
  assert.ok(nonPing.length > 0, "real events arrived alongside the ping");
  for (const frame of nonPing) {
    assert.equal(typeof frame.event.seq, "number", `event ${frame.event.type} carries a seq`);
  }
  const pingFrames = frames.filter((f) => f.event.type === "ping");
  assert.ok(pingFrames.length > 0);
  for (const frame of pingFrames) {
    assert.equal(frame.id, undefined);
    assert.equal(frame.event.seq, undefined);
  }
});
