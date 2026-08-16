import type { DateRange, DateRangePreset } from "@brand/ui";
import {
  DateRangePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@brand/ui";
import { FacetFilter, type FacetOption } from "@brand/data";
import type { ProviderKind } from "@mcp-token-footprint/shared";
import { PROVIDER_KINDS } from "@mcp-token-footprint/shared";
import { ResultCount } from "../../../components/ResultCount";
import { ViewToolbar } from "../../../components/ViewToolbar";
import {
  TESTING_GROUP_BY_OPTIONS,
  type TestingDashboardControls,
  type TestingGroupBy,
} from "./dashboard-url-state";
import { PROVIDER_KIND_LABELS } from "./metrics-derive";

const GROUP_BY_LABELS: Record<TestingGroupBy, string> = {
  model: "Model",
  server: "Server",
  suite: "Suite",
  providerKind: "Provider",
};

const PROVIDER_OPTIONS: FacetOption[] = PROVIDER_KINDS.map((kind) => ({
  value: kind,
  label: PROVIDER_KIND_LABELS[kind],
}));

const GROUP_BY_SELECT_OPTIONS = TESTING_GROUP_BY_OPTIONS.map((g) => ({
  value: g,
  label: GROUP_BY_LABELS[g],
}));

const DATE_PRESETS: DateRangePreset[] = [
  { label: "Last 24 hours", getRange: () => ({ from: hoursAgo(24), to: new Date() }) },
  { label: "Last 7 days", getRange: () => ({ from: daysAgo(6), to: new Date() }) },
  { label: "Last 30 days", getRange: () => ({ from: daysAgo(29), to: new Date() }) },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n, 0, 0, 0);
  return d;
}

/**
 * LOCAL calendar-date (not UTC) `YYYY-MM-DD` — the picker operates on the days the user actually
 * clicks in their own timezone, so parsing/serializing here stays self-consistent (what you click is
 * what you get back). The backend's bucket FLOORS are UTC (D-OB14, deterministic day/week
 * boundaries) — a control's day boundary being locale-local rather than UTC-aligned is a known,
 * minor, and acceptable friction for a single-timezone local dev tool (never a correctness issue for
 * the figures themselves, only which exact hour the window starts/ends at a boundary day).
 */
function isoDateOnlyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type CatalogOption = { id: string; name: string };

/**
 * FilterControls — the Testing dashboard's global controls row (WP 2.2 spec §Design; WP 2.1
 * toolbar-reach fix for C-1/C-5/D-4): a date-range preset picker (24h/7d/30d/custom —
 * `DateRangePicker`'s own calendar covers "custom", no separate mode toggle needed), a RunFilter
 * subset bar (`FacetFilter` per dimension, the same multi-select component `RunsView.tsx`'s toolbar
 * already uses), a suite single-select, and the group-by select — all rendered through the shared
 * `ViewToolbar` (D-TB6/D-TB7), which owns the row's height/gap/wrap so this stays the SAME control
 * vocabulary + row shape the Issues tab's `IssueFilters` uses (D-4). Every change round-trips
 * through `controls`/`onChange` — the URL persistence lives in the caller (`TestingTab`), not here
 * (this component is a pure controlled view).
 *
 * C-1 fix: `Suite`/`Group by` used to be `SelectField` (a label-ABOVE stack) — dropped into an
 * `items-center` row that floated their triggers ~9px below every sibling control (three heights,
 * three top edges, measured 11px of scatter). Both are now a bare `Select` + `SelectTrigger
 * aria-label=…`, exactly like `RunsView.tsx`'s own "Group by" control and `DirectoryTab.tsx`'s
 * "Sort" control (the same defect, already fixed there) — an `aria-hidden` muted prefix keeps the
 * value legible to a sighted user without a visible label row breaking the baseline.
 */
export function FilterControls({
  controls,
  onChange,
  servers,
  environments,
  suites,
  models,
  runCount,
}: {
  controls: TestingDashboardControls;
  onChange: (next: TestingDashboardControls) => void;
  servers: CatalogOption[];
  environments: CatalogOption[];
  suites: CatalogOption[];
  models: string[];
  /** Total runs in the current window/filter (C-5 count badge). Omitted while the caller's metrics
   *  haven't loaded at least once — never render a misleading "0 runs" ahead of real data. */
  runCount?: number;
}) {
  const serverOptions: FacetOption[] = servers.map((s) => ({ value: s.id, label: s.name }));
  const envOptions: FacetOption[] = environments.map((s) => ({ value: s.id, label: s.name }));
  const modelOptions: FacetOption[] = models.map((m) => ({ value: m, label: m }));

  const dateValue: DateRange = { from: new Date(`${controls.from}T00:00:00`), to: new Date(`${controls.to}T00:00:00`) };

  return (
    <ViewToolbar
      left={
        <>
          <DateRangePicker
            value={dateValue}
            onValueChange={(range) => {
              if (!range?.from) return;
              onChange({
                ...controls,
                from: isoDateOnlyLocal(range.from),
                to: isoDateOnlyLocal(range.to ?? range.from),
              });
            }}
            presets={DATE_PRESETS}
            numberOfMonths={2}
            placeholder="Date range"
          />
          <FacetFilter
            title="Provider"
            options={PROVIDER_OPTIONS}
            selected={controls.providerKind}
            onSelectedChange={(values) => onChange({ ...controls, providerKind: values as ProviderKind[] })}
          />
          <FacetFilter
            title="Server"
            options={serverOptions}
            selected={controls.serverId}
            onSelectedChange={(values) => onChange({ ...controls, serverId: values })}
          />
          <FacetFilter
            title="Environment"
            options={envOptions}
            selected={controls.scenarioId}
            onSelectedChange={(values) => onChange({ ...controls, scenarioId: values })}
          />
          <FacetFilter
            title="Model"
            options={modelOptions}
            selected={controls.model}
            onSelectedChange={(values) => onChange({ ...controls, model: values })}
          />
          <Select
            value={controls.suiteId ?? "__all__"}
            onValueChange={(value) => onChange({ ...controls, suiteId: value === "__all__" ? undefined : value })}
          >
            <SelectTrigger aria-label="Suite" className="h-9 w-auto shrink-0 gap-1.5">
              <span aria-hidden className="text-muted-foreground">
                Suite:
              </span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All suites</SelectItem>
              {suites.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
      results={
        runCount != null ? (
          <ResultCount>
            {runCount} run{runCount === 1 ? "" : "s"}
          </ResultCount>
        ) : undefined
      }
      actions={
        <Select
          value={controls.groupBy}
          onValueChange={(value) => onChange({ ...controls, groupBy: value as TestingGroupBy })}
        >
          <SelectTrigger aria-label="Group by" className="h-9 w-auto shrink-0 gap-1.5">
            <span aria-hidden className="text-muted-foreground">
              Group by:
            </span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_BY_SELECT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
