---
type: "Work Package Spec"
title: "WP 5.1 — rating findings cross-linked into the skill and server surfaces"
description: "Phase 5 cross-links. Most of this ledger line already shipped; what remains is the link itself and a rating-sourced SkillFlow suggestion."
tags: ["roadmap", "RM-06"]
timestamp: "2026-08-21T17:20:00Z"
status: "final"
---
# WP 5.1 — rating findings cross-linked into the skill and server surfaces

> **Status: specified 2026-08-21.** Phase 5 of [`item.md`](./item.md); ledger
> [`STATUS.md`](./STATUS.md). The owner instructed BUILD on 2026-08-21, so this is live work, not
> backlog. AR1–AR16 untouched; **AR6** (base-rating scores stay their own dimension) and **AR9**
> (a finding drafts a labeled fix, never auto-applied) are the two this WP is designed around.

**Size:** M · **Depends on:** none open — its stated dependency WP 4.3 is done (2026-07-11) ·
shared + API + Web · **no migration**

---

## First: what this ledger line promised that is already built

The ledger line reads *"skill findings → SkillFlow suggestion drafts / Skill IDE deep-links;
server findings → server detail (Advisor evidence when Advisor Phase 1 lands)"*. Three of its
claims are stale and must not be re-implemented:

1. **"server findings → server detail" already ships.** `IssuesPanel`
   (`apps/web/src/features/issues/IssuesPanel.tsx`) is described in its own header as *"the ONE
   Issues-tab surface, shared by the MCP-server detail view and the skill inspector"*, and it is
   mounted on **both**: `apps/web/src/features/servers/ServersView.tsx:918`
   (`targetKind="mcp_server"`, the `issues` tab) and
   `apps/web/src/features/skills/SkillInspector.tsx:801` (`targetKind="skill"`, `?tab=issues`).
   `GET /api/servers/:id/issues` and `GET /api/skills/:id/issues` both exist
   (`apps/api/src/grading/issue-routes.ts:220,226`).
2. **The finding→entity identity resolution already ships.** An `ErrorFinding` carries only the
   `FixTarget` **enum** (`skill | mcp_server | none`) and no id — but
   `RatingIssueService.resolveTargets` (`apps/api/src/grading/issue-service.ts:156`) already
   resolves it to concrete ids: a `skill` finding fans out over `run.skills[]`; an `mcp_server`
   finding over the distinct `serverId`s the run's tool steps exercised, with the environment's
   allow-list as an honest fallback; an empty result files no issue. The persisted `rating_issues`
   row therefore already carries `targetKind` · `targetId` · `targetName` · `skillVersionId?`.
3. **"when Advisor Phase 1 lands" is stale.** Advisor **Phases 1–2, all 5 WPs, are done**
   (2026-08-18 — the [RM-01 advisor ledger](/Roadmap/RM-01-advisor/STATUS.md)). Drop the
   conditional. Server detail even carries an **Advisor tab** already (`ServersView.tsx:928`,
   `AdvisorPanel` at `scope: "server"`).

Observability Phase 5 also built the **fleet** half on top of the same v26 registry — deterministic
clustering, lifecycle, auto-reopen, the Dashboard `issues` tab at `/dashboard?tab=issues&issue=<id>`,
drafted-fix copy and "Analyze with Assistant"
(the [RM-17 observability ledger](/Roadmap/RM-17-observability/STATUS.md), WPs 5.1–5.4).

---

## Problem

With all of that built, one thing is still missing, and it is the thing this ledger line is named
after: **a rating finding never links to the entity it blames.**

`fixTarget` has ten consumers across the API and the web. Every web consumer —
`IssuesPanel.tsx:194`, `issues-fleet/IssueFixesSection.tsx:28`,
`issues-fleet/issue-triage-prompt.ts:63` — renders it as a **chip**. The strings `/skills/` and
`/servers/` appear **nowhere** in `apps/web/src/features/issues/` or
`apps/web/src/features/issues-fleet/`; the only navigation out of an issue is to a run
(`IssueLinkedRuns.tsx:55,62`). So an operator reading "this failure is the skill's fault" — with
`targetId` sitting right there in the payload — has to go find the skill by hand.

