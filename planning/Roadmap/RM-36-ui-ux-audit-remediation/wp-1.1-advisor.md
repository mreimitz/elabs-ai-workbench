---
type: "Work Package Spec"
title: "WP 1.1 — /advisor: recommendation body readability + evidence-chip target size"
description: "Phase 1 of item.md. Ledger: STATUS.md. Moves the 139-name tool list out of the recommendation's prose into a disclosure, and fixes the 55 WCAG 2.2 2.5.8 target-size failures on the evidence chips — the only route in the app that fails 2.5.8."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:40:00Z"
status: "final"
---
# WP 1.1 — `/advisor`: recommendation body readability + evidence-chip target size

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).
Findings **P1-1** and **P1-2** in [`audit-report.md`](./audit-report.md).

**Depends on:** nothing. **Touches:** `apps/web/src/features/advisor/RecommendationCard.tsx` only.

## The finding

Two defects on one component, both measured on the running app at 1440×900 in both themes.

**P1-1 — the conclusion is buried under its own evidence.** The top recommendation renders
*"Trim 139 never-called tools from qlik-stage … saving ≈ 136,502 tokens/turn"*, and then inlines all
139 tool names as comma-separated prose inside the card body — **twenty rendered lines**. The first
card alone fills the viewport, so an operator sees **1 of 16 recommendations** without scrolling, and
must read ~350 words of `qlik_*` identifiers to reach the "Estimated saving" panel below it.

**P1-2 — 55 WCAG 2.2 2.5.8 target-size failures.** `/advisor` is the **only** route in the app that
fails 2.5.8 once the inline and spacing exceptions are honestly granted. Each evidence link measures
**16px tall**, and the list packs them with a **4px** vertical gap, so the 24px-undisturbed-circle
exception cannot rescue them either.

The cause is exact — `EvidenceLink` renders:

```tsx
<Button asChild variant="link" size="sm" className="h-auto max-w-full gap-1 p-0">
```

`h-auto p-0` strips the button's own height and padding, collapsing the target to its line box. The
enclosing list is `className="flex flex-wrap items-center gap-x-3 gap-y-1"`.

## Scope

### `RecommendationCard.tsx` — the body

Keep the recommendation sentence, the counts and the token figure in the body. Move the enumerated
tool names out of the paragraph into a collapsed disclosure:

- Use `@elabs-ai/components-ui` `Collapsible` (or `Accordion`) — confirm the real prop names with
  `pnpm exec brand-ui docs Collapsible` before writing, per `.claude/rules/dependencies.md`.
- Render the names as wrapped `Badge variant="secondary"` chips **or** a `max-h-*
  overflow-y-auto` block. Not prose.
- The trigger states the count — e.g. "Show 139 never-called tools" — so the collapsed state still
  carries the fact.
- The card already has a correct precedent immediately below: the **ASSUMPTIONS** list. Match it.

### `EvidenceLink` + its list — the target size

Raise the effective target to **≥ 24px** in both dimensions:

- Drop `h-auto p-0` so the `size="sm"` height stands, **or** keep `h-auto` and add vertical padding.
- Raise the list to `gap-y-2` so adjacent rows are no longer 4px apart.

Layout utilities only. No token change, no variant change, no new component.

## Out of scope

The advisor's rules, its API, its evidence resolution, the "Estimated saving" panel's content, and
anything under `apps/api/`. This WP is presentation only.

## Acceptance

- [ ] The 139 tool names no longer render as prose in the card body; the recommendation's sentence
      and its token figure are visible without expanding anything.
- [ ] At 1440×900, `/advisor` shows **more than one** recommendation card in the first viewport.
- [ ] A re-run of the audit's target-size probe over `/advisor` — element rect extended by its
      `<label>`, inline and spacing exceptions granted — reports **0** failures, down from 55.
- [ ] The disclosure is keyboard-operable and shows a visible focus ring in both themes.
- [ ] `/advisor` reads correctly in **both** themes, verified by looking at the running app.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
