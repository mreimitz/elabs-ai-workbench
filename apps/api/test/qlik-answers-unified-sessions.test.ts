import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { RunEvent, SessionCapabilities } from "@mcp-token-footprint/shared";
import { _clearQlikAnswersAppContextCache } from "../src/providers/model-catalog.js";
import type { InteractiveTurns } from "../src/testing/engine.js";
import {
  runQlikAnswers,
  runQlikAnswersInteractive,
  type QlikAnswersRunConfig,
} from "../src/testing/qlik-answers-executor.js";
import type { RunEmitMeta } from "../src/testing/run-manager.js";

// Unified Sessions (roadmap/unified-sessions/, WP1.5) — coverage for the qlik-answers-executor's
// adoption of the shared SessionClock/terminalFor/capabilities contract, ON TOP of the existing Phase 4
// cloud-assistants suite (qlik-answers-executor.test.ts / qlik-answers-backoff.test.ts), which already
// locks the deadline→aborted fix and the AE-4→prompt_rejected mapping. This file covers what those
// don't: the STALL detector, `rate_limit` classification, capability-manifest reporting, duration
// accounting, and the INTERACTIVE `waiting_input`/`wait_expired` bracketing (previously untested).
//
// NO REAL TENANT is ever contacted — every tenant call goes through an injected `fetchImpl` stub
// (mirrors the sibling test files exactly).

const BASE_URL = "https://acme.us.qlikcloud.com";
const ASSISTANT_ID = "asst-123";
const APP_ID = "app-guid-1";
const PROMPT = "What was the average NYC taxi fare?";
const ETAG = "assistant-version-42";
const MESSAGE_ID = "msg-1";
const ANSWER = "The average NYC taxi fare was $18.50.";

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function answerMessage(text = ANSWER): unknown {
  return {
    id: MESSAGE_ID,
    type: "ai",
    content: [
      {
        card: {
          body: [
            { type: "TextBlock", text: "Conclusion" },
            { type: "TextBlock", text },
          ],
        },
      },
    ],
  };
}

type Call = { url: string; method: string };

/**
 * A stub fetch dispatching the cloud-assistants wire. `onStream` decides the prompt-POST response;
 * everything else has a sensible default (resolution → app id, thread → thread-1, messages → the
 * answer card). A pending (never-settling-until-abort) `onStream` promise is how the stall/wait tests
 * simulate "the tenant never responds" without a real network hang.
 */
function stubFetch(opts: {
  calls: Call[];
  onStream?: (init: RequestInit | undefined) => Response | Promise<Response>;
}): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    opts.calls.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/messages")) return jsonResponse({ data: [answerMessage()] });
    if (url.endsWith("/actions/stream")) {
      if (!opts.onStream) throw new Error("unexpected /actions/stream call in stub");
      return opts.onStream(init);
    }
    if (url.endsWith("/cloud-assistants/threads")) return jsonResponse({ id: "thread-1" });
    if (url.includes("/api/v1/assistants/"))
      return jsonResponse({ id: ASSISTANT_ID, appIds: [APP_ID], knowledgeBases: [] });
    return new Response("not found", { status: 404 });
  };
  return impl as typeof fetch;
}

/** A prompt POST that never resolves on its own — only rejects once its signal aborts. Simulates a
 *  hung/silent tenant for the stall / wait-budget tests. */
function neverSettlingStream(): (init: RequestInit | undefined) => Promise<Response> {
  return (init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal ?? undefined;
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
        once: true,
      });
    });
}

function successStream(frames: string[] = [`data: {"messageId":"${MESSAGE_ID}"}\n`]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", etag: ETAG } });
}

function baseConfig(
  over: Partial<QlikAnswersRunConfig> & Pick<QlikAnswersRunConfig, "fetchImpl">,
): QlikAnswersRunConfig {
  return {
    assistantId: ASSISTANT_ID,
    prompt: PROMPT,
    auth: { apiKey: "secret-key", baseUrl: BASE_URL },
    profiles: ["generic_o200k"],
    transport: "invoke",
    retrySleep: () => Promise.resolve(),
    retryRandom: () => 0,
    ...over,
  };
}

