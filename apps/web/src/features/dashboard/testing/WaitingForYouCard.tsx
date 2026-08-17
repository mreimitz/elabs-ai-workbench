import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { MetricCard } from "@elabs-ai/components-charts";
import { queryRunsFiltered } from "../../../lib/api";
import { formatNumber } from "../../../lib/format";
import { WAITING_FOR_YOU_FILTER } from "../../testing/runs/run-filter-url";
import { drillDownHref } from "./dashboard-url-state";

/**
 * "Waiting for you" KPI card (Sessions lens, Observability WP 2.4 DESIGN) — deep-links into the Runs
 * feed's "Waiting for you" preset. Counts against the LITERAL SAME `RunFilter`
 * ({@link WAITING_FOR_YOU_FILTER}) that preset applies (`GET /api/runs?filter=…`, no new endpoint),
 * so the card's count and the lens it links to can never drift apart. Deliberately NOT scoped to the
 * dashboard's date-range controls: "waiting for you" is a live, current-state count (a session paused
 * days ago is still waiting today), not a windowed metric.
 *
 * Best-effort: a fetch failure hides the card rather than surfacing a dashboard-blocking error (it's a
 * supplementary KPI tile, not a required panel — mirrors the Runs feed filter bar's own dynamic-option
 * loaders). Still renders at a count of 0 (a calm, informative "nothing's stuck" signal, not hidden —
 * `countChipTone`'s "zero is never alarming" doctrine applies to visibility too, not just color).
 */
export function WaitingForYouCard() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    queryRunsFiltered(WAITING_FOR_YOU_FILTER)
      .then((rows) => {
        if (!cancelled) setCount(rows.length);
      })
      .catch(() => {
        // Best-effort — see doc comment above.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === null) return null;

  return (
    <Link
      to={drillDownHref(WAITING_FOR_YOU_FILTER)}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Waiting for you — ${formatNumber(count)} session${count === 1 ? "" : "s"} waiting for your input`}
    >
      <MetricCard
        icon={<Clock aria-hidden />}
        label="Waiting for you"
        value={formatNumber(count)}
        description={`session${count === 1 ? "" : "s"} paused for your input`}
      />
    </Link>
  );
}
