---
type: "Work Package Spec"
title: "WP 1.1 \u2014 the security-posture contract: findings, report, score, rule-id registry"
description: "Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-20"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.1 — the security-posture contract: findings, report, score, rule-id registry

Phase 1 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** nothing.
**Consumed by:** WP 1.2 (the server analyzer implements the rule ids declared here), WP 1.3/1.4/2.x
of this plan, and — the reason this WP is being built now — **`roadmap/ci/` WP 3.1**, the
`no-new-security-findings` assertion.

This is a **contract-only** WP. It ships types, zod schemas, a frozen rule registry, one pure score
function, one pure ordering function, one redaction helper, and their tests. **It analyses nothing.**
Every rule id it declares is implemented by WP 1.2.

---

## Locked decisions this WP implements

The security-posture decision log is empty; the binding constraints come from this plan's README and
from the repo rules:

- **README invariant — deterministic + versioned.** Findings carry `ruleId`, a severity, evidence and
  a documented rationale; reports are never silently compared across analyzer versions.
- **README invariant — read-only over persisted data.** No MCP connection, no skill execution, no
  network, ever. This WP has no I/O at all.
- **README invariant — conservative, documented heuristics.** A finding says *why* and cites what it
  matched; severity inflation is a defect.
- **README invariant — no new runtime dependency.**
- **`.claude/rules/architecture.md`** — a wire shape is declared in `packages/shared` first, as a type
  **and** a zod schema. That is exactly and only what this WP does.
- **`.claude/rules/mcp-and-security.md`** — nothing leaving the API may carry a secret value.

### Decisions to lock in this WP (record them in the ledger's decision log — it starts here)

- **D-SP1 — the analyzer is a pure, versioned read-model declared in `packages/shared`, and the
  contract lands before the first rule.** One module, `security-posture.ts`, holding the shapes, the
  registry, the score and the ordering. WP 1.2's analyzer, WP 2.x's UI and CI WP 3.1's assertion all
  import from it; none of them re-derives a shape, a weight or a sort order. The precedent is
  `packages/shared/src/ci-assertions.ts` (the CI gate contract) and `skill-security.ts` (a derivation
  moved out of a React component so both ends could reach it) — follow their shape and their comment
  density.
- **D-SP2 — a rule id is `category.kebab-slug`, and it is frozen the moment it ships.** A rule is
  never renamed and never re-pointed at a different check; a rule that stops making sense is marked
  `deprecated` and keeps its id. This is not tidiness: CI WP 3.1 compares finding sets **by `ruleId`**
  across two releases, so a renamed rule reads as one finding resolved and one new finding appearing,
  which is exactly the false alarm that teaches an operator to ignore the gate.
- **D-SP3 — the score is a documented, severity-weighted deduction from 100, computed in exactly one
  place, and versioned by `SECURITY_ANALYZER_VERSION`.** Deductions: `error` −15, `warning` −5,
  `info` −1, floored at 0. Bands: `clean` = 100, `low` 90–99, `medium` 70–89, `high` < 70. Two reports
  produced under different analyzer versions are **never silently compared** — the same posture
  `counting_version` already gives token counts. The weights live beside the function that applies
  them, and no caller may re-implement it.
- **D-SP4 — evidence is redacted and capped by construction, not by convention.** A finding's evidence
  passes through one helper that (a) truncates to `SECURITY_EVIDENCE_MAX_CHARS` with an explicit
  marker, (b) replaces control and zero-width characters with visible escapes — a poisoning rule's
  whole job is to surface characters you cannot see, so printing them raw would hide the finding, and
  (c) masks anything token-shaped (`mcpfp_…`, long base64url runs, `sk-…`-style keys). A finding never
  carries an absolute local path.
- **D-SP5 — a finding's severity IS its rule's declared severity. Always.** A rule that needs two
  severities is two rules. Per-instance escalation would make a gate's counts move for reasons an
  operator cannot see in the rule list, and `no-new-security-findings` would have to reason about
  severity drift on top of set membership. Pinned by a test over the registry, and enforceable at
  construction because the finding factory reads the severity from the registry rather than taking it
  as a parameter.
- **D-SP6 — a report is byte-stable for the same input.** Findings are emitted in one total order
  (severity descending, then `ruleId`, then anchor kind, then anchor name, then evidence excerpt), by
  one exported comparator. Determinism is the plan's headline invariant and a diff (WP 1.4) plus a CI
  gate are both meaningless without it, so the order is part of the contract, not of the analyzer.