function collect(): {
  events: RunEvent[];
  metas: (RunEmitMeta | undefined)[];
  emit: (e: RunEvent, meta?: RunEmitMeta) => void;
} {
  const events: RunEvent[] = [];
  const metas: (RunEmitMeta | undefined)[] = [];
  return {
    events,
    metas,
    emit: (e, meta) => {
      events.push(e);
      metas.push(meta);
    },
  };
}

// The LAST `status` event's index (a run also emits an early `{type:"status",status:"running"}`).
const terminalIndex = (events: RunEvent[]): number => {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === "status") return i;
  }
  return -1;
};
const terminalStatusEvent = (events: RunEvent[]) =>
  [...events].reverse().find((e): e is Extract<RunEvent, { type: "status" }> => e.type === "status");
const phasesOf = (events: RunEvent[]) =>
  events.filter((e): e is Extract<RunEvent, { type: "phase" }> => e.type === "phase");

/** A fake {@link InteractiveTurns} mirroring the REAL run-service provider's contract exactly: resolves
 *  queued turns immediately, otherwise resolves `null` ONLY once `abortSignal` fires (never "naturally"
 *  on its own) — so `nextTurnOrStop()`'s abort-vs-turn race behaves identically to production. */
function turnsFrom(queue: string[], abortSignal: AbortSignal): InteractiveTurns {
  let index = 0;
  return {
    nextTurn: () =>
      new Promise<string | null>((resolve) => {
        if (abortSignal.aborted) {
          resolve(null);
          return;
        }
        if (index < queue.length) {
          resolve(queue[index++] as string);
          return;
        }
        abortSignal.addEventListener("abort", () => resolve(null), { once: true });
      }),
  };
}

beforeEach(() => _clearQlikAnswersAppContextCache());

// ── The STALL detector (default guard, D-US3) ─────────────────────────────────────────────────────

test("no maxRunDurationMs set + a silent tenant → the STALL detector fires, not a hang (D-US3 default guard)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: neverSettlingStream() });
  const { events, emit } = collect();

  const result = await runQlikAnswers(
    "run-stall-1",
    baseConfig({ fetchImpl, stallMs: 15 }), // no maxRunDurationMs — the stall detector is the only guard
    emit,
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(terminalStatusEvent(events)?.stopReasonCode, "stalled");
  assert.match(result.stopReason ?? "", /stalled/);
});

test("a tiny stallMs still lets a FAST answer complete (the stall timer is rolled by every emitted event)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: () => successStream() });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-stall-2", baseConfig({ fetchImpl, stallMs: 50 }), emit);

  assert.equal(result.status, "completed");
  assert.equal(terminalStatusEvent(events)?.stopReasonCode, undefined);
});

// ── `rate_limit` classification (429/AE-6 retries exhausted) ─────────────────────────────────────

test("a persistent 429/AE-6 (retries exhausted) → error/error carrying stopReasonCode rate_limit", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () => jsonResponse({ errors: [{ code: "AE-6" }] }, { status: 429 }),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-rl-1", baseConfig({ fetchImpl }), emit);

  assert.equal(result.status, "error");
  assert.equal(result.outcome, "error");
  assert.equal(terminalStatusEvent(events)?.stopReasonCode, "rate_limit");
  assert.ok(result.stopReason?.includes("AE-6"));
});

test("a non-AE-x, non-429 tenant failure → error/error carrying stopReasonCode provider_error", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () => jsonResponse({ message: "internal server error" }, { status: 500 }),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswers("run-pe-1", baseConfig({ fetchImpl }), emit);

  assert.equal(result.status, "error");
  assert.equal(result.outcome, "error");
  assert.equal(terminalStatusEvent(events)?.stopReasonCode, "provider_error");
});

// ── SessionClock duration accounting rides the terminal emit's `meta` side-channel ────────────────

test("the terminal `status` emit carries SessionClock durations as `meta` (activeDurationMs/totalDurationMs)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: () => successStream() });
  const { events, metas, emit } = collect();

  await runQlikAnswers("run-dur-1", baseConfig({ fetchImpl }), emit);

  const idx = terminalIndex(events);
  assert.ok(idx >= 0, "a terminal status event was emitted");
  const meta = metas[idx];
  assert.ok(meta, "the terminal status emit carried a meta side-channel");
  assert.equal(typeof meta?.activeDurationMs, "number");
  assert.equal(typeof meta?.totalDurationMs, "number");
  assert.ok((meta?.activeDurationMs ?? -1) >= 0);
  assert.ok((meta?.totalDurationMs ?? -1) >= 0);
  // Every NON-terminal emit (running/step/kpi) carries no meta — only the terminal `status` does.
  assert.ok(metas.slice(0, idx).every((m) => m === undefined));
});

