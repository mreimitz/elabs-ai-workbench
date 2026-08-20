---
type: "Work Package Spec"
title: "WP M.3 \u2014 scoped write tools on the workbench MCP mount"
description: "Phase MCP of mcp-server.md. Ledger: STATUS.md. Shared rules"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP M.3 — scoped write tools on the workbench MCP mount

Phase MCP of [`mcp-server.md`](./mcp-server.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules:
the [testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP M.1 (the read-only mount — done 2026-08-19, `wp/ci/M.1`), WP M.2 (the scope
mechanism — done 2026-08-20, `wp/ci/M.2`).
**Consumes:** the frozen D-C4 scope vocabulary, unchanged. This WP adds **zero** scopes.

---

## Locked decisions this WP implements

- **D-MCP3 (locked 2026-08-19)** — read-first; write tools arrive **only** behind explicit token
  scopes, because headless has no interactive approval, so **scope = consent**. **Deletes are
  excluded entirely, at every phase.**
- **D-MCP4 (locked 2026-08-19)** — one tool registry. Every tool here **re-projects** a service
  function that already exists (`ScanService.runScan`, `SuiteOrchestrator.startSuiteRun` /
  `startPlanRun` + `resolveRunPlan`, `buildRunPlanEstimate`). **No logic in the MCP layer.**
- **D-MCP5 (locked 2026-08-19)** — the definition footprint is measured and budgeted
  (`WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET`, currently **3000**; the 21-tool read surface measures
  ~2206 in-test / ~2224 scanned).
- **D-MCP6 (locked 2026-08-19)** — the whole mount is behind the `mcp_server` Settings › Features
  flag. Nothing new is flagged here.
- **D-MCP7 (locked 2026-08-20)** — **a tokenless loopback caller keeps FULL access to the mount,
  explicitly including the write tools this WP adds.** `grantedScopes === null` means "no credential
  was involved", never "a token with no scopes". `API_AUTH_REQUIRED=true` is the single switch that
  changes this, for the whole API.
- **D-MCP8 (locked 2026-08-20)** — `read` is the price of admission to the mount
  (`API_TOKEN_ROUTE_SCOPES`: `POST /api/mcp → read`). A write-capable agent therefore holds `read`
  **plus** its execute scope; a `scan:run`-only token cannot open the mount at all. **Do not change
  this to accommodate the write tools.**
- **D-C4 (locked 2026-08-19)** — the scope tuple `read` · `scan:run` · `runs:launch` · `suites:run`
  is **frozen**. This WP maps the three execute scopes onto three tools and adds nothing.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-MCP10 — exactly three write tools, one per execute scope, and the scope decides the tool.**
  `scan_run` needs `scan:run`; `suite_run_start` needs `suites:run`; `run_plan_start` needs
  `runs:launch`. **`run_plan_start` refuses `source: "suite"`** and names `suite_run_start` in the
  refusal, so a `runs:launch` token can never run a saved suite through the generic plan endpoint —
  the two scopes would otherwise be indistinguishable in practice, which would make `suites:run`
  decorative. The refusal is a readable `isError` result, not a validation crash.
- **D-MCP11 — a write tool answers with the ticket, not the outcome, and names the read tool that
  finishes the job.** `scan_run` is synchronous in the API (`ScanService.runScan` awaits), so it
  returns a compact scan summary; the two launch tools are asynchronous by construction (the
  orchestrator returns a `running` `SuiteRun` immediately), so they return the suite-run id + status
  and **point at `suite_runs_get`** for polling. No write tool blocks on a matrix, no write tool
  invents a "wait" mode, and no polling tool is added — `scans_get` and `suite_runs_get` already
  exist and are already `read`.
- **D-MCP12 — every launch tool carries an advisory cost estimate in its result, and it is the
  SAME estimate the UI's launcher shows.** `buildRunPlanEstimate` (`apps/api/src/estimate/service.ts`,
  behind `GET /api/estimate/run-plan`) is re-projected, not re-derived. It is advisory only: it never
  blocks a launch, and a model with no pricing entry reports unpriced rather than zero. This is what
  makes `mcp-server.md`'s "each write tool's description states its cost behavior" true in the
  *result* and not only in the prose.
- **D-MCP13 — the caller parameter of `createWorkbenchMcpServer` becomes REQUIRED.** It currently
  defaults to `TRUSTED_LOCAL_CALLER` (allow-everything). That is harmless while one call site exists
  and every tool is a read; it stops being harmless the moment a forgotten argument would hand a
  second embedding the three write tools. A default-open parameter in an authorization path is a
  latent privilege escalation, so this WP removes the default and makes each embedding say who it is.

---

## What we're building

1. **Three write tools on the mount**, declared contract-first in
   `packages/shared/src/workbench-mcp.ts` and implemented as re-projections in
   `apps/api/src/mcp-server/tools.ts`:
   - **`scan_run`** (`scan:run`) — run a discovery scan against a registered MCP server. Re-projects
     `ScanService.runScan(serverId, tokenProfile?)`, i.e. exactly `POST /api/servers/:id/scan`.
   - **`suite_run_start`** (`suites:run`) — start a saved benchmark suite's matrix run. Re-projects
     `SuiteOrchestrator.startSuiteRun(suiteId)`, i.e. exactly `POST /api/suites/:id/run`.
   - **`run_plan_start`** (`runs:launch`) — start a `collection` or `adhoc` run plan. Re-projects
     `resolveRunPlan(...)` + `SuiteOrchestrator.startPlanRun(...)`, i.e. exactly
     `POST /api/run-plans` minus the `suite` source (D-MCP10).
2. **The tool-name declaration widened from "read tools" to "tools"** — a `WORKBENCH_MCP_WRITE_TOOL_NAMES`
   tuple beside the existing read one, a `WORKBENCH_MCP_TOOL_NAMES` union of the two, and the
   existing gate tests (`tools/list` set-equality, the `WORKBENCH_MCP_TOOL_SCOPES` key-set test, the
   `WORKBENCH_MCP_TOOL_FAMILIES` partition test) extended to cover the union rather than replaced.
3. **Scope declarations for the three new tools** in `WORKBENCH_MCP_TOOL_SCOPES` — the *only* place a
   tool's required scope is written. The M.2 dispatch gate (`withScopeEnforcement` /
   `missingScopeForTool` in `apps/api/src/mcp-server/server.ts`) then enforces them with **no change
   to that file's gate logic**.
