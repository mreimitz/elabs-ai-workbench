# Interface review — AI Workbench (MCP Token Footprint)

Produced with the `better-interface` skill (jakubkrehel/skills), coordinating `better-accessibility`,
`better-layout`, `better-writing`, `better-typography`, `better-colors`, `better-ui`. Mode: full (cap 15
findings).

> **Provenance note (owner, 2026-07-25).** This file is the source of truth for the **interface-craft**
> plan ([`planning/Roadmap/completed/RM-15-interface-craft/`](../planning/Roadmap/completed/RM-15-interface-craft/item.md)). It was produced against the
> running app **before** the toolbar-reach plan merged to `main`; several `file:line`s have since
> drifted (e.g. `TableToolbar.tsx` is now deleted; the Runs overflow wrapper moved to `RunsView.tsx:733`;
> `AgentCard.tsx` gained a `title`). The plan's [`conventions.md`](../planning/Roadmap/completed/RM-15-interface-craft/conventions.md)
> §5 tracks the known drift. Implement the finding **intent** against current source; report new drift.

## Scope and Coverage

Mode: full · Scope: the running application at http://127.0.0.1:8080, all nav-reachable routes plus the
off-nav consoles, in both shipped themes.

Stack and conventions: React 19 + Vite 6, react-router-dom v7. Styling is Tailwind v4 with semantic oklch
tokens from `@elabs-ai/components-tokens`; all UI comes from the vendored `@elabs-ai/components-*` design system (brand-ui 1.9.0,
Radix + CVA) under a hard "no raw color, no hand-rolled interactive HTML" rule enforced by
`.claude/hooks/`. Two themes (light default, dark), and the app ships `data-density="compact"`
by default (`main.tsx:54`), which replaces the upstream type scale wholesale (`styles/app.css:74-111`).
Fixes below are expressed in that system.

