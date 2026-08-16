import { useCallback, useEffect, useState } from "react";
import type { RunFeedback } from "@mcp-token-footprint/shared";
import { listRunFeedback } from "../../lib/api";

/**
 * Observability WP 2.5 (D-OB15) — the run's per-turn "Your verdict" feedback, batched: ONE
 * `listRunFeedback` call per run mount, narrowed to run-LEVEL feedback's step-scoped counterpart —
 * every `key: "verdict"` row that carries a `stepId` — keyed by that step id so each turn card (in
 * `ConversationPane`'s `AssistantTurn` AND, since Observability WP3.4, `TurnsLens`'s `TurnCard`) can
 * look up its own row with zero network. A failed/slow fetch just leaves turns unset (best-effort,
 * like every other cosmetic lookup); it never blocks or errors the transcript. `onChange` is handed to
 * each turn's `FeedbackControl` so a write updates this shared map in place.
 *
 * Extracted into its own module (rather than living inside `ConversationPane.tsx`, where it started)
 * so a caller that only needs the DATA — not the full chat surface and its `@brand/ai` weight — can
 * import it without pulling that in. `ConversationPane` and `TurnsLens` are mutually exclusive console
 * tabs (only one is ever mounted at a time), so each mounting its own instance is never a redundant
 * simultaneous fetch — just the same batched-lookup shape reused per-mount.
 */
export function useTurnFeedback(
  runId: string | null,
): [Map<string, RunFeedback>, { onChange: (stepId: string, next: RunFeedback | undefined) => void }] {
  const [byStepId, setByStepId] = useState<Map<string, RunFeedback>>(new Map());

  useEffect(() => {
    let alive = true;
    setByStepId(new Map());
    if (runId === null) return;
    listRunFeedback(runId)
      .then((rows) => {
        if (!alive) return;
        const next = new Map<string, RunFeedback>();
        for (const row of rows) {
          if (row.key === "verdict" && row.stepId !== undefined) next.set(row.stepId, row);
        }
        setByStepId(next);
      })
      .catch(() => {
        /* cosmetic lookup — turns simply render with no feedback control state pre-filled */
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  const onChange = useCallback((stepId: string, next: RunFeedback | undefined) => {
    setByStepId((prev) => {
      const copy = new Map(prev);
      if (next) copy.set(stepId, next);
      else copy.delete(stepId);
      return copy;
    });
  }, []);

  return [byStepId, { onChange }];
}
