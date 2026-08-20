// Assistant Hub — the mission-planner's MODEL ROSTER (LAYER 8 · D-AH6).
//
// The orchestration prompt (`hub/prompting/layers/orchestration.ts`) routes each planned agent to a
// model TIER (`frontier / balanced / fast / local / zero-cost-heavy`) and is meant to be handed the
// live provider roster, tagged by tier, so it emits a REAL model id — not a tier name. Before this
// was wired, the planner saw only a placeholder and emitted the literal tier label (e.g. `"balanced"`),
// which is not a resolvable model and blew up at turn time ("The model `balanced` does not exist…").
//
// This module is the PURE half: classify a model into a tier and format the roster string. The impure
// half (enumerating the hub-eligible credentials' live models) lives in `index.ts`, where the provider
// store is in scope, and calls in here. The deterministic guard that replaces any leftover tier label
// with the session's model lives in `planner.ts` (`normalizePlannedModels`) and reuses
// {@link RESERVED_MODEL_TIERS} below.

import type { ProviderKind } from "@mcp-token-footprint/shared";
import { providerKindLabel } from "@mcp-token-footprint/shared";
import { resolvePrice } from "../../providers/pricing.js";

/** The five model tiers the orchestration routing contract references (orchestration.ts §Model routing). */
export type HubModelTier = "frontier" | "balanced" | "fast" | "local" | "zero-cost-heavy";

/** Tiers in the order they render in the roster + the routing rules (frontier first). */
export const HUB_MODEL_TIERS: readonly HubModelTier[] = [
  "frontier",
  "balanced",
  "fast",
  "local",
  "zero-cost-heavy",
];

/** The reserved tier LABELS a planner must never emit as a `model` id. The guard
 *  (`normalizePlannedModels`) treats any agent model equal to one of these (case-insensitively) as
 *  "no concrete model" and substitutes the session's model. */
export const RESERVED_MODEL_TIERS: ReadonlySet<string> = new Set<string>(HUB_MODEL_TIERS);

/** One assignable model, tagged with the tier it routes under, in the shape {@link formatModelRoster}
 *  renders. `displayName` is unused in the roster string today (ids are what the planner must emit) but
 *  carried for parity with the wire `AvailableModel`.
 *
 *  **model-identity WP4.2 (blast-radius row 16).** `credentialId` is what gives the planner a vocabulary
 *  for "the subscription Sonnet": the subscription roster deliberately emits Anthropic's CANONICAL ids
 *  (`providers/subscription-models.ts`, frozen by §3 — `resolvePrice`/`MODEL_CONTEXT_LIMITS` are
 *  exact-key lookups), so `claude-sonnet-5` names BOTH an `anthropic` API model and a
 *  `claude_subscription` one. Namespacing the id is the rejected composite-id trap (D-MI1); carrying the
 *  credential ALONGSIDE it is the additive answer, exactly as the wire does. Optional so an existing
 *  caller (or a test) that only knows the id still compiles and renders as it did. */
export type HubRosterModel = {
  modelId: string;
  kind: ProviderKind;
  displayName?: string;
  tier: HubModelTier;
  /** The `provider_credentials` row that owns this entry — the value a planner copies into a planned
   *  agent's `providerCredentialId` when two entries share a model id. */
  credentialId?: string;
};

// Output $/1M-token thresholds for the price-derived tiers (a heuristic, deliberately coarse — the
// guard makes routing SAFE regardless, this only makes it GOOD). Opus-class (~$25) → frontier;
// gpt-4o / haiku-class (~$5–10) → balanced; mini/flash-class (<$3) → fast. An unpriced model (e.g. a
// Acme-Answers assistant or a local OpenAI-compatible endpoint) defaults to `balanced`.
const FRONTIER_OUT_PER_1M = 20;
const FAST_OUT_PER_1M = 3;

/**
 * Classify a model into a routing tier. Kind wins for the two non-price tiers — a signed-in Claude
 * subscription is `zero-cost-heavy` (no metered per-token cost, but serialized), an Ollama model is
 * `local`. Every other kind derives from its output price; an unknown price is `balanced` (the routing
 * rules' "unsure → balanced" default).
 */
