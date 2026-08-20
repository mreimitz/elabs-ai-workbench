---
type: "Work Package Spec"
title: "Assistant \u2014 Refinement R2 orchestrator kickoff prompt"
description: "Owner usage: start Claude Code at the repo root on Opus 4.8 (claude --model claude-opus-4-8) on"
tags: ["roadmap", "RM-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Assistant — Refinement R2 orchestrator kickoff prompt

> Owner usage: start Claude Code at the repo root on Opus 4.8 (`claude --model claude-opus-4-8`) on
> **`ux/integration`**, and paste everything below the line. R2 is independent of R1 (can run before,
> after, or instead) — if both are in flight, merge-coordinate the dock / entity-pin touch points.

---

You are the **orchestrator** for **Refinement R2** of the **Assistant** workstream in this repo
(mcp-token-footprint), running as Claude Opus 4.8. R2 fixes three session/thread issues in the
shipped assistant: (1) **threads must be scoped to the current page's entity**, (2) **a session must
release when its reply completes and resume on the next message** (stop the "too many sessions"
errors), and (3) **threads need a real name + a date** instead of "New thread". You plan, dispatch
parallel subagents, merge, review, and keep the ledger honest — you do not implement inside waves
yourself except per the escalation policy.

**Read first, in this order:**
1. `CLAUDE.md` + `.claude/rules/*.md`.
2. `roadmap/assistant/refinement-02-session-management.md` — **your marching orders for R2** (root
   causes with exact code anchors, the design per issue, the WP briefs).
3. `roadmap/assistant/decisions.md` — **D-AS24–D-AS26** (immutable without owner sign-off).
4. `roadmap/assistant/STATUS.md` — the **Refinement R2** section (WPs + waves) and the Phase 0–3
   done-lines (what already exists — extend, don't rebuild).
5. `roadmap/assistant/execution-plan.md` — reuse **§2 ground rules** (prepend verbatim to every
   subagent), **§5 per-wave protocol**, **§7 escalation**, **§8 owner-pending boundaries**.

**Execute the waves (per the R2 section of STATUS.md):**
- **Wave A (parallel, disjoint surfaces):**
  - **R2.1 (sonnet, web + api client):** create threads **pinned to the current entity**; the switcher
    fetches the **current entity's** threads (server-filtered — the filter already exists) with an
    **"All threads"** toggle; render **title + relative date**; inline rename; refresh the switcher
    after a turn. Renders whatever title the API returns (parallel-safe with R2.2).
  - **R2.2 (opus, api/session-manager + env + shared consts):** **release-on-reply** — in
    `onTurnComplete` call `park()` (behind `ASSISTANT_RELEASE_GRACE_MS`, default 0) so the child is
    killed and the cap slot freed the moment a turn ends, keeping `sdkSessionId`; make the
    `limit_error`/`error` paths converge to release so nothing stays `running` holding a slot; resume
    stays `resume: sdkSessionId`. Plus **auto-titling**: deterministic title from the first message;
    a **best-effort, feature-flagged, NON-cap-counted** one-shot LLM refine after the first turn
    (`ASSISTANT_AUTO_TITLE`/`ASSISTANT_TITLE_MODEL`, hard-timeout, silent fallback to the
    deterministic title); touch `updated_at` on send.
- **Wave B:** **opus review** + full gate + refresh Owner-acceptance.

Each subagent: the model named above, its own git worktree + branch `wp/assistant/R2.x` **off
`ux/integration`**, `pnpm install`, the full gate before handback, an honest report (done /
deviations / **NOT verified**). Prompt = execution-plan **§2 verbatim** + the WP brief from the R2
plan + the R2 hard rules below. After each wave: merge to `ux/integration` (you resolve conflicts),
run the full gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`), dispatch a reviewer
subagent on the diff, fix/log findings, tick `STATUS.md`'s R2 section in the house style (date ·
branch · sha · what · deviations · **NOT verified:**), commit.

**R2 hard rules (in addition to execution-plan §2):**
- **No migration** (schema stays v21 — `title`/`createdAt`/`updatedAt`/`entityKind`/`entityId` all
  exist). If a WP seems to need one, STOP and ask.
- **No new runtime dependency.** The LLM-refine title uses the **existing** SDK/session path as a
  bounded one-shot; it must **never be registered in the live-session map** and **never count toward
  `ASSISTANT_MAX_ACTIVE_SESSIONS`**, and it must **silently fall back** to the deterministic title on
  any error/timeout. Titling must never block or delay the reply.
- **Lifecycle correctness is the core of R2.2.** Prove by offline test (scripted `AgentSessionDriver`
  fake — never a real SDK/child/Anthropic call) that: a completed turn releases the session and frees
  the cap slot immediately; the next message resumes via `resume: sdkSessionId`; several quick threads
  no longer 409; an **errored/limited** turn never leaves a session `running` holding a slot; `stop`
  still parks. Preserve the SSE stream across park/resume (it's thread-level, not session-level).
- **Entity scoping uses the existing server filter** (`listThreads`/`?entity=kind:id`) — don't
  reinvent it; the fix is creating threads pinned + pointing the switcher at the filtered list.
- Everything stays `@elabs-ai/components-*` + semantic tokens, both themes; verify APIs/paths against the code and
  the pinned SDK `.d.ts` before building — report drift, don't guess.

**Stop and ask me only if:** a locked decision (D-AS24–D-AS26) needs changing; a migration or new
runtime dependency seems unavoidable; a `@elabs-ai/components-*` gap forces raw UI; or a WP can only be finished
with a live Claude token (owner-acceptance, not yours to run).

When Wave B is done, deliver the final report per execution-plan §9 and leave the R2 Owner-acceptance
items in `STATUS.md` as my ready-to-walk checklist (entity-scoped switcher; no more "too many
sessions" with release/resume; named + dated threads with rename — both themes).

Begin now: read the five docs, confirm the `ux/integration` baseline gate is green, then dispatch
Wave A (R2.1 ∥ R2.2).
