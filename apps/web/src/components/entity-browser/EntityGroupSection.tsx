import type { ReactNode } from "react";
import { Text } from "@elabs-ai/components-ui";
import { formatNumber } from "../../lib/format";

/**
 * One group's header + body (RM-32 D-OD3) — IDENTICAL in grid and table mode, so switching the mode
 * never re-shuffles or re-labels the sections.
 *
 * A group with no visible members never reaches this component: `buildEntityGroups` drops it, so a
 * bare header standing over nothing is structurally impossible rather than a rule to remember.
 */
export function EntityGroupSection(props: {
  label: string;
  badge?: ReactNode;
  count: number;
  children: ReactNode;
}) {
  // The `none` grouping yields one unlabelled group — render its body with no header at all rather
  // than an empty header row.
  if (!props.label) return <>{props.children}</>;
  return (
    <section aria-label={props.label} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Text
          variant="meta"
          tone="muted"
          className="min-w-0 truncate font-semibold uppercase tracking-wide"
        >
          {props.label}
        </Text>
        {props.badge}
        <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
          {formatNumber(props.count)}
        </Text>
      </div>
      {props.children}
    </section>
  );
}
