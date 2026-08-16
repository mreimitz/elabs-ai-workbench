import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  ProviderCredential,
  Scenario,
  Suite,
  SuiteRun,
  Test,
} from "@mcp-token-footprint/shared";
import { Button, ErrorState, Spinner } from "@brand/ui";
import { getSuite, getSuiteRun, listProviders, listScenarios, listTests } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { SuiteRunConsole } from "./SuiteRunConsole";

/**
 * Route wrapper for the suite-run console (`/testing/suite-runs/:suiteRunId`) — the analogue of
 * `../RunConsoleRoute`. Loads the persisted suite run, then its suite (for the matrix axes + config)
 * and the test/scenario lists (for name resolution), and hands them to {@link SuiteRunConsole}, which
 * owns the live SSE stream. Remounting on refresh re-runs this load, so a refresh mid-run reattaches
 * (the backend replays its buffered events on connect, then resumes live).
 */
/**
 * The suite-shaped shell a suite-less plan run (collection/adhoc, D-T5) renders under: the run's own
 * frozen `configSnapshot` + a source-derived display name. Empty membership is correct — the console's
 * `axisRefs` builds the matrix axes from the run's cells.
 */
function planRunSuiteShell(suiteRun: SuiteRun): Suite {
  return {
    id: "",
    name: suiteRun.source === "collection" ? "Collection run" : "Interactive session",
    config: suiteRun.configSnapshot,
    testIds: [],
    scenarioIds: [],
    createdAt: suiteRun.startedAt,
    updatedAt: suiteRun.startedAt,
  };
}

export function SuiteRunConsoleRoute() {
  const params = useParams();
  const navigate = useNavigate();
  const suiteRunId = params.suiteRunId ?? null;

  const [data, setData] = useState<{
    suiteRun: SuiteRun;
    suite: Suite;
    tests: Test[];
    scenarios: Scenario[];
    providers: ProviderCredential[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!suiteRunId) return;
    let active = true;
    setError(null);
    setData(null);
    (async () => {
      const suiteRun = await getSuiteRun(suiteRunId);
      // Qlik Answers (WP 3.2) — `providers` resolves each member scenario's provider KIND, so the
      // console can roll up a questions-consumed total for `qlik_answers` members (see
      // `SuiteRunConsole`'s derivation). A lightweight, already-redacted list — same call
      // `RunConsoleRoute` makes for the single-run console's "est." labels.
      // Testing IA (D-T5) — a collection/adhoc plan run has NO owning suite (`suiteId` undefined).
      // Synthesize a suite-shaped shell from the run's frozen config instead of hard-failing on
      // `GET /api/suites/<nothing>`: the console derives its matrix axes from the streamed/persisted
      // cells anyway (`axisRefs` merges membership with cells), so empty id lists render fine.
      const [suite, tests, scenarios, providers] = await Promise.all([
        suiteRun.suiteId !== undefined
          ? getSuite(suiteRun.suiteId)
          : Promise.resolve(planRunSuiteShell(suiteRun)),
        listTests(),
        listScenarios(),
        listProviders(),
      ]);
      if (active) setData({ suiteRun, suite, tests, scenarios, providers });
    })().catch((cause: unknown) => {
      if (active) setError(getErrorMessage(cause, "Couldn’t load the suite run."));
    });
    return () => {
      active = false;
    };
  }, [suiteRunId]);

  const onBack = useCallback(() => navigate("/testing/suites"), [navigate]);
  const onOpenRun = useCallback((runId: string) => navigate(`/testing/runs/${runId}`), [navigate]);

  if (error) {
    return (
      // The route mounts full-bleed (like the run console), so this error frame pads itself.
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
        <ErrorState
          title="Couldn’t open the suite run."
          description={error}
          actions={
            <Button variant="outline" onClick={onBack}>
              Back to suites
            </Button>
          }
        />
      </div>
    );
  }

  if (!data || !suiteRunId) {
    return (
      <div className="flex h-full w-full items-center justify-center py-16">
        <Spinner aria-label="Loading suite run…" />
      </div>
    );
  }

  return (
    <SuiteRunConsole
      // Key on the id so navigating between two suite-run consoles remounts fresh (its stream is keyed
      // on the id inside the hook, but remounting also resets seeded state cleanly).
      key={suiteRunId}
      suiteRunId={suiteRunId}
      suite={data.suite}
      suiteRun={data.suiteRun}
      tests={data.tests}
      scenarios={data.scenarios}
      providers={data.providers}
      onBack={onBack}
      onOpenRun={onOpenRun}
    />
  );
}