export function tierForModel(modelId: string, kind: ProviderKind): HubModelTier {
  if (kind === "claude_subscription") return "zero-cost-heavy";
  if (kind === "ollama") return "local";
  const outPer1M = resolvePrice(modelId)?.outPer1M;
  if (outPer1M === undefined) return "balanced";
  if (outPer1M >= FRONTIER_OUT_PER_1M) return "frontier";
  if (outPer1M < FAST_OUT_PER_1M) return "fast";
  return "balanced";
}

/**
 * hub-fixes (Defect 2) — whether a model supports structured output (`generateObject` / JSON-schema
 * mode). The OpenAI-compatible facade serves Acme-Answers assistants as `assistant|<server>|<assistant>`
 * ids — single-shot assistants with NO structured-output mode — so a mission agent's report-extraction
 * call must not run on such a model (it throws and wrongly fails the agent); the orchestrator projects the
 * agent's prose deterministically instead.
 *
 * **model-identity WP4.2 (D-MI4) — the model id alone can no longer answer this.** A subscription-pinned
 * agent runs on a CANONICAL Anthropic id (`claude-sonnet-5`, frozen by §3), so the old string test
 * reported it structured-output-capable while the executor behind it — the Agent SDK — has no
 * `generateObject` at all. What decides the capability is the resolved credential's KIND, not the name:
 * hence the additive `providerKind`. Absent ⇒ the byte-identical pre-WP4.2 string test, so every existing
 * call site (and every legacy/unpinned mission) behaves exactly as before.
 */
export function isStructuredOutputModel(modelId: string, providerKind?: ProviderKind): boolean {
  // The Agent-SDK subscription transport has no structured-output mode — see the module note above.
  if (providerKind === "claude_subscription") return false;
  return !modelId.startsWith("assistant|");
}

/** A model id together with the credential that owns it — the pair D-MI1 makes authoritative. Used
 *  wherever a mission has to CHOOSE a model (synthesis, the best-of-N judge) so the choice carries its
 *  provider identity to the resolver instead of being re-guessed from the name downstream. */
export type HubModelRef = {
  model: string;
  providerCredentialId?: string;
};

/**
 * assistant-hub v1-fixes (F1 — planning/Roadmap/RM-03-assistant-hub/mission-session-analysis-2026-07-20.md) — pick the
 * model for the mission SYNTHESIS turn. The synthesizer's whole instruction (reports digest + numbered
 * sources) rides the SYSTEM prompt, so the model must actually receive system prompts — an `assistant|…`
 * facade model does not (single-shot Q&A; the observed failure was a "synthesis" generated from the bare
 * ask, blind to every report). Preference: explicit override → the parent session's model → the first
 * structured-capable plan model → (last resort) the session model anyway, where `synthesizeMission`'s
 * deterministic fallback still yields an honest report-derived answer.
 *
 * **model-identity WP4.2 (D-MI4).** Now picks a {@link HubModelRef}, not a bare id, so the chosen model's
 * CREDENTIAL travels with it into `runSynthesisTurn` (which resolves `providerCredentialId` first, then
 * the parent session's pin) — a plan model borrowed for synthesis must not be re-guessed from its name.
 * `isStructured` is injected so the caller can supply the credential-aware predicate; absent ⇒ the bare
 * id test, i.e. pre-WP4.2 behaviour. An explicit `override` (env `HUB_MISSION_SYNTHESIS_MODEL`) is a bare
 * id by construction and therefore carries no credential — deliberately unchanged.
 */
export function pickSynthesisModel(args: {
  session: HubModelRef;
  planModels: readonly HubModelRef[];
  override?: string;
  isStructured?: (ref: HubModelRef) => boolean;
}): HubModelRef {
  const override = args.override?.trim();
  if (override) return { model: override };
  const isStructured = args.isStructured ?? ((ref: HubModelRef) => isStructuredOutputModel(ref.model));
  if (isStructured(args.session)) return args.session;
  return args.planModels.find((ref) => isStructured(ref)) ?? args.session;
}

