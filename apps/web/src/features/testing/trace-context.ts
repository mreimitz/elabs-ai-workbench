import { createContext, useContext } from "react";
import type { RunStep } from "@mcp-token-footprint/shared";

/**
 * A `RunStep`-by-id lookup for the Trace tab, provided once by `TraceTimeline` and consumed deep in
 * the tree by `TraceLeafDetail` (its expand modal renders the step's `PacketTabs`). A context avoids
 * prop-drilling `steps` through every recursive `TraceNode`; it is read-only derived state, not UI.
 */
export const TraceStepsContext = createContext<Map<string, RunStep>>(new Map());

/** Resolve the `RunStep` backing a trace leaf's `detailStepId` (or `null` when absent/unknown). */
export function useTraceStep(stepId: string | undefined): RunStep | null {
  const steps = useContext(TraceStepsContext);
  return stepId ? (steps.get(stepId) ?? null) : null;
}
