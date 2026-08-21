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
// LEVEL AND SEVERITY ARE INDEPENDENT AXES (owner decision 2026-08-22). The LEVEL (`warn`/`alert`)
// says which threshold a value crossed; the SEVERITY is what the rule's `notify` action was
// configured to send. A warning crossing notifies at the rule's configured severity, exactly as an
// alert crossing does. AM-OB10 originally DEMOTED a `warn` one step down `WATCH_NOTIFY_SEVERITIES`;
// the owner overturned that — an operator who set a rule to `critical` meant it, and a notification
// that quietly arrives as `warning` is one the author never asked for and cannot see they lost. The
// level still rides on the event and the audit row, so a warn is still distinguishable from an
// alert, and a warn→alert escalation still re-fires through an active cooldown.

import { WATCH_DEFAULT_NO_DATA_POLICY } from "./constants.js";
import type {
  WatchNoDataPolicy,
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

// There is deliberately NO severity-resolution function here any more. A `notify` action's severity
// is whatever the rule configured, for every crossing level — see the header. Resolving it through a
// helper would only invite the demotion back.

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
