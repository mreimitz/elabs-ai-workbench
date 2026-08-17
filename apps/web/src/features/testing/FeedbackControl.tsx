import { useState } from "react";
import type { RunFeedback, RunFeedbackInput, RunFeedbackSummary } from "@mcp-token-footprint/shared";
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
import { MessageSquareText, ThumbsDown, ThumbsUp } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { deleteRunFeedback, putRunFeedback } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

/**
 * Observability WP 2.5 (D-OB15) — human feedback UI. ONE generic key ("verdict", ±1) the console
 * writes today; arbitrary keys are a WP4.5 concern. STRICTLY a separate lens from grading (AR6): the
 * copy always reads "Your verdict", never "Grade"/"Score", and the iconography (a `Toggle` pressed
 * thumb, not a `Badge`/`StatusBadge` chip) is deliberately unlike every judge-verdict surface
 * (`BaseVerdictChip`'s semantic-variant `Badge`, `GradeChip`'s `StatusBadge`) so a reviewer can never
 * mistake one dimension for the other.
 */
const VERDICT_KEY = "verdict";

export type FeedbackControlProps = {
  runId: string;
  /** Absent = run-level feedback; present = this turn/step's OWN feedback (its `run_steps.id`). */
  stepId?: string;
  /**
   * The scope's currently persisted "verdict" row, or `undefined` if none yet. CONTROLLED — this
   * component never fetches on its own; the caller owns the source of truth (a self-contained fetch
   * in `RunBar`'s header control, a batched per-run fetch in `ConversationPane`) so mounting many of
   * these (one per turn) never fans out into N redundant list calls.
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
          key: VERDICT_KEY,
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
        key: VERDICT_KEY,
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
 * ONE read-only feedback-summary chip. `"verdict"` renders the thumb icon (`Badge variant="outline"`
 * — deliberately not the solid semantic-variant Badge `BaseVerdictChip` uses, nor a `StatusBadge`, so
 * it never visually reads as a grade); any other key (a future WP4.5 rubric) falls back to a generic
 * `key: score` label. Renders `null` for a `null` score (a comment-only row with no thumb yet).
 */
export function FeedbackSummaryChip({ entry }: { entry: RunFeedbackSummary }) {
  if (entry.key === VERDICT_KEY) {
    if (entry.score === null) return null;
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
      {entry.score !== null ? `: ${entry.score}` : ""}
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
