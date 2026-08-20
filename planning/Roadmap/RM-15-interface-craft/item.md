---
type: "Roadmap Item"
title: "Interface Craft — write the six rules that were never written"
description: "Close the fifteen findings of the cross-discipline interface review by writing and applying the accessibility, layout, writing, typography, colour and component rules the app had been following only by habit."
tags: ["roadmap", "RM-15"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# Interface Craft — write the six rules that were never written

## Goal

Close the fifteen findings of the cross-discipline interface review by writing and applying the accessibility, layout, writing, typography, colour and component rules the app had been following only by habit.

## Why it matters

A cross-discipline review returned a blocking verdict on five high findings, all of them symptoms of standards that existed in people's heads but nowhere in the repository.

## Milestones

- [ ] Phase 0 — independent structural fixes.
- [ ] Phase 1 — structure.
- [ ] Phase 2 — consistency.
- [ ] Phase 3 — voice.
- [ ] Phase 4 — close and guardrails.

## Linked research

No linked research yet.

## Plan overview (from the original plan README)

**Priority: HIGH.** Base branch: **`ui/interface-craft`** (cut from `main` 2026-07-25, after
toolbar-reach merged). The PM/owner merges validated WP branches into it and decides when it goes to
`main`. Nothing is pushed to origin by this plan.

Source of truth: `docs/INTERFACE-REVIEW-2026-07-25.md` —
a cross-discipline interface review produced with the `better-interface` skill coordinating six domain
skills (accessibility, layout, writing, typography, colors, ui). 15 findings (1…15), each with a
`path:line`, the current implementation, a proposed fix, and a **measured or source-verified basis**;
plus a **Considered but Rejected** table (5 candidates — do not resurrect them) and a **Verification**
section separating what was measured from what was only stated. Verdict: **Block — five HIGH findings**.

---

## The thesis

**toolbar-reach finished applying standards the project had already written down. This plan is
different: these are gaps where no standard existed.**

The design system is disciplined — zero raw colors, zero positive `tabindex`, zero `transition: all`,
zero placeholder-only labels, `tabular-nums` on every live numeric surface, 21 of 21 destructive
confirmations labelled with their consequence, `focus-visible` rings with offsets throughout, 120
mostly-excellent empty states. The findings here are the **exceptions in a high-discipline codebase**,
not a survey of its normal state.

What is missing is a **rule** for the six things below, so each drifted independently:

1. **on-fill contrast** — no shared "every fill clears AA against its foreground" check, so each theme
   fails a different pair;
2. **landmark semantics** — the shell grew two `<main>`s, an unnamed sidebar, and no skip link;
3. **error association** — `aria-invalid` on 45 fields, `aria-describedby` on 6;
4. **notification timing** — every error and the one actionable toast expires at 4000ms;
5. **prose measure** — no `max-w-prose` anywhere; worst line is 190 characters;
6. **error voice** — four openers coexist across ~180 strings.

This plan **writes those six rules** (D-IC1…D-IC11), **applies them**, and **asserts them in CI** so
they cannot drift back.

---

## Reconciliation with toolbar-reach (the world moved)

The kickoff for this plan assumed toolbar-reach was **in-flight** (Batch A running, zero WPs ticked)
and built a two-track architecture to avoid colliding with it. **That is no longer true.** As of
2026-07-25 toolbar-reach is **PROGRAM COMPLETE and merged into `main`** (merge commit `6f66f5b`;
`git merge-base --is-ancestor ui/toolbar-reach main` = yes). Consequences:

- **The Track 1 / Track 2 split is collapsed.** There is no concurrent plan to collide with; the
  toolbar-reach domains are frozen in `main`. All batches (G → H → I → J → K) run **sequentially on
  one branch** (`ui/interface-craft`, cut from the merged `main`). No rebase-after-toolbar-reach step
  is needed — it has already landed.
- **Phase 0 amendments, restated for the merged world:**
  - **0.a (finding 2, HIGH — Runs filter overflow)** could not be added to toolbar-reach as a "WP 2.9"
    because that plan is shipped. It is **migrated into this plan as WP 0.4** (Batch G). Its dependency
    (D-TB7 `ViewToolbar` owns `left` as flex-wrap) is already satisfied — D-TB7 is in `main`.
  - **0.b (finding 10 remainder — Crew/Agent card truncation)** could not extend toolbar-reach WP 2.8
    (shipped). `AgentCard.tsx` already got a `title` via a toolbar-reach PM touch-up
    (`AgentCard.tsx:186,234`); **`CrewCard.tsx:60` did not**. The remainder is **folded into WP 2.1**.
  - **0.c (D-TB1 amendment — section-titling cards need a semantic heading)** is recorded, as
    instructed, next to the original D-TB1 in
    [`roadmap/ux-overhaul/toolbar-standard-2026-07-11.md`](../RM-30-ux-overhaul/toolbar-standard-2026-07-11.md)
    and cross-linked from [`roadmap/toolbar-reach/README.md`](../RM-28-toolbar-reach/item.md). It is
    restated here as **D-IC5** and implemented by **WP 1.1**.
- **The kickoff's "Sequencing note — Track 2 cannot overlap toolbar-reach" is obsolete.** It mapped
  every remaining finding to a colliding toolbar-reach WP. Those WPs are merged, so there is nothing
  live to collide with. The collision that still matters is **within this plan** (e.g. WP 2.2 must
  land after WP 0.1 splits `--success` from `--primary`, or `SuiteDeltas.tsx`'s `text-primary` bug
  stays invisible), and that is encoded in the batch dependencies below.

**Post-merge drift the review's `file:line`s predate** (the review was run against a pre-merge tree;
sub-agents treat Domain as a file list and locate current lines — [`conventions.md`](./conventions.md)
§5 lists these so they are not re-discovered):

