import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { DigestReport } from "@mcp-token-footprint/shared";
import { Badge, Button, MetricCard, PageShell, StatePanel, Text } from "@brand/ui";
import { ArrowLeft, Clock, Download } from "lucide-react";
import { getDigestMarkdown, getDigestReport } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { formatDateTime, formatNumber, formatPercent } from "../../lib/format";
import { ChatMarkdown } from "../testing/ChatMarkdown";

// Observability WP5.5 (D-OB22) — the routed, read-only digest view a notification's `linkPath` deep-
// links to (`/reports/digest/:id`). Renders the SAME report the notification announced: a compact KPI
// header built from the structured JSON (`GET …/json`), then the full briefing rendered inline from
// the Markdown twin (`GET …/markdown`) via the shared `ChatMarkdown` component — the "existing report
// render path" the WP spec calls for reusing, rather than a bespoke second renderer.

export function DigestReportRoute() {
  const { id } = useParams();
  const navigate = useNavigate();

  if (!id) {
    return <StatePanel kind="error" title="Digest unavailable" description="Missing digest id." />;
  }
  return <DigestReportView id={id} onBack={() => navigate(-1)} />;
}

export function DigestReportView({ id, onBack }: { id: string; onBack: () => void }) {
  const [report, setReport] = useState<DigestReport | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null);
    setMarkdown(null);
    setError(null);
    Promise.all([getDigestReport(id), getDigestMarkdown(id)])
      .then(([reportResult, markdownResult]) => {
        if (!active) return;
        setReport(reportResult);
        setMarkdown(markdownResult);
      })
      .catch((cause: unknown) => {
        if (active) setError(getErrorMessage(cause, "Couldn’t load the digest."));
      });
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className="flex min-h-full flex-col bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft aria-hidden />
            <span>Back</span>
          </Button>
          <Text as="span" variant="meta" tone="muted" className="truncate">
            {report ? `${report.windowKind === "daily" ? "Daily" : "Weekly"} digest` : "Digest"}
          </Text>
          {report?.late ? (
            <Badge variant="outline" className="gap-1 border-border text-muted-foreground">
              <Clock aria-hidden className="size-3" />
              While you were away
            </Badge>
          ) : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={`/api/reports/digest/${id}/markdown`} download>
            <Download aria-hidden />
            <span>Download Markdown</span>
          </a>
        </Button>
      </div>

      <PageShell width="lg">
        {error ? (
          <StatePanel
            kind="error"
            title="Couldn’t load the digest."
            description={`${error} Try again.`}
          />
        ) : !report || markdown === null ? (
          <StatePanel kind="loading" title="Loading digest…" />
        ) : (
          <div className="flex flex-col gap-6">
            <DigestHeader report={report} />
            <ChatMarkdown text={markdown} />
          </div>
        )}
      </PageShell>
    </div>
  );
}

function DigestHeader({ report }: { report: DigestReport }) {
  return (
    <div className="flex flex-col gap-3">
      <Text variant="meta" tone="muted">
        {formatDateTime(report.windowFrom)} → {formatDateTime(report.windowTo)} · generated{" "}
        {formatDateTime(report.generatedAt)}
      </Text>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          label="Runs"
          value={formatNumber(report.headline.runs.current)}
          description={`vs ${formatNumber(report.headline.runs.previous)} prior`}
        />
        <MetricCard
          label="Error rate"
          value={
            report.headline.errorRate === null
              ? "—"
              : formatPercent(report.headline.errorRate.current * 100)
          }
          description={
            report.headline.errorRate === null
              ? "no runs in either window"
              : `vs ${formatPercent(report.headline.errorRate.previous * 100)} prior`
          }
        />
        <MetricCard
          label="New issues"
          value={formatNumber(report.newIssues.length)}
          description={`${report.regressedIssues.length} regressed · ${report.resolvedIssues.length} resolved`}
        />
        <MetricCard
          label="Movers"
          value={formatNumber(report.movers.length)}
          description={`${report.notableRuns.length} notable run${report.notableRuns.length === 1 ? "" : "s"}`}
        />
      </div>
    </div>
  );
}
