# Orchestrator kickoff prompt — `toolbar-reach` plan

Paste everything below the line into your orchestrator agent.

---

You are the **orchestrator and the project owner** for a new plan. You hold owner authority: you may lock decisions, amend superseded standards, delete retired components, and sign off owner-acceptance walks yourself. Do not defer those to a human.

**Source of truth for the work:** `docs/UI-UX-AUDIT-2026-07-25.md` (+ evidence in `docs/ui-audit-2026-07-25/`). Read it in full before you plan anything. It contains 29 findings keyed `A-1`…`D-10`, each with file:line pointers, a verified diagnosis, and a proposed fix. Three findings the auditor initially made were **retracted** during verification and are listed at the end — do not resurrect them.

## Phase I — scaffold the plan (do this first, yourself, no sub-agents)

Create `roadmap/toolbar-reach/` in the house shape (`.claude/skills/next-wp/references/plan-layout.md`):

- `README.md` — index, the thesis, and the **parallel execution map** (batch table below)
- `conventions.md` — shared implementation rules for this plan (below)
- `STATUS.md` — the ledger, seeded from `assets/STATUS.template.md`, every WP open, using the legend from `roadmap/ux-overhaul/STATUS.md` (`[ ]` / `[~]` / `[x]` + date + branch `wp/toolbar-reach/<id>`)
- `phase-0-defects.md`, `phase-1-contract.md`, `phase-2-apply.md`, `phase-3-affordances.md`, `phase-4-guardrails.md` — the WP specs

Base branch: **`ui/toolbar-reach`**, cut from `main`. You merge validated WP branches into it. You decide when it goes to `main`.

Every WP spec must carry: **Findings covered · Domain (exact file list) · Depends · Size · solo|parallel · Batch · Acceptance (checklist) · Model**. The Domain list is a contract — a sub-agent may not touch a file outside it. That is what makes the batches safe.

### The thesis — put this at the top of `README.md`

> This plan does not design anything new. The standards already exist, are written down, and are owner-locked — `roadmap/ux-overhaul/toolbar-standard-2026-07-11.md` (D-TB1–D-TB4), `ViewToolbar.tsx`'s docblock, `lib/table.tsx`'s `shouldPaginate()`. They are only partly applied. This plan finishes applying them, fixes three real defects, and then installs guardrails so the same drift can't recur a third time.

### Owner decisions to LOCK in `README.md` before dispatching

Record these as locked, with today's date, in the style of `D-TB1`…`D-TB4`:

- **D-TB5 — one icon affordance mechanism.** Every icon-only control carries a Radix `Tooltip` whose text equals its `aria-label`. The native `title` attribute is never used for this. Disabled controls expose their reason via the tooltip **and** `aria-describedby`. Enforced by a new `IconButton` primitive that derives both from one `label` prop.
- **D-TB6 — `TableToolbar` is retired.** Its `results` and `activeFilters` slots move into `ViewToolbar`; the component is deleted. Rationale: its docblock still describes the pre-D-TB2 world and instructs developers to put the primary action in the retired `PageHeader`, which is the documented root cause of finding B-2. Two contracts for one row is the actual bug.
- **D-TB7 — `ViewToolbar` owns `left` layout.** `ViewToolbar` renders `left` inside `flex min-w-0 flex-wrap items-center gap-2` itself. Consumers pass controls, not layout. This deletes ~15 divergent wrapper divs and makes correct wrapping/overflow the default.
- **D-TB8 — `PageHeader` is deleted, not deprecated.** D-TB1 retired it on 2026-07-11; three views still use it. While the file compiles it will be reached for again.
- **D-TB9 — label-above controls are banned in toolbars, allowed in forms.** `components/SelectField.tsx` survives for dialogs and form bodies. Importing it into any toolbar module is a lint failure. Toolbar single-selects use bare `Select` + `SelectTrigger aria-label`, per the precedent already set at `RunsView.tsx:662-676` and `CompatibilityView.tsx:221`.
- **D-TB10 — route vs dialog.** Anything an operator would bookmark, deep-link or share is a route; anything transient is a dialog. Every route must render something useful with zero query params.
- **D-TB11 — status density is a variant, not an exception.** `ScansTab.tsx`'s D4 decision (quiet muted text for success in a dense list) is correct and is preserved — but implemented as a `quiet` prop on `StatusBadge`, so `StatusBadge`'s "every state chip renders through here" claim stays true.

