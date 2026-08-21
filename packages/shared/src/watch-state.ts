// Observability — watch-rule severity / state semantics (RM-17 Phase 6, AM-OB10).
//
// The PURE decision layer shared by the API evaluator (`apps/api/src/watch/engine.ts`), the wire
// validation (`schemas.ts`) and the web editor (`apps/web/src/features/watch/*`). Nothing here
// touches the database, the clock (every function takes `nowMs`), or a network. Three questions:
//
//   1. WHICH LEVEL did a value cross — the optional WARNING threshold, the ALERT threshold, or
//      neither ({@link scoreWatchWindowValue})?
//   2. WHAT does an EMPTY window mean for this rule ({@link resolveNoDataPolicy}) — and what state
//      does the window therefore end in ({@link watchWindowState})?
//   3. Is this rule PAUSED right now ({@link isWatchRulePaused})?
//
// The one non-obvious rule: a `warn` crossing does NOT introduce a second severity vocabulary. It
// DEMOTES the `notify` action's configured severity by one step in `WATCH_NOTIFY_SEVERITIES`
// ({@link demoteNotifySeverity}), floored at `info` — so "critical when it's bad, warning when it's
// getting bad" is expressible with the vocabulary that already exists.

import { WATCH_DEFAULT_NO_DATA_POLICY, WATCH_NOTIFY_SEVERITIES } from "./constants.js";
import type {
  WatchNoDataPolicy,
  WatchNotifySeverity,
  WatchRule,
  WatchWindowConfig,
  WatchWindowLevel,
  WatchWindowOp,
  WatchWindowState,
} from "./types.js";

/** The no-data policy a config resolves to. An absent policy is `hold` — NOT the pre-AM-OB10
 *  "an empty window is a recovery" behaviour, which is now the explicit `ok` opt-in. */
export function resolveNoDataPolicy(
  config: Pick<WatchWindowConfig, "noData"> | undefined,
): WatchNoDataPolicy {
  return config?.noData ?? WATCH_DEFAULT_NO_DATA_POLICY;
}

/** True when `value op threshold` holds — the shipped breach test, extracted so the warn and alert
 *  thresholds are compared by exactly the same code. */
export function crossesThreshold(value: number, op: WatchWindowOp, threshold: number): boolean {
  return op === ">=" ? value >= threshold : value <= threshold;
}

/**
 * The MOST SEVERE level `value` reached, or `null` for neither. `alert` always wins: a value past
 * the alert threshold is also past the (less severe) warning one, and reporting the lower of the two
 * would understate the problem.
 */
export function scoreWatchWindowValue(
  value: number,
  config: Pick<WatchWindowConfig, "op" | "threshold" | "warnThreshold">,
): WatchWindowLevel | null {
  if (crossesThreshold(value, config.op, config.threshold)) return "alert";
  if (
    config.warnThreshold !== undefined &&
    crossesThreshold(value, config.op, config.warnThreshold)
  ) {
    return "warn";
  }
  return null;
}

/**
 * The state ONE scored window ends in. `n === 0` (nothing ran) is `no_data` — a first-class outcome,
 * never collapsed into `ok`. `value === null` with a non-zero `n` cannot happen through the metrics
 * service, but is treated as `no_data` too rather than fabricating a crossing from nothing.
 */
export function watchWindowState(
  value: number | null,
  n: number,
  config: Pick<WatchWindowConfig, "op" | "threshold" | "warnThreshold">,
): WatchWindowState {
  if (n <= 0 || value === null) return "no_data";
  return scoreWatchWindowValue(value, config) ?? "ok";
}

/**
 * Whether a window in this state would DISPATCH the rule's actions, ignoring arm/cooldown state.
 * A `no_data` window dispatches only under the `notify` policy — that is the whole point of the
 * policy, and the reason `hold` (the default) can neither fire nor recover.
 */
export function watchWindowStateFires(state: WatchWindowState, policy: WatchNoDataPolicy): boolean {
  if (state === "no_data") return policy === "notify";
  return state === "warn" || state === "alert";
}

/** One step DOWN the existing severity ladder (`critical` → `warning` → `info`), floored at `info`.
 *  This is how a WARNING crossing is expressed without inventing a second vocabulary (AM-OB10). */
export function demoteNotifySeverity(severity: WatchNotifySeverity): WatchNotifySeverity {
  const index = WATCH_NOTIFY_SEVERITIES.indexOf(severity);
  const floor = WATCH_NOTIFY_SEVERITIES[0] as WatchNotifySeverity;
  if (index <= 0) return floor;
  return (WATCH_NOTIFY_SEVERITIES[index - 1] ?? floor) as WatchNotifySeverity;
}

/** The severity a `notify` action carries for a crossing at `level`: the configured one for an
 *  `alert`, one step down for a `warn`. A fire with no level (a single-threshold rule, or a
 *  no-data fire) keeps the configured severity. */
export function notifySeverityForLevel(
  configured: WatchNotifySeverity,
  level: WatchWindowLevel | undefined,
): WatchNotifySeverity {
  return level === "warn" ? demoteNotifySeverity(configured) : configured;
}

/** Whether a rule is paused AT `nowMs`. A pause is a timestamp, so it expires on its own — an
 *  unparseable or past `pausedUntil` simply resolves to "not paused" (no sweep, nothing to unstick). */
export function isWatchRulePaused(rule: Pick<WatchRule, "pausedUntil">, nowMs: number): boolean {
  if (rule.pausedUntil === undefined) return false;
  const until = Date.parse(rule.pausedUntil);
  return Number.isFinite(until) && until > nowMs;
}

export type WatchThresholdValidation = { ok: true } | { ok: false; message: string };

/**
 * A WARNING threshold must be STRICTLY LESS SEVERE than the ALERT one for the configured `op`:
 * `>=` (higher is worse) → warn must be BELOW alert; `<=` (lower is worse) → warn must be ABOVE it.
 * A warning that is equally or more severe than the alert can never fire at `warn` — it is a footgun,
 * so it is a validation error on the wire AND in the editor, not a silently-dead field.
 */
export function validateWatchThresholds(
  config: Pick<WatchWindowConfig, "op" | "threshold" | "warnThreshold">,
): WatchThresholdValidation {
  const { warnThreshold } = config;
  if (warnThreshold === undefined) return { ok: true };
  if (config.op === ">=") {
    return warnThreshold < config.threshold
      ? { ok: true }
      : {
          ok: false,
          message: `The warning threshold must be below the alert threshold for '>=' (got warning ${warnThreshold}, alert ${config.threshold}).`,
        };
  }
  return warnThreshold > config.threshold
    ? { ok: true }
    : {
        ok: false,
        message: `The warning threshold must be above the alert threshold for '<=' (got warning ${warnThreshold}, alert ${config.threshold}).`,
      };
}
