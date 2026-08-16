import { useCallback, useEffect, useState } from "react";
import type {
  Collection,
  CollectionSyncResult,
  CollectionSyncState,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Descriptions,
  DescriptionsItem,
  EmptyState,
  MetricCard,
  StatePanel,
  Text,
  toast,
} from "@brand/ui";
import { GitBranch, KeyRound, Lock, Pencil, RefreshCw, RotateCw } from "lucide-react";
import { getCollectionStatus, syncCollection, updateCollection } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { CollectionEditor, type CollectionEditorSubmit } from "./CollectionEditor";
import { ConflictResolution } from "./ConflictResolution";
import { hasPendingWork, lastSyncedLabel, syncChips } from "./collection-status";
import { notifyError } from "../../../lib/notify";

const SYNC_STATUS_MESSAGE: Record<CollectionSyncResult["status"], string> = {
  unchanged: "Already in sync — nothing to push or pull.",
  pushed: "Pushed local changes to the remote.",
  pulled: "Pulled remote changes into your library.",
  merged: "Merged both sides and pushed.",
  conflicts: "Merge conflicts need resolving before this can finish.",
};

/**
 * The Git tab of a collection (WP 3.1). When the collection is BOUND to a repo it shows the existing
 * two-way sync UI (binding descriptions, live sync-state metrics + chips, refresh, the Sync action, and
 * conflict resolution). When UNBOUND it shows an honest "Bind to GitHub" CTA — no fake sync affordances —
 * that opens the {@link CollectionEditor} (repoUrl · path · branch · write-only PAT) and binds via
 * `updateCollection`. Status is only fetched for a bound collection (an unbound one 400s REPO_NOT_BOUND).
 */
