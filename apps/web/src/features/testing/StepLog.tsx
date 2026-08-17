import { useCallback, useMemo, useState } from "react";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import type { RunStep, RunStepType, SessionCostBasis, SpanKind } from "@mcp-token-footprint/shared";
import { DataTable, FacetFilter, FilterBar, SearchInput, ColumnPicker } from "@elabs-ai/components-data";
import type { Status, TreeNode } from "@elabs-ai/components-ui";
import {
  Button,
  EmptyState,
  Progress,
  StatusBadge,
  Text,
  ToggleGroup,
  ToggleGroupItem,
  Tree,
  cn,
} from "@elabs-ai/components-ui";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BrainCog,
  ClipboardCheck,
  FileCog,
  Gavel,
  Hammer,
  ListTree,
  MessageSquare,
  MessagesSquare,
  Radar,
  Search as SearchIcon,
  Wrench,
} from "lucide-react";
import { col } from "../../lib/table";
import { formatCostUsd, formatDuration, formatNumber, safeJson } from "../../lib/format";
import { deriveStatusView } from "../../lib/status";
import { dedupeToolSteps } from "./dedupe-tool-steps";
import { HighlightMatch } from "./SearchHighlight";
import {
  buildStepTree,
  childrenByParentId,
  defaultCollapsedStepIds,
  expandableStepIds,
  hasStepHierarchy,
  type StepTreeNode,
} from "./step-tree";
import {
  derivePerStepEconomics,
  rollupSubtreeEconomics,
  type StepCumulativeKpi,
  type StepEconomics,
} from "./analytics-derive";

/**
 * The right-pane step / packet log (WP 3.6, UI §4 Zone C). A virtualized `@elabs-ai/components-data` `DataTable`
 * of every `RunStep` in order — the "inspect every package" surface. Selecting a row lifts the
 * selection to `RunConsole` (`onSelectStep`), which opens the `PacketInspector` and cross-highlights
 * the matching left-pane tool card (WP 3.4 already reflects `selectedStepId`).
 *
 * Smoothness at 50+ steps comes from `DataTable`'s opt-in row virtualization
 * (`enableRowVirtualization`): only the visible window of rows is mounted, so a long, rapidly-growing
 * log never mounts hundreds of rows or thrashes layout. There is NO per-row `getBoundingClientRect`
 * / `offsetHeight` measurement anywhere here — the cost-weight cell is a pure CSS `Progress` whose
 * value is computed from the step's tokens against the run's max, never from a measured DOM rect.
 *
 * Observability (WP 3.2) — once any step carries WP3.1's `parentStepId` (`hasStepHierarchy`), the log
 * renders as a COLLAPSIBLE TREE (`@elabs-ai/components-ui` `Tree`) instead of the flat table: span-kind icons, a
 * `rating`/`tool_io` default-collapsed state, and per-step token/cost/duration "economics" chips
 * (subtree-rolled-up on parents — see `analytics-derive.ts`). A run with NO hierarchy (every run
 * recorded before WP3.1, or any run whose executor emits none) renders EXACTLY as before — the
 * original flat `DataTable` branch below is untouched.
 */

/** Display metadata for a `RunStep.type` — the DevTools-style icon + a short `llm.req`-style label. */
type StepTypeMeta = {
  /** Short label shown in the type facet and (as a tooltip) on the icon. */
  label: string;
  Icon: ComponentType<LucideProps>;
};

export const STEP_TYPE_META: Record<RunStepType, StepTypeMeta> = {
  llm_request: { label: "llm.req", Icon: ArrowUpFromLine },
  llm_response: { label: "llm.resp", Icon: ArrowDownToLine },
  tool_call: { label: "tool.call", Icon: Wrench },
  tool_result: { label: "tool.result", Icon: Hammer },
  context_event: { label: "context.event", Icon: FileCog },
  // F6 — the operator's own turns (opener prompt + interactive follow-ups), now represented in the log.
  user_message: { label: "user.msg", Icon: MessageSquare },
};

