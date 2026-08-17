import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  SessionTrace,
  SkillGraph,
  SkillSuggestion,
  TraceEvent,
  TraceVerdict,
} from "@mcp-token-footprint/shared";
import {
  Badge,
  Button,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Text,
} from "@elabs-ai/components-ui";
import type { LegendItem } from "@elabs-ai/components-flow";
import { Legend } from "@elabs-ai/components-flow";
import {
  Bot,
  ChevronDown,
  CornerDownLeft,
  ExternalLink,
  FileText,
  Flag,
  MessageSquare,
  SquareTerminal,
  User,
  Wrench,
} from "lucide-react";
import { SuggestionCard } from "./SuggestionCard";
import { buildEventNodeIndex } from "./trace-link";
import { TRACE_VERDICT_META } from "./trace-verdict-meta";

export type TraceEvidencePaneProps = {
  /** The source run's id, for the "Run console" deep link. */
  runId: string;
  trace: SessionTrace;
  graph: SkillGraph;
  /** The canvas selection — when set, the pane filters to that node's verdict evidence. */
  selectedNodeId: string | undefined;
  /**
   * WP 5.2 — the feedback loop's deterministic suggestions for THIS trace, fetched once per trace
   * load. `null` while still loading/not yet fetched (never renders a broken empty section);
   * `undefined` when the caller hasn't wired suggestions in at all (same as `null`, an even softer
   * "not available" signal so this prop can be genuinely optional).
   */
  suggestions?: SkillSuggestion[] | null;
  /** Opens the review-and-apply flow for a suggestion. Omitted suggestions render advisory-only. */
  onApplySuggestion?: (suggestion: SkillSuggestion) => void;
  /**
   * WP 7.6 (SI6) — the trace legend, DOCKED inside this panel as a collapsible section (it used to
   * float in the toolbar row, inflating it into the audit's 242px void). Omitted ⇒ no legend section.
   */
  legendItems?: LegendItem[];
  /**
   * WP 7.6 — evidence→canvas linking: called with the node whose verdict cites a clicked event
   * (the canvas centers that node). Omitted ⇒ event rows stay non-interactive.
   */
  onFocusNode?: (nodeId: string) => void;
};

/** Icon + short primary text + optional status/detail per normalized trace-event type. */
function eventView(event: TraceEvent): {
  icon: React.ReactNode;
  primary: string;
  mono?: boolean;
  clamp?: boolean;
  badge?: { label: string; variant: "success" | "destructive" | "outline" };
} {
  switch (event.type) {
    case "turn":
      return {
        icon: <MessageSquare aria-hidden />,
        primary: event.payload.text?.trim() || "(assistant turn)",
        clamp: true,
      };
    case "user_message":
      return {
        icon: <User aria-hidden />,
        primary: event.payload.text.trim() || "(user message)",
        clamp: true,
      };
    case "tool_call":
      return { icon: <Wrench aria-hidden />, primary: event.payload.tool, mono: true };
    case "tool_result": {
      const status = event.payload.status;
      return {
        icon: <CornerDownLeft aria-hidden />,
        primary: event.payload.tool ?? "(tool result)",
        mono: true,
        badge:
          status === "error"
            ? { label: "error", variant: "destructive" }
            : status
              ? { label: status, variant: "outline" }
              : undefined,
      };
    }
    case "skill_file_read":
      return { icon: <FileText aria-hidden />, primary: event.payload.path, mono: true };
    case "script_result":
      return {
        icon: <SquareTerminal aria-hidden />,
        primary: event.payload.script ?? "(script result)",
        mono: true,
        badge:
          event.payload.exitCode === 0
            ? { label: "exit 0", variant: "success" }
            : { label: `exit ${event.payload.exitCode}`, variant: "destructive" },
      };
    case "subagent_spawn":
      return {
        icon: <Bot aria-hidden />,
        primary: event.payload.label ?? "(subagent)",
        clamp: true,
      };
    case "marker":
      return { icon: <Flag aria-hidden />, primary: event.payload.raw, mono: true, clamp: true };
    default:
      return { icon: <MessageSquare aria-hidden />, primary: "(event)" };
  }
}

/**
 * One compact trace-event row: type icon, `#idx`, the primary text (clamped), an optional badge.
 * With `onFocus` (WP 7.6 — the event is cited by a node's verdict) the row is a ghost-button that
 * centers that node on the canvas (the same row-button idiom as `TurnIndex`); without it the row
 * stays a plain list item.
 */
