import { useMemo, useState } from "react";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import type { RunOutcome, RunStatus, RunStep } from "@mcp-token-footprint/shared";
import { DataTable, FacetFilter, FilterBar, SearchInput } from "@elabs-ai/components-data";
import { Badge, Button, Switch, Text, cn } from "@elabs-ai/components-ui";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Ban,
  BrainCog,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileCog,
  Hammer,
  Info,
  Trash2,
  Wrench,
} from "lucide-react";
import { IconButton } from "../../components/IconButton";
import { col } from "../../lib/table";
import { formatDuration, formatNumber, safeJson } from "../../lib/format";
import { dedupeToolSteps } from "./dedupe-tool-steps";
import { CodeSnippet } from "./CodeSnippet";
import { firstProfileTokens, stepTypeMeta, tokensDown, tokensUp } from "./StepLog";
import type { RunDeltas } from "./use-run-stream";

/**
 * The Inspector's **Console** panel (WP 3.10, UI §3.1) — the live, chronological, human-readable
 * narration of a run: reasoning/output delta one-liners, tool call/result one-liners, context
 * notices, and warnings/errors. This is the DevTools "Console" lens, deliberately distinct from the
 * structured **Network** table (`StepLog`, WP 3.6): Network is the sortable/filterable packet table;
 * Console is the prose stream you watch while it runs.
 *
 * It is **derived state** — there is no separate console event channel. Every row is folded from the
 * SAME `useRunStream` state the rest of the console reads (`stream.steps`, `stream.deltas`,
 * `stream.status`, `stream.error`), so it can never drift from the other panes. Selecting a row that
 * maps to a `RunStep` lifts the SHARED `selectedStepId` (no second selection state), which opens the
 * packet inspector (WP 3.6) and cross-highlights the left tool card (WP 3.4).
 *
 * Smoothness at 50+ events comes from `@elabs-ai/components-data` `DataTable`'s opt-in row virtualization
 * (single-column "log" mode): only the visible window of rows mounts, so a long, rapidly-growing log
 * never mounts hundreds of rows or thrashes layout. There is NO per-row `getBoundingClientRect` /
 * `offsetHeight` measurement anywhere here — the only per-row work is reading already-derived fields.
 *
 * Protocol-frame note: the persisted `RunStep.payload` is a **redacted, structured** object
 * (`{ toolCallId, args }`, `{ toolCallId, result }`, `{ deltas, snapshot }`, …), NOT a raw JSON-RPC
 * envelope — the MCP transport-level `jsonrpc`/`id`/`method` frames are not captured in the run
 * transcript (server redacts to data). So the **Protocol** level surfaces the closest-to-raw thing we
 * DO have (the redacted payload, read-only via `CodeSnippet`) and the panel says so honestly.
 */

/** The DevTools-style severity levels (UI §3.1): `All ▸ Errors ▸ Warnings ▸ Info ▸ Protocol`. */
export type ConsoleLevel = "error" | "warning" | "info" | "protocol";

/** One narrated console row, derived from the run stream. Append-only; never mutated in place. */
type ConsoleEntry = {
  /** Stable key for React + dedupe (step id, or a synthetic id for deltas/status). */
  key: string;
  level: ConsoleLevel;
  /** Short channel label shown as a dimmed prefix (e.g. `tool`, `llm.req`). */
  channel: string;
  Icon: ComponentType<LucideProps>;
  /** The human-readable one-liner. */
  message: string;
  /** Optional trailing meta (tokens / duration / finish reason), `tabular-nums`. */
  meta?: string;
  /** The step this row maps to (drives shared selection); `null` for deltas/status rows. */
  stepId: string | null;
  /** The closest-to-raw payload for the expand/Protocol view (redacted, read-only). */
  raw?: unknown;
};

/** Level → token-driven `Badge` variant (no raw colours — variants carry the severity tokens). */
const LEVEL_BADGE: Record<ConsoleLevel, "destructive" | "warning" | "secondary" | "outline"> = {
  error: "destructive",
  warning: "warning",
  info: "secondary",
  protocol: "outline",
};

const LEVEL_META: Record<ConsoleLevel, { label: string; Icon: ComponentType<LucideProps> }> = {
  error: { label: "Errors", Icon: CircleAlert },
  warning: { label: "Warnings", Icon: AlertTriangle },
  info: { label: "Info", Icon: Info },
  protocol: { label: "Protocol", Icon: FileCog },
};

