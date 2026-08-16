import { WATCH_ACTION_TYPES } from "@mcp-token-footprint/shared";
import type { WatchAction, WatchRuleEvent, WatchRuleTrigger } from "@mcp-token-footprint/shared";

/**
 * Pure label + fire-stat helpers for the watch-rules list/audit UI (Observability WP4.4). No
 * aggregate "last fired"/"fire count" field exists on {@link WatchRule} — the list derives it
 * client-side from the rule's own audit log ({@link WatchRuleEvent}[], `GET /api/watch-rules/:id/
 * events`, newest-first). Unit-tested directly (no React).
 */

const REAL_ACTION_TYPES = new Set<string>(WATCH_ACTION_TYPES);

/** True for a row that represents an actual action attempt (ok or failed) — excludes the
 *  decision/state markers (`sampled_out`, `window_recover`, `window_catchup`, `test_fire`) that the
 *  audit log also carries but that are not themselves a rule "firing". */
function isFireActionRow(action: string): boolean {
  return REAL_ACTION_TYPES.has(action) || action === "window_fire";
}

export type RuleFireStats = {
  /** How many DISTINCT trigger occurrences produced at least one action row — an on-terminal fire
   *  groups by `runId` (every action for one run shares it); a windowed fire groups by `at` (every
   *  action for one window-end shares the exact same timestamp, incl. the `window_fire` marker
   *  itself), so a multi-action rule is counted once per occurrence, not once per action. */
  fireCount: number;
  /** ISO-8601 timestamp of the most recent fire, or `null` if the rule has never fired. */
  lastFiredAt: string | null;
};

export function deriveRuleFireStats(events: WatchRuleEvent[]): RuleFireStats {
  const fires = events.filter((event) => isFireActionRow(event.action));
  if (fires.length === 0) return { fireCount: 0, lastFiredAt: null };
  const occurrences = new Set(fires.map((event) => event.runId ?? event.at));
  // Events are assumed newest-first (the API's `listEvents` order); fall back to a max-scan so the
  // helper stays correct even if a caller hands it an unsorted array (e.g. a test fixture).
  const lastFiredAt = fires.reduce(
    (latest, event) => (latest === null || event.at > latest ? event.at : latest),
    null as string | null,
  );
  return { fireCount: occurrences.size, lastFiredAt };
}

export function triggerLabel(trigger: WatchRuleTrigger): string {
  return trigger === "on_terminal" ? "On terminal" : "Windowed";
}

const ACTION_LABELS: Record<WatchAction["type"], string> = {
  notify: "Notify",
  pin: "Pin run",
  add_to_collection: "Add to collection",
  promote_to_test: "Promote to test",
  run_grader: "Run grader",
  webhook: "Webhook",
};

export function actionTypeLabel(type: WatchAction["type"]): string {
  return ACTION_LABELS[type];
}

/** A compact "what this rule does" summary for the list row (e.g. "Notify, Webhook"). */
export function actionsSummary(actions: WatchAction[]): string {
  if (actions.length === 0) return "No actions";
  return actions.map((action) => actionTypeLabel(action.type)).join(", ");
}

/** A human label for an audit row's `action` field, including the non-action decision markers. */
export function auditActionLabel(action: string): string {
  switch (action) {
    case "sampled_out":
      return "Sampled out";
    case "window_fire":
      return "Window fired";
    case "window_recover":
      return "Window recovered";
    case "window_catchup":
      return "Boot catch-up";
    case "test_fire":
      return "Test-fire";
    case "error":
      return "Evaluation error";
    default:
      return REAL_ACTION_TYPES.has(action) ? actionTypeLabel(action as WatchAction["type"]) : action;
  }
}
