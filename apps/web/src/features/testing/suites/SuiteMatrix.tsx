import { useEffect, useMemo, useState } from "react";
import type { RunGrade, SuiteCell } from "@mcp-token-footprint/shared";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { getRunGrades } from "../../../lib/api";
import { BASE_VERDICT_LABELS, BaseVerdictBadge } from "../BaseVerdictChip";
import { pickBaseVerdictEvidence } from "../grade-format";

/**
 * The suite-run matrix — rows = tests × cols = scenarios, each cell rolling up that (test, scenario)'s
 * repetitions into one status chip. Built on `@elabs-ai/components-ui` `Table*` with a sticky first column (the same
 * shape as the compatibility `HeatmapGrid`), so it scrolls horizontally inside its own container and
 * never pushes the page sideways. Cell fills are SEMANTIC tokens only (success/warning/destructive/
 * info/muted) — colour = the cell's status. Cells with a resolved child `runId` are `@elabs-ai/components-ui`
 * `Button`s that drill through to that run's console; unstarted cells are inert.
 *
 * Cells BUILD UP live: a cell first arrives `running`, then flips to its child's settled status. The
 * denominator is the suite's planned `repetitions`, so a partially-run cell reads "2 / 3" honestly.
 *
 * Auto-Rating WP 3.2 (AR6) — a SETTLED cell (status `complete`/`failed`/`stopped`) with a resolved
 * drill-through `runId` also carries a compact `answer_validation` base-rating verdict marker, a
 * SEPARATE dimension from the cell's rollup status / expectation score above it (rendered via the SAME
 * plain-`Badge` vocabulary as the Runs feed's `BaseVerdictChip` and the run console Report tab). This
 * component self-fetches each distinct drill-through run's latest-per-grader grades (best-effort, the
 * same client-side pattern `RunsView` uses for its Grade chips) — no new endpoint, and no props change
 * for `SuiteRunConsole` (still off-limits here). A PENDING/RUNNING cell shows no marker at all (nothing
 * to rate yet); a settled cell with no parseable `answer_validation` evidence reads the honest muted
 * "Not rated" from {@link BaseVerdictBadge} — never a fake verdict.
 */
export type SuiteMatrixRef = { id: string; name: string };

export type SuiteMatrixProps = {
  /** Ordered row subjects (tests). */
  tests: SuiteMatrixRef[];
  /** Ordered column subjects (scenarios). */
  scenarios: SuiteMatrixRef[];
  /** Cells seen so far, keyed by {@link import("./use-suite-stream").cellKey}. */
  cells: Record<string, SuiteCell>;
  /** Planned repetitions per cell (the roll-up denominator). */
  repetitions: number;
  /** Drill-through: open a child run's console. */
  onOpenRun: (runId: string) => void;
};

type RollupStatus = "pending" | "running" | "complete" | "failed" | "stopped";

type CellRollup = {
  status: RollupStatus;
  doneCount: number;
  total: number;
  runId?: string;
  meanScore: number | null;
};

/** Child-run statuses that mean the repetition is SETTLED (won't change further). */
const TERMINAL_CHILD_STATUSES = new Set(["completed", "stopped", "error", "aborted"]);

/** Rollup statuses that mean the WHOLE cell is settled — only then is a base-rating verdict possible. */
const SETTLED_ROLLUP_STATUSES = new Set<RollupStatus>(["complete", "failed", "stopped"]);

/** A rolled-up status → its token-backed cell fill + short label. Colour = status (semantic tokens). */
const CELL_META: Record<RollupStatus, { fill: string; label: string }> = {
  pending: { fill: "bg-muted text-muted-foreground", label: "Queued" },
  running: { fill: "bg-info/15 text-info-text", label: "Running" },
  complete: { fill: "bg-success/15 text-success-text", label: "Complete" },
  failed: { fill: "bg-destructive/15 text-destructive-text", label: "Failed" },
  stopped: { fill: "bg-warning/20 text-warning-text", label: "Stopped" },
};

