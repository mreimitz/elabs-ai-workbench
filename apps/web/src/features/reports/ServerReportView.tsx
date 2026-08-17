import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  CompatibilityReportModel,
  CompatibilitySeverity,
  CompatibilityTestEntry,
  CompatibilityTestReport,
  ScanDetail,
  ServerReport,
  ToolScan,
  ToolSeveritySummary,
} from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Descriptions,
  DescriptionsItem,
  Heading,
  MetricCard,
  PageShell,
  Separator,
  StatePanel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@elabs-ai/components-ui";
import { ArrowLeft, CheckCircle2, Download, Printer } from "lucide-react";
import { getServerReport } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime, formatNumber, formatPercent } from "../../lib/format";
import { clientLabel, MANUAL_REVIEW_CONCERNS, SEVERITY_META } from "../compatibility/meta";
import {
  DETAIL_OPTIONS,
  type DetailLevel,
  FINDING_SEVERITIES,
  OUTCOME_META,
  OutcomeLegend,
  OutcomeTally,
  PerModelReasoning,
  SeverityTally,
  STATUS_ORDER,
  type StatusKey,
  isDetailed,
  outcomeKey,
  shortModelName,
  worstSeverity,
} from "./reportRender";

/** What the report view needs to fetch + render. */
export type ReportTarget = {
  scanId: string;
  modelIds: string[];
  client?: string;
  serverName?: string;
  /** Minimum finding severity that earns a full detail block (the rest stay in summaries). */
  detail: DetailLevel;
};

const SEVERITY_RANK: Record<CompatibilitySeverity, number> = {
  blocker: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const DETAIL_LABEL: Record<DetailLevel, string> = Object.fromEntries(
  DETAIL_OPTIONS.map((o) => [o.value, o.label]),
) as Record<DetailLevel, string>;

/** The worst finding severity across a tool's tool-test entries (null = no findings). */
function toolWorstSeverity(report: CompatibilityTestReport): CompatibilitySeverity | null {
  let worst: CompatibilitySeverity | null = null;
  for (const e of report.entries) {
    const s = worstSeverity(e.statusCounts);
    if (s && (!worst || SEVERITY_RANK[s] > SEVERITY_RANK[worst])) worst = s;
  }
  return worst;
}

function worstOf(severities: CompatibilitySeverity[]): CompatibilitySeverity | null {
  let worst: CompatibilitySeverity | null = null;
  for (const s of severities) if (!worst || SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  return worst;
}

/** Build the markdown-export URL for a report target (mirrors the JSON route's query, plus `detail`). */
function markdownUrl(target: ReportTarget): string {
  const q = new URLSearchParams();
  if (target.modelIds.length > 0) q.set("models", target.modelIds.join(","));
  if (target.client) q.set("client", target.client);
  q.set("detail", target.detail);
  return `/api/reports/server/${target.scanId}/markdown?${q.toString()}`;
}

/**
 * Route wrapper (item 5): `/reports/scans/:scanId?models=&client=&detail=&serverName=`. Rebuilds the
 * {@link ReportTarget} from the URL so a report is deep-linkable + refresh-safe, and renders the view
 * inside the app shell. Back returns to the previous page.
 */
export function ServerReportRoute() {
  const { scanId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  if (!scanId) {
    return <StatePanel kind="error" title="Report unavailable" description="Missing scan id." />;
  }

  const modelsParam = searchParams.get("models");
  const detailParam = searchParams.get("detail");
  const clientParam = searchParams.get("client");
  const serverNameParam = searchParams.get("serverName");
  const detail: DetailLevel = isDetailLevel(detailParam) ? detailParam : "all";

  const target: ReportTarget = {
    scanId,
    modelIds: modelsParam ? modelsParam.split(",").filter(Boolean) : [],
    detail,
    ...(clientParam ? { client: clientParam } : {}),
    ...(serverNameParam ? { serverName: serverNameParam } : {}),
  };

  return <ServerReportView target={target} onBack={() => navigate(-1)} />;
}

function isDetailLevel(value: string | null): value is DetailLevel {
  return value === "all" || value === "medium" || value === "high" || value === "blocker";
}

export function ServerReportView({ target, onBack }: { target: ReportTarget; onBack: () => void }) {
  const [report, setReport] = useState<ServerReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null);
    setError(null);
    getServerReport(target.scanId, target.modelIds, target.client)
      .then((result) => active && setReport(result))
      .catch(
        (cause: unknown) => active && setError(getErrorMessage(cause, "Couldn’t build the report.")),
      );
    return () => {
      active = false;
    };
  }, [target.scanId, target.client, target.modelIds]);

  return (
    // Renders INSIDE the app shell (item 5): a normal-flow container, not a fixed overlay. In print,
    // the shell chrome carries `.app-non-printable` (see AppShell) so only this report paginates.
    <div className="report-overlay flex min-h-full flex-col bg-background">
      {/* Toolbar — hidden when printing. */}
      <div className="report-no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden />
            <span>Back</span>
          </Button>
          <Text as="span" variant="meta" tone="muted">
            Server report{target.serverName ? ` · ${target.serverName}` : ""}
          </Text>
        </div>
        <div className="flex items-center gap-3">
          <Text as="span" variant="meta" tone="muted" className="hidden md:inline">
            Tip: in the print dialog keep Margins on “Default”.
          </Text>
          <Button asChild variant="outline" size="sm">
            <a href={markdownUrl(target)} download>
              <Download aria-hidden />
              <span>Download Markdown</span>
            </a>
          </Button>
          <Button size="sm" disabled={!report} onClick={() => window.print()}>
            <Printer aria-hidden />
            <span>Print / Save as PDF</span>
          </Button>
        </div>
      </div>

      {/* Content sits in the unified PageShell frame (width="lg" ≈ the report's max-w-5xl reading
          column). The `report-content` class is kept on the outer element for the print stylesheet;
          in print `.report-overlay *` already forces max-width:100%, so the frame never breaks
          pagination. */}
      <PageShell width="lg" className="report-content" contentClassName="print:max-w-none">
        {error ? (
          <StatePanel
            kind="error"
            title="Couldn’t build the report."
            description={`${error} Try again.`}
          />
        ) : !report ? (
          <StatePanel
            kind="loading"
            title="Building report…"
            loadingLabel="Running compatibility tests…"
          />
        ) : (
          <ReportBody report={report} detail={target.detail} />
        )}
      </PageShell>
    </div>
  );
}