The app already knows how to build that link, once, elsewhere: `advisorEvidenceHref`
(`apps/web/src/features/advisor/advisor-evidence.ts:39`) maps an entity kind + id to
`/servers/:id` · `/skills/:id` · `/scans/:id` · `/scans/:scanId?tool=` · `/testing/runs/:id`, and
returns **`null`** for anything it cannot resolve so a wrong link is never rendered. That is the
resolver this WP re-projects (D-MCP4 — one resolver, never a second).

Second gap: a `fixTarget: "skill"` finding is never offered to the skill's author as an **edit**.
`apps/api/src/skillflow/suggestions.ts` (676 lines) contains no reference to `ErrorFinding`,
`error_forensics`, `RatingIssue`, `fixTarget` or `run_grades` — verified by substring scan.
SkillFlow's suggestion loop reads trace verdicts only, even though
`GET /api/skills/:id/versions/:vid/suggestions?runId=…` is already keyed by **the same run id**
auto-rating rated.

---

## Scope

### A — the finding names its target, and the name is a link

- **One resolver.** Re-project `advisorEvidenceHref`. It may be lifted out of
  `features/advisor/` into a shared web module, but there must be **exactly one** function that
  turns an entity kind + id into an href, proven by a source-grep test. Its `null`-on-unknown
  behaviour is preserved verbatim: an unresolvable target renders as plain text, never a guess.
- **Where the link appears** — in every surface that already renders a rating target:
  - `IssuesPanel.tsx` — the issue header's `targetName` becomes a link to `/servers/:targetId` or
    `/skills/:targetId`, by `targetKind`.
  - `issues-fleet/IssueDetail.tsx` — the same, plus the `fleet.affected.servers[]` and
    `fleet.affected.skills[]` chips become links (they are already id arrays).
  - `apps/web/src/features/testing/ReportTab.tsx` — a run-console `error_forensics` finding row
    gains the resolved target link **when the run resolves it unambiguously**. The finding carries
    no id, so the row derives candidates from the run the console is already showing
    (`run.skills[]` for `fixTarget: "skill"`; the distinct tool-step `serverId`s for
    `mcp_server`). **Two or more candidates render as two or more links, never one guess**; zero
    candidates render the chip exactly as today.
- **Make the server detail tab addressable.** `ServersView.tsx:118` holds the active tab in
  `useState`, so `/servers/:serverId?tab=issues` is not a link anybody can send. Move it to
  `?tab=` exactly as the skill inspector already does (`SkillInspector.tsx:138` — the D-SP21
  precedent), keeping `overview` as the zero-param default so D-TB10 still holds. The eight tab ids
  (`overview · tests · tools · resources · prompts · scans · issues · advisor`) are unchanged; an
  unknown `?tab=` value falls back to `overview` rather than rendering nothing.
- **No new route.** Nothing here adds a `<Route path="…">`, so `ASSISTANT_ROUTE_MANIFEST` needs
  **no new entry** and the `assistant-route-operability` gate is untouched. That is a checkable
  claim: the manifest file's diff must be zero lines.

### B — a skill-blamed finding becomes a SkillFlow suggestion

`GET /api/skills/:id/versions/:vid/suggestions?runId=…` gains a **third, additive array**.

- **Contract-first.** `SkillSuggestionsResponse` (`packages/shared/src/types.ts:3692`) gains
  `ratingSuggestions?: SkillRatingSuggestion[]` — an additive optional field, so every existing
  consumer compiles unchanged. It is a **new type**, not a reuse of `SkillSuggestion`: that type's
  `verdictRef` is required and names a graph node or edge (`types.ts:3625`), and a rating finding
  has neither — forcing one would be a fabricated verdict. `SkillRatingSuggestion` is
  `{ id, findingId, category: ErrorFindingCategory, bucket: RootCauseBucket, rationale: string,
  ops: SkillEditOp[] }`, with its own appended rule tuple in `packages/shared/src/constants.ts`.
  The existing `SKILLFLOW_SUGGESTION_RULES` and `SKILLFLOW_STATIC_SUGGESTION_RULES` tuples are
  **not** edited.
