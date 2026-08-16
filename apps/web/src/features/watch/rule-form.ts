import type {
  MetricsBucket,
  RunFilter,
  RunMetricsMeasure,
  WatchAction,
  WatchActionInput,
  WatchNotifySeverity,
  WatchRule,
  WatchRuleInput,
  WatchRulePatch,
  WatchRuleTrigger,
  WatchWindowConfig,
  WatchWindowDuration,
  WatchWindowOp,
} from "@mcp-token-footprint/shared";

/**
 * Pure form<->wire conversions for the watch-rule editor (Observability WP4.4). No React here —
 * unit-tested directly. The editor keeps ONE {@link RuleFormState} regardless of the selected
 * trigger (both a `window` draft AND a `filter` draft always exist) so switching trigger radio
 * never discards work; only the ACTIVE trigger's fields are sent on submit.
 */

/** Every window-duration -> metrics-bucket mapping is DERIVED, never a free field the user picks
 *  (the API's `WatchWindowConfig.bucket` doc: "derived from `window` by the evaluator, echoed here
 *  for transparency" — the wire still carries it, so the UI must compute + send a consistent value
 *  rather than exposing a second, potentially-inconsistent picker). Mirrors
 *  `apps/api/src/watch/engine.ts`'s `metricsBucketForWindow` (read-only reference — not imported;
 *  API internals are out of this WP's reach).
 */
export function bucketForWindow(window: WatchWindowDuration): MetricsBucket {
  switch (window) {
    case "1h":
      return "hour";
    case "6h":
    case "24h":
      return "day";
    case "7d":
      return "week";
    default: {
      const _exhaustive: never = window;
      return _exhaustive;
    }
  }
}

export function defaultWindowConfig(): WatchWindowConfig {
  const window: WatchWindowDuration = "1h";
  return {
    measure: "errorRate" as RunMetricsMeasure,
    bucket: bucketForWindow(window),
    window,
    op: ">=" as WatchWindowOp,
    threshold: 0.3,
    cooldownMinutes: 60,
  };
}

// ── Actions — a FIXED slot per closed action type (a checklist, not a dynamic list) ──────────────

export type ActionFormState = {
  notify: { enabled: boolean; severity: WatchNotifySeverity; template: string };
  pin: { enabled: boolean };
  add_to_collection: { enabled: boolean; collectionId: string };
  promote_to_test: { enabled: boolean; collectionId: string };
  run_grader: { enabled: boolean; graderId: string };
  /** `hasSavedSecret` — true when the loaded rule already has a webhook action (its `secretRef` is
   *  never surfaced here, only the FACT a secret exists); `url` always starts blank on load — a
   *  webhook's target is write-only, never echoed back by the API. */
  webhook: { enabled: boolean; url: string; template: string; hasSavedSecret: boolean };
};

export function emptyActionFormState(): ActionFormState {
  return {
    notify: { enabled: false, severity: "warning", template: "" },
    pin: { enabled: false },
    add_to_collection: { enabled: false, collectionId: "" },
    promote_to_test: { enabled: false, collectionId: "" },
    run_grader: { enabled: false, graderId: "" },
    webhook: { enabled: false, url: "", template: "", hasSavedSecret: false },
  };
}

/** Project a persisted {@link WatchAction} list onto the fixed-slot form state — each present action
 *  type flips `enabled`; a `webhook` action never carries its URL forward (write-only). */
export function actionsToFormState(actions: WatchAction[]): ActionFormState {
  const state = emptyActionFormState();
  for (const action of actions) {
    switch (action.type) {
      case "notify":
        state.notify = { enabled: true, severity: action.severity, template: action.template ?? "" };
        break;
      case "pin":
        state.pin = { enabled: true };
        break;
      case "add_to_collection":
        state.add_to_collection = { enabled: true, collectionId: action.collectionId };
        break;
      case "promote_to_test":
        state.promote_to_test = { enabled: true, collectionId: action.collectionId };
        break;
      case "run_grader":
        state.run_grader = { enabled: true, graderId: action.graderId };
        break;
      case "webhook":
        state.webhook = { enabled: true, url: "", template: action.template ?? "", hasSavedSecret: true };
        break;
      default: {
        const _exhaustive: never = action;
        void _exhaustive;
      }
    }
  }
  return state;
}

/** Drop any webhook action when duplicating a rule (WP4.4 D-OB21 corollary): the source secret can
 *  never be read back, so a copy simply starts with that action off — never silently missing a URL. */
export function stripWebhookForDuplicate(state: ActionFormState): ActionFormState {
  return { ...state, webhook: { enabled: false, url: "", template: state.webhook.template, hasSavedSecret: false } };
}

export type ActionsValidation = { ok: true } | { ok: false; message: string };

/** Client-side pre-check (before ever hitting the API): at least one action must be enabled, and an
 *  enabled webhook needs a URL THIS submission — the wire requires it every time `actions` is sent
 *  (it is never "kept" implicitly within an actions payload; see {@link toWatchRulePatch}'s
 *  `actionsTouched` gate for how an untouched Actions step avoids this entirely). */