4. **An "Actions" tool family** in `WORKBENCH_MCP_TOOL_FAMILIES` so the generated
   `GET /api/mcp/llms.txt` documents the write surface — including the sentence that a write tool
   needs `read` **plus** its execute scope (D-MCP8), which is the one thing a token-minting operator
   gets wrong.
5. **`createWorkbenchMcpServer`'s `caller` parameter made required** (D-MCP13), with every call site
   updated to pass one explicitly.
6. **Docs** — the write surface, its scopes, and its cost behaviour in
   [`user-guide/20-workbench-mcp-server.md`](/user-guide/DC-16-workbench-mcp-server/20-workbench-mcp-server.md) (which
   currently states the mount is read-only — that sentence must become accurate, not disappear) and a
   scope-to-capability line in
   [`user-guide/21-service-tokens.md`](/user-guide/DC-17-service-tokens/21-service-tokens.md).

### Explicitly NOT in this WP

Any new scope (D-C4 froze the vocabulary) · **any delete, prune, or revoke capability, in any form,
at any depth** (D-MCP3) · any config/CRUD write (no server create/edit, no skill edit, no token
minting, no settings write) · a `wait`/`poll` mode on a write tool (D-MCP11) · a new polling tool
(`scans_get`/`suite_runs_get` already exist) · a second auth knob or any new environment variable
(D-MCP7) · a migration (this WP persists nothing new) · a new runtime dependency · any web UI change
(no `<Route>`; `ASSISTANT_ROUTE_MANIFEST` must have a **zero-byte diff**) · any change to the
`assistant/` tool surface or `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS`/`deriveAssistantScope` ·
raising `WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET` (see A9).

---

## Design (implement this, don't redesign it)

### 1. `packages/shared/src/workbench-mcp.ts` — the declaration

**Zero deletions from this file.** `WORKBENCH_MCP_READ_TOOL_NAMES`, `WorkbenchMcpReadToolName` and
`WORKBENCH_MCP_READ_TOOL_NAME_SET` all stay exported and unchanged — other code and tests read them.
Add, additively:

