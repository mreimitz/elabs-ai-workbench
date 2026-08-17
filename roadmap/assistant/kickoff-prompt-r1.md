# Assistant — Refinement R1 orchestrator kickoff prompt

> Owner usage: start Claude Code at the repo root on Opus 4.8 (`claude --model claude-opus-4-8`) on
> the **`ux/integration`** branch, and paste everything below the line.

---

You are the **orchestrator** for **Refinement R1** of the **Assistant** workstream in this repo
(mcp-token-footprint), running as Claude Opus 4.8. R1 makes the (already-shipped) in-app assistant
obey three owner rules: (1) **writes are hard-locked to the current page's entity**, (2) on a skill it
is **aware of the full skill structure** and has the **skill-creator best-practices** loaded, and
(3) its file edits show **live in the Files view** with the **UI auto-navigating** to each change. You
plan, dispatch parallel subagents, merge, review, and keep the ledger honest — you do not implement
inside waves yourself (except per the escalation policy).

**Read first, in this order:**
1. `CLAUDE.md` + `.claude/rules/*.md` (hard project rules).
2. `roadmap/assistant/refinement-01-scope-structure-live-edits.md` — **your marching orders for R1**
   (root causes with code anchors, the design per rule, and the WP briefs).
3. `roadmap/assistant/decisions.md` — **D-AS19–D-AS23** (immutable without owner sign-off) plus the
   original D-AS1–D-AS18 the feature already honors.
4. `roadmap/assistant/STATUS.md` — the **Refinement R1** section (the WPs + waves you tick) and the
   Phase 0–3 done-lines (what already exists, so you extend rather than rebuild).
5. `roadmap/assistant/execution-plan.md` — reuse its **§2 ground rules** (prepend verbatim to every
   subagent), **§5 per-wave protocol**, **§7 escalation**, **§8 owner-pending boundaries**.

**Execute waves A→D without waiting for me between waves** (per the R1 section of STATUS.md):
- **A:** R1.1 (opus) — scope model + `SCOPE_WRITE_TOOLS` + per-message `canUseTool` hard-lock + envelope/
  system-prompt reworded as an instruction + entity-pin reconciliation. `shared`+`api`(+web pin).
- **B:** R1.2 (sonnet, skill-structure context + bundle skill-creator read-only) ∥ R1.3 (sonnet,
  `workspace_*` events + live-workspace read endpoint). Disjoint surfaces.
- **C:** R1.4 (sonnet, live Files view + auto-navigate; needs R1.3) ∥ R1.5 (sonnet, dock scope chip +
  re-scope on nav; needs R1.1). Different web areas.
- **D:** opus security review + full gate + refresh Owner-acceptance.

Each subagent: the model named above, its own git worktree + branch `wp/assistant/R1.x` **off
`ux/integration`**, `pnpm install`, the full gate before handback, and an honest report
(done / deviations / **NOT verified**). Prompt = execution-plan **§2 verbatim** + the WP's brief from
the refinement plan + the R1 hard rules below. After each wave: merge to `ux/integration` (you resolve
conflicts), run the full gate, dispatch a reviewer subagent on the wave diff, fix/log findings, tick
`STATUS.md`'s R1 section in the house style (date · branch · sha · what was built · deviations ·
**NOT verified:**), commit.

**R1 hard rules (in addition to execution-plan §2):**
- **Scope enforcement is the security core.** The authoritative guard is **per-message in
  `canUseTool`** using the *current* envelope's scope (tools are built once per session, so build-time
  filtering alone is NOT sufficient). Prove by test that **no out-of-scope tool and no id-mismatched
  target** (`skills_commit_workspace`/`skills_open_workspace` `skillId` ≠ scoped id) can pass, and that
  **unscoped/global = read-only**. Reads stay broad; **only writes** are locked. Deny with a
  model-visible reason so the agent self-corrects. Extend the existing `permission-classifier` tests.
- **No migration** (schema stays at v21; scope is derived, workspace events are transient, the live
  read is off disk). If a WP seems to need one, STOP and ask.
- **No new runtime dependency.** `skill-creator` is **static content vendored into the image**
  (a resources dir copied by the Dockerfile), not an npm dep — never `npm/pnpm add` it. If it can't be
  vendored offline at build time, fall back to a distilled checklist + `docs/skill-authoring.md` and
  flag it for me; do not invent a dependency.
- **Tests fully offline** — reuse the existing scripted-fake `PtyDriver`/`AgentSessionDriver` seams;
  never spawn the real SDK/CLI/PTY or call Anthropic in `pnpm test`.
- **Honor the locked calls:** unscoped dock = read-only; "save once at end" = the existing gated
  `skills_commit_workspace` approval (no auto-commit per edit); the live Files view is the review
  surface. The bundled skill-creator is **read-only, never executed**.
- Verify plan-cited APIs/paths against the code and the pinned SDK `.d.ts` before building — report
  drift, don't guess. Everything stays `@elabs-ai/components-*` + semantic tokens, both themes.

**Stop and ask me only if:** a locked decision (D-AS19–D-AS23) needs changing; a migration or a new
runtime dependency seems unavoidable; a `@elabs-ai/components-*` gap forces raw UI; or a WP can only be finished
with a live Claude token (execution-plan §8 — that's owner-acceptance, not yours to run).

When Wave D is done (or blocked), deliver the final report per execution-plan §9 and leave the R1
Owner-acceptance items in `STATUS.md` as my ready-to-walk checklist (the three rules verified live in
both themes with a real token).

Begin now: read the five docs, confirm the `ux/integration` baseline gate is green, then dispatch
Wave A (R1.1).
