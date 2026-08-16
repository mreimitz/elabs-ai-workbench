import type { AnswersSnapshot } from "@mcp-token-footprint/shared";
import { Badge, Card, CardContent, CardHeader, CardTitle, ScrollArea } from "@brand/ui";
import { BarChart3 } from "lucide-react";
import { formatNumber } from "../../lib/format";
import { InsightRow } from "./SourcesPanel";

/**
 * Qlik Answers (WP 7.1, D-QA9/D-QA10) — the "Insights" roll-up in the monitoring RAIL. WP 7.1's
 * DE-DUP moved the snapshot-evidence list here from the chat's `SourcesPanel`: the rail is the SINGLE
 * home of each insight's full evidence (title · reason · hypercube data · Qlik definition), shown
 * exactly once, while the chat keeps its inline snapshot insets + citation chips. It sits in the same
 * `Card` rhythm as the rail's other panels (`TurnIndex`/`AssertionResults`).
 *
 * A FLAT, ORDERED list of the exported {@link InsightRow} across every settled assistant turn (a
 * multi-turn run tags each row with a "Turn N" chip so its provenance survives the flattening). The
 * list is BOUNDED — a height-capped `ScrollArea` around the `<ol>` — so a long run's insights never
 * push the rest of the rail (Turns, assertions, grades, the DevTools panel) off-screen (MUST-FIX G1).
 * The section itself is NOT collapsible on purpose: each row's `<li>` is the FORWARD scroll target a
 * citation chip resolves to, and Radix would UNMOUNT a closed section's content — killing the forward
 * leg. So the anchors stay ALWAYS MOUNTED; per-INSIGHT expand/collapse still lives on each row.
 *
 * BIDIRECTIONAL link: each row's `<li>` is the FORWARD target a citation chip in the answer scrolls to
 * ({@link InsightRow} spreads the turn-qualified `insightAnchorValue`); each row's "Show in answer"
 * ghost button is the REVERSE leg — `onCiteInsight(turnIndex, snapshotIndex)` (wired in `RunConsole`
 * to `navigateTo("chat", { kind: "insight", … })`) reveals + scrolls the chat to the matching chip.
 *
 * Renders `null` when no turn carries a snapshot (nothing to roll up) — never an empty card. Only ever
 * handed SETTLED turns (`RunConsole` derives `snapshots` off the settled `llm_response` payload), so
 * it never reads a mid-stream turn.
 */
export type RailInsightsPanelProps = {
  /** The run's settled assistant turns that produced at least one `Qlik.Snapshot`, in turn order. */
  turns: { turnIndex: number; snapshots: AnswersSnapshot[] }[];
  /** REVERSE link — reveal the answer's citation chip for `(turnIndex, snapshotIndex)` in the chat. */
  onCiteInsight: (turnIndex: number, snapshotIndex: number) => void;
};

export function RailInsightsPanel({ turns, onCiteInsight }: RailInsightsPanelProps) {
  const total = turns.reduce((sum, turn) => sum + turn.snapshots.length, 0);
  if (total === 0) return null;
  const multiTurn = turns.length > 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>
          <span className="flex min-w-0 items-center gap-2">
            <BarChart3 aria-hidden className="size-4 shrink-0" />
            Insights
            <Badge variant="secondary" className="font-normal tabular-nums">
              {formatNumber(total)}
            </Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {/* BOUNDED (G1) — the height cap + scroll keep a long run's insights inside the card without a
            section-level collapse, so every row's `<li>` FORWARD anchor stays mounted for a chip jump. */}
        <ScrollArea className="max-h-96">
          <ol className="flex min-w-0 flex-col gap-2 pr-3">
            {turns.flatMap((turn) =>
              turn.snapshots.map((snap, snapshotIndex) => (
                <InsightRow
                  key={`${turn.turnIndex}-${snapshotIndex}`}
                  snap={snap}
                  index={snapshotIndex}
                  turnIndex={turn.turnIndex}
                  showTurn={multiTurn}
                  onCite={() => onCiteInsight(turn.turnIndex, snapshotIndex)}
                />
              )),
            )}
          </ol>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
