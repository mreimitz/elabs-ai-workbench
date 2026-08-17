# Assistant — Refinement R3 orchestrator kickoff prompt

> Owner usage: start Claude Code at the repo root on Opus 4.8 (`claude --model claude-opus-4-8`) on
> **`ux/integration`**, and paste everything below the line. R3 is independent of R1/R2 (it reads the
> R1 scope map but doesn't require R1 to be merged; coordinate at merge if in flight).

---

You are the **orchestrator** for **Refinement R3** of the **Assistant** workstream in this repo
(mcp-token-footprint), running as Claude Opus 4.8. R3 adds **session starters**: when a new thread's
dock empty state opens, show contextual **suggested-prompt chips** tailored to the current
sheet/entity; clicking one **prefills the composer** (never auto-sends). Starters are **curated +
data-aware** (deterministic, no LLM), cover **analysis and in-scope actions**, and **respect the R1
scope-lock**. You plan, dispatch subagents, merge, review, and keep the ledger honest — you do not
implement inside waves yourself except per the escalation policy.

**Read first, in this order:**
1. `CLAUDE.md` + `.claude/rules/*.md`.
2. `roadmap/assistant/refinement-03-session-starters.md` — **your marching orders for R3**, including
   the **authored catalog** (the exact base starters per sheet/entity + the data-aware conditionals).
   Implement the catalog as written.
3. `roadmap/assistant/decisions.md` — **D-AS27–D-AS29** (immutable without owner sign-off); also
   D-AS19 (scope-lock) which the starters must respect.
4. `roadmap/assistant/STATUS.md` — the **Refinement R3** section (WPs + waves) and Phase 0–3 done-lines.
5. `roadmap/assistant/execution-plan.md` — reuse **§2 ground rules** (prepend verbatim to every
   subagent), **§5 per-wave protocol**, **§7 escalation**, **§8 owner-pending boundaries**.

**Execute the waves (per the R3 section of STATUS.md):**
- **Wave A — R3.1 (sonnet, `shared` + `api`):** author `packages/shared/src/assistant-starters.ts`
  (the base catalog from the plan, keyed by surface = `'global'` or entity kind, with skill-tab
  variants) + `GET /api/assistant/starters?entityKind&entityId&tab` next to `GET
  /api/assistant/models`. The endpoint returns the surface's base set **plus rule-based conditional
  starters** computed from cheap reads (reuse `AssistantToolDeps` + the repository accessors named in
  the plan; model it on the existing `features/testing/compare/next-steps/deriveNextSteps` engine) —
  deterministic, read-only, versioned, **no LLM**. **Scope-filter**: include an action starter only
  when its `writeTool` is in `SCOPE_WRITE_TOOLS` for that entity kind.
- **Wave B — R3.2 (sonnet, `web`; needs R3.1) + review:** render starter chips in the dock's
  `PendingPanel` empty state for the current envelope (entityKind/entityId/tab); click →
  `openAssistant({prompt, entity})` (prefill only — it already never sends); refetch on entity/tab
  change; fold the 7 existing `*-analyze.ts` prompts to read their text from the catalog. Both themes;
  fall back to today's plain empty state when there are no chips. Then an **opus/sonnet review** +
  full gate + a cross-check that **no catalog entry suggests an out-of-scope write**.

Each subagent: the model above, its own worktree + branch `wp/assistant/R3.x` **off
`ux/integration`**, `pnpm install`, the full gate before handback, an honest report. Prompt =
execution-plan **§2 verbatim** + the WP brief from the R3 plan + the R3 hard rules below. After each
wave: merge to `ux/integration`, run the full gate (`pnpm typecheck && pnpm test && pnpm build &&
pnpm lint`), dispatch a reviewer, fix/log, tick `STATUS.md`'s R3 section (date · branch · sha · what ·
deviations · **NOT verified:**), commit.

**R3 hard rules (in addition to execution-plan §2):**
- **No LLM, no migration, no new dependency.** Starters are deterministic + free.
- **Respect the scope-lock (D-AS29).** An action starter appears only where its write is in scope
  (`SCOPE_WRITE_TOOLS`); read-only surfaces (run/scan/compare) get analysis starters only. Add a test
  that cross-checks every action starter's `writeTool` against the scope map — a starter that would be
  denied must never be emitted.
- **Prefill, never send.** Clicking a starter uses the existing `openAssistant` prefill path; do not
  add an auto-submit.
- **Ship the URL-pinned surfaces first.** Environment/Test starters depend on those pages exposing a
  pin (the plan's note) — if that pin isn't available, omit them and record it; don't hack a pin.
- Verify APIs/paths against the code and the pinned SDK/registry before building — report drift; keep
  everything `@elabs-ai/components-*` + semantic tokens, both themes.

**Stop and ask me only if:** a locked decision (D-AS27–D-AS29) needs changing; a migration or new
dependency seems unavoidable; a `@elabs-ai/components-*` gap forces raw UI; or a starter can only be finished with a
live token (owner-acceptance).

When done, deliver the final report per execution-plan §9 and leave the R3 Owner-acceptance items in
`STATUS.md` as my ready-to-walk checklist (starters per sheet; data-aware ones fire on failed/low
states; click prefills; actions only where in scope — both themes).

Begin now: read the five docs, confirm the `ux/integration` baseline gate is green, then dispatch
Wave A (R3.1).
