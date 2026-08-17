import { useState } from "react";
import { CheckCircle2, EyeOff, RotateCcw } from "lucide-react";
import { Button, Label, Textarea, toast } from "@elabs-ai/components-ui";
import { ConfirmDialog } from "../../components/dialogs";
import { ignoreIssue, reopenIssue, resolveIssue } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import type { FleetIssue } from "./issue-lib";
import { notifyError } from "../../lib/notify";

type PendingAction = "resolve" | "ignore" | "reopen" | null;

/**
 * The detail's lifecycle actions (WP5.3 spec §Design: "Resolve w/ note · Ignore · Reopen"). Every
 * action goes through the modal system's Tier-1 `ConfirmDialog` (acceptance #2: resolve REQUIRES the
 * confirm tier) — Resolve/Ignore additionally collect an optional operator note (the `children` slot
 * ConfirmDialog exposes for exactly this "≤1 extra field" case). On success the caller's `onChanged`
 * refetches the issue (no optimistic mutation — mirrors `IssuesPanel`'s resolve/re-open recipe).
 */
export function IssueLifecycleActions({
  issue,
  onChanged,
}: {
  issue: FleetIssue;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<PendingAction>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const lifecycle = issue.fleet.lifecycle;

  function openDialog(action: PendingAction) {
    setNote("");
    setPending(action);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const trimmed = note.trim();
      if (pending === "resolve") {
        await resolveIssue(issue.id, trimmed.length > 0 ? trimmed : undefined);
        toast.success("Issue resolved");
      } else if (pending === "ignore") {
        await ignoreIssue(issue.id, trimmed.length > 0 ? trimmed : undefined);
        toast.success("Issue ignored");
      } else {
        await reopenIssue(issue.id);
        toast.success("Issue reopened");
      }
      setPending(null);
      onChanged();
    } catch (cause) {
      const failedVerb =
        pending === "resolve" ? "resolve" : pending === "ignore" ? "ignore" : "reopen";
      notifyError(`Couldn’t ${failedVerb} the issue. Try again.`, {
        description: getErrorMessage(cause),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {lifecycle !== "resolved" ? (
        <Button variant="outline" size="sm" onClick={() => openDialog("resolve")}>
          <CheckCircle2 aria-hidden />
          <span>Resolve…</span>
        </Button>
      ) : null}
      {lifecycle !== "resolved" ? (
        <Button variant="outline" size="sm" onClick={() => openDialog("ignore")}>
          <EyeOff aria-hidden />
          <span>Ignore…</span>
        </Button>
      ) : null}
      {lifecycle === "resolved" ? (
        <Button variant="outline" size="sm" onClick={() => openDialog("reopen")}>
          <RotateCcw aria-hidden />
          <span>Reopen</span>
        </Button>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending === "resolve"
            ? "Resolve this issue?"
            : pending === "ignore"
              ? "Ignore this issue?"
              : "Reopen this issue?"
        }
        description={
          pending === "resolve"
            ? "Marks the recurring cluster fixed. If it’s seen again in a later run, it automatically regresses back to open."
            : pending === "ignore"
              ? "A won’t-fix dismissal. If it’s seen again in a later run, it automatically regresses back to open."
              : "Returns this issue to Open and clears its resolution note."
        }
        confirmLabel={
          pending === "resolve" ? "Resolve issue" : pending === "ignore" ? "Ignore issue" : "Reopen issue"
        }
        tone="default"
        busy={busy}
        onConfirm={() => void confirm()}
      >
        {pending === "resolve" || pending === "ignore" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issue-lifecycle-note">Note (optional)</Label>
            <Textarea
              id="issue-lifecycle-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What was changed, or why this won’t be fixed…"
              rows={3}
              spellCheck
            />
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
