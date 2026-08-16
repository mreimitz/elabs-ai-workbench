import { Sparkline } from "@brand/charts";
import { Button, EmptyState, MetricCard, Spinner, Text } from "@brand/ui";
import type { HubUsageSummary } from "@mcp-token-footprint/shared";
import { useNavigate } from "react-router-dom";
import { DialogSection } from "../../../../components/dialogs";
import { InlineError } from "../../../../components/InlineError";
import { getHubUsageSummary } from "../../../../lib/api";
import { formatCostUsd, formatNumber } from "../../../../lib/format";
import { loadableData, useLoadable } from "../../../../lib/loadable";

/**
 * Assistant Hub UX WP2.4 (D-HUX6/D-HUX10) — the crew profile modal's read-only Usage section: this
 * crew's totals + a 30-day cost trend (`GET /api/hub/usage/summary?groupBy=crew&id=<crewId>`, the
 * WP1.6 per-entity summary the Directory card's own strip also reads), plus a link into the workforce
 * Usage tab (WP2.6) for the full drill-down. No form state — nothing here is editable.
 */
export function UsageSection({ crewId }: { crewId: string }) {
  const navigate = useNavigate();
  const { state, reload } = useLoadable<HubUsageSummary>(
    () => getHubUsageSummary({ groupBy: "crew", id: crewId }),
    [crewId],
  );
  const summary = loadableData(state);

  return (
    <DialogSection
      title="Usage"
      description="This crew's spend and token totals over the last 30 days."
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => navigate("/assistant/agents?tab=usage")}>
          View in Usage tab
        </Button>
      }
    >
      {state.status === "loading" ? (
        <div className="flex items-center gap-2 text-body text-muted-foreground">
          <Spinner className="size-4" aria-hidden />
          <span>Loading usage…</span>
        </div>
      ) : state.status === "error" ? (
        <InlineError title="Couldn’t load this crew's usage" detail={state.error} onRetry={reload} />
      ) : !summary || summary.totals.sessions === 0 ? (
        <EmptyState
          title="No usage yet"
          description="This crew hasn't been instantiated into any sessions yet."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MetricCard label="Sessions" value={formatNumber(summary.totals.sessions)} />
            <MetricCard label="Cost" value={formatCostUsd(summary.totals.costUsd)} />
            <MetricCard label="Tokens in" value={formatNumber(summary.totals.tokensIn)} />
            <MetricCard label="Tokens out" value={formatNumber(summary.totals.tokensOut)} />
          </div>

          {summary.strip.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Text variant="caption" tone="muted">
                Daily cost, last {summary.strip.length} days
              </Text>
              <Sparkline
                values={summary.strip.map((bucket) => bucket.costUsd)}
                variant="bar"
                label={`Daily cost for ${summary.label}, last ${summary.strip.length} days`}
                width={480}
                height={48}
              />
            </div>
          ) : null}
        </div>
      )}
    </DialogSection>
  );
}
