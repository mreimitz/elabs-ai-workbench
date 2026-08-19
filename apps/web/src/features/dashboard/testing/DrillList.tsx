import { ChevronRight } from "lucide-react";
import { Text } from "@elabs-ai/components-ui";
import { IconButton } from "../../../components/IconButton";

/**
 * DrillList — a compact, labelled breakdown list: one row per SERIES (a stop reason, a server, a
 * leaderboard entry), each opening that series' destination.
 *
 * It is NOT the charts' click surface. Every chart panel now passes `onDatapointClick`, so a bar or
 * a point is activated directly, by pointer or keyboard (`@elabs-ai/components-charts` mounts real
 * `<button>` targets outside the aria-hidden `<svg>`). The lists that merely mirrored one row per
 * datapoint were deleted with that change; the ones that remain earn their place by carrying
 * something no single datapoint does — a series' TOTAL across the whole window, and its human name
 * next to it, readable without hovering (`GuardrailStopsPanel`, `ScansStripPanel`,
 * `LeaderboardsPanel`).
 *
 * The `<ul>/<li>` + ghost `IconButton` shape is the SAME pattern `ScansTab.tsx`'s "Biggest movers"
 * list uses, so it reads as one grammar across the app.
 */
export type DrillRow = {
  key: string;
  label: string;
  value: string;
  onOpen: () => void;
};

export function DrillList({ rows, emptyLabel }: { rows: DrillRow[]; emptyLabel?: string }) {
  if (rows.length === 0) {
    return emptyLabel ? (
      <Text variant="meta" tone="muted">
        {emptyLabel}
      </Text>
    ) : null;
  }
  return (
    <ul className="flex flex-col divide-y divide-border border-t border-border">
      {rows.map((row) => (
        <li key={row.key} className="flex items-center gap-3 py-1.5 first:pt-0 last:pb-0">
          <Text variant="meta" className="min-w-0 flex-1 truncate">
            {row.label}
          </Text>
          <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
            {row.value}
          </Text>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={row.onOpen}
            label={`Open runs for ${row.label}`}
            className="shrink-0"
          >
            <ChevronRight aria-hidden />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}
