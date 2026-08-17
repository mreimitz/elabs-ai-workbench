# Phase 0 — Independent structural fixes · Batch G (4 parallel)

Four WPs with **disjoint domains** that depend on nothing and unblock the rest of the plan. Enter now
(toolbar-reach is already merged to `main`; these domains are free). Read
[`conventions.md`](./conventions.md) first — **§2 (measurement) and §5 (known drift) are load-bearing
here.** Each Acceptance item is a **number** produced against the running app in **both** themes.

---

## WP 0.1 — Token contrast + semantic split + root type rendering

- **Findings covered:** 1 (HIGH — on-fill contrast), 11 (the token half — identical `--success`/
  `--primary` and `--ring`/`--info`), 15 (LOW — font smoothing).
- **Domain (contract):**
  - `apps/web/src/styles/app.css` — a per-theme token **override** block (append **after** the
    `@import "@elabs-ai/components-tokens/styles.css"`; `[data-theme="light"]` / `[data-theme="dark"]`
    blocks and/or a `@theme` block — whatever wins the cascade in both themes) **+** `antialiased` root
    rendering (finding 15).
  - `apps/web/index.html` — `<body>` may take `class="antialiased"` (either here **or** the `app.css`
    body rule; pick one, not both).
  - `apps/web/src/styles/tokens-contrast.test.ts` — **new** (the deliverable, not a nice-to-have).
- **Depends:** — · **Size:** L · **parallel** · **Batch G** · **Model:** opus · high.
- **Do NOT** edit the vendored `themes.css`; the override is app-side and reversible (record it in
  [`upstream-gaps.md`](./upstream-gaps.md) items 1–2 — already recorded, do not duplicate).

**The work.**
- **Contrast (finding 1).** Fix the four failing on-fill pairs. **Adjust `L` first, preserve `C` and
  `H`, then re-measure — do not eyeball.**
  - `light`: `--primary` `#008947` (4.31) and `--info` `#2d86c8` (3.76) render against a near-white
    `#fafafa` foreground → **darken their `L`** (keep C, H) until each pair clears **4.5:1**.
  - `dark`: `--destructive` `#ef5f89` / `#fafafa` = 3.02. Dark already solves four of five by using a
    **dark foreground** (`--primary-foreground` is `#1c1a18` there) — give `--destructive-foreground`
    the **same** dark treatment.
- **Semantic split (finding 11 — tokens; D-IC2).** In the same override block, give `--success` a value
  **distinct** from `--primary`, and `--ring` a value distinct from `--info`, in **both** themes. (They
  are byte-identical today.) Keep `--success` a green that reads as success and clears its own on-fill
  pair; keep `--ring` a focus color distinct from `--info`.
- **Root type (finding 15).** Apply `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing:
  grayscale;` at the root (via `antialiased` on `<body>` or the `app.css` body rule). One line.

**Acceptance (numbers, both themes):**
1. Measured (oklch→sRGB + WCAG ratio) on the running app: **bright** `--primary`⇄`-foreground` ≥ 4.5,
   `--info`⇄`-foreground` ≥ 4.5, `--success`⇄`-foreground` ≥ 4.5; **dark** `--destructive`⇄`-foreground`
   ≥ 4.5. Report each ratio.
2. **No regression:** the pairs passing today still pass — bright `--destructive` (was 5.20), `--warning`
   (6.59); dark `--primary`/`--success` (8.24), `--warning` (8.40), `--info` (6.58). Report each.
3. `getComputedStyle(document.documentElement)`: `--success !== --primary` **and** `--ring !== --info`
   in **both** themes.
4. `getComputedStyle(document.body).webkitFontSmoothing === "antialiased"`.
5. `tokens-contrast.test.ts` asserts (in-code, from the resolved token values) **all 5 role⇄foreground
   pairs × 2 themes ≥ 4.5** **and** the two identity splits — and it **fails on the pre-fix tokens**
   (demonstrate the red, then the green). It runs in `pnpm test` (the gate).
