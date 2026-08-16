import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  SectionHeader,
  StatePanel,
  StatusBadge,
  Text,
  toast,
} from "@brand/ui";
import { ArrowRight, Layers, Loader2, PlayCircle, Plus, Trash2 } from "lucide-react";
import {
  assignSuiteToCollection,
  createSuite,
  deleteSuite,
  estimateRunPlan,
  listCollections,
  listScenarios,
  listSkills,
  listSuiteRuns,
  listSuites,
  listTests,
  removeSuiteFromCollection,
  runSuite,
  updateSuite,
} from "../../../lib/api";
import { listSkillVersions } from "../../skills/skills-inspector-api";
import { getErrorMessage } from "../../../lib/errors";
import { ConfirmDialog } from "../../../components/dialogs";
import { formatCostUsd, formatDateTime, formatNumber } from "../../../lib/format";
import { IconButton } from "../../../components/IconButton";
import { KpiStat } from "../../../components/KpiStat";
import { SuiteEditor } from "./SuiteEditor";
import { suiteStatusBadge } from "./SuiteRunConsole";
import { notifyError } from "../../../lib/notify";

/** Format a token band as "low–high" (or a single figure when they collapse). Mirrors the identical
 *  helper in `RunLauncher.tsx`'s `CostPreview` — kept local (that file isn't in this WP's ownership). */
function formatEstimateRange(low: number, high: number): string {
  return low === high ? formatNumber(low) : `${formatNumber(low)}–${formatNumber(high)}`;
}

/**
 * Suites — the mass-run authoring + launch surface. Lists suites (member counts + config summary),
 * CREATES them through the `SuiteEditor` dialog, and LAUNCHES a run (`POST /api/suites/:id/run`) that
 * navigates straight to the live console. A "Recent runs" strip links back into any past console.
 *
 * design-remediation T8 — this is now a pure LIST: opening a suite navigates to its real detail page
 * (`/testing/suites/:suiteId`, {@link ../SuiteDetail}), where editing happens behind an overlay. The
 * `:suiteId` route no longer renders this view with an edit modal over it (which used to teleport to
 * Collections on cancel). Create stays a transient local dialog (routes-vs-dialogs D-TB10).
 */
