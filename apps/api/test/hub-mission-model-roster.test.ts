// Assistant Hub — the mission model-roster helpers + the "balanced" guard (pure, no provider/API key).
//
// Proves:
//   • `tierForModel` classifies by kind (subscription/ollama) then price, unknown → balanced;
//   • `formatModelRoster` lists every tier, ids verbatim, "(none configured)" for an empty tier;
//   • `normalizePlannedModels` replaces a bare tier label / empty model with the fallback (loudly
//     noted) but leaves a concrete or off-roster id untouched — and co-exists with a "Plan check" note.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { HubMissionPlan, HubPlannedAgent, HubToolGrants } from "@mcp-token-footprint/shared";
import {
  clampGrantsToCatalog,
  clampPlannedCredentials,
  formatModelRoster,
  isStructuredOutputModel,
  normalizePlannedModels,
  notePlanPricingGaps,
  RESERVED_MODEL_TIERS,
  shouldAutoApprove,
  tierForModel,
  type HubRosterModel,
} from "../src/hub/missions/index.js";

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

function plannedAgent(over: Partial<HubPlannedAgent> & { key: string }): HubPlannedAgent {
  return {
    name: over.key,
    systemPrompt: `You are ${over.key}.`,
    model: "gpt-4o",
    toolGrants: EMPTY_GRANTS,
    skillIds: [],
    brief: `Do ${over.key}.`,
    target: `Target ${over.key}`,
    expectedOutcome: "A report.",
    ...over,
  };
}

function planWith(agents: HubPlannedAgent[], rationale?: string): HubMissionPlan {
  return {
    topology: "parallel",
    autonomy: "always_ask",
    agents,
    ...(rationale ? { rationale } : {}),
  };
}

// ── tierForModel ─────────────────────────────────────────────────────────────────────────────────

test("tierForModel: kind wins for subscription/ollama; price derives the rest; unknown → balanced", () => {
  assert.equal(tierForModel("whatever", "claude_subscription"), "zero-cost-heavy");
  assert.equal(tierForModel("llama3.1", "ollama"), "local");
  // Current MODEL_PRICING (outPer1M): opus-4-8 = 25 → frontier; gpt-4o = 10 → balanced; mini = 0.6 → fast.
  assert.equal(tierForModel("claude-opus-4-8", "anthropic"), "frontier");
  assert.equal(tierForModel("gpt-4o", "openai"), "balanced");
  assert.equal(tierForModel("gpt-4o-mini", "openai"), "fast");
  // An unpriced id (e.g. a Qlik-Answers assistant surfaced via an OpenAI-compatible facade) → balanced.
  assert.equal(tierForModel("assistant|mcp-demo|mcp-sales", "openai_compatible"), "balanced");
});

test("RESERVED_MODEL_TIERS is exactly the five routing tiers", () => {
  assert.deepEqual(
    [...RESERVED_MODEL_TIERS].sort(),
    ["balanced", "fast", "frontier", "local", "zero-cost-heavy"],
  );
});

// ── formatModelRoster ──────────────────────────────────────────────────────────────────────────────

test("formatModelRoster lists every tier, ids verbatim, and (none configured) for empties", () => {
  const models: HubRosterModel[] = [
    { modelId: "claude-opus-4-8", kind: "anthropic", tier: "frontier" },
    { modelId: "gpt-4o", kind: "openai", tier: "balanced" },
    { modelId: "assistant|mcp-demo|mcp-sales", kind: "openai_compatible", tier: "balanced" },
  ];
  const text = formatModelRoster(models);
  assert.match(text, /never a tier name/, "the header steers the planner off tier labels");
  assert.match(text, /- frontier: claude-opus-4-8/);
  assert.match(text, /- balanced: gpt-4o, assistant\|mcp-demo\|mcp-sales/);
  assert.match(text, /- fast: \(none configured\)/);
  assert.match(text, /- local: \(none configured\)/);
  assert.match(text, /- zero-cost-heavy: \(none configured\)/);
});

