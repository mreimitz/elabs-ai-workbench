import { useId } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle, Button, Label, Text } from "@brand/ui";
import { Settings } from "lucide-react";
import type { HubLimitRetrySource } from "@mcp-token-footprint/shared";
import { HubModelPicker } from "./HubModelPicker";
import {
  findUnavailableRetrySource,
  HUB_DIRECT_RETRY_SOURCE_LABEL,
  isDirectRetrySource,
  pickHubRetryTarget,
} from "./hub-limit-retry";
import { hubCredentialLabel, hubModelTriggerLabel } from "./hub-model-picker";
import {
  findHubModelOption,
  type HubModelCredentialIssue,
  type HubModelOption,
} from "./use-hub-models";

export type HubLimitErrorBannerProps = {
  message: string;
  retrySources: HubLimitRetrySource[];
  currentModel?: string;
  /**
   * The credential the failed turn ran on (`HubSession.providerCredentialId`; `null` on a pre-v55 or
   * unpinned session). Used only to (a) select the right row in the picker when two credentials
   * expose the same model id, and (b) keep a one-click retry off the credential that just refused
   * the turn. Absent ⇒ both degrade to by-id behaviour, never to a wrong credential.
   */
  currentCredentialId?: string | null;
  /** The live hub-eligible model roster (`useHubModelRoster().models`) — the ONLY way a direct-source
   *  button (`api_key`/`subscription`) knows whether that source is actually configured. */
  roster: HubModelOption[];
  /** Credentials that exist but contribute no selectable row (`useHubModelRoster().unavailable`) —
   *  rendered visible-and-disabled in the picker (D-MI7) and used to tell "not configured" apart from
   *  "configured but broken" on a direct-source button. */
  unavailable?: readonly HubModelCredentialIssue[];
  /** True only for the TRAILING (most recent) turn — history renders message-only, no stale actions
   *  (mirrors the Assistant dock's `AssistantLimitErrorBanner`, D-AS14). */
  interactive: boolean;
  /** True while a retry is in flight (disables every control; never a silent no-op click). */
  retrying: boolean;
  /**
   * model-identity WP 4.3 (D-MI1) — a retry carries the whole roster ROW, not a bare model id.
   *
   * The old `(source, modelId: string)` signature is the user-visible face of the workstream's
   * defect: a model id cannot express which credential it came from (the subscription roster emits
   * Anthropic's canonical ids on purpose), so "Retry on subscription" sent `claude-sonnet-5` with no
   * credential and the server's name heuristic routed it straight back to the metered API key. The
   * caller turns this row into the wire with `hubModelWireFields()`.
   */
  onRetry: (source: HubLimitRetrySource, target: HubModelOption) => void;
};

/**
 * Assistant Hub (WP4.3, D-AH17 / R-SES11) — the hub's terminal limit-error banner. Mirrors the
 * Assistant dock's `AssistantLimitErrorBanner` (D-AS14): an explicit one-click "Retry on …" for each
 * source the turn engine offered (`retrySourcesFor`, `turn-engine.ts`) — but ONLY when that source is
 * actually CONFIGURED (a hub-eligible credential of that kind exists in the live roster); otherwise a
 * link to configure (or fix) one in Settings, never a dead button. `other_model` offers an inline
 * picker over the whole roster. A retry resends the turn's original user text as a NEW message with
 * the chosen model as a per-message override (`HubSendMessageInput`, R-SES10) — an honestly
 * event-sourced fresh attempt, never an in-place rewrite. Only the trailing turn is `interactive`; an
 * older `limit_error` in the transcript renders as a plain, action-free record (retrying an
 * already-superseded failure makes no sense).
 *
 * **model-identity WP 4.3 (D-MI1).** Every retry path now hands the caller a whole roster ROW —
 * model **and** credential — so "retry on the other source" actually switches source. Which row a
 * direct-source button runs on is decided by {@link pickHubRetryTarget} (deterministic order, prefers
 * the colliding twin of the failed model, never the credential that just failed) and stated in plain
 * words under the button, so the operator can see what they are about to get before clicking it.
 */
