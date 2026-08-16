import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  Collection,
  RunPlanEstimate,
  Scenario,
  Skill,
  SkillVersion,
  Suite,
  SuiteInput,
  SuiteRun,
  Test,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Heading,
  StatePanel,
  StatusBadge,
  Text,
  toast,
} from "@brand/ui";
import { ArrowLeft, Layers, ListChecks, Loader2, Pencil, PlayCircle, Trash2 } from "lucide-react";
import {
  ApiError,
  assignSuiteToCollection,
  deleteSuite,
  estimateRunPlan,
  getSuite,
  listCollections,
  listScenarios,
  listSkills,
  listSuiteRuns,
  listTests,
  removeSuiteFromCollection,
  runSuite,
  updateSuite,
} from "../../../lib/api";
import { listSkillVersions } from "../../skills/skills-inspector-api";
import { getErrorMessage } from "../../../lib/errors";
import { ConfirmDialog } from "../../../components/dialogs";
import { formatCostUsd, formatDateTime, formatNumber } from "../../../lib/format";
import { KpiStat } from "../../../components/KpiStat";
import { PageShell } from "../../../components/PageShell";
import { ViewToolbar } from "../../../components/ViewToolbar";
import { useRouteCrumb } from "../../../components/route-crumb";
import { notifyError } from "../../../lib/notify";
import { SuiteEditor } from "./SuiteEditor";
import { suiteStatusBadge } from "./SuiteRunConsole";

/** Format a token band as "low–high" (or a single figure when they collapse). Mirrors the identical
 *  helper in `RunLauncher.tsx`'s `CostPreview` / `SuitesView.tsx` — kept local to each owning file. */
function formatEstimateRange(low: number, high: number): string {
  return low === high ? formatNumber(low) : `${formatNumber(low)}–${formatNumber(high)}`;
}

/**
 * Suite detail (design-remediation T8) — a REAL place, not the suites list with an edit modal painted
 * over it. It resolves its own suite (`getSuite`) plus the test/environment/skill/collection catalogs
 * the editor needs, shows the suite's matrix config + membership + recent runs, and lets the operator
 * **Run** it (→ live suite-run console), **Edit** it (the {@link SuiteEditor} opens as an OVERLAY, so
 * cancelling stays on this page — never teleports to Collections), or **Delete** it (→ back to the
 * suites list). The page publishes the suite name as its breadcrumb leaf via `useRouteCrumb`.
 */
