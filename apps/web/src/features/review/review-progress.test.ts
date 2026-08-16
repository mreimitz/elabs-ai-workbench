import { describe, expect, test } from "vitest";
import type { ReviewRubric, RunSummary } from "@mcp-token-footprint/shared";
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

describe("isRunReviewed", () => {
  test("false when the run carries no feedback at all", () => {
    expect(isRunReviewed(run(undefined), RUBRIC)).toBe(false);
  });

  test("false when only SOME rubric keys have a feedback entry (a skip / partial review)", () => {
    expect(isRunReviewed(run([{ key: "helpful", score: 1 }]), RUBRIC)).toBe(false);
  });

  test("true once EVERY rubric key has an entry — even a note-only key whose score is null", () => {
    expect(
      isRunReviewed(
        run([
          { key: "helpful", score: 1 },
          { key: "clarity", score: 4 },
          { key: "notes", score: null }, // a comment-only row still has a run_feedback row → present
        ]),
        RUBRIC,
      ),
    ).toBe(true);
  });

  test("extra, non-rubric feedback keys don't matter either way", () => {
    expect(
      isRunReviewed(
        run([
          { key: "helpful", score: 1 },
          { key: "clarity", score: 4 },
          { key: "notes", score: null },
          { key: "verdict", score: 1 }, // e.g. the WP2.5 thumbs control, unrelated to this rubric
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
        { key: "helpful", score: 1 },
        { key: "clarity", score: 4 },
        { key: "notes", score: null },
      ]), // fully reviewed
      run([{ key: "helpful", score: -1 }]), // skipped after one key
      run(undefined), // never opened / fully skipped
      run([
        { key: "helpful", score: 1 },
        { key: "clarity", score: 2 },
        { key: "notes", score: null },
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
    expect(missingKeys(run([{ key: "clarity", score: 3 }]), RUBRIC)).toEqual(["helpful", "notes"]);
  });

  test("empty once every key is answered", () => {
    expect(
      missingKeys(
        run([
          { key: "helpful", score: 1 },
          { key: "clarity", score: 4 },
          { key: "notes", score: null },
        ]),
        RUBRIC,
      ),
    ).toEqual([]);
  });
});

describe("withUpsertedFeedback", () => {
  test("adds a new entry for a key the run didn't have yet", () => {
    const next = withUpsertedFeedback(run([{ key: "helpful", score: 1 }]), "clarity", 4);
    expect(next.feedback).toEqual([
      { key: "helpful", score: 1 },
      { key: "clarity", score: 4 },
    ]);
  });

  test("REPLACES (not appends) the existing entry for the SAME key — upsert semantics", () => {
    const next = withUpsertedFeedback(run([{ key: "helpful", score: 1 }]), "helpful", -1);
    expect(next.feedback).toEqual([{ key: "helpful", score: -1 }]);
  });

  test("never mutates the input run", () => {
    const original = run([{ key: "helpful", score: 1 }]);
    const snapshot = JSON.parse(JSON.stringify(original));
    withUpsertedFeedback(original, "clarity", 4);
    expect(original).toEqual(snapshot);
  });
});
