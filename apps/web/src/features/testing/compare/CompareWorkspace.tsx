import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RunGrade } from "@mcp-token-footprint/shared";
import { Button, Heading, StatePanel } from "@brand/ui";
import { GitCompareArrows } from "lucide-react";
import { PageShell } from "../../../components/PageShell";
import { ViewToolbar } from "../../../components/ViewToolbar";
import { getErrorMessage } from "../../../lib/errors";
import { CompareBar } from "./CompareBar";
import { VerdictBand } from "./VerdictBand";
import { SummaryMode } from "./SummaryMode";
import { FlowMode } from "./FlowMode";
import { MetricsMode } from "./MetricsMode";
import { SuiteCompareMode } from "./SuiteCompareMode";
import { useCompareState } from "./useCompareState";
import {
  buildWorkspaceRuns,
  deriveCaveats,
  loadCompareData,
  loadGradesForRuns,
  sharedTestId,
  type CompareData,
  type CompareMode,
  type RunModeProps,
} from "./compare-runs";

/**
 * The Compare Workspace (audit §H) — the rebuilt `/testing/runs/compare`, replacing the old
 * scrolling card page (radar + 15-row selector GONE). It is the FRAME only (WP 4.1): a fixed
 * PageShell header, a pinned compare-bar strip + verdict band, and a mode-switched content region
 * with ONE FILE PER MODE ({@link SummaryMode}/{@link FlowMode}/{@link MetricsMode}/
 * {@link SuiteCompareMode}) so WP 4.2/4.3/4.6 fill disjoint files.
 *
 * Scroll contract (compare-redesign WP-2, resolves audit R2/F2): the runs branch mounts
 * `scroll="fill"` on {@link PageShell} so the mode region FILLS the viewport instead of scrolling —
 * each mode then owns its own internal scroller (Flow's `FlowLanes` `overflow-auto` pane, Summary's
 * own `overflow-y-auto` root). That makes Flow's sticky lane-identity header actually stick, lands
 * its horizontal scrollbar at the viewport bottom, and keeps the compare bar + verdict band pinned
 * as a plain `shrink-0` row (no `sticky`/`before:` cover hack needed — the mode region no longer
 * scrolls past them). The suite branch is untouched (`scroll="content"`, out of scope here).
 *
 * All workspace state lives in the URL ({@link useCompareState}): `?ids&baseline&mode&focus` — every
 * chip add/remove, baseline pin, and mode switch is a query mutation (no page scroll), so a reload or
 * a shared link restores the exact workspace. The `?suiteRunIds=` seam from the Runs feed (WP 2.4)
 * routes to the disabled suite stub until WP 4.6, keeping that entry point unbroken.
 *
 * The H6 "What changed" markers and the H7 next-steps/export duplication that used to live in this
 * frame have moved into {@link SummaryMode} (compare-redesign step 6/§3.3 — Summary orders content by
 * question: verdict → what changed → matrix → charts → next steps last). This file only renders the
 * frame + the blocking (mixed-test) caveat band, which every mode shares.
 */
