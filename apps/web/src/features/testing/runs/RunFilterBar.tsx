import { useMemo, useState } from "react";
import type { RunFilter } from "@mcp-token-footprint/shared";
import {
  RUN_OUTCOMES,
  RUN_PHASES,
  RUN_STATUSES,
  STOP_REASON_CODES,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Checkbox,
  DateRangePicker,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  NumberInput,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  cn,
  useIsMobile,
} from "@brand/ui";
import { Plus, X } from "lucide-react";
import { IconButton } from "../../../components/IconButton";

/** One selectable option for a dynamic (id-valued) multi/select field. */
export type RunFilterOption = { value: string; label: string };

/** The dynamic, app-data-sourced option lists the bar needs for id-valued fields — `RunsView` resolves
 *  these from data it already loads (scenarios/servers/suites/skills) or a lightweight extra fetch. */
export type RunFilterOptionData = {
  environments: RunFilterOption[];
  models: RunFilterOption[];
  servers: RunFilterOption[];
  suites: RunFilterOption[];
  skills: RunFilterOption[];
};

export const EMPTY_RUN_FILTER_OPTIONS: RunFilterOptionData = {
  environments: [],
  models: [],
  servers: [],
  suites: [],
  skills: [],
};

/**
 * Every RunFilter field the bar can render as a chip. `phase`/`stopReasonCode` stay in the union so a
 * preset or a hand-edited URL that carries one still renders a REMOVABLE chip (never a silent,
 * invisible filter) — but they are no longer offered in the "+ Filter" menu (see {@link FIELD_GROUPS}
 * and {@link RENDERABLE_FIELDS}): design-remediation T8 folded the four lifecycle synonyms (Status /
 * Outcome / Stop reason / Phase) down to the two an operator actually reasons about — **Status**
 * (terminal state) and **Outcome** (quality). The old `providerKind` "Kind" filter is gone entirely
 * (T8, "delete one of Type/Kind"): the toolbar's single/suite **Type** facet keeps the row-shape axis,
 * and provider is approximable through the **Model** filter — so "Kind" was the redundant one to drop.
 */
export type FilterFieldKey =
  | "status"
  | "outcome"
  | "stopReasonCode"
  | "phase"
  | "model"
  | "serverId"
  | "scenarioId"
  | "suiteId"
  | "skillId"
  | "date"
  | "score"
  | "cost"
  | "duration"
  | "pinned"
  | "interactiveOnly"
  | "needsAttention"
  | "feedback"
  | "hasError";

const FIELD_LABELS: Record<FilterFieldKey, string> = {
  status: "Status",
  outcome: "Outcome",
  stopReasonCode: "Stop reason",
  phase: "Phase",
  model: "Model",
  serverId: "Server",
  scenarioId: "Environment",
  suiteId: "Suite",
  skillId: "Skill",
  date: "Date",
  score: "Score",
  cost: "Cost",
  duration: "Duration",
  pinned: "Pinned",
  interactiveOnly: "Interactive",
  needsAttention: "Needs attention",
  feedback: "Feedback",
  hasError: "Has error",
};

/**
 * Menu grouping for the "+ Filter" dropdown — purely presentational, and the SOURCE OF WHAT IS
 * ADDABLE. design-remediation T8: **Lifecycle** now offers exactly the two non-synonym filters
 * (Status + Outcome); `stopReasonCode`/`phase` are deliberately absent (folded into Status), and
 * `providerKind` ("Kind") is deleted. The two triage-boolean toggles (`needsAttention`/`hasError`)
 * moved to **Other** alongside the other booleans so Lifecycle reads as the clean two-filter group
 * the critique asked for.
 */
const FIELD_GROUPS: { label: string; fields: FilterFieldKey[] }[] = [
  { label: "Lifecycle", fields: ["status", "outcome"] },
  { label: "Scope", fields: ["model", "serverId", "scenarioId", "suiteId", "skillId"] },
  { label: "Metrics", fields: ["date", "score", "cost", "duration"] },
  { label: "Other", fields: ["pinned", "interactiveOnly", "needsAttention", "hasError", "feedback"] },
];

