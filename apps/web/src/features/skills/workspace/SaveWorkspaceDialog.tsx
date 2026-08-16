import { useEffect, useState } from "react";
import type { SkillDiff, SkillEditOp, SkillVersion } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Input,
  Label,
  ScrollArea,
  Spinner,
  Text,
  toast,
} from "@brand/ui";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { ApiError } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { formatNumber } from "../../../lib/format";
import { FormDialog } from "../../../components/dialogs";
import { postSkillEdits } from "../skills-inspector-api";
import { describeTreeOp } from "./workspace-model";

/** Signed, formatted token delta (mirrors SkillDiffView / the design tab's SaveVersionDialog). */
function formatSigned(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}

const STATUS_LABEL: Record<string, string> = {
  added: "added",
  removed: "removed",
  modified: "modified",
  renamed: "renamed",
  unchanged: "unchanged",
};

type SavedResult = { version: SkillVersion; diff: SkillDiff; warnings: string[] };
type Banner = { status: 409 | 400 | "other"; message: string };

export type SaveWorkspaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillId: string;
  versionId: string;
  /** The tree the working copy was seeded from — a mismatch is a 409 (the version changed underneath). */
  baseTreeSha: string;
  /** The derived tree-op batch to save (from `deriveTreeOps`). */
  ops: SkillEditOp[];
  /** User-created empty folders that will silently drop (folders are implicit server-side) — a note. */
  emptyFolders: string[];
  /** Called with the new version + its diff after a successful save (the caller reloads the tree). */
  onSaved: (version: SkillVersion, diff: SkillDiff) => void;
  /** Re-fetch the version's fresh `treeSha` after a 409 (the working tree is NOT discarded). */
  onReload: () => Promise<void>;
  /** Deep-link into the Diff tab for (fromVersionId, toVersionId) — omitted when navigation isn't wired. */
  onViewDiff?: (fromVersionId: string, toVersionId: string) => void;
};

/**
 * The Files-tab save flow (WP 3.2): note + a human-readable summary of the derived file ops, then
 * `POST .../edits` (the SAME route the Design tab uses — one new immutable version for the whole
 * batch). Success shows a compact diff summary; a `409` keeps the working tree and offers "Reload"
 * (re-fetch the fresh `treeSha`); a `400` surfaces the server's exact validation message. `{ unchanged:
 * true }` is a toast + close (the derived batch left the tree byte-identical). Deliberately a SEPARATE
 * component from the Design tab's `SaveVersionDialog` (which needs a graph + describes graph ops) —
 * Phase 9 (I10) unifies all staging onto the live draft later.
 */
