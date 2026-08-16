import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SuiteRunMember } from "@mcp-token-footprint/shared";
import { EmptyState, Skeleton, Table, TableBody, TableHeader } from "@brand/ui";
import { ListTree } from "lucide-react";
import { InlineError } from "../../../components/InlineError";
import { RunsCompareBar } from "../runs/RunsCompareBar";
import { RUN_TABLE_COLUMNS } from "../runs/run-columns";
import { RunsTableHead } from "../runs/RunsTableHead";
import { TestGroupRow } from "./TestGroupRow";

/**
 * The base 9-column set, EXPLICITLY — `TestGroupRow`'s summary row is a hand-rolled fixed layout (it
 * doesn't gate on `visible` at all) that matches exactly these 9 columns. Passing this explicitly
 * (rather than leaving `RunsTableHead`'s `visible` `undefined`, which means "show every recognized
 * column") keeps the suite console's Runs tab byte-unchanged now that `RunTableColumnKey` also
 * carries the Sessions-lens-only columns (Observability WP 2.4) — those have no place in
 * `TestGroupRow`'s fixed row and would otherwise misalign the header against it.
 */
const SUITE_MEMBERS_VISIBLE_COLUMNS = new Set(RUN_TABLE_COLUMNS);
import type { SuiteMatrixRef } from "./SuiteMatrix";

/**
 * The suite-run console's "Runs" tab — the SAME runs table as the unified Runs overview, scoped to this
 * suite execution and grouped by Test (owner-chosen layout). Each test is a collapsible
 * {@link TestGroupRow} that expands to its individual member runs (test × environment × repetition), so
 * a finished suite run finally shows WHAT executed — drill into any run, or multi-select runs of one
 * test and compare them side by side. Reads persisted members (via {@link useSuiteMembers}), so it works
 * identically for a live and a finished run.
 */
export function SuiteMembersTab({
  members,
  loading,
  error,
  onRetry,
  tests,
  scenarioName,
  onOpenRun,
}: {
  members: SuiteRunMember[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Ordered test axis ({id, name}) — drives group order + names (same refs the matrix uses). */
  tests: SuiteMatrixRef[];
  /** scenarioId → name, for the Environment column + intra-test ordering. */
  scenarioName: Map<string, string>;
  onOpenRun: (runId: string) => void;
}) {
  const navigate = useNavigate();
  const [expandedTests, setExpandedTests] = useState<Set<string>>(() => new Set());
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(() => new Set());

  // The Grade column shows only when at least one member carries a graded score (mirrors the feed's S9).
  const showGrade = members.some((m) => m.score !== null);
  const groups = useMemo(
    () => groupByTest(members, tests, scenarioName),
    [members, tests, scenarioName],
  );

  // Compare guard (mirrors the feed): ≥2 selected runs, all of a SINGLE test (a cross-test set can't be
  // compared side by side). `multiTest` drives the explanatory copy in the compare bar.
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const selectedTestIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of selectedRunIds) {
      const member = memberById.get(id);
      if (member) set.add(member.testId);
    }
    return set;
  }, [selectedRunIds, memberById]);
  const canCompare = selectedRunIds.size >= 2 && selectedTestIds.size === 1;
  const multiTest = selectedRunIds.size >= 2 && selectedTestIds.size > 1;

  const toggleTest = (id: string) =>
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleRunSelected = (runId: string, on: boolean) =>
    setSelectedRunIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(runId);
      else next.delete(runId);
      return next;
    });
  const openCompare = () => {
    if (canCompare) navigate(`/testing/runs/compare?ids=${[...selectedRunIds].join(",")}`);
  };

  if (loading && members.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (error && members.length === 0) {
    return <InlineError title="Couldn’t load member runs" detail={error} onRetry={onRetry} />;
  }
  if (members.length === 0) {
    return (
      <EmptyState
        icon={<ListTree aria-hidden />}
        title="No member runs"
        description="This suite run recorded no member runs — nothing executed, or its runs were deleted."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <RunsCompareBar
        runCount={selectedRunIds.size}
        canCompare={canCompare}
        multiTest={multiTest}
        suiteCount={0}
        onCompareRuns={openCompare}
        onCompareSuites={() => {}}
        onClear={() => setSelectedRunIds(new Set())}
      />
      {/* The @brand/ui Table renders its own scroll wrapper; pin Name (left) + Actions (right) via the
          shared header. Matches the feed's table scaffold (hand-rolled Table primitives, not DataTable). */}
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <Table className="w-full">
          <TableHeader>
            <RunsTableHead showGrade={showGrade} visible={SUITE_MEMBERS_VISIBLE_COLUMNS} />
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TestGroupRow
                key={group.testId}
                testName={group.testName}
                members={group.members}
                scenarioName={scenarioName}
                showGrade={showGrade}
                expanded={expandedTests.has(group.testId)}
                onToggleExpand={() => toggleTest(group.testId)}
                selectedRunIds={selectedRunIds}
                onToggleRunSelected={toggleRunSelected}
                onOpenRun={onOpenRun}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type TestGroup = { testId: string; testName: string; members: SuiteRunMember[] };

/** Partition members into per-test groups in the suite's test order (then any extra test seen in the
 *  members), members within a test ordered by environment name then repetition. */
function groupByTest(
  members: SuiteRunMember[],
  tests: SuiteMatrixRef[],
  scenarioName: Map<string, string>,
): TestGroup[] {
  const byTest = new Map<string, SuiteRunMember[]>();
  for (const member of members) {
    const list = byTest.get(member.testId);
    if (list) list.push(member);
    else byTest.set(member.testId, [member]);
  }
  const nameOf = new Map(tests.map((t) => [t.id, t.name]));
  const order: string[] = [];
  for (const test of tests) if (byTest.has(test.id)) order.push(test.id);
  for (const id of byTest.keys()) if (!order.includes(id)) order.push(id);

  return order.map((id) => {
    const list = (byTest.get(id) ?? []).slice().sort((a, b) => {
      const envA = scenarioName.get(a.scenarioId) ?? a.scenarioId;
      const envB = scenarioName.get(b.scenarioId) ?? b.scenarioId;
      return envA.localeCompare(envB) || (a.repetition ?? 0) - (b.repetition ?? 0);
    });
    return { testId: id, testName: nameOf.get(id) ?? `#${id.slice(0, 6)}`, members: list };
  });
}
