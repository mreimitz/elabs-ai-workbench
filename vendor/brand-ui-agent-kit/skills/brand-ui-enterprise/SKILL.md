---
name: brand-ui-enterprise
description: "Design-judgment layer for building enterprise-grade app UIs with the brand-ui (@brand/*) design system. Use when designing or laying out a professional/business app or screen — admin console, operator console, internal/back-office tool, dashboard, data app, dense data table, master-detail/drill-down screen, B2B SaaS app, or AI workspace — that must read enterprise-grade, not like a marketing or consumer app. It classifies the surface (professional vs consumer vs marketing) and commits to a register, picks the app-shell archetype (tool/workspace vs enterprise admin), models objects and screens, and stands up the mandatory baseline (shell, app icon + favicon, System/Qlik Bright/Qlik Dark theme switcher, settings modal, toasts, detail panel). Also triggers on app-shell design and admin/dashboard layout. Not for marketing landing pages, consumer/mobile apps, pure data/SQL/analytics questions, theme-token-only work, or component-library picks; defers props to brand-ui and scored review to brand-ui-audit."
user-invocable: true
argument-hint: "[what you're building, e.g. 'internal admin console for billing ops, qlik-dark']"
allowed-tools:
  - Bash(npx @brand/cli *)
  - Bash(npx brand-ui *)
  - Bash(pnpm brand-ui *)
---

# brand-ui-enterprise

Design **enterprise-grade applications** with brand-ui. This skill is the _judgment_
layer: decide what kind of product you're building, pick the right shell, stand up the
mandatory baseline, then build screens from `@brand/*` with enterprise UX discipline.
Keep this file lean — load a `reference/` file when its step is active.

## What this skill owns — and defers

- **Owns:** the professional / consumer / marketing call + register; the shell-archetype
  choice; the enterprise **app baseline** (definition of done); applying enterprise UX
  principles mapped to `@brand/*`.
- **Defers:** real component props/APIs → the **`brand-ui`** skill (`brand-ui search` /
  `brand-ui docs`); scored UX/a11y review → **`brand-ui-audit`** (set its register =
  _product/professional_); a brand-new scaffold interview → **`brand-ui-new-app`** (feed it
  the shell archetype this skill picked — **A** tool/workspace or **B** enterprise admin);
  tokens/themes → **`brand-ui-theme`**.
- **Never:** re-implement a component, invent props, or use marketing patterns in a
  professional surface.

## Procedure (in order)

### 0 · Detect the mode (what situation am I in?)

Infer from the request + the workspace — don't interrogate:

- **Create** (greenfield) · **Extend** (add to a brand-ui app) · **Audit & fix** (review /
  remediate an existing app) · **Retrofit** (bring a non-brand-ui app onto brand-ui).

Look first (`package.json` for `@brand/*`, an existing shell/routes); ask one question
only if genuinely ambiguous. Each mode has its own short question set + hand-offs.
→ `reference/modes-and-interaction.md`.

### 1 · Classify the surface → state the register

Decide first: **professional / consumer / marketing?**

- Professional — "a trained user does this repeatedly as their job" → **calm** register.
- Consumer — "a stranger uses this voluntarily; we want them back" → **lighter** register.
- Marketing — "a visitor is deciding whether to care; one action" → **expressive** register.

Say the answer out loud before building. Mixed product → classify **per surface** (the
app shell is professional; a `/landing` or `/pricing` route is marketing).
→ `reference/professional-vs-marketing.md` (tests, table, the trap, legitimate exceptions).

### 2 · Pick the shell archetype + plan the nav

Professional apps use one of two shells — choose up front (hard to change later):

- **A — tool/workspace** (editor / inspector / canvas): inset collapsible sidebar +
  routed content + status bar + navigator/inspector panes + ⌘K palette.
- **B — enterprise admin** (console): icon sidebar (top-level views) + topnav +
  breadcrumb + optional secondary rail + detail.

Marketing → no sidebar; top nav + single scroll.
→ `reference/shell-and-navigation.md` (archetypes, nav-type catalog, canonical snippets).

### 3 · Stand up the baseline (mandatory, by default)

Every professional app gets these **without being asked**: the chosen shell, the
**collapsible Qlik app icon + favicon**, **ThemeProvider + System/Qlik Bright/Qlik Dark
switcher**, a **settings modal**, the **Sonner `Toaster`**, and a **right-side detail
panel** (generic `Sheet`/`Drawer`; `@brand/ai` `ContextPanel` for AI surfaces).
→ `reference/enterprise-app-baseline.md` (spec, root wiring, definition-of-done checklist).

### 4 · Model the objects & task flow, then build screens

**Model first, lay out second** (noun → verb): list the **objects** (Country, Customer,
Order), their **relationships**, **actions** and **attributes**; give each object a
**detail hub** (header + attributes + actions + related lists) and connect them with
**drill-down/up navigation** (breadcrumb path, peer prev/next, preserved list position).
Pick the **detail/task surface** by context + complexity + reference-need: full page (hub /
multi-step) · drawer/`Sheet` (keep the list in view) · modal `Dialog`/`AlertDialog`
(focused / irreversible) · inline/expand (repeated edits). **Never dump everything onto one
page.** → `reference/object-and-navigation-patterns.md`.

