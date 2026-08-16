/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * Claude subscription token — the ONE panel that owns the stored `sk-ant-oat01-…` token.
 *
 * Rendered in two places, so the two can never drift:
 *   • Settings → Assistant   (the dock's sign-in, plus its API-key fallback, which stays there)
 *   • Settings → Providers   (inside the credential modal for an `claude_subscription` kind)
 *
 * WHY THERE IS NO "signed in as <email>" HERE (owner decision, 2026-07-28)
 * ------------------------------------------------------------------------
 * The token this app stores is a LONG-LIVED token minted by the Anthropic CLI's `setup-token`
 * flow. Anthropic scopes those tokens to INFERENCE ONLY — verified against the live API with the
 * stored token: `GET /api/oauth/profile`, `GET /api/oauth/claude_cli/roles` and
 * `POST /api/oauth/validate` all return 403 `permission_error` ("does not meet scope requirement
 * user:profile"). The token is opaque (no JWT claims to decode), the CLI deliberately prints no
 * "Logged in as …" line for this flow, and it persists no account record in its config dir. So the
 * account identity is genuinely NOT derivable from anything we hold — this panel must never
 * fabricate one. Surfacing the real account requires running the OAuth exchange ourselves with a
 * `user:profile` scope; that is parked as a workstream (see roadmap/assistant/wp-oauth-identity.md).
 *
 * What the panel does instead: state the constraint plainly, and give the owner a first-class way
 * to RESET the token (delete it + end live sessions) and mint a fresh one — which is also how you
 * switch to a different Claude account.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */
import { useState } from "react";
import type { AssistantAuthStatus } from "@mcp-token-footprint/shared";
import { ASSISTANT_TOKEN_EXPIRY_WARNING_DAYS } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  Separator,
  Spinner,
  Text,
  cn,
  toast,
} from "@brand/ui";
import { Copy, ExternalLink, Info, KeyRound, RotateCcw, Sparkles } from "lucide-react";
import { ConfirmDialog } from "../../components/dialogs";
import { IconButton } from "../../components/IconButton";
import {
  cancelAssistantOauth,
  completeAssistantOauth,
  signOutAssistant,
  startAssistantOauth,
  storeAssistantToken,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

export function ClaudeSubscriptionAuthPanel(props: {
  /** The redacted auth status (never a token). `null` while the parent is still loading it. */
  status: AssistantAuthStatus | null;
  loading?: boolean;
  /** Called with the fresh status after every mutation so the parent's own view stays in sync. */
  onStatusChange: (next: AssistantAuthStatus) => void;
  /** Disambiguates input ids when more than one instance could mount. */
  idPrefix?: string;
  /**
   * Compact mode for the Providers credential modal: drops the manual paste-token field (that path
   * stays in Settings → Assistant) and bounds the panel's own height. `DialogContent` at sizes
   * sm/lg/xl carries NO max-height and NO overflow (only `size="full"` does), so an unbounded panel
   * inside a `FormDialog` would run off-screen on a short viewport — this keeps the dialog whole.
   */
  compact?: boolean;
}) {
  const idPrefix = props.idPrefix ?? "assistant";
  const compact = props.compact ?? false;

  // PTY sign-in flow state.
  const [flow, setFlow] = useState<{ flowId: string; authUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  // Paste-token + reset state.
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const status = props.status;
  const signedIn = status?.signedIn ?? false;
  const nearExpiry =
    signedIn &&
    typeof status?.tokenAgeDays === "number" &&
    status.tokenAgeDays >= ASSISTANT_TOKEN_EXPIRY_WARNING_DAYS;

  async function onStart() {
    setStarting(true);
    setFlowError(null);
    try {
      setFlow(await startAssistantOauth());
      setCode("");
    } catch (error) {
      setFlowError(getErrorMessage(error, "Couldn’t start sign-in. Paste a token below instead."));
    } finally {
      setStarting(false);
    }
  }

  async function onComplete() {
    if (!flow || !code.trim()) return;
    setCompleting(true);
    setFlowError(null);
    try {
      props.onStatusChange(await completeAssistantOauth(flow.flowId, code.trim()));
      setFlow(null);
      setCode("");
      toast.success("Signed in to Claude");
    } catch (error) {
      setFlowError(
        getErrorMessage(error, "Couldn’t complete sign-in. Paste a token below instead."),
      );
    } finally {
      setCompleting(false);
    }
  }

  async function onCancelFlow() {
    const active = flow;
    setFlow(null);
    setCode("");
    setFlowError(null);
    if (active) {
      try {
        await cancelAssistantOauth(active.flowId);
      } catch {
        // Best-effort — a stale/expired flow cancels itself server-side regardless.
      }
    }
  }

  async function onSaveToken() {
    if (!tokenInput.trim()) return;
    setSavingToken(true);
    try {
      props.onStatusChange(await storeAssistantToken(tokenInput.trim()));
      setTokenInput("");
      toast.success("Token saved");
    } catch (error) {
      notifyError("Couldn’t save the token. Try again.", { description: getErrorMessage(error) });
    } finally {
      setSavingToken(false);
    }
  }

  async function onReset() {
    setPendingReset(false);
    setResetting(true);
    try {
      props.onStatusChange(await signOutAssistant());
      toast.success("Token reset — sign in again to mint a fresh one");
    } catch (error) {
      notifyError("Couldn’t reset the token. Try again.", { description: getErrorMessage(error) });
    } finally {
      setResetting(false);
    }
  }

  async function copyAuthUrl() {
    if (!flow) return;
    try {
      await navigator.clipboard.writeText(flow.authUrl);
      toast.success("Authorization URL copied");
    } catch {
      notifyError("Couldn’t copy the URL", {
        description: "Select the URL and copy it manually.",
      });
    }
  }

  if (props.loading || !status) {
    return (
      <div className="flex items-center gap-2">
        <Spinner className="size-4" />
        <Text variant="meta" tone="muted">
          Loading sign-in status…
        </Text>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        compact && "max-h-[60vh] overflow-y-auto overscroll-contain pr-1",
      )}
    >
      {/* Status summary — everything we can honestly report about the stored token. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {signedIn ? (
          <Badge variant="success">Signed in</Badge>
        ) : (
          <Badge variant="warning">Not signed in</Badge>
        )}
        {signedIn && typeof status.tokenAgeDays === "number" ? (
          <Text variant="meta" tone="muted">
            Token age: <span className="tabular-nums">{status.tokenAgeDays}</span>{" "}
            {status.tokenAgeDays === 1 ? "day" : "days"}
          </Text>
        ) : null}
        {signedIn && status.tokenCreatedAt ? (
          <Text variant="meta" tone="muted">
            Stored {new Date(status.tokenCreatedAt).toLocaleDateString()}
          </Text>
        ) : null}
      </div>

      {nearExpiry ? (
        <Alert variant="warning">
          <AlertDescription>
            This token is close to its one-year expiry. Sign in again to refresh it before it
            lapses.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* The account-identity constraint, stated plainly rather than guessed at. */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Text variant="meta" tone="muted">
          <span className="font-medium text-foreground">Which account is this?</span> The stored
          token is a long-lived subscription token minted by the Anthropic&nbsp;CLI. Anthropic
          scopes those tokens to inference only, so the token carries no account or organization
          identity and this app cannot show which Claude account it belongs to. If you keep more
          than one, name the credential after its account.
        </Text>
      </div>

      <Separator />

      {/* Sign in / re-sign in — the PTY flow. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <Text className="font-medium">{signedIn ? "Re-sign in" : "Sign in with Claude"}</Text>
          <Text variant="meta" tone="muted">
            Opens an authorization page in your browser; paste the code it gives you back here.
          </Text>
        </div>

        {flowError ? (
          <Alert variant="destructive">
            <AlertDescription>{flowError}</AlertDescription>
          </Alert>
        ) : null}

        {flow ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <Text variant="meta" tone="muted">
                Open this URL in your browser to authorize, then paste the code below. To use a
                different Claude account, open it in a browser window signed in to that account — a
                private window is the simplest way to force the account picker.
              </Text>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono text-meta">
                  {flow.authUrl}
                </code>
                <Button asChild size="sm" variant="outline">
                  <a href={flow.authUrl} target="_blank" rel="noreferrer">
                    <ExternalLink aria-hidden />
                    <span>Open</span>
                  </a>
                </Button>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label="Copy authorization URL"
                  onClick={() => void copyAuthUrl()}
                >
                  <Copy aria-hidden />
                </IconButton>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${idPrefix}-auth-code`}>Authorization code</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id={`${idPrefix}-auth-code`}
                  className="min-w-0 flex-1"
                  value={code}
                  placeholder="Paste the code from your browser…"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setCode(event.target.value)}
                />
                <Button onClick={() => void onComplete()} disabled={completing || !code.trim()}>
                  {completing ? <Spinner className="size-4" /> : null}
                  <span>Submit code</span>
                </Button>
                <Button variant="outline" onClick={() => void onCancelFlow()} disabled={completing}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <Button onClick={() => void onStart()} disabled={starting}>
              {starting ? <Spinner className="size-4" /> : <Sparkles aria-hidden />}
              <span>{signedIn ? "Re-sign in with Claude" : "Sign in with Claude"}</span>
            </Button>
          </div>
        )}
      </div>

      {compact ? null : (
        <>
          <Separator />

          {/* Manual paste path. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-token`}>Or paste a Claude subscription token</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`${idPrefix}-token`}
                type="password"
                name="assistant-oauth-token"
                className="min-w-0 flex-1"
                value={tokenInput}
                placeholder="sk-ant-oat01-…"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setTokenInput(event.target.value)}
              />
              <Button
                onClick={() => void onSaveToken()}
                disabled={savingToken || !tokenInput.trim()}
              >
                {savingToken ? <Spinner className="size-4" /> : <KeyRound aria-hidden />}
                <span>Save token</span>
              </Button>
            </div>
            <Text variant="meta" tone="muted">
              Stored encrypted; never shown again. Saving a token replaces the stored one.
            </Text>
          </div>
        </>
      )}

      {signedIn ? (
        <>
          <Separator />

          {/* Reset — the answer to "how do I change the signed-in account?". */}
          <div className="flex flex-col gap-2">
            <Text className="font-medium">Reset the token</Text>
            <Text variant="meta" tone="muted">
              Deletes the stored token from this machine and ends any active assistant sessions.
              Nothing else is lost — sign in again above to mint a fresh one.{" "}
              <span className="text-foreground">To switch to a different Claude account:</span>{" "}
              reset here, then start sign-in and authorize in a browser signed in to the account you
              want.
            </Text>
            <div>
              <Button variant="outline" onClick={() => setPendingReset(true)} disabled={resetting}>
                {resetting ? <Spinner className="size-4" /> : <RotateCcw aria-hidden />}
                <span>Reset token</span>
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={pendingReset}
        onOpenChange={(open) => !open && setPendingReset(false)}
        title="Reset the stored Claude token?"
        description="This deletes the token from this machine and ends any active assistant sessions. You can sign in again at any time — including with a different Claude account."
        confirmLabel="Reset token"
        tone="destructive"
        onConfirm={() => void onReset()}
      />
    </div>
  );
}