/** A terminal status that narrates as a final console line (and at which level). */
function terminalLine(
  status: RunStatus,
  outcome: RunOutcome | undefined,
  stopReason: string | undefined,
): { level: ConsoleLevel; message: string } | null {
  switch (status) {
    case "completed":
      return { level: "info", message: "Run completed." };
    case "stopped":
      return {
        level: "warning",
        message:
          outcome === "stopped_guardrail"
            ? `Run stopped by guardrail${stopReason ? ` — ${stopReason}` : "."}`
            : `Run stopped${stopReason ? ` — ${stopReason}` : "."}`,
      };
    case "error":
      return { level: "error", message: `Run failed${stopReason ? ` — ${stopReason}` : "."}` };
    case "aborted":
      return { level: "warning", message: "Run aborted." };
    case "pending":
    case "running":
      return null;
    default:
      return null;
  }
}

/** A compact `→ read_file {path:"…"}` argument preview for a tool-call one-liner. */
function argPreview(payload: unknown): string {
  if (payload == null || typeof payload !== "object") return "";
  const args = (payload as { args?: unknown }).args;
  if (args == null) return "";
  // The args are already redacted server-side; we render TEXT only, clamped so the one-liner stays one
  // line (the full redacted payload is available on expand / in the inspector drawer).
  const json = safeJson(args).replace(/\s+/g, " ").trim();
  return json.length > 80 ? `${json.slice(0, 79)}…` : json;
}

