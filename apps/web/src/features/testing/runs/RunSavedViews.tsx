import { useCallback, useEffect, useRef, useState } from "react";
import type { RunFilter, RunView } from "@mcp-token-footprint/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  toast,
} from "@elabs-ai/components-ui";
import { Bookmark, Check, ChevronDown, Save, Trash2 } from "lucide-react";
import { createRunView, deleteRunView, listRunViews, updateRunView } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { type RunColumnsPreference, normalizeColumnsPreference } from "./run-columns";
import { RUN_VIEW_PRESETS, isPresetViewId } from "./run-filter-url";
import { notifyError } from "../../../lib/notify";

/** A view's applied shape — the FULL state {@link RunSavedViews} restores (DESIGN: "a view also
 *  restores columns + sort"). `sort` is app-owned and opaque on the wire, so it is typed loosely here
 *  and validated by the caller (`RunsView` knows its own `SortKey`/`SortDir` shape). */
export type AppliedRunView = {
  id: string;
  name: string;
  filter: RunFilter;
  columns: RunColumnsPreference;
  sort: unknown;
};

export type RunSavedViewsProps = {
  /** The id of the currently-applied view (preset or saved), or `null` if the bar has drifted from
   *  any named view (e.g. the operator hand-edited a filter after applying one). */
  activeId: string | null;
  currentFilter: RunFilter;
  currentColumns: RunColumnsPreference;
  /** Opaque sort hint captured verbatim into a saved view's `sort` field. */
  currentSort: unknown;
  onApply: (view: AppliedRunView) => void;
  /**
   * AM-OB1 — a view id that arrived in the URL as the SHORT named form (`?view=<id>` with no other
   * feed-state param) and still has to be resolved into real state. Presets resolve immediately;
   * a persisted view waits for the `run_views` list this component already fetches. Read ONCE, on
   * mount: later view changes come from {@link onApply} and must not re-trigger a resolve.
   */
  pendingViewId?: string | null;
  /**
   * Called exactly once for a {@link pendingViewId}: with the resolved view (the caller applies it),
   * or with `null` when the id names nothing — a deleted saved view, or a preset that no longer
   * exists — so the caller can drop the dead id from the URL instead of showing a nameless label.
   */
  onPendingResolved?: (view: AppliedRunView | null) => void;
};

/**
 * Saved-view picker (Observability WP 2.3): the client-side PRESETS ({@link RUN_VIEW_PRESETS} — no DB
 * row, always available, never editable) plus persisted `run_views` rows (`GET/POST /api/run-views`,
 * `PATCH/DELETE /api/run-views/:id`, WP1.4). Applying a view restores its filter AND its column/sort
 * presentation hints; "Save current view" captures the CURRENT filter+columns+sort into a new (or,
 * once one is active, the SAME) persisted view.
 */