6. Both themes render correctly by eye as a sanity check — but the numbers above are the pass.

---

## WP 0.2 — FieldRow error association

- **Findings covered:** 4 (HIGH — field errors not programmatically associated).
- **Domain (contract):** `apps/web/src/components/FieldRow.tsx` **+** `apps/web/src/components/FieldRow.test.tsx` (**new**).
- **Depends:** — · **Size:** S · **parallel** · **Batch G** · **Model:** sonnet · low.

**The work.** `FieldRow` (the canonical field wrapper, ~16 forms build on it) renders the error `<Text>`
with **no `id`**, and never sets `aria-describedby` on the control. Fix it **once** in `FieldRow` so
every form inherits it (D-IC6):
- Give the error `<Text>` `id={`${id}-error`}` and keep `role="alert"` (announces on first render).
- Set `aria-describedby={error ? `${id}-error` : undefined}` **and** `aria-invalid={error ? true :
  undefined}` on the **control** — i.e. inject them onto `children`. The child control today takes its
  own `id={id}` (matching the `Label htmlFor`); use `React.cloneElement` (or an equivalent) to add the
  two ARIA attributes to the single control child **without** clobbering any the caller already set, and
  **without** breaking the `wide` layout or existing `FieldRow` consumers. If a caller already sets
  `aria-describedby`, merge (space-join) rather than overwrite.

**Acceptance:**
1. `FieldRow.test.tsx`: with an `error`, the rendered control has `aria-invalid` **and** an
   `aria-describedby` whose id resolves to the error node (whose text === the error); the error node has
   `role="alert"`. Without an `error`, the control has **no** `aria-describedby` and no dangling id.
2. A caller-supplied `aria-describedby` on the control is preserved (merged), not overwritten.
3. No existing form regresses (gate green; the ~16 `FieldRow` consumers still typecheck + their tests
   pass).
4. Report the app-wide count of controls now inheriting `aria-describedby` via `FieldRow` (baseline was
   6 sites wiring it by hand).

---

## WP 0.3 — Shell landmarks + skip link

- **Findings covered:** 3 (HIGH — two `<main>`s, unnamed sidebar, no skip link, 22 stops before content).
- **Domain (contract):** `apps/web/src/components/AppShell.tsx` **+** `apps/web/src/components/AppShell.test.tsx` (**new**).
- **Depends:** — · **Size:** M · **parallel** · **Batch G** · **Model:** opus · medium.

**The work.** Today the shell renders **two nested `<main>`s** — the vendored `SidebarInset`
(`AppShell.tsx:645`) renders a `<main>`, and the app's own main region (`:347`/`:352`/`:361`/`:364`,
four layout branches) renders another inside it — the sidebar is an unnamed `<div data-slot="sidebar">`,
and there is no skip link, so a keyboard user hits **22 focusable stops** (16 the sidebar) before
content. Fix all three (D-IC4):
- **Exactly one `<main>`.** Keep one; demote the other to a `<div>` (retain its `app-shell-main`
  class/layout). Decide which stays `<main>` so the skip-link target is the real content region — if
  `SidebarInset` can't be made a non-`main` cleanly, keep **its** `<main>` and demote the four inner
  `app-shell-main` variants to `<div>` (or vice-versa); the live DOM must show **one**.
- **Name the nav.** The primary sidebar becomes/receives `<nav aria-label="Sections">` (the precedent
  is in-repo: `SettingsView.tsx:381` `<nav aria-label="Settings sections">`). Wrap or label the
  existing sidebar element — do **not** hand-roll a new sidebar.
- **Skip link.** Add a "Skip to content" link as the **first focusable element**, visually-hidden until
  focused (a `sr-only focus:not-sr-only` treatment, token-styled, visible focus ring), targeting the
  single `<main>` (`href="#…"` + a matching `id`).