function EventRow({
  event,
  highlighted,
  onFocus,
}: {
  event: TraceEvent;
  highlighted: boolean;
  onFocus?: () => void;
}) {
  const view = eventView(event);
  const content = (
    <>
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-3.5">{view.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <Text variant="meta" tone="muted" as="span" className="shrink-0 tabular-nums">
            #{event.idx}
          </Text>
          {view.badge ? (
            <Badge variant={view.badge.variant} className="shrink-0 font-normal tabular-nums">
              {view.badge.label}
            </Badge>
          ) : null}
        </span>
        <Text
          variant={view.mono ? "code" : "body"}
          as="span"
          className={cn("block min-w-0 break-words", view.clamp ? "line-clamp-2" : "truncate")}
        >
          {view.primary}
        </Text>
      </span>
    </>
  );
  if (onFocus) {
    return (
      <li
        data-event-idx={event.idx}
        data-highlighted={highlighted || undefined}
        className={cn(
          "min-w-0 rounded-md border border-transparent",
          highlighted && "border-border bg-accent",
        )}
      >
        <Button
          variant="ghost"
          onClick={onFocus}
          title="Show this event’s node on the canvas"
          data-testid={`trace-event-focus-${event.idx}`}
          className="h-auto w-full items-start justify-start gap-2 whitespace-normal rounded-md px-2 py-1.5 text-left font-normal"
        >
          {content}
        </Button>
      </li>
    );
  }
  return (
    <li
      data-event-idx={event.idx}
      data-highlighted={highlighted || undefined}
      className={cn(
        "flex min-w-0 items-start gap-2 rounded-md border border-transparent px-2 py-1.5",
        highlighted && "border-border bg-accent",
      )}
    >
      {content}
    </li>
  );
}

/**
 * The Trace tab's side pane (WP 2.3): the run's normalized trace events rendered compactly (icon
 * per event type, clamped turn text, status badges on tool/script results), a link out to the full
 * run console route, and honest coverage — a collapsible "Unmatched events (N)" section listing the
 * events the aligner could attribute to no design element. Selecting a node on the canvas filters
 * the list to that verdict's `evidence` events (highlighted, scrolled into view) with the verdict's
 * status + full reason above them.
 */