Review boundary: this is a desktop operator console — `RunConsole.tsx:333` treats <1200px as "narrow"
and there is no mobile target. I reviewed adaptivity down to 514px (Chrome's floor for this window) but
weighted findings for the desktop range. Not inspected: SkillFlow Design/Trace canvas, the vendor assistant
surfaces, suite-run console with live data, OAuth flows — all need credentials or a live workload.

| Domain | Evidence inspected | Result |
|---|---|---|
| Accessibility | Live DOM landmark/heading/focus audit on Runs, Dashboard, Servers, Skills, Compatibility; tab-order enumeration (460 stops); `outline-none` sweep (all 6 sites + 2 focus targets); inert/aria-hidden/live-region/aria-describedby/toast-config source sweep; viewport meta; reflow at 514px | 5 findings |
| Layout | Toolbar overflow geometry measured at 1100px and 514px; `overflow-x-auto` + hidden-scrollbar sweep (21 sites); logical-vs-physical property counts; fixed-width inventory | 1 finding |
| Writing | Full button-label inventory; 21 ConfirmDialog title/label pairs; 28 InlineError + 132 `toast.error` + 6 ErrorState strings; 120 empty states; 59 toggle labels; 49 link texts | 2 findings |
| Typography | Compact + comfortable type scales resolved from tokens; `tabular-nums` coverage audit; `leading-*` inventory; measure measured in-page (chars/line); 324 `truncate` + 21 `line-clamp` recoverability pass; font-smoothing check on `<body>` | 3 findings |
| Colors | Every `--*`/`--*-foreground` fill pair measured in both themes via oklch→sRGB conversion + WCAG ratio; full-page rendered-pair scan on 5 routes × 2 themes; raw-color sweep; token-identity comparison | 2 findings |
| UI | Radius scale resolved (`--radius: 4px`); nested-surface border/shadow inventory (27 sites); `transition-*` specificity sweep; `active:scale` values; icon library + size distribution; all 34 `animate-*` + 16 custom keyframes | 1 finding |

## Findings

### 1 · HIGH · Colors
**Location:** `vendor/brand/brand-tokens-1.9.0 → themes.css:595,612,619` (bright) and `:755,768,772`
(dark); rendered on `StatusBadge.tsx:25-28` and every filled `Button`.
**Before:** Measured on-fill pairs. light: `--primary` `#008947` / `#fafafa` = **4.31:1**;
`--success` (identical token) = **4.31:1**; `--info` `#2d86c8` / `#fafafa` = **3.76:1**. dark:
`--destructive` `#ef5f89` / `#fafafa` = **3.02:1**.
**After:** Give each failing fill a foreground with ≥4.5:1. Dark already solves this for four of five —
`--primary-foreground` is `#1c1a18` there; apply the same treatment to `--destructive-foreground` in
dark. In bright, darken `--primary`/`--info` lightness (keep C and H) until the pair clears 4.5,
then re-run `themes-contrast.test.ts`.
**Why:** WCAG 1.4.3 AA needs 4.5:1 for normal text; all these render at 11–13px. Each theme fails a
different pair, which is what independent tuning without a shared on-fill check produces. The dark failure
is the worst case: it is the Failed/Unanswered badge — the app's own "real failure grabs the eye"
decision is its least readable element.

### 2 · HIGH · Layout
**Location:** `features/testing/RunsView.tsx:632`.
**Before:** `<div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]
[&::-webkit-scrollbar]:hidden">` — measured at 1100px: `clientWidth` 160 vs `scrollWidth` 498, 338px
(68%) hidden, `scrollbar-width: none`.
**After:** Keep the scroll, restore the cue: add an edge fade mask (`mask-image: linear-gradient(to
right, black 85%, transparent)`) or let the next control peek 16–32px. Better, wrap the row — the sibling
`FilterControls.tsx:97` already sets `flex-wrap`.
**Why:** Hint at hidden content. At an ordinary laptop width the Type facet, Filter button, Show-forks
toggle and row-count badge are invisible with zero affordance — no scrollbar, fade, chevron or peek.
Discovery requires a trackpad gesture or keyboard focus auto-scroll. Verified in-page, not inferred.

### 3 · HIGH · Accessibility
**Location:** `components/AppShell.tsx:643` + `:332-362`; `vendor sidebar.tsx:293-300`, `:203-215`.
**Before:** Live DOM on every route: two `<main>` elements, one nested inside the other (`SidebarInset`
renders `<main>`, and `mainRegion` renders another inside it). The only `<nav>` is the breadcrumb; the
primary sidebar is `<div data-slot="sidebar">` with no role and no accessible name. No skip link —
measured 22 focusable stops before the first content element, 16 of them the sidebar.
**After:** Render the shell wrapper as a `<div>` and keep one `<main>`; give the sidebar `<nav
aria-label="Sections">`; add a "Skip to content" link as the first focusable element targeting the
`<main>`. The pattern already exists in-repo — `SettingsView.tsx:381` is a correctly labelled `<nav
aria-label="Settings sections">`.
**Why:** Structure is navigation. Two main landmarks is invalid HTML and leaves no unambiguous "content"
target; the app's actual navigation is not a landmark at all, so landmark-based jumping is impossible;
and with no bypass link every keyboard user re-traverses 22 stops on every navigation.

### 4 · HIGH · Accessibility
**Location:** `components/FieldRow.tsx:24-34` (the canonical field wrapper, plus ~16 forms built on it).
**Before:** `<Label htmlFor={id}>{label}</Label>` / `{children}` / `{error ? <Text variant="meta"
className="text-destructive" role="alert">{error}</Text> : null}` — the error `<Text>` has no `id`, and
`FieldRow` never sets `aria-describedby` on the control. 45 sites set `aria-invalid`; only 6 in the whole
app wire `aria-describedby`.
**After:** Give the error an `id={`${id}-error`}`, pass `aria-describedby={error ? `${id}-error` :
undefined}` down to the control, and keep `role="alert"` for the announcement on first render.
**Why:** Errors that announce. The field announces "invalid" with no reason attached. On refocus — the
exact moment a screen-reader user returns to fix it — the message is not part of the accessible
description. `aria-errormessage` is absent app-wide. One component fix propagates to every form.

### 5 · HIGH · Accessibility
**Location:** `main.tsx:66`; 176 `toast.error(…)` call sites; `features/watch/PromoteToTestDialog.tsx:76-82`.
**Before:** `<Toaster richColors closeButton position="top-right" offset={64} />` — no `duration`, and no
call site overrides it, so every toast uses sonner 1.7.4's `TOAST_LIFETIME = 4000` ms. That includes all
176 error toasts and the one toast carrying an action (`action: { label: "Open collection" }`).
**After:** `<Toaster duration={4000} />` for successes, but pass `duration: Infinity` on `toast.error(…)`
and on any toast with an action — sonner supports per-call duration.
**Why:** Toasts carrying actions or errors stay until dismissed. A 4-second error is unreadable for many
users and unreachable by keyboard; an actionable toast that expires is WCAG 2.2.1 (Timing Adjustable).
`closeButton` gives manual dismissal but does not extend the clock.

### 6 · MEDIUM · Accessibility
**Location:** `vendor card.tsx:260-264`; rendered on `ScansTab.tsx:270,327,381,510,536`,
`ServersView.tsx:687,719,740,778`.
**Before:** `CardTitle` is `<div className="text-title leading-none">` — not a heading. Live DOM on Runs,
Servers and Dashboard returns exactly one heading each: the `sr-only` h1. The Dashboard's five visible
sections ("Since your last visit", "Needs attention", "Biggest movers", "Latest server footprint",
"Recent scan activity") carry no heading semantics.
**After:** Have `CardTitle` accept an `as`/`level` prop and render `<h2>`/`<h3>` where it titles a real
section, keeping `text-title` for the visual. Leave decorative card titles as `div`.
**Why:** Structure is navigation. On the busiest screen in the app a screen-reader user has no way to
move between sections. This is a consequence of D-TB1 (retiring visible page titles) being applied to the
visual layer without giving the semantic layer a replacement — note the resulting inversion: `CardTitle`
renders at 15px/600 while page identity sits at 13px in a breadcrumb `<li>`.

### 7 · MEDIUM · Accessibility
**Location:** `features/testing/RunConsole.tsx` (only `aria-live` is the search counter at `:1268`);
`components/TableToolbar.tsx:66-70` and its 6 count call sites.
**Before:** The SSE run stream has no live region — streamed turns, tool calls and status transitions are
silent. Filtered result counts ("12 of 90 rows", "33 of 101 scans") render in an inert `<div>`.
**After:** Wrap the transcript in `role="log" aria-live="polite"`, and render the result count into a
stable, always-present `role="status"` region whose text updates. `features/hub/AgentTranscript.tsx:62-64`
already does the first correctly — copy it.
**Why:** Announce dynamic content. The two things that change without user action — the stream and the
filtered count — are the two that are never announced. Note also that every `role="alert"` in the app is
conditionally mounted rather than updated in a stable region, which is unreliable across AT/browser pairs.

### 8 · MEDIUM · Accessibility
**Location:** `features/testing/run-launcher/RunLauncher.tsx:726-730, 804-808` and `:441`;
`features/testing/suites/SuiteEditor.tsx:551`; `features/hub/meta-rail/MetaRail.tsx:135-146`.
**Before:** Validation focus targets are `className="… outline-none"` with no replacement ring —
`document.getElementById("launcher-tests")?.focus()` moves focus to an element that shows nothing.
Separately, `MetaRail` stays mounted when closed with `aria-hidden` + `pointer-events-none`, but its
`<Button aria-label="Hide the rail">` and section tree remain in the tab order.
**After:** Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to the three
focus targets. For the rail, add `inert` when closed (it removes both pointer and tab access in one
attribute) instead of `aria-hidden` + `pointer-events-none`.
**Why:** Visible focus rings / `aria-hidden` never on focusable content. Validation succeeds at moving
focus and then hides where it went — the user is told "fix the highlighted fields" with no visible
cursor. And focus can enter a region the accessibility tree says does not exist. The app's focus
discipline is otherwise excellent (`:focus-visible` + `ring-2` + offset throughout, zero positive
`tabindex`), which makes these three the exceptions worth closing.

### 9 · MEDIUM · Typography
**Location:** `features/compatibility/CompatibilityView.tsx:505-520`; `vendor card.tsx:273`
(`CardDescription`); `features/assistant/AssistantMessageBody.tsx:35,55`; `features/skills/SkillOverview.tsx:550-553`.
**Before:** Measured in-page at 1600px: the "Not everything is automated" callout runs 1240px = **190
characters per line** at 13px. `max-w-prose` appears zero times in the app; `PageShell` defaults to
`width="full"` and only 4 of 25 call sites pass `centered`.
**After:** Cap prose containers at ~65–75ch — `max-w-[68ch]` on `AlertDescription` bodies,
`CardDescription`, the rendered SKILL.md block and the assistant message body. `StatePanel` already caps
its description at `max-w-sm`; extend the same idea.
**Why:** Cap the measure. 190ch is roughly 2.5× the readable range — the eye loses the line return. This
only affects genuine prose; tables and dense rows correctly stay full-width.

### 10 · MEDIUM · Typography
**Location:** `features/testing/runs/RunTableRow.tsx:174-178`; `features/hub/workforce/AgentCard.tsx:230-234`
and `CrewCard.tsx:59-63`; `vendor select.tsx:22`.
**Before:** Confirmed in the live DOM: `<TableCell className="max-w-[12rem] truncate">` renders `the vendor
Answers — ontime-assistant` clipped with no `title`, no tooltip. Agent/crew descriptions use
`line-clamp-2` with no recovery. `SelectTrigger` ships `[&>span]:line-clamp-1` with no `title`, so every
select in the app clips its value — including `CompatibilityView.tsx:545`'s composed `${server} · ${date}
· ${n} tools` label. Recoverability pass: **82 recoverable, 249 not**.
**After:** Add `title={value}` at minimum; better, adopt the pattern already in the same feature —
`features/hub/agents/AgentBriefPreview.tsx:13-33` pairs `line-clamp-2` with `title` and a `HoverCard`
carrying the full text.
**Why:** Truncate without losing content. These are user-authored names and descriptions — precisely the
strings that distinguish one row from another. The correct pattern exists three directories away and was
not applied.

### 11 · MEDIUM · Colors
**Location:** `themes.css:595/612` and `:619/632` (both themes); `lib/status.ts:88-112`;
`features/scans/scanDelta.tsx:88`; `features/compare/CompareView.tsx:881`;
`compare/matrix/DeltaMatrix.tsx:352-354`; `compare/suite/suite-data.ts:48-53`;
`features/testing/suites/SuiteDeltas.tsx:245`.
**Before:** Verified at runtime: `--primary` and `--success` are byte-identical, and `--ring` and
`--info` are byte-identical, in both themes. Downstream, green carries 6 meanings, amber 7, red 8, blue 7.
"Delta got worse" is amber on Scans and red on all five Compare surfaces; "delta got better" is
`text-success` everywhere except `text-primary` at `SuiteDeltas.tsx:245`.
**After:** Split the tokens: give `--success` its own value distinct from `--primary`, and `--ring` its
own distinct from `--info`. Then pick one delta convention and apply it — the locked decision D-UX9
already exists (`planning/Roadmap/RM-30-ux-overhaul/STATUS.md:143`), it is simply implemented three ways.
**Why:** One color, one meaning. Because `--ring === --info`, a keyboard user tabbing the Runs feed sees
focus rings at the same lightness and chroma as the "Running" chips beside them — the focus indicator is
camouflaged by content. And a filled green button (action), a green chip (success) and a green delta
(improvement) can share one screen with only position to disambiguate. `features/compatibility/meta.ts:59-62`
reserves blue for "Running" and then breaks that reservation 40 lines later at `:99`.

### 12 · MEDIUM · Writing
**Location:** 28 InlineError sites; `components/ErrorBoundary.tsx:22`;
`features/issues-fleet/IssueLifecycleActions.tsx:53`;
`features/skills/design/UnifiedEditor.tsx:271,392,428`; `features/settings/SettingsView.tsx:2435` vs `:2848`.
**Before:** Four competing error voices in one product: "Couldn't …" (28 sites), "Could not …" (~75),
"Failed to …" (~9), "`<Noun>` failed" (~14, incl. "Action failed"). Most state the failure and stop:
"Couldn't load quality", "Couldn't load the org rail", "Something went wrong", "Can't connect those".
Even the apostrophe is inconsistent inside one file ("Could not save token" vs "Couldn't save the client
ID").
**After:** Pick one opener ("Couldn't …", curly apostrophe) and add a next step to each. The app already
contains its own target voice — `RunConsole.tsx:822`: "… The console will resume automatically when the
connection recovers."; `GradePanel.tsx:142`: "… Configure the LLM judge, then re-grade."
**Why:** Errors say how to fix. Four voices read as four products. "Couldn't load the org rail" names an
internal widget, not a user concept; "Action failed" names nothing at all. Note what is already right and
should be preserved: zero instances of blaming the user, zero "Oops", zero exclamation marks.

### 13 · MEDIUM · Writing
**Location:** `features/hub/projects/ProjectLibraryPanel.tsx:267`;
`features/hub/agents/CrewLibraryPanel.tsx:161`; `features/hub/agents/RoleLibraryPanel.tsx`; +3 more
filter/search empty states.
**Before:** `title = "No projects match your filter"`, `description = (none)`, `actions = (none)` — and
`CrewLibraryPanel` explicitly sets `description: undefined` on the filtered branch.
**After:** Echo the query and offer the exit: `No projects match "quarterly"` with a Clear filters
action. `EmptyState` already accepts both props.
**Why:** Search and filter empty states name the query and offer an exit. A dead end at exactly the moment
the user has mistyped. This is the one weak spot in an otherwise strong set — the other ~114 empty states
explain what would appear and when, which is genuinely above average.

### 14 · MEDIUM · UI
**Location:** `features/settings/SettingsView.tsx:634,652,779,1069,2538,2975,3219`;
`features/hub/meta-rail/ProgressSection.tsx:152,245`; `OutputsSection.tsx:159`;
`features/review/RubricEditorDialog.tsx:156`; +16 more (27 total).
**Before:** Hand-rolled card surfaces: `rounded-lg border border-border bg-card p-3` — border, no
`shadow-sm`, where the system's real `Card` is `rounded-lg border bg-card shadow-sm`. In the meta rail,
`ProgressSection.tsx:152` (`rounded-md` + `p-2.5`) nests `:245` (`rounded-md`), giving two hairlines 10px
apart inside `RailSection`'s own `border-b` — three border weights within ~13px. Settings also splits
`rounded-lg` and `rounded-md` for the identical "muted inset panel" pattern within one file.
**After:** Use `<Card>` for card-shaped things so elevation comes from the shared token, and drop the
inner border in the meta rail — a `bg-background` fill alone separates the nested row.
**Why:** Shadows for elevation, borders for structure. These read visibly flatter than the real Cards
beside them, and stacked hairlines are the accumulation the rule exists to prevent. Worth stating:
`transition: all` appears zero times app-wide and every transition enumerates its properties — this
domain is otherwise disciplined.

### 15 · LOW · Typography
**Location:** `apps/web/index.html:9` (`<body>` has no class); `apps/web/src/styles/app.css:15-23`.
**Before:** `-webkit-font-smoothing` is absent from the entire app and every `@elabs-ai/components-*` package. Verified
at runtime: `getComputedStyle(document.body).webkitFontSmoothing === "auto"`. Independently confirmed from
the build — Tailwind's `.antialiased` rule is never emitted into the bundle.
**After:** Add `antialiased` to `<body>` in `index.html`, or `-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;` to the existing body rule in `app.css:19`.
**Why:** Font smoothing on the root. On macOS all text renders heavier than intended — most visible at the
app's 13px compact body size on dark. Highest leverage-to-effort item in the review: one line, zero
risk, affects every glyph.

## Considered but Rejected

| Location | Candidate | Rejected because |
|---|---|---|
| `vendor button.tsx:7` — `active:scale-[0.98]` | Raise press feedback to `scale(0.96)` per better-ui principle 9 | 0.98 sits inside the rule's stated floor ("never below 0.95"), the app has zero overrides to reconcile, and the value is owned by the shared design system serving other products. A 2% depression is subtle, but changing a vendored token to satisfy a 0.96 preference is not a user-benefit change the app can make locally. |
| 22 files mixing `size-3.5` / `size-4` / `size-5` icons, incl. `PublishGithubDialog.tsx` and `PushGithubDialog.tsx` | Normalize icon sizing per surface | Per-file counts cannot distinguish "header uses size-5, rows use size-3.5" (a correct hierarchy) from three sizes colliding in one row (the actual defect). better-interface forbids reporting a visual finding from source alone — I did not run the per-row visual check, so this stays unreported rather than becoming a guess. |
| Every rounded child inside a padded Card | Apply concentric radius (outer = inner + padding) | `--radius` resolves to 4px in both shipped themes (`--decoration: 0`), so `rounded-lg` = 4px and `rounded-md` = 2px. The mathematically-correct inner radius is always 0, making the maximum possible error 4px and the typical error 2px — not perceptible. The visible issue in these same components is the doubled border, which is finding 14. |
| All text inputs at 13px (Input, Textarea, SelectTrigger, CommandInput) | Apply `text-base sm:text-sm` to prevent iOS Safari input zoom | This is a desktop operator console: only 63 of 518 components use any breakpoint prefix, there is no responsive typography, and `AppShell` is `h-dvh overflow-hidden`. The standard remedy would also silently fail here — `app.css:82` folds `--text-base` to 13px under compact, so `text-base` is not 16px. A latent defect with no current users, and the obvious fix is wrong. |
| 89 physical `ml-`/`mr-`/`pl-`/`pr-` vs 30 logical `ms-`/`me-`/`ps-`/`pe-`; `left-*` used 28×, `start-*` 0× | Convert to logical properties | There is no RTL support anywhere in the app — zero `dir=` attributes, `<html lang="en">` only, and no i18n layer. Converting ~90 sites now is churn with no user benefit. Worth doing as part of an i18n project, not before one. |
| Repeated `border-b` on list rows and the compact 13px/11px type scale | Replace separators with spacing; loosen density | better-layout explicitly says to preserve "deliberate platform chrome, compact professional tools, and project tokens when they remain usable under hit-area, zoom, localization and viewport stress tests." The density here is a deliberate, documented product decision (`main.tsx:54`, `app.css:54-111`) for a dense data tool, and it survives the stress tests I ran. |

## Verification

**Checks run — passed / observed:**

| Check | Method | Result |
|---|---|---|
| On-fill contrast, both themes | oklch→sRGB conversion in-page + WCAG ratio on `--{primary,destructive,success,warning,info}` ⇄ `-foreground` | bright: primary 4.31, success 4.31, info 3.76 **FAIL**; destructive 5.20, warning 6.59 PASS. dark: destructive 3.02 **FAIL**; primary 8.24, success 8.24, warning 8.40, info 6.58 PASS |
| Full-page rendered-pair scan | Every text node vs its composited background, 5 routes × 2 themes | Bright: 1–2 distinct failures per route, all traced to finding 1. Dark: 2, both the destructive fill. No other contrast failures found |
| Token identity | `getComputedStyle(document.documentElement)` | `--primary === --success` and `--ring === --info` confirmed in both themes |
| Landmarks / headings / nav | Live DOM query on Runs, Dashboard, Servers, Skills, Compatibility | 2 nested `<main>`; only `<nav>` is the breadcrumb; sidebar is a `<div>` with no role/name; 1 heading per route, `sr-only` |
| Keyboard traversal | Enumerated 460 visible focusables, located first element inside `main.app-shell-main` | 22 stops before content, 16 in the sidebar; no skip link |
| Toolbar overflow | `clientWidth`/`scrollWidth` on the Runs filter row | at 1100px: 160 visible of 498 → 338px (68%) hidden, `scrollbar-width: none` |
| Reflow | Window resized to 514px (Chrome floor) and 1100px | No document-level horizontal scroll; but the `ml-auto … shrink-0` actions cluster extends 157px past the viewport at 514px and "New run" is unreachable |
| Prose measure | Character-width probe against rendered container widths at 1600px | Compatibility callout = 190 ch/line at 13px |
| Font smoothing | `getComputedStyle(document.body).webkitFontSmoothing` | "auto" — antialiasing not applied |
| Truncation recovery | Live scan for clipped/clamped text lacking title/aria-label/tooltip | Confirmed on the Runs Environment column (`the vendor assistant — ontime-assistant`, `max-w-[12rem]`, no recovery) |
| Both themes rendered | Full walk in light and dark | No unthemed surface, no raw color, no broken token — dark is independently tuned, not a mechanical inversion |

**Not verified — stated rather than converted into findings:**

- **Toast expiry not observed.** Finding 5 rests on config evidence: sonner 1.7.4's `TOAST_LIFETIME =
  4000`, `<Toaster>` with no `duration`, and no `duration` override at any of 176 `toast.error` call
  sites. I did not trigger and time a real error toast.
- **Screen-reader announcement not tested.** Findings 4, 6 and 7 are structural (missing
  `aria-describedby`, missing headings, missing live regions). Whether a given AT/browser pair announces
  a conditionally-mounted `role="alert"` needs a real screen-reader pass.
- **`prefers-reduced-motion` not exercised.** The token layer ships a global `*` clamp
  (`themes.css:1310-1320`) setting `animation-iteration-count: 1 !important`, which may leave spinners
  frozen mid-rotation. Needs a browser with the OS flag set.
- **200% zoom not tested** — only viewport resize. The `h-12` toolbar and `h-14` top bar are fixed
  heights that could clip text at 200%.
- **Below 514px not tested** — Chrome would not size the window smaller, so WCAG 1.4.10's 320px reflow
  requirement is unconfirmed.
- **Icon size collisions** — per-row visual check not run (see Considered but Rejected).
- **Not inspected at all:** SkillFlow Design/Trace canvas, the vendor assistant surfaces, live suite runs, OAuth
  flows.

## Verdict

**Block — five HIGH findings remain.**

Findings 1 and 3 are the two to clear first: the contrast failures are measured, systemic, and land on
the app's primary action and its failure status; the landmark structure makes the whole application
unnavigable by assistive technology regardless of how good the per-component work is. Both are small,
contained changes — a token pass and a shell-semantics pass.

The rest of the picture is genuinely strong and worth stating plainly: zero raw colors, zero positive
`tabindex`, zero `transition: all`, zero placeholder-only labels, `aria-invalid` on 45 fields,
`focus-visible` rings with offsets throughout, `tabular-nums` systematically applied to every live
numeric surface, 120 mostly-excellent empty states, and 21 of 21 destructive confirmations labelled with
their consequence. The findings above are the exceptions in a codebase with high discipline — not a
survey of its normal state.
