import { useMemo } from "react";
import {
  formatNumber,
  isSectionKind,
  reachFromEntry,
  type BoundTool,
  type SkillFlowNodeCost,
  type SkillGraph,
  type SkillGraphNode,
} from "@mcp-token-footprint/shared";
import { Alert, AlertDescription, Badge, Text } from "@elabs-ai/components-ui";
import { Info } from "lucide-react";

// ── RM-30 WP 7.8 — the token figure ───────────────────────────────────────────────────────────────
// "/analyze — always reads 4 sections, 1,240 tokens. May additionally read 1 file and call 1 tool,
// up to 3,900 tokens."
//
// This sentence is the deliverable of the work package. It is what turns the diagram from a picture
// into a measurement, and it is the only place in the app that answers the question the whole
// workbench exists for: WHEN THIS SKILL FIRES, WHAT DOES THE MODEL ACTUALLY END UP READING?
//
// Every number is measured, never modelled:
//   • the reachability sets come from the ONE shared `reachFromEntry` (the projector, the connect
//     handler and the tests read the same grammar it walks);
//   • a section's tokens come from the API's `flow-tokens` route, which counts that section's own
//     SKILL.md span with the VERSION's token profile — the same `TokenCounter` the L1/L2/L3 footprint
//     uses, not a second counter;
//   • a bundled file's tokens are the footprint's already-persisted per-file total;
//   • a tool's tokens are its SCAN's `definitionTokens`, because a tool definition is the server's
//     cost, not the skill's.
//
// Absent means UNKNOWN, never zero. A box the API could not measure — a section the author just
// dropped on the canvas and has not saved, a tool no bound server exposes — is COUNTED SEPARATELY and
// said out loud ("2 not yet measured"), because a silently-omitted box reads as a cheaper skill.

/** One flow's measured reading list. Pure; exported so a test can assert the arithmetic directly. */
export type FlowReading = {
  entryLabel: string;
  /** True for a keyword entry: its flow is the whole skill by definition (design decision 2). */
  wholeSkill: boolean;
  alwaysSections: number;
  alwaysTokens: number;
  maybeFiles: number;
  maybeTools: number;
  maybeSections: number;
  /** always + every maybe: the CEILING, what it costs if the model opens everything it may open. */
  ceilingTokens: number;
  /** Reached boxes with no measurement available — reported, never silently treated as free. */
  unmeasured: number;
};

/** What a node contributes and how it is counted. `undefined` tokens ⇒ unmeasured. */
function nodeTokens(
  node: SkillGraphNode,
  costs: ReadonlyMap<string, number>,
  toolTokens: ReadonlyMap<string, number>,
): number | undefined {
  if (node.kind === "tool_ref") return toolTokens.get(node.toolName);
  return costs.get(node.id);
}

/**
 * Measure one entry point's reading list over a graph.
 *
 * Pure and total: an unknown entry id yields a zeroed reading rather than throwing, because the
 * canvas may hold a selection from a graph it has since re-projected.
 */
export function measureFlowReading(
  graph: SkillGraph,
  entryNodeId: string,
  costs: ReadonlyMap<string, number>,
  toolTokens: ReadonlyMap<string, number>,
): FlowReading {
  const reach = reachFromEntry(graph, entryNodeId);
  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const entry = byId.get(entryNodeId);
  const entryLabel =
    entry && entry.kind === "entry_point" ? entry.trigger.value : (entry?.label ?? entryNodeId);

  let alwaysSections = 0;
  let alwaysTokens = 0;
  let maybeFiles = 0;
  let maybeTools = 0;
  let maybeSections = 0;
  let maybeTokens = 0;
  let unmeasured = 0;

  for (const id of reach.always) {
    const node = byId.get(id);
    if (!node) continue;
    // The entry point IS a section of the document (a `/command` heading), so its own prose counts —
    // but it is the thing you picked, not something it "reads", so it is not one of the N sections.
    if (isSectionKind(node.kind)) alwaysSections += 1;
    const tokens = nodeTokens(node, costs, toolTokens);
    if (tokens === undefined) unmeasured += 1;
    else alwaysTokens += tokens;
  }

  for (const id of reach.maybe) {
    const node = byId.get(id);
    if (!node) continue;
    if (node.kind === "asset" || node.kind === "validation_gate") maybeFiles += 1;
    else if (node.kind === "tool_ref") maybeTools += 1;
    else if (isSectionKind(node.kind) || node.kind === "entry_point") maybeSections += 1;
    const tokens = nodeTokens(node, costs, toolTokens);
    if (tokens === undefined) unmeasured += 1;
    else maybeTokens += tokens;
  }

  return {
    entryLabel,
    wholeSkill: reach.wholeSkill,
    alwaysSections,
    alwaysTokens,
    maybeFiles,
    maybeTools,
    maybeSections,
    ceilingTokens: alwaysTokens + maybeTokens,
    unmeasured,
  };
}

