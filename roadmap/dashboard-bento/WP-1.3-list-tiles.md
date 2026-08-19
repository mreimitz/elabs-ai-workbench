# WP 1.3 — Attention, Movers and Advisor tiles

Build the Overview's list/text tiles against the committed contract
`apps/web/src/features/dashboard/overview/overview-contract.ts`. WP 1.1 (the hook) and WP 1.2 (chart
tiles) run in parallel — **consume the type only**, and drive tests from your own fixtures.

## Files (yours exclusively)

- `apps/web/src/features/dashboard/overview/tiles/AttentionTile.tsx`
- `apps/web/src/features/dashboard/overview/tiles/MoversTile.tsx`
- `apps/web/src/features/dashboard/overview/tiles/AdvisorTile.tsx`
- co-located `.test.tsx` for each

**Do NOT touch** `overview-contract.ts`, `use-overview-data.ts`/`overview-derive.ts` (WP 1.1), any
`tiles/Hero*`/`Startup*`/`PassRate*`/`SpendBy*`/`SurfaceMix*` (WP 1.2), `OverviewTab.tsx` or
`DashboardView.tsx` (WP 1.4), `ScansTab.tsx`, or anything under `features/dashboard/testing/`.

## What each tile is

| Tile | Bento size | Content |
| --- | --- | --- |
| `AttentionTile` | `sm` with `span={{ row: 2 }}` (1×2) | "Needs you" — failed scans, unscanned servers, regressed/open issues, each a row with an inline action. Count badge in the header. |
| `MoversTile` | `md` (2×1) | Biggest footprint movers, each with a Δ and one-click Diff / Open. |
| `AdvisorTile` | `span={{ col: 4 }}` (full width) | The single top evidenced recommendation + "See all recommendations". |

Each tile renders its own `<BentoGridItem>` (from `@elabs-ai/components-ui`) with the size above, so
WP 1.4 only composes them. Read `BentoGridItem`'s props from the package `.d.ts` — do not guess.

## Reuse, do not rewrite

`ScansTab.tsx` already renders an attention queue and a biggest-movers list with the exact
behaviour we want (inline "Scan now", `StatusBadge`, `ScanDeltaCell`, `diffVsPreviousHref`).
**Extract or mirror that presentation** rather than authoring a second, subtly different one — but do
**not edit `ScansTab.tsx`** (it is not yours this WP; if shared code is genuinely warranted, put the
new shared piece in `overview/tiles/` and say so in your report).

Delta tone: `ScanDeltaCell`/`deltaTextTone` (`apps/web/src/lib/delta.ts`) is this app's ONE
magnitude-delta colour authority — amber for worse, red reserved for structural removal (D-IC3).
Use it for movers rather than re-mapping a sign to a colour inline.

## Hard requirements

1. **A tile whose section is empty renders `null`** — it removes itself. Never an empty box.
   `AttentionTile` is the one exception worth considering: "nothing needs you" is genuinely useful
   information. Decide, implement it deliberately, and justify the choice in your report.
2. **Every row is keyboard reachable with a visible focus ring**, and every icon-only control uses
   `IconButton` (its tooltip == its `aria-label`; never a native `title`) — see
   `.claude/rules/icon-affordances.md`.
3. **Severity is never colour alone** — `AdvisorTile` must state severity in text too.
4. **No fabricated figures.** `savingsLabel` is `null` when the advisor gave none; render nothing
   rather than "0 tokens saved".
5. Long names truncate (`min-w-0` on flex children) — the movers list takes real server names.

## Acceptance
- [ ] Three tiles, each rendering its own `BentoGridItem` at the size above.
- [ ] Empty-section behaviour implemented and tested per tile, with the `AttentionTile` decision justified.
- [ ] Attention rows carry working inline actions and real hrefs from the contract.
- [ ] Movers deltas use the app's shared delta tone, not an inline colour mapping.
- [ ] Advisor severity is conveyed in text, not colour alone.
- [ ] Keyboard reachable, visible focus, `IconButton` for icon-only controls.
- [ ] Both-theme safe: semantic tokens only, `className` layout-only, no raw colour.
- [ ] Gate green except the 2 pre-existing api failures noted below.
