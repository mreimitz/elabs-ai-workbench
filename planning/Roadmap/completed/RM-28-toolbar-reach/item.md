---
type: "Roadmap Item"
title: "Toolbar Reach — apply the standards already locked"
description: "Close the twenty-nine findings of the UI/UX audit by settling the toolbar, route-versus-dialog and icon-affordance contracts and applying them across every view."
tags: ["roadmap", "RM-28"]
timestamp: "2026-08-20T14:03:58Z"
status: "done"
---

# Toolbar Reach — apply the standards already locked

## Goal

Close the twenty-nine findings of the UI/UX audit by settling the toolbar, route-versus-dialog and icon-affordance contracts and applying them across every view.

## Why it matters

The app had locked standards in principle and then applied them unevenly, leaving three different mechanisms for the same affordance.

## Milestones

- [x] Phase 0 — defects.
- [x] Phase 1 — settle the contract.
- [x] Phase 2 — apply it.
- [x] Phase 3 — icon affordances at scale.
- [x] Phase 4 — guardrails and acceptance.

## Linked research

No linked research yet.

## Plan overview (from the original plan README)

**Priority: HIGH.** Base branch: **`ui/toolbar-reach`** (cut from `main` 2026-07-25). The PM/owner
merges validated WP branches into it and decides when it goes to `main`. Nothing is pushed to origin
by this plan.

