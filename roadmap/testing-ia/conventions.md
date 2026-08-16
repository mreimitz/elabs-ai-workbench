# Testing IA — conventions

The [testing conventions](../testing/conventions.md) apply in full (stack ground truth, quality
gate, security boundary). Additions specific to this workstream:

- **Contract-first, additive-only.** Every wire change lands in `packages/shared`
  (types + zod) first, then API, then web. The `scenario` naming is **frozen on the wire**
  (routes, shared type names, DB tables) — the Scenario→Environment rename is user-visible
  labels in `apps/web/src` only. A breaking wire change is owner-gated (`/api/v2` rule).
- **One execution engine.** Ad-hoc/interactive and collection runs are **plans** executed as
  suite-runs through `apps/api/src/suites/orchestrator.ts`. Do not fork a second mass-run path,
  and do not auto-create Suite rows for ad-hoc runs (pending D-T5).
- **Routing discipline.** Every route removed or moved by WP 3.0 gets a `Navigate replace`
  redirect (pattern in `apps/web/src/App.tsx`). Deep-linked consoles
  (`/testing/runs/:runId`, `/testing/suite-runs/:suiteRunId`, `/testing/suites/:suiteId`) must
  keep resolving forever.
- **Local collection invariants** (pending D-T4): reserved name, `is_default`, undeletable,
  never repo-bound; no test/suite may end up collection-less (delete ⇒ reassign to Local).
- **Git-sync trust model intact.** PAT stays write-only + encrypted; SSRF guards and
  no-force-push stay as built; unbound collections answer sync/status/resolve with an honest
  400 (`REPO_NOT_BOUND`-style typed error), never a fake success.
- **Migration numbering** is claimed at kickoff via the cross-workstream decision-log
  convention (Benchmarks holds v13–v15; check sibling `roadmap/*/STATUS.md` decision logs for
  later claims before taking the next free `user_version`).
- **UI discipline** per repo rules: `@brand/*` components only, semantic tokens, both themes
  verified by looking; forms per `.claude/rules/interaction-guidelines.md`; loading/streaming
  per `.claude/rules/loading-states.md` (the unified Runs feed is a streaming surface).