---

## What we're building

One new file, `packages/shared/src/security-posture.ts`, one test file beside it, and one export line.

1. **Version + vocabulary** — `SECURITY_ANALYZER_VERSION`, the severity tuple, the subject-kind tuple,
   the rule-category tuple, and the score bands.
2. **The rule registry** — `SECURITY_RULES`, a frozen record keyed by rule id, each entry carrying its
   category, subject kind, declared severity, a short title, and a **rationale sentence written for
   the operator who has to act on it** (not a changelog entry). Eleven server rules, listed below —
   exactly the checks WP 1.2 implements.
3. **The shapes** — `SecurityFinding`, `SecurityFindingAnchor`, `SecurityEvidence`,
   `SecuritySubjectRef`, `SecurityScore`, `SecurityReport`, each with a zod schema, because the report
   crosses the wire in WP 2.2 and CI 3.1.
4. **The pure functions** — `computeSecurityScore`, `compareSecurityFindings`,
   `redactSecurityEvidence`, `capSecurityFindings`, and a `createSecurityFinding` factory that reads
   severity from the registry (D-SP5) and runs evidence through the redactor (D-SP4).
5. **The tests** — registry integrity, the score table, the ordering's totality, and proof that the
   redactor bites.

### The eleven server rule ids (WP 1.2 implements these; this WP only declares them)

| Rule id | Severity | What WP 1.2 will check |
| --- | --- | --- |
| `poisoning.injection-phrasing` | error | Imperative override phrasing in a tool description ("ignore previous instructions", "do not tell the user", "before doing anything else, read…"). |
| `poisoning.hidden-instructions` | error | A hidden-instruction block in a description — `<IMPORTANT>`-style pseudo-tags, HTML comments, or a block addressed to the model rather than to the operator. |
| `poisoning.invisible-unicode` | error | Zero-width, bidi-control or private-use characters in a tool name or description. |
| `poisoning.oversized-description` | warning | A tool description past a documented length threshold, where an embedded protocol or a second instruction set can hide in plain sight. |
| `annotation.destructive-unmarked` | warning | A tool whose name/description reads destructive with no `destructiveHint`. |
| `annotation.readonly-contradiction` | error | `readOnlyHint: true` on a tool that reads as mutating (`delete_*`, `write_*`, `create_*`). |
| `annotation.open-world-unmarked` | info | A tool that reads as reaching the network/an external system with no `openWorldHint`. |
| `schema.secret-shaped-parameter` | warning | A free-text parameter named like a credential (`token`, `password`, `api_key`, `secret`, `credential`). |
| `schema.undescribed-parameter` | info | A parameter with no `description` — the model has to guess what to put in it. |
| `schema.unconstrained-additional-properties` | info | An object schema that neither sets `additionalProperties: false` nor constrains it. |
| `oauth.broad-scope` | warning | Stored OAuth scope breadth — a wildcard or an all-of-account scope on a server used for one job. |

Severities are the **declared** ones (D-SP5) and were chosen against the README's "severity inflation
is a defect" line: `error` is reserved for a server asserting something its own surface contradicts —
the three poisoning checks plus `annotation.readonly-contradiction`; hygiene that a reasonable server
may legitimately fail is `info`. The split is **4 `error` · 4 `warning` · 3 `info`**.

**No skill rule ids are declared.** WP 1.3 (the skill analyzer) is out of scope for the CI dependency
and declaring ids nothing implements would leave the registry's integrity test unable to pin them.
`SECURITY_SUBJECT_KINDS` includes `"skill"` so WP 1.3 adds rules without reshaping anything.

### Explicitly NOT in this WP

Any analysis, any rule implementation, any regex that matches a real description (WP 1.2) · any API
route or handler · any repository or DB read · any UI (WP 2.1) · the posture **diff** (WP 1.4) · the
**skill** analyzer and its rule ids (WP 1.3 — out of scope for this workstream slice entirely) ·
report-export integration (WP 2.2) · the CI assertion itself (`roadmap/ci/` WP 3.1) · a migration ·
a runtime dependency · an environment variable · a feature flag.

---

## Design (implement this, don't redesign it)

### 1. `packages/shared/src/security-posture.ts`

Open with a banner in the register of `ci-assertions.ts`/`skill-security.ts`: what this is, why it is
in `shared`, what it deliberately does not do, and the D-SP decisions it encodes.

