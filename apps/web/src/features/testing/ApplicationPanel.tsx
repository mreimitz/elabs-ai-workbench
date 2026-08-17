import { useMemo } from "react";
import type { ReactNode } from "react";
import type { RunStep } from "@mcp-token-footprint/shared";
import { SplitPanel, StatePanel, Text, Tree } from "@elabs-ai/components-ui";
import type { TreeNode } from "@elabs-ai/components-ui";
import { ArrowDownToLine, Hammer, PackageOpen } from "lucide-react";
import { ArtifactPreview, lastLlmResponseIndex } from "./ArtifactPreview";
import { firstProfileTokens, stepTypeMeta } from "./StepLog";
import { formatNumber } from "../../lib/format";

/**
 * The Inspector's **Application** panel (WP 3.9, UI §3.4) — the Chrome-DevTools "Application" analog,
 * shown as a third tab beside Network (StepLog) and Console in the run console's right pane.
 *
 * It has two halves:
 *
 * 1. **Responses** (built) — a two-pane browser of every response the run produced. A `Tree` on the
 *    left groups `llm_response` + `tool_result` steps **by turn** (a turn boundary is each
 *    `llm_response`); a read-only `ArtifactPreview` on the right shows the selected response's content
 *    (JSON via Monaco / prose via `Text` / errors via `Text`). It REUSES the shared `selectedStepId`
 *    selection — a response node's id IS the step id — so selecting a response also opens the existing
 *    `PacketInspector` and cross-highlights the conversation card (the same behaviour as a StepLog
 *    row; correct, not a regression).
 *
 * 2. **Artifacts** (DEFERRED) — there is no engine/DB/shared support to CAPTURE artifacts (resource
 *    reads, tool-written files, mime/size/download) during a run yet, so this is an honest placeholder
 *    (`StatePanel`), not fabricated rows. Capturing created/downloaded documents needs run-engine + DB
 *    + shared support (coordinate with WP 1.6 / 0.4).
 */

export type ApplicationPanelProps = {
  /** All run steps (the panel reads the as-of-k sliced list so replay truncates it consistently). */
  steps: RunStep[];
  /** The lifted cross-pane selection (shared with the tool cards, StepLog, and PacketInspector). */
  selectedStepId: string | null;
  onSelectStep: (stepId: string | null) => void;
  /** The final turn's accumulated assistant text (`stream.deltas.text`). */
  finalText?: string;
  /** The final turn's accumulated reasoning (`stream.deltas.reasoning`). */
  finalReasoning?: string;
};

/** A turn-grouped tree node carries the step it represents (or null for a `turn-N` parent). */
type ResponseNodeData = { step: RunStep | null };

export function ApplicationPanel({
  steps,
  selectedStepId,
  onSelectStep,
  finalText = "",
  finalReasoning = "",
}: ApplicationPanelProps) {
  // Walk steps in order, grouping responses (llm_response + tool_result) by turn. The turn counter
  // starts at 1 and increments on each `llm_response`, so a response is attributed to the turn it
  // belongs to (the response that closes turn N, plus the tool results produced within it).
  const { nodes, turnIds } = useMemo(() => buildResponseTree(steps), [steps]);

  // The selected step resolved from the SHARED selection (only response steps are previewable).
  const selectedStep = useMemo(
    () => (selectedStepId ? (steps.find((step) => step.id === selectedStepId) ?? null) : null),
    [selectedStepId, steps],
  );

  // The last `llm_response` is the only turn whose assistant prose is available (in the live deltas).
  const lastRespIndex = useMemo(() => lastLlmResponseIndex(steps), [steps]);
  const lastRespId = lastRespIndex >= 0 ? (steps[lastRespIndex]?.id ?? null) : null;
  const selectedIsLastResponse =
    selectedStep !== null && selectedStep.type === "llm_response" && selectedStep.id === lastRespId;

  // Drive the tree selection from the shared selection (a `turn-N` parent never matches a step id, so
  // selecting a response highlights it; a non-response selection leaves the tree unselected).
  const selectedIds = selectedStepId ? [selectedStepId] : [];

  const tree =
    nodes.length === 0 ? (
      <div className="flex h-full min-h-0 items-center justify-center p-4">
        <StatePanel
          kind="empty"
          title="No responses yet"
          description="LLM responses and tool results appear here as the run streams."
        />
      </div>
    ) : (
      <Tree<ResponseNodeData>
        nodes={nodes}
        selectionMode="single"
        selectedIds={selectedIds}
        defaultExpandedIds={turnIds}
        surface="default"
        virtualize
        maxHeight="100%"
        className="h-full"
        onSelectionChange={(ids) => {
          const id = ids[0];
          // Only real step ids drive the shared selection — a `turn-N` parent is just a group header.
          if (id && !id.startsWith("turn-")) {
            onSelectStep(id === selectedStepId ? null : id);
          }
        }}
      />
    );

  return (
    <div className="flex flex-col gap-4">
      {/* Responses browser — fixed-height so the right pane's Monaco lays out (`automaticLayout`). */}
      <div className="h-[26rem] overflow-hidden rounded-md border border-border">
        <SplitPanel
          start={tree}
          end={
            <ArtifactPreview
              step={selectedStep}
              isLastResponse={selectedIsLastResponse}
              finalText={finalText}
              finalReasoning={finalReasoning}
            />
          }
          startSize="320px"
          startTone="muted"
          endTone="card"
          className="h-full"
        />
      </div>

      {/* Artifacts — DEFERRED. Honest placeholder; no fabricated rows/sizes/mime/download links. */}
      <StatePanel
        kind="empty"
        icon={<PackageOpen aria-hidden />}
        title="Artifacts — pending engine capture"
        description="Capturing the documents a run creates or downloads (MCP resource reads, tool-written files, with mime type, size, and download) needs run-engine + persistence + shared-contract support that doesn't exist yet. This lands when artifact capture is wired (coordinate with WP 1.6 / 0.4); until then no artifacts are fabricated."
      />
    </div>
  );
}

