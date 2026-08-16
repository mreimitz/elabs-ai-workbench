import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Spinner,
  Text,
} from "@brand/ui";
import type { HubFile } from "@mcp-token-footprint/shared";
import { getHubProjectFile } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

/**
 * Assistant Hub UX (WP1.8 integration) — the light, read-only viewer for a project's pinned file,
 * opened from the meta rail's Context section (`onOpenPinnedFile`). The retired `SessionContextPanel`
 * drilled into a pinned file's full text via `@brand/ai`'s `ContextPanel` detail pane; the rail's
 * Context section is pure and "lists — the caller shows", so this dialog IS the "show". Deliberately
 * minimal (fetch-on-open + a scrollable monospace preview) — the full pinned-file management (add /
 * remove / re-pin) stays on the Projects page, unchanged.
 */
export function HubPinnedFileDialog({
  projectId,
  file,
  onClose,
}: {
  projectId: string | null;
  file: HubFile | null;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    getHubProjectFile(projectId, file.id)
      .then((detail) => {
        if (!cancelled) setContent(detail.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, projectId]);

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="min-w-0 truncate" title={file?.filename ?? file?.id}>
            {file?.filename ?? file?.id ?? "Pinned file"}
          </DialogTitle>
          <DialogDescription>A project file pinned into this session's context.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-body text-muted-foreground">
            <Spinner className="size-4" aria-hidden />
            <span>Loading…</span>
          </div>
        ) : error ? (
          <Text className="text-destructive" role="alert">
            {error}
          </Text>
        ) : content !== null ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/40 p-3">
            <Text className="min-w-0 whitespace-pre-wrap break-words font-mono text-caption">
              {content}
            </Text>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
