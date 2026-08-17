import { Fragment } from "react";
import type { SuiteRunMember } from "@mcp-token-footprint/shared";
import { Badge, StatusBadge, TableCell, TableRow, Text } from "@elabs-ai/components-ui";
import { ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { formatCostUsd, formatDateTime, formatDuration, formatNumber } from "../../../lib/format";
import { formatGradePercent } from "../grade-format";
import { isReviewInFlight, REVIEWING_BADGE, runStatusBadgeStatus } from "../RunBar";
import { MemberRow, MetricCell } from "../runs/SuiteTableRows";
import { pinCell } from "../runs/pinning";

/**
 * One TEST of a suite run as a collapsible group of Runs-table rows — the suite-console analogue of the
 * feed's `SuiteTableRows` (suite→member), one level deeper (test→member). A summary `<TableRow>` on the
 * `muted` surface (chevron · test name · "N environments · M runs" · Test badge · rolled-up status +
 * "· N error" · summed turns/tools/tokens/cost · mean grade · earliest start · span) that, when
 * expanded, injects the test's member run rows (reusing {@link MemberRow} verbatim). Returns a fragment
 * of `<TableRow>`s so it slots into the shared `<TableBody>` and keeps column alignment. Members are
 * already ordered (by scenario then repetition) by the caller.
 */
export function TestGroupRow({
  testName,
  members,
  scenarioName,
  showGrade,
  expanded,
  onToggleExpand,
  selectedRunIds,
  onToggleRunSelected,
  onOpenRun,
}: {
  testName: string;
  members: SuiteRunMember[];
  scenarioName: Map<string, string>;
  showGrade: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  selectedRunIds: Set<string>;
  onToggleRunSelected: (runId: string, on: boolean) => void;
  onOpenRun: (runId: string) => void;
}) {
  const envCount = new Set(members.map((m) => m.scenarioId)).size;
  const turns = members.reduce((sum, m) => sum + m.turns, 0);
  const tools = members.reduce((sum, m) => sum + m.toolCalls, 0);
  const tokens = members.reduce((sum, m) => sum + m.tokensIn + m.tokensOut, 0);
  const cost = members.reduce((sum, m) => sum + m.costUsd, 0);

  const scored = members.map((m) => m.score).filter((s): s is number => s !== null);
  const meanScore =
    scored.length > 0 ? scored.reduce((sum, s) => sum + s, 0) / scored.length : null;

  const rollup = rollupStatus(members);
  const earliestStart = members.reduce<string | null>(
    (min, m) => (min === null || Date.parse(m.startedAt) < Date.parse(min) ? m.startedAt : min),
    null,
  );
  const spanMs = durationSpan(members);

  return (
    <Fragment>
      {/* Summary row — click toggles the group open/closed. */}
      <TableRow className="cursor-pointer bg-muted" onClick={onToggleExpand}>
        <TableCell className={pinCell("left", "muted")}>
          <div className="flex items-center gap-2">
            <IconButton
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
              aria-expanded={expanded}
              label={expanded ? `Collapse ${testName}` : `Expand ${testName}`}
            >
              {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            </IconButton>
            <div className="min-w-0 max-w-[16rem]">
              <div className="flex min-w-0 items-center gap-2">
                <FlaskConical aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-medium">{testName}</span>
              </div>
              <Text variant="meta" tone="muted" className="block truncate tabular-nums">
                {envCount} environment{envCount === 1 ? "" : "s"} · {members.length} run
                {members.length === 1 ? "" : "s"}
              </Text>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="secondary" className="font-normal">
            Test
          </Badge>
        </TableCell>
        <TableCell className="text-muted-foreground tabular-nums">
          {envCount} environment{envCount === 1 ? "" : "s"}
        </TableCell>
        <TableCell>
          <StatusBadge status={rollup.status}>{rollup.label}</StatusBadge>
        </TableCell>
        <MetricCell pending={false}>{formatNumber(turns)}</MetricCell>
        <MetricCell pending={false}>{formatNumber(tools)}</MetricCell>
        <MetricCell pending={false}>{formatNumber(tokens)}</MetricCell>
        <MetricCell pending={false}>{formatCostUsd(cost)}</MetricCell>
        {showGrade ? (
          <TableCell className="tabular-nums text-muted-foreground">
            {meanScore === null ? "—" : formatGradePercent(meanScore)}
          </TableCell>
        ) : null}
        <TableCell>
          <Text variant="meta" tone="muted" className="whitespace-nowrap tabular-nums">
            {earliestStart ? formatDateTime(earliestStart) : "—"}
          </Text>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {spanMs === null ? "—" : formatDuration(spanMs)}
        </TableCell>
        <TableCell className={pinCell("right", "muted")} aria-hidden />
      </TableRow>

      {/* Expanded: the test's member run rows (reused verbatim from the feed). */}
      {expanded
        ? members.map((member) => (
            <MemberRow
              key={member.id}
              run={member}
              testName={testName}
              scenarioName={scenarioName.get(member.scenarioId)}
              showGrade={showGrade}
              primaryScore={member.score}
              selected={selectedRunIds.has(member.id)}
              onToggleSelected={(on) => onToggleRunSelected(member.id, on)}
              onOpen={() => onOpenRun(member.id)}
            />
          ))
        : null}
    </Fragment>
  );
}

/** Roll a test's members into one status chip: any active → Running; any terminal-but-still-rating →
 *  Reviewing… (AR11); all failed → Failed; else Completed with an honest "· N error" suffix so a
 *  green chip never hides a failed member below. */
function rollupStatus(members: SuiteRunMember[]): {
  status: "pending" | "running" | "complete" | "failed" | "denied";
  label: string;
} {
  const brand = members.map((m) => runStatusBadgeStatus(m.status, m.outcome));
  const anyActive = brand.some((s) => s === "running" || s === "pending");
  const errorCount = brand.filter((s) => s === "failed").length;
  if (anyActive) return { status: "running", label: "Running" };
  // Every member is terminal but at least one review hasn't settled — the group is still being rated.
  if (members.some((m) => isReviewInFlight(m.ratingState))) return REVIEWING_BADGE;
  if (members.length > 0 && errorCount === members.length) {
    return { status: "failed", label: members.length === 1 ? "Failed" : "All failed" };
  }
  if (errorCount > 0)
    return {
      status: "complete",
      label: `Completed · ${errorCount} error${errorCount === 1 ? "" : "s"}`,
    };
  return { status: "complete", label: "Completed" };
}

/** Wall-clock span from the earliest member start to the latest member end (null when unknowable). */
function durationSpan(members: SuiteRunMember[]): number | null {
  let minStart = Number.POSITIVE_INFINITY;
  let maxEnd = Number.NEGATIVE_INFINITY;
  for (const m of members) {
    const start = Date.parse(m.startedAt);
    if (Number.isNaN(start)) continue;
    minStart = Math.min(minStart, start);
    if (m.durationMs != null) maxEnd = Math.max(maxEnd, start + m.durationMs);
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return null;
  return Math.max(0, maxEnd - minStart);
}
