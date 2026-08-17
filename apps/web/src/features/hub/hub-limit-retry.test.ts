// model-identity WP 4.3 (D-MI1/D-MI9) — the limit-error banner's target selection.
//
// The defect this locks (README §1, blast-radius row 14): "Retry on subscription" answered with a bare
// MODEL ID, and a model id cannot say which credential it came from — the subscription roster emits
// Anthropic's canonical `claude-sonnet-5` on purpose, so the retry went out with no credential, the
// server's `claude*` → `anthropic` name heuristic ran, and the turn landed back on the metered API key
// that had just refused it.
import { HUB_LIMIT_RETRY_SOURCES, STOP_REASON_CODES } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import {
  findUnavailableRetrySource,
  isDirectRetrySource,
  kindMatchesRetrySource,
  pickHubRetryTarget,
} from "./hub-limit-retry";
import type { HubModelCredentialIssue, HubModelOption } from "./use-hub-models";

const METERED_SONNET: HubModelOption = {
  modelId: "claude-sonnet-5",
  kind: "anthropic",
  credentialId: "cred-metered",
  credentialLabel: "Work key",
  displayName: "Claude Sonnet 5",
};
const SUBSCRIPTION_SONNET: HubModelOption = {
  // Byte-identical to the metered row's id — the canonical collision (README §1).
  modelId: "claude-sonnet-5",
  kind: "claude_subscription",
  credentialId: "cred-sub",
  credentialLabel: "Claude Max",
  displayName: "Sonnet",
};
const SUBSCRIPTION_OPUS: HubModelOption = {
  modelId: "claude-opus-4-8",
  kind: "claude_subscription",
  credentialId: "cred-sub",
  credentialLabel: "Claude Max",
  displayName: "Opus",
};
const OPENAI_GPT5: HubModelOption = {
  modelId: "gpt-5",
  kind: "openai",
  credentialId: "cred-openai",
  credentialLabel: "OpenAI",
};

describe("kindMatchesRetrySource", () => {
  test("`subscription` is the Claude-subscription kind; `api_key` is every other kind", () => {
    expect(kindMatchesRetrySource("claude_subscription", "subscription")).toBe(true);
    expect(kindMatchesRetrySource("anthropic", "subscription")).toBe(false);
    expect(kindMatchesRetrySource("anthropic", "api_key")).toBe(true);
    expect(kindMatchesRetrySource("openai", "api_key")).toBe(true);
    expect(kindMatchesRetrySource("claude_subscription", "api_key")).toBe(false);
  });

  test("isDirectRetrySource narrows away `other_model` only", () => {
    expect(HUB_LIMIT_RETRY_SOURCES.filter(isDirectRetrySource)).toEqual([
      "api_key",
      "subscription",
    ]);
  });
});

