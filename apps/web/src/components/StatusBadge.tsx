import type { ReactNode } from "react";
import { Badge, Text, cn } from "@brand/ui";
import { Loader2 } from "lucide-react";
import {
  type CountTone,
  type StatusTone,
  type StatusView,
  countChipTone,
  deriveStatusView,
} from "../lib/status";

// The ONE status chip for the whole app (audit §S3). Every state chip — scan success/failed, run
// completed/aborted/stopped_guardrail, tool-call complete, trace ok — renders through here so one
// concept has one rendering. The wire-value → {label, tone} decision lives in `lib/status.ts`
// (conventions §3, copied exactly); this file only turns a tone into `@brand/tokens` utilities so
// both themes read correctly.
//
// Built by composing the `@brand/ui` `Badge` pill (geometry + typography) and layering semantic tone
// tokens — the same way `@brand/ui`'s own `StatusBadge` composes Badge internally. We do NOT use
// `@brand`'s closed 7-state `StatusBadge` enum directly because this app's vocabulary needs states it
// doesn't express (gray-outline `aborted`, amber-outline `stopped_guardrail`, dashed `pending`).
//
// D-TB11 (audit D-3): density is a `quiet` PROP, not an inline exception. A dense list (e.g. the
// Dashboard's recent-scan-activity table) wants a *success* row to read as quiet muted text — "what
// needs me", not an all-green wall of chips — while every other tone still needs the tone-filled chip
// even in that same dense list. `quiet` renders exactly that: success goes text-only, everything else
// renders unchanged. This keeps the "every state chip renders through here" claim true — a caller
// never reaches for a raw `<Text>` status exception again.

/** tone → semantic-token classes. `-text` foregrounds + alpha washes are AA-checked in both themes. */
const TONE_CLASS: Record<StatusTone, string> = {
  // green outline (calm success wash — mirrors @brand StatusBadge `complete`)
  success: "border-success/40 bg-success/10 text-success-text",
  // red FILLED — real failure grabs the eye (mirrors @brand `failed`)
  danger: "border-transparent bg-destructive text-destructive-foreground",
  // amber outline
  warning: "border-warning/50 bg-warning/10 text-warning-text",
  // blue outline (pairs with the spinner)
  info: "border-info/40 bg-info/10 text-info-text",
  // gray outline
  neutral: "border-border bg-transparent text-muted-foreground",
  // gray dashed (the "not run yet" affordance) — border set by the `dashed` flag below
  pending: "bg-transparent text-muted-foreground",
};

/** count tone → classes. Zero collapses to `neutral` upstream (`countChipTone`). */
const COUNT_TONE_CLASS: Record<CountTone, string> = {
  success: "border-success/40 bg-success/10 text-success-text",
  danger: "border-destructive/40 bg-destructive/10 text-destructive-text",
  warning: "border-warning/50 bg-warning/10 text-warning-text",
  info: "border-info/40 bg-info/10 text-info-text",
  neutral: "border-border bg-transparent text-muted-foreground",
};

export type StatusBadgeProps = {
  /**
   * Raw wire value (scan/run status or outcome), mapped through {@link deriveStatusView}. Unknown/
   * malformed values render safely, never crash. Ignored when {@link StatusBadgeProps.view} is given.
   */
  status?: string | null | undefined;
  /**
   * Unified Sessions (WP3.1) — a PRECOMPUTED view, for a caller that already ran its own richer
   * derivation (e.g. `lib/status.ts` `deriveRunStatusView`, which needs more than one raw string to
   * pick a run/session's label+tone). Takes precedence over `status` when both are given — this stays
   * the ONE rendering component either way, so no surface ever hand-rolls a chip's tone classes.
   */
  view?: StatusView;
  /**
   * Density variant (D-TB11 / audit D-3): when the resolved view is a **success** chip, render it as
   * quiet muted text (D4's dense-list look) instead of the tone-filled pill. Every other tone still
   * renders as its normal chip even when `quiet` is set — only success goes quiet, so a failure/
   * warning/pending row never loses its chip in a dense list. No effect on `kind: "none"` (already text).
   */
  quiet?: boolean;
  /** Override the mapped label (rare — the mapping already sentence-cases). */
  children?: ReactNode;
  className?: string;
};

/**
 * Render any status wire value (or a precomputed {@link StatusView}) as its canonical chip. `N/A` (and
 * null/empty) renders as plain muted text with NO chip, per the vocabulary table. Pass `quiet` to also
 * render a **success** chip as muted text (D-TB11) — for a dense list where an all-green wall of chips
 * is decoration, not signal.
 */
export function StatusBadge({
  status,
  view: viewOverride,
  quiet,
  children,
  className,
}: StatusBadgeProps) {
  const view = viewOverride ?? deriveStatusView(status);

  if (view.kind === "none" || (quiet && view.kind === "chip" && view.tone === "success")) {
    return (
      <Text variant="meta" tone="muted" className={cn("tabular-nums", className)}>
        {children ?? view.label}
      </Text>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn("gap-1", TONE_CLASS[view.tone], view.dashed && "border-dashed", className)}
      data-status={view.tone}
    >
      {view.spinner ? (
        <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
      ) : null}
      {children ?? view.label}
    </Badge>
  );
}

export type CountBadgeProps = {
  /** The count. `0` always renders neutral (never red/green), regardless of `tone`. */
  value: number;
  /** Tone for a NON-zero count (e.g. `danger` for failures, `success` for passes). */
  tone?: CountTone;
  /** Override the rendered content (defaults to the value). */
  children?: ReactNode;
  className?: string;
};

/**
 * A value-aware count chip (conventions §3: "a zero renders neutral, never red/green"). Use it for the
 * "N failures" / "N passed" / "N fractures" chips the audit flagged as alarming at zero.
 */
export function CountBadge({ value, tone = "neutral", children, className }: CountBadgeProps) {
  const effective = countChipTone(value, tone);
  return (
    <Badge
      variant="outline"
      className={cn("tabular-nums", COUNT_TONE_CLASS[effective], className)}
      data-count-tone={effective}
    >
      {children ?? value}
    </Badge>
  );
}
