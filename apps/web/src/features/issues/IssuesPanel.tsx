import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type {
  FixTarget,
  RatingIssue,
  RatingIssueSeverity,
  RatingIssueTargetKind,
  RootCauseBucket,
} from "@mcp-token-footprint/shared";
import { Badge, Button, Skeleton, Text, toast } from "@elabs-ai/components-ui";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { FailureEvidence } from "../../components/FailureEvidence";
import { InlineError } from "../../components/InlineError";
import { CountBadge } from "../../components/StatusBadge";
import { TabEmptyState } from "../../components/TabEmptyState";
import { issuesExportUrl, updateIssueStatus } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime, formatNumber } from "../../lib/format";
import type { Loadable } from "../../lib/loadable";
import { notifyError } from "../../lib/notify";
import { SEVERITY_META } from "../issues-fleet/issue-lib";

/**
 * IssuesPanel — the ONE Issues-tab surface, shared by the MCP-server detail view and the skill
 * inspector (Rating Issues registry, the auto-learning loop). Renders a target's deduplicated,
 * persistent issues: count/severity roll-up + export attachments in the header, then one bordered
 * row per issue (status/severity/bucket/fix-target chips, "seen N×", the labeled draft-fix
 * SUGGESTION — never auto-applied — and deep links to every contributing run).
 *
 * Data ownership: the PARENT calls `useRatingIssues` (page-level, so the tab strip can badge the
 * open count before this tab ever mounts) and passes `state` + `onReload` down. The only mutation
 * here is the manual resolve / re-open (`PATCH /api/issues/:id`) — optimistic-free: on success the
 * panel simply refetches via `onReload`.
 *
 * The chip vocabulary mirrors the run console's Report tab (bucket + fixTarget chips, the
 * "Suggested fix" panel) so the SAME finding reads identically whether seen per-run or rolled up
 * here. Status/severity are this feature's OWN dimension → plain semantic-variant Badges (the AR6
 * pattern), not the app-wide `StatusBadge` wire-status vocabulary.
 */
export type IssuesPanelProps = {
  targetKind: RatingIssueTargetKind;
  targetId: string;
  /** Display name for copy (e.g. the assistant prompt) — issues also carry their own denormalized name. */
  targetName: string;
  state: Loadable<RatingIssue[]>;
  onReload: () => void;
  /**
   * Skill inspector only — wires the "Fix with assistant" action on each OPEN issue (the caller
   * opens the assistant dock prefilled via `useAssistant().openAssistant`, gated on auth). Omitted
   * (server targets / assistant not configured) the action simply doesn't render.
   */
  onFixWithAssistant?: (issue: RatingIssue) => void;
};

/** Stable empty list so the sort memo doesn't recompute on every loading/error render. */
const NO_ISSUES: RatingIssue[] = [];

export function IssuesPanel({
  targetKind,
  targetId,
  targetName,
  state,
  onReload,
  onFixWithAssistant,
}: IssuesPanelProps) {
  // Per-issue busy state for the resolve/re-open action (never a global spinner).
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null);

  const issues = state.status === "data" ? state.data : NO_ISSUES;
  // Open first, then most recently seen — the actionable ones lead.
  const sorted = useMemo(
    () =>
      [...issues].sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      }),
    [issues],
  );

  async function toggleStatus(issue: RatingIssue) {
    const next = issue.status === "open" ? "resolved" : "open";
    setBusyIssueId(issue.id);
    try {
      await updateIssueStatus(issue.id, next);
      toast.success(next === "resolved" ? "Issue resolved" : "Issue reopened");
      onReload();
    } catch (cause) {
      notifyError(next === "resolved" ? "Couldn’t resolve the issue." : "Couldn’t reopen the issue.", {
        description: `${getErrorMessage(cause)} Try again.`,
      });
    } finally {
      setBusyIssueId(null);
    }
  }

  if (state.status === "loading") return <IssuesSkeleton />;

  if (state.status === "error") {
    return <InlineError title="Couldn’t load issues" detail={state.error} onRetry={onReload} />;
  }

  if (sorted.length === 0) {
    return (
      <TabEmptyState
        icon={<ShieldCheck aria-hidden />}
        title="No issues recorded"
        description={`Runs that hit problems with this ${
          targetKind === "skill" ? "skill" : "server"
        } will file them here automatically.`}
      />
    );
  }

  const openCount = sorted.filter((issue) => issue.status === "open").length;
  const resolvedCount = sorted.length - openCount;
  const severityCount = (severity: RatingIssueSeverity) =>
    sorted.filter((issue) => issue.severity === severity).length;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header: count chips + severity distribution + export attachments ── */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <CountBadge value={openCount} tone="warning">
            {`${formatNumber(openCount)} open`}
          </CountBadge>
          <CountBadge value={resolvedCount} tone="success">
            {`${formatNumber(resolvedCount)} resolved`}
          </CountBadge>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <CountBadge value={severityCount("high")} tone="danger">
            {`${formatNumber(severityCount("high"))} high`}
          </CountBadge>
          <CountBadge value={severityCount("medium")} tone="warning">
            {`${formatNumber(severityCount("medium"))} medium`}
          </CountBadge>
          <CountBadge value={severityCount("low")}>
            {`${formatNumber(severityCount("low"))} low`}
          </CountBadge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={issuesExportUrl("markdown", targetKind, targetId)} download>
              <FileText aria-hidden />
              <span>Export Markdown</span>
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={issuesExportUrl("json", targetKind, targetId)} download>
              <Download aria-hidden />
              <span>Export JSON</span>
            </a>
          </Button>
        </div>
      </div>

      {/* ── The issues, open first ── */}
      <ul aria-label={`Rating issues for ${targetName}`} className="flex flex-col gap-3">
        {sorted.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            busy={busyIssueId === issue.id}
            onToggleStatus={() => void toggleStatus(issue)}
            onFixWithAssistant={onFixWithAssistant}
          />
        ))}
      </ul>
    </div>
  );
}

