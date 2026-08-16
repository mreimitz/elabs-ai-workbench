// Observability — the CLOSED watch-rule action set + its executor (roadmap/observability/, WP4.1).
//
// Each action is executed through an injected {@link WatchActionServices} seam (real services in
// prod; stubs in tests) and returns a structured {@link WatchRuleEventResult} (never throws — a
// thrown error is caught and turned into an `ok:false` result). Actions are strictly POST-HOC
// OBSERVERS: NOTHING here mutates run lifecycle/status/totals/grades. `pin` writes the run's pin flag
// (a retention marker, not lifecycle), `run_grader` APPENDS a grade row (append-only, never a
// mutation of existing grades or run totals), `promote_to_test` creates a NEW draft test (never runs
// it), and the rest are outbound/notify side-effects. The webhook URL is resolved from the ENCRYPTED
// secret store transiently and NEVER echoed into a result/detail/error/log.

import {
  WATCH_WEBHOOK_TIMEOUT_MS,
  type WatchAction,
  type WatchNotifySeverity,
  type WatchRuleEventResult,
} from "@mcp-token-footprint/shared";

/** The compact run view the webhook payload carries (no secrets — a summary of the terminal run). */
export interface WatchRunSummaryView {
  id: string;
  status: string;
  outcome?: string;
  scenarioId: string;
  testId: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  startedAt: string;
}

/**
 * The compact window view a windowed rule's alert carries (WP4.2). A windowed rule fires on an
 * AGGREGATE over a trailing window — there is NO single run — so the alert names the rule + the window
 * + the measured value/threshold/late flag instead of a run summary.
 */
export interface WatchWindowSummaryView {
  ruleId: string;
  ruleName: string;
  measure: string;
  op: string;
  threshold: number;
  /** The trailing-window width ("1h"|"6h"|"24h"|"7d"). */
  window: string;
  windowStart: string;
  windowEnd: string;
  /** The breach-direction extreme measure value; null only in edge paths (a fire always has a value). */
  value: number | null;
  /** True when the window completed while the app was away (boot catch-up). */
  late: boolean;
}

/**
 * A WP4.3 notification request — the shape the (future) notification center will consume. `runId` is
 * present for an on-terminal alert; `window` is present for a windowed alert (WP4.2). Exactly one of the
 * two carries the context (never both) — the sink renders whichever it gets.
 */
export interface WatchNotifyRequest {
  runId?: string;
  severity: WatchNotifySeverity;
  template?: string;
  /** WP4.2 — set for a windowed rule's alert (no run context). */
  window?: WatchWindowSummaryView;
}

/**
 * The side-effecting operations the executor drives. Each is narrow + injectable so the executor is
 * decoupled from the concrete services (and trivially stubbable in tests). `notify` is OPTIONAL: while
 * WP4.3's notification table is unbuilt it is UNDEFINED, so a `notify` action is ACCEPTED but INERT
 * (audited, no-ops) — WP4.3 wires a real `notify` here and the action goes live with NO engine change.
 */
export interface WatchActionServices {
  /** Pin the run (WP1.6 pin path) — a retention marker, never a lifecycle change. */
  pinRun(runId: string): void;
  /** Assign the run's TEST to a collection (existing collections service). */
  addRunToCollection(runId: string, collectionId: string): void;
  /** Create the documented DRAFT test from the run (never auto-runs); returns the new test id. */
  promoteRunToTest(runId: string, collectionId: string): string;
  /** APPEND an extra grade via the grading service (append-only; never mutates run totals/grades). */
  runGrader(runId: string, graderId: string): Promise<void>;
  /** Decrypt a webhook action's URL by ref (transient; undefined if the ref is unknown). */
  resolveWebhookUrl(secretRef: string): string | undefined;
  /** WP4.3 notification sink — UNDEFINED in WP4.1 => `notify` is accepted but inert. */
  notify?: (request: WatchNotifyRequest) => void;
  /** Injectable fetch for the webhook POST (a test injects a local receiver; prod uses global fetch). */
  fetchImpl?: typeof fetch;
}

/**
 * Execute ONE action for a terminal run. Fully guarded — returns an `ok:false` result on any failure
 * rather than throwing, so the engine can isolate a failing action from the others + the run pipeline.
 */
export async function executeWatchAction(
  action: WatchAction,
  ctx: { runId: string; run: WatchRunSummaryView },
  services: WatchActionServices,
): Promise<WatchRuleEventResult> {
  try {
    switch (action.type) {
      case "pin": {
        services.pinRun(ctx.runId);
        return { ok: true, detail: "pinned run" };
      }
      case "add_to_collection": {
        services.addRunToCollection(ctx.runId, action.collectionId);
        return { ok: true, detail: `added run's test to collection ${action.collectionId}` };
      }
      case "promote_to_test": {
        const testId = services.promoteRunToTest(ctx.runId, action.collectionId);
        return { ok: true, detail: `promoted draft test ${testId}` };
      }
      case "run_grader": {
        await services.runGrader(ctx.runId, action.graderId);
        return { ok: true, detail: `enqueued grader ${action.graderId}` };
      }
      case "notify": {
        if (!services.notify) {
          // WP4.3 seam — accepted + audited, but inert until the notification table + sink land.
          return {
            ok: true,
            detail: `notify (${action.severity}) accepted — inert until WP4.3`,
          };
        }
        services.notify({
          runId: ctx.runId,
          severity: action.severity,
          ...(action.template !== undefined ? { template: action.template } : {}),
        });
        return { ok: true, detail: `notify (${action.severity})` };
      }
      case "webhook": {
        return await executeWebhook(action, ctx, services);
      }
    }
  } catch (error) {
    // Guard: NEVER throw into the engine. Scrub the message so a secret can never leak via an error.
    return { ok: false, error: scrub(toMessage(error)) };
  }
}

