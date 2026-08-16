import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { RunFilter, RunGrade, RunSummary, Scenario, Test } from "@mcp-token-footprint/shared";
import { serializeRunFilter } from "@mcp-token-footprint/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Toggle,
  toast,
  useIsMobile,
} from "@brand/ui";
import { FacetFilter, SearchInput } from "@brand/data";
import { ClipboardCheck, GitCompareArrows, GitFork, Layers, PlayCircle, Plus } from "lucide-react";
import { deleteRun, deleteSuiteRun, getRunGrades, listServers, listSkills, pinRun, unpinRun } from "../../lib/api";
import { formatCostUsd, formatDateTime, formatNumber, formatPercent, formatRelativeTime } from "../../lib/format";
import { getErrorMessage } from "../../lib/errors";
import { deriveRunStatusView } from "../../lib/status";
import { KpiStat } from "../../components/KpiStat";
import { PageShell } from "../../components/PageShell";
import { ResultCount } from "../../components/ResultCount";
import { ViewToolbar } from "../../components/ViewToolbar";
import { pickBaseVerdictEvidence, pickPrimaryGrade } from "./grade-format";
import { runStatusBadgeStatus } from "./RunBar";
import { RunLauncher, type RunLauncherIntent } from "./run-launcher/RunLauncher";
import { EMPTY_RUN_FILTER_OPTIONS, RunFilterBar, type RunFilterOptionData } from "./runs/RunFilterBar";
import { type FeedItem, type FeedSuiteItem, type RunsFeedData, loadRunsFeed } from "./runs/runs-api";
import {
  isEmptyRunFilter,
  parseFilterFromSearchParams,
  writeFilterToSearchParams,
} from "./runs/run-filter-url";
import {
  DEFAULT_RUN_COLUMNS_PREFERENCE,
  type RunColumnsPreference,
  type RunTableColumnKey,
  toVisibleColumnSet,
  runTableColumnCount,
} from "./runs/run-columns";
import { RunColumnChooser } from "./runs/RunColumnChooser";
import { RunSavedViews, type AppliedRunView } from "./runs/RunSavedViews";
import { RunsCompareBar } from "./runs/RunsCompareBar";
import { SessionDurationStats } from "./runs/SessionDurationStats";
import { RunsTableHead } from "./runs/RunsTableHead";
import { RunSummaryCard, RunTableRow } from "./runs/RunTableRow";
import { SuiteTableRows, suiteDisplayName } from "./runs/SuiteTableRows";
import { suiteStatusBadge } from "./suites/SuiteRunConsole";
import { SuitesView } from "./suites/SuitesView";
import {
  type GroupBy,
  GROUP_BY_OPTIONS,
  type RunsTableFilters,
  type RunsTableGroup,
  type RunsTotals,
  type SortDir,
  type SortKey,
  type TopRowVM,
  TYPE_FACETS,
  filterRows,
  groupRows,
  shouldShowGradeColumn,
  sortRows,
  summarizeRows,
} from "./runs/runs-table-model";
import { notifyError } from "../../lib/notify";

/** The two peer surfaces of the Runs section (toolbar-reach WP 4.3 · B-6). */
type FeedTab = "runs" | "suites";

/**
 * The Runs section shell (toolbar-reach WP 4.3 · finding B-6 — "if an operator can't find a feature
 * without knowing its URL, it isn't shipped").
 *
 * The runs feed and the suite catalog are two peers of one testing surface, but **Suites** — a
 * first-class data-model concept — was previously reachable ONLY by drilling through a run. Rather
 * than add a fifth nav item (the 4-item Testing nav is a hard-won simplification), Suites gets a
 * sibling tab here, surfaced where the work already is (the runs feed is where suite runs surface).
 *
 * The active tab rides in the URL as `?feed=suites` — the same `?tab=`-style deep-link idiom the app
 * already uses (e.g. Workforce `?tab=usage`) — so the Suites view is bookmarkable, while the bare
 * `/testing/runs` (zero query params) still renders the runs feed usefully (D-TB10). Each tab hosts
 * its OWN page frame: the runs feed keeps its `scroll="fill"` table contract untouched (in
 * {@link RunsFeedPanel}); the Suites catalog reuses {@link SuitesView} verbatim inside a scroll
 * frame. Only the active tab is mounted (Radix unmounts the other), so switching to Suites tears
 * down the runs feed's fetches and vice-versa.
 */
export function RunsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const feed: FeedTab = searchParams.get("feed") === "suites" ? "suites" : "runs";
  const setFeed = useCallback(
    (next: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          // "runs" is the param-less default (clean URL); only "suites" is persisted.
          if (next === "suites") params.set("feed", "suites");
          else params.delete("feed");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <Tabs
      value={feed}
      onValueChange={setFeed}
      className="flex h-full min-h-0 w-full flex-col bg-background"
    >
      {/* The peer-tab strip — a compact command bar mirroring the toolbar header's lift (`bg-card`),
          pinned above whichever feed is active so switching tabs moves nothing above the content. */}
      <div className="flex shrink-0 items-center border-b border-border bg-card px-4 py-2 min-[1200px]:px-8">
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="suites">Suites</TabsTrigger>
        </TabsList>
      </div>
      {/* Only the active tab mounts (Radix default). `mt-0` cancels the brand default top margin so
          the strip→content offset is the sole gap; each panel then owns its own scroll contract. */}
      <TabsContent
        value="runs"
        className="mt-0 flex min-h-0 flex-1 flex-col focus-visible:outline-none"
      >
        <RunsFeedPanel />
      </TabsContent>
      <TabsContent
        value="suites"
        className="mt-0 flex min-h-0 flex-1 flex-col focus-visible:outline-none"
      >
        {/* The suites catalog verbatim (B-6) — a first-class surface, no longer reachable only by
            drilling through a run. `SuitesView` renders its own list with zero params, wrapped here
            in a `scroll="content"` frame so it gets the same gutter + scroll region as any page. */}
        <PageShell width="full" scroll="content">
          <SuitesView />
        </PageShell>
      </TabsContent>
    </Tabs>
  );
}

