import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  ReviewRubric,
  ReviewRubricKeyDef,
  RunDetail,
  RunFeedback,
  RunSummary,
} from "@mcp-token-footprint/shared";
import { parseRunFilter, serializeRunFilter } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  EmptyState,
  Heading,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Text,
  Textarea,
  Toggle,
  cn,
} from "@elabs-ai/components-ui";
import { ChevronLeft, ChevronRight, ClipboardList, SkipForward, ThumbsDown, ThumbsUp } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { PageShell } from "../../components/PageShell";
import { StatusBadge } from "../../components/StatusBadge";
import { ViewToolbar } from "../../components/ViewToolbar";
import {
  getRun,
  listReviewRubrics,
  listRunFeedback,
  listScenarios,
  listTests,
  putRunFeedback,
  queryRunsFiltered,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatCostUsd, formatDuration, formatNumber, formatRelativeTime } from "../../lib/format";
import { runStatusBadgeView } from "../testing/RunBar";
import { countReviewed, isRunReviewed, withUpsertedFeedback } from "./review-progress";
import { RunStepsPreview } from "./RunStepsPreview";
import { notifyError } from "../../lib/notify";

/** A "lite" queue, not a paginated one (D-OB22) — bounds the runs feed fetch to a sane working set.
 *  If the filter matches more, the count carries an honest "showing the first N" note. */
const REVIEW_QUEUE_LIMIT = 200;

/**
 * Observability WP4.5 (D-OB22) — the review surface: pick a source (the active runs-feed filter) + a
 * rubric, then walk the matching runs keyboard-first. Left pane = a READ-ONLY run summary + step
 * preview (`RunStepsPreview`); right pane = the rubric form, one control per key, each answer written
 * through the EXISTING WP1.5 `POST /api/runs/:id/feedback` (`putRunFeedback`) — never a new endpoint.
 * A "review session" is EPHEMERAL: the source filter + the picked rubric id live in the URL
 * (`?filter=…&rubricId=…`), nothing beyond the rubric DEFINITION is persisted.
 *
 * Keyboard (global, active whenever no text field has focus): `j`/`k` — next/prev run (a manual
 * "skip" — no answer is required before moving on); Arrow keys — move the focused-key ring among the
 * rubric's keys; a digit (`1`/`2` for thumbs, `1`-`5` for scale5) on the focused key commits that
 * value and advances (to the next key, or — on the rubric's last key — to the next run); `Enter` on a
 * `note` key commits its typed comment (if any) and advances, or — with nothing typed, or on a
 * thumbs/scale5 key — just advances without writing (SKIP that one key). Mouse clicks on a value do
 * the same commit-and-advance.
 */