/** Roll one (test, scenario) cell's repetitions (variants folded together) into a single chip. */
function rollup(cells: SuiteCell[], repetitions: number): CellRollup {
  const total = Math.max(repetitions, cells.length);
  if (cells.length === 0) return { status: "pending", doneCount: 0, total, meanScore: null };

  const doneCount = cells.filter((c) => TERMINAL_CHILD_STATUSES.has(c.status)).length;
  const anyRunning = cells.some((c) => !TERMINAL_CHILD_STATUSES.has(c.status));
  const anyFailed = cells.some((c) => c.status === "error" || c.status === "aborted");
  const anyStopped = cells.some((c) => c.status === "stopped");
  const status: RollupStatus = anyRunning
    ? "running"
    : anyFailed
      ? "failed"
      : anyStopped
        ? "stopped"
        : "complete";

  // Drill-through target: the highest-repetition cell that has a resolved child run id.
  const withRun = [...cells].filter((c) => c.runId).sort((a, b) => a.repetition - b.repetition);
  const runId = withRun.at(-1)?.runId;

  const scored = cells.map((c) => c.score).filter((s): s is number => typeof s === "number");
  const meanScore =
    scored.length > 0 ? scored.reduce((sum, s) => sum + s, 0) / scored.length : null;

  return { status, doneCount, total, meanScore, ...(runId ? { runId } : {}) };
}

