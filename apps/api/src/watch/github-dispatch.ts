// Observability — the GitHub Actions `workflow_dispatch` sender (RM-17 Phase 6, AM-OB11).
//
// The ONE place in the app that POSTs to GitHub's `workflow_dispatch` endpoint, and the ONE place a
// watch action reads the connected GitHub account's token. It is deliberately tiny and deliberately
// paranoid:
//
//   * NO CREDENTIAL EVER LEAVES. The token is read from the injected `token()` seam, used to build
//     one `Authorization` header, and dropped. It is never returned, never put in a
//     `WatchRuleEventResult` (which is persisted verbatim into `watch_rule_events.result_json`),
//     never logged, and never included in a thrown error. `dispatchGithubWorkflow` never throws:
//     every path returns a controlled, enumerated message.
//   * NO RESPONSE BODY IS ECHOED. GitHub's 4xx bodies can quote request content; only the numeric
//     STATUS reaches the audit row.
//   * NO INPUT VALUE IS ECHOED. `inputs` are the operator's — possibly a ref, a filter, a token-ish
//     string — so an audit line names the repository, the workflow and the ref, and says HOW MANY
//     inputs were sent, never which or what.
//   * THE TARGET IS RE-VALIDATED HERE. `actions_json` is a blob; a hand-edited row could carry an
//     `owner` this app's zod never saw. `workflowDispatchUrl` refuses an invalid target rather than
//     emitting a URL, so there is no path from a bad row to a credentialed `fetch`.
//
// FAILURE MODEL — deliberately the webhook's, not a second one (see `postWebhook` in `actions.ts`):
// ONE attempt, a bounded timeout, an isolated + audited failure. No retry, no backoff, no
// dead-letter, and no polling of the dispatched run: dispatch is fire-and-record.
//
// WHY NO RUN CONTEXT IS APPENDED: GitHub REJECTS (422) a `workflow_dispatch` input the workflow file
// does not declare. Unlike the webhook — which can append `run`/`link`/`template` freely — this
// sender can only send what the operator configured, so it sends exactly that and nothing else.

import {
  validateWorkflowDispatchTarget,
  WATCH_WORKFLOW_DISPATCH_TIMEOUT_MS,
  workflowDispatchUrl,
  type WatchRuleEventResult,
  type WatchWorkflowDispatchTarget,
} from "@mcp-token-footprint/shared";

/** The seams a dispatch needs. Both are INJECTED so the gate never makes a real GitHub call and
 *  never touches a real credential store (conventions §12). */
export interface GithubDispatchDeps {
  /** The connected account's DECRYPTED token, or `undefined` when no account is connected. In-process
   *  use only — the returned value is placed in one header and dropped. */
  token: () => string | undefined;
  /** Injectable fetch (a test injects a local recorder; prod uses global `fetch`). */
  fetchImpl?: typeof fetch;
}

/** GitHub's REST media type + the API version it pins. Neither is a secret. */
const GITHUB_ACCEPT = "application/vnd.github+json";
const GITHUB_API_VERSION = "2022-11-28";

/**
 * Dispatch ONE GitHub Actions workflow. Returns a `WatchRuleEventResult` — never throws, so a
 * failing dispatch is an isolated, audited action and never affects the other actions or the run
 * pipeline. A 204 (GitHub's success for this endpoint) is the only `ok:true`.
 */
export async function dispatchGithubWorkflow(
  target: WatchWorkflowDispatchTarget,
  deps: GithubDispatchDeps,
): Promise<WatchRuleEventResult> {
  // 1. Re-validate the row. A rule that never went through the wire schema (hand-edited
  //    `actions_json`, a legacy blob) must not reach `fetch`. The message names the FIELD, never
  //    the value — this string lands in an audit row.
  const check = validateWorkflowDispatchTarget(target);
  if (!check.ok) {
    return { ok: false, error: `workflow dispatch refused — invalid ${check.field}` };
  }

  // 2. The credential. An absent account is an honest, actionable failure, never a silent no-op.
  const token = deps.token();
  if (!token) {
    return {
      ok: false,
      error: "workflow dispatch refused — no GitHub account is connected (connect one in Settings)",
    };
  }

  const url = workflowDispatchUrl(target);
  const inputCount = target.inputs ? Object.keys(target.inputs).length : 0;
  // The one non-secret identity a result may carry: what the operator typed and the API already
  // returns in the rule itself. Input KEYS and VALUES are deliberately absent.
  const where = `${target.repo} · ${target.workflow} @ ${target.ref}`;

  const impl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await impl(url, {
      method: "POST",
      headers: {
        // The ONLY place the token is used. Never logged, never returned.
        authorization: `Bearer ${token}`,
        accept: GITHUB_ACCEPT,
        "content-type": "application/json",
        "x-github-api-version": GITHUB_API_VERSION,
      },
      body: JSON.stringify({
        ref: target.ref,
        ...(inputCount > 0 ? { inputs: target.inputs } : {}),
      }),
      signal: AbortSignal.timeout(WATCH_WORKFLOW_DISPATCH_TIMEOUT_MS),
    });
  } catch {
    // Network/timeout/DNS — a controlled message only. The raw error can carry the URL (and, on some
    // runtimes, request detail), so it is never surfaced.
    return { ok: false, error: "workflow dispatch request failed" };
  }

  if (response.status === 204) {
    return {
      ok: true,
      detail: `dispatched ${where}${inputCount > 0 ? ` · ${inputCount} input${inputCount === 1 ? "" : "s"}` : ""}`,
    };
  }
  return { ok: false, error: describeFailure(response.status, where) };
}

/**
 * Turn a non-204 status into a readable, NON-LEAKING reason. GitHub's own error body is deliberately
 * ignored — it can quote the request (including input values) back at us, and this string is
 * persisted into an audit row and rendered in the notification centre.
 */
function describeFailure(status: number, where: string): string {
  switch (status) {
    case 401:
      return `workflow dispatch rejected (401) for ${where} — the connected GitHub account's credential was refused; reconnect it in Settings`;
    case 403:
      return `workflow dispatch refused (403) for ${where} — the connected GitHub account is not allowed to run Actions on that repository`;
    case 404:
      return `workflow dispatch not found (404) for ${where} — check the owner, repository and workflow file, and that the workflow declares a workflow_dispatch trigger`;
    case 422:
      return `workflow dispatch rejected (422) for ${where} — check the ref exists and the inputs match the ones the workflow declares`;
    default:
      return `workflow dispatch responded ${status} for ${where}`;
  }
}
