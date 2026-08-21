import { useState } from "react";
import type { GradeFeedback, GradeFeedbackVerdict } from "@mcp-token-footprint/shared";
import {
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
import { appendGradeFeedback } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { notifyError } from "../../lib/notify";

/**
 * Benchmarks WP 6.1 — the human's call on ONE grade: *did the grader get this right?*
 *
 * ## It is not a grade, and the copy never lets it read as one (AR6)
 * The question this control asks is about the GRADER, not the run: "Grader was right" /
 * "Grader was wrong". It shows no number, offers no score, and changes nothing about the grade it
 * sits beside — the percentage on the card is exactly what it was before and after. It feeds the
 * judge-agreement metric (WP 6.2) and nothing else.
 *
 * ## Append-only, visibly
 * Each click POSTs a NEW verdict row; the API keeps the old one. Clicking the thumb that is already
 * pressed is therefore a deliberate no-op — an append-only record has no "un-say it", and writing a
 * duplicate row would inflate the very count WP 6.2 divides by. Switching thumbs DOES append (that
 * is a changed mind, and the history is the point).
 *
 * ## Controlled
 * The component never fetches. The caller owns the read side (`listRunGradeFeedback` once per run),
 * so mounting one of these per grade card — or per suite-matrix cell — never fans out into N calls.
 */
export type GradeFeedbackControlProps = {
  gradeId: string;
  /** The grader's human label, woven into each control's accessible name ("Tool hygiene: …"). */
  graderLabel: string;
  /** The grade's NEWEST persisted verdict, or `undefined` when nobody has judged it yet. */
  current: GradeFeedback | undefined;
  /** Called after a successful append with the row the API returned. */
  onAppended: (next: GradeFeedback) => void;
  /** Compact sizing for dense surfaces (a suite-matrix cell) vs. a roomier grade card. */
  size?: "sm" | "default";
  /** Hide the "This grade:" text label (a tooltip still names every control). */
  hideLabel?: boolean;
};

const VERDICT_LABELS: Record<GradeFeedbackVerdict, string> = {
  agree: "Grader was right",
  disagree: "Grader was wrong",
};

export function GradeFeedbackControl({
  gradeId,
  graderLabel,
  current,
  onAppended,
  size = "default",
  hideLabel = false,
}: GradeFeedbackControlProps) {
  // Optimistic press: shows the intended verdict immediately, then settles. On failure `current` is
  // untouched (`onAppended` only runs on success), so the control snaps back and the toast explains.
  const [pending, setPending] = useState<GradeFeedbackVerdict | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(current?.note ?? "");
  const [savingNote, setSavingNote] = useState(false);

  const verdict = pending ?? current?.verdict ?? null;
  const saving = pending !== null;

  const append = async (next: GradeFeedbackVerdict, note?: string) => {
    setPending(next);
    try {
      const saved = await appendGradeFeedback(gradeId, {
        verdict: next,
        ...(note !== undefined && note.length > 0 ? { note } : {}),
      });
      onAppended(saved);
      return true;
    } catch (error) {
      notifyError("Couldn’t record your call on this grade.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
      return false;
    } finally {
      setPending(null);
    }
  };

  const press = (next: GradeFeedbackVerdict) => {
    // Append-only: re-clicking the verdict already on record has nothing to add and must not write a
    // duplicate row (WP 6.2 counts verdicts). Switching thumbs is a real, recorded change of mind.
    if (current?.verdict === next) return;
    void append(next);
  };

  const saveNote = async () => {
    if (verdict === null) return; // guarded in the UI too — the button is disabled with a reason
    setSavingNote(true);
    const ok = await append(verdict, noteDraft.trim());
    setSavingNote(false);
    if (ok) {
      setNoteOpen(false);
      toast.success("Note recorded");
    }
  };

  const iconSize = size === "sm" ? "size-3.5" : "size-4";
  const noteId = `grade-feedback-note-${gradeId}`;

  return (
    // A <span> root (not a <div>): a grade card puts this inside `MetricCard`'s description, which
    // renders a <p> — a block child there is invalid markup React warns about at runtime.
    <span className="inline-flex shrink-0 flex-wrap items-center gap-1">
      {hideLabel ? null : (
        <Text as="span" variant="meta" tone="muted" className="whitespace-nowrap">
          This grade:
        </Text>
      )}
      {(["agree", "disagree"] as const).map((option) => {
        const Icon = option === "agree" ? ThumbsUp : ThumbsDown;
        const name = `${graderLabel}: ${VERDICT_LABELS[option]}`;
        return (
          <Tooltip key={option}>
            <TooltipTrigger asChild>
              <Toggle
                variant="outline"
                size={size}
                pressed={verdict === option}
                disabled={saving}
                onPressedChange={() => press(option)}
                aria-label={name}
              >
                <Icon aria-hidden className={iconSize} />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>{name}</TooltipContent>
          </Tooltip>
        );
      })}
      <Popover
        open={noteOpen}
        onOpenChange={(open) => {
          setNoteOpen(open);
          if (open) setNoteDraft(current?.note ?? "");
        }}
      >
        <PopoverTrigger asChild>
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={current?.note ? "Edit your note on this grade" : "Add a note to your call"}
          >
            <MessageSquareText aria-hidden className={iconSize} />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <div className="flex flex-col gap-2">
            <Label htmlFor={noteId}>Why? (optional)</Label>
            <Textarea
              id={noteId}
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="What did the grader miss…"
              rows={3}
              spellCheck
            />
            <Text variant="meta" tone="muted">
              Recorded alongside your call, never folded into the score.
            </Text>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
                Cancel
              </Button>
              {verdict === null ? (
                // A note is attached to a verdict — there is no verdict-less row to write. Say so
                // through the one disabled-affordance the app has, rather than a dead button.
                <IconButton
                  size="icon-sm"
                  label="Save note"
                  disabled
                  disabledReason="Pick “grader was right” or “grader was wrong” first — a note is recorded with your call."
                >
                  <MessageSquareText aria-hidden className="size-4" />
                </IconButton>
              ) : (
                <Button size="sm" disabled={savingNote} onClick={() => void saveNote()}>
                  {savingNote ? "Saving…" : "Save"}
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

/**
 * Fold a run's full, append-only feedback history into "the newest verdict per grade" — the single
 * thing every surface displays. The API returns rows oldest-first, so the last write per grade wins
 * (the same reduction `GradeRepository.latestByGrader` performs for grades themselves).
 */
export function latestFeedbackByGrade(rows: GradeFeedback[]): Map<string, GradeFeedback> {
  const latest = new Map<string, GradeFeedback>();
  for (const row of rows) latest.set(row.gradeId, row);
  return latest;
}
