---
type: "Work Package Spec"
title: "WP 6.9 (AM-OB10) — watch-rule dual thresholds, an explicit NO_DATA state, and pausing"
description: "A WARNING threshold below ALERT, an explicit NO_DATA state to replace today's silent treatment of an empty window as recovery, a PAUSED state distinct from disabled, and renotification for sustained conditions."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.9 (AM-OB10) — watch-rule dual thresholds, an explicit NO_DATA state, and pausing

## Verification finding

**None of the three parts is built — and the NO_DATA gap is not merely missing, it is actively
wrong today.**

The shipped rule shape (`packages/shared/src/types.ts:2336-2353`, DDL
`apps/api/src/db/schema.ts:828-841`):

```ts
export type WatchRule = {
  id; name; enabled: boolean;
  trigger: "on_terminal" | "windowed";
  filter: RunFilter;
  sample?: number;              // deterministic [0,1] hash gate
  window?: WatchWindowConfig;
  lastEvaluatedAt?: string;
  actions: WatchAction[];
  createdAt; updatedAt;
};
```

**1. One threshold, no severity on it.** `WatchWindowConfig` (`types.ts:2316-2332`) carries exactly one
scalar `threshold` with one `op` (`">=" | "<="` — `constants.ts:621`), plus `measure`, `grader?`,
`groupBy?`, `bucket`, `window`, `cooldownMinutes`. `WatchRule.window` is singular (`:2346`), the column
is a single `window_json` (`schema.ts:835`), and the round-trip parses it as one object
(`apps/api/src/watch/repository.ts:294-296`).

Severity exists **only on the `notify` action** — `WatchNotifySeverity = ["info","warning","critical"]`
(`constants.ts:588`), attached at `types.ts:2280`. Two `notify` actions on one rule would still share
the **same single threshold**, so that does not produce warning-vs-alert behaviour; and the web editor
cannot even express it, because `ActionFormState` has one fixed slot per action type
(`apps/web/src/features/watch/rule-form.ts:62-70`).

**2. There is no persisted rule state; the fire/recover machine is re-derived from the audit log.**
`watch_rules` has no state column. `WatchRuleRepository.getWindowState`
(`apps/api/src/watch/repository.ts:204-223`) reads the latest `window_fire`/`window_recover` marker and
computes `armed = latestMarker === undefined || latestMarker.action === "window_recover"` (`:220`),
consumed at `engine.ts:264-267`. So there are exactly **two implicit states — armed (ok) and not-armed
(firing)** — derived, never stored. On-terminal rules are fully stateless (`engine.ts:56-94`).

**3. NO_DATA — the defect.** `apps/api/src/watch/engine.ts:395-428` flattens every returned point and
then:

```ts
if (points.length === 0) return { value: null, n: 0, breached: false };   // engine.ts:420
```

An empty window returns **no series at all**, because `computeRunMetrics` builds buckets only from
fetched rows (`apps/api/src/observability/metrics.ts:459-470`) and `buildRunSeries` skips empty ones
(`:578`) — there is no zero-fill, deliberately. So `points.length === 0` ⇒ `breached: false` ⇒ the
state machine takes the **not-breached branch** (`engine.ts:283-300`), which emits a `window_recover`
marker if the rule was firing and **sets `armed = true`** (`:299`).

**That means an empty window is currently treated as RECOVERY.** A rule firing because "error rate ≥
30%" is marked recovered the moment traffic stops entirely — the one circumstance where an operator
most needs to be told something is wrong. There is no `no_data` state, no marker, and no policy field:
greps for `no_data`/`nodata`/`no-data` across `apps/api/src/watch/`, `apps/web/src/features/watch/`,
`apps/web/src/features/notifications/` and all three shared contract files return **zero hits**. The
preview surface is more honest than the evaluator — `WatchWindowPreviewPoint.value` is `number | null`
(`types.ts:2424-2433`, `engine.ts:336-343`) — but it is fed by the same `breached: false` collapse, so
its chart cannot distinguish "healthy" from "nothing ran" either.

**4. No PAUSED state.** `enabled` (`types.ts:2339`, `schema.ts:831`) is the only lifecycle flag,
toggled at `apps/api/src/watch/routes.ts:59-63` and `WatchRulesView.tsx:124-131,265-267`. Greps for
`snooze|mute|paused` across the watch and notification surfaces return only unrelated matches
(`tone="muted"` styling; `waiting_input` run-status prose at `constants.ts:259,269`). On the
notification side the only per-item flag is `read` (`types.ts:2464`) — dismissal, not suppression.