/**
 * Every field the bar can RENDER as an active chip (design-remediation T8): the addable menu fields
 * PLUS the two legacy lifecycle fields (`phase`, `stopReasonCode`) the "+ Filter" menu no longer
 * offers but a preset/URL may still carry (e.g. the "Waiting for you" preset sets `phase`). Keeping
 * them renderable means such a constraint always shows as a removable chip rather than filtering the
 * feed invisibly.
 */
const RENDERABLE_FIELDS: FilterFieldKey[] = [
  ...FIELD_GROUPS.flatMap((group) => group.fields),
  "phase",
  "stopReasonCode",
];

function humanizeToken(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const STATUS_OPTIONS: RunFilterOption[] = RUN_STATUSES.map((v) => ({ value: v, label: humanizeToken(v) }));
const OUTCOME_OPTIONS: RunFilterOption[] = RUN_OUTCOMES.map((v) => ({ value: v, label: humanizeToken(v) }));
const STOP_REASON_OPTIONS: RunFilterOption[] = STOP_REASON_CODES.map((v) => ({
  value: v,
  label: humanizeToken(v),
}));
const PHASE_OPTIONS: RunFilterOption[] = RUN_PHASES.map((v) => ({ value: v, label: humanizeToken(v) }));

const MULTI_FIELD_KEYS = new Set<FilterFieldKey>([
  "status",
  "outcome",
  "stopReasonCode",
  "phase",
  "model",
  "serverId",
  "scenarioId",
  "skillId",
]);

/** Strip one field's own key(s) from a filter, immutably. */
function clearField(filter: RunFilter, field: FilterFieldKey): RunFilter {
  const next = { ...filter };
  switch (field) {
    case "status":
    case "outcome":
    case "stopReasonCode":
    case "phase":
    case "model":
    case "serverId":
    case "scenarioId":
    case "suiteId":
    case "skillId":
    case "pinned":
    case "interactiveOnly":
    case "needsAttention":
    case "hasError":
    case "feedback":
      delete next[field];
      return next;
    case "date":
      next.dateFrom = undefined;
      next.dateTo = undefined;
      return next;
    case "score":
      next.scoreGte = undefined;
      next.scoreLte = undefined;
      next.grader = undefined;
      return next;
    case "cost":
      next.costUsdGte = undefined;
      next.costUsdLte = undefined;
      return next;
    case "duration":
      next.durationMsGte = undefined;
      next.durationMsLte = undefined;
      return next;
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

/** Whether `field` currently carries a value in `filter` (drives which chips render). */
function isFieldActive(filter: RunFilter, field: FilterFieldKey): boolean {
  switch (field) {
    case "status":
      return (filter.status?.length ?? 0) > 0;
    case "outcome":
      return (filter.outcome?.length ?? 0) > 0;
    case "stopReasonCode":
      return (filter.stopReasonCode?.length ?? 0) > 0;
    case "phase":
      return (filter.phase?.length ?? 0) > 0;
    case "model":
      return (filter.model?.length ?? 0) > 0;
    case "serverId":
      return (filter.serverId?.length ?? 0) > 0;
    case "scenarioId":
      return (filter.scenarioId?.length ?? 0) > 0;
    case "skillId":
      return (filter.skillId?.length ?? 0) > 0;
    case "suiteId":
      return filter.suiteId !== undefined;
    case "date":
      return filter.dateFrom !== undefined || filter.dateTo !== undefined;
    case "score":
      return filter.scoreGte !== undefined || filter.scoreLte !== undefined;
    case "cost":
      return filter.costUsdGte !== undefined || filter.costUsdLte !== undefined;
    case "duration":
      return filter.durationMsGte !== undefined || filter.durationMsLte !== undefined;
    case "pinned":
      return filter.pinned !== undefined;
    case "interactiveOnly":
      return filter.interactiveOnly === true;
    case "needsAttention":
      return filter.needsAttention === true;
    case "hasError":
      return filter.hasError !== undefined;
    case "feedback":
      return filter.feedback !== undefined;
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

function optionsFor(field: FilterFieldKey, data: RunFilterOptionData): RunFilterOption[] {
  switch (field) {
    case "status":
      return STATUS_OPTIONS;
    case "outcome":
      return OUTCOME_OPTIONS;
    case "stopReasonCode":
      return STOP_REASON_OPTIONS;
    case "phase":
      return PHASE_OPTIONS;
    case "model":
      return data.models;
    case "serverId":
      return data.servers;
    case "scenarioId":
      return data.environments;
    case "skillId":
      return data.skills;
    case "suiteId":
      return data.suites;
    default:
      return [];
  }
}

function labelsFor(values: string[], options: RunFilterOption[]): string {
  const byValue = new Map(options.map((o) => [o.value, o.label]));
  return values.map((v) => byValue.get(v) ?? v).join(", ");
}

/** A short "value" string for the chip's subtitle; `null` ⇒ the field is active but summarized purely
 *  by its label (no compact subtitle worth showing). */
function summarize(field: FilterFieldKey, filter: RunFilter, data: RunFilterOptionData): string | null {
  switch (field) {
    case "status":
      return filter.status ? labelsFor(filter.status, STATUS_OPTIONS) : null;
    case "outcome":
      return filter.outcome ? labelsFor(filter.outcome, OUTCOME_OPTIONS) : null;
    case "stopReasonCode":
      return filter.stopReasonCode ? labelsFor(filter.stopReasonCode, STOP_REASON_OPTIONS) : null;
    case "phase":
      return filter.phase ? labelsFor(filter.phase, PHASE_OPTIONS) : null;
    case "model":
      return filter.model ? labelsFor(filter.model, data.models) : null;
    case "serverId":
      return filter.serverId ? labelsFor(filter.serverId, data.servers) : null;
    case "scenarioId":
      return filter.scenarioId ? labelsFor(filter.scenarioId, data.environments) : null;
    case "skillId":
      return filter.skillId ? labelsFor(filter.skillId, data.skills) : null;
    case "suiteId":
      return filter.suiteId ? labelsFor([filter.suiteId], data.suites) : null;
    case "date": {
      const from = filter.dateFrom?.slice(0, 10);
      const to = filter.dateTo?.slice(0, 10);
      if (from && to) return `${from} – ${to}`;
      if (from) return `from ${from}`;
      if (to) return `to ${to}`;
      return null;
    }
    case "score": {
      const parts: string[] = [];
      if (filter.scoreGte !== undefined) parts.push(`≥ ${filter.scoreGte}`);
      if (filter.scoreLte !== undefined) parts.push(`≤ ${filter.scoreLte}`);
      if (filter.grader) parts.push(`(${filter.grader})`);
      return parts.length > 0 ? parts.join(" ") : null;
    }
    case "cost": {
      const parts: string[] = [];
      if (filter.costUsdGte !== undefined) parts.push(`≥ $${filter.costUsdGte}`);
      if (filter.costUsdLte !== undefined) parts.push(`≤ $${filter.costUsdLte}`);
      return parts.length > 0 ? parts.join(" ") : null;
    }
    case "duration": {
      const parts: string[] = [];
      if (filter.durationMsGte !== undefined) parts.push(`≥ ${Math.round(filter.durationMsGte / 1000)}s`);
      if (filter.durationMsLte !== undefined) parts.push(`≤ ${Math.round(filter.durationMsLte / 1000)}s`);
      return parts.length > 0 ? parts.join(" ") : null;
    }
    case "pinned":
      return filter.pinned === true ? "Pinned only" : filter.pinned === false ? "Unpinned only" : null;
    case "interactiveOnly":
      return filter.interactiveOnly === true ? "Only" : null;
    case "needsAttention":
      return filter.needsAttention === true ? "Only" : null;
    case "hasError":
      return filter.hasError === true ? "Yes" : filter.hasError === false ? "No" : null;
    case "feedback": {
      const parts: string[] = [];
      if (filter.feedback?.key) parts.push(filter.feedback.key);
      if (filter.feedback?.hasScore) parts.push("scored");
      return parts.length > 0 ? parts.join(", ") : "Any";
    }
    default: {
      const _exhaustive: never = field;
      return _exhaustive;
    }
  }
}

export type RunFilterBarProps = {
  filter: RunFilter;
  onChange: (next: RunFilter) => void;
  options: RunFilterOptionData;
};

/**
 * The composable, RunFilter-bound filter bar (Observability WP 2.3). Renders one chip per ACTIVE
 * RunFilter field (a field with a value set) plus, while mid-add, the field just picked from "+
 * Filter" (before it has a value). Every field is generic enough for reuse by the rules UI (WP 4.4)
 * that will eventually embed the same filter-builder.
 *
 * interface-craft WP 0.4 (finding 2): the bar is mounted as a plain top-level child of `RunsView`'s
 * `ViewToolbar` `left` cluster, which owns wrapping (D-TB7, `flex min-w-0 flex-wrap`). The bar's own
 * root also carries `flex-wrap` (no `shrink-0`) so a large set of active filter chips wraps onto its
 * own extra line(s) rather than being forced onto one non-shrinking, non-wrapping line that could
 * overflow the toolbar — the same defect finding 2 flagged, one level down.
 *
 * P0 mobile audit T4 (2026-07-25 critique): the same live pass measured the "+ Filter" trigger's
 * label 100% covered at 390px. Every chip and the trigger are already `shrink-0` (they don't crush),
 * so `flex-wrap` should reflow them onto their own line rather than overlap anything — desktop keeps
 * that wrap-only recipe exactly as `RunsView.test.tsx`'s "the hand-rolled overflow-x-auto scroller is
 * gone" test locks in (finding 2's fix was deliberately wrap, never an invisible-affordance scroller).
 * Below the mobile breakpoint (`useIsMobile`, 768px) `overflow-x-auto` rides along as a DEFENSIVE
 * floor only there: if an ancestor ever squeezes this row narrower than even ONE glued chip pair's own
 * min-content width (a single flex-wrap line can't help there), the excess becomes reachable by a
 * horizontal swipe instead of silently overlapping. This does not change any filter's own width/height
 * (owner-scoped to a later task) — it only guards the row's overflow behavior on a phone. NOT
 * independently re-verified live at 390px — flag for browser confirmation.
 */
export function RunFilterBar({ filter, onChange, options }: RunFilterBarProps) {
  const [openField, setOpenField] = useState<FilterFieldKey | null>(null);
  const isMobile = useIsMobile();

  const visibleFields = useMemo<FilterFieldKey[]>(() => {
    // Render a chip for any RENDERABLE field that is active — including `phase`/`stopReasonCode`,
    // which the "+ Filter" menu no longer offers but a preset/URL may still carry (T8).
    const active = RENDERABLE_FIELDS.filter((f) => isFieldActive(filter, f));
    if (openField && !active.includes(openField)) active.push(openField);
    return active;
  }, [filter, openField]);

  const addableFields = useMemo(
    () => FIELD_GROUPS.map((g) => ({ ...g, fields: g.fields.filter((f) => !isFieldActive(filter, f)) })),
    [filter],
  );

  const removeField = (field: FilterFieldKey) => {
    onChange(clearField(filter, field));
    if (openField === field) setOpenField(null);
  };

  return (
    <div
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", isMobile && "overflow-x-auto")}
    >
      {visibleFields.map((field) => (
        <FilterChip
          key={field}
          label={FIELD_LABELS[field]}
          summary={summarize(field, filter, options)}
          open={openField === field}
          onOpenChange={(next) => setOpenField(next ? field : null)}
          onRemove={() => removeField(field)}
        >
          <FieldEditor field={field} filter={filter} onChange={onChange} options={options} />
        </FilterChip>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0 gap-1">
            <Plus aria-hidden className="size-3.5" />
            <span>Filter</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {addableFields.map((group, i) =>
            group.fields.length === 0 ? null : (
              <div key={group.label}>
                {i > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {group.fields.map((field) => (
                  <DropdownMenuItem key={field} onSelect={() => setOpenField(field)}>
                    {FIELD_LABELS[field]}
                  </DropdownMenuItem>
                ))}
              </div>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function FilterChip({
  label,
  summary,
  open,
  onOpenChange,
  onRemove,
  children,
}: {
  label: string;
  summary: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-stretch">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 max-w-[16rem] justify-start gap-1.5 rounded-r-none border-r-0"
          >
            <span className="font-medium">{label}</span>
            {summary ? <span className="min-w-0 truncate text-muted-foreground">{summary}</span> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          {children}
        </PopoverContent>
      </Popover>
      <IconButton
        variant="outline"
        size="icon-sm"
        className="rounded-l-none"
        onClick={onRemove}
        label={`Remove ${label} filter`}
      >
        <X aria-hidden className="size-3.5" />
      </IconButton>
    </div>
  );
}

function FieldEditor({
  field,
  filter,
  onChange,
  options,
}: {
  field: FilterFieldKey;
  filter: RunFilter;
  onChange: (next: RunFilter) => void;
  options: RunFilterOptionData;
}) {
  if (MULTI_FIELD_KEYS.has(field)) {
    return (
      <MultiSelectEditor
        options={optionsFor(field, options)}
        selected={(filter[field as keyof RunFilter] as string[] | undefined) ?? []}
        onSelectedChange={(values) =>
          onChange({ ...filter, [field]: values.length > 0 ? values : undefined })
        }
      />
    );
  }
  switch (field) {
    case "suiteId":
      return (
        <ScalarSelectEditor
          options={options.suites}
          value={filter.suiteId}
          placeholder="Any suite"
          onValueChange={(value) => onChange({ ...filter, suiteId: value })}
        />
      );
    case "date":
      return (
        <div className="flex flex-col gap-2">
          <Label>Started between</Label>
          <DateRangePicker
            value={{
              from: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
              to: filter.dateTo ? new Date(filter.dateTo) : undefined,
            }}
            onValueChange={(range) =>
              onChange({
                ...filter,
                dateFrom: range?.from ? range.from.toISOString() : undefined,
                dateTo: range?.to ? range.to.toISOString() : undefined,
              })
            }
            numberOfMonths={1}
            placeholder="Pick a date range"
          />
        </div>
      );
    case "score":
      return (
        <RangeEditor
          label="Score (0–1)"
          gte={filter.scoreGte}
          lte={filter.scoreLte}
          step={0.05}
          onApply={(gte, lte) => onChange({ ...filter, scoreGte: gte, scoreLte: lte })}
          extra={
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="run-filter-grader">Grader (optional)</Label>
              <Input
                id="run-filter-grader"
                defaultValue={filter.grader ?? ""}
                placeholder="e.g. answer_validation…"
                spellCheck={false}
                autoComplete="off"
                onBlur={(event) => {
                  const value = event.currentTarget.value.trim();
                  onChange({ ...filter, grader: value.length > 0 ? value : undefined });
                }}
              />
            </div>
          }
        />
      );
    case "cost":
      return (
        <RangeEditor
          label="Cost (USD)"
          gte={filter.costUsdGte}
          lte={filter.costUsdLte}
          step={0.01}
          onApply={(gte, lte) => onChange({ ...filter, costUsdGte: gte, costUsdLte: lte })}
        />
      );
    case "duration":
      return (
        <RangeEditor
          label="Duration (seconds)"
          gte={filter.durationMsGte !== undefined ? filter.durationMsGte / 1000 : undefined}
          lte={filter.durationMsLte !== undefined ? filter.durationMsLte / 1000 : undefined}
          step={1}
          onApply={(gte, lte) =>
            onChange({
              ...filter,
              durationMsGte: gte !== undefined ? Math.round(gte * 1000) : undefined,
              durationMsLte: lte !== undefined ? Math.round(lte * 1000) : undefined,
            })
          }
        />
      );
    case "pinned":
      return (
        <TriStateEditor
          label="Pinned"
          value={filter.pinned}
          onValueChange={(value) => onChange({ ...filter, pinned: value })}
        />
      );
    case "hasError":
      return (
        <TriStateEditor
          label="Has error"
          value={filter.hasError}
          onValueChange={(value) => onChange({ ...filter, hasError: value })}
        />
      );
    case "interactiveOnly":
      return (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="run-filter-interactive">Interactive runs only</Label>
          <Switch
            id="run-filter-interactive"
            checked={filter.interactiveOnly === true}
            onCheckedChange={(checked) =>
              onChange({ ...filter, interactiveOnly: checked ? true : undefined })
            }
          />
        </div>
      );
    case "needsAttention":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="run-filter-needs-attention">Needs attention only</Label>
            <Switch
              id="run-filter-needs-attention"
              checked={filter.needsAttention === true}
              onCheckedChange={(checked) =>
                onChange({ ...filter, needsAttention: checked ? true : undefined })
              }
            />
          </div>
          <Text variant="meta" tone="muted" className="text-pretty">
            Runs paused on you (waiting for input) or finished/queued and not yet opened.
          </Text>
        </div>
      );
    case "feedback":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-filter-feedback-key">Feedback key (optional)</Label>
            <Input
              id="run-filter-feedback-key"
              defaultValue={filter.feedback?.key ?? ""}
              placeholder="e.g. thumbs…"
              spellCheck={false}
              autoComplete="off"
              onBlur={(event) => {
                const key = event.currentTarget.value.trim();
                const hasScore = filter.feedback?.hasScore;
                const next = key.length > 0 || hasScore ? { key: key || undefined, hasScore } : undefined;
                onChange({ ...filter, feedback: next });
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="run-filter-feedback-score">Has a feedback score</Label>
            <Switch
              id="run-filter-feedback-score"
              checked={filter.feedback?.hasScore === true}
              onCheckedChange={(checked) => {
                const key = filter.feedback?.key;
                const next = checked || key ? { key, hasScore: checked ? true : undefined } : undefined;
                onChange({ ...filter, feedback: next });
              }}
            />
          </div>
        </div>
      );
    default:
      return null;
  }
}

function MultiSelectEditor({
  options,
  selected,
  onSelectedChange,
}: {
  options: RunFilterOption[];
  selected: string[];
  onSelectedChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered =
    query.trim().length === 0
      ? options
      : options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-2">
      {options.length > 8 ? (
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter options…"
          spellCheck={false}
          autoComplete="off"
          aria-label="Filter options"
        />
      ) : null}
      <ScrollArea className="max-h-64">
        <div className="flex flex-col gap-1 pr-2">
          {filtered.length === 0 ? (
            <Text variant="meta" tone="muted" className="px-1 py-2">
              No options.
            </Text>
          ) : (
            filtered.map((option) => {
              const id = `run-filter-opt-${option.value}`;
              const checked = selected.includes(option.value);
              return (
                <label
                  key={option.value}
                  htmlFor={id}
                  className="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    aria-label={option.label}
                    onCheckedChange={(value) =>
                      onSelectedChange(
                        value === true
                          ? [...selected, option.value]
                          : selected.filter((v) => v !== option.value),
                      )
                    }
                  />
                  <span className="min-w-0 truncate" aria-hidden>
                    {option.label}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ScalarSelectEditor({
  options,
  value,
  placeholder,
  onValueChange,
}: {
  options: RunFilterOption[];
  value: string | undefined;
  placeholder: string;
  onValueChange: (value: string | undefined) => void;
}) {
  return (
    <Select
      value={value ?? "__any__"}
      onValueChange={(next) => onValueChange(next === "__any__" ? undefined : next)}
    >
      <SelectTrigger aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__any__">{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TriStateEditor({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean | undefined;
  onValueChange: (value: boolean | undefined) => void;
}) {
  const current = value === undefined ? "__any__" : value ? "__yes__" : "__no__";
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select
        value={current}
        onValueChange={(next) =>
          onValueChange(next === "__any__" ? undefined : next === "__yes__")
        }
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__any__">Any</SelectItem>
          <SelectItem value="__yes__">Yes</SelectItem>
          <SelectItem value="__no__">No</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function RangeEditor({
  label,
  gte,
  lte,
  step,
  onApply,
  extra,
}: {
  label: string;
  gte: number | undefined;
  lte: number | undefined;
  step: number;
  onApply: (gte: number | undefined, lte: number | undefined) => void;
  extra?: React.ReactNode;
}) {
  const [draftGte, setDraftGte] = useState<number | null>(gte ?? null);
  const [draftLte, setDraftLte] = useState<number | null>(lte ?? null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{label}</Label>
        <div className="flex items-center gap-2">
          <NumberInput
            aria-label={`${label} minimum`}
            value={draftGte}
            onValueChange={setDraftGte}
            step={step}
            placeholder="Min"
          />
          <span className="text-muted-foreground">–</span>
          <NumberInput
            aria-label={`${label} maximum`}
            value={draftLte}
            onValueChange={setDraftLte}
            step={step}
            placeholder="Max"
          />
        </div>
      </div>
      {extra}
      <div className={cn("flex justify-end gap-2")}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraftGte(null);
            setDraftLte(null);
            onApply(undefined, undefined);
          }}
        >
          Clear
        </Button>
        <Button
          size="sm"
          onClick={() => onApply(draftGte ?? undefined, draftLte ?? undefined)}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
