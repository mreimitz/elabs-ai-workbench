---
type: "Work Package Spec"
title: "WP 6.1 (AM-OB1) — the runs feed's saved-view and table state joins its filter in the URL"
description: "The RunFilter already round-trips through ?filter=; this closes the residual — saved-view identity, column set, sort and grouping — so a saved view is a shareable named URL."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.1 (AM-OB1) — the runs feed's saved-view and table state joins its filter in the URL

## Verification finding

**The filter half of this item shipped with WP 2.3 and is complete. The view half did not ship at all.**

Already built — and built well:

- **One canonical param carries the entire filter object.**
  `apps/web/src/features/testing/runs/run-filter-url.ts:17` declares `const FILTER_PARAM = "filter"`;
  `parseFilterFromSearchParams` (`:22`) falls back to `{}` on malformed input rather than throwing, and
  `writeFilterToSearchParams` (`:47`) deletes the param for an empty filter and copies every other param
  through untouched.
- **The URL is the sole source of truth for the filter.**
  `apps/web/src/features/testing/RunsView.tsx:240` derives `filter` from `parseFilterFromSearchParams(searchParams)`;
  `setFilter` (`:241-246`) writes back through `setSearchParams(…, { replace: true })`. There is no
  shadow `useState` copy, and no `localStorage` anywhere under `apps/web/src/features/testing/`.
- **All 33 `RunFilter` fields round-trip**, because the whole object is serialized as one key-sorted,
  byte-stable JSON blob by the shared codec (`packages/shared/src/run-filter.ts:57` `serializeRunFilter`,
  `:65` `parseRunFilter`). The schema is `runFilterSchema` (`packages/shared/src/schemas.ts:1026-1063`,
  `.strict()`). Seven fields have no UI control today (`seen`, `providerKind`, `suiteRunId`, `testId`,
  `collectionId`, `tokensGte`, `tokensLte`) but are still carried and preserved across edits, because
  every setter spreads `...filter`.
- **Byte-stability is test-pinned** (`apps/web/src/features/testing/runs/run-filter-url.test.ts:63`,
  and `:84` for the dashboard drill-down hydrating the bar exactly).

Not built:

- **The saved-view selection is not in the URL.** `activeViewId` is
  `useState<string | null>(null)` (`RunsView.tsx:255`), written only inside `applyView`
  (`:568-580`) and read only as the picker's `activeId` prop (`:766-772`). There is **no `?view=` /
  `?viewId=` param** anywhere in `apps/web/src/features/testing/`. Applying a view pushes its filter
  into `?filter=` (`:570`), so the resulting link is shareable **as an anonymous filter** — it loses the
  view's identity, its `columns` and its `sort`.
- **No server route resolves a view by name.** `apps/api/src/observability/views.ts:25-32` exposes
  `list()` and `get(id)`; names are unique (`assertNameFree`, `:35`/`:64`) but there is no
  lookup-by-name route. The web client (`apps/web/src/lib/api.ts:525-533`) never fetches a single view,
  so even an id in the URL has no consumer today.
- **Four presentation controls are React state only** (`RunsView.tsx`): `typeFacet` (`:247`),
  `groupBy` (`:248`), `sortKey`/`sortDir` (`:249-250`), `columnsPreference` (`:256`). Sharing a link to
  "failures, grouped by model, sorted by cost, with the session column set" is impossible.
- **Client-side presets are unaddressable too** (`run-filter-url.ts:81-92`, ids `preset:all` …
  `preset:pinned`).
- **A latent defect sits in the same code.** `RunSavedViews.tsx:45-47` documents `activeId` as `null`
  once the bar has drifted from any named view, but `setActiveViewId` is called **only** in `applyView`
  (`RunsView.tsx:577`). Hand-editing a filter after applying a view leaves the picker still claiming
  that view is active — and "Update view" then silently retargets it. This WP touches exactly that code
  and should fix it.

**Verdict: PARTIALLY BUILT — residual only.**

Residual: the saved-view identity and the four presentation controls (`typeFacet`, `groupBy`, sort,
columns) in the URL, a route or client path that resolves a view id on cold load, and the `activeViewId`
drift defect. **Do not touch the `?filter=` mechanism** — it is correct, tested and shared with the
dashboard drill-down.

## Goal

Today an operator can share "these runs" but not "my Failures view, grouped by model, sorted by cost,
with the session columns" — pasting that URL gives the receiver the right rows in the wrong shape, and
the saved view they were actually looking at is nowhere in the link. Afterwards a saved view is a real
named URL: opening it cold restores the view's filter, columns, sort and grouping, the picker shows
that view as active, and editing the filter honestly de-selects it.

## Scope

- **`apps/web/src/features/testing/runs/run-filter-url.ts`** — add the presentation params beside the
  existing `filter` key, following the module's established pure/React-free style: `view` (a `run_views`
  row id or a `preset:` id), `cols`, `sort`, `group`, `type`. Each parses defensively (unknown value →
  the current default, never a throw) and each is **omitted when it equals the default**, so
  `/testing/runs` stays the clean canonical link. Add a parse/serialize round-trip test beside the
  existing one.
