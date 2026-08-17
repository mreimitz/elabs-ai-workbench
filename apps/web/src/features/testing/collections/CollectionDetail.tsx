import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Collection } from "@mcp-token-footprint/shared";
import { Badge, Button, Heading, StatePanel, Tabs, TabsContent, TabsList, TabsTrigger, Text, toast } from "@elabs-ai/components-ui";
import {
  ArrowLeft,
  FolderGit2,
  GitBranch,
  Layers,
  ListChecks,
  Lock,
  PlayCircle,
  Trash2,
} from "lucide-react";
import { ApiError, deleteCollection, getCollection } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { ConfirmDialog } from "../../../components/dialogs";
import { PageShell } from "../../../components/PageShell";
import { ViewToolbar } from "../../../components/ViewToolbar";
import { RunLauncher } from "../run-launcher/RunLauncher";
import { CollectionTests } from "./CollectionTests";
import { CollectionSuites } from "./CollectionSuites";
import { CollectionGit } from "./CollectionGit";
import { notifyError } from "../../../lib/notify";

type DetailTab = "tests" | "suites" | "git";

/**
 * Collection detail (WP 3.1) — the collection is the home for tests and suites. Three tabs:
 * **Tests** (the re-homed, scoped test authoring surface), **Suites** (this collection's suites,
 * scoped read-only + links), and **Git** (the two-way sync UI when bound, or a "Bind to GitHub" CTA
 * when local). The reserved **Local** collection (`isDefault`) is undeletable — its Delete action is
 * hidden. Self-contained: fetches its own collection; the tabs each fetch their own data.
 */
