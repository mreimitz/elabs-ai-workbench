---
type: "Research Output"
title: "Orchestrator prompt \u2014 remediate the full-validation RC blockers"
description: "Paste the block below to your coding agent. It assumes the agent can spawn parallel sub-agents in"
tags: ["research", "RS-07"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Orchestrator prompt — remediate the full-validation RC blockers

Paste the block below to your coding agent. It assumes the agent can spawn parallel sub-agents in
their own git worktrees, validate their output, and choose a model per job.

---

You are the **orchestrator** for a release-candidate hardening pass on the MCP Token Footprint app
(repo root: this directory). A full production-readiness review already exists at
`research/full-validation/` — read `research/full-validation/README.md` first, then the specific
finding docs each task cites. Do **not** re-derive the findings; act on them.

## Your job

Fix the release-candidate blockers and the highest-value cleanups as a set of **parallel
sub-agents, each in its own git worktree**, then validate and integrate. You assign the model, scope
the worktree, and own the final gate.

## Hard rules (non-negotiable — from `CLAUDE.md` and `.claude/rules/`)

- **Definition of done is the gate:** `pnpm typecheck && pnpm test && pnpm build && pnpm lint` must
  pass. No task is "done" until its worktree passes the gate. "Green" means you ran it, not that you
  wrote it.
- **Contract-first:** any wire change goes in `packages/shared` (types + zod) first, then API, then
  web. Additive `/api` only.
- **brand-ui only** for any web UI: every visible element is a `@elabs-ai/components-*` component, semantic tokens
  only, no raw colors, no `dark:`. The `enforce-brand-ui` and `check-tokens` hooks will fight you if
  you break this.
- **Runtime boundary:** only `apps/api` touches MCP, secrets, or the DB; the browser gets redacted
  data. Never move secret/MCP logic into `apps/web`.
- **No new runtime dependencies** without flagging it to me. No `@elabs-ai/components-*` version bump.
- **Honest reporting:** each sub-agent leads its report with what it did NOT verify (especially
  anything visual/live — there's no provider key or the vendor tenant available, so those paths are
  read-and-reason, not executed).
- For every fix, add or extend a **test that locks the behavior** (the repo has 1532 API + 746 web
  tests — match that bar). Where a security fix has a natural negative test (traversal rejected,
  redirect blocked), write it.

## Worktree grouping (designed so no two agents edit the same files)

Spawn these as parallel worktrees. Groups are file-disjoint; the two that touch shared surfaces are
noted so you can serialize just those.

**Wave 1 — parallel, independent:**

- **WT-A · Collections data-safety & path traversal** *(Critical + High; highest risk)*
  Fixes: `02-api-review.md` C-1 and H-1/H-5/H-6, `06-security-review.md` H1.
  - Constrain the resolve `path` (`apps/api/src/collections/routes.ts`) and enforce containment in
    `apps/api/src/collections/git-sync.ts` using the existing `assertSafeRelativePath` helper before
    any `writeFileSync`/`rmSync`.
  - Add a per-collection mutex; stop `status()` mutating the worktree on a GET; fix `exportKind` so
    it can never overwrite/push a *different* member's file (honor the "remote-only files untouched"
    invariant).
  - Tests: traversal rejected; concurrent sync serialized; export never clobbers a sibling.
  - Model: **strongest reasoning model** (correctness- and concurrency-critical).

- **WT-B · Process lifecycle & resource leaks** *(High)*
  Fixes: `02-api-review.md` H-9, H-11, and the cascade-delete-during-run finding.
  - Add SIGTERM/SIGINT graceful shutdown in `apps/api/src/index.ts`: drain SSE, stop the run
    manager, close MCP/Agent-SDK children, close the DB.
  - Fix the leaked MCP stdio child on failed connect in `apps/api/src/mcp/client.ts` (`openSession`).
  - Prevent deleting a test/scenario from cascade-deleting a **live** run's rows while the loop
    spends (guard in `apps/api/src/testing/routes.ts` + reconsider the `ON DELETE CASCADE`).
  - Tests: shutdown closes children/DB; failed connect leaves no child; delete-blocked-while-running.
  - Model: **strongest reasoning model**.

- **WT-C · Debug-dump & assistant reference-dir writability** *(High, mostly mechanical + one
  security fix)*
  Fixes: `02-api-review.md` H-10, the assistant read-only-dir finding, `06` M3.
  - Delete the ungated `console.error("[QA-DEBUG roster]"…)` at
    `apps/api/src/providers/model-catalog.ts:300-301` (or gate it behind the existing debug env var,
    matching its siblings).
  - Make the assistant skill-authoring reference dir genuinely read-only
    (`apps/api/src/assistant/session-manager.ts` — remove it from `additionalDirectories` or route
    writes through the scope gate + workspace-frame path).
  - Tests: models fetch emits no raw tenant data; a native write to the reference dir is blocked.
  - Model: **mid-tier model** (small, well-specified).

- **WT-D · Skill ingest caps & GitHub-import traversal** *(High/Medium, security)*
  Fixes: `02-api-review.md` skills-caps finding, `06-security-review.md` M2.
  - Enforce `SKILL_MAX_FILE_BYTES`/`SKILL_MAX_TOTAL_BYTES`/`SKILL_MAX_FILES` on the
    `save-draft`/scaffold paths (`apps/api/src/skills/routes.ts`).
  - Reject `..`/absolute `subpath` and assert tmp-dir containment in
    `apps/api/src/skills/git-service.ts`.
  - Tests: oversize/zip-bomb rejected on all paths; `../` subpath rejected.
  - Model: **mid-tier model**.