- **Which findings.** Only the run's latest `error_forensics` findings — read through the existing
  `latestForensicsFindings` (`issue-service.ts:454`) — with `fixTarget === "skill"`, **and only
  when the requested skill is one the run actually loaded** (`run.skills[]` contains it). A finding
  on a run that never loaded this skill produces nothing; it is not this skill's problem.
- **One deterministic rule, no model call.** A `failed_tool_call` finding that carries a `toolName`
  produces a body-append op documenting the failing call, reusing the exact `body-append` mechanic
  `missing-breadcrumbs` and `loop-detected` already use (`buildMissingBreadcrumbOps`,
  `suggestions.ts:149`). Every other finding is **advisory-only** (`ops: []` — the shape's existing
  meaning), carrying the finding's own `draftFix` as its rationale. The LLM branch of
  `suggestions.ts` stays owner-gated and unbuilt.
- **No corruption.** Every non-empty op batch goes through the existing `validateEditOps` against
  the same graph; a batch that fails is **downgraded to advisory**, never dropped and never
  applied — the rule `suggestions.ts` already enforces for its five trace rules.
- **AR9 holds:** nothing is auto-applied. Applying goes through the existing save flow, which
  writes a new immutable version.
- **Where it renders.** The skill inspector's **`issues` tab**, as a section beside the existing
  issue rows. Deliberately **not** the Trace evidence pane: `SkillInspector.tsx:743` records that
  *"Design + Trace are HIDDEN for now (the visual-design surface is parked)"* and an effect at
  `:365` force-redirects `?tab=design`/`?tab=trace` to `files`, so `SuggestionCard`, the whole
  `UnifiedEditor` and its `?mode=`/`?node=`/`?line=` deep links are **unreachable through the UI
  today**. Shipping into a parked surface would be shipping nothing.

---

## Files

**New**
- `apps/web/src/features/skills/RatingSuggestions.tsx` (+ its co-located test) — the section that
  renders `ratingSuggestions` in the skill inspector's `issues` tab.