**5. Renotification exists for windowed rules only, and nothing for on-terminal.** The whole
suppression machine is `engine.ts:269-301`: on breach, fire if `armed || cooldownElapsed`, then
disarm and stamp `lastFiredMs`; while continuously breached inside the cooldown, stay quiet; on
not-breached, record `window_recover` and re-arm (so the next breach fires immediately, ignoring
cooldown). `cooldownMs = config.cooldownMinutes * 60_000` (`:262`), capped by
`WATCH_COOLDOWN_MAX_MINUTES = 7*24*60` (`constants.ts:635`), web default 60
(`rule-form.ts:55`). Note the granularity: comparisons are against **window END boundaries**, so
effective resolution is the window width, not wall-clock minutes.

`on_terminal` rules have **no dedupe, no suppression, no interval** — `onRunSettled`
(`engine.ts:56-94`) fires every action for every matching run, from the single choke point at
`apps/api/src/testing/run-service.ts:923-943`. The only rate control is the deterministic
per-(rule, run) sample hash (`sampleDecision`, `engine.ts:119-126`). 50 failing runs ⇒ 50
notifications.

**Verdict: NOT BUILT.**

## Goal

Afterwards a watch rule can warn before it alarms, says "nothing ran" instead of pretending everything
recovered, can be muted for an afternoon without being switched off and forgotten, and keeps reminding
the operator while a condition persists instead of going quiet after one message.

## Scope — four parts, one of them a bug fix

**1. Dual thresholds (WARNING below ALERT).**
`WatchWindowConfig` gains an optional second threshold with the same `op`. The evaluator resolves the
**most severe** satisfied level per evaluation and carries it into the action dispatch, so a `notify`
action can render its severity from the level reached rather than from a fixed config value. The
severity vocabulary already exists (`WatchNotifySeverity`, `constants.ts:588`) — reuse it, do not add a
second one. Validate at zod that WARNING is on the same side of, and less severe than, ALERT for the
configured `op` — a warning that is stricter than the alert is a footgun.

**2. An explicit NO_DATA state — fix the recovery bug first.**
Separate "the window contained no runs" from "the window contained runs and they were fine" at
`engine.ts:395-428`. `n === 0` must produce a distinct outcome, not `breached: false`. Then a
per-rule **no-data policy** decides what happens: *treat as OK* (today's behaviour, kept as an
explicit opt-in), *notify*, or *hold state* (neither fire nor recover — recommended default, because
it is the only one that cannot lie in either direction).
The state is still **derived from the audit log** — add a `window_no_data` marker beside the existing
`window_fire`/`window_recover` rather than introducing a state column. ⚠ **Verify at pickup whether
`watch_rule_events.action` (`schema.ts:847-856`) is CHECK-constrained**; if it is, adding a marker is a
schema change and this part inherits the migration.
The preview endpoint must expose the distinction too (`WatchWindowPreviewPoint` already carries
`value: number | null` — give it the state, so the historical preview a user consults before saving
shows "no data" rather than a healthy-looking gap).

**3. A PAUSED state distinct from disabled.**
Disabled means "I do not want this rule". Paused means "I know, stop telling me until <time>". Model it
as a nullable `paused_until` timestamp on the rule: expired pauses resolve to active with no sweep
needed, and a paused rule still **evaluates and records state** — it only suppresses the actions. That
distinction matters: a rule that stops evaluating while paused would come back armed and blind.
This is the one part of the item that needs a column.

**4. Renotification for sustained conditions.**
Windowed rules already have `cooldownMinutes` doing exactly this — the honest reading is that part 4
is **already satisfied for windowed rules** and the real gap is `on_terminal`, which has no suppression
at all. Give on-terminal rules a bounded notification budget (a per-rule minimum interval, or a cap per
window) so a broken environment producing 50 failures does not produce 50 notifications. Keep
conventions §11 in view: rules ship quiet by default, and this makes them quieter, never louder.

## Files

Modify:

- `packages/shared/src/types.ts` — ⚠ **contended**
- `packages/shared/src/schemas.ts` — ⚠ **contended**
- `packages/shared/src/constants.ts` — ⚠ **contended**
- `apps/api/src/watch/engine.ts` — the evaluator, the state machine, the on-terminal path
- `apps/api/src/watch/repository.ts` — `getWindowState`, `prepareActions`, the row round-trip
- `apps/api/src/watch/routes.ts` — the pause/resume action
- `apps/api/src/db/database.ts` — ⚠ **migration (part 3 only, see below)**
- `apps/api/src/db/schema.ts` — ⚠ **migration (part 3 only)**
- `apps/web/src/features/watch/RuleEditorDialog.tsx` — ⚠ **contended with AM-OB4 and AM-OB11**
- `apps/web/src/features/watch/rule-form.ts` — ⚠ **contended with AM-OB4 and AM-OB11**
- `apps/web/src/features/watch/WatchRulesView.tsx` (the pause control + state column)
- `apps/web/src/features/watch/RuleAuditDialog.tsx` (the new marker in the audit list)
- `apps/api/test/watch-rules.test.ts` and the windowed-rule test file
- `apps/web/src/features/watch/RuleEditorDialog.test.tsx`, `WatchRulesView.test.tsx`

