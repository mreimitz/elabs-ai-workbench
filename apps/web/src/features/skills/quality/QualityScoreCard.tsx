import { useMemo } from "react";
import type { QualityReport, QualitySeverity } from "@mcp-token-footprint/shared";
import { Badge, Card, CardContent, MetricCard, Text } from "@brand/ui";
import { SEVERITY_META, SEVERITY_ORDER } from "./quality-meta";

/** Tally findings per severity (0 for a severity with none) so every band always renders a count. */
function severityCounts(report: QualityReport): Record<QualitySeverity, number> {
  const counts: Record<QualitySeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const finding of report.findings) counts[finding.severity] += 1;
  return counts;
}

/**
 * The Quality tab's headline: the 0–100 `score` as a `MetricCard` (the score IS the KPI) beside a
 * severity breakdown (error/warning/info badges + a one-line summary). The score is deterministic —
 * `clamp(100 - Σ(count(severity) * weight), 0, 100)` — so the same version always shows the same
 * number; applying a fix creates a NEW version and this re-renders with its (higher) score.
 */
export function QualityScoreCard({ report }: { report: QualityReport }) {
  const counts = useMemo(() => severityCounts(report), [report]);
  const total = report.findings.length;
  const ruleCount = Object.keys(report.ruleCounts).length;

  return (
    <section
      aria-label="Quality score"
      className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
      data-testid="quality-score"
    >
      <MetricCard
        label="Quality score"
        value={String(report.score)}
        description={`out of 100 · engine v${report.qualityEngineVersion}`}
        emphasis="headline"
      />
      <Card>
        <CardContent className="flex h-full flex-col justify-center gap-3 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {SEVERITY_ORDER.map((severity) => {
              const meta = SEVERITY_META[severity];
              const Icon = meta.icon;
              return (
                <Badge key={severity} variant={meta.badgeVariant} className="gap-1 tabular-nums">
                  <Icon aria-hidden className="size-3.5" />
                  {counts[severity]} {meta.label.toLowerCase()}
                  {counts[severity] === 1 ? "" : "s"}
                </Badge>
              );
            })}
          </div>
          <Text variant="meta" tone="muted" className="text-pretty">
            {total === 0
              ? "No findings — this version passes every deterministic quality check."
              : `${total} finding${total === 1 ? "" : "s"} across ${ruleCount} rule${ruleCount === 1 ? "" : "s"}.`}
          </Text>
        </CardContent>
      </Card>
    </section>
  );
}
