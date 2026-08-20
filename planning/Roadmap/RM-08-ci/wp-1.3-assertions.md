---
type: "Work Package Spec"
title: "WP 1.3 \u2014 assertions engine (server-side) + mcpfp assert"
description: "Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.3 — assertions engine (server-side) + `mcpfp assert`

Phase 1 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.1 (service tokens — done 2026-08-19, `wp/ci/1.1`), WP 1.2 (the `mcpfp` CLI —
done 2026-08-19, `wp/ci/1.2`).
**Consumed by:** WP 2.2 (suite/grade assertions + the baseline-delta PR-comment artifact),
WP 2.3 (GitHub Actions packaging), WP 3.1 (`no-new-security-findings`).

---

## Locked decisions this WP implements

- **D-C6 (locked 2026-08-19)** — stdout is the payload, stderr is the narration. The assert result
  goes to stdout (or `--output`); every warning, skip notice and error goes to stderr.
- **D-C7 (locked 2026-08-19)** — exit codes. **This WP is the ONLY thing in the repo that may emit
  `MCPFP_EXIT.assertionFailure` (`1`).** `0` = every rule passed (skips allowed) · `1` = at least
  one rule **failed** · `2` = the gate could not run (bad file, unresolvable target, transport,
  non-2xx, an incomparable baseline). Getting this split right is the whole point of the WP: a
  pipeline must be able to tell "the gate said no" from "the gate could not run".