function ReportBody({ report, detail }: { report: ServerReport; detail: DetailLevel }) {
  const { scan, models } = report;
  const toolByName = useMemo(() => new Map(scan.tools.map((t) => [t.toolName, t])), [scan.tools]);
  const issuesByTool = useMemo(
    () => new Map(report.toolFindings.byTool.map((s) => [s.toolName, s])),
    [report.toolFindings.byTool],
  );

  // Server-level findings = server tests with ≥1 non-pass outcome, worst-first.
  const serverFindings = useMemo(
    () =>
      report.serverTests.entries
        .filter((e) => worstSeverity(e.statusCounts) !== null)
        .sort(
          (a, b) =>
            SEVERITY_RANK[worstSeverity(b.statusCounts)!] -
              SEVERITY_RANK[worstSeverity(a.statusCounts)!] ||
            a.userFacingName.localeCompare(b.userFacingName),
        ),
    [report.serverTests.entries],
  );

  const overallWorst = worstOf([
    ...serverFindings.map((e) => worstSeverity(e.statusCounts)!),
    ...report.toolFindings.byTest.map((t) => t.worstSeverity),
  ]);
  const totalFindings = serverFindings.length + report.toolFindings.byTest.length;

  return (
    <div className="flex flex-col gap-10">
      <HeaderSection report={report} detail={detail} />
      <ExecutiveSummary
        report={report}
        serverFindings={serverFindings}
        overallWorst={overallWorst}
        totalFindings={totalFindings}
      />
      <ServerFindingsSection findings={serverFindings} models={models} detail={detail} />
      <ServerLedgerSection report={report} />
      {/* The tests that surfaced something at tool level (detail), then the tool summary below it. */}
      <ToolDetailSection report={report} toolByName={toolByName} detail={detail} />
      <ToolInventorySection scan={scan} report={report} issuesByTool={issuesByTool} />
      <Appendices report={report} />
    </div>
  );
}