```ts
/**
 * Bumped when a rule's MEANING changes, a weight changes, or the report shape changes — i.e. whenever
 * two reports would no longer be comparable. Mirrors `TOKEN_COUNTING_VERSION`'s job for token counts:
 * a consumer that compares two reports MUST check this first (D-SP3).
 */
export const SECURITY_ANALYZER_VERSION = 1;

export const SECURITY_SEVERITIES = ["error", "warning", "info"] as const;
export type SecuritySeverity = (typeof SECURITY_SEVERITIES)[number];

/** What a report is ABOUT. `skill` has no rules yet — WP 1.3 adds them without reshaping this. */
export const SECURITY_SUBJECT_KINDS = ["server", "skill"] as const;
export type SecuritySubjectKind = (typeof SECURITY_SUBJECT_KINDS)[number];

export const SECURITY_RULE_CATEGORIES = [
  "poisoning",
  "annotation",
  "schema",
  "oauth",
  "skill-surface",
] as const;
export type SecurityRuleCategory = (typeof SECURITY_RULE_CATEGORIES)[number];
```

The registry entry, and the registry:

```ts
export type SecurityRule = {
  /** `category.kebab-slug`, frozen forever once shipped (D-SP2). */
  id: string;
  category: SecurityRuleCategory;
  subject: SecuritySubjectKind;
  /** The ONE severity every finding of this rule carries (D-SP5). */
  severity: SecuritySeverity;
  /** Four words an operator scans in a list. */
  title: string;
  /**
   * WHY this matters and what to do — one or two sentences, written for the person who has to fix
   * the server, not for a changelog. A rule with a vague rationale is a rule that gets ignored.
   */
  rationale: string;
  /** Set instead of deleting a rule that no longer makes sense. Its id is never reused (D-SP2). */
  deprecated?: true;
};

export const SECURITY_RULES = { /* the eleven entries above */ } as const satisfies Record<
  string,
  SecurityRule
>;

export type SecurityRuleId = keyof typeof SECURITY_RULES;
export const SECURITY_RULE_IDS = Object.keys(SECURITY_RULES) as SecurityRuleId[];
```

The finding + report shapes:

```ts
/** WHERE in the subject the finding lives. `server` is the subject itself (an OAuth-scope finding). */
export type SecurityFindingAnchor =
  | { kind: "server" }
  | { kind: "tool"; toolName: string }
  | { kind: "parameter"; toolName: string; parameterPath: string }
  | { kind: "file"; path: string };

/** The matched text, already redacted and capped (D-SP4). Never constructed by hand. */
export type SecurityEvidence = {
  /** The excerpt, after `redactSecurityEvidence`. */
  excerpt: string;
  /** Character offset of the match within the source text, when the rule knows it. */
  offset?: number;
  /** True when the excerpt was truncated at SECURITY_EVIDENCE_MAX_CHARS. */
  truncated: boolean;
};

export type SecurityFinding = {
  ruleId: SecurityRuleId;
  severity: SecuritySeverity;   // === SECURITY_RULES[ruleId].severity (D-SP5)
  anchor: SecurityFindingAnchor;
  /** One operator sentence naming what was found where. Never a stack trace, never a raw payload. */
  message: string;
  evidence?: SecurityEvidence;
};

export type SecurityScoreBand = "clean" | "low" | "medium" | "high";

export type SecurityScore = {
  /** 0–100, integer, floored at 0. */
  value: number;
  band: SecurityScoreBand;
  /** Echoed so a stored score is never re-banded by a later build's thresholds. */
  analyzerVersion: number;
};

/** Enough to identify what was analysed and reproduce it; never enough to leak anything. */
export type SecuritySubjectRef = {
  kind: SecuritySubjectKind;
  /** The scan id (server) or the skill-version id (skill) the report was computed from. */
  id: string;
  /** The owning entity: the server id, or the skill id. */
  ownerId: string;
  /** Display name of the owning entity. Not a path, not a URL, not a command line. */
  name: string;
  /** When the analysed artefact was produced (scan `scannedAt` / skill version `createdAt`). */
  capturedAt: string;
};

export type SecurityReport = {
  analyzerVersion: number;
  /** ISO 8601 instant the analyzer produced this. */
  generatedAt: string;
  subject: SecuritySubjectRef;
  findings: SecurityFinding[];
  counts: { error: number; warning: number; info: number; total: number };
  score: SecurityScore;
  /** True when `capSecurityFindings` dropped rows; `counts` still reflects ALL findings. */
  truncated: boolean;
};
```