/** Cap the ids listed per tier so a large roster can't blow the LAYER-8 budget; the remainder is
 *  summarized ("+N"). */
const MAX_MODELS_PER_TIER = 12;

/**
 * Render the tier-tagged roster the orchestration layer injects (its `{{MODEL_ROSTER}}` slot). Every
 * tier is listed — an empty one shows `(none configured)` so the routing rules that name `local` /
 * `zero-cost-heavy` stay meaningful (rule 5: "if no local model is configured, say so"). Ids are shown
 * VERBATIM because the planner must copy one into an agent's `model`.
 *
 * **model-identity WP4.2 (blast-radius row 16) — COLLIDING ids get a pin.** When the same model id
 * appears under more than one credential (the canonical case: `claude-sonnet-5` served by both an
 * Anthropic API key and the Anthropic CLI subscription), the id ALONE cannot express which one the
 * planner meant, and the resolver's name heuristic structurally cannot recover it (README §1). Those —
 * and only those — entries are annotated `id (Provider · pin=<credentialId>)`, and one extra
 * instruction line tells the planner to copy the pin into the agent's `providerCredentialId`. A
 * uniquely-named model is left byte-identical, so a single-credential install's roster string does not
 * change at all. Ids themselves are NEVER namespaced (D-MI1/§3 — `resolvePrice`/`MODEL_CONTEXT_LIMITS`
 * are exact-key lookups).
 *
 * A pin the planner invents is stripped server-side (`clampPlannedCredentials`) — the same
 * hallucination posture `clampGrantsToCatalog` applies to server ids.
 */
export function formatModelRoster(models: readonly HubRosterModel[]): string {
  // Which ids are ambiguous? Only an id served by ≥2 DISTINCT credentials needs a pin.
  const credentialsPerId = new Map<string, Set<string>>();
  for (const model of models) {
    if (!model.credentialId) continue;
    const seen = credentialsPerId.get(model.modelId) ?? new Set<string>();
    seen.add(model.credentialId);
    credentialsPerId.set(model.modelId, seen);
  }
  const ambiguous = (modelId: string): boolean => (credentialsPerId.get(modelId)?.size ?? 0) > 1;
  const anyAmbiguous = models.some((model) => ambiguous(model.modelId));

  const byTier = new Map<HubModelTier, string[]>();
  for (const tier of HUB_MODEL_TIERS) byTier.set(tier, []);
  for (const model of models) {
    // The FULL registry label (D-MI6), never `shortLabel`: the subscription's short form is bare "CLI",
    // which D-MI5 itself flags as colliding with the Auto-Rating "Claude CLI judge" — an ambiguity that
    // has no place in a prompt whose entire job is disambiguation.
    const label =
      model.credentialId && ambiguous(model.modelId)
        ? `${model.modelId} (${providerKindLabel(model.kind)} · pin=${model.credentialId})`
        : model.modelId;
    byTier.get(model.tier)?.push(label);
  }

  const lines = HUB_MODEL_TIERS.map((tier) => {
    const ids = byTier.get(tier) ?? [];
    if (ids.length === 0) return `- ${tier}: (none configured)`;
    const shown = ids.slice(0, MAX_MODELS_PER_TIER);
    const more = ids.length > shown.length ? `, … (+${ids.length - shown.length} more)` : "";
    return `- ${tier}: ${shown.join(", ")}${more}`;
  });

  const pinNote = anyAmbiguous
    ? [
        "",
        "Some model ids are served by MORE THAN ONE provider and are shown as `id (Provider · pin=<credentialId>)`.",
        "For those, set the agent's `model` to the bare id (never the annotated form) AND set its",
        "`providerCredentialId` to the `pin=` value, so the agent runs on the provider you chose.",
      ].join("\n")
    : "";

  return `Assignable models by tier — set each agent's \`model\` to a model id EXACTLY as written here (never a tier name):
${lines.join("\n")}${pinNote}`;
}
