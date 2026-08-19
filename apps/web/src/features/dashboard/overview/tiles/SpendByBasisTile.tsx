import { DollarSign } from "lucide-react";
import type { CostBasis } from "@mcp-token-footprint/shared";
import {
  BentoGridItem,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  StatePanel,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import {
  isSubscriptionReference,
  SubscriptionCostMarker,
} from "../../../../components/SubscriptionCostMarker";
import { deltaTextTone } from "../../../../lib/delta";
import { formatCostUsd } from "../../../../lib/format";
import { COST_CLASS_LABELS, humanize } from "../../testing/metrics-derive";
import type { CostBasisFigure, RunHealthData, SectionEnvelope } from "../overview-contract";
import { isEmptySection } from "../overview-contract";

/**
 * Overview spend tile (dashboard-bento WP 1.2) — **one row per cost basis, never a blended total**.
 *
 * `api_exact` is money a provider billed; `subscription_reference` is a shadow price for a run that
 * cost \$0 at the margin on a subscription. They are different KINDS of number, so D-OB14 forbids
 * adding them — and the contract carries them as a list precisely so no tile can. This tile
 * therefore renders a row each and computes each row's Δ against ITS OWN previous window; there is
 * no total anywhere in the markup, and a test asserts the summed figure never appears.
 *
 * The subscription row carries the app's one accuracy marker (`SubscriptionCostMarker`, D-CS4/D-CS8)
 * so the distinction is stated, not just implied by a label.
 *
 * Labels come from `COST_CLASS_LABELS` — the same vocabulary the Testing dashboard's Cost panel
 * uses — rather than a second spelling of "$ Est. (subscription reference)"; an unknown basis falls
 * back to `humanize`. Delta tone comes from `deltaTextTone(…, false)`: spend going UP is worse
 * (D-IC3, amber — red stays reserved for structural removal), and the sign is always in the text so
 * colour is never the only signal.
 */
export function SpendByBasisTile({ section }: { section: SectionEnvelope<RunHealthData> }) {
  const figures = section.data?.costByBasis ?? [];

  // Self-hide: an empty section, or a ready section with no cost recorded at all. A tile with a
  // header and no rows is exactly the empty box the bento must never show.
  if (isEmptySection(section)) return null;
  if (section.state === "ready" && figures.length === 0) return null;

  return (
    <BentoGridItem size="md">
      <CardHeader className="gap-1 p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign aria-hidden className="size-4" />
          Spend
        </CardTitle>
        <CardDescription>
          One row per cost basis — billed and reference costs are never added together
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-4 pt-0">
        {section.state === "error" ? (
          <StatePanel
            kind="error"
            title="Cost unavailable"
            description={section.error ?? undefined}
          />
        ) : section.state === "loading" ? (
          // Layout-shaped placeholder (loading-states.md) — two rows, the shape the real content
          // takes. `<output>` is the app's semantic live region (implicit `role="status"`, the
          // `ResultCount`/`ConversationPane` precedent), so the skeleton announces once.
          <output className="flex flex-col gap-3" aria-live="polite">
            <span className="sr-only">Loading spend…</span>
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </output>
        ) : (
          <ul className="flex flex-col gap-2">
            {figures.map((figure) => (
              <SpendRow key={figure.basis} figure={figure} />
            ))}
          </ul>
        )}
      </CardContent>
    </BentoGridItem>
  );
}

function SpendRow({ figure }: { figure: CostBasisFigure }) {
  const label =
    COST_CLASS_LABELS[figure.basis as keyof typeof COST_CLASS_LABELS] ?? humanize(figure.basis);
  // A Δ exists only against a comparable previous window — `null` renders nothing, never "+$0.00".
  const delta = figure.previousUsd === null ? null : figure.currentUsd - figure.previousUsd;

  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        <Text as="span" variant="meta" tone="muted" className="truncate">
          {label}
        </Text>
        {isSubscriptionReference(figure.basis as CostBasis) ? <SubscriptionCostMarker /> : null}
      </span>
      <span className="flex shrink-0 items-baseline gap-2">
        <Text as="span" variant="body" className="tabular-nums">
          {formatCostUsd(figure.currentUsd)}
        </Text>
        {delta !== null ? (
          <Text
            as="span"
            variant="meta"
            className={cn("tabular-nums", deltaTextTone(delta, false))}
          >
            {delta === 0
              ? "No change"
              : `${delta > 0 ? "+" : "-"}${formatCostUsd(Math.abs(delta))}`}
          </Text>
        ) : null}
      </span>
    </li>
  );
}
