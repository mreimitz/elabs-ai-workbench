---
type: "Work Package Spec"
title: "WP 2.2 \u2014 suite/grade assertions + the baseline-delta PR-comment artifact"
description: "Phase 2 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.2 — suite/grade assertions + the baseline-delta PR-comment artifact

Phase 2 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.3 (the assertions engine + `mcpfp assert` — done 2026-08-19, `wp/ci/1.3`),
WP 2.1 (`mcpfp suite run` — the command that produces the suite run a suite gate asserts against).
**Consumed by:** WP 2.3 (the packaged GitHub Actions workflow posts this artifact) and WP 3.1
(`no-new-security-findings` is one more member of the rule union this WP extends — **3.1 and this WP
edit the same two files and must never run concurrently**).

---

## Locked decisions this WP implements

- **README invariant** — assertions are evaluated **server-side** and versioned
  (`ASSERTIONS_VERSION`); the CLI only renders results. **Artifacts contain no secrets and no
  absolute local paths.**
- **D-C3 (locked 2026-08-19)** — baseline: **symbolic in, concrete out**. `"previous"` or an explicit
  id; either way the API resolves exactly one concrete subject and the report echoes it, so the
  artifact records what was actually compared.
- **D-C6 (locked 2026-08-19)** — stdout is the payload, stderr is the narration; every emitted string
  passes the token-redaction pass.
- **D-C7 (locked 2026-08-19)** — `mcpfp assert` is the **only** thing that may exit `1`. A rule that
  failed is `1`; a gate that could not run is `2`.
- **D-C8 (locked 2026-08-19)** — an unevaluable rule is never a silent pass. "No earlier scan yet" is
  a loud `skipped` + exit 0; a named-but-unresolvable baseline, and two subjects that are not on the
  same scale, are both **400 → exit 2**.
- **D-C9 (locked 2026-08-19)** — `assert` never *runs* anything. It evaluates what is already
  persisted; a CI job chains `mcpfp scan` / `mcpfp suite run` and then `mcpfp assert`.
