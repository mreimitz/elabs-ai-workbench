// The ONE place a **magnitude delta** picks its colour (interface-craft WP 2.2, D-IC3 — reaffirming
// the locked D-UX9). A magnitude delta is "a measured number changed" — tokens, cost, latency,
// grade, pass-rate. It is coloured by **outcome**, direction-aware:
//
//   • a rise in a lower-is-better metric (tokens/cost/latency)  → WORSE
//   • a rise in a higher-is-better metric (score/quality/pass)  → BETTER
//   • unchanged / indeterminate                                 → NEUTRAL
//
//   worse   → `text-warning-text` (amber)   — a magnitude *warning*, not a failure
//   better  → `text-success-text` (green)
//   neutral → `text-muted-foreground`
//
// D-IC3 consolidates the app onto the amber-worse tone that Scans already shipped
// (`scanDelta.tsx`) — before this, "worse" was amber on Scans but RED on all five Compare surfaces.
// Every delta surface now derives its tone from here; **no view maps a delta sign → colour inline.**
//
// ── Amber, not red — the reserved-red rule (D-UX9's diff-semantics axis) ────────────────────────────
// `--destructive`/red is reserved for **structural REMOVAL** — a tool/resource/row that no longer
// exists (green = added, red = removed). That is a SEPARATE axis from magnitude and this module does
// NOT touch it: added/removed *items* keep their green-added / red-removed colouring elsewhere. A
// suite cell whose member run ERRORED is likewise a structural failure signal, not a magnitude —
// callers keep that red themselves (see `suite-data.ts`'s `error` tone). Here, a number simply
// getting worse is amber, never red.

/** A magnitude delta's outcome. A tie (or an indeterminate delta) is `neutral` — never a
 *  "better/worse" judgement the data can't support. */
export type DeltaOutcome = "better" | "worse" | "neutral";

/**
 * Classify a signed magnitude delta by outcome, given whether a HIGHER value is better for that
 * metric. `null`/`undefined`/`0`/`NaN` → `neutral` (no judgement on a tie or a missing figure).
 *
 * @param delta          the signed change (new − baseline), or a raw sign; `null` when unavailable.
 * @param higherIsBetter `true` for score/quality/pass-rate; `false` for tokens/cost/latency.
 */
export function deltaOutcome(
  delta: number | null | undefined,
  higherIsBetter: boolean,
): DeltaOutcome {
  if (delta == null || delta === 0 || Number.isNaN(delta)) return "neutral";
  const rose = delta > 0;
  const better = higherIsBetter ? rose : !rose;
  return better ? "better" : "worse";
}

/** THE mapping — outcome → semantic foreground tone token. The single source of truth for every
 *  magnitude-delta text colour in the app. */
export const DELTA_TEXT_TONE: Record<DeltaOutcome, string> = {
  better: "text-success-text",
  worse: "text-warning-text",
  neutral: "text-muted-foreground",
};

/** Outcome → solid fill token (the diverging delta-bars). Same three outcomes, the fill variant. */
export const DELTA_BAR_TONE: Record<DeltaOutcome, string> = {
  better: "bg-success",
  worse: "bg-warning",
  neutral: "bg-muted-foreground",
};

/** Outcome → alpha cell-wash (the suite grid's green/amber cells; the washes are AA-checked upstream). */
export const DELTA_CELL_WASH: Record<DeltaOutcome, string> = {
  better: "bg-success/10 hover:bg-success/20",
  worse: "bg-warning/10 hover:bg-warning/20",
  neutral: "bg-muted/40 hover:bg-muted/60",
};

/** Outcome → `@elabs-ai/components-ui` `Badge` variant (the pinned net-delta summary chip). */
export const DELTA_BADGE_VARIANT: Record<DeltaOutcome, "success" | "warning" | "secondary"> = {
  better: "success",
  worse: "warning",
  neutral: "secondary",
};

/** Classify + map to the foreground tone token in one call (the common case). */
export function deltaTextTone(delta: number | null | undefined, higherIsBetter: boolean): string {
  return DELTA_TEXT_TONE[deltaOutcome(delta, higherIsBetter)];
}
