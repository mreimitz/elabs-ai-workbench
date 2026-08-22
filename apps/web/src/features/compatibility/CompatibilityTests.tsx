import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CompatibilityAffectedTool,
  CompatibilityReportModel,
  CompatibilityResult,
  CompatibilitySeverity,
  CompatibilityTestEntry,
  CompatibilityTestReport,
  ToolFindingEntry,
  ToolFindingTool,
  ToolScan,
} from "@mcp-token-footprint/shared";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  StatePanel,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { CheckCircle2 } from "lucide-react";
import { getServerTests, getToolTests } from "../../lib/api";
import { toolTestSavings } from "../../lib/optimize";
import { getErrorMessage } from "../../lib/errors";
import { formatBytes, formatNumber } from "../../lib/format";
import { OUTCOME_DOT, OUTCOME_META, SEVERITY_META } from "./meta";
import { EvidenceChip } from "./EvidenceChip";

/** Navigate to a tool's detail (Tools tab → select tool → Tests sub-tab). */
type OpenTool = (toolName: string) => void;

// The "Tests" tab body: an expandable per-test timeline (one entry per compatibility test that ran
// on this subject) that drills into the per-model outcome — pass/fail, what breaks, the cited limit,
// and the fix. Only the relevant level is fetched (server tests for a server; tool tests for a tool).

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "info";

// Outcome chip order for the per-test summary: findings (by severity) first, then pass, then n/a.
type StatusKey = "pass" | "na" | CompatibilitySeverity;
const STATUS_ORDER: StatusKey[] = ["blocker", "high", "medium", "low", "pass", "na"];

// Just the finding severities, worst → least, for ranking + tallying compatibility findings.
const FINDING_SEVERITIES: CompatibilitySeverity[] = ["blocker", "high", "medium", "low"];

/** The most severe finding (fail/warn) outcome across a test's models, or null if none. */
function worstSeverity(
  counts: CompatibilityTestEntry["statusCounts"],
): CompatibilitySeverity | null {
  for (const s of FINDING_SEVERITIES) if ((counts[s] ?? 0) > 0) return s;
  return null;
}

// OUTCOME_META (the per-model/per-count/legend chip vocabulary) now lives in `./meta`, shared with
// reportRender so the tabs and the PDF report never drift.

// Legend + per-test count chips speak the same vocabulary as the per-model chips.
function statusChip(key: StatusKey): { label: string; variant: BadgeVariant } {
  return OUTCOME_META[key];
}

/**
 * A result's single legend outcome. Mirrors the server-side tally (service.ts `buildEntries`): pass
 * → pass, na → na, otherwise the resolved severity (which may itself be "na" for an unclassified
 * warn/fail — kept identical to the backend so a chip and its count can never disagree).
 */
function outcomeKey(result: CompatibilityResult): StatusKey {
  if (result.verdict === "pass") return "pass";
  if (result.verdict === "na") return "na";
  return result.severity;
}

/** Compact model label for a chip (drops provider boilerplate so the colour does the talking). */
function shortModelName(displayName: string): string {
  return displayName
    .replace("Claude ", "")
    .replace(" Instruct", "")
    .replace("Microsoft 365 Copilot", "M365 Copilot")
    .replace("Microsoft Copilot (Consumer / copilot.microsoft.com)", "Copilot consumer")
    .replace("GitHub Copilot (model-picker surface; VS Code / IDE / CLI)", "GitHub Copilot");
}

function formatLimit(value: string | number | boolean | null, unit?: string): string {
  if (value === null) return "";
  // Humanize raw byte counts (e.g. 524288 → "512 KB") rather than "524,288 bytes".
  if (unit === "bytes" && typeof value === "number") return formatBytes(value);
  const base =
    typeof value === "number"
      ? formatNumber(value)
      : typeof value === "boolean"
        ? value
          ? "yes"
          : "no"
        : value;
  return unit ? `${base} ${unit}` : base;
}

export function ServerTestsTab({ scanId, onOpenTool }: { scanId: string; onOpenTool?: OpenTool }) {
  // Memoized on scanId so TestsTab's effect refetches when the scan changes (and only then).
  const load = useCallback((models?: string[]) => getServerTests(scanId, models), [scanId]);
  return <TestsTab load={load} subject="server" onOpenTool={onOpenTool} />;
}

