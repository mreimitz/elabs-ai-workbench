---
type: "Work Package Spec"
title: "WP 0.5 — Posture rule false positive, error-finding triage, fleet chip without a risk band, severity vocabulary"
description: "Phase 0 of item.md. Ledger: STATUS.md. Fix the readOnlyHint name rule that flags getters such as qlik_get_set_expression as mutations, triage every error-severity finding on the owner's servers, render the fleet posture chip as a finding count until that triage is accepted, replace 'Blocker' with limit language, and use one severity ramp with one tone per word across Advisor, Issues and Compatibility."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 0.5 — Posture rule false positive, error-finding triage, fleet chip without a risk band, severity vocabulary

Phase 0 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Files: the analyzer rule `annotation.readonly-contradiction` (`apps/api/src/security/analyzer.ts:456-545`;
`MUTATING_VERBS_IN_NAME` at `:473-486` contains `set`/`sets`/`put`/`puts`; the rule fires as `error`), the
score contract (`packages/shared/src/security-posture.ts:446-506` — `error` deductions uncapped, bands
`clean/low/medium/high`), the fleet summary (`apps/api/src/security/service.ts:431`
`summarizeFleetPosture`, `GET /api/security/summary`), the fleet chip
(`apps/web/src/features/servers/ServersOverview.tsx:392-420` and `PostureCell` at `:496-508`), band
labels and tones (`apps/web/src/features/security/PostureScore.tsx:22-36`), the scan Security tab
(`apps/web/src/features/security/SecurityPanel.tsx`), the severity maps
`apps/web/src/features/compatibility/meta.ts:113-119`, `apps/web/src/features/advisor/advisor-format.ts:26-28`,
`apps/web/src/features/issues/IssuesPanel.tsx:346-348`, `apps/web/src/features/issues-fleet/issue-lib.ts:172-174`,
`apps/web/src/features/skills/quality/quality-meta.ts:14-16`, `packages/shared/src/report-derive.ts:18-32`,
the check catalogue `apps/api/src/compatibility/data/test-catalog.json` (`user_facing_name`), the server
Overview Findings card (`apps/web/src/features/servers/ServersView.tsx:642-660`), README §11
(`README.md:259-283`). Out of scope: the server-card recipe and the "Tests" → "Model limits" tab rename
(WP 2.3), compatibility thresholds that can reach green (WP 2.9), shared label maps for wire enums
(WP 3.1), the glossary and its string tests (WP 3.2), RM-20's remaining acceptance boxes beyond the
error-finding triage.

## Actions

1. Fix the name rule (`analyzer.ts:518-541`): a token from `MUTATING_VERBS_IN_NAME` does not fire when a
   read token (`get`, `list`, `read`, `fetch`, `describe`, `search`, `query`, `find`, `show`) precedes it
   in the same name — `qlik_get_set_expression` yields no finding. Additionally require `set`/`sets`/
   `put`/`puts` to be the leading verb token (`set_config` fires, `config_set` and `settings_get` do not).
   The description rule is unchanged. Fixture tests for: `get_set_expression`, `settings_get`,
   `set_config`, `config_set`, `put_object`, `list_deleted_items`, `reset_cache`. — P0
2. Analyzer version bump (`SECURITY_ANALYZER_VERSION` in `security-posture.ts`) with a "Re-analyze
   latest scan" action (`POST /api/security/reanalyze/:scanId`, button on the scan Security tab) so
   stored reports are re-scored on demand rather than silently re-banded; the report states which
   analyzer version produced it. — P1
3. Triage every `error`-severity finding on the owner's instance: re-analyze the latest scan of each
   of the 8 servers, list each `error` finding (rule id, tool, server) with a classification — true
   positive, false positive, or rule change — in RM-20's `STATUS.md` box "the false-positive rate on YOUR real
   servers"; every false positive becomes a fixture plus a rule change before action 4's gate flips. — P0
