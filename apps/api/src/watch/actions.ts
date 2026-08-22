// Observability — the CLOSED watch-rule action set + its executor (planning/Roadmap/RM-17-observability/, WP4.1).
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
  type WatchRunSummaryView,
  type WatchAction,
  type WatchNotifySeverity,
  type WatchRuleEventResult,
  type WatchWindowLevel,
  type WatchWorkflowDispatchTarget,
} from "@mcp-token-footprint/shared";
import { appPath, outboundUrl } from "./outbound-link.js";

/**
 * The compact run view the webhook payload carries (no secrets — a summary of the terminal run).
 *
 * AM-OB13 moved the DEFINITION to `packages/shared/src/manual-send.ts`, because the hand-driven send
 * previews the same payload in the browser, so the shape is genuinely on the wire. Re-exported from
 * here so every existing importer (`engine.ts`, the tests) is unchanged — and so a manual send and a
 * rule fire can never describe the same run with two different shapes.
 */
export type { WatchRunSummaryView };

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
  /** The breach-direction extreme measure value; null for a NO-DATA fire (AM-OB10) — never 0. */
  value: number | null;
  /** True when the window completed while the app was away (boot catch-up). */
  late: boolean;
  /** AM-OB10 — the rule's optional WARNING threshold, when it has one (so an alert can say which of
   *  the two levels was crossed and what the other one is). */
  warnThreshold?: number;
  /** AM-OB10 — the severity LEVEL this fire reached. Absent on a single-threshold rule (always an
   *  alert) and on a no-data fire. The level is INDEPENDENT of the notify action's severity: it says
   *  which threshold was crossed, while the notification goes out at the rule's configured severity
   *  whichever one it was (owner decision 2026-08-22). */
  level?: WatchWindowLevel;
  /** AM-OB10 — true when the window contained NO runs and the rule's no-data policy is `notify`.
   *  `value` is then null: silence is the signal, not a fabricated zero. */
  noData?: boolean;
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
  /**
   * AM-OB11 — send a GitHub Actions `workflow_dispatch`. REQUIRED, not optional: unlike the WP4.3
   * `notify` seam (which was a placeholder for something unbuilt), the sender exists, so an
   * omitted wiring would make a configured action silently inert in production. Injected so the
   * gate never makes a real GitHub call and never reads a real credential (conventions §12); the
   * implementation is `watch/github-dispatch.ts`, the ONLY place the account token is read.
   */
  dispatchWorkflow(target: WatchWorkflowDispatchTarget): Promise<WatchRuleEventResult>;
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
      case "workflow_dispatch": {
        // AM-OB11 — the ONLY action that can start work OUTSIDE this app. It carries no run context
        // by construction (GitHub 422s an undeclared input), so the on-terminal and windowed paths
        // hand the dispatcher the identical target — see `executeWatchWindowAction`.
        return await services.dispatchWorkflow(toDispatchTarget(action));
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
    // AM-OB13 — ABSOLUTE when the deployment set `APP_BASE_URL`, the same bare path as before when
    // it did not. The path itself comes from the one vocabulary (`outbound-link.ts`), never inline.
    link: outboundUrl(appPath.run(ctx.runId)),
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
        // Owner decision 2026-08-22 — the severity is EXACTLY what the rule configured, at every
        // crossing level. AM-OB10 shipped a warn→one-step-down demotion; it was overturned, because
        // an author who set `critical` meant it and could not see that a warn arrived as `warning`.
        // The LEVEL that fired still rides on `ctx.window.level` (and the audit row) beside it.
        const severity = action.severity;
        if (!services.notify) {
          // WP4.3 seam — accepted + audited, inert until the notification sink lands (no scheduler change then).
          return {
            ok: true,
            detail: `notify (${severity}) accepted — inert until WP4.3`,
          };
        }
        services.notify({
          severity,
          window: ctx.window,
          ...(action.template !== undefined ? { template: action.template } : {}),
        });
        return { ok: true, detail: `notify (${severity})` };
      }
      case "webhook": {
        const url = services.resolveWebhookUrl(action.secretRef);
        if (!url) return { ok: false, error: "webhook secret not found" };
        const body = {
          window: ctx.window,
          link: outboundUrl(appPath.watchRules()),
          ...(action.template !== undefined ? { template: action.template } : {}),
        };
        return postWebhook(url, body, services.fetchImpl);
      }
      case "workflow_dispatch": {
        // AM-OB11 — this action IS meaningful for a windowed rule, and that is the point of it: "the
        // error rate crossed 30% over 6h" is exactly when you want CI to re-run the suite. So it must
        // NOT fall into the "requires a run" default below. The target is identical to the
        // on-terminal path's, because GitHub rejects any input the workflow does not declare, so
        // there is no window context to append even if we wanted to.
        return await services.dispatchWorkflow(toDispatchTarget(action));
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

/**
 * AM-OB11 — strip the discriminator off a `workflow_dispatch` action so the dispatcher receives the
 * plain target. Written out field by field (not `{...action}` minus `type`) so a field added to the
 * action later is a COMPILE error here rather than something silently forwarded to GitHub.
 */
function toDispatchTarget(
  action: Extract<WatchAction, { type: "workflow_dispatch" }>,
): WatchWorkflowDispatchTarget {
  return {
    owner: action.owner,
    repo: action.repo,
    workflow: action.workflow,
    ref: action.ref,
    ...(action.inputs !== undefined ? { inputs: action.inputs } : {}),
  };
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
