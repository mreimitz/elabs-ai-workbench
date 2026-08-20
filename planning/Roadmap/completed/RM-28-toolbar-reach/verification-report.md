---
type: "Work Package Spec"
title: "Toolbar Reach \u2014 verification report (owner-acceptance walk)"
description: "Branch: ui/toolbar-reach (cut from main; main never touched, nothing pushed) \u2014 61 commits, all 23 WPs merged."
tags: ["roadmap", "RM-28"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Toolbar Reach — verification report (owner-acceptance walk)

**Date:** 2026-07-25
**Branch:** `ui/toolbar-reach` (cut from `main`; `main` never touched, nothing pushed) — 61 commits, all 23 WPs merged.
**Verifier:** PM-as-owner (this session). Structural verification from validated agent reports + PM diff review on
every merge; **live measured-geometry** pass driven with Playwright + system Chrome against a fresh build of
`ui/toolbar-reach` served on `:8085`, at the audit's **1515×811** viewport, in **both** `light` and
`dark`.
**Source of findings:** `/docs/UI-UX-AUDIT-2026-07-25.md` (`../../docs/UI-UX-AUDIT-2026-07-25.md`) (29 findings
A-1…D-10 + 3 retractions).

> Honesty note, per the plan's own charge ("do not sign off a rule you have not measured on every view"): the
> two **marquee toolbar rows** (C-1 Dashboard filter, B-2 Environments) are signed off on **live measured
> geometry in both themes** (numbers below). Content-dependent rows (Compatibility, Compare, Usage) and the
> run-console visuals are **owner-pending** — they need seeded data or a provider key that this environment
> lacks — and are marked as such, not signed off. This is the correction the plan demanded of
> [`../ux-overhaul/verification-report.md:176`](/Roadmap/RM-30-ux-overhaul/verification-report.md) (which WP 0.4 fixed).

---

## 1. Quality gate — GREEN on the complete plan

Run from the repo root after 4.1 (the final WP) merged:

| Gate | Result |
| --- | --- |
| `typecheck` | `packages/shared` · `apps/api` · `apps/web` all **Done** |
| `test` | **API 3058 / 3058 pass** · **web 272 files / 2688 pass / 5 skipped** |
| `build` | `✓ built in ~26s` (serialized, `--workspace-concurrency=1`) |
| `lint` | Biome `Checked 1392 files … No fixes applied` |

Gate re-run GREEN on `ui/toolbar-reach` after **every** batch integration (A→F). The one API `metrics-perf`
p95 flake that surfaced under concurrent-agent load passes cleanly in isolation (0 failures).

---

## 2. Live measured-geometry walk (both themes) — the marquee toolbar rows

**Method (the auditor's own):** read each toolbar row's interactive controls in the live DOM and compare
`getBoundingClientRect()` — the **top edge** and **height** of every *control* in the row must be identical.
"Looks aligned" is not a pass. AppShell top-bar chrome (top≈8–11) and tab strips (top≈68) are excluded; only
the view toolbar's own controls are measured.

### B-2 · Environments — ONE row (WP 1.1) — **PASS, measured, both themes**
| Theme | Controls (label · top/height) | Verdict |
| --- | --- | --- |
| `light` | `Search environments…` 57/30 · `New environment` 57/30 | **tops={57} heights={30} — IDENTICAL ✅** |
| `dark` | same | **IDENTICAL ✅** |

The audit's B-2 was *two stacked bands* (a near-empty top `ViewToolbar` + a second in-table `TableToolbar`).
It is now one row; the search input and the primary action share **one top (57) and one height (30)**.
Geometry is theme-stable.

### C-1 · Dashboard Testing filter — the owner's screenshot (WP 2.1) — **PASS (fix confirmed), measured, both themes**
| | Date range | Facets (Provider/Server/Env/Model) | Suite | Group by | Scatter |
| --- | --- | --- | --- | --- | --- |
| **Audit BEFORE** | 117 / 30 | 119 / 26 | **126** / 30 | **126** / 30 | **top 11px** (label-above), heights 30/26 |
| **AFTER (measured, both themes)** | 120 / 30 | 121 / 26 | **120** / 30 | **120** / 30 | **top 1px**, heights 30/26 |

The diagnosed cause — `SelectField`'s label-above stack pushing Suite/Group-by **+9px** to top=126 — is
**eliminated**: they now sit at top=120, aligned with the date range. The **11px scatter collapses to 1px.**
The residual 1px top / 4px height is **exactly the vendored floor** flagged in the plan: `@elabs-ai/components-data`'s
`FacetFilter` renders at `h-26` while `@elabs-ai/components-ui`'s `Select`/`DatePicker` render at `h-30` — not fixable
without touching vendored `@elabs-ai/components-*` (owner-gated; upstream item §6). The plan's job (kill the label-above
cause) is measurably done.

### B-1 · Agents & Crews — no visible in-page H1 (WP 1.2 / D-TB8) — **PASS, measured**
The only heading in `main` is `<h1>` "Agents & Crews" with `class` including **`sr-only`** (font hidden). No
visible title/description block — `PageHeader` is deleted, the sr-only h1 kept for assistive tech (the TB.x
pattern). Content no longer pushed ~80px down.

### B-4 · Breadcrumb section labels (WP 2.7) — **PASS, measured**
`/scans` → **`MCP › Scans`** · `/testing/runs` → **`Testing › Runs`** (not the synthetic `Home › …`). The
retracted Assistant-peer IA is untouched; `TabPanel` untouched (C-9 stays closed per the owner — D-UX16).

### D-1 · Scans list-first (WP 4.2) — **PASS, measured**
On arrival at `/scans` (no selection): `main` width **1259px (full)**, **no** resizable split handle mounted,
**no** "No scan selected" empty detail card. The cramped-390px-rail-beside-800px-of-nothing is gone; the split
mounts only when a scan is picked.

---

## 3. Per-finding coverage (all 29) — how each was verified

**M** = live-measured (§2) · **S** = structural (agent invariant/behaviour tests + PM diff review, gate-green)
· **O** = owner-pending (needs seeded data or a provider key this environment lacks).

| Finding | WP | How verified |
| --- | --- | --- |
| A-1 run-console switcher desync | 0.1 | **S** — merged into one `TabPanel` strip; invariant tests prove strip-value-set === panel-value-set and no path sets `leftView` off-strip; `ToggleGroup`/ternary grep-clean. Live console visuals = **O** (provider key). |
| A-2 `/testing/runs/new` dead-end | 0.2 | **S** — param-less route + ⌘K now open the launcher; tests. Live = **O**. |
| A-3 four chrome rows | 0.2 | **S** — `Re-run` folded into RunBar; standalone row gone; `LineageBanner` self-collapses. Live = **O**. |
| B-1 two page-frame idioms | 1.2 | **M** — Agents & Crews h1 sr-only (§2). |
| B-2 Environments two toolbars | 1.1 | **M** — one row, 57/30 identical (§2). |
| B-3 `TableToolbar` stale contract | 1.1 / 0.4 | **S** — `TableToolbar` deleted; the 4.1 guardrail asserts it's gone + unimported; 0.4 corrected the record. |
| B-4 synthetic "Home" crumb | 2.7 | **M** — section-label crumbs (§2). |
| B-5 two entry mechanisms | 4.4 | **S** — route-vs-dialog rule written (`.claude/rules/routes-vs-dialogs.md`). |
| B-6 off-nav features | 4.3 | **S** — Suites tab in Runs feed + Review/Rubrics section in Collections; no new nav; tests. |
| C-1 Dashboard filter scatter | 2.1 | **M** — 11px→1px (§2). |
| C-2 six filter-chip idioms | 2.4 | **S** — Usage hand-rolled badge retired; `SelectField`→bare `Select`. |
| C-3 Compatibility bare controls | 2.2 | **S** — six controls reflow via `ViewToolbar` D-TB7; host-client "Host client: none". Live widths = **O** (needs a scan). |
| C-4 Compare bar truncation | 2.3 | **S** — server name first + type/env Badge outside + `title` + `w-56`. Live = **O** (needs 2 scans). |
| C-5 five count renderings | 1.1/2.1/2.8 | **S** — standardised on the count Badge (Environments, Dashboard, ScansView, ReviewView). |
| C-6 divergent row containers | 1.1 | **S** — `ViewToolbar` owns the `left` flex-wrap (D-TB7); consumers pass controls, not layout. |
| C-7 Collections empty bar + ragged actions + monospace | 2.5 | **S** — action column reserves width; bar resolved; `not bound…` in body face. Live = **O**. |
| C-8 single-page pagination | 0.3/1.1 | **S** — all 6 sites `shouldPaginate`-guarded; the 4.1 guardrail fails on a bare `enablePagination`. |
| C-9 centred tab strips | 2.7 | **CLOSED (won't-do)** — owner kept D-UX16 (centered tabs); `TabPanel` untouched. |
| C-10 one-subject compatibility | 2.2 | **S** — leads with Tool × Model; legend beside the grid. Live = **O**. |
| D-1 Scans narrow rail | 4.2 | **M** — list-first (§2). |
| D-2 KPI orphan | 2.1 | **S** — 5-col grid at `lg`. Live = **O** (needs runs). |
| D-3 status two renderings | 2.6 | **S** — `StatusBadge quiet` variant; ScansTab exception removed; 34 tests. |
| D-4 dashboard tabs differ | 2.1 | **S** — Testing + Issues share one filter-row shape. |
| D-5 Settings signpost | 4.4 | **S** — theme `Select` in Settings General (System/Bright/Dark), wired to the lifted preference (PM App.tsx touch-up). Live switch = **O**. |
| D-6 "Metrics · Soon" + disabled Export | 3.3 | **S** — disabled Export reason on a themed tooltip + `aria-describedby` (label restored — see §5). |
| D-7 three hover mechanisms | 1.3 / 3.1–3.4 | **S** — `IconButton` (one label → tooltip + aria-label, no `title`); ~129 controls converted; the 1 missing name (`EffectiveMemoryStack:151`) fixed; 4.1 hook enforces it. Live hover = **O**. |
| D-8 error vs empty | 2.5 | **S** — 404 collection → empty state, not the pink `ErrorState`. |
| D-9 archived Switch vs Checkbox | 2.8 | **S** — Projects → `Checkbox`; test asserts `checkbox`. |
| D-10 clamped descriptions | 2.8 | **S** — `title` on agent-card + skill-frontmatter clamps (recovery). |

**Retracted findings — NOT resurrected** (verified untouched): the "Agents/Projects/Audit → Assistant"
breadcrumb claim (they're sidebar peers — B-4 preserves that); "Compare's disabled Export has no explanation"
(folded into D-6/3.3); "Latest server footprint renders status a third way".

---

## 4. Guardrails (WP 4.1) — so this can't drift a THIRD time
Each was **demonstrated to fail on the injected pre-fix pattern**, then reverted:
1. a test failing on a bare `enablePagination` (C-8);
2. a test failing if `SelectField` is imported by a `*Toolbar*`/`*Filter*` module (D-TB9);
3. `.claude/hooks/no-title-on-icon-button.mjs` (registered in `settings.json`) rejecting `title=` on a
   text-less `<Button>`/`<IconButton>` — verified it does **not** false-positive on component `title` props,
   text-bearing buttons, `@elabs-ai/components-ai` `PromptInputButton`, the `brand-ui-allow` escape hatch, or non-web/test files;
4. a test asserting `PageHeader` + `TableToolbar` are gone and unimported (D-TB6/D-TB8).

---

## 5. Owner corrections applied during integration (recorded for honesty)
- **CompareBar "Export" label restored (3.3):** the agent followed the spec literally and converted a
  *text-bearing* split-button to icon-only, dropping the "Export" label. The audit (D-6/D-7) only asked to fix
  the disabled-*reason* wiring — so the label was restored and the reason moved off native `title` onto a
  themed Radix tooltip + `aria-describedby`.
- **6 cross-domain `TooltipProvider` test wraps:** converting the shared `ExpandableTable` primitive (3.1) made
  tests in 3.2/3.3/3.4-domain files that render it need a provider; a typed custom-`render` was added to each.
- **AgentCard D-10 `title` + OrgChartTab / theme-sync wiring:** small PM integration touch-ups where a fix's
  blast radius fell outside the owning WP's domain (each agent correctly reported rather than reached across).
- **Owner decisions locked 2026-07-25:** C-9 **kept closed** (D-UX16 centered tabs stands); D-5 **applied**
  (supersedes ux-overhaul WP 6.7).

---

## 6. Carry-forward for the owner / upstream `@elabs-ai/components-*` (NOT signed off)
- **IconButton-in-Dialog Escape hazard** — a modal that auto-focuses an `IconButton` opens its tooltip, which
  eats the first Escape (one instance fixed in 3.1). Now that `IconButton` is everywhere, a live modal sweep or
  a primitive-level fix is warranted. Owner call.
- **`@elabs-ai/components-data` `FacetFilter` `h-26` vs `@elabs-ai/components-ui` `h-30`** — the ~1px/4px residual on every mixed toolbar
  row (measured in C-1). The plan removed the diagnosed label-above cause; this is the vendored floor. Upstream
  `@elabs-ai/components-*` report.
- **`Composer.tsx:541` `SpeechInput`** keeps a bare native `title` — a `@elabs-ai/components-ai` `PromptInputButton`, not a
  `<Button>`, so outside Phase 3 + the 4.1 hook. Upstream `@elabs-ai/components-ai` fix.
- **Likely dead code:** `agents/CrewEditor.tsx` / `CrewLibraryPanel.tsx`.
- **Minor:** `/skills → "Skills › Skills"` crumb redundancy (one-line collapse if wanted); `/testing/environments`
  sits in the "Setup" sidebar group (pre-existing); editing a suite from the embedded Runs tab round-trips to
  Collections (pre-existing SuitesView flow).

---

## 7. What I could NOT verify (needs a provider key / seeded data / the live owner walk)
- **Run-console visuals (A-1/A-2/A-3):** the merged tab strip, the launcher-on-`/new`, and the folded re-run
  action need a **real run** (provider key). Structurally locked by tests; the live render is owner-pending.
- **Content-dependent toolbar rows (C-3 Compatibility, C-4 Compare, C-10, D-2, Usage):** measured only where
  chrome renders without data; the with-content geometry + truncation behaviour need seeded scans/runs.
- **Live theme switch from Settings (D-5)** and **icon-button hover tooltips at scale (D-7)** — verified
  structurally; the live interaction is owner-pending.
- A full keyboard-only traversal of every touched view (spot-checked visible focus rings via the components;
  not exhaustively driven).

**Bottom line:** the plan's marquee claims are signed off on **measured geometry in both themes** (B-1, B-2,
B-4, C-1, D-1); the rest are structurally verified and gate-green, with the honest owner-pending set named
above. Remaining owner action: the provider-key/live walk and the `ui/toolbar-reach → main` merge.