- **`components/TableToolbar.tsx` is deleted.** Finding 7's "`TableToolbar.tsx:66-70` + its 6 count
  call sites" no longer exists — result counts now render via `ViewToolbar`'s `results` slot
  (`Badge variant="secondary" className="tabular-nums"`). WP 1.2 must re-locate the count sites.
- **Finding 2's line drifted** `RunsView.tsx:632 → :733`; the derived-toggle green `:662 → :764`. The
  defect itself is intact.
- **`AgentCard.tsx` already carries `title`** (toolbar-reach WP 2.8). WP 2.1 targets `CrewCard.tsx`
  and re-verifies AgentCard rather than re-applying it.

---

## Locked owner decisions (D-IC1–D-IC11, locked 2026-07-25)

The owner holds authority here and has locked these; sub-agents implement to them, they don't
relitigate them. Every number below is **measured** in the review (oklch→sRGB + WCAG ratio;
`getComputedStyle`; live-DOM queries), not asserted.

### D-IC1 — On-fill contrast is a gate, not a review item
Every `--<role>` ⇄ `--<role>-foreground` pair clears **WCAG AA 4.5:1** in **both** themes, asserted by
a test that runs in the gate (`tokens-contrast.test.ts`). **Measured today (fails):**
`light` `--primary` **4.31**, `--success` **4.31**, `--info` **3.76**; `dark`
`--destructive` **3.02**. (Passing today, must stay passing: bright `--destructive` 5.20 / `--warning`
6.59; dark `--primary`/`--success` 8.24, `--warning` 8.40, `--info` 6.58.) The dark `--destructive`
failure is the worst case — it is the Failed/Unanswered badge, the app's own "real failure grabs the
eye" element rendering as its least readable.

### D-IC2 — Semantic tokens hold distinct values
`--success` ≠ `--primary` and `--ring` ≠ `--info`. They are **byte-identical today** in both themes
(confirmed via `getComputedStyle`), which is why a focus ring renders at the same lightness and chroma
as a "Running" chip, and a filled green button / green success chip / green improvement delta can share
one screen with only position to disambiguate.

### D-IC3 — One delta convention, implemented once
Reaffirm **D-UX9** ([`roadmap/ux-overhaul/STATUS.md:143`](../RM-30-ux-overhaul/STATUS.md)) and move it into a
single shared helper (`lib/delta.ts`). **No view computes its own delta tone.** Today six surfaces
disagree: "worse" is amber on Scans and red on all five Compare surfaces; "better" is `text-success`
everywhere **except** `text-primary` at `SuiteDeltas.tsx:245`.

### D-IC4 — The shell has exactly one `<main>`, a named `<nav>`, and a skip link
Today: **two nested `<main>`s**, the sidebar is an unnamed `<div>`, no skip link, and **22 focusable
stops before content** (16 of them the sidebar). The correctly-labelled pattern already exists in-repo
at `SettingsView.tsx:381` (`<nav aria-label="Settings sections">`).

### D-IC5 — Section titles are semantic headings
The D-TB1 amendment (Phase 0.c), restated as this plan's clause: every card or panel that titles a
**real section** renders a semantic heading (`h2`/`h3`) carrying the `text-title` visual; a bare
`<div>` `CardTitle` is not acceptable for a section title. Decorative card titles stay `div`.

### D-IC6 — Field errors are programmatically associated
`aria-invalid` **plus** `aria-describedby` pointing at the error's `id`, emitted by `FieldRow` so every
form inherits it. Today 45 fields set `aria-invalid` and 6 wire a description; `aria-errormessage` is
absent app-wide.

### D-IC7 — Errors and actionable notifications do not auto-dismiss
Successes may. Today **all 176 error toasts and the one action-bearing toast** (`PromoteToTestDialog`,
`action: { label: "Open collection" }`) expire at sonner's 4000ms default. WCAG 2.2.1 (Timing
Adjustable): a toast carrying an action or an error stays until dismissed.

