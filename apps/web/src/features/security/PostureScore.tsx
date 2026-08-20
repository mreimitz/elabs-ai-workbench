import type { SecurityScore, SecurityScoreBand } from "@mcp-token-footprint/shared";
import { Text, cn } from "@elabs-ai/components-ui";
import { StatusBadge } from "../../components/StatusBadge";
import type { StatusTone, StatusView } from "../../lib/status";

/**
 * PostureScore — the ONE rendering of a posture score + its band.
 * =============================================================================================
 * Used by the scan Security tab, the skill Security tab and the servers-rail badge alike, so a
 * score can never read one way in a list and another way in the tab it drills into.
 *
 * **The band is the API's, never re-derived here (D-SP3).** `computeSecurityScore` is the only
 * function permitted to turn findings into a number and a number into a band; this file maps that
 * band onto the app's existing status vocabulary and stops. If you ever find yourself writing
 * `value >= 90` in this file, that is the bug — the thresholds live in the contract, and a UI that
 * re-types them is a UI that eventually disagrees with the gate.
 *
 * The tone mapping reuses `lib/status.ts`'s buckets so both themes are already correct and no chip
 * carries a colour of its own (`.claude/rules/styling-and-tokens.md`).
 */

/** band → the app's status tone. `clean` reads green, `high` reads like a hard failure. */
const BAND_TONE: Record<SecurityScoreBand, StatusTone> = {
  clean: "success",
  low: "info",
  medium: "warning",
  high: "danger",
};

/** band → the words an operator scans. Sentence case, no jargon, no severity inflation. */
const BAND_LABEL: Record<SecurityScoreBand, string> = {
  clean: "Clean",
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

export function postureBandLabel(band: SecurityScoreBand): string {
  return BAND_LABEL[band];
}

/** The band as a {@link StatusView}, so it renders through the app's ONE chip component. */
export function postureBandView(band: SecurityScoreBand): StatusView {
  return {
    kind: "chip",
    label: BAND_LABEL[band],
    tone: BAND_TONE[band],
    spinner: false,
    dashed: false,
  };
}

export type PostureScoreProps = {
  score: SecurityScore;
  /**
   * `full` — the number, then the band chip (the tabs' KPI treatment).
   * `chip` — the band chip alone, with the score in its accessible name (the rail's dense rows,
   * where a bare number beside a token count would read as a second token count).
   */
  variant?: "full" | "chip";
  /** Layout-only classes. */
  className?: string;
};

export function PostureScore({ score, variant = "full", className }: PostureScoreProps) {
  const label = BAND_LABEL[score.band];
  if (variant === "chip") {
    return (
      <span
        className={cn("inline-flex shrink-0", className)}
        // The number is the detail, the band is the headline — but a screen reader gets both, so a
        // non-sighted operator is never told less than a sighted one.
        role="img"
        aria-label={`Security posture ${label}, score ${score.value} of 100`}
      >
        <StatusBadge view={postureBandView(score.band)} />
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <Text
        className="font-semibold tabular-nums"
        aria-label={`Posture score ${score.value} of 100`}
      >
        {score.value}
      </Text>
      <StatusBadge view={postureBandView(score.band)} />
    </span>
  );
}
