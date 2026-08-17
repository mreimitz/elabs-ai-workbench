// Unified Sessions — the static capability manifests (roadmap/unified-sessions/, WP1.1, D-US4).
//
// A {@link SessionCapabilities} manifest declares what a run backend CAN DO (live text/reasoning, tool
// calls, a meaningful context window, token/cost fidelity, follow-ups, ask-user, a wait budget). The
// console gates on these facets instead of forking on `providerKind`, so
// a new backend renders correctly with zero new UI branches. Manifests are declared STATICALLY per
// adapter here (one source of truth), then emitted + persisted (`capabilities_json`) by each executor's
// adoption WP (engine WP1.3, subscription WP1.4). They are runtime-VERIFIABLE — if an
// adapter ever observes a downgrade at run time it records that in STATUS (README D-US4); the values
// below are the declared baseline, faithful to research 01 §C3 and the per-WP notes in the plan.

import type {
  ProviderKind,
  SessionCapabilities,
} from "@mcp-token-footprint/shared";

/**
 * The AI-SDK engine (the five chat-completions provider kinds: `anthropic`, `openai`, `google`,
 * `openai_compatible`, `ollama`). Full-fidelity: streams text + raw reasoning, real tool-call steps,
 * meaningful context-window accounting, provider-exact tokens, exactly-billed cost, follow-ups + the
 * `ask_user` tool in interactive mode.
 */
export const ENGINE_SESSION_CAPABILITIES: SessionCapabilities = {
  liveText: true,
  liveReasoning: "raw",
  toolCalls: true,
  contextWindow: true,
  tokens: "exact",
  costBasis: "api_exact",
  followUps: true,
  askUser: true,
};

/**
 * The Claude-subscription child (`claude_subscription`). Streams answer text + real tool-call steps and
 * supports interactive follow-ups, but exposes NO reasoning stream (`liveReasoning:"none"`) and NO
 * context-window figures (`contextWindow:false`); tokens are provider-exact but cost is a subscription
 * REFERENCE estimate, not a metered charge (D-CS8). It does not offer the engine's `ask_user` tool.
 */
export const SUBSCRIPTION_SESSION_CAPABILITIES: SessionCapabilities = {
  liveText: true,
  liveReasoning: "none",
  toolCalls: true,
  contextWindow: false,
  tokens: "exact",
  costBasis: "subscription_reference",
  followUps: true,
  askUser: false,
};

/**
 * The static capability manifest for a provider kind. The five chat-completions kinds share the engine
 * manifest; `claude_subscription` gets its own.
 */
export function capabilitiesForProviderKind(kind: ProviderKind): SessionCapabilities {
  switch (kind) {
    case "claude_subscription":
      return SUBSCRIPTION_SESSION_CAPABILITIES;
    default:
      // anthropic | openai | google | openai_compatible | ollama — the AI-SDK engine.
      return ENGINE_SESSION_CAPABILITIES;
  }
}

