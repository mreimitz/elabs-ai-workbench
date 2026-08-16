import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Text,
  cn,
} from "@brand/ui";
import { ChevronRight, MessageSquare } from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { formatClock, formatCostUsd, formatDuration, formatNumber } from "../../lib/format";
import { stepTypeMeta } from "./StepLog";
import { TraceLeafDetail } from "./TraceLeafDetail";
import { consoleAnchor, type ConsoleNavRef } from "./console-anchors";
import type { TraceKpi, TraceNode as TraceNodeData } from "./trace-tree";

/** One fixed lane width (must match the leaf-detail indent below). */
const LANE_PX = 20;

/**
 * One row of the Trace timeline, recursive. The git-branch look is a PURE-CSS rail (no measurement,
 * no SVG): a fixed-width lane column per ancestor depth (a centered `bg-border` hairline that
 * continues only while that ancestor has a following sibling), plus the node's own connector cell —
 * an up segment, a down segment (when this node has a next sibling), a horizontal elbow, and a
 * status-tinted node dot. A `turn` row additionally draws a top rule, reading as the run's
 * "date separator".
 *
 * Expand/collapse is a controlled `@brand/ui` `Collapsible`; clicking a row ONLY toggles it — the
 * Trace tab deliberately does NOT drive the shared `selectedStepId`, so it never pops the right-side
 * inspector Sheet. The per-leaf detail (args/result/response/…) is reached via its **Expand** button,
 * which opens a modal carrying the same inspector panel (`TraceLeafDetail`).
 */
