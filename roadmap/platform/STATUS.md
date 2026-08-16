# Platform hardening — work-package status ledger · **PRIORITY: MEDIUM (rolling)**

Living state for the **platform** plan, read and updated by `/next-wp platform`. A box is ticked
**only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/platform/<id>`.

> Plan in [`README.md`](./README.md). WPs are independent — pick opportunistically between
> other workstreams' waves. Blocked-on notes: 1.1 needs Benchmarks P1; 1.5 needs Benchmarks P3.

- [ ] WP 1.1 — first-run onboarding: seeded demo content + guided empty states
- [ ] WP 1.2 — docs & changelog: in-app docs route, CHANGELOG discipline, per-view help links
- [ ] WP 1.3 — diagnostics bundle: redacted export, secret-free proven by test
- [ ] WP 1.4 — upgrade-path test harness: fixture DBs → migrate → invariants
- [ ] WP 1.5 — performance & scale pass: fleet-scale fixtures, endpoint budgets, index review
- [ ] WP 1.6 — owner-acceptance consolidation: one runnable checklist across all ledgers

## Decision log
_Entries: date · decision · rationale._

## Owner acceptance (owner-only)
- [ ] Fresh install → load demo data → every main view populated and self-explanatory → remove
      demo data → clean empty states; diagnostics bundle opened and confirmed readable +
      secret-free — accepted: ____
