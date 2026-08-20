---
type: "Work Package Spec"
title: "WP 2.1 — Servers: overview route, de-railed detail, breadcrumb switcher, ServerRail deleted"
description: "Phase 2 of the overview-detail plan. /servers becomes a grouped overview through the EntityBrowser kit; /servers/:serverId becomes a full-width detail whose breadcrumb leaf switches servers; the 288px rail is deleted."
tags: ["roadmap", "RM-32"]
timestamp: "2026-08-20T19:50:00Z"
status: "final"
---
# WP 2.1 — Servers

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Concept: [`concept.md`](./concept.md)
(D-OD1–D-OD8). **Depends on WP 1.1 + WP 1.2.**

## What this WP is

`/servers` stops redirecting to the first server and renders a **grouped overview** (card grid ⇄
table) through the `EntityBrowser` kit. `/servers/:serverId` keeps today's `ServersView` detail but
loses the 288px rail and gains a **breadcrumb-leaf server switcher**. `ServerRail` is deleted, and
every behaviour it carried is ported.

## Files

| File | Change |
| --- | --- |
| `apps/web/src/features/servers/ServersOverview.tsx` | **new** — the overview page |
| `apps/web/src/features/servers/ServersOverview.test.tsx` | **new** |
| `apps/web/src/features/servers/ServerBreadcrumbSwitcher.tsx` | **new** — thin adapter over `BreadcrumbEntitySwitcher` |
| `apps/web/src/features/servers/server-groups.ts` | **new** — the `EntityGroupBy<ServerConfig>` for server types (+ its test) |
| `apps/web/src/features/servers/ServersView.tsx` | edit — mount the breadcrumb switcher; correct the rail-sibling comment |
| `apps/web/src/App.tsx` | edit — route split, delete the redirect effect + the rail branch |
| `apps/web/src/features/servers/ServerRail.tsx` | **delete** |
| `apps/web/src/features/servers/ServerRail.test.tsx` | **delete** (behaviours ported, see below) |

## The overview (`ServersOverview.tsx`)

Owns its own `PageShell` (`width="full"`, `headerVariant="toolbar"`) with **one** `ViewToolbar` row
(D-TB2), rendering `EntityBrowser` in the body.

- **Toolbar left**: the `SearchInput` + the type-filter `Select` (ported verbatim from `ServerRail`,
  including the `effectiveFilter` guard that keeps the selection valid when a type stops being in
  use) + the group-by picker when more than one grouping exists.
- **Toolbar results**: `<ResultCount>` — "N of M" when filtered, else "M servers".
- **Toolbar actions**: `ViewModeToggle`, "Manage types" (`Tags` `IconButton`), "Add MCP server"
  (primary). **Never** an assistant hook (D-TB3).
- **Body**: `EntityBrowser` grouped by server type via `server-groups.ts` — in-use types first (API
  order), `Untyped` last, empty groups dropped.
- **Body head**: an `sr-only` `<h1>Servers</h1>` (the breadcrumb names the page, D-TB1).

### The server card

Composed with `EntityCard`, carrying only measured data:

- Title = the server name, a real `<Link to={/servers/:id}>` (D-OD7).
- The server-type `Badge` + `ServerTypeStatusBadge` (reuse `ServerTypeStatusBadge.tsx`).
- Health: the dot + `StatusBadge` from `serverHealth` — **port `HEALTH_DOT_CLASS` and the
  `serverHealth` derivation out of `ServerRail.tsx` into `server-groups.ts`** (or a sibling
  `server-health.ts`) so nothing is lost when the rail file goes. Keep the rule that the dot is
  `aria-label`led only when it is the sole cue.
- Startup tokens (`tabular-nums`), `—` for a never-scanned or failed server — never a misleading `0`.
- Tool count and last-scan relative time when a successful scan exists.
- The posture band chip via `PostureScore`, fed by the **one** fleet request
  `getSecurityFleetSummary()` hoisted to the overview (D-SP22 — one request for the fleet, never one
  per card). A server with no successful scan is legitimately absent from that answer: render nothing
  where a health chip already explains why, else the muted em dash — the exact `PostureCell` rule.
