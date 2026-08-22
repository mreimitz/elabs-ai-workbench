// Observability — "send this run to a webhook, by hand" (RM-17 Phase 6, AM-OB13).
//
//   GET  /api/runs/:id/webhook-payload            — exactly what a send would post (no side effect)
//   POST /api/runs/:id/send-to-webhook            — post it, audited
//   GET  /api/suite-runs/:id/webhook-payload
//   POST /api/suite-runs/:id/send-to-webhook
//
// Before this, the only way to get an interesting run out of the bench was to copy the URL out of
// the address bar. A rule could push one, but only on a schedule the rule decided; the one manual
// affordance — `POST /api/watch-rules/:id/test-fire` — deliberately sends FAKE data (`sample-run`),
// because its job is proving the plumbing, not sharing a result.
//
// THE DESTINATION IS A RULE'S, NOT A REGISTRY (the spec's recommended path, chosen here)
//   A webhook URL lives encrypted in `watch_secrets`, keyed by an opaque `secretRef` that is minted
//   inside `prepareActions` during rule create/update and surfaced only attached to a rule. So the
//   caller names a destination INDIRECTLY, by rule id, and this module resolves it through the SAME
//   `resolveWebhookUrl` the engine uses. That buys: no new table, no migration, no second secret
//   lifecycle, and rotation/deletion that already work (a rotated rule rotates the destination; a
//   deleted rule cascade-deletes it).
//
//   The cost is the case `watch_secrets.rule_id ON DELETE CASCADE` creates: "send via rule X" stops
//   working the moment rule X is deleted. That is handled EXPLICITLY, in both of its forms, because
//   a generic "webhook request failed" would send an operator hunting a network problem that does
//   not exist:
//     - the rule is gone            -> 404, "that destination no longer exists" (naming the cause).
//       There is no audit row, and there cannot be: `watch_rule_events.rule_id` references
//       `watch_rules`, so the row this event would hang off is exactly the row that was deleted.
//     - the rule is there, the ref no longer resolves (rotated) -> an `ok:false` result whose error
//       says the same thing, AND an audit row, because there is still a rule to hang it off.
//
// SECRETS
//   The URL is resolved transiently and handed straight to `postWebhook`. It is never returned,
//   never logged, never placed in a result or an audit row — the same discipline the rule path
//   keeps, reused rather than reimplemented (one attempt, the 10 s `WATCH_WEBHOOK_TIMEOUT_MS`
//   bound, `scrub()`ed errors). The preview endpoint carries the PAYLOAD, which by construction
//   contains no destination at all: it is a run summary plus two links.

import {
  manualSendRequestSchema,
  WATCH_MARKER_MANUAL_SEND,
  type ManualSendPayload,
  type WatchRuleEventResult,
  type WatchRunSummaryView,
  type WatchSuiteRunSummaryView,
} from "@mcp-token-footprint/shared";
import type { FastifyInstance } from "fastify";
import type { SuiteRunRepository } from "../suites/suite-run-repository.js";
import type { RunRepository } from "../testing/run-repository.js";
import { httpError } from "../utils/errors.js";
import { postWebhook } from "./actions.js";
import { appPath, outboundUrl } from "./outbound-link.js";
import type { WatchRuleRepository } from "./repository.js";

/** What the manual-send routes need. Narrow + injectable, so the gate never makes a real request. */
export interface ManualSendDeps {
  rules: WatchRuleRepository;
  runs: RunRepository;
  suiteRuns: SuiteRunRepository;
  /** Injectable fetch for the POST (a test injects a local receiver; prod uses global fetch). */
  fetchImpl?: typeof fetch;
}

/** The one sentence an operator gets when the rule that owned the destination is gone. */
const DESTINATION_GONE = "that destination no longer exists — its watch rule has been deleted";
/** …and when the rule survives but its secret no longer resolves (rotated out from under the send). */
const DESTINATION_UNRESOLVABLE =
  "that destination no longer exists — the rule's webhook was changed or removed";

export async function registerManualSendRoutes(
  app: FastifyInstance,
  deps: ManualSendDeps,
): Promise<void> {
  app.get("/api/runs/:id/webhook-payload", async (request): Promise<ManualSendPayload> => {
    const { id } = request.params as { id: string };
    return buildRunPayload(deps.runs, id);
  });

  app.get(
    "/api/suite-runs/:id/webhook-payload",
    async (request): Promise<ManualSendPayload> => {
      const { id } = request.params as { id: string };
      return buildSuiteRunPayload(deps.suiteRuns, id);
    },
  );

  app.post("/api/runs/:id/send-to-webhook", async (request): Promise<WatchRuleEventResult> => {
    const { id } = request.params as { id: string };
    const { ruleId } = manualSendRequestSchema.parse(request.body);
    // Build the payload FIRST: a request naming a run that does not exist is a 404 about the run,
    // not a webhook outcome, and it must not reach the destination or the audit log.
    const body = buildRunPayload(deps.runs, id);
    return send(deps, ruleId, id, body);
  });

  app.post("/api/suite-runs/:id/send-to-webhook", async (request): Promise<WatchRuleEventResult> => {
    const { id } = request.params as { id: string };
    const { ruleId } = manualSendRequestSchema.parse(request.body);
    const body = buildSuiteRunPayload(deps.suiteRuns, id);
    // `runId` on the audit row stays undefined: a suite run is not a run, and `watch_rule_events`
    // has exactly one denormalized subject column. The suite-run id rides in the detail text.
    return send(deps, ruleId, undefined, body, id);
  });
}