export function ToolTestsTab({ scanId, toolName }: { scanId: string; toolName: string }) {
  // Memoized on scanId + toolName so TestsTab's effect refetches when either changes.
  const load = useCallback(
    (models?: string[]) => getToolTests(scanId, toolName, models),
    [scanId, toolName],
  );
  return <TestsTab load={load} subject="tool" />;
}

function TestsTab({
  load,
  subject,
  onOpenTool,
}: {
  load: (models?: string[]) => Promise<CompatibilityTestReport>;
  subject: "server" | "tool";
  onOpenTool?: OpenTool;
}) {
  const [report, setReport] = useState<CompatibilityTestReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    load()
      .then((result) => active && setReport(result))
      .catch(
        (cause: unknown) => active && setError(getErrorMessage(cause, "Couldn’t load the tests.")),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load]);

  if (loading)
    return (
      <StatePanel
        kind="loading"
        title="Running compatibility tests…"
        loadingLabel="Running tests…"
      />
    );
  if (error)
    return (
      <StatePanel kind="error" title="Couldn’t load the tests." description={`${error} Try again.`} />
    );
  if (!report || report.entries.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title="No tests to show"
        description={`No ${subject}-level compatibility tests applied to this ${subject}.`}
      />
    );
  }
  return <TestTimeline report={report} onOpenTool={onOpenTool} />;
}

