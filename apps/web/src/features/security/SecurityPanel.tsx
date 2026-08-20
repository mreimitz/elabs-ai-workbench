import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  SECURITY_EVIDENCE_MAX_CHARS,
  SECURITY_RULES,
  type SecurityFinding,
  type SecurityFindingAnchor,
  type SecurityFindingCounts,
  type SecurityPostureDiff,
  type SecurityReport,
  type SecurityRuleId,
  securityFindingIdentity,
} from "@mcp-token-footprint/shared";
import { type ColumnDef, DataTable } from "@elabs-ai/components-data";
import {
  Alert,
  AlertDescription,
  Button,
  MetricCard,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { ShieldCheck } from "lucide-react";
import { InlineError } from "../../components/InlineError";
import { TabEmptyState } from "../../components/TabEmptyState";
import { formatDateTime, formatNumber } from "../../lib/format";
import { type Loadable, useLoadable } from "../../lib/loadable";
import { FindingSeverityBadge } from "./FindingSeverityBadge";
import { PostureScore } from "./PostureScore";
import { SecurityDiffPanel } from "./SecurityDiffPanel";
import {
  getScanSecurityDiff,
  getScanSecurityReport,
  getSkillSecurityDiff,
  getSkillSecurityReport,
} from "./security-api";

/**
 * SecurityPanel — the Security tab's whole body, for a scan AND for a skill version.
 * =============================================================================================
 * One component serves both because a posture report is one shape for both subjects (D-SP1); that
 * is precisely what WP 1.1–1.4 bought, and forking it here would spend it.
 *
 * **The report is the answer, and the UI does not second-guess it.**
 *   • Findings render in the order they arrive — `compareSecurityFindings` is the only sort (D-SP6).
 *   • The score and the band come off `score`; nothing here re-derives either (D-SP3).
 *   • Every count comes off `counts`, which describes ALL findings the analyzer produced, including
 *     any the display cap dropped. `findings.length` is never counted. When `truncated` is set the
 *     panel says so out loud, because a list that is quietly shorter than its own tally is the one
 *     way this surface could lie.
 *   • An anchor renders per KIND (D-SP12) — a skill finding never prints the word "server".
 *
 * **URL state, not a route (D-SP21).** The Security tab lives inside `/scans/:scanId` and
 * `/skills/:skillId`, which already exist; the baseline selection is `?baseline=<id>` on those. No
 * `<Route>` is added, so `ASSISTANT_ROUTE_MANIFEST` and its gate are untouched.
 */

/** What is being reported on. The two arms are the two subject kinds the analyzer knows. */
export type SecuritySubjectTarget =
  | { kind: "scan"; scanId: string }
  | { kind: "skill"; skillId: string; versionId: string };

/** One selectable baseline — another scan of this server, or another version of this skill. */
export type SecurityBaselineOption = { id: string; label: string };

export type SecurityPanelProps = {
  target: SecuritySubjectTarget;
  /** Newest first, EXCLUDING the current subject — the caller owns that filtering. */
  baselines: SecurityBaselineOption[];
  /** The report, loaded by the HOST via {@link useSecurityReport} — see that hook for why. */
  state: Loadable<SecurityReport>;
  /** Retry the host's load, wired to the error state's Retry button. */
  onRetry: () => void;
  className?: string;
};

/** The `?baseline=` parameter both this panel and its diff child read. */
const BASELINE_PARAM = "baseline";

function targetKey(target: SecuritySubjectTarget): string {
  return target.kind === "scan" ? target.scanId : `${target.skillId}/${target.versionId}`;
}

function loadReport(target: SecuritySubjectTarget): Promise<SecurityReport> {
  return target.kind === "scan"
    ? getScanSecurityReport(target.scanId)
    : getSkillSecurityReport(target.skillId, target.versionId);
}

/**
 * Load one subject's posture report — called by the PAGE, not by the panel.
 *
 * That split exists for one concrete reason: the tab strip badges the Security tab with
 * `counts.total`, and Radix unmounts an inactive tab's content, so a panel that owned its own fetch
 * could not supply a count until after the tab had been opened once. `SkillInspector` already solves
 * this the same way for its Issues count (`useRatingIssues` at page level), and this follows it — one
 * fetch, one source of truth for both the badge and the body.
 *
 * `enabled: false` keeps the hook in `loading` without fetching, for a host whose subject id is not
 * known yet (no scan selected, no version resolved).
 */
export function useSecurityReport(
  target: SecuritySubjectTarget,
  opts?: { enabled?: boolean },
): { state: Loadable<SecurityReport>; reload: () => void } {
  return useLoadable(() => loadReport(target), [targetKey(target)], {
    enabled: opts?.enabled ?? true,
  });
}

/**
 * Load the posture diff against `baselineId`, or stay in `loading` while there is no baseline.
 *
 * It is a hook rather than a fetch inside `SecurityDiffPanel` because `SecurityPanel` has to know
 * whether the diff was REFUSED: on a refusal it keeps rendering the current report, which it can
 * only decide if it can see the diff's state.
 */
function useSecurityDiff(
  target: SecuritySubjectTarget,
  baselineId: string | null,
): Loadable<SecurityPostureDiff> {
  const { state } = useLoadable(
    () =>
      target.kind === "scan"
        ? getScanSecurityDiff(target.scanId, baselineId ?? "")
        : getSkillSecurityDiff(target.skillId, target.versionId, baselineId ?? ""),
    [targetKey(target), baselineId ?? ""],
    { enabled: baselineId !== null },
  );
  return state;
}

export function SecurityPanel({
  target,
  baselines,
  state,
  onRetry,
  className,
}: SecurityPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // A baseline naming something that is no longer selectable (a deleted scan, a link from another
  // subject) resolves to "no baseline" rather than to a diff request nobody can act on.
  const rawBaseline = searchParams.get(BASELINE_PARAM);
  const baselineId = baselines.some((entry) => entry.id === rawBaseline) ? rawBaseline : null;

  const setBaselineId = useCallback(
    (next: string | null) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next === null) params.delete(BASELINE_PARAM);
          else params.set(BASELINE_PARAM, next);
          return params;
        },
        // `replace` so picking through four baselines does not bury the page in the Back stack —
        // the URL is still shareable and still survives a reload, which is what D-SP21 asks for.
        { replace: true },
      );
    },
    [setSearchParams],
  );

  if (state.status === "loading") {
    // A layout-shaped placeholder, not a spinner (`.claude/rules/loading-states.md`): four tiles the
    // size of the real ones, then rows the size of the real table.
    return (
      <div className={cn("flex flex-col gap-4", className)} aria-busy="true">
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Posture score" value="" loading announceLoading={false} />
          <MetricCard label="Errors" value="" loading announceLoading={false} />
          <MetricCard label="Warnings" value="" loading announceLoading={false} />
          <MetricCard label="Info" value="" loading announceLoading={false} />
        </div>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    // A settled failure, never dressed up as "nothing found". The message is the API's own — for a
    // scan that is D-SP10's "has status …, so it has no complete tool list to analyse", and for a
    // skill version D-SP16's "has no SKILL.md" — both of which tell the operator what to do next.
    return (
      <InlineError
        className={className}
        title="Couldn’t analyse the security posture"
        detail={state.error}
        onRetry={onRetry}
      />
    );
  }

  const report = state.data;

  return (
    <SecurityPanelBody
      target={target}
      report={report}
      baselines={baselines}
      baselineId={baselineId}
      onBaselineChange={setBaselineId}
      className={className}
    />
  );
}

