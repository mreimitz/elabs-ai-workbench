import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DataTable, FacetFilter, SearchInput, type FacetOption } from "@elabs-ai/components-data";
import {
  Badge,
  Button,
  Checkbox,
  DateRangePicker,
  EmptyState,
  Heading,
  Input,
  Label,
  StatePanel,
  toast,
  type DateRange,
  type DateRangePreset,
} from "@elabs-ai/components-ui";
import {
  HUB_SESSION_MODES,
  RUN_STATUSES,
  type HubProject,
  type HubSession,
  type HubSessionCreateInput,
  type RunStatus,
} from "@mcp-token-footprint/shared";
import { History, Plus } from "lucide-react";
import { FormDialog } from "../../../components/dialogs";
import { PageShell } from "../../../components/PageShell";
import { ViewToolbar } from "../../../components/ViewToolbar";
import {
  createHubSession,
  listHubProjects,
  listHubSessionsForTable,
  updateHubSession,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { clickableRowTableProps } from "../../../lib/table";
import { NewSessionDialog } from "../NewSessionDialog";
import { useHubModelRoster } from "../use-hub-models";
import { buildSessionColumns, NO_PROJECT_VALUE, SESSION_MODE_LABELS } from "./columns";
import { parseSessionsFilter, serializeSessionsFilter } from "./sessions-url-state";
import { notifyError } from "../../../lib/notify";

/** Sessions-table (WP1.4) status facet labels. `Record<RunStatus, string>` is exhaustive over every
 *  {@link RunStatus} member — a future one fails `pnpm typecheck` here until classified. */
const STATUS_FACET_LABELS: Record<RunStatus, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  stopped: "Stopped",
  error: "Failed",
  aborted: "Aborted",
  ended: "Ended",
};

const STATUS_FACET_OPTIONS: FacetOption[] = RUN_STATUSES.map((status) => ({
  value: status,
  label: STATUS_FACET_LABELS[status],
}));

const MODE_FACET_OPTIONS: FacetOption[] = HUB_SESSION_MODES.map((mode) => ({
  value: mode,
  label: SESSION_MODE_LABELS[mode],
}));