/**
 * POST the templated JSON to the webhook's (decrypted) URL. The URL is used only to make the request —
 * NEVER placed in the result/detail/error. Bounded by {@link WATCH_WEBHOOK_TIMEOUT_MS} so a hung
 * endpoint can't stall the post-terminal review. A non-2xx or a network error is an ISOLATED,
 * audited failure (it never affects other actions or the run).
 */
async function executeWebhook(
  action: Extract<WatchAction, { type: "webhook" }>,
  ctx: { runId: string; run: WatchRunSummaryView },
  services: WatchActionServices,
): Promise<WatchRuleEventResult> {
  const url = services.resolveWebhookUrl(action.secretRef);
  if (!url) {
    // The secret ref no longer resolves (rotated/deleted) — audited, never a URL in the message.
    return { ok: false, error: "webhook secret not found" };
  }
  const body = {
    // Appended fields (WP4.1): rule/run/link — plus the caller's opaque template string, if any.
    run: ctx.run,
    link: `/testing/runs/${ctx.runId}`,
    ...(action.template !== undefined ? { template: action.template } : {}),
  };
  return postWebhook(url, body, services.fetchImpl);
}

/**
 * POST a JSON body to a (decrypted) webhook URL. Shared by the on-terminal (WP4.1) and windowed (WP4.2)
 * executors so the URL-redaction + timeout + non-2xx/network isolation live in ONE place. The URL is
 * used ONLY to make the request — NEVER placed in the result/detail/error. Exported (WP4.3) so the
 * `POST /api/watch-rules/:id/test-fire` route (`watch/webhook.ts`) reuses the SAME machinery for its
 * sample payload rather than reimplementing the timeout/redaction/isolation discipline.
 */
export async function postWebhook(
  url: string,
  body: unknown,
  fetchImpl?: typeof fetch,
): Promise<WatchRuleEventResult> {
  const impl = fetchImpl ?? fetch;
  try {
    const response = await impl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WATCH_WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      // A 4xx/5xx is a failure — audited, isolated. Only the STATUS is recorded (never the URL).
      return { ok: false, error: `webhook responded ${response.status}` };
    }
    return { ok: true, detail: `webhook responded ${response.status}` };
  } catch {
    // Network/timeout/DNS — a controlled message only (the raw error/URL is never surfaced).
    return { ok: false, error: "webhook request failed" };
  }
}

/**
 * Execute ONE action for a WINDOWED rule fire (WP4.2). A windowed rule fires on an AGGREGATE over a
 * trailing window — there is no run context — so only the ALERT actions (`notify`, `webhook`) carry
 * meaning; the run-scoped actions (`pin`/`add_to_collection`/`promote_to_test`/`run_grader`) are
 * audited as `ok:false` "not applicable" rather than silently doing nothing or crashing. Reuses the
 * SAME notify seam (inert until WP4.3) + the SAME `postWebhook` machinery as the on-terminal executor;
 * fully guarded (never throws into the scheduler).
 */
export async function executeWatchWindowAction(
  action: WatchAction,
  ctx: { window: WatchWindowSummaryView },
  services: WatchActionServices,
): Promise<WatchRuleEventResult> {
  try {
    switch (action.type) {
      case "notify": {
        if (!services.notify) {
          // WP4.3 seam — accepted + audited, inert until the notification sink lands (no scheduler change then).
          return {
            ok: true,
            detail: `notify (${action.severity}) accepted — inert until WP4.3`,
          };
        }
        services.notify({
          severity: action.severity,
          window: ctx.window,
          ...(action.template !== undefined ? { template: action.template } : {}),
        });
        return { ok: true, detail: `notify (${action.severity})` };
      }
      case "webhook": {
        const url = services.resolveWebhookUrl(action.secretRef);
        if (!url) return { ok: false, error: "webhook secret not found" };
        const body = {
          window: ctx.window,
          link: "/testing/observability/rules",
          ...(action.template !== undefined ? { template: action.template } : {}),
        };
        return postWebhook(url, body, services.fetchImpl);
      }
      default:
        // pin / add_to_collection / promote_to_test / run_grader — no run to act on. Honest + audited.
        return {
          ok: false,
          error: `action '${action.type}' requires a run; not applicable to a windowed rule`,
        };
    }
  } catch (error) {
    return { ok: false, error: scrub(toMessage(error)) };
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Defense in depth — strip anything URL-shaped from a message before it reaches an audit row, so a
 * webhook URL (or any other endpoint) can never leak via an unexpected error path.
 */
function scrub(message: string): string {
  return message.replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]");
}