export function SaveWorkspaceDialog({
  open,
  onOpenChange,
  skillId,
  versionId,
  baseTreeSha,
  ops,
  emptyFolders,
  onSaved,
  onReload,
  onViewDiff,
}: SaveWorkspaceDialogProps) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [result, setResult] = useState<SavedResult | null>(null);

  useEffect(() => {
    if (open) {
      setNote("");
      setBanner(null);
      setResult(null);
    }
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setBanner(null);
    try {
      const response = await postSkillEdits(skillId, versionId, {
        baseTreeSha,
        ops,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if ("unchanged" in response) {
        toast.info("Nothing to save", {
          description: "Those edits left the file tree identical to the current version.",
        });
        onOpenChange(false);
        return;
      }
      setResult({
        version: response.version,
        diff: response.diff,
        warnings: response.warnings ?? [],
      });
      toast.success(`Saved v${response.version.seq}`, {
        description: "Your file changes are now a new version.",
      });
      onSaved(response.version, response.diff);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setBanner({
          status: 409,
          message: getErrorMessage(err, "The version changed since you loaded it."),
        });
      } else if (err instanceof ApiError && err.status === 400) {
        setBanner({
          status: 400,
          message: getErrorMessage(err, "The server rejected these edits."),
        });
      } else {
        setBanner({
          status: "other",
          message: getErrorMessage(err, "The save request didn’t go through. Try again."),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    setReloading(true);
    try {
      await onReload();
      setBanner(null);
      toast.info("Reloaded", {
        description: "Re-based on the current version — double-check your changes.",
      });
    } catch (err) {
      setBanner({
        status: "other",
        message: getErrorMessage(err, "The reload didn’t go through. Try again."),
      });
    } finally {
      setReloading(false);
    }
  }

  const changedEntries = result ? result.diff.entries.filter((e) => e.status !== "unchanged") : [];

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={result ? "Saved" : "Save as new version"}
      description={
        result
          ? "The file changes were applied and saved as a new immutable version."
          : "Review the file changes, then save — this creates a new immutable version; nothing is mutated in place."
      }
      // Result phase: "View full diff" when navigation is wired, else a plain "Close". Form: save.
      cancelLabel={result && onViewDiff ? "Close" : undefined}
      primaryLabel={result ? (onViewDiff ? "View full diff" : "Close") : "Save version"}
      onSubmit={
        result
          ? onViewDiff
            ? () => {
                onViewDiff(versionId, result.version.id);
                onOpenChange(false);
              }
            : () => onOpenChange(false)
          : handleSave
      }
      busy={result ? undefined : saving}
      submitDisabled={result ? undefined : ops.length === 0}
    >
      {result ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" aria-hidden />
            <Text>
              Version v{result.version.seq} created
              {result.version.note ? ` — “${result.version.note}”` : ""}.
            </Text>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <RollupTile
              label="Files"
              value={`+${result.diff.rollup.filesAdded} / ~${result.diff.rollup.filesModified} / −${result.diff.rollup.filesRemoved}`}
            />
            <RollupTile label="Renamed" value={String(result.diff.rollup.filesRenamed)} />
            <RollupTile label="Total tokens Δ" value={formatSigned(result.diff.rollup.totalDelta)} />
            <RollupTile label="Bytes Δ" value={formatSigned(result.diff.rollup.bytesDelta)} />
          </div>

          {result.warnings.length > 0 ? (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Some ops were skipped</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Text variant="caption" tone="muted">
              Changed files
            </Text>
            {changedEntries.length === 0 ? (
              <Text variant="meta" tone="muted">
                No files changed.
              </Text>
            ) : (
              <ScrollArea className="max-h-56 rounded-md border border-border">
                <ul className="flex flex-col p-1">
                  {changedEntries.map((entry) => (
                    <li
                      key={`${entry.status}:${entry.path}`}
                      className="flex items-center gap-2 px-2 py-1.5"
                    >
                      <Badge variant="outline" className="shrink-0">
                        {STATUS_LABEL[entry.status] ?? entry.status}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate font-mono text-caption">
                        {entry.path}
                      </span>
                      <span className="shrink-0 tabular-nums text-caption text-muted-foreground">
                        {entry.binary ? "binary" : `${formatSigned(entry.tokenDelta)} tok`}
                      </span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {banner ? (
            <Alert variant={banner.status === 400 ? "destructive" : "warning"}>
              <AlertTriangle />
              <AlertTitle>
                {banner.status === 409
                  ? "Couldn’t save — this version changed since you loaded it"
                  : banner.status === 400
                    ? "Couldn’t save — these edits were rejected"
                    : "Couldn’t save this version"}
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>{banner.message}</span>
                {banner.status === 409 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => void handleReload()}
                    disabled={reloading}
                  >
                    {reloading ? <Spinner className="size-4" /> : <RefreshCw aria-hidden />}
                    <span>{reloading ? "Reloading…" : "Reload"}</span>
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="save-workspace-note">Note (optional)</Label>
            <Input
              id="save-workspace-note"
              value={note}
              placeholder="What changed, and why…"
              spellCheck
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          {emptyFolders.length > 0 ? (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>Empty folders won’t be saved</AlertTitle>
              <AlertDescription>
                Folders exist only where files live, so these empty folders are dropped:{" "}
                <span className="font-mono">{emptyFolders.join(", ")}</span>. Add a file to keep one.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Text variant="caption" tone="muted">
              {ops.length} file {ops.length === 1 ? "change" : "changes"}
            </Text>
            {ops.length === 0 ? (
              <Text variant="meta" tone="muted">
                Nothing staged yet.
              </Text>
            ) : (
              <ScrollArea className="max-h-56 rounded-md border border-border">
                <ul className="flex flex-col gap-1 p-2">
                  {ops.map((op, index) => (
                    <li key={index} className="font-mono text-body">
                      {describeTreeOp(op)}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </div>
        </div>
      )}
    </FormDialog>
  );
}

function RollupTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-0.5 p-2.5">
      <Text variant="meta" tone="muted">
        {label}
      </Text>
      <Text className="tabular-nums">{value}</Text>
    </Card>
  );
}
