import { useCallback, useEffect, useMemo, useState } from "react";
import type { SuiteRunMember, SuiteRunStatus } from "@mcp-token-footprint/shared";
import { getSuiteRunMembers } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";

/**
 * Fetch a suite run's MEMBER runs (`GET /api/suite-runs/:id/members`) — one {@link SuiteRunMember} per
 * executed test × scenario × repetition, each a persisted child run enriched with its primary-grader
 * `score`. Unlike the live-only per-cell SSE stream, this reads persisted state, so it materialises
 * IDENTICALLY for a live and a FINISHED suite run — it's what lets the console show what actually
 * executed (and seed the matrix) after the stream is gone.
 *
 * Mirrors {@link import("./use-suite-analytics").useSuiteAnalytics}'s discipline: re-fetches on the
 * suite-run id AND on the run `status` transition (so a finishing run pulls its settled members once),
 * plus an explicit `reload`; a failure is kept as `error` so the caller separates "loading" from
 * "failed", and an empty member list is legitimate (a run that recorded nothing) — not an error.
 * `scoreById` is the single map both the matrix seed and the Runs-tab Grade cell read.
 */
export function useSuiteMembers(
  suiteRunId: string,
  status: SuiteRunStatus | null,
): {
  members: SuiteRunMember[];
  scoreById: Map<string, number | null>;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [members, setMembers] = useState<SuiteRunMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    getSuiteRunMembers(suiteRunId)
      .then((result) => {
        if (!cancelled) setMembers(result);
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
    // `status` re-pulls the members as the run settles; `nonce` drives explicit retry.
  }, [suiteRunId, status, nonce]);

  const scoreById = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const member of members) map.set(member.id, member.score);
    return map;
  }, [members]);

  return { members, scoreById, loading, error, reload };
}
