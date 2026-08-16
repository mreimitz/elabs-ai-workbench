import { Badge, Button, Popover, PopoverContent, PopoverTrigger, Text, cn } from "@brand/ui";
import {
  AlertTriangle,
  Brain,
  Check,
  GitCompareArrows,
  Layers,
  MessageSquare,
  ShieldAlert,
  Wrench,
  X,
} from "lucide-react";
import type { CellDiff, FlowNode, FlowNodeKind } from "./flow-types";

/** D-UX9 diff colours → the cell's left rail. Neutral for unchanged; none for a gap. */
const DIFF_RAIL: Record<CellDiff, string> = {
  unchanged: "border-l-border",
  added: "border-l-success",
  removed: "border-l-destructive",
  changed: "border-l-warning",
  gap: "border-l-transparent",
};

const DIFF_TINT: Record<CellDiff, string> = {
  unchanged: "bg-card",
  added: "bg-success/10",
  removed: "bg-destructive/10",
  changed: "bg-warning/10",
  gap: "bg-transparent",
};

/** Cost-heat backgrounds (0–4), used only under the Cost lens. */
const HEAT_BG = [
  "bg-card",
  "bg-warning/10",
  "bg-warning/20",
  "bg-warning/30",
  "bg-warning/40",
] as const;

const KIND_ICON = {
  preamble: Layers,
  reasoning: Brain,
  tool: Wrench,
  answer: MessageSquare,
  guardrail: ShieldAlert,
  error: AlertTriangle,
} as const;

/**
 * Kinds whose {@link FlowNode.subtitle} carries real signal (a one-line reasoning/answer preview, the
 * skills-loaded summary, an error/guardrail reason) — these keep a second line (F6). `tool`'s subtitle
 * is just its server id, IDENTICAL across every tool card in a trace, so it's the "repeated opaque id"
 * F6 calls out — it moves to the card's `title` tooltip instead of taking a permanent second line.
 */
const SECOND_LINE_KIND: Record<FlowNodeKind, boolean> = {
  preamble: true,
  reasoning: true,
  tool: false,
  answer: true,
  guardrail: true,
  error: true,
};

/** One aligned cell: an event block for a lane's {@link FlowNode}, or a tinted "not run" gap. */
export function LaneCell({
  node,
  diff,
  columnId,
  letter,
  focused,
  heat = 0,
  costLens = false,
  skillsLens = false,
  changedPeers,
  onFocus,
}: {
  node: FlowNode | null;
  diff: CellDiff;
  columnId: string;
  letter: string;
  focused: boolean;
  heat?: 0 | 1 | 2 | 3 | 4;
  costLens?: boolean;
  skillsLens?: boolean;
  /** The peer cells (letter + node) sharing this column — powers the changed-outcome popover. */
  changedPeers?: Array<{ letter: string; node: FlowNode }>;
  onFocus: (token: string | null) => void;
}) {
  if (!node) {
    // A gap — the other run(s) have a step here; render a faint dashed "not run" placeholder.
    return (
      <div
        className={cn(
          "flex min-h-[2.75rem] items-center rounded-md border border-dashed border-border/60 px-2",
          diff === "removed"
            ? "bg-destructive/5"
            : diff === "added"
              ? "bg-success/5"
              : "bg-muted/20",
        )}
      >
        <Text variant="caption" tone="muted" className="italic">
          not run
        </Text>
      </div>
    );
  }

  const Icon = KIND_ICON[node.kind];
  const isSkill = node.isSkillDisclosure === true;
  const bg = costLens && heat > 0 ? HEAT_BG[heat] : DIFF_TINT[diff];
  const showSubtitleInline = Boolean(node.subtitle) && SECOND_LINE_KIND[node.kind];
  const hasBadges =
    hasTokens(node) ||
    typeof node.durationMs === "number" ||
    (diff === "changed" && changedPeers && changedPeers.length > 1);

  return (
    <div
      data-col-id={columnId}
      data-letter={letter}
      title={node.subtitle && !showSubtitleInline ? node.subtitle : undefined}
      className={cn(
        "relative flex min-h-[2.75rem] min-w-0 flex-col justify-center gap-0.5 rounded-md border border-l-4 px-2 py-1.5 cursor-pointer",
        DIFF_RAIL[diff],
        bg,
        "border-border",
        focused ? "ring-2 ring-ring" : "hover:ring-1 hover:ring-ring/60",
        skillsLens && !isSkill && "opacity-40",
        skillsLens && isSkill && "ring-1 ring-primary",
      )}
    >
      {/*
       * F4 — the WHOLE card is the focus target, not just the title strip. Stretched-overlay pattern:
       * a real `Button` absolutely covers the card (z-0) so any click/tap/keyboard-Enter on the card
       * toggles focus; `ChangedResultPopover` + the token/duration badges below sit in a `relative
       * z-10` wrapper so they stay independently clickable ON TOP of the overlay — a `<button>` can't
       * nest another `<button>`, so this is a sibling overlay, not a wrapper around the row content.
       */}
      <Button
        variant="ghost"
        onClick={() => onFocus(focused ? null : `${letter}@${columnId}`)}
        aria-pressed={focused}
        aria-label={cellAriaLabel(node)}
        className="absolute inset-0 z-0 h-auto w-auto justify-start rounded-md p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      />
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-caption font-medium",
            node.kind === "tool" && "font-mono",
          )}
        >
          {node.title}
        </span>
        {node.status === "ok" && <Check aria-hidden className="size-3.5 shrink-0 text-success" />}
        {node.status === "error" && (
          <X aria-hidden className="size-3.5 shrink-0 text-destructive" />
        )}
        {hasBadges && (
          <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-end gap-1">
            {hasTokens(node) && (
              <Badge variant="secondary" className="tabular-nums">
                {node.tokens!.toLocaleString()} tok
              </Badge>
            )}
            {typeof node.durationMs === "number" && (
              <Badge variant="outline" className="tabular-nums">
                {formatDuration(node.durationMs)}
              </Badge>
            )}
            {diff === "changed" && changedPeers && changedPeers.length > 1 && (
              <ChangedResultPopover peers={changedPeers} />
            )}
          </div>
        )}
      </div>
      {showSubtitleInline && (
        <Text variant="caption" tone="muted" className="min-w-0 truncate">
          {node.subtitle}
        </Text>
      )}
    </div>
  );
}

function hasTokens(node: FlowNode): boolean {
  return typeof node.tokens === "number" && node.tokens > 0;
}

/** The whole-card overlay button's accessible name (F4) — names the step + its outcome. */
function cellAriaLabel(node: FlowNode): string {
  const statusSuffix =
    node.status === "error" ? ", failed" : node.status === "ok" ? ", succeeded" : "";
  return `${node.title}${statusSuffix} — view step detail`;
}

/** Side-by-side result popover for a same-step-different-outcome column (audit §H4). */
function ChangedResultPopover({ peers }: { peers: Array<{ letter: string; node: FlowNode }> }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 border-warning/50 px-1.5 text-warning"
        >
          <GitCompareArrows aria-hidden className="size-3" />
          Compare results
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[32rem] max-w-[90vw]">
        <div className="flex flex-col gap-3">
          <Text variant="meta" className="font-semibold">
            Same step, different outcome
          </Text>
          <div className="grid grid-cols-2 gap-3">
            {peers.map(({ letter, node }) => (
              <div key={letter} className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">{letter}</span>
                  {node.status === "error" ? (
                    <Badge variant="destructive">Failed</Badge>
                  ) : (
                    <Badge variant="success">Succeeded</Badge>
                  )}
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-caption">
                  {node.resultText ?? "(no result captured)"}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
