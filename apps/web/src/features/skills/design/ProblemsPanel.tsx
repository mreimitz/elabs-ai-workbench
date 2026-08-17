import { useEffect, useMemo, useState } from "react";
import type { QualityReport, SkillGraph, ToolDiagnostic } from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  cardVariants,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Text,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@elabs-ai/components-ui";
import {
  ChevronDown,
  Code2,
  HelpCircle,
  Info,
  ListChecks,
  ShieldAlert,
  TriangleAlert,
  Workflow,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  formatToolDiagnosticMessage,
  getQualityReport,
  getToolDiagnostics,
} from "../skills-inspector-api";
import {
  collectSkillProblems,
  explainerFor,
  type SkillProblem,
  type SkillProblemSeverity,
  type SkillProblemSource,
} from "./code-intel/explainers";

// ── Skill IDE WP 9.4 (I10.5) — the unified problems panel ──────────────────────────────────────────
// ONE list aggregating the three surfaces, rendered IDENTICALLY in Flow and Code modes because the
// panel is mounted once in `UnifiedEditor` (below the body, at a stable tree position that every mode
// shares). Each problem deep-links its NODE (flow — `onGoToNode`), its LINE (code — `onGoToLine`), and
// its GUIDE ANCHOR (from the explainer registry, the single source). Honest live-vs-persisted framing:
//   • projector warnings are LIVE (the draft's current projection — recompute on every edit),
//   • quality findings + tool diagnostics are per the LAST-SAVED version (both take a `versionId`),
//     so while the draft is dirty they reflect the saved text — the panel says so, and they re-fetch
//     when `versionId` changes (i.e. on save).

/** Per-severity presentation (mirrors the Quality tab's `SEVERITY_META`; both themes via tokens). */
const SEVERITY_META: Record<
  SkillProblemSeverity,
  {
    label: string;
    badgeVariant: "destructive" | "warning" | "secondary";
    icon: LucideIcon;
    rank: number;
  }
> = {
  error: { label: "Error", badgeVariant: "destructive", icon: ShieldAlert, rank: 0 },
  warning: { label: "Warning", badgeVariant: "warning", icon: TriangleAlert, rank: 1 },
  info: { label: "Info", badgeVariant: "secondary", icon: Info, rank: 2 },
};

/** Per-source presentation — a small neutral badge so the reader knows which check raised it. */
const SOURCE_META: Record<SkillProblemSource, { label: string; icon: LucideIcon }> = {
  projector: { label: "Flow", icon: Workflow },
  quality: { label: "Quality", icon: ListChecks },
  tool: { label: "Tool", icon: Wrench },
};

export type ProblemsPanelProps = {
  skillId: string;
  versionId: string;
  /** The LIVE draft projection (node/line attribution) — the same graph the canvas + code decorations use. */
  graph: SkillGraph | null;
  /** The draft's LIVE projector warnings (always shown, always current). */
  warnings: string[];
  /** True when the draft has unsaved edits — the persisted quality/tool findings then lag the draft text. */
  dirty: boolean;
  /** Select the node on the canvas (flow deep link) — the panel switches to a flow-visible mode. */
  onGoToNode: (nodeId: string) => void;
  /** Reveal the line in the code editor (code deep link) — the panel switches to code mode. */
  onGoToLine: (line: number) => void;
};

/**
 * The unified problems panel (WP 9.4). Fetches the persisted-version quality report + tool diagnostics
 * (read-only, degrade to an inline note on failure — never load-blocking), aggregates them with the
 * live projector warnings through the single-source registry, and renders one collapsible list with a
 * severity summary. Every item carries up to a triple deep link. The empty state EDUCATES.
 */
