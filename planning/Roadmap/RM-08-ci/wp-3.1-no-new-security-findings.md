---
type: "Work Package Spec"
title: "WP 3.1 \u2014 the no-new-security-findings assertion"
description: "Phase 3 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 3.1 — the `no-new-security-findings` assertion

Phase 3 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](../RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.3 (the assertions engine), **WP 2.2** (which last touched
`packages/shared/src/ci-assertions.ts` and `apps/api/src/assertions/service.ts` — **this WP must be
implemented on top of a branch that already contains 2.2, never concurrently with it**), and
**security-posture WP 1.2** (the analyzer this rule calls).

---

## Locked decisions this WP implements

- **D-C7** — `1` is an assertion failure, `2` is a gate that could not run. This rule may produce a
  `1`; a missing analyzer, an unusable scan or an unresolvable baseline is a `2`.
- **D-C8** — an unevaluable rule is never a silent pass. **No earlier scan yet ⇒ `skipped` with a
  reason and exit `0`**; a named-but-unresolvable baseline ⇒ 400 ⇒ `2`.
- **D-C13 (WP 2.2)** — one target, one rule family. This rule is **`family: "scan"`**, so it composes
  with `max-server-tokens`/`no-new-tools`/… in a single footprint gate file, which is where it
  belongs: a repo gates its MCP server's surface and its posture in one document.
- **D-C14 (WP 2.2)** — a named baseline is always resolved and echoed, and the report's identity
  fields are the discriminated `AssertionSubjectRef`.
- **D-C15 (WP 2.2)** — the PR-comment body renders `AssertionRuleResult.details` generically, so this
  rule's itemization appears in the artifact with no renderer change.
- **D-MCP4 / D-SP1 / D-SP7** — re-project, don't reimplement. This rule calls
  security-posture WP 1.2's `analyzeScan`/`analyzeScanTools`; it contains **no heuristic, no regex,
  no severity logic and no score**.
- **D-SP2** — rule ids are frozen, which is the entire reason set-membership comparison is sound here.
- **D-SP3** — reports produced under different `SECURITY_ANALYZER_VERSION`s are never silently
  compared.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-C20 — "new" is set membership by (ruleId, anchor), never a count.** A finding is new when its
  identity — `ruleId` plus its anchor (tool name, parameter path, file path, or the server itself) —
  is present in the subject's report and absent from the baseline's. A count comparison would pass a
  release that resolved one finding and introduced a worse one, which is the single most likely way
  this gate would be wrong in production. Evidence text is deliberately **not** part of the identity:
  a reworded description that still trips the same rule on the same tool is the same finding, not a
  new one, and a gate that fired on rewording would be turned off within a week.
- **D-C21 — `minSeverity` defaults to `warning`.** `error` and `warning` findings gate; `info`
  findings (undescribed parameters, an unmarked open-world tool, an unconstrained
  `additionalProperties`) are hygiene, and a gate that goes red on day one for hygiene is a gate that
  gets deleted. A team that wants the stricter posture writes `"minSeverity": "info"` explicitly. The
  default is a decision, so it is written down here rather than buried in a schema default.
- **D-C22 — an analyzer-version mismatch between the two reports is an ERROR, not a pass.** Both
  reports are produced by the same running build, so the versions are equal by construction today —
  the check exists for the case that stops being true (a persisted or cached report, WP 1.4's diff,
  a future cross-instance comparison). It is the exact shape of D-C8's `deltasComparable` guard: a
  comparison that is not on the same scale is a **400**, never a suppressed-to-zero pass.

---

## What we're building

1. **One rule kind** — `no-new-security-findings`, `family: "scan"`, `needsBaseline: true`, schema
   `{ rule: "no-new-security-findings", minSeverity?: "error" | "warning" | "info" }` (`.strict()`,
   default `"warning"` per D-C21).
2. **One evaluator** in `apps/api/src/assertions/service.ts` that analyses the subject scan and the
   baseline scan through security-posture's `analyzeScan`, diffs by identity (D-C20), and reports:
   - `pass` — no new finding at or above `minSeverity`. The message names how many findings exist in
     total and how many were already in the baseline, so a passing gate is still informative.
   - `fail` — `observed` = the count of new findings at or above the threshold; `details` = one line
     per new finding (`error · poisoning.injection-phrasing · tool "search_issues" — …`), capped with
     the existing `capAssertionDetails`.
   - `skipped` — there is no earlier scan yet (D-C8 case 1), with the reason the existing baseline
     resolution already produces.
3. **One new port** on `AssertionPorts`: `security: { analyze: (scanId: string) => SecurityReport }`,
   wired in `apps/api/src/index.ts` to security-posture WP 1.2's `analyzeScan` bound to the same
   `scans`/`servers`/`oauth` instances.
4. **Docs** — the rule appears automatically in `mcpfp help assert`'s **generated** table (write the
   `ASSERTION_RULE_META` summary, not the table); add it to the rule list in
   `user-guide/22-mcpfp-cli.md` with a one-paragraph explanation of D-C20 and D-C21, and add a line to
   `user-guide/23-ci-github-actions.md`'s rule×topology table (it needs a baseline, so it is
   **topology B** — in topology A it skips on every run).

