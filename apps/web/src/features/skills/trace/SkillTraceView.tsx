import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  RunSummary,
  SessionTrace,
  SkillDiff,
  SkillGraph,
  SkillSuggestion,
  SkillUsage,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import type { Edge } from "@elabs-ai/components-flow";
import { InspectorPanel } from "@elabs-ai/components-flow";
import { PlayCircle, Server } from "lucide-react";
import { getSkillUsage } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { formatDateTime } from "../../../lib/format";
import { StatusBadge } from "../../../components/StatusBadge";
import { runStatusBadgeView } from "../../testing/RunBar";
import { RunLauncher, type RunLauncherIntent } from "../../testing/run-launcher/RunLauncher";
import { SaveVersionDialog } from "../design/SaveVersionDialog";
import {
  buildFlow,
  NODE_KIND_LEGEND_ITEMS,
  SkillGraphCanvas,
  type SkillCanvasNode,
  type TraceCanvasOverlay,
} from "../design/SkillGraphCanvas";
import {
  getSkillGraph,
  getSkillSuggestions,
  getSkillTrace,
  getSkillVersion,
  getSkillVersionRuns,
} from "../skills-inspector-api";
import { TraceEvidencePane } from "./TraceEvidencePane";
import { TraceFocusNode, type TraceFocusRequest } from "./TraceFocusNode";
import { TRACE_VERDICT_LEGEND_ITEMS, TRACE_VERDICT_META } from "./trace-verdict-meta";
import { notifyError } from "../../../lib/notify";

export type SkillTraceViewProps = {
  skillId: string;
  versionId: string;
  /** Refresh the skill + switch the active version once a suggestion is applied (WP 5.2). */
  onVersionSaved?: (newVersionId: string) => void;
  /** Deep-link into the Diff tab for (fromVersionId, toVersionId) — the apply dialog's "View full diff". */
  onOpenDiff?: (fromVersionId: string, toVersionId: string) => void;
};

/** The Trace canvas legend: the three verdict states plus the five node kinds. WP 7.6 (SI6): docked
 *  INSIDE the Evidence panel (a collapsible section in {@link TraceEvidencePane}) — never floated
 *  over the canvas, never parked in the toolbar row (whose height it used to inflate into the
 *  audit's 242px void). */
const TRACE_LEGEND_ITEMS = [...TRACE_VERDICT_LEGEND_ITEMS, ...NODE_KIND_LEGEND_ITEMS];

/** Per-verdict-status counts + the unmatched-event count for the summary strip. */
function summarize(trace: SessionTrace): {
  ok: number;
  fracture: number;
  unvisited: number;
  unmatched: number;
} {
  let ok = 0;
  let fracture = 0;
  let unvisited = 0;
  for (const verdict of trace.alignment.verdicts) {
    if (verdict.status === "ok") ok += 1;
    else if (verdict.status === "fracture") fracture += 1;
    else unvisited += 1;
  }
  return { ok, fracture, unvisited, unmatched: trace.alignment.unmatchedEvents.length };
}

/** A one-line, plain-language verdict for a run's alignment summary (K4). */
function traceVerdict(summary: {
  ok: number;
  fracture: number;
  unvisited: number;
  unmatched: number;
}): string {
  const matched = summary.ok + summary.fracture;
  if (matched === 0) {
    // The run never touched the skill's designed path.
    return summary.unmatched > 0
      ? `This run never activated the skill — all ${summary.unmatched} event${
          summary.unmatched === 1 ? "" : "s"
        } went unmatched.`
      : "This run never activated the skill — it produced no events to align.";
  }
  if (summary.fracture === 0) {
    return `This run followed the design — ${summary.ok} node${summary.ok === 1 ? "" : "s"} executed as designed${
      summary.unmatched > 0
        ? `, with ${summary.unmatched} unmatched event${summary.unmatched === 1 ? "" : "s"}`
        : ""
    }.`;
  }
  return `This run diverged from the design — ${summary.fracture} fracture${
    summary.fracture === 1 ? "" : "s"
  } across ${matched} activated node${matched === 1 ? "" : "s"}${
    summary.unmatched > 0 ? `, ${summary.unmatched} unmatched` : ""
  }.`;
}

