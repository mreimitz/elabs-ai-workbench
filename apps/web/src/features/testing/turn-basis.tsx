// RM-34 WP 1.3 (D-ET5) — say where the estimate's turn model came from.
//
// The run-plan preview has always rendered a band with nothing to judge it by: a band built from 51
// of this exact environment-and-test's own completed runs and a band built from three frozen
// constants painted IDENTICALLY. That invisibility is what let an 8-turn ceiling survive unnoticed
// until a live call was made against a 19-turn run. This module turns the wire's
// `RunPlanTurnProfile` (RM-34 WP 1.1) into one honest line for the three surfaces that read a
// `RunPlanEstimate` — the launcher, the suite run-confirm, and the fork dialog.

import { Text } from "@elabs-ai/components-ui";
import type {
  RunPlanEstimate,
  RunPlanEstimateEnvironment,
  RunPlanTurnBasis,
  RunPlanTurnProfile,
} from "@mcp-token-footprint/shared";
import { formatNumber } from "../../lib/format";

/**
 * How weak a basis is. `default` is weakest (nothing was measured), `pair` strongest (this exact
 * test on this exact environment). Higher wins the plan-wide verdict.
 */
const BASIS_WEAKNESS: Record<RunPlanTurnBasis, number> = {
  pair: 0,
  environment: 1,
  global: 2,
  default: 3,
};

/**
 * The one profile that speaks for a whole plan.
 *
 * A plan spans several environments, each with its own basis, and its band is a SUM — so one
 * unmeasured environment makes the total partly assumed. The weakest basis present therefore wins
 * (`default` > `global` > `environment` > `pair`), tie-broken by the smallest sample, so the line
 * always describes the least evidence behind the number rather than the most. This is the same
 * "one unknown makes the total unknown" rule RM-33 applied to suite cache rollups — not a second
 * convention.
 *
 * Returns `null` — claim nothing — when there is nothing to characterise:
 *   - no environments on the response, or
 *   - ANY environment missing `turnProfile`. Absent means "this response predates the measurement"
 *     (RM-34 WP 1.1's contract), never "measured nothing" — a profile that measured nothing still
 *     says so, as `basis: "default"`. So a partly-annotated response cannot be summarised honestly,
 *     and a pre-WP-1.2 response (where every environment is absent) renders exactly as it does
 *     today.
 */
export function weakestTurnProfile(
  estimate: Pick<RunPlanEstimate, "environments"> | null | undefined,
): RunPlanTurnProfile | null {
  const environments: RunPlanEstimateEnvironment[] = estimate?.environments ?? [];
  if (environments.length === 0) return null;

  let weakest: RunPlanTurnProfile | null = null;
  for (const environment of environments) {
    const profile = environment.turnProfile;
    if (!profile) return null;
    if (
      weakest === null ||
      BASIS_WEAKNESS[profile.basis] > BASIS_WEAKNESS[weakest.basis] ||
      (BASIS_WEAKNESS[profile.basis] === BASIS_WEAKNESS[weakest.basis] &&
        profile.sampleSize < weakest.sampleSize)
    ) {
      weakest = profile;
    }
  }
  return weakest;
}

/**
 * The basis in operator language, split around the sample count so the count can carry
 * `tabular-nums`. `default` has no count to give — it is the honest label on the number the app has
 * been showing all along.
 */
function basisSentence(profile: RunPlanTurnProfile): { before: string; after: string } | null {
  switch (profile.basis) {
    case "pair":
      return { before: "Turn count from ", after: " past runs of this test on this environment." };
    case "environment":
      return { before: "Turn count from ", after: " past runs on this environment." };
    case "global":
      return { before: "Turn count from ", after: " past runs across all environments." };
    case "default":
      return null;
  }
}

/**
 * One static meta line beneath an estimate's band, saying where its turn model came from. Renders
 * `null` when the response carries no profile to describe (see {@link weakestTurnProfile}) — and no
 * tab stop, no tooltip, no icon when it does: it is a sentence, not a control.
 */
export function TurnBasisNote({
  estimate,
  className,
}: {
  estimate: Pick<RunPlanEstimate, "environments"> | null | undefined;
  className?: string;
}) {
  const profile = weakestTurnProfile(estimate);
  if (!profile) return null;

  const sentence = basisSentence(profile);
  return (
    <Text variant="meta" tone="muted" className={className}>
      {sentence === null ? (
        "Turn count is an assumption — no past runs to measure."
      ) : (
        <>
          {sentence.before}
          <span className="tabular-nums">{formatNumber(profile.sampleSize)}</span>
          {sentence.after}
        </>
      )}
    </Text>
  );
}
