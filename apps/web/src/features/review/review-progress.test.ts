import { describe, expect, test } from "vitest";
import type { ReviewRubric, RunFeedback, RunSummary } from "@mcp-token-footprint/shared";
import { countReviewed, isRunReviewed, missingKeys, withUpsertedFeedback } from "./review-progress";

const RUBRIC: ReviewRubric = {
  id: "rub-1",
  name: "Answer quality",
  keys: [
    { key: "helpful", kind: "thumbs" },
    { key: "clarity", kind: "scale5" },
    { key: "notes", kind: "note" },
  ],
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};

function run(feedback: RunSummary["feedback"]): RunSummary {
  return { id: "run-1", feedback } as RunSummary;
}

/** AM-OB2 — `RunFeedbackSummary` gained a REQUIRED `hasComment`; these fixtures carry no text. */
function fb(key: string, score: number | null, hasComment = false) {
  return { key, score, hasComment };
}

/** A saved `run_feedback` row, the shape `withUpsertedFeedback` now takes. */
function savedRow(key: string, score: number | null, comment?: string): RunFeedback {
  return {
    id: `fb-${key}`,
    runId: "run-1",
    key,
    ...(score !== null ? { score } : {}),
    ...(comment !== undefined ? { comment } : {}),
    source: "human",
    createdAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("isRunReviewed", () => {
  test("false when the run carries no feedback at all", () => {
    expect(isRunReviewed(run(undefined), RUBRIC)).toBe(false);
  });

  test("false when only SOME rubric keys have a feedback entry (a skip / partial review)", () => {
    expect(isRunReviewed(run([fb("helpful", 1)]), RUBRIC)).toBe(false);
  });

  test("true once EVERY rubric key has an entry — even a note-only key whose score is null", () => {
    expect(
      isRunReviewed(
        run([
          fb("helpful", 1),
          fb("clarity", 4),
          fb("notes", null), // a comment-only row still has a run_feedback row → present
        ]),
        RUBRIC,
      ),
    ).toBe(true);
  });

  test("extra, non-rubric feedback keys don't matter either way", () => {
    expect(
      isRunReviewed(
        run([
          fb("helpful", 1),
          fb("clarity", 4),
          fb("notes", null),
          fb("verdict", 1), // e.g. the WP2.5 thumbs control, unrelated to this rubric
        ]),
        RUBRIC,
      ),
    ).toBe(true);
  });
});

describe("countReviewed (incl. skips)", () => {
  test("counts only the FULLY reviewed runs — a skipped/partial run doesn't count", () => {
    const runs = [
      run([
        fb("helpful", 1),
        fb("clarity", 4),
        fb("notes", null),
      ]), // fully reviewed
      run([fb("helpful", -1)]), // skipped after one key
      run(undefined), // never opened / fully skipped
      run([
        fb("helpful", 1),
        fb("clarity", 2),
        fb("notes", null),
      ]), // fully reviewed
    ];
    expect(countReviewed(runs, RUBRIC)).toBe(2);
  });

  test("an empty queue reviews 0/0", () => {
    expect(countReviewed([], RUBRIC)).toBe(0);
  });
});

describe("missingKeys", () => {
  test("lists the keys still lacking a feedback entry, in rubric order", () => {
    expect(missingKeys(run([fb("clarity", 3)]), RUBRIC)).toEqual(["helpful", "notes"]);
  });

  test("empty once every key is answered", () => {
    expect(
      missingKeys(
        run([
          fb("helpful", 1),
          fb("clarity", 4),
          fb("notes", null),
        ]),
        RUBRIC,
      ),
    ).toEqual([]);
  });
});

describe("withUpsertedFeedback", () => {
  test("adds a new entry for a key the run didn't have yet", () => {
    const next = withUpsertedFeedback(run([fb("helpful", 1)]), savedRow("clarity", 4));
    expect(next.feedback).toEqual([fb("helpful", 1), fb("clarity", 4)]);
  });

  test("REPLACES (not appends) the existing entry for the SAME key — upsert semantics", () => {
    const next = withUpsertedFeedback(run([fb("helpful", 1)]), savedRow("helpful", -1));
    expect(next.feedback).toEqual([fb("helpful", -1)]);
  });

  test("never mutates the input run", () => {
    const original = run([fb("helpful", 1)]);
    const snapshot = JSON.parse(JSON.stringify(original));
    withUpsertedFeedback(original, savedRow("clarity", 4));
    expect(original).toEqual(snapshot);
  });

  // AM-OB2 — a comment-only row (a corrected answer, a note rubric key) has NO score. Before
  // `hasComment` existed the aggregate recorded it as `{score: null}` and every chip dropped it, so
  // a captured correction was indistinguishable from an untouched run.
  test("a comment-only saved row lands as hasComment: true with a null score", () => {
    const next = withUpsertedFeedback(
      run([fb("helpful", 1)]),
      savedRow("corrected_output", null, "The right answer."),
    );
    expect(next.feedback).toEqual([fb("helpful", 1), fb("corrected_output", null, true)]);
  });

  test("whitespace-only text is NOT a comment (it would claim a note nobody can read)", () => {
    const next = withUpsertedFeedback(run([]), savedRow("notes", null, "   "));
    expect(next.feedback).toEqual([fb("notes", null, false)]);
  });
});