function IssueRow({
  issue,
  busy,
  onToggleStatus,
  onFixWithAssistant,
}: {
  issue: RatingIssue;
  busy: boolean;
  onToggleStatus: () => void;
  onFixWithAssistant?: (issue: RatingIssue) => void;
}) {
  const status = STATUS_META[issue.status];
  const severity = SEVERITY_META[issue.severity];
  const fix = FIX_TARGET_META[issue.fixTarget];
  const open = issue.status === "open";

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      {/* Chip row — status/severity are this feature's own dimension; bucket/fixTarget mirror the
          run Report tab so one finding reads identically per-run and rolled-up. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <Badge variant={status.variant}>{status.label}</Badge>
        <Badge variant={severity.variant}>{severity.label}</Badge>
        <Badge variant="outline">{BUCKET_LABELS[issue.bucket]}</Badge>
        <Badge variant={fix.variant}>{fix.label}</Badge>
        <Text variant="meta" tone="muted" className="ml-1 tabular-nums">
          seen {formatNumber(issue.timesSeen)}×
        </Text>
        <Text variant="meta" tone="muted" className="tabular-nums">
          · last seen {formatDateTime(issue.lastSeenAt)}
        </Text>
      </div>

      <Text className="break-words font-medium text-pretty">{issue.title}</Text>
      <Text variant="meta" tone="muted" className="break-words text-pretty">
        {issue.summary}
      </Text>

      {/* The draft fix is a SUGGESTION — the app never auto-applies it (same recipe as ReportTab). */}
      <div className="rounded-md border border-border bg-card p-2.5">
        <div className="flex items-center gap-1.5">
          <Wrench aria-hidden className="size-3.5 text-muted-foreground" />
          <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
            Draft fix
          </Text>
        </div>
        <Text className="mt-1 break-words">{issue.draftFix}</Text>
      </div>

      {/* Contributing runs — deep links into the run console (+ the suite run when one exists). */}
      {issue.occurrences.length > 0 ? (
        <div className="flex flex-col gap-1">
          <Text variant="meta" tone="muted">
            Occurrences ({formatNumber(issue.occurrences.length)})
          </Text>
          <ul className="flex flex-col gap-1">
            {issue.occurrences.map((occurrence, index) => (
              <li key={`${occurrence.runId}:${index}`} className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0">
                    <Link to={`/testing/runs/${occurrence.runId}`}>
                      <span>Run {shortId(occurrence.runId)}</span>
                      <ExternalLink aria-hidden className="size-3 shrink-0" />
                    </Link>
                  </Button>
                  {occurrence.suiteRunId ? (
                    <Button asChild variant="link" size="sm" className="h-auto gap-1 p-0">
                      <Link to={`/testing/suite-runs/${occurrence.suiteRunId}`}>
                        <span>Suite run {shortId(occurrence.suiteRunId)}</span>
                        <ExternalLink aria-hidden className="size-3 shrink-0" />
                      </Link>
                    </Button>
                  ) : null}
                  <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                    {formatDateTime(occurrence.createdAt)}
                  </Text>
                  <Text variant="meta" tone="muted" className="shrink-0">
                    {humanizeCategory(occurrence.category)}
                  </Text>
                  <Text
                    variant="meta"
                    tone="muted"
                    className="min-w-0 truncate"
                    title={occurrence.message}
                  >
                    {occurrence.message}
                  </Text>
                </div>
                {/* The ACTUAL wrong call + exact error for this sighting (when captured). */}
                <FailureEvidence
                  toolName={occurrence.toolName}
                  sentArguments={occurrence.sentArguments}
                  errorMessage={occurrence.errorMessage}
                  className="pl-0.5"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Actions — per-issue busy state; refetch (not optimistic) after the PATCH settles. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={onToggleStatus}>
          {open ? <CheckCircle2 aria-hidden /> : <RotateCcw aria-hidden />}
          <span>{busy ? (open ? "Resolving…" : "Reopening…") : open ? "Resolve" : "Reopen"}</span>
        </Button>
        {open && onFixWithAssistant ? (
          <Button variant="outline" size="sm" onClick={() => onFixWithAssistant(issue)}>
            <Sparkles aria-hidden />
            <span>Fix with assistant</span>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The assistant prompt for one open skill issue — prefilled into the dock's composer (never
 * auto-sent; the edit itself goes through the existing approval-gated workspace flow, which lands
 * as a NEW immutable version). Exported for the skill inspector + tests.
 */
export function buildIssueFixPrompt(skillName: string, issue: RatingIssue): string {
  return [
    `The skill “${skillName}” has an open rating issue filed against it:`,
    "",
    `Issue: ${issue.title}`,
    `Summary: ${issue.summary}`,
    `Draft fix: ${issue.draftFix}`,
    "",
    "Analyze the skill’s current version and propose an edit implementing this fix. Open the skill workspace, apply the change, and stage it for my approval as a new immutable version — do not commit anything without my approval.",
  ].join("\n");
}

/** Truncated id for a link label — the full id lives in the href/console, not the copy. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Sentence-case a wire category token (`failed_tool_call` → "Failed tool call") — no raw snake_case in UI. */
function humanizeCategory(raw: string): string {
  const words = raw.replace(/[_-]+/g, " ").trim();
  if (words.length === 0) return "";
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

// ── Chip metadata ─────────────────────────────────────────────────────────────────────────────────

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "info";

/** Issue lifecycle chips — this feature's own dimension (AR6 pattern: plain semantic Badges). */
const STATUS_META: Record<RatingIssue["status"], { label: string; variant: BadgeVariant }> = {
  open: { label: "Open", variant: "warning" },
  resolved: { label: "Resolved", variant: "success" },
};

// RM-37 WP 0.5 (action 8) — severity used to be a THIRD hand-written copy of this exact map (the
// fleet Issues tab in `../issues-fleet/issue-lib.ts` carried an identical one), and neither file
// forced the two to agree — Advisor's own copy disagreed with both on top. `SEVERITY_META` is now
// imported from `issue-lib.ts`, which itself reads label + variant off the one shared
// `SEVERITY_RAMP` (`@mcp-token-footprint/shared`), so this panel and the fleet Issues tab render
// the SAME severity as the SAME chip by construction — there is no cycle: `issue-lib.ts` imports
// only from `@mcp-token-footprint/shared`, never from this feature.

// Mirrors the run console ReportTab's bucket/fixTarget chip vocabulary EXACTLY (those maps are
// module-private there) — one finding must read identically per-run and rolled up here.
const BUCKET_LABELS: Record<RootCauseBucket, string> = {
  skill: "Skill",
  mcp_server: "MCP server",
  model_behavior: "Model behavior",
  test_setup: "Test setup",
  provider_infra: "Provider infra",
};

const FIX_TARGET_META: Record<FixTarget, { label: string; variant: BadgeVariant }> = {
  skill: { label: "Fix in skill", variant: "info" },
  mcp_server: { label: "Fix in MCP server", variant: "warning" },
  none: { label: "No fix target", variant: "outline" },
};

// ── Loading skeleton (layout-shaped, no collapsing spinner — loading-states rule) ────────────────

function IssuesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* A live status announces "loading" to assistive tech; the shaped skeletons are decorative. */}
      <output className="sr-only">Loading issues…</output>
      <div className="flex flex-col gap-4" aria-hidden>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-36 rounded-md" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        </div>
        {[0, 1].map((key) => (
          <div key={key} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
