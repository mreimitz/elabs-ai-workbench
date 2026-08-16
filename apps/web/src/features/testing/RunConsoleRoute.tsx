import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  ProviderCredential,
  ProviderKind,
  RunForkRef,
  RunMode,
  RunStatus,
  RunStep,
  Scenario,
  SessionAssistantIdentity,
  SessionCapabilities,
  Test,
} from "@mcp-token-footprint/shared";
import { supportsMidRunFork } from "@mcp-token-footprint/shared";
import { Button, ErrorState, Spinner } from "@brand/ui";
import { GitFork } from "lucide-react";
import { getRun, listProviders, listScenarios, listTests } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { isTerminalRunStatus } from "../../lib/status";
import { useRouteCrumb } from "../../components/route-crumb";
import { RunConsole, type RunConsoleTarget } from "./RunConsole";
import { ForkDialog } from "./ForkDialog";
import { LineageBanner } from "./LineageBanner";

// ── Unified Sessions WP 3.2 (D-US4) — the credential-derived capability FALLBACK ────────────────────
// This is the ONE place left in the console that still consults `providerKind`/credential kind: (a)
// the pre-run surface, which has no run row at all yet, and (b) a pre-contract run whose persisted
// `capabilities_json` is absent (it predates this workstream). A client mirror of the API's
// `apps/api/src/testing/session-capabilities.ts` (which the web app cannot import — the runtime
// boundary forbids `web -> api` source imports); kept in sync by hand since both sides are additive
// and rarely change. Every OTHER surface in the console (`RunConsole`, `KpiRail`, `ConversationPane`,
// `QuestionPrompt`) takes the resolved `SessionCapabilities` as a plain, required prop and never
// looks at `providerKind` again.

const ENGINE_CAPABILITIES: SessionCapabilities = {
  liveText: true,
  liveReasoning: "raw",
  toolCalls: true,
  contextWindow: true,
  tokens: "exact",
  costBasis: "api_exact",
  followUps: true,
  askUser: true,
};

const SUBSCRIPTION_CAPABILITIES: SessionCapabilities = {
  liveText: true,
  liveReasoning: "none",
  toolCalls: true,
  contextWindow: false,
  tokens: "exact",
  costBasis: "subscription_reference",
  followUps: true,
  askUser: false,
};

const QLIK_ANSWERS_CAPABILITIES: SessionCapabilities = {
  liveText: true,
  liveReasoning: "structured",
  toolCalls: false,
  contextWindow: false,
  tokens: "estimated",
  costBasis: "questions",
  followUps: true,
  askUser: false,
};

/**
 * The scenario-derived identity a `qlik_answers` fallback carries even before any run has started
 * (mirrors what the console already showed pre-WP3.2: the environment's configured assistant + the
 * transport override). A REAL run's persisted `capabilities.identity` supersedes this once it exists
 * (the executor fills in `name`/`description`/`version`/`appId` as it resolves them) — this is only
 * the best-effort placeholder for "no run yet" / "pre-contract run".
 */
function fallbackIdentity(scenario: Scenario): SessionAssistantIdentity {
  return {
    kind: "qlik_assistant",
    assistantId: scenario.model,
    ...(scenario.answersMode?.transport ? { transport: scenario.answersMode.transport } : {}),
  };
}

/** The credential-derived capability manifest for a scenario, when no persisted one is available. */
function fallbackCapabilities(
  kind: ProviderKind | undefined,
  scenario: Scenario,
): SessionCapabilities {
  if (kind === "qlik_answers") {
    return { ...QLIK_ANSWERS_CAPABILITIES, identity: fallbackIdentity(scenario) };
  }
  if (kind === "claude_subscription") return SUBSCRIPTION_CAPABILITIES;
  // Unknown (providers not loaded yet) or one of the five chat-completions kinds.
  return ENGINE_CAPABILITIES;
}

/**
 * Route wrapper for the Run console (item 2). Two shapes:
 * - `/testing/runs/new?testId=…&scenarioId=…` — the pre-run config surface. Starting a run
 *   navigates (replace) to `/testing/runs/:runId` so Back returns to the runs list.
 * - `/testing/runs/:runId` — load the run by id, resolve its test/scenario/provider, then stream
 *   (live) or replay (terminal). On mount this re-reads the run, so a refresh mid-run reattaches:
 *   the backend replays the full event log on connect and the SSE stream picks up live events.
 *
 * The console needs the resolved `Test` + `Scenario` objects (not just ids), so this fetches the
 * test/scenario/provider lists once and joins by id — the same resolution `RunsView` used to do.
 */
