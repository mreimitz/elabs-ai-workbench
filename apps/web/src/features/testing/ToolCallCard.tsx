import { useState } from "react";
import type { Status } from "@elabs-ai/components-ui";
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  StatusBadge,
  Text,
  cn,
} from "@elabs-ai/components-ui";
import { ToolInput, ToolOutput } from "@elabs-ai/components-ai";
import { ChevronRight, ExternalLink, GitBranch, Maximize2, Wrench } from "lucide-react";
import { formatDuration, formatNumber, safeJson } from "../../lib/format";
import { detectAssets } from "./asset-detect";
import { AssetGallery } from "./AssetGallery";
import { IconButton } from "../../components/IconButton";
import { PayloadDialog } from "./PayloadDialog";
import { mcpErrorText, summarizeArgs, unwrapToolResult } from "./tool-call-view";
import type { TimelineToolCall } from "./use-run-stream";

/**
 * One tool invocation inside an assistant turn, rendered the way a real Claude session renders it:
 * a SINGLE collapsed line whose whole row is the disclosure trigger — chevron + tool name + a muted
 * one-line args summary + right-aligned duration/token meta. Success carries NO badge (quiet is the
 * default; only `failed`/`running` surface a `StatusBadge`), and the technical view (Parameters /
 * Result via `@elabs-ai/components-ai` `ToolInput`/`ToolOutput`, plus the cross-pane Inspect / View-in-trace
 * actions) lives behind the row, one click away.
 *
 * The result payload is UNWRAPPED before display ({@link unwrapToolResult}): an MCP envelope
 * (`{ content: [{ type: "text", text }], structuredContent?, isError }`) shows its meaningful
 * payload — `structuredContent` when present, else the text parts with JSON-in-string pretty-parsed
 * — never the escaped wire frame. The raw step stays reachable via Inspect (packet log).
 *
 * Both technical blocks are CLAMPED (a huge result must not swallow the transcript), so each carries
 * an **Expand** button into the shared `PayloadDialog` — the same full-payload modal the Trace leaf
 * opens, with the backing step's `PacketTabs` beside it. Without it a clamped block was a dead end:
 * the only ways on were Inspect (a different, re-serialized view) or the Trace tab.
 *
 * The two run steps that back this — the engine `tool_call` (args) and its `tool_result` — arrive
 * separately from `apps/api/src/testing/engine.ts`; `buildTimeline` pairs them into the
 * {@link TimelineToolCall} consumed here, de-duping the MCP-sink timing step by `toolCallId`.
 */
