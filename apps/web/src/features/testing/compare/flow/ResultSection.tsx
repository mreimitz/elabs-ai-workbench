import { useMemo, useState } from "react";
import { Badge, Button, Heading, Text } from "@elabs-ai/components-ui";
import { Maximize2 } from "lucide-react";
import { RunLetterBadge } from "../RunLetterBadge";
import { runChipLabel } from "../compare-runs";
import { ResultCompareDialog } from "./ResultCompareDialog";
import { laneResults, type LaneResult } from "./result";
import type { FlowLane } from "./flow-types";

/**
 * The Flow **Result** section (compare-redesign §3.2·7, WP-7). Rendered by {@link FlowLanes} AFTER the
 * aligned rows (and any terminal block): a distinct full-width band — divider + "Result" heading —
 * then ONE grid row using the SAME `gridTemplateColumns` as the lanes above, so each Result cell sits
 * directly under its lane column (a gutter cell keeps the 2.25rem rail aligned).
 *
 * It renders from `lanes` directly ({@link laneResults}), NOT from the collapsed `DisplayRow`s, so the
 * final answer is ALWAYS shown and is never hidden by the "Changes only" collapse. The `Expand` button
 * opens the side-by-side {@link ResultCompareDialog}. The `id="compare-result"` anchor lets a future
 * verdict-band link target the section directly.
 */
export function ResultSection({
  lanes,
  gridTemplateColumns,
}: {
  lanes: FlowLane[];
  gridTemplateColumns: string;
}) {
  const [open, setOpen] = useState(false);
  const results = useMemo(() => laneResults(lanes), [lanes]);

  return (
    <section id="compare-result" className="mt-6 flex flex-col gap-3 border-t-2 border-border pt-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Heading level={3} size="subtitle">
          Result
        </Heading>
        <Text variant="caption" tone="muted">
          the final answer each run produced
        </Text>
      </div>

      <div className="grid items-stretch gap-2" style={{ gridTemplateColumns }}>
        {/* Gutter cell — keeps the Result cells aligned under the lanes' 2.25rem rail. */}
        <div aria-hidden />
        {results.map((result) => (
          <ResultCell key={result.letter} result={result} onExpand={() => setOpen(true)} />
        ))}
      </div>

      <ResultCompareDialog open={open} onOpenChange={setOpen} results={results} />
    </section>
  );
}

/** One lane's final-result preview: identity + token badge, a 6-line clamp, and an Expand button. */
function ResultCell({ result, onExpand }: { result: LaneResult; onExpand: () => void }) {
  const isError = result.kind === "error";
  const isNone = result.kind === "none";

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2">
        <RunLetterBadge
          letter={result.letter}
          color={result.color}
          baseline={result.run.isBaseline}
          size="sm"
        />
        <Text variant="caption" className="min-w-0 flex-1 truncate font-medium">
          {runChipLabel(result.run)}
        </Text>
        {isError ? (
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

      {isNone ? (
        <Text variant="caption" tone="muted">
          No final answer — this run recorded no output.
        </Text>
      ) : (
        // The error state is signalled by the `error` Badge above; the message reads as muted detail.
        <Text
          variant="caption"
          tone="muted"
          className="line-clamp-6 whitespace-pre-wrap break-words"
        >
          {result.text || "—"}
        </Text>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onExpand}
        aria-label={`Expand full outputs (run ${result.letter})`}
        className="w-fit"
      >
        <Maximize2 aria-hidden />
        <span>Expand</span>
      </Button>
    </div>
  );
}
