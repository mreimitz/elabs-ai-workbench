import { useCallback, useEffect, useMemo, useState } from "react";
import type { Collection, Test, TestAttachmentInput, TestInput } from "@mcp-token-footprint/shared";
import { type ColumnDef, DataTable, SearchInput } from "@elabs-ai/components-data";
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
  Checkbox,
  EmptyState,
  StatePanel,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@elabs-ai/components-ui";
import { HelpCircle, ListChecks, Pencil, PlayCircle, Plus, Trash2 } from "lucide-react";
import {
  addTestAttachment,
  assignTestToCollection,
  createTest,
  deleteTest,
  listCollections,
  listTests,
  removeTestFromCollection,
  updateTest,
} from "../../../lib/api";
import { col, shouldPaginate } from "../../../lib/table";
import { getErrorMessage } from "../../../lib/errors";
import { ViewToolbar } from "../../../components/ViewToolbar";
import { IconButton } from "../../../components/IconButton";
import { RunLauncher } from "../run-launcher/RunLauncher";
import { TestEditor } from "./TestEditor";
import { notifyError } from "../../../lib/notify";

/**
 * Tests, re-homed under a collection (WP 3.1) — the collection is where tests live. Fetches all tests
 * and SCOPES to `collectionId` (tests whose `collectionId` points here; loose legacy tests land in
 * Local after migration). "New test" creates the test IN this collection (`createTest({ …,
 * collectionId })`); editing exposes the TestEditor's "Move to collection" picker (immediate membership
 * write) so a test can be moved out — the scoped list refreshes so it drops away. Self-contained.
 */
