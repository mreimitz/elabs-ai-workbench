import { useCallback, useEffect, useMemo, useState } from "react";
import type { HubMemory, HubMemoryKind, HubMemoryScope } from "@mcp-token-footprint/shared";
import { HUB_MEMORY_KINDS } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Label,
  Spinner,
  Text,
  Textarea,
  cn,
  toast,
} from "@brand/ui";
import { Brain, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "../../../components/dialogs";
import { FieldRow } from "../../../components/FieldRow";
import { IconButton } from "../../../components/IconButton";
import { SelectField } from "../../../components/SelectField";
import {
  createHubMemory,
  deleteHubMemory,
  listHubMemory,
  updateHubMemory,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { notifyError } from "../../../lib/notify";

/**
 * Assistant Hub UX WP2.7 (D-HUX11, §7.5) — the ONE card-list treatment for memory, parameterized by
 * SCOPE: grouped by kind, each entry shows provenance ("You" vs "Assistant proposed"), supports inline
 * edit, archive/restore, and AlertDialog-confirmed delete — plus, for a still-`proposed` row left over
 * from a transcript the owner didn't act on there, an explicit Accept action (D-AH11's "nothing hidden"
 * — a stray proposal must be reachable from the manage surface too, not just the chip that made it).
 *
 * ## Prop contract (for WP2.3/WP2.4's profile-modal `memorySection` slots)
 *
 * `<ScopedMemoryList scope="agent" scopeId={agentId} />` / `scope="crew"` / `scope="project"` each
 * render that entity's OWN memory, fully self-contained (owns its fetch/create/edit/archive/delete —
 * no data or callbacks to thread in). `scope="profile"` (global memory) omits `scopeId` entirely — a
 * `scopeId` alongside `profile` is a caller bug the API 400s on, so this component never sends one.
 *
 * Fetches via the existing `GET /api/hub/memory` (no server-side scope filter shipped on the route —
 * `apps/api/src/hub/repository.ts`'s `listMemory` supports one, but the route only exposes
 * `status`/`kind`) and filters client-side by scope/scopeId; the app is a single-owner local tool with a
 * small memory table, so this is a deliberate, low-risk trade against touching the route surface.
 */
export type ScopedMemoryListProps = {
  /** The memory scope this list manages — `profile` (global, no owner) or an entity scope requiring
   *  `scopeId` (`project`/`agent`/`crew`). */
  scope: HubMemoryScope;
  /** The owning entity's id. REQUIRED for `project`/`agent`/`crew`; omit for `profile`. */
  scopeId?: string;
  /** Layout-only — merged onto the root container. */
  className?: string;
};

const KIND_LABELS: Record<HubMemoryKind, string> = {
  profile: "Profile",
  preference: "Preference",
  instruction: "Instruction",
};

const KIND_OPTIONS = HUB_MEMORY_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }));

function matchesScope(memory: HubMemory, scope: HubMemoryScope, scopeId: string | undefined): boolean {
  const memoryScope = memory.scope ?? "profile";
  if (memoryScope !== scope) return false;
  if (scope === "profile") return true;
  return (memory.scopeId ?? undefined) === scopeId;
}

