import type { CostBasis } from "@mcp-token-footprint/shared";
import { Badge, Tooltip, TooltipContent, TooltipTrigger, cn } from "@brand/ui";

/**
 * Claude subscription (roadmap/claude-subscription/, WP 3.1, D-CS4) — the shared accuracy marker for a
 * cost figure that is a subscription SHADOW price rather than a billed charge. Reuses the "est." marker
 * convention `qlik_answers` established (see `KpiRail`): a compact, muted "est." {@link Badge} carrying a
 * tooltip that explains the run's `costUsd` is exact tokens × the model's list rate on the Claude
 * subscription — a reference estimate for comparison, marginal cost \$0, never an actual charge.
 *
 * ONE element, reused on every surface that renders a subscription run's cost (run-console KPI rail,
 * Runs feed, Compare matrix, suite report) so the marker reads identically everywhere. Rendered only
 * when {@link isSubscriptionReference} is true for the run's {@link CostBasis} — an ordinary
 * (`api_exact`/absent) run shows no marker.
 *
 * A11y: the `Badge` is made keyboard-reachable (`tabIndex={0}` + `aria-label`) so the Radix tooltip
 * opens on focus, not hover alone. `@brand/*`-only, semantic tokens (Badge `secondary` variant reads
 * correctly in both `qlik-bright` + `qlik-dark`); `className` is layout-only.
 */

/** The exact D-CS8 marker value that flags a subscription shadow-price cost. */
const SUBSCRIPTION_REFERENCE: CostBasis = "subscription_reference";

/** The one tooltip copy, shared by every surface (owner-worded per the WP 3.1 brief). */
export const SUBSCRIPTION_COST_TOOLTIP =
  "Reference estimate — this run’s cost is exact tokens × list price on the Claude subscription (marginal cost $0).";

/** True when a run's {@link CostBasis} means its `costUsd` is a subscription shadow-price estimate. */
export function isSubscriptionReference(costBasis: CostBasis | undefined): boolean {
  return costBasis === SUBSCRIPTION_REFERENCE;
}

export function SubscriptionCostMarker({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="secondary"
          tabIndex={0}
          role="note"
          aria-label={`Estimated cost · subscription reference. ${SUBSCRIPTION_COST_TOOLTIP}`}
          className={cn("cursor-help font-normal", className)}
        >
          est.
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">{SUBSCRIPTION_COST_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}