export function ToolCallCard({
  call,
  selected,
  onInspect,
  onShowInTrace,
  serverName,
  showServerChip = false,
}: {
  call: TimelineToolCall;
  selected: boolean;
  onInspect: () => void;
  /** WP 3.2 — reveal this call in the Trace tree (cross-representation link). Omitted when no id. */
  onShowInTrace?: (() => void) | undefined;
  /** Resolved human server name (falls back to the raw id upstream). Undefined → no server info. */
  serverName?: string | undefined;
  /** Show the server chip on the collapsed row — only when the run spans >1 server. */
  showServerChip?: boolean;
}) {
  const status = toBrandStatus(call);
  // The Agent SDK reports an MCP tool by its fully-qualified `mcp__<serverKey>__<toolName>` name
  // (subscription path, WP 1.3). Strip the `mcp__<serverKey>__` prefix so it reads as the plain tool
  // name (`acme_search`), matching the API-keyed path; non-prefixed names pass through unchanged.
  const toolLabel = call.toolName.startsWith("mcp__")
    ? call.toolName.split("__").slice(2).join("__") || call.toolName
    : call.toolName;
  const hasArgs = hasArgsPayload(call.call);
  const args = hasArgs ? argsInput(call.call) : undefined;
  const result = resultView(call.result);
  const duration = durationLabel(call.result?.durationMs ?? call.call.durationMs);
  const resultTokens =
    call.result?.usageActual?.outputTokens ?? Object.values(call.result?.profileTokens ?? {})[0];
  const summary = summarizeArgs(args);
  // Managed image assets (paths-only in the text) stay VISIBLE below the collapsed row — a produced
  // artifact is the headline (UI §D2), never hidden behind the technical disclosure.
  const assets = detectAssets(call.result);
  // Which technical block, if any, is open in the shared full-payload modal.
  const [expanded, setExpanded] = useState<"parameters" | "result" | null>(null);
  const expandedPayload =
    expanded === "parameters"
      ? { heading: "Parameters", ...asPayload(args), step: call.call, isError: false }
      : expanded === "result" && result
        ? {
            heading: "Result",
            ...(result.errorText !== undefined
              ? { value: result.errorText, language: "markdown" as const }
              : asPayload(result.output)),
            step: call.result ?? call.call,
            isError: result.errorText !== undefined,
          }
        : null;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Collapsible
        className={cn(
          "group/tool min-w-0 rounded-md border border-border bg-card",
          selected && "ring-2 ring-ring",
        )}
      >
        <CollapsibleTrigger
          className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Tool call ${toolLabel}`}
        >
          <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-90"
            aria-hidden
          />
          <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <Text
            variant="code"
            as="span"
            className="shrink-0 text-caption font-medium"
            title={toolLabel}
          >
            {toolLabel}
          </Text>
          {showServerChip && serverName ? (
            <Badge variant="outline" className="shrink-0 font-normal">
              {serverName}
            </Badge>
          ) : null}
          {summary ? (
            <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground" title={summary}>
              {summary}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {/* Quiet on success: status noise only when it MEANS something (running / failed). */}
          {status === "running" || status === "failed" ? (
            <StatusBadge status={status} className="shrink-0" />
          ) : duration || (typeof resultTokens === "number" && resultTokens > 0) ? (
            <span className="shrink-0 tabular-nums text-caption text-muted-foreground">
              {[
                duration,
                typeof resultTokens === "number" && resultTokens > 0
                  ? `${formatNumber(resultTokens)} tok`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </CollapsibleTrigger>

        <CollapsibleContent>
          {/* T6d — CONTAIN the technical JSON: `min-w-0 overflow-x-auto` makes a long blob scroll
              WITHIN the pane instead of widening the whole conversation column past the viewport.
              `max-h` keeps a huge result from swallowing the transcript — it scrolls in place. */}
          <div className="flex min-w-0 flex-col gap-3 border-t border-border px-3 py-2.5">
            {serverName ? (
              <Text variant="meta" tone="muted">
                Server · {serverName}
              </Text>
            ) : null}
            {hasArgs ? (
              /* `relative` so the Expand affordance can sit over the block's own header row —
                 `ToolInput` renders its "PARAMETERS" caption itself and takes no action slot. */
              <div className="relative min-w-0">
                <ToolInput
                  input={args}
                  className="min-w-0 max-h-60 overflow-x-auto overflow-y-auto"
                />
                <IconButton
                  label="Expand parameters"
                  size="icon-sm"
                  variant="ghost"
                  className="absolute right-1 top-0"
                  onClick={() => setExpanded("parameters")}
                >
                  <Maximize2 aria-hidden />
                </IconButton>
              </div>
            ) : (
              <Text variant="meta" tone="muted">
                Arguments are redacted for this step.
              </Text>
            )}
            {result ? (
              <div className="relative min-w-0">
                <ToolOutput
                  output={result.output}
                  errorText={result.errorText}
                  className="min-w-0 max-h-80 overflow-y-auto"
                />
                <IconButton
                  label="Expand result"
                  size="icon-sm"
                  variant="ghost"
                  className="absolute right-1 top-0"
                  onClick={() => setExpanded("result")}
                >
                  <Maximize2 aria-hidden />
                </IconButton>
              </div>
            ) : (
              <Text variant="meta" tone="muted">
                Awaiting result…
              </Text>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {onShowInTrace ? (
                <Button variant="outline" size="sm" onClick={onShowInTrace}>
                  <GitBranch aria-hidden />
                  <span>View in trace</span>
                </Button>
              ) : null}
              <Button
                variant={selected ? "secondary" : "outline"}
                size="sm"
                onClick={onInspect}
                aria-pressed={selected}
              >
                <ExternalLink aria-hidden />
                <span>Inspect</span>
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {expandedPayload ? (
        <PayloadDialog
          open
          onOpenChange={(next) => (next ? undefined : setExpanded(null))}
          heading={expandedPayload.heading}
          value={expandedPayload.value}
          language={expandedPayload.language}
          isError={expandedPayload.isError}
          step={expandedPayload.step}
        />
      ) : null}
      {assets.length > 0 ? <AssetGallery serverId={call.serverId} paths={assets} /> : null}
    </div>
  );
}

/**
 * The already-unwrapped payload as editor text: a string is prose (verbatim `markdown`), anything
 * else is a document (`safeJson`-indented `json`). Mirrors what `ToolInput`/`ToolOutput` render, so
 * the modal shows the same thing the clamped block does — just all of it.
 */
function asPayload(value: unknown): { value: string; language: "json" | "markdown" } {
  if (typeof value === "string") return { value, language: "markdown" };
  return { value: safeJson(value), language: "json" };
}

/**
 * Map a timeline tool call onto the canonical closed `Status` enum. A failed call/result → `failed`;
 * a settled ok result → `complete`; otherwise the call is still in flight → `running`.
 * (`RunStep.status` is the narrower `ok|error|running`.)
 */
function toBrandStatus(call: TimelineToolCall): Status {
  const resultStatus =
    call.result?.status ?? (call.call.type === "tool_result" ? call.call.status : undefined);
  if (call.call.status === "error" || resultStatus === "error") return "failed";
  if (resultStatus === "ok") return "complete";
  if (call.result) return "complete";
  if (call.call.status === "ok") return "complete";
  return "running";
}

/** Pull the raw `args` value out of the `tool_call` payload (`{ toolCallId, args }`) for `ToolInput`. */
function argsInput(call: { payload: unknown }): unknown {
  const p = call.payload;
  if (p && typeof p === "object" && "args" in p) return (p as { args: unknown }).args;
  return undefined;
}

/** True when the `tool_call` payload carries an `args` field (vs. a redacted step). */
function hasArgsPayload(call: { payload: unknown }): boolean {
  const p = call.payload;
  return Boolean(p && typeof p === "object" && "args" in p);
}

/**
 * Shape the `tool_result` payload (`{ result }` | `{ error }`) for `ToolOutput`, UNWRAPPING an MCP
 * result envelope on the way ({@link unwrapToolResult}). An error step routes its message into
 * `errorText`.
 */
function resultView(
  result: TimelineToolCall["result"],
): { output: unknown; errorText: string | undefined } | null {
  if (!result) return null;
  const isError = result.status === "error";
  const p = result.payload;
  if (p && typeof p === "object") {
    if ("error" in p)
      return { output: undefined, errorText: String((p as { error: unknown }).error) };
    if ("result" in p) {
      const value = (p as { result: unknown }).result;
      if (isError) {
        return {
          output: undefined,
          errorText: typeof value === "string" ? value : mcpErrorText(value),
        };
      }
      return { output: unwrapToolResult(value), errorText: undefined };
    }
  }
  return isError
    ? { output: undefined, errorText: "Tool failed." }
    : { output: "(no result payload)", errorText: undefined };
}

/** Human-readable duration label; `null` when there's no duration to show. */
function durationLabel(ms: number | undefined): string | null {
  return ms === undefined ? null : formatDuration(ms);
}