`counts` counting **all** findings while `findings` may be capped is deliberate and must be stated in
a comment: a gate that reads `counts.error` must never be fooled by display truncation.

Zod schemas for `SecurityFinding`, `SecurityScore`, `SecuritySubjectRef` and `SecurityReport`
(`securityFindingSchema`, …), each `.strict()`, mirroring the types exactly. `ruleId` validates
against the registry key set, not against a loose string.

The pure functions:

```ts
export const SECURITY_EVIDENCE_MAX_CHARS = 200;
export const SECURITY_FINDING_LIMIT = 200;

export const SECURITY_SEVERITY_DEDUCTION: Record<SecuritySeverity, number> =
  { error: 15, warning: 5, info: 1 };

/** D-SP3 — the ONE place a posture score is computed. */
export function computeSecurityScore(findings: readonly SecurityFinding[]): SecurityScore;

/** D-SP6 — the ONE total order. Severity desc, then ruleId, then anchor, then excerpt. */
export function compareSecurityFindings(a: SecurityFinding, b: SecurityFinding): number;

/** D-SP4 — truncate, escape invisibles, mask token-shaped runs. */
export function redactSecurityEvidence(raw: string, offset?: number): SecurityEvidence;

/** Bound a report's finding list; the caller keeps the true counts. */
export function capSecurityFindings(findings: readonly SecurityFinding[]):
  { findings: SecurityFinding[]; truncated: boolean };

/** D-SP5 — severity comes from the registry, never from the caller. */
export function createSecurityFinding(input: {
  ruleId: SecurityRuleId;
  anchor: SecurityFindingAnchor;
  message: string;
  evidence?: { raw: string; offset?: number };
}): SecurityFinding;
```

`redactSecurityEvidence` specifics (write them as code, not as prose):
- Escape ` -`, ``, `​-‏`, `‪-‮`, `⁠-⁤`, `﻿` to a
  visible `\uXXXX` form.
- Mask `mcpfp_[A-Za-z0-9_-]{20,}`, `sk-[A-Za-z0-9_-]{16,}`, `gh[pousr]_[A-Za-z0-9]{20,}`, and bare
  base64url runs of 32+ characters, each to `«redacted»`. Masking runs **after** escaping so an
  invisible character cannot split a credential past the matcher.
- Truncate to `SECURITY_EVIDENCE_MAX_CHARS`, appending `…`, and set `truncated`.

`compareSecurityFindings` must be a **total** order — no pair may compare 0 unless every component is
equal — because `Array.prototype.sort` is only stable within one engine's implementation, and a
byte-stable report is the point (D-SP6).

### 2. `packages/shared/src/index.ts`

Add one line, alphabetically: `export * from "./security-posture.js";` — between `./run-filter.js`
and `./schemas.js`. That is the file's whole diff.

### 3. `packages/shared/src/security-posture.test.ts`

