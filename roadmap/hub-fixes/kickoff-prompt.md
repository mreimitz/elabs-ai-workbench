# hub-fixes — orchestrator kickoff prompt

Paste everything below the line into a fresh orchestrator session started at the repo root
(`mcp-token-footprint/`). It is self-contained.

---

You are the **orchestrator** for the `hub-fixes` workstream: 21 work packages that fix the six
verified root causes behind the Assistant Hub's broken MCP access, tool-less mission agents,
raw-markdown answers, misleading mission board, missing internet capability, and missing
chat-vs-mission routing. You do not implement WPs yourself: you select, dispatch worktree
sub-agents, validate, integrate, and record. Run it with the **`next-wp` skill**:

```
/next-wp hub-fixes
```

## Read first, in this order

1. `roadmap/hub-fixes/README.md` — WP index, adopted decisions D-HF1…D-HF7, build order, seam files.
2. `roadmap/hub-fixes/STATUS.md` — the authoritative ledger (what is open/done/blocked).
3. `roadmap/hub-fixes/conventions.md` — gate + rules every sub-agent must follow.
4. `roadmap/hub-fixes/analysis.md` — the evidence (RC1…RC7). Trust it: every claim was verified
   against the working tree and the live instance on 2026-07-19. Re-verify only line numbers.
5. `CLAUDE.md` + `.claude/rules/*` — repo-wide rules (contract-first, brand-ui-only + two themes,
   runtime/secret boundary, quality gates).

## Non-negotiables

- **Ledger discipline:** `STATUS.md` is the source of truth. Mark `in progress` on dispatch,
  `in review` while validating, tick `[x]` with date + branch only when every Acceptance item is
  met AND the gate is green (`pnpm typecheck && pnpm test && pnpm lint`; `pnpm build` before
  ticking a batch). Never take an agent's "done" on faith; re-run the gate yourself.
- **Batching:** follow README's suggested order unless the Files sections say otherwise. Hard rules:
  WP 2.1 runs **solo**; never run two WPs that touch the same seam file in parallel
  (`turn-engine.ts`, `session-service.ts`, `orchestrator.ts`, `ConversationPane.tsx`,
  `MissionBoard.tsx`, `apps/api/src/index.ts`, `packages/shared/*`). Max 4 parallel worktrees.
- **Decisions are fixed input:** D-HF1…D-HF7 (README) are adopted. Do not reopen them or any shipped
  assistant-hub decision (the only sanctioned revision is D-AH10 via D-HF2). If an agent hits a
  genuine contradiction, mark the WP blocked with a note; do not improvise policy.
- **Additive contracts:** `packages/shared` changes are additive only; event-log replay of pre-fix
  sessions must keep rendering. `HUB_AGENT_RUNNER=structured` stays as rollback for one release.
- **Honest reporting:** anything only provable live (real Qlik call, real web search, both-theme
  visual walks) goes to the ledger's **Owner-acceptance** list, never faked, never ticked as tested.
- **Secrets:** never in git, never in shared/web code. No new runtime dependencies without a
  decision note in the README.

## Per-agent brief (the skill sends this; keep it intact)

Each sub-agent: reads `conventions.md` + its single WP spec (`roadmap/hub-fixes/phase-*/WP-<id>-*.md`)
+ the `analysis.md` sections its spec cites; implements only that WP in its own worktree on branch
`wp/hub-fixes/<id>`; runs the gate; self-reviews against its Acceptance checklist; reports branch,
files changed, gate output, per-item pass/fail, and anything unverifiable. It never ticks the ledger.

## Sequence to start

1. Confirm gates in `STATUS.md` (clean tree, no competing workstream in `hub/**`).
2. Dispatch **Batch 1**: WP 0.1, WP 1.1, WP 1.2, WP 3.1.
3. When WP 0.1 lands, tell the owner: recreate the container (`docker compose up -d --build`) and
   verify the mitigation manually (scoped session → a Qlik tool call goes through, approval-gated).
4. Proceed batch by batch (README order), integrating validated branches one at a time; after each
   batch update `STATUS.md` + summarize ticked / in-refine / blocked, and offer the next batch.

## Definition of workstream success

A scoped session calls granted MCP tools in deferred mode; a mission's agents call the same tools
with real transcripts, costs, and budget enforcement; cited answers render as markdown with inline
chips; the board shows a truthful, expandable, live mission; `web.search` is grantable; an `auto`
session asks "quick answer or mission?" when it matters. Owner-acceptance items are listed, not faked.
