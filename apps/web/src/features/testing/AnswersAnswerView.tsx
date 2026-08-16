import type { AnswersAnswerBlock, AnswersSnapshot } from "@mcp-token-footprint/shared";
import { Button, Text } from "@brand/ui";
import { ChatMarkdown } from "./ChatMarkdown";
import { AnswersSnapshotData } from "./AnswersSnapshotData";
import { citationAnchorValue, consoleAnchor, scrollToInsight } from "./console-anchors";

/**
 * Qlik Answers (WP 5.3, D-QA8/D-QA9/D-QA10) — the answer face for a `qlik_answers` run's settled
 * turn. Renders the assistant's card body as its ORDERED `blocks[]` sequence (NOT a flattened
 * string): narrative `text` blocks interleaved with the `Qlik.Snapshot` insights they cite, each at
 * its own card position. This REPLACES `ChatMarkdown(assistantText)` only when the derived `blocks`
 * are present AND the turn has settled — `ConversationPane` keeps the live streaming `ChatMarkdown`
 * for every in-flight or non-qlik turn (so this never renders half-parsed blocks).
 *
 *   - a `text` block → its markdown (`ChatMarkdown`), followed by its citation chips (D-QA9): one
 *     superscript chip per cited snapshot index. WP 7.1 — the chip is now BIDIRECTIONAL: clicking it
 *     is the FORWARD leg (scroll the RAIL to that insight row, cross-pane); the chip also carries the
 *     REVERSE target ({@link citationAnchorValue}) so a rail row's "Show in answer" scrolls back here;
 *   - a `snapshot` block → the shared {@link AnswersSnapshotData} inset (1×1 → MetricCard, else a
 *     compact table) for the referenced snapshot, bounds-checked against `snapshots`.
 *
 * DANGLING references are handled gracefully (verified against the real run: 6 text blocks cite
 * indices 0..5 but only 5 snapshots exist): a citation index outside `snapshots` renders an INERT
 * chip (no scroll target, no throw), and a `snapshot` block whose `index` is out of range renders
 * nothing — never `snapshots[i]` without a bounds check.
 */
export type AnswersAnswerViewProps = {
  /** The ordered card-body sequence (`AnswersStepPayload.blocks`), already derived server-side. */
  blocks: AnswersAnswerBlock[];
  /** The run's snapshots (`AnswersStepPayload.snapshots`) — the target of every `snapshot`/citation ref. */
  snapshots: AnswersSnapshot[];
  /**
   * WP 7.1 — the owning assistant turn's 0-based index. Turn-qualifies every citation chip's
   * FORWARD/REVERSE anchor (`insight:<turn>:<snap>` / `citation:<turn>:<snap>`) so the rail↔chat link
   * is unique across a multi-turn run (a bare snapshot index collided on every turn's first insight).
   */
  turnIndex: number;
};

export function AnswersAnswerView({ blocks, snapshots, turnIndex }: AnswersAnswerViewProps) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <AnswersTextBlock
            // Blocks are a positional, immutable sequence — the index is the stable identity.
            key={index}
            block={block}
            snapshotCount={snapshots.length}
            turnIndex={turnIndex}
          />
        ) : (
          <AnswersSnapshotBlock key={index} index={block.index} snapshots={snapshots} />
        ),
      )}
    </div>
  );
}

/** One narrative text block + its citation chips (D-QA9). */
function AnswersTextBlock({
  block,
  snapshotCount,
  turnIndex,
}: {
  block: Extract<AnswersAnswerBlock, { kind: "text" }>;
  snapshotCount: number;
  turnIndex: number;
}) {
  const citations = block.citations ?? [];
  return (
    <div className="flex min-w-0 flex-col">
      <ChatMarkdown text={block.markdown} />
      {citations.length > 0 ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {citations.map((snapshotIndex, k) => (
            <AnswersCitationChip
              key={`${snapshotIndex}-${k}`}
              snapshotIndex={snapshotIndex}
              snapshotCount={snapshotCount}
              turnIndex={turnIndex}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One citation chip (D-QA9 · WP 7.1): a superscript, 1-based-labelled marker for the snapshot it
 * cites. In range → an interactive `Button` that is BOTH ends of the rail↔chat link: clicking it
 * anchor-scrolls the RAIL to the matching insight row (FORWARD, {@link scrollToInsight}, cross-pane),
 * and it carries the turn-qualified {@link citationAnchorValue} `data-console-anchor` so a rail row's
 * "Show in answer" scrolls the chat back to it (REVERSE). OUT of range (a dangling citation —
 * index ≥ snapshot count, or negative) → an INERT superscript marker (visible so the narrative's
 * footnote isn't silently lost, but non-interactive, no anchor, no scroll target).
 */
function AnswersCitationChip({
  snapshotIndex,
  snapshotCount,
  turnIndex,
}: {
  snapshotIndex: number;
  snapshotCount: number;
  turnIndex: number;
}) {
  const label = snapshotIndex + 1;
  const inRange = snapshotIndex >= 0 && snapshotIndex < snapshotCount;

  if (!inRange) {
    return (
      <sup
        className="tabular-nums text-caption text-muted-foreground"
        title="The cited insight is unavailable for this answer."
      >
        [{label}]
      </sup>
    );
  }

  return (
    <sup className="leading-none">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        // FORWARD leg — scroll the rail's insight row into view (cross-pane, turn-qualified target).
        onClick={(event) => scrollToInsight(event.currentTarget, turnIndex, snapshotIndex)}
        aria-label={`Jump to insight ${label}`}
        className="h-5 min-w-0 gap-0 rounded-full px-1.5 font-medium leading-none text-caption tabular-nums"
        // REVERSE target — the @brand/ui Button forwards data-* attrs so a rail row can scroll here.
        {...consoleAnchor(citationAnchorValue(turnIndex, snapshotIndex))}
      >
        {label}
      </Button>
    </sup>
  );
}

/**
 * One `snapshot` block — the referenced insight's data inset at its card position. Bounds-checked:
 * an out-of-range `index` (a dangling reference) renders nothing. The shared {@link AnswersSnapshotData}
 * itself renders nothing when the snapshot carries no hypercube `data`; when there IS neither data nor
 * anything else to show, we surface the snapshot's title as a minimal label so the block isn't a
 * silent gap (the full insight face — reason/definition — is WP 5.4's SourcesPanel `InsightRow`).
 */
function AnswersSnapshotBlock({
  index,
  snapshots,
}: {
  index: number;
  snapshots: AnswersSnapshot[];
}) {
  if (index < 0 || index >= snapshots.length) return null;
  const snapshot = snapshots[index];
  if (!snapshot) return null;

  if (snapshot.data) {
    return <AnswersSnapshotData snapshot={snapshot} variant="inset" />;
  }

  const title = snapshot.title?.trim();
  if (!title) return null;
  return (
    <Text variant="meta" tone="muted" className="min-w-0 text-pretty">
      {title}
    </Text>
  );
}