- **`apps/web/src/features/testing/RunsView.tsx`** — move `activeViewId`, `columnsPreference`,
  `sortKey`/`sortDir`, `groupBy` and `typeFacet` off `useState` and onto the same `useSearchParams`
  read the filter already uses. On cold load with `?view=<id>`, resolve the view (see below) and apply
  its filter/columns/sort; `?filter=` present alongside `?view=` **wins** for the filter (an explicit
  filter in the URL is the more specific instruction) and de-selects the view, which is exactly the
  drift semantics `RunSavedViews.tsx:45-47` already documents.
- **Fix the drift defect**: any filter edit that leaves the applied view's filter must clear
  `activeViewId` (and therefore the `?view=` param), so "Update view" can never silently retarget a
  view the operator is no longer looking at.
- **View resolution on cold load** — `GET /api/run-views` already returns the full list
  (`apps/api/src/observability/routes.ts:95`), and the feed already loads it for the picker. Resolve
  `?view=<id>` against that list client-side. **Do not add a lookup-by-name route** and do not put a
  view *name* in the URL: names are mutable, ids are not, and a renamed view must not break a link
  someone pasted last month. The "named URL" the amendment asks for is a URL that *names a view by its
  stable id*, presented to the operator as a copyable link from the picker.
- **A copy-link affordance** in the saved-views picker (`RunSavedViews.tsx`) so the shareable URL is
  discoverable rather than something the operator must construct by hand.

## Files

Add:

- (none — every change lands in existing files; the new tests are additions inside the existing
  co-located suites)

Modify:

- `apps/web/src/features/testing/runs/run-filter-url.ts`
- `apps/web/src/features/testing/runs/run-filter-url.test.ts`
- `apps/web/src/features/testing/RunsView.tsx` — ⚠ **contended**: AM-OB5 adds the pulse strip to this
  same component. Do not batch WP 6.1 with WP 6.5.
- `apps/web/src/features/testing/RunsView.test.tsx` (and any sibling feed test that asserts default state)
- `apps/web/src/features/testing/runs/RunSavedViews.tsx`
- `apps/web/src/features/testing/runs/run-columns.ts` (only if the column-set id needs a stable URL token)

Untouched on purpose: `packages/shared/**` (no wire change — the view id is already on the wire as
`RunView.id`), all of `apps/api/**`, `apps/api/src/db/**`.

## Non-goals

- **No change to `?filter=` or to `serializeRunFilter`/`parseRunFilter`.** That contract is shared with
  the dashboard drill-down (`dashboard-url-state.ts:250` `drillDownHref`) and is byte-pinned by test;
  breaking it breaks every panel's click-through.
- No new `RunFilter` field, and no promotion of a presentation control into the filter grammar — a
  column set is not a filter.
- No lookup-by-name route, and no view **name** in the URL (see Scope for why).
- No new saved-view server capability (no sharing, no ownership, no publish) — this is single-owner
  local software.
- Not the dashboard's URL state; that is AM-OB3.

## Dependencies

- Depends on shipped WP 1.4 (saved views CRUD), WP 2.3 (runs feed upgrade, which built `?filter=`) and
  WP 2.4 (the sessions column set) — all done.
- No dependency on any other Phase 6 item.
- ⚠ **Conflicts with AM-OB5** on `RunsView.tsx`. These two are the only Phase 6 items that both write
  that file.

## Migration

**None.** Web-only. `apps/api/src/db/{database,schema}.ts` must be a zero-line diff, and no
`user_version` is claimed.

## Acceptance

1. Applying a saved view produces a URL containing `?view=<id>`; opening that URL in a fresh tab
   restores the same filter, column set, sort and grouping, and the picker shows that view as active.
2. Changing sort, grouping, the type facet or the column set changes the URL, and reloading restores
   the changed state. A default-valued control writes **no** param, so `/testing/runs` with no query is
   byte-identical to today's default feed.
3. Editing the filter while a view is applied clears `?view=` and de-selects the view in the picker;
   "Update view" is then unavailable or targets nothing — the drift defect at `RunsView.tsx:577` is
   gone, pinned by a test that fails against today's code.
4. `?view=` naming a deleted or unknown id, and any malformed presentation param, degrade to the
   default without throwing and without clearing the filter (mirroring `parseFilterFromSearchParams`).
5. `?filter=` and `?view=` present together: the explicit filter wins and the view reads as
   de-selected.
6. The existing `?filter=` round-trip tests (`run-filter-url.test.ts:63`, `:84`) still pass unchanged,
   and a dashboard drill-down link still hydrates the bar byte-for-byte.
7. The other params already living on this route (`?feed=suites`, `?launch=1`) survive every new write.
8. A copy-link action in the picker yields a URL that satisfies criterion 1.
9. Both themes and a keyboard-only pass over the picker and its copy-link affordance — or recorded as
   an owner-acceptance line rather than claimed.
10. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
