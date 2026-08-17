import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle, Button } from "@elabs-ai/components-ui";
import { Settings } from "lucide-react";
import type {
  AssistantAuthSource,
  AssistantAuthStatus,
  AssistantLimitErrorKind,
} from "@mcp-token-footprint/shared";

export type AssistantLimitErrorBannerProps = {
  message: string;
  source: AssistantAuthSource;
  kind?: AssistantLimitErrorKind;
  /** `null` while still loading — the banner degrades to "configure in Settings" until it resolves. */
  authStatus: AssistantAuthStatus | null;
  /** True only for the TRAILING (most recent) turn — history renders message-only, no stale actions. */
  interactive: boolean;
  /** True while a retry-source POST is in flight (disables the button; never a silent no-op click). */
  retrying: boolean;
  onRetry: (source: AssistantAuthSource) => void;
};

/**
 * WP 3.3 (D-AS14) — the terminal limit-error banner. A `limit_error` is ALREADY a settled event by the
 * time this renders (never mid-stream — see `.claude/rules/loading-states.md`), so there is no
 * "loading" variant to build here. Offers an explicit one-click "Retry on …" ONLY when the OTHER auth
 * source is actually configured (never a silent fallback — D-AS14's whole point); otherwise a link to
 * configure one in Settings. An `auth`-kind failure additionally hints at re-signing-in
 * (subscription) or re-checking the key (api_key) — a `rate_limit` kind needs neither, just the retry.
 * Only the trailing turn is `interactive`; older `limit_error`s in the transcript render as a plain,
 * action-free record (retrying an already-superseded failure makes no sense).
 */
export function AssistantLimitErrorBanner({
  message,
  source,
  kind,
  authStatus,
  interactive,
  retrying,
  onRetry,
}: AssistantLimitErrorBannerProps) {
  const otherSource: AssistantAuthSource = source === "subscription" ? "api_key" : "subscription";
  const otherLabel = otherSource === "api_key" ? "API key" : "subscription";
  const otherConfigured =
    otherSource === "api_key"
      ? (authStatus?.fallbackConfigured ?? false)
      : (authStatus?.signedIn ?? false);

  return (
    <Alert variant="warning">
      <AlertTitle>
        {source === "subscription" ? "Subscription limit reached" : "API-key limit reached"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{message}</span>
        {interactive && kind === "auth" ? (
          <span className="text-muted-foreground">
            {source === "subscription"
              ? "Your subscription sign-in may have expired — sign in again in Settings."
              : "The API-key fallback may be invalid or revoked — check it in Settings."}
          </span>
        ) : null}
        {interactive ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {otherConfigured ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRetry(otherSource)}
                disabled={retrying}
              >
                {retrying ? "Retrying…" : `Retry on ${otherLabel}`}
              </Button>
            ) : (
              <Button size="sm" variant="outline" asChild>
                <Link to="/settings">
                  <Settings aria-hidden />
                  <span>{`Configure ${otherLabel} in Settings to retry`}</span>
                </Link>
              </Button>
            )}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