/**
 * The Trace tab (WP 2.3): pick one of the runs that resolved this skill version (via `run_skills` —
 * a scenario the skill was attached to and tested), fetch its aligned `SessionTrace`, and overlay
 * the alignment onto the SAME canvas the Design tab renders ({@link SkillGraphCanvas} — one
 * implementation, no fork): `tone="success"` where execution matched design, `tone="destructive"`
 * on fractures (reason in the node subtitle), dimmed never-visited nodes, execution-count badges,
 * and traversal counts on traversed edges. Beside the canvas, {@link TraceEvidencePane} lists the
 * normalized events; selecting a node filters to that verdict's evidence, and — WP 5.2 — surfaces
 * any deterministic suggestions for that node with a "Review & apply…" flow that reuses the WP 4.2
 * {@link SaveVersionDialog} (prefilled ops + a "SkillFlow suggestion: <rule>" note). Applying a
 * suggestion is the only mutation this view ever triggers — everything else is read-only GETs.
 *
 * Trace Mode sources are ONLY this app's own test runs (owner decision 2026-07-03); the external
 * session-JSONL upload source was removed.
 */
export function SkillTraceView({
  skillId,
  versionId,
  onVersionSaved,
  onOpenDiff,
}: SkillTraceViewProps) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [graph, setGraph] = useState<SkillGraph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  // The version's CURRENT `treeSha` (WP 5.2's apply flow needs it as `baseTreeSha`) — loaded
  // alongside the graph; re-loaded on demand if a suggestion's apply dialog hits a 409.
  const [version, setVersion] = useState<SkillVersion | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(undefined);
  const [trace, setTrace] = useState<SessionTrace | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>(undefined);

  // WP 7.6 — evidence→canvas linking: the Evidence panel's latest "center this node" request,
  // consumed by the `TraceFocusNode` child inside the canvas. `tick` lets a repeat click re-center.
  const [focusRequest, setFocusRequest] = useState<TraceFocusRequest | null>(null);

  // WP 5.2 — the feedback loop: fetched once per trace load (not per node-selection). `null` while
  // loading/not-yet-fetched; a fetch failure is a toast (best-effort — suggestions are additive, the
  // trace itself already rendered successfully by the time this fires).
  const [suggestions, setSuggestions] = useState<SkillSuggestion[] | null>(null);
  const [applySuggestion, setApplySuggestion] = useState<SkillSuggestion | null>(null);
  const [suggestionSavedVersionId, setSuggestionSavedVersionId] = useState<string | null>(null);

  // Load the version's run list + design graph together.
  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setRunsError(null);
    setGraph(null);
    setGraphError(null);
    setVersion(null);
    setSelectedRunId(undefined);
    setTrace(null);
    setTraceError(null);
    setSelectedNodeId(undefined);
    setFocusRequest(null);
    setSuggestions(null);
    getSkillVersionRuns(skillId, versionId)
      .then((loaded) => {
        if (cancelled) return;
        setRuns(loaded);
        // Auto-select the newest run so the overlay appears without an extra click.
        if (loaded.length > 0) setSelectedRunId(loaded[0]?.id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setRunsError(getErrorMessage(err, "Couldn’t load runs"));
      });
    getSkillGraph(skillId, versionId)
      .then((response) => {
        if (!cancelled) setGraph(response.graph);
      })
      .catch((err: unknown) => {
        if (!cancelled) setGraphError(getErrorMessage(err, "Couldn’t load the skill graph"));
      });
    // The version's treeSha — WP 5.2's apply-suggestion dialog needs it as `baseTreeSha`. A failure
    // here only disables "Review & apply…" (the dialog never renders without a treeSha); the trace
    // itself still works, so this doesn't feed into `graphError`.
    getSkillVersion(skillId, versionId)
      .then((loaded) => {
        if (!cancelled) setVersion(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  // Fetch the aligned trace whenever the selected run changes; on success, fetch this trace's WP 5.2
  // suggestions ONCE (not re-fetched per node selection — TraceEvidencePane filters the same list
  // client-side as the canvas selection changes).
  useEffect(() => {
    if (!selectedRunId) {
      setTrace(null);
      setTraceError(null);
      setSuggestions(null);
      return;
    }
    let cancelled = false;
    setTrace(null);
    setTraceError(null);
    setSelectedNodeId(undefined);
    setFocusRequest(null);
    setSuggestions(null);
    getSkillTrace(skillId, versionId, selectedRunId)
      .then((loaded) => {
        if (cancelled) return;
        setTrace(loaded);
        getSkillSuggestions(skillId, versionId, { runId: selectedRunId })
          .then((response) => {
            if (!cancelled) setSuggestions(response.suggestions);
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            setSuggestions([]);
            notifyError("Couldn’t load suggestions", {
              description: `${getErrorMessage(err, "The SkillFlow suggestions didn’t come back.")} Switch runs, then switch back to try again.`,
            });
          });
      })
      .catch((err: unknown) => {
        // Surfaces the server's message inline — notably the 409 version-mismatch reason.
        if (!cancelled) setTraceError(getErrorMessage(err, "Couldn’t load the trace"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId, selectedRunId]);

  const handleSuggestionApplyOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      setApplySuggestion(null);
      if (suggestionSavedVersionId) {
        onVersionSaved?.(suggestionSavedVersionId);
        setSuggestionSavedVersionId(null);
      }
    },
    [suggestionSavedVersionId, onVersionSaved],
  );

  // WP 7.6 — an Evidence-panel event row was clicked: center its verdict's node on the canvas.
  const handleFocusNode = useCallback((nodeId: string) => {
    setFocusRequest((previous) => ({ nodeId, tick: (previous?.tick ?? 0) + 1 }));
  }, []);

  const handleSuggestionReload = useCallback(async () => {
    const [graphResponse, loadedVersion] = await Promise.all([
      getSkillGraph(skillId, versionId),
      getSkillVersion(skillId, versionId),
    ]);
    setGraph(graphResponse.graph);
    setVersion(loadedVersion);
  }, [skillId, versionId]);

  const overlay: TraceCanvasOverlay | undefined = useMemo(() => {
    if (!trace) return undefined;
    const nodes = new Map<
      string,
      { status: "ok" | "fracture" | "unvisited"; visits: number; reason?: string }
    >();
    for (const verdict of trace.alignment.verdicts) {
      if (!verdict.nodeId) continue;
      nodes.set(verdict.nodeId, {
        status: verdict.status,
        visits: trace.alignment.nodeVisits[verdict.nodeId] ?? 0,
        reason: verdict.reason,
      });
    }
    const edgeTraversals = new Map<string, number>();
    for (const [edgeId, count] of Object.entries(trace.alignment.edgeTraversals)) {
      if (count > 0) edgeTraversals.set(edgeId, count);
    }
    return { nodes, edgeTraversals };
  }, [trace]);

  const { nodes, edges } = useMemo(
    () =>
      graph
        ? buildFlow(graph, overlay)
        : { nodes: [] as SkillCanvasNode[], edges: [] as Edge[], droppedEdges: 0 },
    [graph, overlay],
  );

  const summary = useMemo(() => (trace ? summarize(trace) : undefined), [trace]);

  const runOptions = useMemo(
    () =>
      (runs ?? []).map((run) => ({
        value: run.id,
        run,
      })),
    [runs],
  );

  if (runsError) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load runs — refresh the page to try again."
        description={runsError}
      />
    );
  }
  if (graphError) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load the design graph — refresh the page to try again."
        description={graphError}
      />
    );
  }
  if (runs === null || graph === null) {
    return <StatePanel kind="loading" title="Loading…" loadingLabel="Loading runs and graph…" />;
  }

  if (graph.nodes.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="Nothing to trace"
        description="No sections were found in this version's SKILL.md, so there's no graph to overlay a run onto."
      />
    );
  }

  // No test run has exercised this skill version yet — teach the attach → run → trace chain (K4).
  if (runs.length === 0) {
    return <TraceEmptyState skillId={skillId} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* WP 7.6 (SI6) — ONE compact toolbar block at the top of the tab content: the run picker +
          the value-aware conformance chips on a single row, the plain-language verdict directly
          beneath. Nothing tall or floating lives here (the legend is docked in the Evidence panel),
          so the canvas starts immediately below — zero dead vertical space. */}
      <div className="flex shrink-0 flex-col gap-2" data-testid="trace-toolbar">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="flex w-full max-w-sm flex-col gap-1.5">
            <Label htmlFor="trace-run-picker">Run</Label>
            <Select value={selectedRunId ?? ""} onValueChange={setSelectedRunId}>
              <SelectTrigger
                id="trace-run-picker"
                className="w-full"
                data-testid="trace-run-picker"
              >
                <SelectValue placeholder="Select a run…" />
              </SelectTrigger>
              <SelectContent>
                {runOptions.map(({ value, run }) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex items-center gap-2">
                      {/* AR11 — review-aware: a terminal run still being rated reads "Reviewing…".
                          WP3.fix (D-US5) — threads `stopReasonCode`/`phase` too, for the precise
                          locked-table label/tone. */}
                      <StatusBadge
                        view={runStatusBadgeView(
                          run.status,
                          run.outcome,
                          run.ratingState,
                          run.stopReasonCode,
                          run.phase,
                        )}
                      />
                      <span className="tabular-nums">{formatDateTime(run.startedAt)}</span>
                      <Text variant="meta" tone="muted" as="span" className="tabular-nums">
                        {run.turns} turn{run.turns === 1 ? "" : "s"} · {run.toolCalls} tool call
                        {run.toolCalls === 1 ? "" : "s"}
                      </Text>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {summary ? (
            <div className="flex flex-wrap items-center gap-1.5 pb-1" data-testid="trace-summary">
              {/* Value-aware chips (K4 / conventions §3): a zero count renders neutral, never a tone
                  that implies good/bad. Only non-zero ok/fracture counts carry their success/danger tone. */}
              <Badge
                variant={summary.ok > 0 ? TRACE_VERDICT_META.ok.badgeVariant : "secondary"}
                className="tabular-nums"
              >
                {summary.ok} ok
              </Badge>
              <Badge
                variant={
                  summary.fracture > 0 ? TRACE_VERDICT_META.fracture.badgeVariant : "secondary"
                }
                className="tabular-nums"
              >
                {summary.fracture} fracture{summary.fracture === 1 ? "" : "s"}
              </Badge>
              <Badge variant={TRACE_VERDICT_META.unvisited.badgeVariant} className="tabular-nums">
                {summary.unvisited} unvisited
              </Badge>
              <Badge variant="secondary" className="tabular-nums">
                {summary.unmatched} unmatched
              </Badge>
            </div>
          ) : null}
        </div>

        {/* K4 — a one-line plain-language verdict, so an all-unmatched run doesn't read as an
            ambiguous "0 ok / 0 fracture". */}
        {summary ? (
          <Text variant="meta" tone="muted" className="text-pretty" data-testid="trace-verdict">
            {traceVerdict(summary)}
          </Text>
        ) : null}
      </div>

      {traceError ? (
        // A settled failure (e.g. the 409 version-mismatch) — inline, with the server's reason.
        <ErrorState
          title="Couldn’t load the trace — switch runs or refresh the page to try again."
          description={traceError}
        />
      ) : selectedRunId && trace === null ? (
        <StatePanel
          kind="loading"
          title="Aligning…"
          loadingLabel="Aligning the run against the design graph…"
        />
      ) : (
        // WP 7.6 — the lens layout: a FLEX ROW filling all remaining height. The canvas grows; the
        // Evidence panel is a fixed-width flex sibling (`InspectorPanel` reserves its own width via
        // a spacer), so the canvas can never extend beneath it.
        <div
          className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border"
          data-testid="trace-lens-layout"
        >
          <div className="relative min-w-0 flex-1" data-testid="trace-canvas-region">
            <SkillGraphCanvas nodes={nodes} edges={edges} onSelectNode={setSelectedNodeId}>
              <TraceFocusNode request={focusRequest} />
            </SkillGraphCanvas>
          </div>
          <InspectorPanel
            title="Evidence"
            width="22rem"
            hasSelection={trace !== null}
            selectionKey={selectedNodeId ?? "all"}
            emptyMessage="Pick a run to see its trace events here."
          >
            {trace && selectedRunId ? (
              <TraceEvidencePane
                runId={selectedRunId}
                trace={trace}
                graph={graph}
                selectedNodeId={selectedNodeId}
                suggestions={suggestions}
                onApplySuggestion={setApplySuggestion}
                legendItems={TRACE_LEGEND_ITEMS}
                onFocusNode={handleFocusNode}
              />
            ) : null}
          </InspectorPanel>
        </div>
      )}

      {applySuggestion && version ? (
        <SaveVersionDialog
          open
          onOpenChange={handleSuggestionApplyOpenChange}
          skillId={skillId}
          versionId={versionId}
          baseTreeSha={version.treeSha}
          graph={graph}
          ops={applySuggestion.ops}
          initialNote={`SkillFlow suggestion: ${applySuggestion.rule}`}
          onDiscardOps={() => setApplySuggestion(null)}
          onSaved={(savedVersion: SkillVersion, _diff: SkillDiff, _warnings: string[]) => {
            setSuggestionSavedVersionId(savedVersion.id);
          }}
          onReload={handleSuggestionReload}
          onViewDiff={(fromId, toId) => onOpenDiff?.(fromId, toId)}
        />
      ) : null}
    </div>
  );
}

/**
 * UX WP 3.3 (G11/S20) — the instructive empty state for a skill version no run has exercised yet. A
 * trace is built by aligning one of the app's OWN test runs onto this skill's design graph, so the
 * empty state teaches that chain — attach → run → trace — with a link to the Environments screen and
 * a one-click "Test this skill" that opens the run launcher pre-seeded with the environments this
 * skill is attached to. Usage is skill-level (`GET /api/skills/:id/usage`); a fetch failure degrades
 * to the attach-first guidance (the "Test this skill" affordance simply stays hidden).
 */
function TraceEmptyState({ skillId }: { skillId: string }) {
  const [usage, setUsage] = useState<SkillUsage | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    getSkillUsage(skillId)
      .then((loaded) => {
        if (!cancelled) setUsage(loaded);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  const attached = usage?.environments ?? [];
  const scenarioIds = attached.map((env) => env.scenarioId);
  const intent = useMemo<RunLauncherIntent>(
    () => ({ kind: "environments", scenarioIds }),
    // The pre-seed set only changes when the attached environments change.
    [scenarioIds.join(",")],
  );

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Nothing to trace yet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Text tone="muted" className="text-pretty">
            A trace overlays one of the app’s own test runs onto this skill’s design graph. No run
            has exercised this version yet — follow the chain to get one:
          </Text>
          <ol className="flex flex-col gap-3">
            <li className="flex gap-2.5">
              <Badge variant="secondary" className="mt-0.5 shrink-0 tabular-nums">
                1
              </Badge>
              <div className="flex min-w-0 flex-col items-start gap-1">
                <Text as="span" className="text-pretty">
                  <span className="font-medium">Attach</span> this skill to an environment.
                  {attached.length > 0 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      Attached to {attached.length} environment{attached.length === 1 ? "" : "s"}.
                    </span>
                  ) : null}
                </Text>
                <Button asChild variant="link" size="sm" className="h-auto justify-start px-0">
                  <Link to="/testing/environments">
                    <Server aria-hidden className="size-3.5" /> Open Environments
                  </Link>
                </Button>
              </div>
            </li>
            <li className="flex gap-2.5">
              <Badge variant="secondary" className="mt-0.5 shrink-0 tabular-nums">
                2
              </Badge>
              <div className="flex min-w-0 flex-col items-start gap-1">
                <Text as="span" className="text-pretty">
                  <span className="font-medium">Run</span> a test in an environment that has it
                  attached.
                </Text>
                {attached.length > 0 ? (
                  <Button size="sm" onClick={() => setLauncherOpen(true)}>
                    <PlayCircle aria-hidden />
                    <span>Test this skill…</span>
                  </Button>
                ) : (
                  <Text variant="meta" tone="muted">
                    Attach an environment first (step 1), then launch a run.
                  </Text>
                )}
              </div>
            </li>
            <li className="flex gap-2.5">
              <Badge variant="secondary" className="mt-0.5 shrink-0 tabular-nums">
                3
              </Badge>
              <Text as="span" className="text-pretty">
                <span className="font-medium">Return</span> here — the run appears in the picker and
                its trace overlays this graph.
              </Text>
            </li>
          </ol>
        </CardContent>
      </Card>

      <RunLauncher open={launcherOpen} onOpenChange={setLauncherOpen} intent={intent} />
    </div>
  );
}
