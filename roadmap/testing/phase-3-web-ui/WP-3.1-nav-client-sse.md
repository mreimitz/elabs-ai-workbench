# WP 3.1 — Navigation, API client, SSE plumbing

**Phase:** 3 · **Size:** M · **Depends on:** 2.2

## Objective
Wire the Testing view group into the app shell and add the streaming client so the UI can drive
and observe runs.

## Why / references
Web has no router and no streaming (`conventions.md` → Web). UI concept
[`../10-…ui-concept.md`](../../10-testing-ui-concept.md) §1 (nav placement). SSE protocol = WP 2.2;
`RunEvent` = WP 0.3.

## Files
- `apps/web/src/components/AppShell.tsx` *(modify — extend `ViewKey`, `NAV_ITEMS`, `VIEW_LABELS`)*
- `apps/web/src/App.tsx` *(modify — state + view wiring; a small sub-view switch within Testing)*
- `apps/web/src/lib/api.ts` *(modify — add SSE + run-control helpers)*

## Design — nav
Extend the union and nav arrays (currently `dashboard|servers|scans|compare|settings`):
```ts
export type ViewKey = "dashboard" | "servers" | "scans" | "compare" | "settings"
  | "scenarios" | "tests" | "runs";   // Testing group
```
Add `NAV_ITEMS` + `VIEW_LABELS` entries with lucide icons (e.g. `FlaskConical`, `ListChecks`,
`PlayCircle`). The **Run console** (WP 3.3) is opened from a Run/Test, not a permanent nav item.

## Design — client (api.ts)
Keep `apiGet/apiPost/...`. Add:
```ts
export function openRunStream(runId: string, on: (e: RunEvent) => void): () => void {
  const es = new EventSource(`/api/runs/${runId}/stream`);   // GET, EventSource-friendly
  es.onmessage = (m) => on(JSON.parse(m.data) as RunEvent);
  es.onerror = () => { /* surface + allow caller to retry */ };
  return () => es.close();
}
export const startRun = (b: RunStartRequest) => apiPost<RunStartResponse>("/api/runs", b);
export const sendTurn = (id: string, text: string) => apiPost(`/api/runs/${id}/turns`, { text });
export const stopRun  = (id: string) => apiPost(`/api/runs/${id}/stop`, {});
```
A small `useRunStream(runId)` hook accumulates events into console state (messages, steps, kpis,
status) and returns a cleanup.

## Acceptance
- New nav entries switch views; render in both themes (qlik-bright, qlik-dark).
- A dev harness starts a run and logs an ordered `RunEvent` stream; `EventSource` closes on unmount
  (no leak).
- Gate: typecheck + build green.

## Notes
- `EventSource` only does GET — that's why start/turn/stop are separate POSTs (matches WP 2.2).
- Don't introduce a router or a state library (owner-gated); follow the existing `activeView` pattern.
