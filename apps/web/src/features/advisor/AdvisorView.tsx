import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ADVISOR_SCOPE_KINDS,
  type AdvisorReportQuery,
  type AdvisorScopeKind,
} from "@mcp-token-footprint/shared";
import {
  EmptyState,
  Heading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@elabs-ai/components-ui";
import { Lightbulb } from "lucide-react";
import { PageShell } from "../../components/PageShell";
import { ViewToolbar } from "../../components/ViewToolbar";
import { InlineError } from "../../components/InlineError";
import { listScenarios, listServers } from "../../lib/api";
import { useLoadable } from "../../lib/loadable";
import { AdvisorPanel } from "./AdvisorPanel";
import { ADVISOR_SCOPE_LABELS, isAdvisorScopeKind, parseAdvisorQuery } from "./advisor-format";

/**
 * The Advisor route (`/advisor`) — evidenced recommendations derived from what the app has already
 * measured (scans, runs, environments). Read-only: it renders suggestions and links to their
 * evidence; it never applies anything.
 *
 * Routes-vs-dialogs (D-TB10): this is a PLACE, not an action — an operator bookmarks "the advisor
 * report for this environment" and shares the URL — so the scope lives in the URL (`?scope=&id=`)
 * and the route renders something genuinely useful with ZERO query params: the FLEET report.
 */
export function AdvisorView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const scopeKind: AdvisorScopeKind = useMemo(() => {
    const raw = searchParams.get("scope");
    return raw && isAdvisorScopeKind(raw) ? raw : "fleet";
  }, [searchParams]);
  const selectedId = searchParams.get("id") ?? "";
  const query: AdvisorReportQuery | null = useMemo(
    () => parseAdvisorQuery(searchParams),
    [searchParams],
  );

  // The two entity pickers' options. Both are cheap list reads; a failure surfaces as an inline
  // error rather than an empty picker that looks like "you have no servers".
  const { state: serversState, reload: reloadServers } = useLoadable(() => listServers(), []);
  const { state: scenariosState, reload: reloadScenarios } = useLoadable(() => listScenarios(), []);

  const setScope = useCallback(
    (next: AdvisorScopeKind) => {
      const params = new URLSearchParams();
      if (next !== "fleet") params.set("scope", next);
      // Switching scope drops the previous id on purpose: a server id is meaningless as an
      // environment id, and carrying it over would 404 the report against the wrong entity.
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const setEntityId = useCallback(
    (id: string) => {
      const params = new URLSearchParams();
      params.set("scope", scopeKind);
      params.set("id", id);
      setSearchParams(params, { replace: true });
    },
    [scopeKind, setSearchParams],
  );

  const servers = serversState.status === "data" ? serversState.data : [];
  const scenarios = scenariosState.status === "data" ? scenariosState.data : [];

  const entityOptions =
    scopeKind === "server"
      ? servers.map((server) => ({ value: server.id, label: server.name }))
      : scopeKind === "scenario"
        ? scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name }))
        : [];

  const scopeLabel =
    scopeKind === "fleet"
      ? "the whole fleet"
      : (entityOptions.find((option) => option.value === selectedId)?.label ??
        `this ${ADVISOR_SCOPE_LABELS[scopeKind].toLowerCase()}`);

  const pickerError =
    scopeKind === "server" && serversState.status === "error"
      ? { title: "Couldn’t load MCP servers", detail: serversState.error, retry: reloadServers }
      : scopeKind === "scenario" && scenariosState.status === "error"
        ? {
            title: "Couldn’t load environments",
            detail: scenariosState.error,
            retry: reloadScenarios,
          }
        : null;

  return (
    <PageShell
      width="centered"
      headerVariant="toolbar"
      header={
        <ViewToolbar
          info="Deterministic, evidenced recommendations computed from scans and runs the app has already recorded. Every saving is an estimate, and nothing here is ever applied automatically."
          left={
            <>
              <Select
                value={scopeKind}
                onValueChange={(value) => setScope(value as AdvisorScopeKind)}
              >
                <SelectTrigger className="w-44" aria-label="Advisor scope">
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent>
                  {ADVISOR_SCOPE_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {ADVISOR_SCOPE_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {scopeKind === "fleet" ? null : (
                <Select
                  value={selectedId}
                  onValueChange={setEntityId}
                  disabled={entityOptions.length === 0}
                >
                  <SelectTrigger
                    className="w-64"
                    aria-label={
                      scopeKind === "server"
                        ? "MCP server to advise on"
                        : "Environment to advise on"
                    }
                  >
                    <SelectValue
                      placeholder={
                        scopeKind === "server" ? "Pick a server…" : "Pick an environment…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {entityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          }
        />
      }
    >
      {/* The breadcrumb (MCP › Advisor) names the page; keep an H1 for assistive tech only (D-TB1). */}
      <Heading level={1} className="sr-only">
        Advisor
      </Heading>

      {pickerError ? (
        <InlineError
          title={pickerError.title}
          detail={pickerError.detail}
          onRetry={pickerError.retry}
        />
      ) : null}

      {query ? (
        <AdvisorPanel query={query} scopeLabel={scopeLabel} />
      ) : (
        <EmptyState
          icon={<Lightbulb aria-hidden />}
          title={scopeKind === "server" ? "Pick an MCP server" : "Pick an environment"}
          description={
            entityOptions.length === 0 && !pickerError
              ? `There is nothing to advise on yet — register ${
                  scopeKind === "server" ? "an MCP server" : "an environment"
                } first, then come back.`
              : `Choose one in the toolbar above to see its recommendations, or switch the scope to “${ADVISOR_SCOPE_LABELS.fleet}”.`
          }
        />
      )}
    </PageShell>
  );
}
