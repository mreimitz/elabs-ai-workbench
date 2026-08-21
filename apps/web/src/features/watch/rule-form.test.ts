import { describe, expect, test } from "vitest";
import type { WatchRule } from "@mcp-token-footprint/shared";
import {
  actionsFormToInput,
  actionsToFormState,
  bucketForWindow,
  emptyActionFormState,
  emptyRuleFormState,
  ruleToDuplicateFormState,
  ruleToFormState,
  stripWebhookForDuplicate,
  toWatchRuleInput,
  toWatchRulePatch,
  validateActions,
  windowForWire,
} from "./rule-form";

describe("bucketForWindow", () => {
  test("1h -> hour", () => expect(bucketForWindow("1h")).toBe("hour"));
  test("6h -> day", () => expect(bucketForWindow("6h")).toBe("day"));
  test("24h -> day", () => expect(bucketForWindow("24h")).toBe("day"));
  test("7d -> week", () => expect(bucketForWindow("7d")).toBe("week"));
});

describe("validateActions", () => {
  test("rejects an all-disabled checklist", () => {
    expect(validateActions(emptyActionFormState())).toEqual({
      ok: false,
      message: "Enable at least one action.",
    });
  });

  test("rejects an enabled webhook with no URL", () => {
    const state = emptyActionFormState();
    state.webhook = { enabled: true, url: "", template: "", hasSavedSecret: false };
    const result = validateActions(state);
    expect(result.ok).toBe(false);
  });

  test("accepts an enabled webhook with a URL", () => {
    const state = emptyActionFormState();
    state.webhook = { enabled: true, url: "https://example.com/hook", template: "", hasSavedSecret: false };
    expect(validateActions(state)).toEqual({ ok: true });
  });

  test("accepts a single enabled pin action", () => {
    const state = emptyActionFormState();
    state.pin = { enabled: true };
    expect(validateActions(state)).toEqual({ ok: true });
  });
});

describe("actionsFormToInput", () => {
  test("builds only enabled actions, trims optional fields to omitted when blank", () => {
    const state = emptyActionFormState();
    state.pin = { enabled: true };
    state.notify = { enabled: true, severity: "critical", template: "  " };
    const out = actionsFormToInput(state);
    expect(out).toEqual([
      { type: "notify", severity: "critical" },
      { type: "pin" },
    ]);
  });

  test("includes a non-blank template", () => {
    const state = emptyActionFormState();
    state.notify = { enabled: true, severity: "info", template: "hello" };
    expect(actionsFormToInput(state)).toEqual([{ type: "notify", severity: "info", template: "hello" }]);
  });

  test("webhook carries the plaintext url", () => {
    const state = emptyActionFormState();
    state.webhook = { enabled: true, url: " https://hooks.example/x ", template: "", hasSavedSecret: false };
    expect(actionsFormToInput(state)).toEqual([{ type: "webhook", url: "https://hooks.example/x" }]);
  });
});

describe("actionsToFormState / round-trip", () => {
  test("a webhook action never carries its URL into the form (write-only)", () => {
    const state = actionsToFormState([{ type: "webhook", secretRef: "ref-1", template: "tmpl" }]);
    expect(state.webhook).toEqual({ enabled: true, url: "", template: "tmpl", hasSavedSecret: true });
  });

  test("projects every action type onto its own slot", () => {
    const state = actionsToFormState([
      { type: "pin" },
      { type: "add_to_collection", collectionId: "col-1" },
      { type: "promote_to_test", collectionId: "col-2" },
      { type: "run_grader", graderId: "rouge1" },
    ]);
    expect(state.pin.enabled).toBe(true);
    expect(state.add_to_collection).toEqual({ enabled: true, collectionId: "col-1" });
    expect(state.promote_to_test).toEqual({ enabled: true, collectionId: "col-2" });
    expect(state.run_grader).toEqual({ enabled: true, graderId: "rouge1" });
    expect(state.notify.enabled).toBe(false);
    expect(state.webhook.enabled).toBe(false);
  });
});

