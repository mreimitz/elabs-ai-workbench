---
type: "Status Ledger"
title: "Platform hardening \u2014 work-package status ledger \u00b7 PRIORITY: MEDIUM (rolling)"
description: "Living state for the platform plan, read and updated by /next-wp platform. A box is ticked"
tags: ["roadmap", "RM-18"]
timestamp: "2026-08-22T12:30:00Z"
status: "active"
---
# Platform hardening — work-package status ledger · **PRIORITY: MEDIUM (rolling)**

Living state for the **platform** plan, read and updated by `/next-wp platform`. A box is ticked
**only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/platform/<id>`.

> Plan in [`item.md`](./item.md). WPs are independent — pick opportunistically between
> other workstreams' waves.
>
> **The two blocked-on notes were STALE and are cleared (checked 2026-08-21 by `RM-35` WP 4.1's
> prerequisite recheck).** They read "1.1 needs Benchmarks P1; 1.5 needs Benchmarks P3". Both
> Benchmarks phases are complete in
> [`RM-07`'s ledger](../RM-07-benchmarks/STATUS.md): **Phase 1 is 4/4** (WP 1.1 contract, 1.2 grader
> engine, 1.3 LLM judge, 1.4 grade UI) and **Phase 3 is 5/5** (WP 3.1 suites schema, 3.2
> orchestrator, 3.3 suite console, 3.4 analytics, 3.5 failure buckets). **Nothing in this item is
> blocked on another workstream.** This is the second stale blocked-flag found here — RM-01's WP 2.1
> flag was found stale the same way on 2026-08-18.

- [ ] WP 1.1 — first-run onboarding: seeded demo content + guided empty states
- [ ] WP 1.2 — docs & changelog: in-app docs route, CHANGELOG discipline, per-view help links
- [ ] WP 1.3 — diagnostics bundle: redacted export, secret-free proven by test
- [x] WP 1.4 — upgrade-path test harness: fixture DBs → migrate → invariants — **done 2026-08-22 · `wp/roadmap-cleanup/rm18-1.4` (2 commits, merged) · spec:
      [`wp-1.4-upgrade-harness.md`](./wp-1.4-upgrade-harness.md). It found a LIVE DEFECT in shipped
      migration code, which is what the WP was for.**
      Six captured fixtures (377 KB total, 31–194 KB each), byte-deterministic from a committed
      generator, incl. `user_version = 0` and the item's named pre-v13 case. The harness asserts six
      invariant classes per fixture — version lands at latest, a second migration is a no-op, no row
      lost, `foreign_key_check` + `integrity_check` clean, the migrated schema matches a **fresh** one
      structurally, and repositories still read. It rides `pnpm test` with no wiring (the api script is
      `tsx --test test/*.test.ts`). api tests 3729 → 3738.
      **THE DEFECT — migration v5 broke `run_feedback` on any pre-v5 database.** v5 rebuilt `run_steps`
      by renaming it away first, on the recorded grounds that *"nothing FK-references `run_steps`"*.
      True at F6; **false since v36**, which added `run_feedback.step_id TEXT REFERENCES run_steps(id)
      ON DELETE CASCADE`. SQLite rewrites a child's stored FK text to follow a renamed parent, so the
      rename silently repointed it at `run_steps_old`, which the rebuild then dropped.
      **Reproduced independently by the orchestrator** in an isolated database — the child's DDL came
      back as `REFERENCES "run_steps_old"(id)`, `foreign_key_check` returned `[]` (it inspects ROWS and
      a new `run_feedback` is empty), and **every** insert then failed with *"no such table:
      main.run_steps_old"* — **including one with a NULL `step_id`**, because SQLite resolves the FK
      target when it PREPARES the statement. The whole human-feedback surface (WP1.5 feedback, WP4.5
      review queue) was dead on such a database.
      **The fix** is the pattern v31 already uses on `runs`: build under a new name, copy, DROP the
      original, RENAME into the freed name — no child DDL is ever rewritten. **Verified independently
      under BOTH `foreign_keys` settings**: the child text stays `REFERENCES run_steps(id)`, rows are
      preserved, the insert succeeds. v31's own comment, which cited v5 as the safe counter-example, is
      corrected in the same diff. **Teeth probed:** reinstating the old pattern turns
      `v00-preversioning` red with *"run_feedback foreign keys differ from a fresh database"*.
      `schema.ts` and the `MIGRATIONS` array are byte-unchanged; `apps/web`/`packages`/`apps/cli` are a
      zero-line diff; the live `data/app.sqlite` was never opened (md5 and mtime unchanged).
      ⚠️ **TWO THINGS LEFT FOR THE OWNER, neither done here.** (1) **Forward path only** — a database
      that ALREADY went through the old rename is not healed; repairing it needs a new numbered
      migration, which this WP was forbidden from adding. Exposure is narrow (only a DB opened at
      `user_version` 0–4 by code that already carried v36's `run_feedback`) and **the owner's live
      database was deliberately not checked against it**. (2) The deep fixtures cannot see column drift
      on `run_steps` and `runs` specifically, because v5 and v31 rebuild those two from today's
      `schemaSql` — that is what `v61-at-capture` is for, and it is documented rather than glossed
- [ ] WP 1.5 — performance & scale pass: fleet-scale fixtures, endpoint budgets, index review
- [x] WP 1.6 — owner-acceptance consolidation: one runnable checklist across all ledgers — done
      2026-08-21 · wp/roadmap-cleanup/1.1 · every pending owner walk in the bundle, grouped into four
      sittings by prerequisite (browser · provider key · subscription · CI):
      [`owner-acceptance-consolidated.md`](./owner-acceptance-consolidated.md)

## Decision log
_Entries: date · decision · rationale._

## Owner acceptance (owner-only)
- [ ] Fresh install → load demo data → every main view populated and self-explanatory → remove
      demo data → clean empty states; diagnostics bundle opened and confirmed readable +
      secret-free — accepted: ____