export function SuiteDetail() {
  const navigate = useNavigate();
  const { suiteId } = useParams();

  const [suite, setSuite] = useState<Suite | null>(null);
  const [tests, setTests] = useState<Test[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillVersions, setSkillVersions] = useState<Map<string, SkillVersion[]>>(new Map());
  const [runs, setRuns] = useState<SuiteRun[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [running, setRunning] = useState(false);
  // Error Prevention (P1) — "Run" used to fire `runSuite` on click with zero confirmation and no cost
  // preview. The toolbar's Run button now OPENS this confirm; only its own confirm starts spend.
  const [confirmingRun, setConfirmingRun] = useState(false);
  const [runEstimate, setRunEstimate] = useState<RunPlanEstimate | null>(null);
  const [estimatingRun, setEstimatingRun] = useState(false);
  const [runEstimateError, setRunEstimateError] = useState<string | null>(null);

  // The suite name is this route's breadcrumb leaf ("Suites / <name>"); clears on unmount.
  useRouteCrumb(suite?.name ?? null);

  const load = useCallback(
    async (isActive: () => boolean = () => true) => {
      if (!suiteId) return;
      setLoading(true);
      setLoadError(null);
      setNotFound(false);
      try {
        const suiteData = await getSuite(suiteId);
        if (!isActive()) return;
        setSuite(suiteData);

        // The rest is best-effort catalog + history for the editor and the recent-runs strip — a
        // failure there leaves the page usable (empty pickers / no history), never blocks the suite.
        const [testList, scenarioList, collectionList, runList] = await Promise.all([
          listTests().catch(() => [] as Test[]),
          listScenarios().catch(() => [] as Scenario[]),
          listCollections().catch(() => [] as Collection[]),
          listSuiteRuns(suiteId).catch(() => [] as SuiteRun[]),
        ]);
        if (!isActive()) return;
        setTests(testList);
        setScenarios(scenarioList);
        setCollections(collectionList);
        setRuns(runList);

        try {
          const skillList = await listSkills();
          if (!isActive()) return;
          setSkills(skillList);
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
        } catch {
          if (isActive()) {
            setSkills([]);
            setSkillVersions(new Map());
          }
        }
      } catch (error) {
        if (!isActive()) return;
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(`${getErrorMessage(error, "Couldn’t load this suite.")} Try refreshing the page.`);
        }
      } finally {
        if (isActive()) setLoading(false);
      }
    },
    [suiteId],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const testsById = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);
  const scenariosById = useMemo(() => new Map(scenarios.map((s) => [s.id, s])), [scenarios]);

  const handleSubmit = useCallback(
    async (input: SuiteInput) => {
      if (!suite) return;
      await updateSuite(suite.id, input);
      toast.success("Suite updated");
      await load();
    },
    [suite, load],
  );

  const handleSetCollection = useCallback(
    async (id: string, to: string | null, from: string | null) => {
      try {
        if (to) {
          await assignSuiteToCollection(to, id);
          toast.success("Assigned to collection");
        } else if (from) {
          await removeSuiteFromCollection(from, id);
          toast.success("Removed from collection");
        }
      } catch (error) {
        notifyError("Couldn’t change the suite’s collection.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
        throw error;
      }
    },
    [],
  );

  const runNow = useCallback(async () => {
    if (!suite) return;
    setRunning(true);
    try {
      const run = await runSuite(suite.id);
      toast.success("Suite run started", { description: suite.name });
      navigate(`/testing/suite-runs/${run.id}`);
    } catch (error) {
      notifyError("Couldn’t start the suite run.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setRunning(false);
    }
  }, [suite, navigate]);

  const performDelete = useCallback(async () => {
    if (!suite) return;
    setDeleting(true);
    try {
      await deleteSuite(suite.id);
      toast.success("Suite deleted");
      setConfirmingDelete(false);
      navigate("/testing/suites");
    } catch (error) {
      notifyError("Couldn’t delete the suite.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setDeleting(false);
    }
  }, [suite, navigate]);

  // Error Prevention (P1) — fetch the advisory cost estimate only once the Run confirm is actually
  // open, and only for a plain tests × environments suite (a variant suite overrides the environment
  // per axis, the same caveat `RunLauncher.tsx`'s `CostPreview` applies).
  const runVariantCount = suite?.config.variants?.length ?? 0;
  const canEstimateRun =
    suite !== null &&
    confirmingRun &&
    runVariantCount === 0 &&
    suite.testIds.length > 0 &&
    suite.scenarioIds.length > 0;
  useEffect(() => {
    if (!canEstimateRun || !suite) {
      setRunEstimate(null);
      setRunEstimateError(null);
      setEstimatingRun(false);
      return;
    }
    let active = true;
    setEstimatingRun(true);
    estimateRunPlan(suite.testIds, suite.scenarioIds, suite.config.repetitions)
      .then((result) => {
        if (!active) return;
        setRunEstimate(result);
        setEstimatingRun(false);
      })
      .catch(() => {
        if (!active) return;
        setRunEstimateError("Couldn’t estimate cost — you can still continue.");
        setEstimatingRun(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEstimateRun, suite?.id]);

  if (loading) {
    return (
      <PageShell>
        <StatePanel kind="loading" title="Loading suite…" loadingLabel="Loading suite…" />
      </PageShell>
    );
  }

  if (notFound) {
    return (
      <PageShell>
        <StatePanel
          kind="empty"
          icon={<Layers aria-hidden />}
          title="Suite not found"
          description="It may have been deleted, or the link is out of date."
          actions={
            <Button variant="outline" onClick={() => navigate("/testing/suites")}>
              <ArrowLeft aria-hidden />
              <span>Back to suites</span>
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (loadError || !suite) {
    return (
      <PageShell>
        <StatePanel
          kind="error"
          title="Couldn’t load this suite."
          description={loadError ?? "Try refreshing the page."}
        />
      </PageShell>
    );
  }

  const { config } = suite;
  const variantCount = config.variants?.length ?? 0;
  const axisCount = variantCount > 0 ? variantCount : suite.scenarioIds.length;
  const cells = suite.testIds.length * axisCount * config.repetitions;
  const canRun = cells > 0;

  return (
    <PageShell
      headerVariant="toolbar"
      width="full"
      header={
        <ViewToolbar
          left={
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="tabular-nums">
                {suite.testIds.length} tests
              </Badge>
              {variantCount > 0 ? (
                <Badge variant="secondary" className="tabular-nums">
                  {variantCount} variants
                </Badge>
              ) : (
                <Badge variant="secondary" className="tabular-nums">
                  {suite.scenarioIds.length} environment{suite.scenarioIds.length === 1 ? "" : "s"}
                </Badge>
              )}
              <Text variant="meta" tone="muted" className="tabular-nums">
                {cells} cells
              </Text>
            </div>
          }
          actions={
            <>
              <Button variant="outline" onClick={() => setConfirmingDelete(true)}>
                <Trash2 aria-hidden />
                <span>Delete</span>
              </Button>
              {/* Destructive/primary adjacency (P1) — a visible divider keeps Delete a deliberate
                  reach away from Edit/Run, not one misclick apart. */}
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
              <Button variant="outline" onClick={() => setEditorOpen(true)}>
                <Pencil aria-hidden />
                <span>Edit</span>
              </Button>
              <Button disabled={running || !canRun} onClick={() => setConfirmingRun(true)}>
                {running ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <PlayCircle aria-hidden />
                )}
                <span>{running ? "Starting…" : "Run"}</span>
              </Button>
            </>
          }
        />
      }
    >
      {/* Breadcrumb-named page (Suites / <name>) — keep an AT-only H1 (D-TB1). */}
      <Heading level={1} className="sr-only">
        {suite.name}
      </Heading>

      {suite.description ? (
        <Text tone="muted" className="text-pretty">
          {suite.description}
        </Text>
      ) : null}

      {/* Matrix config — the same summary the list row shows, expanded onto its own KPI rail. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
          <KpiStat label="Repetitions" value={<span className="tabular-nums">{config.repetitions}×</span>} />
          <KpiStat label="Parallel" value={<span className="tabular-nums">{config.maxConcurrency}</span>} />
          <KpiStat
            label="Cost cap"
            value={
              <span className="tabular-nums">
                {config.aggregateCostCapUsd ? formatCostUsd(config.aggregateCostCapUsd) : "No cap"}
              </span>
            }
          />
          <KpiStat label="Cells" value={<span className="tabular-nums">{cells}</span>} />
        </CardContent>
      </Card>

      {/* Membership — the ordered tests and the environment (or variant) axis. */}
      <div className="grid gap-4 md:grid-cols-2">
        <MemberList
          icon={<ListChecks aria-hidden />}
          title="Tests"
          empty="No tests in this suite yet — add some in the editor."
          items={suite.testIds.map((id, index) => ({
            key: `${id}-${index}`,
            label: testsById.get(id)?.name ?? "Unknown test",
            meta: `#${index + 1}`,
          }))}
        />
        {variantCount > 0 ? (
          <MemberList
            icon={<Layers aria-hidden />}
            title="Variants"
            empty="No variants."
            items={(config.variants ?? []).map((variant, index) => ({
              key: `variant-${index}`,
              label: variant.label,
              meta: scenariosById.get(variant.scenarioId)?.name,
            }))}
          />
        ) : (
          <MemberList
            icon={<Layers aria-hidden />}
            title="Environments"
            empty="No environments in this suite yet — add some in the editor."
            items={suite.scenarioIds.map((id) => ({
              key: id,
              label: scenariosById.get(id)?.name ?? "Unknown environment",
              meta: scenariosById.get(id)?.model,
            }))}
          />
        )}
      </div>

      {/* Recent runs of THIS suite — a link back into any past console (mirrors the list's strip). */}
      {runs.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="Recent suite runs">
          <Text className="font-medium">Recent runs</Text>
          <ul className="flex flex-col gap-1.5">
            {runs.slice(0, 8).map((run) => {
              const badge = suiteStatusBadge(run.status, run.ratingState);
              return (
                <li key={run.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <Text variant="meta" tone="muted" className="tabular-nums">
                          {formatDateTime(run.startedAt)}
                        </Text>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {run.aggregates ? (
                          <>
                            <KpiStat
                              label="Cells"
                              value={`${run.aggregates.cellsCompleted} / ${run.aggregates.cellsTotal}`}
                            />
                            <KpiStat
                              label="Grade"
                              value={
                                run.aggregates.meanGrade === null
                                  ? "—"
                                  : run.aggregates.meanGrade.toFixed(2)
                              }
                            />
                            <KpiStat
                              label="Cost"
                              value={formatCostUsd(
                                run.aggregates.execCostUsd + run.aggregates.judgeCostUsd,
                              )}
                            />
                          </>
                        ) : null}
                        <StatusBadge status={badge.status}>{badge.label}</StatusBadge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate(`/testing/suite-runs/${run.id}`)}
                        >
                          Open console
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <EmptyState
          icon={<PlayCircle aria-hidden />}
          title="No runs yet"
          description="Run this suite to produce a matrix of results — they’ll appear here for replay and comparison."
        />
      )}

      {/* Edit as an OVERLAY (design-remediation T8) — cancelling stays on this detail page. */}
      <SuiteEditor
        open={editorOpen}
        suite={suite}
        tests={tests}
        scenarios={scenarios}
        skills={skills}
        skillVersions={skillVersions}
        onOpenChange={setEditorOpen}
        onSubmit={handleSubmit}
        collections={collections}
        onSetCollection={handleSetCollection}
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={(open) => !open && setConfirmingDelete(false)}
        title={`Delete ${suite.name}?`}
        description="This permanently removes the suite. Suite runs already produced from it are kept. This action cannot be undone."
        confirmLabel="Delete suite"
        tone="destructive"
        busy={deleting}
        onConfirm={() => void performDelete()}
      />

      <ConfirmDialog
        open={confirmingRun}
        onOpenChange={setConfirmingRun}
        title={`Run ${suite.name}?`}
        description={`${suite.testIds.length} test${suite.testIds.length === 1 ? "" : "s"} × ${axisCount} ${variantCount > 0 ? "variant" : "environment"}${axisCount === 1 ? "" : "s"} × ${config.repetitions} repetition${config.repetitions === 1 ? "" : "s"} = ${cells} run${cells === 1 ? "" : "s"}.`}
        confirmLabel="Run suite"
        onConfirm={() => {
          setConfirmingRun(false);
          void runNow();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Text variant="meta" tone="muted">
            Cost cap:{" "}
            {config.aggregateCostCapUsd
              ? formatCostUsd(config.aggregateCostCapUsd)
              : "No cap set — this run can spend without limit."}
          </Text>
          {canEstimateRun ? (
            estimatingRun ? (
              <Text variant="meta" tone="muted">
                Estimating cost…
              </Text>
            ) : runEstimateError ? (
              <Text variant="meta" tone="muted">
                {runEstimateError}
              </Text>
            ) : runEstimate ? (
              <Text variant="meta" tone="muted" className="tabular-nums">
                ≈ {formatEstimateRange(runEstimate.tokens.low, runEstimate.tokens.high)} tokens
                {runEstimate.environmentCount > runEstimate.unpricedEnvironmentCount
                  ? ` · ${formatCostUsd(runEstimate.costUsd.low)}–${formatCostUsd(runEstimate.costUsd.high)} (estimate)`
                  : ""}
              </Text>
            ) : null
          ) : variantCount > 0 ? (
            <Text variant="meta" tone="muted">
              No cost estimate available for a variant suite — each variant may run on a different
              environment.
            </Text>
          ) : null}
        </div>
      </ConfirmDialog>
    </PageShell>
  );
}

/** One titled membership card — an ordered list of resolved names, each with an optional meta chip. */
function MemberList({
  icon,
  title,
  empty,
  items,
}: {
  icon: ReactNode;
  title: string;
  empty: string;
  items: { key: string; label: string; meta?: string }[];
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <Text className="font-medium">{title}</Text>
          <Badge variant="secondary" className="tabular-nums">
            {items.length}
          </Badge>
        </div>
        {items.length === 0 ? (
          <Text variant="meta" tone="muted" className="text-pretty">
            {empty}
          </Text>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => (
              <li
                key={item.key}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5"
              >
                <Text className="min-w-0 truncate">{item.label}</Text>
                {item.meta ? (
                  <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
                    {item.meta}
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