/** A safe fallback for any step whose `type` somehow escapes the closed union. */
const FALLBACK_META: StepTypeMeta = { label: "step", Icon: BrainCog };

export function stepTypeMeta(type: RunStepType): StepTypeMeta {
  return STEP_TYPE_META[type] ?? FALLBACK_META;
}

/**
 * Observability (WP 3.2) — icon/label overrides for the tree's NEW/child span kinds (D-OB17): a
 * `tool_io` child (the MCP roundtrip detail), a `rating` span (the auto-rating review), a `judge_call`
 * child (one LLM judge invocation), a future `probe` span, and a `turn` grouping. `tool_call` (as a
 * spanKind) and `context_event`-as-a-role deliberately have NO entry — the existing `type` icon
 * (Wrench / FileCog) already covers them, so no second icon is needed. Only used by the tree branch —
 * a flat run never carries a `spanKind` at all.
 */
const SPAN_KIND_META: Partial<Record<SpanKind, StepTypeMeta>> = {
  tool_io: { label: "tool.io", Icon: ArrowLeftRight },
  rating: { label: "rating", Icon: ClipboardCheck },
  judge_call: { label: "judge.call", Icon: Gavel },
  probe: { label: "probe", Icon: Radar },
  turn: { label: "turn", Icon: MessagesSquare },
};

/** The tree row's icon: a `spanKind` override when one applies, else the ordinary `type` meta. */
function spanOrTypeMeta(step: RunStep): StepTypeMeta {
  const override = step.spanKind ? SPAN_KIND_META[step.spanKind] : undefined;
  return override ?? stepTypeMeta(step.type);
}

/** Map a `RunStep.status` onto the closed `@elabs-ai/components-ui` `Status` enum used by `StatusBadge`. */
export function stepBrandStatus(status: RunStep["status"]): Status {
  if (status === "error") return "failed";
  if (status === "running") return "running";
  return "complete";
}

/** The "tokens up" (sent / input) figure for a step — provider-actual first, then estimator lens. */
export function tokensUp(step: RunStep): number {
  if (step.usageActual) return step.usageActual.inputTokens;
  // For request-ish / tool-call steps the estimator lens is the best available "sent" measure.
  if (step.type === "llm_request" || step.type === "tool_call" || step.type === "context_event") {
    return firstProfileTokens(step);
  }
  return 0;
}

/** The "tokens down" (received / output) figure for a step — provider-actual first, then lens. */
export function tokensDown(step: RunStep): number {
  if (step.usageActual) return step.usageActual.outputTokens;
  if (step.type === "llm_response" || step.type === "tool_result") {
    return firstProfileTokens(step);
  }
  return 0;
}

/** The first populated estimator-lens token count (lenses are partial — only effective profiles). */
export function firstProfileTokens(step: RunStep): number {
  for (const value of Object.values(step.profileTokens)) {
    if (typeof value === "number") return value;
  }
  return 0;
}

/** A step's total token weight (sent + received) — drives the cost-weight bar's relative tint. */
function stepWeight(step: RunStep): number {
  return tokensUp(step) + tokensDown(step);
}

/** Human label for a step row: tool name, then model/label, then the type label. */
function stepLabel(step: RunStep): string {
  return step.toolName ?? step.label ?? stepTypeMeta(step.type).label;
}

function durationLabel(ms: number | undefined | null): string {
  return ms === undefined || ms === null ? "—" : formatDuration(ms);
}

/** Lower-cased haystack of a step's searchable text (label, tool, server, and its redacted payload). */
function searchHaystack(step: RunStep): string {
  const parts = [
    step.label,
    step.toolName ?? "",
    step.serverId ?? "",
    stepTypeMeta(step.type).label,
  ];
  // The payload is already redacted server-side; searching its TEXT only (never rendering it as
  // markup) is safe and matches the spec's "searches names and payloads".
  try {
    parts.push(safeJson(step.payload));
  } catch {
    // A payload that can't be stringified (shouldn't happen for redacted JSON) is simply not indexed.
  }
  return parts.join(" ").toLowerCase();
}

