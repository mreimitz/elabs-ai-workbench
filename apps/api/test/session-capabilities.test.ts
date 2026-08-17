// Unified Sessions WP1.1 — the static capability manifests
// (apps/api/src/testing/session-capabilities.ts). Verifies every declared manifest is a valid
// SessionCapabilities (parses against the shared zod), that `capabilitiesForProviderKind` is total
// over PROVIDER_KINDS, and that the per-WP facet values (research 01 §C3) are what the console will
// gate on.

import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDER_KINDS, sessionCapabilitiesSchema } from "@mcp-token-footprint/shared";
import {
  ENGINE_SESSION_CAPABILITIES,
  SUBSCRIPTION_SESSION_CAPABILITIES,
  capabilitiesForProviderKind,
} from "../src/testing/session-capabilities.js";

test("every static manifest parses against sessionCapabilitiesSchema", () => {
  for (const manifest of [ENGINE_SESSION_CAPABILITIES, SUBSCRIPTION_SESSION_CAPABILITIES]) {
    assert.doesNotThrow(() => sessionCapabilitiesSchema.parse(manifest));
  }
});

test("capabilitiesForProviderKind is total over PROVIDER_KINDS", () => {
  for (const kind of PROVIDER_KINDS) {
    const caps = capabilitiesForProviderKind(kind);
    assert.doesNotThrow(() => sessionCapabilitiesSchema.parse(caps));
  }
});

test("the five chat-completions kinds all resolve to the engine manifest", () => {
  for (const kind of ["anthropic", "openai", "google", "openai_compatible", "ollama"] as const) {
    assert.equal(capabilitiesForProviderKind(kind), ENGINE_SESSION_CAPABILITIES);
  }
});

test("claude_subscription resolves to its own manifest", () => {
  assert.equal(
    capabilitiesForProviderKind("claude_subscription"),
    SUBSCRIPTION_SESSION_CAPABILITIES,
  );
});

test("engine manifest: full-fidelity facets (research 01 §C3)", () => {
  assert.deepEqual(ENGINE_SESSION_CAPABILITIES, {
    liveText: true,
    liveReasoning: "raw",
    toolCalls: true,
    contextWindow: true,
    tokens: "exact",
    costBasis: "api_exact",
    followUps: true,
    askUser: true,
  });
});

test("subscription manifest: no reasoning/context, exact tokens, subscription cost (WP1.4)", () => {
  const c = SUBSCRIPTION_SESSION_CAPABILITIES;
  assert.equal(c.liveReasoning, "none");
  assert.equal(c.contextWindow, false);
  assert.equal(c.tokens, "exact");
  assert.equal(c.costBasis, "subscription_reference");
});
