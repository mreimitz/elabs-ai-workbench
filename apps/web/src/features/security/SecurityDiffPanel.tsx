import type {
  SecurityFinding,
  SecurityFindingCounts,
  SecurityPostureDiff,
  SecurityReport,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { GitCompareArrows, TriangleAlert, X } from "lucide-react";
import { TabEmptyState } from "../../components/TabEmptyState";
import { formatDateTime, formatNumber } from "../../lib/format";
import type { Loadable } from "../../lib/loadable";
import { PostureScore } from "./PostureScore";
// `SecurityPanel` renders this file and this file re-uses its findings table — a cycle, but a
// deferred one: every binding crossing it is a hoisted function or a type, referenced only inside a
// component body, never at module-evaluation time. Keeping ONE findings table is worth more than
// splitting it into a fifth module purely to break an import arrow that never fires.
import {
  FindingsTable,
  type SecurityBaselineOption,
  type SecuritySubjectTarget,
} from "./SecurityPanel";

/**
 * SecurityDiffPanel — the baseline picker, and what changed since.
 * =============================================================================================
 * Two states, and they are deliberately not the same shape:
 *
 *   • **No baseline** — just the picker. The panel above it is already showing the current report,
 *     which is the right resting state; a diff is a question you opt into.
 *   • **A baseline** — Added / Resolved / Unchanged, each with the diff's own per-severity counts.
 *     Every number is `diff.counts`, never a `.length`; every order is the diff's, never re-sorted.
 *
 * **A refusal is information, not a crash (D-SP19).** Four pairings are refused with a 400 whose
 * body IS the explanation — a truncated report, a baseline belonging to another server, a
 * cross-version analyzer mismatch, a subject-kind mismatch. That sentence is written for the
 * operator, so it is shown verbatim in an `Alert`, the picker stays usable, and `SecurityPanel`
 * keeps rendering the current report underneath. The tab never blanks and no error boundary fires.
 */

export type SecurityDiffPanelProps = {
  target: SecuritySubjectTarget;
  /** The current report — its subject's identity labels the "after" side of the comparison. */
  subjectReport: SecurityReport;
  baselines: SecurityBaselineOption[];
  baselineId: string | null;
  onBaselineChange: (next: string | null) => void;
  /** The diff, loaded by `SecurityPanel` — it needs to see a refusal to keep the report on screen. */
  state: Loadable<SecurityPostureDiff>;
  className?: string;
};

/** `Select` has no empty-string value, so "no baseline" needs a sentinel that no id can collide with. */
const NO_BASELINE = "__none__";

export function SecurityDiffPanel({
  target,
  subjectReport,
  baselines,
  baselineId,
  onBaselineChange,
  state,
  className,
}: SecurityDiffPanelProps) {
  const noun = target.kind === "scan" ? "scan" : "version";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <GitCompareArrows aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Text variant="meta" tone="muted" className="shrink-0">
          Compare against
        </Text>
        <Select
          value={baselineId ?? NO_BASELINE}
          onValueChange={(next) => onBaselineChange(next === NO_BASELINE ? null : next)}
          disabled={baselines.length === 0}
        >
          <SelectTrigger
            className="w-72 max-w-full"
            aria-label={`Baseline ${noun} to compare this posture against`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_BASELINE}>No baseline</SelectItem>
            {baselines.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {baselineId !== null ? (
          <Button variant="ghost" size="sm" onClick={() => onBaselineChange(null)}>
            <X aria-hidden />
            <span>Clear</span>
          </Button>
        ) : null}
        {baselines.length === 0 ? (
          <Text variant="meta" tone="muted" className="min-w-0">
            {`There is only one ${noun} to compare, so there is nothing to diff against yet.`}
          </Text>
        ) : null}
      </div>

      {baselineId === null ? null : state.status === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : state.status === "error" ? (
        // D-SP19 — the API's own sentence, verbatim. It names WHICH pairing is meaningless and what
        // to do instead, which is more use than any wording this component could invent. The current
        // report keeps rendering above; nothing is blanked.
        <Alert variant="destructive">
          <div className="flex min-w-0 items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <AlertDescription className="min-w-0 break-words">{state.error}</AlertDescription>
          </div>
        </Alert>
      ) : (
        <DiffBody diff={state.data} subjectReport={subjectReport} />
      )}
    </div>
  );
}

function DiffBody({
  diff,
  subjectReport,
}: {
  diff: SecurityPostureDiff;
  subjectReport: SecurityReport;
}) {
  const nothingChanged = diff.added.length === 0 && diff.resolved.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Text variant="meta" tone="muted" className="min-w-0 text-pretty">
          {`${diff.baseline.name} · captured ${formatDateTime(diff.baseline.capturedAt)} → captured ${formatDateTime(
            diff.subject.capturedAt,
          )}`}
        </Text>
        <div className="flex shrink-0 items-center gap-2">
          <PostureScore score={diff.score.baseline} variant="chip" />
          <Text variant="meta" tone="muted" aria-hidden>
            →
          </Text>
          <PostureScore score={diff.score.subject} />
          <ScoreDelta delta={diff.score.delta} />
        </div>
      </div>

      {nothingChanged ? (
        // D-SP23 — "nothing changed" is a RESULT. Three empty tables under three headings would be
        // the same information rendered as an accident.
        <TabEmptyState
          size="sm"
          icon={<GitCompareArrows aria-hidden />}
          title="Nothing changed"
          description={`No finding appeared and none was resolved between these two ${
            diff.subject.kind === "server" ? "scans" : "versions"
          }. ${formatNumber(diff.counts.unchanged.total)} ${
            diff.counts.unchanged.total === 1 ? "finding carries" : "findings carry"
          } over unchanged.`}
        />
      ) : (
        <>
          <DiffSection
            title="Added"
            description="In this report and not in the baseline."
            findings={diff.added}
            counts={diff.counts.added}
            emptyMessage="Nothing new appeared."
          />
          <DiffSection
            title="Resolved"
            description="In the baseline and gone from this report."
            findings={diff.resolved}
            counts={diff.counts.resolved}
            emptyMessage="Nothing was resolved."
          />
          <DiffSection
            title="Unchanged"
            description="In both — shown with this report's own evidence."
            findings={diff.unchanged}
            counts={diff.counts.unchanged}
            emptyMessage="Nothing carried over."
          />
        </>
      )}

      {/* The subject's identity, so a shared URL still says WHAT was measured even when the diff
          itself is empty. Read off the report the panel above already loaded — not re-fetched. */}
      <Text variant="meta" tone="muted" className="tabular-nums">
        {`Security analyzer v${formatNumber(diff.analyzerVersion)} · ${subjectReport.subject.name}`}
      </Text>
    </div>
  );
}