export type StepLogProps = {
  steps: RunStep[];
  /** The lifted cross-highlight selection (shared with the left tool cards + the inspector). */
  selectedStepId: string | null;
  onSelectStep: (stepId: string | null) => void;
  /**
   * Observability (WP 3.2) — cumulative per-step KPI snapshots (the console's REPLAY-only
   * `kpiByStepId`, or the report's structurally identical `stepKpis`), keyed by step id. Powers the
   * tree's per-step token/cost DELTA chips (diffed consecutive snapshots — see
   * `analytics-derive.ts#derivePerStepEconomics`). `undefined`/`null` while unavailable (e.g. a
   * still-live run, before the replay snapshot lands) — chips fall back to duration-only, never a
   * guessed figure. Ignored entirely by the flat (no-hierarchy) branch.
   */
  kpiByStepId?: ReadonlyMap<string, StepCumulativeKpi> | null;
  /**
   * Observability (WP 3.2) — the run's `SessionCapabilities.costBasis` (D-US4). Governs the tree's
   * per-step cost-delta chip: suppressed for `"none"` (no cost at all) and `"questions"` (Acme's
   * question-count basis has no honest PER-STEP dollar figure), marked "est." for
   * `"subscription_reference"`. `undefined` shows a plain dollar chip (the `"api_exact"` default).
   * Ignored entirely by the flat (no-hierarchy) branch.
   */
  costBasis?: SessionCostBasis;
  /**
   * Observability (WP 3.4) — the console-header in-run search query, integrated with the TREE branch
   * only (WP3.2's hierarchical log) as a "filter to matches" facility DISTINCT from this component's
   * own local search box above (that one stays exactly as it was). `undefined`/empty is a complete
   * no-op for every existing caller — the log renders byte-identically.
   */
  highlightQuery?: string;
  /**
   * "filtered" (default) hides every row that doesn't match `highlightQuery` (plus its ancestor
   * chain, mirroring the existing local-search behavior below); "all" shows every row and only
   * highlights the matches (the LangSmith in-trace "Filtered Only"/"Show All" pattern). Ignored when
   * `highlightQuery` is empty. Uncontrolled (defaults to "filtered") when no `onMatchFilterModeChange`
   * is supplied.
   */
  matchFilterMode?: "filtered" | "all";
  onMatchFilterModeChange?: (mode: "filtered" | "all") => void;
};

