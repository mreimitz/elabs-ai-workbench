import {
  Badge,
  Button,
  DateRangePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DateRange,
  type DateRangePreset,
} from "@brand/ui";
import {
  HUB_USAGE_GROUP_BYS,
  type HubProject,
  type HubUsageGroupBy,
} from "@mcp-token-footprint/shared";
import { useNavigate } from "react-router-dom";
import { ViewToolbar } from "../../../../components/ViewToolbar";
import { sessionsHrefForFilter } from "./usage-links";
import type { UsageControls } from "./usage-url-state";

/**
 * Assistant Hub UX WP2.6 (D-HUX10, §7.3) — the Usage tab's one control row: `DateRangePicker` +
 * group-by `Select` + a Project filter, per the WP text's toolbar workstep. Mounted BARE (no
 * `PageShell`) — `WorkforceView` (WP2.1) already owns the page frame; this follows `ViewToolbar`'s
 * documented "(b) detail pane" usage, the same posture the Usage tab's host tab body takes.
 *
 * PROJECT FILTER IS SINGLE-SELECT, NOT `@brand/data`'s `FacetFilter` (deliberate): `/api/hub/usage/
 * rollup`'s `projectId` query param is one string, not an array (`hubUsageRollupQuerySchema`,
 * `apps/api/src/hub/routes.ts`) — a multi-select `FacetFilter` chip would silently only ever apply
 * the LAST checked value, which misrepresents what the control does. Both controls use bare `Select`
 * + `SelectTrigger aria-label` per D-TB9 (label-above stack banned in toolbars).
 */

const GROUP_BY_LABELS: Record<HubUsageGroupBy, string> = {
  agent: "Agent",
  crew: "Crew",
  model: "Model",
  project: "Project",
  mode: "Mode",
};

const GROUP_BY_OPTIONS = HUB_USAGE_GROUP_BYS.map((value) => ({
  value,
  label: GROUP_BY_LABELS[value],
}));

const NO_PROJECT_FILTER = "__all__";

const DATE_PRESETS: DateRangePreset[] = [
  { label: "Last 7 days", getRange: () => ({ from: daysAgo(6), to: new Date() }) },
  { label: "Last 30 days", getRange: () => ({ from: daysAgo(29), to: new Date() }) },
  { label: "Last 90 days", getRange: () => ({ from: daysAgo(89), to: new Date() }) },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateRangeFromControls(controls: UsageControls): DateRange | undefined {
  if (!controls.from && !controls.to) return undefined;
  return {
    from: controls.from ? new Date(`${controls.from}T00:00:00.000Z`) : undefined,
    to: controls.to ? new Date(`${controls.to}T00:00:00.000Z`) : undefined,
  };
}

export function UsageToolbar({
  controls,
  onControlsChange,
  projects,
  entityCount,
}: {
  controls: UsageControls;
  onControlsChange: (next: UsageControls) => void;
  projects: HubProject[];
  /** Row count for the current group-by (excluding nothing — the unattributed bucket counts too). */
  entityCount: number | undefined;
}) {
  const navigate = useNavigate();

  const projectOptions = [
    { value: NO_PROJECT_FILTER, label: "All projects" },
    ...projects
      .map((p) => ({ value: p.id, label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const activeProject = controls.projectId
    ? projects.find((p) => p.id === controls.projectId)
    : undefined;

  return (
    <ViewToolbar
      left={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select
            value={controls.groupBy}
            onValueChange={(value) =>
              onControlsChange({ ...controls, groupBy: value as HubUsageGroupBy })
            }
          >
            <SelectTrigger aria-label="Group by" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_BY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={controls.projectId ?? NO_PROJECT_FILTER}
            onValueChange={(value) =>
              onControlsChange({
                ...controls,
                projectId: value === NO_PROJECT_FILTER ? undefined : value,
              })
            }
          >
            <SelectTrigger aria-label="Project" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projectOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRangePicker
            value={dateRangeFromControls(controls)}
            onValueChange={(range) =>
              onControlsChange({
                ...controls,
                from: range?.from ? isoDateOnly(range.from) : undefined,
                to: range?.to
                  ? isoDateOnly(range.to)
                  : range?.from
                    ? isoDateOnly(range.from)
                    : undefined,
              })
            }
            presets={DATE_PRESETS}
            placeholder="All time"
          />
          {entityCount !== undefined ? (
            <Badge variant="secondary" className="shrink-0 tabular-nums">
              {entityCount} {entityCount === 1 ? "entity" : "entities"}
            </Badge>
          ) : null}
        </div>
      }
      actions={
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate(sessionsHrefForFilter({ projectId: controls.projectId }))}
        >
          View sessions
        </Button>
      }
    />
  );
}
