# Observability workstream — conventions

Shared rules every WP in this plan assumes. Sub-agents read this file plus their WP spec before
writing code. Where this file and a WP spec disagree, the WP spec wins for its scope.

## Quality gate (definition of done)

`pnpm typecheck && pnpm test && pnpm build && pnpm lint` from the repo root — green in the
worktree before handback, green on `main` after merge. See `.claude/rules/quality-gates.md`.
No WP is ticked without it. Co-locate tests as `name.test.ts` next to sources; API tests live in
`apps/api/test/`.

## Repo rules that bind every WP

- **Contract-first:** any wire change lands in `packages/shared` (`types.ts` + `schemas.ts` +
  `constants.ts`) first, then API, then web. **Additive only** — no field removed or re-typed,
  no `RunEvent`/`RunStatus` union member removed. Old persisted runs must replay unchanged.
- **Runtime/secret boundary:** only the API touches DB, MCP, child processes, secrets. Webhook
  URLs and any credentials go through the encrypted secret store; never into the web bundle,
  never returned by the API.
- **brand-ui only:** every visible element from `@brand/*`; Tailwind v4 semantic tokens, no raw
  colors (`check-tokens` hook); both themes `qlik-bright` + `qlik-dark` must read correctly;
  loading-states rule (`.claude/rules/loading-states.md`) for every streaming/async surface.
- **Naming:** TS files kebab-case, React components PascalCase.
- **No new runtime dependency without owner approval.** SQLite FTS5 ships inside better-sqlite3
  (verify at WP 1.3 claim time; if the bundled build lacks FTS5, STOP and ask — do not add a
  dependency silently).

## Doctrine specific to this plan

1. **Derived, never authoritative.** Every metric, rollup, cluster, and digest is recomputable
   from persisted rows (`runs`, `run_steps`, `run_grades`, `run_feedback`, `mcp_scans`,
   rating-issue tables). If a derived table exists (owner-gated WP), it is a cache with a
   recompute endpoint, never a source of truth.
2. **Honest aggregation (D-OB14).** Token/cost measures are grouped by capability
   (`tokens: exact|estimated|none`, `costBasis`) and rendered as separate, marked series —
   never summed into one blended line. Question-based cost (`qlik_answers`) is its own unit.
   A slice with no data is omitted or marked "no data", never zero-filled. `meanScore` uses
   `PRIMARY_GRADER_PRIORITY` selection exactly as suite analytics do.
3. **Feedback separation (D-OB15, AR6 intact).** Human `run_feedback` scores NEVER blend into
   `meanGrade`, `passRateAt05`, scatter, suite aggregates, or issue scoring. They are a separate
   lens, filterable and visible alongside — nothing more.
4. **Duration means active (per D-US3).** Analytics/metrics/suite surfaces default to
   `activeDurationMs`; wall clock (`totalDurationMs`) is the secondary lens and is always
   labelled as such. Runs persisted before Phase 0 have only wall clock — treat
   `activeDurationMs ?? totalDurationMs` and mark the series accordingly. (Columns land in
   unified-sessions Wave 1.)
5. **The session contract is consumed, never redefined (D-OB27).** Terminals, `stopReasonCode`
   (incl. `stalled`/`wait_expired`/`session_ended`), persisted `phase`, `capabilities_json`,
   the duration split, the `ended` terminal + `seen`, and the status module are owned by
   `roadmap/unified-sessions/` (D-US1–15). This plan reads those columns/modules; any WP that
   finds itself writing terminal/clock/phase logic is out of scope — STOP and ask.
6. **Capability gating, not kind forks (D-US4).** New UI renders from the persisted capability
   manifest, never from `providerKind === …`. Existing forks are replaced only where a WP's
   spec says so.
7. **FTS discipline (D-OB16).** Indexed per run step: user prompts + assistant/answer text
   (≤2 kB/field), tool names + args (≤1 kB), tool results (≤1 kB, skip non-text/base64),
   error strings + stopReason + judge verdicts + forensics summaries/fix targets. Truncation
   limits live in `packages/shared/constants.ts`. The index is rebuildable
   (`POST /api/maintenance/reindex-search`).
8. **Migrations serialize.** Exactly ONE migration-bearing WP in flight at any time. At claim
   time verify the next free `user_version` in `apps/api/src/db/database.ts` `MIGRATIONS` AND
   sibling `roadmap/*/STATUS.md` ledgers (v28 expected first), record the claim in this plan's
   STATUS Decision log. Fresh-DB and upgrade paths both tested (`migrations.test.ts` pattern).
9. **Clock policy is owned by unified-sessions' SessionClock (D-US3/7).** No default wall cap;
   stall detector + wait budget; `activeDurationMs`/`totalDurationMs` split. This plan only
   consumes the persisted values — analytics default to ACTIVE duration (conventions §4).
10. **Scheduler honesty (D-OB19).** The in-process ticker (windowed rules, issue sweeps,
    digests) runs only while the API runs. On boot it evaluates missed windows since the last
    tick and marks late notifications "while you were away" — it never pretends continuity.
11. **Notifications are quiet by default.** Every rule/alert ships disabled or with a
    conservative threshold; the historical-preview endpoint must be consulted in the UI before
    save. No default rule spams.
12. **Stub everything external in tests.** Judge/LLM passes behind injectable seams (existing
    `JudgeGenerate`/driver patterns); webhooks against a local test receiver; no real tenant,
    provider, or subscription call in the gate. Live behavior is owner-acceptance, listed in
    STATUS, never claimed by an agent.

## UI grammar for new surfaces

Follow the established shells: `PageShell`/`PageHeader` + scroll contract, `TabPanel` for tabs,
`StatusBadge`/`lib/status` vocabulary (the single module unified-sessions WP3.1 ships), the 4-tier dialog system,
`components/form/*` for forms, `TableToolbar` + `lib/table` for tables, `@brand/charts` for all
charts (follow `AnalyticsPanel.tsx` chart panel framing; series colors `var(--chart-1..5)`).
Dashboard tabs follow the existing Dashboard card grammar. Every chart/table datapoint that
represents runs deep-links to the runs feed with the equivalent `RunFilter` applied.

## Honest reporting

Tick criteria are the WP's Acceptance checklist plus the gate. Lead with what was NOT verified.
Visual/both-theme/keyboard claims require the running app; otherwise they are owner-acceptance
items recorded in STATUS. Never fake data, never zero-fill, never silently skip a failing case.
