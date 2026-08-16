# Changelog — next-wp

All notable changes to this skill are recorded here. Versioning is semantic (MAJOR.MINOR.PATCH).

## 1.0.0 — 2026-06-20

Initial release.

- Orchestrates an implementation plan made of numbered work-package (WP) specs + a STATUS ledger.
- Selects the next **open, dependency-unblocked** WPs (up to 4), choosing a **parallel-safe** batch
  (minimal file overlap; recommended build order; owner-gated items surfaced, not faked).
- Dispatches one sub-agent per WP, **each in its own git worktree**; agents implement, run the quality
  gate, self-review against Acceptance, and report back.
- **Validate-and-tick-off review loop**: the orchestrator re-runs the gate, checks every Acceptance
  item, integrates the branch, and ticks the WP off in the ledger — or sends the same agent back to
  refine with itemized feedback.
- Bundled references: `references/plan-layout.md` (required plan folder shape),
  `references/status-ledger.md` (ledger format + parsing/update rules), `assets/STATUS.template.md`
  (ledger template used when a plan has none).
- Ships alongside the project slash command `/next-wp` (`.claude/commands/next-wp.md`), which invokes
  the same workflow.

### Compatibility notes
- Assumes a git repo and a plan folder of WP specs (see `references/plan-layout.md`).
- Project defaults target this repo (plans under `roadmap/`, gate `pnpm typecheck && pnpm test &&
  pnpm build`). Override the plan path and gate for other projects.
