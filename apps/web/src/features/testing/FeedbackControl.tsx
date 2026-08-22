import { useState } from "react";
import type { RunFeedback, RunFeedbackInput, RunFeedbackSummary } from "@mcp-token-footprint/shared";
import {
  RUN_FEEDBACK_KEY_CORRECTED_OUTPUT,
  RUN_FEEDBACK_KEY_VERDICT,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Text,
  Textarea,
  Toggle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@elabs-ai/components-ui";
import { MessageSquareText, PencilLine, ThumbsDown, ThumbsUp } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { deleteRunFeedback, putRunFeedback } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

/**
 * Observability WP 2.5 (D-OB15) — human feedback UI. STRICTLY a separate lens from grading (AR6):
 * the copy always reads "Your verdict", never "Grade"/"Score", and the iconography (a `Toggle`
 * pressed thumb, not a `Badge`/`StatusBadge` chip) is deliberately unlike every judge-verdict surface
 * (`BaseVerdictChip`'s semantic-variant `Badge`, `GradeChip`'s `StatusBadge`) so a reviewer can never
 * mistake one dimension for the other.
 *
 * RM-17 Phase 6 (AM-OB2) — the feedback `key` is now a PROP rather than a hardcoded literal, and the
 * two well-known keys are named once in `packages/shared`. The corrected-answer editor is the sibling
 * {@link CorrectedOutputControl} below, not a second mode of this control: a thumb is an opinion, a
 * corrected answer is a piece of content with a downstream consumer (promote-to-test), and merging
 * their state would make "cleared the note" and "cleared the correction" the same action.
 */

export type FeedbackControlProps = {
  runId: string;
  /** Absent = run-level feedback; present = this turn/step's OWN feedback (its `run_steps.id`). */
  stepId?: string;
  /**
   * The `run_feedback.key` this control writes. Defaults to `"verdict"`; every existing call site
   * relies on that default, so the wire is unchanged for them.
   */
  feedbackKey?: string;
  /**
   * The scope's currently persisted row for {@link feedbackKey}, or `undefined` if none yet.
   * CONTROLLED — this component never fetches on its own; the caller owns the source of truth (a
   * self-contained fetch in `RunBar`'s header control, a batched per-run fetch in `ConversationPane`)
   * so mounting many of these (one per turn) never fans out into N redundant list calls.
   */
  current: RunFeedback | undefined;
  /** Called after a successful write/clear with the row's new value (`undefined` after a clear). */
  onChange: (next: RunFeedback | undefined) => void;
  /** Compact icon sizing for dense turn rows vs. the header's slightly roomier controls. */
  size?: "sm" | "default";
  /** Hide the "Your verdict" text label (icon-only, for the tightest turn rows — a tooltip still names it). */
  hideLabel?: boolean;
};

export function FeedbackControl({
  runId,
  stepId,
  feedbackKey = RUN_FEEDBACK_KEY_VERDICT,
  current,
  onChange,
  size = "default",
  hideLabel = false,
}: FeedbackControlProps) {
  // Optimistic press: shows the intended state IMMEDIATELY on click, then settles — reverting to
  // whatever `current` already was (untouched on failure, since `onChange` is only called on success)
  // once the request resolves. Both thumbs disable while a write is in flight so a second click can't
  // race the first (loading-states rule: optimistic thumb + a settled state, error only on terminal
  // failure — the toast below). WRAPPED in `{ score }` (rather than a bare `number | null`) so a
  // pending CLEAR (`score: null`) stays distinguishable from "nothing pending" — a bare nullable would
  // make `pending ?? current?.score` fall straight through to the old score while a clear was in flight.
  const [pending, setPending] = useState<{ score: number | null } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(current?.comment ?? "");
  const [savingNote, setSavingNote] = useState(false);

  const score = pending ? pending.score : (current?.score ?? null);
  const saving = pending !== null;

  const write = async (nextScore: 1 | -1) => {
    // Clicking the ALREADY-active thumb takes the verdict back (clear) rather than re-sending the
    // same score — a deliberate toggle-off, distinct from switching thumbs.
    const clearing = current?.score === nextScore;
    setPending({ score: clearing ? null : nextScore });
    try {
      if (clearing && current) {
        await deleteRunFeedback(runId, current.id);
        onChange(undefined);
      } else {
        const input: RunFeedbackInput = {
          key: feedbackKey,
          score: nextScore,
          ...(stepId ? { stepId } : {}),
          ...(current?.comment ? { comment: current.comment } : {}),
        };
        const saved = await putRunFeedback(runId, input);
        onChange(saved);
      }
    } catch (error) {
      notifyError("Couldn’t save the verdict.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setPending(null);
    }
  };

  const saveNote = async () => {
    const comment = noteDraft.trim();
    setSavingNote(true);
    try {
      const input: RunFeedbackInput = {
        key: feedbackKey,
        ...(stepId ? { stepId } : {}),
        ...(current?.score !== undefined ? { score: current.score } : {}),
        ...(comment.length > 0 ? { comment } : {}),
      };
      const saved = await putRunFeedback(runId, input);
      onChange(saved);
      setNoteOpen(false);
      toast.success("Note saved");
    } catch (error) {
      notifyError("Couldn’t save the note.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setSavingNote(false);
    }
  };

  const iconSize = size === "sm" ? "size-3.5" : "size-4";
  const noteId = `feedback-note-${stepId ?? "run"}`;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {hideLabel ? null : (
        <Text variant="meta" tone="muted" className="whitespace-nowrap">
          Your verdict
        </Text>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            variant="outline"
            size={size}
            pressed={score === 1}
            disabled={saving}
            onPressedChange={() => void write(1)}
            aria-label={score === 1 ? "Clear your thumbs-up verdict" : "Your verdict: thumbs up"}
          >
            <ThumbsUp aria-hidden className={iconSize} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Your verdict — thumbs up</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            variant="outline"
            size={size}
            pressed={score === -1}
            disabled={saving}
            onPressedChange={() => void write(-1)}
            aria-label={score === -1 ? "Clear your thumbs-down verdict" : "Your verdict: thumbs down"}
          >
            <ThumbsDown aria-hidden className={iconSize} />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>Your verdict — thumbs down</TooltipContent>
      </Tooltip>
      <Popover
        open={noteOpen}
        onOpenChange={(open) => {
          setNoteOpen(open);
          if (open) setNoteDraft(current?.comment ?? "");
        }}
      >
        <PopoverTrigger asChild>
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={current?.comment ? "Edit your note" : "Add a note to your verdict"}
          >
            <MessageSquareText aria-hidden className={iconSize} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <div className="flex flex-col gap-2">
            <Label htmlFor={noteId}>Your note (optional)</Label>
            <Textarea
              id={noteId}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="What did you notice…"
              rows={3}
              spellCheck
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={savingNote} onClick={() => void saveNote()}>
                {savingNote ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * RM-17 Phase 6 (AM-OB2) — the corrected answer: **what this run should have said**, written by the
 * operator without leaving the console. It is stored as an ordinary run-level `run_feedback` row
 * under the well-known `corrected_output` key (comment-only, no score), through the same WP1.5
 * `POST /api/runs/:id/feedback` upsert everything else uses — no new endpoint, no new table.
 *
 * AR6 / D-OB15: this is NOT a grade. Nothing re-scores the run because a correction exists. Its one
 * downstream consumer is "Promote to test", where it becomes the DRAFT test's expected insight.
 *
 * CONTROLLED, like {@link FeedbackControl}: the caller owns the fetched row and gets the saved one
 * back through `onChange`.
 */
export function CorrectedOutputControl({
  runId,
  current,
  onChange,
  size = "default",
}: {
  runId: string;
  current: RunFeedback | undefined;
  onChange: (next: RunFeedback | undefined) => void;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current?.comment ?? "");
  const [saving, setSaving] = useState(false);

  const existing = current?.comment?.trim() ?? "";
  const hasCorrection = existing.length > 0;
  const fieldId = `corrected-output-${runId}`;

  const save = async () => {
    const comment = draft.trim();
    setSaving(true);
    try {
      if (comment.length === 0) {
        // Emptying the box REMOVES the correction rather than persisting an empty one — a blank
        // `corrected_output` row would claim a correction was captured that nobody can read.
        if (current) {
          await deleteRunFeedback(runId, current.id);
          onChange(undefined);
          toast.success("Corrected answer removed");
        }
        setOpen(false);
        return;
      }
      const saved = await putRunFeedback(runId, {
        key: RUN_FEEDBACK_KEY_CORRECTED_OUTPUT,
        comment,
      });
      onChange(saved);
      setOpen(false);
      toast.success("Corrected answer saved", {
        description: "Promoting this run to a test will use it as the expected answer.",
      });
    } catch (error) {
      notifyError("Couldn’t save the corrected answer.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const iconSize = size === "sm" ? "size-3.5" : "size-4";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(current?.comment ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <IconButton
          variant="ghost"
          size="icon-sm"
          label={hasCorrection ? "Edit the corrected answer" : "Write the corrected answer"}
        >
          <PencilLine aria-hidden className={iconSize} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <div className="flex flex-col gap-2">
          <Label htmlFor={fieldId}>Corrected answer</Label>
          <Text variant="meta" tone="muted">
            What this run should have answered. Promoting it to a test uses this as the expected
            answer — it never changes this run’s grade.
          </Text>
          <Textarea
            id={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="The answer this run should have given…"
            rows={6}
            spellCheck
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : hasCorrection && draft.trim().length === 0 ? "Remove" : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * ONE read-only feedback-summary chip. `"verdict"` renders the thumb icon (`Badge variant="outline"`
 * — deliberately not the solid semantic-variant Badge `BaseVerdictChip` uses, nor a `StatusBadge`, so
 * it never visually reads as a grade); `"corrected_output"` renders its own "Corrected answer" chip;
 * any other key (a WP4.5 rubric) falls back to a generic label.
 *
 * AM-OB2 — a COMMENT-ONLY row (`score: null`, `hasComment: true`) now renders. It used to return
 * `null`, so a run whose operator wrote a note or a full corrected answer looked exactly like a run
 * nobody had touched. The chip reports only that text EXISTS (the summary carries no text by design);
 * the run console and the run report show the words.
 */
export function FeedbackSummaryChip({ entry }: { entry: RunFeedbackSummary }) {
  if (entry.key === RUN_FEEDBACK_KEY_CORRECTED_OUTPUT) {
    if (!entry.hasComment) return null;
    return (
      <Badge variant="outline" className="gap-1 font-normal">
        <PencilLine aria-hidden className="size-3" />
        <span>Corrected answer</span>
      </Badge>
    );
  }
  if (entry.key === RUN_FEEDBACK_KEY_VERDICT) {
    if (entry.score === null) {
      // A note with no thumb is still human feedback — say so rather than rendering nothing.
      if (!entry.hasComment) return null;
      return (
        <Badge variant="outline" className="gap-1 font-normal">
          <MessageSquareText aria-hidden className="size-3" />
          <span>Your note</span>
        </Badge>
      );
    }
    const up = entry.score > 0;
    return (
      <Badge
        variant="outline"
        className="gap-1 font-normal"
        title={`Your verdict — thumbs ${up ? "up" : "down"}`}
      >
        {up ? (
          <ThumbsUp aria-hidden className="size-3" />
        ) : (
          <ThumbsDown aria-hidden className="size-3" />
        )}
        <span>Your verdict</span>
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 font-normal tabular-nums" title={`Human feedback — ${entry.key}`}>
      {entry.key}
      {entry.score !== null ? `: ${entry.score}` : entry.hasComment ? ": note" : ""}
    </Badge>
  );
}

/** Every run-level feedback entry as a row of {@link FeedbackSummaryChip}s. `null` when there's none
 *  (honest empty — never a placeholder chip) so callers can render it unconditionally. */
export function FeedbackChips({ feedback }: { feedback: RunFeedbackSummary[] | undefined }) {
  const entries = feedback ?? [];
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map((entry) => (
        <FeedbackSummaryChip key={entry.key} entry={entry} />
      ))}
    </div>
  );
}