export function ReviewView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const filter = useMemo(() => parseRunFilter(searchParams.get("filter") ?? "{}"), [searchParams]);
  const filterKey = useMemo(() => serializeRunFilter(filter), [filter]);
  const rubricId = searchParams.get("rubricId");

  const [rubrics, setRubrics] = useState<ReviewRubric[]>([]);
  const [rubricsLoading, setRubricsLoading] = useState(true);
  const rubric = useMemo(() => rubrics.find((r) => r.id === rubricId) ?? null, [rubrics, rubricId]);

  const [queue, setQueue] = useState<RunSummary[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  // Review survives a refresh (P1 harden) — the queue pointer lives in the URL (`?runIndex=`), not an
  // unpersisted `useState`, so a refresh at run 150 of 200 lands back on run 150, not run 1. Clamped
  // into the CURRENT queue's bounds (a stale/out-of-range value from an old queue degrades to the
  // nearest valid run rather than crashing or pointing at nothing).
  const rawRunIndexParam = Number(searchParams.get("runIndex") ?? "0");
  const runIndex =
    queue.length === 0
      ? 0
      : Math.min(
          Math.max(Number.isFinite(rawRunIndexParam) ? Math.trunc(rawRunIndexParam) : 0, 0),
          queue.length - 1,
        );
  // Distinguishes the very first queue load (restore whatever `runIndex` a deep link/refresh carried)
  // from a LATER source-filter change (a genuinely new queue — start its pointer over at run 0).
  const firstQueueLoadRef = useRef(true);
  const [focusedKeyIndex, setFocusedKeyIndex] = useState(0);

  const [currentDetail, setCurrentDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState<RunFeedback[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const [testNames, setTestNames] = useState<Record<string, string>>({});
  const [scenarioNames, setScenarioNames] = useState<Record<string, string>>({});

  const currentRun = queue[runIndex] ?? null;

  // The left pane's scroll container — reset to the top on every run change, so the transcript never
  // opens mid-scroll from whatever position the PREVIOUS run's steps were left at.
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcriptScrollRef.current) transcriptScrollRef.current.scrollTop = 0;
  }, [currentRun?.id]);

  // ── Load rubrics (once) ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    setRubricsLoading(true);
    listReviewRubrics()
      .then((list) => {
        if (active) setRubrics(list);
      })
      .catch((error) => {
        if (active)
          notifyError("Couldn’t load review rubrics. Reload the page to try again.", {
            description: getErrorMessage(error),
          });
      })
      .finally(() => {
        if (active) setRubricsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // ── Name lookups for the left-pane header (best-effort; cosmetic only) ─────────────────────────
  useEffect(() => {
    let active = true;
    Promise.all([listTests(), listScenarios()])
      .then(([tests, scenarios]) => {
        if (!active) return;
        setTestNames(Object.fromEntries(tests.map((t) => [t.id, t.name])));
        setScenarioNames(Object.fromEntries(scenarios.map((s) => [s.id, s.name])));
      })
      .catch(() => {
        /* cosmetic only — an id fallback below covers a failed lookup */
      });
    return () => {
      active = false;
    };
  }, []);

  // ── Load the run queue whenever the source filter changes ──────────────────────────────────────
  useEffect(() => {
    let active = true;
    setQueueLoading(true);
    queryRunsFiltered(filter, { limit: REVIEW_QUEUE_LIMIT })
      .then((rows) => {
        if (!active) return;
        setQueue(rows);
        setFocusedKeyIndex(0);
        // A genuinely NEW source filter (not the initial load) means the old `runIndex` in the URL
        // belonged to a different queue — reset the pointer to run 0. The initial load leaves it
        // alone so a deep link / refresh restores wherever the reviewer left off.
        if (!firstQueueLoadRef.current) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set("runIndex", "0");
              return next;
            },
            { replace: true },
          );
        }
        firstQueueLoadRef.current = false;
      })
      .catch((error) => {
        if (active)
          notifyError("Couldn’t load the review queue. Reload the page to try again.", {
            description: getErrorMessage(error),
          });
      })
      .finally(() => {
        if (active) setQueueLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // ── Load the current run's detail + existing feedback whenever the pointer moves ───────────────
  useEffect(() => {
    if (!currentRun) {
      setCurrentDetail(null);
      setCurrentFeedback([]);
      setNoteDrafts({});
      return;
    }
    let active = true;
    setDetailLoading(true);
    // Clear the PREVIOUS run's feedback/notes immediately, at the start of the fetch — not just in
    // the `!currentRun` branch above. Otherwise `advanceAfterKey` briefly renders the old run's
    // already-answered scores/notes in the right pane while the new run's fetch is still in flight.
    setCurrentDetail(null);
    setCurrentFeedback([]);
    setNoteDrafts({});
    Promise.all([getRun(currentRun.id), listRunFeedback(currentRun.id)])
      .then(([detail, feedback]) => {
        if (!active) return;
        setCurrentDetail(detail);
        setCurrentFeedback(feedback);
        const drafts: Record<string, string> = {};
        for (const entry of feedback) if (entry.comment) drafts[entry.key] = entry.comment;
        setNoteDrafts(drafts);
      })
      .catch((error) => {
        if (active)
          notifyError("Couldn’t load this run. Reload the page to try again.", {
            description: getErrorMessage(error),
          });
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRun?.id]);

  function selectRubric(id: string) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("rubricId", id);
        return next;
      },
      { replace: true },
    );
  }

  function goToRun(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= queue.length) return; // clamp — no wraparound
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("runIndex", String(nextIndex));
        return next;
      },
      { replace: true },
    );
    setFocusedKeyIndex(0);
  }

  function advanceAfterKey() {
    if (rubric && focusedKeyIndex < rubric.keys.length - 1) {
      setFocusedKeyIndex((i) => i + 1);
    } else {
      goToRun(runIndex + 1);
    }
  }

  async function commitKey(keyDef: ReviewRubricKeyDef, value: { score?: number; comment?: string }) {
    if (!currentRun) return;
    try {
      const saved = await putRunFeedback(currentRun.id, { key: keyDef.key, ...value });
      setCurrentFeedback((list) => [...list.filter((f) => f.key !== keyDef.key), saved]);
      setQueue((list) =>
        list.map((r, i) =>
          i === runIndex ? withUpsertedFeedback(r, keyDef.key, saved.score ?? null) : r,
        ),
      );
      advanceAfterKey();
    } catch (error) {
      notifyError("Couldn’t save your answer. Try again.", {
        description: getErrorMessage(error),
      });
    }
  }

  function skipKey() {
    advanceAfterKey();
  }

  // ── Keyboard-first flow (D-OB22 DESIGN) ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rubric || queue.length === 0) return;
    function onKeyDown(event: KeyboardEvent) {
      const active = document.activeElement;
      // A text field owns its own keys (typing a note, Enter-to-commit handled by the Textarea
      // itself below) — never hijacked by the global shortcuts.
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) return;
      if (!rubric) return;
      // Grading shortcuts must never swallow the app's OWN shortcuts (⌘K, ⌃J, ⌘1–⌘5, …) — every
      // branch below calls `preventDefault()`, and the digit branches COMMIT A GRADE, so a reviewer
      // reaching for the command palette must not silently score the run. Any modifier bails out
      // before any branch runs.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j") {
        event.preventDefault();
        goToRun(runIndex + 1);
        return;
      }
      if (event.key === "k") {
        event.preventDefault();
        goToRun(runIndex - 1);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setFocusedKeyIndex((i) => Math.min(i + 1, rubric.keys.length - 1));
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setFocusedKeyIndex((i) => Math.max(i - 1, 0));
        return;
      }

      const keyDef = rubric.keys[focusedKeyIndex];
      if (!keyDef) return;

      if (event.key === "Enter") {
        event.preventDefault();
        if (keyDef.kind === "note") {
          const draft = (noteDrafts[keyDef.key] ?? "").trim();
          if (draft.length > 0) void commitKey(keyDef, { comment: draft });
          else skipKey();
        } else {
          skipKey(); // Enter with no value picked = skip this key
        }
        return;
      }
      if (keyDef.kind === "thumbs" && (event.key === "1" || event.key === "2")) {
        event.preventDefault();
        void commitKey(keyDef, { score: event.key === "1" ? 1 : -1 });
        return;
      }
      if (keyDef.kind === "scale5" && ["1", "2", "3", "4", "5"].includes(event.key)) {
        event.preventDefault();
        void commitKey(keyDef, { score: Number(event.key) });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubric, queue.length, runIndex, focusedKeyIndex, noteDrafts, currentRun?.id]);

  const reviewed = rubric ? countReviewed(queue, rubric) : 0;
  const total = queue.length;
  const progressPct = total > 0 ? (reviewed / total) * 100 : 0;

  const header = (
    <ViewToolbar
      info={
        <p className="max-w-xs text-pretty">
          Pick a rubric, then walk the matching runs. Answer with a click or the keyboard
          (j/k to move, arrows to change key, a digit or Enter to answer and advance).
        </p>
      }
      left={
        <div className="flex min-w-0 items-center gap-2">
          <Select value={rubricId ?? undefined} onValueChange={selectRubric}>
            <SelectTrigger aria-label="Rubric" className="w-56 shrink-0">
              <SelectValue placeholder={rubricsLoading ? "Loading rubrics…" : "Pick a rubric…"} />
            </SelectTrigger>
            <SelectContent>
              {rubrics.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {rubric && total > 0 ? (
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              Run {runIndex + 1} of {total}
            </Badge>
          ) : null}
        </div>
      }
      actions={
        <>
          {rubric && total > 0 ? (
            <>
              <IconButton
                variant="outline"
                size="sm"
                disabled={runIndex === 0}
                disabledReason="Already at the first run"
                onClick={() => goToRun(runIndex - 1)}
                label="Previous run"
              >
                <ChevronLeft aria-hidden />
              </IconButton>
              <Button variant="outline" size="sm" onClick={() => goToRun(runIndex + 1)}>
                <SkipForward aria-hidden />
                <span>Skip</span>
              </Button>
              <IconButton
                variant="outline"
                size="sm"
                disabled={runIndex >= total - 1}
                disabledReason="Already at the last run"
                onClick={() => goToRun(runIndex + 1)}
                label="Next run"
              >
                <ChevronRight aria-hidden />
              </IconButton>
            </>
          ) : null}
          <Button variant="ghost" onClick={() => navigate("/testing/observability/review-rubrics")}>
            <ClipboardList aria-hidden />
            <span>Manage rubrics</span>
          </Button>
        </>
      }
    />
  );

  return (
    <PageShell headerVariant="toolbar" width="full" scroll="fill" header={header}>
      <Heading level={1} className="sr-only">
        Review runs
      </Heading>

      {!rubric ? (
        <EmptyState
          icon={<ClipboardList aria-hidden />}
          title={rubricsLoading ? "Loading rubrics…" : "Pick a rubric to start reviewing"}
          description={
            rubricsLoading
              ? undefined
              : rubrics.length === 0
                ? "No review rubrics exist yet — create one from “Manage rubrics”."
                : "Choose a rubric from the toolbar above to walk this filter's matching runs."
          }
          actions={
            !rubricsLoading && rubrics.length === 0 ? (
              <Button onClick={() => navigate("/testing/observability/review-rubrics")}>
                <ClipboardList aria-hidden />
                <span>Manage rubrics</span>
              </Button>
            ) : undefined
          }
        />
      ) : queueLoading ? (
        <StatePanel kind="loading" title="Loading the review queue…" loadingLabel="Loading…" />
      ) : queue.length === 0 ? (
        <EmptyState
          icon={<ClipboardList aria-hidden />}
          title="No runs match this filter"
          description="Adjust the runs feed's filter, then reopen “Review these…” to build a new queue."
        />
      ) : (
        <div className="flex h-full min-h-0">
          <div
            ref={transcriptScrollRef}
            className="min-w-0 flex-1 overflow-y-auto border-e border-border p-4"
          >
            {currentRun ? (
              <RunHeader
                run={currentRun}
                testName={testNames[currentRun.testId]}
                scenarioName={scenarioNames[currentRun.scenarioId]}
              />
            ) : null}
            {detailLoading ? (
              <StatePanel kind="loading" title="Loading the transcript…" loadingLabel="Loading…" className="mt-4" />
            ) : currentDetail ? (
              <div className="mt-4">
                <RunStepsPreview steps={currentDetail.steps} />
              </div>
            ) : null}
          </div>

          <div className="flex w-[26rem] shrink-0 flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {rubric.instructions ? (
                <Text variant="meta" tone="muted" className="mb-4 block">
                  {rubric.instructions}
                </Text>
              ) : null}
              <div className="flex flex-col gap-3">
                {rubric.keys.map((keyDef, index) => (
                  <RubricKeyRow
                    key={keyDef.key}
                    keyDef={keyDef}
                    index={index}
                    focused={index === focusedKeyIndex}
                    runId={currentRun?.id ?? null}
                    currentScore={currentFeedback.find((f) => f.key === keyDef.key)?.score}
                    noteValue={noteDrafts[keyDef.key] ?? ""}
                    onFocus={() => setFocusedKeyIndex(index)}
                    onNoteChange={(value) => setNoteDrafts((d) => ({ ...d, [keyDef.key]: value }))}
                    onCommitScore={(score) => void commitKey(keyDef, { score })}
                    onCommitNote={() => {
                      const draft = (noteDrafts[keyDef.key] ?? "").trim();
                      if (draft.length > 0) void commitKey(keyDef, { comment: draft });
                      else skipKey();
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <Text variant="meta" tone="muted">
                  {reviewed}/{total} reviewed
                </Text>
                {total >= REVIEW_QUEUE_LIMIT ? (
                  <Text variant="meta" tone="muted">
                    showing the first {REVIEW_QUEUE_LIMIT}
                  </Text>
                ) : null}
              </div>
              <Progress value={progressPct} aria-label="Review progress" />
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function RunHeader({
  run,
  testName,
  scenarioName,
}: {
  run: RunSummary;
  testName: string | undefined;
  scenarioName: string | undefined;
}) {
  const view = runStatusBadgeView(run.status, run.outcome, run.ratingState, run.stopReasonCode, run.phase);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Text className="min-w-0 truncate font-medium">{testName ?? "Unknown test"}</Text>
        <StatusBadge view={view} />
      </div>
      <Text variant="meta" tone="muted" className="min-w-0 truncate">
        {scenarioName ?? "Unknown environment"} · started {formatRelativeTime(run.startedAt)}
      </Text>
      <div className="flex flex-wrap items-center gap-3 tabular-nums">
        <Text variant="meta" tone="muted">
          {formatCostUsd(run.costUsd)}
        </Text>
        <Text variant="meta" tone="muted">
          {formatNumber(run.tokensIn)} in / {formatNumber(run.tokensOut)} out
        </Text>
        {run.durationMs !== undefined ? (
          <Text variant="meta" tone="muted">
            {formatDuration(run.durationMs)}
          </Text>
        ) : null}
      </div>
    </div>
  );
}

function RubricKeyRow({
  keyDef,
  index,
  focused,
  runId,
  currentScore,
  noteValue,
  onFocus,
  onNoteChange,
  onCommitScore,
  onCommitNote,
}: {
  keyDef: ReviewRubricKeyDef;
  index: number;
  focused: boolean;
  /** The run currently under review — included so real focus follows the ring even when a run
   *  changes but the focused KEY index happens to stay numerically the same (see the effect below). */
  runId: string | null;
  currentScore: number | undefined;
  noteValue: string;
  onFocus: () => void;
  onNoteChange: (value: string) => void;
  onCommitScore: (score: number) => void;
  onCommitNote: () => void;
}) {
  const answered = keyDef.kind === "note" ? noteValue.trim().length > 0 : currentScore !== undefined;
  const containerRef = useRef<HTMLDivElement>(null);

  // Review focus is REAL, not painted (P1 a11y fix folded in here): `focused` used to only draw a
  // ring while actual DOM focus stayed wherever the mouse last clicked. Whenever this key BECOMES the
  // focused one — via arrow-key navigation, a commit-and-advance, or a run change — move real focus
  // to its first control, so Tab order, screen readers, and the visual ring all agree.
  useEffect(() => {
    if (!focused) return;
    const control = containerRef.current?.querySelector<HTMLElement>("button, textarea");
    control?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, runId]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        focused ? "border-ring ring-2 ring-ring" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Text className="font-medium">{keyDef.key}</Text>
        {answered ? (
          <Badge variant="outline" className="font-normal">
            Answered
          </Badge>
        ) : null}
      </div>
      {keyDef.description ? (
        <Text variant="meta" tone="muted">
          {keyDef.description}
        </Text>
      ) : null}
      {keyDef.kind === "thumbs" ? (
        <div className="flex gap-2">
          <Toggle
            variant="outline"
            pressed={currentScore === 1}
            onFocus={onFocus}
            onPressedChange={() => onCommitScore(1)}
            aria-label={`${keyDef.key}: thumbs up`}
          >
            <ThumbsUp aria-hidden className="size-4" />
          </Toggle>
          <Toggle
            variant="outline"
            pressed={currentScore === -1}
            onFocus={onFocus}
            onPressedChange={() => onCommitScore(-1)}
            aria-label={`${keyDef.key}: thumbs down`}
          >
            <ThumbsDown aria-hidden className="size-4" />
          </Toggle>
        </div>
      ) : keyDef.kind === "scale5" ? (
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Toggle
              key={n}
              variant="outline"
              pressed={currentScore === n}
              onFocus={onFocus}
              onPressedChange={() => onCommitScore(n)}
              aria-label={`${keyDef.key}: ${n}`}
              className="tabular-nums"
            >
              {n}
            </Toggle>
          ))}
        </div>
      ) : (
        <Textarea
          value={noteValue}
          onChange={(event) => onNoteChange(event.target.value)}
          onFocus={onFocus}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onCommitNote();
            }
          }}
          placeholder="Type a note, then press Enter…"
          rows={2}
          spellCheck
          aria-label={`${keyDef.key} note`}
        />
      )}
      <span className="sr-only">Key {index + 1}</span>
    </div>
  );
}
