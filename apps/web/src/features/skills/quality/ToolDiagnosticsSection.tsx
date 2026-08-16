import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ServerConfig, ToolDiagnosticsReport } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Text,
} from "@brand/ui";
import { TriangleAlert } from "lucide-react";
import { apiGet } from "../../../lib/api";
import { formatToolDiagnosticMessage } from "../skills-inspector-api";

export type ToolDiagnosticsSectionProps = {
  /** `null` while still loading. */
  report: ToolDiagnosticsReport | null;
  /** A settled fetch failure (validation is best-effort — the report/findings still render). */
  error: string | null;
};

/**
 * The MCP tool-reference section of the Quality tab (WP 5.1's `ToolDiagnostic`s rendered HERE — moved
 * from 5.2 per review finding 1). Deterministic + read-only over the LATEST persisted server scans:
 * `unknown_tool` / `stale_tool` diagnostics (each anchored back to a SKILL.md line, with close-match
 * candidates via the shared `formatToolDiagnosticMessage`) plus an `unscannedServers` note when a
 * scoped server has no completed scan (its references couldn't be validated). Never opens an MCP
 * connection, never triggers a scan.
 */
export function ToolDiagnosticsSection({ report, error }: ToolDiagnosticsSectionProps) {
  const navigate = useNavigate();
  const unscanned = report?.unscannedServers ?? [];

  // K9 — resolve unscanned server NAMES to their ids so each can link to its scan action (the server
  // detail page, where "Scan now" lives). Best-effort: a name we can't resolve renders as plain text.
  const [serverIdByName, setServerIdByName] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    if (unscanned.length === 0) return;
    let cancelled = false;
    apiGet<ServerConfig[]>("/api/servers")
      .then((servers) => {
        if (cancelled) return;
        setServerIdByName(new Map(servers.map((server) => [server.name, server.id])));
      })
      .catch(() => {
        /* no links — the names still render as text below */
      });
    return () => {
      cancelled = true;
    };
  }, [unscanned.length]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool references</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Text variant="meta" tone="muted" className="break-words">
            Couldn’t validate tool references: {error} Use “Re-run checks” above to try again.
          </Text>
        ) : report === null ? (
          <Text variant="meta" tone="muted">
            Checking tool references…
          </Text>
        ) : report.diagnostics.length === 0 ? (
          <Text variant="meta" tone="muted">
            Every backticked tool reference resolves to a scanned server.
          </Text>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="tool-diagnostics-list">
            {report.diagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.kind}:${diagnostic.name}:${index}`}>
                <Card
                  className="flex flex-col gap-1 p-2.5"
                  data-testid="tool-diagnostic"
                  data-kind={diagnostic.kind}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={diagnostic.kind === "stale_tool" ? "warning" : "destructive"}>
                      {diagnostic.kind === "stale_tool" ? "stale" : "unknown"}
                    </Badge>
                    <code className="font-mono text-xs break-all">{diagnostic.name}</code>
                    {diagnostic.anchor ? (
                      <Text variant="meta" tone="muted" as="span" className="tabular-nums">
                        line {diagnostic.anchor.startLine}
                      </Text>
                    ) : null}
                  </div>
                  <Text variant="meta" tone="muted" className="break-words">
                    {formatToolDiagnosticMessage(diagnostic)}
                  </Text>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {unscanned.length > 0 ? (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>Some servers weren’t scanned</AlertTitle>
            <AlertDescription>
              Tool validation skipped {unscanned.length} server{unscanned.length === 1 ? "" : "s"}{" "}
              with no completed scan (
              {unscanned.map((name, index) => {
                const id = serverIdByName.get(name);
                return (
                  <Fragment key={name}>
                    {index > 0 ? ", " : ""}
                    {id ? (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 align-baseline"
                        onClick={() => navigate(`/servers/${id}`)}
                        title={`Open ${name} to run a scan`}
                      >
                        {name}
                      </Button>
                    ) : (
                      <span className="font-medium">{name}</span>
                    )}
                  </Fragment>
                );
              })}
              ). Run a scan to validate references against {unscanned.length === 1 ? "it" : "them"}.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