// ── §A Header ─────────────────────────────────────────────────────────────────────────────────────

function HeaderSection({ report, detail }: { report: ServerReport; detail: DetailLevel }) {
  const { server, scan } = report;
  const endpoint = server.transport === "stdio" ? (server.command ?? "—") : (server.url ?? "—");
  const client = clientLabel(report.client);
  const resources = scan.resources ?? [];
  const prompts = scan.prompts ?? [];

  return (
    <header className="report-avoid-break flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Text as="span" variant="meta" tone="muted" className="uppercase tracking-wide">
          MCP Server Compatibility &amp; Footprint Report
        </Text>
        <Heading level={1}>{server.name}</Heading>
      </div>

      <Descriptions columns={2}>
        <DescriptionsItem label="Transport">{server.transport}</DescriptionsItem>
        <DescriptionsItem label="Endpoint">
          <span className="break-all font-mono">{endpoint}</span>
        </DescriptionsItem>
        <DescriptionsItem label="Auth">{server.authType}</DescriptionsItem>
        <DescriptionsItem label="Secrets">
          {server.hasEnvSecrets || server.hasHeaderSecrets
            ? [server.hasEnvSecrets ? "env" : null, server.hasHeaderSecrets ? "headers" : null]
                .filter(Boolean)
                .join(" + ")
            : "none"}
        </DescriptionsItem>
        <DescriptionsItem label="Scan date">{formatDateTime(scan.scannedAt)}</DescriptionsItem>
        <DescriptionsItem label="Token profile">{scan.tokenProfile}</DescriptionsItem>
        <DescriptionsItem label="Tools / resources / prompts" numeric>
          {formatNumber(scan.totalTools)} / {formatNumber(resources.length)} /{" "}
          {formatNumber(prompts.length)}
        </DescriptionsItem>
        <DescriptionsItem label="Report generated">
          {formatDateTime(report.generatedAt)}
        </DescriptionsItem>
      </Descriptions>

      <div className="flex flex-wrap items-center gap-1.5">
        <Text as="span" variant="meta" tone="muted">
          Models:
        </Text>
        {report.models.map((m) => (
          <Badge key={m.id} variant="outline" className="font-normal">
            {m.displayName}
          </Badge>
        ))}
        {client ? <Badge variant="secondary">Host client: {client}</Badge> : null}
        {detail !== "all" ? (
          <Badge variant="secondary">Detailed: {DETAIL_LABEL[detail]}</Badge>
        ) : null}
      </div>

      <Alert variant="info">
        <AlertTitle>Scope &amp; method</AlertTitle>
        <AlertDescription>
          Generated from a static-connection scan of the server&apos;s tool surface evaluated
          against a provenanced model dataset. Findings cite the documented limit and its source.
          Concerns that need a human review (auth/audience binding, prompt-injection, PII, transport
          hardening, hidden secrets, workflow safety) are out of static scope — see “Not tested” in
          the appendix.
        </AlertDescription>
      </Alert>
    </header>
  );
}

// ── §B Executive summary ────────────────────────────────────────────────────────────────────────────