export function SuiteMatrix({ tests, scenarios, cells, repetitions, onOpenRun }: SuiteMatrixProps) {
  // Group cells by `${testId} ${scenarioId}` (variants folded together for the base matrix roll-up).
  const grouped = useMemo(() => {
    const map = new Map<string, SuiteCell[]>();
    for (const cell of Object.values(cells)) {
      const key = `${cell.testId} ${cell.scenarioId}`;
      const list = map.get(key);
      if (list) list.push(cell);
      else map.set(key, [cell]);
    }
    return map;
  }, [cells]);

  // Hoisted out of JSX (was computed twice per cell) so the SAME rollups feed both the render AND the
  // base-rating-grade fetch below.
  const rollups = useMemo(() => {
    const map = new Map<string, CellRollup>();
    for (const test of tests) {
      for (const scenario of scenarios) {
        const key = `${test.id} ${scenario.id}`;
        map.set(key, rollup(grouped.get(key) ?? [], repetitions));
      }
    }
    return map;
  }, [tests, scenarios, grouped, repetitions]);

  // AR6 (WP 3.2) — every SETTLED cell's drill-through run id, deduped, is a candidate for a base-rating
  // verdict marker. Pending/running cells are excluded (nothing to rate yet).
  const settledRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const roll of rollups.values()) {
      if (roll.runId && SETTLED_ROLLUP_STATUSES.has(roll.status)) ids.add(roll.runId);
    }
    return [...ids];
  }, [rollups]);

  // Best-effort, cache-filling fetch (the SAME client-side pattern `RunsView` uses for its Grade
  // chips): only fetch ids not already in the map, so a live-updating matrix (new SSE cell ticks)
  // doesn't refetch a run's grades it already has. Terminates after one round trip per new id — every
  // requested id lands in the map (even `[]` on a failed/unready fetch), so `missing` empties out.
  const [gradesByRun, setGradesByRun] = useState<Map<string, RunGrade[]>>(new Map());
  useEffect(() => {
    const missing = settledRunIds.filter((id) => !gradesByRun.has(id));
    if (missing.length === 0) return;
    let active = true;
    void Promise.all(
      missing.map((id) =>
        getRunGrades(id)
          .then((response) => [id, response.latest] as const)
          .catch(() => [id, [] as RunGrade[]] as const),
      ),
    ).then((entries) => {
      if (active) setGradesByRun((current) => new Map([...current, ...entries]));
    });
    return () => {
      active = false;
    };
  }, [settledRunIds, gradesByRun]);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-48 bg-card">
              Test \ Environment
            </TableHead>
            {scenarios.map((scenario) => (
              <TableHead key={scenario.id} className="min-w-28 text-center align-bottom">
                <span className="block truncate font-medium" title={scenario.name}>
                  {scenario.name}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tests.map((test) => (
            <TableRow key={test.id}>
              <TableCell className="sticky left-0 z-10 min-w-48 max-w-72 truncate bg-card font-medium">
                <span title={test.name}>{test.name}</span>
              </TableCell>
              {scenarios.map((scenario) => {
                const roll = rollups.get(`${test.id} ${scenario.id}`) ?? rollup([], repetitions);
                const baseVerdict =
                  roll.runId && SETTLED_ROLLUP_STATUSES.has(roll.status)
                    ? pickBaseVerdictEvidence(gradesByRun.get(roll.runId) ?? [])
                    : undefined;
                return (
                  <MatrixCell
                    key={scenario.id}
                    rollup={roll}
                    baseVerdict={baseVerdict}
                    ariaSubject={`${test.name} × ${scenario.name}`}
                    onOpenRun={onOpenRun}
                  />
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function MatrixCell({
  rollup: roll,
  baseVerdict,
  ariaSubject,
  onOpenRun,
}: {
  rollup: CellRollup;
  /**
   * `undefined` — the cell isn't settled yet (pending/running), so no marker renders at all.
   * `null` — settled, but no parseable `answer_validation` evidence (renders `BaseVerdictBadge`'s
   * honest muted "Not rated"). An {@link AnswerValidationEvidence} — the real verdict.
   */
  baseVerdict?: ReturnType<typeof pickBaseVerdictEvidence>;
  ariaSubject: string;
  onOpenRun: (runId: string) => void;
}) {
  const meta = CELL_META[roll.status];
  const countText = `${roll.doneCount} / ${roll.total}`;
  const scoreText = roll.meanScore === null ? null : roll.meanScore.toFixed(2);

  // The token-coloured surface is a child layout <span> (colour = status); the interactive control is a
  // @elabs-ai/components-ui Button so keyboard + focus come for free (matches the heatmap HeatCell pattern).
  const surface = (
    <span
      className={cn(
        "flex w-full flex-col items-center justify-center gap-0.5 rounded-md px-2 py-2",
        meta.fill,
      )}
    >
      <span className="text-body font-semibold tabular-nums">{countText}</span>
      {scoreText !== null ? (
        <span className="text-caption tabular-nums opacity-80">score {scoreText}</span>
      ) : (
        <span className="text-caption opacity-80">{meta.label}</span>
      )}
      {/* AR6 — a SEPARATE base-rating verdict marker: a plain semantic-variant `Badge` (never part of
          the status-coloured surface above), so it never reads as the same dimension as the cell's
          rollup status / expectation score. */}
      {baseVerdict !== undefined ? (
        <span className="mt-0.5">
          <BaseVerdictBadge evidence={baseVerdict} />
        </span>
      ) : null}
    </span>
  );

  // An explicit `aria-label` on the drill-through Button replaces its computed accessible name
  // wholesale, so the base-rating marker's text (visible in `surface`) must be echoed here too —
  // otherwise a screen-reader user gets the rollup status but silently loses the AR6 signal.
  const baseVerdictAnnouncement =
    baseVerdict === undefined
      ? ""
      : baseVerdict === null
        ? " Base rating: not rated."
        : ` Base rating: ${BASE_VERDICT_LABELS[baseVerdict.verdict]}.`;

  if (!roll.runId) {
    return (
      <TableCell className="p-1 text-center">
        <span className="sr-only">{`${ariaSubject}: ${meta.label}, ${countText}`}</span>
        {surface}
      </TableCell>
    );
  }

  return (
    <TableCell className="p-1 text-center">
      <Button
        variant="ghost"
        onClick={() => onOpenRun(roll.runId as string)}
        aria-label={`${ariaSubject}: ${meta.label}, ${countText}. Open run.${baseVerdictAnnouncement}`}
        className="h-auto w-full p-0"
      >
        {surface}
      </Button>
    </TableCell>
  );
}

/** Compact legend for the cell colours — reused under the matrix. */
export function SuiteMatrixLegend() {
  const items: RollupStatus[] = ["pending", "running", "complete", "stopped", "failed"];
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-full", CELL_META[status].fill)} />
          <Text variant="meta" tone="muted">
            {CELL_META[status].label}
          </Text>
        </span>
      ))}
    </div>
  );
}
