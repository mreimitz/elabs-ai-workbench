import { useCallback, useEffect, useState } from "react";
import type {
  QualityFinding,
  QualityReport,
  SkillEditOp,
  SkillGraph,
  SkillStaticSuggestion,
  SkillVersion,
  ToolDiagnosticsReport,
} from "@mcp-token-footprint/shared";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  StatePanel,
  Text,
} from "@elabs-ai/components-ui";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { getErrorMessage } from "../../../lib/errors";
import { InlineError } from "../../../components/InlineError";
import { SaveVersionDialog } from "../design/SaveVersionDialog";
import { SuggestionCard } from "../trace/SuggestionCard";
import {
  getQualityReport,
  getSkillGraph,
  getSkillVersion,
  getStaticSuggestions,
  getToolDiagnostics,
} from "../skills-inspector-api";
import { QualityScoreCard } from "./QualityScoreCard";
import { FindingCard } from "./FindingCard";
import { ToolDiagnosticsSection } from "./ToolDiagnosticsSection";
import { SEVERITY_ORDER } from "./quality-meta";

export type QualityViewProps = {
  skillId: string;
  versionId: string;
  /** Refresh the skill + switch the active version after a fix/suggestion is applied (mirrors the
   *  Design/Trace tabs' `handleDesignSaved`) — the version picker updates and the score re-runs. */
  onVersionSaved?: (newVersionId: string) => void;
  /** Deep-link into the Diff tab for (fromVersionId, toVersionId) — the apply dialog's "View full diff". */
  onOpenDiff?: (fromVersionId: string, toVersionId: string) => void;
  /** Best-effort anchor deep-link — switch the inspector to the Design tab (cross-tab node selection
   *  isn't wired, so the anchor is surfaced on the finding and this only jumps to Design). */
  onOpenDesign?: () => void;
};

