import { useEffect, useState } from "react";
import type {
  SkillDiff,
  SkillEditOp,
  SkillEditsResponse,
  SkillGraph,
  SkillVersion,
} from "@mcp-token-footprint/shared";
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
} from "@elabs-ai/components-ui";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { ApiError } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { formatNumber } from "../../../lib/format";
import { FormDialog } from "../../../components/dialogs";
import { describeEditOp } from "./use-edit-ops";
import { postSkillEdits } from "../skills-inspector-api";

/** Signed, formatted token delta (e.g. "+74", "−12", "0") — mirrors SkillDiffView's own formatter. */
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

export type SaveVersionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillId: string;
  versionId: string;
  /** The tree the client's graph was projected from — the `baseTreeSha` for the op-canonical fallback
   *  save (used by the Quality/Trace suggestion-apply flows; a mismatch is a 409). */
  baseTreeSha: string;
  /** The RAW/base graph the ops target — used only to resolve node/edge labels for the summary list. */
  graph: SkillGraph;
  ops: SkillEditOp[];
  /**
   * CONTENT-CANONICAL save (WP 9.1) — the Design tab's live-draft path. When provided it turns the live
   * draft into a new immutable version (or `{ unchanged: true }`), throwing an `ApiError` (409 = the
   * head moved, 400 = rejected) surfaced as a banner. When ABSENT (the Quality/Trace suggestion-apply
   * flows), the dialog falls back to the op-canonical edits route (`postSkillEdits`) against
   * `baseTreeSha` — a discrete suggestion batch against a fixed version, unchanged from before WP 9.1.
   */
  save?: (note?: string) => Promise<SkillEditsResponse>;
  /** Called once the op buffer should be dropped (a real save, or `{ unchanged: true }`). */
  onDiscardOps: () => void;
  /** Called with the new version + its diff vs. the base version right after a successful save. */
  onSaved: (version: SkillVersion, diff: SkillDiff, warnings: string[]) => void;
  /** Re-fetch the graph/base version after a 409 — the op buffer is NOT cleared. */
  onReload: () => Promise<void>;
  /** Deep-link into the Diff tab for (fromVersionId, toVersionId). */
  onViewDiff: (fromVersionId: string, toVersionId: string) => void;
  /**
   * Pre-fill the note field on open (WP 5.2 — the Trace tab's suggestion apply flow prefills
   * `"SkillFlow suggestion: <rule>"`). Optional; defaults to an empty note (the Design tab's own
   * "Save as new version" flow never sets this).
   */
  initialNote?: string;
};

/**
 * The Design tab's save flow (WP 4.2, migrated to the live draft in WP 9.1): note + a human-readable
 * op summary, then the CONTENT-CANONICAL save (`draft.save` → `POST /api/skills/:id/save-draft`) — the
 * live draft text becomes a new immutable version, the staged ops ride along as its intent-log
 * metadata. Then either a compact diff-summary success view (rollup + changed files, reusing the
 * SkillDiffView vocabulary at a smaller scale) or an in-dialog conflict/error banner. `{ unchanged:
 * true }` never shows a success view — it's a toast, the op buffer clears, and the dialog closes
 * (nothing to review). A `409` (the head moved) keeps the op buffer and offers "Reload" (re-fetches the
 * base, never discards pending edits); a `400` surfaces the server's exact message.
 */
export function SaveVersionDialog({
  open,
  onOpenChange,
  skillId,
  versionId,
  baseTreeSha,
  graph,
  ops,
  save,
  onDiscardOps,
  onSaved,
  onReload,
  onViewDiff,
  initialNote,
}: SaveVersionDialogProps) {
  const [note, setNote] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [result, setResult] = useState<SavedResult | null>(null);

  // Reset per-open transient state — a dialog reopened for a fresh batch of ops starts clean.
  useEffect(() => {
    if (open) {
      setNote(initialNote ?? "");
      setBanner(null);
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setBanner(null);
    try {
      // WP 9.1: the Design tab supplies a content-canonical `save`; the Quality/Trace suggestion-apply
      // flows omit it and fall back to the op-canonical edits route against the fixed base tree.
      const response = save
        ? await save(note.trim() || undefined)
        : await postSkillEdits(skillId, versionId, {
            baseTreeSha,
            ops,
            ...(note.trim() ? { note: note.trim() } : {}),
          });
      if ("unchanged" in response) {
        toast.info("Nothing to save", {
          description: "Those edits left SKILL.md identical to the current version.",
        });
        onDiscardOps();
        onOpenChange(false);
        return;
      }
      setResult({
        version: response.version,
        diff: response.diff,
        warnings: response.warnings ?? [],
      });
      toast.success(`Saved v${response.version.seq}`, {
        description: "Your Design edits are now a new version.",
      });
      onSaved(response.version, response.diff, response.warnings ?? []);
      onDiscardOps();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setBanner({
          status: 409,
          message: getErrorMessage(err, "The version changed since this graph was loaded."),
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
      toast.info("Graph reloaded", {
        description:
          "Your pending edits are kept — anchors may have shifted, so double-check them.",
      });
    } catch (err) {
      setBanner({
        status: "other",
        message: getErrorMessage(err, "The graph didn’t reload. Try again."),
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
          ? "SKILL.md was rewritten through the anchored ops and saved as a new immutable version."
          : "Review the staged edits, then save — this creates a new immutable version; nothing is mutated in place."
      }
      // Result phase: the meaningful next action is the diff; "Close" dismisses. Form phase: save.
      cancelLabel={result ? "Close" : undefined}
      primaryLabel={result ? "View full diff" : "Save version"}
      onSubmit={
        result
          ? () => {
              onViewDiff(versionId, result.version.id);
              onOpenChange(false);
            }
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
            <RollupTile label="L2 · body Δ" value={formatSigned(result.diff.rollup.l2Delta)} />
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
                    <span>{reloading ? "Reloading…" : "Reload graph"}</span>
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="save-version-note">Note (optional)</Label>
            <Input
              id="save-version-note"
              value={note}
              placeholder="What changed, and why…"
              spellCheck
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Text variant="caption" tone="muted">
              {ops.length} staged {ops.length === 1 ? "edit" : "edits"}
            </Text>
            {ops.length === 0 ? (
              <Text variant="meta" tone="muted">
                Nothing staged yet.
              </Text>
            ) : (
              <ScrollArea className="max-h-56 rounded-md border border-border">
                <ul className="flex flex-col gap-1 p-2">
                  {ops.map((op, index) => (
                    <li key={index} className="text-body">
                      {describeEditOp(op, graph)}
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
