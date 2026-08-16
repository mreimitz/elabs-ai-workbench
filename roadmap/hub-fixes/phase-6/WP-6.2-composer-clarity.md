# WP 6.2 — composer mode/autonomy clarity

**Phase:** 6 · **Size:** S · **Depends on:** 6.1 · **Model:** Sonnet · **Agent profile:** web

## Objective

The composer stops conflating two dials: the session MODE (chat / research / mission / auto) is
visible with its own affordance, and the autonomy chip is labeled as autonomy. The confusion that
produced the owner's "Auto" misreading disappears.

## Why / evidence

`analysis.md` RC7: the composer's "Auto" chip is `AutonomyModeSelect` (autonomy values
`always_ask`/`threshold`/`auto`), trivially misread as an automatic MODE. Mode itself is invisible
in the composer today.

## Design

- Composer meta row shows a mode chip (icon + label, e.g. `Auto mode` / `Mission`) next to the
  model chip; clicking it explains the mode and (for `auto`-capable accounts of this app: always)
  offers switching the SESSION mode where allowed (auto ↔ chat ↔ research; entering `mission`
  keeps the existing semantics). Mode switch = session PATCH (extend `hubSessionPatchSchema`
  additively with `mode`, mirroring WP 1.2's pattern; update the `ComposerCommands.tsx:60-64`
  comment that documented the omission).
- Autonomy chip gains the label prefix `Autonomy:` and a tooltip describing the three levels.
- Keep it small: no redesign; tokens + existing `@brand/ui` menu primitives.

## Files (exclusive)

- `apps/web/src/features/hub/Composer.tsx`, `AutonomyModeSelect.tsx`, `ComposerCommands.tsx` (+ tests)
- `packages/shared/src/schemas.ts` (patch mode, additive), `apps/api/src/hub/routes.ts` (PATCH accepts mode; guard: mission↔auto transitions only when no mission is running)

## Acceptance

- [ ] Mode chip reflects the session mode live; switching PATCHes and re-renders; running-mission guard tested.
- [ ] Autonomy chip labeled + tooltip; no functional autonomy change.
- [ ] a11y: both chips keyboard-operable with clear names; both themes.
- [ ] Gate green.
