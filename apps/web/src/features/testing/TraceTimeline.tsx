import { useEffect, useMemo, useRef } from "react";
import type { RunStep } from "@mcp-token-footprint/shared";
import { EmptyState, ScrollArea, Text } from "@elabs-ai/components-ui";
import { GitBranch } from "lucide-react";
import { buildTraceTree } from "./trace-tree";
import { TraceNode } from "./TraceNode";
import { TraceStepsContext } from "./trace-context";
import {
  scrollToConsoleAnchor,
  type ConsoleNavRef,
  type ConsoleNavTarget,
} from "./console-anchors";
import type { RunKpis, RunStreamState } from "./use-run-stream";

/**
 * The "Trace" tab (findings/plan: replaces the flat Raw transcript) — the whole run as a
 * turn-grouped, collapsible event tree drawn like a git-history graph. It is DERIVED state: every
 * node is reconstructed from the same `viewStream` the other panes read (via {@link buildTraceTree},
 * which reuses Wave-1's `buildTimeline`), so it stays as-of-k in replay and never drifts. Cost is
 * derived per turn from the cumulative `kpiByStepId` snapshots; sub-events show tokens + duration.
 *
 * Clicking a row only expands/collapses it — the Trace tab does NOT open the right-side inspector
 * Sheet. A leaf's full payload + the inspector detail panel are reached via its Expand button (a
 * modal). `stream.steps` is provided as a by-id context so that modal can resolve the backing step.
 */
export function TraceTimeline({
  stream,
  kpiByStepId,
  navTarget,
  onShowInChat,
}: {
  stream: RunStreamState;
  kpiByStepId: Map<string, RunKpis> | null;
  /** WP 3.2 — a nonce'd trace-scroll target (from an error card or a chat tool's "View in trace"). */
  navTarget?: ConsoleNavTarget | null;
  /** WP 3.2 — reveal the Chat tab at a turn/tool (a Trace row's "Show in chat"). */
  onShowInChat?: (ref: ConsoleNavRef) => void;
}) {
  const nodes = useMemo(
    () =>
      buildTraceTree({
        steps: stream.steps,
        timeline: stream.timeline,
        deltas: stream.deltas,
        kpiByStepId,
      }),
    [stream.steps, stream.timeline, stream.deltas, kpiByStepId],
  );

  const stepsById = useMemo(
    () => new Map<string, RunStep>(stream.steps.map((s) => [s.id, s])),
    [stream.steps],
  );

  // WP 3.2 — scroll the Trace to a cross-link target when its nonce changes (deferred one frame so it
  // runs after the freshly-revealed Trace tab lays out). `scrollIntoView` handles the ScrollArea's own
  // viewport scroll; we only need to resolve the row within this subtree.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const navNonce = navTarget?.nonce ?? null;
  useEffect(() => {
    if (!navTarget) return;
    const raf = requestAnimationFrame(() => {
      scrollToConsoleAnchor(containerRef.current, navTarget.ref);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nonce is the intended re-trigger key.
  }, [navNonce]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <EmptyState
          icon={<GitBranch aria-hidden />}
          title="No events yet"
          description="The run's turns, messages, tool calls and responses appear here as a collapsible timeline as it streams."
        />
      </div>
    );
  }

  return (
    <TraceStepsContext.Provider value={stepsById}>
      <ScrollArea className="h-full">
        <div ref={containerRef} className="flex flex-col py-2 pl-2 pr-3">
          {nodes.map((node, i) => (
            <TraceNode
              key={node.id}
              node={node}
              depth={0}
              isFirst={i === 0}
              isLast={i === nodes.length - 1}
              ancestorHasNext={[]}
              {...(onShowInChat ? { onShowInChat } : {})}
            />
          ))}
          <Text variant="meta" tone="muted" className="px-2 pt-3">
            Cost is derived per turn from cumulative snapshots; sub-events show tokens and duration
            only (the engine does not measure per-event cost).
          </Text>
        </div>
      </ScrollArea>
    </TraceStepsContext.Provider>
  );
}