export function StepLog({
  steps,
  selectedStepId,
  onSelectStep,
  kpiByStepId = null,
  costBasis,
  highlightQuery = "",
  matchFilterMode = "filtered",
  onMatchFilterModeChange,
}: StepLogProps) {
  const [search, setSearch] = useState("");
  const [typeFacet, setTypeFacet] = useState<string[]>([]);
  const [serverFacet, setServerFacet] = useState<string[]>([]);
  const [errorsOnly, setErrorsOnly] = useState<string[]>([]);
  // Uncontrolled fallback for `matchFilterMode` when the caller doesn't lift it — StepLog still needs
  // SOME local state to flip the toggle even if nobody upstream cares about the value.
  const [localMatchFilterMode, setLocalMatchFilterMode] = useState<"filtered" | "all">("filtered");
  const effectiveMatchFilterMode = onMatchFilterModeChange ? matchFilterMode : localMatchFilterMode;
  const setMatchFilterMode = onMatchFilterModeChange ?? setLocalMatchFilterMode;
  const highlightNeedle = highlightQuery.trim().toLowerCase();
  const hasHighlight = highlightNeedle.length > 0;

  // De-dupe the double `tool_call` rows (Task C3 #2): each logical tool call emits an engine `:step:`
  // row (args) AND an MCP-sink `:mcp:` row (timing/size); collapse them into ONE row (merged) so the
  // log shows each tool call once. Everything below — weight, facets, search, count — reads this
  // canonical list, so the table and the Network badge stay accurate.
  const logicalSteps = useMemo(() => dedupeToolSteps(steps), [steps]);

  // The cost-weight bar tints each step relative to the heaviest step in the (full) run, so the
  // expensive step pops (Braintrust "weight by cost"). Computed once over all steps, not per-row DOM.
  const maxWeight = useMemo(
    () => logicalSteps.reduce((max, step) => Math.max(max, stepWeight(step)), 0),
    [logicalSteps],
  );

  // Facet option lists derive from the present data so only types/servers that exist are offered.
  const typeOptions = useMemo(() => {
    const present = new Set(logicalSteps.map((step) => step.type));
    return [...present].map((type) => ({ label: stepTypeMeta(type).label, value: type }));
  }, [logicalSteps]);

  const serverOptions = useMemo(() => {
    const names = new Set<string>();
    for (const step of logicalSteps) if (step.serverId) names.add(step.serverId);
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ label: name, value: name }));
  }, [logicalSteps]);

  // Facets + search cascade: a row must pass every active filter.
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return logicalSteps.filter((step) => {
      if (typeFacet.length > 0 && !typeFacet.includes(step.type)) return false;
      if (serverFacet.length > 0 && !(step.serverId && serverFacet.includes(step.serverId)))
        return false;
      if (errorsOnly.length > 0 && step.status !== "error") return false;
      if (needle.length > 0 && !searchHaystack(step).includes(needle)) return false;
      return true;
    });
  }, [logicalSteps, typeFacet, serverFacet, errorsOnly, needle]);

  // Observability (WP 3.2) — a FLAT run (every step persisted before WP3.1, or an executor that
  // never emits `parentStepId`) renders the ORIGINAL DataTable branch below, byte-for-byte unchanged.
  const hasHierarchy = useMemo(() => hasStepHierarchy(steps), [steps]);

  // Observability (WP 3.4) — "Filtered only" restricts the TREE branch to rows matching the
  // console-header search on top of the local facets/search above (the SAME `searchHaystack` — one
  // haystack, two callers). "Show all" (or no highlight query) leaves membership untouched; the tree
  // then only HIGHLIGHTS matches (`StepTreeRowLabel`). Never applied to the flat DataTable branch.
  const treeSourceSteps = useMemo(() => {
    if (!hasHighlight || effectiveMatchFilterMode !== "filtered") return filtered;
    return filtered.filter((step) => searchHaystack(step).includes(highlightNeedle));
  }, [filtered, hasHighlight, effectiveMatchFilterMode, highlightNeedle]);

  const columns = useMemo(
    () => [
      // `#` — the per-run ordinal (1-based). Numeric so the table sorts it numerically.
      col<RunStep>({
        id: "index",
        header: "#",
        numeric: true,
        value: (row) => row.index + 1,
      }),
      // Type — DevTools-style icon; the type label is the accessible name + tooltip.
      col<RunStep>({
        id: "type",
        header: "Type",
        value: (row) => stepTypeMeta(row.type).label,
        cell: (row) => {
          const meta = stepTypeMeta(row.type);
          const Icon = meta.Icon;
          return (
            <span className="flex items-center gap-1.5" title={meta.label}>
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <Text variant="meta" tone="muted" as="span" className="truncate">
                {meta.label}
              </Text>
            </span>
          );
        },
      }),
      // Label — model or tool name; the clickable cell that selects the row (no whole-row onClick prop
      // on DataTable, so the affordance lives on a real `Button`, matching ScansView).
      col<RunStep>({
        id: "label",
        header: "Step",
        value: (row) => stepLabel(row),
        cell: (row) => {
          const selected = selectedStepId === row.id;
          return (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-auto w-full min-w-0 justify-start px-1.5 py-1 text-left font-medium",
                selected && "bg-accent text-accent-foreground",
              )}
              onClick={() => onSelectStep(selected ? null : row.id)}
              aria-pressed={selected}
              title={stepLabel(row)}
            >
              <span className="truncate">{stepLabel(row)}</span>
            </Button>
          );
        },
      }),
      col<RunStep>({
        id: "status",
        header: "Status",
        value: (row) => row.status,
        cell: (row) => (
          <StatusBadge status={stepBrandStatus(row.status)} size="sm">
            {deriveStatusView(row.status).label}
          </StatusBadge>
        ),
      }),
      col<RunStep>({
        id: "tokensUp",
        header: "Tokens ↑",
        numeric: true,
        value: (row) => tokensUp(row),
      }),
      col<RunStep>({
        id: "tokensDown",
        header: "Tokens ↓",
        numeric: true,
        value: (row) => tokensDown(row),
      }),
      col<RunStep>({
        id: "duration",
        header: "Duration",
        numeric: true,
        value: (row) => row.durationMs ?? 0,
        cell: (row) => (
          <Text variant="meta" tone="muted" as="span" className="tabular-nums">
            {durationLabel(row.durationMs)}
          </Text>
        ),
      }),
      // Cost-weight — a thin `Progress` tinted by the step's tokens relative to the run's heaviest
      // step. Pure CSS width (no DOM measurement); makes the expensive step pop at a glance.
      col<RunStep>({
        id: "weight",
        header: "Weight",
        numeric: true,
        value: (row) => stepWeight(row),
        cell: (row) => {
          const weight = stepWeight(row);
          const pct = maxWeight > 0 ? (weight / maxWeight) * 100 : 0;
          return (
            <span
              className="flex items-center justify-end gap-2"
              title={`${formatNumber(weight)} tokens`}
            >
              <Progress
                value={pct}
                className="h-1.5 w-16"
                aria-label={`Relative token weight ${Math.round(pct)} percent`}
              />
            </span>
          );
        },
      }),
    ],
    [maxWeight, onSelectStep, selectedStepId],
  );

  if (hasHierarchy) {
    return (
      <StepTree
        rawSteps={steps}
        filteredSteps={treeSourceSteps}
        logicalSteps={logicalSteps}
        selectedStepId={selectedStepId}
        onSelectStep={onSelectStep}
        kpiByStepId={kpiByStepId}
        costBasis={costBasis}
        search={search}
        onSearchChange={setSearch}
        typeOptions={typeOptions}
        typeFacet={typeFacet}
        onTypeFacetChange={setTypeFacet}
        serverOptions={serverOptions}
        serverFacet={serverFacet}
        onServerFacetChange={setServerFacet}
        errorsOnly={errorsOnly}
        onErrorsOnlyChange={setErrorsOnly}
        highlightQuery={hasHighlight ? highlightQuery : ""}
        matchFilterMode={effectiveMatchFilterMode}
        onMatchFilterModeChange={setMatchFilterMode}
      />
    );
  }

  return (
    <DataTable
      data={filtered}
      columns={columns}
      // Virtualize rather than paginate — the log can grow large and live, and rapid scroll must stay
      // smooth (Acceptance: smooth at 50+ steps). A fixed scroll height keeps it within the right pane.
      enableRowVirtualization
      estimateRowHeight={44}
      maxBodyHeight="22rem"
      initialView={{ sorting: [{ id: "index", desc: false }] }}
      emptyMessage={
        logicalSteps.length === 0
          ? "No steps yet — the log fills as the run streams."
          : "No steps match the current filter."
      }
      toolbar={(table) => (
        <FilterBar actions={<ColumnPicker table={table} />}>
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search steps & payloads…"
            label="Search steps"
          />
          {typeOptions.length > 0 ? (
            <FacetFilter
              title="Type"
              options={typeOptions}
              selected={typeFacet}
              onSelectedChange={setTypeFacet}
            />
          ) : null}
          {serverOptions.length > 0 ? (
            <FacetFilter
              title="Server"
              options={serverOptions}
              selected={serverFacet}
              onSelectedChange={setServerFacet}
            />
          ) : null}
          <FacetFilter
            title="Errors"
            options={[{ label: "Errors only", value: "error" }]}
            selected={errorsOnly}
            onSelectedChange={setErrorsOnly}
          />
        </FilterBar>
      )}
    />
  );
}

