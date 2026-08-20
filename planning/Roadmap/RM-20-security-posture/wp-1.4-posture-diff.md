---
type: "Work Package Spec"
title: "WP 1.4 \u2014 posture diff: scan\u2194scan and version\u2194version (added / resolved / unchanged findings)"
description: "Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-20"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.4 — posture diff: scan↔scan and version↔version (added / resolved / unchanged findings)

Phase 1 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.1 (`SecurityReport`, `compareSecurityFindings`, `securityFindingIdentity`),
WP 1.2 (`analyzeScan`), WP 1.3 (`analyzeSkillVersion`).
**Consumed by:** WP 2.1 (the diff view), WP 2.2 (report export) — and, immediately,
`apps/api/src/assertions/service.ts`, whose `no-new-security-findings` rule hand-rolled the same set
arithmetic and now calls this WP's one definition.

> **Provenance note — read this before treating the document as a pre-build spec.**
> A first draft of this file was written at kickoff but was left **untracked in the primary working
> tree**, so it was absent from the implementer's worktree, which is created from a commit. The
> implementer said so plainly rather than inventing one, and derived the design from the plan's
> README, the D-SP1–D-SP16 decision log, WP 1.1–1.3 as the house pattern, and the hard constraints in
> its brief. **This document was then rewritten to describe what actually shipped**, with the two
> ideas from the draft that were *not* built recorded as follow-ups at the end. Nothing here is a
> retro-fitted claim of foresight. The process lesson — **commit a WP spec before dispatching** — is
> the orchestrator's, and is recorded in the ledger.

---

## Locked decisions this WP inherits

- **D-SP1** — the diff's SHAPE and its pure set arithmetic live in
  `packages/shared/src/security-posture.ts`, because the web bundle (WP 2.1), the API and the CI
  assertions engine all need one answer. No second shape, no second order.
- **D-SP2** — no rule id is added, renamed or read. This WP adds no heuristic.
- **D-SP3** — the score is not recomputed. The diff **reads** each report's `score` and subtracts.
  `computeSecurityScore` still appears in exactly one file under `apps/api/src`.
- **D-SP4/D-SP5** — the diff constructs no finding and no evidence; it moves the objects the two
  reports already carry.
- **D-SP6** — byte-stability. Every bucket is emitted in its **source report's** existing
  `compareSecurityFindings` order, which the reports were already sorted into.
- **D-SP8** — computed on read, persisted nowhere. Both sides are recomputed; no cache, no table.
- **D-C20** (`roadmap/ci/`) — a finding's identity is `securityFindingIdentity` (`ruleId` + anchor)
  and nothing else. Evidence is deliberately outside it: a reworded description that still trips the
  same rule on the same tool is the **same** finding, not one resolved plus one new.

## Decisions locked in this WP

- **D-SP17 — there is exactly ONE differ, it lives in the contract, and the CI gate re-projects it.**
  `diffSecurityReports(baseline, subject)` does the set arithmetic in
  `packages/shared/src/security-posture.ts`. `no-new-security-findings` stopped building its own
  identity `Set` and now reads `.added` off it. Two implementations of "which findings are new" is
  how a diff view and a CI gate end up disagreeing in front of an operator with no way to tell which
  one is lying — and the assertions engine's own header already said this rule "analyses NOTHING…
  re-project, don't reimplement" (D-MCP4/D-SP7). **`apps/api/test/ci-assertions.test.ts` is
  byte-identical and green** — that is the proof the re-point moved no gate behaviour.
- **D-SP18 — the differ REFUSES an incomparable pair itself; the service refuses again with an HTTP
  message.** The four conditions of D-SP19 are checked inside `diffSecurityReports`, which throws a
  plain `Error`, **and** inside the API's `requireDiffable`, which throws `httpError(400, …)`. That is
  deliberate belt-and-braces rather than an oversight: the shared throw means a future caller —
  WP 2.1, an export, another gate — cannot skip the check by forgetting to call a predicate, while
  the service's throw is the one an operator actually reads. A test pins the difference by asserting
  the HTTP caller sees **400 and not 500**, which is exactly what would regress if the service guard
  were dropped and only the shared one remained. The cost is two sets of message wording for one set
  of conditions; see the follow-ups.
- **D-SP19 — a diff is refused, never fudged, for four reasons, each naming itself.**
  (a) **Subject-kind mismatch** — a server report against a skill report shares no anchor vocabulary.
  (b) **Different owner** — two scans of *different servers*, or versions of *different skills*.
  "Added" and "resolved" are only meaningful about one subject over time; the cross-server question is
  `GET /api/compare`'s and always was. (c) **Analyzer-version mismatch** — findings from different
  analyzer versions are not on the same scale (the existing D-C22 guard, now shared). (d) **Either
  side truncated** — a shortened list would answer "what changed among the ones we listed", which is
  not a verdict, and would report findings as *resolved* purely because they fell off the other side's
  list. Precedent: D-C8's `deltasComparable === false` is a 400, never a suppressed-to-zero pass.
- **D-SP20 — the diff is dated from its two reports, never from a clock.**
  `packages/shared/src/security-posture.ts` has no clock and must not grow one, so `generatedAt` is
  the **later** of the two reports' own `generatedAt` — the diff is as fresh as its freshest side.
  This is also what makes the determinism test meaningful: a fixed pair of reports diffs to a
  byte-identical answer, every time.

---

## What shipped