/**
 * Resolve the destination, post, audit. Never throws for a webhook-shaped failure — those come back
 * as `ok:false` results, exactly like a rule fire's, so the console can show the outcome instead of
 * a stack. The two cases that ARE thrown are about the caller's request, not the destination's
 * behaviour: an unknown run (404, above) and a rule/destination that no longer exists (404, here).
 */
async function send(
  deps: ManualSendDeps,
  ruleId: string,
  runId: string | undefined,
  body: ManualSendPayload,
  suiteRunId?: string,
): Promise<WatchRuleEventResult> {
  const rule = deps.rules.tryGet(ruleId);
  if (!rule) throw httpError(404, DESTINATION_GONE);

  const webhookAction = rule.actions.find(
    (action): action is Extract<typeof action, { type: "webhook" }> => action.type === "webhook",
  );
  if (!webhookAction) throw httpError(400, "That rule has no webhook destination to send to");

  const subject = suiteRunId !== undefined ? `suite run ${suiteRunId}` : `run ${runId}`;

  const url = deps.rules.resolveWebhookUrl(webhookAction.secretRef);
  if (!url) {
    const result: WatchRuleEventResult = { ok: false, error: DESTINATION_UNRESOLVABLE };
    deps.rules.recordEvent(ruleId, runId, WATCH_MARKER_MANUAL_SEND, result);
    return result;
  }

  const posted = await postWebhook(url, body, deps.fetchImpl);
  // Name the subject in the audit row: the rule's own history is otherwise a wall of rows that all
  // look alike, and "did I actually send THAT run out" is the question this row exists to answer.
  const result: WatchRuleEventResult = posted.ok
    ? { ok: true, detail: `sent ${subject} by hand — ${posted.detail ?? "webhook accepted"}` }
    : { ok: false, error: `sending ${subject} by hand failed — ${posted.error ?? "unknown"}` };
  deps.rules.recordEvent(ruleId, runId, WATCH_MARKER_MANUAL_SEND, result);
  return result;
}

/**
 * The payload for ONE run — the real thing, never `sampleTestFireBody`'s `"sample-run"`. `run` is
 * the SAME `WatchRunSummaryView` the rule path builds, from the same `buildFilterCandidate` source,
 * so a hand-driven send and a rule fire describe a run identically.
 */
export function buildRunPayload(runs: RunRepository, runId: string): ManualSendPayload {
  const candidate = runs.buildFilterCandidate(runId);
  if (!candidate) throw httpError(404, "Run not found");
  const run: WatchRunSummaryView = {
    id: runId,
    status: candidate.status,
    ...(candidate.outcome !== undefined ? { outcome: candidate.outcome } : {}),
    scenarioId: candidate.scenarioId,
    testId: candidate.testId,
    costUsd: candidate.costUsd,
    tokensIn: candidate.tokensIn,
    tokensOut: candidate.tokensOut,
    startedAt: candidate.startedAt,
  };
  return {
    run,
    link: outboundUrl(appPath.run(runId)),
    reportLink: outboundUrl(appPath.runReport(runId)),
    manual: true,
  };
}

/**
 * The payload for ONE suite run. Cost/token/matrix figures come off the cached aggregates and are
 * OMITTED when the run has none — absent means UNKNOWN, never a zero that reads like a measurement
 * (the same rule RM-33's D-CT6 applies to the cache split, for the same reason).
 */
export function buildSuiteRunPayload(
  suiteRuns: SuiteRunRepository,
  suiteRunId: string,
): ManualSendPayload {
  const row = suiteRuns.getRun(suiteRunId); // 404s if unknown, like every other suite-run route
  const aggregates = row.aggregates;
  const suiteRun: WatchSuiteRunSummaryView = {
    id: row.id,
    status: row.status,
    ...(row.suiteId !== undefined ? { suiteId: row.suiteId } : {}),
    ...(row.source !== undefined ? { source: row.source } : {}),
    startedAt: row.startedAt,
    ...(row.endedAt !== undefined ? { endedAt: row.endedAt } : {}),
    ...(aggregates !== undefined
      ? {
          cellsTotal: aggregates.cellsTotal,
          cellsCompleted: aggregates.cellsCompleted,
          costUsd: aggregates.execCostUsd + aggregates.judgeCostUsd,
          totalTokens: aggregates.totalTokens,
          meanGrade: aggregates.meanGrade,
        }
      : {}),
  };
  return {
    suiteRun,
    link: outboundUrl(appPath.suiteRun(suiteRunId)),
    reportLink: outboundUrl(appPath.suiteRunReport(suiteRunId)),
    manual: true,
  };
}
