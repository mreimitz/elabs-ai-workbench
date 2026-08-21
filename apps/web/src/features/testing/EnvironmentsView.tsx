import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProviderCredential,
  ScanDetail,
  Scenario,
  ScenarioInput,
  ServerConfig,
  ServerType,
  Skill,
  SkillVersion,
} from "@mcp-token-footprint/shared";
import { providerKindLabel } from "@mcp-token-footprint/shared";
import { DataTable, SearchInput } from "@elabs-ai/components-data";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  EmptyState,
  Heading,
  StatePanel,
  Text,
  toast,
} from "@elabs-ai/components-ui";
import { FlaskConical, Lightbulb, Loader2, Pencil, Plus, Trash2, Wifi, X } from "lucide-react";
import {
  apiGet,
  createScenario,
  deleteScenario,
  listProviders,
  listScenarios,
  listServerTypes,
  listSkills,
  updateScenario,
} from "../../lib/api";
import { listSkillVersions } from "../skills/skills-inspector-api";
import { actionsCol, col, shouldPaginate } from "../../lib/table";
import { getErrorMessage } from "../../lib/errors";
import { formatCostUsd, formatNumber, formatRelativeTime } from "../../lib/format";
import { IconButton } from "../../components/IconButton";
import { InlineError } from "../../components/InlineError";
import { PageShell } from "../../components/PageShell";
import { ResultCount } from "../../components/ResultCount";
import { StatusBadge } from "../../components/StatusBadge";
import { ViewToolbar } from "../../components/ViewToolbar";
import { AdvisorPanel } from "../advisor/AdvisorPanel";
import { advisorReportHref } from "../advisor/advisor-format";
import { EnvironmentEditor } from "./EnvironmentEditor";
import { credentialHealthView, getCredentialHealth, testCredential } from "./credential-health";
import { notifyError } from "../../lib/notify";

/**
 * Environments — the run harness (server + provider/model + allow-list + guardrails) a Test runs
 * against. Self-contained: it fetches its own environments, provider credentials, servers, and each
 * server's latest scan (so the editor's allow-list can compute a live footprint). Create/edit run
 * through the `EnvironmentEditor` dialog; delete confirms via `AlertDialog`. No fabricated data — a
 * real empty state when the list is `[]`. (Wire/identifiers keep the `scenario` name — see the
 * `Scenario` shared type and `/api` fields.)
 */
