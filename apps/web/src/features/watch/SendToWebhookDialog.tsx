import { useEffect, useState } from "react";
import type { ManualSendPayload, WatchRule } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { Link2Off, TriangleAlert } from "lucide-react";
import { FormDialog } from "../../components/dialogs";
import { FieldRow } from "../../components/FieldRow";
import {
  getRunWebhookPayload,
  getSuiteRunWebhookPayload,
  listWatchRules,
  sendRunToWebhook,
  sendSuiteRunToWebhook,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { CodeSnippet } from "../testing/CodeSnippet";

/**
 * RM-17 Phase 6 (AM-OB13) — "Send to webhook…", reached from the run console's overflow menu and
 * the suite-run console's. A transient task with a start and an end, so it is a DIALOG, not a route
 * (`.claude/rules/routes-vs-dialogs.md`, D-TB10): nothing here is worth bookmarking, and there is
 * nothing to come back to once it closes.
 *
 * TWO THINGS AN OPERATOR MUST SEE BEFORE SENDING, AND THEY ARE DIFFERENT THINGS
 *   - WHERE it goes. Never a URL — a webhook destination is encrypted server-side and does not
 *     cross this boundary. It is named by the watch rule that owns it, which is also the only place
 *     that destination was ever typed.
 *   - WHAT goes. The exact bytes, from `GET …/webhook-payload`, which builds through the SAME code
 *     the send does. This is real run data leaving the app to somebody else's system, so "send" is
 *     never a blind action.
 *
 * A rule can only be a candidate destination if it carries a `webhook` action; the list comes
 * straight off `listWatchRules()` (no endpoint of its own). When none does, the dialog says what to
 * do about it rather than showing an empty picker.
 */
export type SendToWebhookSubject =
  | { kind: "run"; id: string }
  | { kind: "suite-run"; id: string };

export function SendToWebhookDialog({
  open,
  onOpenChange,
  subject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: SendToWebhookSubject;
}) {
  const noun = subject.kind === "run" ? "run" : "suite run";
  const [destinations, setDestinations] = useState<WatchRule[]>([]);
  const [ruleId, setRuleId] = useState<string>("");
  const [payload, setPayload] = useState<ManualSendPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `null` = the preview has not settled (loading, or the lookup failed) — so "nothing will be
  // sent" is never rendered from an unfinished fetch.
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPreviewError(null);
    setSending(false);
    setLoading(true);
    setPayload(null);
    let active = true;

    const loadPayload =
      subject.kind === "run"
        ? getRunWebhookPayload(subject.id)
        : getSuiteRunWebhookPayload(subject.id);

    Promise.all([
      listWatchRules().then((rules) => rules.filter(hasWebhookAction)),
      loadPayload.then(
        (value) => ({ ok: true as const, value }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
    ])
      .then(([rules, preview]) => {
        if (!active) return;
        setDestinations(rules);
        setRuleId(rules[0]?.id ?? "");
        if (preview.ok) setPayload(preview.value);
        else
          setPreviewError(
            getErrorMessage(preview.err, `Couldn’t load what would be sent for this ${noun}.`),
          );
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            getErrorMessage(err, "Couldn’t load your webhook destinations. Close and reopen to retry."),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, subject.kind, subject.id, noun]);

  async function submit() {
    if (!ruleId) {
      setError("Pick a destination.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const result =
        subject.kind === "run"
          ? await sendRunToWebhook(subject.id, ruleId)
          : await sendSuiteRunToWebhook(subject.id, ruleId);
      const destination = destinations.find((rule) => rule.id === ruleId)?.name ?? "the webhook";
      if (!result.ok) {
        // A destination-side failure is an OUTCOME the server already audited, not an exception —
        // keep the dialog open with the reason so the operator can pick another destination.
        setError(result.error ?? `Sending this ${noun} failed.`);
        return;
      }
      onOpenChange(false);
      toast.success(`Sent to ${destination}`, {
        description: result.detail ?? `This ${noun} was posted to the webhook.`,
      });
    } catch (err) {
      setError(getErrorMessage(err, `Couldn’t send this ${noun}. Try again.`));
    } finally {
      setSending(false);
    }
  }

  const noDestinations = !loading && destinations.length === 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Send this ${noun} to a webhook`}
      description={`Posts this ${noun}'s summary and links to a destination you already configured on a watch rule. Nothing about the ${noun} changes.`}
      primaryLabel="Send"
      onSubmit={() => void submit()}
      busy={sending}
      submitDisabled={loading || noDestinations || !ruleId}
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <Spinner className="size-4" />
          <Text variant="meta" tone="muted">
            Loading destinations…
          </Text>
        </div>
      ) : noDestinations ? (
        <Alert>
          <Link2Off aria-hidden />
          <AlertTitle>No webhook destination is configured</AlertTitle>
          <AlertDescription>
            A destination is a watch rule with a webhook action — that is where its URL is stored,
            encrypted. Add one under Observability → Rules, then come back here.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <FieldRow id="send-webhook-destination" label="Destination" error={error ?? undefined}>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger id="send-webhook-destination" aria-invalid={error ? true : undefined}>
                <SelectValue placeholder="Select a destination…" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((rule) => (
                  <SelectItem key={rule.id} value={rule.id}>
                    {rule.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Text variant="meta" tone="muted">
              Named by the watch rule that owns it. The URL itself stays encrypted on the server and
              is never shown here.
            </Text>
          </FieldRow>

          {payload ? (
            <CodeSnippet
              label="What will be sent"
              ariaLabel={`The exact payload that will be posted for this ${noun}`}
              value={JSON.stringify(payload, null, 2)}
            />
          ) : previewError ? (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertTitle>Couldn’t show what would be sent</AlertTitle>
              <AlertDescription>{previewError}</AlertDescription>
            </Alert>
          ) : null}

          {payload && !payload.link.startsWith("http") ? (
            <Alert>
              <TriangleAlert aria-hidden />
              <AlertTitle>The links will not be clickable</AlertTitle>
              <AlertDescription>
                This deployment has not been told its own address, so the links go out as
                app-relative paths. Set <code>APP_BASE_URL</code> to the URL you reach this app at
                and they become full links.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      )}
    </FormDialog>
  );
}

/** A rule is a candidate destination exactly when it carries a `webhook` action. */
function hasWebhookAction(rule: WatchRule): boolean {
  return rule.actions.some((action) => action.type === "webhook");
}
