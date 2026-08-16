import type { ReactNode } from "react";
import { Text, cn } from "@brand/ui";

/**
 * One compact label/value stat — the single replacement for the six ad-hoc re-implementations
 * (`FootKpi` in ToolPlayground/ResourcePromptRun, `Stat` in CompatibilityCellSheet/reportRender,
 * `Metric` in RunsView, `StripStat` in ServersView). Rendered as a `<dl>` term/definition pair so
 * the label and value are semantically associated (screen readers announce them together) rather
 * than being two unlabeled sibling `Text` nodes.
 *
 * When a full metric *card* is wanted (icon, delta, trend visual) use `@brand/ui` `MetricCard`
 * instead — this is only the inline/stacked text pattern.
 */
export interface KpiStatProps {
  label: ReactNode;
  value: ReactNode;
  /** Optional trailing unit/qualifier rendered muted after the value (e.g. "tokens", "ok"). */
  sub?: ReactNode;
  /** `"stack"` (default) = label above value; `"inline"` = label · value on one baseline. */
  orientation?: "stack" | "inline";
  className?: string;
}

export function KpiStat({ label, value, sub, orientation = "stack", className }: KpiStatProps) {
  // The value and the label must never share a SIZE role — that parity (both at `meta`) was the
  // "64,522 is the same size as the word beside it" defect (critique P1 typography). The label is a
  // small, muted, uppercase eyebrow (`meta`); the value is a real numeral one or more rungs above it.
  // `stack` (the KPI card) uses the executive `kpi` rung (32px + tabular-nums); `inline` (dense
  // strips — compat cell sheet, session-duration stats) uses `body`, which still out-sizes the meta
  // label but keeps strips dense. (`subtitle`/`title`/`display` are Heading-only variants — Text's
  // size roles are meta/caption/body/kpi/code, so those are the two we pick from.)
  const valueVariant = orientation === "inline" ? "body" : "kpi";
  return (
    <dl
      className={cn(
        orientation === "inline" ? "flex items-baseline gap-1.5" : "flex flex-col gap-0.5",
        className,
      )}
    >
      <dt>
        <Text as="span" variant="meta" tone="muted" className="uppercase tracking-wide">
          {label}
        </Text>
      </dt>
      <dd className="m-0">
        <Text as="span" variant={valueVariant} className="font-medium tabular-nums leading-none">
          {value}
          {sub != null ? (
            <Text as="span" variant="meta" tone="muted" className="ml-1 font-normal tracking-normal">
              {sub}
            </Text>
          ) : null}
        </Text>
      </dd>
    </dl>
  );
}