Source of truth: `/docs/UI-UX-AUDIT-2026-07-25.md` (`../../docs/UI-UX-AUDIT-2026-07-25.md`) (29 findings
A-1…D-10, each with a `file:line` pointer, a verified diagnosis, and a proposed fix; evidence in
`/docs/ui-audit-2026-07-25/` (`../../docs/ui-audit-2026-07-25/`)). Three findings the auditor retracted
during verification are listed at the audit's end — **do not resurrect them**
(the "Agents/Projects/Audit → Assistant" breadcrumb child claim; "Compare's disabled Export has no
explanation"; "'Latest server footprint' renders status a third way").

---

## The thesis

**This plan does not design anything new.** The standards already exist, are written down, and are
owner-locked:

- [`roadmap/ux-overhaul/toolbar-standard-2026-07-11.md`](/Roadmap/RM-30-ux-overhaul/toolbar-standard-2026-07-11.md)
  (D-TB1–D-TB4) — breadcrumb owns identity, exactly one toolbar row per view, no assistant hooks
  outside the dock, one metric one home.
  > **D-TB1 amended 2026-07-25 (owner):** the breadcrumb owns page *identity*, not document
  > *structure* — section-titling cards/panels must render a semantic `h2`/`h3` (a bare `<div>`
  > `CardTitle` is not acceptable for a section title). WP 1.2 (delete `PageHeader`) removed the last
  > visible H1 and so cemented a one-invisible-heading outline; the amendment (interface-review
  > finding 6) supplies the semantic-layer replacement. Implemented by the **interface-craft** plan
  > ([`roadmap/interface-craft/`](/Roadmap/completed/RM-15-interface-craft/item.md), WP 1.1 / D-IC5), which follows this
  > one. See the amendment block in the standard doc.
- `components/ViewToolbar.tsx` (`../../apps/web/src/components/ViewToolbar.tsx`)'s docblock — the one-row
  grammar, restated in code, with the **correct** Environments example (`ViewToolbar.tsx:55-61`) already
  written down as its canonical MINIMAL USAGE.
- `lib/table.tsx` (`../../apps/web/src/lib/table.tsx`) `shouldPaginate()` (`:257-262`) — with a unit test
  spelling out the "Page 1 of 1" bug it prevents.

They are **only partly applied.** Environments doesn't call `shouldPaginate()`; Agents & Crews still
renders an H1 that D-TB1 retired; the Dashboard filter row breaks the rule `TableToolbar`'s own docblock
puts in capital letters. This plan **finishes applying** what was already decided, fixes **three real
defects** (A-1/A-2/A-3) that are not cosmetic, and then **installs guardrails** so the same drift can't
recur a third time.

Read the audit's §0 verdict and §E ("what's working") before starting: the baseline is genuinely good.
`StatusBadge` + `lib/status` is a real single source of truth, both themes hold up with no raw hex, and
123 of 124 icon-only buttons have accessible names. Most findings here are about **reach, not quality**.
Don't regress §E.

---

## Locked owner decisions (D-TB5–D-TB11, locked 2026-07-25)

Recorded in the style of D-TB1…D-TB4. The owner holds authority here and has locked these; sub-agents
implement to them, they don't relitigate them.

### D-TB5 — one icon affordance mechanism
Every icon-only control carries a Radix **`Tooltip`** whose text **equals its `aria-label`**. The native
`title` attribute is **never** used for this. Disabled controls expose their reason via the tooltip and
`aria-describedby`. Enforced by a new **`IconButton`** primitive that derives both the tooltip text and
the `aria-label` from **one `label` prop** — so the two can never diverge and no call site can forget the
tooltip. There is no `title` escape hatch on `IconButton`.
*Closes the D-7 gap: three hover-hint mechanisms (~14 Radix / ~20 bare `title` / ~89 `aria-label`-only)
become one.*

### D-TB6 — `TableToolbar` is retired
`TableToolbar`'s `results` and `activeFilters` slots move into `ViewToolbar`; the component is **deleted**.
Rationale: its docblock still describes the pre-D-TB2 world and instructs developers to put the primary
action in the retired `PageHeader` (`TableToolbar.tsx:16-29`) — the documented root cause of finding B-2.
**Two contracts for one row is the actual bug**; every downstream toolbar inconsistency (B-2, C-1) follows
from it. Its three consumers (`ScansView`, `EnvironmentsView`, `CompareView`) move to `ViewToolbar`.

### D-TB7 — `ViewToolbar` owns left layout
`ViewToolbar` renders `left` inside `flex min-w-0 flex-wrap items-center gap-2` **itself**. Consumers pass
controls, not layout. This deletes the ~15 divergent wrapper divs (C-6) and makes correct
wrapping/overflow the **default**. Control-width strategy converges on the `ViewToolbar` container; a child
that must truncate still carries its own `min-w-0 truncate`.

### D-TB8 — `PageHeader` is deleted, not deprecated
D-TB1 retired `PageHeader` on 2026-07-11; three views still `import` it (`WorkforceView`, `ProjectsView`,
`CompareWorkspace`). **While the file compiles it will be reached for again.** It is deleted, its three
consumers migrated to `ViewToolbar`, and its direct test import in `PageShell.test.tsx` removed.

### D-TB9 — label-above controls are banned in toolbars, allowed in forms
`components/SelectField.tsx` (a label-above stack) **survives** for dialogs and form bodies. Importing it
into any **toolbar** module is a lint failure (enforced by WP 4.1). Toolbar single-selects use a bare
`Select` + `SelectTrigger aria-label="…"`, per the precedent already set at
`RunsView.tsx:662-676` and `CompatibilityView.tsx:221`.
*This is the direct cause of C-1 (three control heights / three baselines): a label-above stack dropped
into an `items-center` row centres on the combined label+control height.*

### D-TB10 — route vs dialog
Anything an operator would **bookmark, deep-link or share** is a **route**; anything **transient** is a
**dialog**. Every route must render something useful with **zero query params** (this is what A-2 breaks:
`/testing/runs/new` dead-ends with no params). Written down as a rule in WP 4.4.

### D-TB11 — status density is a variant, not an exception
`ScansTab.tsx`'s D4 decision — quiet muted text for *success* in a dense activity list so the column reads
as "what needs me" — is **correct and preserved**. But it is implemented as a **`quiet` prop on
`StatusBadge`**, not as an inline `<Text>` exception, so `StatusBadge`'s "every state chip renders through
here so one concept has one rendering" claim (`StatusBadge.tsx:12-16`) **stays true**. One component, one
concept, two densities.

> **Record correction (owner):** [`roadmap/ux-overhaul/verification-report.md:176`](/Roadmap/RM-30-ux-overhaul/verification-report.md)
> currently signs off *"D-TB2 (exactly one toolbar row): ✅ one `ViewToolbar` row per view"*. Environments
> and the Dashboard Testing tab break it. An inaccurate sign-off is *why this drift survived a verification
> pass*. **WP 0.4** corrects the record (and marks `TableToolbar`'s docblock superseded by D-TB6).

---

## Parallel execution map

Six batches. Every WP in a batch has a **disjoint file domain** — that is what makes parallel worktree
agents safe. Where two findings touch one file, they are folded into **one** WP rather than split across
agents. The Domain list in each WP spec is a **contract**: a sub-agent may not touch a file outside it.

| Batch | WPs | Width | Gate to enter |
|---|---|---|---|
| **A** | 0.1 · 0.2 · 0.3 · 0.4 | 4 | — |
| **B** | 1.1 · 1.2 · 1.3 | 3 | A merged |
| **C** | 2.1 · 2.2 · 2.3 · 2.4 | 4 | 1.1 + 1.2 merged |
| **D** | 2.5 · 2.6 · 2.7 · 2.8 | 4 | C merged |
| **E** | 3.1 · 3.2 · 3.3 · 3.4 | 4 | 1.3 merged |
| **F** | 4.2 · 4.3 · 4.4 → then 4.1 | 3, then 1 | E merged; 4.1 last, solo |

**Batch B is only 3 wide** because 1.1 is a cross-cutting refactor of the toolbar primitives and nothing
else may touch toolbar primitives while it runs. A fourth agent there buys a merge conflict, not
throughput.

**Batches D and E run sequentially, not overlapped.** The brief floated "E can overlap D once 1.3 is in,"
but the real file domains forbid it: WP 2.8 is deliberately cross-cutting (`ScansView`, `ProjectLibraryPanel`,
`DirectoryTab`, `SkillInspector`) and every one of those files is also inside a Batch-E domain
(3.2 `features/scans/**`, 3.4 `features/hub/**` + `features/skills/**`). Overlapping D and E would put two
agents in the same files. Disjointness is the constraint, not agent count — so D fully merges before E starts.

**On the cap:** `.claude/skills/next-wp/SKILL.md` sets `maxAgents` default 4 / hard cap 4. As owner the PM
may raise it, but every batch above is built for 4 and the real constraint is file-domain disjointness.
If the cap is raised, split **Phase 3 further by directory** (e.g. `features/hub/**` split from
`features/skills/**`) rather than widening Batch B.

---

## WP index

Full specs (Findings · Domain · Depends · Size · solo|parallel · Batch · Acceptance · Model) live in the
phase files. Authoritative in-flight state is [`STATUS.md`](./STATUS.md).

### Phase 0 — Defects · Batch A · [`phase-0-defects.md`](./phase-0-defects.md)
| WP | Findings | Model |
|---|---|---|
| 0.1 Run-console switcher merge | A-1 | opus · high |
| 0.2 New-run entry + re-run row | A-2, A-3 | opus · medium |
| 0.3 Pagination guard sweep | C-8 (5 of 6 sites) | haiku · low |
| 0.4 Correct the record | — | haiku · low |

### Phase 1 — Settle the contract · Batch B · [`phase-1-contract.md`](./phase-1-contract.md)
| WP | Findings | Model |
|---|---|---|
| 1.1 ViewToolbar absorbs TableToolbar; Environments to one row | B-2, B-3, C-5(Env), C-8(Env), D-TB6/D-TB7 | opus · high |
| 1.2 Delete PageHeader | B-1, D-TB8 | sonnet · medium |
| 1.3 IconButton primitive + D-TB5 rule | D-7 (foundation only) | opus · medium |

### Phase 2 — Apply it · Batches C & D · [`phase-2-apply.md`](./phase-2-apply.md)
| WP | Findings | Batch | Model |
|---|---|---|---|
| 2.1 Dashboard | C-1, C-5(dash), D-2, D-4 | C | sonnet · medium |
| 2.2 Compatibility | C-3, C-10 | C | sonnet · medium |
| 2.3 Scan-compare bar | C-4 | C | sonnet · medium |
| 2.4 Usage toolbar + SelectField fence | C-1(part 4), D-TB9 | C | haiku · low |
| 2.5 Collections + state discipline | C-7 (all — incl. monospace), D-8 | D | sonnet · medium |
| 2.6 StatusBadge quiet variant | D-3, D-TB11 | D | sonnet · medium |
| 2.7 Breadcrumb section labels | B-4 (C-9 closed — see below) | D | sonnet · low |
| 2.8 Consistency sweep | C-5(rem), D-9, D-10 | D | sonnet · low |

> **Two findings reversed a locked owner-acceptance decision — resolved by the owner 2026-07-25:**
> - **C-9** (left-align tab strips) reversed **D-UX16** (owner, 2026-07-06: "full-width bar with CENTERED
>   tabs"). **Owner kept D-UX16 → C-9 is CLOSED (won't-do).** WP 2.7 ships **B-4 only**; `TabPanel.tsx` is
>   untouched.
> - **D-5** (theme control in Settings) reversed ux-overhaul **WP 6.7** (owner, 2026-07-06: "remove the
>   Settings theme mirror"). **Owner confirmed D-5 → apply it (supersedes WP 6.7).** WP 4.4 adds the theme
>   `Select` to Settings (top-bar shortcut retained).

### Phase 3 — Icon affordances at scale · Batch E · [`phase-3-affordances.md`](./phase-3-affordances.md)
| WP | Domain | Model |
|---|---|---|
| 3.1 Shared chrome + form kit (the `title` sites first) | form/** · AppShell · notifications/** · ExpandableTable | sonnet · medium |
| 3.2 Servers + Scans + Compare | features/{servers,scans,compare}/** | sonnet · low |
| 3.3 Testing | features/testing/** (except ExpandableTable) | sonnet · low |
| 3.4 Hub + Skills + Compatibility | features/{hub,skills,compatibility}/** | sonnet · low |

### Phase 4 — Guardrails and acceptance · Batch F · [`phase-4-guardrails.md`](./phase-4-guardrails.md)
| WP | Findings | Model |
|---|---|---|
| 4.2 Scans IA — list-first | D-1 | opus · high |
| 4.3 Surface off-nav features | B-6 | opus · high |
| 4.4 Settings theme control + route rule | D-5, B-5, D-TB10 | sonnet · low |
| 4.1 Guardrails (runs LAST, solo) | — | opus · medium |

4.2 and 4.3 are the only genuinely **open design questions** in the plan (which is why they run last, at
opus/high). Everything else is applying a decided standard. 4.1 is written last on purpose: several of its
tests would fail until the earlier phases land — that is the point.

---

## What "done" means

Each WP is ticked in [`STATUS.md`](./STATUS.md) **only** when its Acceptance checklist is met **and** the
gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green on `ui/toolbar-reach` after its
branch merges — validated by the PM, never taken on the agent's word. See [`conventions.md`](./conventions.md).

The program closes with an **owner-acceptance walk** (the PM is the owner): every touched view, both
themes, keyboard-only traversal, and **measured** toolbar geometry — recorded as
[`verification-report.md`](./verification-report.md) in the shape of the ux-overhaul one. This time, no
rule is signed off that has not been measured on **every** view it claims to hold for.