function ExecutiveSummary({
  report,
  serverFindings,
  overallWorst,
  totalFindings,
}: {
  report: ServerReport;
  serverFindings: CompatibilityTestEntry[];
  overallWorst: CompatibilitySeverity | null;
  totalFindings: number;
}) {
  const { scan } = report;
  const top3Share =
    scan.totalTokens > 0
      ? ([...scan.tools]
          .sort((a, b) => b.totalTokens - a.totalTokens)
          .slice(0, 3)
          .reduce((a, t) => a + t.totalTokens, 0) /
          scan.totalTokens) *
        100
      : 0;

  // Per-model server-test outcome tally (the cross-model contrast, computed from the server tests).
  const perModel = useMemo(() => {
    return report.models.map((m) => {
      const counts: Partial<Record<StatusKey, number>> = {};
      for (const e of report.serverTests.entries) {
        const r = e.results.find((x) => x.modelId === m.id);
        if (!r) continue;
        const k = outcomeKey(r);
        counts[k] = (counts[k] ?? 0) + 1;
      }
      const worst: StatusKey =
        FINDING_SEVERITIES.find((s) => (counts[s] ?? 0) > 0) ?? (counts.pass ? "pass" : "na");
      return { model: m, counts, worst };
    });
  }, [report.models, report.serverTests.entries]);

  const tally = new Map<CompatibilitySeverity, number>();
  for (const e of serverFindings) {
    const w = worstSeverity(e.statusCounts)!;
    tally.set(w, (tally.get(w) ?? 0) + 1);
  }
  for (const t of report.toolFindings.byTest)
    tally.set(t.worstSeverity, (tally.get(t.worstSeverity) ?? 0) + 1);
  const tallyCounts: Partial<Record<CompatibilitySeverity, number>> = Object.fromEntries(tally);

  return (
    <section className="flex flex-col gap-4">
      <SectionTitle title="Executive summary" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Startup tokens"
          value={formatNumber(scan.totalTokens)}
          description="Tool definitions"
        />
        <MetricCard
          label="Tools"
          value={formatNumber(scan.totalTools)}
          description={`avg ${formatNumber(scan.averageTokensPerTool)} tok`}
        />
        <MetricCard
          label="Top-3 share"
          value={formatPercent(top3Share)}
          description="of startup tokens"
        />
        <MetricCard
          label="Largest tool"
          value={formatNumber(scan.largestToolTokens)}
          description={scan.largestToolName ?? "—"}
        />
      </div>

      {totalFindings === 0 ? (
        <Alert variant="success">
          <AlertTitle>No compatibility findings</AlertTitle>
          <AlertDescription>
            All {report.serverTests.entries.length} server-level tests and the tool-level checks
            pass across the {report.models.length} selected model
            {report.models.length === 1 ? "" : "s"}.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert
          variant={
            overallWorst === "blocker" || overallWorst === "high" ? "destructive" : "warning"
          }
        >
          <AlertTitle>
            {totalFindings} finding{totalFindings === 1 ? "" : "s"} across {report.models.length}{" "}
            model
            {report.models.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            <div className="mt-1">
              <SeverityTally counts={tallyCounts} />
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Server × model: per-model server-test outcomes (worst-case contrast across the roster). */}
      <Card>
        <CardHeader>
          <CardTitle>Server-test outcomes by model</CardTitle>
          <CardDescription>
            Worst-case across the {report.serverTests.entries.length} server-level tests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Worst</TableHead>
                <TableHead>Outcomes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perModel.map(({ model, counts, worst }) => (
                <TableRow key={model.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <Text as="span" className="font-medium">
                        {shortModelName(model.displayName)}
                      </Text>
                      <Text as="span" variant="meta" tone="muted">
                        {model.providerId}
                      </Text>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={OUTCOME_META[worst].variant}>{OUTCOME_META[worst].label}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1.5">
                      {STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((s) => (
                        <Badge key={s} variant={OUTCOME_META[s].variant} className="tabular-nums">
                          {counts[s]} {OUTCOME_META[s].label}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

// ── §C Server-level findings ──────────────────────────────────────────────────────────────────────

function ServerFindingsSection({
  findings,
  models,
  detail,
}: {
  findings: CompatibilityTestEntry[];
  models: CompatibilityReportModel[];
  detail: DetailLevel;
}) {
  const detailed = findings.filter((e) => isDetailed(worstSeverity(e.statusCounts)!, detail));
  const hidden = findings.length - detailed.length;
  return (
    <section className="flex flex-col gap-4">
      <SectionTitle
        title="Server-level findings"
        description={
          detail === "all"
            ? "Server-level tests that fail or warn on at least one model, worst-first. Each shows what we tested, why it matters, the model-specific reasoning, the cited evidence, and the affected tools."
            : `Server-level findings at ${DETAIL_LABEL[detail].toLowerCase()}, worst-first — with the model-specific reasoning, cited evidence, and affected tools. Lower-severity findings are in the ledger below.`
        }
      />
      {detailed.length === 0 ? (
        <CleanRow
          label={
            findings.length === 0
              ? "No server-level findings — every server test passes across the selected models."
              : `No server-level findings at ${DETAIL_LABEL[detail].toLowerCase()}. ${hidden} lower-severity finding${hidden === 1 ? "" : "s"} are in the ledger.`
          }
        />
      ) : (
        <>
          {detailed.map((entry) => (
            <FindingCard key={entry.testId} entry={entry} models={models} />
          ))}
          {hidden > 0 ? (
            <Text variant="meta" tone="muted">
              + {hidden} lower-severity finding{hidden === 1 ? "" : "s"} not detailed here — see the
              ledger below.
            </Text>
          ) : null}
        </>
      )}
    </section>
  );
}

function FindingCard({
  entry,
  models,
}: { entry: CompatibilityTestEntry; models: CompatibilityReportModel[] }) {
  const worst = worstSeverity(entry.statusCounts);
  return (
    <Card>
      <CardHeader className="report-avoid-break">
        <div className="flex flex-wrap items-center gap-2">
          {worst ? (
            <Badge variant={SEVERITY_META[worst].variant}>{SEVERITY_META[worst].label}</Badge>
          ) : null}
          <CardTitle className="min-w-0">{entry.userFacingName}</CardTitle>
          <Text as="span" variant="code" tone="muted">
            {entry.techName}
          </Text>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <OutcomeTally counts={entry.statusCounts} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Labeled label="What we tested">{entry.whatItDoes}</Labeled>
        <div>
          <Text
            as="span"
            variant="meta"
            tone="muted"
            className="font-medium uppercase tracking-wide"
          >
            Per-model reasoning &amp; evidence
          </Text>
          <div className="mt-1.5">
            <PerModelReasoning entry={entry} models={models} />
          </div>
        </div>
        {entry.recommendation ? (
          <Labeled label="Recommendation">{entry.recommendation}</Labeled>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── §D Server-level test ledger ─────────────────────────────────────────────────────────────────────

function ServerLedgerSection({ report }: { report: ServerReport }) {
  const entries = report.serverTests.entries;
  return (
    <section className="flex flex-col gap-4">
      <SectionTitle
        title="Server-level test ledger"
        description={`Every server-level test we ran across the ${report.models.length} selected models — including the ones that passed (the audit trail).`}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Text as="span" variant="meta" tone="muted">
          Legend:
        </Text>
        <OutcomeLegend />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Test</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>What it checks</TableHead>
            <TableHead>Outcomes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.testId} className="report-avoid-break align-top">
              <TableCell>
                <span className="flex flex-col">
                  <Text as="span" className="font-medium">
                    {e.userFacingName}
                  </Text>
                  <Text as="span" variant="code" tone="muted">
                    {e.techName}
                  </Text>
                </span>
              </TableCell>
              <TableCell>
                {e.category ? (
                  <Badge variant="outline">{e.category}</Badge>
                ) : (
                  <Text as="span" tone="muted">
                    —
                  </Text>
                )}
              </TableCell>
              <TableCell className="max-w-md">
                <Text variant="meta" tone="muted">
                  {e.whatItDoes}
                </Text>
              </TableCell>
              <TableCell>
                <OutcomeTally counts={e.statusCounts} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

// ── §E Tool inventory ───────────────────────────────────────────────────────────────────────────────

function ToolInventorySection({
  scan,
  report,
  issuesByTool,
}: {
  scan: ScanDetail;
  report: ServerReport;
  issuesByTool: Map<string, ToolSeveritySummary>;
}) {
  const tools = [...scan.tools].sort((a, b) => b.totalTokens - a.totalTokens);
  return (
    <section className="flex flex-col gap-4">
      <SectionTitle
        title="Tool summary"
        description="Every tool by token footprint, with its issue tally across the tool-level tests. Tools whose findings surfaced above are detailed there; this is the complete roster."
      />

      {report.toolFindings.byTest.length > 0 ? (
        <Card>
          <CardHeader className="report-avoid-break">
            <CardTitle>Tool-level findings</CardTitle>
            <CardDescription>
              Tool-level tests that flag at least one tool (worst-first).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {report.toolFindings.byTest.map((t) => (
              <div key={t.testId} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={SEVERITY_META[t.worstSeverity].variant}>
                    {SEVERITY_META[t.worstSeverity].label}
                  </Badge>
                  <Text as="span" className="font-medium">
                    {t.userFacingName}
                  </Text>
                  <Text as="span" variant="meta" tone="muted">
                    · {t.tools.length} tool{t.tools.length === 1 ? "" : "s"}
                  </Text>
                </span>
                {t.recommendation ? (
                  <Text variant="meta" tone="muted" className="text-pretty">
                    {t.recommendation}
                  </Text>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  {t.tools.slice(0, 18).map((tool) => (
                    <Badge
                      key={tool.toolName}
                      variant={SEVERITY_META[tool.severity].variant}
                      className="font-mono font-normal"
                    >
                      {tool.toolName}
                    </Badge>
                  ))}
                  {t.tools.length > 18 ? (
                    <Text as="span" variant="meta" tone="muted">
                      +{t.tools.length - 18} more
                    </Text>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Tool</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Desc</TableHead>
            <TableHead className="text-right">Schema</TableHead>
            <TableHead className="text-right">Share</TableHead>
            <TableHead>Issues</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tools.map((tool, i) => {
            const issues = issuesByTool.get(tool.toolName);
            return (
              <TableRow key={tool.id} className="report-avoid-break">
                <TableCell className="tabular-nums text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-mono">{tool.toolName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(tool.totalTokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(tool.descriptionTokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(tool.schemaTokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(tool.contributionPercent)}
                </TableCell>
                <TableCell>
                  {issues && issues.total > 0 ? (
                    <SeverityTally counts={issues.counts} />
                  ) : (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 aria-hidden className="size-3.5" />
                      <Text as="span" variant="meta">
                        Pass
                      </Text>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}

// ── §F Per-flagged-tool detail ──────────────────────────────────────────────────────────────────────

function ToolDetailSection({
  report,
  toolByName,
  detail,
}: {
  report: ServerReport;
  toolByName: Map<string, ToolScan>;
  detail: DetailLevel;
}) {
  // Only tools whose worst tool-level finding meets the chosen severity get a detail block.
  const detailedTools = report.flaggedToolTests.filter((tr) => {
    const w = toolWorstSeverity(tr);
    return w !== null && isDetailed(w, detail);
  });

  return (
    <section className="flex flex-col gap-4">
      <SectionTitle
        title="Tool detail"
        description={
          detail === "all"
            ? "Full per-tool test results for every tool with at least one finding. Clean tools are listed in the summary below."
            : `Per-tool results for tools with a finding at ${DETAIL_LABEL[detail].toLowerCase()}. Other tools and their issue counts are in the summary below.`
        }
      />
      {detailedTools.length === 0 ? (
        <CleanRow
          label={
            report.flaggedToolTests.length === 0
              ? "No tools were flagged — every tool passes its tool-level tests across the selected models."
              : `No tools have a finding at ${DETAIL_LABEL[detail].toLowerCase()} — see the tool summary below.`
          }
        />
      ) : (
        detailedTools.map((toolReport) => (
          <ToolDetailCard
            key={toolReport.subjectId}
            toolReport={toolReport}
            tool={toolByName.get(toolReport.subjectId)}
            models={report.models}
            detail={detail}
          />
        ))
      )}
    </section>
  );
}

function ToolDetailCard({
  toolReport,
  tool,
  models,
  detail,
}: {
  toolReport: CompatibilityTestReport;
  tool: ToolScan | undefined;
  models: CompatibilityReportModel[];
  detail: DetailLevel;
}) {
  // At a severity filter, detail only the findings that meet it (the surfaced tests); at "all",
  // show every non-pass finding.
  const findings = toolReport.entries.filter((e) => {
    const s = worstSeverity(e.statusCounts);
    return s !== null && (detail === "all" || isDetailed(s, detail));
  });
  return (
    <Card>
      <CardHeader className="report-avoid-break">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="font-mono">{toolReport.subjectLabel}</CardTitle>
          {tool ? (
            <Text as="span" variant="meta" tone="muted" className="tabular-nums">
              {formatNumber(tool.totalTokens)} tok · {formatPercent(tool.contributionPercent)} of
              server
            </Text>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {findings.length > 0 ? (
          <div className="flex flex-col gap-3">
            {findings.map((entry) => {
              const worst = worstSeverity(entry.statusCounts);
              return (
                <div
                  key={entry.testId}
                  className="report-avoid-break flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {worst ? (
                      <Badge variant={SEVERITY_META[worst].variant}>
                        {SEVERITY_META[worst].label}
                      </Badge>
                    ) : null}
                    <Text as="span" className="font-medium">
                      {entry.userFacingName}
                    </Text>
                    <Text as="span" variant="code" tone="muted">
                      {entry.techName}
                    </Text>
                  </div>
                  <Text variant="meta" tone="muted">
                    {entry.whatItDoes}
                  </Text>
                  <PerModelReasoning entry={entry} models={models} />
                  {entry.recommendation ? (
                    <Labeled label="Recommendation">{entry.recommendation}</Labeled>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Full ledger for this tool — every tool-level test, incl. passes. Only in full-detail mode;
            a severity filter keeps the per-tool block to the surfaced tests. */}
        {detail === "all" ? (
          <div className="flex flex-col gap-2">
            <Text
              as="span"
              variant="meta"
              tone="muted"
              className="font-medium uppercase tracking-wide"
            >
              All tool tests
            </Text>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Outcomes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {toolReport.entries.map((e) => (
                  <TableRow key={e.testId}>
                    <TableCell>
                      <span className="flex flex-col">
                        <Text as="span">{e.userFacingName}</Text>
                        <Text as="span" variant="code" tone="muted">
                          {e.techName}
                        </Text>
                      </span>
                    </TableCell>
                    <TableCell>
                      <OutcomeTally counts={e.statusCounts} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── §G Appendices ────────────────────────────────────────────────────────────────────────────────────

function Appendices({ report }: { report: ServerReport }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionTitle title="Appendix" />

      <Card className="report-avoid-break">
        <CardHeader>
          <CardTitle>Method &amp; scoring</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Text variant="body">
            Each test evaluates the scanned tool surface against a per-model limit resolved from a
            provenanced dataset. A test yields a verdict per model — <strong>pass</strong>,{" "}
            <strong>warn</strong>, <strong>fail</strong>, or <strong>n/a</strong> (no documented
            limit) — and a per-model severity (Blocker → Low) that reflects the real-world
            consequence on that model. Evidence chips carry the cited value, its source link, and a
            confidence label (Verified / Likely / Estimated / Unverified) derived from the
            dataset&apos;s source tier.
          </Text>
        </CardContent>
      </Card>

      <Card className="report-avoid-break">
        <CardHeader>
          <CardTitle>Models &amp; provenance</CardTitle>
          <CardDescription>
            {report.models.length} models evaluated; limits come from the provenanced dataset.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {report.models.map((m) => (
              <Badge key={m.id} variant="outline" className="font-normal">
                {m.providerName} · {m.displayName}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="report-avoid-break">
        <CardHeader>
          <CardTitle>Not tested (manual review required)</CardTitle>
          <CardDescription>
            These concerns can&apos;t be inferred from a static tool surface + a model dataset —
            they need a human/behavioural review. The report does not claim coverage of them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Descriptions columns={1}>
            {MANUAL_REVIEW_CONCERNS.map((c) => (
              <DescriptionsItem key={c.title} label={c.title}>
                {c.detail}
              </DescriptionsItem>
            ))}
          </Descriptions>
        </CardContent>
      </Card>
    </section>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────────────────────────

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="report-avoid-break flex flex-col gap-1">
      <Heading level={2}>{title}</Heading>
      {description ? (
        <Text variant="meta" tone="muted" className="max-w-3xl text-pretty">
          {description}
        </Text>
      ) : null}
      <Separator className="mt-1" />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <Text as="span" variant="meta" tone="muted" className="font-medium uppercase tracking-wide">
        {label}
      </Text>
      <Text variant="body" className="text-pretty">
        {children}
      </Text>
    </div>
  );
}

function CleanRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
      <Text variant="meta" tone="muted">
        {label}
      </Text>
    </div>
  );
}