function TestTimeline({
  report,
  onOpenTool,
}: { report: CompatibilityTestReport; onOpenTool?: OpenTool }) {
  const [open, setOpen] = useState<string[]>([]);
  const groups = useMemo(() => groupProviders(report.models), [report.models]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="meta" tone="muted">
          {report.entries.length} {report.subjectType}-level test
          {report.entries.length === 1 ? "" : "s"} × {report.models.length} models · expand a test
          for the impact per model.
        </Text>
        <Legend />
      </div>

      <Accordion
        type="multiple"
        value={open}
        onValueChange={setOpen}
        className="flex flex-col gap-2"
      >
        {report.entries.map((entry) => (
          <AccordionItem
            key={entry.testId}
            value={entry.testId}
            className="rounded-md border border-border bg-card"
          >
            <AccordionTrigger className="gap-3 px-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <Text as="span" className="font-medium">
                    {entry.userFacingName}
                  </Text>
                  <Text as="span" variant="code" tone="muted">
                    {entry.techName}
                  </Text>
                </span>
                <StatusCounts counts={entry.statusCounts} />
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-3">
              {open.includes(entry.testId) ? (
                <EntryDetail entry={entry} groups={groups} onOpenTool={onOpenTool} />
              ) : null}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

function EntryDetail({
  entry,
  groups,
  onOpenTool,
}: { entry: CompatibilityTestEntry; groups: ProviderGroup[]; onOpenTool?: OpenTool }) {
  const byModel = useMemo(() => new Map(entry.results.map((r) => [r.modelId, r])), [entry.results]);

  return (
    <div className="flex flex-col gap-4 pb-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{entry.level}</Badge>
        {entry.category ? <Badge variant="outline">{entry.category}</Badge> : null}
        <Badge variant="outline" className="font-mono font-normal">
          {entry.executionMode}
        </Badge>
      </div>

      <Text variant="body" tone="muted">
        {entry.whatItDoes}
      </Text>

      {entry.recommendation ? (
        <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-3">
          <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
            Fix
          </Text>
          <Text variant="body">{entry.recommendation}</Text>
        </div>
      ) : null}

      {/* Severity grid: grouped Hosted / Open-weight → one row per provider → a chip per model.
          The chip's colour IS the outcome; click a chip for the full per-model explanation. */}
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-2.5">
            <Text variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
              {group.label}
            </Text>
            <div className="flex flex-col gap-2">
              {group.providers.map((provider) => (
                <div
                  key={provider.providerId}
                  className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3"
                >
                  <Text as="span" variant="meta" tone="muted" className="shrink-0 sm:w-28 sm:pt-1">
                    {provider.providerName}
                  </Text>
                  <div className="flex flex-wrap gap-1.5">
                    {provider.models.map((model) => {
                      const result = byModel.get(model.id);
                      return result ? (
                        <ModelChip
                          key={model.id}
                          model={model}
                          result={result}
                          onOpenTool={onOpenTool}
                        />
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// A single model cell: a severity-coloured chip (legend vocabulary only). Click for the full
// per-model explanation in a popover — the chip itself carries no long text.
function ModelChip({
  model,
  result,
  onOpenTool,
}: { model: CompatibilityReportModel; result: CompatibilityResult; onOpenTool?: OpenTool }) {
  const outcome = OUTCOME_META[outcomeKey(result)];
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${model.displayName} — ${outcome.label}. Show details`}
        className="inline-flex rounded-full p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <Badge variant={outcome.variant} className="cursor-pointer">
          {shortModelName(model.displayName)}
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
        <ModelDetail model={model} result={result} outcome={outcome} onOpenTool={onOpenTool} />
      </PopoverContent>
    </Popover>
  );
}

function ModelDetail({
  model,
  result,
  outcome,
  onOpenTool,
}: {
  model: CompatibilityReportModel;
  result: CompatibilityResult;
  outcome: { label: string; variant: BadgeVariant };
  onOpenTool?: OpenTool;
}) {
  const rationale = cleanRationale(result.rationale);
  const failure =
    result.failureMode && result.failureMode !== "none"
      ? result.failureMode.replace(/_/g, " ")
      : null;
  const measured = formatLimit(result.measured.value, result.measured.unit);
  const limit = formatLimit(result.threshold.value, result.threshold.unit);
  return (
    <div className="flex max-h-[70vh] flex-col gap-3 overflow-auto">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={outcome.variant}>{outcome.label}</Badge>
        <Text as="span" className="font-medium">
          {model.displayName}
        </Text>
      </div>
      {failure ? (
        <Text as="span" variant="meta" tone="muted" className="font-mono">
          {failure}
        </Text>
      ) : null}
      {rationale ? <Text variant="body">{rationale}</Text> : null}
      {measured || limit ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {measured ? <DetailStat label="Measured" value={measured} /> : null}
          {limit ? <DetailStat label="Limit" value={limit} /> : null}
        </div>
      ) : null}
      {result.affectedTools && result.affectedTools.length > 0 ? (
        <AffectedTools tools={result.affectedTools} onOpenTool={onOpenTool} />
      ) : null}
      {result.evidence.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {result.evidence.map((ev, i) => (
            <EvidenceChip key={`${ev.field}:${i}`} evidence={ev} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// The per-tool breakdown behind an aggregate server test — the specific tools to fix, each a link
// into that tool's detail. Offenders (`over`) lead; the rest are shown as top contributors.
function AffectedTools({
  tools,
  onOpenTool,
  limit = 12,
}: { tools: CompatibilityAffectedTool[]; onOpenTool?: OpenTool; limit?: number }) {
  const offenders = tools.filter((t) => t.over);
  const shown = (offenders.length > 0 ? offenders : tools).slice(0, limit);
  const hidden = (offenders.length > 0 ? offenders.length : tools.length) - shown.length;
  return (
    <div className="flex flex-col gap-1.5">
      <Text as="span" variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
        {offenders.length > 0 ? `Tools over the limit (${offenders.length})` : "Top contributors"}
      </Text>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((t) => (
          <ToolLink
            key={t.toolName}
            toolName={t.toolName}
            displayName={t.namespacedName}
            detail={`${formatNumber(t.value)}${t.unit ? ` ${t.unit}` : ""}`}
            onOpenTool={onOpenTool}
          />
        ))}
        {hidden > 0 ? (
          <Text as="span" variant="meta" tone="muted">
            +{hidden} more
          </Text>
        ) : null}
      </div>
    </div>
  );
}

// A clickable chip that jumps to a tool's detail; falls back to static text when no nav handler. When
// the measured value was taken over a different string than the bare name (e.g. the namespaced
// `mcp__server__tool` for the name-length check), `displayName` is shown so the count reconciles —
// navigation still keys off the bare `toolName`.
function ToolLink({
  toolName,
  displayName,
  detail,
  onOpenTool,
}: { toolName: string; displayName?: string; detail?: string; onOpenTool?: OpenTool }) {
  const name = displayName ?? toolName;
  const label = detail ? `${name} · ${detail}` : name;
  if (!onOpenTool) {
    return (
      <Badge variant="outline" className="font-mono font-normal">
        {label}
      </Badge>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-auto py-0.5 font-mono font-normal"
      onClick={() => onOpenTool(toolName)}
    >
      {label}
    </Button>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <Text as="span" variant="meta" tone="muted">
        {label}
      </Text>
      <Text as="span" variant="meta" className="font-medium tabular-nums">
        {value}
      </Text>
    </span>
  );
}

function StatusCounts({ counts }: { counts: CompatibilityTestEntry["statusCounts"] }) {
  const chips = STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {chips.map((s) => {
        const chip = statusChip(s);
        return (
          <Badge key={s} variant={chip.variant} className="tabular-nums">
            {counts[s]} {chip.label}
          </Badge>
        );
      })}
    </span>
  );
}

// Strip developer-facing prefixes the resolver emits so the UI reads as prose, not debug output.
function cleanRationale(rationale: string): string {
  if (!rationale || rationale === "(default — no rule matched)") return "";
  return rationale.replace(/^\(model-invariant\)\s*/, "");
}

// A PASSIVE legend (SV9): a quiet inline key — a small token-coloured dot + muted label per outcome
// — NOT the filled/hover chips that read as filter buttons. Reference only; nothing here is clickable.
function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {(["pass", "blocker", "high", "medium", "low", "na"] as StatusKey[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", OUTCOME_DOT[s])} />
          <Text as="span" variant="meta" tone="muted">
            {statusChip(s).label}
          </Text>
        </span>
      ))}
    </span>
  );
}

type ProviderRow = { providerId: string; providerName: string; models: CompatibilityReportModel[] };
type ProviderGroup = { label: string; providers: ProviderRow[] };

const GROUP_LABEL: Record<string, string> = {
  saas: "Hosted (SaaS)",
  open_weight: "Open-weight (self-hosted)",
};
const GROUP_ORDER = ["saas", "open_weight"];

/**
 * Two-level grouping for the per-test matrix: outcome group (Hosted / Open-weight) → provider →
 * its models. Insertion order is preserved within each level (the roster already lists providers
 * and their models in a sensible order), and groups are ordered Hosted-then-open-weight.
 */
function groupProviders(models: CompatibilityReportModel[]): ProviderGroup[] {
  const byGroup = new Map<string, Map<string, ProviderRow>>();
  for (const model of models) {
    const providers = byGroup.get(model.group) ?? new Map<string, ProviderRow>();
    const row = providers.get(model.providerId) ?? {
      providerId: model.providerId,
      providerName: model.providerName,
      models: [],
    };
    row.models.push(model);
    providers.set(model.providerId, row);
    byGroup.set(model.group, providers);
  }
  const rank = (g: string): number => (GROUP_ORDER.indexOf(g) === -1 ? 99 : GROUP_ORDER.indexOf(g));
  return [...byGroup.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((group) => ({
      label: GROUP_LABEL[group] ?? group,
      providers: [...byGroup.get(group)!.values()],
    }));
}

// ── Server Overview findings (the single findings surface) ─────────────────────────────────────
// One test-driven model: server-level test findings + tool-level test findings aggregated across
// tools (each linking the offending tools). Replaces the old split of "Model compatibility" (tests)
// + "Optimization" (heuristics) — severity-ranked, with the fix and, where a size lever exists, the
// estimated token saving carried along on the finding.

type ServerFinding = {
  key: string;
  severity: CompatibilitySeverity;
  name: string;
  recommendation: string;
  detail: string;
  /** Aggregate server-test offenders (namespaced length, footprint contributors). */
  serverTools?: CompatibilityAffectedTool[];
  /** Tools failing a tool-level test. */
  tools?: ToolFindingTool[];
  savings: number;
};

export function ServerFindings({
  scanId,
  toolFindings,
  toolsByName,
  onOpenTool,
}: {
  scanId: string;
  toolFindings: ToolFindingEntry[];
  toolsByName: Map<string, ToolScan>;
  onOpenTool?: OpenTool;
}) {
  const [report, setReport] = useState<CompatibilityTestReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getServerTests(scanId)
      .then((result) => active && setReport(result))
      .catch(
        (cause: unknown) =>
          active && setError(getErrorMessage(cause, "Couldn’t load the findings.")),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [scanId]);

  const findings = useMemo<ServerFinding[]>(() => {
    if (!report) return [];
    const modelCount = report.models.length;
    const out: ServerFinding[] = [];

    // Server-level test findings (worst severity across models; aggregate offenders attached).
    for (const entry of report.entries) {
      const worst = worstSeverity(entry.statusCounts);
      if (!worst) continue;
      const affected = FINDING_SEVERITIES.reduce((sum, s) => sum + (entry.statusCounts[s] ?? 0), 0);
      let serverTools: CompatibilityAffectedTool[] | undefined;
      for (const r of entry.results) {
        if (r.affectedTools && r.affectedTools.length > (serverTools?.length ?? 0))
          serverTools = r.affectedTools;
      }
      out.push({
        key: `srv:${entry.testId}`,
        severity: worst,
        name: entry.findingName,
        recommendation: entry.recommendation,
        detail: `${affected} of ${modelCount} models affected`,
        serverTools,
        savings: 0,
      });
    }

    // Tool-level test findings aggregated across tools (savings summed from the offending tools).
    for (const entry of toolFindings) {
      const savings = entry.tools.reduce((sum, t) => {
        const tool = toolsByName.get(t.toolName);
        return tool ? sum + toolTestSavings(entry.testId, tool) : sum;
      }, 0);
      out.push({
        key: `tool:${entry.testId}`,
        severity: entry.worstSeverity,
        name: entry.findingName,
        recommendation: entry.recommendation,
        detail: `${entry.tools.length} tool${entry.tools.length === 1 ? "" : "s"} affected`,
        tools: entry.tools,
        savings,
      });
    }

    out.sort(
      (a, b) =>
        FINDING_SEVERITIES.indexOf(a.severity) - FINDING_SEVERITIES.indexOf(b.severity) ||
        b.savings - a.savings ||
        a.name.localeCompare(b.name),
    );
    return out;
  }, [report, toolFindings, toolsByName]);

  if (loading)
    return <StatePanel kind="loading" title="Checking findings…" loadingLabel="Running tests…" />;
  if (error)
    return (
      <StatePanel
        kind="error"
        title="Couldn’t load the findings."
        description={`${error} Try again.`}
      />
    );

  if (findings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
        <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
        <Text variant="meta" tone="muted">
          No findings — server and tool tests pass across the model roster.
        </Text>
      </div>
    );
  }

  const tally = new Map<CompatibilitySeverity, number>();
  for (const f of findings) tally.set(f.severity, (tally.get(f.severity) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {FINDING_SEVERITIES.filter((s) => tally.has(s)).map((s) => (
          <Badge key={s} variant={SEVERITY_META[s].variant} className="tabular-nums">
            {tally.get(s)} {SEVERITY_META[s].label}
          </Badge>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {findings.map((f) => (
          <li key={f.key} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant={SEVERITY_META[f.severity].variant}>
                {SEVERITY_META[f.severity].label}
              </Badge>
              <Text as="span" className="truncate font-medium" title={f.name}>
                {f.name}
              </Text>
              <Text as="span" variant="meta" tone="muted">
                · {f.detail}
              </Text>
              {f.savings > 0 ? (
                <Badge variant="success" className="tabular-nums">
                  ≈ {formatNumber(f.savings)} tok recoverable
                </Badge>
              ) : null}
            </span>
            {f.recommendation ? (
              <Text variant="meta" tone="muted" className="text-pretty line-clamp-2">
                {f.recommendation}
              </Text>
            ) : null}
            {f.serverTools && f.serverTools.length > 0 ? (
              <AffectedTools tools={f.serverTools} onOpenTool={onOpenTool} />
            ) : null}
            {f.tools && f.tools.length > 0 ? (
              <ToolFindingLinks tools={f.tools} onOpenTool={onOpenTool} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolFindingLinks({
  tools,
  onOpenTool,
  limit = 12,
}: { tools: ToolFindingTool[]; onOpenTool?: OpenTool; limit?: number }) {
  const shown = tools.slice(0, limit);
  const hidden = tools.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((t) => (
        <ToolLink key={t.toolName} toolName={t.toolName} onOpenTool={onOpenTool} />
      ))}
      {hidden > 0 ? (
        <Text as="span" variant="meta" tone="muted">
          +{hidden} more
        </Text>
      ) : null}
    </div>
  );
}