## Non-goals

- **No third severity vocabulary.** `WatchNotifySeverity` exists; reuse it.
- No change to the deterministic sample hash (`engine.ts:119-126`) — it is a sampling gate, orthogonal
  to renotification.
- No change to the on-terminal choke point (`run-service.ts:923-943`) or to when rules are evaluated.
- **No zero-filling of empty metric buckets** to make NO_DATA disappear. `computeRunMetrics` omitting
  empty buckets (`metrics.ts:459-470`, `:578`) is correct and is doctrine (conventions §2); the fix
  belongs in the evaluator, not the metrics service.
- No paging, no escalation chains, no on-call rotation. This is single-owner local software.
- No change to `WatchWindowOp` beyond validating the two thresholds against it.

## Dependencies

- Depends on shipped WP 4.1 (rules engine), WP 4.2 (windowed rules + preview) and WP 4.3
  (notification centre) — all done.
- ⚠ Shares `RuleEditorDialog.tsx` and `rule-form.ts` with **AM-OB4** (which adds a ratio numerator
  editor) and **AM-OB11** (which adds an action type). All three edit the same fixed-slot action form.
  **Do not batch any two of these three.**
- No dependency on another Phase 6 item's output.

## Migration

**YES, for part 3 only — and it is avoidable.**

Parts 1, 2 and 4 need **no migration**: the dual threshold and the no-data policy fit inside the
existing `window_json` blob (`schema.ts:835`, parsed as `WatchWindowConfig` at
`repository.ts:294-296`), and an on-terminal notification budget can ride in `actions_json` or beside
it in the same blob. Part 3's `paused_until` is a genuine new column on `watch_rules`.

Therefore: **if the batch already has a migration-bearing WP in flight (AM-OB6 is the expected one),
either sequence this after it, or split part 3 out and ship parts 1/2/4 with a zero-line DB diff.**
Splitting is the recommended move — the NO_DATA fix is the most valuable part of this item and should
not wait behind a pause button.

If part 3 is taken: verify the next free `user_version` at claim time against
`apps/api/src/db/database.ts` `MIGRATIONS` **and** sibling ledgers, record the claim in the RM-17
decision log, use the `ensureColumn` + `tableExists` pattern with the column appended to the end of the
`schema.ts` baseline list, and test fresh-DB and upgrade paths. Also re-verify whether
`watch_rule_events.action` is CHECK-constrained (part 2's marker).

## Acceptance

1. A rule can carry a WARNING threshold below its ALERT threshold; crossing only WARNING produces a
   notification at the lower severity, crossing ALERT produces the higher one, and zod rejects a
   WARNING that is more severe than the ALERT for the configured `op`.
2. **The recovery bug is fixed, and the test proves it against today's code.** A rule that is firing,
   whose next window contains **zero runs**, does **not** emit `window_recover` and does **not**
   silently re-arm under the default policy. Write this test first and watch it fail on the current
   `engine.ts:420` before fixing.
3. Each of the three no-data policies behaves as named, and the default is the one that neither fires
   nor recovers.
4. The historical preview distinguishes "no data" from "healthy" in its returned points, so an
   operator consulting it before saving (conventions §11) is not misled.
5. A paused rule still evaluates and records its state, but dispatches no actions; the pause expires on
   its own with no sweep; pause is visibly distinct from disabled in the rules list.
6. An on-terminal rule matching 50 runs in quick succession produces a bounded number of
   notifications, not 50 — asserted by test.
7. Existing rules keep behaving identically: a rule with no WARNING, no no-data policy and no pause
   evaluates byte-identically to today apart from criterion 2's corrected empty-window handling, which
   is a deliberate behaviour change and must be called out in the ledger.
8. Migration (if part 3 is in scope): claim recorded in the decision log; fresh-DB and upgrade paths
   both tested; every moved `LATEST_SCHEMA_VERSION` literal updated without weakening an assertion.
   If part 3 is split out, `apps/api/src/db/**` is a zero-line diff.
9. Both themes and a keyboard pass over the editor's new threshold/policy fields and the pause control
   — or recorded as an owner-acceptance line rather than claimed.
10. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