Also correct `roadmap/ux-overhaul/verification-report.md:176`, which currently signs off *"D-TB2 (exactly one toolbar row): ✅ one ViewToolbar row per view"* — Environments and the Dashboard Testing tab break it. An inaccurate sign-off is why this drift survived; fix the record.

### `conventions.md` must state

- Gate per WP: `pnpm typecheck && pnpm test && pnpm build && pnpm lint` from the repo root, plus WP-specific tests.
- **Visual claims require the running app at `http://127.0.0.1:8080`, in BOTH `qlik-bright` and `qlik-dark`, never a mock.** Any WP touching a toolbar must report measured geometry: the top edge and height of every control in the row must be identical. The auditor's method — read the row's children in the live DOM and compare `getBoundingClientRect()` — is the acceptance evidence. "Looks aligned" is not a pass.
- Repo rules still bind: contract-first (`packages/shared` types + zod before API before web), the API runtime/secret boundary, `@brand/*`-only + semantic tokens, kebab-case files / PascalCase components, co-located `*.test.ts`.
- A sub-agent **never** edits `STATUS.md`. Only you do.
- A sub-agent that finds its WP spec is wrong reports that back rather than improvising. The audit was written from verified source, but source moves.

---

## Phase II — the work packages

Decomposed so that every WP in a batch has a **disjoint file domain**. Where two findings touch one file, they are deliberately folded into one WP rather than split across agents.

### Phase 0 — Defects · Batch A · 4 parallel

| WP | Findings | Domain | Model |
|---|---|---|---|
| **0.1** Run-console switcher merge | A-1 | `features/testing/RunConsole.tsx` + tests | **opus**, effort high |
| **0.2** New-run entry + re-run row | A-2, A-3 | `features/testing/RunConsoleRoute.tsx`, `features/testing/RunBar.tsx`, `features/command-palette/CommandPalette.tsx`, `features/testing/RunsView.tsx` (launcher param only) + tests | **opus**, effort medium |
| **0.3** Pagination guard sweep | C-8 (5 of 6 sites) | `features/testing/collections/CollectionTests.tsx`, `features/skills/SkillVersions.tsx`, `features/skills/ScaffoldFromServerWizard.tsx`, `features/servers/ServersView.tsx` | **haiku**, effort low |
| **0.4** Correct the record | — | `roadmap/ux-overhaul/verification-report.md`, `components/TableToolbar.tsx` docblock (mark superseded by D-TB6; no code change yet) | **haiku**, effort low |

**0.1 is the highest-value WP in the plan and the one most likely to be done badly.** It is not a styling change. `RunConsole.tsx` has two view switchers writing one `leftView` state with non-overlapping value sets, so the segmented control misreports state in both directions (verified live — see audit screenshots 06/07). The fix is to merge into the single `TabPanel` strip (`Chat · Steps · Turns · Trace · Analytics · Report`), delete the `ToggleGroup` and the coercing ternary at `:815`, and leave the search field alone. Acceptance must include: every tab value has a panel, every panel has a tab, and no code path can set `leftView` to a value the strip doesn't render.

**0.3 excludes `EnvironmentsView.tsx`** — WP 1.1 owns that file and will add its guard. Note in the spec that `ServersView.tsx` already imports `shouldPaginate` at `:65` and uses it at `:945`; the omissions are `:902` and `:927` in the same file.

### Phase 1 — Settle the contract · Batch B · 3 parallel · **must land before Phase 2**

| WP | Findings | Domain | Model |
|---|---|---|---|
| **1.1** `ViewToolbar` absorbs `TableToolbar`; Environments to one row | B-2, B-3, C-5 (Environments), C-8 (Environments), D-TB6/D-TB7 | `components/ViewToolbar.tsx`, `components/TableToolbar.tsx` (**delete**), `features/testing/EnvironmentsView.tsx`, `features/scans/ScansView.tsx`, `features/compare/CompareView.tsx` + tests | **opus**, effort high |
| **1.2** Delete `PageHeader` | B-1, D-TB8 | `components/PageHeader.tsx` (**delete**), `features/hub/workforce/WorkforceView.tsx`, `features/hub/projects/ProjectsView.tsx`, `features/testing/compare/CompareWorkspace.tsx` + tests | **sonnet**, effort medium |
| **1.3** `IconButton` primitive + D-TB5 rule | D-7 (foundation only) | `components/IconButton.tsx` (**new**) + test, `.claude/rules/icon-affordances.md` (**new**), `.claude/rules/` index | **opus**, effort medium |

