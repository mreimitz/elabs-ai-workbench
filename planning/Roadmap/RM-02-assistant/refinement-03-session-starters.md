---
type: "Work Package Spec"
title: "Assistant \u2014 Refinement R3: session starters (per-entity suggested prompts)"
description: "Owner-driven (2026-07-11). A new thread should suggest what to do next, tailored to the current"
tags: ["roadmap", "RM-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Assistant — Refinement R3: session starters (per-entity suggested prompts)

> Owner-driven (2026-07-11). A new thread should suggest what to do next, tailored to the current
> sheet/entity. Decisions **D-AS27–D-AS29** in [`decisions.md`](./decisions.md); ledger section
> **Refinement R3** in [`STATUS.md`](./STATUS.md). Execution model = [`execution-plan.md`](./execution-plan.md).
> Integration base **`ux/integration`**. **No migration**. Owner choices: **curated + data-aware**
> (deterministic, no LLM) · click **prefills the composer** (never auto-sends) · **analysis + action**
> starters (actions respect the R1 scope-lock).

## Intent
When the dock opens a new thread, the empty state (`PendingPanel`, `AssistantDock.tsx`, today just
"Say something to get started" with **no actions**) should show a small set of **starter chips**
relevant to the page you're on. Clicking one prefills the composer via the existing
`openAssistant({prompt, entity})` (which already **fills, never sends** — matches D-AS27).

## Design
- **Shared catalog** `packages/shared/src/assistant-starters.ts` (sits beside `assistant-scope.ts`
  / `assistant-ui-registry.ts`): `AssistantStarter = { id, label, prompt, kind: 'analysis'|'action',
  writeTool?: ToolName }` + a static **base catalog** keyed by *surface* (`'global'` or an
  `AssistantEntityKind`, with optional skill-tab variants). One source both ends read.
- **Data-aware endpoint** `GET /api/assistant/starters?entityKind&entityId&tab` (next to
  `GET /api/assistant/models` in `assistant/routes.ts`) → returns the surface's **base** set **plus
  rule-based conditional** starters computed from **cheap reads** (reusing `AssistantToolDeps` + the
  repository accessors below), modeled on the existing **`deriveNextSteps`** engine
  (`features/testing/compare/next-steps/`) — pure, deterministic, versioned, **no LLM**. Read-only.
- **Scope-consistent (D-AS29).** Action starters are included **only when their `writeTool` is in
  scope** for the entity kind (`SCOPE_WRITE_TOOLS`, `packages/shared/src/assistant-scope.ts`).
  Read-only surfaces (`run`/`scan`/`compare`) get analysis starters only; test/suite-creation actions
  surface on Environment/Collection pages where those writes are in scope — never on a skill/run page
  (they'd be denied by R1).
- **Web render.** The dock's `PendingPanel` fetches starters for the current envelope
  (entityKind/entityId/tab) and renders them as `@elabs-ai/components-*` chips; click → `openAssistant({prompt,
  entity})`. Refetch when the page/entity changes. Both themes; graceful empty/loading (no chips →
  today's plain empty state). The 7 existing `*-analyze.ts` page-hook buttons stay (they live outside
  the dock); their prompts are folded into the catalog as the seed so wording stays in one place.

**Data accessors for the conditionals** (already used by the read tools; `AssistantToolDeps` bag):
latest scan status per server (`ScanRepository.getLatestForServer`), scan token total/tools
(`getSummary`/`getDetail`), a skill's recent runs + grades (`RunRepository.listRunsForSkillVersion`
+ `GradeRepository.latestByGrader`), skill footprint/quality (`skills_versions`/quality report), a
run's status+outcome (`getRun`), suite-run aggregates (`SuiteRunRepository.getRun.aggregates`),
compatibility bands (`buildHeatmap`). All cheap, all deterministic.

---

## The catalog (the analysis — per sheet/entity)

Each entry = **chip label** → *prompt prefilled*. `[A]` analysis, `[W]` action (gated write, shown
only in-scope), `[?cond]` data-aware (shown only when the condition holds).

### Global / Dashboard (no entity pinned)
- **Most expensive server** → *"Rank my MCP servers by token footprint and show the biggest
  contributors."* `[A]`
- **Token savings** → *"Look across my servers' latest scans and find the biggest token-savings
  opportunities — bloated descriptions, unused or overlapping tools — with estimated savings."* `[A]`
- **Recent failures** → *"Summarize my failed runs from the last week and group them by likely
  cause."* `[A]`
- `[?any server's latest scan failed]` **Debug failed scans** → *"<N> servers' most recent scan
  failed. Investigate each and explain the likely cause."* `[A]`
- `[?recent run pass-rate low]` **Why are runs failing?** → *"Investigate the recent drop in run pass
  rate and identify the common root causes."* `[A]`

### Server (`/servers/:id`)
- **Explain the footprint** → *"Explain this server's token footprint and its biggest tool
  contributors."* `[A]`
- **Trim tokens** → *"Identify tools or descriptions on this server I could trim to cut tokens, with
  estimated savings."* `[A]`
- **What changed since last scan?** → *"Compare this server's two most recent scans and explain what
  changed."* `[A]`
- `[?last scan failed]` **Debug the failed scan** → *"The most recent scan of this server failed.
  Investigate the failure and explain what prevented it from completing."* `[A]`
- **Adjust config** → *"Help me adjust this server's non-secret configuration."* `[W servers_update_config]`

### Scan (`/scans/:id`)
- **Reduce token footprint** → *"Analyze this scan and identify ways to reduce the server's token
  footprint — bloated descriptions, unused tools, optimization opportunities."* `[A]`
- **Most expensive tools** → *"Show which tools in this scan cost the most tokens, and why."* `[A]`
- **Fits the models?** → *"Check this scan's tools against common model context limits and flag
  anything that won't fit."* `[A]`
- **Compare to previous** → *"Compare this scan to the server's previous scan and explain the
  deltas."* `[A]`
- `[?scan failed]` **Why did it fail?** → *"Explain why this scan failed."* `[A]`

### Skill (`/skills/:id`) — tab-aware
Overview / default:
- **Improve from recent runs** → *"Analyze the recent test runs that use this skill, find avoidable
  issues, and propose edits to the skill."* `[W skills_commit_workspace]`
- **Explain the footprint** → *"Explain this skill's L1/L2/L3 token footprint and where I could trim
  it."* `[A]`
- **Tighten triggers** → *"Review this skill's description and trigger keywords for collisions or weak
  matches and propose fixes."* `[W]`
- `[?quality score low]` **Fix quality findings** → *"Fix the top quality findings for this skill and
  show me the changes."* `[W]`
- `[?L2 over budget]` **Split oversized body** → *"This skill's body is over the L2 budget — split the
  largest section into a reference file and show the diff."* `[W]`

Tab overrides (surface these first when the envelope's `tab` matches):
- **Quality** → *"Fix the top quality findings for this skill and show me the changes."* `[W]`
- **Diff** → *"Summarize what changed between the two versions I'm comparing and whether anything
  looks risky."* `[A]`
- **Usage** → *"Explain how this skill affected the cost and quality of the runs that used it."* `[A]`
- **Versions** → *"Walk me through how this skill evolved across its versions."* `[A]`
- **Files** → *"Give me a tour of this skill's files and what each one is for."* `[A]`

### Run (`/testing/runs/:id`) — read-only scope → analysis only
- **Summarize this run** → *"Analyze this run and summarize what happened."* `[A]`
- `[?failed/errored]` **Why did this fail?** → *"This run did not finish successfully. Investigate what
  happened and explain the root cause."* `[A]`
- **Most expensive turns** → *"Break down which turns and tool calls consumed the most tokens."* `[A]`
- `[?context_overflow]` **Explain the overflow** → *"Explain what caused the context overflow and how
  to avoid it."* `[A]`
- `[?assertions_failed]` **Which expectations failed?** → *"List the expectations that failed and
  explain why."* `[A]`
  *(Note: "draft a regression test from this run" is offered on the Environment page — test writes are
  out of scope on a run page under R1.)*

### Suite run (`/testing/suite-runs/:id`)
- **Summarize the matrix** → *"Analyze this suite run and summarize the aggregate outcome across its
  test matrix."* `[A]`
- **Biggest failure buckets** → *"Which tests or environments failed most in this suite run, and
  why?"* `[A]`
- `[?pass-rate low]` **Investigate the failures** → *"Investigate the failures dragging down this
  suite run's pass rate."* `[A]`

### Compare (scan compare `/compare/scans`, run compare `/testing/runs/compare`)
- **Explain the differences** → *"Explain the key differences in this comparison and why they
  matter."* `[A]`
- **What drove cost up?** → *"Which changes increased tokens or cost the most here?"* `[A]`
- **Recommend a verdict** → *"Weigh the differences and recommend a verdict with evidence."* `[A]`

### Collection (`/testing/collections/:id`)
- **What does this cover?** → *"Summarize this collection's tests and what they exercise."* `[A]`
- **Coverage gaps** → *"Identify gaps in this collection — tests without expectations or graders, or
  capabilities not covered."* `[A]`
- **Organize** → *"Help me organize this collection — rename, regroup, or adjust membership."*
  `[W collections_modify]`

### Compatibility (`/testing/compatibility`)
- **Explain failures** → *"Explain the compatibility failures shown here — which models have issues
  and the root causes."* `[A]`
- **Best model** → *"Recommend the best model(s) for this server's tools based on these results."* `[A]`

### Environment (`/testing/environments`, scenario) — where test/suite actions belong (in scope)
- **Draft a test from a failed run** → *"Draft a regression test for this environment based on a
  recent failed run."* `[W tests_create]`
- **Set up a skill** → *"Attach a skill to this environment and configure it."* `[W environments_attach_skill]`
- **Tune the setup** → *"Review this environment's system prompt, tools, and model and suggest
  improvements."* `[W environments_update]`
- **Explain this environment** → *"Explain how this environment is configured and what it exercises."*
  `[A]`
  *(Depends on the Environment page publishing its selected entity into the envelope — see Notes.)*

---

## Work packages (waves · models)
**Wave A**
- **R3.1 — shared starter catalog + data-aware endpoint** (`shared` + `api`) · **sonnet**. The
  `assistant-starters.ts` catalog (base sets above) + `GET /api/assistant/starters` (base +
  conditional via the `deriveNextSteps` pattern, scope-filtered by `SCOPE_WRITE_TOOLS`). Tests: each
  surface returns its base set; each conditional fires only when its data holds (failed scan →
  debug; low pass-rate → investigate; L2-over → split; etc.); out-of-scope action starters excluded;
  `global` when unpinned; endpoint is read-only + deterministic.

**Wave B**
- **R3.2 — starter chips in the dock empty state** (`web`) · **sonnet** (needs R3.1's wire). Render
  starters in `PendingPanel` for the current envelope (entityKind/entityId/tab); click → prefill via
  `openAssistant` (never auto-send); refetch on entity/tab change; fold the 7 `*-analyze.ts` prompts
  to read from the catalog. Both themes; plain empty state when no chips. Tests + both-theme shots.
- **R3 review** — gate + a check that no starter suggests an out-of-scope write (cross-check the
  catalog against `SCOPE_WRITE_TOOLS`) + refresh Owner-acceptance.

## Owner-acceptance (live)
- Open a new thread on a server / scan / skill / run / suite-run / compare / collection page → see
  relevant starters; a failed scan / failed run / low-quality skill surfaces its data-aware starter.
- Clicking a starter **prefills** the composer (you press send); action starters only appear where
  they're in scope and go through the normal approval. Global/dashboard shows cross-cutting starters.
  Both themes + keyboard.

## Non-goals / notes
- No LLM starter generation (deterministic + free, per D-AS28); no migration; no new dependency.
- **Environment/Test starters** depend on those pages exposing a selected-entity pin to the envelope
  (today `/testing/environments` holds selection in React state — see the R1.1 pin reconciliation).
  Ship the URL-pinned surfaces first (global/server/scan/skill/run/suite_run/compare/collection/
  compatibility); wire Environment/Test starters when the pin lands (coordinate with R1.1).
- Starters are a superset home for the existing "Analyze…" buttons — keep those buttons; source their
  text from the catalog so wording lives in one place.