export function CollectionGit({
  collection,
  onChanged,
}: {
  collection: Collection;
  /** Called after a bind/edit or a member-reconciling sync so the parent can re-fetch the collection. */
  onChanged: () => void | Promise<void>;
}) {
  const bound = Boolean(collection.repoUrl);
  const collectionId = collection.id;

  const [status, setStatus] = useState<CollectionSyncState | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  const loadStatus = useCallback(
    async (isActive: () => boolean = () => true) => {
      if (!bound) return;
      setStatusLoading(true);
      setStatusError(null);
      try {
        const state = await getCollectionStatus(collectionId);
        if (isActive()) setStatus(state);
      } catch (error) {
        if (isActive()) setStatusError(getErrorMessage(error, "Couldn’t read the sync status."));
      } finally {
        if (isActive()) setStatusLoading(false);
      }
    },
    [bound, collectionId],
  );

  useEffect(() => {
    let active = true;
    void loadStatus(() => active);
    return () => {
      active = false;
    };
  }, [loadStatus]);

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await syncCollection(collectionId);
      setStatus(result.state);
      if (result.status === "conflicts") {
        toast.warning("Merge conflicts", { description: SYNC_STATUS_MESSAGE.conflicts });
      } else {
        toast.success("Sync complete", { description: SYNC_STATUS_MESSAGE[result.status] });
        // A pull may have reconciled members into the DB — let the parent refresh.
        await onChanged();
      }
    } catch (error) {
      notifyError("Couldn’t sync the collection.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setSyncing(false);
    }
  }, [collectionId, onChanged]);

  const onResolved = useCallback(
    async (result: CollectionSyncResult) => {
      setStatus(result.state);
      if (result.status === "conflicts") {
        toast.warning("Still conflicted", { description: "Some files still need a resolution." });
      } else {
        toast.success("Conflicts resolved", { description: SYNC_STATUS_MESSAGE[result.status] });
        await onChanged();
      }
    },
    [onChanged],
  );

  const handleEditorSubmit = useCallback(
    async ({ input }: CollectionEditorSubmit) => {
      const updated = await updateCollection(collectionId, input);
      toast.success(bound ? "Binding updated" : "Bound to GitHub", { description: updated.name });
      await onChanged();
      await loadStatus();
    },
    [collectionId, bound, onChanged, loadStatus],
  );

  if (!bound) {
    // D-UX11 (LOCKED) — the reserved default "Local" collection can NEVER bind to git. Its Bind
    // button is disabled with an inline explanation that matches the detail header's copy ("It can't
    // be deleted or bound to a repo"); no editor opens. Every other collection binds normally.
    const isLocal = collection.isDefault === true;
    return (
      <>
        <EmptyState
          icon={isLocal ? <Lock aria-hidden /> : <GitBranch aria-hidden />}
          title={isLocal ? "Local can't be bound to a repository" : "Not bound to a repository"}
          description={
            isLocal
              ? "This is your default, always-present collection — it can't be deleted or bound to a repo. To git-back tests, create another collection and bind that one, then move the tests into it."
              : "This is a local collection. Bind it to a GitHub repo to share and version its tests and suites with a team — sync is two-way, a real merge, never a force-push."
          }
          actions={
            <Button disabled={isLocal} onClick={() => setEditorOpen(true)}>
              <GitBranch aria-hidden />
              <span>Bind to GitHub</span>
            </Button>
          }
        />
        {isLocal ? null : (
          <CollectionEditor
            open={editorOpen}
            collection={collection}
            onOpenChange={setEditorOpen}
            onSubmit={handleEditorSubmit}
          />
        )}
      </>
    );
  }

  const conflicts = status?.conflicts ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={() => setEditorOpen(true)}>
          <Pencil aria-hidden />
          <span>Edit binding</span>
        </Button>
        <Button onClick={() => void runSync()} disabled={syncing || conflicts.length > 0}>
          <RotateCw className={syncing ? "animate-spin" : undefined} aria-hidden />
          <span>{syncing ? "Syncing…" : "Sync"}</span>
        </Button>
      </div>

      {/* Binding */}
      <Card>
        <CardContent className="py-4">
          <Descriptions columns={2} layout="horizontal">
            <DescriptionsItem label="Repository">
              <span className="break-all font-mono text-meta">{collection.repoUrl}</span>
            </DescriptionsItem>
            <DescriptionsItem label="Branch">
              <span className="font-mono text-meta">{collection.branch}</span>
            </DescriptionsItem>
            <DescriptionsItem label="Path in repo">
              <span className="font-mono text-meta">{collection.repoPath || "(repo root)"}</span>
            </DescriptionsItem>
            <DescriptionsItem label="Auth">
              {collection.hasPat ? (
                <Badge variant="secondary">
                  <KeyRound aria-hidden className="size-3" />
                  PAT set
                </Badge>
              ) : (
                <Text variant="meta" tone="muted">
                  public / no token
                </Text>
              )}
            </DescriptionsItem>
            <DescriptionsItem label="Last sync">
              <span className="font-mono text-meta">{lastSyncedLabel(collection)}</span>
            </DescriptionsItem>
          </Descriptions>
        </CardContent>
      </Card>

      {/* Sync-state / diff preview */}
      <section className="flex flex-col gap-3" aria-label="Sync state">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text className="font-medium">Pending changes</Text>
          <div className="flex items-center gap-2">
            {status ? (
              <div className="flex flex-wrap gap-1.5">
                {syncChips(status).map((chip) => (
                  <Badge key={chip.key} variant={chip.variant}>
                    {chip.label}
                  </Badge>
                ))}
              </div>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadStatus()}
              disabled={statusLoading}
            >
              <RefreshCw className={statusLoading ? "animate-spin" : undefined} aria-hidden />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {statusLoading && !status ? (
          <StatePanel
            kind="loading"
            title="Reading sync status…"
            loadingLabel="Fetching the remote…"
          />
        ) : statusError ? (
          <StatePanel kind="error" title="Couldn’t read the sync status." description={statusError} />
        ) : status ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard
                label="Ahead"
                value={String(status.ahead)}
                description="local commits to push"
              />
              <MetricCard
                label="Behind"
                value={String(status.behind)}
                description="remote commits to pull"
              />
              <MetricCard
                label="Uncommitted"
                value={status.dirty ? "yes" : "no"}
                description="local member edits"
              />
              <MetricCard
                label="Conflicts"
                value={String(status.conflicts.length)}
                description="files to resolve"
              />
            </div>
            {!hasPendingWork(status) ? (
              <Text variant="meta" tone="muted">
                This collection is fully in sync with its remote.
              </Text>
            ) : null}
          </>
        ) : null}
      </section>

      {/* Conflict resolution takes over when the branch is conflicted. */}
      {conflicts.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="Conflict resolution">
          <Text className="font-medium">Resolve conflicts</Text>
          <ConflictResolution
            collectionId={collection.id}
            conflicts={conflicts}
            onResolved={(result) => void onResolved(result)}
          />
        </section>
      ) : null}

      <CollectionEditor
        open={editorOpen}
        collection={collection}
        onOpenChange={setEditorOpen}
        onSubmit={handleEditorSubmit}
      />
    </div>
  );
}
