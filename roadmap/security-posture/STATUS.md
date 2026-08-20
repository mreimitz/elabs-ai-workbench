# Security posture — work-package status ledger · **PRIORITY: HIGH**

Living state for the **security-posture** plan, read and updated by `/next-wp security-posture`.
A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/security-posture/<id>`.

> Plan + invariants in [`README.md`](./README.md). Pure read-model over persisted scans/skills —
> no schema migration expected; if one becomes necessary, claim the next free `user_version` via
> the cross-workstream decision-log convention.

## Phase 1 — Analyzer
- [x] WP 1.1 — contract: finding/report/score shapes, rule-id registry, `SECURITY_ANALYZER_VERSION`
      — done 2026-08-20 · `wp/security-posture/1.1` · spec: [`wp-1.1-contract.md`](./wp-1.1-contract.md).
      **Contract only — no analyzer, no rule logic, no route, no migration, no dependency.** Three
      files: a new `packages/shared/src/security-posture.ts` (657 lines), its test (555 lines), and
      **one** added export line in `packages/shared/src/index.ts`. It declares
      `SECURITY_ANALYZER_VERSION` (1), the severity / subject-kind / rule-category vocabularies, the
      **frozen eleven-rule server registry** (3 `error` · 4 `warning` · 4 `info` — WP 1.2 implements
      them), six shapes with `.strict()` zod schemas, and five pure functions:
      `computeSecurityScore`, `compareSecurityFindings`, `redactSecurityEvidence`,
      `capSecurityFindings`, `createSecurityFinding`. Its only import is `zod` — no `node:*`, no
      filesystem, no network. Decisions **D-SP1–D-SP6** in the log below.
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`typecheck` **0** · shared **127/127** [97 before] · cli **63/63** · api **3344 passed / 7
      failed** — the pre-existing compatibility-roster failures — · `build` **0** · `lint` **2**
      errors, both the pre-existing oversized `all-models.json`; web **3556 passed / 5 skipped**, run
      separately and byte-identical to the measured baseline); the three-file diff and the one-line
      `index.ts` change; and **three independent teeth checks** — disabling credential masking in
      `redactSecurityEvidence`, letting a caller smuggle a severity past `createSecurityFinding`, and
      dropping the comparator's residual tie-breakers each turned tests **red**, all restored
      afterwards (`git status` clean).
      **Two deviations, both reported rather than taken silently:** (1) the spec's `index.ts`
      placement instruction contradicted itself ("alphabetically" vs "between `run-filter` and
      `schemas`"); the agent took alphabetical, which is correct — `security-posture` sorts after
      `schemas`. (2) The credential regexes absorb an escaped-invisible as one credential character,
      without which the spec's own requirement (masking survives an invisible injected mid-credential)
      is unachievable, because escaping inserts a backslash that splits the run.
      **Orchestrator note (not a defect — carry into WP 1.2's fixtures):** the catch-all
      `[A-Za-z0-9_-]{32,}` credential pattern will mask a long snake_case MCP tool name that appears
      inside an evidence excerpt. Nothing leaks and the finding's *anchor* still names the tool
      unredacted, but WP 1.2's fixtures should expect it rather than be surprised by it.
      **Not verified:** D-SP4's "a finding never carries an absolute local path" is documented in the
      anchor's JSDoc, not enforced at runtime — that becomes WP 1.2's obligation when it constructs
      anchors. `SecurityRule.deprecated` is declared but unused, so untested. Nothing was run against
      the running app (this WP adds no route and no UI).
- [ ] WP 1.2 — server analyzer: poisoning/annotation/schema/OAuth rules + score — depends: 1.1 ✅ · spec: [`wp-1.2-server-analyzer.md`](./wp-1.2-server-analyzer.md)
- [ ] WP 1.3 — skill analyzer: security-surface roll-up + score
- [ ] WP 1.4 — posture diff (scan↔scan, version↔version)

## Phase 2 — Surfacing
- [ ] WP 2.1 — UI: Security tabs, list badges, diff view (both themes)
- [ ] WP 2.2 — report export integration

## Decision log
_Entries: date · decision · rationale._

- **2026-08-20 · D-SP1–D-SP6 locked at the WP 1.1 kickoff.** Full text + the design they bind:
  [`wp-1.1-contract.md`](./wp-1.1-contract.md). Declared in
  `packages/shared/src/security-posture.ts` and pinned by `packages/shared/src/security-posture.test.ts`.
  - **D-SP1 — the analyzer is a pure, versioned read-model declared in `packages/shared`, and the
    contract lands before the first rule.** One module holds the shapes, the rule registry, the score
    and the emit order. WP 1.2's server analyzer, WP 1.3's skill analyzer, WP 1.4's posture diff,
    WP 2.x's UI and `roadmap/ci/` WP 3.1's `no-new-security-findings` assertion all **import** from
    it; none re-derives a shape, a weight or a sort order. Its only import is `zod` — no `node:*`, no
    filesystem, no network, no DB — which is what lets the API, the web bundle and the CLI-facing
    report share one copy. Precedent: `ci-assertions.ts` and `skill-security.ts`. No migration, no
    runtime dependency, no feature flag, no environment variable.
  - **D-SP2 — a rule id is `category.kebab-slug`, and it is frozen the moment it ships.** A rule is
    never renamed and never re-pointed at a different check; one that stops making sense is marked
    `deprecated` and keeps its id. CI WP 3.1 compares finding sets **by `ruleId`** across two
    releases, so a rename reads as one finding resolved plus one new finding appearing — exactly the
    false alarm that teaches an operator to ignore the gate. Eleven server rule ids are frozen here;
    no skill rule id is declared, but `SECURITY_SUBJECT_KINDS` already carries `"skill"` so WP 1.3
    adds rules without reshaping anything. Pinned by a test that writes the ids **and** their
    severities out a second time by hand, so a rename or a severity drift is a red test.
  - **D-SP3 — the score is a documented, severity-weighted deduction from 100, computed in exactly
    one place, and versioned by `SECURITY_ANALYZER_VERSION`.** Deductions: `error` −15, `warning` −5,
    `info` −1, floored at 0. Bands: `clean` = 100, `low` 90–99, `medium` 70–89, `high` < 70.
    `computeSecurityScore` is the only function permitted to apply the weights or the thresholds —
    the band function is deliberately **not** exported — and the returned score echoes the analyzer
    version so a stored score is never re-banded by a later build. Two reports produced under
    different analyzer versions are never silently compared, the same discipline `counting_version`
    already gives token counts.
  - **D-SP4 — evidence is redacted and capped by construction, not by convention.** Every excerpt
    passes through `redactSecurityEvidence`, in this order: (a) invisible characters — C0, DEL,
    U+200B–200F, U+202A–202E, U+2060–2064, U+FEFF — are rewritten to a visible `\uXXXX`, because a
    poisoning rule's whole job is to surface characters you cannot see and printing them raw would
    hide the finding; (b) credential-shaped runs (`mcpfp_…`, `sk-…`, `gh[pousr]_…`, and bare
    base64url runs of 32+) are masked to `«redacted»` — masking runs **after** escaping, and the
    matchers absorb an escaped-invisible as one credential character, so an invisible injected
    mid-credential cannot split the run past the matcher; (c) the result is truncated at
    `SECURITY_EVIDENCE_MAX_CHARS` (200) with an explicit `…` and `truncated: true`.
    `createSecurityFinding` takes evidence as `{ raw }`, never as a finished excerpt, so the redactor
    cannot be bypassed. A finding never carries an absolute local path.
  - **D-SP5 — a finding's severity IS its rule's declared severity. Always.** A rule that needs two
    severities is two rules. Per-instance escalation would make a gate's counts move for reasons an
    operator cannot see in the rule list, and `no-new-security-findings` would have to reason about
    severity drift on top of set membership. Enforced at construction: `createSecurityFinding` has
    **no** `severity` parameter and reads it from `SECURITY_RULES`. Pinned across all eleven rules,
    including a case that smuggles a severity in through a cast.
  - **D-SP6 — a report is byte-stable for the same input.** Findings are emitted in one total order
    via the exported `compareSecurityFindings`: severity descending, then `ruleId`, then anchor kind,
    then anchor name, then the evidence excerpt — followed by residual tie-breakers (evidence
    presence, offset, truncated flag, message) so **no pair compares 0 unless every component is
    equal**. `Array.prototype.sort` is only stable within one engine, and the posture diff (WP 1.4)
    plus the CI gate are both meaningless without byte-stability, so the order belongs to the
    contract, not to the analyzer. String comparison is UTF-16 code-unit, never `localeCompare`.
    `SecurityReport.counts` always describes **all** findings even when `capSecurityFindings`
    (limit 200) shortened the list, so a gate reading `counts.error` cannot be fooled by display
    truncation.

  _Rationale:_ the whole workstream's value is that a posture report can be **diffed** — release to
  release, and by a CI gate that must not cry wolf. Every one of these six exists to make two reports
  comparable: a frozen id, one score, one order, one redactor, one severity per rule, and a version
  stamp for the day any of that has to change.

## Owner acceptance (owner-only)
- [ ] A deliberately poisoned fixture server (injection phrasing + secret-shaped param +
      contradictory annotation) shows the expected findings with readable evidence in both
      themes; a clean server scores clean; the diff shows a finding appearing and resolving —
      accepted: ____