/**
 * The loaded panel. Split out so the diff's own load can be a hook without sitting behind the three
 * early returns above — and so the ONE decision that needs both loads lives in one place:
 *
 *   • **a diff that came back** replaces the findings list, because that is the question the
 *     operator just asked and showing both would be two answers to it;
 *   • **a diff that was REFUSED** does not (D-SP19/A5) — the refusal is shown as an `Alert` and the
 *     current report keeps rendering underneath, so a meaningless comparison costs the operator the
 *     comparison, never the report they already had.
 */
function SecurityPanelBody({
  target,
  report,
  baselines,
  baselineId,
  onBaselineChange,
  className,
}: {
  target: SecuritySubjectTarget;
  report: SecurityReport;
  baselines: SecurityBaselineOption[];
  baselineId: string | null;
  onBaselineChange: (next: string | null) => void;
  className?: string;
}) {
  const diffState = useSecurityDiff(target, baselineId);
  const showReportFindings = baselineId === null || diffState.status === "error";

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <PostureHeader report={report} />

      <SecurityDiffPanel
        target={target}
        subjectReport={report}
        baselines={baselines}
        baselineId={baselineId}
        onBaselineChange={onBaselineChange}
        state={diffState}
      />

      {showReportFindings ? <ReportFindings report={report} /> : null}
    </div>
  );
}