export function TraceEvidencePane({
  runId,
  trace,
  graph,
  selectedNodeId,
  suggestions,
  onApplySuggestion,
  legendItems,
  onFocusNode,
}: TraceEvidencePaneProps) {
  const [unmatchedOpen, setUnmatchedOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId),
    [graph.nodes, selectedNodeId],
  );
  const selectedVerdict: TraceVerdict | undefined = useMemo(
    () =>
      selectedNodeId
        ? trace.alignment.verdicts.find((verdict) => verdict.nodeId === selectedNodeId)
        : undefined,
    [trace.alignment.verdicts, selectedNodeId],
  );

  const evidenceIdxs = useMemo(() => new Set(selectedVerdict?.evidence ?? []), [selectedVerdict]);

  // Filter to the verdict's evidence when a node is selected; the full stream otherwise.
  const visibleEvents = useMemo(() => {
    if (!selectedVerdict || evidenceIdxs.size === 0) return trace.events;
    return trace.events.filter((event) => evidenceIdxs.has(event.idx));
  }, [trace.events, selectedVerdict, evidenceIdxs]);

  const unmatched = useMemo(() => {
    const idxs = new Set(trace.alignment.unmatchedEvents);
    return trace.events.filter((event) => idxs.has(event.idx));
  }, [trace.events, trace.alignment.unmatchedEvents]);

  // Scroll the first evidence event into view when the selection changes.
  useEffect(() => {
    if (!selectedVerdict || evidenceIdxs.size === 0) return;
    const first = listRef.current?.querySelector("[data-highlighted]");
    first?.scrollIntoView({ block: "nearest" });
  }, [selectedVerdict, evidenceIdxs]);

  const verdictMeta = selectedVerdict ? TRACE_VERDICT_META[selectedVerdict.status] : undefined;

  // WP 5.2 — this selected node's suggestions (if any were computed for this trace). `undefined`
  // while still loading (or not wired in at all) renders nothing rather than a false "no suggestions".
  const nodeSuggestions = useMemo(
    () =>
      selectedNodeId
        ? (suggestions ?? []).filter((s) => s.verdictRef.nodeId === selectedNodeId)
        : [],
    [suggestions, selectedNodeId],
  );

  // WP 7.6 — which node (if any) each event deep-links to on the canvas. Only meaningful when the
  // caller wired `onFocusNode`; the map itself is cheap either way.
  const eventNodeIndex = useMemo(
    () => buildEventNodeIndex(trace.alignment.verdicts),
    [trace.alignment.verdicts],
  );
  const focusHandlerFor = (idx: number): (() => void) | undefined => {
    if (!onFocusNode) return undefined;
    const nodeId = eventNodeIndex.get(idx);
    return nodeId ? () => onFocusNode(nodeId) : undefined;
  };

  return (
    <div className="flex h-full flex-col gap-3" data-testid="trace-evidence-pane">
      <div className="flex items-center justify-between gap-2">
        <Text variant="caption" tone="muted">
          {trace.events.length} event{trace.events.length === 1 ? "" : "s"}
        </Text>
        <Button asChild variant="outline" size="sm">
          <Link to={`/testing/runs/${runId}`}>
            <ExternalLink aria-hidden /> Run console
          </Link>
        </Button>
      </div>

      {/* WP 7.6 (SI6/K4) — the trace legend DOCKED inside the Evidence panel: a compact collapsible
          directly under the header, never floated over the canvas and never inflating the toolbar. */}
      {legendItems && legendItems.length > 0 ? (
        <Collapsible
          open={legendOpen}
          onOpenChange={setLegendOpen}
          className="border-b border-border pb-2"
          data-testid="trace-legend"
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between"
              data-testid="trace-legend-toggle"
            >
              <span>Trace legend</span>
              <ChevronDown
                aria-hidden
                className={cn("size-4 transition-transform", legendOpen && "rotate-180")}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Legend items={legendItems} className="mt-1 w-full" />
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {selectedNode && selectedVerdict && verdictMeta ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/50 p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={verdictMeta.badgeVariant}>{verdictMeta.label}</Badge>
            <Text as="span" className="min-w-0 truncate font-medium">
              {selectedNode.label}
            </Text>
          </div>
          <Text variant="meta" tone="muted" className="break-words">
            {selectedVerdict.reason}
          </Text>
          {evidenceIdxs.size === 0 ? (
            <Text variant="meta" tone="muted">
              No cited evidence events — showing the full stream.
            </Text>
          ) : (
            <Text variant="meta" tone="muted">
              Showing {evidenceIdxs.size} evidence event{evidenceIdxs.size === 1 ? "" : "s"}.
            </Text>
          )}
        </div>
      ) : selectedNodeId ? (
        <Text variant="meta" tone="muted">
          No verdict for the selected node — showing the full stream.
        </Text>
      ) : null}

      {selectedNodeId && suggestions === null ? (
        <Text variant="meta" tone="muted">
          Checking for suggestions…
        </Text>
      ) : nodeSuggestions.length > 0 ? (
        <div className="flex flex-col gap-2" data-testid="suggestion-list">
          {nodeSuggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              graph={graph}
              onApply={onApplySuggestion}
            />
          ))}
        </div>
      ) : null}

      {visibleEvents.length === 0 ? (
        <Text variant="meta" tone="muted">
          No trace events.
        </Text>
      ) : (
        <ul ref={listRef} className="flex flex-col gap-0.5" data-testid="trace-event-list">
          {visibleEvents.map((event) => (
            <EventRow
              key={event.idx}
              event={event}
              highlighted={evidenceIdxs.has(event.idx)}
              onFocus={focusHandlerFor(event.idx)}
            />
          ))}
        </ul>
      )}

      <Collapsible
        open={unmatchedOpen}
        onOpenChange={setUnmatchedOpen}
        className="border-t border-border pt-2"
      >
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between"
            data-testid="unmatched-toggle"
          >
            <span>Unmatched events ({unmatched.length})</span>
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform", unmatchedOpen && "rotate-180")}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {unmatched.length === 0 ? (
            <Text variant="meta" tone="muted" className="px-2 py-1.5">
              Every event was attributed to a design element.
            </Text>
          ) : (
            <ul className="flex flex-col gap-0.5 pt-1" data-testid="unmatched-event-list">
              {unmatched.map((event) => (
                <EventRow key={event.idx} event={event} highlighted={false} />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