export function CompareWorkspace() {
  const navigate = useNavigate();
  const state = useCompareState();
  const {
    ids,
    baseline,
    mode,
    focus,
    suiteRunIds,
    setIds,
    addId,
    removeId,
    setBaseline,
    setMode,
    setFocus,
  } = state;

  const [data, setData] = useState<CompareData | null>(null);
  const [gradesByRun, setGradesByRun] = useState<Map<string, RunGrade[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setLoading(true);
    setError(null);
    try {
      const next = await loadCompareData();
      if (isActive()) setData(next);
    } catch (cause) {
      if (isActive()) setError(getErrorMessage(cause, "Couldn’t load runs."));
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  // Grades back the "ungraded" comparability caveat. Best-effort, keyed by the id SET so it refires
  // only when the selection changes (not on every render).
  const idsKey = useMemo(() => [...ids].sort().join(","), [ids]);
  useEffect(() => {
    const selected = idsKey.split(",").filter(Boolean);
    if (selected.length < 2) {
      setGradesByRun(new Map());
      return;
    }
    let active = true;
    void loadGradesForRuns(selected).then((map) => {
      if (active) setGradesByRun(map);
    });
    return () => {
      active = false;
    };
  }, [idsKey]);

  const runs = useMemo(
    () => (data ? buildWorkspaceRuns(ids, baseline, data) : []),
    [data, ids, baseline],
  );
  const testId = useMemo(() => sharedTestId(runs), [runs]);
  const caveats = useMemo(() => deriveCaveats(runs, gradesByRun), [runs, gradesByRun]);

  // Switching the test picker replaces the set with that test's two newest runs (baseline = newest).
  const onSelectTest = useCallback(
    (nextTestId: string) => {
      if (!data) return;
      const testRuns = data.runs
        .filter((run) => run.testId === nextTestId)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 2)
        .map((run) => run.id);
      setIds(testRuns);
    },
    [data, setIds],
  );

  // The title header used by the transitional (loading / error) and suite branches. The RUNS branch
  // uses the compact `headerVariant="toolbar"` compare bar instead (compare-redesign §3.1).
  const header = (
    <ViewToolbar info="Compare runs of one test across environments — tokens, tool calls, context, cost, outcome, and their process flow — side by side." />
  );

  if (loading) {
    return (
      <PageShell header={header} headerVariant="toolbar" width="full">
        <Heading level={1} className="sr-only">
          Compare runs
        </Heading>
        <StatePanel kind="loading" title="Loading runs…" loadingLabel="Loading runs…" />
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell header={header} headerVariant="toolbar" width="full">
        <Heading level={1} className="sr-only">
          Compare runs
        </Heading>
        <StatePanel
          kind="error"
          title="Couldn’t load runs."
          description={error ?? "No run data available."}
          actions={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      </PageShell>
    );
  }

  // The suite seam owns the whole content region (no run chips apply) — render the disabled stub.
  const inSuiteMode = mode === "suite" || suiteRunIds.length > 0;

  // Nothing selected yet → an inline prompt back to Runs (H8), still inside the frame.
  const isEmpty = !inSuiteMode && runs.length === 0;

  // The suite seam owns a plain scroll="content" PageShell (unchanged, out of scope for WP-2).
  if (inSuiteMode) {
    return (
      <PageShell header={header} headerVariant="toolbar" width="full">
        <Heading level={1} className="sr-only">
          Compare runs
        </Heading>
        <SuiteCompareMode suiteRunIds={suiteRunIds} data={data} />
      </PageShell>
    );
  }

  return (
    // scroll="fill": the mode region below fills the viewport and hides its own overflow, so the
    // active mode's internal scroller (Flow's FlowLanes overflow-auto pane, Summary's own
    // overflow-y-auto root) becomes the ONE scroll container. `headerVariant="toolbar"` hosts the
    // compacted compare bar as the fixed command row (compare-redesign §3.1 / D1). `contentClassName`
    // supplies the inter-block gap that fill mode (unlike the default) doesn't add for us.
    <PageShell
      header={
        <CompareBar
          runs={runs}
          data={data}
          testId={testId}
          baseline={baseline}
          mode={mode}
          caveats={caveats}
          onSelectTest={onSelectTest}
          onAddRun={addId}
          onRemoveRun={removeId}
          onSetBaseline={setBaseline}
          onModeChange={(next: CompareMode) => setMode(next)}
        />
      }
      headerVariant="toolbar"
      width="full"
      scroll="fill"
      contentClassName="gap-3"
    >
      {/* The TopNav breadcrumb (Runs › Compare) names the page; keep the H1 for AT only (§3.1). */}
      <Heading level={1} className="sr-only">
        Compare runs
      </Heading>

      {/* Blocking caveats (mixed tests) still earn a persistent Alert band; informational caveats are
          the bar's ⚠ chip only. Renders nothing for a cleanly comparable set (no pinned height). */}
      <VerdictBand caveats={caveats} verdict={null} onFocus={setFocus} />

      <div className="flex min-h-0 flex-1 flex-col">
        {isEmpty ? (
          <StatePanel
            kind="empty"
            icon={<GitCompareArrows aria-hidden />}
            title="Pick runs to compare"
            description="Choose a test above and add at least two of its runs, or select runs on the Runs page and choose Compare."
            actions={
              <Button variant="outline" onClick={() => navigate("/testing/runs")}>
                Go to Runs
              </Button>
            }
          />
        ) : (
          <ModeContent
            mode={mode}
            runs={runs}
            baselineId={baseline}
            data={data}
            focus={focus}
            onFocus={setFocus}
          />
        )}
      </div>
    </PageShell>
  );
}

/** Render the active RUN mode (suite is handled by the caller). One component per mode file. */
function ModeContent({ mode, ...rest }: { mode: CompareMode } & RunModeProps) {
  switch (mode) {
    case "flow":
      return <FlowMode {...rest} />;
    case "metrics":
      return <MetricsMode {...rest} />;
    default:
      return <SummaryMode {...rest} />;
  }
}
