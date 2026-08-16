import type { ReactNode } from "react";
import { Button, Text, cn } from "@brand/ui";
import { formatNumber } from "../lib/format";

/** Chart-token classes for composition segments — theme-aware, no raw colors. */
const SEGMENT_BG = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;

export type Segment = { label: string; value: number };

/**
 * One horizontal stacked bar split into labelled segments (e.g. a tool's
 * Name / Description / Schema / Annotations token split), with a compact legend.
 * Replaces the old "four separate Progress bars" encoding.
 */
export function SegmentedBar({ segments, ariaLabel }: { segments: Segment[]; ariaLabel?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          ariaLabel ??
          segments.map((s) => `${s.label} ${Math.round((s.value / total) * 100)}%`).join(", ")
        }
      >
        {segments.map((s, index) =>
          s.value > 0 ? (
            <div
              key={s.label}
              className={cn("h-full", SEGMENT_BG[index % SEGMENT_BG.length])}
              style={{ width: `${(s.value / total) * 100}%` }}
              title={`${s.label}: ${formatNumber(s.value)} (${Math.round((s.value / total) * 100)}%)`}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s, index) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              className={cn("size-2.5 shrink-0 rounded-sm", SEGMENT_BG[index % SEGMENT_BG.length])}
              aria-hidden
            />
            <Text variant="meta" tone="muted">
              {s.label}
            </Text>
            <Text variant="meta" className="tabular-nums">
              {formatNumber(s.value)} ({Math.round((s.value / total) * 100)}%)
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type RankedItem = {
  id: string;
  label: string;
  value: number;
  percent: number;
  aside?: ReactNode;
};

/** Compact ranked list: rank · name · inline bar · value/percent. Rows are clickable when `onSelect` is given. */
export function RankedTokenList({
  items,
  onSelect,
}: { items: RankedItem[]; onSelect?: (id: string) => void }) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <ul className="flex flex-col">
      {items.map((item, index) => {
        const body = (
          <span className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2.5">
            <span className="text-right text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-baseline justify-between gap-2">
                <Text className="truncate font-mono text-sm" title={item.label}>
                  {item.label}
                </Text>
                <Text variant="meta" className="shrink-0 tabular-nums">
                  {formatNumber(item.value)} · {item.percent.toFixed(1)}%
                </Text>
              </span>
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </span>
            </span>
          </span>
        );

        return (
          <li key={item.id} className="min-w-0">
            {onSelect ? (
              <Button
                variant="ghost"
                className="h-auto w-full justify-start rounded-md px-2 py-1.5 text-left"
                onClick={() => onSelect(item.id)}
              >
                {body}
              </Button>
            ) : (
              <span className="block px-2 py-1.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Canonical Name/Description/Schema/Annotations split, in segment order. */
export type ContributorSplit = {
  name: number;
  description: number;
  schema: number;
  annotations: number;
};

export type ContributorRow = {
  id: string;
  label: string;
  total: number;
  percent: number;
  split: ContributorSplit;
};

const CONTRIB_SEGMENTS = [
  { key: "name", label: "Name" },
  { key: "description", label: "Description" },
  { key: "schema", label: "Schema" },
  { key: "annotations", label: "Annotations" },
] as const;

function StackedBar({
  split,
  scaleMax,
  ariaLabel,
}: { split: ContributorSplit; scaleMax: number; ariaLabel: string }) {
  const denom = scaleMax || 1;
  return (
    <span
      className="block h-2.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={ariaLabel}
    >
      <span className="flex h-full w-full">
        {CONTRIB_SEGMENTS.map((seg, index) => {
          const value = split[seg.key];
          if (value <= 0) return null;
          return (
            <span
              key={seg.key}
              className={cn("block h-full", SEGMENT_BG[index % SEGMENT_BG.length])}
              style={{ width: `${(value / denom) * 100}%` }}
              title={`${seg.label}: ${formatNumber(value)}`}
            />
          );
        })}
      </span>
    </span>
  );
}

/**
 * Merged token-distribution view: a server-wide stacked composition bar on top, per-tool stacked
 * contributor rows below (each row's bar shows *why* the tool is expensive — Name/Description/
 * Schema/Annotations), and ONE shared legend pinned to the bottom. Rows are clickable when
 * `onSelect` is given. Additive — does not touch SegmentedBar / RankedTokenList.
 */
export function StackedContributorList({
  serverSplit,
  rows,
  onSelect,
}: {
  serverSplit: ContributorSplit;
  rows: ContributorRow[];
  onSelect?: (id: string) => void;
}) {
  const rowMax = Math.max(...rows.map((r) => r.total), 1);

  return (
    <div className="flex flex-col gap-3">
      {/* Server-wide composition */}
      <div className="flex flex-col gap-1.5">
        <Text variant="meta" tone="muted">
          All tools
        </Text>
        <StackedBar
          split={serverSplit}
          scaleMax={serverTotal(serverSplit)}
          ariaLabel="Server-wide token composition"
        />
      </div>

      {/* Per-tool stacked rows */}
      <ul className="flex flex-col">
        {rows.map((row, index) => {
          const body = (
            <span className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2.5">
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-2">
                  <Text className="truncate" title={row.label}>
                    {row.label}
                  </Text>
                  <Text variant="meta" className="shrink-0 tabular-nums">
                    {formatNumber(row.total)} · {row.percent.toFixed(1)}%
                  </Text>
                </span>
                <StackedBar
                  split={row.split}
                  scaleMax={rowMax}
                  ariaLabel={`${row.label} token composition`}
                />
              </span>
            </span>
          );
          return (
            <li key={row.id} className="min-w-0">
              {onSelect ? (
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start rounded-md px-2 py-1.5 text-left"
                  onClick={() => onSelect(row.id)}
                >
                  {body}
                </Button>
              ) : (
                <span className="block px-2 py-1.5">{body}</span>
              )}
            </li>
          );
        })}
      </ul>

      {/* One shared legend, pinned to the bottom */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2.5">
        {CONTRIB_SEGMENTS.map((seg, index) => (
          <li key={seg.key} className="flex items-center gap-1.5">
            <span
              className={cn("size-2.5 shrink-0 rounded-sm", SEGMENT_BG[index % SEGMENT_BG.length])}
              aria-hidden
            />
            <Text variant="meta" tone="muted">
              {seg.label}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}

function serverTotal(split: ContributorSplit): number {
  return split.name + split.description + split.schema + split.annotations;
}