// ── Observability (WP 3.2) — the tree branch ────────────────────────────────────────────────────────

type StepTreeProps = {
  /** The RAW (pre-de-dup) steps — needed only to resolve a `tool_io` child's reparenting. */
  rawSteps: RunStep[];
  /** The already search/facet-FILTERED, de-duped steps the tree is built from. */
  filteredSteps: RunStep[];
  /** The full de-duped (unfiltered) list — economics are derived over the whole run. */
  logicalSteps: RunStep[];
  selectedStepId: string | null;
  onSelectStep: (stepId: string | null) => void;
  kpiByStepId: ReadonlyMap<string, StepCumulativeKpi> | null;
  costBasis: SessionCostBasis | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  typeOptions: { label: string; value: string }[];
  typeFacet: string[];
  onTypeFacetChange: (value: string[]) => void;
  serverOptions: { label: string; value: string }[];
  serverFacet: string[];
  onServerFacetChange: (value: string[]) => void;
  errorsOnly: string[];
  onErrorsOnlyChange: (value: string[]) => void;
  /** Observability (WP 3.4) — the console-header search integration; see `StepLogProps`. */
  highlightQuery: string;
  matchFilterMode: "filtered" | "all";
  onMatchFilterModeChange: (mode: "filtered" | "all") => void;
};