/**
 * The unified Runs feed (Runs-table rebuild · WP 2.4; the RunFilter-bound query surface · WP 2.3). ONE
 * interactive, sortable / searchable / groupable table carries BOTH standalone single runs AND suite
 * runs, on the shared `PageShell` (full-width catalog archetype). Name (left) and Actions (right) are
 * PINNED so drill-in and identity stay on screen while a genuinely-wide table scrolls horizontally
 * inside its own region (S2); the whole row opens the run/suite console (T1). Suite runs are
 * collapsible summary rows that expand to their KPI rail (pinned to the viewport width, T2) + member
 * rows — this expansion is UNFILTERED (WP2.3: a filter never truncates a suite's drill-down, see
 * `runs-api.ts`'s `buildRunsFeed` doc). The single one-row `ViewToolbar` (toolbar standard 2026-07-11,
 * D-TB2) carries the WP2.3 `RunFilterBar` (URL-persisted via `?filter=`, the SAME shared
 * `serializeRunFilter`/`parseRunFilter` helper the WP2.2 dashboard drill-down links build with) +
 * search (`RunFilter.q`, FTS-snippeted) + saved views (presets + `run_views` CRUD) + a Type facet (row
 * shape has no RunFilter equivalent) + a row-count chip on the left, and the column chooser + Group by
 * + Compare runs + New run on the right; a totals strip above the table monitors spend / tokens /
 * failure rate for the current filter (G8). Single or member runs multi-select into the Compare bar;
 * suite runs multi-select for suite comparison (feeds WP 4.6).
 *
 * Data is assembled client-side from the existing endpoints via {@link loadRunsFeed} (which ALSO takes
 * the active `RunFilter` — WP2.3, no new endpoint, just the already-merged `GET /api/runs?filter=…`);
 * the sort / group / Type-facet logic lives in the pure {@link ./runs/runs-table-model}.
 *
 * Rendered inside the {@link RunsView} shell as the "Runs" peer tab; the "Suites" peer mounts the
 * existing {@link SuitesView} verbatim (toolbar-reach WP 4.3 · B-6).
 */