- **WT-E · Asset-proxy SSRF hardening** *(Medium security)*
  Fixes: `06-security-review.md` M1.
  - In `apps/api/src/servers/routes.ts` asset proxy: `redirect:"manual"`, re-validate origin after
    any redirect, add a timeout, and do **not** forward stored custom auth headers off-origin.
  - Tests: off-origin redirect blocked; auth header not leaked cross-origin.
  - Model: **strong reasoning model** (security correctness).

- **WT-F · Web bundle splitting** *(High-value perf; web-only, disjoint from A–E)*
  Fixes: `03-web-review.md` H1 + M1, confirmed by the ~9.3 MB single-chunk measurement in
  `08-quality-gate.md`.
  - Introduce `React.lazy` + `Suspense` for the heavy routes (Monaco/`@elabs-ai/components-editor`, React Flow,
    charts, Mermaid) in `apps/web/src/App.tsx`; ensure the unreachable Skill Design/Trace surfaces
    aren't eagerly bundled.
  - Verify with `pnpm --filter web build` that the main chunk shrinks and no route errors; keep the
    build under the documented memory ceiling.
  - Model: **strong reasoning model** (bundler/lazy-boundary reasoning).

**Wave 2 — after Wave 1 merges (these touch shared web/contract surfaces; serialize to avoid churn):**

- **WT-G · Correctness cleanups (web)** *(High/Medium bugs)*
  Fixes: `03-web-review.md` H2 (`isTokenProfile` omits `generic_estimate` in `App.tsx` and
  `rows.ts`), M2/M3 (unguarded `localStorage.setItem` in `ServerReportDialog.tsx` and
  `CompatibilityView.tsx`), the two stale-response races (`ResourcePromptRun.tsx`,
  `ScaffoldFromServerWizard.tsx`), and add `AbortSignal` support in `apps/web/src/lib/api.ts`.
  - Model: **mid-tier model**.

- **WT-H · Dead code & duplication** *(Medium, safe deletions — do last so it doesn't fight A–G)*
  Fixes: `05-dead-code-duplication.md` — remove the 2 unused components, ~12 verified dead exports
  (incl. the 6 orphaned `lib/api.ts` wrappers), the unwired `insert-as-context` feature (+its test),
  and the unused `pino` dep in `apps/api`; extract the save/diff dialog trio and the grading
  judge-chain duplication only if low-risk. **Only touch items labeled "verified dead"** — leave the
  unverified tool output alone.
  - Model: **mid-tier model**, but require it to re-verify each deletion has zero remaining
    references before removing (grep + typecheck).

**Not code — do yourself or a cheap model, in parallel, no worktree needed:**

- **Docs truth-up** (`07-docs-consistency.md`): flip Skill IDE + Auto-Rating from "🔜 Planned" to
  built in `CLAUDE.md`; fix "web has no tests yet" and "not a router" in the rules docs; add the 6
  missing endpoint families to §6; add a CHANGELOG entry for the shipped waves. Model: **cheap/fast**.
- **Deployment exposure** (`04` H / `06` M4): change `docker-compose.yml` to `127.0.0.1:8080:8080`
  and note the no-auth constraint until team-server auth lands. Also add `*.timestamp-*.mjs` to
  ignore so `biome check` stays clean after web tests run locally (`08-quality-gate.md` note 1).
  Model: **cheap/fast**.

## Explicitly OUT of scope for this pass (flag, don't fix)

- The unauthenticated-API design and full SSRF posture on user-supplied MCP URLs — accepted for the
  local single-owner tool; belongs to the planned team-server work. Just confirm the compose bind
  fix landed.
- Anything requiring a live provider key or the vendor tenant.
- CI existence (`04` H): verify whether `.github/workflows/ci.yml` exists relative to the real git
  root and report; don't invent a workflow unless I confirm where it should live.

## Model-assignment guidance (summary)

- **Strongest reasoning model** → WT-A, WT-B, WT-E, WT-F (concurrency, lifecycle, security
  correctness, bundler boundaries).
- **Mid-tier model** → WT-C, WT-D, WT-G, WT-H (well-specified, localized changes).
- **Cheap/fast model** → docs, compose/ignore edits.
Right-size per task; don't put a small mechanical edit on the biggest model or a concurrency fix on
the smallest.

## Your orchestration loop

1. Create the worktrees for Wave 1 and dispatch with the model each is assigned. Give each sub-agent
   only its finding-doc section + the exact files, and the hard rules above.
2. When a sub-agent returns, **validate independently**: run the full gate in its worktree, read its
   diff, confirm it added a behavior-locking test, and confirm it stayed in its file scope.
3. Reject and re-dispatch anything that fails the gate, expands scope, or regresses a rule.
4. Merge Wave 1 (resolve any conflicts — they should be minimal by construction), then run Wave 2 in
   worktrees off the merged tip, validate, merge.
5. Run the **full gate once more on the integrated tip**, plus `pnpm build` for the web-chunk check.
6. Report: what merged, per-task gate results, the bundle-size before/after, any finding you chose
   to defer and why, and everything you did **not** verify.

Begin by reading `research/full-validation/README.md` and the cited finding docs, then propose the
worktree/model plan back to me before dispatching.

# Citations

None.
