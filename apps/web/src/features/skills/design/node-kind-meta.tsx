import type { ReactNode } from "react";
import type { SkillGraphNodeKind, ToolDiagnostic } from "@mcp-token-footprint/shared";
import { FileText, GitBranch, Paperclip, Play, RotateCcw, ShieldCheck, Wrench } from "lucide-react";

/**
 * Shared kind → { label, icon, legend color, canvas tone } mapping for the Design tab (WP 1.3) —
 * the single place `SkillDesignView` (canvas nodes + legend) and `NodeDetailPanel` (the kind badge)
 * both read from, so the two views can never drift.
 *
 * Design mode never implies an execution verdict (D4 — this app never runs skill content), so the
 * canvas `tone` is restricted to `"default"`/`"accent"` only: `accent` marks gatekeepers (the
 * decision points worth a second look at a glance), everything else is `"default"`. `success` /
 * `destructive` are reserved for Trace Mode (Phase 2), which reads real run outcomes.
 */
export type NodeKindMeta = {
  label: string;
  icon: ReactNode;
  /** Legend swatch — a token reference (`var(--chart-N)`), never a raw color literal. */
  color: string;
  tone: "default" | "accent";
};

export const NODE_KIND_META: Record<SkillGraphNodeKind, NodeKindMeta> = {
  subroutine: {
    label: "Sub-routine",
    icon: <FileText />,
    color: "var(--chart-1)",
    tone: "default",
  },
  gatekeeper: {
    label: "Gatekeeper",
    icon: <GitBranch />,
    color: "var(--chart-2)",
    tone: "accent",
  },
  asset: {
    label: "Asset",
    icon: <Paperclip />,
    color: "var(--chart-3)",
    tone: "default",
  },
  validation_gate: {
    label: "Validation gate",
    icon: <ShieldCheck />,
    color: "var(--chart-4)",
    tone: "default",
  },
  loop_guard: {
    label: "Loop guard",
    icon: <RotateCcw />,
    color: "var(--chart-5)",
    tone: "default",
  },
  // Skill IDE I1 — an entry point (a /command or keyword) heads a flow. Contract landed in WP 1.1,
  // the projector emits these from WP 1.2, and WP 1.3 gives them distinct canvas styling: a play
  // glyph, `tone="accent"`, and (in `buildFlow`) the trigger value as the node title. The accent
  // tone reads as a "start here" affordance in both themes.
  entry_point: {
    label: "Entry point",
    icon: <Play />,
    color: "var(--chart-2)",
    tone: "accent",
  },
  // Skill IDE WP 8.1 (I9.2) — a text-projected MCP tool reference (accessory leaf). A wrench glyph +
  // a MUTED swatch/tone: until the WP 5.1 validation overlay upgrades it (ok / stale / unknown /
  // unbound), a `tool_ref` node carries no verdict, so it reads as quiet supporting furniture in both
  // themes. `var(--muted-foreground)` is a semantic token (no raw color), like every other swatch.
  tool_ref: {
    label: "Tool reference",
    icon: <Wrench />,
    color: "var(--muted-foreground)",
    tone: "default",
  },
};

/**
 * Skill IDE WP 5.2 — the tool-reference diagnostics (I5) that anchor INSIDE a node's line span. A
 * diagnostic's `anchor.startLine` is a 1-based SKILL.md line; a node "carries" it when that line
 * falls within the node's inclusive `[startLine, endLine]` anchor range (a section owns its heading
 * through the line before the next heading, so any backticked tool reference in that section counts).
 * Diagnostics without an anchor can't be attributed to a node and are skipped here (they still show
 * in the full-file SKILL.md editor). Pure — the single place the canvas badge + the panel issue list
 * agree on which node a diagnostic belongs to (`.length` is the badge count).
 */
export function diagnosticsInRange(
  diagnostics: ToolDiagnostic[],
  startLine: number,
  endLine: number,
): ToolDiagnostic[] {
  return diagnostics.filter((diagnostic) => {
    const line = diagnostic.anchor?.startLine;
    return line !== undefined && line >= startLine && line <= endLine;
  });
}