- **D-MCP4 (locked 2026-08-19)** — re-project, don't reimplement. There is exactly one differ
  (`compare/service.ts`'s `buildComparison`) and it stays that way.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-C13 — a gate document stays SINGLE-FAMILY: one target, one family of rules.**
  `ASSERTION_RULE_META` gains a `family: "scan" | "suite"`; `assertionTargetSchema` gains
  `{ suite }` and `{ suiteRun }` members; `assertionDocumentSchema.superRefine` rejects a document
  whose rules do not all belong to its target's family, naming the offending rule index. A repo that
  wants both a footprint gate and a quality gate keeps two files and runs `mcpfp assert` twice —
  which is also what makes the two exit codes readable in a build log. **`ASSERTIONS_VERSION` stays
  1**: every change here is additive (new union members, a new optional refinement path), and every
  v1 document that validates today still validates.
- **D-C14 — a NAMED baseline is always resolved and always echoed, even when no rule needs one.** WP
  1.3 resolved a baseline only when a baseline-dependent rule existed. The PR artifact's whole value
  is the delta sentence, and both new rules are absolute (they need no baseline), so a suite gate
  would otherwise produce an artifact with nothing to compare. The engine now resolves whenever the
  document (or `--baseline`) names one. **Nothing else changes**: an unnamed baseline with no
  baseline-dependent rule still resolves nothing, and D-C8's three outcomes are untouched.
  In the same change the report's identity fields widen to a **discriminated**
  `AssertionSubjectRef` (`{ kind: "scan" } & AssertionScanRef` | `{ kind: "suite_run" } & …`). The
  scan variant is byte-identical to today's plus the `kind` discriminant, so existing output stays
  valid (additive response fields only) and every consumer is forced by the compiler to handle both.
  `AssertionScanRef` stays exported unchanged.
- **D-C15 — the PR-comment body is ONE pure function in `packages/shared`, rendered from the
  `AssertionReport` alone.** Not a second API endpoint (the *evaluation* is server-side; *formatting*
  is the CLI's job, D-C6) and not a private copy in `apps/cli` (WP 2.3's workflow, and anything else
  that later wants the same comment, would re-derive it). It is deterministic for a given report, and
  it contains **no credential, no absolute local path, and no filesystem detail** — the only
  environment-specific string it may carry is the workbench base URL the envelope already carries.
- **D-C16 — a suite gate refuses a suite run that is not `completed` and settled.** A `running`,
  `pending`, `capped`, `stopped` or `error` suite run named as the subject is a **400** (exit 2), and
  so is a `completed` one whose `ratingState` has not settled (`pending`/`rating`). A half-graded
  matrix read as a mean score is exactly the silent-wrong-answer D-C8 exists to prevent: it would
  report a quality regression that is really just grading latency. Same spirit as WP 1.3's refusal to
  assert a `failed` scan.

---

## What we're building

1. **Two new assertion rules** — exactly the two `README.md` names, no more:
   - **`min-suite-score`** — `{ rule, min }` (0–1). The suite run's `aggregates.meanGrade` must be
     at least `min`. A `completed` suite run whose `meanGrade` is `null` (no member produced a
     graded score) **FAILS** with a message saying so — it is not a skip, because a gate that
     demanded a score and got none has not been satisfied.
   - **`max-suite-cost`** — `{ rule, maxUsd }` (> 0). `aggregates.execCostUsd + aggregates.judgeCostUsd`
     must be at most `maxUsd`. Both halves are named in the message, because "the judge cost blew the
     budget" and "the run cost blew the budget" are different problems.
   Both are `family: "suite"`, both `needsBaseline: false`.
2. **Suite targets** — `{ suite: "<id|exact name>" }` (its newest **completed + settled** suite run)
   and `{ suiteRun: "<id>" }` (that exact one), resolved server-side with the same total-order
   tie-break `resolveSubject` already uses for scans.
3. **A suite baseline** — `"previous"` resolves to the newest **earlier** completed+settled suite run
   of the subject's own suite; anything else is an explicit suite-run id. D-C8's three outcomes apply
   unchanged (no earlier run yet → the report carries `baseline: null` and, if a rule needed one, a
   loud skip; a named-but-unresolvable baseline → 400).
4. **`renderAssertionMarkdown(report)`** in `packages/shared/src/ci-assertions.ts` — the PR-comment
   body (D-C15).
5. **`mcpfp assert --format markdown`** — emit that body to stdout or `--output`. The exit code is
   unchanged and is derived from the report, not from the format.
6. **Docs** — the two rules appear automatically in `mcpfp help assert`'s **generated** rule table
   (it renders from `ASSERTION_RULE_META`, so do not hand-write them); add the `markdown` format, the
   suite target shapes, and a worked suite gate file to `user-guide/22-mcpfp-cli.md`, and refresh
   `mcpfp.assert.example.json` only if it can stay a single-family document (D-C13) — otherwise add a
   sibling example rather than breaking the existing one.

### The PR-comment body (D-C15) — what it must contain

Markdown, in this order, and nothing else:

1. **A heading with the verdict**: `✅ mcpfp gate passed` / `❌ mcpfp gate failed` / with a
   `— N skipped` suffix when any rule skipped.
2. **The identity line**: what was asserted, by name and id, and when it was captured.
3. **The delta sentence**, when a baseline resolved — `2,224 → 2,410 tokens (+186, +8.4%)` for a scan
   subject; `mean grade 0.84 → 0.79 (−0.05)` and `$1.02 → $1.31 (+$0.29)` for a suite subject. When
   no baseline resolved, one honest line saying so and why (first scan / none named).
4. **A rules table**: rule · status · observed · limit. Numbers formatted with the existing
   `formatNumber`/`formatPercent` helpers from `packages/shared/src/format.ts` — do not write new
   formatters.
5. **Details**, as a collapsed `<details>` block per failing rule, using the already-capped
   `AssertionRuleResult.details` (never re-cap, never un-cap).
6. **A footer** naming the assertions version and the evaluation instant.

Deterministic for a given report; a byte-for-byte re-render of the same report is identical.

### Explicitly NOT in this WP

Any rule beyond the two named (`min-suite-pass-rate`, a suite-delta rule and a per-test rule are
deliberately deferred — the README names two and a gate vocabulary is easier to grow than to shrink) ·
`no-new-security-findings` (**WP 3.1**, and it edits these same two files — do not front-run it, do
not add a `family: "security"`, do not leave a placeholder) · `--format markdown` on
`mcpfp suite run` (that command stays `human|json`) · posting a comment to GitHub (WP 2.3 owns the
workflow; this WP produces the body and nothing more) · any new API route · a migration · a
dependency · a scope change · any web change.

---

## Design (implement this, don't redesign it)

### 1. `packages/shared/src/ci-assertions.ts`

Additive only; `ASSERTIONS_VERSION` stays **1**.

- `ASSERTION_RULE_KINDS` gains `"min-suite-score"`, `"max-suite-cost"` (append — order is the help
  table's order).
- `ASSERTION_RULE_META`'s value type gains `readonly family: "scan" | "suite"`; every existing entry
  is annotated `family: "scan"` and the two new ones `family: "suite"`. Add
  `assertionRuleFamily(kind)` beside the existing `assertionRuleNeedsBaseline(kind)`.
- Two rule schemas (`.strict()`), added to the `assertionRuleSchema` discriminated union:
  `min-suite-score` with `min: z.number().min(0).max(1)`; `max-suite-cost` with
  `maxUsd: z.number().positive()`.
- `assertionTargetSchema` gains `z.object({ suite: z.string().min(1) }).strict()` and
  `z.object({ suiteRun: z.string().min(1) }).strict()`. Export
  `assertionTargetFamily(target): "scan" | "suite"` so the API and the refinement share one answer.
- `assertionDocumentSchema` gains a `superRefine` enforcing D-C13, with the issue `path` pointing at
  `["rules", index]` so the operator sees which rule is the odd one out.
- `AssertionSuiteRunRef` — `{ suiteRunId, suiteId?, suiteName, source?, startedAt, endedAt?, status,
  cellsTotal, cellsCompleted, meanGrade, execCostUsd, judgeCostUsd }`. Nothing that could carry a
  secret; no provider key, no model credential, no path.
- `AssertionSubjectRef = ({ kind: "scan" } & AssertionScanRef) | ({ kind: "suite_run" } & AssertionSuiteRunRef)`.
  `AssertionReport.subject` and `AssertionReport.baseline.scan` widen to it. **Keep the field name
  `baseline.scan`** — renaming it would break WP 1.3's CLI renderer and its tests for no gain; a
  comment says it is the baseline *subject*, named for wire compatibility.
- `renderAssertionMarkdown(report: AssertionReport): string` per the section above.

### 2. `apps/api/src/assertions/service.ts`

- `AssertionPorts` gains the narrow read ports the suite family needs — structurally typed, like the
  existing ones, so a test hands it functions rather than a database:
  ```ts
  suites: { list: () => Suite[] };
  suiteRuns: {
    getRun: (id: string) => SuiteRun;
    listRuns: (suiteId?: string) => SuiteRun[];
  };
  ```
  Wire the real `SuiteService`/`SuiteRunRepository` in `apps/api/src/index.ts` at the existing
  `registerAssertionRoutes` call. **Do not** add a repository or a query — `listRuns` and `getRun`
  already exist and are what `GET /api/suite-runs` uses.
- `resolveSubject` branches on `assertionTargetFamily(target)`. The suite branch mirrors the scan
  branch exactly: id-or-exact-name for `{ suite }` (an ambiguous name names both ids, never picks),
  newest-first with the **id tie-break** (`newestFirst`'s shape — reuse it, generically or by a
  sibling comparator; do not write a second sort with a different tie-break), and D-C16's
  completed+settled filter.
- Baseline resolution: `resolveBaseline` branches the same way. **And the resolution trigger changes
  per D-C14**: `needsBaseline || requestedBaseline !== undefined`. That one boolean is the whole
  behavioural change to the existing engine — call it out in a comment.
- Two new evaluators in the rule dispatch. They read `SuiteRun.aggregates` and nothing else; a
  suite-family rule evaluated against a scan subject is unreachable (D-C13 makes it a validation
  error) but must still be a defensive `throw` rather than a silent pass.
- **No change** to the six existing evaluators, to `buildComparison`'s use, or to the
  `deltasComparable` guard.

### 3. `apps/cli`

- `SUPPORTED_FORMATS.assert` gains `"markdown"` — and the comment there that says markdown is
  deliberately absent "until WP 2.2" is replaced with what is now true.
- `commands/assert.ts`: `--format markdown` → `context.emitter.payload(renderAssertionMarkdown(report))`.
  The exit code is derived from `report.passed` exactly as today — **the format must not change it**,
  and a test must pin that (`--format markdown` on a failing gate still exits `1`).
- `help.ts`: the rule table regenerates itself; add the suite target shapes and the markdown format
  to the `assert` topic prose, and add the family rule (D-C13) in one sentence.

### 4. Tests

- `apps/api/test/ci-assertions.test.ts` — extend. Per new rule: a pass, a fail, and the boundary
  (`meanGrade === min` passes; `cost === maxUsd` passes). `meanGrade: null` **fails**. D-C16's five
  refusal cases (`running`, `capped`, `stopped`, `error`, unsettled `ratingState`) each a **400**.
  D-C13: a document mixing families is rejected with the issue path at the offending rule. D-C14: a
  named baseline with only absolute rules is still resolved and echoed; an unnamed baseline with only
  absolute rules is still `null`.
- `packages/shared/src/ci-assertions.test.ts` (create if absent, otherwise extend) —
  `renderAssertionMarkdown` snapshot-ish assertions: the verdict heading for pass/fail/skipped, the
  delta sentence for both subject kinds, the no-baseline sentence, and a **negative** test that the
  output contains no `/`-rooted path and nothing token-shaped.
- `apps/cli/test/assert.test.ts` — `--format markdown` writes the body to stdout only, exits `1` on a
  failing gate, and `--output` writes it to a file.

Every new guardrail test must be **proved to bite** — the orchestrator will revert the guard and
expect it red. Pay particular attention to D-C16's refusals and to the format-does-not-change-the-
exit-code test.

---

## Files

**New** — none expected beyond a test file if `packages/shared/src/ci-assertions.test.ts` does not
already exist.

**Modified**
- `packages/shared/src/ci-assertions.ts`
- `apps/api/src/assertions/service.ts`
- `apps/api/src/index.ts` (the `registerAssertionRoutes` deps only)
- `apps/cli/src/cli.ts` (`SUPPORTED_FORMATS`), `apps/cli/src/commands/assert.ts`,
  `apps/cli/src/help.ts`
- `apps/api/test/ci-assertions.test.ts`, `apps/cli/test/assert.test.ts`
- `user-guide/22-mcpfp-cli.md`

**Zero-line diff (verified with `git diff <base>..HEAD -- <path>`)**
- `apps/api/src/compare/service.ts` — one differ, re-projected (D-MCP4)
- `packages/shared/src/api-tokens.ts`, `apps/api/src/api-tokens/**` — no scope change;
  `POST /api/assertions/evaluate` already needs only `read`
- `packages/shared/src/workbench-mcp.ts`, `apps/api/src/mcp-server/**`
- `apps/web/**`
- `apps/api/src/db/**` — no migration
- `pnpm-lock.yaml`, every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts` — no environment variable

---

## Acceptance

- **A1** — `min-suite-score` and `max-suite-cost` exist, validate strictly, appear in the generated
  `mcpfp help assert` table with correct summaries, and are the **only** rules added.
- **A2** — Both evaluate correctly against a suite run's `aggregates`, including the boundary cases
  (`===` passes) and `meanGrade: null` → **fail** with an explanatory message.
- **A3 (D-C13)** — A document may target `{server}`/`{scan}` **or** `{suite}`/`{suiteRun}`, and its
  rules must all match that family; a mixed document is a validation error whose issue path names the
  offending rule index. `ASSERTIONS_VERSION` is still **1** and an existing v1 gate file still
  validates unchanged (prove it with the repo's `mcpfp.assert.example.json`).
- **A4 (D-C14)** — A named baseline is resolved and echoed even when no rule needs one; an unnamed
  baseline with only absolute rules still resolves nothing. D-C8's three outcomes are unchanged
  (prove the existing D-C8 tests still pass untouched).
- **A5 (D-C14 shape)** — `AssertionReport.subject` and `baseline.scan` are the discriminated
  `AssertionSubjectRef`; a scan report's JSON is byte-identical to before **except** the added
  `kind: "scan"`; `AssertionScanRef` is still exported with the same members.
- **A6 (D-C16)** — Each of `running`, `pending`, `capped`, `stopped`, `error` and
  `completed`-with-unsettled-`ratingState` is a **400** naming the state, and therefore an exit `2`
  from the CLI — never a score.
- **A7 (D-C15)** — `renderAssertionMarkdown` is a pure function in `packages/shared`, is the **only**
  place the comment body is built (grep proves no second renderer), is deterministic for a given
  report, and contains no credential, no absolute path and no filesystem detail. Both subject kinds
  render a correct delta sentence, and the no-baseline case renders an honest one.
- **A8** — `mcpfp assert --format markdown` writes the body to stdout (or `--output`) and **the exit
  code is unchanged by the format**: a failing gate is still `1`, a gate that could not run is still
  `2`, and nothing else in the CLI can emit `1`.
- **A9** — `user-guide/22-mcpfp-cli.md` documents the suite targets, the two rules, the family rule
  and the markdown format, with a worked suite gate file.
- **A10 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` **separately**. Report exit codes and test counts.
  Two failures are **pre-existing** and must be reported as such, never fixed silently: 2 tests in
  `apps/api/test/compatibility-data.test.ts` and `pnpm lint` on
  `research/token-context-comparison/comparison/all-models.json`.
- **A11 (no drive-by scope)** — Every zero-line-diff path is clean; no file outside the Files section
  changed; **no security rule and no `family: "security"` placeholder was added** (WP 3.1's). You did
  **not** touch any `STATUS.md`.
