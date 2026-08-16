import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Collection, CollectionSyncState } from "@mcp-token-footprint/shared";
import { DEFAULT_COLLECTION_NAME } from "@mcp-token-footprint/shared";
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
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Heading,
  Input,
  Skeleton,
  Spinner,
  StatePanel,
  Text,
  buttonVariants,
  toast,
} from "@brand/ui";
import { SearchInput } from "@brand/data";
import {
  ClipboardCheck,
  ClipboardList,
  Download,
  FolderGit2,
  KeyRound,
  Lock,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  createCollection,
  deleteCollection,
  getCollectionStatus,
  listCollections,
} from "../../../lib/api";
import type { InsightBenchImportResult } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { PageShell } from "../../../components/PageShell";
import { ResultCount } from "../../../components/ResultCount";
import { ViewToolbar } from "../../../components/ViewToolbar";
import { FieldRow } from "../../../components/FieldRow";
import { IconButton } from "../../../components/IconButton";
import { ImportInsightBenchDialog } from "./ImportInsightBenchDialog";
import { lastSyncedLabel, syncChips } from "./collection-status";
import { notifyError } from "../../../lib/notify";

type StatusEntry = { state?: CollectionSyncState; loading: boolean; error?: string };

/**
 * Collections (WP 3.1) — the test home. The reserved **Local** collection (`isDefault`) is pinned
 * FIRST, badged, and undeletable; every test lives in a collection and unassigned tests land in Local.
 * "New collection" creates a LOCAL (unbound) collection with just a name — git binding is a separate
 * action on the detail's Git tab. Bound collections load live sync-state chips per row (`GET /:id/
 * status`); local collections skip that (they have no remote). Selecting a collection deep-links to its
 * detail (`/testing/collections/:id`). Self-contained: fetches its own collections.
 */
