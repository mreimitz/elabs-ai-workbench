// Unified Sessions WP1.1 — the static capability manifests
// (apps/api/src/testing/session-capabilities.ts). Verifies every declared manifest is a valid
// SessionCapabilities (parses against the shared zod), that `capabilitiesForProviderKind` is total
// over PROVIDER_KINDS, and that the per-WP facet values (research 01 §C3) are what the console will
// gate on. Also checks the per-run identity overlay.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionAssistantIdentity } from "@mcp-token-footprint/shared";
import { PROVIDER_KINDS, sessionCapabilitiesSchema } from "@mcp-token-footprint/shared";
import {
  ENGINE_SESSION_CAPABILITIES,
  QLIK_ANSWERS_SESSION_CAPABILITIES,
  QLIK_ANSWERS_WAIT_BUDGET_MS,
  SUBSCRIPTION_SESSION_CAPABILITIES,
  capabilitiesForProviderKind,
  withAssistantIdentity,
} from "../src/testing/session-capabilities.js";

test("every static manifest parses against sessionCapabilitiesSchema", () => {
  for (const manifest of [
    ENGINE_SESSION_CAPABILITIES,
    SUBSCRIPTION_SESSION_CAPABILITIES,
    QLIK_ANSWERS_SESSION_CAPABILITIES,
  ]) {
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

test("claude_subscription + qlik_answers resolve to their own manifests", () => {
  assert.equal(
    capabilitiesForProviderKind("claude_subscription"),
    SUBSCRIPTION_SESSION_CAPABILITIES,
  );
  assert.equal(capabilitiesForProviderKind("qlik_answers"), QLIK_ANSWERS_SESSION_CAPABILITIES);
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

test("qlik manifest: no tools, structured reasoning, estimated tokens, questions cost, 30-min wait (WP1.5)", () => {
  const c = QLIK_ANSWERS_SESSION_CAPABILITIES;
  assert.equal(c.toolCalls, false);
  assert.equal(c.liveReasoning, "structured");
  assert.equal(c.tokens, "estimated");
  assert.equal(c.costBasis, "questions");
  assert.equal(c.waitBudgetMs, QLIK_ANSWERS_WAIT_BUDGET_MS);
  assert.equal(QLIK_ANSWERS_WAIT_BUDGET_MS, 30 * 60_000);
  // The base manifest carries no identity — the executor overlays it per run.
  assert.equal(c.identity, undefined);
});

test("withAssistantIdentity attaches the identity card without mutating the base", () => {
  const identity: SessionAssistantIdentity = {
    kind: "qlik_assistant",
    assistantId: "asst-123",
    name: "Flights Analyst",
    version: 'W/"etag-1"',
    appId: "app-abc",
    transport: "invoke",
  };
  const overlaid = withAssistantIdentity(QLIK_ANSWERS_SESSION_CAPABILITIES, identity);
  assert.deepEqual(overlaid.identity, identity);
  // Base is untouched (no shared-singleton mutation).
  assert.equal(QLIK_ANSWERS_SESSION_CAPABILITIES.identity, undefined);
  assert.doesNotThrow(() => sessionCapabilitiesSchema.parse(overlaid));
});
