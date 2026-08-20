# WP 2.2 — One page-level toolbar, correct order, and Scans merged into Overview

Owner feedback 2026-08-20, items 1–3. **Depends on WP 2.1** (the four new tiles).

## Defect 1 — the toolbar/tab order is flipped (a written standard was broken)

`roadmap/ux-overhaul/toolbar-standard-2026-07-11.md` states the app's layout order:
**breadcrumb → ONE toolbar row → content**, and every other view follows it (see
`SkillInspector.tsx:538` — *"Toolbar standard (2026-07-11): breadcrumb → ONE ViewToolbar row →
content"*; the owner's own screenshot of the Skills page shows toolbar ABOVE the tab strip).

The Dashboard does the opposite: the **tab strip is at page level and each tab renders its own
toolbar band inside itself** (`TestingTab.tsx`'s `FilterControls` band and `OverviewTab.tsx`'s
Window control). That is the flip the owner is reporting.

**Fix:** hoist ONE `ViewToolbar` to page level in `DashboardView.tsx`, ABOVE the `TabPanel` strip,
and delete the per-tab toolbar bands.

## Defect 2 — the shared timeline must drive Testing and Issues too

> *"If we introduce a new toolbar with filter on timeline this need to work for Testing and issues
> as well."*

The page-level toolbar owns the **time range**, and all three tabs read it:
- **Overview** — replaces its own 24h/7d/30d control.
- **Testing** — replaces the `DateRangePicker` inside `FilterControls`. Testing's *other* facets
  (provider / server / environment / suite / model / group-by) stay in the tab; only the RANGE moves
  up. Do not regress the Testing dashboard's existing behaviour.
- **Issues** — the fleet-issues list must scope to the same range (it already filters on
  `lastSeenFrom`/`lastSeenTo`; wire those to the shared range).

Use the **richer** control as the shared one: Testing's `DateRangePicker` already offers 24h/7d/30d
presets **plus** a custom calendar range, so adopt that rather than Overview's preset-only toggle.

**URL contract:** one range param shared by all tabs. Reconcile the two existing schemes
(`overview-url-state.ts`'s `?oRange=` preset and `dashboard-url-state.ts`'s `?from=/?to=`) into one.
Keep deep links working: `?tab=testing` with an existing `from`/`to` must still resolve. Note the
existing deliberate difference — a **preset** means "trailing N as of now" and must NOT be frozen to
instants, while a **custom** range is pinned; preserve both meanings.

## Defect 3 — merge Scans into Overview

> *"Overview and scans can be merged … the two tables can be at the bottom end of the bento with
> full width grid size."*

- Compose WP 2.1's `InventoryTile`, `LargestToolTile`, then `FootprintTableTile` and
  `RecentScansTile` (full width) at the **bottom** of the bento.
- **Retire the Scans tab.** Tabs become **Overview · Testing · Issues**. `?tab=scans` must not
  404 or dead-end — redirect it to Overview (the same courtesy the app gives its other moved routes).
- `ScansTab.tsx`'s remaining unique content is its "Since your last visit" change summary. The
  Overview has no equivalent; decide deliberately whether to bring it across as a tile or drop it,
  and **justify the choice in your report** — do not let it vanish silently.
- Delete `ScansTab.tsx` (and its test) only once nothing imports them.

## Defect 4 — the bento spotlight

> *"the Bento shows a yellow shade around the cursor, we dont want that effect. elevation is good,
> the shadow not."*

Remove `spotlight` from the `BentoGrid` in `OverviewTab.tsx`. The cursor-following gradient is
`color-mix(in oklch, var(--primary) …)` — the brand lime — which is the yellow shade. Keep
`BentoGridItem`'s ordinary hover **elevation** (it lifts to a larger shadow natively); only the
coloured spotlight overlay goes. Assert in a test that no `[data-testid="bento-spotlight"]` overlay
renders.

## Files

`DashboardView.tsx`, `overview/OverviewTab.tsx`, `overview/overview-url-state.ts`,
`dashboard/TestingTab.tsx`, `dashboard/testing/FilterControls.tsx`,
`dashboard/testing/dashboard-url-state.ts`, `issues-fleet/IssuesFleetTab.tsx`, plus their tests;
delete `dashboard/ScansTab.tsx` + `ScansTab.test.tsx`.

## Acceptance
- [ ] ONE page-level `ViewToolbar` above the tab strip; no per-tab toolbar band remains.
- [ ] The range control drives Overview, Testing AND Issues; one shared URL param; presets stay
      relative, custom ranges stay pinned. Tested for all three tabs.
- [ ] Testing's non-range facets and behaviour are unchanged.
- [ ] Tabs are Overview · Testing · Issues; `?tab=scans` redirects to Overview; `?tab=testing`
      and `?tab=issues` still deep-link; the default stays out of the URL.
- [ ] The four WP 2.1 tiles are composed, with both tables full-width at the bottom.
- [ ] No spotlight overlay renders; hover elevation retained.
- [ ] The "Since your last visit" decision is implemented deliberately and justified.
- [ ] `assistant-route-operability` passes unchanged (or a reasoned manifest entry).
- [ ] No horizontal overflow at 375 / 768 / 1400 px; reads in both themes.
- [ ] Gate delta vs the 3 pre-existing `main` failures: zero.

## Defect 5 — two delta tones on one page (surfaced by WP 2.1)

WP 2.1's `InventoryTile` colours a worse delta with `deltaTextTone(delta, false)` — **amber** — which
is what `.claude/rules` and `lib/delta.ts` require: *"the ONE place a magnitude delta picks its
colour … worse → `text-warning-text` (amber) … `--destructive`/red is reserved for structural
REMOVAL"* (D-IC3, consolidating D-UX9). `StartupCostTile` and `PassRateTile` instead pass
`positiveIsGood` to `MetricCard`, whose dist hardcodes
`deltaColor = good ? "text-success-text" : "text-destructive-text"` — **red**.

Both now render on the SAME bento, so the split is no longer theoretical (it pre-dated this plan —
`KpiRail.tsx:211` ships it too — but never side by side).

**Fix:** unify the Overview on the app's own authority. `StartupCostTile` and `PassRateTile` stop
using `MetricCard`'s `delta`/`deltaDirection`/`positiveIsGood` colouring and render their delta
through `deltaTextTone` (mirroring `ScanDeltaCell`), so every delta on the page shares one tone
vocabulary: **amber = worse, green = better, muted = neutral**. Keep the accessible-label form
(`"up +250, unfavorable"`) and the `data-polarity` hook the existing tests assert, so nothing
regresses.

Do NOT "fix" this by making `InventoryTile` red — that would break the locked rule.

- [ ] Every delta on the Overview uses `deltaTextTone`; no tile relies on `MetricCard`'s internal
      delta colour. Tested: a growing footprint renders `text-warning-text`, never
      `text-destructive-text`.

## Defect 6 — the hover lift is clipped on the top row (owner, 2026-08-20)

> *"when i hover the top tiles of the bento and they elevate the top border is not visible anymore.
> assuming the bento grid needs a little bit more padding to the top"*

Confirmed against the vendored component. `bentoGridItemVariants` makes elevation the hover gesture:

```
"shadow-none hover:shadow-xl",
"hover:border-ring/40",
"hover:-translate-y-1 motion-reduce:hover:translate-y-0",
```

`-translate-y-1` is **4px of upward travel**, and `shadow-xl` spreads further still. The bento sits
directly against the top of its scroll container, so on the first row the lifted top border — and the
`hover:border-ring/40` edge that carries the lift in dark theme — is cut off.

**Fix:** give the bento's scroll content enough headroom to absorb the lift and its shadow — top
padding of at least `pt-2` (8px), and enough side/bottom room that a hovered edge tile is not clipped
either. Do NOT remove the travel or the shadow; the gesture is correct, only the container is tight.
The owner explicitly kept elevation ("elevation is good") — this is about clipping, not the effect.

- [ ] A hovered first-row tile shows its complete top border and shadow; no edge tile is clipped on
      hover at any of 375 / 768 / 1400 px.
