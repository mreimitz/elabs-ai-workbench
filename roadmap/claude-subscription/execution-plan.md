# Claude subscription as a run model — orchestrated execution plan

The orchestration design a **single lead session (the orchestrator)** follows to drive
[`STATUS.md`](./STATUS.md) to done. The orchestrator plans batches, dispatches **one worktree
subagent per WP on the model assigned below**, validates each against the WP's Acceptance + the
quality gate, ticks the ledger, and repeats. Locked decisions D-CS1–D-CS10 are in
[`README.md`](./README.md).

---

## Roles & models

- **Orchestrator (this lead session): `opus`.** Plans batches, dispatches subagents, validates
  diffs against Acceptance + gate, ticks `STATUS.md`, resolves contention. Writes no product code
  itself beyond conflict fix-ups.
- **Subagents: one per WP, in an isolated git worktree** (`Agent` tool, `isolation: "worktree"`),
  on the model in the table. Each implements exactly one WP to its Acceptance and returns a summary
  of files changed + gate result.

### Model assignment (rationale: reasoning-heavy integration → `opus`; wire/UI/mechanical → `sonnet`)

| WP | Model | Why |
| --- | --- | --- |
| 0.1 shared contract | `sonnet` | Additive types/zod; mechanical but must be exact (barrier). |
| 0.2 credential + migration + auth | `sonnet` | Follows the `vendor_assistant` linked-auth pattern; migration is boilerplate. |
| 0.3 roster + Settings form | `sonnet` | Reuses `ASSISTANT_MODEL_ROSTER`; standard form work. |
| **1.1 executor core** | **`opus`** | The crux: generalize the judge one-shot to a multi-turn loop and map SDK `DriverEvent`s → `run_steps`/KPIs so the console renders identically. Deepest reasoning. |
| **1.2 run-service branch** | **`opus`** | Hot, high-blast-radius file (`run-service.ts`); must mirror the `vendor_assistant` fork without disturbing existing paths. |
| **1.3 MCP tools via SDK** | **`opus`** | Allow-list → SDK `mcpServers`/`disallowedTools` mapping + estimated `tool_result` metering + transport-vs-tool-error semantics. Subtle. |
| 1.4 skills materialization | `sonnet` | Materialize read-only files into the workspace; bounded. |
| **1.5 cost / cap** | **`opus`** | Shadow-pricing must feed the cost cap correctly (D-CS8) — a wrong sign here breaks guardrails silently. |
| **2.1 orchestrator + shared semaphore** | **`opus`** | Concurrency correctness across run + judge children (D-CS10); race-prone. |
| 2.2 suite report degradation | `sonnet` | Rendering + flags; no new algorithm. |
| 3.1 UI markers | `sonnet` | Reuse the `estimatedTokens` marker; both themes. |
| 3.2 report markers | `sonnet` | JSON/Markdown flags + footnote. |
| 3.3 auto-rating interaction | `sonnet` | Verify + document; small code. |

---

## Batches (dependency-ordered; within a batch = parallel worktrees)

```
Batch A  [barrier]      0.1 shared                                 sonnet ×1
Batch B  [parallel ×3]  0.2 credential | 0.3 roster | 1.1 executor sonnet, sonnet, OPUS
Batch C  [single]       1.2 run-service branch                     OPUS ×1   (hot file, no co-writer)
Batch D  [seq on exec]  1.3 MCP tools → 1.5 cost → 1.4 skills      OPUS, OPUS, sonnet
Batch E  [parallel ×2]  2.1 semaphore | 2.2 suite report           OPUS, sonnet
Batch F  [parallel ×3]  3.1 UI | 3.2 reports | 3.3 auto-rating      sonnet ×3
```

**Why these seams:**
- **A is a hard barrier** — every other WP imports the shared contract. Do not fan out until 0.1 is
  merged and typechecks.
- **B**: 1.1 builds against DI seams (injected auth resolver + driver), so it does **not** need 0.2
  merged first — it runs in parallel and is wired to the real resolver in C.
- **C is single-writer**: `apps/api/src/testing/run-service.ts` is a hot file other workstreams
  touch; only one agent edits it at a time.
- **D is sequenced, not parallel**: 1.3/1.4/1.5 all layer config onto the `claude-subscription-executor`
  module. Running them as parallel worktrees would conflict on the same file — do them in series
  (or one agent does 1.3+1.5, which are tightly coupled). Re-base each on the prior's merge.
- **E/F fan out** — different surfaces (concurrency vs report; console vs reports vs grading).

---

## Per-WP validation loop (the orchestrator runs this for every returned subagent)

1. **Re-base check** — worktree subagents fork from a **stale** base; confirm the worktree was
   `reset --hard` to the intended merge SHA before trusting the diff (see gotchas).
2. **Acceptance** — diff satisfies the WP line in `STATUS.md` + the relevant README decisions.
3. **Gate** — `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green (run per operational
   notes below — build serialized, tests via the workspace `test` script).
4. **Boundaries** — no secret leaves the API; wire changes landed in `packages/shared` first; UI uses
   `@brand/*` only; both themes read correctly for any visible change.
5. **Tick or bounce** — on pass, tick the box in `STATUS.md` with
   `— done <date> · wp/claude-subscription/<id>` and merge; on fail, send the subagent back with the
   specific gap (do **not** fix silently unless it's a trivial merge conflict).

## Stop conditions

- **Owner-acceptance items stay open.** Everything under `STATUS.md` → "Owner-acceptance" needs a
  live signed-in subscription and **cannot be validated headless** — leave those boxes unticked and
  hand them to the owner. The build is "done" when Phases 0–3 are ticked and the gate is green; the
  live walks are the owner's.
- **Contention hold.** If a sibling session is writing `packages/shared` or `run-service.ts`, hold
  that WP (0.1 / 1.2) until clear rather than racing.

## Operational gotchas (fold into every subagent brief — these are known traps in this repo)

- **pnpm version:** plain `pnpm` resolves to v11 and breaks install. Use the pinned toolchain —
  `corepack pnpm@9.15.4 -C <repo-root> …`.
- **Build OOM:** the parallel `pnpm build` can SIGTERM the web build under concurrent-session load;
  run `pnpm build -r --workspace-concurrency=1`, and if the web build OOMs use
  `NODE_OPTIONS=--max-old-space-size=3400`.
- **Tests resolve shared from a gitignored `dist`:** validate via the workspace `test` script /
  recursive `pnpm test`, never a bare `vitest run`.
- **Migrations:** claim the next free `PRAGMA user_version` **at claim time** by reading
  `apps/api/src/db/database.ts` `MIGRATIONS` — do not hardcode (siblings consume versions).
- **Worktree stale base:** subagent worktrees fork from a stale commit; `reset --hard` to the
  intended SHA before implementing.
- **Concurrent auto-commit:** another owner session may commit/push mid-task; re-check `git status`
  and rebase before committing/merging. **Commit/push only when the owner asks.**