/** The KPI grid + the provenance line. Every figure is read off the report, never recomputed. */
function PostureHeader({ report }: { report: SecurityReport }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Posture score"
          value={<PostureScore score={report.score} />}
          description={`${formatNumber(report.counts.total)} ${
            report.counts.total === 1 ? "finding" : "findings"
          }`}
        />
        <MetricCard label="Errors" value={formatNumber(report.counts.error)} />
        <MetricCard label="Warnings" value={formatNumber(report.counts.warning)} />
        <MetricCard label="Info" value={formatNumber(report.counts.info)} />
      </div>

      <Text variant="meta" tone="muted" className="tabular-nums text-pretty">
        {`Security analyzer v${formatNumber(report.analyzerVersion)} · ${report.subject.name} · captured ${formatDateTime(
          report.subject.capturedAt,
        )} · analysed ${formatDateTime(report.generatedAt)}`}
      </Text>

      {report.truncated ? (
        // D-SP4/A7 — the LIST was capped; `counts` above still describes every finding. Saying so is
        // not optional: a table quietly shorter than the tally beside it is the one lie this surface
        // could tell.
        <Alert variant="warning">
          <AlertDescription>
            {`This report produced ${formatNumber(report.counts.total)} findings and lists the first ${formatNumber(
              report.findings.length,
            )}. The counts above describe all of them. A posture diff is refused while a report is truncated — fix the findings listed here, then diff again.`}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** The plain report: the findings table, or D-SP23's real answer when there is nothing to show. */
function ReportFindings({ report }: { report: SecurityReport }) {
  if (report.findings.length === 0) {
    return <CleanSubjectState counts={report.counts} analyzerVersion={report.analyzerVersion} />;
  }
  return (
    <FindingsTable
      findings={report.findings}
      label={`Security findings for ${report.subject.name}`}
    />
  );
}

/**
 * D-SP23 — a clean subject gets a REAL answer that names what was checked, not a blank panel. A
 * blank panel is indistinguishable from a broken one, and "we found nothing" is worth only as much
 * as the list of things you looked for.
 */
export function CleanSubjectState({
  counts,
  analyzerVersion,
}: {
  counts: SecurityFindingCounts;
  analyzerVersion: number;
}) {
  const ruleCount = Object.keys(SECURITY_RULES).length;
  return (
    <TabEmptyState
      size="sm"
      icon={<ShieldCheck aria-hidden />}
      title="Nothing found"
      description={`All ${formatNumber(ruleCount)} security rules ran under analyzer v${formatNumber(
        analyzerVersion,
      )} and reported ${formatNumber(counts.total)} findings.`}
    />
  );
}

// ── The findings table ──────────────────────────────────────────────────────────────────────────

/**
 * D-SP12 — an anchor's words depend on its KIND. `server` says "This server", `skill` says "This
 * skill version"; neither borrows the other's noun, which is the whole reason `skill` got its own
 * variant instead of reusing `server`.
 */
export function anchorLabel(anchor: SecurityFindingAnchor): string {
  switch (anchor.kind) {
    case "server":
      return "This server";
    case "skill":
      return "This skill version";
    case "tool":
      return anchor.toolName;
    case "parameter":
      return `${anchor.toolName} · ${anchor.parameterPath}`;
    case "file":
      return anchor.path;
    default: {
      const exhaustive: never = anchor;
      return exhaustive;
    }
  }
}

/** The rule's own title, or its raw id if a report arrives under a build that does not know it. */
function ruleTitle(ruleId: SecurityRuleId): string {
  return SECURITY_RULES[ruleId]?.title ?? ruleId;
}

/**
 * The five columns, built ONCE at module scope because they close over nothing.
 *
 * `enableSorting: false` on every one of them is the point of this block, not an oversight.
 * `compareSecurityFindings` already put the worst finding first (D-SP6), and a sortable header would
 * hand an operator one click that replaces the analyzer's severity order with an alphabetical one —
 * exactly the "the UI never re-sorts findings" line D-SP3/D-SP6 draw. So these are plain
 * `ColumnDef`s rather than `lib/table`'s `col()`, which turns sorting on by default.
 */
const FINDING_COLUMNS: ColumnDef<SecurityFinding>[] = [
  {
    id: "severity",
    accessorFn: (finding) => finding.severity,
    enableSorting: false,
    header: "Severity",
    cell: ({ row }) => <FindingSeverityBadge severity={row.original.severity} />,
  },
  {
    id: "rule",
    accessorFn: (finding) => ruleTitle(finding.ruleId),
    enableSorting: false,
    header: "Rule",
    cell: ({ row }) => <RuleCell ruleId={row.original.ruleId} />,
  },
  {
    id: "anchor",
    accessorFn: (finding) => anchorLabel(finding.anchor),
    enableSorting: false,
    header: "Where",
    cell: ({ row }) => (
      // `min-w-0` is what actually lets a long tool path truncate inside the cell.
      <Text variant="meta" className="block min-w-0 truncate font-mono">
        {anchorLabel(row.original.anchor)}
      </Text>
    ),
  },
  {
    id: "message",
    accessorFn: (finding) => finding.message,
    enableSorting: false,
    header: "What was found",
    cell: ({ row }) => (
      <Text className="block min-w-0 text-pretty break-words">{row.original.message}</Text>
    ),
  },
  {
    id: "evidence",
    accessorFn: (finding) => finding.evidence?.excerpt ?? "",
    enableSorting: false,
    header: "Evidence",
    cell: ({ row }) => <EvidenceCell finding={row.original} />,
  },
];

/**
 * The findings, in the report's own order.
 *
 * Sorting is off — see {@link FINDING_COLUMNS}.
 */
export function FindingsTable({
  findings,
  label,
  className,
}: {
  findings: SecurityFinding[];
  label: string;
  className?: string;
}) {
  const columns = useMemo(() => FINDING_COLUMNS, []);

  return (
    <DataTable
      aria-label={label}
      className={className}
      data={findings}
      columns={columns}
      emptyMessage="No findings."
    />
  );
}

/**
 * The rule's title, with its RATIONALE one keyboard step away.
 *
 * The rationale is written for the person who has to fix the thing, so it is shown verbatim — this
 * component does not paraphrase it, shorten it or turn it into a tooltip. A `Popover`'s trigger is a
 * real `Button`, so it is reachable by Tab and dismissible by Escape without any handling here.
 */
function RuleCell({ ruleId }: { ruleId: SecurityRuleId }) {
  const rule = SECURITY_RULES[ruleId];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link" size="sm" className="h-auto min-w-0 whitespace-normal p-0 text-left">
          {ruleTitle(ruleId)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96">
        <div className="flex flex-col gap-2">
          <Text className="font-medium">{ruleTitle(ruleId)}</Text>
          <Text variant="meta" tone="muted" className="font-mono">
            {ruleId}
          </Text>
          <Text className="text-pretty">
            {rule?.rationale ?? "No rationale is registered for this rule."}
          </Text>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The matched excerpt, as TEXT.
 *
 * It arrives already redacted and escaped by D-SP4 — an invisible character is a literal `​`
 * in the string, a credential is the literal `«redacted»` marker. So it is rendered as plain text in
 * a wrapping monospace box: never through `dangerouslySetInnerHTML` (React escapes it once, and once
 * is correct), never re-escaped a second time, and never *only* in a tooltip — the entire point of
 * the invisible-unicode rule is that you can SEE what was hiding in the definition.
 */
function EvidenceCell({ finding }: { finding: SecurityFinding }) {
  const evidence = finding.evidence;
  if (!evidence) {
    return (
      <Text variant="meta" tone="muted">
        —
      </Text>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          View excerpt
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[28rem] max-w-[min(28rem,90vw)]">
        <div className="flex flex-col gap-2">
          <Text variant="meta" tone="muted">
            {evidence.offset === undefined
              ? "The matched text, redacted."
              : `The matched text, redacted — at character ${formatNumber(evidence.offset)} of the definition.`}
          </Text>
          <div className="max-h-64 overflow-y-auto rounded-md bg-muted p-3">
            <Text
              variant="meta"
              className="block whitespace-pre-wrap break-words font-mono"
              data-testid="security-evidence-excerpt"
            >
              {evidence.excerpt}
            </Text>
          </div>
          {evidence.truncated ? (
            <Text variant="meta" tone="muted">
              {`… the excerpt was cut at ${formatNumber(SECURITY_EVIDENCE_MAX_CHARS)} characters.`}
            </Text>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Stable React key for a finding — the contract's own identity, so it survives a re-fetch. */
export function findingKey(finding: SecurityFinding): string {
  return securityFindingIdentity(finding);
}
