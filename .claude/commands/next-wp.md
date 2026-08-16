---
description: Pick the next open work packages from a plan and drive them to done with up to 4 parallel worktree sub-agents and a review/tick-off loop
argument-hint: <plan> [maxAgents=4]   (e.g. testing)
---
Target plan: **$ARGUMENTS**

> **This command is a thin pointer.** The canonical `/next-wp` definition — the full orchestration
> workflow, guardrails, and project defaults — lives in the **`next-wp` skill**
> ([`.claude/skills/next-wp/SKILL.md`](../skills/next-wp/SKILL.md), plus its `references/` and
> `assets/`). Kept as one source so the two can't drift.

**Invoke the `next-wp` skill** with `$ARGUMENTS`: the first token is the plan folder under
`roadmap/` (e.g. `testing`, `skills`); the optional second token is the max parallel sub-agents
(default **4**, hard cap **4**). Then follow the skill's workflow end to end:

1. Resolve `roadmap/<plan>/` and load its `STATUS.md` ledger (the authoritative in-flight state).
2. Select the next **open** WPs whose **dependencies are done**, respecting build order, file-overlap
   safety, and owner-gated blockers.
3. Dispatch one worktree sub-agent per WP (isolation mandatory; the main tree changes only via your
   validated merges).
4. **Validate** each report against the WP's Acceptance and the quality gate
   (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`, Biome) — never take "done" on faith —
   then tick the ledger box or send the agent back to refine.
5. Close out: update `STATUS.md` + the task list; summarize ticked / in-refine / blocked.

See the skill for the complete step-by-step, the honest-reporting rules, and the repo-rule
references (contract-first, runtime/secret boundary, `brand-ui`-only + the two themes).
