import { LineChart } from "lucide-react";
import { StatePanel } from "@brand/ui";
import type { RunModeProps } from "./compare-runs";

/**
 * Metrics mode — an honest "coming soon" state (D2, compare-redesign §3.4). The tab stays in the
 * Summary|Flow|Metrics segmented control and `?mode=metrics` stays a valid deep link; the compare
 * bar's `ModeToggle` already sets the expectation with a small `soon` `Badge` beside the tab label
 * (see {@link MODE_SOON} in `compare-runs.ts`), so landing here is a confirmation, not a surprise.
 * No internal work-package numbers in user-facing copy — just what will actually land: a per-turn
 * context/cost series, aligned across the compared runs, with model-limit lines (the same shape
 * {@link ContextCurves} already draws for the Summary aggregate, broken out per metric and per turn).
 */
export function MetricsMode({ runs }: RunModeProps) {
  return (
    <StatePanel
      kind="empty"
      icon={<LineChart aria-hidden />}
      title="Metrics — coming soon"
      description={
        runs.length >= 2
          ? "Per-turn context and cost series for these runs, aligned turn by turn with model-limit lines, will land here."
          : "Add a second run to compare per-turn context and cost series once this lands."
      }
    />
  );
}
