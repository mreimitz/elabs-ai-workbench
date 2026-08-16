// Assistant Hub (WP2.6, R-GUI4) — the bounded, machine-hinted repair loop for GenUI emission.
//
// When a `present`/`prompt_user` spec fails validation, the model is fed back the TYPED errors as repair
// HINTS ("Fix these errors: …") and asked to re-emit — at most `maxAttempts` times (default
// `HUB_GENUI_MAX_REPAIR_ATTEMPTS` = 2). On exhaustion the tool returns a recovery envelope (rendered as an
// honest recovery card) and the model is told to fall back to plain markdown — never an infinite loop.
//
// The tracker is per-turn (a fresh one per `createGenuiTools` call). A successful emission RESETS the
// counter (a later, unrelated widget gets its own full repair budget); consecutive failures accumulate.

import {
  HUB_GENUI_COMPONENT_IDS,
  type GenuiValidationError,
} from "@mcp-token-footprint/shared";

/** A bounded counter of consecutive failed GenUI emissions within one turn (R-GUI4). */
export class GenuiRepairTracker {
  private failures = 0;

  constructor(private readonly maxAttempts: number) {}

  /** Record a failed emission. Returns whether the repair budget is now exhausted (fall back to markdown). */
  recordFailure(): { exhausted: boolean; attempt: number } {
    this.failures += 1;
    return { exhausted: this.failures > this.maxAttempts, attempt: this.failures };
  }

  /** A successful emission clears the streak — the next widget starts with a full budget. */
  recordSuccess(): void {
    this.failures = 0;
  }
}

/**
 * Format validation errors into the model-facing repair instruction (R-GUI4). Leads with the imperative
 * "Fix these errors:", lists each typed error with its path, and — when a component/child was unknown —
 * reminds the model of the available component ids. Kept compact (one line per error).
 */
export function formatRepairHints(errors: GenuiValidationError[]): string {
  const lines = errors.slice(0, 12).map((e) => `- ${e.path}: ${e.message}`);
  const sawUnknownComponent = errors.some(
    (e) => e.code === "unknown_component" || e.code === "child_not_allowed",
  );
  const parts = ["Fix these errors and re-emit the `present` call ONCE:", ...lines];
  if (sawUnknownComponent) {
    parts.push(`Available components: ${HUB_GENUI_COMPONENT_IDS.join(", ")}.`);
  }
  parts.push("If it still fails, stop calling `present` and answer in plain markdown instead.");
  return parts.join("\n");
}

/** The model-visible message on repair-budget exhaustion (R-GUI4) — a clean instruction to stop, not an
 *  error (so the model continues gracefully in markdown rather than treating it as a tool crash). */
export function exhaustionModelMessage(attempts: number): string {
  return `The UI could not be rendered after ${attempts} attempts. Do not call \`present\` again for this; answer in plain markdown.`;
}