Follow `feature-flags.test.ts` / `workbench-mcp.test.ts` in style (node test runner via the shared
package's existing setup — check how the neighbours are run before writing the first line).

- **Registry integrity**: every key equals its entry's `id`; every id matches
  `/^[a-z-]+\.[a-z0-9-]+$/` and its prefix is a declared `SECURITY_RULE_CATEGORIES` member; every
  severity is a declared member; every rationale is a non-empty sentence of at least ~40 characters
  (a placeholder rationale is a defect the gate should catch); ids are unique; there are exactly 11
  rules and all of them are `subject: "server"`.
- **D-SP5**: `createSecurityFinding` ignores any attempt to pass a severity (the type forbids it —
  assert the runtime behaviour too) and always emits `SECURITY_RULES[ruleId].severity`.
- **D-SP3 score table**: `[]` → 100/`clean`; one `info` → 99/`low`; two `warning` → 90/`low`; one
  `error` + one `warning` → 80/`medium`; three `error` → 55/`high`; seven `error` → **0**, not
  negative. The band boundaries at 100/90/70 are asserted exactly.
- **D-SP6 ordering**: sorting a shuffled fixture twice yields the identical array, and no two distinct
  findings compare 0.
- **D-SP4 redaction**: a `mcpfp_`-prefixed token, an `sk-` key and a `ghp_` token are each masked; a
  zero-width space and an RTL override are each visibly escaped; a 5,000-character excerpt is
  truncated with `truncated: true`.
- **Schema round-trip**: a fully-populated `SecurityReport` parses; an unknown `ruleId` is rejected;
  an extra key is rejected (`.strict()`).

---

## Files

**New**
- `packages/shared/src/security-posture.ts`
- `packages/shared/src/security-posture.test.ts`

**Modified**
- `packages/shared/src/index.ts` — **one added export line, nothing else**

**Zero-line diff (verified with `git diff main..HEAD -- <path>`)**
- `apps/api/**` — this WP has no analyzer, no route, no repository read
- `apps/web/**`
- `apps/cli/**`
- every other file in `packages/shared/src/` — in particular `types.ts`, `schemas.ts`,
  `constants.ts`, `ci-assertions.ts`, `api-tokens.ts`, `workbench-mcp.ts`, `skill-security.ts`
- `apps/api/src/db/**` — no migration
- `pnpm-lock.yaml`, every `package.json` — no dependency
- `.env.example`, `apps/api/src/config/env.ts` — no environment variable
- `packages/shared/src/feature-flags.ts` — no feature flag

---

## Acceptance

Each item is independently checkable; cite the file:line or test name that proves it.

- **A1** — `packages/shared/src/security-posture.ts` exists and exports `SECURITY_ANALYZER_VERSION`
  (=1), `SECURITY_SEVERITIES`, `SECURITY_SUBJECT_KINDS`, `SECURITY_RULE_CATEGORIES`, `SECURITY_RULES`,
  `SECURITY_RULE_IDS`, the six shapes, their zod schemas, and the five pure functions named in the
  Design. It is reachable as `@mcp-token-footprint/shared` (one added line in `index.ts`).
- **A2 (D-SP2)** — Exactly the eleven server rule ids in the table above are declared, each
  `category.kebab-slug`, each with a real rationale sentence. The registry-integrity test fails if an
  id is malformed, duplicated, miscategorised, or given a placeholder rationale. No skill rule id is
  declared, and `SECURITY_SUBJECT_KINDS` still contains `"skill"` for WP 1.3.
- **A3 (D-SP5)** — A finding's `severity` is always `SECURITY_RULES[ruleId].severity`;
  `createSecurityFinding` takes no severity parameter, and a test pins the equality across all eleven
  rules.
- **A4 (D-SP3)** — `computeSecurityScore` is the only place weights are applied (grep proves no second
  copy), the documented table holds exactly, the value floors at 0 rather than going negative, and the
  returned `analyzerVersion` echoes `SECURITY_ANALYZER_VERSION`. Bands break at 100 / 90 / 70.
- **A5 (D-SP6)** — `compareSecurityFindings` is a total order: sorting a shuffled fixture is
  idempotent and byte-stable, and no two distinct findings compare 0.
- **A6 (D-SP4)** — `redactSecurityEvidence` masks each of the three credential shapes, visibly escapes
  zero-width and bidi-control characters (the poisoning rules' whole subject matter), and truncates at
  `SECURITY_EVIDENCE_MAX_CHARS` with `truncated: true`. A test proves masking survives an invisible
  character injected mid-credential.
- **A7** — `capSecurityFindings` bounds the list while `SecurityReport.counts` keeps the **true**
  totals, and a comment says why. The zod schemas are `.strict()`, validate `ruleId` against the
  registry, and round-trip a fully-populated report.
- **A8 (pure)** — The module imports nothing but `zod` and the package's own type modules: no
  `node:*`, no filesystem, no network, no `apps/api` reachability. Grep the imports and say so.
- **A9 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` run **separately**. Report exit codes and test counts,
  including the shared package's count before and after. Two failures are **pre-existing on `main`**
  and must be reported as such, never fixed silently and never allowed to mask a new one: 2 tests in
  `apps/api/test/compatibility-data.test.ts` (stale model roster) and `pnpm lint` refusing
  `research/token-context-comparison/comparison/all-models.json` (1.8 MiB over Biome's 1 MiB cap).
- **A10 (no drive-by scope)** — Every path in the zero-line-diff list has a zero-line diff; the only
  modification outside the two new files is the single export line in `packages/shared/src/index.ts`.
  **No rule is implemented, no analyzer is written, no API route is added.** You did **not** touch any
  `STATUS.md`.
