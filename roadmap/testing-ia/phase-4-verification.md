# Phase 4 — Verification & docs (WP specs)

## WP 4.1 — E2E + upgrade proofs
**Size:** M · **Depends on:** 2.1, 2.2 · API-test-only (batch 3, parallel-safe with 3.1 + 3.2
— touches only `apps/api/test/`)

**Objective:** the handover's verification section, as executable tests.

**Files:** `apps/api/test/` (extend `migrations.test.ts`; new/extended E2E specs alongside the
existing collection-sync and seeded-suite E2E tests).

**Semantics & Acceptance (each is a test):**
- **Upgrade fixture:** pre-vNEXT DB with a git-bound collection + loose tests/suites →
  migrate → binding intact, Local exists exactly once, loose members reassigned; idempotent on
  second startup.
- **Local lifecycle:** create local collection → add tests → run it (source `collection`) →
  suite-run members match; later bind a `file://` bare repo → the existing offline sync E2E
  passes unchanged.
- **Unbound honesty:** sync/status/resolve on an unbound collection → 400 `REPO_NOT_BOUND`.
- **Plan equivalence:** the same tests × scenarios × reps launched via source `suite` and via
  source `adhoc` produce equivalently-shaped suite-runs (members, accounting, cost cap).
- Gate green. (Web has no test runner — UI acceptance stays in WP 4.2's owner walk; say so
  honestly in the ledger.)

## WP 4.2 — Docs close-out + owner acceptance
**Size:** S · **Depends on:** all · docs-only (batch 6, last)

**Objective:** the repo's self-description matches reality; the owner signs off on the visual
result.

**Files:** `CLAUDE.md` (capability-table row → ✅ with what shipped),
`roadmap/testing-ia/README.md` + `STATUS.md` (final state), pointer-freshness check in
`roadmap/testing/ia-restructure-handover.md`.

**Acceptance:** capability row accurate (no overclaiming — anything unverified is listed as
owner-pending); ledger complete with dates/branches; **owner walk recorded in STATUS.md**:
nav (4 + Setup) in both themes, all four redirects clicked, collections-as-home flow, launcher
both paths, suite-run summary → member → drill, rename sweep spot-check, keyboard/focus pass
on the launcher and feed; gate green.