function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function MemoryCard({
  memory,
  onAccept,
  onEdit,
  onArchiveToggle,
  onDelete,
}: {
  memory: HubMemory;
  onAccept: (memory: HubMemory) => Promise<void>;
  onEdit: (memory: HubMemory, content: string) => Promise<void>;
  onArchiveToggle: (memory: HubMemory) => Promise<void>;
  onDelete: (memory: HubMemory) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [busy, setBusy] = useState<"accept" | "edit" | "archive" | "delete" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleAccept = async (): Promise<void> => {
    setBusy("accept");
    try {
      await onAccept(memory);
    } catch (error) {
      notifyError("Couldn’t accept the proposal", { description: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleEditSave = async (): Promise<void> => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusy("edit");
    try {
      await onEdit(memory, trimmed);
      setEditing(false);
    } catch (error) {
      notifyError("Couldn’t save the change", { description: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleArchiveToggle = async (): Promise<void> => {
    setBusy("archive");
    try {
      await onArchiveToggle(memory);
    } catch (error) {
      notifyError("Couldn’t update this memory", { description: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setBusy("delete");
    try {
      await onDelete(memory);
      setDeleteOpen(false);
    } catch (error) {
      notifyError("Couldn’t delete this memory", { description: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="shrink-0">
          {memory.source === "user" ? "You" : "Assistant proposed"}
        </Badge>
        {memory.status === "proposed" ? (
          <Badge variant="info" className="shrink-0">
            Awaiting your review
          </Badge>
        ) : memory.status === "archived" ? (
          <Badge variant="outline" className="shrink-0">
            Archived
          </Badge>
        ) : null}
        <Text variant="caption" tone="muted" className="shrink-0">
          {formatSavedAt(memory.createdAt)}
        </Text>
      </div>

      {editing ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            aria-label="Edit memory content"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(memory.content);
                setEditing(false);
              }}
              disabled={busy !== null}
            >
              <X aria-hidden className="size-4" />
              <span>Cancel</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleEditSave()}
              disabled={busy !== null || !draft.trim()}
            >
              {busy === "edit" ? <Spinner className="size-4" aria-hidden /> : <Check aria-hidden className="size-4" />}
              <span>Save</span>
            </Button>
          </div>
        </div>
      ) : (
        <Text className="min-w-0 whitespace-pre-wrap break-words">{memory.content}</Text>
      )}

      {!editing ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-2">
          {memory.status === "proposed" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => void handleAccept()}
              disabled={busy !== null}
            >
              {busy === "accept" ? <Spinner className="size-4" aria-hidden /> : <Check aria-hidden className="size-4" />}
              <span>Accept</span>
            </Button>
          ) : null}
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            label="Edit memory"
            onClick={() => setEditing(true)}
            disabled={busy !== null}
          >
            <Pencil aria-hidden className="size-4" />
          </IconButton>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleArchiveToggle()}
            disabled={busy !== null}
          >
            {busy === "archive" ? <Spinner className="size-4" aria-hidden /> : null}
            <span>{memory.status === "archived" ? "Restore" : "Archive"}</span>
          </Button>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            label="Delete memory"
            onClick={() => setDeleteOpen(true)}
            disabled={busy !== null}
          >
            <Trash2 aria-hidden className="size-4" />
          </IconButton>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this memory?"
        description="This permanently removes it — it will no longer be shown to the assistant."
        confirmLabel="Delete memory"
        tone="destructive"
        busy={busy === "delete"}
        onConfirm={() => void handleDelete()}
      />
    </li>
  );
}

export function ScopedMemoryList({ scope, scopeId, className }: ScopedMemoryListProps) {
  const [memories, setMemories] = useState<HubMemory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addKind, setAddKind] = useState<HubMemoryKind>("preference");
  const [addContent, setAddContent] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const all = await listHubMemory();
      setMemories(all.filter((memory) => matchesScope(memory, scope, scopeId)));
    } catch (error) {
      notifyError("Couldn’t load memory", { description: getErrorMessage(error) });
    } finally {
      setLoaded(true);
    }
  }, [scope, scopeId]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
  }, [refresh]);

  const visible = useMemo(
    () => (showArchived ? memories : memories.filter((m) => m.status !== "archived")),
    [memories, showArchived],
  );

  const groups = useMemo(
    () =>
      HUB_MEMORY_KINDS.map((kind) => ({
        kind,
        entries: visible.filter((m) => m.kind === kind),
      })).filter((group) => group.entries.length > 0),
    [visible],
  );

  const handleAdd = async (): Promise<void> => {
    const trimmed = addContent.trim();
    if (!trimmed) return;
    setAddBusy(true);
    try {
      const created = await createHubMemory({
        kind: addKind,
        content: trimmed,
        ...(scope !== "profile" ? { scope, scopeId } : {}),
      });
      setMemories((current) => [created, ...current]);
      setAddContent("");
      setAdding(false);
      toast.success("Memory added");
    } catch (error) {
      notifyError("Couldn’t add memory", { description: getErrorMessage(error) });
    } finally {
      setAddBusy(false);
    }
  };

  const handleAccept = async (memory: HubMemory): Promise<void> => {
    const updated = await updateHubMemory(memory.id, { status: "active" });
    setMemories((current) => current.map((m) => (m.id === updated.id ? updated : m)));
    toast.success("Memory accepted");
  };

  const handleEdit = async (memory: HubMemory, content: string): Promise<void> => {
    const updated = await updateHubMemory(memory.id, { content });
    setMemories((current) => current.map((m) => (m.id === updated.id ? updated : m)));
    toast.success("Memory saved");
  };

  const handleArchiveToggle = async (memory: HubMemory): Promise<void> => {
    const updated = await updateHubMemory(memory.id, {
      status: memory.status === "archived" ? "active" : "archived",
    });
    setMemories((current) => current.map((m) => (m.id === updated.id ? updated : m)));
  };

  const handleDelete = async (memory: HubMemory): Promise<void> => {
    await deleteHubMemory(memory.id);
    setMemories((current) => current.filter((m) => m.id !== memory.id));
    toast.success("Memory deleted");
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex cursor-pointer items-center gap-2 font-normal text-caption text-muted-foreground">
          <Checkbox
            checked={showArchived}
            onCheckedChange={(next) => setShowArchived(next === true)}
          />
          <span>Show archived</span>
        </Label>
        {!adding ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            <span>Add</span>
          </Button>
        ) : null}
      </div>

      {adding ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <FieldRow id="scoped-memory-kind" label="Kind">
            <SelectField
              id="scoped-memory-kind"
              label=""
              value={addKind}
              onChange={(next) => setAddKind(next as HubMemoryKind)}
              options={KIND_OPTIONS}
            />
          </FieldRow>
          <FieldRow id="scoped-memory-content" label="Content">
            <Textarea
              id="scoped-memory-content"
              value={addContent}
              onChange={(event) => setAddContent(event.target.value)}
              placeholder="e.g. Prefers concise answers with tabular numbers…"
              rows={3}
            />
          </FieldRow>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setAddContent("");
              }}
              disabled={addBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleAdd()}
              disabled={addBusy || !addContent.trim()}
            >
              {addBusy ? <Spinner className="size-4" aria-hidden /> : null}
              <span>Add memory</span>
            </Button>
          </div>
        </div>
      ) : null}

      {!loaded ? (
        <div className="flex items-center gap-2 py-2 text-body text-muted-foreground">
          <Spinner className="size-4" aria-hidden />
          <span>Loading memory…</span>
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          className="mt-2"
          icon={<Brain aria-hidden />}
          title="No memory saved yet"
          description="Add a note, or accept one the assistant proposes in a conversation."
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {groups.map((group) => (
            <div key={group.kind} className="flex min-w-0 flex-col gap-1.5">
              <Text variant="meta" tone="muted" className="uppercase tracking-wide">
                {KIND_LABELS[group.kind]} · {group.entries.length}
              </Text>
              <ul className="flex min-w-0 flex-col gap-2">
                {group.entries.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    onAccept={handleAccept}
                    onEdit={handleEdit}
                    onArchiveToggle={handleArchiveToggle}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
