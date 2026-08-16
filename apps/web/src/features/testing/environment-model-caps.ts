import type { ProviderKind, TokenProfileRef } from "@mcp-token-footprint/shared";

/**
 * Model-capability heuristics + copy for the Environment editor's dependent controls (WP 2.7 · F3 /
 * S19). These are best-effort classifiers over the provider kind + model id — the app has no
 * authoritative per-model capability flag exposed to the web, so (like the run engine's own
 * deferred-eligibility check) they mirror engine behavior by id pattern. Being pure + framework-free,
 * they are unit-tested in `environment-model-caps.test.ts`.
 *
 * Bias: when a capability is genuinely unknowable from the id (a local/compat model), we stay
 * PERMISSIVE (show the control) rather than hide a control a valid model needs.
 */

/**
 * Whether the model exposes a reasoning-effort control. Reasoning effort is meaningless on classic
 * chat models (gpt-4o, gemini-1.5, Claude Haiku), so the editor disables the control there.
 *
 * - anthropic: extended thinking on modern Claude; Haiku doesn't expose it.
 * - openai: the o-series (o1/o3/o4) and GPT-5 reasoning family; classic gpt-4o/gpt-4.1 ignore it.
 * - google: Gemini 2.5+ "thinking" models.
 * - openai_compatible / ollama: unknowable (deepseek-r1, qwq, …) — stay permissive.
 * - no provider chosen yet: permissive (don't pre-disable before a credential is picked).
 */
export function modelSupportsReasoning(kind: ProviderKind | undefined, modelId: string): boolean {
  if (!kind) return true;
  const id = modelId.toLowerCase();
  switch (kind) {
    case "anthropic":
      return !/haiku/.test(id);
    case "openai":
      return /^o[1345]\b|^o[1345]-|gpt-5|reasoning/.test(id);
    case "google":
      return /2\.5|thinking/.test(id);
    case "openai_compatible":
    case "ollama":
      return true;
    default:
      return true;
  }
}

/**
 * Whether the model can run `deferred` tool loading (Anthropic tool search). Mirrors the run
 * engine's `registry.supportsToolSearch` exactly: Anthropic, non-Haiku. Anything else falls back to
 * eager at run time, so the editor disables the Deferred segment for it (enforcing the caption's own
 * "Anthropic (non-Haiku) only" rule instead of leaving it a run-time surprise).
 */
export function modelSupportsDeferred(kind: ProviderKind | undefined, modelId: string): boolean {
  return kind === "anthropic" && !/haiku/i.test(modelId);
}

/**
 * One-line, when-to-use copy for each token-profile chip (F3: "add per-chip tooltip"). Keyed by the
 * `TokenProfileRef` union so it stays exhaustive if a profile is added.
 */
export const TOKEN_PROFILE_META: Record<TokenProfileRef, { title: string; help: string }> = {
  generic_o200k: {
    title: "o200k",
    help: "Real BPE for GPT-4o / GPT-4.1 / o-series (o200k_base). The default, encoding-accurate.",
  },
  generic_cl100k: {
    title: "cl100k",
    help: "Real BPE for the GPT-4 / GPT-3.5 era (cl100k_base).",
  },
  generic_estimate: {
    title: "estimate",
    help: "Offline lexical / byte-ratio heuristic — tokenizer-agnostic approximation, not exact.",
  },
  raw_json_rough: {
    title: "rough",
    help: "Bytes ÷ 4 over the stable-JSON serialization — the roughest lens.",
  },
};
