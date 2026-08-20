---
type: "Work Package Spec"
title: "WP 2.2 \u2014 SSE streaming + run control"
description: "Phase: 2 \u00b7 Size: L \u00b7 Depends on: 1.3, 1.6, 2.1"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.2 — SSE streaming + run control

**Phase:** 2 · **Size:** L · **Depends on:** 1.3, 1.6, 2.1

## Objective
Expose the live run over the wire: start a run, stream its `RunEvent`s to the browser, accept
interactive turns, and stop. Scope open-Q #1 → **SSE** (server→client) + POST for control.

## Why / references
[`../references.md`](../references.md) → *Fastify SSE via `reply.raw`* (implement on the raw response,
no new dependency). `RunEvent` union from WP 0.3; the per-run `EventEmitter` from WP 1.3
(`run-manager`). UI consumes this in WP 3.1.

## Files
- `apps/api/src/testing/routes.ts` *(modify/extend — run endpoints)*

## Routes
```
POST     /api/runs                 # {testId,scenarioId,mode} -> {runId,streamUrl}; starts the loop async
GET(SSE) /api/runs/:id/stream      # text/event-stream of RunEvent
POST     /api/runs/:id/turns       # {text} interactive turn -> resumes the loop
POST     /api/runs/:id/stop        # abort -> outcome: "aborted"
GET      /api/runs                 # RunSummary[] (history)
GET      /api/runs/:id             # RunDetail (replay)
GET      /api/runs/compare?ids=…   # CompareRow[] for one test across scenarios (WP 3.8)
```

## Design — SSE on `reply.raw`
```ts
server.get("/api/runs/:id/stream", async (req, reply) => {
  const emitter = runManager.get(req.params.id);     // 404 if unknown
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const write = (e: RunEvent) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
  // replay any buffered events first (so a late subscriber isn't out of sync), then live:
  bufferedEvents(req.params.id).forEach(write);
  const onEvent = (e: RunEvent) => write(e);
  emitter.on("event", onEvent);
  const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 15000);
  req.raw.on("close", () => { clearInterval(heartbeat); emitter.off("event", onEvent); });
});
```
- `POST /api/runs` validates with `runStartSchema`, creates the run (WP 1.6 writes the row), kicks off
  the engine **without awaiting completion**, and returns `{ runId, streamUrl }`.
- Keep a small bounded **event buffer** per active run so a subscriber that connects a beat late still
  receives the opening events in order.
- **Interactive** turn: `POST /turns` appends a user message and resumes the loop; reject if the run
  isn't in an interactive, awaiting-input state.
- **Stop**: signal the engine to abort; close sessions; emit terminal `outcome:"aborted"`.

## Implementation steps
1. Run lifecycle in `run-manager` (states: pending→running→awaiting_input?→terminal).
2. SSE handler + heartbeat + cleanup on client disconnect.
3. Control routes (start/turns/stop) + history/detail/compare reads (delegate to WP 1.6 repo).

## Acceptance
- Integration test: start a run, subscribe, receive an **ordered** `RunEvent` stream ending in a
  terminal `status`; assert `kpi` + `step` events arrive.
- `stop` aborts a live run and the stream ends with `outcome:"aborted"`.
- Interactive: posting a turn resumes the loop and produces further events.
- No event loss for a subscriber that connects slightly after start (buffer works).
- Gate green.

## Notes
- This is the app's first streaming surface; keep all SSE specifics in this route file. Backpressure:
  bound the buffer, drop `: ping` heartbeats are cheap; a slow client that disconnects must tear down
  cleanly (no leaked emitters/sessions).
