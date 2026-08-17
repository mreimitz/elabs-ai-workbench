// Assistant Hub (roadmap/assistant-hub/, WP1.1, D-AH4 / D-US4) — the hub capability manifest per kind.
// Proves the hub REUSES the Unified-Sessions manifests (never forks them), constrains the model surface
// to D-AH4, and sets `askUser` from `exposeAskUser` — off by default (mission
// agent/synthesis turns), on for interactive foreground sessions (which expose the reused `ask_user`).

import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDER_KINDS } from "@mcp-token-footprint/shared";
import {
  ENGINE_SESSION_CAPABILITIES,
  SUBSCRIPTION_SESSION_CAPABILITIES,
} from "../src/testing/session-capabilities.js";
import {
  assertHubModelKind,
  HUB_AI_SDK_MODEL_KINDS,
  HUB_MODEL_KINDS,
  hubCapabilitiesForKind,
  isHubAiSdkKind,
  isHubModelKind,
} from "../src/hub/capabilities.js";

test("the five AI-SDK kinds reuse the shared engine manifest (askUser coerced off)", () => {
  for (const kind of HUB_AI_SDK_MODEL_KINDS) {
    const caps = hubCapabilitiesForKind(kind);
    assert.deepEqual(caps, { ...ENGINE_SESSION_CAPABILITIES, askUser: false });
    assert.equal(caps.askUser, false, "the hub does not expose the Testing ask_user tool in v1");
    assert.equal(isHubAiSdkKind(kind), true);
  }
});

test("exposeAskUser:true turns askUser on (interactive foreground) across every hub kind", () => {
  for (const kind of HUB_MODEL_KINDS) {
    const foreground = hubCapabilitiesForKind(kind, true);
    assert.equal(foreground.askUser, true, `${kind} foreground exposes ask_user`);
    // Everything OTHER than askUser matches the default (agent/synthesis) manifest — only the one facet flips.
    assert.deepEqual({ ...foreground, askUser: false }, hubCapabilitiesForKind(kind));
  }
});

test("claude_subscription is a hub model kind carrying the shared subscription manifest", () => {
  assert.equal(isHubModelKind("claude_subscription"), true);
  assert.equal(
    isHubAiSdkKind("claude_subscription"),
    false,
    "subscription is NOT the AI-SDK turn path",
  );
  assert.deepEqual(hubCapabilitiesForKind("claude_subscription"), {
    ...SUBSCRIPTION_SESSION_CAPABILITIES,
    askUser: false,
  });
});

test("assertHubModelKind is the D-AH4 enforcement point (every live kind is currently eligible)", () => {
  // With `acme_answers` retired, HUB_MODEL_KINDS covers every live ProviderKind — so this guard has no
  // reachable rejection today. It stays the ONE place a future non-hub kind is refused, which is why the
  // eligibility check is asserted here rather than deleted along with its last failing input.
  for (const kind of PROVIDER_KINDS) {
    assert.equal(isHubModelKind(kind), true, `${kind} is hub-eligible`);
    assert.doesNotThrow(() => assertHubModelKind(kind));
  }
});

test("HUB_MODEL_KINDS is the five AI-SDK kinds plus claude_subscription", () => {
  assert.deepEqual(
    [...HUB_MODEL_KINDS].sort(),
    ["anthropic", "claude_subscription", "google", "ollama", "openai", "openai_compatible"].sort(),
  );
});