export function CollectionTests({ collectionId }: { collectionId: string }) {
  const [tests, setTests] = useState<Test[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Test | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Test | null>(null);
  // The run launcher (WP 3.3) — a row's "Run test" opens it prefilled with that one test.
  const [runTest, setRunTest] = useState<Test | null>(null);

  // `isActive` guards post-`await` writes so a rapid nav / unmount can't clobber the list with a stale
  // response. Defaults to always-apply for the manual callers; the mount effect passes its cancel flag.
  const refresh = useCallback(async (isActive: () => boolean = () => true) => {
    setLoading(true);
    try {
      const [list, collectionList] = await Promise.all([listTests(), listCollections()]);
      if (isActive()) {
        setTests(list);
        setCollections(collectionList);
      }
    } catch (error) {
      if (isActive()) {
        notifyError("Couldn’t load tests.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refresh(() => active);
    return () => {
      active = false;
    };
  }, [refresh]);

  const scoped = useMemo(
    () => tests.filter((t) => t.collectionId === collectionId),
    [tests, collectionId],
  );

  // Search filter is owned here (not delegated to the DataTable's `globalFilter`) so that "select all"
  // targets exactly the rows currently on screen, never hidden ones. Matches name / prompt / profiles.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.userPrompt.toLowerCase().includes(q) ||
        t.addedProfiles.some((p) => p.toLowerCase().includes(q)),
    );
  }, [scoped, search]);

  // Multi-select for bulk delete. Pruned to ids that still exist whenever the scoped list refreshes.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(scoped.map((t) => t.id));
      const next = new Set<string>();
      for (const id of prev) if (valid.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [scoped]);

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));
  const someVisibleSelected = visible.some((t) => selected.has(t.id));
  const toggleAll = useCallback(
    (on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const t of visible) {
          if (on) next.add(t.id);
          else next.delete(t.id);
        }
        return next;
      }),
    [visible],
  );
  const toggleOne = useCallback(
    (id: string, on: boolean) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );

  // "Move to collection" — the editor's picker is an immediate membership write. Refresh after so a test
  // moved OUT of this collection drops from the scoped list (and one moved in appears).
  const handleSetCollection = useCallback(
    async (testId: string, to: string | null, from: string | null) => {
      try {
        if (to) {
          await assignTestToCollection(to, testId);
          toast.success("Moved to collection");
        } else if (from) {
          await removeTestFromCollection(from, testId);
          toast.success("Removed from collection");
        }
        await refresh();
      } catch (error) {
        notifyError("Couldn’t change the test’s collection.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
        throw error;
      }
    },
    [refresh],
  );

  // Returns the saved Test so the editor can target attachment uploads at its id. New tests are created
  // IN this collection; edits preserve membership (moves go through the picker above).
  const handleSave = useCallback(
    async (input: TestInput, existing: Test | null): Promise<Test> => {
      const saved = existing
        ? await updateTest(existing.id, input)
        : await createTest({ ...input, collectionId });
      toast.success(existing ? "Test saved" : "Test created");
      await refresh();
      return saved;
    },
    [refresh, collectionId],
  );

  const handleAddAttachment = useCallback(
    async (testId: string, input: TestAttachmentInput) => {
      const attachment = await addTestAttachment(testId, input);
      toast.success("Attachment added", { description: input.name });
      await refresh();
      return attachment;
    },
    [refresh],
  );

  const performDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteTest(target.id);
      toast.success("Test deleted");
      await refresh();
    } catch (error) {
      notifyError("Couldn’t delete the test.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    }
  }, [pendingDelete, refresh]);

  const performBulkDelete = useCallback(async () => {
    const ids = [...selected];
    setBulkDeleteOpen(false);
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => deleteTest(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    const ok = ids.length - failed;
    if (failed === 0) {
      toast.success(`Deleted ${ok} test${ok === 1 ? "" : "s"}`);
    } else {
      notifyError(`Couldn’t delete ${failed} of ${ids.length} tests.`, {
        description: `The other ${ok} were deleted. Try again for the rest.`,
      });
    }
    setSelected(new Set());
    await refresh();
  }, [selected, refresh]);

  const columns = useMemo(
    () => [
      {
        // Bespoke leading column (not the `col` helper): a non-sortable multi-select checkbox with a
        // select-all/indeterminate header. Drives the "Delete selected" bulk action in the toolbar.
        id: "select",
        enableSorting: false,
        enableGlobalFilter: false,
        header: () => (
          <Checkbox
            aria-label="Select all tests"
            checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
            onCheckedChange={(value) => toggleAll(value === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={selected.has(row.original.id)}
            onCheckedChange={(value) => toggleOne(row.original.id, value === true)}
          />
        ),
      } satisfies ColumnDef<Test>,
      col<Test>({
        id: "name",
        header: "Name",
        value: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      }),
      col<Test>({
        id: "prompt",
        header: "Prompt",
        value: (row) => row.userPrompt,
        cell: (row) => (
          <Text variant="meta" tone="muted" className="block max-w-md truncate">
            {row.userPrompt}
          </Text>
        ),
      }),
      col<Test>({
        id: "attachments",
        header: "Attachments",
        numeric: true,
        value: (row) => row.attachments.length,
      }),
      {
        // Bespoke ColumnDef (not the `col` helper) so the header can carry a tooltip explaining what
        // "Added profiles" means in this context (T7 — the term was unexplained; the column reads
        // `none` for most tests). Sorting/filtering still key off the joined profile list.
        id: "profiles",
        accessorFn: (row) => row.addedProfiles.join(", "),
        enableSorting: true,
        header: () => (
          <span className="inline-flex items-center gap-1">
            <span>Added profiles</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="What are added profiles?"
                  className="size-4 text-muted-foreground"
                >
                  <HelpCircle aria-hidden className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Extra token-estimator lenses applied to this test on top of the environment's
                default profiles — most tests add none.
              </TooltipContent>
            </Tooltip>
          </span>
        ),
        cell: ({ row }) =>
          row.original.addedProfiles.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.original.addedProfiles.map((profile) => (
                <Badge key={profile} variant="secondary" className="font-mono text-meta">
                  {profile}
                </Badge>
              ))}
            </div>
          ) : (
            <Text variant="meta" tone="muted">
              none
            </Text>
          ),
      } satisfies ColumnDef<Test>,
      col<Test>({
        id: "actions",
        header: "",
        value: () => "",
        cell: (row) => (
          <div className="flex justify-end gap-1">
            <IconButton
              variant="ghost"
              size="sm"
              label={`Run ${row.name}`}
              onClick={() => setRunTest(row)}
            >
              <PlayCircle aria-hidden />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              label={`Edit ${row.name}`}
              onClick={() => {
                setEditing(row);
                setEditorOpen(true);
              }}
            >
              <Pencil aria-hidden />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              label={`Delete ${row.name}`}
              onClick={() => setPendingDelete(row)}
            >
              <Trash2 aria-hidden />
            </IconButton>
          </div>
        ),
      }),
    ],
    [selected, allVisibleSelected, someVisibleSelected, toggleAll, toggleOne],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar standard (2026-07-11): ONE row — [search] ····· [New test]. The helper sentence is
          dropped (D-TB1); search filters the table below via the shared `search` state. */}
      <ViewToolbar
        left={
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search tests…"
            label="Search tests"
            containerClassName="w-64"
          />
        }
        actions={
          <>
            {selected.size > 0 ? (
              <Button variant="outline" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 aria-hidden />
                <span>
                  Delete selected (<span className="tabular-nums">{selected.size}</span>)
                </span>
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus aria-hidden />
              <span>New test</span>
            </Button>
          </>
        }
      />

      {loading ? (
        <StatePanel kind="loading" title="Loading tests…" loadingLabel="Loading tests…" />
      ) : scoped.length === 0 ? (
        <EmptyState
          icon={<ListChecks aria-hidden />}
          title="No tests in this collection yet"
          description="A test is a reusable prompt (plus optional attachments and overrides). Create one here to add it to this collection."
          actions={
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus aria-hidden />
              <span>New test</span>
            </Button>
          }
        />
      ) : (
        <DataTable
          data={visible}
          columns={columns}
          enablePagination={shouldPaginate(visible.length, 25)}
          pageSize={25}
          initialView={{ sorting: [{ id: "name", desc: false }] }}
          emptyMessage="No tests match the current search."
        />
      )}

      <TestEditor
        open={editorOpen}
        test={editing}
        onOpenChange={setEditorOpen}
        onSave={handleSave}
        onAddAttachment={handleAddAttachment}
        collections={collections}
        onSetCollection={handleSetCollection}
      />

      <RunLauncher
        open={runTest !== null}
        onOpenChange={(next) => !next && setRunTest(null)}
        intent={{ kind: "tests", testIds: runTest ? [runTest.id] : [], collectionId }}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name ?? "test"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the test and its attachments. Runs already produced from it
              are unaffected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void performDelete()}>
                Delete test
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => !open && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} test{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected test{selected.size === 1 ? "" : "s"} and{" "}
              {selected.size === 1 ? "its" : "their"} attachments. Runs already produced from{" "}
              {selected.size === 1 ? "it" : "them"} are unaffected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void performBulkDelete()}>
                Delete {selected.size} test{selected.size === 1 ? "" : "s"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