export function TraceNode({
  node,
  depth,
  isFirst,
  isLast,
  ancestorHasNext,
  onShowInChat,
}: {
  node: TraceNodeData;
  depth: number;
  isFirst: boolean;
  isLast: boolean;
  ancestorHasNext: boolean[];
  /** WP 3.2 — reveal the Chat tab at this row's turn/tool (cross-representation link). */
  onShowInChat?: (ref: ConsoleNavRef) => void;
}) {
  const [open, setOpen] = useState(node.defaultOpen);
  const navRef = node.navRef;
  const expandable = node.children.length > 0 || node.detail !== undefined;
  const isTurnSeparator = node.kind === "turn" && !isFirst;
  const Icon = node.stepType ? stepTypeMeta(node.stepType).Icon : null;

  const rail = (
    <div className="flex shrink-0" aria-hidden>
      {ancestorHasNext.map((cont, i) => (
        <span key={i} className="relative w-5 self-stretch">
          {cont ? (
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
          ) : null}
        </span>
      ))}
      <span className="relative w-5 self-stretch">
        {/* up segment (suppressed only at the very first root, which has nothing above it) */}
        {depth === 0 && isFirst ? null : (
          <span className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-border" />
        )}
        {/* down segment continues the spine to the next sibling */}
        {!isLast ? (
          <span className="absolute bottom-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-border" />
        ) : null}
        {/* horizontal elbow into the content */}
        <span className="absolute left-1/2 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        {/* node dot */}
        <span
          className={cn(
            "absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
            node.status === "error"
              ? "bg-destructive"
              : node.kind === "turn"
                ? "bg-primary"
                : node.kind === "leaf"
                  ? "bg-border"
                  : "bg-muted-foreground",
          )}
        />
      </span>
    </div>
  );

  const row = (
    <div
      className={cn(
        "group/trace flex items-stretch",
        isTurnSeparator && "mt-1 border-t border-border pt-1",
      )}
      {...(node.anchorValue ? consoleAnchor(node.anchorValue) : {})}
    >
      {rail}
      <RowBody node={node} expandable={expandable} open={open} Icon={Icon} />
      {/* WP 3.2 — cross-link back to this turn/tool in the chat (keyboard-reachable, reveal on hover). */}
      {navRef && onShowInChat ? (
        <IconButton
          variant="ghost"
          size="icon"
          className="ml-1 size-6 shrink-0 self-center opacity-0 transition-opacity group-hover/trace:opacity-100 focus-visible:opacity-100"
          label="Show in chat"
          onClick={() => onShowInChat(navRef)}
        >
          <MessageSquare aria-hidden className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );

  if (!expandable) return row;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {row}
      <CollapsibleContent>
        {node.children.length > 0 ? (
          node.children.map((child, i) => (
            <TraceNode
              key={child.id}
              node={child}
              depth={depth + 1}
              isFirst={i === 0}
              isLast={i === node.children.length - 1}
              ancestorHasNext={[...ancestorHasNext, !isLast]}
              {...(onShowInChat ? { onShowInChat } : {})}
            />
          ))
        ) : node.detail !== undefined ? (
          <div style={{ paddingLeft: (depth + 1) * LANE_PX + 8 }} className="py-1 pr-2">
            <TraceLeafDetail
              value={node.detail}
              language={node.detailLanguage ?? "json"}
              ariaLabel={node.detailLabel ?? node.title}
              isError={node.detailError ?? false}
              {...(node.detailLabel ? { label: node.detailLabel } : {})}
              {...(node.detailStepId ? { detailStepId: node.detailStepId } : {})}
            />
          </div>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The clickable row body: chevron + icon + title + subtitle + right-aligned KPI chips. */
function RowBody({
  node,
  expandable,
  open,
  Icon,
}: {
  node: TraceNodeData;
  expandable: boolean;
  open: boolean;
  Icon: ComponentType<LucideProps> | null;
}) {
  const iconTone = node.status === "error" ? "text-destructive" : "text-muted-foreground";
  const rowClass =
    "h-auto min-w-0 flex-1 justify-start gap-2 rounded-md py-1 pr-2 pl-1 text-left font-normal";

  const content: ReactNode = (
    <>
      {expandable ? (
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden />
      )}
      {Icon ? <Icon className={cn("size-3.5 shrink-0", iconTone)} aria-hidden /> : null}
      <Text
        as="span"
        variant={node.kind === "leaf" ? "meta" : "code"}
        className={cn(
          "min-w-0 shrink truncate",
          node.kind === "turn"
            ? "font-semibold text-foreground"
            : node.kind === "leaf"
              ? "text-muted-foreground"
              : "font-medium",
        )}
        title={node.title}
      >
        {node.title}
      </Text>
      {node.subtitle ? (
        <Text
          as="span"
          variant="meta"
          tone="muted"
          className="min-w-0 shrink truncate"
          title={node.subtitle}
        >
          {node.subtitle}
        </Text>
      ) : null}
      <KpiChips kpi={node.kpi} className="ml-auto shrink-0 pl-2" />
    </>
  );

  if (expandable) {
    return (
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className={rowClass}>
          {content}
        </Button>
      </CollapsibleTrigger>
    );
  }
  return <div className={cn("flex items-center", rowClass)}>{content}</div>;
}

/** Right-aligned chips: tokens (↑/↓ or single) · duration · cost (when present) · timestamp. */
function KpiChips({ kpi, className }: { kpi: TraceKpi; className?: string }) {
  const hasAny =
    Boolean(kpi.timestamp) ||
    Boolean(kpi.tokensIn) ||
    Boolean(kpi.tokensOut) ||
    Boolean(kpi.tokens) ||
    kpi.durationMs !== undefined ||
    kpi.costUsd !== undefined;
  if (!hasAny) return null;
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      {kpi.tokensIn ? (
        <Badge variant="secondary" className="font-normal tabular-nums">
          {formatNumber(kpi.tokensIn)}↑
        </Badge>
      ) : null}
      {kpi.tokensOut ? (
        <Badge variant="secondary" className="font-normal tabular-nums">
          {formatNumber(kpi.tokensOut)}↓
        </Badge>
      ) : null}
      {!kpi.tokensIn && !kpi.tokensOut && kpi.tokens ? (
        <Badge variant="secondary" className="font-normal tabular-nums">
          {formatNumber(kpi.tokens)} tok
        </Badge>
      ) : null}
      {kpi.durationMs !== undefined ? (
        <Text as="span" variant="meta" tone="muted" className="tabular-nums">
          {formatDuration(kpi.durationMs)}
        </Text>
      ) : null}
      {kpi.costUsd !== undefined ? (
        <Badge variant="outline" className="font-normal tabular-nums">
          {formatCostUsd(kpi.costUsd, { precision: 4 })}
        </Badge>
      ) : null}
      {kpi.timestamp ? (
        <Text as="span" variant="meta" tone="muted" className="tabular-nums">
          {formatClock(kpi.timestamp)}
        </Text>
      ) : null}
    </span>
  );
}
