import { useCallback, useEffect, useState } from "react";
import type { SuiteAnalytics, SuiteRunStatus } from "@mcp-token-footprint/shared";
import { getSuiteAnalytics } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";

/**
 * Fetch a suite run's DERIVED analytics (`GET /api/suite-runs/:id/analytics`) — the quality×cost scatter
 * + metadata breakdowns. Re-fetches when the suite run id changes, when the selected `grader` (score
 * dimension) changes, and when the run `status` transitions (so a finishing run pulls the settled
 * analytics once grading lands), plus an explicit `reload`. Mirrors `useRunReport`'s discipline: a
 * failure is kept as `error` so the caller distinguishes "loading" from "failed", and analytics are
 * legitimately empty (`{scatter:[],breakdowns:[]}`) while a run is early / ungraded — that is not an error.
 *
 * `grader` is the empty string for the DEFAULT primary-grader priority, else a specific grader id.
 */
export function useSuiteAnalytics(
  suiteRunId: string,
  grader: string,
  status: SuiteRunStatus | null,
): {
  analytics: SuiteAnalytics | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [analytics, setAnalytics] = useState<SuiteAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    getSuiteAnalytics(suiteRunId, grader || undefined)
      .then((result) => {
        if (!cancelled) setAnalytics(result);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `status` re-pulls the analytics as the run settles; `nonce` drives explicit retry.
  }, [suiteRunId, grader, status, nonce]);

  return { analytics, loading, error, reload };
}