export function CollectionDetail() {
  const navigate = useNavigate();
  const { collectionId } = useParams();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // D-8 — a bad/deleted collection id is an expected "nothing here" (the API 404s), not a genuine
  // failure; it gets its own EMPTY-state branch below instead of falling into the pink `ErrorState`
  // that's reserved for a real fetch failure (network error / non-404 5xx).
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<DetailTab>("tests");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The run launcher (WP 3.3) — "Run collection" opens it prefilled with every test in this collection.
  const [launcherOpen, setLauncherOpen] = useState(false);

  const loadCollection = useCallback(
    async (isActive: () => boolean = () => true) => {
      if (!collectionId) return;
      setLoading(true);
      setLoadError(null);
      setNotFound(false);
      try {
        const c = await getCollection(collectionId);
        if (isActive()) setCollection(c);
      } catch (error) {
        if (!isActive()) return;
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(`${getErrorMessage(error, "Couldn’t load this collection.")} Try refreshing the page.`);
        }
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [collectionId],
  );

  useEffect(() => {
    let active = true;
    void loadCollection(() => active);
    return () => {
      active = false;
    };
  }, [loadCollection]);

  const performDelete = useCallback(async () => {
    if (!collectionId) return;
    setDeleting(true);
    try {
      await deleteCollection(collectionId);
      toast.success("Collection deleted");
      setConfirmingDelete(false);
      navigate("/testing/collections");
    } catch (error) {
      notifyError("Couldn’t delete the collection.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setDeleting(false);
    }
  }, [collectionId, navigate]);

  if (loading) {
    return (
      <PageShell>
        <StatePanel kind="loading" title="Loading collection…" loadingLabel="Loading collection…" />
      </PageShell>
    );
  }

  if (notFound) {
    // D-8 — "not found" is an expected empty state (dashed card), not a genuine failure: the
    // pink `ErrorState`/`StatePanel kind="error"` is reserved for a real fetch failure below.
    return (
      <PageShell>
        <StatePanel
          kind="empty"
          icon={<FolderGit2 aria-hidden />}
          title="Collection not found"
          description="It may have been deleted, or the link is out of date."
          actions={
            <Button variant="outline" onClick={() => navigate("/testing/collections")}>
              <ArrowLeft aria-hidden />
              <span>Back to collections</span>
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (loadError || !collection) {
    return (
      <PageShell>
        <StatePanel
          kind="error"
          title="Couldn’t load this collection."
          description={loadError ?? "Try refreshing the page."}
        />
      </PageShell>
    );
  }

  const isLocal = collection.isDefault === true;

  return (
    <PageShell
      headerVariant="toolbar"
      width="full"
      header={
        // Toolbar standard (2026-07-11): breadcrumb → ONE ViewToolbar row → content. Identity is the
        // breadcrumb leaf (App.tsx publishes the collection name), NOT an in-page title (D-TB1); the
        // binding chip carries the Local / git-bound state (so the descriptions are dropped — the chip
        // + Git tab convey them). Run collection is the primary action; Delete stays as a secondary
        // action for non-local collections (its only other home is the list row).
        <ViewToolbar
          left={<CollectionBindingChip collection={collection} />}
          actions={
            <>
              {isLocal ? null : (
                <>
                  <Button variant="outline" onClick={() => setConfirmingDelete(true)}>
                    <Trash2 aria-hidden />
                    <span>Delete</span>
                  </Button>
                  {/* Destructive/primary adjacency (P1) — Delete used to sit immediately left of the
                      primary Run collection button, one misclick apart. A visible divider (not just
                      spacing, which a dense toolbar can visually swallow) keeps them apart. */}
                  <span aria-hidden className="mx-1 h-5 w-px bg-border" />
                </>
              )}
              <Button onClick={() => setLauncherOpen(true)}>
                <PlayCircle aria-hidden />
                <span>Run collection</span>
              </Button>
            </>
          }
        />
      }
    >
      {/* Breadcrumb-named page (Collections / <name>) — keep an AT-only H1 (D-TB1). */}
      <Heading level={1} className="sr-only">
        {collection.name}
      </Heading>

      <RunLauncher
        open={launcherOpen}
        onOpenChange={setLauncherOpen}
        intent={{ kind: "collection", collectionId: collection.id }}
      />

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as DetailTab)}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="tests" className="gap-1.5">
            <ListChecks aria-hidden className="size-3.5" />
            <span>Tests</span>
          </TabsTrigger>
          <TabsTrigger value="suites" className="gap-1.5">
            <Layers aria-hidden className="size-3.5" />
            <span>Suites</span>
          </TabsTrigger>
          <TabsTrigger value="git" className="gap-1.5">
            <GitBranch aria-hidden className="size-3.5" />
            <span>Git</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tests">
          <CollectionTests collectionId={collection.id} />
        </TabsContent>
        <TabsContent value="suites">
          <CollectionSuites collectionId={collection.id} />
        </TabsContent>
        <TabsContent value="git">
          <CollectionGit collection={collection} onChanged={() => loadCollection()} />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={(open) => !open && setConfirmingDelete(false)}
        title={`Delete ${collection.name}?`}
        description="This removes the collection. Its member tests and suites become local-only (moved back to Local; the git repo, if any, is untouched). This action cannot be undone."
        confirmLabel="Delete collection"
        tone="destructive"
        busy={deleting}
        onConfirm={() => void performDelete()}
      />
    </PageShell>
  );
}

/**
 * The binding chip for the detail toolbar's `left` cluster (toolbar standard 2026-07-11). Names the
 * collection's home in ONE chip — mirroring the list row's language: the reserved **Local** collection
 * (Lock), a **git-bound** collection (its repo · path · branch as truncating muted meta), or an unbound
 * **local-only** collection.
 */
function CollectionBindingChip({ collection }: { collection: Collection }) {
  if (collection.isDefault) {
    return (
      <Badge variant="secondary">
        <Lock aria-hidden className="size-3" />
        Local
      </Badge>
    );
  }
  if (collection.repoUrl) {
    return (
      <>
        <Badge variant="secondary" className="shrink-0">
          <GitBranch aria-hidden className="size-3" />
          Git-bound
        </Badge>
        <Text variant="meta" tone="muted" className="min-w-0 truncate font-mono">
          {collection.repoUrl}
          {collection.repoPath ? ` · ${collection.repoPath}` : ""} · {collection.branch}
        </Text>
      </>
    );
  }
  return <Badge variant="outline">local only</Badge>;
}
