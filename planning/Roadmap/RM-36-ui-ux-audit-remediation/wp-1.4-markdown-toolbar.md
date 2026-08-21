---
type: "Work Package Spec"
title: "WP 1.4 — markdown table toolbar: the D-TB5 violation, raised upstream"
description: "Phase 1 of item.md. Ledger: STATUS.md. Eleven icon-only controls in the rendered SKILL.md name themselves with a native title=, paint no focus ring, and measure under 24px — the app's only unringed focusables. They are upstream, so this WP raises the gap and records the exception rather than patching around it."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:43:00Z"
status: "final"
---
# WP 1.4 — markdown table toolbar: the D-TB5 violation, raised upstream

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).
Finding **P1-5** in [`audit-report.md`](./audit-report.md).

**Depends on:** nothing. **Owner-gated:** the outcome is an upstream request plus a recorded
exception, not a local component.

## The finding

On `/skills/:skillId` → Overview (the rendered `SKILL.md`), each rendered markdown table carries an
icon-only toolbar — *Copy table*, *Download table*, *View fullscreen*. Eleven such controls on that
one page, in both themes:

```html
<button class="cursor-pointer p-1 text-muted-foreground transition-all …" title="Copy table" type="button">
```

Three failures at once:

1. **The accessible name is a native `title`.** `.claude/rules/icon-affordances.md` (**D-TB5**) is
   explicit: *"Never use the native `title` attribute to explain an icon-only control … it is
   invisible to assistive technology."* There is no `aria-label`.
2. **No focus ring.** Computed on focus: `outline: 0px auto`, `box-shadow: none`. These were
   **11 of the 13** unringed focusables found on the entire route — and the only unringed controls
   the whole audit found anywhere.
3. **21×21 and 23×23**, sitting adjacent, so both the 24px minimum and the spacing exception fail.

## Why this is not a local fix

The markup is **not** in `apps/web/src` — a repo-wide grep for the class string returns nothing. It
is rendered by a `@elabs-ai/components-*` component. `.claude/rules/library-first.md` is clear that a
missing or wrong library behaviour is *"a real upstream gap, not a license to hand-roll"*, and
`brand-ui-only.md` puts local overrides of a component's behaviour behind owner sign-off.

The correct in-repo counterpart already exists and is right:
`apps/web/src/components/IconButton.tsx` derives the tooltip text **and** the `aria-label` from one
`label` prop, so the two cannot diverge and the tooltip cannot be forgotten.

## Scope

1. **Identify the exact component and package** that renders the toolbar — narrow it with
   `pnpm exec brand-ui search` / `docs` rather than guessing, and record the package and component
   name in this file.
2. **Raise it upstream** with the owner: the toolbar should take the `IconButton` treatment — one
   `label` prop feeding both the tooltip and `aria-label`, a token-driven
   `focus-visible:ring-2 ring-ring`, and a ≥24px target.
3. **Record the exception** in the ledger's Owner-acceptance section so the unringed controls are a
   known, owned gap rather than an unexplained audit failure.

**Do not** patch it locally with a global CSS override targeting the library's class names. That
would be a second styling system by the back door, and it would break silently on the next
`@elabs-ai/components-*` bump.

## Out of scope

Converting the app's remaining icon-only call sites to `IconButton`. `.claude/rules/icon-affordances.md`
says that conversion is a separate, later phase and that an unconverted site is not a violation of a
shipped conversion. This WP covers only the upstream toolbar.

## Acceptance

- [ ] The owning package and component are named in this spec, verified with the brand-ui CLI.
- [ ] The gap is raised with the owner, with the three measured failures and the `IconButton`
      precedent attached.
- [ ] The ledger's Owner-acceptance section records the exception, so a later audit reading
      "11 unringed focusables on `/skills/:skillId`" finds the decision instead of re-filing it.
- [ ] No local CSS override of library class names was added.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
