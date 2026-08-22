// Observability — webhook test-fire (planning/Roadmap/RM-17-observability/, WP4.3, D-OB19).
//
//   POST /api/watch-rules/:id/test-fire
//
// Sends a SAMPLE payload to a rule's webhook action so an operator can verify the receiving endpoint
// before relying on it. Reuses the SAME `postWebhook` machinery (`watch/actions.ts`) the real engine
// uses for a real fire — the timeout/URL-redaction/non-2xx/network isolation is not reimplemented here.
// The webhook's URL is resolved TRANSIENTLY via the existing `resolveWebhookUrl` (never returned,
// logged, or placed in the audit row); the outcome is recorded to the SAME `watch_rule_events` audit
// log a real fire uses (`recordEvent`, action `"test_fire"`) so a test-fire shows up alongside real
// history. Never throws into the caller — `postWebhook` already guards every failure mode.

import type { WatchRule, WatchRuleEventResult } from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import { httpError } from "../utils/errors.js";
import { postWebhook } from "./actions.js";
import { appPath, outboundUrl } from "./outbound-link.js";
import type { WatchRuleRepository } from "./repository.js";

export async function registerWatchTestFireRoute(
  app: FastifyInstance,
  rules: WatchRuleRepository,
  resolveWebhookUrl: (secretRef: string) => string | undefined,
): Promise<void> {
  app.post("/api/watch-rules/:id/test-fire", async (request): Promise<WatchRuleEventResult> => {
    const { id } = request.params as { id: string };
    const rule = rules.get(id); // 404s if unknown (same as every other single-rule route)

    const webhookAction = rule.actions.find(
      (action): action is Extract<typeof action, { type: "webhook" }> => action.type === "webhook",
    );
    if (!webhookAction) {
      throw httpError(400, "Rule has no webhook action to test-fire");
    }

    const url = resolveWebhookUrl(webhookAction.secretRef);
    if (!url) {
      const result: WatchRuleEventResult = { ok: false, error: "webhook secret not found" };
      rules.recordEvent(id, undefined, "test_fire", result);
      return result;
    }

    const body = sampleTestFireBody(rule, webhookAction.template);
    const result = await postWebhook(url, body);
    rules.recordEvent(id, undefined, "test_fire", result);
    return result;
  });
}

/**
 * The documented sample payload (WP4.3 acceptance): the SAME shape a real fire's webhook body takes
 * (`executeWebhook`/the windowed webhook in `actions.ts` — `{ run, link, template? }` or
 * `{ window, link, template? }`), plus `sample: true` so a receiving endpoint can tell a test-fire
 * apart from a real one. A `windowed` rule with a saved threshold samples the `window` shape (using its
 * OWN threshold as the "measured" value, since there is no real window to score); every other rule
 * (on_terminal, or a windowed rule with no threshold saved yet) samples the `run` shape.
 *
 * AM-OB13 — the sample's DATA stays deliberately fake (that is the whole point of a test-fire: prove
 * the plumbing without implying real data was shared), but its LINK is now built through the same
 * `appPath`/`outboundUrl` vocabulary a real fire uses. Otherwise a test-fire would prove the plumbing
 * with a link SHAPED differently from the one production sends — which is exactly the thing an
 * operator is test-firing to check.
 */
function sampleTestFireBody(rule: WatchRule, template: string | undefined): unknown {
  const now = new Date().toISOString();
  if (rule.trigger === "windowed" && rule.window) {
    const w = rule.window;
    return {
      window: {
        ruleId: rule.id,
        ruleName: rule.name,
        measure: w.measure,
        op: w.op,
        threshold: w.threshold,
        window: w.window,
        windowStart: now,
        windowEnd: now,
        value: w.threshold,
        late: false,
      },
      link: outboundUrl(appPath.watchRules()),
      ...(template !== undefined ? { template } : {}),
      sample: true,
    };
  }
  return {
    run: {
      id: "sample-run",
      status: "completed",
      outcome: "success",
      scenarioId: "sample-scenario",
      testId: "sample-test",
      costUsd: 0.01,
      tokensIn: 100,
      tokensOut: 50,
      startedAt: now,
    },
    link: outboundUrl(appPath.run("sample-run")),
    ...(template !== undefined ? { template } : {}),
    sample: true,
  };
}