export function CollectionsView() {
  const navigate = useNavigate();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, StatusEntry>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Collection | null>(null);
  // C-7 (empty toolbar) — once there's something to search, the toolbar's `left` cluster carries a
  // real search field (matching the EnvironmentsView B-2 fix) instead of sitting near-empty.
  const [search, setSearch] = useState("");

  const loadStatus = useCallback(async (id: string) => {
    setStatuses((prev) => ({ ...prev, [id]: { ...prev[id], loading: true, error: undefined } }));
    try {
      const state = await getCollectionStatus(id);
      setStatuses((prev) => ({ ...prev, [id]: { state, loading: false } }));
    } catch (error) {
      setStatuses((prev) => ({ ...prev, [id]: { loading: false, error: getErrorMessage(error) } }));
    }
  }, []);

  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      setLoading(true);
      try {
        const list = await listCollections();
        if (!isActive()) return;
        setCollections(list);
        // Kick off a status fetch per BOUND collection (each does a real clone/fetch — tolerate
        // failures). Local/unbound collections have no remote, so they skip status entirely.
        for (const c of list) if (c.repoUrl) void loadStatus(c.id);
      } catch (error) {
        if (isActive()) {
          notifyError("Couldn’t load collections.", {
            description: `${getErrorMessage(error)} Try again.`,
          });
        }
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [loadStatus],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  // Local pinned first (there is exactly one `isDefault`), the rest in API order.
  const ordered = useMemo(() => {
    const local = collections.filter((c) => c.isDefault);
    const rest = collections.filter((c) => !c.isDefault);
    return [...local, ...rest];
  }, [collections]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((c) => c.name.toLowerCase().includes(q));
  }, [ordered, search]);

  const handleCreate = useCallback(
    async (name: string) => {
      // A LOCAL (unbound) collection — no repo demanded. Binding is a separate action on the detail.
      const created = await createCollection({ name });
      toast.success("Collection created", { description: created.name });
      await load();
      navigate(`/testing/collections/${created.id}`);
    },
    [load, navigate],
  );

  const handleImported = useCallback(
    (result: InsightBenchImportResult) => {
      toast.success("InsightBench imported", {
        description: `${result.created} tests created · ${result.skipped} skipped · 1 suite`,
      });
      void load();
      navigate(`/testing/suites/${result.suiteId}`);
    },
    [load, navigate],
  );

  const performDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteCollection(target.id);
      toast.success("Collection deleted");
      await load();
    } catch (error) {
      notifyError("Couldn’t delete the collection.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    }
  }, [pendingDelete, load]);

  return (
    <PageShell
      headerVariant="toolbar"
      width="full"
      header={
        // Toolbar standard (2026-07-11): breadcrumb → ONE ViewToolbar row → content. The breadcrumb
        // (Home / Collections) names the page — no in-page H1/description (D-TB1). C-7 (empty
        // toolbar): with nothing yet to organize, the onboarding sentence moves onto the zero-state
        // card below and the ⓘ tooltip is omitted so the bar isn't a lone tooltip + two buttons; once
        // there's at least one collection, the ⓘ returns AND `left` carries a real search field (the
        // EnvironmentsView B-2 pattern), so the row always carries real content, not a near-empty band.
        <ViewToolbar
          info={
            collections.length > 0 ? (
              <p className="max-w-xs text-pretty">
                The home for your tests and suites. Every test lives in a collection; bind a
                collection to a git repo to share and version it with a team.
              </p>
            ) : undefined
          }
          left={
            collections.length > 0 ? (
              <div className="w-56 min-w-[10rem]">
                <SearchInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search collections…"
                  label="Search collections"
                />
              </div>
            ) : undefined
          }
          results={
            collections.length > 0 ? (
              <ResultCount>
                {filtered.length} {filtered.length === 1 ? "collection" : "collections"}
              </ResultCount>
            ) : undefined
          }
          actions={
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Download aria-hidden />
                <span>Import</span>
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden />
                <span>New collection</span>
              </Button>
            </>
          }
        />
      }
    >
      {/* Breadcrumb-named page — keep an AT-only H1 now that the title block is gone (D-TB1). */}
      <Heading level={1} className="sr-only">
        Collections
      </Heading>

      {loading ? (
        <StatePanel
          kind="loading"
          title="Loading collections…"
          loadingLabel="Loading collections…"
        />
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 aria-hidden />}
          title="No collections yet"
          description="The home for your tests and suites — every test lives in a collection. Create a local one to organize them, bind it to a git repo later to share and version it with a team, or import a colleague's InsightBench questions."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Download aria-hidden />
                <span>Import InsightBench</span>
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden />
                <span>New collection</span>
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 aria-hidden />}
          title="No collections match your search"
          description={`No collection name contains "${search}".`}
          actions={
            <Button variant="outline" onClick={() => setSearch("")}>
              Clear filter
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((collection) => (
            <li key={collection.id}>
              <CollectionRow
                collection={collection}
                status={statuses[collection.id]}
                onOpen={() => navigate(`/testing/collections/${collection.id}`)}
                onDelete={collection.isDefault ? undefined : () => setPendingDelete(collection)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Review section (toolbar-reach WP 4.3 · finding B-6). The Review surface + its rubrics used
          to be reachable ONLY by URL (a "Review these…" button on the runs feed, and Settings →
          Testing for the rubrics) — "if an operator can't find a feature without knowing its URL, it
          isn't shipped". Rather than a fifth nav item, they surface as a section here in Collections,
          the test home. Both destinations render usefully with zero query params (D-TB10): the
          review surface opens its rubric picker; the rubric manager lists every rubric. Kept below
          the collections list so the primary content leads. Hidden only while collections load. */}
      {loading ? null : <ReviewSection onNavigate={navigate} />}

      <NewCollectionDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />

      <ImportInsightBenchDialog
        open={importOpen}
        collections={collections}
        onOpenChange={setImportOpen}
        onImported={handleImported}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name ?? "collection"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the collection. Its member tests and suites become local-only (moved back
              to {DEFAULT_COLLECTION_NAME}; the git repo, if any, is untouched). This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => void performDelete()}
            >
              Delete collection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/** A name-only create dialog — a new collection starts LOCAL (unbound); git is bound later on the detail. */
function NewCollectionDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError(null);
    setSaving(false);
  }, [open]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the collection a name.");
      document.getElementById("new-collection-name")?.focus();
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onCreate(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(`Couldn’t create the collection. ${getErrorMessage(err)} Try again.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New collection</DialogTitle>
          <DialogDescription>
            A local collection to organize tests and suites. You can bind it to a GitHub repo later
            from its Git tab.
          </DialogDescription>
        </DialogHeader>
        <FieldRow id="new-collection-name" label="Name" error={error ?? undefined}>
          <Input
            id="new-collection-name"
            name="new-collection-name"
            value={name}
            placeholder="Finance benchmarks…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </FieldRow>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? <Spinner className="size-4" /> : <Save aria-hidden />}
            <span>{saving ? "Creating…" : "Create collection"}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CollectionRow({
  collection,
  status,
  onOpen,
  onDelete,
}: {
  collection: Collection;
  status: StatusEntry | undefined;
  onOpen: () => void;
  /** Omitted for the undeletable Local collection. */
  onDelete?: () => void;
}) {
  const bound = Boolean(collection.repoUrl);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text className="min-w-0 truncate font-medium">{collection.name}</Text>
            {collection.isDefault ? (
              <Badge variant="secondary">
                <Lock aria-hidden className="size-3" />
                Local
              </Badge>
            ) : null}
            {collection.hasPat ? (
              <Badge variant="secondary">
                <KeyRound aria-hidden className="size-3" />
                PAT
              </Badge>
            ) : null}
            {bound ? (
              status?.loading ? (
                <Skeleton className="h-5 w-16 rounded-full" />
              ) : status?.error ? (
                <Badge variant="outline">status unavailable</Badge>
              ) : status?.state ? (
                <div className="flex flex-wrap gap-1.5">
                  {syncChips(status.state).map((chip) => (
                    <Badge key={chip.key} variant={chip.variant}>
                      {chip.label}
                    </Badge>
                  ))}
                </div>
              ) : null
            ) : collection.isDefault ? null : (
              <Badge variant="outline">local only</Badge>
            )}
          </div>
          {/* C-7 (monospace prose) — a real repo path/branch is a code-like identifier and stays
              monospace; "not bound to a repository" is prose, so it renders in the body face. */}
          {bound ? (
            // D-IC10 (interface-craft WP 2.1) — the composed repo/path/branch line truncates at
            // narrow widths; carry the full text as a `title` so it's recoverable on hover.
            <Text
              variant="meta"
              tone="muted"
              className="min-w-0 truncate font-mono"
              title={`${collection.repoUrl}${collection.repoPath ? ` · ${collection.repoPath}` : ""} · ${collection.branch} · ${lastSyncedLabel(collection)}`}
            >
              {`${collection.repoUrl}${collection.repoPath ? ` · ${collection.repoPath}` : ""} · ${collection.branch} · ${lastSyncedLabel(collection)}`}
            </Text>
          ) : (
            <Text variant="meta" tone="muted" className="min-w-0 truncate">
              not bound to a repository
            </Text>
          )}
        </div>
        {/* C-7 (ragged action alignment) — the action cluster is a fixed footprint whether or not
            Delete renders: an invisible `size-8` placeholder fills the delete slot for the
            undeletable Local row, so every row's Open button lands at the same x. */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={onOpen}>
            Open
          </Button>
          {onDelete ? (
            <IconButton
              variant="ghost"
              size="icon-sm"
              label={`Delete ${collection.name}`}
              onClick={onDelete}
            >
              <Trash2 aria-hidden />
            </IconButton>
          ) : (
            <span aria-hidden className="size-8" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The Review section on the Collections page (toolbar-reach WP 4.3 · finding B-6). These two entry
 * cards keep the review surface (`/testing/review`) and its rubric manager
 * (`/testing/observability/review-rubrics`) discoverable from the test home. design-remediation T8
 * also gave Review its own Testing nav item (and Review rubrics a Setup nav item), so these cards are
 * now a convenience shortcut rather than the only reachable path. Each destination renders usefully
 * with zero query params (D-TB10).
 */
function ReviewSection({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <section aria-label="Review" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Heading level={2} size="subtitle">
          Review
        </Heading>
        <Text variant="meta" tone="muted" className="text-pretty">
          Human review of your test runs, kept separate from automated grades — walk runs against a
          rubric, or manage the rubrics reviewers use.
        </Text>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ReviewEntryCard
          icon={<ClipboardCheck aria-hidden />}
          title="Review runs"
          description="Pick a rubric and walk the matching runs keyboard-first, recording thumbs, 1–5 scores, or notes as ordinary feedback."
          actionLabel="Open review"
          onOpen={() => onNavigate("/testing/review")}
        />
        <ReviewEntryCard
          icon={<ClipboardList aria-hidden />}
          title="Review rubrics"
          description="Create and manage the checklists reviewers walk. A rubric's answers are recorded as human feedback, never as grades."
          actionLabel="Manage rubrics"
          onOpen={() => onNavigate("/testing/observability/review-rubrics")}
        />
      </div>
    </section>
  );
}

/** One Review entry card — an icon, a title, an explanation, and the navigation action. */
function ReviewEntryCard({
  icon,
  title,
  description,
  actionLabel,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onOpen: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-3 py-4">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
          <Text className="font-medium">{title}</Text>
        </div>
        <Text variant="meta" tone="muted" className="min-w-0 flex-1 text-pretty">
          {description}
        </Text>
        <div>
          <Button variant="outline" size="sm" onClick={onOpen}>
            {actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
