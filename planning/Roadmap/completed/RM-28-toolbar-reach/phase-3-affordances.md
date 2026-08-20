---
type: "Work Package Spec"
title: "Phase 3 \u2014 Icon affordances at scale \u00b7 Batch E"
description: "Four parallel WPs. Depends on 1.3 merged (the IconButton primitive + D-TB5 rule). Runs after Batch D"
tags: ["roadmap", "RM-28"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 3 — Icon affordances at scale · Batch E

Four parallel WPs. **Depends on 1.3 merged** (the `IconButton` primitive + D-TB5 rule). **Runs after Batch D
fully merges, not overlapped** — WP 2.8 is cross-cutting (`ScansView`, `ProjectLibraryPanel`, `DirectoryTab`,
`SkillInspector`) and every one of those files is inside a Batch-E domain, so overlapping would put two
agents in the same file. Split **by feature directory** so the domains are disjoint; the four are made
**collectively exhaustive** over `apps/web/src` so the WP 4.1 guardrail hook (reject `title=` on a text-less
`<Button>`) can pass with no grandfather list.

The audit measured **~124 icon-only buttons**: ~14 already have a Radix `Tooltip`, ~20 use a bare `title`,
~89 have `aria-label` only and show **nothing on hover**. This phase converts them all to `IconButton`.

## The identical brief for all four WPs

Read [`conventions.md`](./conventions.md) and `.claude/rules/icon-affordances.md` (D-TB5, shipped by 1.3).
Within your Domain:

1. **Convert every icon-only control to `IconButton`** — one `label` per control, producing both the tooltip
   text and the `aria-label` from that one prop. This covers both the `aria-label`-only buttons (add the
   tooltip) and the bare-`title` buttons (replace `title` with the tooltip).
2. **Delete every `title` on a text-less `<Button>`.** After conversion, grep your domain for `title=` on a
   `<Button>`/`IconButton` with no text child — there should be none.
3. **DO NOT strip `title` from text-bearing elements.** A `title` on a truncated **value/prose** element
   (a clamped description, a truncating select value, a name that ellipsises) is legitimate D-10 recovery and
   **stays**. D-TB5 bans `title` *only* on a text-less `<Button>`. When in doubt, if the element renders
   visible text, keep its `title`.
4. **Wire disabled reasons** via `IconButton`'s `disabledReason` (tooltip + `aria-describedby`).
5. **Do NOT invent labels.** Where a control's purpose is unclear from context, **report it** to the PM
   rather than guess — the app's icons are not all conventional (`GitFork` / `ScanLine` / `Grid3x3`).
6. **Don't regress §E** — the ~14 already-tooltipped buttons keep working; don't double-wrap them.

Report back: count of controls converted, any labels you couldn't determine (listed), and confirmation that
grep for `title=`-on-text-less-`<Button>` in your Domain is clean.

---

## WP 3.1 — Shared chrome + form kit (the `title` sites first — highest reuse)

- **Domain (exact):**
  - `apps/web/src/components/**` (the form kit `components/form/**` — `ListEditor` `:59`, `KeyValueEditor`
    `:119`, `TagInput` `:76`, `SliderNumber` `:94` are the reused `title` sites the audit names first;
    `AppShell.tsx`; and any other icon buttons under `components/`) + co-located tests
  - `apps/web/src/features/notifications/**`
  - `apps/web/src/features/testing/ExpandableTable.tsx` (a shared table primitive; carved out of 3.3's domain)
- **Depends:** 1.3 · **Size:** M · **parallel** · **Batch E** · **Model:** sonnet, effort **medium**.
- **Do first** — the form-kit primitives are reused across every feature; converting them once fixes the
  most call sites (D-7#3). **Do not** touch `IconButton.tsx` itself (1.3 owns it) beyond importing it.

**Acceptance:** all icon-only controls under `components/**` + `features/notifications/**` +
`ExpandableTable.tsx` are `IconButton`s (tooltip === aria-label); form-kit primitives (`ListEditor`,
`KeyValueEditor`, `TagInput`, `SliderNumber`) no longer use `title`; grep-clean for `title`-on-text-less-
`<Button>` in the Domain; a spot-check on the running app shows tooltips on the form-kit add/remove buttons in
both themes; gate green + tests.

---

## WP 3.2 — Servers + Scans + Compare + Reports

- **Domain (exact):** `apps/web/src/features/servers/**`, `apps/web/src/features/scans/**`,
  `apps/web/src/features/compare/**` (the **scan** compare), `apps/web/src/features/reports/**` + tests.
- **Depends:** 1.3 · **Size:** S · **parallel** · **Batch E** · **Model:** sonnet, effort **low**.
- Forks after Batch D (so it sees 2.8's ScansView count change and 2.3's compare bar). The audit's icons here
  include the non-conventional `ScanLine` — label it clearly.

**Acceptance:** all icon-only controls in these four directories are `IconButton`s; grep-clean for
`title`-on-text-less-`<Button>`; spot-check on the running app (servers list/detail action icons, scan-detail
export/diff icons) in both themes; gate green + tests. Report any unclear labels.

---

## WP 3.3 — Testing

- **Domain (exact):** `apps/web/src/features/testing/**` (**except** `ExpandableTable.tsx`, owned by 3.1),
  plus `apps/web/src/features/watch/**` and `apps/web/src/features/review/**` (testing-adjacent) + tests.
- **Depends:** 1.3 · **Size:** M (the largest icon surface) · **parallel** · **Batch E** · **Model:** sonnet,
  effort **low**.
- **Includes the D-6/D-7 disabled-Export case:** `features/testing/compare/CompareBar.tsx:372-384`'s
  *"Add a second run to export a comparison"* currently exists **only as a `title`** on a disabled control —
  convert it to `IconButton` with `disabledReason="Add a second run to export a comparison"` (tooltip +
  `aria-describedby`). Note WP 0.1/0.2 already touched `RunConsole`/`RunBar`/`RunConsoleRoute` (Batch A,
  merged) — this WP forks well after; no overlap.

**Acceptance:** all icon-only controls under `features/testing/**` (minus ExpandableTable) + `features/watch/**`
+ `features/review/**` are `IconButton`s; the CompareBar disabled-Export reason is a wired `disabledReason`;
grep-clean for `title`-on-text-less-`<Button>`; spot-check on the running app (Runs feed row actions, launcher,
suites) in both themes; gate green + tests. Report unclear labels.

---

## WP 3.4 — Hub + Skills + Compatibility + Assistant + Dashboard + Issues + Settings

- **Domain (exact):** `apps/web/src/features/hub/**`, `apps/web/src/features/skills/**`,
  `apps/web/src/features/compatibility/**`, `apps/web/src/features/assistant/**`,
  `apps/web/src/features/dashboard/**`, `apps/web/src/features/issues-fleet/**`,
  `apps/web/src/features/issues/**`, `apps/web/src/features/settings/**` + tests.
- **Depends:** 1.3 · **Size:** M (the other large surface) · **parallel** · **Batch E** · **Model:** sonnet,
  effort **low**.
- **Includes two named fixes:**
  - **The single missing accessible name** in the whole app: `features/hub/memory/EffectiveMemoryStack.tsx:151`
    — give it a real `IconButton` label (the 124th button, per the audit).
  - **SkillInspector's mixed mechanisms:** `SkillInspector.tsx:578` uses `title` for the gear while `:611-648`
    uses Radix Tooltips for Pull/Push under a comment asserting the convention; `SkillRail.tsx:87`'s "Add
    skill" has neither. Unify all three onto `IconButton`.
- Forks after Batch D — so it sees 2.8's `SkillInspector`/`ProjectLibraryPanel`/`DirectoryTab` edits and
  2.6/2.1's dashboard edits; only add `IconButton` affordances, don't undo those.

**Acceptance:** all icon-only controls across these eight directories are `IconButton`s; the
`EffectiveMemoryStack.tsx:151` control now has an accessible name **and** tooltip; SkillInspector's gear /
Pull / Push / SkillRail add-skill are all `IconButton`; grep-clean for `title`-on-text-less-`<Button>`;
spot-check on the running app (hub workforce icons, skills inspector, dashboard) in both themes; gate green +
tests. Report unclear labels.

> **If the cap is raised for Batch E** (owner option per the README): split 3.4 into **3.4a**
> (`hub/**` + `skills/**` + `compatibility/**`) and **3.4b** (`assistant/**` + `dashboard/**` +
> `issues-fleet/**` + `issues/**` + `settings/**`), and optionally split 3.3's `watch/**` + `review/**` out.
> The domains are already disjoint by directory, so this is a clean subdivision, not a rewrite.