- **Do not regress** toolbar-reach's IconButton conversions already in `AppShell.tsx` (dock/theme
  controls) — those are a different region; leave them.

**Acceptance (live DOM, both themes):**
1. `document.querySelectorAll('main').length === 1` (was 2).
2. The sidebar is a `<nav>` with an accessible name "Sections" (`getByRole('navigation', { name })`
   finds it; it was an unnamed `<div>`).
3. The **first** focusable element is the skip link; **focusables before the first content element = 1**
   (was 22). Activating it moves focus into `<main>`.
4. The skip link is invisible until focused, then visible with a focus ring, readable in both themes.
5. `AppShell.test.tsx` asserts one `main`, the named nav, and the skip link as first focusable.

---

## WP 0.4 — Runs feed toolbar adopts D-TB7 (finding 2; migrated Phase-0.a)

- **Findings covered:** 2 (HIGH — 68% of the Runs filter row hidden behind `[scrollbar-width:none]` at
  1100px). Plus the pressed-toggle-borrows-primary-green defect in the same row.
- **Domain (contract):** `apps/web/src/features/testing/RunsView.tsx` (**toolbar region only** — the
  filter/toggle row; **not** the result-count call site, which WP 1.2 owns), `apps/web/src/features/testing/runs/RunFilterBar.tsx`.
- **Depends:** — (D-TB7 `ViewToolbar` owning `left` as `flex min-w-0 flex-wrap` is already in `main`) ·
  **Size:** M · **parallel** · **Batch G** · **Model:** sonnet · medium.

**The work.** The Runs filter row is a **hand-rolled** `<div className="flex min-w-0 items-center gap-2
overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">` (`RunsView.tsx:733`) — at 1100px
`clientWidth 160` vs `scrollWidth 498`, so 338px (68%: Type facet, Filter button, Show-forks toggle,
row-count badge) is hidden with **zero** affordance.
- **Preferred fix — let the row wrap.** Replace the hand-rolled overflow wrapper with the D-TB7
  `ViewToolbar` `left` flex-wrap pattern (the sibling `FilterControls.tsx:97` already sets `flex-wrap`).
  The row wraps onto a second line instead of hiding.
- **If you keep any horizontal scroll**, it **must** carry a visible cue — an edge fade mask
  (`mask-image: linear-gradient(to right, black 85%, transparent)`) or let the next control **peek**
  16–32px. `[scrollbar-width:none]` with no cue **is** the defect; do not ship it.
- **Pressed toggle ≠ primary action.** The Show-forks toggle (`RunsView.tsx:764`,
  `variant={filter.derived === true ? "default" : "outline"}`) borrows the filled-primary green when
  pressed. A pressed toggle is not a primary action — use a proper pressed treatment (a `Toggle` /
  `ToggleGroup` pressed state, or `outline` + `aria-pressed`) that stays visibly distinct from the
  **New run** primary button in the same cluster.

**Acceptance (measured at 1100px, both themes):**
1. The `overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden` wrapper is **gone** from
   `RunsView.tsx`.
2. At 1100px, **every** control in the row is visible or wrapped onto a second line — measured
   `scrollWidth === clientWidth` (was 160 vs 498). Report both numbers.
3. If any horizontal scroll remains, a visible cue is present (name it: fade mask or Npx peek).
4. The Show-forks toggle no longer renders in the filled-primary green when pressed; it is visibly
   distinct from the New-run primary button. Report the pressed treatment used.
5. The result-count call site is **untouched** (WP 1.2 owns it — keep the rebase clean).
6. `RunFilterBar` tests still pass; add/extend a test if the toggle's pressed variant is now assertable.

---

### Batch G exit → Batch H
All four merged to `ui/interface-craft`, PM re-runs the full gate, every Acceptance number checked and
recorded in [`STATUS.md`](./STATUS.md). H enters on 0.1 (tokens/DOM base) + 0.4 (Runs toolbar, for
1.2's rebase).