4. Fleet chip without a risk band until accepted: `PostureCell` (`ServersOverview.tsx:496-508`) renders
   "n findings · x error" as a neutral count chip instead of `PostureScore variant="chip"`; `danger`
   tone only when an `error` finding remains after triage; gated by a shared constant
   `FLEET_POSTURE_BAND_ACCEPTED = false` (flipped when RM-20's box is ticked). Band words stay on the scan
   Security tab. — P1
5. Score scale: the Security tab header prints the score as "15 / 100" and shows the band thresholds
   on hover (today the scale is not shown). — P2
6. **Owner decision needed:** name of the surface. Options: (a) keep "Security posture" (tab, score,
   README §11, `llms.txt`, the gate-rule text around `no-new-security-findings` at README `:384-438`);
   (b) rename to "Definition hygiene" — findings over stored definitions, with the same score, diff and
   CI assertion. Apply across `SecurityPanel.tsx`, `PostureScore.tsx`, README §11 and the generated
   `GET /api/mcp/llms.txt`. — P1
7. Compatibility severities in limit language: `compatibility/meta.ts:113-119` and
   `report-derive.ts:18-32` labels become `blocker` → "Exceeds limit", `high` → "Near limit", `medium`
   → "Within limit", `low` → "Advice" (wire values unchanged); `test-catalog.json` gains a
   `finding_name` per check phrased as the problem ("Namespaced tool names exceed the length limit"),
   used by the Overview Findings card (`ServersView.tsx:642-660`) and the tool detail findings, while
   `user_facing_name` stays for the checks list. "Blocker" appears nowhere in the UI. — P1
8. One ramp for ranked findings: Advisor (`advisor-format.ts:26-28`) and Issues (`IssuesPanel.tsx:346-348`,
   `issue-lib.ts:172-174`) use Critical / High / Medium / Low with one tone each (red filled, amber,
   neutral filled, outline) from one table in `packages/shared`; the two deterministic analyzers keep
   Error / Warning / Info (`quality-meta.ts:14-16`, `PostureScore.tsx`). A test asserts every map reads
   its tone from the shared table, so "High" is never red in one feature and amber in another. — P1
9. "Risk" reserved for security `error`-class results: compatibility, Advisor and Issues copy never
   uses "risk"; string test over `apps/web/src` (non-test files) for `\brisk\b` outside
   `features/security/`. — P2
10. README §11 (`README.md:259-283`) describes the rules as deterministic definition checks with a
    documented false-positive path (the triage list from action 3); the servers-list badge sentence
    matches action 4. Screenshots are regenerated in WP 0.7. — P2

## Acceptance

- [ ] Unit: `qlik_get_set_expression` with `readOnlyHint: true` → 0 findings; `set_config` with
      `readOnlyHint: true` → 1 finding; all existing analyzer and posture tests pass.
- [ ] Owner's instance after re-analysis: no server carries `annotation.readonly-contradiction` on a
      `get_*`/`list_*` tool; every remaining `error` finding is listed in RM-20 `STATUS.md` with its
      classification.
- [ ] `/servers` cards show "n findings" in a neutral tone; a red chip appears only where an accepted
      `error` finding remains; the posture chip and a green status dot never share one line (card
      recipe itself is WP 2.3).
- [ ] `/servers/:id` Overview Findings: no "Blocker"; the top row reads as a problem statement with
      the model count ("… exceed the length limit · 49 of 55 models"); the severity legend reads
      Exceeds limit / Near limit / Within limit / Advice.
- [ ] `grep -rn "Blocker" apps/web/src packages/shared/src --include=*.ts --include=*.tsx` (non-test)
      → 0 hits outside wire-value constants.
- [ ] Advisor "High" and Issues "High" render the same tone; the shared tone-table test passes.
- [ ] `/scans/:id` Security tab shows "<score> / 100" and the analyzer version on the report.
- [ ] `/servers`, `/servers/:id`, `/scans/:id` Security, `/advisor`, `/dashboard?tab=issues` read
      correctly in both themes, verified on the running app.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — the rule fix and fixtures are a day; triage of the owner's servers is a half day; the chip gate,
label maps, `finding_name` column and tone table are two to three days.

## Sources

`PO-14, PO-15, SEC-08, PS-10, PS-11, UXC-14, UXC-22, MK-07, UX-09, WT (/scans/:id Security; cross-cutting 5)`