### Explicitly NOT in this WP

Any heuristic, regex, severity or score — all of that is security-posture WP 1.2 and this rule calls
it · a **skill** posture rule (needs sp WP 1.3, out of scope) · a posture **diff** endpoint or UI
(sp WP 1.4 / 2.1) · persisting a posture report (D-SP8) · a second rule (`max-security-score`,
`no-error-findings`) — one rule, the one the plan names · any change to the six WP 1.3 rules or the
two WP 2.2 rules · a migration · a dependency · a scope change · any web change.

---

## Design (implement this, don't redesign it)

### 1. `packages/shared/src/ci-assertions.ts`

Additive; `ASSERTIONS_VERSION` stays **1** (a new rule kind is additive — WP 1.3's own comment says
so). Append `"no-new-security-findings"` to `ASSERTION_RULE_KINDS`; add its `ASSERTION_RULE_META`
entry with `needsBaseline: true`, `family: "scan"`, and a summary sentence that states the identity
rule and the default threshold in operator language; add the `.strict()` schema (its `minSeverity`
reuses `SECURITY_SEVERITIES` from `security-posture.ts` — import it, do not restate the three
strings) and add it to the `assertionRuleSchema` union.

### 2. `apps/api/src/assertions/service.ts`

- `AssertionPorts` gains the `security` port above. It is a **function**, structurally typed like the
  existing ports, so a test hands it a stub without a database.