// ── tree construction ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the turn-grouped response tree. Walk `steps` in order; a `turn` counter starts at 1 and bumps
 * on each `llm_response`. Each turn that contains at least one response (an `llm_response` or a
 * `tool_result`) becomes an expandable `turn-N` parent whose children are that turn's responses, in
 * order. A response child's `id` IS its step's `id`, so tree selection maps straight to the shared
 * `selectedStepId`. Only `llm_response` + `tool_result` steps appear; the rest are skipped.
 */
function buildResponseTree(steps: RunStep[]): {
  nodes: TreeNode<ResponseNodeData>[];
  turnIds: string[];
} {
  const turns = new Map<number, TreeNode<ResponseNodeData>[]>();
  const order: number[] = [];
  let turn = 1;

  for (const step of steps) {
    if (step.type === "llm_response" || step.type === "tool_result") {
      let children = turns.get(turn);
      if (!children) {
        children = [];
        turns.set(turn, children);
        order.push(turn);
      }
      children.push(responseChild(step));
    }
    // The turn boundary is AFTER the response that closes the turn, so the closing `llm_response` is
    // attributed to the turn it ends, and subsequent steps fall into the next turn.
    if (step.type === "llm_response") turn += 1;
  }

  const nodes: TreeNode<ResponseNodeData>[] = order.map((t) => {
    const children = turns.get(t) ?? [];
    return {
      id: `turn-${t}`,
      label: (
        <span className="flex items-center gap-2">
          <span>Turn {t}</span>
          <Text variant="meta" tone="muted" as="span" className="tabular-nums">
            {formatNumber(children.length)}
          </Text>
        </span>
      ),
      data: { step: null },
      children,
    };
  });

  return { nodes, turnIds: order.map((t) => `turn-${t}`) };
}

/** A response child node — id IS the step id so selection maps to the shared `selectedStepId`. */
function responseChild(step: RunStep): TreeNode<ResponseNodeData> {
  const Icon = step.type === "llm_response" ? ArrowDownToLine : Hammer;
  return {
    id: step.id,
    label: <ResponseLabel step={step} />,
    icon: <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />,
    data: { step },
  };
}

/** A concise child label: tool name (or `llm.resp`) plus a short token / status hint. */
function ResponseLabel({ step }: { step: RunStep }): ReactNode {
  const name =
    step.type === "tool_result" ? (step.toolName ?? step.label) : stepTypeMeta(step.type).label;
  const tokens = firstProfileTokens(step);
  const isError = step.status === "error";
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate" title={name}>
        {name}
      </span>
      {isError ? (
        <Text variant="meta" as="span" className="shrink-0 text-destructive">
          error
        </Text>
      ) : tokens > 0 ? (
        <Text variant="meta" tone="muted" as="span" className="shrink-0 tabular-nums">
          {formatNumber(tokens)} tok
        </Text>
      ) : null}
    </span>
  );
}
