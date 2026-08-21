---
type: "Work Package Spec"
title: "UI/UX audit — the running app, both themes, 2026-08-21"
description: "The measured findings behind RM-36: a static token pass plus a rendered cross-theme design, usability and accessibility audit of 30 routes at http://127.0.0.1:5173."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:30:00Z"
status: "final"
---

# UI/UX audit — the running app, both themes

**Target:** `http://127.0.0.1:5173` (Vite dev server, API on `:8080`, the owner's real database —
8 MCP servers, 76 runs, real skills and suites).
**Register:** product (operator console) — the bar is *earned familiarity*, not distinctiveness.
**Date:** 2026-08-21. **Method:** two passes, formed independently, then synthesised.

- **Pass 1 — deterministic.** `brand-ui audit apps/web/src --json` over 627 files.
- **Pass 2 — rendered.** Playwright 1.56 (the repo's own install), 1440×900, **30 routes ×
  2 themes = 60 captures**, with an oklch-aware WCAG contrast auditor reading computed pixels, a
  real `Tab`-key focus walk, a WCAG 2.2 target-size probe, and viewport sweeps at 1280 / 1024 / 768.

> **What was NOT audited.** The **Assistant feature flag is off** on this instance, so all eight
> `/assistant/*` routes render the "turned off" panel rather than their real surfaces. The Hub
> workspace, sessions, agents/crews, projects, memory, usage and audit views are therefore
> **un-audited** — roughly a quarter of the app's routes. Nothing here should be read as a verdict
> on them. Re-running the sweep with the flag on is the one gap to close.

---

## Scorecard — 19 / 24

| Axis | Score | The short reason |
| --- | --- | --- |
| Accessibility | 3 / 4 | Contrast and focus are genuinely clean; target size fails on one route, and one control cluster breaks the project's own D-TB5 rule. |
| States & resilience | 3 / 4 | Broad, real state coverage; one endpoint failure is swallowed silently. |
| Theming & tokens | 4 / 4 | Every colour resolves to an oklch token, both themes verified rendering, one documented and test-gated override. |
| Consistency & hierarchy | 3 / 4 | One shell and one grammar hold; the runs table encodes two columns two ways each, and three surfaces waste vertical space. |
| Visual anti-patterns | 3 / 4 | No gradient text, neon glow, pure black or custom cursors; three side-stripe accents and one wall-of-text. |
| Taste & anti-slop | 3 / 4 | Real data and real domain vocabulary throughout; one card body is a 350-word comma dump. |

**Does this look AI-generated? No.** Real fleet data, honest unknown-handling (`—` for unmeasured,
an explicit "not measured" rather than a fake `0`), restrained colour, dense operator tables, and
domain vocabulary a generator would not invent. The only content-slop the detector flagged —
133 `acme-*` hits and one `~99.99%` — are **test fixtures and a code comment**, not shipped UI.

---

## What is verified clean (do not "fix" these)

These were measured, not assumed. Each is a place where a plausible finding was **refuted**.

1. **Colour contrast: zero failures, 30 routes × 2 themes.** The auditor measured 200 text elements
   on the dashboard alone; every computed colour came back `oklch`, so the parser was doing real
   work rather than silently passing an unparsed format. Lowest ratios found: **4.66:1** (12px badge
   label), 4.70:1 (status badges), 5.47:1 (muted tabs), 5.50:1 (12px sidebar section labels) —
   all above the 4.5:1 floor.
2. **Focus rings: 45 / 45 real `Tab` stops carried a visible ring** on the dashboard walk, including
   the skip link, all 14 sidebar items, the tab strip, the chart figure and the table sort buttons.
3. **Reduced motion: covered.** The app has 79 `transition-*` / `animate-*` call sites against only
   17 `motion-reduce:` guards, which looks like a gap — but `@elabs-ai/components-tokens`'
   `themes.css` ships a **global blanket** rule (`* { animation-duration: 0.01ms !important;
   transition-duration: 0.01ms !important }` under `prefers-reduced-motion: reduce`). The
   unguarded sites are covered by construction. **Not a finding.**
4. **Target size, app-wide.** Applying WCAG 2.2 2.5.8 honestly — extending each control's rect by
   its associated `<label>`, and granting both the *inline* and the *spacing* (24px undisturbed
   circle) exceptions — **21 of 22 sampled routes pass**. The 13×13 row checkboxes and the 13×13
   run-launcher radios are **not** failures: the checkboxes sit alone in tall rows, and each radio's
   real target is the whole `<Label>` card wrapping it.
5. **Horizontal overflow at 1280 and 1024: none.** The single element reported past the viewport is
   the closed assistant dock, present identically on every route including Settings.
6. **Raw colour literals: none in shipped UI.** All 20 `raw-hex` hits are false positives — React
   error `#185` inside comments, `#ff0000` sentinels inside `.test.tsx`, and four `#000` stops in
   `app.css` that are **`mask-image` alpha stops, not colours**.
7. **State coverage is real:** `EmptyState` in 69 files, `StatePanel` 69, `Spinner` 52, `Skeleton`
   30, `ErrorState` 8.
8. **No unlabeled form controls, no duplicate element ids** on any route except `/illustrations`
   (finding P1-2), and no `space-y-*` misuse — the 11 static hits are `space-y-0` *neutralising*
   `CardHeader`'s default, which is the sanctioned pattern.

---

## P0 — broken, illegible or inaccessible

**None.** No contrast failure, no unreachable-by-keyboard control, no illegible surface, no route
that fails to render.

---

## P1 — clearly hurts quality

### P1-1 · `/advisor` — the recommendation body is a 350-word comma dump

**Surface:** `/advisor`, both themes · `apps/web/src/features/advisor/RecommendationCard.tsx`

The highest-value recommendation on the page — *"Trim 139 never-called tools … saving ≈ 136,502
tokens/turn"* — is buried under **twenty rendered lines of comma-separated tool names**
(`qlik_add_chart, qlik_add_container, qlik_add_filter, …`) inlined into the card's prose paragraph.
At 1440×900 the single first card fills the entire viewport, so the operator sees **1 of 16
recommendations** without scrolling, and must read a 350-word list to reach the "Estimated saving"
panel underneath it.

**Why it matters:** the recommendation is an *evidenced suggestion* whose whole value is the number
and the decision. Rendering its evidence as unstructured prose inverts the hierarchy — the argument
hides the conclusion.

**Fix (token-referenced):** keep the sentence and the count in the body; move the 139 names out of
the paragraph into a collapsed disclosure (`@elabs-ai/components-ui` `Collapsible` / an
`Accordion`), rendered as a wrapped list of `Badge variant="secondary"` chips or a
`max-h-*` `overflow-y-auto` block, not prose. The card already has a correct "ASSUMPTIONS" list
pattern directly below — reuse that structure. No new component, no new token.

### P1-2 · `/advisor` — 55 real WCAG 2.2 2.5.8 target-size failures

**Surface:** `/advisor`, both themes · `RecommendationCard.tsx:88-96` (the `<ul>`) and `:136-148`
(`EvidenceLink`)

This is the **only** route in the app that fails 2.5.8 after the inline and spacing exceptions are
granted. Measured: **55 distinct evidence links, each 16px tall**, packed by
`className="flex flex-wrap items-center gap-x-3 gap-y-1"` — a **4px** vertical gap, so the 24px
undisturbed-circle exception cannot apply either.

The cause is precise: `EvidenceLink` renders
`<Button asChild variant="link" size="sm" className="h-auto max-w-full gap-1 p-0">`. The
`h-auto p-0` strips the button's own height and padding, collapsing the target to its 16px line box.

**Fix:** drop `h-auto p-0` so the `size="sm"` height stands, or raise the list to
`gap-y-2` **and** give each link vertical padding, so the effective target reaches 24px. Layout
utilities only — no token change.

### P1-3 · `/illustrations` — duplicate SVG pattern ids mis-register the blueprint grid

**Surface:** `/illustrations` detail dialog, both themes ·
`packages/illustrations/src/primitives/PaperStage.tsx:51`

`PaperStage` derives its pattern id from geometry constants alone:

```ts
const patternId = `illus-paper-grid-c${fmt(cell)}-m${majorEvery}`.replace(/\./g, "p");
```

Every stage on a page with the same `cell` / `majorEvery` therefore emits the **same**
`<pattern id>`. Measured in the detail dialog: **36 `<pattern>` elements resolving to just 2 distinct
ids**, carrying **3 distinct `patternTransform` values** (`translate(0 -7.8)`, `translate(0 3.8)`,
`translate(0 4.6)`) across 3 distinct stage sizes — because the transform is computed per stage from
its own centre (`cx % cell`, `cy % cell`).

`url(#id)` resolves to the **first** matching element in document order, so **all 36 stages render
with one stage's grid phase**. This is a **live rendering defect**, not merely invalid HTML: the
majority of illustrations in the size matrix draw their grid out of registration with their own
crosshair and registration marks. On the gallery grid (24 patterns, 24 duplicates) every card
happens to be the same size, so the phases coincide and nothing looks wrong — the bug only shows
where sizes differ, which is exactly what the detail dialog is for.

**Fix:** make the id instance-unique — `React.useId()` composed with the existing geometry suffix, so
the id stays readable and the package's no-literals guard still passes. Add a contract test asserting
that two `PaperStage`s of different sizes on one page emit two distinct pattern ids.

### P1-4 · Run console — a `<p>` nested inside a `<p>` throws a React error on every load

**Surface:** `/testing/runs/:runId`, both themes · `apps/web/src/features/testing/KpiRail.tsx`
(the cost tile's `description`)

Captured markup:

```html
<p class="text-meta font-normal text-muted-foreground"><p class="text-meta text-muted-foreground">estimated</p></p>
```

`MetricCard` renders its `description` prop inside a `<p>`; the call site passes a `<Text>`, which is
itself a `<p>`. Console output on every run-console load, in both themes:

```
In HTML, <p> cannot be a descendant of <p>. This will cause a hydration error.
```

**Why it matters:** invalid HTML the browser will re-parent, a permanent React error in the console
of the app's busiest screen (which makes real errors harder to notice), and a latent hydration bug.

**Fix:** pass a plain string to `description`, or `<Text as="span">`. One-line change.

### P1-5 · Rendered markdown table toolbar breaks the icon-affordance rule (D-TB5)

**Surface:** `/skills/:skillId` → Overview (the rendered `SKILL.md`), both themes · a
`@elabs-ai/components-*` component, **not app source**

Eleven icon-only controls on that page — *Copy table*, *Download table*, *View fullscreen* per
rendered table — fail three ways at once:

```html
<button class="cursor-pointer p-1 text-muted-foreground transition-all …" title="Copy table" type="button">
```

1. **The accessible name is a native `title`.** `.claude/rules/icon-affordances.md` (D-TB5) states
   this outright: *"Never use the native `title` attribute to explain an icon-only control … it is
   invisible to assistive technology."* There is no `aria-label`.
2. **No focus ring.** Computed on focus: `outline: 0px auto`, `box-shadow: none` — these were 11 of
   the 13 unringed focusables found on the entire route.
3. **21×21 and 23×23**, adjacent to each other, so both the size minimum and the spacing exception
   fail.

**Why it matters:** it is the one place in the audited app where a keyboard user gets no focus
feedback, and it violates a written project rule.

**Fix:** this is **upstream**, so per `library-first.md` it is a gap to raise, not to hand-roll. The
in-repo counterpart already exists and is correct — `apps/web/src/components/IconButton.tsx` derives
tooltip text and `aria-label` from one `label` prop. Ask for the same treatment on the markdown
table toolbar; until then, note it as a known upstream exception rather than patching around it.

### P1-6 · At 768px the primary actions of the two busiest pages become unreachable

**Surface:** `/testing/runs` and `/testing/runs/:runId`, 768×900

The page scroll width equals the client width, so nothing is off-screen-but-scrollable — the content
is **clipped and unreachable**, and no ancestor scrolls horizontally.

| Route | Unreachable at 768px | Measured right edge |
| --- | --- | --- |
| `/testing/runs` | **Compare runs**, **+ New run** | 849px, 958px (viewport 768) |
| `/testing/runs/:runId` | **Export session log**, **Re-run with changes**, the `automated` meta chip | 806px, 975px |

1280px and 1024px are clean; this is a 768-and-below failure only. It is an operator desktop tool, so
this is P1 rather than P0 — but "+ New run" is the page's primary call to action, and RM-32 already
carries "the layout below 768px" as an open owner-acceptance box.

**Fix:** let the action cluster collapse — wrap it, or move the secondary actions into the existing
overflow `⋯` menu below a breakpoint, keeping the primary CTA visible. Layout only.

---

## P2 — polish

### P2-1 · The runs table encodes the same column two different ways

**Surface:** `/testing/runs`, both themes

In one table, in adjacent rows:

- **Status** — suite-run parent rows render `⊙ Completed` (icon + badge); child run rows render
  `Completed` (badge, no icon).
- **Grade** — parent rows render plain text (`100.0% pass`); child rows render **badges**
  (`Judge 70%`, `Answered`).
- **Actions** — parent rows show `Open console`; child rows show `Open` plus an unlabeled
  strikethrough-bell glyph.

Two visual encodings for one column reads as two meanings. Pick one per column and let the row's
indent and expander carry the parent/child distinction (they already do).

### P2-2 · Server cards repeat the chips their own group heading already states

**Surface:** `/servers`, both themes

The group heading reads `QLIK-SAAS · [Production] · 2`, and then **every card inside that group**
repeats `[qlik-saas] [Production]` as chips. By the reduction filter this is removable without loss
of meaning — the grouping *is* the statement. Keep the risk chip (which varies within a group);
drop the type and status chips when the card sits under a heading that names them.

Related, same surface: `mcp-assets` truncates to `mcp-ass…` (10% lost, 81px shown against 90px
needed) because the `Scan failed` + `Medium risk` chips take the row — the name is clipped exactly
on the card whose name you most need to read. Let the title wrap, or move the chips to their own row.

### P2-3 · The run launcher's step 1 is mostly empty

**Surface:** `/testing/runs/new`, both themes

The wizard dialog holds a fixed height; step 1 offers two radio cards and then roughly **380px of
empty space** above the footer. The step rail also truncates `Tests & environme…` with room to
spare. Either size the dialog to its step, or bring step 2's first decision forward.

### P2-4 · A failed request on `/testing/environments` is swallowed completely

**Surface:** `/testing/environments`, both themes

`GET /api/servers/FInszS9xQ4Jvdpo0fUdML/latest-scan` returns **404** on every load — an environment
references a server id that no longer resolves. The page shows **no error text, no `role="alert"`,
no `role="status"`, and no toast**; the failure exists only in the browser console.

`.claude/rules/architecture.md` and the interaction rules both say connection/scan failures must
surface and must never be swallowed. A dangling reference is exactly the data-integrity signal an
operator needs. Surface it inline on the affected environment row — "server no longer available" —
rather than dropping it.

### P2-5 · Card-height coupling leaves dead space on the skill inspector

**Surface:** `/skills/:skillId` → Overview, both themes

The Frontmatter card is grid-paired with the taller Token-footprint card and carries ~130px of empty
space below `metadata.tags`. Let the shorter card size to content (`items-start` on the grid) rather
than stretching.

### P2-6 · Three side-stripe accents

**Surfaces:** `apps/web/src/features/hub/SourcesPanel.tsx:124`,
`apps/web/src/features/testing/ReportTab.tsx:603`,
`apps/web/src/features/testing/compare/flow/LaneCell.tsx:125`

`border-l-2` / `border-l-4` accent stripes — a generic-UI tell. Prefer a full `border-border`, a
`bg-muted` tint, or a leading icon. Low stakes; listed for completeness.

### P2-7 · Accepted as-is — recorded so it is not re-reported

- **The `⌘K` chip renders at 11.2px**, below the 12px body-text floor the static pass flags. It is a
  `<kbd>` key cap from the design system, not prose. **Not a defect** — judged and accepted.
- **174 `em-dash-overuse` and 133 `slop-brand-name` advisories** are comments, prose in code, and
  `acme-*` **test fixtures**. Not shipped UI.
- **`ToolsPalette.tsx:624,630,762`** carries `text-[11px]` / `text-[10px]` in the skill-IDE tool
  palette. Real sub-12px text, but on a dense IDE surface that the sweep did not open. Worth a look
  when that surface is next touched; not scheduled here.

---

## Method notes — how to reproduce or extend this

- The harness is Playwright driven straight from the repo's own install
  (`node_modules/.pnpm/playwright@1.56.0/…`), navigating the dev server with the theme forced via
  `localStorage` (`brand-ui-theme` **and** `mcp-token-footprint.theme-preference` — the app resolves
  the preference into the provider key before first paint, so setting only one flashes the wrong
  theme).
- **Render gate:** 2.6s settle + a `waitForFunction` on body text length + 0.7s. A screenshot fired
  during the loader is a capture bug, not a finding.
- **The contrast auditor must be oklch-aware.** Every computed colour in this app is `oklch()`; an
  `rgb()`-only parser returns zero failures while measuring nothing. Confirm it is working by
  printing the *distribution* of ratios, not just the count over the threshold.
- **The target-size probe must grant 2.5.8's exceptions** or it over-reports by ~50×: this app went
  from "98 distinct failures across every route" to "55 failures on one route" once label-extension,
  the inline exception and the spacing exception were applied. The naive number would have been a
  fabricated emergency.