export function ProblemsPanel({
  skillId,
  versionId,
  graph,
  warnings,
  dirty,
  onGoToNode,
  onGoToLine,
}: ProblemsPanelProps) {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [diagnostics, setDiagnostics] = useState<ToolDiagnostic[]>([]);
  // Non-blocking: a fetch failure surfaces a soft note but never hides the (always-live) projector part.
  const [persistedError, setPersistedError] = useState<string | null>(null);

  // Re-fetch the persisted findings whenever the version changes — notably after a save (the parent
  // repoints `versionId` to the new immutable version), so quality/tool re-check the just-saved text.
  useEffect(() => {
    let cancelled = false;
    setQuality(null);
    setDiagnostics([]);
    setPersistedError(null);
    Promise.allSettled([
      getQualityReport(skillId, versionId),
      getToolDiagnostics(skillId, versionId),
    ]).then(([qualityR, diagnosticsR]) => {
      if (cancelled) return;
      setQuality(qualityR.status === "fulfilled" ? qualityR.value : null);
      setDiagnostics(diagnosticsR.status === "fulfilled" ? diagnosticsR.value.diagnostics : []);
      if (qualityR.status === "rejected" && diagnosticsR.status === "rejected") {
        setPersistedError(
          "Couldn’t load the saved-version quality and tool checks — showing live flow warnings only.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [skillId, versionId]);

  const problems = useMemo(
    () =>
      collectSkillProblems({
        graph,
        warnings,
        quality,
        diagnostics,
        formatDiagnostic: formatToolDiagnosticMessage,
      }).sort((a, b) => SEVERITY_META[a.severity].rank - SEVERITY_META[b.severity].rank),
    [graph, warnings, quality, diagnostics],
  );

  const counts = useMemo(() => {
    const tally = { error: 0, warning: 0, info: 0 } as Record<SkillProblemSeverity, number>;
    for (const problem of problems) tally[problem.severity] += 1;
    return tally;
  }, [problems]);

  const total = problems.length;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(cardVariants(), "shrink-0")}
      data-testid="problems-panel"
    >
      <CollapsibleTrigger
        className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Problems — ${total} ${total === 1 ? "item" : "items"}`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <Text variant="meta" className="font-medium">
            Problems
          </Text>
          {total === 0 ? (
            <Badge variant="secondary" className="gap-1">
              <ListChecks aria-hidden className="size-3.5" />
              None
            </Badge>
          ) : (
            <span className="flex flex-wrap items-center gap-1.5">
              {counts.error > 0 ? (
                <Badge variant="destructive" className="gap-1 tabular-nums">
                  <ShieldAlert aria-hidden className="size-3.5" />
                  {counts.error}
                </Badge>
              ) : null}
              {counts.warning > 0 ? (
                <Badge variant="warning" className="gap-1 tabular-nums">
                  <TriangleAlert aria-hidden className="size-3.5" />
                  {counts.warning}
                </Badge>
              ) : null}
              {counts.info > 0 ? (
                <Badge variant="secondary" className="gap-1 tabular-nums">
                  <Info aria-hidden className="size-3.5" />
                  {counts.info}
                </Badge>
              ) : null}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform data-[state=open]:rotate-180"
          data-state={open ? "open" : "closed"}
        />
      </CollapsibleTrigger>

      <CollapsibleContent>
        {/* SI15 — the expanded body is ONE bounded internal scroll container (`max-h` + `min-h-0` +
            `overflow-y-auto`), so a long problem list scrolls INSIDE the panel instead of growing the
            `shrink-0` collapsible and pushing the whole Design tab past its page. (The previous inner
            `ScrollArea max-h-64` never scrolled: the brand ScrollArea viewport is `size-full`, and a
            percentage height against the Radix root's AUTO height resolves to the content height —
            so the list just grew.) `overscroll-contain` keeps a wheel at the list edge from chaining
            into the page. Collapsed/expanded behavior is untouched. */}
        <div
          className="flex max-h-72 min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain border-t border-border p-3"
          data-testid="problems-body"
        >
          {/* Honest scope note: what is live vs. what reflects the last-saved version. */}
          <Text variant="meta" tone="muted" className="text-pretty">
            Flow warnings are live on your draft. Quality and tool checks are for the last-saved
            version
            {dirty ? " — save to re-check them against your unsaved edits." : "."}
          </Text>
          {persistedError ? (
            <Text variant="meta" tone="muted" className="break-words">
              {persistedError}
            </Text>
          ) : null}

          {total === 0 ? (
            <EmptyProblems />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="problems-list">
              {problems.map((problem) => (
                <li key={problem.id}>
                  <ProblemRow problem={problem} onGoToNode={onGoToNode} onGoToLine={onGoToLine} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One problem row: severity + source badges, the message, and up to a triple deep link. */
function ProblemRow({
  problem,
  onGoToNode,
  onGoToLine,
}: {
  problem: SkillProblem;
  onGoToNode: (nodeId: string) => void;
  onGoToLine: (line: number) => void;
}) {
  const severity = SEVERITY_META[problem.severity];
  const source = SOURCE_META[problem.source];
  const SeverityIcon = severity.icon;
  const SourceIcon = source.icon;
  const explainer = explainerFor(problem.elementId);

  return (
    <div
      className="flex flex-col gap-1.5 rounded-md border border-border p-2.5"
      data-testid="problem-row"
      data-source={problem.source}
      data-severity={problem.severity}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={severity.badgeVariant} className="gap-1">
          <SeverityIcon aria-hidden className="size-3.5" />
          {severity.label}
        </Badge>
        <Badge variant="outline" className="gap-1">
          <SourceIcon aria-hidden className="size-3.5" />
          {source.label}
        </Badge>
      </div>

      <Text variant="meta" className="break-words">
        {problem.message}
      </Text>

      <div className="flex flex-wrap items-center gap-1.5">
        {problem.nodeId !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto gap-1 px-1.5 py-0.5 text-xs"
            onClick={() => onGoToNode(problem.nodeId as string)}
          >
            <Workflow aria-hidden className="size-3.5" />
            Show node
          </Button>
        ) : null}
        {problem.line !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto gap-1 px-1.5 py-0.5 text-xs tabular-nums"
            onClick={() => onGoToLine(problem.line as number)}
          >
            <Code2 aria-hidden className="size-3.5" />
            Line {problem.line}
          </Button>
        ) : null}
        {explainer ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="link" size="sm" className="h-auto gap-1 p-0 text-xs">
                <HelpCircle aria-hidden className="size-3.5" />
                What is this?
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <span className="block font-medium">{explainer.title}</span>
              <span className="mt-1 block text-pretty">{explainer.short}</span>
              <code className="mt-1.5 block break-all text-xs text-muted-foreground">
                {explainer.guideAnchor}
              </code>
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/** The educating empty state: no problems, and a plain list of exactly what the panel checks. */
function EmptyProblems() {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border p-3">
      <div className="flex items-center gap-2">
        <ListChecks aria-hidden className="size-4 text-success" />
        <Text variant="meta" className="font-medium">
          No problems — here’s what we check
        </Text>
      </div>
      <ul className="flex list-disc flex-col gap-0.5 pl-5">
        <li>
          <Text variant="meta" tone="muted" as="span">
            <span className="font-medium">Flow</span> — live projector warnings from your draft
            (orphan sections, unresolved branches, dangling references).
          </Text>
        </li>
        <li>
          <Text variant="meta" tone="muted" as="span">
            <span className="font-medium">Quality</span> — the deterministic quality rules for the
            saved version (identity, budgets, breadcrumbs, dead files).
          </Text>
        </li>
        <li>
          <Text variant="meta" tone="muted" as="span">
            <span className="font-medium">Tool</span> — MCP tool references validated against the
            bound servers’ latest scans (unknown / stale names).
          </Text>
        </li>
      </ul>
    </div>
  );
}
