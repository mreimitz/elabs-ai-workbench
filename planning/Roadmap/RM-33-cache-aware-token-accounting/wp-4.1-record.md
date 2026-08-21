---
type: "Work Package Spec"
title: "WP 4.1 — front page, changelog and the user-guide subject"
description: "Phase 4 of item.md. Ledger: STATUS.md. The §11 hard rule: the front page follows the work, in the same commit as the last tick."
tags: ["roadmap", "RM-33"]
timestamp: "2026-08-21T08:11:00Z"
status: "final"
---
# WP 4.1 — the record

Phase 4 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

**Depends on:** every other box in this plan.

`CLAUDE.md` §11 — *the front page follows the work* — makes this non-optional: a ledger box does not
tick while the front page still describes software that does not match.

## Scope

- **`README.md`** — update the capability row for Testing / observability so it says what the app now
  does: token figures carry their cache composition, cached tokens are chartable, the cost preview is
  cache-aware. **Verify every claim against the running app or a passing test — never against a WP
  description.**
- **`CHANGELOG.md`** — one entry, naming migration **59** and the additive wire fields.
- **`/new-docu`** — a `planning/user-guide/DC-NN-*` subject (or an increment on the existing Testing
  subject) covering, in the owner's language:
  - what **Tokens ↑** counts (gross, cache-inclusive) and why it is not the same quantity as
    **Context**;
  - the difference between a **cache read** (0.1× — a discount) and a **cache write** (1.25× — a
    premium), and why the app refuses to merge them;
  - how to read the cost breakdown and "saved vs uncached";
  - why an old run shows no split, and why the dashboard says *unavailable* rather than 0%.
- **`.claude/rules/`** — no new rule. If anything, one line in the testing conventions pointing at
  `TokenAmount` as the only sanctioned token display.

## Acceptance

1. Every factual claim added to `README.md` is traceable to a passing test or a check against the
   running app; the WP report states which.
2. `CHANGELOG.md` entry present and names the migration version.
3. The doc subject exists via the generator (never a hand-made folder, never a `README.md` inside
   `planning/`), and `pnpm okf:validate` passes both conformance layers.
4. `pnpm okf:sync` regenerates indexes cleanly; `pnpm okf:test` green.
5. Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.
