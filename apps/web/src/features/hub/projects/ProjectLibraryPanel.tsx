import { useCallback, useEffect, useMemo, useState } from "react";
import type { HubProject } from "@mcp-token-footprint/shared";
import { Badge, Button, Checkbox, EmptyState, Label, Spinner, Text, cn, toast } from "@brand/ui";
import { SearchInput } from "@brand/data";
import { Archive, Folder, Plus } from "lucide-react";
import { ConfirmDialog } from "../../../components/dialogs";
import {
  createHubProject,
  deleteHubProject,
  listHubProjects,
  listHubSessionsForTable,
  updateHubProject,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { ProjectEditor, type ProjectFormValue } from "./ProjectEditor";
import { notifyError } from "../../../lib/notify";

/** `"new"` is a real selection state (the "create a project" draft), distinct from `null` (nothing
 *  selected — the empty state). */
type Selection = string | "new" | null;

/** One rail row — folder icon tinted by status, truncating name, archived badge, muted session
 *  count. The whole row is one ghost-Button click target (the `OrgRail` RailItem recipe). */
function ProjectRow({
  project,
  active,
  sessionCount,
  onSelect,
}: {
  project: HubProject;
  active: boolean;
  /** undefined while counts are still loading (or failed) — render nothing, never a fake 0. */
  sessionCount: number | undefined;
  onSelect: () => void;
}) {
  const archived = !!project.archivedAt;
  return (
    <li className="min-w-0">
      <Button
        type="button"
        variant="ghost"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "h-auto w-full min-w-0 justify-start gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-accent/60",
          active && "bg-accent text-primary hover:bg-accent",
          // Dimmed, not hidden: when "Show archived" is on, archived rows must read as background
          // noise next to active ones, not as equals.
          archived && "opacity-70",
        )}
      >
        <Folder
          aria-hidden
          className={cn("size-4 shrink-0", archived ? "text-muted-foreground" : "text-primary")}
        />
        <span className="min-w-0 flex-1 truncate text-left" title={project.name}>
          {project.name}
        </span>
        {archived ? (
          <Badge variant="outline" className="shrink-0">
            Archived
          </Badge>
        ) : null}
        {sessionCount != null ? (
          <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
            {sessionCount}
          </span>
        ) : null}
      </Button>
    </li>
  );
}

/**
 * Assistant Hub (WP3.1, D-AH11c; rebuilt ui-wave U6, owner feedback) — the project library at
 * `/assistant/projects`: a fixed w-72 rail (header + search + rows + a quiet "Show archived"
 * toggle) beside the `ProjectEditor` detail pane. U6 dropped the old `SplitPane` recipe for the
 * SAME rail-plus-content frame the workforce section uses (`WorkforceView` + `OrgRail`) — the
 * owner's "misaligned with the app's layout concept" was exactly this: projects was the last
 * library still dressed as a generic split-tab.
 *
 * U6 repair notes (the "not even working" list):
 *  • Archiving used to DROP the project from local state and deselect it whenever "Show archived"
 *    was off — so the toggle then had nothing to reveal and undo required a reload. Now the row
 *    stays in state (only hidden from the rail) and the detail stays open, so Unarchive is one
 *    click away.
 *  • KNOWN API GAP (not fixable here): `GET /api/hub/projects` never returns archived rows
 *    (`repository.listProjects()` is called without `includeArchived` — `apps/api/src/hub/
 *    routes.ts`, `registerHubProjectRoutes`), so after a reload archived projects are unlistable
 *    and can never be restored from the UI. The in-session fix above plus the honest "all
 *    archived" rail state keep the flow usable until the route grows the same `?includeArchived=`
 *    the agents route already has.
 *  • The dirty-guard-on-selection-switch (ConfirmDialog) is unchanged.
 */
