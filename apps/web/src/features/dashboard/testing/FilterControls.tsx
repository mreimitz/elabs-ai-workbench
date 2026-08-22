import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@elabs-ai/components-ui";
import { FacetFilter, type FacetOption } from "@elabs-ai/components-data";
import type { ProviderKind } from "@mcp-token-footprint/shared";
import { PROVIDER_KINDS } from "@mcp-token-footprint/shared";
import { ResultCount } from "../../../components/ResultCount";
import { ViewToolbar } from "../../../components/ViewToolbar";
import {
  TESTING_BUCKET_AUTO,
  TESTING_BUCKET_LABELS,
  TESTING_BUCKET_OPTIONS,
  TESTING_GROUP_BY_OPTIONS,
  type TestingBucketChoice,
  type TestingBucketSelection,
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

export type CatalogOption = { id: string; name: string };

/**
 * FilterControls — the Testing tab's FACET row: a `RunFilter` subset bar (`FacetFilter` per
 * dimension, the same multi-select component `RunsView.tsx`'s toolbar already uses), a suite
 * single-select and the group-by select, rendered through the shared `ViewToolbar` (D-TB6/D-TB7),
 * which owns the row's height/gap/wrap so this keeps the SAME control vocabulary + row shape the
 * Issues tab's `IssueFilters` uses (D-4). Every change round-trips through `controls`/`onChange` —
 * the URL persistence lives in the caller (`TestingTab`), not here (a pure controlled view).
 *
 * ── THE DATE RANGE MOVED OUT (dashboard-bento WP 2.2, Defect 2) ──────────────────────────────────
 * This row used to lead with its own `DateRangePicker`, inside a `bg-card` band pinned below the tab
 * strip. The Dashboard now carries ONE range control in ONE page-level toolbar ABOVE the strip
 * (`DashboardView` → `DashboardRangeControl`), scoping Overview, Testing and Issues alike — the
 * owner's 2026-08-20 note that a timeline filter "need to work for Testing and issues as well".
 * That picker (presets + calendar) is the one that survived; this row keeps only the facets that are
 * genuinely Testing's own, and the caller renders it frame-light so it reads as tab content rather
 * than a second chrome band.
 *
 * ── THE TIME BUCKET JOINED THE ROW (RM-17 AM-OB3) ────────────────────────────────────────────────
 * The bucket granularity was derived from the window span and nothing else — hourly under two days,
 * daily under sixty, weekly beyond — with no way to say "this range, but hourly". The `Bucket`
 * select is that missing control, and it is what makes the `?tBucket=` key worth having: a URL key
 * over a choice the UI never offered would address nothing. `Auto` is the default (and names what
 * auto currently resolves to), so an untouched dashboard behaves and reads exactly as before.
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
  bucketSelection,
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
  /**
   * AM-OB3 — the resolved bucket, used ONLY to spell out what "Auto" currently means on the Auto
   * option itself. A clamped choice is reported by the caller as a full-width note above the
   * panels, not squeezed into this row: it is a statement about the charts, not about this control.
   */
  bucketSelection?: TestingBucketSelection;
}) {
  const serverOptions: FacetOption[] = servers.map((s) => ({ value: s.id, label: s.name }));
  const envOptions: FacetOption[] = environments.map((s) => ({ value: s.id, label: s.name }));
  const modelOptions: FacetOption[] = models.map((m) => ({ value: m, label: m }));

  return (
    <ViewToolbar
      left={
        <>
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
        <>
          {/* AM-OB3 — the time-bucket control. It ships WITH the `?tBucket=` key it writes, because
              a URL key over a choice the UI never offered would address nothing. "Auto" is the
              default and writes no param, so an untouched dashboard URL is unchanged. */}
          <Select
            value={controls.bucket}
            onValueChange={(value) => onChange({ ...controls, bucket: value as TestingBucketChoice })}
          >
            <SelectTrigger aria-label="Time bucket" className="h-9 w-auto shrink-0 gap-1.5">
              <span aria-hidden className="text-muted-foreground">
                Bucket:
              </span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TESTING_BUCKET_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option === TESTING_BUCKET_AUTO && bucketSelection !== undefined
                    ? `${TESTING_BUCKET_LABELS[option]} (${TESTING_BUCKET_LABELS[bucketSelection.auto].toLowerCase()})`
                    : TESTING_BUCKET_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        </>
      }
    />
  );
}