/**
 * `subject − baseline`, and **positive means the posture improved** (the contract's own direction —
 * "we went up four points"). Direction is carried by the sign AND the word, never by colour alone.
 */
function ScoreDelta({ delta }: { delta: number }) {
  if (delta === 0) {
    return <Badge variant="outline">No change</Badge>;
  }
  const improved = delta > 0;
  return (
    <Badge variant="outline" className="tabular-nums">
      {`${improved ? "+" : "−"}${formatNumber(Math.abs(delta))} ${improved ? "better" : "worse"}`}
    </Badge>
  );
}

/** One bucket. The heading carries the bucket's OWN per-severity tally, straight off `diff.counts`. */
function DiffSection({
  title,
  description,
  findings,
  counts,
  emptyMessage,
}: {
  title: string;
  description: string;
  findings: SecurityFinding[];
  counts: SecurityFindingCounts;
  emptyMessage: string;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={`${title} security findings`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading level={3} className="text-body font-semibold">
          {title}
        </Heading>
        <Badge variant="secondary" className="tabular-nums">
          {formatNumber(counts.total)}
        </Badge>
        <Text variant="meta" tone="muted" className="tabular-nums">
          {`${formatNumber(counts.error)} error · ${formatNumber(counts.warning)} warning · ${formatNumber(
            counts.info,
          )} info`}
        </Text>
        <Text variant="meta" tone="muted" className="min-w-0">
          {description}
        </Text>
      </div>
      {findings.length === 0 ? (
        <Text variant="meta" tone="muted">
          {emptyMessage}
        </Text>
      ) : (
        <FindingsTable findings={findings} label={`${title} security findings`} />
      )}
    </section>
  );
}
