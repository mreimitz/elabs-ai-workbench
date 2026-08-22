import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SkillDiff, SkillDiffEntry, SkillVersion } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  MetricCard,
  ResizableHandle,
  ResizablePanel,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Text,
} from "@elabs-ai/components-ui";
import { CodeEditor, DiffEditor } from "@elabs-ai/components-editor";
import { ArrowRight, FileCode2 } from "lucide-react";
import { AdaptivePanelGroup } from "../../components/AdaptivePanelGroup";
import { getErrorMessage } from "../../lib/errors";
import { formatNumber } from "../../lib/format";
import { READ_ONLY_OPTIONS, languageFor } from "../../lib/monaco";
import { getSkillDiff, getSkillFileDiff, type SkillFileDiff } from "./skills-inspector-api";
import { formatVersionLabel } from "./version-label";

// ── change-list status metadata (semantic tokens only — no raw colors) ──────────────────────────
// Exported (with the delta helpers + DeltaStrip below) so other surfaces compositing a skill diff —
// e.g. the Assistant dock's AssistantDiffCard (WP 2.2) — reuse the SAME status vocabulary and rollup
// tile layout instead of re-deriving it.

export const STATUS_META: Record<
  SkillDiffEntry["status"],
  { label: string; variant: "success" | "destructive" | "warning" | "info" | "outline" }
> = {
  added: { label: "added", variant: "success" },
  removed: { label: "removed", variant: "destructive" },
  modified: { label: "modified", variant: "warning" },
  renamed: { label: "renamed", variant: "info" },
  unchanged: { label: "unchanged", variant: "outline" },
};

/** Signed, formatted token delta (e.g. "+74", "−12", "0"). */
export function formatSigned(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}

/** Semantic token-delta text color: more tokens = destructive, fewer = success, none = muted. */
export function deltaTone(value: number): string {
  if (value > 0) return "text-destructive";
  if (value < 0) return "text-success";
  return "text-muted-foreground";
}

// ── delta strip ─────────────────────────────────────────────────────────────────────────────────

/** The four-tile rollup strip (mockup #5): file counts + per-level + total token deltas. */
export function DeltaStrip({ diff }: { diff: SkillDiff }) {
  const r = diff.rollup;
  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Files"
        value={
          <span className="flex flex-wrap items-baseline gap-2 text-base tabular-nums">
            <span className="text-success">+{r.filesAdded}</span>
            <span className="text-destructive">−{r.filesRemoved}</span>
            <span className="text-warning">~{r.filesModified}</span>
            <span className="text-info">⇄{r.filesRenamed}</span>
          </span>
        }
        description="added · removed · modified · renamed"
      />
      <MetricCard
        label="L1 · metadata Δ"
        value={formatSigned(r.l1Delta)}
        description="name + description"
        delta={formatSigned(r.l1Delta)}
        deltaDirection={r.l1Delta > 0 ? "up" : r.l1Delta < 0 ? "down" : "neutral"}
        positiveIsGood={false}
      />
      <MetricCard
        label="L2 · body Δ"
        value={formatSigned(r.l2Delta)}
        description="SKILL.md"
        delta={formatSigned(r.l2Delta)}
        deltaDirection={r.l2Delta > 0 ? "up" : r.l2Delta < 0 ? "down" : "neutral"}
        positiveIsGood={false}
      />
      <MetricCard
        label="Total tokens Δ"
        value={formatSigned(r.totalDelta)}
        description={`L3 Δ ${formatSigned(r.l3Delta)}`}
        emphasis="headline"
        delta={formatSigned(r.totalDelta)}
        deltaDirection={r.totalDelta > 0 ? "up" : r.totalDelta < 0 ? "down" : "neutral"}
        positiveIsGood={false}
      />
    </div>
  );
}

// ── manifest field diff ─────────────────────────────────────────────────────────────────────────

function ManifestDiff({ diff }: { diff: SkillDiff }) {
  if (diff.manifestDiff.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manifest changes</CardTitle>
        </CardHeader>
        <CardContent>
          <Text variant="meta" tone="muted">
            No manifest field changed between these versions.
          </Text>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Manifest changes</CardTitle>
      </CardHeader>
      <CardContent>
        <Descriptions columns={1} layout="horizontal">
          {diff.manifestDiff.map((entry) => (
            <DescriptionsItem
              key={entry.field}
              label={<span className="font-mono text-xs">{entry.field}</span>}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="break-words text-muted-foreground line-through">
                  {entry.from ?? "—"}
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="break-words">{entry.to ?? "—"}</span>
              </span>
            </DescriptionsItem>
          ))}
        </Descriptions>
      </CardContent>
    </Card>
  );
}

// ── change list (walkable full tree) ────────────────────────────────────────────────────────────

