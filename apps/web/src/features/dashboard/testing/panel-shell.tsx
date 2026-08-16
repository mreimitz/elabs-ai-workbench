import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Text } from "@brand/ui";

/**
 * Shared chart-panel framing for the Testing dashboard (WP 2.2) — mirrors the `ChartGrid`/
 * `ChartPanel` local helpers in `features/testing/AnalyticsPanel.tsx` (title/subtitle/icon Card,
 * fixed-height chart box, honest empty state) without importing that feature's file (a different,
 * DO-NOT-TOUCH cluster) — the same small pattern re-created for this feature's own panels.
 */

/** A responsive 1→2 column grid for the dashboard's chart panels. */
export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{children}</div>;
}

export function ChartPanel({
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  /** Right-aligned per-panel controls (e.g. a grader note) on the title row. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>
            <span className="flex items-center gap-2">
              {icon}
              {title}
            </span>
          </CardTitle>
          {subtitle ? (
            <Text variant="meta" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

/** The panel-local "nothing in this window" state — a compact `EmptyState`, never a blank box. */
export function PanelEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center py-6">
      <EmptyState title={title} description={description} />
    </div>
  );
}

/** A fixed-height box giving a chart its sizing context (matches `AnalyticsPanel`'s `h-56 w-full`). */
export function ChartBox({ children }: { children: ReactNode }) {
  return <div className="h-56 w-full">{children}</div>;
}
