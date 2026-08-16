import { useState } from "react";
import { Badge, Text, ToggleGroup, ToggleGroupItem } from "@brand/ui";
import { CodeEditor, DiffEditor } from "@brand/editor";
import { ArrowRight } from "lucide-react";
import { WorkbenchDialog } from "../../../../components/dialogs/WorkbenchDialog";
import { READ_ONLY_OPTIONS } from "../../../../lib/monaco";
import { runChipLabel } from "../compare-runs";
import { RunLetterBadge } from "../RunLetterBadge";
import type { LaneResult } from "./result";

/**
 * The Expand target of the Flow Result section (compare-redesign §3.2·7, WP-7) — the largest modal
 * tier ({@link WorkbenchDialog}) titled "Result — full outputs". One read-only Monaco pane per
 * compared run (2–3), side by side, so the runs' actual outputs sit level regardless of turn count.
 *
 * D3 (owner-locked): side-by-side is the committed default; when EXACTLY two runs are compared, a
 * `Side-by-side | Diff` toggle in the header swaps to a single read-only Monaco `DiffEditor`
 * (`original` = the earlier/baseline run A, `modified` = run B). The toggle is absent for 3 runs.
 *
 * SECURITY (`mcp-and-security.md`): the text is UNTRUSTED, already-redacted LLM/tool output — shown
 * read-only as markdown text only (`readOnly`, no `eval`, no `dangerouslySetInnerHTML`).
 */
export function ResultCompareDialog({
  open,
  onOpenChange,
  results,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: LaneResult[];
}) {
  const canDiff = results.length === 2;
  const [view, setView] = useState<"side" | "diff">("side");
  const diffing = canDiff && view === "diff";

  const headerActions = canDiff ? (
    <ToggleGroup
      type="single"
      value={view}
      aria-label="Output view"
      onValueChange={(next) => {
        if (next === "side" || next === "diff") setView(next);
      }}
    >
      <ToggleGroupItem value="side" aria-label="Side by side">
        Side-by-side
      </ToggleGroupItem>
      <ToggleGroupItem value="diff" aria-label="Diff">
        Diff
      </ToggleGroupItem>
    </ToggleGroup>
  ) : undefined;

  return (
    <WorkbenchDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Result — full outputs"
      description="The final answer each compared run produced (read-only, already redacted)."
      {...(headerActions ? { headerActions } : {})}
    >
      {diffing ? (
        <DiffPane a={results[0]!} b={results[1]!} />
      ) : (
        <div className="flex h-full min-h-0 divide-x divide-border">
          {results.map((result) => (
            <ResultPane key={result.letter} result={result} />
          ))}
        </div>
      )}
    </WorkbenchDialog>
  );
}

/** One run's output pane: identity header + a read-only Monaco `CodeEditor` filling the height. */
function ResultPane({ result }: { result: LaneResult }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PaneHeader result={result} />
      {/* The flex-1/min-h-0 parent gives `height="100%"` a bounded box (Monaco `automaticLayout`). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CodeEditor
          value={result.text || "(no output)"}
          language="markdown"
          readOnly
          height="100%"
          ariaLabel={`Run ${result.letter} output (full)`}
          options={READ_ONLY_OPTIONS}
        />
      </div>
    </div>
  );
}

/** The 2-run diff (D3): run A (baseline/original) ↔ run B (modified), read-only markdown. Monaco's
 *  `DiffEditor` renders side-by-side (its default `renderSideBySide`) so the two full reports keep
 *  their parallel structure with change highlighting — clearer than an inline unified view for long
 *  outputs. Side-by-side (plain, un-highlighted panes) remains the modal's default view. */
function DiffPane({ a, b }: { a: LaneResult; b: LaneResult }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-card px-4 py-2.5">
        <PaneIdentity result={a} suffix="baseline" />
        <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <PaneIdentity result={b} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DiffEditor
          original={a.text || "(no output)"}
          modified={b.text || "(no output)"}
          language="markdown"
          readOnly
          height="100%"
          options={READ_ONLY_OPTIONS}
        />
      </div>
    </div>
  );
}

function PaneHeader({ result }: { result: LaneResult }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2.5">
      <PaneIdentity result={result} />
    </div>
  );
}

/** RunLetterBadge + chip label + optional error/token badges — the shared pane/diff identity row. */
function PaneIdentity({ result, suffix }: { result: LaneResult; suffix?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <RunLetterBadge
        letter={result.letter}
        color={result.color}
        baseline={result.run.isBaseline}
        size="md"
      />
      <Text variant="caption" className="min-w-0 flex-1 truncate font-medium">
        {runChipLabel(result.run)}
      </Text>
      {suffix ? (
        <Text variant="caption" tone="muted" className="shrink-0">
          {suffix}
        </Text>
      ) : null}
      {result.kind === "error" ? (
        <Badge variant="destructive" className="shrink-0 font-normal">
          error
        </Badge>
      ) : null}
      {result.tokens != null ? (
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {result.tokens.toLocaleString()} tok
        </Badge>
      ) : null}
    </div>
  );
}
