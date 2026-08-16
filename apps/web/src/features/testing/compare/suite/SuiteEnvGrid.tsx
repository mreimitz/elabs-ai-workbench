import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@brand/ui";
import { StatusBadge } from "../../../../components/StatusBadge";
import {
  SUITE_TONE_CELL,
  SUITE_TONE_TEXT,
  buildSuiteGrid,
  signedCostText,
  signedGradeText,
  subjectKey,
  toneForDelta,
  type SuiteCompareData,
  type SuiteGridCell,
} from "./suite-data";

/**
 * The test × environment grid (audit §G13.6 / §T9c) — the centrepiece of suite compare. Rows are the
 * suite's tests, columns its environments; each cell is the (test × environment) subject's grade Δ and
 * cost Δ (comparison − baseline), coloured per D-UX9 (green better · red worse · neutral tie — NO ✓ on
 * a tie). An errored member on either side paints the cell RED with a {@link StatusBadge}. A drillable
 * cell (both suites resolved a member run) is a Button that opens the member-run comparison in the SAME
 * workspace (`/testing/runs/compare?ids=A,B&mode=summary`).
 */
export function SuiteEnvGrid({
  compare,
  onDrill,
}: {
  compare: SuiteCompareData;
  /** Open the member-run comparison for a cell (baseline member id, comparison member id). */
  onDrill: (baselineRunId: string, comparisonRunId: string) => void;
}) {
  const { data } = compare;
  const grid = buildSuiteGrid(compare);
  const scenarioName = (id: string) => data.scenariosById.get(id)?.name ?? id;
  const testName = (id: string) => data.testsById.get(id)?.name ?? id;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-card">Test</TableHead>
            {grid.scenarioIds.map((scenarioId) => (
              <TableHead key={scenarioId} className="min-w-[9rem]">
                <span className="break-words">{scenarioName(scenarioId)}</span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {grid.testIds.map((testId) => (
            <TableRow key={testId}>
              <TableCell className="sticky left-0 z-10 bg-card align-top font-medium">
                <span className="break-words">{testName(testId)}</span>
              </TableCell>
              {grid.scenarioIds.map((scenarioId) => {
                const cell = grid.cells.get(subjectKey(testId, scenarioId)) ?? null;
                return <GridCell key={scenarioId} cell={cell} onDrill={onDrill} />;
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GridCell({
  cell,
  onDrill,
}: {
  cell: SuiteGridCell | null;
  onDrill: (baselineRunId: string, comparisonRunId: string) => void;
}) {
  if (!cell) {
    return (
      <TableCell className="align-top">
        <Text variant="meta" tone="muted">
          —
        </Text>
      </TableCell>
    );
  }

  const content = <CellBody cell={cell} />;
  const baseId = cell.base?.representativeRunId ?? null;
  const compId = cell.comparison?.representativeRunId ?? null;

  if (cell.drillable && baseId && compId) {
    return (
      <TableCell className="p-1 align-top">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              onClick={() => onDrill(baseId, compId)}
              className={cn(
                "h-auto w-full flex-col items-start gap-0.5 rounded-md p-2 text-left",
                SUITE_TONE_CELL[cell.tone],
              )}
            >
              {content}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Compare member runs of this cell</TooltipContent>
        </Tooltip>
      </TableCell>
    );
  }

  // Present on only one side (or no drillable pair) — a non-interactive toned cell.
  return (
    <TableCell className="p-1 align-top">
      <div
        className={cn(
          "flex flex-col gap-0.5 rounded-md p-2",
          SUITE_TONE_CELL[cell.tone].split(" ")[0],
        )}
      >
        {content}
        <Text variant="meta" tone="muted">
          {cell.base && cell.comparison
            ? "single run"
            : cell.base
              ? "baseline only"
              : "comparison only"}
        </Text>
      </div>
    </TableCell>
  );
}

/** The grade Δ + cost Δ (and an error badge when a member errored) inside a cell. */
function CellBody({ cell }: { cell: SuiteGridCell }) {
  const erroredSide = cell.base?.errored
    ? cell.base
    : cell.comparison?.errored
      ? cell.comparison
      : null;
  return (
    <>
      {erroredSide ? <StatusBadge status={erroredSide.statusValue || "error"} /> : null}
      {cell.gradeDelta != null ? (
        <Text
          as="span"
          variant="meta"
          className={cn(
            "tabular-nums",
            SUITE_TONE_TEXT[toneForDelta(cell.gradeDelta, "higher-better")],
          )}
        >
          grade {cell.gradeDelta === 0 ? "no change" : signedGradeText(cell.gradeDelta)}
        </Text>
      ) : (
        <Text as="span" variant="meta" tone="muted">
          grade —
        </Text>
      )}
      {cell.costDelta != null ? (
        <Text
          as="span"
          variant="meta"
          className={cn(
            "tabular-nums",
            SUITE_TONE_TEXT[toneForDelta(cell.costDelta, "lower-better")],
          )}
        >
          cost {cell.costDelta === 0 ? "no change" : signedCostText(cell.costDelta)}
        </Text>
      ) : (
        <Text as="span" variant="meta" tone="muted">
          cost —
        </Text>
      )}
    </>
  );
}