export function ProjectLibraryPanel() {
  const [projects, setProjects] = useState<HubProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<Selection>(null);
  /** Top-level sessions per project id; null until loaded. Feeds the rail rows' muted counts and
   *  the detail header's "N sessions" link. */
  const [sessionCounts, setSessionCounts] = useState<Map<string, number> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await listHubProjects());
    } catch (error) {
      notifyError("Couldn’t load projects", { description: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Same dataset the "N sessions" link lands on (`/assistant/sessions` defaults: top-level,
        // non-archived) — any other count would contradict the table one click later.
        const sessions = await listHubSessionsForTable();
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const session of sessions) {
          if (!session.projectId) continue;
          counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + 1);
        }
        setSessionCounts(counts);
      } catch {
        // Counts are decoration on someone else's data — a failed fetch must not toast over the
        // library itself; rows simply render without numbers.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () => (showArchived ? projects : projects.filter((p) => !p.archivedAt)),
    [projects, showArchived],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return visible;
    return visible.filter((project) =>
      `${project.name} ${project.description ?? ""}`.toLowerCase().includes(needle),
    );
  }, [visible, query]);

  const selectedProject =
    selection && selection !== "new" ? (projects.find((p) => p.id === selection) ?? null) : null;

  const requestSelect = (next: Selection): void => {
    if (dirty && next !== selection) {
      setPendingSelection(next);
      return;
    }
    setSelection(next);
  };

  const confirmDiscard = (): void => {
    setSelection(pendingSelection);
    setPendingSelection(null);
  };

  const handleSave = async (value: ProjectFormValue): Promise<void> => {
    setSaving(true);
    try {
      const description = value.description.trim();
      const instructions = value.instructions.trim();
      if (selectedProject) {
        // PATCH: an omitted field means "leave unchanged" (see `HubRepository.updateProject`) — a
        // field the user just CLEARED must go over the wire as an explicit `null`, not be dropped.
        const updated = await updateHubProject(selectedProject.id, {
          name: value.name.trim(),
          description: description || null,
          instructions: instructions || null,
        });
        setProjects((current) => current.map((p) => (p.id === updated.id ? updated : p)));
        toast.success("Project saved");
      } else {
        const created = await createHubProject({
          name: value.name.trim(),
          ...(description ? { description } : {}),
          ...(instructions ? { instructions } : {}),
        });
        setProjects((current) => [created, ...current]);
        setSelection(created.id);
        toast.success("Project created");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!selectedProject) return;
    await deleteHubProject(selectedProject.id);
    setProjects((current) => current.filter((p) => p.id !== selectedProject.id));
    setSelection(null);
    toast.success("Project deleted");
  };

  const handleArchiveToggle = async (archived: boolean): Promise<void> => {
    if (!selectedProject) return;
    const updated = await updateHubProject(selectedProject.id, { archived });
    // Keep the row in state and the detail open in EVERY case (U6 repair — see the class doc): the
    // rail's archived filter handles visibility, and the still-open header is where the one-click
    // Unarchive undo lives. Dropping state here is what used to strand archived projects.
    setProjects((current) => current.map((p) => (p.id === updated.id ? updated : p)));
    toast.success(archived ? "Project archived" : "Project restored");
  };

  const countLabel =
    filtered.length !== visible.length ? `${filtered.length} / ${visible.length}` : visible.length;

  const sessionCountFor = (id: string): number | undefined =>
    sessionCounts ? (sessionCounts.get(id) ?? 0) : undefined;

  return (
    <>
      <div className="flex h-full min-h-0 flex-1 overflow-hidden">
        {/* ── Rail ─────────────────────────────────────────────────────────────────────────── */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="flex shrink-0 flex-col gap-3 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <Text className="shrink-0 font-semibold leading-tight">Projects</Text>
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {countLabel}
              </Badge>
              <div className="min-w-0 flex-1" />
              <Button size="sm" onClick={() => requestSelect("new")} className="shrink-0 gap-1.5">
                <Plus aria-hidden className="size-4" />
                <span>New</span>
              </Button>
            </div>
            <SearchInput
              value={query}
              onValueChange={setQuery}
              label="Filter projects"
              placeholder="Filter projects…"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0 [scrollbar-gutter:stable]">
            {loading ? (
              <div className="flex items-center gap-2 p-2 text-body text-muted-foreground">
                <Spinner className="size-4" aria-hidden />
                <span>Loading projects…</span>
              </div>
            ) : projects.length === 0 ? (
              <EmptyState
                className="mt-4"
                icon={<Folder aria-hidden />}
                title="No projects yet"
                description="Create a project to group sessions and pin instructions + reference files they all inherit."
              />
            ) : filtered.length === 0 && query.trim() ? (
              <EmptyState
                className="mt-4"
                icon={<Folder aria-hidden />}
                title={`No projects match “${query.trim()}”`}
                description="Try a different search term, or clear the filter to see every project."
                actions={
                  <Button variant="outline" onClick={() => setQuery("")}>
                    Clear filter
                  </Button>
                }
              />
            ) : filtered.length === 0 ? (
              // Everything that exists is archived and hidden — say so instead of pretending the
              // library is empty (the honest half of the U6 archive repair).
              <EmptyState
                className="mt-4"
                icon={<Archive aria-hidden />}
                title="All projects are archived"
                description="Turn on Show archived to see them."
              />
            ) : (
              <ul className="flex min-w-0 flex-col gap-0.5">
                {filtered.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    active={project.id === selection}
                    sessionCount={sessionCountFor(project.id)}
                    onSelect={() => requestSelect(project.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-border px-3 py-2.5">
            <Label className="flex cursor-pointer items-center gap-2 font-normal text-caption text-muted-foreground">
              <Checkbox
                checked={showArchived}
                onCheckedChange={(next) => setShowArchived(next === true)}
              />
              <span>Show archived</span>
            </Label>
          </div>
        </div>

        {/* ── Detail ───────────────────────────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selection === null ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={<Folder aria-hidden />}
                title="Select a project"
                description="Pick a project from the list, or create a new one."
                actions={
                  <Button onClick={() => requestSelect("new")} className="gap-1.5">
                    <Plus aria-hidden className="size-4" />
                    <span>New project</span>
                  </Button>
                }
              />
            </div>
          ) : (
            <ProjectEditor
              key={selection}
              project={selectedProject}
              saving={saving}
              {...(selectedProject ? { sessionCount: sessionCountFor(selectedProject.id) } : {})}
              onSave={handleSave}
              {...(selectedProject
                ? { onDelete: handleDelete, onArchiveToggle: handleArchiveToggle }
                : {})}
              onDirtyChange={setDirty}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingSelection !== null}
        onOpenChange={(open) => !open && setPendingSelection(null)}
        title="Discard unsaved changes?"
        description="This project has changes that haven't been saved. Switching now discards them."
        confirmLabel="Discard changes"
        tone="destructive"
        onConfirm={confirmDiscard}
      />
    </>
  );
}