### D-IC8 — One error voice: "Couldn't `<verb>` `<object>`." plus a next step
Today four openers coexist — "Couldn't" (28), "Could not" (~75), "Failed to" (~9), "`<Noun>` failed"
(~14) — with curly-vs-straight apostrophes inconsistent inside one file. The app already contains its
own target voice: `RunConsole.tsx:822`, `GradePanel.tsx:142`.

### D-IC9 — Prose caps at ~68ch
Tables and dense rows are not prose. `max-w-prose` appears **zero** times in the app; worst measured
line is **190 characters** (`CompatibilityView.tsx` "Not everything is automated" callout at 1600px,
13px). Cap genuine prose containers at ~65–75ch (`max-w-[68ch]`).

### D-IC10 — Truncation always has recovery
A `title`, a tooltip, or an expand. Today **82 recoverable, 249 not**. The correct pattern already
exists at `AgentBriefPreview.tsx:13-33` (`line-clamp-2` paired with `title` + a `HoverCard`).

### D-IC11 — Card-shaped surfaces use `<Card>`
Elevation comes from the shared token (`shadow-sm`), never a hand-rolled `border` standing in for a
shadow. **27 sites** hand-roll `rounded-lg border border-border bg-card p-3` (no shadow) today, reading
visibly flatter than the real `Card` beside them.

---

## Vendor boundary — decided once

Four fixes land in code that this repo **vendors** as `@elabs-ai/components-*` tarballs, which CLAUDE.md §9 requires
owner approval to change: the failing token pairs (D-IC1/D-IC2), `CardTitle`'s missing `as`/`level`
(D-IC5), `SelectTrigger`'s uncaptioned `[&>span]:line-clamp-1` (D-IC10), and `CardDescription`'s
missing measure cap (D-IC9).

**Decision (owner, 2026-07-25): fix app-side now, file upstream for the next `@elabs-ai/components-*` bump.**
Concretely —

- **Tokens (D-IC1/2):** a `@theme` override block in `apps/web/src/styles/app.css`. `app.css` is
  app-owned; the override darkens/splits the failing token values locally and is deleted when
  brand-ui ships corrected tokens.
- **Components (D-IC5/D-IC9/D-IC10):** thin **app wrappers** in `apps/web/src/components/` —
  `SectionCardTitle.tsx` (renders `h2`/`h3` with `text-title`), a title-carrying `<Select>` wrapper,
  a measure-capped `CardDescription` usage. `components/` is app-owned and outside every
  toolbar-reach domain.

Rationale: `app.css` and `components/` are app-owned, reversible, and outside every shipped
toolbar-reach domain, so this plan does **not** block on a vendor release. **Do not bump the
`@elabs-ai/components-*` version inside this plan.** Each override is recorded as an upstream issue in
[`upstream-gaps.md`](./upstream-gaps.md) so it can be deleted when brand-ui ships the fix.

---

## Parallel execution map

Five batches. Every WP in a batch has a **disjoint file domain** — that is what makes parallel worktree
agents safe. The Domain list in each WP spec is a **contract**: a sub-agent may not touch a file
outside it ([`conventions.md`](./conventions.md) §4). Where two findings touch one file they are folded
into **one** WP.

