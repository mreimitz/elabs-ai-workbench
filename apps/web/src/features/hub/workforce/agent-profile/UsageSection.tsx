import { useEffect, useState } from "react";
import type { HubUsageSummary } from "@mcp-token-footprint/shared";
import { MetricCard, Spinner, Text } from "@brand/ui";
import { apiGet } from "../../../../lib/api";
import { getErrorMessage } from "../../../../lib/errors";

/**
 * Assistant Hub UX WP2.3 · Usage section (D-HUX6 "Usage" · consumes WP1.6's D-HUX10).
 *
 * A read-only per-agent usage summary from `GET /api/hub/usage/summary?groupBy=agent&id=<roleId>`
 * (the WP1.6 endpoint): rolling totals (sessions / cost / tokens in-out) plus a trailing daily
 * strip rendered as a compact token/cost sparkbar. Every number is the app's own metered spend —
 * an agent's real cost accrues across the sessions attributed to it (including mission-agent
 * children running a different model). No provider key is needed to READ this; it just reports what
 * has already been spent.
 */

function formatCost(usd: number): string {
  return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function UsageSection({ agentId, days = 30 }: { agentId: string; days?: number }) {
  const [summary, setSummary] = useState<HubUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ groupBy: "agent", id: agentId, days: String(days) });
        const result = await apiGet<HubUsageSummary>(`/api/hub/usage/summary?${params.toString()}`);
        if (!cancelled) setSummary(result);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, days]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-body text-muted-foreground">
        <Spinner className="size-4" aria-hidden />
        <span>Loading usage…</span>
      </div>
    );
  }

  if (error) {
    return (
      <Text variant="meta" className="text-destructive" role="alert">
        Couldn’t load usage: {error}
      </Text>
    );
  }

  if (!summary) return null;

  const { totals, strip } = summary;
  const maxTokens = strip.reduce((max, day) => Math.max(max, day.tokensIn + day.tokensOut), 0);
  const hasSpend = totals.sessions > 0 || totals.costUsd > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Sessions" value={totals.sessions.toLocaleString()} />
        <MetricCard label="Cost" value={formatCost(totals.costUsd)} />
        <MetricCard label="Tokens in" value={totals.tokensIn.toLocaleString()} />
        <MetricCard label="Tokens out" value={totals.tokensOut.toLocaleString()} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Text className="font-medium">Last {strip.length} days</Text>
          <Text variant="caption" tone="muted">
            tokens / day
          </Text>
        </div>
        {!hasSpend ? (
          <Text variant="caption" tone="muted">
            No spend recorded for this agent in this window yet.
          </Text>
        ) : (
          <div
            className="flex h-24 items-end gap-0.5"
            role="img"
            aria-label={`Daily token usage over the last ${strip.length} days`}
          >
            {strip.map((day) => {
              const total = day.tokensIn + day.tokensOut;
              const heightPct = maxTokens > 0 ? Math.max(2, (total / maxTokens) * 100) : 2;
              return (
                <div
                  key={day.key}
                  className="flex-1 rounded-sm bg-primary/70"
                  style={{ height: `${heightPct}%` }}
                  title={`${day.label}: ${total.toLocaleString()} tokens · ${formatCost(day.costUsd)}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