// ── Capabilities reporting (D-US4) ──────────────────────────────────────────────────────────────

test("onCapabilities is reported: a base manifest at start, then enriched with appId + version on success", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: () => successStream() });
  const { emit } = collect();
  const reports: SessionCapabilities[] = [];

  await runQlikAnswers(
    "run-cap-1",
    baseConfig({ fetchImpl, transport: "invoke", onCapabilities: (c) => reports.push(c) }),
    emit,
  );

  assert.ok(reports.length >= 2, "reported at least twice: base + enriched");
  const first = reports[0] as SessionCapabilities;
  assert.equal(first.toolCalls, false);
  assert.equal(first.tokens, "estimated");
  assert.equal(first.costBasis, "questions");
  assert.equal(first.liveReasoning, "structured");
  assert.equal(first.waitBudgetMs, 30 * 60_000);
  assert.equal(first.identity?.assistantId, ASSISTANT_ID);
  assert.equal(first.identity?.transport, "invoke");
  assert.equal(first.identity?.appId, undefined, "appId not yet known at the very first report");

  const last = reports[reports.length - 1] as SessionCapabilities;
  assert.equal(last.identity?.appId, APP_ID);
  assert.equal(last.identity?.version, ETAG);
});

test("onCapabilities is never called when unset — a pure no-op (every existing caller today)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: () => successStream() });
  const { emit } = collect();
  // No onCapabilities in the config — must not throw.
  const result = await runQlikAnswers("run-cap-2", baseConfig({ fetchImpl }), emit);
  assert.equal(result.status, "completed");
});

// ── Interactive: `waiting_input` bracketing + the 30-min default wait budget (D-US7) ──────────────

test("interactive: awaiting the next turn emits `waiting_input` with a server-authored deadline (default 30 min)", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: () => successStream() });
  const controller = new AbortController();
  const { events, emit } = collect();

  const runPromise = runQlikAnswersInteractive(
    "run-wait-1",
    baseConfig({ fetchImpl, abortSignal: controller.signal }),
    turnsFrom([], controller.signal), // no follow-up queued — it will sit in `waiting_input`
    emit,
  );

  // Give the opener turn a tick to settle and the wait to be entered, then stop the session.
  await new Promise((r) => setTimeout(r, 20));
  const waitPhase = phasesOf(events).find((e) => e.phase === "waiting_input");
  assert.ok(waitPhase, "a waiting_input phase event was emitted");
  assert.equal(waitPhase?.detail?.reason, "next_turn");
  assert.ok(waitPhase?.detail?.deadlineAt, "carries a server-authored deadline");
  const deadlineMs = new Date(waitPhase?.detail?.deadlineAt as string).getTime() - Date.now();
  // The default Qlik wait budget is 30 min — assert it's in the right ballpark (generous tolerance).
  assert.ok(deadlineMs > 25 * 60_000 && deadlineMs <= 30 * 60_000, `deadline ~30min out: ${deadlineMs}ms`);

  controller.abort();
  const result = await runPromise;
  assert.equal(result.status, "aborted");
  assert.equal(result.outcome, "aborted");
  assert.equal(terminalStatusEvent(events)?.stopReasonCode, "user_stop");
});

test("interactive: the wait budget exhausting (nobody answers) → stopped/stopped_guardrail/wait_expired", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: () => successStream() });
  // No abortSignal at all here — only the tiny waitBudgetMs override should end the session.
  const { events, emit } = collect();
  const neverAnswers: InteractiveTurns = { nextTurn: () => new Promise(() => undefined) };

  const result = await runQlikAnswersInteractive(
    "run-wait-2",
    baseConfig({ fetchImpl, waitBudgetMs: 15 }),
    neverAnswers,
    emit,
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(terminalStatusEvent(events)?.stopReasonCode, "wait_expired");
  assert.match(result.stopReason ?? "", /[Ww]ait budget/);
});