| Batch | WPs | Width | Gate to enter |
|---|---|---|---|
| **G** | 0.1 · 0.2 · 0.3 · 0.4 | 4 | now (toolbar-reach already merged to `main`) |
| **H** | 1.1 · 1.2 · 1.3 · 1.4 | 4 | G merged (all four; H needs 0.1's tokens/DOM base) |
| **I** | 2.1 · 2.2 · 2.3 · 2.4 | 4 | H merged (2.2 also needs 0.1 — see below) |
| **J** | 3.1 solo → then 3.2a · 3.2b · 3.2c | 1, then 3 | I merged |
| **K** | 4.1 solo → then 4.2 | 1, then owner | J merged |

- **Batch G is 4 wide, not 3.** The kickoff capped G at 3 *because a fourth free domain didn't exist
  while toolbar-reach was running*. toolbar-reach is merged, so `RunsView.tsx` + `RunFilterBar.tsx`
  (finding 2, WP 0.4) is now a free, disjoint domain and the highest-stakes reconciliation item
  ("without it a HIGH finding survives both plans"). It joins G. All four G domains are disjoint:
  `app.css`+`index.html`+tokens-test · `FieldRow.tsx` · `AppShell.tsx` · `RunsView.tsx`+`RunFilterBar.tsx`.
  Within the `next-wp` hard cap of 4.
- **WP 2.2 must land after WP 0.1.** `SuiteDeltas.tsx:245`'s `text-primary` is invisible **today only
  because `--primary ≡ --success`**; once 0.1 splits them it becomes a visible green-on-wrong-token
  bug. So 2.2 (which implements D-IC3 and fixes that site) is scheduled in Batch I, after G merges.
- **Batch J's first slot is solo (WP 3.1).** 3.1 and 3.2 both edit the same `toast.error(...)` lines;
  3.1 is a mechanical call-site swap (`toast.error(` → `notifyError(`), 3.2 rewrites the strings.
  Running them concurrently or in the other order guarantees conflicts across ~180 sites.
- **Batch K's 4.1 runs last, solo.** Several of its guardrail assertions only pass once the earlier
  phases land — that is the point.
- **On the cap:** `.claude/skills/next-wp/SKILL.md` sets `maxAgents` default 4 / hard cap 4. The real
  constraint is domain disjointness, not agent count. If the cap is raised, **split 3.2 further by
  directory** rather than widening G or J.

---

## WP index

Full specs (Findings covered · Domain · Depends · Size · solo|parallel · Batch · Acceptance · Model)
live in the phase files. Authoritative in-flight state is [`STATUS.md`](./STATUS.md).

### Phase 0 — Independent structural fixes · Batch G · [`phase-0-independent.md`](./phase-0-independent.md)
| WP | Findings | Model |
|---|---|---|
| 0.1 Token contrast + semantic split + root type rendering | 1, 11 (tokens), 15 | opus · high |
| 0.2 FieldRow error association | 4 | sonnet · low |
| 0.3 Shell landmarks + skip link | 3 | opus · medium |
| 0.4 Runs feed toolbar adopts D-TB7 (finding 2, migrated 0.a) | 2 | sonnet · medium |

### Phase 1 — Structure · Batch H · [`phase-1-structure.md`](./phase-1-structure.md)
| WP | Findings | Model |
|---|---|---|
| 1.1 Section headings are semantic | 6, D-IC5 | opus · medium |
| 1.2 Live regions for streaming + counts | 7 | sonnet · medium |
| 1.3 Focus visibility + `inert` | 8 | sonnet · medium |
| 1.4 Prose measure caps | 9, D-IC9 | sonnet · low |

### Phase 2 — Consistency · Batch I · [`phase-2-consistency.md`](./phase-2-consistency.md)
| WP | Findings | Model |
|---|---|---|
| 2.1 Truncation recovery (remainder, incl. CrewCard from 0.b) | 10, D-IC10 | sonnet · medium |
| 2.2 One delta convention | 11 (deltas), D-IC3 | opus · medium |
| 2.3 Filter and search empty states | 13 | sonnet · low |
| 2.4 Card elevation consistency | 14, D-IC11 | sonnet · medium |

### Phase 3 — Voice · Batch J · [`phase-3-voice.md`](./phase-3-voice.md)
| WP | Findings | Model |
|---|---|---|
| 3.1 Notification timing (solo, first) | 5, D-IC7 | sonnet · medium |
| 3.2a One error voice — `components/**` + `features/testing/**` | 12, D-IC8 | sonnet · medium |
| 3.2b One error voice — `features/hub/**` + `features/skills/**` | 12, D-IC8 | sonnet · medium |
| 3.2c One error voice — settings/servers/scans/review/watch/issues | 12, D-IC8 | sonnet · medium |

### Phase 4 — Close · Batch K · [`phase-4-close.md`](./phase-4-close.md)
| WP | Findings | Model |
|---|---|---|
| 4.1 Guardrails (solo, last) | — | opus · medium |
| 4.2 Re-run the review (owner) | — | opus · high |

**WP 4.2 acceptance mechanism (owner decision, 2026-07-25):** the `better-interface` skill that
produced the review is **not installed here**, so the final acceptance re-run **substitutes** the
installed `brand-ui-audit` + `brand-ui-visual-ux-reviewer` agents **plus manual live probing** against
the running app (oklch→sRGB contrast, `<main>` count, focusables-before-content, `scrollWidth` vs
`clientWidth` on the Runs row, characters-per-line on the compatibility callout — the same
measurements the review used). The plan passes when the re-measured numbers clear the bar the review
set — or the only surviving findings are ones this plan deliberately deferred.

---

## What "done" means

Each WP is ticked in [`STATUS.md`](./STATUS.md) **only** when its Acceptance checklist is met **and**
the gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green on `ui/interface-craft`
after its branch merges — validated by the PM, never taken on the agent's word. In this plan,
**"verified" means you have the number**: contrast ratios per pair per theme, `<main>` count,
focusable-stops-before-content, `scrollWidth`/`clientWidth`, characters-per-line — measured against the
running app in **both** themes ([`conventions.md`](./conventions.md) §2). "Looks fine" is not a pass.

The program closes with **WP 4.2** — the acceptance re-run above — recorded as
[`verification-report.md`](./verification-report.md), a before/after **diff of numbers, not adjectives**.
