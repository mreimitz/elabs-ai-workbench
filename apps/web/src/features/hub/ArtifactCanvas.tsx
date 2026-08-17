import { useCallback, useEffect, useRef, useState } from "react";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
  MarkdownView,
  type MarkdownViewProps,
  WebPreview,
  WebPreviewBody,
} from "@elabs-ai/components-ai";
import { DiffEditor } from "@elabs-ai/components-editor";
import {
  Badge,
  Button,
  ChangeReview,
  type ChangeHunk,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Label,
  ScrollArea,
  Spinner,
  Tabs,
  TabsContent,
  TabsTrigger,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import type {
  HubAgentRole,
  HubArtifact,
  HubArtifactKind,
  HubArtifactVersion,
  HubReview,
  HubReviewComment,
} from "@mcp-token-footprint/shared";
import {
  Braces,
  Check,
  Code2,
  Copy,
  Download,
  FileText,
  GitCompare,
  Globe,
  Maximize2,
  RotateCcw,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import { ConfirmDialog } from "../../components/dialogs";
import { IconButton } from "../../components/IconButton";
import { ScrollableTabsList } from "../../components/ScrollableTabsList";
import { SelectField } from "../../components/SelectField";
import {
  decideHubReview,
  fetchHubArtifactShareHtml,
  hubArtifactExportUrl,
  hubArtifactShareUrl,
  listHubAgentRoles,
  listHubArtifactReviews,
  listHubArtifactVersions,
  listHubArtifacts,
  requestHubArtifactReview,
  revertHubArtifactVersion,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatRelativeTime } from "../../lib/format";
import { notifyError } from "../../lib/notify";

/**
 * Assistant Hub (WP1.6 + WP3.5, §1.9 / R-UX13 / D-AH12 / D-AH7) — the artifact canvas: a side panel
 * (mounted as `ChatShell`'s `aside`, see `AssistantView.tsx`) that lists the session's artifacts,
 * renders the selected one across three tabs — **Content** (kind-aware view, WP1.6), **Diff**
 * (version-to-version, `@elabs-ai/components-editor` `DiffEditor`, WP3.5), **Review** (the critic review workflow on
 * `AI/ChangeReview`, WP3.5) — a version list with a per-version **Revert** action (the R-UX7 undo
 * pairing), and export actions (md/html/json + the self-contained `share.html`).
 *
 * Why `MarkdownView` (fenced) for `code`/`json` instead of `@elabs-ai/components-ai`'s `CodeBlock`: `CodeBlock`'s
 * `language` prop is a Shiki `BundledLanguage` literal union, and a hub artifact carries no language
 * field (the contract is kind-only) — fabricating a language guess would be actively misleading.
 * `MarkdownView`'s fenced-code path already goes through the same Shiki-backed `@streamdown/code`
 * plugin and degrades gracefully with no/unknown info string, so it renders correctly without a
 * type-unsafe cast. `DiffEditor` (Monaco) needs an ACTUAL language id, not a Shiki literal, so the Diff
 * tab maps `kind` to a best-effort Monaco id instead (`artifactMonacoLanguage`) — a coarser guess than
 * `CodeBlock` would need, but Monaco degrades to plain highlighting on an unknown id, never a crash.
 *
 * WP3.5's review workflow is intentionally scoped to the CRITIC path (D-AH12: "a critic role produces
 * anchored comments + suggested edits; the user accepts/rejects per suggestion"): `POST .../reviews`
 * always spawns a critic run, there is no separate "open a blank review and hand-author comments" affordance.
 * `ChangeReview`'s built-in per-hunk toggle is wired as the ACCEPT gesture (`onToggle(id, true)`); reject is a
 * small button injected via its sanctioned `renderHunk` override (the component has no dedicated per-hunk
 * reject action — only the toggle and the header's bulk Approve/Reject all). `HubReview` carries no `model`
 * field (the wire contract doesn't track it — additive-only, no migration, this WP's own constraint), so
 * `ChangeReviewProvenance` shows the resolved role name (or "Critic") + a timestamp, honestly omitting `model`
 * rather than fabricating it.
 */

const KIND_ICON: Record<HubArtifactKind, typeof FileText> = {
  markdown: FileText,
  code: Code2,
  html: Globe,
  table: Table2,
  json: Braces,
};

const KIND_LABEL: Record<HubArtifactKind, string> = {
  markdown: "Markdown",
  code: "Code",
  html: "HTML",
  table: "Table",
  json: "JSON",
};

/** A hub artifact carries no language field (kind-only contract) — this is a best-effort Monaco id for
 *  the Diff tab; Monaco degrades to plain text highlighting on an unrecognized id, never a crash. */
const KIND_MONACO_LANGUAGE: Record<HubArtifactKind, string> = {
  markdown: "markdown",
  code: "plaintext",
  html: "html",
  table: "plaintext",
  json: "json",
};

const NO_ROLE_VALUE = "__none__";

/**
 * ui-wave U2 (owner feedback) — Streamdown's built-in table toolbar carries a "View fullscreen"
 * control that portals a RAW edge-to-edge takeover (`fixed inset-0`, no backdrop/title/dialog
 * chrome), which is exactly the pattern the owner rejected. `MarkdownView` deliberately blocks a
 * `components` override (its prose map is library-owned), so the table can't be re-routed through
 * `ExpandableTable` here — instead the raw-fullscreen control is switched OFF (copy/download stay)
 * and the canvas gets its own Expand action opening the app's NORMAL `@elabs-ai/components-ui` Dialog below.
 */
const MD_CONTROLS: MarkdownViewProps["controls"] = { table: { fullscreen: false } };

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function truncateForTitle(text: string, max = 60): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function ArtifactBody({
  artifact,
  version,
}: { artifact: HubArtifact; version: HubArtifactVersion }) {
  if (artifact.kind === "html") {
    return (
      <WebPreview className="size-full rounded-none border-0">
        <WebPreviewBody srcDoc={version.content} />
      </WebPreview>
    );
  }
  if (artifact.kind === "code") {
    return (
      <MarkdownView
        baseHeadingLevel={2}
        controls={MD_CONTROLS}
      >{`\`\`\`\n${version.content}\n\`\`\``}</MarkdownView>
    );
  }
  if (artifact.kind === "json") {
    return (
      <MarkdownView
        baseHeadingLevel={2}
        controls={MD_CONTROLS}
      >{`\`\`\`json\n${prettyJson(version.content)}\n\`\`\``}</MarkdownView>
    );
  }
  return (
    <MarkdownView baseHeadingLevel={2} controls={MD_CONTROLS}>
      {version.content}
    </MarkdownView>
  ); // markdown | table
}

/** Copy the `share.html` document to the clipboard — fetches the text (a plain `<a>` can only navigate/
 *  download, never write the clipboard) then writes it, with toast feedback either way. */
function useCopyShare(artifactId: string, version: number | undefined) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    setCopying(true);
    try {
      const html = await fetchHubArtifactShareHtml(artifactId, version);
      await navigator.clipboard.writeText(html);
      setCopied(true);
      toast.success("share.html copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      notifyError("Couldn’t copy share.html", { description: getErrorMessage(error) });
    } finally {
      setCopying(false);
    }
  }, [artifactId, version]);
  return { copying, copied, copy };
}