export function RunSavedViews({
  activeId,
  currentFilter,
  currentColumns,
  currentSort,
  onApply,
  pendingViewId = null,
  onPendingResolved,
}: RunSavedViewsProps) {
  const [views, setViews] = useState<RunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setViews(await listRunViews());
    } catch (error) {
      notifyError("Couldn’t load saved views.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // AM-OB1 — resolve a `?view=<id>` short named URL, exactly once. The ref is seeded from the FIRST
  // render's prop and cleared the moment it is answered, so neither the async `run_views` load nor a
  // later `currentColumns`/`currentSort` identity change can re-fire it (which would fight the
  // operator's own edits). A preset needs no fetch; a persisted view waits for `loading` to settle.
  const pendingRef = useRef<string | null>(pendingViewId);
  const latestRef = useRef({ currentColumns, currentSort, onPendingResolved });
  latestRef.current = { currentColumns, currentSort, onPendingResolved };
  useEffect(() => {
    const pending = pendingRef.current;
    if (pending === null) return;
    const { currentColumns: columns, currentSort: sort, onPendingResolved: resolve } = latestRef.current;
    if (resolve === undefined) return;
    if (isPresetViewId(pending)) {
      pendingRef.current = null;
      const preset = RUN_VIEW_PRESETS.find((p) => p.id === pending);
      resolve(
        preset
          ? {
              id: preset.id,
              name: preset.name,
              filter: preset.filter,
              columns: preset.columns ?? columns,
              sort,
            }
          : null,
      );
      return;
    }
    if (loading) return;
    pendingRef.current = null;
    const view = views.find((v) => v.id === pending);
    resolve(
      view
        ? {
            id: view.id,
            name: view.name,
            filter: view.filter,
            columns: normalizeColumnsPreference(view.columns),
            sort: view.sort,
          }
        : null,
    );
  }, [loading, views]);

  const activeSavedView = activeId && !isPresetViewId(activeId) ? views.find((v) => v.id === activeId) : undefined;

  const applyPreset = (presetId: string) => {
    const preset = RUN_VIEW_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    // Sessions lens (WP 2.4) — a preset carrying its own `columns` (today only "Sessions") switches
    // the column set wholesale; every other preset keeps whatever columns are currently active
    // (unchanged WP2.3 behavior).
    onApply({
      id: preset.id,
      name: preset.name,
      filter: preset.filter,
      columns: preset.columns ?? currentColumns,
      sort: currentSort,
    });
  };

  const applySavedView = (view: RunView) => {
    onApply({
      id: view.id,
      name: view.name,
      filter: view.filter,
      columns: normalizeColumnsPreference(view.columns),
      sort: view.sort,
    });
  };

  const submitSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setSaving(true);
    try {
      const created = await createRunView({
        name: trimmed,
        filter: currentFilter,
        columns: currentColumns,
        sort: currentSort,
      });
      setViews((current) => [...current, created]);
      setSaveOpen(false);
      setName("");
      toast.success(`Saved view “${created.name}”`);
      onApply({
        id: created.id,
        name: created.name,
        filter: created.filter,
        columns: normalizeColumnsPreference(created.columns),
        sort: created.sort,
      });
    } catch (error) {
      notifyError("Couldn’t save the view.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const submitUpdate = async () => {
    if (!activeSavedView) return;
    setSaving(true);
    try {
      const updated = await updateRunView(activeSavedView.id, {
        filter: currentFilter,
        columns: currentColumns,
        sort: currentSort,
      });
      setViews((current) => current.map((v) => (v.id === updated.id ? updated : v)));
      toast.success(`Updated view “${updated.name}”`);
    } catch (error) {
      notifyError("Couldn’t update the view.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const submitDelete = async () => {
    if (!activeSavedView) return;
    setDeleteOpen(false);
    const target = activeSavedView;
    try {
      await deleteRunView(target.id);
      setViews((current) => current.filter((v) => v.id !== target.id));
      toast.success(`Deleted view “${target.name}”`);
      applyPreset(RUN_VIEW_PRESETS[0]?.id ?? "preset:all");
    } catch (error) {
      notifyError("Couldn’t delete the view.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    }
  };

  const activeLabel =
    RUN_VIEW_PRESETS.find((p) => p.id === activeId)?.name ?? activeSavedView?.name ?? "Views";

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-0 max-w-[12rem] gap-1.5">
            <Bookmark aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{activeLabel}</span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
          <DropdownMenuLabel>Presets</DropdownMenuLabel>
          {RUN_VIEW_PRESETS.map((preset) => (
            <DropdownMenuItem key={preset.id} onSelect={() => applyPreset(preset.id)}>
              {activeId === preset.id ? <Check aria-hidden className="size-3.5" /> : <span className="size-3.5" />}
              <span>{preset.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {loading ? (
            <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
          ) : views.length === 0 ? (
            <DropdownMenuItem disabled>No saved views yet</DropdownMenuItem>
          ) : (
            views.map((view) => (
              <DropdownMenuItem key={view.id} onSelect={() => applySavedView(view)}>
                {activeId === view.id ? <Check aria-hidden className="size-3.5" /> : <span className="size-3.5" />}
                <span className="min-w-0 truncate">{view.name}</span>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
            <Save aria-hidden className="size-3.5" />
            <span>Save current view…</span>
          </DropdownMenuItem>
          {activeSavedView ? (
            <>
              <DropdownMenuItem onSelect={() => void submitUpdate()} disabled={saving}>
                <Save aria-hidden className="size-3.5" />
                <span>Update “{activeSavedView.name}”</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 aria-hidden className="size-3.5" />
                <span>Delete “{activeSavedView.name}”</span>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>Captures the current filters, columns, and sort.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="run-view-name">View name</Label>
            <Input
              id="run-view-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. My failing runs this week…"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitSave();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitSave()} disabled={saving || name.trim().length === 0}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{activeSavedView?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved view. The runs it filters to are never affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void submitDelete()}>
                Delete view
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