/** "1 file and 1 tool" / "2 files" / "" — the maybe clause's subject, in plain English. */
function maybeSubject(reading: FlowReading): string {
  const parts: string[] = [];
  if (reading.maybeSections > 0) {
    parts.push(`${reading.maybeSections} ${reading.maybeSections === 1 ? "section" : "sections"}`);
  }
  if (reading.maybeFiles > 0) {
    parts.push(`${reading.maybeFiles} ${reading.maybeFiles === 1 ? "file" : "files"}`);
  }
  if (reading.maybeTools > 0) {
    parts.push(`${reading.maybeTools} ${reading.maybeTools === 1 ? "tool" : "tools"}`);
  }
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export type FlowReadingPanelProps = {
  graph: SkillGraph;
  entryNodeId: string;
  /** Per-node read cost from `GET …/flow-tokens`. Empty while it loads or if the fetch failed. */
  costs: SkillFlowNodeCost[];
  /** The bound servers' scanned tools — a tool's definition tokens come from the SCAN, not the skill. */
  boundTools: BoundTool[];
  /** True while the cost fetch is in flight: the counts are honest, the token figures are not yet. */
  loading?: boolean;
};

/**
 * The panel beside the canvas: one sentence saying what this entry point puts in front of the model,
 * and what it costs. Semantic tokens only; reads in both themes; every number `tabular-nums`.
 */
export function FlowReadingPanel({
  graph,
  entryNodeId,
  costs,
  boundTools,
  loading = false,
}: FlowReadingPanelProps) {
  const costMap = useMemo(
    () => new Map(costs.map((cost) => [cost.nodeId, cost.tokens] as const)),
    [costs],
  );
  const toolMap = useMemo(
    () => new Map(boundTools.map((tool) => [tool.toolName, tool.definitionTokens] as const)),
    [boundTools],
  );
  const reading = useMemo(
    () => measureFlowReading(graph, entryNodeId, costMap, toolMap),
    [graph, entryNodeId, costMap, toolMap],
  );

  const subject = maybeSubject(reading);
  const measuring = loading || costs.length === 0;

  return (
    <Alert className="shrink-0">
      <Info aria-hidden />
      <AlertDescription>
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <Badge variant="secondary" className="font-mono">
            {reading.entryLabel}
          </Badge>
          <Text variant="meta" as="span">
            always reads{" "}
            <span className="font-medium tabular-nums">
              {formatNumber(reading.alwaysSections)}{" "}
              {reading.alwaysSections === 1 ? "section" : "sections"}
            </span>
            {measuring ? (
              <span className="text-muted-foreground">, measuring…</span>
            ) : (
              <>
                ,{" "}
                <span className="font-medium tabular-nums">
                  {formatNumber(reading.alwaysTokens)} tokens
                </span>
              </>
            )}
            .
            {subject === "" ? (
              " Nothing else is reachable from here."
            ) : (
              <>
                {" "}
                May additionally read {subject}
                {measuring ? (
                  <span className="text-muted-foreground">, still measuring.</span>
                ) : (
                  <>
                    , up to{" "}
                    <span className="font-medium tabular-nums">
                      {formatNumber(reading.ceilingTokens)} tokens
                    </span>
                    .
                  </>
                )}
              </>
            )}
          </Text>
        </div>
        {reading.wholeSkill ? (
          <Text variant="meta" tone="muted" className="mt-1 block text-pretty">
            A keyword loads the whole document, so this flow is the entire skill — there is no
            smaller per-keyword reading list to show, and inventing one would be fiction.
          </Text>
        ) : null}
        {reading.unmeasured > 0 && !measuring ? (
          <Text variant="meta" tone="muted" className="mt-1 block text-pretty">
            <span className="tabular-nums">{formatNumber(reading.unmeasured)}</span> reached{" "}
            {reading.unmeasured === 1 ? "box is" : "boxes are"} not yet measured — an unsaved edit,
            or a tool no bound server exposes. Their cost is excluded rather than counted as zero.
          </Text>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