function StepTree({
  rawSteps,
  filteredSteps,
  logicalSteps,
  selectedStepId,
  onSelectStep,
  kpiByStepId,
  costBasis,
  search,
  onSearchChange,
  typeOptions,
  typeFacet,
  onTypeFacetChange,
  serverOptions,
  serverFacet,
  onServerFacetChange,
  errorsOnly,
  onErrorsOnlyChange,
  highlightQuery,
  matchFilterMode,
  onMatchFilterModeChange,
}: StepTreeProps) {
  const treeRoots = useMemo(
    () => buildStepTree(filteredSteps, rawSteps),
    [filteredSteps, rawSteps],
  );
  const defaultCollapsed = useMemo(() => defaultCollapsedStepIds(treeRoots), [treeRoots]);
  const allExpandableIds = useMemo(() => expandableStepIds(treeRoots), [treeRoots]);

  // Explicit per-id EXPANDED overrides from user toggles; a node absent from this map falls back to
  // its own computed default — so a node that arrives LATER (a streaming run) always gets its own
  // correct default, never silently forced closed by a stale "expand everything I knew about" list.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // While actively filtering, force every match's ancestor chain open — a filter that hid a matching
  // CHILD behind a collapsed parent would be worse than useless. Collapse state is UI-only and this
  // never mutates `overrides`, so clearing the filter restores exactly what the user had before.
  // Observability (WP 3.4) — the console-header search's "Filtered only" mode ALSO narrows
  // `filteredSteps` (in the parent `StepLog`), so it counts here too; "Show all" leaves membership
  // untouched, so it does NOT force an expansion the operator didn't ask for.
  const isFiltering =
    search.trim().length > 0 ||
    typeFacet.length > 0 ||
    serverFacet.length > 0 ||
    errorsOnly.length > 0 ||
    (highlightQuery.length > 0 && matchFilterMode === "filtered");

  const expandedIds = useMemo(() => {
    if (isFiltering) return allExpandableIds;
    return allExpandableIds.filter((id) => overrides[id] ?? !defaultCollapsed.has(id));
  }, [allExpandableIds, overrides, defaultCollapsed, isFiltering]);

  const handleExpandedChange = useCallback(
    (ids: string[]) => {
      const nextSet = new Set(ids);
      setOverrides((prev) => {
        const next = { ...prev };
        for (const id of allExpandableIds) next[id] = nextSet.has(id);
        return next;
      });
    },
    [allExpandableIds],
  );

  const perStepEconomics = useMemo(
    () => derivePerStepEconomics(logicalSteps, kpiByStepId),
    [logicalSteps, kpiByStepId],
  );
  const childrenMap = useMemo(() => childrenByParentId(treeRoots), [treeRoots]);

  const nodes = useMemo<TreeNode<RunStep>[]>(
    () =>
      treeRoots.map((node) =>
        toTreeNode(node, perStepEconomics, childrenMap, costBasis, highlightQuery),
      ),
    [treeRoots, perStepEconomics, childrenMap, costBasis, highlightQuery],
  );

  const selectedIds = useMemo(() => (selectedStepId ? [selectedStepId] : []), [selectedStepId]);
  const handleSelectionChange = useCallback(
    (ids: string[]) => onSelectStep(ids[0] ?? null),
    [onSelectStep],
  );

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        actions={
          // Observability (WP 3.4) — the "Filtered only"/"Show all" toggle (LangSmith's in-trace
          // pattern), shown ONLY while the console-header search has an active query. `type="single"`
          // Radix toggle groups CAN emit an empty string when the pressed item is clicked again; that
          // would clear the selection entirely, so an empty next value is ignored (always exactly one
          // of the two stays pressed).
          highlightQuery.length > 0 ? (
            <ToggleGroup
              type="single"
              variant="segmented"
              size="sm"
              value={matchFilterMode}
              onValueChange={(next) => {
                if (next === "filtered" || next === "all") onMatchFilterModeChange(next);
              }}
              aria-label="Step log match filter"
            >
              <ToggleGroupItem value="filtered" aria-label="Filtered only — hide non-matching steps">
                Filtered only
              </ToggleGroupItem>
              <ToggleGroupItem value="all" aria-label="Show all — highlight matches without hiding">
                Show all
              </ToggleGroupItem>
            </ToggleGroup>
          ) : undefined
        }
      >
        <SearchInput
          value={search}
          onValueChange={onSearchChange}
          placeholder="Search steps & payloads…"
          label="Search steps"
        />
        {typeOptions.length > 0 ? (
          <FacetFilter
            title="Type"
            options={typeOptions}
            selected={typeFacet}
            onSelectedChange={onTypeFacetChange}
          />
        ) : null}
        {serverOptions.length > 0 ? (
          <FacetFilter
            title="Server"
            options={serverOptions}
            selected={serverFacet}
            onSelectedChange={onServerFacetChange}
          />
        ) : null}
        <FacetFilter
          title="Errors"
          options={[{ label: "Errors only", value: "error" }]}
          selected={errorsOnly}
          onSelectedChange={onErrorsOnlyChange}
        />
      </FilterBar>
      {treeRoots.length === 0 ? (
        <EmptyState
          icon={<ListTree aria-hidden />}
          title={logicalSteps.length === 0 ? "No steps yet" : "No steps match the current filter"}
          description={
            logicalSteps.length === 0
              ? "The log fills as the run streams."
              : "Try a different search term or clear a filter."
          }
        />
      ) : (
        // NOT virtualized (`Tree`'s `virtualize` windows the DOM for >50-row trees via
        // `@tanstack/react-virtual`, which needs a REAL measured viewport — unlike the flat
        // `DataTable` branch's row count, a step tree is bounded by the run's step count, typically
        // well under that threshold). Bounded + scrollable instead, matching the flat branch's own
        // `maxBodyHeight="22rem"` budget.
        <div className="max-h-[22rem] overflow-y-auto rounded-md border border-border">
          <Tree
            nodes={nodes}
            expandedIds={expandedIds}
            onExpandedChange={handleExpandedChange}
            selectionMode="single"
            selectedIds={selectedIds}
            onSelectionChange={handleSelectionChange}
            aria-label="Run steps"
            className="p-1"
          />
        </div>
      )}
    </div>
  );
}