Then **prioritize by information value**: rank each region (act › decide › reference › raw),
match space + emphasis + interaction to importance, turn findings into actions, kill redundancy,
order sections summary-first, and promote a high-value task to its own surface.
→ `reference/information-priority-and-emphasis.md`.

Then compose from `@brand/*` with enterprise discipline: density-with-progressive-disclosure,
every state designed, calm token-only visuals, motion that explains state, fix-oriented
copy. Real props: default to `brand-ui docs`/`brand-ui search`, or compose with documented props
and **flag** what's unconfirmed — never guess. Deep-verifying against the vendored `@brand/*`
source is **optional** (shipping-critical only), not an every-run step. → `reference/principles.md`.

### 5 · Verify → hand off

Run the baseline checklist (`enterprise-app-baseline.md` §3). Route a scored review to
**`brand-ui-audit`** with register = _product/professional_ (so it judges this as a
professional product surface, not marketing). For a greenfield scaffold, hand
**`brand-ui-new-app`** the shell archetype this skill picked (**A** tool/workspace or **B**
enterprise admin) so it starts from the right shell. Report honestly what you did **not**
visually verify (compiled ≠ looked at). → `reference/modes-and-interaction.md` (per-mode hand-offs).

## Critical rules (always)

- **Classification-first.** Never build before stating surface type + register.
- **Objects and tasks before pages.** Model the objects (noun → verb), give each a detail
  hub, connect them with drill-down/up navigation. A screen operates on an object or
  completes a task — it is **never** a content-dump of everything on one page.
- **Right component for each structural job.** Sticky `PageShell`/`SectionHeader` header with
  a `ButtonGroup` toolbar (not loose buttons); `Tabs` for an object's sections (not a card
  stack); `SplitPanel` master-detail when a list drives a detail (never detail **below** the
  list); a searchable list with a count (not hand-rolled cards). → `screen-layout-patterns.md`.
- **Importance drives emphasis, space & interaction.** Rank every region by value to the task
  (act › decide › reference › raw); give the most valuable content the most space, prominence,
  and interaction; de-emphasize or hide reference/raw; kill redundancy (say each thing once);
  order sections summary-first; promote a high-value repeated task (e.g. Run X) to its own
  surface. → `information-priority-and-emphasis.md`.
- **The baseline is mandatory** for professional apps — not opt-in.
- **Professional register discipline:** dense-by-design + progressive disclosure; calm,
  token-only visuals; motion explains state (<~200 ms, `motion-reduce` safe).
- **No marketing slop in a pro surface:** no hero/landing layout, no wall of three equal
  feature cards, no gradient/"AI-purple" accents, no fake-perfect stats, no
  "Acme / Jane Doe" content, no filler verbs (elevate, seamless, unleash…).
- **Semantic tokens only**; must read in qlik-bright **and** qlik-dark. Real elements,
  visible focus, labels, `aria-label` on icon-only controls.
- **Compose, don't reinvent.** Defer APIs to `brand-ui`; defer scoring to `brand-ui-audit`.
- **Lean by default.** Load only the active step's `reference/*.md`, not all of them; deep
  prop-verification against the vendored `@brand/*` source is **opt-in** (shipping-critical only) —
  the default is `brand-ui docs` or compose-and-flag. Don't turn every run into a full audit.

## The category error this skill prevents

"Build an internal admin console for X" must **not** produce a marketing landing (hero
banner, three equal cards, big gradient headline, fake stats). An admin console is a
**professional** surface → archetype B + the baseline. Reaching for `@brand/marketing`
in an operational app? Stop and re-do step 1.

## Resources

- `reference/modes-and-interaction.md` — the four modes, mode detection, per-mode question sets, hand-offs.
- `reference/professional-vs-marketing.md` — the 3-way framework, one-line tests, the trap.
- `reference/shell-and-navigation.md` — shell archetypes A/B, nav-type catalog, snippets
  (collapsible app icon, theme switcher, settings modal) lifted from shipping qLabs apps.
- `reference/enterprise-app-baseline.md` — the mandatory default skeleton + checklist.
- `reference/principles.md` — enterprise UX principles (rulebook) → `@brand/*` map.
- `reference/object-and-navigation-patterns.md` — OOUI, object detail hubs, drill-down/up
  navigation, and the detail-surface decision tree (page/drawer/modal/inline) → `@brand/*`.
- `reference/screen-layout-patterns.md` — screen anatomy, **structural component selection**,
  master-detail split, and the MCP-server case study (what goes where, in which component).
- `reference/information-priority-and-emphasis.md` — rank content by value; emphasis/space/
  interaction by importance; insight→action; promote high-value tasks to their own surface.
- `assets/` — paste-ready baseline files (app shell, theme switcher, settings
  modal, providers, favicon) **and a `detail-hub.tsx` screen example** (archetype-B object
  detail hub: sticky header+tabs · `SplitPanel` master-detail · Run-task `Dialog`) — starting
  points; verify props with `brand-ui docs`.

> Sibling brand-ui skills do the rest: `brand-ui` (compose + real APIs), `brand-ui-new-app`
> (scaffold), `brand-ui-audit` (scored review), `brand-ui-theme` (tokens/themes).
> Shipped as `brand-ui-enterprise`; vendored from the `qlabs-enterprise-ui` skill repo (v0.4.0).