export function SuitesView() {
  const navigate = useNavigate();

  const [suites, setSuites] = useState<Suite[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [runs, setRuns] = useState<SuiteRun[]>([]);
  // WP 5.1 — registered skills + versions, so the editor's variant pickers can attach/pin/detach.
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillVersions, setSkillVersions] = useState<Map<string, SkillVersion[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Suite | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Suite | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  // Error Prevention (P1) — "Run" used to fire `runSuite` on click with zero confirmation and no cost
  // preview, even though every suite here defaults to "no cap". The row's Run button now OPENS this
  // confirm (stating cells/cap/estimated cost); only its own confirm actually starts spend.
  const [pendingRun, setPendingRun] = useState<Suite | null>(null);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    setLoading(true);
    try {
      const [suiteList, testList, scenarioList, collectionList, runList] = await Promise.all([
        listSuites(),
        listTests(),
        listScenarios(),
        listCollections(),
        listSuiteRuns(),
      ]);
      if (!isActive()) return;
      setSuites(suiteList);
      setTests(testList);
      setScenarios(scenarioList);
      setCollections(collectionList);
      setRuns(runList);

      // Skills registry (WP 5.1) — load skills + each skill's versions so the variant pickers can
      // attach/pin/detach. Best-effort: a registry failure leaves the variant pickers empty (a suite
      // without variants is unaffected), never blocking the suites list.
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
      if (isActive()) {
        notifyError("Couldn’t load suites.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      }
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const suiteName = useMemo(() => new Map(suites.map((s) => [s.id, s.name])), [suites]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setEditorOpen(true);
  }, []);

  // The editor is CREATE-only here now (edit lives on the detail page), so closing it just clears
  // state — no route navigation, no teleport.
  const handleEditorOpenChange = useCallback((open: boolean) => {
    setEditorOpen(open);
    if (!open) setEditing(null);
  }, []);

  const handleSubmit = useCallback(
    async (input: SuiteInput) => {
      if (editing) {
        await updateSuite(editing.id, input);
        toast.success("Suite updated");
      } else {
        await createSuite(input);
        toast.success("Suite created");
      }
      await load();
    },
    [editing, load],
  );

  // Collection (re)assignment for the editor's picker — an immediate write via the membership API.
  const handleSetCollection = useCallback(
    async (suiteId: string, to: string | null, from: string | null) => {
      try {
        if (to) {
          await assignSuiteToCollection(to, suiteId);
          toast.success("Assigned to collection");
        } else if (from) {
          await removeSuiteFromCollection(from, suiteId);
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

  const runNow = useCallback(
    async (suite: Suite) => {
      setRunningId(suite.id);
      try {
        const run = await runSuite(suite.id);
        toast.success("Suite run started", { description: suite.name });
        navigate(`/testing/suite-runs/${run.id}`);
      } catch (error) {
        notifyError("Couldn’t start the suite run.", {
          description: `${getErrorMessage(error)} Try again.`,
        });
      } finally {
        setRunningId(null);
      }
    },
    [navigate],
  );

  const performDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeletingId(target.id);
    try {
      await deleteSuite(target.id);
      toast.success("Suite deleted");
      setPendingDelete(null);
      await load();
    } catch (error) {
      notifyError("Couldn’t delete the suite.", {
        description: `${getErrorMessage(error)} Try again.`,
      });
    } finally {
      setDeletingId(null);
    }
  }, [pendingDelete, load]);

  const recentRuns = useMemo(() => runs.slice(0, 8), [runs]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <SectionHeader
        title="Suites"
        description="Mass-runs — a test × environment × repetition matrix executed in parallel with a soft cost cap. Launch one to watch its live console."
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden />
            <span>New suite</span>
          </Button>
        }
      />

      {loading ? (
        <StatePanel kind="loading" title="Loading suites…" loadingLabel="Loading suites…" />
      ) : suites.length === 0 ? (
        <EmptyState
          icon={<Layers aria-hidden />}
          title="No suites yet"
          description="A suite bundles ordered tests and an environment set into a repeatable matrix run. Create one to start benchmarking."
          actions={
            <Button onClick={openCreate}>
              <Plus aria-hidden />
              <span>New suite</span>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {suites.map((suite) => (
            <li key={suite.id}>
              <SuiteRow
                suite={suite}
                running={runningId === suite.id}
                onRequestRun={() => setPendingRun(suite)}
                onOpen={() => navigate(`/testing/suites/${suite.id}`)}
                onDelete={() => setPendingDelete(suite)}
              />
            </li>
          ))}
        </ul>
      )}

      {recentRuns.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="Recent suite runs">
          <Text className="font-medium">Recent runs</Text>
          <ul className="flex flex-col gap-1.5">
            {recentRuns.map((run) => {
              // AR11 — review-aware: a terminal suite run still being rated reads "Reviewing…".
              const badge = suiteStatusBadge(run.status, run.ratingState);
              return (
                <li key={run.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <Text className="min-w-0 truncate font-medium">
                          {suiteName.get(run.suiteId ?? "") ?? "Suite"}
                        </Text>
                        <Text variant="meta" tone="muted">
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
      ) : null}

      <SuiteEditor
        open={editorOpen}
        suite={editing}
        tests={tests}
        scenarios={scenarios}
        skills={skills}
        skillVersions={skillVersions}
        onOpenChange={handleEditorOpenChange}
        onSubmit={handleSubmit}
        collections={collections}
        onSetCollection={handleSetCollection}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? "suite"}?`}
        description="This permanently removes the suite. Suite runs already produced from it are kept. This action cannot be undone."
        confirmLabel="Delete suite"
        tone="destructive"
        busy={pendingDelete !== null && deletingId === pendingDelete.id}
        onConfirm={() => void performDelete()}
      />

      <RunSuiteConfirmDialog
        suite={pendingRun}
        onOpenChange={(open) => !open && setPendingRun(null)}
        onConfirm={() => {
          const suite = pendingRun;
          setPendingRun(null);
          if (suite) void runNow(suite);
        }}
      />
    </div>
  );
}

/**
 * Error Prevention (P1) — the ONE confirm every suite Run action routes through: states the exact
 * cell count, the suite's own cost cap (or the honest "no cap" it currently has), and — for a plain
 * tests × environments suite (a variant suite overrides the environment per axis, so the estimate
 * doesn't apply the same way `RunLauncher.tsx`'s `CostPreview` skips it too) — an advisory
 * `GET /api/estimate/run-plan` token/cost band. Never blocks the run; it just makes sure spend was
 * SEEN before it happens.
 */
function RunSuiteConfirmDialog({
  suite,
  onOpenChange,
  onConfirm,
}: {
  suite: Suite | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [estimate, setEstimate] = useState<RunPlanEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const variantCount = suite?.config.variants?.length ?? 0;
  const canEstimate =
    suite !== null && variantCount === 0 && suite.testIds.length > 0 && suite.scenarioIds.length > 0;
  const suiteId = suite?.id;

  useEffect(() => {
    if (!canEstimate || !suite) {
      setEstimate(null);
      setEstimateError(null);
      setEstimating(false);
      return;
    }
    let active = true;
    setEstimating(true);
    estimateRunPlan(suite.testIds, suite.scenarioIds, suite.config.repetitions)
      .then((result) => {
        if (!active) return;
        setEstimate(result);
        setEstimating(false);
      })
      .catch(() => {
        if (!active) return;
        setEstimateError("Couldn’t estimate cost — you can still continue.");
        setEstimating(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suiteId, canEstimate]);

  if (!suite) return null;
  const variantAxis = variantCount > 0 ? variantCount : suite.scenarioIds.length;
  const cells = suite.testIds.length * variantAxis * suite.config.repetitions;
  const cap = suite.config.aggregateCostCapUsd;

  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={`Run ${suite.name}?`}
      description={`${suite.testIds.length} test${suite.testIds.length === 1 ? "" : "s"} × ${variantAxis} ${variantCount > 0 ? "variant" : "environment"}${variantAxis === 1 ? "" : "s"} × ${suite.config.repetitions} repetition${suite.config.repetitions === 1 ? "" : "s"} = ${cells} run${cells === 1 ? "" : "s"}.`}
      confirmLabel="Run suite"
      onConfirm={onConfirm}
    >
      <div className="flex flex-col gap-1.5">
        <Text variant="meta" tone="muted">
          Cost cap:{" "}
          {cap ? formatCostUsd(cap) : "No cap set — this run can spend without limit."}
        </Text>
        {canEstimate ? (
          estimating ? (
            <Text variant="meta" tone="muted">
              Estimating cost…
            </Text>
          ) : estimateError ? (
            <Text variant="meta" tone="muted">
              {estimateError}
            </Text>
          ) : estimate ? (
            <Text variant="meta" tone="muted" className="tabular-nums">
              ≈ {formatEstimateRange(estimate.tokens.low, estimate.tokens.high)} tokens
              {estimate.environmentCount > estimate.unpricedEnvironmentCount
                ? ` · ${formatCostUsd(estimate.costUsd.low)}–${formatCostUsd(estimate.costUsd.high)} (estimate)`
                : ""}
            </Text>
          ) : null
        ) : (
          <Text variant="meta" tone="muted">
            No cost estimate available for a variant suite — each variant may run on a different
            environment.
          </Text>
        )}
      </div>
    </ConfirmDialog>
  );
}

function SuiteRow({
  suite,
  running,
  onRequestRun,
  onOpen,
  onDelete,
}: {
  suite: Suite;
  running: boolean;
  onRequestRun: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { config } = suite;
  // WP 5.1 — a variant suite's matrix axis is its variants (each names its own scenario), not the
  // default scenario set. Fall back to the scenario axis when no variants are defined.
  const variantCount = config.variants?.length ?? 0;
  const axisCount = variantCount > 0 ? variantCount : suite.scenarioIds.length;
  const cells = suite.testIds.length * axisCount * config.repetitions;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text className="min-w-0 truncate font-medium">{suite.name}</Text>
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
          </div>
          <Text variant="meta" tone="muted" className="tabular-nums">
            {config.repetitions}× reps · {config.maxConcurrency} parallel ·{" "}
            {config.aggregateCostCapUsd
              ? `${formatCostUsd(config.aggregateCostCapUsd)} cap`
              : "no cap"}{" "}
            · {cells} cells
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" disabled={running || cells === 0} onClick={onRequestRun}>
            {running ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <PlayCircle aria-hidden />
            )}
            <span>{running ? "Starting…" : "Run"}</span>
          </Button>
          {/* Opens the suite's detail page (design-remediation T8) — where its config/members show
              and the editor opens as an overlay. */}
          <Button variant="outline" size="sm" onClick={onOpen}>
            <span>Open</span>
            <ArrowRight aria-hidden />
          </Button>
          {/* Destructive/primary adjacency (P1) — a visible divider keeps the icon-only trash a
              deliberate reach away from Run/Open, not one pointer-error apart. */}
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          <IconButton variant="ghost" size="sm" label={`Delete ${suite.name}`} onClick={onDelete}>
            <Trash2 aria-hidden />
          </IconButton>
        </div>
      </CardContent>
    </Card>
  );
}