export function EnvironmentsView() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [providers, setProviders] = useState<ProviderCredential[]>([]);
  const [servers, setServers] = useState<ServerConfig[]>([]);
  // Server types (planning/Roadmap/completed/RM-21-server-types) — read-only, feeds the editor's allowed-server type/status
  // surfacing (WP 4.1). Best-effort: a missing/failed types API degrades to [] (no crash, no type
  // labels), so it must never fail the whole environments load.
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [latestScans, setLatestScans] = useState<Map<string, ScanDetail>>(new Map());
  // The skill registry + each skill's immutable versions — feeds the editor's "Allowed skills" panel
  // (version chip + per-skill L1/L2 footprint). Best-effort: a missing skills API leaves these empty.
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillVersions, setSkillVersions] = useState<Map<string, SkillVersion[]>>(new Map());
  // A genuine skills-registry failure (network/500) is surfaced, not swallowed to `[]` — an empty
  // list must mean "no skills", never "the fetch failed". `null` = loaded fine (or not attempted).
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Scenario | null>(null);
  // Advisor (planning/Roadmap/RM-01-advisor/ WP 1.3) — the environment whose inline recommendation panel is open
  // below the table. Environments have no per-entity ROUTE (selection lives in React state, as it
  // already does for the editor above), so the panel is opened from a row action and names the
  // environment it belongs to; the full, bookmarkable report is one click away at `/advisor`.
  const [advisorScenarioId, setAdvisorScenarioId] = useState<string | null>(null);
  // Credential health ("is this key usable?", T7) — a client-side record (see `credential-health.ts`).
  // `healthTick` forces the table to re-read the store after a check; `testingProviders` tracks which
  // credential(s) have a live "Test connection" in flight (a Set — two rows may test at once).
  const [healthTick, setHealthTick] = useState(0);
  const [testingProviders, setTestingProviders] = useState<ReadonlySet<string>>(() => new Set());

  // The live row behind the open advisor panel. Derived (not stored) so a refresh, rename or
  // delete can never leave the panel pointing at a stale snapshot — a deleted environment simply
  // closes the panel.
  const advisorScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === advisorScenarioId) ?? null,
    [scenarios, advisorScenarioId],
  );

  const providerById = useMemo(() => {
    const map = new Map<string, ProviderCredential>();
    for (const provider of providers) map.set(provider.id, provider);
    return map;
  }, [providers]);

  // P2-4 (RM-36 WP 2.2) — the ids in an environment's `allowedServers` that no longer resolve to a
  // registered server. This page used to say nothing at all about them: the server row was simply
  // absent from `/api/servers`, its `…/latest-scan` 404'd into a swallowed `catch`, and the only
  // trace of the dangling reference was a red line in the browser console. A dangling reference is
  // exactly the data-integrity signal an operator needs, so it is surfaced INLINE on the row it
  // belongs to. It is a KNOWN state, not an exceptional one — hence a chip on the Servers cell, not
  // an error banner over the page (see `interaction-guidelines.md`: surface every outcome, and the
  // out-of-scope note in the WP spec: nothing about the environments API changes).
  const knownServerIds = useMemo(() => new Set(servers.map((server) => server.id)), [servers]);
  const missingServerCount = useCallback(
    (scenario: Scenario) =>
      scenario.allowedServers.filter((allowed) => !knownServerIds.has(allowed.serverId)).length,
    [knownServerIds],
  );

  const runCredentialTest = useCallback(async (provider: ProviderCredential) => {
    setTestingProviders((prev) => {
      const next = new Set(prev);
      next.add(provider.id);
      return next;
    });
    try {
      const health = await testCredential(provider);
      setHealthTick((tick) => tick + 1);
      if (health.state === "verified") {
        toast.success("Connection verified", { description: provider.label });
      } else {
        notifyError("Couldn’t verify the credential.", {
          description:
            health.error ?? "The provider couldn’t be reached. Check the key and try again.",
        });
      }
    } finally {
      setTestingProviders((prev) => {
        const next = new Set(prev);
        next.delete(provider.id);
        return next;
      });
    }
  }, []);

  // `isActive` guards the post-`await` writes so a rapid nav / unmount (or a superseded refresh)
  // can't clobber the lists with a stale response. Defaults to always-apply for the manual callers
  // (post-create/update/delete); the mount effect passes its own `() => active` cancel flag.
  const refresh = useCallback(async (isActive: () => boolean = () => true) => {
    setLoading(true);
    try {
      const [scenarioList, providerList, serverList, typeList] = await Promise.all([
        listScenarios(),
        listProviders(),
        apiGet<ServerConfig[]>("/api/servers"),
        // Best-effort: type/status surfacing is additive read-only — a failure degrades to [] rather
        // than failing the whole environments load.
        listServerTypes().catch(() => [] as ServerType[]),
      ]);
      if (!isActive()) return;
      setScenarios(scenarioList);
      setProviders(providerList);
      setServers(serverList);
      setServerTypes(typeList);

      // Best-effort: a server with no scan 404s on latest-scan — that's expected, not an error.
      const scanEntries = await Promise.all(
        serverList.map(async (server) => {
          try {
            const scan = await apiGet<ScanDetail>(`/api/servers/${server.id}/latest-scan`);
            return [server.id, scan] as const;
          } catch {
            return null;
          }
        }),
      );
      if (!isActive()) return;
      setLatestScans(
        new Map(
          scanEntries.filter((entry): entry is readonly [string, ScanDetail] => entry !== null),
        ),
      );

      // Skills registry (Phase 2 attachment) — load the skill list + each skill's versions so the
      // editor can show a version chip + per-skill footprint. A per-skill version 404 stays
      // best-effort (skip that one), but a failure of the skills LIST itself is surfaced (below) so
      // the editor's "Allowed skills" panel isn't silently empty when the registry is actually down.
      try {
        const skillList = await listSkills();
        if (!isActive()) return;
        setSkills(skillList);
        setSkillsError(null);
        const versionEntries = await Promise.all(
          skillList.map(async (skill) => {
            try {
              return [skill.id, await listSkillVersions(skill.id)] as const;
            } catch {
              return null;
            }
          }),
        );
        if (!isActive()) return;
        setSkillVersions(
          new Map(
            versionEntries.filter(
              (entry): entry is readonly [string, SkillVersion[]] => entry !== null,
            ),
          ),
        );
      } catch (error) {
        if (!isActive()) return;
        setSkills([]);
        setSkillVersions(new Map());
        setSkillsError(getErrorMessage(error));
      }
    } catch (error) {
      if (isActive()) {
        notifyError("Couldn’t load environments.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refresh(() => active);
    return () => {
      active = false;
    };
  }, [refresh]);

  const handleSubmit = useCallback(
    async (input: ScenarioInput) => {
      if (editing) {
        await updateScenario(editing.id, input);
        toast.success("Environment updated");
      } else {
        await createScenario(input);
        toast.success("Environment created");
      }
      await refresh();
    },
    [editing, refresh],
  );

  const performDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteScenario(target.id);
      toast.success("Environment deleted");
      await refresh();
    } catch (error) {
      notifyError("Couldn’t delete the environment.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    }
  }, [pendingDelete, refresh]);

  const columns = useMemo(
    () => [
      col<Scenario>({
        id: "name",
        header: "Name",
        value: (row) => row.name,
        cell: (row) => <span className="font-medium">{row.name}</span>,
      }),
      col<Scenario>({
        id: "provider",
        header: "Provider",
        value: (row) => providerById.get(row.providerId)?.label ?? row.providerId,
        // D-MI6 (`planning/Roadmap/RM-16-model-identity/`, WP 2.3): the badge shows the provider kind's DISPLAY
        // name, never the raw wire literal — it used to read "claude_subscription".
        cell: (row) => {
          const provider = providerById.get(row.providerId);
          return provider ? (
            <Badge variant="secondary">{providerKindLabel(provider.kind)}</Badge>
          ) : (
            <Badge variant="warning">missing</Badge>
          );
        },
      }),
      // Credential HEALTH (T7): whether this environment's key is actually usable, tested on demand
      // (never faked) — Verified / Never tested / Failed + when it was last checked, plus the "Test
      // connection" affordance. `healthTick` in the deps re-reads the store after a check.
      col<Scenario>({
        id: "credential",
        header: "Credential",
        value: (row) => getCredentialHealth(providerById.get(row.providerId)).state,
        cell: (row) => {
          const provider = providerById.get(row.providerId);
          if (!provider) {
            return (
              <Text variant="meta" tone="muted">
                No credential
              </Text>
            );
          }
          return (
            <CredentialHealthCell
              provider={provider}
              busy={testingProviders.has(provider.id)}
              onTest={() => void runCredentialTest(provider)}
            />
          );
        },
      }),
      col<Scenario>({
        id: "model",
        header: "Model",
        value: (row) => row.model,
        cell: (row) => (
          <span className="font-mono text-meta" title={row.model}>
            {row.model.length > 12 ? `${row.model.slice(0, 12)}…` : row.model}
          </span>
        ),
      }),
      col<Scenario>({
        id: "toolLoading",
        header: "Loading",
        value: (row) => row.toolLoadingMode,
        // Two equal modes → one neutral pill weight for both (T10: `deferred` was an emphasized blue
        // pill vs `eager` a gray outline — arbitrary emphasis on one of two peers).
        cell: (row) => <Badge variant="secondary">{row.toolLoadingMode}</Badge>,
      }),
      // P2-4 — the Servers count, plus an inline note when one of the referenced servers no longer
      // resolves. Sorting still keys off the raw count, so the added note changes no ordering.
      col<Scenario>({
        id: "tools",
        header: "Servers",
        numeric: true,
        value: (row) => row.allowedServers.length,
        cell: (row) => <AllowedServersCell scenario={row} missing={missingServerCount(row)} />,
      }),
      col<Scenario>({
        id: "profiles",
        header: "Profiles",
        numeric: true,
        value: (row) => row.defaultProfiles.length,
      }),
      col<Scenario>({
        id: "guardrails",
        header: "Guardrails",
        value: (row) => summarizeGuardrails(row),
        cell: (row) => (
          <Text variant="meta" tone="muted" className="tabular-nums">
            {summarizeGuardrails(row)}
          </Text>
        ),
      }),
      // Row actions: no sort glyph, no global-filter participation, right-aligned (T10/S15).
      actionsCol<Scenario>({
        header: "Actions",
        cell: (row) => (
          <>
            <IconButton
              variant="ghost"
              size="sm"
              label={`Edit ${row.name}`}
              onClick={() => {
                setEditing(row);
                setEditorOpen(true);
              }}
            >
              <Pencil aria-hidden />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              label={`Advice for ${row.name}`}
              onClick={() => setAdvisorScenarioId(row.id)}
            >
              <Lightbulb aria-hidden />
            </IconButton>
            <IconButton
              variant="ghost"
              size="sm"
              label={`Delete ${row.name}`}
              onClick={() => setPendingDelete(row)}
            >
              <Trash2 aria-hidden />
            </IconButton>
          </>
        ),
      }),
    ],
    [providerById, testingProviders, runCredentialTest, healthTick, missingServerCount],
  );

  // Catalog archetype (audit §C): full-width, header fixed, the table scrolls INTERNALLY (default
  // `scroll="content"`). A short/empty state fills the region (centred, no dead sea below). The
  // header is the shared one-row ViewToolbar (toolbar standard D-TB1/D-TB2): identity → breadcrumb.
  // ONE toolbar row (B-2 fix): [search] [count] ····· [New environment] — search + count live in the
  // ViewToolbar left/results, not a second in-table TableToolbar (D-TB6/D-TB7), modelled on
  // AuditView / SessionsView. Count is the standard secondary Badge (C-5).
  return (
    <PageShell
      headerVariant="toolbar"
      header={
        <ViewToolbar
          left={
            <div className="w-56 min-w-[10rem]">
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search environments…"
                label="Search environments"
              />
            </div>
          }
          results={
            <ResultCount>
              {scenarios.length} {scenarios.length === 1 ? "environment" : "environments"}
            </ResultCount>
          }
          actions={
            <Button
              onClick={() => {
                setEditing(null);
                setEditorOpen(true);
              }}
            >
              <Plus aria-hidden />
              <span>New environment</span>
            </Button>
          }
        />
      }
    >
      {/* The breadcrumb (Home / Environments) names the page; keep an H1 for AT only (D-TB1). */}
      <Heading level={1} className="sr-only">
        Environments
      </Heading>

      {!loading && skillsError ? (
        <InlineError
          title="Couldn’t load skills"
          detail={`The environment editor's skill options may be incomplete. ${skillsError}`}
          onRetry={() => void refresh()}
        />
      ) : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <StatePanel
            kind="loading"
            title="Loading environments…"
            loadingLabel="Loading environments…"
          />
        </div>
      ) : scenarios.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<FlaskConical aria-hidden />}
            title="No environments yet"
            description="An environment pairs a provider credential and model with an allowed tool set and guardrails. Create one to start running tests."
            actions={
              <Button
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                <Plus aria-hidden />
                <span>New environment</span>
              </Button>
            }
          />
        </div>
      ) : (
        <DataTable
          data={scenarios}
          columns={columns}
          globalFilter={search}
          onGlobalFilterChange={setSearch}
          enablePagination={shouldPaginate(scenarios.length, 25)}
          pageSize={25}
          initialView={{ sorting: [{ id: "name", desc: false }] }}
          emptyMessage="No environments match the current search."
        />
      )}

      {/* ── Inline advisor panel for the picked environment (advisor WP 1.3). Read-only: evidenced
          suggestions with labelled estimates; the app never applies one. ── */}
      {advisorScenario ? (
        <section
          aria-label={`Advisor recommendations for ${advisorScenario.name}`}
          className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-col">
              <Heading level={2} size="subtitle">
                Advisor · {advisorScenario.name}
              </Heading>
              <Text variant="meta" tone="muted" className="text-pretty">
                Deterministic recommendations from this environment's runs and its servers' scans.
                Savings are estimates.
              </Text>
            </div>
            <IconButton
              variant="ghost"
              size="sm"
              label="Close advisor panel"
              onClick={() => setAdvisorScenarioId(null)}
            >
              <X aria-hidden />
            </IconButton>
          </div>
          <AdvisorPanel
            query={{ scope: "scenario", id: advisorScenario.id }}
            scopeLabel={advisorScenario.name}
            fullReportHref={advisorReportHref({ scope: "scenario", id: advisorScenario.id })}
          />
        </section>
      ) : null}

      <EnvironmentEditor
        open={editorOpen}
        scenario={editing}
        providers={providers}
        servers={servers}
        serverTypes={serverTypes}
        latestScans={latestScans}
        skills={skills}
        skillVersions={skillVersions}
        onOpenChange={setEditorOpen}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name ?? "environment"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the environment. Runs already produced from it are
              unaffected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={() => void performDelete()}>
                Delete environment
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/**
 * P2-4 (RM-36 WP 2.2) — the Servers count, and an INLINE note when this environment references a
 * server that no longer resolves.
 *
 * The defect this closes: `GET /api/servers/<id>/latest-scan` 404s on every load for a dangling
 * reference, and the page showed no error text, no `role="alert"`, no `role="status"` and no toast —
 * the failure existed only in the browser console. `architecture.md` and `interaction-guidelines.md`
 * both forbid swallowing a failure like that.
 *
 * It is deliberately NOT an error banner over the whole page. A dangling reference is a KNOWN state
 * of the data (a server was deleted; the environment kept pointing at it), not an exceptional
 * failure, so it reads as information on the row it belongs to: a warning chip naming how many of
 * the environment's servers are gone. `role="status"` (polite) rather than `role="alert"`, for the
 * same reason.
 */
