import { useMemo, useState } from "react";
import type { SkillVersion } from "@mcp-token-footprint/shared";
import { DataTable } from "@brand/data";
import { Badge, Button, Checkbox, Spinner, StatePanel } from "@brand/ui";
import { ArrowRight, GitBranch, RotateCcw, Upload } from "lucide-react";
import { ConfirmDialog } from "../../components/dialogs";
import { actionsCol, col, shouldPaginate } from "../../lib/table";
import { formatDateTime, formatNumber } from "../../lib/format";

/** One version row with its client-computed Δtokens vs the previous (lower-seq) version. */
type VersionRow = {
  version: SkillVersion;
  /** total-token delta vs the immediately-lower seq; null for the first (v1) version. */
  deltaVsPrev: number | null;
};

/**
 * Build the display rows: for each version, its Δtokens vs the version with the next-lower seq
 * (the immediate predecessor). Computed client-side per the WP — the wire carries no Δ. Returned
 * newest-first (highest seq) to match the header picker + the mockup (#4).
 */
function buildRows(versions: SkillVersion[]): VersionRow[] {
  const bySeqAsc = [...versions].sort((a, b) => a.seq - b.seq);
  const rows: VersionRow[] = bySeqAsc.map((version, index) => {
    const prev = index > 0 ? bySeqAsc[index - 1] : undefined;
    return {
      version,
      deltaVsPrev: prev ? version.totalTokens - prev.totalTokens : null,
    };
  });
  return rows.reverse();
}

/** short 7-char source ref (a commit sha / tag), or an em dash for uploads. */
function shortRef(ref: string | undefined): string {
  if (!ref) return "—";
  return ref.length > 7 ? ref.slice(0, 7) : ref;
}

const IMPORTED_LABEL: Record<SkillVersion["importedFrom"], string> = {
  upload: "Upload",
  "github-pull": "GitHub pull",
};

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (delta === 0) {
    return <Badge variant="outline">0</Badge>;
  }
  // A larger footprint is "worse" for a context budget → destructive; smaller → success.
  return (
    <Badge variant={delta > 0 ? "destructive" : "success"}>
      {delta > 0 ? "+" : ""}
      {formatNumber(delta)}
    </Badge>
  );
}

export type SkillVersionsProps = {
  /** All versions of the skill (any order; this component sorts). */
  versions: SkillVersion[];
  /** The current selection for the Compare action — two version ids (from → to) or fewer. */
  selectedIds: string[];
  /** Toggle a version into/out of the compare selection (caps at two, oldest drops off). */
  onToggleSelect: (versionId: string) => void;
  /** Fire the Compare action with the two selected versions (from = older seq, to = newer seq). */
  onCompare: (fromId: string, toId: string) => void;
  /** The skill's current HEAD version id — its row shows "Latest", not a restore button. */
  latestVersionId?: string | null;
  /**
   * Restore an older version as the new latest (non-destructive — creates a new head version with
   * the chosen version's content; the in-between versions are kept). Confirmed here first.
   */
  onRestore: (versionId: string) => void;
  /** The version id whose restore is in flight (drives the row spinner + disables the others). */
  restoringId?: string | null;
};

/**
 * Versions tab (WP 1.8): a `DataTable` of the immutable version history — seq, label, source ref
 * (short), imported-from, date, files, total tokens, and a client-computed Δ vs the previous
 * version. Each row carries a checkbox; picking exactly two enables a "Compare" action that
 * deep-links into the Diff tab (from = older, to = newer). Mirrors mockup #4.
 */