- Endpoint: `stdio` command or the URL, mono, truncating, with the `title` truncation carve-out.
- Actions: a "Scan <name>" `IconButton` (disabled + `disabledReason` while busy) and a ⋯
  `DropdownMenu` (Edit · Test connection · Delete, destructive styling on Delete).

### The server table columns

Reuse `col`/`navCol`/`actionsCol` from `apps/web/src/lib/table.tsx`: Name (nav) · Type · Health ·
Tokens (numeric) · Tools (numeric) · Posture · Transport · Auth · Endpoint · Last scan · actions.

## The detail (`ServersView.tsx`)

- Keep the tabs, the `PageShell width="master-detail" scroll="fill"` mount and the toolbar as they
  are. **Correct** the comment block that claims the rail is a sibling `secondaryContent` structure —
  it is no longer true.
- Mount the switcher: build a memoized `<ServerBreadcrumbSwitcher …/>` and pass it to
  `useSetBreadcrumbSlot` (memoize per `breadcrumb-slot.tsx`'s contract or the effect re-fires every
  render). Groups = the same `server-groups.ts` grouping; `triggerBadge` = the server's health chip;
  `onSelect` navigates to `/servers/:id`; `onCreate` opens the add-server wizard; `onViewAll`
  navigates to `/servers`.
- `ServersView` needs `servers: ServerConfig[]` and `onAddServer` to feed the switcher — both already
  exist in `App.tsx`'s `serversRouteProps()`; add `servers` to that prop set.
- With the switcher contributing the leaf, `App.tsx`'s static server crumb must **stop** rendering the
  server name (the slot becomes the leaf; `AppShell` already appends it after the static crumbs and
  re-separates the last static crumb). Reduce the server-detail breadcrumb to
  `[{ label: "MCP Servers", to: "/servers" }]`.

## `App.tsx` edits

1. `/servers` → `<ServersOverview …/>`; `/servers/:serverId` → `<ServersRoute {...serversRouteProps()} />`.
   `ServersRoute` no longer needs to serve the bare path.
2. **Delete** the "redirect to the first server" effect (D-OD1) and the now-unused `sortedServers`
   dependency if nothing else uses it.
3. **Delete** the `isServersSection` branch of `secondaryContent`. Leave `secondaryTitle` /
   `secondaryContent` themselves alone — WP 3.1 removes the prop once Skills is also converted.
4. Adjust the server-detail breadcrumb as described above.

## Behaviours ported out of `ServerRail.test.tsx` (do not drop these)

The rail's test file is deleted; these assertions move into `ServersOverview.test.tsx` (or
`server-groups.test.ts` where they are pure):

- Grouping by type with `Untyped` last; empty groups dropped after search/filter.
- The type filter derives its options from the **full** fleet, not the search subset.
- A filter whose type stops being in use falls back to "All types" rather than showing nothing.
- A dangling `typeId` (its type deleted) resolves as untyped and never crashes.
- Health states: never-scanned (dashed, `Not scanned`), running (`Scanning…`, no chip), failed
  (`Scan failed`), failed + `authRequired` (`Auth expired`), success (`Healthy`, no chip, token total
  shown).
- A never/failed-scanned server shows `—`, never `0` tokens.
- Posture: one fleet request for the whole grid; an absent posture renders nothing when a health chip
  is shown, else the em dash.
- The zero-fleet `EmptyState` offers "Add server"; "Manage types" is reachable at zero fleet.

## Acceptance

- `/servers` renders the overview on a cold load with **no** redirect to a server.
- Grid and table show the same groups in the same order; the mode persists; `?view=` wins.
- Search + type filter narrow both modes; emptied groups vanish; zero-match offers Clear.
- A card and a table row both open `/servers/:id`; the title link works with middle-click.
- The detail page has **no left rail** and spans the window; its breadcrumb leaf is the switcher;
  picking another server navigates; "View all →" and the "MCP Servers" crumb return to the overview.
- `ServerRail.tsx` and its test are gone; `rg "ServerRail"` returns nothing.
- `pnpm typecheck && pnpm test && pnpm build && pnpm lint` all green.
- No API, wire, schema or dependency change.
