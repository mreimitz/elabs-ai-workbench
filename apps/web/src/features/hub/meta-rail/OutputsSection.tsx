import {
  Badge,
  Button,
  Card,
  EmptyState,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@elabs-ai/components-ui";
import type {
  HubArtifact,
  HubArtifactKind,
  HubFile,
  HubFileLink,
  HubWorkspaceSnapshot,
} from "@mcp-token-footprint/shared";
import { Braces, Camera, Code2, Download, FileOutput, FileText, Globe, Table2 } from "lucide-react";
import { formatBytes, formatRelativeTime } from "../../../lib/format";

/**
 * Assistant Hub UX (WP1.2, D-HUX3) — the meta rail's OUTPUTS section: "artifacts and workspace files
 * merged into one list (name, kind, updated, open action)", replacing `ArtifactCanvas`'s own picker
 * list AND `WorkspaceFilesPanel`'s "Uploads" section (the concept's wireframe also lists workspace
 * SNAPSHOTS under Outputs, kept here as a lighter secondary group with its own Restore action).
 *
 * Deliberately does NOT reproduce every `WorkspaceFilesPanel` action (delete an upload, promote a
 * workspace-tree file, browse the raw tree, attach/detach an MCP resource) — those are heavier,
 * destructive, or picker-driven flows that don't fit "one merged summary list" in a 360 px rail. This
 * section owns the LIST + its "open"/"download"/"restore" affordances; the richer management surface
 * is an integration decision (WP1.1/owner), noted in the WP1.2 handoff report.
 *
 * The artifact/file detail viewers (`ArtifactCanvas`'s tabs, a file's raw content) do NOT render
 * inside the rail — `onOpenArtifact`/`getFileDownloadUrl` delegate outward, matching how the Context
 * section's pinned files delegate through `onOpenPinnedFile` (one consistent "the rail lists, the
 * caller shows" contract across all three sections).
 */

const ARTIFACT_KIND_ICON: Record<HubArtifactKind, typeof FileText> = {
  markdown: FileText,
  code: Code2,
  html: Globe,
  table: Table2,
  json: Braces,
};

const ARTIFACT_KIND_LABEL: Record<HubArtifactKind, string> = {
  markdown: "Markdown",
  code: "Code",
  html: "HTML",
  table: "Table",
  json: "JSON",
};

export type HubOutputFileEntry = { file: HubFile; link?: HubFileLink };

export type MetaRailOutputsProps = {
  artifacts: HubArtifact[];
  onOpenArtifact?: (artifact: HubArtifact) => void;
  files: HubOutputFileEntry[];
  /** Resolves a file's download href (e.g. `hubFileContentUrl` — kept out of this component so it
   *  never imports `lib/api` directly). Omitting it hides the download action. */
  getFileDownloadUrl?: (file: HubFile) => string;
  snapshots?: HubWorkspaceSnapshot[];
  onRestoreSnapshot?: (snapshotId: string) => void;
  /** Disables the snapshot Restore action while a request is in flight. */
  busy?: boolean;
};

type OutputRow =
  | {
      kind: "artifact";
      key: string;
      name: string;
      typeLabel: string;
      at: string;
      artifact: HubArtifact;
    }
  | { kind: "file"; key: string; name: string; typeLabel: string; at: string; file: HubFile };

export function OutputsSection({
  artifacts,
  onOpenArtifact,
  files,
  getFileDownloadUrl,
  snapshots = [],
  onRestoreSnapshot,
  busy,
}: MetaRailOutputsProps) {
  const isEmpty = artifacts.length === 0 && files.length === 0 && snapshots.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        icon={<FileOutput aria-hidden />}
        title="No outputs yet"
        description="Documents, code, and files the assistant creates or attaches in this session appear here."
      />
    );
  }

  const rows: OutputRow[] = [
    ...artifacts.map(
      (artifact): OutputRow => ({
        kind: "artifact",
        key: `artifact:${artifact.id}`,
        name: artifact.title,
        typeLabel: ARTIFACT_KIND_LABEL[artifact.kind],
        at: artifact.updatedAt,
        artifact,
      }),
    ),
    ...files.map(
      ({ file }): OutputRow => ({
        kind: "file",
        key: `file:${file.id}`,
        name: file.filename ?? file.id,
        typeLabel: formatBytes(file.bytes),
        at: file.createdAt,
        file,
      }),
    ),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest first

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {rows.length > 0 ? (
        <ul className="flex min-w-0 flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.key} className="min-w-0">
              {row.kind === "artifact" ? (
                <ArtifactRow
                  artifact={row.artifact}
                  {...(onOpenArtifact ? { onOpenArtifact } : {})}
                />
              ) : (
                <FileRow file={row.file} {...(getFileDownloadUrl ? { getFileDownloadUrl } : {})} />
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {snapshots.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Text variant="meta" tone="muted" className="uppercase tracking-wide">
            Snapshots
          </Text>
          <ul className="flex min-w-0 flex-col gap-1.5">
            {snapshots.map((snapshot) => (
              <li key={snapshot.id} className="min-w-0">
                <SnapshotRow
                  snapshot={snapshot}
                  busy={busy}
                  {...(onRestoreSnapshot ? { onRestoreSnapshot } : {})}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function OutputRowShell({
  icon,
  name,
  meta,
  action,
}: {
  icon: React.ReactNode;
  name: string;
  meta: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex min-w-0 items-center gap-2 px-2 py-1.5">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <Text className="min-w-0 truncate" title={name}>
          {name}
        </Text>
        <Text variant="meta" tone="muted" className="min-w-0 truncate">
          {meta}
        </Text>
      </div>
      {action ? <span className="shrink-0">{action}</span> : null}
    </Card>
  );
}

function ArtifactRow({
  artifact,
  onOpenArtifact,
}: {
  artifact: HubArtifact;
  onOpenArtifact?: (artifact: HubArtifact) => void;
}) {
  const Icon = ARTIFACT_KIND_ICON[artifact.kind];
  return (
    <OutputRowShell
      icon={<Icon aria-hidden className="size-4" />}
      name={artifact.title}
      meta={`${ARTIFACT_KIND_LABEL[artifact.kind]} · v${artifact.latestVersion} · ${formatRelativeTime(artifact.updatedAt)}`}
      action={
        onOpenArtifact ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenArtifact(artifact)}
            aria-label={`Open ${artifact.title}`}
          >
            Open
          </Button>
        ) : undefined
      }
    />
  );
}

function FileRow({
  file,
  getFileDownloadUrl,
}: {
  file: HubFile;
  getFileDownloadUrl?: (file: HubFile) => string;
}) {
  return (
    <OutputRowShell
      icon={<FileText aria-hidden className="size-4" />}
      name={file.filename ?? file.id}
      meta={`${formatBytes(file.bytes)} · ${formatRelativeTime(file.createdAt)}`}
      action={
        getFileDownloadUrl ? (
          // IconButton can't accept `asChild` (D-TB5 — it would dissolve into a Slot and break the
          // icon-child composition), and this needs to stay a REAL download <a>. So it manually
          // replicates IconButton's Tooltip mechanism: one label fed to both the anchor's
          // `aria-label` and the tooltip.
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" asChild>
                <a
                  href={getFileDownloadUrl(file)}
                  download={file.filename ?? file.id}
                  aria-label={`Download ${file.filename ?? file.id}`}
                >
                  <Download aria-hidden className="size-3.5" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`Download ${file.filename ?? file.id}`}</TooltipContent>
          </Tooltip>
        ) : undefined
      }
    />
  );
}

function SnapshotRow({
  snapshot,
  busy,
  onRestoreSnapshot,
}: {
  snapshot: HubWorkspaceSnapshot;
  busy?: boolean;
  onRestoreSnapshot?: (snapshotId: string) => void;
}) {
  return (
    <OutputRowShell
      icon={<Camera aria-hidden className="size-4" />}
      name={snapshot.label ?? snapshot.id}
      meta={`${formatRelativeTime(snapshot.createdAt)} · ${snapshot.fileCount} file${snapshot.fileCount === 1 ? "" : "s"} · ${formatBytes(snapshot.totalBytes)}`}
      action={
        onRestoreSnapshot ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onRestoreSnapshot(snapshot.id)}
          >
            Restore
          </Button>
        ) : undefined
      }
    />
  );
}