export function validateActions(state: ActionFormState): ActionsValidation {
  const enabledCount = (Object.keys(state) as (keyof ActionFormState)[]).filter(
    (key) => state[key].enabled,
  ).length;
  if (enabledCount === 0) return { ok: false, message: "Enable at least one action." };
  if (state.webhook.enabled && state.webhook.url.trim().length === 0) {
    return {
      ok: false,
      message: "Enter the webhook URL — it's never stored in a form this editor can prefill.",
    };
  }
  return { ok: true };
}

/** Build the wire action list from the fixed-slot form state. Assumes {@link validateActions} passed. */
export function actionsFormToInput(state: ActionFormState): WatchActionInput[] {
  const out: WatchActionInput[] = [];
  if (state.notify.enabled) {
    out.push({
      type: "notify",
      severity: state.notify.severity,
      ...(state.notify.template.trim() ? { template: state.notify.template.trim() } : {}),
    });
  }
  if (state.pin.enabled) out.push({ type: "pin" });
  if (state.add_to_collection.enabled) {
    out.push({ type: "add_to_collection", collectionId: state.add_to_collection.collectionId });
  }
  if (state.promote_to_test.enabled) {
    out.push({ type: "promote_to_test", collectionId: state.promote_to_test.collectionId });
  }
  if (state.run_grader.enabled) {
    out.push({ type: "run_grader", graderId: state.run_grader.graderId.trim() });
  }
  if (state.webhook.enabled) {
    out.push({
      type: "webhook",
      url: state.webhook.url.trim(),
      ...(state.webhook.template.trim() ? { template: state.webhook.template.trim() } : {}),
    });
  }
  return out;
}

// ── The editor's whole form state ─────────────────────────────────────────────────────────────

export type RuleFormState = {
  name: string;
  enabled: boolean;
  trigger: WatchRuleTrigger;
  filter: RunFilter;
  /** 0-100, UI-friendly; 100 means "always" (the `sample` field is omitted on submit). Only
   *  meaningful for `on_terminal` (the deterministic per-run sampling the engine applies). */
  samplePercent: number;
  window: WatchWindowConfig;
  actions: ActionFormState;
};

export function emptyRuleFormState(): RuleFormState {
  return {
    name: "",
    enabled: true,
    trigger: "on_terminal",
    filter: {},
    samplePercent: 100,
    window: defaultWindowConfig(),
    actions: emptyActionFormState(),
  };
}

export function ruleToFormState(rule: WatchRule): RuleFormState {
  return {
    name: rule.name,
    enabled: rule.enabled,
    trigger: rule.trigger,
    filter: rule.filter,
    samplePercent: rule.sample !== undefined ? Math.round(rule.sample * 100) : 100,
    window: rule.window ?? defaultWindowConfig(),
    actions: actionsToFormState(rule.actions),
  };
}

/** Duplicate = a fresh unsaved draft copied from `rule`, name prefixed, webhook action dropped
 *  (its secret can never be carried over — {@link stripWebhookForDuplicate}). */
export function ruleToDuplicateFormState(rule: WatchRule): RuleFormState {
  const base = ruleToFormState(rule);
  return { ...base, name: `Copy of ${rule.name}`, actions: stripWebhookForDuplicate(base.actions) };
}

export function toWatchRuleInput(state: RuleFormState): WatchRuleInput {
  const input: WatchRuleInput = {
    name: state.name.trim(),
    enabled: state.enabled,
    trigger: state.trigger,
    filter: state.filter,
    actions: actionsFormToInput(state.actions),
  };
  if (state.trigger === "on_terminal" && state.samplePercent < 100) {
    input.sample = Math.max(0, Math.min(1, state.samplePercent / 100));
  }
  if (state.trigger === "windowed") {
    input.window = { ...state.window, bucket: bucketForWindow(state.window.window) };
  }
  return input;
}

/**
 * Build the PATCH body for an edit. `actionsTouched` gates whether `actions` is included at all —
 * when the Actions step was never opened/edited this submission, `actions` is OMITTED so the
 * server's "an omitted field keeps its stored value" rule preserves the existing webhook secret
 * untouched (re-sending `actions` always ROTATES any webhook secret, per the API contract).
 */
export function toWatchRulePatch(state: RuleFormState, actionsTouched: boolean): WatchRulePatch {
  const patch: WatchRulePatch = {
    name: state.name.trim(),
    enabled: state.enabled,
    trigger: state.trigger,
    filter: state.filter,
  };
  patch.sample = state.trigger === "on_terminal" && state.samplePercent < 100
    ? Math.max(0, Math.min(1, state.samplePercent / 100))
    : undefined;
  if (state.trigger === "windowed") {
    patch.window = { ...state.window, bucket: bucketForWindow(state.window.window) };
  }
  if (actionsTouched) patch.actions = actionsFormToInput(state.actions);
  return patch;
}