```ts
/**
 * The WRITE tools (WP M.3). Three, one per execute scope in the frozen D-C4 vocabulary — and that is
 * not a coincidence: a scope with no tool is decorative, and a tool with no scope of its own is a
 * privilege the operator cannot decline. Nothing here deletes (D-MCP3, at every phase).
 */
export const WORKBENCH_MCP_WRITE_TOOL_NAMES = [
  "scan_run",
  "suite_run_start",
  "run_plan_start",
] as const;

export type WorkbenchMcpWriteToolName = (typeof WORKBENCH_MCP_WRITE_TOOL_NAMES)[number];

/** Every tool the mount registers — reads and writes, in registration order. */
export const WORKBENCH_MCP_TOOL_NAMES = [
  ...WORKBENCH_MCP_READ_TOOL_NAMES,
  ...WORKBENCH_MCP_WRITE_TOOL_NAMES,
] as const;

export type WorkbenchMcpToolName = WorkbenchMcpReadToolName | WorkbenchMcpWriteToolName;

export const WORKBENCH_MCP_WRITE_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  WORKBENCH_MCP_WRITE_TOOL_NAMES,
);
```

Extend `WORKBENCH_MCP_TOOL_SCOPES` with exactly three entries under a new `── Actions ──` band:

```ts
  scan_run: "scan:run",
  suite_run_start: "suites:run",
  run_plan_start: "runs:launch",
```

Widen `WORKBENCH_MCP_TOOL_SCHEMAS`'s `satisfies` clause from
`Record<WorkbenchMcpReadToolName, z.ZodRawShape>` to `Record<WorkbenchMcpToolName, z.ZodRawShape>`
and add the three shapes:

```ts
  // ── Actions (write — WP M.3) ─────────────────────────────────────────────────────────────────
  scan_run: { serverId: idField, tokenProfile: z.enum(TOKEN_PROFILES).optional() },
  suite_run_start: { suiteId: idField },
  run_plan_start: {
    source: z.enum(["collection", "adhoc"]),
    collectionId: z.string().optional(),
    testIds: z.array(z.string()).max(WORKBENCH_MCP_MAX_LIST_LIMIT).optional(),
    scenarioIds: z.array(z.string()).max(WORKBENCH_MCP_MAX_LIST_LIMIT).optional(),
    repetitions: z.number().int().min(1).max(SUITE_MAX_REPETITIONS).optional(),
    maxConcurrency: z.number().int().min(1).max(SUITE_MAX_CONCURRENCY).optional(),
    aggregateCostCapUsd: z.number().positive().optional(),
  },
```

Notes that matter:

- `run_plan_start`'s shape is **flat and permissive at the schema layer, strict at the handler**,
  because `registerTool`'s `inputSchema` is a ZodRawShape and cannot express a discriminated union.
  The handler builds the real `RunPlanInput` and hands it to the **existing `runPlanInputSchema`**
  for validation, so the wire contract is enforced by the same parser `POST /api/run-plans` uses —
  never by a hand-written check (D-MCP4). A `source: "collection"` with no `collectionId`, or an
  `adhoc` with no `testIds`, therefore fails in `runPlanInputSchema` and surfaces as a readable
  `isError` result via the existing `safeTool` wrapper.
- **`source` deliberately has no `"suite"` member** (D-MCP10). The enum is the first line of defence
  and the SDK refuses it before the handler runs; the handler *additionally* refuses the string
  `"suite"` with the sentence naming `suite_run_start`, so an agent that guesses gets told what to
  use rather than a schema dump.
- `judgeOverride` and `variants` are **not** exposed. They are the two plan knobs that reference
  provider credentials and skill versions respectively; a headless agent has no business tuning them
  and leaving them off keeps the definition footprint down. An agent that needs them saves a suite.
- Import `TOKEN_PROFILES`, `SUITE_MAX_REPETITIONS`, `SUITE_MAX_CONCURRENCY` from
  `./constants.js` — they are already declared there; do not restate the numbers.

Add one family to `WORKBENCH_MCP_TOOL_FAMILIES` (last, after "Suites & collections"):

```ts
  {
    label: "Actions",
    when:
      "Reach for these to make the workbench DO something: run a discovery scan, start a saved " +
      "benchmark suite, or launch a collection/ad-hoc run plan. Each needs its own token scope on " +
      "top of `read`, and each returns a ticket to poll with `scans_get` or `suite_runs_get` " +
      "rather than waiting. Nothing here deletes anything.",
    tools: ["scan_run", "suite_run_start", "run_plan_start"],
  },
```