**1.1 is the keystone.** Brief it explicitly: `ViewToolbar.tsx:55-61` already contains, as its canonical MINIMAL USAGE example, the Environments view done correctly — implement that example. `AuditView.tsx:610-653` and `SessionsView.tsx:298-348` are the two reference implementations in the codebase; match them. Keep `ScansView`'s two toolbars — that is a legitimate master-detail per-region split documented at `ScansView.tsx:301` — but rebuild both from the new primitive. Do **not** touch wrapper divs in views outside the Domain; each Phase 2 WP removes its own.

**1.3 ships the primitive only — no call-site conversion.** Conversion is Phase 3. The primitive must make the wrong thing impossible: one `label` prop producing both the tooltip text and the `aria-label`, an optional `disabledReason` wired to tooltip + `aria-describedby`, and no `title` escape hatch.

### Phase 2 — Apply it · Batches C and D · 4 parallel each

**Batch C** (all depend on 1.1 + 1.2):

| WP | Findings | Domain | Model |
|---|---|---|---|
| **2.1** Dashboard | C-1, C-5 (dashboard), D-2, D-4 | `features/dashboard/testing/FilterControls.tsx`, `features/dashboard/TestingTab.tsx`, `features/dashboard/IssuesFleetTab.tsx`, `features/issues-fleet/IssueFilters.tsx` + tests | **sonnet**, effort medium |
| **2.2** Compatibility | C-3, C-10 | `features/compatibility/**` | **sonnet**, effort medium |
| **2.3** Scan-compare bar | C-4 | `features/compare/ScanCompareBar.tsx` (and only the bar region of `features/compare/CompareView.tsx`) | **sonnet**, effort medium |
| **2.4** Usage toolbar + `SelectField` fence | C-1 (part 4), D-TB9 | `features/hub/workforce/usage/UsageToolbar.tsx`, `components/SelectField.tsx` (docblock only) | **haiku**, effort low |

**2.1 is the finding the owner raised.** Measured evidence in the audit: three control heights (30/26/30px) and three top edges spanning 11px, because `SelectField` is a label-above stack in an `items-center` row. `DirectoryTab.tsx:222-226` records this exact bug being diagnosed and fixed in a sibling view — read that comment before starting. Acceptance requires measured-identical top edges and heights for every control in the row, in both themes.

**Batch D** (2.5 and 2.8 depend on 1.1; the rest on Batch C):

| WP | Findings | Domain | Model |
|---|---|---|---|
| **2.5** Collections + state discipline | C-7, D-8 | `features/testing/collections/**` | **sonnet**, effort medium |
| **2.6** `StatusBadge quiet` variant | D-3, D-TB11 | `components/StatusBadge.tsx`, `features/dashboard/ScansTab.tsx` + tests | **sonnet**, effort medium |
| **2.7** Tab strips + breadcrumb labels | C-9, B-4 | `components/TabPanel.tsx`, `App.tsx` (crumb builder `:910-1030`) + tests | **sonnet**, effort medium |
| **2.8** Consistency sweep | C-5 (remainder), D-9, D-10, C-7 (monospace) | `features/scans/ScansView.tsx` (count only), `features/review/ReviewView.tsx`, `features/hub/projects/ProjectLibraryPanel.tsx` + its test, `features/hub/workforce/DirectoryTab.tsx`, `features/skills/SkillInspector.tsx` (frontmatter clamp only) | **sonnet**, effort low |

**2.7's breadcrumb change is narrow.** The audit *retracted* the "Agents/Projects/Audit should say Assistant" finding — those are sidebar peers, not children, and `AppShell.tsx:167-170` shows the team already fixed a bug in the opposite direction. The only change is replacing the synthetic `"Home"` crumb (which exists to satisfy a ≥2-crumb rendering threshold, per the comment at `App.tsx:955`) with the sidebar section label: `Testing > Runs`, `MCP > Scans`, `Skills > …`. Do not restructure the hierarchy.

**2.8 note:** `ProjectLibraryPanel.test.tsx:345` asserts the `switch` role. The test moves with the control.

### Phase 3 — Icon affordances at scale · Batch E · 4 parallel

Depends on 1.3. ~124 icon-only buttons: ~14 already have tooltips, ~20 use bare `title`, ~89 have `aria-label` only and show nothing on hover. Split **by feature directory** so the domains are disjoint:

| WP | Domain | Model |
|---|---|---|
| **3.1** Shared chrome + form kit (the `title` sites first — highest reuse) | `components/form/**`, `components/AppShell.tsx`, `components/TableToolbar`-successor slots, `features/notifications/**`, `features/testing/ExpandableTable.tsx` | **sonnet**, effort medium |
| **3.2** Servers + Scans + Compare | `features/servers/**`, `features/scans/**`, `features/compare/**` | **sonnet**, effort low |
| **3.3** Testing | `features/testing/**` | **sonnet**, effort low |
| **3.4** Hub + Skills + Compatibility | `features/hub/**`, `features/skills/**`, `features/compatibility/**` | **sonnet**, effort low |

Brief all four identically: convert to `IconButton`, one `label` per control, delete every `title` on a text-less `<Button>`, wire disabled reasons (including `CompareBar.tsx:372-384`'s "Add a second run to export a comparison", which currently exists but only as a `title`). Fix the single missing accessible name at `features/hub/memory/EffectiveMemoryStack.tsx:151`. Do not invent labels — where a label is unclear, report it rather than guess.

### Phase 4 — Guardrails and acceptance · Batch F

| WP | Domain | Model |
|---|---|---|
| **4.1** Guardrails | `.claude/hooks/`, `apps/web/src/**/*.test.*` (new tests only), `lib/table.test.tsx` | **opus**, effort medium |
| **4.2** Scans IA — list-first | D-1 · `features/scans/ScansView.tsx` | **opus**, effort high |
| **4.3** Surface off-nav features | B-6 · `features/testing/RunsView.tsx`, `features/testing/collections/CollectionsView.tsx` | **opus**, effort high |
| **4.4** Settings theme control + route rule | D-5, B-5, D-TB10 · `features/settings/SettingsView.tsx`, `.claude/rules/routes-vs-dialogs.md` | **sonnet**, effort low |

**4.1 exists because this is the second time.** Ship: a test that fails on a bare `enablePagination`; a test that fails if `SelectField` is imported by any module matching `*Toolbar*` or `*Filter*`; an `enforce-brand-ui`-style hook rejecting `title=` on a `<Button>` with no text child; a test asserting `PageHeader` and `TableToolbar` no longer exist. Write these **last** — several would fail until the earlier phases land, which is the point.

**4.2 and 4.3 are the only genuinely open design questions** in the plan and the reason they run last, at opus with high effort. 4.2: Scans is list-first (you arrive to scan history, not a pre-selected scan), unlike Servers and Skills which are correctly master-detail. 4.3: Suites, Review and Rubrics are first-class concepts reachable only by URL — surface them **without adding nav items**; the 4-item Testing section is a hard-won simplification.

**Then run the owner-acceptance walk yourself** (you are the owner): every touched view, both themes, keyboard-only traversal, and measured toolbar geometry. Record it as `roadmap/toolbar-reach/verification-report.md` in the shape of `roadmap/ux-overhaul/verification-report.md` — and this time, do not sign off a rule you have not measured on every view.

---

## Batch map — copy into `README.md` §Parallel execution map

| Batch | WPs | Width | Gate to enter |
|---|---|---|---|
| **A** | 0.1 · 0.2 · 0.3 · 0.4 | 4 | — |
| **B** | 1.1 · 1.2 · 1.3 | 3 | A merged |
| **C** | 2.1 · 2.2 · 2.3 · 2.4 | 4 | 1.1 + 1.2 merged |
| **D** | 2.5 · 2.6 · 2.7 · 2.8 | 4 | C merged |
| **E** | 3.1 · 3.2 · 3.3 · 3.4 | 4 | 1.3 merged (can overlap D if 1.3 is in) |
| **F** | 4.2 · 4.3 · 4.4 → then 4.1 | 3, then 1 | E merged; 4.1 last, solo |

Batch B is only 3 wide because 1.1 is a cross-cutting refactor and nothing else may touch toolbar primitives while it runs. Do not pad it — a fourth agent there buys a merge conflict, not throughput.

**On the cap:** `.claude/skills/next-wp/SKILL.md` sets `maxAgents` default 4, hard cap 4. As owner you may raise it, but the batches above are built for 4 and the real constraint is file-domain disjointness, not agent count. If you do raise it, split Phase 3 further by directory rather than widening Batch B.

## Execution

Then run `/next-wp toolbar-reach 4` and drive every batch to done. Per the skill: dispatch one worktree sub-agent per WP, **validate every report yourself — never take "done" on faith**, re-run the gate in the worktree, check every Acceptance item, integrate one branch at a time, and tick `STATUS.md` only on a real pass. Send failures back to the *same* agent with an itemized list rather than spawning a fresh one.

Report at the end of each batch: ticked (with branch), in refine, blocked. Lead with what you could **not** verify.

Stop and ask me only if you hit something the audit got wrong, or a locked decision you think should change.