1. **`packages/shared/src/security-posture.ts`** (+255 / −6):
   - `SecurityFindingCounts` (extracted from `securityReportSchema`'s inline `counts` literal so the
     diff's three tallies and the report's one tally have a single definition — the parsed shape is
     byte-identical, and this is the only edit to an existing declaration in the file);
   - `SecurityPostureDiff` — `analyzerVersion`, `generatedAt`, `baseline`/`subject`
     (`SecuritySubjectRef` each), `added`/`resolved`/`unchanged` (`SecurityFinding[]` each),
     `counts` (full `SecurityFindingCounts` per bucket) and `score`
     (`baseline`, `subject`, `delta = subject − baseline` — **positive is an improvement**);
   - `diffSecurityReports(baseline, subject)` — the four refusals, then membership by
     `securityFindingIdentity`;
   - `securityPostureDiffSchema` / `securityFindingCountsSchema` / `securityDiffQuerySchema`,
     `.strict()` at every level.
2. **`apps/api/src/security/service.ts`** (+117) — `diffScanPosture(ports, scanId, baselineScanId)`
   and `diffSkillPosture(ports, skillId, versionId, baselineVersionId)`: analyse both sides through
   the **same** `analyzeScan` / `analyzeSkillVersion` the report routes serve (D-MCP4 — the diff and
   the report can never disagree about one subject's posture), then `requireDiffable`, then the shared
   differ. No score is computed here and no port was added.
3. **`apps/api/src/security/routes.ts`** (+63 / −4) — two routes, each a **sub-path of the report it
   diffs**, with the baseline as a query argument:
   ```
   GET /api/scans/:scanId/security/diff?baseline=<scanId>
   GET /api/skills/:id/versions/:vid/security/diff?baseline=<versionId>
   ```
   No discriminator parameter is needed because the path already names the subject kind. Both
   register only when the skills port is present, exactly as WP 1.3's report route does.
4. **`apps/api/src/assertions/service.ts`** (+14 / −8) — the D-SP17 re-point. The only behavioural
   line that changed is how `added` is computed; both guards, `gating`, `carried`, both message
   strings, `observed`/`limit` and the `details` mapping are untouched.
5. **Tests** — `apps/api/test/security-posture-diff.test.ts` (new, +559) and +285 appended to
   `packages/shared/src/security-posture.test.ts`.

`apps/api/test/security-skill-analyzer.test.ts` moved +11 / −5: its route-surface assertion is
deliberately **exhaustive** ("exactly TWO security routes"), so adding two routes makes it false. It
was updated to list all four rather than weakened or filtered — which is the assertion working as
designed.

### Explicitly NOT in this WP

Any **UI** (WP 2.1) · report-export integration (WP 2.2) · a **new** CI assertion rule or any change
to `packages/shared/src/ci-assertions.ts` · a workbench MCP tool over the diff · **cross-owner**
comparison (D-SP19b) · persisting a diff or a report (D-SP8) · a migration · a new runtime dependency
· an environment variable · a feature flag · any new rule, matcher or severity.

---

## Acceptance (as verified)

- **A1 (D-SP17)** — one differ; a test walks `apps/api/src` for a second identity-set construction and
  pins both call sites to the shared one.
- **A2 (D-C20)** — "added" is set membership by `(ruleId, anchor)`, never a count: one resolved plus
  one different added, with **byte-identical counts on both sides**, still reports 1 added / 1
  resolved. A reworded description on the same rule + tool is `unchanged`.
- **A3 (D-SP6)** — each bucket is in its source report's own order; the same pair diffed twice is
  byte-identical.
- **A4–A6 (D-SP19)** — all four refusals, over fixtures **and** over HTTP, each naming itself; a
  baseline scan from a different server is a 400 naming both; a skill version from another skill is a
  **404** (unreachable, not merely rejected).
- **A7 (D-SP3)** — nothing is re-scored; `delta = subject − baseline`, positive when posture improved.
- **A8 (D-SP20)** — the contract stays clock-free (`new Date(` / `Date.now(` absent);
  `generatedAt` is the later of the two reports', tested both ways round.
- **A9** — two read-only routes; `?baseline=` required; unknown ids 404; the exhaustive route-surface
  assertion lists exactly four GET (plus Fastify's four paired HEAD) and no write verb.
- **A10 (D-SP8)** — `sqlite_master` and `PRAGMA user_version` unchanged across a service call **and**
  a real HTTP request; `apps/api/src/db/**` zero-diff.
- **A11 (D-SP17 proof)** — `apps/api/test/ci-assertions.test.ts` byte-identical and green (56/56),
  including its exact-message, `deepEqual(details)` and PR-comment-markdown assertions.
- **A12** — every wire shape `.strict()`; every API response parsed through its schema in the tests.
- **A13** — `apps/api/src/index.ts` **zero-diff**: the diff needed no port the report routes did not
  already receive.

---

## Follow-ups this WP deliberately did not build

Neither is a defect; both are recorded so a later WP can pick them up as **additive** work.

1. **`evidenceChanged` on an unchanged finding.** D-C20 excludes evidence from identity on purpose, so
   a vendor rewording a description leaves the finding `unchanged` — correct, but the UI (WP 2.1)
   cannot currently *show* that the text moved underneath it. A boolean on each unchanged entry would
   surface it without ever affecting membership, counts or the score.
2. **Duplicate-identity pairing.** The differ classifies with `Set`s, so if one side ever carried two
   findings sharing `(ruleId, anchor)` and the other carried one, the extra would silently not appear
   as resolved. No rule emits duplicate identities today — every per-parameter and per-file rule
   anchors distinctly — so this is defence against a future rule, not a live bug.
3. **One voice for the four refusal messages.** D-SP18's belt-and-braces means the conditions have one
   definition but the wording exists twice (shared `Error`, service `httpError`). Both are tested; a
   later tidy could hand the service a reason code and keep one message table.
