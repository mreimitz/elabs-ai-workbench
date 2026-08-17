# Kickoff prompt — Claude subscription as a run model (paste into a fresh session)

Copy everything in the fenced block below into a new session at the repo root
(`mcp-token-footprint/`). It makes that session the **orchestrator** for the
`roadmap/claude-subscription/` plan and drives it end-to-end.

---

```
You are the ORCHESTRATOR for the "Claude subscription as a run model" workstream. Run on Opus.

GOAL
Make Claude models on the owner's signed-in Claude Code subscription a first-class, selectable
model for regular test runs — single AND suite runs — with zero marginal API cost, appearing
IDENTICALLY to an API-keyed Claude run in the UI, except for a clear "est." accuracy marker on the
non-exact metrics. Drive Phases 0–3 of roadmap/claude-subscription/STATUS.md to done.

READ FIRST (authoritative)
- roadmap/claude-subscription/README.md        — plan + locked decisions D-CS1..D-CS10 + accuracy map
- roadmap/claude-subscription/execution-plan.md — batches, per-WP model assignment, validation loop
- roadmap/claude-subscription/STATUS.md         — the ledger you tick
- Reference implementation to generalize: apps/api/src/grading/claude-cli-judge.ts
  (drives the subscription CLI as an LLM via the AgentSessionDriver — ~80% of the executor).
- Pattern to mirror for a "selectable model that runs on its own branch + marks estimated metrics":
  the vendor_assistant executor (apps/api/src/testing/*vendor-assistant* + the fork at
  apps/api/src/testing/run-service.ts:398-406, and registry.modelFor throwing for the kind).
- CLAUDE.md + .claude/rules/* (contract-first in packages/shared; brand-ui only; secrets stay in
  the API; quality gate = pnpm typecheck && pnpm test && pnpm build && pnpm lint).

HOW TO RUN IT
Work batch by batch exactly as roadmap/claude-subscription/execution-plan.md lays out
(A → B → C → D → E → F). For each WP in a batch, spawn ONE subagent in an isolated git worktree
(Agent tool, isolation: "worktree") on the model assigned in the execution-plan table
(opus for 1.1/1.2/1.3/1.5/2.1; sonnet for the rest). Give each subagent: the WP's STATUS.md line,
the relevant README decisions, the reference files above, and the operational gotchas below. It
implements exactly ONE WP to its Acceptance and returns files-changed + gate result.

Then VALIDATE each returned WP yourself before ticking:
  1. Worktree forked from a STALE base — confirm it was reset --hard to the intended merge SHA.
  2. Acceptance met (STATUS.md line + README decisions).
  3. Gate green: pnpm typecheck && pnpm test && pnpm build && pnpm lint (see gotchas for how).
  4. Boundaries: wire changes in packages/shared FIRST; no secret leaves the API; visible UI is
     @brand/* only and reads correctly in BOTH themes (qlik-bright + qlik-dark).
  5. Tick the STATUS.md box (— done <date> · wp/claude-subscription/<id>) and merge; else bounce
     the subagent back with the specific gap.

KEY DECISIONS TO HOLD (do not re-litigate)
- Internal kind = claude_subscription; executor module = claude-subscription-executor. NEVER bare
  "assistant" (collides with apps/api/src/assistant/*), NEVER claude_cli (already the judge provider id).
- It is a NEW executor branch (like vendor_assistant), NOT a modelFor entry — the Agent SDK is not an
  AI-SDK LanguageModel.
- Auth = the signed-in subscription only, resolved from assistant_credentials at run time; not
  signed in → "auth broken" + honest run error, never a fake result.
- NOT clean-session: MCP tools (via SDK mcpServers) and skills (materialized read-only) DO work;
  their runtime metering is ESTIMATED and marked.
- Token COUNTS are exact (turn_done.usage). COST is a reference estimate = exact tokens x
  MODEL_PRICING list rate, labelled "est. · subscription", and it feeds the maxCostUsd cost cap.
- No visible UX divergence beyond the reused estimatedTokens / "est." marker, in UI AND reports.
- Runs and the auto-rating judge SHARE ONE subscription concurrency budget (~1 GiB per child) —
  extend the AUTO_RATING_MAX_CONCURRENCY semaphore; do not give runs a second unbounded pool.

STOP / HANDOFF
- Owner-acceptance items in STATUS.md need a LIVE signed-in subscription and cannot be validated
  headless — leave them unticked and list them for the owner. "Done" = Phases 0–3 ticked + gate green.
- Commit/push ONLY when the owner asks. If a sibling session is writing packages/shared or
  run-service.ts, HOLD WP 0.1 / 1.2 until clear.

OPERATIONAL GOTCHAS (put these in every subagent brief)
- pnpm: plain `pnpm` is v11 and breaks install — use `corepack pnpm@9.15.4 -C <repo-root> …`.
- Build: `pnpm build -r --workspace-concurrency=1`; if the web build OOMs, prefix
  NODE_OPTIONS=--max-old-space-size=3400.
- Tests: use the workspace `test` script / recursive `pnpm test` (shared resolves from a gitignored
  dist), never a bare `vitest run`.
- Migration: claim the next free PRAGMA user_version at claim time by reading
  apps/api/src/db/database.ts MIGRATIONS — do NOT hardcode a version.
- Worktree subagents fork from a STALE commit — reset --hard to the intended SHA first.
- Another owner session may auto-commit/push mid-task — re-check git status + rebase before merging.

Start now: confirm the plan docs exist, verify the current LATEST_SCHEMA_VERSION in
apps/api/src/db/database.ts, then dispatch Batch A (WP 0.1, sonnet).
```

---

## Notes for the owner (outside the prompt)

- The prompt is **self-contained** — a fresh session needs only the repo + this block.
- It stops at the gate + Phases 0–3; the **live subscription walks** (real single run, real suite
  run, both-theme marker walk, not-signed-in path) are yours — they can't run headless.
- If you'd rather use the built-in `/next-wp claude-subscription` runner, it enforces the same
  plan→worktree→validate→tick loop; the only thing it doesn't guarantee is the **per-WP model
  assignment**, which is why this prompt drives the Agent tool directly with an explicit model each.