/** Build one `@elabs-ai/components-ui` `TreeNode` per step, recursively — the icon slot carries the span-kind/type
 *  icon, the label slot carries the compact economics row (status + token/cost/duration chips, rolled
 *  up over the subtree via `rollupSubtreeEconomics`). */
function toTreeNode(
  node: StepTreeNode,
  perStepEconomics: ReadonlyMap<string, StepEconomics>,
  childrenMap: ReadonlyMap<string, string[]>,
  costBasis: SessionCostBasis | undefined,
  highlightQuery: string,
): TreeNode<RunStep> {
  const { step } = node;
  const meta = spanOrTypeMeta(step);
  const rollup = rollupSubtreeEconomics(step.id, childrenMap, perStepEconomics);
  return {
    id: step.id,
    icon: <meta.Icon aria-hidden />,
    label: (
      <StepTreeRowLabel step={step} econ={rollup} costBasis={costBasis} highlightQuery={highlightQuery} />
    ),
    children:
      node.children.length > 0
        ? node.children.map((child) =>
            toTreeNode(child, perStepEconomics, childrenMap, costBasis, highlightQuery),
          )
        : undefined,
    data: step,
  };
}

/** Whether a cost-delta chip is honest to show for this basis (never anything for a costless run). */
function showsCostChip(econ: StepEconomics, costBasis: SessionCostBasis | undefined): boolean {
  return econ.costUsdDelta > 0 && costBasis !== "none";
}