/** Findings sorted worst-severity-first, then by rule id, so the list reads top-down by importance. */
function sortFindings(findings: QualityFinding[]): QualityFinding[] {
  const rank = (severity: QualityFinding["severity"]) => SEVERITY_ORDER.indexOf(severity);
  return [...findings].sort(
    (a, b) => rank(a.severity) - rank(b.severity) || a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * The Quality tab (WP 4.3): a deterministic quality report for the selected skill version — a score
 * card + severity breakdown, the findings list (severity badge, message, anchor, a "Why" reference to
 * the authoring guide, and an apply-fix flow), STATIC optimization suggestions (WP 4.2, reusing
 * {@link SuggestionCard}), and the MCP tool-reference diagnostics (WP 5.1), with a "Re-run checks"
 * refresh. Every apply routes the `SkillEditOp[]` through the SAME edits/save flow as every other
 * edit ({@link SaveVersionDialog} → `postSkillEdits`): a save creates a new immutable version, the
 * parent switches the active selection to it, and this view re-runs against the new version (the
 * score improves). Everything else is read-only GETs — nothing here executes skill content.
 */
export function QualityView({
  skillId,
  versionId,
  onVersionSaved,
  onOpenDiff,
  onOpenDesign,
}: QualityViewProps) {
  // Primary (gating): the quality report. Secondary (best-effort, own inline surfaces): static
  // suggestions + tool diagnostics. Support (apply flow only): the graph (op labels) + version (treeSha).
  const [report, setReport] = useState<QualityReport | null>(null);
  const [suggestions, setSuggestions] = useState<SkillStaticSuggestion[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<ToolDiagnosticsReport | null>(null);
  const [graph, setGraph] = useState<SkillGraph | null>(null);
  const [version, setVersion] = useState<SkillVersion | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Apply flow: the staged ops + a note, plus the id of a version saved via the dialog (switched to on
  // dialog close so the parent's refetch doesn't unmount the dialog before its success view is seen).
  const [applyTarget, setApplyTarget] = useState<{ ops: SkillEditOp[]; note: string } | null>(null);
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);

  // Fetch everything in parallel; one failure never rejects the others (allSettled). The report gates
  // the view; suggestions/diagnostics degrade to their own inline notes; graph/version failing only
  // disables apply (findings still render).
  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      const [reportR, suggestionsR, diagnosticsR, graphR, versionR] = await Promise.allSettled([
        getQualityReport(skillId, versionId),
        getStaticSuggestions(skillId, versionId),
        getToolDiagnostics(skillId, versionId),
        getSkillGraph(skillId, versionId),
        getSkillVersion(skillId, versionId),
      ]);
      if (isCancelled()) return;

      if (reportR.status === "fulfilled") {
        setReport(reportR.value);
        setError(null);
      } else {
        setError(getErrorMessage(reportR.reason, "Couldn’t load the quality report"));
      }

      if (suggestionsR.status === "fulfilled") {
        setSuggestions(suggestionsR.value);
        setSuggestionsError(null);
      } else {
        setSuggestions([]);
        setSuggestionsError(
          getErrorMessage(suggestionsR.reason, "Couldn’t load optimization suggestions"),
        );
      }

      if (diagnosticsR.status === "fulfilled") {
        setDiagnostics(diagnosticsR.value);
        setDiagnosticsError(null);
      } else {
        setDiagnostics(null);
        setDiagnosticsError(
          getErrorMessage(diagnosticsR.reason, "Couldn’t validate tool references"),
        );
      }

      setGraph(graphR.status === "fulfilled" ? graphR.value.graph : null);
      setVersion(versionR.status === "fulfilled" ? versionR.value : null);
    },
    [skillId, versionId],
  );

  // Initial load / version switch: reset to the loading state, then load. Deterministic per version.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setReport(null);
    setSuggestions(null);
    setDiagnostics(null);
    setGraph(null);
    setVersion(null);
    setError(null);
    setSuggestionsError(null);
    setDiagnosticsError(null);
    void load(() => cancelled).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  // "Re-run checks": refetch WITHOUT clearing the current report (no loading flash) — only the button
  // spins. On the same immutable version the result is identical; after a fix it re-runs on the new one.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  // Re-fetch the graph + version (fresh treeSha) after a 409 in the apply dialog — mirrors the Design
  // and Trace tabs' reload handlers.
  const handleReloadGraph = useCallback(async () => {
    const [graphResponse, loadedVersion] = await Promise.all([
      getSkillGraph(skillId, versionId),
      getSkillVersion(skillId, versionId),
    ]);
    setGraph(graphResponse.graph);
    setVersion(loadedVersion);
  }, [skillId, versionId]);

  const handleApplyFix = useCallback((finding: QualityFinding) => {
    if (!finding.fix || finding.fix.length === 0) return;
    setApplyTarget({ ops: finding.fix, note: `Quality fix: ${finding.ruleId}` });
  }, []);

  const handleApplyStatic = useCallback((suggestion: SkillStaticSuggestion) => {
    if (suggestion.ops.length === 0) return;
    setApplyTarget({ ops: suggestion.ops, note: `Optimization: ${suggestion.rule}` });
  }, []);

  // On dialog close, drop the staged ops and — if a save landed — switch the parent to the new version
  // (which remounts this view against it, so the score re-runs).
  const handleApplyOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      setApplyTarget(null);
      if (savedVersionId) {
        onVersionSaved?.(savedVersionId);
        setSavedVersionId(null);
      }
    },
    [savedVersionId, onVersionSaved],
  );

  if (error && report === null) {
    return (
      <InlineError
        title="Couldn’t load quality"
        detail={error}
        onRetry={() => void handleRefresh()}
      />
    );
  }
  if (report === null) {
    return (
      <StatePanel
        kind="loading"
        title="Running quality checks…"
        loadingLabel="Running quality checks…"
      />
    );
  }

  const findings = sortFindings(report.findings);
  // The graph + version power the apply flow (op labels + baseTreeSha); without them, hide apply.
  const canApply = graph !== null && version !== null;

  return (
    <div className="flex flex-col gap-6" data-testid="quality-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="meta" tone="muted" className="text-pretty">
          Deterministic, versioned quality checks for this skill version.
        </Text>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          title="Re-run the quality checks for this version"
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          {refreshing ? "Re-running…" : "Re-run checks"}
        </Button>
      </div>

      <QualityScoreCard report={report} />

      {/* Findings */}
      <Card>
        <CardHeader>
          <CardTitle>Findings{findings.length > 0 ? ` (${findings.length})` : ""}</CardTitle>
        </CardHeader>
        <CardContent>
          {findings.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 aria-hidden className="size-6 text-success" />}
              title="No quality issues"
              description="Every deterministic quality rule passed for this version."
            />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="quality-findings">
              {findings.map((finding, index) => (
                <li key={`${finding.ruleId}:${index}`}>
                  <FindingCard
                    finding={finding}
                    onApplyFix={canApply ? handleApplyFix : undefined}
                    {...(onOpenDesign ? { onOpenDesign } : {})}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Static optimization suggestions (WP 4.2, reusing SuggestionCard) */}
      <Card>
        <CardHeader>
          <CardTitle>
            Optimization suggestions
            {suggestions && suggestions.length > 0 ? ` (${suggestions.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {suggestionsError ? (
            <Text variant="meta" tone="muted" className="break-words">
              Couldn’t load optimization suggestions: {suggestionsError} Use “Re-run checks” above
              to try again.
            </Text>
          ) : suggestions === null ? (
            <Text variant="meta" tone="muted">
              Checking for optimizations…
            </Text>
          ) : suggestions.length === 0 ? (
            <Text variant="meta" tone="muted">
              No optimization suggestions — this version's structure and footprint look good.
            </Text>
          ) : graph === null ? (
            // The suggestion op summaries resolve node/edge labels from the graph; without it, the
            // apply flow can't render, so show a soft note rather than half-rendered cards.
            <Text variant="meta" tone="muted">
              {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} available —
              reload to review them.
            </Text>
          ) : (
            <div className="flex flex-col gap-2" data-testid="quality-suggestions">
              {suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  variant="static"
                  suggestion={suggestion}
                  graph={graph}
                  {...(canApply ? { onApply: handleApplyStatic } : {})}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* MCP tool-reference diagnostics (WP 5.1, rendered here) */}
      <ToolDiagnosticsSection report={diagnostics} error={diagnosticsError} />

      {applyTarget && graph && version ? (
        <SaveVersionDialog
          open
          onOpenChange={handleApplyOpenChange}
          skillId={skillId}
          versionId={versionId}
          baseTreeSha={version.treeSha}
          graph={graph}
          ops={applyTarget.ops}
          initialNote={applyTarget.note}
          onDiscardOps={() => setApplyTarget(null)}
          onSaved={(savedVersion) => setSavedVersionId(savedVersion.id)}
          onReload={handleReloadGraph}
          onViewDiff={(fromId, toId) => onOpenDiff?.(fromId, toId)}
        />
      ) : null}
    </div>
  );
}
