---
type: "Work Package Spec"
title: "WP 2.1 \u2014 mcpfp suite run: trigger, poll, result summary"
description: "Phase 2 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.1 — `mcpfp suite run`: trigger, poll, result summary

Phase 2 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](../RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.2 (the `mcpfp` CLI — done 2026-08-19, `wp/ci/1.2`), Benchmarks WP 3.2 (the
suite-run orchestrator — done; `POST /api/suites/:id/run` + the suite-run read surface exist).
**Consumed by:** WP 2.2 (suite/grade assertions + the baseline-delta PR-comment artifact renders
from this command's envelope) and WP 2.3 (the packaged GitHub Actions workflow invokes it).

---

## Locked decisions this WP implements

- **D-C1 (locked 2026-08-19)** — `mcpfp` is `apps/cli`, a workspace package whose **only runtime
  dependency is `@mcp-token-footprint/shared`**. No MCP SDK, no `better-sqlite3`, no `apps/api`
  import. A test reads the manifest **and** scans every import in `apps/cli/src` to keep it that way.
- **D-C5 (locked 2026-08-19)** — argument parsing is `node:util`'s `parseArgs`; HTTP is global
  `fetch`. **This WP adds no dependency**, so `pnpm-lock.yaml`'s `packages:`/`snapshots:` sections
  stay byte-identical.
- **D-C6 (locked 2026-08-19)** — **stdout is the payload, stderr is the narration.** Everything a
  machine consumes goes through `Emitter.payload`; every progress line, warning and error goes to
  stderr. Every string written passes the `redactTokens` pass.
- **D-C7 (locked 2026-08-19)** — the exit codes. `0` success · **`1` is reserved to
  `mcpfp assert` and nothing else may ever emit it** · `2` execution/config/transport error. A
  non-2xx response is a `2`.
- **D-C4 (locked 2026-08-19)** — the frozen scope tuple. `suites:run` is the scope that starts a
  suite run; polling and name resolution are reads and need `read`.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-C11 — `mcpfp suite run` WAITS by default, waits by POLLING, and maps a terminal suite-run
  status onto an exit code.**
  - *Waits by default*, because a CI step that fires and forgets cannot gate anything. `--no-wait`
    returns straight after the `202` with the suite-run id (exit `0`) for the deliberate fire-and-poll
    case.
  - *By polling* `GET /api/suite-runs/:id`, **not** by consuming the SSE stream. The stream would need
    an event-stream parser in a CLI whose whole point is that it has no dependencies, and it is the
    fragile half of the transport through proxies and CI runners. Polling a read endpoint is boring,
    resumable and correct; the run happens in the API either way.
  - *Exit codes*: `completed` → **0**; `error`, `capped` (the aggregate cost cap soft-stopped the
    matrix) and `stopped` (an operator halted it) → **2**; a wait budget exhausted while the status is
    still `pending`/`running` → **2**, naming the suite-run id so the operator can poll it. **Never
    `1`** — D-C7 reserves that for `mcpfp assert`, and WP 2.2's suite/grade assertions are what will
    legitimately emit it.
  - *Rating*: the command waits for a terminal status **and**, when the server sends a `ratingState`,
    for it to settle (`rated`/`failed`/`skipped`) — the same pair the suite SSE stream waits for, so
    the summary is not published while member grades are still landing. If the wait budget runs out
    with a **terminal** status but an unsettled rating, that is **not** a failure: the exit code comes
    from the terminal status and a loud stderr warning says the grades may be incomplete. **`--quiet`
    does not silence that warning** (same posture as D-C8's skip warnings).
- **D-C12 — the suite-run envelope composes exactly two reads, and says so in the type.** `data` for
  this command is `{ suiteRun, members }`, declared as `McpfpSuiteRunResult` in
  `packages/shared/src/cli-contract.ts`. The CLI does not compute, re-rank or re-shape either half —
  it fetches `GET /api/suite-runs/:id` and `GET /api/suite-runs/:id/members` and puts both in the
  envelope, because the API has no single endpoint returning both and WP 2.2's PR artifact needs the
  member rows. The client invariant is intact (transport + formatting); the composition is declared
  in `shared` rather than improvised in the command, so WP 2.2 types against it instead of
  re-deriving it from prose.

---

## What we're building

1. **`mcpfp suite run <suite>`** — start a saved suite's matrix run and, by default, wait for it,
   then print a result summary. `<suite>` is a suite id **or its exact name** (the same
   id-then-name-fallback shape `mcpfp scan <server>` already has).
2. **`--no-wait`** (return after the `202`) and **`--wait <seconds>`** (the total wait budget,
   defaulting to a shared constant), plus `--format human|json` and the existing global flags.
3. **Progress narration on stderr** while polling — cells completed / total, from the suite run's
   `aggregates` — emitted only when the number actually changes, so a 40-minute matrix does not
   produce 500 identical lines in a build log. Silenced by `--quiet` (it is narration, D-C6).
4. **A human summary and a JSON envelope**: status, timing, the matrix size, tokens, execution and
   judge cost, mean grade + pass rate when graded, and a bounded member table. `data` is
   `McpfpSuiteRunResult` (D-C12).
5. **Help** — a `suite run` topic in `COMMAND_HELP`, the command in the top-level command list, and
   the "Not built yet" line reduced to WP 2.2's artifact alone.
6. **Two documentation corrections folded in** (both are one-liners this WP owns because it owns
   `apps/cli`):
   - `apps/cli/src/help.ts:142-143` still says a **remote `mcpfp assert` caller needs an execute
     scope**. That has been false since WP M.2 mapped `POST /api/assertions/evaluate → read`
     (D-C10, closed). Replace it with the truth: a remote assert caller needs `read`.
   - the same file's global "Configuration" paragraph says "`scan` needs `scan:run`; everything else
     needs `read`" — extend it so `suite run` names `suites:run` **plus** `read` (it polls).
7. **`user-guide/22-mcpfp-cli.md`** — a `suite run` section matching the shipped behaviour, including
   the exit-code table and the CI invocation warning (`node apps/cli/dist/index.js`, never
   `pnpm --silent`, which collapses `2` onto `1`).

### Explicitly NOT in this WP

Suite/grade **assertions** (min score, max cost) and the baseline-delta **PR-comment artifact** — both
WP 2.2, and `--format markdown` must therefore stay unsupported for this command · a GitHub Actions
workflow file (WP 2.3) · SSE streaming (D-C11) · suite **CRUD** from the CLI (no create/edit/delete —
and per D-MCP3's spirit the CLI gains no delete of anything) · running a **collection** or **ad-hoc**
plan (`POST /api/run-plans`) — the ledger row is `suite run`, and the two-path launcher is the UI's
and WP M.3's · any API change (this WP adds **no route, no schema change, no migration**) · any web
change · any new dependency · any change to the scope vocabulary.

---

## Design (implement this, don't redesign it)

### 1. `packages/shared/src/cli-contract.ts` — additive declarations

`MCPFP_OUTPUT_VERSION` stays **1**: this is a new command putting a new `data` in the existing
envelope, which is exactly what `data` is for.

```ts
/** How often `mcpfp suite run` re-reads the suite run while waiting. */
export const MCPFP_SUITE_RUN_POLL_INTERVAL_MS = 5_000;

/** Total wait budget for `mcpfp suite run` when `--wait` is not given. */
export const MCPFP_SUITE_RUN_DEFAULT_WAIT_MS = 1_800_000; // 30 minutes

/** Members `mcpfp suite run` lists in the HUMAN rendering. `--format json` carries all of them. */
export const MCPFP_SUITE_RUN_MEMBER_ROWS = 10;

/**
 * `mcpfp suite run --format json`'s `data` (D-C12). Two API reads, composed here rather than in the
 * command, because no single endpoint returns both and WP 2.2's PR artifact needs the member rows.
 * Neither half is re-shaped by the CLI: `suiteRun` is `GET /api/suite-runs/:id` verbatim and
 * `members` is `GET /api/suite-runs/:id/members` verbatim.
 *
 * `members` is `[]` under `--no-wait` — the run has not produced any yet, and an empty array is the
 * honest answer rather than an absent field a consumer would have to special-case.
 */
export type McpfpSuiteRunResult = {
  suiteRun: SuiteRun;
  members: SuiteRunMember[];
};
```

Import `SuiteRun` / `SuiteRunMember` from `./types.js` (both already exported through `index.ts`).

### 2. `apps/cli/src/commands/suite-run.ts` — the command

Structure it exactly like `commands/scan.ts`:

```ts
export async function runSuiteRunCommand(
  context: CommandContext,
  ref: string,
  options: { wait: boolean; waitMs: number },
): Promise<McpfpExitCode>
```

Flow:

1. **Start.** `POST /api/suites/${encodeURIComponent(id)}/run` with `scope: "suites:run"` on the
   request (so a `403 scope_forbidden` names the right scope — the `client.ts` mechanism already does
   this). Returns the `SuiteRun` from the `202`.
   **Id first, name second**, mirroring `runScanFor`: try the POST with `ref` as an id; on a **404**
   only, `GET /api/suites`, resolve `ref` as an **exact** name, and POST again. Rationale is the same
   as `scan`'s and must be repeated in the comment: a token minted with `suites:run` alone may not be
   able to list suites, and listing first would 403 a token that is perfectly able to do its job.
   An ambiguous name lists the candidate ids and exits `2` (reuse the shape of
   `resolveServerRef`'s error; write `resolveSuiteRef` beside it in this file rather than
   generalising `servers.ts` — one call site is not a shared helper).
2. **`--no-wait`** → emit the envelope/summary now with `members: []` and return `0`.
3. **Wait.** Loop until terminal, sleeping `MCPFP_SUITE_RUN_POLL_INTERVAL_MS` between reads of
   `GET /api/suite-runs/:id` (`scope: "read"`), tracking a deadline of `waitMs` from the start of the
   wait. Terminal = `status ∈ {completed, capped, stopped, error}` **and** (`ratingState` absent, or
   `ratingState ∈ {rated, failed, skipped}`) — D-C11.
   Narrate on stderr only when `aggregates.cellsCompleted` changes:
   `Suite run <id>: 12/40 cells, $0.31 so far…`. Use `formatNumber`/`formatUsd`-style helpers already
   in `shared/format.ts` if they fit; do not invent new formatting.
   Sleep with a plain `await new Promise((r) => setTimeout(r, …))` — no dependency, and make it
   injectable through `CommandContext` **only if** the existing test harness needs it (check
   `apps/cli/test/harness.ts` first; prefer a short poll interval in tests over a new seam).
4. **Members.** Once terminal, `GET /api/suite-runs/:id/members` (`scope: "read"`). A failure here is
   a normal `CliError` → exit `2`: the summary is the deliverable, and silently reporting zero members
   would read as "the matrix ran nothing".
5. **Emit.** `--format json` → `emitJson(context, { suiteRun, members })`. `human` → the rendering
   below.
6. **Exit code** per D-C11. On a non-`completed` terminal status, call `context.emitter.fail(...)`
   with one sentence naming the status and the suite-run id, then return `MCPFP_EXIT.error`.
   On a budget exhausted with a terminal status but unsettled rating, call `context.emitter.warn(...)`
   (a `warn` survives `--quiet`) and return the status-derived code.

**Human rendering** — `renderFields` for the header, `renderTable` for the members, both already in
`output.ts`:

- Header: Suite (name + id, or "— (ad-hoc)" when `suiteId` is absent), Suite run id, Source, Status,
  Started/Ended, Duration, Rating state.
- Aggregates: cells completed/total, mean grade, grade std-dev, pass rate @0.5, total tokens,
  execution cost, judge cost. Every one of these can legitimately be `null` — render `—`, never `0`.
- Members: the `MCPFP_SUITE_RUN_MEMBER_ROWS` **worst-scoring** members first (that is what an
  operator opens the log for), each with status, score, tokens, cost; a `…and N more` line when it
  bit. Sorting for display is presentation, not computation — it does not touch `data`.
- Last line, so it survives `| tail -1`: one verdict sentence —
  `Suite run <id> completed: 40/40 cells, mean grade 0.82, $1.14.`

### 3. `apps/cli/src/cli.ts` — wiring

- `OPTIONS` gains `wait: { type: "string" }` and `"no-wait": { type: "boolean" }`.
- Both are refused on every other command, in the existing "flags that only mean something on one
  command" block: `mcpfp scan foo --no-wait` must be a named error, not a silently ignored flag.
- `SUPPORTED_FORMATS` gains `"suite run": ["human", "json"]`. **`markdown` is deliberately absent** —
  it is WP 2.2's PR-comment artifact, and offering the flag early would write a human table into a
  file a later step tried to parse (the comment already in that map explains this for `assert`; say
  the same here).
- `routeFor`: `command === "suite"` with `args[0] === "run"` and `args[1]` the ref. A missing
  subcommand or a wrong one is a named usage error listing `run` as the only subcommand (mirror the
  `config` branch). A missing ref is a usage error naming `mcpfp suite run <suite>`.
- `Route` gains `{ kind: "suite-run"; name: "suite run"; formatKey: "suite run"; suiteRef: string }`;
  `dispatch` gains the case. Parse `--wait` as a positive integer number of **seconds** and turn it
  into ms; a non-numeric or non-positive `--wait` is a `2` naming the flag.

### 4. Tests — `apps/cli/test/`

The harness (`apps/cli/test/harness.ts`) already runs the CLI in-process against a `node:http` stub.
Extend it; do not build a second harness.

- **Happy path**: stub answers `202` then `running` → `running` → `completed`, plus members. Assert
  exit `0`, the poll count, that stdout holds nothing but the JSON envelope under `--format json`,
  and that the envelope's `data` has exactly the keys `suiteRun` + `members`.
- **Exit-code table** (extend `exit-codes.test.ts`): `completed`→0, `error`→2, `capped`→2,
  `stopped`→2, budget-exhausted-while-running→2, `--no-wait`→0. And the invariant that matters:
  **no path returns `1`** — assert it over the whole matrix, and keep the existing WP 1.2 test that
  scans the source for references to the assertion-failure constant working (add
  `suite-run.ts` to whatever it globs, or verify it already globs the directory).
- **Rating wait (D-C11)**: terminal status with `ratingState: "rating"` keeps polling; settling to
  `rated` finishes. Budget exhausted with terminal-status-but-unsettled-rating exits with the
  **status-derived** code and prints the warning **even with `--quiet`**.
- **Name fallback**: a `404` on the id POST triggers exactly one `GET /api/suites`, then a second
  POST with the resolved id. An ambiguous name exits `2` without a second POST.
- **Scope message**: a `403` with `code: "scope_forbidden"` on the start POST produces a message
  naming `suites:run`.
- **Redaction**: a stubbed API error body that echoes `mcpfp_…` back never reaches either stream
  unredacted (the existing redaction test's shape).

Every new guardrail test must be **proved to bite** — the orchestrator will revert the guard and
expect it red.

---

## Files

**New**
- `apps/cli/src/commands/suite-run.ts`
- `apps/cli/test/suite-run.test.ts`

**Modified**
- `packages/shared/src/cli-contract.ts` (additive only)
- `apps/cli/src/cli.ts` (OPTIONS, `SUPPORTED_FORMATS`, `Route`, `routeFor`, `dispatch`)
- `apps/cli/src/help.ts` (new topic + command list + the two corrections in §6)
- `apps/cli/test/exit-codes.test.ts`, `apps/cli/test/commands.test.ts`,
  `apps/cli/test/harness.ts` (only if the stub needs a new route)
- `user-guide/22-mcpfp-cli.md`

**Zero-line diff (verified with `git diff main..HEAD -- <path>`)**
- `apps/api/**` — this WP adds no route, no handler, no schema and no test on the API side
- `apps/web/**`
- `packages/shared/src/api-tokens.ts`, `ci-assertions.ts`, `workbench-mcp.ts`, `types.ts`,
  `schemas.ts`, `constants.ts` — nothing here needs a wire change; `cli-contract.ts` is the one
  shared file this WP touches
- `packages/shared/src/index.ts` — `cli-contract.js` is already exported
- `apps/api/src/db/**` — no migration
- `pnpm-lock.yaml`'s `packages:` / `snapshots:` sections, and every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts` — no environment variable
- `apps/cli/src/client.ts` — the transport is complete; if you believe it is not, report why rather
  than editing it

---

## Acceptance

Each item is independently checkable; cite the file:line or test name that proves it.

- **A1** — `mcpfp suite run <suiteId>` starts the suite run via `POST /api/suites/:id/run` and, by
  default, polls `GET /api/suite-runs/:id` until terminal, then prints a summary. The CLI issues no
  request other than those two plus `GET /api/suite-runs/:id/members` (and, only on a 404,
  `GET /api/suites`) — asserted against the stub's recorded request log.
- **A2** — `<suite>` accepts an exact **name**: the id POST is tried first, and `GET /api/suites` is
  requested **only** after a 404. An ambiguous name lists candidate ids and exits `2`.
- **A3 (D-C11 exit codes)** — the full table holds: `completed`→**0**, `error`→**2**, `capped`→**2**,
  `stopped`→**2**, wait budget exhausted while non-terminal→**2**, `--no-wait`→**0**. **No input
  produces `1`**, and the WP 1.2 source-scan invariant (nothing but `assert` references the
  assertion-failure exit constant) still passes with the new file in scope.
- **A4 (D-C11 rating)** — the wait continues past a terminal status while `ratingState` is
  `pending`/`rating` and finishes when it settles. Budget exhausted with a terminal status but an
  unsettled rating exits with the **status-derived** code and prints a warning that **`--quiet` does
  not silence**.
- **A5 (D-C6)** — under `--format json`, stdout contains **exactly** the envelope and nothing else;
  every progress line, warning and error is on stderr; a stubbed API error body echoing a
  `mcpfp_…` token reaches neither stream unredacted.
- **A6 (D-C12)** — `data` is `McpfpSuiteRunResult` with exactly the keys `suiteRun` and `members`,
  each verbatim from its endpoint (no field added, renamed, re-ordered or computed by the CLI), and
  the type is declared in `packages/shared/src/cli-contract.ts`. `--no-wait` yields `members: []`.
- **A7 (D-C5/D-C1)** — no dependency was added: `apps/cli/package.json` still lists exactly
  `@mcp-token-footprint/shared`, the manifest+import scan test passes, and `pnpm-lock.yaml`'s
  `packages:`/`snapshots:` sections are byte-identical.
- **A8** — `--format markdown` on `suite run` is refused with the message naming the formats it does
  support (`human, json`), never silently downgraded. `--wait`/`--no-wait` on any other command are
  refused by name.
- **A9 (the two corrections)** — `apps/cli/src/help.ts` no longer claims a remote `mcpfp assert`
  caller needs an execute scope (it needs `read`, per D-C10/WP M.2), and the configuration paragraph
  states that `suite run` needs `suites:run` **plus** `read`. Quote both new sentences.
- **A10** — `mcpfp help` lists `suite run`; `mcpfp help suite` (and `mcpfp help "suite run"`, if the
  lookup key allows it) prints the topic; the "Not built yet" line names only WP 2.2's artifact.
  `user-guide/22-mcpfp-cli.md` documents the command, its flags, its exit codes and the
  `node apps/cli/dist/index.js` CI invocation.
- **A11 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` run **separately**. Report exit codes and test
  counts. Two failures are **pre-existing on `main`** and must be reported as such, never fixed
  silently and never allowed to mask a new one: 2 tests in
  `apps/api/test/compatibility-data.test.ts` (stale model roster) and `pnpm lint` refusing
  `research/token-context-comparison/comparison/all-models.json` (1.8 MiB over Biome's 1 MiB cap).
- **A12 (no drive-by scope)** — Every path in the zero-line-diff list has a zero-line diff, and no
  file outside the Files section changed. In particular `apps/api/**` is untouched. You did **not**
  touch any `STATUS.md`.
