import { ChevronRight } from "lucide-react";
import { Text } from "@brand/ui";
import { IconButton } from "../../../components/IconButton";

/**
 * DrillList — the ONE click-through breakdown list every Testing-dashboard panel uses for
 * drill-down (WP 2.2). `@brand/charts` v1.6.0 has no per-datapoint/legend `onClick` (Bar/Line/Area
 * only expose hover-tooltip interaction — confirmed against the vendored `.d.ts` and the MCP
 * `docs`/`search` tools; see the WP report), so each chart's actual click surface is this compact,
 * keyboard-reachable list underneath it — one row per bucket/class/group, each opening the
 * equivalent RunFilter in the runs feed. This is the SAME `<ul>/<li>` + ghost `Button` pattern
 * `ScansTab.tsx`'s "Biggest movers" list already uses, so it reads as one grammar across the app
 * (and is a strictly BETTER a11y story than a tiny unlabeled SVG bar as a click target).
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
