import type { ReactNode } from "react";
import { Activity, AlertTriangle, Clock, Coins } from "lucide-react";
import { MetricCard, MetricGrid } from "@brand/charts";
import { formatCostUsd, formatDuration, formatNumber, formatPercent } from "../../../lib/format";
import type { TestingKpis } from "./metrics-derive";

/**
 * KpiHeader — the Testing dashboard's window-level MetricCard row (WP 2.2 spec §Design): runs,
 * error rate, active p95 duration, plus ONE card per cost-basis class present (never a blended $
 * figure across classes, D-OB14) and a Questions card when the window has any `qlik_answers`
 * activity. All figures are derived client-side from data the panels already fetched (see
 * `metrics-derive.ts#buildTestingKpis`) — no extra network round trip for this row.
 *
 * `extra` (Sessions lens, WP 2.4) — additional tile(s) appended to the SAME grid, for a card that does
 * its OWN independent fetch outside the windowed `kpis` derivation (e.g. `WaitingForYouCard`, a live
 * current-state count that deliberately ignores the date-range controls).
 *
 * D-2 (WP 2.1 toolbar-reach): the common case is Runs + Error rate + Active p95 + one cost-basis
 * card + `extra` (`WaitingForYouCard`) — FIVE cards, which orphaned onto row two at quarter width
 * in the `columns={4}` grid. Chosen fix: widen to a five-column grid at the `lg` breakpoint
 * (`className="lg:grid-cols-5"`, merged over `MetricGrid`'s own `colsMap[4]` via `cn()`/
 * `tailwind-merge` — confirmed the LAST matching `grid-cols` class at a given breakpoint wins, so
 * this cleanly overrides `sm:grid-cols-2 lg:grid-cols-4` to `…lg:grid-cols-5`), not promoting
 * `Waiting for you` into a "Needs attention" panel — that panel lives in `ScansTab.tsx`, which is
 * this WP's domain fence (WP 2.6 owns it). This doesn't guarantee zero orphans for every possible
 * card count (e.g. two cost-basis classes + Questions + extra = 7), the same limitation the
 * previous `columns={4}` had — it specifically closes the 5-card case the audit measured.
 */
export function KpiHeader({ kpis, extra }: { kpis: TestingKpis; extra?: ReactNode }) {
  return (
    <MetricGrid columns={4} className="lg:grid-cols-5">
      <MetricCard icon={<Activity aria-hidden />} label="Runs" value={formatNumber(kpis.runCount)} />
      <MetricCard
        icon={<AlertTriangle aria-hidden />}
        label="Error rate"
        value={formatPercent(kpis.errorRatePercent)}
        positiveIsGood={false}
      />
      <MetricCard
        icon={<Clock aria-hidden />}
        label="Active p95"
        value={kpis.latestP95DurationMs != null ? formatDuration(kpis.latestP95DurationMs) : "n/a"}
        description="Latest bucket"
        positiveIsGood={false}
      />
      {kpis.costByBasis.map((c) => (
        <MetricCard
          key={c.cls}
          icon={<Coins aria-hidden />}
          label={c.label}
          value={formatCostUsd(c.total)}
        />
      ))}
      {kpis.questionsTotal > 0 ? (
        <MetricCard
          icon={<Coins aria-hidden />}
          label="Questions"
          value={formatNumber(kpis.questionsTotal)}
          description="Qlik Answers usage unit"
        />
      ) : null}
      {extra}
    </MetricGrid>
  );
}