/** The path a change-list row shows: `from → to` for a rename, else the path. */
function entryLabel(entry: SkillDiffEntry): string {
  if (entry.status === "renamed" && entry.fromPath) {
    return `${entry.fromPath} → ${entry.path}`;
  }
  return entry.path;
}

function ChangeList({
  entries,
  selectedPath,
  onSelect,
}: {
  entries: SkillDiffEntry[];
  selectedPath: string | undefined;
  onSelect: (entry: SkillDiffEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="No changes"
        description="These two versions have identical trees."
      />
    );
  }
  return (
    <ul className="flex flex-col">
      {entries.map((entry) => {
        const meta = STATUS_META[entry.status];
        const active = entry.path === selectedPath;
        return (
          <li key={`${entry.status}:${entry.path}`} className="min-w-0">
            <Button
              variant="ghost"
              onClick={() => onSelect(entry)}
              aria-current={active ? "true" : undefined}
              className={`h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left ${
                active ? "bg-muted" : ""
              }`}
            >
              <Badge variant={meta.variant} className="shrink-0">
                {meta.label}
              </Badge>
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={entryLabel(entry)}>
                {entryLabel(entry)}
              </span>
              <span className={`shrink-0 tabular-nums text-xs ${deltaTone(entry.tokenDelta)}`}>
                {entry.binary ? "binary" : `${formatSigned(entry.tokenDelta)} tok`}
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

// ── per-entry viewer (right pane) ────────────────────────────────────────────────────────────────

function EntryViewer({
  skillId,
  fromId,
  toId,
  entry,
}: {
  skillId: string;
  fromId: string;
  toId: string;
  entry: SkillDiffEntry;
}) {
  const [fileDiff, setFileDiff] = useState<SkillFileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The path to load: the rename target lives at `entry.path` in the "to" version, but the file
  // route diffs one path across both versions — the diff-service resolves the rename internally.
  useEffect(() => {
    let cancelled = false;
    setFileDiff(null);
    setError(null);
    if (entry.binary) return; // binary → no text to load (rendered below without a fetch)
    getSkillFileDiff(skillId, fromId, toId, entry.path)
      .then((result) => {
        if (!cancelled) setFileDiff(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, "Couldn’t load file diff"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, fromId, toId, entry.path, entry.binary]);

  // Binary change → a simple note (no Monaco).
  if (entry.binary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <FileCode2 className="size-10 text-muted-foreground" aria-hidden />
        <Text>Binary file changed</Text>
        <Text variant="meta" tone="muted">
          {entryLabel(entry)}
        </Text>
      </div>
    );
  }

  if (error) {
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load file diff — select another file, then reselect this one to try again."
        description={error}
      />
    );
  }
  if (fileDiff === null) {
    return <StatePanel kind="loading" title="Loading…" loadingLabel="Loading file diff…" />;
  }

  const fromText = fileDiff.from.isBinary ? "" : fileDiff.from.text;
  const toText = fileDiff.to.isBinary ? "" : fileDiff.to.text;
  const language = languageFor(entry.path);

  // added → only a "to" side; removed → only a "from" side. Single-pane CodeEditor for both.
  if (entry.status === "added") {
    return (
      <SinglePane title={`Added · ${entry.path}`}>
        <CodeEditor
          value={toText}
          language={language}
          readOnly
          height="100%"
          ariaLabel={`Added ${entry.path}`}
          options={READ_ONLY_OPTIONS}
        />
      </SinglePane>
    );
  }
  if (entry.status === "removed") {
    return (
      <SinglePane title={`Removed · ${entry.path}`}>
        <CodeEditor
          value={fromText}
          language={language}
          readOnly
          height="100%"
          ariaLabel={`Removed ${entry.path}`}
          options={READ_ONLY_OPTIONS}
        />
      </SinglePane>
    );
  }

  // modified / renamed (text) → side-by-side Monaco DiffEditor (it computes the +/- line diff).
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <Text variant="meta" tone="muted" className="truncate font-mono">
          {entryLabel(entry)}
        </Text>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffEditor
          original={fromText}
          modified={toText}
          language={language}
          readOnly
          height="100%"
          options={READ_ONLY_OPTIONS}
        />
      </div>
    </div>
  );
}

function SinglePane({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <Text variant="meta" tone="muted" className="truncate font-mono">
          {title}
        </Text>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

// ── the Diff tab ─────────────────────────────────────────────────────────────────────────────────

export type SkillDiffViewProps = {
  skillId: string;
  /** All versions (any order) — drives the A/B pickers. */
  versions: SkillVersion[];
  /** Controlled A/B selection (from → to). When undefined the view seeds prev → current itself. */
  fromId?: string;
  toId?: string;
  onChangeFrom: (versionId: string) => void;
  onChangeTo: (versionId: string) => void;
};

/**
 * Diff tab (WP 1.8): A/B version pickers (default previous → current) over `getSkillDiff`, then a
 * rollup delta strip + manifest field diff + a walkable full-tree change list. Selecting a MODIFIED
 * text entry loads `getSkillFileDiff` and renders a side-by-side Monaco `DiffEditor`; added/removed
 * render a single pane; binary renders a "binary changed" note. Mirrors mockups #5 / #7 (dark).
 */
export function SkillDiffView({
  skillId,
  versions,
  fromId,
  toId,
  onChangeFrom,
  onChangeTo,
}: SkillDiffViewProps) {
  const byNewest = useMemo(() => [...versions].sort((a, b) => b.seq - a.seq), [versions]);

  const [diff, setDiff] = useState<SkillDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<SkillDiffEntry | null>(null);

  const bothPicked = Boolean(fromId && toId);
  const samePicked = Boolean(fromId && toId && fromId === toId);

  useEffect(() => {
    if (!fromId || !toId || fromId === toId) {
      setDiff(null);
      setError(null);
      setSelectedEntry(null);
      return;
    }
    let cancelled = false;
    setDiff(null);
    setError(null);
    setSelectedEntry(null);
    getSkillDiff(skillId, fromId, toId)
      .then((result) => {
        if (cancelled) return;
        setDiff(result);
        // Auto-select the first changed entry so the viewer isn't empty.
        const firstChanged = result.entries.find((e) => e.status !== "unchanged");
        setSelectedEntry(firstChanged ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, "Couldn’t load diff"));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId, fromId, toId]);

  const changedEntries = useMemo(
    () => (diff ? diff.entries.filter((e) => e.status !== "unchanged") : []),
    [diff],
  );

  if (versions.length < 2) {
    return (
      <StatePanel
        kind="empty"
        title="Need two versions"
        description="A skill needs at least two versions before it can be diffed. Pull latest or upload a new version."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* A/B pickers */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
        <VersionPicker label="From" value={fromId} versions={byNewest} onChange={onChangeFrom} />
        <ArrowRight className="mb-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <VersionPicker label="To" value={toId} versions={byNewest} onChange={onChangeTo} />
      </div>

      {samePicked ? (
        <StatePanel
          kind="empty"
          title="Pick two different versions"
          description="From and To are the same version."
        />
      ) : !bothPicked ? (
        <StatePanel
          kind="empty"
          title="Pick two versions"
          description="Choose a From and a To version to diff."
        />
      ) : error ? (
        <StatePanel
          kind="error"
          title="Couldn’t load diff — switch versions or refresh the page to try again."
          description={error}
        />
      ) : diff === null ? (
        <StatePanel kind="loading" title="Diffing…" loadingLabel="Computing diff…" />
      ) : (
        <div className="flex flex-col gap-4">
          <DeltaStrip diff={diff} />
          <ManifestDiff diff={diff} />

          {/* Change list (left) + per-file viewer (right) */}
          <AdaptivePanelGroup className="min-h-[30rem] rounded-lg border border-border">
            <ResizablePanel defaultSize={34} minSize={22}>
              <ScrollArea className="h-full">
                <div className="p-2">
                  <ChangeList
                    entries={changedEntries}
                    selectedPath={selectedEntry?.path}
                    onSelect={setSelectedEntry}
                  />
                </div>
              </ScrollArea>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={66} minSize={40}>
              {selectedEntry ? (
                <EntryViewer
                  key={`${fromId}:${toId}:${selectedEntry.path}`}
                  skillId={skillId}
                  fromId={fromId as string}
                  toId={toId as string}
                  entry={selectedEntry}
                />
              ) : (
                <StatePanel
                  kind="empty"
                  title="No file selected"
                  description="Pick a changed file to see its diff."
                />
              )}
            </ResizablePanel>
          </AdaptivePanelGroup>
        </div>
      )}
    </div>
  );
}

function VersionPicker({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: string | undefined;
  versions: SkillVersion[];
  onChange: (versionId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Text variant="meta" tone="muted">
        {label}
      </Text>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-56" aria-label={`${label} version`}>
          <SelectValue placeholder="Select version" />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => (
            // RM-30 WP 7.9 — the shared helper, not a hand-built label. Composing `v{seq}` +
            // `versionLabel` here produced "v5 · v5" for every version the Studio saves, because the
            // API's fallback label IS `v{seq}`; `formatVersionLabel` drops a label that only repeats
            // the sequence, and it is what the inspector's own pickers and the Studio toolbar use.
            <SelectItem key={v.id} value={v.id}>
              {formatVersionLabel(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