/** Tokens / duration trailer for a step row (provider-actual first, then the estimator lens). */
function stepMeta(step: RunStep): string | undefined {
  const up = tokensUp(step);
  const down = tokensDown(step);
  const parts: string[] = [];
  if (up > 0) parts.push(`${formatNumber(up)}↑`);
  if (down > 0) parts.push(`${formatNumber(down)}↓`);
  if (up === 0 && down === 0) {
    const lens = firstProfileTokens(step);
    if (lens > 0) parts.push(`${formatNumber(lens)} tok`);
  }
  if (step.durationMs !== undefined) {
    parts.push(formatDuration(step.durationMs));
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Narrate ONE `RunStep` into a console entry (level + one-liner + the raw payload for expand). */
function entryForStep(step: RunStep): ConsoleEntry {
  const base = { key: step.id, stepId: step.id, raw: step.payload, meta: stepMeta(step) };
  const isError = step.status === "error";
  switch (step.type) {
    case "tool_call":
      return {
        ...base,
        level: "info",
        channel: "tool.call",
        Icon: Wrench,
        message: `→ ${step.toolName ?? step.label}${argPreview(step.payload) ? ` ${argPreview(step.payload)}` : ""}`,
      };
    case "tool_result":
      return {
        ...base,
        level: isError ? "warning" : "info",
        channel: "tool.result",
        Icon: Hammer,
        message: isError
          ? `← ${step.toolName ?? step.label} · isError`
          : `← ${step.toolName ?? step.label}`,
      };
    case "llm_request":
      return {
        ...base,
        level: "info",
        channel: "llm.req",
        Icon: ArrowUpFromLine,
        message: `▸ ${step.label}`,
      };
    case "llm_response":
      return {
        ...base,
        level: isError ? "error" : "info",
        channel: "llm.resp",
        Icon: ArrowDownToLine,
        message: `▸ ${step.label}`,
      };
    case "context_event":
      return {
        ...base,
        level: step.label === "context_overflow" ? "error" : "warning",
        channel: "context",
        Icon: step.label === "context_overflow" ? Ban : FileCog,
        message:
          step.label === "context_overflow"
            ? "Context window exceeded — the conversation outgrew the model's limit."
            : `Context event — ${step.label}`,
      };
    default:
      return {
        ...base,
        level: "info",
        channel: stepTypeMeta(step.type).label,
        Icon: BrainCog,
        message: step.label,
      };
  }
}

/**
 * Fold the run-stream state into the ordered console log. The in-flight `deltas` (the streaming
 * assistant turn that has NOT yet settled into an `llm_response` step) narrate as two live one-liners
 * pinned after the settled steps, so you see text/reasoning appear as it streams — exactly the
 * "watch it run" affordance Network can't give. Settled steps own their own rows (by index).
 */
function buildLog(
  steps: RunStep[],
  deltas: RunDeltas,
  status: RunStatus | null,
  outcome: RunOutcome | undefined,
  stopReason: string | undefined,
  error: string | null,
): ConsoleEntry[] {
  const log: ConsoleEntry[] = steps.map(entryForStep);

  // Live streaming deltas — only while the run is non-terminal (a finished run's text is already in
  // its settled `llm_response` steps). Rendered dimmed via the `info` level + an explicit "(streaming)".
  const live = status === "running" || status === "pending";
  if (live && deltas.reasoning.trim().length > 0) {
    log.push({
      key: "delta:reasoning",
      level: "info",
      channel: "reasoning",
      Icon: BrainCog,
      message: `${oneLine(deltas.reasoning)} (streaming…)`,
      stepId: null,
    });
  }
  if (live && deltas.text.trim().length > 0) {
    log.push({
      key: "delta:text",
      level: "info",
      channel: "output",
      Icon: ArrowDownToLine,
      message: `${oneLine(deltas.text)} (streaming…)`,
      stepId: null,
    });
  }

  // A stream-level error event (`stream.error`) that is NOT already a terminal status line.
  if (error && status !== "error") {
    log.push({
      key: "error:stream",
      level: "error",
      channel: "stream",
      Icon: CircleAlert,
      message: error,
      stepId: null,
    });
  }

  // Terminal status as the final line.
  if (status) {
    const terminal = terminalLine(status, outcome, stopReason);
    if (terminal) {
      log.push({
        key: `status:${status}`,
        level: terminal.level,
        channel: "run",
        Icon:
          terminal.level === "error"
            ? CircleAlert
            : terminal.level === "warning"
              ? AlertTriangle
              : Info,
        message: terminal.message,
        stepId: null,
      });
    }
  }

  return log;
}

/** Collapse streamed text to a single clamped line for the one-liner (full text lives in the steps). */
function oneLine(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 100 ? `${flat.slice(0, 99)}…` : flat;
}

/** Lower-cased search haystack for an entry (message + channel + the redacted raw payload TEXT). */
function haystack(entry: ConsoleEntry): string {
  let raw = "";
  try {
    if (entry.raw != null) raw = safeJson(entry.raw);
  } catch {
    // A payload that can't be stringified is simply not indexed.
  }
  return `${entry.channel} ${entry.message} ${entry.meta ?? ""} ${raw}`.toLowerCase();
}

export type ConsolePanelProps = {
  steps: RunStep[];
  deltas: RunDeltas;
  status: RunStatus | null;
  outcome?: RunOutcome;
  stopReason?: string;
  error: string | null;
  /** The lifted cross-highlight selection (shared with the left tool cards + the inspector). */
  selectedStepId: string | null;
  onSelectStep: (stepId: string | null) => void;
};

export function ConsolePanel({
  steps,
  deltas,
  status,
  outcome,
  stopReason,
  error,
  selectedStepId,
  onSelectStep,
}: ConsolePanelProps) {
  const [search, setSearch] = useState("");
  const [levelFacet, setLevelFacet] = useState<string[]>([]);
  // DevTools "preserve log" (default ON): keep the full narrated history. When turned OFF, the
  // console "follows the tail" — it auto-watermarks at the latest row each render, so only brand-new
  // in-flight events show and prior history is suppressed (the volatile/auto-clear mode). The two
  // controls are independent: Clear is always available and sets the watermark explicitly.
  const [preserve, setPreserve] = useState(true);
  // The Clear watermark is the count of SETTLED (step-backed, non-ephemeral) entries to hide, NOT a
  // row key. A key is the wrong anchor here: during a live run the last row is frequently an EPHEMERAL
  // streaming/status row (`delta:text`, `delta:reasoning`, `status:running`) whose key DISAPPEARS the
  // instant the delta settles into an `llm_response` step — `findIndex` would then return -1 and the
  // whole cleared history would silently reappear mid-stream. Settled entries are keyed by their
  // `step.id` and only ever grow by appending, so a settled-count watermark is stable across streaming.
  const [clearedSettledCount, setClearedSettledCount] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // De-dupe the double `tool_call` rows (Task C3 #2): each logical tool call emits an engine `:step:`
  // row AND an MCP-sink `:mcp:` row; collapse them into ONE so the console narrates each tool call
  // once (the `:mcp:` row's timing/size is merged onto the engine row). Selection/cross-highlight
  // still works because the surviving row keeps the engine step's id (the shared `selectedStepId`).
  const logicalSteps = useMemo(() => dedupeToolSteps(steps), [steps]);

  // The full derived log. Cheap to recompute (one map + a few pushes); memoised so the table data
  // identity is stable between unrelated renders.
  const fullLog = useMemo(
    () => buildLog(logicalSteps, deltas, status, outcome, stopReason, error),
    [logicalSteps, deltas, status, outcome, stopReason, error],
  );

  // Apply the clear watermark by SETTLED-entry count (the stable anchor — see `clearedSettledCount`).
  // We walk the log and slice off the prefix that ends once we've passed the first
  // `clearedSettledCount` settled (step-backed) entries; any ephemeral delta/status rows interleaved
  // in that prefix are dropped with it, and rows produced after the clear still append. With
  // preserve-log OFF the effective watermark is the SECOND-TO-LAST row (follow-the-tail: only the
  // freshest row shows); whichever watermark is later (further down the log) wins, so an explicit
  // Clear during tail-follow still works.
  const afterClear = useMemo(() => {
    let explicitAt = -1;
    if (clearedSettledCount > 0) {
      let settledSeen = 0;
      for (let i = 0; i < fullLog.length; i += 1) {
        if (fullLog[i]?.stepId !== null) {
          settledSeen += 1;
          if (settledSeen === clearedSettledCount) {
            explicitAt = i;
            break;
          }
        }
      }
    }
    const tailAt = preserve ? -1 : fullLog.length - 2;
    const at = Math.max(explicitAt, tailAt);
    return at < 0 ? fullLog : fullLog.slice(at + 1);
  }, [fullLog, preserve, clearedSettledCount]);

  // The errors counter chip counts the CURRENT (post-clear) error rows — DevTools "errors (n)".
  const errorCount = useMemo(
    () => afterClear.filter((entry) => entry.level === "error").length,
    [afterClear],
  );
  const warningCount = useMemo(
    () => afterClear.filter((entry) => entry.level === "warning").length,
    [afterClear],
  );

  // Level facet + search cascade. The "Protocol" level is a lens over rows that carry a raw payload
  // (the closest-to-raw frame we persist) rather than a distinct event class, so selecting it shows
  // exactly the rows whose raw payload can be expanded.
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => {
    return afterClear.filter((entry) => {
      if (levelFacet.length > 0) {
        const matchesLevel = levelFacet.includes(entry.level);
        const matchesProtocol = levelFacet.includes("protocol") && entry.raw != null;
        if (!matchesLevel && !matchesProtocol) return false;
      }
      if (needle.length > 0 && !haystack(entry).includes(needle)) return false;
      return true;
    });
  }, [afterClear, levelFacet, needle]);

  const levelOptions = useMemo(
    () =>
      (Object.keys(LEVEL_META) as ConsoleLevel[]).map((level) => ({
        label: LEVEL_META[level].label,
        value: level,
      })),
    [],
  );

  const columns = useMemo(
    () => [
      col<ConsoleEntry>({
        id: "event",
        header: "Event",
        // The sortable/searchable value is the message; display is a rich one-liner row.
        value: (row) => row.message,
        cell: (row) => {
          const selected = row.stepId !== null && selectedStepId === row.stepId;
          const isOpen = expanded[row.key] === true;
          const selectable = row.stepId !== null;
          const canExpand = row.raw != null;
          const Glyph = row.Icon;
          return (
            <div className="flex min-w-0 flex-col gap-1 py-0.5">
              <div className="flex min-w-0 items-center gap-2">
                {/* Expand toggle for the raw frame (only when a redacted payload exists). */}
                {canExpand ? (
                  <IconButton
                    variant="ghost"
                    size="icon-sm"
                    className="size-5 shrink-0"
                    onClick={() => setExpanded((prev) => ({ ...prev, [row.key]: !isOpen }))}
                    aria-expanded={isOpen}
                    label={isOpen ? "Collapse raw frame" : "Expand raw frame"}
                  >
                    {isOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                  </IconButton>
                ) : (
                  <span className="size-5 shrink-0" aria-hidden />
                )}
                <Glyph
                  className={cn(
                    "size-4 shrink-0",
                    row.level === "error"
                      ? "text-destructive"
                      : row.level === "warning"
                        ? "text-warning"
                        : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <Badge variant={LEVEL_BADGE[row.level]} className="shrink-0 font-normal">
                  {row.channel}
                </Badge>
                {/* The message is the clickable selection affordance when it maps to a step (no
                    whole-row onClick on DataTable, mirroring StepLog). Otherwise it is plain text. */}
                {selectable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-auto min-w-0 justify-start px-1.5 py-0.5 text-left font-normal",
                      selected && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => onSelectStep(selected ? null : row.stepId)}
                    aria-pressed={selected}
                    title={row.message}
                  >
                    <span className="truncate">{row.message}</span>
                  </Button>
                ) : (
                  <Text
                    variant="meta"
                    tone={row.level === "error" ? "default" : "muted"}
                    as="span"
                    className="min-w-0 truncate px-1.5"
                  >
                    {row.message}
                  </Text>
                )}
                {row.meta ? (
                  <Text
                    variant="meta"
                    tone="muted"
                    as="span"
                    className="ml-auto shrink-0 tabular-nums"
                  >
                    {row.meta}
                  </Text>
                ) : null}
              </div>
              {/* The expanded raw frame: read-only, escaped TEXT via CodeSnippet (untrusted payload —
                  never HTML-injected / eval'd; secrets already redacted server-side). */}
              {isOpen && canExpand ? (
                <div className="pl-7">
                  <CodeSnippet
                    value={safeJson(row.raw)}
                    ariaLabel={`Raw frame for ${row.channel}`}
                    maxHeightClassName="max-h-56"
                  />
                </div>
              ) : null}
            </div>
          );
        },
      }),
    ],
    [expanded, onSelectStep, selectedStepId],
  );

  const handleClear = () => {
    // Watermark on the count of currently-settled (step-backed) rows — the STABLE anchor. Everything
    // up to that point hides; later settled steps (and the ephemeral deltas streaming into them) still
    // append. Anchoring on the last row's KEY would be wrong: that row is often an ephemeral
    // delta/status whose key vanishes when it settles, silently un-clearing the whole history.
    const settledCount = fullLog.reduce((n, entry) => (entry.stepId !== null ? n + 1 : n), 0);
    setClearedSettledCount(settledCount);
    setExpanded({});
  };

  return (
    <DataTable
      data={rows}
      columns={columns}
      // Virtualize rather than paginate — the log grows large and live; rapid scroll must stay smooth
      // (Acceptance: smooth at 50+ events). A fixed body height keeps it inside the right pane.
      enableRowVirtualization
      estimateRowHeight={40}
      maxBodyHeight="24rem"
      emptyMessage={
        fullLog.length === 0
          ? "No events yet — the console narrates as the run streams."
          : "No events match the current filter."
      }
      toolbar={() => (
        <FilterBar
          actions={
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2">
                <Switch
                  checked={preserve}
                  onCheckedChange={setPreserve}
                  aria-label="Preserve log"
                />
                <Text variant="meta" tone="muted" as="span">
                  Preserve log
                </Text>
              </label>
              <Button variant="outline" size="sm" onClick={handleClear} title="Clear the console">
                <Trash2 aria-hidden />
                <span>Clear</span>
              </Button>
            </div>
          }
        >
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search events & frames…"
            label="Search console events"
          />
          <FacetFilter
            title="Level"
            options={levelOptions}
            selected={levelFacet}
            onSelectedChange={setLevelFacet}
          />
          <Badge
            variant={errorCount > 0 ? "destructive" : "outline"}
            className="tabular-nums font-normal"
            title={`${errorCount} error${errorCount === 1 ? "" : "s"}`}
          >
            <CircleAlert className="size-3" aria-hidden />
            {formatNumber(errorCount)}
          </Badge>
          {warningCount > 0 ? (
            <Badge
              variant="warning"
              className="tabular-nums font-normal"
              title={`${warningCount} warnings`}
            >
              <AlertTriangle className="size-3" aria-hidden />
              {formatNumber(warningCount)}
            </Badge>
          ) : null}
        </FilterBar>
      )}
    />
  );
}