- **D-C3 (locked 2026-08-19, owner, at this WP's kickoff)** — **baseline semantics: symbolic in,
  concrete out.** A baseline may be named symbolically (`"previous"`) or as an explicit scan id;
  either way the API **resolves it server-side to exactly one concrete scan id** and echoes that id
  (plus its `scannedAt`) in the result, so the artifact records what was actually compared and the
  same assertion can be re-run later against the same pair. Record in the ledger's decision log.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-C8 — an unevaluable rule is never a silent pass.** Three distinguishable outcomes, and each
  maps to a different exit code:
  1. **The baseline cannot exist yet** (this is the server's first scan, so there is no earlier
     one): the baseline-dependent rules report `status: "skipped"` with a reason, the CLI prints a
     loud stderr warning naming each skipped rule, and the command exits **0**. A first-ever run
     must not fail a pipeline for having no history.
  2. **A baseline was named and does not resolve** (an unknown scan id, a scan belonging to a
     different server, a `failed` scan): a **400**, so the CLI exits **2**. A typo'd baseline must
     never quietly degrade into case 1.
  3. **The baseline resolves but the two scans are not on the same scale** —
     `ScanComparison.deltasComparable === false` (a different `tokenProfile` or a different
     `countingVersion`, where the compare service **suppresses every token delta to 0**). A
     `max-scan-delta` rule evaluated against a suppressed 0 would pass every time, so this is an
     **error (exit 2)**, never a pass. Tool matching *is* still valid in that state (the type's own
     contract), so `no-new-tools` / `no-removed-tools` are evaluated normally.
- **D-C9 — `assert` never runs a scan.** It evaluates an already-persisted scan. Scanning is
  `mcpfp scan`; a CI job chains the two, which is what keeps the exit codes honest (a scan that
  could not run is that command's `2`, not this command's `1`).
- **D-C10 — the evaluation endpoint is a POST and therefore, under WP 1.1's *coarse* method→scope
  rule, needs an EXECUTE scope from a remote token even though it only reads.** Do **not** edit
  `requiredScopesForMethod` or the guard to carve out an exception — WP 1.1 deliberately deferred
  per-route mapping to WP M.2, and that file is security-critical. Document the consequence
  (a remote assert-only token needs `scan:run`; a loopback caller needs nothing) and add
  `POST /api/assertions/evaluate → read` to WP M.2's mapping work in the ledger.

---

## What we're building

1. **The assertions contract** in `packages/shared` — `ASSERTIONS_VERSION`, the `mcpfp.assert.json`
   document shape + zod schema, the rule union, and the result/report shape.
2. **A server-side evaluation engine** in `apps/api` — resolves the subject scan and the baseline,
   evaluates every rule, returns an itemized report. **Re-projects `buildComparison`** for all
   baseline work (D-MCP4's "re-project, don't reimplement" — the exact→normalized→fuzzy matcher and
   the `deltasComparable` guard already exist and are tested; do not write a second differ).
3. **`POST /api/assertions/evaluate`** — one thin route over that engine.
4. **`mcpfp assert`** — reads the file, posts it, renders the report, exits 0/1/2.
5. **Docs** — a `mcpfp assert` section in `user-guide/22-mcpfp-cli.md` with a worked
   `mcpfp.assert.json`.

### Explicitly NOT in this WP

Suite/grade rules (min score, max cost — WP 2.2, blocked on Benchmarks P3) · the markdown
PR-comment artifact (WP 2.2) · the packaged GitHub Actions workflow (WP 2.3) ·
`no-new-security-findings` (WP 3.1) · resource/prompt budget rules (owner scoped this WP to the
README's footprint+delta list; adding a rule later is additive) · running a scan (D-C9) · any web
UI (there is no new `<Route>`, so `ASSISTANT_ROUTE_MANIFEST` must have a zero-byte diff) · a
feature flag (this is an additive read-only endpoint, not a capability with a nav surface).

---

## Design (implement this, don't redesign it)

### 1. The contract — `packages/shared/src/ci-assertions.ts`

Contract-first, per `.claude/rules/architecture.md`: this module lands first, then the API, then the
CLI. Export it from `packages/shared/src/index.ts` alongside `cli-contract.ts`.

```ts
/** Bumped only for a BREAKING change to the document shape. Adding a rule kind is additive. */
export const ASSERTIONS_VERSION = 1;

/** The file `mcpfp assert` reads when none is named. */
export const MCPFP_ASSERT_FILE_NAME = "mcpfp.assert.json";
```

**The document** (`mcpfp.assert.json`), zod-validated with `.strict()` at every level so a typo'd
key is a loud `2` rather than a silently-dropped rule:

```jsonc
{
  "version": 1,
  "target": { "server": "github" },   // XOR { "scan": "<scanId>" }
  "baseline": "previous",             // optional: "previous" | "<scanId>"
  "rules": [
    { "rule": "max-server-tokens", "max": 3000 },
    { "rule": "max-tool-tokens",   "max": 400 },
    { "rule": "max-tool-tokens",   "max": 900, "tool": "search_issues" },
    { "rule": "max-tool-count",    "max": 30 },
    { "rule": "no-new-tools" },
    { "rule": "no-removed-tools" },
    { "rule": "max-scan-delta",    "maxTokens": 250, "maxPercent": 10 }
  ]
}
```

- `version` must equal `ASSERTIONS_VERSION`; a higher one is an error naming the mismatch ("this
  file was written for assertions v2; this workbench speaks v1"), not a best-effort parse.
- `target.server` accepts a **server id or an exact server name**; an ambiguous name (two servers
  share it) is a 400 naming both ids, never a silent pick.
- `rules` must be non-empty — an empty gate that exits 0 is worse than no gate.
- `max-scan-delta` requires **at least one** of `maxTokens` / `maxPercent` (refine on the schema).
  Both are **absolute magnitudes**: a gate that only catches growth would let a tool silently
  disappear past a `no-removed-tools`-less config. `maxPercent` is compared against
  `Math.abs(totalsDeltaPercent)`.
- `max-tool-tokens` without `tool` applies to **every** tool in the subject scan; with `tool` it
  applies to that one tool by exact name and is a **fail** if the named tool is absent (a budget on
  a tool that vanished is a finding, not a no-op).

**The rule kinds** are a frozen discriminated union in this WP: `max-server-tokens` ·
`max-tool-tokens` · `max-tool-count` · `no-new-tools` · `no-removed-tools` · `max-scan-delta`.
Export `ASSERTION_RULE_KINDS` (a `readonly [...] as const` tuple) plus a one-sentence
`ASSERTION_RULE_META` description per kind, reused by `mcpfp help assert` and the user guide so the
prose cannot drift from the schema.

**The result:**

```ts
export type AssertionStatus = "pass" | "fail" | "skipped";

export type AssertionResult = {
  rule: AssertionRuleKind;
  status: AssertionStatus;
  /** One operator-facing sentence, e.g. "Server tokens 2,224 within budget 3,000." */
  message: string;
  /** What the rule measured, when it measured a number. */
  observed?: number;
  /** The bound it was measured against. */
  limit?: number;
  /** Rule-specific itemization: the tools added/removed, the tools over budget. Bounded — see below. */
  details?: string[];
  /** Present only on `skipped`: WHY it could not be evaluated. */
  skipReason?: string;
};

export type AssertionReport = {
  assertionsVersion: number;
  evaluatedAt: string;                 // ISO 8601
  subject: AssertionScanRef;           // scanId, serverId, serverName, scannedAt, tokenProfile,
                                       // countingVersion, totalTokens, totalTools
  /** D-C3: what was ASKED for, and the single concrete scan it RESOLVED to. */
  baseline: { requested: string; scan: AssertionScanRef } | null;
  results: AssertionResult[];
  counts: { total: number; passed: number; failed: number; skipped: number };
  /** False iff at least one result is "fail". A report with only passes and skips is `true`. */
  passed: boolean;
};
```

`details` is capped (constant `ASSERTION_DETAIL_LIMIT = 20`) with a final
`"…and N more"` line — a server that added 300 tools must not produce a 300-line CI log or a
megabyte of JSON.

The request body:

```ts
export const assertionEvaluateSchema = z.object({
  document: assertionDocumentSchema,
  /** CLI flag overrides, applied over the document's own target/baseline. */
  target: assertionTargetSchema.optional(),
  baseline: z.string().min(1).optional(),
}).strict();
```

### 2. The engine — `apps/api/src/assertions/{service.ts,routes.ts}`

Layering per `.claude/rules/architecture.md`: the route parses and hands off; the service owns
orchestration; **no new repository** — it reads through the existing `ScanRepository`
(`getDetail`, `getSummary`, `listSummariesByServer`, `getLatestForServer`) and the existing
`ServerRepository` for the id-or-name lookup.

**Subject resolution.** `target.scan` → `scans.getDetail(id)`. `target.server` → the server's
**newest `succeeded` scan** (`listSummariesByServer` is newest-first; filter on status — asserting
against a failed scan would gate on a partial tool list). No succeeded scan → 400 "no completed
scan for server X — run `mcpfp scan X` first".

**Baseline resolution (D-C3).** Only performed when at least one rule needs it.
- `"previous"` → the newest **succeeded** scan of the **subject's server** whose `scannedAt` is
  strictly older than the subject's (tie-break on id so the choice is deterministic). None → the
  case-1 skip.
- anything else → treated as an explicit scan id: 404/wrong-server/`failed` → 400 (case 2).
- Either way the report carries `{ requested, scan: { scanId, … } }`.

**Comparison.** `buildComparison(baselineDetail, subjectDetail, DEFAULT_COMPARE_THRESHOLD)` — note
the argument order: **A is the baseline, B is the subject**, so `totalsDeltaTokens` is
`subject − baseline` and `onlyInB` is "new tools". Getting this backwards inverts every rule, so
pin the direction with a test.

**Rule evaluation** — one small pure function per kind over
`(rule, subject: ScanDetail, comparison: ScanComparison | null)`, dispatched from a
`Record<AssertionRuleKind, evaluator>` so adding WP 2.2/3.1's kinds is one map entry. Rules are
evaluated in document order and **all** of them are evaluated — no short-circuit on the first
failure; a CI log that lists one problem at a time wastes a round trip per problem.

- `max-server-tokens` → `subject.totalTokens <= max`.
- `max-tool-count` → `subject.totalTools <= max`.
- `max-tool-tokens` → every tool (or the named one) `totalTokens <= max`; `details` lists each
  overrunning tool as `"name — 1,204 > 400"`.
- `no-new-tools` → `comparison.onlyInB` empty; `details` names them.
- `no-removed-tools` → `comparison.onlyInA` empty; `details` names them.
- `max-scan-delta` → **first** check `comparison.deltasComparable`; false → throw a 400 (D-C8 case
  3) whose message names both the profiles and both the counting versions. True → compare
  `Math.abs(totalsDeltaTokens)` / `Math.abs(totalsDeltaPercent)` against whichever bounds are set;
  `details` carries the direction (`"+180 tokens (+8.1%) vs baseline"`).

Messages are complete sentences with `toLocaleString("en-US")`-grouped numbers, because they are
what an operator reads in a CI log.

**The route.** `POST /api/assertions/evaluate`, registered from `apps/api/src/index.ts` next to the
compare/report registrations. Errors go through the central handler (`httpError(400, …)`); do not
hand-roll an error body.

### 3. The command — `apps/cli/src/commands/assert.ts`

```
mcpfp assert [file] [--server <id|name>] [--scan <scanId>] [--baseline previous|<scanId>]
             [--format human|json] [--output <path>] [--quiet]
```

- **File discovery** reuses the config-file walk-up helper in `apps/cli/src/config.ts` (extract it
  rather than copying it): a positional/`--file` path is used verbatim (missing → `2`), otherwise
  `mcpfp.assert.json` is looked for from the cwd upward, first hit wins; none found → `2` naming
  the file it looked for.
- **Flag precedence** matches the config resolver's: `--scan`/`--server`/`--baseline` override the
  document. `--scan` and `--server` together is a usage error (`2`). Extend the existing
  `--server only applies to mcpfp scans` guard in `cli.ts` rather than deleting it.
- The CLI **validates the document locally** with the shared zod schema before the network call, so
  a malformed gate fails fast with a field-path message and never reaches the API.
- **`--format json`** → the WP 1.2 envelope with `data` = the `AssertionReport` verbatim (the client
  invariant: the CLI renders, it does not re-compute). `MCPFP_OUTPUT_VERSION` stays **1** — this is
  additive. The stale comment in `cli-contract.ts` that predicts "a new optional sibling of `data`
  (as WP 1.3's `assertions` will be)" must be corrected to describe what was actually built.
- **`--format human`** → one aligned line per rule (`PASS` / `FAIL` / `SKIP` + the message), then a
  summary line (`3 passed · 1 failed · 1 skipped`). `tabular-nums` has no meaning in a terminal, but
  the numbers still align — pad them. No color codes (a CI log is not a TTY).
- **stderr** carries: the skip warnings (one line per skipped rule, naming the reason), and on
  failure a final `Assertions failed: 1 of 5.` line. The **payload stream stays clean** so
  `mcpfp assert --format json > gate.json` parses.
- **Exit:** `passed === true` → `0`; any `fail` → `MCPFP_EXIT.assertionFailure`; anything that
  prevented evaluation → `MCPFP_EXIT.error`.
- Add `assert` to `SUPPORTED_FORMATS` (`["human", "json"]` — markdown is WP 2.2's artifact), to
  `help.ts` (both the top-level usage and a `mcpfp help assert` topic listing every rule kind from
  `ASSERTION_RULE_META`), and to the root `README`/user-guide docs.

### The two existing tests this WP MUST update (not delete)

1. `apps/cli/test/contract.test.ts` — **"exit code 1 is RESERVED: no source file in apps/cli emits
   it"**. WP 1.3 is exactly the thing that lifts the reservation. Rewrite it to keep its teeth:
   `assertionFailure` may be referenced **only** by `src/commands/assert.ts` (and, if you route it
   through the shared error class, the one `errors.ts` line that already documents it); every other
   file staying clean is still asserted.
2. `apps/cli/test/exit-codes.test.ts` — the `A11 — 1 is RESERVED` invocation list. Keep every
   existing invocation asserting "never 1", and **add** the positive case: a stubbed evaluate
   response with a failing rule returns exactly `1`, while a stubbed 500 from the same endpoint
   returns `2`.

---

## Files

**New**
- `packages/shared/src/ci-assertions.ts` (+ its export line in `packages/shared/src/index.ts`)
- `apps/api/src/assertions/service.ts`, `apps/api/src/assertions/routes.ts`
- `apps/api/test/ci-assertions.test.ts`
- `apps/cli/src/commands/assert.ts`
- `apps/cli/test/assert.test.ts`
- `mcpfp.assert.example.json` (repo root — a worked example the docs point at; **not**
  `mcpfp.assert.json`, which stays gitignored-by-convention alongside `mcpfp.config.json`)

**Modified**
- `apps/api/src/index.ts` (one registration), `packages/shared/src/cli-contract.ts` (the stale
  comment), `apps/cli/src/cli.ts` (dispatch + `SUPPORTED_FORMATS` + the `--server` guard),
  `apps/cli/src/config.ts` (extract the walk-up helper), `apps/cli/src/help.ts`,
  `apps/cli/test/contract.test.ts`, `apps/cli/test/exit-codes.test.ts`,
  `user-guide/22-mcpfp-cli.md`, `CLAUDE.md` (§6's endpoint families — add `assertions/`),
  `roadmap/ci/STATUS.md` (the decision log; the orchestrator ticks the box).

**Must have a zero-line diff:** `apps/web/src/**`, `packages/shared/src/assistant-route-manifest.ts`,
`packages/shared/src/api-tokens.ts` (D-C10 — do not touch the guard's scope rule),
`apps/api/src/db/**` (**no migration** — this WP persists nothing), `pnpm-lock.yaml`,
`apps/cli/package.json`'s `dependencies` (the client invariant).

---

## Acceptance

- **A1** — `packages/shared/src/ci-assertions.ts` declares `ASSERTIONS_VERSION`, the document +
  rule + report types, and `.strict()` zod schemas; both the API and the CLI import them (neither
  re-declares a shape). Exported from the package index.
- **A2** — `POST /api/assertions/evaluate` evaluates all six rule kinds against a seeded scan and
  returns an itemized `AssertionReport`; every rule is evaluated (no short-circuit) and
  `counts`/`passed` agree with `results`.
- **A3 (D-C3)** — a `"previous"` baseline resolves to the newest succeeded earlier scan of the
  **subject's own server** and the report echoes that concrete `scanId` + `scannedAt`; an explicit
  scan id is honored verbatim; both forms produce byte-identical results when they name the same
  scan.
- **A4 (D-C8)** — the three unevaluable cases behave as specified and are pinned by tests: no
  earlier scan → `skipped` + exit **0** + a stderr warning; an unresolvable/foreign/failed named
  baseline → **400** → exit **2**; `deltasComparable === false` with a `max-scan-delta` rule →
  **400** → exit **2** (and the test proves a suppressed-0 delta does **not** pass), while
  `no-new-tools`/`no-removed-tools` still evaluate in that state.
- **A5 (D-C7)** — `mcpfp assert` exits **1** for a failed rule, **0** when everything passed or
  skipped, and **2** for a missing/malformed/version-mismatched file, an unreachable API, a non-2xx
  response, and conflicting flags. The updated reservation tests still fail if any file other than
  `commands/assert.ts` references `assertionFailure`.
- **A6 (D-C6)** — `mcpfp assert --format json > gate.json` produces a byte-exact `JSON.parse`-able
  file (envelope v1, `data` = the report) with every warning/skip/failure line on **stderr**;
  `--quiet` empties stderr without touching the payload; `--output` writes the same bytes and leaves
  stdout empty.
- **A7 (the client invariant)** — `apps/cli/package.json`'s runtime dependencies are still exactly
  `@mcp-token-footprint/shared`, the existing manifest+import test passes unchanged, and no
  assertion logic lives in the CLI (it renders a report it received; a test asserts the CLI computes
  no pass/fail itself).
- **A8 (D-C9)** — `mcpfp assert` issues **no** scan: a test asserts the stub never receives a
  `POST /api/servers/:id/scan`.
- **A9 (redaction)** — a token is absent from every assert stream and from the JSON envelope,
  including when the API echoes an error body; the existing `Emitter` redaction covers it (add the
  case to the test, do not add a second masker).
- **A10 (D-C10)** — documented in the user guide + the ledger: a loopback caller needs no token; a
  remote caller needs an **execute** scope because the endpoint is a POST under WP 1.1's coarse
  rule; `requiredScopesForMethod` and `apps/api/src/api-tokens/*` have a **zero-line diff**, and the
  ledger's WP M.2 line records `POST /api/assertions/evaluate → read` as mapping work.
- **A11 (docs)** — `user-guide/22-mcpfp-cli.md` gains an `assert` section with a worked
  `mcpfp.assert.json`, the rule table (generated prose matching `ASSERTION_RULE_META`), the exit-code
  table, and the D-C8 skip/error semantics; `mcpfp help assert` lists every rule kind.
- **A12 (gate)** — `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo
  root. (Note: `main` currently carries two **pre-existing** failures in
  `apps/api/test/compatibility-data.test.ts` and a Biome 1 MiB-cap lint failure under `research/`,
  both from commit `4eddf6f` — see the ledger. Report them as pre-existing; do not fix them here,
  and do not let them mask a new failure.)
- **A13 (no drive-by scope)** — no migration, no new dependency, no `<Route>`, no web change, no
  feature flag; the zero-diff list above holds.
