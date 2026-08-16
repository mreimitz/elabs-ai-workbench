import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Heading, StatePanel, Text } from "@brand/ui";
import { Download, GitCompareArrows } from "lucide-react";
import { getErrorMessage } from "../../../lib/errors";
import type { SuiteModeProps } from "./compare-runs";
import { SuiteVerdictStrip } from "./suite/SuiteVerdictStrip";
import { SuiteEnvGrid } from "./suite/SuiteEnvGrid";
import {
  buildSuiteCompareMarkdown,
  loadSuiteCompare,
  type SuiteCompareData,
} from "./suite/suite-data";

/**
 * Suite-compare mode (WP 4.6, audit §G13.6 / §T9c) — the suite-vs-suite comparison, entered via the
 * `?suiteRunIds=` seam the Runs feed hands over (WP 2.4). It renders:
 *   • a verdict strip — pass rate · mean grade · exec cost · total tokens, baseline (Ⓐ) → comparison
 *     (Ⓑ) with toned Δ (§G13.6 "Suite B: pass rate 78%→91%, mean grade +0.12, exec cost +$0.40");
 *   • a test × environment grid of grade/cost deltas — green/red cells, an errored member a red cell,
 *     each drillable cell opening the member-run comparison in the SAME run-compare workspace;
 *   • the same export affordance as the run workspace (a self-contained Markdown summary download).
 *
 * All data comes from existing endpoints (`GET /api/suite-runs/:id` + `/analytics`) plus the already
 * loaded run catalogue — NO API change. `suiteRunIds[0]` is the baseline (Ⓐ), `[1]` the comparison (Ⓑ).
 */
export function SuiteCompareMode({ suiteRunIds, data }: SuiteModeProps) {
  const navigate = useNavigate();
  const [compare, setCompare] = useState<SuiteCompareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The two suite runs the comparison is built from (feed order → letters A/B). More than two isn't a
  // before/after, so the mode takes the first two and notes it below. Keyed by the joined ids so the
  // load refires on the SET, not on the array identity (a fresh array every render).
  const pairKey = suiteRunIds.slice(0, 2).join(",");

  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      const pair = pairKey.split(",").filter(Boolean);
      if (pair.length < 2) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const next = await loadSuiteCompare(pair, data);
        if (isActive()) setCompare(next);
      } catch (cause) {
        if (isActive()) setError(getErrorMessage(cause, "Couldn’t load the suite runs."));
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [pairKey, data],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const onDrill = useCallback(
    (baselineRunId: string, comparisonRunId: string) => {
      navigate(`/testing/runs/compare?ids=${baselineRunId},${comparisonRunId}&mode=summary`);
    },
    [navigate],
  );

  const onExport = useCallback(() => {
    if (!compare) return;
    const markdown = buildSuiteCompareMarkdown(compare);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `suite-compare-${compare.baseline.id}-vs-${compare.comparison.id}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }, [compare]);

  if (pairKey.split(",").filter(Boolean).length < 2) {
    return (
      <StatePanel
        kind="empty"
        icon={<GitCompareArrows aria-hidden />}
        title="Pick two suite runs to compare"
        description="Select two suite runs on the Runs page (tick their checkboxes, then Compare suites) to see their pass-rate, grade and cost deltas and a test × environment grid."
        actions={
          <Button variant="outline" onClick={() => navigate("/testing/runs")}>
            Go to Runs
          </Button>
        }
      />
    );
  }

  if (loading) {
    return (
      <StatePanel kind="loading" title="Loading suite runs…" loadingLabel="Loading suite runs…" />
    );
  }

  if (error || !compare) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load the suite comparison."
        description={error ?? "No suite-run data available."}
        actions={
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading level={2} size="subtitle">
          Suite comparison
        </Heading>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate("/testing/runs")}>
            <GitCompareArrows aria-hidden />
            <span>Back to Runs</span>
          </Button>
          <Button variant="outline" onClick={onExport}>
            <Download aria-hidden />
            <span>Export</span>
          </Button>
        </div>
      </div>

      {suiteRunIds.length > 2 ? (
        <Text variant="meta" tone="muted">
          Comparing the first two of {suiteRunIds.length} selected suite runs (A → B).
        </Text>
      ) : null}

      <SuiteVerdictStrip compare={compare} />

      <div className="flex flex-col gap-2">
        <Text variant="meta" tone="muted">
          Test × environment — grade and cost Δ per cell (B − A). Green is better, red is worse; a
          red cell with a status chip is an errored member. Click a cell to compare its member runs.
        </Text>
        <SuiteEnvGrid compare={compare} onDrill={onDrill} />
      </div>
    </div>
  );
}
