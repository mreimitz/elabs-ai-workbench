// Observability — the corrected-answer selector (RM-17 Phase 6, AM-OB2).
//
// ONE definition of "what corrected answer does this run carry", shared by the promote-to-test
// builder (`apps/api/src/watch/promote.ts`), the run export (`apps/api/src/reports/*`) and the web
// surfaces (run console, review queue, promote dialog). Pure: no database, no clock, no network —
// it only reads an already-fetched list of `run_feedback` rows.
//
// It exists as its own module for the same reason `watch-state.ts` does (AM-OB10): three call sites
// asking the same question must not each answer it slightly differently. Two rules the callers must
// NOT re-derive locally:
//
//   1. RUN-LEVEL only. A `corrected_output` row scoped to a single step (`stepId` set) is a
//      correction of that TURN, not of the run's answer, and must never become the draft test's
//      expectation. The console writes the run-level row; the filter here is what keeps a
//      hypothetical step-level one out.
//   2. LAST WRITE WINS, matching `fetchRunFeedbackSummaries`' own aggregate. The upsert identity is
//      (run, step, key, source), so in practice there is at most one `human` row — but an `auto`
//      row under the same key is expressible on the wire, and the two must resolve the same way
//      everywhere.
//
// ABSENCE IS NOT A RESULT. `undefined` means "no correction was CAPTURED". It never means "the
// answer needed no correction" — nothing in this app records that judgement, and a surface that
// renders the two the same way is lying (the AM-OB10 / AM-OB4 precedent in this phase).
//
// AR6 / D-OB15: nothing here is a grade. A corrected answer is never read by a grader, never enters
// `run_grades`, `meanScore`, suite aggregates or issue scoring, and never re-scores the run it came
// from. Its ONE downstream consumer is the expectation of a NEWLY CREATED draft test.

import { RUN_FEEDBACK_KEY_CORRECTED_OUTPUT } from "./constants.js";
import type { RunFeedback, RunReportHumanFeedback } from "./types.js";

/**
 * The run's corrected answer, or `undefined` when none was captured.
 *
 * `rows` is the full `GET /api/runs/:id/feedback` list — NOT `RunSummary.feedback`, which drops the
 * text by design (it reports only `hasComment`).
 */
export function selectCorrectedOutput(rows: readonly RunFeedback[]): string | undefined {
  let found: string | undefined;
  for (const row of rows) {
    if (row.key !== RUN_FEEDBACK_KEY_CORRECTED_OUTPUT) continue;
    if (row.stepId !== undefined) continue; // rule 1 — run-level only
    const text = row.comment?.trim();
    // A row whose text was cleared to whitespace carries no correction; keep looking rather than
    // letting it mask an earlier real one only to then read as "captured but empty".
    if (text === undefined || text.length === 0) continue;
    found = text; // rule 2 — last write wins (rows arrive oldest-first)
  }
  return found;
}

/**
 * Build the export's `humanFeedback` block from the run's rows. Passing `[]` is meaningful and
 * different from not calling this at all: it produces `{ entries: [] }`, which says "we looked and
 * there is none" (see {@link RunReportHumanFeedback}).
 */
export function buildRunReportHumanFeedback(
  rows: readonly RunFeedback[],
): RunReportHumanFeedback {
  const correctedOutput = selectCorrectedOutput(rows);
  return {
    entries: [...rows],
    ...(correctedOutput !== undefined ? { correctedOutput } : {}),
  };
}