describe("stripWebhookForDuplicate / ruleToDuplicateFormState", () => {
  test("drops a saved webhook secret on duplicate, keeps the template", () => {
    const state = actionsToFormState([{ type: "webhook", secretRef: "ref-1", template: "tmpl" }]);
    const stripped = stripWebhookForDuplicate(state);
    expect(stripped.webhook).toEqual({ enabled: false, url: "", template: "tmpl", hasSavedSecret: false });
  });

  test("ruleToDuplicateFormState prefixes the name and strips webhook", () => {
    const rule: WatchRule = {
      id: "rule-1",
      name: "High error rate",
      enabled: true,
      trigger: "on_terminal",
      filter: { outcome: ["error"] },
      actions: [{ type: "webhook", secretRef: "ref-1" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const draft = ruleToDuplicateFormState(rule);
    expect(draft.name).toBe("Copy of High error rate");
    expect(draft.actions.webhook.enabled).toBe(false);
    expect(draft.filter).toEqual({ outcome: ["error"] });
  });
});

describe("ruleToFormState", () => {
  test("samplePercent derives from `sample` (absent -> 100)", () => {
    const base: WatchRule = {
      id: "rule-1",
      name: "n",
      enabled: true,
      trigger: "on_terminal",
      filter: {},
      actions: [{ type: "pin" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    expect(ruleToFormState(base).samplePercent).toBe(100);
    expect(ruleToFormState({ ...base, sample: 0.25 }).samplePercent).toBe(25);
  });

  test("windowed rule carries its window config; on_terminal rule gets a default draft window", () => {
    const windowed: WatchRule = {
      id: "rule-2",
      name: "n",
      enabled: true,
      trigger: "windowed",
      filter: {},
      window: {
        measure: "errorRate",
        bucket: "hour",
        window: "1h",
        op: ">=",
        threshold: 0.5,
        cooldownMinutes: 30,
      },
      actions: [{ type: "notify", severity: "warning" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    expect(ruleToFormState(windowed).window.threshold).toBe(0.5);
    const onTerminal: WatchRule = { ...windowed, id: "rule-3", trigger: "on_terminal", window: undefined };
    expect(ruleToFormState(onTerminal).window).toBeDefined();
  });
});

describe("toWatchRuleInput", () => {
  test("on_terminal at 100% omits `sample` and `window`", () => {
    const state = emptyRuleFormState();
    state.name = "  My rule  ";
    state.actions.pin = { enabled: true };
    const input = toWatchRuleInput(state);
    expect(input.name).toBe("My rule");
    expect(input.sample).toBeUndefined();
    expect(input.window).toBeUndefined();
    expect(input.trigger).toBe("on_terminal");
  });

  test("on_terminal below 100% includes a normalized `sample`", () => {
    const state = emptyRuleFormState();
    state.actions.pin = { enabled: true };
    state.samplePercent = 10;
    expect(toWatchRuleInput(state).sample).toBeCloseTo(0.1);
  });

  test("windowed includes a derived-bucket window and no sample", () => {
    const state = emptyRuleFormState();
    state.trigger = "windowed";
    state.window = { ...state.window, window: "7d" };
    state.actions.notify = { enabled: true, severity: "info", template: "" };
    const input = toWatchRuleInput(state);
    expect(input.window?.bucket).toBe("week");
    expect(input.sample).toBeUndefined();
  });
});

describe("toWatchRulePatch", () => {
  test("omits `actions` when the Actions step was never touched (preserves the stored webhook secret)", () => {
    const state = emptyRuleFormState();
    state.name = "n";
    const patch = toWatchRulePatch(state, false);
    expect(patch.actions).toBeUndefined();
  });

  test("includes `actions` once the Actions step is touched", () => {
    const state = emptyRuleFormState();
    state.actions.pin = { enabled: true };
    const patch = toWatchRulePatch(state, true);
    expect(patch.actions).toEqual([{ type: "pin" }]);
  });

  test("windowed patch carries a derived-bucket window", () => {
    const state = emptyRuleFormState();
    state.trigger = "windowed";
    state.window = { ...state.window, window: "6h" };
    const patch = toWatchRulePatch(state, false);
    expect(patch.window?.bucket).toBe("day");
  });
});

// ── RM-17 Phase 6 · AM-OB10 ──────────────────────────────────────────────────────────────────────

describe("AM-OB10 — the new fields round-trip without changing an existing rule", () => {
  test("a new draft is a single-threshold rule with no warning, no policy and no interval", () => {
    const state = emptyRuleFormState();
    expect(state.window.warnThreshold).toBeUndefined();
    expect(state.window.noData).toBeUndefined();
    expect(state.minIntervalMinutes).toBe(0);

    const input = toWatchRuleInput({ ...state, name: "n" });
    expect(input.minIntervalMinutes).toBeUndefined();
  });

  test("an on-terminal interval reaches the wire, and 0 keeps it off", () => {
    const state = { ...emptyRuleFormState(), name: "n", minIntervalMinutes: 30 };
    expect(toWatchRuleInput(state).minIntervalMinutes).toBe(30);
    expect(toWatchRuleInput({ ...state, minIntervalMinutes: 0 }).minIntervalMinutes).toBeUndefined();
  });

  test("the interval is an on_terminal concept — a windowed rule never sends one", () => {
    const state = { ...emptyRuleFormState(), name: "n", trigger: "windowed" as const, minIntervalMinutes: 30 };
    expect(toWatchRuleInput(state).minIntervalMinutes).toBeUndefined();
    // The PATCH always carries the field so an interval can be CLEARED; a windowed rule sends 0.
    expect(toWatchRulePatch(state, false).minIntervalMinutes).toBe(0);
  });

  test("a stored rule's pause, interval, warning threshold and policy all load into the form", () => {
    const rule: WatchRule = {
      id: "r",
      name: "R",
      enabled: true,
      trigger: "windowed",
      filter: {},
      minIntervalMinutes: 45,
      pausedUntil: "2099-01-01T00:00:00.000Z",
      window: {
        measure: "errorRate",
        bucket: "hour",
        window: "1h",
        op: ">=",
        threshold: 0.6,
        warnThreshold: 0.2,
        noData: "notify",
        cooldownMinutes: 60,
      },
      actions: [{ type: "pin" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const state = ruleToFormState(rule);
    expect(state.minIntervalMinutes).toBe(45);
    expect(state.window.warnThreshold).toBe(0.2);
    expect(state.window.noData).toBe("notify");
    // `pausedUntil` is deliberately NOT a form field — pausing is a row action, not an edit, so the
    // editor can never silently re-pause or resume a rule as a side effect of saving something else.
    expect(toWatchRulePatch(state, false).pausedUntil).toBeUndefined();
    expect(toWatchRuleInput(state).window?.warnThreshold).toBe(0.2);
    expect(toWatchRuleInput(state).window?.noData).toBe("notify");
  });
});

// ═══ AM-OB11 — the workflow_dispatch slot ════════════════════════════════════════════════════════

describe("workflow_dispatch form state (AM-OB11)", () => {
  const target = {
    owner: "acme-labs",
    repo: "workbench",
    workflow: "nightly.yml",
    ref: "main",
  } as const;

  test("a NEW rule ships the action OFF — the one action that spends money is quiet by default", () => {
    const state = emptyActionFormState();
    expect(state.workflow_dispatch.enabled).toBe(false);
    expect(actionsFormToInput(state)).toEqual([]);
  });

  test("the wire action is built from the slot, dropping blank input rows", () => {
    const state = emptyActionFormState();
    state.workflow_dispatch = {
      enabled: true,
      ...target,
      inputs: [
        { key: "suite_id", value: "s-42" },
        { key: "", value: "" }, // a half-typed row the operator left behind
      ],
    };
    expect(actionsFormToInput(state)).toEqual([
      { type: "workflow_dispatch", ...target, inputs: { suite_id: "s-42" } },
    ]);
  });

  test("no inputs means the field is OMITTED, not sent as an empty object", () => {
    const state = emptyActionFormState();
    state.workflow_dispatch = { enabled: true, ...target, inputs: [] };
    expect(actionsFormToInput(state)).toEqual([{ type: "workflow_dispatch", ...target }]);
  });

  test("a persisted action projects back onto the slot in full — nothing is write-only here", () => {
    const state = actionsToFormState([
      { type: "workflow_dispatch", ...target, inputs: { suite_id: "s-42" } },
    ]);
    expect(state.workflow_dispatch).toEqual({
      enabled: true,
      ...target,
      inputs: [{ key: "suite_id", value: "s-42" }],
    });
  });

  test("a DUPLICATE keeps the target (unlike a webhook, there is no secret to lose)", () => {
    const rule: WatchRule = {
      id: "r",
      name: "Regression → CI",
      enabled: true,
      trigger: "on_terminal",
      filter: {},
      actions: [
        { type: "webhook", secretRef: "ref-1" },
        { type: "workflow_dispatch", ...target },
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const copy = ruleToDuplicateFormState(rule);
    expect(copy.actions.webhook.enabled).toBe(false);
    expect(copy.actions.workflow_dispatch.enabled).toBe(true);
    expect(copy.actions.workflow_dispatch.owner).toBe("acme-labs");
  });

  test("validateActions refuses a target the API would refuse, using the SAME validator", () => {
    const state = emptyActionFormState();
    state.workflow_dispatch = {
      enabled: true,
      ...target,
      repo: "acme-labs/workbench", // an extra URL path segment
      inputs: [],
    };
    const result = validateActions(state);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/not an owner\/repo pair or a URL/);
  });

  test("validateActions passes a good target", () => {
    const state = emptyActionFormState();
    state.workflow_dispatch = { enabled: true, ...target, inputs: [] };
    expect(validateActions(state)).toEqual({ ok: true });
  });
});

// == AM-OB4 -- `windowForWire`, the one projection Save AND the preview both use ====================

describe("windowForWire", () => {
  const base = {
    bucket: "week" as const, // deliberately WRONG for the duration below -- it must be re-derived
    window: "1h" as const,
    op: ">=" as const,
    threshold: 0.5,
    cooldownMinutes: 0,
  };

  test("re-derives the bucket from the duration rather than trusting the draft", () => {
    expect(windowForWire({ ...base, measure: "errorRate" }).bucket).toBe("hour");
  });

  test("carries the ratio when the measure IS a ratio", () => {
    const ratio = { numerator: { hasError: true } };
    expect(windowForWire({ ...base, measure: "ratio", ratio }).ratio).toEqual(ratio);
  });

  test("DROPS a stale ratio draft when the measure is not a ratio", () => {
    // The editor deliberately keeps the draft so an accidental measure toggle does not discard a
    // numerator the operator just built -- but the wire refuses a config the rule does not evaluate,
    // and a reader would take a stale numerator for the rule's meaning.
    const projected = windowForWire({
      ...base,
      measure: "errorRate",
      ratio: { numerator: { hasError: true } },
    });
    expect("ratio" in projected).toBe(false);
  });

  test("a `ratio` measure with NO draft stays absent rather than gaining an empty one", () => {
    const projected = windowForWire({ ...base, measure: "ratio" });
    expect("ratio" in projected).toBe(false);
  });
});

describe("toWatchRuleInput / toWatchRulePatch -- the ratio rides the same projection", () => {
  test("a windowed ratio rule sends its numerator; a non-ratio one sends none", () => {
    const state = emptyRuleFormState();
    state.name = "Share";
    state.trigger = "windowed";
    state.actions.notify.enabled = true;
    state.window = {
      ...state.window,
      measure: "ratio",
      ratio: { numerator: { outcome: ["stopped_guardrail"] } },
    };
    expect(toWatchRuleInput(state).window?.ratio).toEqual({
      numerator: { outcome: ["stopped_guardrail"] },
    });
    expect(toWatchRulePatch(state, true).window?.ratio).toEqual({
      numerator: { outcome: ["stopped_guardrail"] },
    });

    const swapped = { ...state, window: { ...state.window, measure: "errorRate" as const } };
    expect(toWatchRuleInput(swapped).window).not.toHaveProperty("ratio");
    expect(toWatchRulePatch(swapped, true).window).not.toHaveProperty("ratio");
  });
});