/** One tree row's content: the step's label (left, truncating) + status/economics chips (right). */
function StepTreeRowLabel({
  step,
  econ,
  costBasis,
  highlightQuery,
}: {
  step: RunStep;
  econ: StepEconomics;
  costBasis: SessionCostBasis | undefined;
  /** Observability (WP 3.4) — the console-header search query; empty when no search is active. */
  highlightQuery: string;
}) {
  const label = stepLabel(step);
  const needle = highlightQuery.trim().toLowerCase();
  const hasHighlight = needle.length > 0;
  const labelMatches = hasHighlight && label.toLowerCase().includes(needle);
  // The row can match on its PAYLOAD (a tool's args/result) even when the visible label doesn't
  // literally contain the query — surface that honestly with a small icon rather than fabricating a
  // highlight location that doesn't exist.
  const matchesElsewhere = hasHighlight && !labelMatches && searchHaystack(step).includes(needle);
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 truncate" title={label}>
        {hasHighlight ? <HighlightMatch text={label} query={highlightQuery} /> : label}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {matchesElsewhere ? (
          <span title="Matches the search in its payload">
            <SearchIcon aria-hidden className="size-3.5 text-muted-foreground" />
          </span>
        ) : null}
        <StatusBadge status={stepBrandStatus(step.status)} size="sm">
          {deriveStatusView(step.status).label}
        </StatusBadge>
        {econ.tokensInDelta > 0 ? (
          <Text as="span" variant="meta" tone="muted" className="tabular-nums">
            {formatNumber(econ.tokensInDelta)}↑
          </Text>
        ) : null}
        {econ.tokensOutDelta > 0 ? (
          <Text as="span" variant="meta" tone="muted" className="tabular-nums">
            {formatNumber(econ.tokensOutDelta)}↓
          </Text>
        ) : null}
        {showsCostChip(econ, costBasis) ? (
          <Text as="span" variant="meta" tone="muted" className="tabular-nums">
            {formatCostUsd(econ.costUsdDelta)}
            {costBasis === "subscription_reference" ? " est." : ""}
          </Text>
        ) : null}
        {econ.durationMs != null ? (
          <Text as="span" variant="meta" tone="muted" className="tabular-nums">
            {durationLabel(econ.durationMs)}
          </Text>
        ) : null}
      </span>
    </span>
  );
}
