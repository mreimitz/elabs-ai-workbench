import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input, Spinner, Text, Textarea, toast } from "@elabs-ai/components-ui";
import type { HubFile } from "@mcp-token-footprint/shared";
import { HUB_PINNED_FILE_FILENAME_MAX_LENGTH } from "@mcp-token-footprint/shared";
import { FileText, Pin, Plus, Trash2 } from "lucide-react";
import { FieldRow } from "../../../components/FieldRow";
import { IconButton } from "../../../components/IconButton";
import { createHubProjectFile, deleteHubProjectFile, listHubProjectFiles } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { formatBytes } from "../../../lib/format";
import { EditorSection } from "./EditorSection";
import { notifyError } from "../../../lib/notify";

/**
 * Assistant Hub (WP3.1, D-AH11c; restyled ui-wave U6, owner feedback) — a project's PINNED FILES:
 * small, user-typed/pasted text snippets (style guides, glossaries, reference notes) every session
 * in the project inherits via the LAYER 6b prompt injection (`hub/turn-engine.ts`). Deliberately
 * narrower than a general upload widget (no binary/drag-drop — see `hub/routes.ts`'s
 * `registerHubProjectRoutes` doc); each add/remove persists immediately (no separate "Save" step).
 *
 * U6 restyle: the `DataTable` became plain list rows (filename · size · remove) and the full-height
 * dashed `EmptyState` became a one-line quiet note. WHY: a handful of pinned snippets never earns
 * table chrome (sortable headers, pagination, a "Pinned on" column nobody acts on), and the huge
 * empty box was most of what made the old pane read as unfinished. The section now renders inside
 * the shared `EditorSection` card so it lines up with Description/Instructions/Memory.
 */
export function PinnedFilesEditor({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<HubFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setFiles(await listHubProjectFiles(projectId));
    } catch (error) {
      notifyError("Couldn’t load pinned files", { description: getErrorMessage(error) });
    } finally {
      setLoaded(true);
    }
  }, [projectId]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
  }, [refresh]);

  // Newest first — the API lists oldest-first (link creation order) and local adds prepend; sorting
  // here keeps both sources on one consistent order without a table's sort machinery.
  const sorted = useMemo(
    () =>
      [...files].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)),
    [files],
  );

  const handleAdd = async (): Promise<void> => {
    const trimmedName = filename.trim();
    const trimmedContent = content.trim();
    if (!trimmedName || !trimmedContent) return;
    setBusy(true);
    try {
      const file = await createHubProjectFile(projectId, {
        filename: trimmedName,
        content: trimmedContent,
      });
      setFiles((current) => [file, ...current]);
      setFilename("");
      setContent("");
      setAdding(false);
      toast.success("Pinned to project");
    } catch (error) {
      notifyError("Couldn’t pin the file", { description: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (file: HubFile): Promise<void> => {
    try {
      await deleteHubProjectFile(projectId, file.id);
      setFiles((current) => current.filter((f) => f.id !== file.id));
    } catch (error) {
      notifyError("Couldn’t remove the pinned file", { description: getErrorMessage(error) });
    }
  };

  return (
    <EditorSection
      title="Pinned files"
      description="Small text snippets every session inherits — injected into the system prompt (length-capped), never executed."
      actions={
        !adding ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            <span>Add</span>
          </Button>
        ) : undefined
      }
    >
      {adding ? (
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <FieldRow id="pinned-file-name" label="Filename">
            <Input
              id="pinned-file-name"
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder="e.g. style-guide.md…"
              maxLength={HUB_PINNED_FILE_FILENAME_MAX_LENGTH}
              autoComplete="off"
              spellCheck={false}
            />
          </FieldRow>
          <FieldRow id="pinned-file-content" label="Content">
            <Textarea
              id="pinned-file-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste the text to pin…"
              rows={5}
              spellCheck={false}
            />
          </FieldRow>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setFilename("");
                setContent("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleAdd()}
              disabled={busy || !filename.trim() || !content.trim()}
            >
              {busy ? <Spinner className="size-4" aria-hidden /> : null}
              <span>Pin</span>
            </Button>
          </div>
        </div>
      ) : null}

      {!loaded ? (
        <div className="flex items-center gap-2 py-1 text-body text-muted-foreground">
          <Spinner className="size-4" aria-hidden />
          <span>Loading pinned files…</span>
        </div>
      ) : sorted.length === 0 ? (
        // While the add form is open it already explains the empty state (D-HUX14/§8.5's one-empty-
        // state-per-region rule) — render nothing rather than a second note under the form.
        !adding ? (
          <div className="flex items-center gap-2 py-1">
            <Pin aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <Text variant="caption" tone="muted">
              No pinned files yet — add reference text every session in this project inherits.
            </Text>
          </div>
        ) : null
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-border">
          {sorted.map((file) => {
            const name = file.filename ?? file.id;
            return (
              <li key={file.id} className="flex min-w-0 items-center gap-2 py-1.5">
                <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-body" title={name}>
                  {name}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                  {formatBytes(file.bytes)}
                </span>
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  label={`Remove ${file.filename ?? "pinned file"}`}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDelete(file)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </EditorSection>
  );
}