// ── model-identity WP4.2 (D-MI4) — the structured-output predicate reasons about the CREDENTIAL ──────

test("isStructuredOutputModel: a canonical Anthropic id is structured-capable on an API key and NOT on the subscription", () => {
  // The same id both times — only the resolved provider kind differs. The bare-id test cannot see this,
  // which is exactly why a subscription agent used to be handed a `generateObject` extraction call.
  assert.equal(isStructuredOutputModel("claude-sonnet-5"), true, "pre-WP4.2 answer, unchanged");
  assert.equal(isStructuredOutputModel("claude-sonnet-5", "anthropic"), true);
  assert.equal(
    isStructuredOutputModel("claude-sonnet-5", "claude_subscription"),
    false,
    "the Agent-SDK transport has no structured-output mode, whatever the model is called",
  );
  // The original facade case still holds, with or without a kind.
  assert.equal(isStructuredOutputModel("assistant|t|a"), false);
  assert.equal(isStructuredOutputModel("assistant|t|a", "openai_compatible"), false);
});

// ── model-identity WP4.2 (D-MI4, blast-radius row 16) — the planner's vocabulary for a COLLIDING id ──

test("formatModelRoster: a model id served by TWO credentials is annotated with a copyable pin", () => {
  // The canonical collision: the subscription roster deliberately emits Anthropic's own ids (§3 freezes
  // them), so `claude-sonnet-5` names both the metered API model and the subscription one. Before this,
  // the planner saw one bare id twice and had no way to say which it meant.
  const models: HubRosterModel[] = [
    { modelId: "claude-sonnet-5", kind: "anthropic", tier: "balanced", credentialId: "cred-api" },
    {
      modelId: "claude-sonnet-5",
      kind: "claude_subscription",
      tier: "zero-cost-heavy",
      credentialId: "cred-cli",
    },
    // …and a UNIQUELY-named model in the same roster, which must stay bare.
    { modelId: "gpt-4o", kind: "openai", tier: "balanced", credentialId: "cred-openai" },
  ];
  const text = formatModelRoster(models);
  assert.match(text, /- balanced: claude-sonnet-5 \(Anthropic · pin=cred-api\), gpt-4o$/m);
  assert.match(text, /- zero-cost-heavy: claude-sonnet-5 \(Anthropic CLI · pin=cred-cli\)$/m);
  assert.ok(
    !/gpt-4o \(/.test(text),
    "a uniquely-named model is NOT annotated — the pin appears only where the id is ambiguous",
  );
  assert.match(text, /set its\n`providerCredentialId` to the `pin=` value/);
  // The id itself is never namespaced (D-MI1 / §3 — `resolvePrice`/`MODEL_CONTEXT_LIMITS` are exact-key
  // lookups), so the bare id is still copyable verbatim out of the line.
  assert.ok(!text.includes("cred-cli::claude-sonnet-5"), "ids are never composite");
});

test("formatModelRoster: a single-credential roster renders byte-identically to pre-WP4.2", () => {
  const bare: HubRosterModel[] = [
    { modelId: "claude-opus-4-8", kind: "anthropic", tier: "frontier" },
    { modelId: "gpt-4o", kind: "openai", tier: "balanced" },
  ];
  const withCredentials: HubRosterModel[] = [
    { modelId: "claude-opus-4-8", kind: "anthropic", tier: "frontier", credentialId: "cred-a" },
    { modelId: "gpt-4o", kind: "openai", tier: "balanced", credentialId: "cred-b" },
  ];
  assert.equal(
    formatModelRoster(withCredentials),
    formatModelRoster(bare),
    "no collision ⇒ no annotation and no extra instruction line",
  );
  assert.ok(!formatModelRoster(withCredentials).includes("pin="));
});

test("clampPlannedCredentials strips an invented/deleted pin loudly, and leaves a known one alone", () => {
  const plan = planWith([
    plannedAgent({ key: "a", providerCredentialId: "cred-known" }),
    plannedAgent({ key: "b", providerCredentialId: "cred-hallucinated" }),
    plannedAgent({ key: "c" }),
  ]);
  const { plan: next, stripped } = clampPlannedCredentials(plan, new Set(["cred-known"]));
  assert.deepEqual(stripped, ["b"]);
  assert.equal(next.agents[0]?.providerCredentialId, "cred-known", "a known pin is untouched");
  assert.equal(
    next.agents[1]?.providerCredentialId,
    undefined,
    "an unknown pin is dropped, so the agent falls back to the documented heuristic instead of a 409",
  );
  assert.equal(next.agents[2]?.providerCredentialId, undefined, "an unpinned agent is unchanged");
  assert.match(
    next.rationale ?? "",
    /Provider check:.*does not exist/s,
    "the strip is recorded loudly, under its OWN note prefix",
  );
});

test("a Provider-check note co-exists with a Model-check note (three distinct prefixes, no note eats another)", () => {
  // The real propose-path order: normalize (Model check) → credential clamp (Provider check) → grant
  // clamp (Plan check). Each strips only its OWN prior notes, so all three must survive together — a
  // shared prefix here would silently swallow the model-substitution note.
  // model-identity WP6.1 (F12) — the two defects ride SEPARATE agents now. They used to ride one, but
  // normalize's substitution drops a pin authored for a tier label (a tier label names no real model, so
  // its pin cannot be honoured for the substituted one), which left the credential clamp with nothing to
  // strip and no Provider-check note. That is the intended new behaviour — the invented pin never
  // reaches the clamp — so this test now exercises what it always meant to: three prefixes co-existing.
  const raw = planWith([
    plannedAgent({ key: "a", model: "balanced", toolGrants: { servers: { ghost: "all" }, builtins: [] } }),
    plannedAgent({ key: "b", model: "gpt-4o", providerCredentialId: "ghost" }),
  ]);
  const normalized = normalizePlannedModels(raw, "gpt-4o").plan;
  const pinned = clampPlannedCredentials(normalized, new Set(["cred-known"])).plan;
  const { plan: clamped } = clampGrantsToCatalog(pinned, [
    { id: "real", name: "Real", toolCount: 1, capability: "" },
  ]);
  assert.match(clamped.rationale ?? "", /Model check:/, "the model note survives both later clamps");
  assert.match(clamped.rationale ?? "", /Provider check:/, "the provider note survives the grant clamp");
  assert.match(clamped.rationale ?? "", /Plan check:/, "the grant-strip note is present too");
});

test("clampPlannedCredentials: an EMPTY known-id set means 'no roster available', not 'all invented'", () => {
  const plan = planWith([plannedAgent({ key: "a", providerCredentialId: "cred-known" })]);
  const { plan: next, stripped } = clampPlannedCredentials(plan, new Set());
  assert.equal(next, plan, "the plan is returned untouched (same reference)");
  assert.deepEqual(stripped, []);
});

test("clampPlannedCredentials is idempotent (no duplicate note on a second pass)", () => {
  const known = new Set(["cred-known"]);
  const once = clampPlannedCredentials(
    planWith([plannedAgent({ key: "a", providerCredentialId: "ghost" })]),
    known,
  ).plan;
  const twice = clampPlannedCredentials(once, known).plan;
  assert.equal((twice.rationale ?? "").match(/Provider check:/g)?.length ?? 0, 1);
});

// ── normalizePlannedModels (the guard) ─────────────────────────────────────────────────────────────

test("normalizePlannedModels replaces a bare tier label / empty model with the fallback, loudly noted", () => {
  const plan = planWith([
    plannedAgent({ key: "a", model: "balanced" }),
    plannedAgent({ key: "b", model: "" }),
    plannedAgent({ key: "c", model: "FRONTIER" }), // case-insensitive
  ]);
  const { plan: next, replaced } = normalizePlannedModels(plan, "gpt-4o");
  assert.deepEqual(
    next.agents.map((agent) => agent.model),
    ["gpt-4o", "gpt-4o", "gpt-4o"],
    "every tier/empty model is replaced by the session model",
  );
  assert.equal(replaced.length, 3);
  assert.match(next.rationale ?? "", /Model check:/, "the substitution is noted on the plan");
});

test("normalizePlannedModels leaves a concrete or off-roster id untouched (conservative)", () => {
  const plan = planWith([
    plannedAgent({ key: "a", model: "claude-opus-4-8" }),
    plannedAgent({ key: "b", model: "assistant|mcp-demo|mcp-sales" }), // off-roster but a real assignment
  ]);
  const { plan: next, replaced } = normalizePlannedModels(plan, "gpt-4o");
  assert.deepEqual(next.agents.map((a) => a.model), ["claude-opus-4-8", "assistant|mcp-demo|mcp-sales"]);
  assert.equal(replaced.length, 0, "nothing was replaced");
  assert.equal(next, plan, "the plan is returned unchanged (same reference) when no model is bad");
});

test("normalizePlannedModels is idempotent (no duplicate note on a second pass)", () => {
  const once = normalizePlannedModels(planWith([plannedAgent({ key: "a", model: "balanced" })]), "gpt-4o").plan;
  const twice = normalizePlannedModels(once, "gpt-4o").plan;
  const count = (twice.rationale ?? "").match(/Model check:/g)?.length ?? 0;
  assert.equal(count, 1, "the note appears exactly once after two passes");
});

// model-identity WP6.1 (F12) — the substitution carries the PIN with the model. Before this, the safety
// net substituted a subscription-pinned parent's model onto an agent while leaving it unpinned, silently
// re-routing that agent to the metered twin — the same shape as F2, in the guard meant to prevent harm.

test("F12: normalizePlannedModels backfills the parent's PIN alongside the substituted model", () => {
  const plan = planWith([
    plannedAgent({ key: "a", model: "balanced" }),
    plannedAgent({ key: "b", model: "claude-opus-4-8", providerCredentialId: "cred-api" }),
  ]);
  const { plan: next } = normalizePlannedModels(plan, "claude-sonnet-5", "cred-anthropic-cli");
  assert.equal(next.agents[0]!.model, "claude-sonnet-5");
  assert.equal(
    next.agents[0]!.providerCredentialId,
    "cred-anthropic-cli",
    "the substituted model is the PARENT's, so the credential that owns it is the parent's pin",
  );
  assert.equal(
    next.agents[1]!.providerCredentialId,
    "cred-api",
    "an agent whose model was left alone keeps its own pin untouched (conservative)",
  );
});

test("F12: substituting a model DROPS a pin authored for the tier label; an unpinned parent stays unpinned", () => {
  const plan = planWith([plannedAgent({ key: "a", model: "balanced", providerCredentialId: "cred-api" })]);
  // No parent pin: the agent's own pin was chosen for `balanced`, which names no real model, so it
  // cannot be honoured for the substituted one — dropped onto the heuristic, never a wrong credential.
  const unpinnedParent = normalizePlannedModels(plan, "claude-sonnet-5").plan;
  assert.equal(unpinnedParent.agents[0]!.providerCredentialId, undefined);
  // With a parent pin, the parent's wins over the agent's stale one.
  const pinnedParent = normalizePlannedModels(plan, "claude-sonnet-5", "cred-anthropic-cli").plan;
  assert.equal(pinnedParent.agents[0]!.providerCredentialId, "cred-anthropic-cli");
});

// ── model-identity WP6.1 (F6 / D-MI11) — the UNPRICED-BY-DESIGN path ────────────────────────────────
//
// D-MI11 required "an explicit unpriced-by-design path (surfaced as 'not priced', not a silent $0), so
// a cost cap is never silently inert". WP1.3 shipped the price maps but not this half.

test("F6: notePlanPricingGaps names an unpriced agent LOUDLY and reports the gap", () => {
  const plan = planWith([
    plannedAgent({ key: "a", name: "Priced", model: "claude-opus-4-8" }),
    plannedAgent({ key: "b", name: "Unpriced", model: "no-such-model-9000" }),
  ]);
  const { plan: next, unpriced } = notePlanPricingGaps(plan);
  assert.deepEqual(unpriced, ["Unpriced"], "only the model with no pricing entry at all is reported");
  assert.match(next.rationale ?? "", /Price check:/, "the gap is on the plan card, not swallowed");
  assert.match(next.rationale ?? "", /NOT PRICED \(not \$0\)/, "…and says 'not priced', never $0");
  assert.match(next.rationale ?? "", /Unpriced/, "…naming the agent");
});

test("F6: a fully-priced plan is untouched (same reference); an explicit ZERO-price local model is priced", () => {
  const plan = planWith([
    plannedAgent({ key: "a", model: "claude-opus-4-8" }),
    // A local/Ollama model costs 0 BY DESIGN — that is a known price, not a gap (ZERO_PRICE_MODELS).
    plannedAgent({ key: "b", model: "llama3.1" }),
    // A crew-ref's placeholder empty model is backfilled downstream — never reported as unpriced.
    plannedAgent({ key: "c", model: "" }),
  ]);
  const { plan: next, unpriced } = notePlanPricingGaps(plan);
  assert.deepEqual(unpriced, []);
  assert.equal(next, plan, "no gap ⇒ the plan is returned unchanged (same reference)");
});

test("F6: notePlanPricingGaps is idempotent (no duplicate note on a second pass)", () => {
  const plan = planWith([plannedAgent({ key: "a", model: "no-such-model-9000" })]);
  const once = notePlanPricingGaps(plan).plan;
  const twice = notePlanPricingGaps(once).plan;
  assert.equal((twice.rationale ?? "").match(/Price check:/g)?.length ?? 0, 1);
});

test("F6: shouldAutoApprove REFUSES to auto-launch when the cost estimate is known-incomplete", () => {
  const caps = { askAboveAgents: 3, askAboveUsd: 1 };
  // The unpriced agents contribute $0, so the threshold would otherwise sail through — the cap being
  // silently INAPPLICABLE rather than visibly so is exactly the F6 defect.
  assert.equal(shouldAutoApprove("threshold", 1, 0, caps), true, "without the flag: unchanged");
  assert.equal(
    shouldAutoApprove("threshold", 1, 0, caps, { costEstimateComplete: false }),
    false,
    "an incomplete estimate ASKS instead of comparing planned spend against a meaningless $0",
  );
  assert.equal(
    shouldAutoApprove("threshold", 1, 0, caps, { costEstimateComplete: true }),
    true,
    "a complete estimate is unaffected",
  );
  // The other two dials are untouched: `auto` still always launches, `always_ask` never does.
  assert.equal(shouldAutoApprove("auto", 10, 100, caps, { costEstimateComplete: false }), true);
  assert.equal(shouldAutoApprove("always_ask", 1, 0, caps, { costEstimateComplete: true }), false);
});

test("a Model-check note co-exists with a Plan-check note (distinct prefixes; clamp keeps both)", () => {
  // normalize first (adds a "Model check" note), then clampGrantsToCatalog strips + re-adds only its own
  // "Plan check" notes — so BOTH survive.
  const withModelNote = normalizePlannedModels(
    planWith([plannedAgent({ key: "a", model: "balanced", toolGrants: { servers: { ghost: "all" }, builtins: [] } })]),
    "gpt-4o",
  ).plan;
  const { plan: clamped } = clampGrantsToCatalog(withModelNote, [{ id: "real", name: "Real", toolCount: 1, capability: "" }]);
  assert.match(clamped.rationale ?? "", /Model check:/, "the model note survives the grant clamp");
  assert.match(clamped.rationale ?? "", /Plan check:/, "the grant-strip note is present too");
});
