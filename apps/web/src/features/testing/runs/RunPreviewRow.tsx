import type { RunSummary, SearchContentClass } from "@mcp-token-footprint/shared";
import { Badge, TableCell, TableRow, Text } from "@elabs-ai/components-ui";
import { formatCostUsd, formatNumber } from "../../../lib/format";
import { FeedbackChips } from "../FeedbackControl";
import { runStatusBadgeView } from "../RunBar";
import type { PreviewMode } from "./run-columns";

const MATCH_KIND_LABELS: Record<SearchContentClass, string> = {
  prompt: "Prompt",
  assistant: "Assistant",
  tool: "Tool call",
  tool_result: "Tool result",
  error: "Error",
  rating: "Rating",
  meta: "Meta",
};

function isErrorRun(run: RunSummary): boolean {
  return run.status === "error" || run.outcome === "error";
}

/** The expandable per-row preview line's content (Observability WP 2.3 DESIGN — the column chooser's
 *  "preview cell" options). Renders `null` for `"none"` so the caller never injects an empty row. */
function PreviewContent({ run, mode }: { run: RunSummary; mode: PreviewMode }) {
  switch (mode) {
    case "none":
      return null;
    case "snippet":
      return run.searchSnippet ? (
        <div className="flex min-w-0 items-start gap-2">
          {run.searchMatchKind ? (
            <Badge variant="outline" className="shrink-0 font-normal">
              {MATCH_KIND_LABELS[run.searchMatchKind]}
            </Badge>
          ) : null}
          <Text variant="body" className="min-w-0 whitespace-pre-wrap break-words">
            {run.searchSnippet}
          </Text>
        </div>
      ) : (
        <Text variant="meta" tone="muted">
          No search match to preview on this run.
        </Text>
      );
    case "lastAssistantText":
      // The feed carries no full per-run transcript — only a WP1.3 indexed-hit snippet when a search
      // matched. When that hit's best match came from assistant prose, reuse it; otherwise the console
      // is the honest place to read the actual transcript (never fabricate a preview here).
      return run.searchMatchKind === "assistant" && run.searchSnippet ? (
        <Text variant="body" className="whitespace-pre-wrap break-words">
          {run.searchSnippet}
        </Text>
      ) : (
        <Text variant="meta" tone="muted">
          No assistant-text preview available — open the run to read its full transcript.
        </Text>
      );
    case "stopReason": {
      const view = runStatusBadgeView(run.status, run.outcome, run.ratingState, run.stopReasonCode, run.phase);
      return (
        <Text variant="body">{view.kind === "chip" ? view.label : "No stop reason recorded."}</Text>
      );
    }
    case "error": {
      if (!isErrorRun(run)) {
        return (
          <Text variant="meta" tone="muted">
            No error on this run.
          </Text>
        );
      }
      const view = runStatusBadgeView(run.status, run.outcome, run.ratingState, run.stopReasonCode, run.phase);
      return (
        <Text variant="body" className="text-destructive">
          {view.kind === "chip" ? view.label : "Error"}
        </Text>
      );
    }
    case "cost":
      return (
        <Text variant="body" className="tabular-nums">
          {formatCostUsd(run.costUsd)} · {formatNumber(run.tokensIn)} in / {formatNumber(run.tokensOut)} out
          tokens
        </Text>
      );
    case "feedback":
      // WP 2.5 (D-OB15) — the RUN-LEVEL human-feedback aggregate (`RunSummary.feedback`, WP1.5).
      // Read-only here (the feed is a summary surface; writes happen in the run console); an honest
      // empty state when the run carries none, never a fabricated "not rated" chip.
      return run.feedback && run.feedback.length > 0 ? (
        <FeedbackChips feedback={run.feedback} />
      ) : (
        <Text variant="meta" tone="muted">
          No human feedback on this run yet.
        </Text>
      );
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function RunPreviewRow({
  run,
  mode,
  colSpan,
}: {
  run: RunSummary;
  mode: PreviewMode;
  colSpan: number;
}) {
  if (mode === "none") return null;
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="bg-muted/20 px-4 py-3">
        <PreviewContent run={run} mode={mode} />
      </TableCell>
    </TableRow>
  );
}