test("interactive: a multi-turn happy path — cumulative KPIs, no stray terminal until the user stops", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: () => successStream() });
  const controller = new AbortController();
  const { events, emit } = collect();

  const runPromise = runQlikAnswersInteractive(
    "run-multi-1",
    baseConfig({ fetchImpl, abortSignal: controller.signal }),
    turnsFrom(["follow-up one", "follow-up two"], controller.signal),
    emit,
  );

  // After the 2 queued follow-ups drain, the session sits in `waiting_input` for a 3rd turn that never
  // comes — give it a tick to process both turns, then stop the session (mirrors the `waiting_input`
  // test above; a queue-exhausted `InteractiveTurns` awaits its abort signal FOREVER, exactly like the
  // real run-service provider — see `turnsFrom`'s doc).
  await new Promise((r) => setTimeout(r, 30));
  controller.abort();
  const result = await runPromise;

  assert.equal(result.status, "aborted"); // the turns queue drains, then the fake provider awaits abort
  assert.equal(result.turns, 3, "opener + 2 follow-ups");
  const kpis = events.filter((e): e is Extract<RunEvent, { type: "kpi" }> => e.type === "kpi");
  assert.equal(kpis.length, 3);
  assert.equal(kpis[2]?.turns, 3);
  assert.ok((kpis[2]?.tokensIn ?? 0) > (kpis[0]?.tokensIn ?? 0), "tokensIn accumulates across turns");

  // WP1.7 (D-US1 follow-up) — each of the first 2 waits resolves NORMALLY (a queued follow-up, not the
  // abort that ends the 3rd/final wait), so each is followed by a `{type:"phase",phase:null}` clear:
  // the persisted phase never lingers at `waiting_input` once the run is genuinely processing the next
  // turn. The 3rd (never-answered) wait ends via `controller.abort()` instead — no clear there, since
  // the imminent `stopping` phase (asserted below) immediately supersedes it.
  const allPhases = phasesOf(events);
  const waitingIdx = allPhases.reduce<number[]>((acc, e, i) => {
    if (e.phase === "waiting_input") acc.push(i);
    return acc;
  }, []);
  assert.equal(waitingIdx.length, 3, "one waiting_input per nextTurnOrStop call (3 turns awaited)");
  assert.equal(allPhases[waitingIdx[0]! + 1]?.phase, null, "clear follows the 1st (resolved) wait");
  assert.equal(allPhases[waitingIdx[1]! + 1]?.phase, null, "clear follows the 2nd (resolved) wait");
  assert.equal(
    allPhases[waitingIdx[2]! + 1]?.phase,
    "stopping",
    "the 3rd (aborted) wait goes straight to `stopping` — no redundant null clear",
  );
});

test("interactive: AE-4 mid-turn → stopped/stopped_guardrail/prompt_rejected via the shared terminalFor table", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({
    calls,
    onStream: () =>
      jsonResponse({ errors: [{ code: "AE-4", title: "Prompt is rejected" }] }, { status: 400 }),
  });
  const { events, emit } = collect();

  const result = await runQlikAnswersInteractive(
    "run-ae4-int",
    baseConfig({ fetchImpl }),
    { nextTurn: () => new Promise(() => undefined) },
    emit,
  );

  assert.equal(result.status, "stopped");
  assert.equal(result.outcome, "stopped_guardrail");
  assert.equal(result.stopReason, "prompt_rejected");
  assert.equal(terminalStatusEvent(events)?.stopReasonCode, "prompt_rejected");
});

// ── Stop-verdict-before-signal ordering (execution plan §1) ────────────────────────────────────────

test("a `stopping` phase precedes the terminal `status` on every non-completed terminal", async () => {
  const calls: Call[] = [];
  const fetchImpl = stubFetch({ calls, onStream: neverSettlingStream() });
  const { events, emit } = collect();

  await runQlikAnswers("run-order-1", baseConfig({ fetchImpl, stallMs: 15 }), emit);

  const stoppingIdx = events.findIndex((e) => e.type === "phase" && e.phase === "stopping");
  const statusIdx = terminalIndex(events);
  assert.ok(stoppingIdx >= 0 && stoppingIdx < statusIdx, "stopping phase written before the terminal status");
});
