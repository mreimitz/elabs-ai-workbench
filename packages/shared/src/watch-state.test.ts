// RM-17 Phase 6 (AM-OB10) — the PURE watch-rule severity/state decisions.
//
// These functions are the single definition of "which level did this cross", "what does an empty
// window mean", and "is this rule paused" — shared by the API evaluator, the wire zod and the web
// editor. Pinning them here means the three can never drift apart.

import assert from "node:assert/strict";
import { test } from "node:test";
import { WATCH_DEFAULT_NO_DATA_POLICY, WATCH_NOTIFY_SEVERITIES } from "./constants.js";
import { watchWindowConfigSchema } from "./schemas.js";
import type { WatchWindowConfig } from "./types.js";
import {
  crossesThreshold,
  demoteNotifySeverity,
  isWatchRulePaused,
  notifySeverityForLevel,
  resolveNoDataPolicy,
  scoreWatchWindowValue,
  validateWatchThresholds,
  watchWindowState,
  watchWindowStateFires,
} from "./watch-state.js";

const gte: Pick<WatchWindowConfig, "op" | "threshold" | "warnThreshold"> = {
  op: ">=",
  threshold: 0.3,
  warnThreshold: 0.15,
};
const lte: Pick<WatchWindowConfig, "op" | "threshold" | "warnThreshold"> = {
  op: "<=",
  threshold: 0.5,
  warnThreshold: 0.7,
};

test("scoreWatchWindowValue: the MOST severe crossed level wins, both directions", () => {
  assert.equal(scoreWatchWindowValue(0.05, gte), null, "below both");
  assert.equal(scoreWatchWindowValue(0.15, gte), "warn", "exactly the warn threshold crosses it");
  assert.equal(scoreWatchWindowValue(0.2, gte), "warn", "between warn and alert");
  assert.equal(scoreWatchWindowValue(0.3, gte), "alert", "exactly the alert threshold");
  assert.equal(scoreWatchWindowValue(0.9, gte), "alert", "past alert reports ALERT, never warn");

  assert.equal(scoreWatchWindowValue(0.9, lte), null, "above both for '<='");
  assert.equal(scoreWatchWindowValue(0.7, lte), "warn", "exactly the warn floor");
  assert.equal(scoreWatchWindowValue(0.6, lte), "warn");
  assert.equal(scoreWatchWindowValue(0.4, lte), "alert");
});

test("scoreWatchWindowValue: no warnThreshold behaves exactly like the shipped single threshold", () => {
  const single = { op: ">=" as const, threshold: 0.3 };
  assert.equal(scoreWatchWindowValue(0.29, single), null);
  assert.equal(scoreWatchWindowValue(0.3, single), "alert");
  // The extracted predicate IS the shipped comparison.
  assert.equal(crossesThreshold(0.3, ">=", 0.3), true);
  assert.equal(crossesThreshold(0.3, "<=", 0.3), true);
  assert.equal(crossesThreshold(0.31, "<=", 0.3), false);
});

test("watchWindowState: an EMPTY window is no_data, never ok", () => {
  assert.equal(watchWindowState(null, 0, gte), "no_data", "the defect this WP fixes");
  assert.equal(watchWindowState(0.9, 0, gte), "no_data", "n === 0 wins over any value");
  assert.equal(watchWindowState(null, 5, gte), "no_data", "a null value is never scored");
  assert.equal(watchWindowState(0, 3, gte), "ok");
  assert.equal(watchWindowState(0.2, 3, gte), "warn");
  assert.equal(watchWindowState(0.5, 3, gte), "alert");
});

test("watchWindowStateFires: only the `notify` policy makes an empty window fire", () => {
  assert.equal(watchWindowStateFires("no_data", "hold"), false);
  assert.equal(watchWindowStateFires("no_data", "ok"), false);
  assert.equal(watchWindowStateFires("no_data", "notify"), true);
  for (const policy of ["hold", "ok", "notify"] as const) {
    assert.equal(watchWindowStateFires("ok", policy), false);
    assert.equal(watchWindowStateFires("warn", policy), true);
    assert.equal(watchWindowStateFires("alert", policy), true);
  }
});

