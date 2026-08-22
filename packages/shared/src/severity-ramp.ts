// The ONE severity ramp for ranked findings (RM-37 WP 0.5, action 8).
// ==================================================================================================
// Before this file, four features each declared their own severity → chip map, and they disagreed:
// Advisor rendered "High" as a red `destructive` chip, Issues rendered "High" as a red `destructive`
// chip, Compatibility rendered "High" as an amber `warning` chip beneath a red "Blocker". So the
// same word carried two different weights on two pages of the same app, and an operator comparing
// them had no way to know which one meant more.
//
// **What this module owns: the TONE. What it does not own: the words.**
//
// The four steps below are the ranking — how loud a finding is allowed to be — and every ranked
// finding surface maps its own wire enum onto one of them. Most features also take the labels from
// here (`Critical / High / Medium / Low`); Compatibility deliberately does not, because a model
// limit is better named by the limit ("Exceeds limit") than by an adjective. It still takes its
// TONES from here, which is the invariant that matters: a chip's colour means the same thing on
// every page.
//
// **Deliberately NOT governed by this ramp:** the two DETERMINISTIC analyzers — skill quality
// (`quality-meta.ts`) and security posture (`PostureScore.tsx`/`FindingSeverityBadge.tsx`) — which
// keep `Error / Warning / Info`. Those are not rankings of how bad something is; they are statements
// about what kind of thing was found, and collapsing them into this ramp would claim a comparability
// the two analyzers do not have.
//
// Nothing here imports React or a component library. The variant names are the `@elabs-ai/components-ui`
// `Badge` variants, as plain strings, so the API's markdown renderers can read the same table.

/** Worst-first. The order IS the ranking; nothing else in the app may re-order it. */
export const SEVERITY_RAMP_STEPS = ["critical", "high", "medium", "low"] as const;

export type SeverityRampStep = (typeof SEVERITY_RAMP_STEPS)[number];

/**
 * The four chip treatments, and there is no fifth.
 *
 * `destructive` (red filled) → `warning` (amber) → `secondary` (neutral filled) → `outline`. Note
 * that `secondary` is a FILLED neutral rather than blue: blue is reserved app-wide for "Running", so
 * a Medium chip must never be mistakable for a live state.
 */
export type SeverityRampTone = "destructive" | "warning" | "secondary" | "outline";

/**
 * The one table. A feature reads a tone from here; it never writes a colour of its own.
 *
 * **`critical` is deliberately scarce.** It is the only red on the ramp, and today exactly one wire
 * value reaches it — Compatibility's `blocker`, which means a measured limit is exceeded. Advisor
 * and Issues top out at `high`/amber on purpose: both are heuristic rankings over the app's own
 * measurements, and painting a heuristic red is the severity inflation this work package exists to
 * remove.
 */
export const SEVERITY_RAMP: Record<
  SeverityRampStep,
  { readonly label: string; readonly variant: SeverityRampTone }
> = {
  critical: { label: "Critical", variant: "destructive" },
  high: { label: "High", variant: "warning" },
  medium: { label: "Medium", variant: "secondary" },
  low: { label: "Low", variant: "outline" },
};

/** The tone for a ramp step. The ONLY sanctioned way a ranked-finding chip picks its colour. */
export function severityRampTone(step: SeverityRampStep): SeverityRampTone {
  return SEVERITY_RAMP[step].variant;
}

/** The canonical word for a ramp step. Compatibility overrides these; Advisor and Issues do not. */
export function severityRampLabel(step: SeverityRampStep): string {
  return SEVERITY_RAMP[step].label;
}

/** Worst-first sort weight (`critical` = 4 … `low` = 1), for a list that has to rank mixed findings. */
export function severityRampRank(step: SeverityRampStep): number {
  return SEVERITY_RAMP_STEPS.length - SEVERITY_RAMP_STEPS.indexOf(step);
}