function ExportMenu({ artifact, version }: { artifact: HubArtifact; version: HubArtifactVersion }) {
  const { copying, copied, copy } = useCopyShare(artifact.id, version.version);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ArtifactAction icon={Download} tooltip="Export" label="Export" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={hubArtifactExportUrl(artifact.id, "md", version.version)} download>
            Markdown (.md)
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={hubArtifactExportUrl(artifact.id, "html", version.version)}
            target="_blank"
            rel="noreferrer"
          >
            HTML
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a
            href={hubArtifactExportUrl(artifact.id, "json", version.version)}
            target="_blank"
            rel="noreferrer"
          >
            JSON
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={hubArtifactShareUrl(artifact.id, version.version)} download>
            Download share.html
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copy()} disabled={copying}>
          {copied ? (
            <Check aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          Copy share.html
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The version list, newest first, plus the R-UX7 undo pairing: a per-(non-current)-version "Revert"
 *  action that appends a NEW version equal to that historical one (history stays immutable). */
function VersionList({
  versions,
  selectedVersionId,
  onSelect,
  onReverted,
}: {
  versions: HubArtifactVersion[];
  selectedVersionId: string | undefined;
  onSelect: (version: number) => void;
  onReverted: () => void;
}) {
  const ordered = [...versions].reverse(); // newest first
  const latestVersion = versions.at(-1)?.version;
  const [confirming, setConfirming] = useState<HubArtifactVersion | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmRevert = async () => {
    if (!confirming) return;
    setBusy(true);
    try {
      await revertHubArtifactVersion(confirming.artifactId, confirming.version);
      toast.success(`Reverted to version ${confirming.version}`);
      setConfirming(null);
      onReverted();
    } catch (error) {
      notifyError("Couldn’t revert", { description: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-border border-t p-2">
      <Text variant="meta" tone="muted" className="px-1 font-medium uppercase tracking-wide">
        Versions
      </Text>
      <ScrollArea className="max-h-32">
        <div className="flex flex-col gap-1 pr-2">
          {ordered.map((entry) => {
            const isSelected = entry.id === selectedVersionId;
            const isLatest = entry.version === latestVersion;
            return (
              <div key={entry.id} className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={isSelected ? "secondary" : "ghost"}
                  className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5"
                  onClick={() => onSelect(entry.version)}
                >
                  <Badge variant={isSelected ? "default" : "outline"} className="shrink-0">
                    v{entry.version}
                  </Badge>
                  <Text
                    as="span"
                    variant="meta"
                    tone="muted"
                    className="min-w-0 flex-1 truncate text-start"
                  >
                    {entry.authorKind} · {formatRelativeTime(entry.createdAt)}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </Text>
                </Button>
                {!isLatest ? (
                  <IconButton
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    label={`Revert to version ${entry.version}`}
                    onClick={() => setConfirming(entry)}
                  >
                    <RotateCcw aria-hidden className="size-3.5" />
                  </IconButton>
                ) : null}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={confirming ? `Revert to version ${confirming.version}?` : ""}
        description="This appends a NEW version with that version's content — nothing is deleted, and you can revert again."
        confirmLabel="Revert"
        busy={busy}
        onConfirm={() => void confirmRevert()}
      />
    </div>
  );
}

// ── Diff tab (WP3.5, R-UX13 companion) ──────────────────────────────────────────────────────────────

function DiffPanel({
  artifact,
  versions,
  selectedVersion,
}: {
  artifact: HubArtifact;
  versions: HubArtifactVersion[];
  selectedVersion: HubArtifactVersion;
}) {
  const ordered = [...versions].sort((a, b) => a.version - b.version);
  const priorVersion = ordered.filter((v) => v.version < selectedVersion.version).at(-1);
  const [fromVersionNumber, setFromVersionNumber] = useState(
    priorVersion?.version ?? ordered[0]?.version,
  );

  useEffect(() => {
    setFromVersionNumber(priorVersion?.version ?? ordered[0]?.version);
    // Only reset when the SELECTED version changes — the user's own "compare from" pick otherwise sticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersion.id]);

  if (ordered.length < 2) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState
          icon={<GitCompare aria-hidden />}
          title="Nothing to diff yet"
          description="A second version will let you compare changes here."
        />
      </div>
    );
  }

  const from = ordered.find((v) => v.version === fromVersionNumber) ?? ordered[0];
  if (!from) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-end gap-2">
        <SelectField
          id="hub-artifact-diff-from"
          label="Compare"
          value={String(from.version)}
          onChange={(value) => setFromVersionNumber(Number(value))}
          options={ordered
            .filter((v) => v.id !== selectedVersion.id)
            .map((v) => ({ value: String(v.version), label: `v${v.version}` }))}
        />
        <Text variant="meta" tone="muted" className="pb-2">
          → v{selectedVersion.version}
        </Text>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
        <DiffEditor
          original={from.content}
          modified={selectedVersion.content}
          language={KIND_MONACO_LANGUAGE[artifact.kind]}
          height="100%"
        />
      </div>
    </div>
  );
}

// ── Review tab (WP3.5, D-AH12 / D-AH7) ──────────────────────────────────────────────────────────────

function ReviewRequestForm({
  artifactId,
  roles,
  compact,
  onRequested,
}: {
  artifactId: string;
  roles: HubAgentRole[];
  compact?: boolean;
  onRequested: () => void;
}) {
  const [roleId, setRoleId] = useState(NO_ROLE_VALUE);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = roleId !== NO_ROLE_VALUE || model.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    try {
      await requestHubArtifactReview(artifactId, {
        ...(roleId !== NO_ROLE_VALUE ? { roleId } : {}),
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      toast.success("Review requested");
      setModel("");
      setRoleId(NO_ROLE_VALUE);
      onRequested();
    } catch (error) {
      notifyError("Couldn’t request a review", { description: getErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border border-border bg-card p-3",
        compact && "gap-2 p-2",
      )}
    >
      {!compact ? (
        <Text variant="meta" tone="muted">
          Ask a critic to review this version and suggest edits.
        </Text>
      ) : null}
      {roles.length > 0 ? (
        <SelectField
          id="hub-review-role"
          label="Role"
          value={roleId}
          onChange={setRoleId}
          options={[
            { value: NO_ROLE_VALUE, label: "No role — pick a model" },
            ...roles.map((r) => ({ value: r.id, label: r.name })),
          ]}
        />
      ) : null}
      {roleId === NO_ROLE_VALUE ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hub-review-model">Model</Label>
          <Input
            id="hub-review-model"
            name="model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="claude-sonnet-4-6…"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      ) : null}
      <Button type="button" size="sm" onClick={() => void submit()} disabled={busy || !canSubmit}>
        {busy ? (
          <Spinner className="size-4" aria-hidden />
        ) : (
          <Sparkles aria-hidden className="size-4" />
        )}
        <span>{compact ? "Request another review" : "Request review"}</span>
      </Button>
    </div>
  );
}

/** The reject affordance + before/after body — injected via `ChangeReview`'s sanctioned `renderHunk`
 *  override (the component has no dedicated per-hunk reject action, only the accept toggle + the
 *  header's bulk Approve/Reject all — see the module doc). Mirrors the component's OWN default
 *  before/after markup so a note-vs-edit comment reads consistently with the library's visual grammar. */
function renderReviewHunk(
  comments: HubReviewComment[],
  onReject: (commentId: string) => void,
  rejectingId: string | null,
) {
  return (hunk: ChangeHunk) => {
    const comment = comments.find((c) => c.id === hunk.id);
    if (!comment) return null;
    return (
      <div className="flex flex-col gap-2">
        <Text variant="body" className="text-foreground">
          {comment.body}
        </Text>
        {comment.suggestedEdit !== undefined ? (
          <div className="flex flex-col gap-1.5 text-body">
            {comment.anchor?.quote ? (
              <div className="flex gap-2">
                <span
                  aria-hidden="true"
                  className="shrink-0 select-none font-mono text-muted-foreground"
                >
                  −
                </span>
                <div className="min-w-0 break-words text-muted-foreground line-through decoration-muted-foreground/30">
                  {comment.anchor.quote}
                </div>
              </div>
            ) : null}
            <div className="flex gap-2">
              <span aria-hidden="true" className="shrink-0 select-none font-mono text-foreground">
                +
              </span>
              <div className="min-w-0 break-words text-foreground">{comment.suggestedEdit}</div>
            </div>
          </div>
        ) : null}
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={rejectingId === comment.id}
            onClick={() => onReject(comment.id)}
          >
            {rejectingId === comment.id ? (
              <Spinner className="size-4" aria-hidden />
            ) : (
              <X aria-hidden className="size-4" />
            )}
            <span>Reject</span>
          </Button>
        </div>
      </div>
    );
  };
}

function ReviewPanel({
  artifact,
  roles,
  onArtifactChanged,
}: {
  artifact: HubArtifact;
  roles: HubAgentRole[];
  onArtifactChanged: () => void;
}) {
  const [reviews, setReviews] = useState<HubReview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await listHubArtifactReviews(artifact.id);
      setReviews(list);
    } catch (error) {
      notifyError("Couldn’t load reviews", { description: getErrorMessage(error) });
    } finally {
      setLoaded(true);
    }
  }, [artifact.id]);

  useEffect(() => {
    setLoaded(false);
    setReviews([]);
    void refresh();
  }, [refresh]);

  const review = reviews.at(-1);
  const role = roles.find((r) => r.id === review?.reviewerRef);
  const pending = review?.comments.filter((c) => c.decision === "pending") ?? [];
  const decided = review?.comments.filter((c) => c.decision !== "pending") ?? [];

  const handleAccept = useCallback(
    async (commentId: string) => {
      if (!review) return;
      setDecidingId(commentId);
      try {
        const result = await decideHubReview(review.id, {
          decision: { commentId, decision: "accepted" },
        });
        if (result.resultingVersion) {
          toast.success(`Applied — created version ${result.resultingVersion.version}`);
          onArtifactChanged();
        }
        await refresh();
      } catch (error) {
        notifyError("Couldn’t apply the suggestion", { description: getErrorMessage(error) });
      } finally {
        setDecidingId(null);
      }
    },
    [review, refresh, onArtifactChanged],
  );

  const handleReject = useCallback(
    async (commentId: string) => {
      if (!review) return;
      setDecidingId(commentId);
      try {
        await decideHubReview(review.id, { decision: { commentId, decision: "rejected" } });
        await refresh();
      } catch (error) {
        notifyError("Couldn’t reject the suggestion", { description: getErrorMessage(error) });
      } finally {
        setDecidingId(null);
      }
    },
    [review, refresh],
  );

  const handleApproveAll = async () => {
    setBulkBusy(true);
    for (const comment of pending) await handleAccept(comment.id);
    setBulkBusy(false);
  };

  const handleRejectAll = async () => {
    setBulkBusy(true);
    for (const comment of pending) await handleReject(comment.id);
    setBulkBusy(false);
  };

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Spinner className="size-5" />
      </div>
    );
  }

  const hunks: ChangeHunk[] = pending.map((c) => ({
    id: c.id,
    title: c.anchor?.quote ? truncateForTitle(c.anchor.quote) : "Note",
  }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-2">
      {!review || review.comments.length === 0 ? (
        <EmptyState
          icon={<Sparkles aria-hidden />}
          title="No review yet"
          description="Ask a critic to review this version and suggest edits."
        />
      ) : null}

      {pending.length > 0 && review ? (
        <fieldset disabled={bulkBusy} className="min-w-0">
          <ChangeReview
            hunks={hunks}
            provenance={{
              author: role?.name ?? "Critic",
              timestamp: formatRelativeTime(review.createdAt),
            }}
            onToggle={(id, next) => {
              if (next) void handleAccept(id);
            }}
            onApproveAll={() => void handleApproveAll()}
            onRejectAll={() => void handleRejectAll()}
            renderHunk={renderReviewHunk(pending, (id) => void handleReject(id), decidingId)}
          />
        </fieldset>
      ) : null}

      {decided.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Text variant="meta" tone="muted" className="px-1 font-medium uppercase tracking-wide">
            Decided
          </Text>
          {decided.map((c) => (
            <div
              key={c.id}
              className="flex items-start gap-2 rounded-md border border-border bg-card p-2"
            >
              <Badge
                variant={c.decision === "accepted" ? "success" : "secondary"}
                className="shrink-0"
              >
                {c.decision}
              </Badge>
              <Text variant="meta" className="min-w-0 flex-1 break-words">
                {c.body}
              </Text>
            </div>
          ))}
        </div>
      ) : null}

      <ReviewRequestForm
        artifactId={artifact.id}
        roles={roles}
        compact={!!review}
        onRequested={() => void refresh()}
      />
    </div>
  );
}

export function ArtifactCanvas({
  sessionId,
  turnRunning,
  onClose,
}: {
  sessionId: string;
  /** A turn just settling (false→true→false) is the app's own signal that a NEW artifact version may
   *  exist (the model's built-ins run mid-turn) — mirrors `AssistantView.tsx`'s own settle-detection. */
  turnRunning?: boolean;
  onClose?: () => void;
}) {
  const [artifacts, setArtifacts] = useState<HubArtifact[]>([]);
  const [artifactsLoaded, setArtifactsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<HubArtifactVersion[]>([]);
  const [versionsLoaded, setVersionsLoaded] = useState(false);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null);
  const [roles, setRoles] = useState<HubAgentRole[]>([]);
  // ui-wave U2 (owner feedback) — the outputs viewer's expand target is the app's NORMAL modal
  // Dialog (backdrop, title, close button, Escape), never a raw fullscreen takeover.
  const [expanded, setExpanded] = useState(false);

  const refreshArtifacts = useCallback(async () => {
    try {
      const list = await listHubArtifacts({ session: sessionId });
      setArtifacts(list);
      setSelectedId((current) =>
        current && list.some((a) => a.id === current) ? current : (list[0]?.id ?? null),
      );
    } catch (error) {
      notifyError("Couldn’t load artifacts", { description: getErrorMessage(error) });
    } finally {
      setArtifactsLoaded(true);
    }
  }, [sessionId]);

  useEffect(() => {
    setArtifactsLoaded(false);
    setArtifacts([]);
    setSelectedId(null);
    void refreshArtifacts();
  }, [refreshArtifacts]);

  useEffect(() => {
    // The role library (D-AH7) for the review-request form's picker — best-effort, not gating.
    listHubAgentRoles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  const prevRunningRef = useRef(false);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = !!turnRunning;
    if (!wasRunning || turnRunning) return; // only on the falling edge (just settled)
    void refreshArtifacts();
  }, [turnRunning, refreshArtifacts]);

  const refreshVersions = useCallback(async () => {
    if (!selectedId) {
      setVersions([]);
      setVersionsLoaded(true);
      return;
    }
    try {
      const list = await listHubArtifactVersions(selectedId);
      setVersions(list);
    } catch (error) {
      notifyError("Couldn’t load versions", { description: getErrorMessage(error) });
    } finally {
      setVersionsLoaded(true);
    }
  }, [selectedId]);

  useEffect(() => {
    setVersionsLoaded(false);
    setSelectedVersionNumber(null);
    void refreshVersions();
    // `refreshVersions` itself only changes identity when `selectedId` does — re-running on every
    // identity change (incl. from `handleArtifactChanged` below) is exactly what a manual refresh needs.
  }, [refreshVersions]);

  /** WP3.5 — a review acceptance or a revert appends a new artifact version out from under this view;
   *  re-fetch both the artifact (latestVersion/currentVersionId) and its versions, then jump to the
   *  newest one so the change is immediately visible. */
  const handleArtifactChanged = useCallback(() => {
    void (async () => {
      await refreshArtifacts();
      const list = await listHubArtifactVersions(selectedId ?? "").catch(() => []);
      if (list.length > 0) {
        setVersions(list);
        setSelectedVersionNumber(list.at(-1)?.version ?? null);
      }
    })();
  }, [refreshArtifacts, selectedId]);

  if (!artifactsLoaded || (selectedId !== null && !versionsLoaded)) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col p-2">
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={<FileText aria-hidden />}
            title="No artifacts yet"
            description="Documents, code, and other deliverables the assistant creates in this session will appear here."
          />
        </div>
      </div>
    );
  }

  const artifact = artifacts.find((a) => a.id === selectedId) ?? null;
  const version =
    (selectedVersionNumber !== null
      ? versions.find((v) => v.version === selectedVersionNumber)
      : undefined) ??
    versions.at(-1) ??
    null;

  if (!artifact || !version) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <Spinner className="size-5" />
      </div>
    );
  }

  const Icon = KIND_ICON[artifact.kind];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      {artifacts.length > 1 ? (
        <SelectField
          id="hub-artifact-picker"
          label="Artifact"
          value={artifact.id}
          onChange={setSelectedId}
          options={artifacts.map((a) => ({ value: a.id, label: a.title }))}
        />
      ) : null}

      <Artifact className="min-h-0 flex-1">
        <ArtifactHeader>
          <div className="flex min-w-0 items-center gap-2">
            <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <ArtifactTitle className="truncate">{artifact.title}</ArtifactTitle>
              <ArtifactDescription>
                {KIND_LABEL[artifact.kind]} · v{version.version} of {artifact.latestVersion}
              </ArtifactDescription>
            </div>
          </div>
          <ArtifactActions>
            <ArtifactAction
              icon={Maximize2}
              tooltip="Expand"
              label="Expand"
              onClick={() => setExpanded(true)}
            />
            <ExportMenu artifact={artifact} version={version} />
            {onClose ? <ArtifactClose onClick={onClose} /> : null}
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent className="min-h-0 flex-1 overflow-hidden p-0">
          <Tabs defaultValue="content" className="flex h-full min-h-0 flex-col">
            <ScrollableTabsList containerClassName="shrink-0 border-border border-b px-2 pt-1">
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="diff">Diff</TabsTrigger>
              <TabsTrigger value="review">Review</TabsTrigger>
            </ScrollableTabsList>
            <TabsContent
              value="content"
              className={cn("min-h-0 flex-1 overflow-auto", artifact.kind !== "html" && "p-4")}
            >
              <ArtifactBody artifact={artifact} version={version} />
            </TabsContent>
            <TabsContent value="diff" className="min-h-0 flex-1 overflow-hidden">
              <DiffPanel artifact={artifact} versions={versions} selectedVersion={version} />
            </TabsContent>
            <TabsContent value="review" className="min-h-0 flex-1 overflow-auto">
              <ReviewPanel
                artifact={artifact}
                roles={roles}
                onArtifactChanged={handleArtifactChanged}
              />
            </TabsContent>
          </Tabs>
        </ArtifactContent>
      </Artifact>

      {versions.length > 1 ? (
        <VersionList
          versions={versions}
          selectedVersionId={version.id}
          onSelect={setSelectedVersionNumber}
          onReverted={handleArtifactChanged}
        />
      ) : null}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        {/* ui-wave U2 (owner feedback) — the expanded outputs view: the app's normal `@elabs-ai/components-ui`
            Dialog at the owner's ask (max-w-5xl / max-h-[85vh], body scrolls inside), titled with the
            ARTIFACT title, with the export/copy actions repeated in the header so they stay reachable
            while the canvas behind the overlay is inert. No description → aria-describedby opt-out
            (the WideDialog sanctioned escape). Only mounts while open (Radix), so no double render. */}
        <DialogContent
          size="xl"
          aria-describedby={undefined}
          className="flex max-h-[85vh] max-w-5xl flex-col gap-0 p-0"
        >
          <DialogHeader className="flex-none flex-row items-center gap-2 border-b border-border p-4 pe-12">
            <DialogTitle className="min-w-0 flex-1 truncate">{artifact.title}</DialogTitle>
            <ExportMenu artifact={artifact} version={version} />
          </DialogHeader>
          <div
            className={cn("min-h-0 flex-1 overflow-auto", artifact.kind !== "html" && "p-4")}
          >
            <ArtifactBody artifact={artifact} version={version} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