- The evaluator:
  1. If there is no baseline scan, return `skipped` with the existing `context.skipReason` — reuse the
     mechanism, do not write a second skip path.
  2. `const subject = ports.security.analyze(subjectScan.id)` and the same for the baseline.
  3. **D-C22**: if `subject.analyzerVersion !== baseline.analyzerVersion`, `throw httpError(400, …)`
     naming both versions. Not a `fail`, not a `skip` — a `2`.
  4. Identity key: a single exported helper, `securityFindingIdentity(finding): string`, living in
     `packages/shared/src/security-posture.ts` **if WP 1.1 already declared one**; otherwise add it
     there (it is the contract's business, not the assertion engine's) as
     `` `${ruleId}|${anchorKey(anchor)}` `` with a documented, stable `anchorKey`. **Do not write it
     inside the assertions service** — WP 1.4's diff needs the same identity, and two implementations
     of "the same finding" is how a diff and a gate end up disagreeing.
  5. New = `subject.findings.filter(f => !baselineKeys.has(identity(f)))`, then filtered by
     `minSeverity` using the declared severity order (`error > warning > info`).
  6. **Use `report.findings`, and account for capping.** `capSecurityFindings` may have truncated the
     list while `counts` kept the true totals (sp WP 1.1's contract). If either report is `truncated`,
     the rule must **not** silently gate on a partial set: report it as an **error (400)** naming the
     cap, because "we compared the first 200 findings" is not a verdict. State this in a comment.
- **No change** to the six WP 1.3 evaluators, the two WP 2.2 evaluators, `buildComparison`'s use, the
  `deltasComparable` guard, or baseline resolution.

### 3. Tests — `apps/api/test/ci-assertions.test.ts` (extend)

- **Pass**: identical subject and baseline findings ⇒ `pass`, message names the totals.
- **Fail**: a new `error` finding ⇒ `fail`, `observed` = 1, details name the rule and the anchor.
- **D-C20 (the one that earns its keep)**: baseline has 3 findings, subject has 3 findings — but one
  was resolved and a *different* one appeared. A count comparison passes; this must **fail**. Write
  that test first.
- **D-C20 (the other direction)**: the same rule fires on the same tool with **different evidence
  text** ⇒ **not** new ⇒ `pass`.
- **D-C21**: a new `info` finding ⇒ `pass` at the default; `"minSeverity": "info"` ⇒ `fail`.
- **D-C8**: no earlier scan ⇒ `skipped`, the report's `passed` stays true, the CLI exits `0` and
  prints a warning `--quiet` does not silence (assert at the CLI level too, reusing WP 1.3's shape).
- **D-C22**: mismatched `analyzerVersion` ⇒ **400**.
- **Capping**: a truncated report on either side ⇒ **400**, never a pass.
- **D-C13**: the rule is accepted in a `{server}`/`{scan}`-targeted document and **rejected** in a
  suite-targeted one.

Every new guardrail test must be **proved to bite**. The orchestrator will specifically revert the
D-C20 identity comparison to a count comparison and expect the resolved-one-added-one test to go red.

---

## Files

**Modified**
- `packages/shared/src/ci-assertions.ts`
- `packages/shared/src/security-posture.ts` — **only** to add `securityFindingIdentity`/`anchorKey`
  if WP 1.1 did not already declare them. Nothing else in that file may change.
- `apps/api/src/assertions/service.ts`
- `apps/api/src/index.ts` (the `registerAssertionRoutes` deps only)
- `apps/api/test/ci-assertions.test.ts`
- `user-guide/22-mcpfp-cli.md`, `user-guide/23-ci-github-actions.md`

**Zero-line diff**
- `apps/api/src/security/analyzer.ts` — this rule adds no heuristic
- `apps/api/src/compare/service.ts` — one differ
- `packages/shared/src/api-tokens.ts`, `apps/api/src/api-tokens/**` — no scope change
- `apps/cli/**` — the CLI renders the report it already renders; if you believe a change is needed,
  report why rather than making it
- `apps/web/**`, `apps/api/src/db/**`, `pnpm-lock.yaml`, every `package.json`, `.env.example`,
  `apps/api/src/config/env.ts`

---

## Acceptance

- **A1** — `no-new-security-findings` exists, is `family: "scan"` + `needsBaseline: true`, validates
  strictly, and appears in the generated `mcpfp help assert` table. It is the **only** rule added.
- **A2 (D-C20)** — "New" is set membership by `(ruleId, anchor)`. The resolved-one-added-one fixture
  **fails**; the same-finding-different-evidence fixture **passes**. The identity helper lives in
  `packages/shared/src/security-posture.ts`, not in the assertions service — state its file:line.
- **A3 (D-C21)** — The default threshold is `warning`: a new `info` finding passes by default and
  fails under `"minSeverity": "info"`.
- **A4 (D-C22)** — A mismatched `analyzerVersion` is a **400** (exit 2), never a pass or a skip.
- **A5 (capping)** — A truncated report on either side is a **400**, never a pass over a partial set.
- **A6 (D-C8)** — No earlier scan ⇒ `skipped` + exit `0`, with a warning `--quiet` does not silence;
  a named-but-unresolvable baseline is still a 400.
- **A7 (D-MCP4/D-SP7)** — The evaluator contains no heuristic, regex, severity table or score: it
  calls security-posture's analyzer through the injected port. Grep proves no rule-id string literal
  or matcher appears in `apps/api/src/assertions/`.
- **A8 (D-C13)** — The rule is rejected in a suite-targeted document with the issue path naming the
  offending rule index, and accepted in a scan-targeted one alongside the WP 1.3 rules.
- **A9** — The failing case's details reach the PR-comment artifact through WP 2.2's existing
  renderer with **no renderer change** (prove it: `packages/shared/src/ci-assertions.ts`'s
  `renderAssertionMarkdown` is unchanged except for anything the new rule's metadata requires).
- **A10** — `user-guide/22-mcpfp-cli.md` documents the rule, D-C20's identity rule and D-C21's
  default; `user-guide/23-ci-github-actions.md`'s rule×topology table marks it topology B.
- **A11 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` **separately**. Report exit codes and test counts.
  The two pre-existing failures (`apps/api/test/compatibility-data.test.ts`;
  `research/token-context-comparison/comparison/all-models.json` in lint) must be reported as
  pre-existing, never fixed silently.
- **A12 (no drive-by scope)** — Every zero-line-diff path is clean; the six WP 1.3 rules and the two
  WP 2.2 rules are byte-identical; no analyzer heuristic changed. You did **not** touch any
  `STATUS.md`.
