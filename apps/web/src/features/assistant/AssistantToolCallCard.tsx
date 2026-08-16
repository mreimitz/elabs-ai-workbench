import type { Status } from "@brand/ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  StatusBadge,
  Text,
  cn,
} from "@brand/ui";
import { ToolInput, ToolOutput } from "@brand/ai";
import { ChevronRight, Wrench } from "lucide-react";
import { mcpErrorText, summarizeArgs, unwrapToolResult } from "../testing/tool-call-view";
import type { AssistantTimelineToolCall } from "./use-assistant-stream";

/**
 * One tool invocation inside an assistant turn — rendered the way the run console renders one
 * (`features/testing/ToolCallCard.tsx`, so the two chat surfaces read identically): a SINGLE collapsed
 * row whose whole width is the disclosure trigger — chevron + wrench + the (namespace-stripped) tool
 * name + a muted one-line args summary. Success is QUIET (no badge); only `running`/`failed` surface a
 * `StatusBadge`. Parameters / Result (via `@brand/ai` `ToolInput`/`ToolOutput`) live one click behind
 * the row, with the MCP result envelope UNWRAPPED ({@link unwrapToolResult}) so the tool's real payload
 * shows — `structuredContent`/pretty-parsed JSON, not the escaped `{ content: [{ text }] }` wire frame.
 */
export function AssistantToolCallCard({ call }: { call: AssistantTimelineToolCall }) {
  const status: Status = !call.result ? "running" : call.result.isError ? "failed" : "complete";
  const summary = summarizeArgs(call.input);
  const output =
    call.result && !call.result.isError ? unwrapToolResult(call.result.value) : undefined;
  const errorText = call.result?.isError ? mcpErrorText(call.result.value) : undefined;
  const name = prettyToolName(call.toolName);

  return (
    <Collapsible className={cn("group/tool min-w-0 rounded-md border border-border bg-card")}>
      <CollapsibleTrigger
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Tool call ${name}`}
      >
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-90"
          aria-hidden
        />
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <Text
          variant="code"
          as="span"
          className="shrink-0 text-meta font-medium"
          title={call.toolName}
        >
          {name}
        </Text>
        {summary ? (
          <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" title={summary}>
            {summary}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {/* Quiet on success — status noise only when it means something (running / failed). */}
        {status === "running" || status === "failed" ? (
          <StatusBadge status={status} className="shrink-0" />
        ) : null}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex min-w-0 flex-col gap-3 border-t border-border px-3 py-2.5">
          {call.input !== undefined ? (
            <ToolInput
              input={call.input}
              className="min-w-0 max-h-60 overflow-x-auto overflow-y-auto"
            />
          ) : (
            <Text variant="meta" tone="muted">
              No arguments recorded for this call.
            </Text>
          )}
          {call.result ? (
            <ToolOutput
              output={output}
              errorText={errorText}
              className="min-w-0 max-h-80 overflow-y-auto"
            />
          ) : (
            <Text variant="meta" tone="muted">
              Awaiting result…
            </Text>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Strip the SDK's `mcp__<server>__` namespace from an in-process MCP tool name for display
 * (`runs_get`, not `mcp__assistant-app__runs_get`). Native built-ins (`Read`/`Glob`/`Edit`/…) and
 * already-bare names pass through unchanged.
 */
function prettyToolName(name: string): string {
  return name.replace(/^mcp__.+?__/, "");
}