**Modified — shared (contract-first, additive only)**
- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/constants.ts`

**Modified — API**
- `apps/api/src/skillflow/suggestions.ts`
- `apps/api/src/skillflow/routes.ts`

**Modified — web**
- `apps/web/src/features/advisor/advisor-evidence.ts` (or its lift target — one resolver either way)
- `apps/web/src/features/issues/IssuesPanel.tsx`
- `apps/web/src/features/issues-fleet/IssueDetail.tsx`
- `apps/web/src/features/testing/ReportTab.tsx`
- `apps/web/src/features/servers/ServersView.tsx`
- `apps/web/src/lib/api.ts` (only if the suggestions client call needs widening)

**Zero-line diff — verify each with `git diff <base>..HEAD -- <path>`**
- `packages/shared/src/assistant-route-manifest.ts`, `packages/shared/src/assistant-scope.ts`, and
  the `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` block of `packages/shared/src/constants.ts`
  (D-AO3)
- `apps/api/src/db/**` — **no migration**
- `apps/api/src/grading/**` — this WP **reads** the grading surface, it does not change it
  (`run_grades` stays append-only per AR6; `latestForensicsFindings` is imported, not edited)
- `apps/web/src/App.tsx` — no new route
- `pnpm-lock.yaml` and every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts` — no environment variable, no feature flag

**Orchestration note.** WP 5.2 also appends to `packages/shared/src/constants.ts`, in a different
region (metrics/assertions vs. skillflow). Every other file is disjoint, so the two can run in
parallel worktrees; expect at most an append-conflict in that one file, or serialize the two shared
edits.

---

## Acceptance

- [ ] **A1** — Exactly **one** function in `apps/web/src` turns an entity kind + id into an href; a
      source-grep test fails if a second appears. Its unknown-kind case still returns `null`, and a
      `null` renders as plain text (asserted), never as a broken link.
- [ ] **A2** — On `IssuesPanel`, a `skill` issue's target name navigates to `/skills/<targetId>` and
      an `mcp_server` issue's to `/servers/<targetId>`. Asserted for both target kinds.
- [ ] **A3** — On the fleet issue detail, every `fleet.affected.servers[]` and
      `fleet.affected.skills[]` chip is a link to that entity.
- [ ] **A4** — On the run console's Report tab, a `fixTarget: "skill"` finding on a run with **two**
      attached skills renders **two** links, and the same finding on a run with **zero** attached
      skills renders the chip with **no** link. Both asserted; neither renders a single guessed
      target.
- [ ] **A5** — `/servers/:serverId?tab=issues` cold-loads on the Issues tab and survives a reload;
      bare `/servers/:serverId` still lands on Overview; an unknown `?tab=` value falls back to
      Overview rather than an empty panel.
- [ ] **A6** — `GET /api/skills/:id/versions/:vid/suggestions?runId=…` returns `ratingSuggestions`
      for a run that loaded that skill and produced a `fixTarget: "skill"` finding, and the existing
      `suggestions` and `staticSuggestions` arrays are **byte-identical** to before on the same
      fixture.
- [ ] **A7** — The same call for a run that did **not** load that skill returns
      `ratingSuggestions: []` — not the finding attributed to the wrong skill.
- [ ] **A8** — A `failed_tool_call` finding carrying a `toolName` yields a body-append op that
      passes `validateEditOps`; an op batch that fails validation comes back **advisory**
      (`ops: []`) with its rationale intact, and is never dropped and never applied.
- [ ] **A9** — Applying a rating suggestion produces a **new immutable skill version** through the
      existing save flow, and nothing is auto-applied at any point (AR9).
- [ ] **A10 (AR6)** — This WP writes **no** `run_grades` row and folds no base-rating score into any
      expectation metric; `apps/api/src/grading/**` has a zero-line diff.
- [ ] **A11 (no drive-by scope)** — Every zero-line-diff path above is clean;
      `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` / `deriveAssistantScope` are untouched (D-AO3);
      no migration, no dependency, no feature flag; no `STATUS.md` was edited by the implementer.
- [ ] **A12 (both themes + keyboard)** — Every new link and the rating-suggestion section read
      correctly in `light` **and** `dark` against the **running app**, are keyboard reachable with a
      visible focus ring, and any icon-only control is an `IconButton` whose tooltip equals its
      `aria-label`.
- [ ] **A13 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
      Report exit codes and test counts; report any pre-existing failure as pre-existing rather than
      fixing it silently.

---

## Explicit non-goals

- **Un-parking the Design / Trace tabs.** They are hidden and force-redirected by deliberate earlier
  decisions (the [RM-23 skillflow ledger](/Roadmap/RM-23-skillflow/STATUS.md) and the
  [RM-22 skill-ide ledger](/Roadmap/RM-22-skill-ide/STATUS.md)). Reviving that surface
  is a larger decision than a cross-link WP, and it is the owner's (see below).
- **Any deep link into the SkillFlow canvas.** `?mode=` / `?node=` / `?line=` exist in
  `UnifiedEditor.tsx` but are unreachable while Design is parked; linking to them would be shipping
  a dead link.
- **An Advisor rule sourced from rating findings.** Advisor rules live in
  `apps/api/src/advisor/rules/` behind a registry whose **order is pinned by a test**
  (`registry.ts:37`); adding an eighth rule from this workstream would edit RM-01's file set. It
  belongs in RM-01 as its own WP (see below).
- **A dedicated `/issues` route.** None exists; the fleet view is a Dashboard tab and the per-target
  views are entity tabs. Adding one needs a manifest entry and an IA decision.
- **Any change to the LLM branch of `suggestions.ts`** — still owner-gated and unbuilt.
- **Any change to the rating pipeline, the issue registry schema, or the clustering keys.**

---

## Open questions the owner must answer

1. **Should Design / Trace be un-parked?** If yes, the rating suggestions belong in the Trace
   evidence pane beside `SuggestionCard` and can deep-link to a node, and this WP's delivery surface
   changes. If no, the `issues`-tab section above is the answer and the canvas deep-link stays
   deferred. **This WP assumes "no" and is buildable either way.**
2. **Where does the Advisor rule live?** "Recurring rating issues on this server/skill" is a real
   advisor recommendation, but the advisor registry is RM-01's. Recommendation: file it as an RM-01
   Phase 3 WP rather than reaching into that file set from here.