function RunsFeedPanel() {
  const navigate = useNavigate();
  // P0 mobile audit T4 (2026-07-25 critique) — below 768px the wide interactive table (11+ columns,
  // sticky-pinned Name/Actions) doesn't fit a phone; see the `isMobile` branch further down.
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<RunsFeedData | null>(null);
  const [gradesByRun, setGradesByRun] = useState<Map<string, RunGrade[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded suite-run summary rows + the two multi-select sets (single/member runs → Compare;
  // suite runs → suite comparison, WP 4.6).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [selectedSuiteRunIds, setSelectedSuiteRunIds] = useState<Set<string>>(new Set());

  // The two-path run launcher — the ONE "New run" entry (and per-suite / per-test re-runs) from here.
  const [launcher, setLauncher] = useState<{ open: boolean; intent: RunLauncherIntent }>({
    open: false,
    intent: { kind: "choose" },
  });

  // A-2 (toolbar-reach WP0.2) — the ONE param-less new-run entry. `⌘K → "New run"` and a bookmark/back
  // to `/testing/runs/new` now redirect here with `?launch=1` (instead of the old "Run unavailable"
  // dead-end in `RunConsoleRoute`); consume the flag ONCE to open the existing two-path launcher, then
  // strip `launch` from the URL (preserving any RunFilter params) so a reload/close doesn't reopen it.
  useEffect(() => {
    if (searchParams.get("launch") !== "1") return;
    setLauncher({ open: true, intent: { kind: "choose" } });
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("launch");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // Observability WP2.3 — the RunFilter-bound query surface. `filter` is the SOLE source of truth for
  // status/outcome/model/server/environment/suite/skill/date/score/cost/duration/pinned/interactive/
  // feedback/search (`q`); it round-trips through the URL's `filter=` param via the shared
  // serialize/parse helper, so a WP2.2 dashboard drill-down link (or a bookmark) hydrates the bar
  // exactly. `typeFacet` (single vs. suite ROW SHAPE) has no RunFilter equivalent — it stays a small
  // client-side facet on top, applied to the already-filtered feed by `runs-table-model.ts`.
  const filter = useMemo(() => parseFilterFromSearchParams(searchParams), [searchParams]);
  const setFilter = useCallback(
    (next: RunFilter) => {
      setSearchParams((current) => writeFilterToSearchParams(current, next), { replace: true });
    },
    [setSearchParams],
  );
  const [typeFacet, setTypeFacet] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [sortKey, setSortKey] = useState<SortKey>("started");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Saved views (WP2.3) — which preset/persisted view is currently applied (for the picker's highlight
  // + "Update"/"Delete" availability); column visibility + the preview-cell content source, restored by
  // applying a view and captured when saving one.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [columnsPreference, setColumnsPreference] = useState<RunColumnsPreference>(
    DEFAULT_RUN_COLUMNS_PREFERENCE,
  );
  const visibleColumns = useMemo(
    () => toVisibleColumnSet(columnsPreference.visible),
    [columnsPreference.visible],
  );
  // Which standalone run's preview disclosure is open — one at a time, closes on reload/filter change.
  const [previewOpenRunId, setPreviewOpenRunId] = useState<string | null>(null);

  // The filter bar's dynamic (id-valued) option lists — models/environments come from already-loaded
  // scenario data; servers + skills are a lightweight extra fetch (no new endpoint, existing routes).
  const [servers, setServers] = useState<RunFilterOptionData["servers"]>([]);
  const [skills, setSkills] = useState<RunFilterOptionData["skills"]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all([listServers(), listSkills()])
      .then(([serverList, skillList]) => {
        if (!active) return;
        setServers(serverList.map((s) => ({ value: s.id, label: s.name })));
        setSkills(skillList.map((s) => ({ value: s.id, label: s.displayName || s.name })));
      })
      .catch(() => {
        // Best-effort — the filter bar just shows fewer options for these two dynamic fields.
      });
    return () => {
      active = false;
    };
  }, []);
  const filterOptions = useMemo<RunFilterOptionData>(() => {
    if (!data) return EMPTY_RUN_FILTER_OPTIONS;
    const environments = data.scenarios
      .map((s) => ({ value: s.id, label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const models = [...new Set(data.scenarios.map((s) => s.model).filter((m): m is string => !!m))]
      .sort((a, b) => a.localeCompare(b))
      .map((m) => ({ value: m, label: m }));
    const suites = data.suites
      .map((s) => ({ value: s.id, label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { environments, models, servers, suites, skills };
  }, [data, servers, skills]);

  // The table's horizontal-scroll box. We CAP its width to the space actually available to the right of
  // the sidebar (`innerWidth − box.left`) and let @brand/ui `Table`'s own `overflow-auto` wrapper scroll
  // the wide table INSIDE that cap — so the pinned Name (left) + Actions (right) columns stay on screen
  // at every width. Without the cap the table's natural (nowrap) min-content blows the box past the
  // viewport, because `@brand/ui` AppShell's content inset (`SidebarInset`) is a flex item WITHOUT
  // `min-width:0` (a shell-level gap — reported to the PM; a one-line `min-w-0` there removes the need
  // for this measurement). The same measured width pins the expanded suite KPI rail to the viewport (T2).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const left = el.getBoundingClientRect().left;
      // 8px breathing room on the right; never below a sane floor.
      setBoxWidth(Math.max(320, Math.round(window.innerWidth - left - 8)));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [loading, error]);

  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      setLoading(true);
      setError(null);
      try {
        const feed = await loadRunsFeed(filter);
        if (!isActive()) return;
        setData(feed);
      } catch (loadError) {
        if (isActive()) setError(getErrorMessage(loadError, "Couldn’t load runs."));
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    // A new query closes any open per-row preview (its row may no longer be in view).
    setPreviewOpenRunId(null);
    return () => {
      active = false;
    };
  }, [load]);

  // Standalone single runs (suite members roll up under their summary and are excluded here).
  const standaloneRuns = useMemo(
    () =>
      (data?.items ?? [])
        .filter((item): item is Extract<FeedItem, { kind: "run" }> => item.kind === "run")
        .map((item) => item.run),
    [data],
  );

  // Grade chips: fetch each STANDALONE run's latest-per-grader grades (best-effort). Suite rows show a
  // rolled-up pass rate instead, so member/suite grades aren't fetched here.
  useEffect(() => {
    if (standaloneRuns.length === 0) {
      setGradesByRun(new Map());
      return;
    }
    let active = true;
    void Promise.all(
      standaloneRuns.map((run) =>
        getRunGrades(run.id)
          .then((response) => [run.id, response.latest] as const)
          .catch(() => [run.id, [] as RunGrade[]] as const),
      ),
    ).then((entries) => {
      if (active) setGradesByRun(new Map(entries));
    });
    return () => {
      active = false;
    };
  }, [standaloneRuns]);

  // Every run in the feed (standalone + suite members) keyed by id — for resolving the comparison set's
  // shared test (Compare compares runs of ONE test across environments).
  const allRunsById = useMemo(() => {
    const map = new Map<string, RunSummary>();
    for (const item of data?.items ?? []) {
      if (item.kind === "run") map.set(item.run.id, item.run);
      else for (const member of item.members) map.set(member.id, member);
    }
    return map;
  }, [data]);

  const selectedTestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const runId of selectedRunIds) {
      const run = allRunsById.get(runId);
      if (run) ids.add(run.testId);
    }
    return ids;
  }, [selectedRunIds, allRunsById]);

  const canCompare = selectedRunIds.size >= 2 && selectedTestIds.size === 1;

  // Row id → the source FeedItem it renders from (`suite:<id>` keys the suite rows, run id the singles).
  const itemsById = useMemo(() => {
    const map = new Map<string, FeedItem>();
    for (const item of data?.items ?? []) {
      map.set(item.kind === "run" ? item.run.id : suiteRowId(item.suiteRun.id), item);
    }
    return map;
  }, [data]);

  // The top-level rows as sort/filter-ready primitives (members stay nested inside their FeedSuiteItem).
  const rows = useMemo<TopRowVM[]>(() => {
    if (!data) return [];
    return data.items.map((item) =>
      toTopRowVM(item, data.testsById, data.scenariosById, gradesByRun),
    );
  }, [data, gradesByRun]);

  // Everything except row TYPE (single vs. suite — no RunFilter equivalent) is now filtered
  // server-side via `filter` (WP2.3, `loadRunsFeed`); this stays a thin passthrough into the existing
  // `filterRows` pipeline so grouping/sorting/totals are unchanged.
  const filters: RunsTableFilters = useMemo(
    () => ({ search: "", types: typeFacet, statuses: [], environments: [], dateRange: undefined }),
    [typeFacet],
  );

  // Filter once — reused for the groups, the totals strip, and the "is the Grade column all-empty" test.
  const filteredRows = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const groups = useMemo(() => {
    const sorted = sortRows(filteredRows, sortKey, sortDir);
    return groupRows(sorted, groupBy);
  }, [filteredRows, sortKey, sortDir, groupBy]);

  const totals: RunsTotals = useMemo(() => summarizeRows(filteredRows), [filteredRows]);

  // Grade column dropped when NOTHING in view is graded (S9) — now on EITHER dimension (AR6): a run's
  // `gradeSort` is -1 ungraded, else 0–1 (single = primary score, suite = pass rate); `hasBaseVerdict`
  // is the SEPARATE base-rating signal (see `shouldShowGradeColumn`).
  const showGrade = useMemo(() => shouldShowGradeColumn(filteredRows), [filteredRows]);
  const colSpan = runTableColumnCount(showGrade, columnsPreference.visible);

  const visibleCount = totals.rows;

  // Bulk delete (multi-select). "Select all" targets the FILTERED top-level rows only: standalone
  // single runs (deleted via `deleteRun`) + suite runs (deleted via `deleteSuiteRun`, which unlinks
  // and KEEPS its member runs). A member run selected inside an expanded suite deletes as a single run.
  const selectableRunIds = useMemo(
    () => filteredRows.filter((r) => r.kind === "run").map((r) => r.id),
    [filteredRows],
  );
  const selectableSuiteRunIds = useMemo(
    () => filteredRows.filter((r) => r.kind === "suite").map((r) => r.id.slice("suite:".length)),
    [filteredRows],
  );
  const totalSelectable = selectableRunIds.length + selectableSuiteRunIds.length;
  const allSelected =
    totalSelectable > 0 &&
    selectableRunIds.every((id) => selectedRunIds.has(id)) &&
    selectableSuiteRunIds.every((id) => selectedSuiteRunIds.has(id));
  const anySelected = selectedRunIds.size > 0 || selectedSuiteRunIds.size > 0;
  const selectedCount = selectedRunIds.size + selectedSuiteRunIds.size;

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleAllSelected = useCallback(
    (on: boolean) => {
      setSelectedRunIds(on ? new Set(selectableRunIds) : new Set());
      setSelectedSuiteRunIds(on ? new Set(selectableSuiteRunIds) : new Set());
    },
    [selectableRunIds, selectableSuiteRunIds],
  );

  const performBulkDelete = useCallback(async () => {
    const runIds = [...selectedRunIds];
    const suiteRunIds = [...selectedSuiteRunIds];
    setBulkDeleteOpen(false);
    if (runIds.length === 0 && suiteRunIds.length === 0) return;
    setDeleting(true);
    try {
      const results = await Promise.allSettled([
        ...runIds.map((id) => deleteRun(id)),
        ...suiteRunIds.map((id) => deleteSuiteRun(id)),
      ]);
      const failed = results.filter((r) => r.status === "rejected").length;
      const total = results.length;
      const ok = total - failed;
      if (failed === 0) {
        toast.success(`Deleted ${ok} run${ok === 1 ? "" : "s"}`);
      } else {
        notifyError(`Couldn’t delete ${failed} of ${total} runs.`, {
          description: `The other ${ok} were deleted. Try again for the rest.`,
        });
      }
      setSelectedRunIds(new Set());
      setSelectedSuiteRunIds(new Set());
      await load();
    } finally {
      setDeleting(false);
    }
  }, [selectedRunIds, selectedSuiteRunIds, load]);

  const toggleRunSelected = useCallback((runId: string, on: boolean) => {
    setSelectedRunIds((current) => {
      const next = new Set(current);
      if (on) next.add(runId);
      else next.delete(runId);
      return next;
    });
  }, []);

  const toggleSuiteSelected = useCallback((suiteRunId: string, on: boolean) => {
    setSelectedSuiteRunIds((current) => {
      const next = new Set(current);
      if (on) next.add(suiteRunId);
      else next.delete(suiteRunId);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((rowId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  const onSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(NUMERIC_SORT_KEYS.has(key) ? "desc" : "asc");
      }
    },
    [sortKey],
  );

  const openRunById = useCallback(
    (runId: string) => navigate(`/testing/runs/${runId}`),
    [navigate],
  );

  // Observability WP2.3 — retention pin (WP1.6 API), wired here for the first time. Optimistic: the
  // row flips immediately; a failure reverts it and surfaces a toast (never a silent drop).
  const togglePinned = useCallback(async (run: RunSummary, next: boolean) => {
    setData((current) => (current ? withPinnedRun(current, run.id, next) : current));
    try {
      const result = next ? await pinRun(run.id) : await unpinRun(run.id);
      setData((current) => (current ? withPinnedRun(current, run.id, result.pinned) : current));
    } catch (pinError) {
      setData((current) => (current ? withPinnedRun(current, run.id, !next) : current));
      notifyError(next ? "Couldn’t pin the run." : "Couldn’t unpin the run.", {
        description: `${getErrorMessage(pinError)} Try again.`,
      });
    }
  }, []);

  // Apply a saved view / preset (WP2.3): replaces the filter (→ URL, re-fetches) and restores its
  // columns + sort presentation hints wholesale.
  const applyView = useCallback(
    (view: AppliedRunView) => {
      setFilter(view.filter);
      setColumnsPreference(view.columns);
      const sort = parseViewSort(view.sort);
      if (sort) {
        setSortKey(sort.key);
        setSortDir(sort.dir);
      }
      setActiveViewId(view.id);
    },
    [setFilter],
  );

  const openExistingRun = useCallback(
    (run: RunSummary) => {
      const test = data?.testsById.get(run.testId);
      const scenario = data?.scenariosById.get(run.scenarioId);
      if (!test || !scenario) {
        notifyError("Couldn’t open the run.", {
          description: "The test or environment this run used no longer exists. Try a different run.",
        });
        return;
      }
      navigate(`/testing/runs/${run.id}`);
    },
    [navigate, data],
  );

  const rerunTest = useCallback((run: RunSummary) => {
    setLauncher({ open: true, intent: { kind: "tests", testIds: [run.testId] } });
  }, []);

  const openCompare = useCallback(() => {
    const ids = [...selectedRunIds];
    if (ids.length < 2) return;
    navigate(`/testing/runs/compare?ids=${ids.join(",")}`);
  }, [navigate, selectedRunIds]);

  const openSuiteCompare = useCallback(() => {
    const ids = [...selectedSuiteRunIds];
    if (ids.length < 2) return;
    // Entry point for WP 4.6 suite-compare — the compare workspace consumes `suiteRunIds`.
    navigate(`/testing/runs/compare?suiteRunIds=${ids.join(",")}`);
  }, [navigate, selectedSuiteRunIds]);

  // Shared toolbar pieces (toolbar standard 2026-07-11, D-TB1/D-TB2/D-TB3). The description that used
  // to be an H1 sub-line now lives in the ⓘ info tooltip; the two always-present actions (Compare runs
  // + New run) are reused by the transitional header and the full filter toolbar (never both at once).
  const toolbarInfo = (
    <p className="max-w-xs text-pretty">
      Every instrumented session — single runs and suite runs in one table. Sort, search, filter,
      group, expand a suite to its stats, or select runs to compare.
    </p>
  );
  // D-UX3 / T9b — the restored visible front door for run comparison (the sidebar "Compare" is SCAN
  // compare; this is the Compare Workspace). The selection banner below still routes here with runs
  // pre-picked; this entry opens the workspace to choose a test + its runs.
  const compareRunsAction = (
    <Button variant="outline" onClick={() => navigate("/testing/runs/compare")}>
      <GitCompareArrows aria-hidden />
      <span>Compare runs</span>
    </Button>
  );
  const newRunAction = (
    <Button onClick={() => setLauncher({ open: true, intent: { kind: "choose" } })}>
      <Plus aria-hidden />
      <span>New run</span>
    </Button>
  );
  // P0 mobile audit T4 (2026-07-25 critique): measured "New run sits at x-right 671 in a 390px
  // viewport with no toolbar scroll — you cannot start a run on a phone at all." The toolbar row below
  // gets `overflow-x-auto` on mobile so every control is still reachable by a swipe, but New run —
  // the one action a phone user must always be able to reach without hunting — ALSO pins to the right
  // edge of that same scroll region via `sticky`, so it never depends on how far the row scrolls.
  // `bg-card` matches `PageShell`'s toolbar lift so scrolled-behind controls don't show through.
  const stickyNewRunAction = isMobile ? (
    <div className="sticky right-0 z-10 bg-card pl-2">{newRunAction}</div>
  ) : (
    newRunAction
  );
  // Observability WP4.5 (D-OB22) — the review queue's entry point: takes the ACTIVE filter (the SAME
  // `serializeRunFilter` round-trip every other RunFilter-bound link in this file uses) so the review
  // surface opens already scoped to what's on screen. Only in the full filter toolbar (unlike compare/
  // new-run, "review these" is meaningless before there's a filter/data context to scope it to).
  const reviewRunsAction = (
    <Button
      variant="outline"
      onClick={() => navigate(`/testing/review?filter=${serializeRunFilter(filter)}`)}
    >
      <ClipboardCheck aria-hidden />
      <span>Review these…</span>
    </Button>
  );
  // Loading / error / empty share a toolbar with only the actions — there is nothing to filter yet.
  const transitionalHeader = (
    <ViewToolbar
      info={toolbarInfo}
      className={isMobile ? "overflow-x-auto" : undefined}
      actions={
        <>
          {compareRunsAction}
          {stickyNewRunAction}
        </>
      }
    />
  );

  if (loading) {
    return (
      <PageShell headerVariant="toolbar" header={transitionalHeader}>
        <Heading level={1} className="sr-only">
          Runs
        </Heading>
        <StatePanel kind="loading" title="Loading runs…" loadingLabel="Loading runs…" />
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell headerVariant="toolbar" header={transitionalHeader}>
        <Heading level={1} className="sr-only">
          Runs
        </Heading>
        <StatePanel
          kind="error"
          title="Couldn’t load runs."
          description={error ?? "No run data available."}
          actions={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      </PageShell>
    );
  }

  const totalRows = data.items.length;
  const filterIsActive = !isEmptyRunFilter(filter);

  // A genuinely empty install (no filter narrowing anything) points at "New run"; an ACTIVE filter that
  // matches nothing gets its own honest empty state ("no runs match", never the misleading "New run"
  // pitch) with a one-click way back — interaction-guidelines "empty states".
  if (totalRows === 0 && !filterIsActive) {
    return (
      <PageShell headerVariant="toolbar" header={transitionalHeader}>
        <Heading level={1} className="sr-only">
          Runs
        </Heading>
        <RunLauncher
          open={launcher.open}
          onOpenChange={(open) => setLauncher((current) => ({ ...current, open }))}
          intent={launcher.intent}
        />
        <EmptyState
          icon={<PlayCircle aria-hidden />}
          title="No runs yet"
          description="Use New run to launch a suite or an interactive session. Finished runs appear here for replay, roll-up, and comparison."
          actions={
            <Button onClick={() => setLauncher({ open: true, intent: { kind: "choose" } })}>
              <Plus aria-hidden />
              <span>New run</span>
            </Button>
          }
        />
      </PageShell>
    );
  }

  // The full one-row filter toolbar (toolbar standard D-TB2): [search · saved views · Type · the
  // WP2.3 RunFilter bar · count] ····· [Columns · Group by · Compare runs · New run]. Defined here so
  // it can read `totalRows`/`visibleCount` (resolved only once real data exists).
  const header = (
    <ViewToolbar
      info={toolbarInfo}
      className={isMobile ? "overflow-x-auto" : undefined}
      left={
        // ≤1100px width discipline (WP TB.3a; interface-craft WP 0.4 / finding 2). The dense filter
        // cluster no longer fights `ViewToolbar` for layout — it is a plain list of top-level children,
        // so `ViewToolbar`'s OWN `left` cluster (`flex min-w-0 flex-wrap items-center gap-2`, D-TB7)
        // owns the wrap: below the cluster's fit width the row grows onto a second line instead of
        // hiding controls behind a `scrollbar-width:none` scroller with zero affordance (the finding 2
        // defect — 68% of this row, incl. the Type facet/Filter button/Show-forks toggle/count badge,
        // was invisible at 1100px with no scrollbar, fade, or peek to hint it was there). The search
        // still shrinks first to a legible floor (`min-w-[7rem]`) before anything wraps.
        <>
          <div className="w-56 min-w-[7rem] shrink">
            <SearchInput
              value={filter.q ?? ""}
              onValueChange={(value) =>
                setFilter({ ...filter, q: value.trim().length > 0 ? value : undefined })
              }
              placeholder="Search prompts, tools, errors…"
              label="Search runs"
            />
          </div>
          <RunSavedViews
            activeId={activeViewId}
            currentFilter={filter}
            currentColumns={columnsPreference}
            currentSort={{ key: sortKey, dir: sortDir }}
            onApply={applyView}
          />
          <FacetFilter
            title="Type"
            options={TYPE_FACETS}
            selected={typeFacet}
            onSelectedChange={setTypeFacet}
          />
          <RunFilterBar filter={filter} onChange={setFilter} options={filterOptions} />
          {/* Observability WP3.3 (D-OB18) — forks are HIDDEN by default; this reveals the derived
              (forked) runs. Backed by the shared `RunFilter.derived` flag (default-exclude). A pressed
              TOGGLE, not a `Button variant="default"` (interface-craft WP 0.4 / finding 2's pressed-
              toggle defect) — pressed reads as an accent fill + `border-primary` boundary
              (`toggleVariants`'s `data-[state=on]:bg-accent`), which stays visibly distinct from the
              solid `bg-primary` New-run action in the same row. */}
          <Toggle
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            pressed={filter.derived === true}
            onPressedChange={(pressed) =>
              setFilter({ ...filter, derived: pressed ? true : undefined })
            }
          >
            <GitFork className="size-4" aria-hidden />
            <span>Show forks</span>
          </Toggle>
          <ResultCount>
            {visibleCount === totalRows
              ? `${totalRows} row${totalRows === 1 ? "" : "s"}`
              : `${visibleCount} of ${totalRows} rows`}
          </ResultCount>
        </>
      }
      actions={
        <>
          <RunColumnChooser preference={columnsPreference} onChange={setColumnsPreference} />
          {/* Group by — the previously-floating control (D-TB2), now the leftmost toolbar action. The
              option labels are self-describing ("No grouping", "Group by type"), so no visible label. */}
          <Select value={groupBy} onValueChange={(value) => setGroupBy(value as GroupBy)}>
            <SelectTrigger aria-label="Group by" className="w-44 min-w-0">
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
          {reviewRunsAction}
          {compareRunsAction}
          {stickyNewRunAction}
        </>
      }
    />
  );

  return (
    // #5 — the Runs feed adopts the WP 6.1 `scroll="fill"` frame: the fixed chrome (the header toolbar
    // plus the totals + compare bar) stays put while ONLY the table body scrolls internally with a
    // sticky header, and the table reaches the viewport bottom instead of the whole content panel
    // scrolling. `contentClassName` supplies the 16px inter-block gap that fill mode doesn't add for us.
    <PageShell headerVariant="toolbar" header={header} scroll="fill" contentClassName="gap-4">
      {/* The breadcrumb (Home / Runs) names the page; keep an H1 for AT only (D-TB1). */}
      <Heading level={1} className="sr-only">
        Runs
      </Heading>

      <RunLauncher
        open={launcher.open}
        onOpenChange={(open) => setLauncher((current) => ({ ...current, open }))}
        intent={launcher.intent}
      />

      {/* Fixed chrome — the summary strip (content, shown once) + compare selection bar; never scrolls
          with the rows. Search / filters / group-by moved up into the one-row `ViewToolbar` (D-TB2). */}
      <div className="flex shrink-0 flex-col gap-4">
        <RunsTotalsStrip totals={totals} />

        {/* "Needs attention" is now a FILTERABLE property (owner-requested) — the dense table below is
            the primary, unobstructed view; use the "Needs attention" filter chip / saved-view preset to
            scope the feed to runs paused on you or unseen-not-running, instead of a forced card section. */}
        <RunsCompareBar
          runCount={selectedRunIds.size}
          canCompare={canCompare}
          multiTest={selectedRunIds.size >= 2 && selectedTestIds.size > 1}
          suiteCount={selectedSuiteRunIds.size}
          onCompareRuns={openCompare}
          onCompareSuites={openSuiteCompare}
          onClear={() => {
            setSelectedRunIds(new Set());
            setSelectedSuiteRunIds(new Set());
          }}
          onDelete={() => setBulkDeleteOpen(true)}
          deleting={deleting}
        />

        {/* Sessions lens (Observability WP 2.4) — per-environment active-duration p50/p95, above the
            table; renders nothing unless the active filter is `interactiveOnly` (e.g. the "Sessions"
            preset). */}
        <SessionDurationStats
          filter={filter}
          environmentLabel={(scenarioId) => data.scenariosById.get(scenarioId)?.name ?? scenarioId}
        />
      </div>

      {/* P0 mobile audit T4 (2026-07-25 critique): below 768px the wide interactive table (11+
          columns, sticky-pinned Name/Actions) doesn't fit a phone — measured "three consecutive rows
          read 'barc-flights' with nothing to distinguish them" once every other column scrolled out
          of reach. Below `md` the SAME `groups`/`itemsById`/`data`/`gradesByRun` render instead as one
          Card per run/suite (`MobileRunCards`); the desktop table below is UNCHANGED. */}
      {isMobile ? (
        <div className="min-h-0 w-full flex-1 overflow-y-auto pb-1">
          {visibleCount === 0 ? (
            <div className="flex items-center justify-center rounded-md border border-border bg-card py-10">
              <Text tone="muted">No runs match the current filters.</Text>
            </div>
          ) : (
            <MobileRunCards
              groups={groups}
              itemsById={itemsById}
              data={data}
              gradesByRun={gradesByRun}
              onOpenExistingRun={openExistingRun}
              onRerunTest={rerunTest}
              onOpenSuiteConsole={(suiteRunId) => navigate(`/testing/suite-runs/${suiteRunId}`)}
              onTogglePinned={togglePinned}
            />
          )}
        </div>
      ) : (
        // @brand/ui `Table` renders its OWN `relative w-full overflow-auto` scroll wrapper; we bound it
        // into the remaining height with `[&>div]` (mirrors the merged Compatibility heatmap, CP2) and
        // let it be the single both-axis scroll box. `w-full` (no `min-w-max`) keeps the table WITHIN
        // the viewport — it fits at ≥1500 (no scroll) and only overflows when narrower, where the
        // pinned Name (left) + Actions (right) columns hold.
        <div
          ref={scrollRef}
          style={{ maxWidth: boxWidth }}
          className="min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card [&>div]:h-full [&>div]:min-h-0"
        >
          <Table className="w-full">
            <TableHeader>
              <RunsTableHead
                showGrade={showGrade}
                sort={{ sortKey, sortDir, onSort }}
                selectAll={{
                  checked: allSelected ? true : anySelected ? "indeterminate" : false,
                  onCheckedChange: toggleAllSelected,
                  disabled: totalSelectable === 0,
                }}
                visible={visibleColumns}
              />
            </TableHeader>
            <TableBody>
              {visibleCount === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colSpan} className="py-10 text-center">
                    <Text tone="muted">No runs match the current filters.</Text>
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((group) => (
                  <RenderGroup
                    key={group.key}
                    label={group.label}
                    count={group.rows.length}
                    rows={group.rows}
                    colSpan={colSpan}
                    showGrade={showGrade}
                    viewportWidth={boxWidth}
                    itemsById={itemsById}
                    data={data}
                    gradesByRun={gradesByRun}
                    expanded={expanded}
                    selectedRunIds={selectedRunIds}
                    selectedSuiteRunIds={selectedSuiteRunIds}
                    onToggleExpand={toggleExpanded}
                    onToggleRunSelected={toggleRunSelected}
                    onToggleSuiteSelected={toggleSuiteSelected}
                    onOpenExistingRun={openExistingRun}
                    onRerunTest={rerunTest}
                    onOpenRunById={openRunById}
                    onOpenSuiteConsole={(suiteRunId) => navigate(`/testing/suite-runs/${suiteRunId}`)}
                    onRunSuite={(suiteId) =>
                      setLauncher({ open: true, intent: { kind: "suite", suiteId } })
                    }
                    visible={visibleColumns}
                    previewMode={columnsPreference.previewMode}
                    previewOpenRunId={previewOpenRunId}
                    onTogglePreview={(runId) =>
                      setPreviewOpenRunId((current) => (current === runId ? null : runId))
                    }
                    onTogglePinned={togglePinned}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => !open && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} run{selectedCount === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected runs along with their step and event history.
              {selectedSuiteRunIds.size > 0
                ? " Selected suite runs are removed as a group — their individual member runs are kept and reappear as standalone runs."
                : ""}{" "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void performBulkDelete()}>
                Delete {selectedCount} run{selectedCount === 1 ? "" : "s"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/** Numeric/date columns default to a high-first (descending) sort; text columns to A→Z. */
const NUMERIC_SORT_KEYS = new Set<SortKey>([
  "turns",
  "tools",
  "tokens",
  "cost",
  "grade",
  "started",
  "duration",
]);

/** Stable row id for a suite summary (distinct from any run id). */
function suiteRowId(suiteRunId: string): string {
  return `suite:${suiteRunId}`;
}

/** Immutably flip ONE standalone run's `pinned` flag inside the feed (WP2.3 optimistic pin toggle).
 *  Suite members are untouched — pin is a standalone-row affordance only (see `RunTableRow`). */
function withPinnedRun(data: RunsFeedData, runId: string, pinned: boolean): RunsFeedData {
  return {
    ...data,
    items: data.items.map((item) =>
      item.kind === "run" && item.run.id === runId
        ? { ...item, run: { ...item.run, pinned } }
        : item,
    ),
  };
}

/** Every valid {@link SortKey} — used only to validate a saved view's opaque `sort` blob below. */
const ALL_SORT_KEYS = new Set<SortKey>([
  "name",
  "type",
  "environment",
  "status",
  "turns",
  "tools",
  "tokens",
  "cost",
  "grade",
  "started",
  "duration",
]);

/** A saved view's opaque `sort` blob, given meaning ONLY here (the API never interprets it) — the
 *  shape `RunsView` itself writes when saving (`{ key: SortKey, dir: SortDir }`). Anything else
 *  (foreign/older client, hand-edited) is ignored rather than thrown on, so applying a view never
 *  crashes the feed over its presentation hint. */
function parseViewSort(raw: unknown): { key: SortKey; dir: SortDir } | null {
  if (raw === null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const key = obj.key;
  const dir = obj.dir;
  if (typeof key !== "string" || !ALL_SORT_KEYS.has(key as SortKey)) return null;
  if (dir !== "asc" && dir !== "desc") return null;
  return { key: key as SortKey, dir };
}

/**
 * Reduce one FeedItem to the flat, primitive {@link TopRowVM} the table sorts / filters / groups on.
 * Names + status labels resolve exactly as the rendered rows show them (shared helpers), so a sort by
 * a column matches what the user sees.
 */
function toTopRowVM(
  item: FeedItem,
  testsById: Map<string, Test>,
  scenariosById: Map<string, Scenario>,
  gradesByRun: Map<string, RunGrade[]>,
): TopRowVM {
  if (item.kind === "run") {
    const run = item.run;
    const name = testsById.get(run.testId)?.name ?? "Unknown test";
    const environment = scenariosById.get(run.scenarioId)?.name ?? "Unknown environment";
    const grades = gradesByRun.get(run.id) ?? [];
    const primary = pickPrimaryGrade(grades);
    const gradeSort =
      primary && primary.status === "graded" && primary.score != null ? primary.score : -1;
    // Unified Sessions (WP3.1) — the precise locked-table label (search + "status" column sort),
    // computed from every facet `RunSummary` now carries (`stopReasonCode`/`phase`/`ratingState`),
    // e.g. "Ended" / "Stopped — time limit" / "Expired" instead of the coarser legacy wording. The
    // FACET (the Status filter's dropdown value) stays on the older 5-value `runStatusBadgeStatus`
    // bridge (WP3.fix widened `runStatusBadgeView` itself to return the full locked-table view, so the
    // facet now sources its coarse bucket from `runStatusBadgeStatus` instead) — `runs-table-model.ts`'s
    // `STATUS_FACETS` is a closed, hand-typed list this WP doesn't own, so the exact-match filter
    // values must stay byte-identical to what it already offers.
    const runStatusView = deriveRunStatusView({
      status: run.status,
      outcome: run.outcome,
      stopReasonCode: run.stopReasonCode,
      phase: run.phase,
      ratingState: run.ratingState,
    });
    return {
      id: run.id,
      kind: "run",
      name,
      testId: run.testId,
      typeKey: "single",
      // AR11 — review-aware facet: a terminal run still being rated sorts/filters as "Reviewing…"
      // (the same view its rendered row chip shows).
      statusFacet: runStatusBadgeStatus(run.status, run.outcome, run.ratingState),
      statusLabel: runStatusView.kind === "chip" ? runStatusView.label : "—",
      environments: [environment],
      environmentLabel: environment,
      startedMs: Date.parse(run.startedAt) || 0,
      startedIso: run.startedAt,
      turns: run.turns,
      tools: run.toolCalls,
      tokens: run.tokensIn + run.tokensOut,
      cost: run.costUsd,
      gradeSort,
      // AR6 (WP 3.2) — a SEPARATE dimension from `gradeSort`; see `TopRowVM.hasBaseVerdict`.
      hasBaseVerdict: pickBaseVerdictEvidence(grades) !== null,
      durationMs: run.durationMs ?? null,
    };
  }

  const suiteRun = item.suiteRun;
  const badge = suiteStatusBadge(suiteRun.status, suiteRun.ratingState);
  const aggregates = suiteRun.aggregates ?? null;
  const environments = [
    ...new Set(
      item.members.map((m) => scenariosById.get(m.scenarioId)?.name ?? "Unknown environment"),
    ),
  ];
  const turns = item.members.reduce((sum, m) => sum + m.turns, 0);
  const tools = item.members.reduce((sum, m) => sum + m.toolCalls, 0);
  const tokens =
    aggregates?.totalTokens ?? item.members.reduce((sum, m) => sum + m.tokensIn + m.tokensOut, 0);
  const cost = aggregates
    ? aggregates.execCostUsd + aggregates.judgeCostUsd
    : item.members.reduce((sum, m) => sum + m.costUsd, 0);
  const durationMs = suiteRun.endedAt
    ? Math.max(0, Date.parse(suiteRun.endedAt) - Date.parse(suiteRun.startedAt))
    : null;
  return {
    id: suiteRowId(suiteRun.id),
    kind: "suite",
    name: suiteDisplayName(item),
    testId: null,
    typeKey: "suite",
    statusFacet: badge.status,
    statusLabel: badge.label,
    environments,
    environmentLabel: `${item.environmentCount} environment${item.environmentCount === 1 ? "" : "s"}`,
    startedMs: Date.parse(suiteRun.startedAt) || 0,
    startedIso: suiteRun.startedAt,
    turns,
    tools,
    tokens,
    cost,
    gradeSort: aggregates?.passRateAt05 ?? -1,
    // AR6 (WP 3.2) — suite summary rows keep their existing rolled-up pass rate ONLY; the feed
    // deliberately does NOT fetch every member's grades to roll up a base verdict here too (that would
    // mean N extra fetches per suite row just for a summary chip, and a roll-up would blur a genuinely
    // per-run signal) — see `TopRowVM.hasBaseVerdict`.
    hasBaseVerdict: false,
    durationMs,
  };
}

/** The feed's monitor strip (G8): total spend, tokens, and failure rate for the current filter. */
function RunsTotalsStrip({ totals }: { totals: RunsTotals }) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-md border border-border bg-muted/30 px-4 py-2.5">
      <KpiStat
        orientation="inline"
        label="Runs"
        value={<span className="tabular-nums">{formatNumber(totals.rows)}</span>}
      />
      <KpiStat
        orientation="inline"
        label="Tokens"
        value={<span className="tabular-nums">{formatNumber(totals.tokens)}</span>}
      />
      <KpiStat
        orientation="inline"
        label="Cost"
        value={<span className="tabular-nums">{formatCostUsd(totals.cost)}</span>}
      />
      <KpiStat
        orientation="inline"
        label="Failure rate"
        value={
          <span className="tabular-nums">
            {totals.failureRate === null ? "—" : formatPercent(totals.failureRate * 100)}
          </span>
        }
        sub={totals.failureRate === null ? undefined : `${formatNumber(totals.failed)} failed`}
      />
    </div>
  );
}

/**
 * P0 mobile audit T4 (2026-07-25 critique) — a suite row's mobile card counterpart. Tap opens the
 * full suite console; the matrix member drill-down (expand → KPI rail → member rows) stays a
 * desktop-table-only interaction (`SuiteTableRows`, not touched here) — kept deliberately minimal and
 * self-contained rather than reusing that component (which renders `<TableRow>`s and subscribes to a
 * live SSE stream meant for the table's expand affordance). The card shows the SAME persisted summary
 * fields the desktop row's collapsed state shows before its own live stream attaches.
 */
function SuiteSummaryCard({ item, onOpen }: { item: FeedSuiteItem; onOpen: () => void }) {
  const name = suiteDisplayName(item);
  const badge = suiteStatusBadge(item.suiteRun.status, item.suiteRun.ratingState);
  const aggregates = item.suiteRun.aggregates ?? null;
  const cost = aggregates
    ? aggregates.execCostUsd + aggregates.judgeCostUsd
    : item.members.reduce((sum, m) => sum + m.costUsd, 0);
  const passRate = aggregates?.passRateAt05 ?? null;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <Card
      interactive
      // biome-ignore lint/a11y/useSemanticElements: `@brand/ui` Card is a div-only primitive (no
      // "render as button" prop) — role="button" + tabIndex + a manual Enter handler is the same
      // escape hatch `RunSummaryCard`/`AgentCard.tsx` use for a whole-card tap target.
      role="button"
      aria-label={`Open ${name} suite console`}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-2 p-4"
    >
      <div className="flex items-center gap-2">
        <Layers aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Text className="min-w-0 flex-1 truncate font-medium">{name}</Text>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
        <Badge variant="outline" className="font-normal">
          {item.environmentCount} environment{item.environmentCount === 1 ? "" : "s"}
        </Badge>
      </div>
      <div className="flex items-center justify-between gap-2 text-meta text-muted-foreground">
        <span className="tabular-nums" title={formatDateTime(item.suiteRun.startedAt)}>
          {formatRelativeTime(item.suiteRun.startedAt)}
        </span>
        <span className="tabular-nums text-foreground">
          {passRate === null ? "—" : `${formatPercent(passRate * 100)} pass`} · {formatCostUsd(cost)}
        </span>
      </div>
    </Card>
  );
}

/**
 * P0 mobile audit T4 (2026-07-25 critique) — below `md` (768px) the wide interactive table doesn't
 * fit a phone (measured: 8+ columns unreachable at 390px inside a 336px-wide clipped wrapper, and
 * pinned columns kept their sticky geometry over content nobody could scroll to). Below `md` the SAME
 * `groups` (already sorted/grouped/filtered for the desktop table) render instead as one `@brand/ui`
 * Card per run/suite — `RunSummaryCard` (`RunTableRow.tsx`) for a standalone run, `SuiteSummaryCard`
 * above for a suite. The desktop `<Table>` this replaces is untouched (see `RenderGroup` below).
 */
function MobileRunCards({
  groups,
  itemsById,
  data,
  gradesByRun,
  onOpenExistingRun,
  onRerunTest,
  onOpenSuiteConsole,
  onTogglePinned,
}: {
  groups: RunsTableGroup[];
  itemsById: Map<string, FeedItem>;
  data: RunsFeedData;
  gradesByRun: Map<string, RunGrade[]>;
  onOpenExistingRun: (run: RunSummary) => void;
  onRerunTest: (run: RunSummary) => void;
  onOpenSuiteConsole: (suiteRunId: string) => void;
  onTogglePinned: (run: RunSummary, next: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 pb-2">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          {group.label !== null ? (
            <div className="flex items-center gap-2 px-1">
              <Text className="font-medium">{group.label}</Text>
              <Badge variant="secondary" className="font-normal tabular-nums">
                {group.rows.length}
              </Badge>
            </div>
          ) : null}
          {group.rows.map((row) => {
            const item = itemsById.get(row.id);
            if (!item) return null;
            if (item.kind === "run") {
              return (
                <RunSummaryCard
                  key={row.id}
                  run={item.run}
                  testName={data.testsById.get(item.run.testId)?.name}
                  grades={gradesByRun.get(item.run.id) ?? []}
                  onOpen={() => onOpenExistingRun(item.run)}
                  onRerun={() => onRerunTest(item.run)}
                  pinned={item.run.pinned ?? false}
                  onTogglePinned={(next) => onTogglePinned(item.run, next)}
                />
              );
            }
            return (
              <SuiteSummaryCard
                key={row.id}
                item={item}
                onOpen={() => onOpenSuiteConsole(item.suiteRun.id)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** One (optionally-labeled) group of rows: a sticky-left header row when grouped, then each row. */
function RenderGroup({
  label,
  count,
  rows,
  colSpan,
  showGrade,
  viewportWidth,
  itemsById,
  data,
  gradesByRun,
  expanded,
  selectedRunIds,
  selectedSuiteRunIds,
  onToggleExpand,
  onToggleRunSelected,
  onToggleSuiteSelected,
  onOpenExistingRun,
  onRerunTest,
  onOpenRunById,
  onOpenSuiteConsole,
  onRunSuite,
  visible,
  previewMode,
  previewOpenRunId,
  onTogglePreview,
  onTogglePinned,
}: {
  label: string | null;
  count: number;
  rows: TopRowVM[];
  colSpan: number;
  showGrade: boolean;
  viewportWidth: number | undefined;
  itemsById: Map<string, FeedItem>;
  data: RunsFeedData;
  gradesByRun: Map<string, RunGrade[]>;
  expanded: Set<string>;
  selectedRunIds: Set<string>;
  selectedSuiteRunIds: Set<string>;
  onToggleExpand: (rowId: string) => void;
  onToggleRunSelected: (runId: string, on: boolean) => void;
  onToggleSuiteSelected: (suiteRunId: string, on: boolean) => void;
  onOpenExistingRun: (run: RunSummary) => void;
  onRerunTest: (run: RunSummary) => void;
  onOpenRunById: (runId: string) => void;
  onOpenSuiteConsole: (suiteRunId: string) => void;
  onRunSuite: (suiteId: string) => void;
  /** Column visibility (Observability WP 2.3) — threaded into every row renderer so header/body cells
   *  stay aligned. */
  visible: Set<RunTableColumnKey>;
  previewMode: RunColumnsPreference["previewMode"];
  /** The one standalone run whose preview disclosure is open (or `null`) — `RunTableRow` compares its
   *  own id against this. */
  previewOpenRunId: string | null;
  onTogglePreview: (runId: string) => void;
  onTogglePinned: (run: RunSummary, next: boolean) => void;
}) {
  const railWidth = viewportWidth ? { width: `${viewportWidth}px` } : undefined;
  return (
    <>
      {label !== null ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colSpan} className="bg-muted/60 p-0">
            <div className="sticky left-0 flex items-center gap-2 px-3 py-2" style={railWidth}>
              <Text className="font-medium">{label}</Text>
              <Badge variant="secondary" className="font-normal tabular-nums">
                {count}
              </Badge>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
      {rows.map((row) => {
        const item = itemsById.get(row.id);
        if (!item) return null;
        if (item.kind === "run") {
          return (
            <RunTableRow
              key={row.id}
              run={item.run}
              testName={data.testsById.get(item.run.testId)?.name}
              scenarioName={data.scenariosById.get(item.run.scenarioId)?.name}
              scenarioModel={data.scenariosById.get(item.run.scenarioId)?.model}
              grades={gradesByRun.get(item.run.id) ?? []}
              showGrade={showGrade}
              selected={selectedRunIds.has(item.run.id)}
              onToggleSelected={(on) => onToggleRunSelected(item.run.id, on)}
              onOpen={() => onOpenExistingRun(item.run)}
              onRerun={() => onRerunTest(item.run)}
              visible={visible}
              pinned={item.run.pinned ?? false}
              onTogglePinned={(next) => onTogglePinned(item.run, next)}
              previewMode={previewMode}
              previewOpen={previewOpenRunId === item.run.id}
              onTogglePreview={() => onTogglePreview(item.run.id)}
            />
          );
        }
        const suiteId = item.suiteRun.suiteId;
        return (
          <SuiteTableRows
            key={row.id}
            item={item}
            testsById={data.testsById}
            scenariosById={data.scenariosById}
            colSpan={colSpan}
            showGrade={showGrade}
            viewportWidth={viewportWidth}
            expanded={expanded.has(row.id)}
            onToggleExpand={() => onToggleExpand(row.id)}
            onOpenConsole={() => onOpenSuiteConsole(item.suiteRun.id)}
            onRun={suiteId ? () => onRunSuite(suiteId) : undefined}
            onOpenRun={onOpenRunById}
            selectedRunIds={selectedRunIds}
            onToggleRunSelected={onToggleRunSelected}
            suiteSelected={selectedSuiteRunIds.has(item.suiteRun.id)}
            onToggleSuiteSelected={(on) => onToggleSuiteSelected(item.suiteRun.id, on)}
            visible={visible}
          />
        );
      })}
    </>
  );
}