test("resolveNoDataPolicy: absent resolves to `hold` — NOT the old treat-as-recovery behaviour", () => {
  assert.equal(WATCH_DEFAULT_NO_DATA_POLICY, "hold");
  assert.equal(resolveNoDataPolicy(undefined), "hold");
  assert.equal(resolveNoDataPolicy({}), "hold");
  assert.equal(resolveNoDataPolicy({ noData: "ok" }), "ok");
  assert.equal(resolveNoDataPolicy({ noData: "notify" }), "notify");
});

test("demoteNotifySeverity: one step down the EXISTING ladder, floored at info", () => {
  assert.deepEqual([...WATCH_NOTIFY_SEVERITIES], ["info", "warning", "critical"]);
  assert.equal(demoteNotifySeverity("critical"), "warning");
  assert.equal(demoteNotifySeverity("warning"), "info");
  assert.equal(demoteNotifySeverity("info"), "info", "the floor never wraps");

  assert.equal(notifySeverityForLevel("critical", "alert"), "critical");
  assert.equal(notifySeverityForLevel("critical", "warn"), "warning");
  assert.equal(notifySeverityForLevel("critical", undefined), "critical", "a no-level fire is as configured");
});

test("isWatchRulePaused: a pause is a timestamp that expires on its own", () => {
  const now = Date.parse("2026-08-21T12:00:00.000Z");
  assert.equal(isWatchRulePaused({}, now), false);
  assert.equal(isWatchRulePaused({ pausedUntil: "2026-08-21T13:00:00.000Z" }, now), true);
  assert.equal(isWatchRulePaused({ pausedUntil: "2026-08-21T11:00:00.000Z" }, now), false, "expired");
  assert.equal(isWatchRulePaused({ pausedUntil: "2026-08-21T12:00:00.000Z" }, now), false, "exactly now = over");
  assert.equal(isWatchRulePaused({ pausedUntil: "not-a-date" }, now), false, "garbage never sticks");
});

test("validateWatchThresholds: a warning may never be as severe as its alert", () => {
  assert.deepEqual(validateWatchThresholds({ op: ">=", threshold: 0.3 }), { ok: true });
  assert.deepEqual(validateWatchThresholds(gte), { ok: true });
  assert.deepEqual(validateWatchThresholds(lte), { ok: true });

  const equalGte = validateWatchThresholds({ op: ">=", threshold: 0.3, warnThreshold: 0.3 });
  assert.equal(equalGte.ok, false);
  const strictGte = validateWatchThresholds({ op: ">=", threshold: 0.3, warnThreshold: 0.5 });
  assert.equal(strictGte.ok, false, "a warning ABOVE the alert for '>=' is a footgun");
  const strictLte = validateWatchThresholds({ op: "<=", threshold: 0.5, warnThreshold: 0.4 });
  assert.equal(strictLte.ok, false, "a warning BELOW the alert for '<=' is a footgun");
});

test("watchWindowConfigSchema: accepts the shipped shape, and rejects an inverted warning", () => {
  const base = {
    measure: "errorRate",
    bucket: "hour",
    window: "1h",
    op: ">=",
    threshold: 0.3,
    cooldownMinutes: 60,
  };
  // The pre-AM-OB10 shape still parses byte-identically — no new required field.
  assert.deepEqual(watchWindowConfigSchema.parse(base), base);

  const withWarn = watchWindowConfigSchema.parse({ ...base, warnThreshold: 0.15, noData: "notify" });
  assert.equal(withWarn.warnThreshold, 0.15);
  assert.equal(withWarn.noData, "notify");

  assert.throws(
    () => watchWindowConfigSchema.parse({ ...base, warnThreshold: 0.4 }),
    /warning threshold must be below/i,
    "an inverted warning is a ZodError -> 400, not a silently dead field",
  );
  assert.throws(
    () => watchWindowConfigSchema.parse({ ...base, noData: "shrug" }),
    /invalid/i,
    "the no-data policy vocabulary is closed",
  );
});