export function HubLimitErrorBanner({
  message,
  retrySources,
  currentModel,
  currentCredentialId = null,
  roster,
  unavailable = [],
  interactive,
  retrying,
  onRetry,
}: HubLimitErrorBannerProps) {
  const hintPrefix = useId();
  const directSources = retrySources.filter(isDirectRetrySource);
  const offersOtherModel = retrySources.includes("other_model");
  // D-MI7 (WP 4.1) — the `SelectField` this used to be had to COLLAPSE colliding twins (a `Select`
  // option's `value` IS the model id, and duplicate values are ambiguous), so the row an operator
  // most wanted after a metered-key limit error — the SUBSCRIPTION twin of the same model — was the
  // one it dropped. The shared picker keeps both, distinguishably.
  const currentRow = findHubModelOption(roster, currentModel ?? undefined, currentCredentialId);
  const origin = { modelId: currentModel ?? null, credentialId: currentCredentialId };

  return (
    <Alert variant="warning">
      <AlertTitle>Usage limit reached</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{message}</span>
        {interactive ? (
          <div className="flex flex-col gap-2 pt-1">
            {directSources.length > 0 ? (
              <div className="flex flex-wrap items-start gap-3">
                {directSources.map((source) => {
                  const hintId = `${hintPrefix}-${source}`;
                  const target = pickHubRetryTarget(roster, source, origin);
                  if (target) {
                    return (
                      <div key={source} className="flex min-w-0 flex-col gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-fit"
                          onClick={() => onRetry(source, target)}
                          disabled={retrying}
                          aria-describedby={hintId}
                        >
                          {retrying
                            ? "Retrying…"
                            : `Retry on ${HUB_DIRECT_RETRY_SOURCE_LABEL[source]}`}
                        </Button>
                        {/* Say exactly which model on exactly which credential this will run — the
                            whole defect was that "retry on subscription" quietly did something
                            else, and an operator had no way to see it before or after. */}
                        <Text
                          as="span"
                          id={hintId}
                          variant="caption"
                          tone="muted"
                          className="text-pretty"
                        >
                          {`Runs ${hubModelTriggerLabel(target)} on ${hubCredentialLabel(target)}.`}
                        </Text>
                      </div>
                    );
                  }
                  // The source contributes no usable row. Tell "never configured" apart from
                  // "configured but broken" — the second used to read as the first, which is the
                  // unanswerable "why did it use the other one?" D-MI9 exists to prevent.
                  const blocked = findUnavailableRetrySource(unavailable, source);
                  return (
                    <div key={source} className="flex min-w-0 flex-col gap-1">
                      <Button size="sm" variant="outline" className="w-fit" asChild>
                        <Link to="/settings" aria-describedby={blocked ? hintId : undefined}>
                          <Settings aria-hidden />
                          <span>
                            {blocked
                              ? `Fix ${blocked.label} in Settings to retry`
                              : `Configure ${HUB_DIRECT_RETRY_SOURCE_LABEL[source]} in Settings to retry`}
                          </span>
                        </Link>
                      </Button>
                      {blocked ? (
                        <Text
                          as="span"
                          id={hintId}
                          variant="caption"
                          tone="muted"
                          className="text-pretty"
                        >
                          {blocked.reason}
                        </Text>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {offersOtherModel && roster.length > 0 ? (
              <div className="flex max-w-xs flex-col gap-1.5">
                <Label htmlFor="hub-limit-error-other-model">Retry with a different model</Label>
                <HubModelPicker
                  id="hub-limit-error-other-model"
                  name="Retry with a different model"
                  models={roster}
                  unavailable={unavailable}
                  value={currentRow ?? null}
                  fallbackModelId={currentModel ?? null}
                  placeholder="Choose a model…"
                  disabled={retrying}
                  dialogTitle="Retry with a different model"
                  // The picked ROW travels, credential and all — the picker is the one surface that
                  // can already tell two same-id twins apart, and this is what stops the wire from
                  // throwing that away again.
                  onChange={(option) => onRetry("other_model", option)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
