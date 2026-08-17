import type { TraceVerdictStatus } from "@mcp-token-footprint/shared";
import type { LegendItem } from "@elabs-ai/components-flow";

/**
 * Shared verdict → { label, badge variant, legend color } mapping for the Trace tab (WP 2.3) — the
 * single place the canvas legend, the summary strip, and the evidence pane read from, so the three
 * surfaces can never drift. Colors are SEMANTIC TOKEN references only (the same tokens the
 * `@elabs-ai/components-flow` `FlowNode` tones resolve to); never raw literals.
 */
export type TraceVerdictMeta = {
  label: string;
  /** `@elabs-ai/components-ui` `Badge` variant for the summary strip / evidence header. */
  badgeVariant: "success" | "destructive" | "outline";
  /** Legend swatch — a token reference, never a raw color literal. */
  color: string;
};

export const TRACE_VERDICT_META: Record<TraceVerdictStatus, TraceVerdictMeta> = {
  ok: {
    label: "Executed as designed",
    badgeVariant: "success",
    color: "var(--success)",
  },
  fracture: {
    label: "Fracture",
    badgeVariant: "destructive",
    color: "var(--destructive)",
  },
  unvisited: {
    label: "Not visited",
    badgeVariant: "outline",
    color: "var(--muted-foreground)",
  },
};

/** The three verdict rows appended to the node-kind legend on the Trace canvas. */
export const TRACE_VERDICT_LEGEND_ITEMS: LegendItem[] = (
  Object.keys(TRACE_VERDICT_META) as TraceVerdictStatus[]
).map((status) => ({
  label: TRACE_VERDICT_META[status].label,
  color: TRACE_VERDICT_META[status].color,
}));
