# WP 1.3 — MCP connection status surfacing (events, chips, retry)

**Phase:** 1 · **Size:** M · **Depends on:** 1.2 · **Model:** Sonnet · **Agent profile:** API + web

## Objective

Kill the silent grant drop: when a granted server fails to open at turn time, the user sees which
server, why, and can retry. The model's prompt names unreachable servers instead of pretending no
grants exist.

## Why / evidence

`analysis.md` RC3.4: `getHubMcpSession` failure ⇒ `log.warn` + drop; all dropped ⇒
`resolveHubMcpGrants` returns `null` ⇒ the prompt's "No MCP tools are granted in this session"
fallback (`apps/api/src/index.ts:379-385, 418-427`; `prompting/layers/tools.ts:37-40`). Nothing
surfaces in the UI; a single-server scoped session loses its whole tool surface invisibly.

## Design

- **Shared (additive):** new `HubEvent` member `mcp_server_status`
  `{ type, serverId, serverName, status: "connected" | "error", message?, at }` (+ zod). Emitted
  per granted server at toolset resolution when status CHANGES (not every turn — dedupe on last
  known status per session).
- **API:** `resolveHubMcpGrants` returns per-server outcomes alongside grants (internal type);
  the session service emits the status events into the session log. When ≥1 granted server dropped,
  `toolListText` gets a trailing line: `Unreachable this turn: <name> (<short reason>)` so the
  model states the truth. New `POST /api/hub/servers/:id/reconnect` that evicts the cached hub MCP
  session (next turn reopens).
- **Web:** rail Tools section shows a status chip per granted server (`connected` /
  `error` + tooltip reason) from the latest `mcp_server_status` events (they arrive over the
  existing SSE stream); an error chip offers **Retry** → reconnect endpoint. A turn that lost
  servers renders a compact inline notice in the transcript (reuse the existing banner pattern,
  e.g. `HubLimitErrorBanner` styling).

## Files (exclusive)

- `packages/shared/src/types.ts`, `schemas.ts` (additive event)
- `apps/api/src/index.ts` (`resolveHubMcpGrants` + `getHubMcpSession` outcome plumbing), `apps/api/src/hub/session-service.ts` (status emit — coordinate: WP 1.1 owns this file in Batch 1, so this WP runs in a later batch), `apps/api/src/hub/routes.ts` (reconnect route)
- `apps/web/src/features/hub/meta-rail/ContextSection.tsx` (chips), `use-hub-stream.ts` (event handling), `ConversationPane.tsx`? NO — the inline notice renders from the event via the existing event-to-timeline mapping in `use-hub-stream.ts`; do not touch `ConversationPane.tsx` (WP 3.1 owns it)
- Tests: grant-drop → event emitted + prompt line present; reconnect evicts; chip rendering

## Acceptance

- [ ] Failing server ⇒ `mcp_server_status: error` event persisted once (dedupe tested), prompt contains the `Unreachable this turn` line, and the remaining servers' tools still resolve.
- [ ] All-fail ⇒ no more silent `null`: events + prompt line still emitted; built-ins-only turn proceeds.
- [ ] Reconnect endpoint evicts the cache (unit test with a fake failing-then-working session).
- [ ] Rail chips render both states in both themes; retry wired.
- [ ] Additive shared diff; gate green.