export function SkillVersions({
  versions,
  selectedIds,
  onToggleSelect,
  onCompare,
  latestVersionId,
  onRestore,
  restoringId,
}: SkillVersionsProps) {
  const rows = useMemo(() => buildRows(versions), [versions]);

  // The version pending a "Set as latest" confirmation (a non-destructive re-point), or null.
  const [pendingRestore, setPendingRestore] = useState<SkillVersion | null>(null);
  // The seq the restore would land as — one past the current highest. Shown in the confirm copy.
  const nextSeq = useMemo(
    () => (versions.length === 0 ? 1 : Math.max(...versions.map((v) => v.seq)) + 1),
    [versions],
  );

  const selectedVersions = useMemo(
    () =>
      selectedIds
        .map((id) => versions.find((v) => v.id === id))
        .filter((v): v is SkillVersion => Boolean(v))
        .sort((a, b) => a.seq - b.seq),
    [selectedIds, versions],
  );

  const compareReady = selectedVersions.length === 2;

  const columns = useMemo(() => {
    const selectColumn = col<VersionRow>({
      id: "select",
      header: "",
      value: (row) => (selectedIds.includes(row.version.id) ? 1 : 0),
      cell: (row) => (
        <Checkbox
          checked={selectedIds.includes(row.version.id)}
          onCheckedChange={() => onToggleSelect(row.version.id)}
          aria-label={`Select v${row.version.seq} to compare`}
        />
      ),
    });

    return [
      selectColumn,
      col<VersionRow>({
        id: "seq",
        header: "Seq",
        value: (row) => row.version.seq,
        cell: (row) => <span className="font-mono tabular-nums">v{row.version.seq}</span>,
      }),
      col<VersionRow>({
        id: "label",
        header: "Label",
        value: (row) => row.version.versionLabel,
        cell: (row) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{row.version.versionLabel || "—"}</span>
            {row.version.sourceKind === "github" ? (
              <Badge variant="outline" className="shrink-0">
                <GitBranch className="size-3" /> GitHub
              </Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">
                <Upload className="size-3" /> Upload
              </Badge>
            )}
          </span>
        ),
      }),
      col<VersionRow>({
        id: "sourceRef",
        header: "Source ref",
        value: (row) => row.version.sourceRef ?? "",
        cell: (row) => (
          <span className="font-mono text-caption">{shortRef(row.version.sourceRef)}</span>
        ),
      }),
      col<VersionRow>({
        id: "importedFrom",
        header: "Imported",
        value: (row) => IMPORTED_LABEL[row.version.importedFrom],
        cell: (row) => (
          <Badge variant="secondary">{IMPORTED_LABEL[row.version.importedFrom]}</Badge>
        ),
      }),
      col<VersionRow>({
        id: "date",
        header: "Date",
        value: (row) => Date.parse(row.version.createdAt) || 0,
        cell: (row) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {formatDateTime(row.version.createdAt)}
          </span>
        ),
      }),
      col<VersionRow>({
        id: "files",
        header: "Files",
        numeric: true,
        value: (row) => row.version.fileCount,
      }),
      col<VersionRow>({
        id: "total",
        header: "Total tok",
        numeric: true,
        value: (row) => row.version.totalTokens,
      }),
      col<VersionRow>({
        id: "delta",
        header: "Δ vs prev",
        numeric: true,
        value: (row) => row.deltaVsPrev ?? 0,
        cell: (row) => (
          <span className="tabular-nums">
            <DeltaBadge delta={row.deltaVsPrev} />
          </span>
        ),
      }),
      // "Set as latest" — restore an older version as a NEW head (non-destructive; the versions in
      // between are kept). The HEAD row shows a muted "Latest" chip instead of a button; a row whose
      // restore is in flight shows a spinner, and all buttons disable while any restore runs.
      actionsCol<VersionRow>({
        id: "restore",
        header: "Set as latest",
        cell: (row) => {
          if (row.version.id === latestVersionId) {
            return (
              <Badge variant="outline" className="shrink-0">
                Latest
              </Badge>
            );
          }
          const busy = restoringId === row.version.id;
          return (
            <Button
              size="sm"
              variant="outline"
              disabled={Boolean(restoringId)}
              onClick={() => setPendingRestore(row.version)}
              aria-label={`Set v${row.version.seq} as the latest version`}
            >
              {busy ? (
                <Spinner className="size-4" aria-hidden />
              ) : (
                <RotateCcw className="size-4" aria-hidden />
              )}
              Set as latest
            </Button>
          );
        },
      }),
    ];
  }, [selectedIds, onToggleSelect, latestVersionId, restoringId]);

  if (versions.length === 0) {
    return (
      <StatePanel kind="empty" title="No versions" description="This skill has no versions yet." />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        data={rows}
        columns={columns}
        enablePagination={shouldPaginate(rows.length, 25)}
        pageSize={25}
        initialView={{ sorting: [{ id: "seq", desc: true }] }}
        toolbar={() => (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-body text-muted-foreground">
              {compareReady
                ? `Comparing v${selectedVersions[0]?.seq} → v${selectedVersions[1]?.seq}`
                : "Select two versions to compare"}
            </span>
            <Button
              size="sm"
              disabled={!compareReady}
              onClick={() => {
                const [from, to] = selectedVersions;
                if (from && to) onCompare(from.id, to.id);
              }}
            >
              {compareReady ? (
                <>
                  Compare v{selectedVersions[0]?.seq} <ArrowRight className="size-4" /> v
                  {selectedVersions[1]?.seq}
                </>
              ) : (
                "Compare"
              )}
            </Button>
          </div>
        )}
      />

      <ConfirmDialog
        open={pendingRestore !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestore(null);
        }}
        title={pendingRestore ? `Set v${pendingRestore.seq} as the latest version?` : ""}
        description={
          pendingRestore
            ? `This creates a new version (v${nextSeq}) with v${pendingRestore.seq}’s exact content and makes it the latest. The versions in between are kept — nothing is deleted.`
            : undefined
        }
        confirmLabel="Set as latest"
        onConfirm={() => {
          if (pendingRestore) {
            onRestore(pendingRestore.id);
            setPendingRestore(null);
          }
        }}
      />
    </div>
  );
}