export function RunConsoleRoute() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const runId = params.runId ?? null;
  const isNew = runId === null; // the `/testing/runs/new` route has no :runId param
  // A-2 (toolbar-reach WP0.2) — distinguish the param-LESS new-run URL (⌘K "New run", a bookmark, or
  // the back button landing on `/testing/runs/new` with nothing to launch) from a new-run URL that
  // DOES carry a `testId`+`scenarioId` (the wizard's own navigation, `RunLauncher.tsx`). The param-less
  // case is not a runnable target — it redirects to the runs feed with the real launcher open (see the
  // early `<Navigate>` below) instead of the old "Run unavailable" dead-end. Only a URL that names a
  // test/environment it then cannot resolve is a genuine error (kept as `ErrorState`).
  const isParamlessNew =
    isNew && searchParams.get("testId") === null && searchParams.get("scenarioId") === null;

  const [tests, setTests] = useState<Test[] | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [providers, setProviders] = useState<ProviderCredential[] | null>(null);
  // For an existing run we must resolve which test/scenario it used + whether it is terminal.
  const [run, setRun] = useState<{
    testId: string;
    scenarioId: string;
    mode: RunMode;
    status: RunStatus;
    /** Unified Sessions WP 3.2 — the run's persisted capability manifest, absent on a pre-contract run. */
    capabilities?: SessionCapabilities;
    // Observability WP3.3 (D-OB18) — fork lineage + the parent's steps (the fork-point selector's source).
    derivedFromRunId?: string;
    forkStepId?: string;
    forks?: RunForkRef[];
    steps: RunStep[];
    openerPrompt?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Observability WP3.3 — the "Re-run with changes" / "Fork from here" dialog state.
  const [forkOpen, setForkOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    Promise.all([listTests(), listScenarios(), listProviders()])
      .then(([t, s, p]) => {
        if (!active) return;
        setTests(t);
        setScenarios(s);
        setProviders(p);
      })
      .catch((cause: unknown) => {
        if (active) setError(getErrorMessage(cause, "Couldn’t load the run harness."));
      });
    return () => {
      active = false;
    };
  }, []);

  // Existing run: load its summary (testId/scenarioId/mode/status) once per id. Remounting on a
  // refresh re-runs this — the reattach entry point.
  useEffect(() => {
    if (isNew || !runId) {
      setRun(null);
      return;
    }
    let active = true;
    getRun(runId)
      .then((detail) => {
        if (active) {
          const opener = detail.steps.find((s) => s.type === "user_message");
          const openerText =
            opener && typeof (opener.payload as { text?: unknown } | null)?.text === "string"
              ? (opener.payload as { text: string }).text
              : undefined;
          setRun({
            testId: detail.testId,
            scenarioId: detail.scenarioId,
            mode: detail.mode,
            status: detail.status,
            capabilities: detail.capabilities,
            derivedFromRunId: detail.derivedFromRunId,
            forkStepId: detail.forkStepId,
            forks: detail.forks,
            steps: detail.steps,
            openerPrompt: openerText,
          });
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(getErrorMessage(cause, "Couldn’t load the run."));
      });
    return () => {
      active = false;
    };
  }, [isNew, runId]);

  const providerLabelFor = useCallback(
    (scenario: Scenario): string =>
      (providers ?? []).find((p) => p.id === scenario.providerId)?.label ?? scenario.providerId,
    [providers],
  );
  // Qlik Answers (WP 3.2) — the KPI rail marks token figures "est." (and suppresses the meaningless
  // context metric) by provider KIND, resolved here from the same credential lookup as the label
  // above — never from the run's stripped `estimatedTokens` step-payload flag (see the WP 1.2 gap
  // note: that key doesn't survive persistence).
  const providerKindFor = useCallback(
    (scenario: Scenario): ProviderKind | undefined =>
      (providers ?? []).find((p) => p.id === scenario.providerId)?.kind,
    [providers],
  );

  // WP 4.4 (§H5) — the lossless drill loop's return leg. When this console was opened from the Compare
  // Workspace's step drawer, the whole compare URL rode along as `?returnTo=` (already URL-decoded by
  // `URLSearchParams.get`); it must stay a same-app path (`/testing/…`) so this can only ever return
  // into the workspace, never an arbitrary external URL. Navigating to it restores the exact
  // comparison (mode + focus + the drawer); browser Back is the same restore.
  const returnToRaw = searchParams.get("returnTo");
  const returnTo = returnToRaw && returnToRaw.startsWith("/testing/") ? returnToRaw : null;
  // WP 3.1 (Assistant, D-AS8/D-AS16) — `?turn=<0-based index>`, the run console's first URL-level turn
  // deep link (the assistant's `ui_open_run_turn` tool resolves onto exactly this shape — see
  // `packages/shared/src/assistant-ui-registry.ts`). Malformed/negative values are dropped rather than
  // passed through, so a bad query string degrades to "no anchor" instead of a NaN turnIndex.
  const turnRaw = searchParams.get("turn");
  const initialTurnIndex = (() => {
    if (turnRaw === null) return undefined;
    const parsed = Number(turnRaw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
  })();
  const onBackToCompare = useCallback(() => {
    if (returnTo) navigate(returnTo);
  }, [navigate, returnTo]);
  const onRunStarted = useCallback(
    (newRunId: string) => navigate(`/testing/runs/${newRunId}`, { replace: true }),
    [navigate],
  );

  // Resolve the console target from the URL + loaded lists.
  const resolved = useMemo<
    | { target: RunConsoleTarget; providerLabel: string; capabilities: SessionCapabilities }
    | { pending: true }
    | { missing: string }
  >(() => {
    if (!tests || !scenarios || !providers) return { pending: true };

    if (isNew) {
      const testId = searchParams.get("testId");
      const scenarioId = searchParams.get("scenarioId");
      const test = tests.find((t) => t.id === testId);
      const scenario = scenarios.find((s) => s.id === scenarioId);
      // A-2: the param-less case has already redirected to the launcher (the `<Navigate>` early return
      // below) before this memo's result is ever rendered — so this `missing` now only fires for the
      // GENUINE error: the URL named a `testId`/`scenarioId` that no longer resolves to a real
      // test/environment (a stale/partial deep link).
      if (!test || !scenario)
        return { missing: "The test or environment for this run no longer exists." };
      return {
        target: { kind: "prerun", test, scenario },
        providerLabel: providerLabelFor(scenario),
        // No run row exists yet — always the credential-derived fallback (D-US4).
        capabilities: fallbackCapabilities(providerKindFor(scenario), scenario),
      };
    }

    if (!run) return { pending: true };
    const test = tests.find((t) => t.id === run.testId);
    const scenario = scenarios.find((s) => s.id === run.scenarioId);
    if (!test || !scenario)
      return { missing: "The test or environment this run used no longer exists." };
    const terminal = isTerminalRunStatus(run.status);
    return {
      target: { kind: "run", runId: runId!, test, scenario, mode: run.mode, replay: terminal },
      providerLabel: providerLabelFor(scenario),
      // The persisted manifest wins; a pre-contract run (no `capabilities_json`) falls back (D-US4).
      capabilities: run.capabilities ?? fallbackCapabilities(providerKindFor(scenario), scenario),
    };
  }, [
    tests,
    scenarios,
    providers,
    isNew,
    run,
    runId,
    searchParams,
    providerLabelFor,
    providerKindFor,
  ]);

  // Header redesign 2026-07-11: the run's identity lives in the BREADCRUMB, not the toolbar — the
  // leaf reads "<test> · <model>" once the run resolves (App.tsx falls back to "Run"/"New run"
  // while this is null). The toolbar keeps only status + harness context + the run controls.
  useRouteCrumb(
    "target" in resolved && resolved.target.kind === "run"
      ? `${resolved.target.test.name} · ${resolved.target.scenario.model}`
      : null,
  );

  // A-2 (toolbar-reach WP0.2) — a param-less `/testing/runs/new` is not a runnable target. Redirect to
  // the runs feed with the launcher open (`?launch=1`, consumed by `RunsView`) instead of dead-ending
  // on a "Run unavailable" ErrorState that told the operator to "select a test and environment" with no
  // way to do so. `replace` so this transient URL doesn't linger in history (Back skips it). This is an
  // early return after all hooks so the Rules of Hooks are preserved.
  if (isParamlessNew) {
    return <Navigate to="/testing/runs?launch=1" replace />;
  }

  if (error) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <ErrorState
          title="Couldn’t open the run."
          description={error}
          actions={
            <Button variant="outline" onClick={() => navigate("/testing/runs")}>
              Back to runs
            </Button>
          }
        />
      </div>
    );
  }

  if ("pending" in resolved) {
    return (
      <div className="flex h-full w-full items-center justify-center py-16">
        <Spinner aria-label="Loading run…" />
      </div>
    );
  }

  if ("missing" in resolved) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <ErrorState
          title="Couldn’t open the run."
          description={resolved.missing}
          actions={
            <Button variant="outline" onClick={() => navigate("/testing/runs")}>
              Back to runs
            </Button>
          }
        />
      </div>
    );
  }

  // F7 — key the console by the RESOLVED run id so navigating `/testing/runs/:a` → `/:b` REMOUNTS it
  // fresh instead of reusing the instance (whose internal `runId` state was seeded from `:a` and would
  // keep streaming / stopping / sending against run `a`). The pre-run surface keys on a stable "prerun"
  // sentinel: starting a run there navigates `/new` → `/:runId`, which already tears the pre-run view
  // down via the loading state before the `:runId` console mounts — so the live run is NOT needlessly
  // torn down by this key (it mounts fresh once, reattaching via SSE replay, which is the intended flow).
  const target = resolved.target;
  const consoleKey = target.kind === "run" ? target.runId : "prerun";

  // Observability WP3.3 (D-OB18) — the fork affordance is available for a TERMINAL, non-pre-run run.
  // A-3 (toolbar-reach WP0.2): the "Re-run with changes" launcher no longer sits on its own chrome row
  // above the console (a full-width bordered row holding a single button — exactly what D-TB2 forbids).
  // It is folded into `RunBar`'s action cluster next to Replay/Export (same class of thing), threaded
  // through `RunConsole` → `RunBar` as `reRunAction`. It still opens the `ForkDialog` this route owns
  // (below). Only a terminal run gets it; a live/pre-run console is unchanged. `isForkableRun` is the
  // exact negation of the narrowing guard further down, so the two stay in lockstep.
  const isForkableRun = target.kind === "run" && run !== null && isTerminalRunStatus(run.status);
  const reRunAction = isForkableRun ? (
    <Button variant="outline" size="sm" onClick={() => setForkOpen(true)}>
      <GitFork className="size-4" aria-hidden />
      Re-run with changes
    </Button>
  ) : null;

  const consoleEl = (
    <RunConsole
      key={consoleKey}
      target={target}
      providerLabel={resolved.providerLabel}
      capabilities={resolved.capabilities}
      {...(isNew ? { onRunStarted } : {})}
      {...(returnTo ? { onBackToCompare } : {})}
      {...(initialTurnIndex !== undefined ? { initialTurnIndex } : {})}
      {...(reRunAction ? { reRunAction } : {})}
    />
  );

  // Live/pre-run consoles render exactly as before (no wrapper). The condition below is the negation of
  // `isForkableRun`, and re-narrows `target`/`run` for the terminal block that follows.
  if (target.kind !== "run" || run === null || !isTerminalRunStatus(run.status)) return consoleEl;

  const midRunOk = supportsMidRunFork(resolved.capabilities);
  const forkRunId = target.runId;
  const derivedFromRunId = run.derivedFromRunId;
  // A-3: `LineageBanner` self-collapses to `null` for an ordinary, un-forked run — gate its wrapper on
  // real lineage so no empty bordered row is ever rendered (the banner is CONTENT, its own conditional
  // row; only the lone-button row was the D-TB2 violation, and it is gone).
  const hasLineage = Boolean(derivedFromRunId) || (run.forks?.length ?? 0) > 0;
  const compareWithParent = derivedFromRunId
    ? () =>
        navigate(
          `/testing/runs/compare?ids=${encodeURIComponent(`${derivedFromRunId},${forkRunId}`)}`,
        )
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasLineage ? (
        <div className="shrink-0 border-b border-border px-4 py-2">
          <LineageBanner
            {...(derivedFromRunId ? { derivedFromRunId } : {})}
            {...(run.forkStepId ? { forkStepId: run.forkStepId } : {})}
            {...(run.forks ? { forks: run.forks } : {})}
            {...(compareWithParent ? { onCompareWithParent: compareWithParent } : {})}
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{consoleEl}</div>
      <ForkDialog
        open={forkOpen}
        onOpenChange={setForkOpen}
        runId={forkRunId}
        testId={run.testId}
        scenarioId={run.scenarioId}
        supportsMidRun={midRunOk}
        steps={run.steps}
        {...(run.openerPrompt ? { defaultPrompt: run.openerPrompt } : {})}
        currentModel={target.scenario.model}
        onLaunched={(newRunId) => navigate(`/testing/runs/${newRunId}`, { replace: true })}
      />
    </div>
  );
}
