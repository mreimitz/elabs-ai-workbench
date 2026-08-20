// Assistant Hub (planning/Roadmap/RM-03-assistant-hub/, WP1.1, §1.5 / D-AH3 / D-AH4 / D-US4) — the hub's capability
// manifest per model kind.
//
// The hub REUSES the Unified-Sessions capability manifests VERBATIM (`capabilitiesForProviderKind` in
// `testing/session-capabilities.ts`) rather than declaring a fourth parallel set — the whole point of
// D-US4 is that the UI gates on the manifest, never on `providerKind === …`, so every backend renders
// with zero new UI branches. This module is the hub adapter's thin declaration layer on top of that
// shared source of truth:
//   • it constrains the manifest to the hub's ACTUAL model surface (D-AH4: the five AI-SDK kinds +
//     `claude_subscription` — NOT `acme_answers`, whose clean-session/no-tools shape is a hub non-goal
//     in v1), refusing any other kind up front rather than silently mis-declaring; and
//   • it coerces `askUser` to false: the shared engine manifest advertises the Testing feature's
//     agent-initiated `ask_user` tool, which the hub does NOT expose in v1 (its interaction model is
//     the steering queue + missions, not `ask_user`). Declaring a capability the hub can't back would
//     make WP1.3's UI render a dead affordance — every OTHER facet is inherited unchanged.
//
// The `claude_subscription` branch resolves to the shared SUBSCRIPTION manifest so WP1.5's adapter
// slots in without a capability change; WP1.1's turn engine itself only ever runs the AI-SDK kinds.

import {
  type ProviderKind,
  providerKindLabel,
  type SessionCapabilities,
} from "@mcp-token-footprint/shared";
import { capabilitiesForProviderKind } from "../testing/session-capabilities.js";
import { httpError } from "../utils/errors.js";

/**
 * The hub's model surface at launch (D-AH4): the five chat-completions AI-SDK kinds plus
 * `claude_subscription`. `satisfies readonly ProviderKind[]` keeps every member a real provider kind
 * (a typo fails typecheck) without widening the literal-union element type.
 */
export const HUB_MODEL_KINDS = [
  "anthropic",
  "openai",
  "google",
  "openai_compatible",
  "ollama",
  "claude_subscription",
] as const satisfies readonly ProviderKind[];

export type HubModelKind = (typeof HUB_MODEL_KINDS)[number];

/**
 * The subset WP1.1's turn engine (`turn-engine.ts`) itself drives — the five kinds that run through
 * `providers/registry.modelFor` + AI-SDK `streamText`. `claude_subscription` is a hub MODEL kind (the
 * session-service accepts it) but a SEPARATE executor (WP1.5's `AgentSessionDriver` adapter), never the
 * AI-SDK loop.
 */
export const HUB_AI_SDK_MODEL_KINDS = [
  "anthropic",
  "openai",
  "google",
  "openai_compatible",
  "ollama",
] as const satisfies readonly HubModelKind[];

export type HubAiSdkModelKind = (typeof HUB_AI_SDK_MODEL_KINDS)[number];

/** True when `kind` is a hub model kind at all (D-AH4). */
export function isHubModelKind(kind: ProviderKind): kind is HubModelKind {
  return (HUB_MODEL_KINDS as readonly ProviderKind[]).includes(kind);
}

/** True when `kind` runs through WP1.1's AI-SDK turn engine (excludes `claude_subscription`). */
export function isHubAiSdkKind(kind: ProviderKind): kind is HubAiSdkModelKind {
  return (HUB_AI_SDK_MODEL_KINDS as readonly ProviderKind[]).includes(kind);
}

/**
 * Assert `kind` is a hub model kind, throwing a clean 400 otherwise (the one place `acme_answers` — a
 * hub non-goal in v1, D-AH4 — is rejected). A `TypeScript` `asserts` guard so callers narrow to
 * {@link HubModelKind} after it returns.
 */
export function assertHubModelKind(kind: ProviderKind): asserts kind is HubModelKind {
  if (!isHubModelKind(kind)) {
    throw httpError(
      400,
      // Both the offending kind and the supported list render through PROVIDER_KIND_META (D-MI6) —
      // this message is operator-facing, so it must not leak raw wire literals ("claude_subscription")
      // where every other surface says "Anthropic CLI".
      `Provider kind "${providerKindLabel(kind)}" is not a hub model. The Assistant supports ` +
        `${HUB_MODEL_KINDS.map(providerKindLabel).join(", ")}.`,
    );
  }
}

/**
 * The hub capability manifest for a model kind (D-US4). Reuses the shared Unified-Sessions manifest
 * ({@link capabilitiesForProviderKind}) and applies the hub adaptations documented in the module header:
 * it refuses a non-hub kind (`acme_answers`) and sets `askUser` from `exposeAskUser`. The hub reuses the
 * Testing `ask_user` primitive, exposed ONLY on interactive foreground sessions (chat/research) — the
 * session-service passes `exposeAskUser: session.kind !== "agent"`, so a mission agent CHILD turn (and a
 * synthesis turn) keeps the default `false` (no operator present to answer). Persisted on
 * `hub_sessions.capabilities_json` + surfaced to the UI, which gates on it — never on the provider kind.
 */
export function hubCapabilitiesForKind(
  kind: ProviderKind,
  exposeAskUser = false,
): SessionCapabilities {
  assertHubModelKind(kind);
  return { ...capabilitiesForProviderKind(kind), askUser: exposeAskUser };
}