describe("pickHubRetryTarget", () => {
  test("THE defect: a metered limit on `claude-sonnet-5` retries the SUBSCRIPTION twin, credential and all", () => {
    const target = pickHubRetryTarget([METERED_SONNET, SUBSCRIPTION_SONNET], "subscription", {
      modelId: "claude-sonnet-5",
      credentialId: "cred-metered",
    });
    // Same model id — so the ONLY thing that distinguishes right from wrong here is the credential.
    expect(target?.modelId).toBe("claude-sonnet-5");
    expect(target?.credentialId).toBe("cred-sub");
    expect(target?.kind).toBe("claude_subscription");
  });

  test("prefers the SAME model id over another model of the target source", () => {
    // `claude-opus-4-8` sorts before `claude-sonnet-5` inside the credential's roster order here, so a
    // naive "first row of that kind" would pick Opus and quietly change the model too.
    const target = pickHubRetryTarget(
      [METERED_SONNET, SUBSCRIPTION_OPUS, SUBSCRIPTION_SONNET],
      "subscription",
      { modelId: "claude-sonnet-5", credentialId: "cred-metered" },
    );
    expect(target).toEqual(SUBSCRIPTION_SONNET);
  });

  test("no twin available: falls back to the first row of that source in the picker's deterministic order", () => {
    const target = pickHubRetryTarget([OPENAI_GPT5, SUBSCRIPTION_OPUS], "subscription", {
      modelId: "gpt-5",
      credentialId: "cred-openai",
    });
    expect(target).toEqual(SUBSCRIPTION_OPUS);
  });

  test("order is `buildHubModelGroups`' (kind → label → id), NOT the roster's arrival order", () => {
    const anthropicPersonal: HubModelOption = {
      modelId: "claude-haiku-4-5-20251001",
      kind: "anthropic",
      credentialId: "cred-personal",
      credentialLabel: "Personal key",
    };
    // `listProviders()` returns `ORDER BY updated_at DESC`, so an unrelated edit can put either of
    // these first. The chosen target must not move because of that.
    const forward = pickHubRetryTarget([anthropicPersonal, METERED_SONNET], "api_key");
    const reversed = pickHubRetryTarget([METERED_SONNET, anthropicPersonal], "api_key");
    expect(forward).toEqual(reversed);
    // "Personal key" < "Work key" — both `anthropic`, so the credential LABEL decides.
    expect(forward?.credentialId).toBe("cred-personal");
  });

  test("never returns the credential that just failed", () => {
    const target = pickHubRetryTarget([METERED_SONNET, OPENAI_GPT5], "api_key", {
      modelId: "claude-sonnet-5",
      credentialId: "cred-metered",
    });
    expect(target).toEqual(OPENAI_GPT5);
  });

  test("no row of that source at all ⇒ undefined (the caller shows Settings, never a dead button)", () => {
    expect(pickHubRetryTarget([OPENAI_GPT5], "subscription")).toBeUndefined();
    expect(pickHubRetryTarget([], "api_key")).toBeUndefined();
  });
});

describe("findUnavailableRetrySource", () => {
  const brokenSubscription: HubModelCredentialIssue = {
    credentialId: "cred-sub",
    kind: "claude_subscription",
    label: "Claude Max",
    reason: "This credential's authentication is broken — reconnect it in Settings.",
  };
  const brokenKey: HubModelCredentialIssue = {
    credentialId: "cred-metered",
    kind: "anthropic",
    label: "Work key",
    reason: "Its model list couldn’t be loaded — check the credential in Settings.",
  };

  test("tells 'configured but broken' apart from 'never configured', per source", () => {
    expect(findUnavailableRetrySource([brokenSubscription, brokenKey], "subscription")).toEqual(
      brokenSubscription,
    );
    expect(findUnavailableRetrySource([brokenSubscription, brokenKey], "api_key")).toEqual(
      brokenKey,
    );
    expect(findUnavailableRetrySource([brokenKey], "subscription")).toBeUndefined();
    expect(findUnavailableRetrySource([], "api_key")).toBeUndefined();
  });
});

describe("FROZEN — no stop-reason was repurposed to carry a billing/credential failure", () => {
  // README §3: routing a billing/credential failure into `rate_limit` (or any other existing code) to
  // make the retry banner appear would corrupt every observability and auto-rating bucket built on
  // `STOP_REASON_CODES` (`apps/api/src/testing/session-terminal.ts`). This WP therefore changed the
  // retry's PAYLOAD (a roster row instead of a bare model id), not the classification vocabulary.
  test("STOP_REASON_CODES gained no member for a billing/credential failure", () => {
    expect([...STOP_REASON_CODES]).toEqual([
      "user_stop",
      "session_ended",
      "max_duration",
      "stalled",
      "wait_expired",
      "max_turns",
      "max_tokens",
      "max_context_tokens",
      "max_cost",
      "context_overflow",
      "provider_error",
      "auth",
      "rate_limit",
      "max_tool_calls",
    ]);
  });

  test("HUB_LIMIT_RETRY_SOURCES is unchanged — the banner gained no new trigger condition", () => {
    expect([...HUB_LIMIT_RETRY_SOURCES]).toEqual(["api_key", "subscription", "other_model"]);
  });
});