function AllowedServersCell({ scenario, missing }: { scenario: Scenario; missing: number }) {
  const total = scenario.allowedServers.length;
  if (missing === 0) {
    return <span className="tabular-nums">{formatNumber(total)}</span>;
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      <span className="tabular-nums">{formatNumber(total)}</span>
      {/* A native `<output>` — its implicit role IS `status` (polite), so the note is announced
          without an explicit `role`, which is what `lint/a11y/useSemanticElements` asks for. Layout
          element only; the visible chip is still the design system's `Badge`. */}
      <output>
        <Badge variant="warning" className="font-normal">
          {missing === 1
            ? "1 server no longer available"
            : `${missing} servers no longer available`}
        </Badge>
      </output>
    </span>
  );
}

/** One credential-health cell: the state chip + when it was last checked + a "Test connection" action. */
function CredentialHealthCell({
  provider,
  busy,
  onTest,
}: {
  provider: ProviderCredential;
  busy: boolean;
  onTest: () => void;
}) {
  const health = getCredentialHealth(provider);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <StatusBadge view={credentialHealthView(health.state)} className="shrink-0" />
      {health.checkedAt ? (
        <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
          {formatRelativeTime(health.checkedAt)}
        </Text>
      ) : null}
      <IconButton
        variant="ghost"
        size="sm"
        className="ml-auto shrink-0"
        label={`Test connection for ${provider.label}`}
        disabledReason="Testing the connection…"
        disabled={busy}
        onClick={onTest}
      >
        {busy ? (
          <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Wifi aria-hidden />
        )}
      </IconButton>
    </div>
  );
}

function summarizeGuardrails(scenario: Scenario): string {
  const { guardrails } = scenario;
  const parts: string[] = [];
  if (guardrails.maxTurns) parts.push(`${guardrails.maxTurns} turns`);
  if (guardrails.maxToolCalls) parts.push(`${formatNumber(guardrails.maxToolCalls)} calls`);
  if (guardrails.maxTokens) parts.push(`${formatNumber(guardrails.maxTokens)} tok`);
  if (guardrails.maxContextTokens) parts.push(`${formatNumber(guardrails.maxContextTokens)} ctx`);
  if (guardrails.maxCostUsd) parts.push(formatCostUsd(guardrails.maxCostUsd));
  return parts.length > 0 ? parts.join(" · ") : "none";
}
