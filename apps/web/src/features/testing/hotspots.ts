import type { RunStep, SessionCapabilities } from "@mcp-token-footprint/shared";
import type { StepEconomics } from "./analytics-derive";

/**
 * Observability (WP 3.2) — the KPI rail's "hotspots" strip: up to THREE jump-links (one per kind) to
 * the run's true extremes — slowest step, costliest step, largest single context-window jump. Gated on
 * the run's {@link SessionCapabilities} manifest (D-US4 — capability-driven, never a `providerKind`
 * fork): the costliest hotspot needs a real cost basis, the context-jump hotspot needs a meaningful
 * context window. A run with neither (e.g. a hypothetical future `tokens:"none"` kind) still gets the
 * `slowest` hotspot — duration is always derivable from `RunStep.durationMs` alone — so hotspots degrade
 * to duration-only rather than disappearing or fabricating a cost/context figure.
 */

export type HotspotKind = "slowest" | "costliest" | "contextJump";

export type Hotspot =
  | { kind: "slowest"; stepId: string; label: string; durationMs: number }
  | { kind: "costliest"; stepId: string; label: string; costUsdDelta: number }
  | { kind: "contextJump"; stepId: string; label: string; deltaTokens: number };

/** Human label for a step's jump-link: tool name first, then the step's own label. */
function stepDisplayLabel(step: RunStep): string {
  return step.toolName ?? step.label;
}

/** The step with the largest OWN `durationMs`, or null when no step carries real timing. */
function deriveSlowestStep(steps: RunStep[]): Hotspot | null {
  let best: { step: RunStep; durationMs: number } | null = null;
  for (const step of steps) {
    if (typeof step.durationMs !== "number" || step.durationMs <= 0) continue;
    if (!best || step.durationMs > best.durationMs) best = { step, durationMs: step.durationMs };
  }
  return best
    ? { kind: "slowest", stepId: best.step.id, label: stepDisplayLabel(best.step), durationMs: best.durationMs }
    : null;
}

/** The step with the largest positive `costUsdDelta`, or null when no step carries one. */
function deriveCostliestStep(
  steps: RunStep[],
  perStepEconomics: ReadonlyMap<string, StepEconomics>,
): Hotspot | null {
  let best: { step: RunStep; costUsdDelta: number } | null = null;
  for (const step of steps) {
    const econ = perStepEconomics.get(step.id);
    if (!econ || econ.costUsdDelta <= 0) continue;
    if (!best || econ.costUsdDelta > best.costUsdDelta) best = { step, costUsdDelta: econ.costUsdDelta };
  }
  return best
    ? {
        kind: "costliest",
        stepId: best.step.id,
        label: stepDisplayLabel(best.step),
        costUsdDelta: best.costUsdDelta,
      }
    : null;
}

/** The step whose `context` snapshot jumped the MOST from the immediately preceding snapshot. */
function deriveContextJumpStep(steps: RunStep[]): Hotspot | null {
  let prevTotal = 0;
  let best: { step: RunStep; deltaTokens: number } | null = null;
  for (const step of steps) {
    if (!step.context) continue;
    const delta = step.context.total - prevTotal;
    if (delta > 0 && (!best || delta > best.deltaTokens)) best = { step, deltaTokens: delta };
    prevTotal = step.context.total;
  }
  return best
    ? {
        kind: "contextJump",
        stepId: best.step.id,
        label: stepDisplayLabel(best.step),
        deltaTokens: best.deltaTokens,
      }
    : null;
}

/**
 * Derive up to one hotspot per kind (never more than 3 total), in a stable `slowest, costliest,
 * contextJump` order. `perStepEconomics` is optional — pass `null` while it hasn't loaded yet (e.g. a
 * still-live run) and the costliest hotspot is simply omitted rather than showing a stale/zero cost.
 */
export function deriveHotspots(
  steps: RunStep[],
  perStepEconomics: ReadonlyMap<string, StepEconomics> | null,
  capabilities: Pick<SessionCapabilities, "costBasis" | "contextWindow">,
): Hotspot[] {
  const hotspots: Hotspot[] = [];

  const slowest = deriveSlowestStep(steps);
  if (slowest) hotspots.push(slowest);

  // "none" has no cost figure at all — the same basis-aware exclusion `StepLog`'s cost-delta chip
  // applies (`showsCostChip`).
  if (capabilities.costBasis !== "none" && perStepEconomics) {
    const costliest = deriveCostliestStep(steps, perStepEconomics);
    if (costliest) hotspots.push(costliest);
  }

  if (capabilities.contextWindow) {
    const jump = deriveContextJumpStep(steps);
    if (jump) hotspots.push(jump);
  }

  return hotspots;
}
