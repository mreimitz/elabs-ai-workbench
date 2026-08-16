import { useCallback, useState } from "react";
import { Alert, AlertDescription, AlertTitle, toast } from "@brand/ui";
import { Composer as BrandComposer } from "@brand/ai";
import { Lock } from "lucide-react";
import { sendTurn } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

/**
 * The interactive composer (UI §3): the canonical `@brand/ai` `Composer` (v1.5.0) — the two-tone
 * "double card" with a muted status strip over a recessed `PromptInput` well and a circular send —
 * wired to post the next user turn into a live interactive run via `sendTurn` (`lib/api.ts` —
 * imported, never re-implemented). We keep it text-only: the model is shown on the run-bar (so no
 * pill), and a turn carries no attachments/voice in the v1 wire (`sendTurn` is text-only — see
 * `apps/api/src/testing/`), so those affordances are off rather than faked. Enter sends; Shift+Enter
 * adds a newline (PromptInput's built-in behaviour). The send button shows the submitted state while
 * the request is in flight, and a failure surfaces as a toast.
 *
 * In **automated** mode there is no composer — input is locked — so a quiet note renders instead.
 */
export function Composer({
  runId,
  mode,
  /** When false (run finished / not awaiting input), the composer ignores submits with a hint. */
  canSend,
}: {
  runId: string | null;
  mode: "automated" | "interactive";
  canSend: boolean;
}) {
  if (mode === "automated") {
    return (
      <Alert>
        <Lock aria-hidden />
        <AlertTitle>Automated run — input is locked</AlertTitle>
        <AlertDescription>
          The harness drives this run end-to-end. Switch to an interactive run to send turns
          yourself.
        </AlertDescription>
      </Alert>
    );
  }
  return <InteractiveComposer runId={runId} canSend={canSend} />;
}

function InteractiveComposer({ runId, canSend }: { runId: string | null; canSend: boolean }) {
  const [sending, setSending] = useState(false);
  const disabled = runId === null || !canSend;

  const submit = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (sending || disabled || trimmed.length === 0 || runId === null) return;
      setSending(true);
      try {
        await sendTurn(runId, trimmed);
      } catch (error) {
        notifyError("Couldn’t send the message.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      } finally {
        setSending(false);
      }
    },
    [disabled, runId, sending],
  );

  return (
    <BrandComposer
      placeholder="Message the agent…"
      status={
        sending
          ? "Sending…"
          : disabled
            ? "The run isn't awaiting a turn right now."
            : "Awaiting your input"
      }
      // Model is shown on the run-bar; turns are text-only, so no model pill / voice / attach.
      model={null}
      showVoice={false}
      showAttach={false}
      sendStatus={sending ? "submitted" : "ready"}
      onSubmit={(message) => {
        void submit(message.text ?? "");
      }}
    />
  );
}
