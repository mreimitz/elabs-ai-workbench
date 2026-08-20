---
type: "Work Package Spec"
title: "Interface Craft \u2014 upstream @elabs-ai/components- gaps"
description: "Four fixes in this plan land in code the repo vendors from @elabs-ai/components- (brand-ui 1.9.0). Per the"
tags: ["roadmap", "RM-15"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Interface Craft — upstream `@elabs-ai/components-*` gaps

Four fixes in this plan land in code the repo **vendors** from `@elabs-ai/components-*` (brand-ui 1.9.0). Per the
CLAUDE.md §9 rule and the owner's vendor-boundary decision (README "Vendor boundary"), this plan does
**not** bump the vendored version; it applies each fix **app-side** (reversible, app-owned) **and**
records the real upstream gap here so the app-side override can be **deleted** when brand-ui ships the
fix. File the upstream issues against `mreimitz/elabs-components` at the next bump.

Each entry: the gap · the app-side override this plan ships · the deletion trigger.

---

## 1. Failing on-fill token pairs (D-IC1) — `@elabs-ai/components-tokens`

- **Gap.** In `themes.css`, three `--<role>` ⇄ `--<role>-foreground` fill pairs fail WCAG AA 4.5:1 at
  the sizes they render (11–13px): `light` `--primary` 4.31, `--success` 4.31, `--info` 3.76;
  `dark` `--destructive` 3.02. Each theme was tuned independently with no shared on-fill check, so
  each fails a different pair. Dark already solved four of five (its `--primary-foreground` is a dark
  `#1c1a18`, not white) — `--destructive-foreground` simply never got the same treatment.
- **App-side override (WP 0.1).** A `@theme` override block in `apps/web/src/styles/app.css`: darken
  `--primary`/`--info` lightness in bright (keep C and H) until each pair clears 4.5; give
  `dark --destructive-foreground` the dark-foreground treatment. Guarded by
  `apps/web/src/styles/tokens-contrast.test.ts` (asserts all 5 role pairs × 2 themes).
- **Delete when.** brand-ui ships token values where every role⇄foreground pair clears 4.5:1 in both
  vendor themes and the app's test passes against the un-overridden tokens.

## 2. Byte-identical semantic tokens (D-IC2) — `@elabs-ai/components-tokens`

- **Gap.** `--primary === --success` and `--ring === --info`, byte-identical in **both** themes. A
  semantic token that equals another means a focus ring (`--ring`) renders at the same lightness/chroma
  as a "Running"/"Info" chip (`--info`), and an action (`--primary`) is indistinguishable from a
  success (`--success`) by color alone.
- **App-side override (WP 0.1).** Same `@theme` block gives `--success` a value distinct from
  `--primary` and `--ring` a value distinct from `--info`, in both themes. Asserted by
  `tokens-contrast.test.ts` (`--success !== --primary`, `--ring !== --info`).
- **Delete when.** brand-ui's tokens hold distinct values for these roles.

## 3. `CardTitle` has no `as`/`level` (D-IC5) — `@elabs-ai/components-ui`

- **Gap.** `CardTitle` renders `<div className="text-title leading-none">` (`vendor card.tsx:260-264`)
  — never a heading. A card that titles a real section therefore contributes no `h2`/`h3` to the
  document outline; live DOM on Runs/Servers/Dashboard returns one heading each (the `sr-only` h1).
- **App-side override (WP 1.1).** `apps/web/src/components/SectionCardTitle.tsx` — a thin wrapper that
  renders a real `h2`/`h3` (level via prop) carrying the `text-title` visual, used **only** where a
  card titles a genuine section. Decorative card titles keep `CardTitle`/`div`.
- **Delete when.** `@elabs-ai/components-ui` `CardTitle` accepts an `as`/`level` prop; replace the wrapper with the
  prop at call sites.

## 4. `SelectTrigger` clips its value with no recovery (D-IC10) — `@elabs-ai/components-ui`

- **Gap.** `SelectTrigger` ships `[&>span]:line-clamp-1` (`vendor select.tsx:22`) with no `title`, so
  **every** select in the app clips its value with no way to read the full text — including composed
  labels like `${server} · ${date} · ${n} tools`.
- **App-side override (WP 2.1).** A title-carrying `<Select>` trigger wrapper in
  `apps/web/src/components/` that sets `title={selectedLabel}` (and, where the value is user-authored,
  a `HoverCard` per the `AgentBriefPreview` pattern). Applied to the clipping selects.
- **Delete when.** `@elabs-ai/components-ui` `SelectTrigger` carries a `title` (or exposes the selected label for
  one) by default.

## 5. `CardDescription` has no measure cap (D-IC9) — `@elabs-ai/components-ui`

- **Gap.** `CardDescription` (`vendor card.tsx:273`) sets no `max-w`, so a description in a full-width
  card runs to the container edge (measured 190ch worst case). `max-w-prose` appears zero times
  app-wide; `PageShell` defaults to `width="full"`.
- **App-side override (WP 1.4).** A measure-capped `CardDescription` usage/wrapper
  (`max-w-[68ch]`) applied to the genuine-prose descriptions (Compatibility callout, assistant message
  body, rendered `SKILL.md`). Tables and dense rows stay full-width.
- **Delete when.** `@elabs-ai/components-ui` prose components (`CardDescription`, `AlertDescription`) cap their
  measure by default (or expose a `prose`/measure variant the app can use without a wrapper).

## 6. `CardDescription` silently drops `text-muted-foreground` (found during WP 1.4) — `@elabs-ai/components-ui`

- **Gap.** `@elabs-ai/components-ui`'s vendored `CardDescription` composes its classes such that a `tailwind-merge`
  interaction with `text-wrap-balance` **drops its own `text-muted-foreground`** — reproducible with
  zero wrapper/`className` involved (`cn("text-sm text-muted-foreground text-wrap-balance")` →
  `"text-sm text-wrap-balance"`). So a `CardDescription` renders at the default foreground, not muted.
  Found while writing `ProseCardDescription`'s test (WP 1.4). **Pre-existing, unrelated to this plan.**
- **App-side action:** none taken (out of WP 1.4's prose-cap scope); the `ProseCardDescription` test
  asserts on the classes that actually survive rather than a false regression. If the owner wants the
  muted tone restored app-side, a tiny wrapper could re-append it — but that is a **separate**
  decision, not part of interface-craft.
- **File upstream** so `@elabs-ai/components-ui` `CardDescription` keeps its muted foreground under the
  `text-wrap-balance` merge.

---

**Not an upstream gap — do not file:** the review's rejected candidates (raising `active:scale`,
icon-size normalization, concentric radius, `text-base sm:text-sm`, logical-property conversion). See
[`conventions.md`](./conventions.md) §6 for why each stays unreported.