const DATE_PRESETS: DateRangePreset[] = [
  {
    label: "Last 24 hours",
    getRange: () => ({ from: new Date(Date.now() - 24 * 60 * 60 * 1000), to: new Date() }),
  },
  { label: "Last 7 days", getRange: () => ({ from: daysAgo(6), to: new Date() }) },
  { label: "Last 30 days", getRange: () => ({ from: daysAgo(29), to: new Date() }) },
];

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function startOfDayMs(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDayMs(date: Date): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

type RenameState = { session: HubSession; value: string; busy: boolean };

/**
 * Assistant Hub UX WP1.4 (D-HUX4, P4) — `/assistant/sessions`: session history as a sortable/
 * filterable `DataTable` (§7.2 of the concept). Top-level sessions only (agent mission-children
 * surface via the mission board/audit, never here — `listHubSessionsForTable`'s `topLevelOnly`).
 * Search + status/mode/project facets + a date range filter the already-loaded rows client-side
 * (the same recipe `IssueFilters`/`RunsView`'s Type facet use — a local dev tool's session count
 * never justifies a server-side query grammar for this). Row click opens the session in the
 * workspace (`/assistant?session=<id>`); the row overflow menu carries rename + archive/restore —
 * P4: additive `archived` flag, no hard delete ever.
 */
export function SessionsView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { models, loading: modelsLoading } = useHubModelRoster();

  const [sessions, setSessions] = useState<HubSession[]>([]);
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WP2.8 — the facets seed from the URL ONCE (so a workforce-Usage drill link or any deep link
  // arrives already filtered), then stay in sync via the write-back effect below. The seed is
  // computed a single time from the initial URL (the view is remounted fresh on a new deep link).
  const [seed] = useState(() => parseSessionsFilter(searchParams));
  const [search, setSearch] = useState(seed.search);
  const [statusFacet, setStatusFacet] = useState<string[]>(seed.status);
  const [modeFacet, setModeFacet] = useState<string[]>(seed.mode);
  const [projectFacet, setProjectFacet] = useState<string[]>(seed.project);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(seed.dateRange);
  const [showArchived, setShowArchived] = useState(false);

  // Keep the URL in sync with the live filter state (shareable / reloadable / deep-linkable). Runs on
  // filter changes only; reads the latest `searchParams` via closure and writes only when the string
  // actually differs (so a `?model=` seed normalises to `?q=` once, and the no-filter case stays the
  // clean `/assistant/sessions`). The URL on this route is written ONLY here — there is no external
  // change to react to — so `searchParams`/`setSearchParams` are intentionally out of the dep array.
  useEffect(() => {
    const next = serializeSessionsFilter(searchParams, {
      search,
      status: statusFacet,
      mode: modeFacet,
      project: projectFacet,
      dateRange,
    });
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [search, statusFacet, modeFacet, projectFacet, dateRange]);

  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [rename, setRename] = useState<RenameState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessionList, projectList] = await Promise.all([
        listHubSessionsForTable({ includeArchived: showArchived }),
        listHubProjects(),
      ]);
      setSessions(sessionList);
      setProjects(projectList);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const projectFacetOptions: FacetOption[] = useMemo(
    () => [
      { value: NO_PROJECT_VALUE, label: "No project" },
      ...projects
        .map((p) => ({ value: p.id, label: p.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
    [projects],
  );

  const filtersActive =
    search.trim().length > 0 ||
    statusFacet.length > 0 ||
    modeFacet.length > 0 ||
    projectFacet.length > 0 ||
    dateRange !== undefined;

  const resetFilters = useCallback(() => {
    setSearch("");
    setStatusFacet([]);
    setModeFacet([]);
    setProjectFacet([]);
    setDateRange(undefined);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = dateRange?.from ?? null;
    const to = dateRange?.to ?? dateRange?.from ?? null;
    const fromMs = from ? startOfDayMs(from) : null;
    const toMs = to ? endOfDayMs(to) : null;

    return sessions.filter((session) => {
      if (statusFacet.length > 0 && !statusFacet.includes(session.status)) return false;
      if (modeFacet.length > 0 && !modeFacet.includes(session.mode)) return false;
      if (projectFacet.length > 0) {
        const key = session.projectId ?? NO_PROJECT_VALUE;
        if (!projectFacet.includes(key)) return false;
      }
      const updatedMs = Date.parse(session.updatedAt);
      if (fromMs !== null && !Number.isNaN(updatedMs) && updatedMs < fromMs) return false;
      if (toMs !== null && !Number.isNaN(updatedMs) && updatedMs > toMs) return false;
      if (q.length > 0) {
        const projectName = session.projectId ? (projectNameById.get(session.projectId) ?? "") : "";
        const haystack = [session.title, session.model, session.lastError ?? "", projectName]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, statusFacet, modeFacet, projectFacet, dateRange, search, projectNameById]);

  const openSession = useCallback(
    (session: HubSession) => navigate(`/assistant?session=${session.id}`),
    [navigate],
  );

  const handleCreate = useCallback(
    async (input: HubSessionCreateInput) => {
      const created = await createHubSession(input);
      navigate(`/assistant?session=${created.id}`);
    },
    [navigate],
  );

  const handleArchiveToggle = useCallback(
    async (session: HubSession) => {
      const nextArchived = !session.archived;
      try {
        const updated = await updateHubSession(session.id, { archived: nextArchived });
        setSessions((current) => {
          // Archiving out of an unarchived-only view (or restoring out of an archived-only one is
          // never the case here — `showArchived` gates BOTH) removes the row locally instead of
          // waiting for a reload, mirroring `RoleLibraryPanel.handleArchiveToggle`.
          if (!showArchived && nextArchived) {
            return current.filter((s) => s.id !== session.id);
          }
          return current.map((s) => (s.id === updated.id ? updated : s));
        });
        toast.success(nextArchived ? "Session archived" : "Session restored");
      } catch (err) {
        notifyError(
          nextArchived ? "Couldn’t archive the session" : "Couldn’t restore the session",
          {
            description: getErrorMessage(err),
          },
        );
      }
    },
    [showArchived],
  );

  const handleRenameSubmit = useCallback(async () => {
    if (!rename) return;
    const title = rename.value.trim();
    if (!title) return;
    setRename((current) => (current ? { ...current, busy: true } : current));
    try {
      const updated = await updateHubSession(rename.session.id, { title });
      setSessions((current) => current.map((s) => (s.id === updated.id ? updated : s)));
      toast.success("Session renamed");
      setRename(null);
    } catch (err) {
      notifyError("Couldn’t rename the session", { description: getErrorMessage(err) });
      setRename((current) => (current ? { ...current, busy: false } : current));
    }
  }, [rename]);

  const columns = useMemo(
    () =>
      buildSessionColumns({
        projectNameById,
        onOpen: openSession,
        onRename: (session) => setRename({ session, value: session.title, busy: false }),
        onArchiveToggle: (session) => void handleArchiveToggle(session),
      }),
    [projectNameById, openSession, handleArchiveToggle],
  );

  const newSessionAction = (
    <Button onClick={() => setNewSessionOpen(true)}>
      <Plus aria-hidden />
      <span>New session</span>
    </Button>
  );

  const toolbar = (
    <ViewToolbar
      left={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="w-56 min-w-[10rem]">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              label="Search sessions"
              placeholder="Search title, model, error…"
            />
          </div>
          <FacetFilter
            title="Status"
            options={STATUS_FACET_OPTIONS}
            selected={statusFacet}
            onSelectedChange={setStatusFacet}
          />
          <FacetFilter
            title="Mode"
            options={MODE_FACET_OPTIONS}
            selected={modeFacet}
            onSelectedChange={setModeFacet}
          />
          <FacetFilter
            title="Project"
            options={projectFacetOptions}
            selected={projectFacet}
            onSelectedChange={setProjectFacet}
          />
          <DateRangePicker
            value={dateRange}
            onValueChange={setDateRange}
            presets={DATE_PRESETS}
            placeholder="All time"
          />
          <Label className="flex shrink-0 cursor-pointer items-center gap-2 font-normal text-caption text-muted-foreground">
            <Checkbox
              checked={showArchived}
              onCheckedChange={(next) => setShowArchived(next === true)}
            />
            <span>Show archived</span>
          </Label>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {filtered.length === sessions.length
              ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${sessions.length} sessions`}
          </Badge>
        </div>
      }
      actions={newSessionAction}
    />
  );

  if (loading) {
    return (
      <PageShell headerVariant="toolbar" header={toolbar}>
        <Heading level={1} className="sr-only">
          Sessions
        </Heading>
        <StatePanel kind="loading" title="Loading sessions…" loadingLabel="Loading sessions…" />
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell headerVariant="toolbar" header={toolbar}>
        <Heading level={1} className="sr-only">
          Sessions
        </Heading>
        <StatePanel
          kind="error"
          title="Couldn’t load sessions"
          description={error}
          actions={
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (sessions.length === 0) {
    return (
      <PageShell headerVariant="toolbar" header={toolbar}>
        <Heading level={1} className="sr-only">
          Sessions
        </Heading>
        <NewSessionDialog
          open={newSessionOpen}
          onOpenChange={setNewSessionOpen}
          models={models}
          modelsLoading={modelsLoading}
          onCreate={handleCreate}
          projects={projects}
        />
        <EmptyState
          icon={<History aria-hidden />}
          title="No sessions yet"
          description={
            showArchived
              ? "Start a chat, research, or mission session — it shows up here with its status, tokens, and cost."
              : "Start a session, or check Show archived — every active session may be archived right now."
          }
          actions={
            <>
              <Button onClick={() => setNewSessionOpen(true)}>
                <Plus aria-hidden />
                <span>New session</span>
              </Button>
              {/* Ambiguity guard: `sessions` only carries what `includeArchived` asked for, so an
                  empty list while the toggle is OFF could mean "genuinely no sessions" OR "every
                  session is archived" — this button resolves it in one click without a second
                  fetch just to disambiguate the empty state's copy. */}
              {!showArchived ? (
                <Button variant="outline" onClick={() => setShowArchived(true)}>
                  Show archived
                </Button>
              ) : null}
            </>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell headerVariant="toolbar" header={toolbar}>
      <Heading level={1} className="sr-only">
        Sessions
      </Heading>

      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        models={models}
        modelsLoading={modelsLoading}
        onCreate={handleCreate}
        projects={projects}
      />

      <FormDialog
        open={rename !== null}
        onOpenChange={(open) => !open && setRename(null)}
        title="Rename session"
        primaryLabel="Save"
        busy={rename?.busy ?? false}
        submitDisabled={!rename?.value.trim()}
        onSubmit={() => void handleRenameSubmit()}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hub-session-rename">Title</Label>
          <Input
            id="hub-session-rename"
            value={rename?.value ?? ""}
            onChange={(event) =>
              setRename((current) =>
                current ? { ...current, value: event.target.value } : current,
              )
            }
            placeholder="Session title…"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
          />
        </div>
      </FormDialog>

      {/*
       * Plain (non-virtualized) `DataTable` — the `ScansTab`/`ServersView`/`IssueTriageTable` recipe
       * for a full-width inventory, deliberately NOT `stickyScrollTableProps()`'s row-virtualization:
       * that recipe's scroll box measures a zero height under jsdom/vitest, so `@tanstack/react-
       * virtual` renders an EMPTY `<tbody>` in tests (see `IssueTriageTable.tsx`'s own doc comment for
       * the same finding). `PageShell`'s default `scroll="content"` is the ONE scroll owner (D-HUX1);
       * the table's own `overflow-hidden` wrapper keeps a too-wide table from pushing the page wider.
       */}
      <div className="min-w-0 overflow-hidden rounded-lg border border-border">
        {/* ui-wave U7 (owner feedback): the whole row is the click target (cursor + accent hover +
            delegated click to the title control) — see `clickableRowTableProps` in lib/table.tsx. */}
        <DataTable
          data={filtered}
          columns={columns}
          {...clickableRowTableProps()}
          initialView={{ sorting: [{ id: "updated", desc: true }] }}
          emptyMessage={
            <EmptyState
              title="No sessions match"
              description="Adjust the search, facets, or date range to see more sessions."
              actions={
                <Button variant="outline" onClick={resetFilters} disabled={!filtersActive}>
                  Reset filters
                </Button>
              }
            />
          }
        />
      </div>
    </PageShell>
  );
}
