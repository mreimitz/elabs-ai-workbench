// Assistant Hub (roadmap/assistant-hub/, WP1.1, D-AH4 / D-US4) — the hub capability manifest per kind.
// Proves the hub REUSES the Unified-Sessions manifests (never forks them), constrains the model surface
// to D-AH4 (rejects `qlik_answers`), and sets `askUser` from `exposeAskUser` — off by default (mission
// agent/synthesis turns), on for interactive foreground sessions (which expose the reused `ask_user`).

import assert from "node:assert/strict";
import { test } from "node:test";
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

test("qlik_answers is refused as a hub model (D-AH4 non-goal)", () => {
  assert.equal(isHubModelKind("qlik_answers"), false);
  assert.throws(() => assertHubModelKind("qlik_answers"), /not a hub model/);
  assert.throws(() => hubCapabilitiesForKind("qlik_answers"), /not a hub model/);
});

test("HUB_MODEL_KINDS is the five AI-SDK kinds plus claude_subscription", () => {
  assert.deepEqual(
    [...HUB_MODEL_KINDS].sort(),
    ["anthropic", "claude_subscription", "google", "ollama", "openai", "openai_compatible"].sort(),
  );
});
