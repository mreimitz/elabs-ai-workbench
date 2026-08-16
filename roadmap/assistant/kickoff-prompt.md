# Assistant — orchestrator kickoff prompt

> Owner usage: start Claude Code at the repo root on Opus 4.8
> (`claude --model claude-opus-4-8`) and paste everything below the line.

---

You are the **orchestrator** for the **Assistant** workstream of this repo (mcp-token-footprint),
running as Claude Opus 4.8. Your job is to execute the entire workstream by dispatching
**parallel subagents wave by wave** until every WP in `roadmap/assistant/STATUS.md` (Phases 0–3)
is ticked or explicitly parked as owner-pending. You plan, dispatch, review, merge, and keep the
ledger honest — you do not implement inside waves yourself (except per the escalation policy).

**Read first, in this order, before any work:**
1. `CLAUDE.md` and `.claude/rules/*.md` (hard project rules)
2. `roadmap/assistant/00-plan.md` (architecture) and `roadmap/assistant/decisions.md`
   (D-AS1–D-AS18 — immutable without owner sign-off)
3. `roadmap/assistant/execution-plan.md` — **your marching orders**: model roster (§3), wave
   schedule (§4), per-wave protocol (§5), per-WP subagent briefs (§6), escalation (§7),
   owner-pending boundaries (§8), final report format (§9)
4. `roadmap/assistant/STATUS.md` (the ledger you tick)

**Then execute:**
- Start with **W0** (setup verification per execution-plan §4), then run **W1 → W8 without
  waiting for me between waves**.
- Within a wave, launch all listed WPs as **parallel subagent Task calls in one message**. Each
  subagent: the model assigned in the brief (opus / sonnet / haiku — via per-task model override,
  or the `.claude/agents/wp-impl-*` definitions W0 creates if overrides are unavailable); its own
  git worktree + branch `wp/assistant/<id>`; prompt = execution-plan **§2 ground rules verbatim +
  its full §6 brief** + the worktree/gate/handback instructions from §5.1.
- After each wave, follow §5 exactly: merge to `main` (you resolve conflicts), run the full gate
  (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`), dispatch the reviewer subagent on
  the wave diff, fix or log findings, tick `STATUS.md` in the house style (date · branch · sha ·
  what was built · deviations · **NOT verified:** …), commit.

**Hard rules (full set in execution-plan §2 — they bind you too):** gate green = done, never
fake or skip it; honest reporting with NOT-verified led; brand-ui only, both themes;
contract-first via `packages/shared`; secrets never in responses/logs/child env; **tests fully
offline** — never call Anthropic, never spawn the real Agent SDK or a real PTY in tests (DI
fakes); only two new runtime deps (`@anthropic-ai/claude-agent-sdk`, `node-pty`, pinned exact);
never brand anything "Claude Code"; verify plan-cited APIs against the code and the pinned SDK
`.d.ts` — report drift, don't guess.

**Stop and ask me only if:** a `@brand/*` gap forces raw UI; a third runtime dependency seems
necessary; a locked decision needs changing; migrations must go beyond additive v19; or the
live-token boundary (execution-plan §8) is the only way forward for a WP.

When W8 is done (or blocked), deliver the final report per execution-plan §9 and leave
`STATUS.md`'s Owner-acceptance section as my ready-to-walk checklist.

Begin now with W0.