The family type's `tools` field must widen from `readonly WorkbenchMcpReadToolName[]` to
`readonly WorkbenchMcpToolName[]`.

### 2. `apps/api/src/mcp-server/tools.ts` — three re-projections

`WorkbenchMcpToolDefinition.name` widens to `WorkbenchMcpToolName`; `defineTool`'s `name` parameter
widens with it. Everything else in that file is untouched.

`WorkbenchMcpDeps` grows exactly what the three handlers need, and nothing else:

```ts
  /** The scan service the HTTP scan route uses — `runScan` is re-projected verbatim (D-MCP4). */
  scanService: ScanService;
  /** The suite orchestrator behind `POST /api/suites/:id/run` and `POST /api/run-plans`. */
  suiteOrchestrator: SuiteOrchestrator;
  /** The run-plan resolver's dependencies (`suites`/`collections`/`tests` services). */
  runPlans: RunPlanDeps;
  /** The launcher's advisory estimate (`buildRunPlanEstimate`) — D-MCP12. */
  estimate: EstimateDeps;
```

Handlers — each is thin, and each must be a *call*, not a copy:

- **`scan_run`** → `await deps.scanService.runScan(serverId, tokenProfile)`. Return a compact
  summary, **not** the full `ScanDetail` (which carries every tool's raw definition and would blow a
  host's context): `{ scanId, serverId, serverName, status, scannedAt, totalTools, totalTokens,
  totalRawBytes, tokenProfile, countingVersion, errorMessage? }`, plus a
  `next: "Call scans_get with this scanId for the per-tool breakdown."` line. A scan whose `status`
  comes back `failed` is returned as an **`isError` result** carrying that same summary — the
  request succeeded, the scan did not, and an agent must not read a zero-tool scan as a clean bill of
  health (this mirrors `mcpfp scan`'s exit-2 rule, D-C7).
- **`suite_run_start`** → `deps.suiteOrchestrator.startSuiteRun(suiteId)`. Return
  `{ suiteRunId, suiteId, status, startedAt, source, estimate, next: "Call suite_runs_get …" }`.
  The estimate is built from the saved suite's own membership:
  `buildRunPlanEstimate(deps.estimate, { testIds: suite.testIds, environmentIds: suite.scenarioIds,
  repetitions: suite.config.repetitions })`, read via `deps.runPlans.suites.get(suiteId)` **before**
  the launch so an unknown suite 404s once, in one place.
- **`run_plan_start`** → refuse `"suite"` (D-MCP10) → build the `RunPlanInput` → `runPlanInputSchema.parse(...)`
  → `resolveRunPlan(input, deps.runPlans)` → `buildRunPlanEstimate(deps.estimate, { testIds:
  resolved.testIds, environmentIds: resolved.scenarioIds, repetitions: resolved.config.repetitions })`
  → `deps.suiteOrchestrator.startPlanRun(resolved)`. Return the same envelope as `suite_run_start`
  (`suiteRunId` present, `suiteId` absent for a collection/adhoc plan).
  **Order matters: resolve and estimate BEFORE starting**, so a plan that cannot resolve never
  creates a `suite_runs` row.

Every tool description must state, in one sentence each: what it does, that it **costs money or
wall-clock** (a scan opens a real MCP connection; a launch spends provider tokens against the
configured cost caps), the scope it needs, and the read tool that finishes the job. Keep them tight —
A9 measures them.

`estimate` is advisory (D-MCP12): if `buildRunPlanEstimate` throws for any reason, the launch still
proceeds and the result carries `estimate: null` with a one-line `estimateNote`. A cost preview must
never be the reason a launch fails.

### 3. `apps/api/src/mcp-server/server.ts` — one signature change, no gate change

Remove the `= TRUSTED_LOCAL_CALLER` default from `createWorkbenchMcpServer`'s `caller` parameter
(D-MCP13) and keep `TRUSTED_LOCAL_CALLER` exported for embeddings that legitimately want it. Update
the JSDoc to say the parameter is required and why.

**`missingScopeForTool`, `withScopeEnforcement`, `scopeRefusal` and `UNDECLARED_TOOL_SCOPE` are
byte-identical after this WP.** That is the point of M.2: the gate was built once, and adding the
first tools that actually need it must not require touching it. If you find yourself editing that
logic, stop — you are solving the wrong problem.

### 4. `apps/api/src/mcp-server/routes.ts` + `apps/api/src/index.ts` — wiring

`routes.ts` already passes a real caller; it needs no change beyond the `WorkbenchMcpDeps` type
flowing through. `index.ts` extends the `registerWorkbenchMcpRoutes(server, { … })` bag with
`scanService`, `suiteOrchestrator`, `runPlans` and `estimate`, **reusing the instances already
constructed above that call** — the MCP mount never constructs its own service (the banner at
`index.ts:1513` says so; keep it true).

`apps/api/src/mcp-server/self-scan.ts` embeds the mount for the dogfood gate; if it calls
`createWorkbenchMcpServer` (or builds the deps bag) it must now pass `TRUSTED_LOCAL_CALLER`
explicitly and supply the four new deps. It is a measurement harness — it must **not** be given a
path that could actually launch anything; if wiring real services into it is awkward, wire narrow
stubs that throw, and say so in a comment. The self-scan only ever calls `tools/list`.

### 5. Tests

Extend, don't replace:

- `apps/api/test/workbench-mcp-server.test.ts` — the `tools/list` set-equality now compares against
  `WORKBENCH_MCP_TOOL_NAMES`; the definition-token measurement it prints now covers 24 tools.
- `apps/api/test/mcp-server-scopes.test.ts` — the key-set test now compares
  `WORKBENCH_MCP_TOOL_SCOPES` against `WORKBENCH_MCP_TOOL_NAMES`. Add a **real** scope-refusal case
  per write tool using the M.2 mechanism (the `WorkbenchMcpServerOverrides` seam is no longer needed
  to prove it — a real write-scoped tool now exists; keep the seam and its test, it still guards the
  undeclared-tool path).
- `packages/shared/src/workbench-mcp.test.ts` — the family partition now covers all tool names; add
  a test asserting **no tool name matches `/delete|remove|revoke|prune|drop/i`** (D-MCP3 made
  mechanical) and that `WORKBENCH_MCP_WRITE_TOOL_NAMES.length === 3` with each mapping to a distinct
  execute scope.
- A new `apps/api/test/mcp-server-write-tools.test.ts` driving each write tool in-process against a
  seeded DB: happy path shape, the `run_plan_start` `"suite"` refusal (D-MCP10), the failed-scan
  `isError` path, the estimate present on both launches, and — the one that matters — a
  `read`-only token refused on each write tool while a tokenless loopback caller succeeds (D-MCP7).

Every new guardrail test must be **proved to bite**: the orchestrator will revert the guard and
expect the test to go red.

---

## Files

**New**
- `apps/api/test/mcp-server-write-tools.test.ts`

**Modified**
- `packages/shared/src/workbench-mcp.ts` (additive only — zero deletions)
- `packages/shared/src/workbench-mcp.test.ts`
- `apps/api/src/mcp-server/tools.ts`
- `apps/api/src/mcp-server/server.ts` (signature + JSDoc only)
- `apps/api/src/mcp-server/self-scan.ts` (deps + explicit caller, if it constructs either)
- `apps/api/src/index.ts` (the deps bag at ~line 1516)
- `apps/api/test/workbench-mcp-server.test.ts`, `apps/api/test/mcp-server-scopes.test.ts`
- `user-guide/20-workbench-mcp-server.md`, `user-guide/21-service-tokens.md`

**Zero-line diff (verified with `git diff main..HEAD -- <path>`)**
- `packages/shared/src/api-tokens.ts` — the frozen D-C4 vocabulary, `API_TOKEN_ROUTE_SCOPES`,
  `requiredScopesForMethod`/`requiredScopesForRoute`. This WP maps existing scopes onto tools; it
  touches nothing about what a scope *is* or how a route is guarded.
- `apps/api/src/api-tokens/**` — the guard is M.2's and is complete.
- `packages/shared/src/assistant-route-manifest.ts`, `assistant-scope.ts`, `assistant-starters.ts`
- `apps/api/src/assistant/**`
- `apps/web/**` — no web change at all
- `apps/cli/**` — the CLI is WP 2.1/2.2's
- `packages/shared/src/feature-flags.ts` — no new flag
- `apps/api/src/db/**` — no migration
- `pnpm-lock.yaml`, every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts` — no environment variable

Plus, inside a modified file, these symbols must be byte-identical: `missingScopeForTool`,
`withScopeEnforcement`, `scopeRefusal`, `UNDECLARED_TOOL_SCOPE`, `WORKBENCH_MCP_READ_TOOL_NAMES`,
`WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET`.

---

## Acceptance

Each item is independently checkable; cite the file:line or test name that proves it.

- **A1** — The mount registers exactly **24** tools: the 21 unchanged read tools plus `scan_run`,
  `suite_run_start`, `run_plan_start`. `tools/list` set-equals `WORKBENCH_MCP_TOOL_NAMES`, proven by
  the extended gate test, and `WORKBENCH_MCP_READ_TOOL_NAMES` is unchanged.
- **A2** — Each write tool declares its scope in `WORKBENCH_MCP_TOOL_SCOPES` and **only** there:
  `scan_run → scan:run`, `suite_run_start → suites:run`, `run_plan_start → runs:launch`. The key-set
  test compares against `WORKBENCH_MCP_TOOL_NAMES`, so a future tool with no declared scope fails the
  gate. No scope was added, renamed or removed (`packages/shared/src/api-tokens.ts` zero-diff).
- **A3** — A token holding `read` but not the tool's execute scope gets the M.2 `isError` refusal
  naming the missing scope — for each of the three tools — and **no scan row and no suite-run row is
  created** by the refused call. A token holding `read` + the right scope succeeds.
- **A4 (D-MCP7)** — A tokenless loopback caller can invoke all three write tools. The gate logic in
  `server.ts` (`missingScopeForTool`/`withScopeEnforcement`) is byte-identical to `main`.
- **A5 (D-MCP10)** — `run_plan_start` with `source: "suite"` is refused with a readable `isError`
  result that names `suite_run_start`, and no suite run is created. The schema enum has no `"suite"`
  member, so the SDK refuses it before the handler as well.
- **A6 (D-MCP11)** — Each write tool returns a ticket, not a wall-clock wait: `scan_run` returns a
  compact scan summary (never a full `ScanDetail`) and the two launch tools return
  `suiteRunId` + `status` immediately, each naming the read tool that polls it. No new polling tool
  was added.
- **A7 (D-MCP12)** — Both launch tools carry an advisory `estimate` produced by
  `buildRunPlanEstimate` (the same function `GET /api/estimate/run-plan` calls — proven by import,
  not by resemblance), and a thrown estimate does not fail the launch.
- **A8 (D-MCP3, mechanical)** — A test asserts no registered tool name matches
  `/delete|remove|revoke|prune|drop/i`, and that the write set is exactly three tools mapping to
  three distinct execute scopes. No handler calls a `delete`/`prune` repository method.
- **A9 (D-MCP5)** — The serialized `tools/list` payload still measures **under
  `WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET` (3000)**, and `pnpm mcp:self-scan` exits 0. Report the
  measured number. **If the surface exceeds the budget, tighten the three new descriptions — do NOT
  raise the constant.** If it still will not fit, stop and report rather than raising it: the budget
  is an owner-reviewable number.
- **A10 (D-MCP13)** — `createWorkbenchMcpServer`'s `caller` parameter has no default; every call site
  passes one explicitly; `TRUSTED_LOCAL_CALLER` is still exported. Removing an argument at a call site
  is a compile error (state which one you checked).
- **A11** — `GET /api/mcp/llms.txt` documents the three write tools under an **Actions** family,
  states that a write tool needs `read` **plus** its execute scope, and is still generated from the
  registered definitions (no hand-written tool list). The family-partition test covers every tool.
- **A12** — `user-guide/20-workbench-mcp-server.md` no longer claims the mount is read-only, and says
  precisely what the three write tools do, what they cost, and which scope each needs;
  `user-guide/21-service-tokens.md` maps the three execute scopes to the tools they now unlock.
- **A13 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`,
  plus `pnpm --filter @mcp-token-footprint/web test` run **separately**. Report exit codes and test
  counts. Two failures are **pre-existing on `main`** and must be reported as such, never fixed
  silently and never allowed to mask a new one: 2 tests in
  `apps/api/test/compatibility-data.test.ts` (stale model roster) and `pnpm lint` refusing
  `research/token-context-comparison/comparison/all-models.json` (1.8 MiB over Biome's 1 MiB cap).
- **A14 (no drive-by scope)** — Every path in the zero-line-diff list above has a zero-line diff, and
  no file outside the Files section changed. You did **not** touch any `STATUS.md`.
