// Shared display metadata for the compatibility heatmap (WP 5.4). Maps the engine's closed
// vocabularies (band / verdict / severity) onto @brand/ui variants + token-backed utility classes.
// All colour comes from SEMANTIC tokens (success/warning/destructive) — no raw colour literals.

import type { CSSProperties } from "react";
import type {
  CompatibilityBand,
  CompatibilitySeverity,
  CompatibilityVerdict,
  StatusKey,
} from "@mcp-token-footprint/shared";
import { Check, Slash, TriangleAlert, X, type LucideIcon } from "lucide-react";

type BadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "warning"
  | "destructive"
  | "info";

export type BandMeta = {
  /** DECODED meaning, never a colour name — the legend explains what the band means, not its hue. */
  label: string;
  /** Lower-case fragment for a control's accessible name ("within limits", "not tested", …). */
  srLabel: string;
  /** Cell fill (layout/surface only, token-backed). */
  cell: string;
  /** Legend swatch/dot fill. */
  dot: string;
  /** A per-band mark so meaning survives colour-blindness + greyscale — colour is never the only cue. */
  glyph: LucideIcon;
  /** `true` → overlay the diagonal {@link HATCH_STYLE} (the "no evidence" texture). */
  hatch?: boolean;
};

/**
 * A heatmap cell's fill + glyph, token-backed. `green`/`amber`/`red` are POSITIVE evidence (a
 * scored cell): a SOFT tint (`bg-<state>/N`) paired with the matching on-TINT text token
 * (`text-<state>-text`, tuned per theme so score + "N issues" clear AA in both). `untested` is the
 * ABSENCE of evidence — it deliberately shares NO token with a passing cell: a NEUTRAL `muted`
 * surface + a diagonal hatch + a slash glyph, so a gap in coverage can never be mistaken for a
 * faint pass. Labels are the band's MEANING (decoded), never its colour name.
 */
export const BAND_META: Record<CompatibilityBand, BandMeta> = {
  green: {
    label: "Within limits",
    srLabel: "within limits",
    cell: "bg-success/15 text-success-text",
    dot: "bg-success",
    glyph: Check,
  },
  amber: {
    label: "Near limits",
    srLabel: "near limits",
    cell: "bg-warning/20 text-warning-text",
    dot: "bg-warning",
    glyph: TriangleAlert,
  },
  red: {
    label: "Below floor",
    srLabel: "below floor",
    cell: "bg-destructive/15 text-destructive-text",
    dot: "bg-destructive",
    glyph: X,
  },
  untested: {
    label: "Not tested",
    srLabel: "not tested",
    // Neutral surface — NOT a success tint. The hatch + slash glyph carry the "no evidence" meaning
    // without leaning on colour; the dot is a hollow outline so the legend reads "absent", not "good".
    cell: "bg-muted text-muted-foreground",
    dot: "border border-muted-foreground/60 bg-transparent",
    glyph: Slash,
    hatch: true,
  },
};

/**
 * The diagonal-hatch texture for an `untested` cell — token-driven (uses the `--muted-foreground`
 * colour via CSS var, never a raw literal), applied as a low-opacity overlay so "not tested" reads
 * as a distinct texture rather than a flat tint a viewer could mistake for a faint pass. Decoration
 * only. Reads in both themes (muted-foreground is a mid grey in qlik-bright, a light grey in qlik-dark).
 */
export const HATCH_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent 0, transparent 5px, var(--muted-foreground) 5px, var(--muted-foreground) 6px)",
};

/**
 * Legend tooltip copy (CP4). Bands are scored against EACH model's own practical limits, so the same
 * 0–100 score can be amber for one model and red for another — the legend has to say the thresholds
 * are model-relative or the colours look arbitrary.
 */
export const BAND_TOOLTIP: Record<CompatibilityBand, string> = {
  green: "Comfortably within this model's practical limits.",
  amber: "Approaching this model's practical limits — review before you rely on it.",
  red: "Below this model's practical floor — this pairing is likely to break.",
  untested: "No applicable check scored this pairing — a gap in coverage, not a clean result.",
};

/** A verdict's Badge variant + label (`na` = not-applicable to this model). */
export const VERDICT_META: Record<CompatibilityVerdict, { label: string; variant: BadgeVariant }> =
  {
    pass: { label: "Pass", variant: "success" },
    warn: { label: "Warn", variant: "warning" },
    fail: { label: "Fail", variant: "destructive" },
    na: { label: "N/A", variant: "secondary" },
  };

/** A severity's Badge variant + label. `na` shares the neutral secondary chip. */
export const SEVERITY_META: Record<
  CompatibilitySeverity | "na",
  { label: string; variant: BadgeVariant }
> = {
  blocker: { label: "Blocker", variant: "destructive" },
  high: { label: "High", variant: "warning" },
  // NOT `info`/blue — S3 reserves blue for "Running". A severity ramp reads
  // blocker (red) → high (amber) → medium (neutral-filled) → low (neutral-outline),
  // so Medium is a filled `secondary` chip: clearly a severity, never mistaken for a live state.
  medium: { label: "Medium", variant: "secondary" },
  low: { label: "Low", variant: "outline" },
  na: { label: "N/A", variant: "secondary" },
};

/**
 * The ONE chip vocabulary every per-model outcome cell, per-test count, and legend share (findings
 * by severity, then pass, then n/a) — the single source that used to be re-declared verbatim in
 * CompatibilityTests and reportRender. Title-case so a legend always matches what it labels.
 */
export const OUTCOME_META: Record<StatusKey, { label: string; variant: BadgeVariant }> = {
  pass: { label: "Pass", variant: "success" },
  blocker: SEVERITY_META.blocker,
  high: SEVERITY_META.high,
  medium: SEVERITY_META.medium,
  low: SEVERITY_META.low,
  na: { label: "N/A", variant: "secondary" },
};

/**
 * Token-backed swatch colour per outcome for a PASSIVE legend (SV9): a quiet dot + muted label that
 * reads as an explanatory key, never as a filter button. Mirrors OUTCOME_META's tones — success,
 * destructive, warning for the coloured outcomes; neutral muted-foreground for medium/low/na (which
 * the label disambiguates), with `low` hollow to echo its outline chip.
 */
export const OUTCOME_DOT: Record<StatusKey, string> = {
  pass: "bg-success",
  blocker: "bg-destructive",
  high: "bg-warning",
  medium: "bg-muted-foreground",
  low: "border border-muted-foreground/70 bg-transparent",
  na: "bg-muted-foreground/40",
};

/** Confidence chip variant for an evidence value — the "verified vs estimated" signal. */
export const CONFIDENCE_META: Record<string, { label: string; variant: BadgeVariant }> = {
  high: { label: "Verified", variant: "success" },
  medium: { label: "Likely", variant: "info" },
  low: { label: "Estimated", variant: "warning" },
  "n/a": { label: "Unverified", variant: "secondary" },
};

// Host-client targets + the manual-review concern list + `clientLabel` are plain display data (no
// @brand/ui coupling) and now live in @mcp-token-footprint/shared so the API's Markdown report can
// reuse them. Re-exported here so existing `../compatibility/meta` imports are unchanged.
export { CLIENT_OPTIONS, MANUAL_REVIEW_CONCERNS, clientLabel } from "@mcp-token-footprint/shared";
