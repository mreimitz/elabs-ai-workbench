import { cn } from "@elabs-ai/components-ui";

/**
 * The workspace's run-identity token: a circular badge carrying a run's letter (Ⓐ/Ⓑ/Ⓒ …), ringed
 * and lettered in that run's series colour (`--chart-N`). This is the ONLY run identity in the
 * Compare Workspace (T9g) — reused by the compare bar, the verdict band, and every mode/chart so a
 * run reads as one colour + one letter everywhere. The baseline gets a filled variant so "what every
 * Δ is measured against" is legible at a glance.
 */
export function RunLetterBadge({
  letter,
  color,
  baseline = false,
  size = "sm",
  className,
}: {
  letter: string;
  /** The run's series colour token, e.g. `var(--chart-1)`. */
  color: string;
  baseline?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      // Colour is per-run identity data, not decoration, so it comes through inline `style` from the
      // `--chart-N` token (never a raw literal). Text/border take the same token; the card background
      // keeps the letter readable in both themes.
      style={
        baseline ? { backgroundColor: color, borderColor: color } : { color, borderColor: color }
      }
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-2 font-semibold tabular-nums",
        baseline ? "text-background" : "bg-card",
        size === "md" ? "size-6 text-meta" : "size-5 text-caption",
        className,
      )}
    >
      {letter}
    </span>
  );
}
