import { useEffect, useMemo, useState } from "react";
import type { RunDetail } from "@mcp-token-footprint/shared";
import { StatePanel, Switch, Text, ToggleGroup, ToggleGroupItem, cn } from "@elabs-ai/components-ui";
import { getRun } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import type { RunModeProps } from "./compare-runs";
import { buildFlowLane } from "./flow/build-flow";
import { alignLanes } from "./flow/align";
import { collapseColumns } from "./flow/collapse";
import { baselineIndex, divergenceColumnId, maxStepTokens } from "./flow/flow-derive";
import { FlowLanes } from "./flow/FlowLanes";
import { SkillsSummary } from "./flow/SkillsSummary";
import { ToolsRibbon } from "./flow/ToolsRibbon";
import { FLOW_LENSES, FLOW_LENS_LABEL, type FlowLens } from "./flow/flow-types";
import { StepDrawer } from "./StepDrawer";

/**
 * Flow mode — the process-flow diff (audit §H4, the workspace's hardest surface). Two-to-three runs of
 * one test rendered as ALIGNED lanes: the console's trace model ({@link buildFlowLane}, reusing
 * `buildTimeline`) flattened into event blocks, then {@link alignLanes} LCS-aligns them turn-by-turn
 * so equivalent steps sit level and divergences render as tinted gaps. Three reduce-to-signal lenses
 * (Tools ribbon · Skills · Cost heat) layer over the same aligned model.
 *
 * Data: one `GET /api/runs/:id` per run (the finished-run replay artifact — steps + events + skills).
 */
export function FlowMode({ runs, focus, onFocus }: RunModeProps) {
  const [details, setDetails] = useState<Map<string, RunDetail>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lens, setLens] = useState<FlowLens>("none");
  // "Changes only" (WP-4/F3): default OFF — only long (>=3) unchanged runs collapse; ON collapses
  // every unchanged run, however short.
  const [changesOnly, setChangesOnly] = useState(false);

  const idsKey = runs.map((run) => run.id).join(",");

  useEffect(() => {
    const ids = idsKey.split(",").filter(Boolean);
    if (ids.length < 2) {
      setDetails(new Map());
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all(ids.map((id) => getRun(id)))
      .then((loaded) => {
        if (!active) return;
        setDetails(new Map(loaded.map((detail) => [detail.id, detail])));
      })
      .catch((cause) => {
        if (active) setError(getErrorMessage(cause, "Couldn’t load the run traces."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [idsKey]);

  const lanes = useMemo(
    () =>
      runs
        .map((run) => {
          const detail = details.get(run.id);
          return detail ? buildFlowLane(run, detail) : null;
        })
        .filter((lane): lane is NonNullable<typeof lane> => lane != null),
    [runs, details],
  );

  const columns = useMemo(() => alignLanes(lanes), [lanes]);
  const baselineIdx = useMemo(() => baselineIndex(lanes), [lanes]);
  const divergenceId = useMemo(() => divergenceColumnId(columns), [columns]);
  const maxTokens = useMemo(() => maxStepTokens(columns), [columns]);
  // The collapsed display rows FlowLanes renders (WP-4/F3). StepDrawer/divergence/heat all keep
  // reading the raw `columns` — grouping is purely a render-layer concern.
  const rows = useMemo(() => collapseColumns(columns, { changesOnly }), [columns, changesOnly]);

  if (runs.length < 2) {
    return (
      <StatePanel
        kind="empty"
        title="Add a second run"
        description="Flow mode diffs the process flows of two or three runs side by side. Add another run of this test above."
      />
    );
  }

  if (loading && lanes.length === 0) {
    return (
      <StatePanel kind="loading" title="Loading run traces…" loadingLabel="Loading run traces…" />
    );
  }

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load the run traces."
        description={`${error} Try again.`}
      />
    );
  }

  if (lanes.length < 2) {
    return (
      <StatePanel
        kind="empty"
        title="No trace to diff"
        description="These runs have no recorded steps to align — open them in the console to confirm they produced a trace."
      />
    );
  }

  const showLanes = lens === "none" || lens === "cost" || lens === "skills";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Lens toggle + the D-UX9 diff legend. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <ToggleGroup
          type="single"
          value={lens}
          aria-label="Flow lens"
          onValueChange={(next) => {
            if (next && (FLOW_LENSES as readonly string[]).includes(next))
              setLens(next as FlowLens);
          }}
          className="w-fit"
        >
          {FLOW_LENSES.map((value) => (
            <ToggleGroupItem key={value} value={value} aria-label={FLOW_LENS_LABEL[value]}>
              {FLOW_LENS_LABEL[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {lens !== "tools" && (
          <label className="flex cursor-pointer items-center gap-2">
            <Switch
              checked={changesOnly}
              onCheckedChange={setChangesOnly}
              aria-label="Changes only"
            />
            <Text variant="caption" tone="muted" as="span">
              Changes only
            </Text>
          </label>
        )}
        {lens !== "tools" && <DiffLegend cost={lens === "cost"} />}
      </div>

      {/* The step drawer (H5 · level 2): opens when `?focus=` addresses a flow cell, resolving it to
          the run's node + backing steps and reusing the console inspector — without leaving compare.
          A portal `Sheet`, so it can mount here regardless of the active lens. */}
      <StepDrawer
        focus={focus}
        lanes={lanes}
        columns={columns}
        details={details}
        onClose={() => onFocus(null)}
      />

      {lens === "tools" ? (
        <ToolsRibbon lanes={lanes} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {lens === "skills" && (
            <div className="shrink-0">
              <SkillsSummary lanes={lanes} />
            </div>
          )}
          {showLanes && (
            <FlowLanes
              lanes={lanes}
              rows={rows}
              baselineIdx={baselineIdx}
              divergenceId={divergenceId}
              maxTokens={maxTokens}
              costLens={lens === "cost"}
              skillsLens={lens === "skills"}
              focus={focus}
              onFocus={onFocus}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** The add/remove/changed key — and, under the Cost lens, the token-heat scale. */
function DiffLegend({ cost }: { cost: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <LegendSwatch className="bg-success" label="Added" />
      <LegendSwatch className="bg-destructive" label="Removed" />
      <LegendSwatch className="bg-warning" label="Changed" />
      <LegendSwatch className="bg-border" label="Unchanged" />
      {cost && (
        <span className="flex items-center gap-1">
          <Text variant="caption" tone="muted">
            Heat:
          </Text>
          <span className="h-3 w-4 rounded-sm bg-warning/10" />
          <span className="h-3 w-4 rounded-sm bg-warning/20" />
          <span className="h-3 w-4 rounded-sm bg-warning/30" />
          <span className="h-3 w-4 rounded-sm bg-warning/40" />
        </span>
      )}
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("h-3 w-3 rounded-sm", className)} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </span>
  );
}
