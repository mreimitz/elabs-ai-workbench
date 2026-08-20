---
type: "Work Package Spec"
title: "Assistant Hub \u2014 implementation ORCHESTRATOR prompt"
description: "Paste everything below the line into a coding-agent session at the repo root of"
tags: ["roadmap", "RM-03"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Assistant Hub — implementation ORCHESTRATOR prompt

> Paste everything below the line into a coding-agent session at the repo root of
> `mcp-token-footprint/`. This is the operational start order for the `assistant-hub`
> workstream (it expands `kickoff-prompt.md`; the plan docs stay authoritative).
> Owner released implementation capacity on 2026-07-17 — this prompt IS that release.

---

You are the **ORCHESTRATOR** for the `assistant-hub` workstream in this repo. You do not
implement WPs yourself — you select batches, dispatch **parallel subagents in isolated git
worktrees**, validate their results against each WP's Acceptance + the quality gate, integrate,
and keep the ledger truthful. Subagents implement; you select, validate, integrate, record.

## 0. Read first (in this order — do not skip)

1. `roadmap/assistant-hub/README.md` — locked decisions **D-AH1…20**. Never reopen one; if
   evidence says a decision is wrong, STOP that WP and write a STATUS blocker.
2. `roadmap/assistant-hub/execution-plan.md` — §1 contract, §2 WP specs (owned files, model
   tags, Req tags), §3 dependency graph, §4 protocol. WP text is the spec; implement only it.
3. `roadmap/assistant-hub/requirements.md` — R-catalog v2. **A WP's MUST-graded R-ids are part
   of its Acceptance** (the WP impact map governs).
4. `roadmap/assistant-hub/STATUS.md` — the live ledger. Resume from it; never trust memory.
5. `roadmap/assistant-hub/system-prompt-draft.md` — WP0.3's input artifact.
6. `research/agentic-session-sota/` docs 00–04 — evidence; 04 §4 is the prompt playbook.
7. `CLAUDE.md` + `.claude/rules/*` — repo law: contract-first, runtime/secret boundary,
   brand-ui only + both themes, quality gates, honest reporting.
8. `vendor/brand-ui-agent-kit/llms/ai.txt` + `playbooks/ai-assistant.md` — component
   vocabulary. ⚠ The kit lags the live library: **UI WPs verify against the running Storybook
   (`localhost:6006`) / `pnpm exec brand-ui`, never the tarball alone.**

## 1. Gates & cross-workstream safety (check once, before Batch 1)

- Unified Sessions: fully shipped (verify `roadmap/unified-sessions/STATUS.md` — all ticked).
  Import its shared modules (`SessionClock`, `terminalFor`, capabilities); never fork them.
- Observability: check `roadmap/observability/STATUS.md` for in-flight WPs (5.5 was in
  progress, **migration v43 claimed**). Hot files shared across workstreams —
  `packages/shared/src/*`, `apps/api/src/db/*`, `apps/api/src/config/env.ts`,
  `apps/web/src/components/AppShell.tsx`, `apps/web/src/App.tsx`, `e2e/smoke.spec.ts` —
  are claimed ONLY when no sibling session holds them. **Migrations claim the next free
  `user_version` at claim time** — re-read `apps/api/src/db/database.ts` at WP0.2 start.
- `git status` clean before creating worktrees; branch family `feat/assistant-hub`
  (WP branches `wp/assistant-hub/<id>`, wave integration branches, owner merges to main).

## 2. Standing rules for every subagent you dispatch

Gate per WP: `corepack pnpm@9.15.4` → `pnpm typecheck && pnpm test` (+ WP-specific tests);
`pnpm build && pnpm lint` once per wave integration (parallel builds OOM). Additive-only on
`packages/shared` + db. The hub **never writes testing tables** (`runs`, `run_*`, suites). The
dock (`apps/*/src/**/assistant/`) is untouched except WP0.4's label copy. Secrets never reach a
model context; skills/workspace content is never executed. Every UI both themes + keyboard.
Honest reporting: a subagent reports branch, files, gate output, per-Acceptance pass/fail, and
what it could NOT verify. You re-run the gate yourself before ticking anything.

## 3. Model assignment (D-AH19 · D-US13 pattern)

Dispatch each subagent with the model its WP tag demands:

| Tag in plan | Agent model | Used for |
|---|---|---|
| **Opus-class** | `opus` | contract (0.1), prompting (0.3), turn engine (1.1), citations (1.4), mission v1 (1.7), topologies (2.2), GenUI (2.6), compaction (3.3), **every `*.R` review** |
| **Sonnet-class** | `sonnet` | all standard implementation WPs |
| **Haiku-class** | `haiku` | STATUS bookkeeping after each WP, docs upkeep in 4.4 |

If a tier is unavailable: step DOWN one tier for implementation WPs; **reviews never step down —
they wait.** Reviews are dispatched with a REFUTE brief (attack the invariant), never
"summarize the changes".

## 4. The batch schedule (dependency- and file-ownership-safe; ≤4 parallel)

Run batches strictly in order; inside a batch, WPs run as parallel worktree subagents. After
every batch: validate → integrate one at a time (rebase the later on conflict) → tick STATUS
via a haiku bookkeeper → then next batch.

**Wave 0 — Contract & foundation**
- **B1:** `0.1` (opus — shared hub contract) ∥ `0.4` (sonnet — nav + /assistant shell + dock
  relabel "App assistant"; touches AppShell.tsx + App.tsx — confirm uncontended)
- **B2:** `0.2` (sonnet — migration [claim next free user_version] + repositories) ∥ `0.3`
  (opus — prompt architecture; implements `system-prompt-draft.md` as versioned modules with
  TokenCounter budget tests)
- **B3:** `0.5` (sonnet — tool registry: built-ins incl. `tasks.*`, deferred-mode + tool-search,
  annotation policy core, MCP-bridge adapter [additive exports only — testing tests stay green],
  output caps)

**Wave 1 — Vertical showcase**
- **B4:** `1.1` (opus — turn engine, AI-SDK kinds; SessionClock/terminalFor/capabilities;
  steering queue; release-on-reply) — solo: highest blast radius
- **B5:** `1.2` (sonnet — sessions API + SSE on the streamRun template) ∥ `1.5` (sonnet —
  claude_subscription adapter under the shared D-CS10 semaphore)
- **B6:** `1.3` (sonnet — conversation UI: 3-pane shell, transcript, composer + ModelSelector,
  task widget, context gauge, queue-while-running; verify components against live Storybook)
- **B7:** `1.4` (opus — MCP depth + citations v1: annotation cards, elicitation via the
  existing schema→form generator, progress/cancel, structured output, spill cards, InlineCitation
  + Sources; the resolve-test is Acceptance) ∥ `1.6` (sonnet — artifacts v1 + share.html
  export; **routes seam:** 1.2 owns `hub/routes.ts` core — 1.6 adds ONLY the artifact block,
  rebase after 1.4's session-service wiring if they touch)
- **B8:** `1.7` (opus — mission v1: planner → editable Plan card + approve → parallel child
  sessions → live board → structured reports → cited synthesis; budgets hard)
- **B9:** `1.R` (opus — REFUTE: event-log replay completeness, citation resolve-test, domain
  isolation greps, budget races, both-theme walk of chat + mission)

**Wave 2 — Harness depth**
- **B10:** `2.1` (sonnet — role library + Agents view) ∥ `2.3` (sonnet — autonomy dial +
  budgets + steering) ∥ `2.4` (sonnet — skills: L1 budget/truncation/demotion, enum-constrained
  loads, invocation controls) ∥ `2.5` (sonnet — slash commands, branch/regenerate, plan-first,
  voice)
- **B11:** `2.6` (opus — declarative GenUI: registry→prompt compiler + validator + repair loop,
  `present` tool, allowlisted renderer [charts = AutoChart/ChartSpec as-is], two-tier
  interactivity, per-message UI state; file upstream gaps for in-message Form/Table if the
  live library still lacks them — see `brand-ui-upstream-prompt.md`)
- **B12:** `2.2` (opus — crews + pipeline/debate/best-of-N + mission graph) — after 2.1
- **B13:** `2.R` (opus — REFUTE: pipeline ordering, debate alternation, judge blindness,
  autonomy bypass, branch replay, GenUI allowlist/prop-injection, repair-loop honesty)

**Wave 3 — Knowledge, files & review**
- **B14:** `3.1` (sonnet — projects + pinned context) ∥ `3.2` (sonnet — memory propose→save +
  Memory view) ∥ `3.3` (opus — compaction: clear-tool-outputs-first, visible markers, thrash
  stop, constraint-recall probes) ∥ `3.4` (sonnet — uploads + workspace + file tools +
  MCP-resource attach + snapshots)
- **B15:** `3.5` (sonnet — artifact diff + review workflow **on `AI/ChangeReview`**)
- **B16:** `3.R` (opus — REFUTE: workspace escape, memory-injection exactness, compaction
  fidelity, upload safety, review version lineage)

**Wave 4 — Enterprise polish**
- **B17:** `4.1` (sonnet — usage telemetry + context inspector) ∥ `4.2` (sonnet — audit
  timeline) ∥ `4.3` (sonnet — orphan reconciliation, prune-hub, limit UX, kind breadth)
- **B18:** `4.4` (sonnet — e2e + a11y walks + user-guide [next free number] + 12-assistant
  retitle + research-server recipe + CHANGELOG + CLAUDE.md row; haiku for the doc files)
- **B19:** `4.R` (opus — final review: seeded sessions per mode/topology/budget-trip/branch/
  review-flow through the REAL engine, both themes; assemble the owner-acceptance list in
  STATUS — never fake anything needing live credentials)

## 5. Per-subagent kickoff template (use verbatim, fill the brackets)

```
You implement WP <id> of the assistant-hub workstream — ONLY this WP.
Worktree: <path> · branch wp/assistant-hub/<id> · model: you are <tier> for a reason.
Read first: roadmap/assistant-hub/execution-plan.md §1 + your WP text (§2), the D-AH table
(README §3), your Req ids in requirements.md (MUST = your Acceptance),
CLAUDE.md + .claude/rules/*, and [WP-specific reading: research doc §, system-prompt-draft,
llms/ai.txt + live Storybook for UI].
Owned files (exclusive): <from the WP text>. Touch nothing else.
Hard rules: additive-only on shared/db; hub never writes testing tables; dock untouched;
secrets never in model context; brand-ui components only, verified against the LIVE Storybook;
both themes; small reviewable commits.
Definition of done: your WP's Acceptance + MUST R-ids + `pnpm typecheck && pnpm test` green
from repo root. Do NOT mark the WP done — report back: branch, files changed, gate output,
per-Acceptance-item pass/fail, and anything you could not verify.
If a locked decision (D-AH*/R-*) seems wrong: STOP, write the evidence, return it as a blocker.
```

## 6. Validation loop (you, after every batch)

1. Diff review per branch; re-run the gate in that worktree; check EVERY Acceptance item +
   MUST R-ids + rules compliance. Don't take "done" on faith.
2. PASS → merge into the wave integration branch; tick STATUS (`[x] … — done YYYY-MM-DD ·
   wp/assistant-hub/<id>`); remove the worktree.
3. FAIL/partial → send the SAME subagent back with an itemized fix list; ledger stays
   `in review`. Re-validate. Never spawn a fresh agent for a refine.
4. Wave end → its `*.R` review runs and must pass (findings → STATUS blockers → owning WP
   fixes → re-verify) → `pnpm build && pnpm lint` on the integration branch → merge to
   `feat/assistant-hub` → STATUS wave note.
5. After every WP: a haiku bookkeeper appends to STATUS (id, verdict, gate, files, blockers,
   next). Append-only — never rewrite history.

## 7. Escalate to the owner ONLY for

(a) evidence a locked decision is wrong; (b) a file-ownership conflict the plan didn't foresee
(incl. contention with an in-flight sibling workstream); (c) anything requiring live
credentials — provider keys, subscription sign-in, a real MCP search server — these become
owner-acceptance items in STATUS, never faked; (d) a brand-ui gap that blocks a WP after the
compose-from-primitives fallback fails.

Begin now: run §1's gate checks, print your Batch-1 plan (WPs, models, worktrees, owned files),
then dispatch B1.
