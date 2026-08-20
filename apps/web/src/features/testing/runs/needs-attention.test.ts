import type { RunSummary } from "@mcp-token-footprint/shared";
import { describe, expect, test } from "vitest";
import { runNeedsAttention, selectRunsNeedingAttention } from "./needs-attention";

/** Minimal `RunSummary` builder — only the fields a given test cares about get overridden. */
function run(over: Partial<RunSummary> & { id: string }): RunSummary {
  return {
    testId: "test-1",
    scenarioId: "env-1",
    mode: "automated",
    status: "completed",
    startedAt: "2026-07-16T00:00:00.000Z",
    turns: 1,
    toolCalls: 0,
    peakContextTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    // `seen` defaults false server-side for every run — mirror that here so a test that doesn't
    // override it exercises the REAL default, not an accidentally-safe `true`.
    seen: false,
    ...over,
  };
}

// Unified Sessions (planning/Roadmap/completed/RM-29-unified-sessions/, WP3.3) — the execution-plan's own formula, verbatim:
// `pendingInput || (unseen && !running)`.
describe("runNeedsAttention", () => {
  test("pendingInput: a LIVE run paused on the operator (running + waiting_input) needs attention", () => {
    expect(
      runNeedsAttention(run({ id: "a", status: "running", phase: "waiting_input", seen: true })),
    ).toBe(true);
  });

  test("a running run with NO distinct phase (mid-turn) does not need attention", () => {
    expect(runNeedsAttention(run({ id: "a", status: "running", phase: undefined }))).toBe(false);
  });

  test("a running run queued/starting (not waiting_input) does not need attention", () => {
    expect(runNeedsAttention(run({ id: "a", status: "running", phase: "starting" }))).toBe(false);
  });

  test("unseen && !running: an unseen FINISHED run needs attention", () => {
    expect(runNeedsAttention(run({ id: "a", status: "completed", seen: false }))).toBe(true);
    expect(runNeedsAttention(run({ id: "a", status: "stopped", seen: false }))).toBe(true);
    expect(runNeedsAttention(run({ id: "a", status: "error", seen: false }))).toBe(true);
    expect(runNeedsAttention(run({ id: "a", status: "ended", seen: false }))).toBe(true);
  });

  test("a SEEN finished run does not need attention", () => {
    expect(runNeedsAttention(run({ id: "a", status: "completed", seen: true }))).toBe(false);
  });

  test("a currently-running (not paused) run is never flagged purely for being unseen", () => {
    expect(runNeedsAttention(run({ id: "a", status: "running", seen: false }))).toBe(false);
  });

  test("seen undefined (a fixture/payload without the field) is NOT treated as unseen — no false positive", () => {
    const { seen: _drop, ...withoutSeen } = run({ id: "a", status: "completed", seen: false });
    expect(runNeedsAttention(withoutSeen as RunSummary)).toBe(false);
  });

  test("an unseen PENDING run also needs attention (the literal formula's !running includes pending)", () => {
    expect(runNeedsAttention(run({ id: "a", status: "pending", seen: false }))).toBe(true);
  });
});

describe("selectRunsNeedingAttention", () => {
  test("filters down to only the flagged runs, preserving input order", () => {
    const runs = [
      run({ id: "a", status: "completed", seen: true }), // seen — excluded
      run({ id: "b", status: "running", phase: "waiting_input" }), // pendingInput — included
      run({ id: "c", status: "error", seen: false }), // unseen terminal — included
      run({ id: "d", status: "running", seen: false }), // running, no pause — excluded
    ];
    expect(selectRunsNeedingAttention(runs).map((r) => r.id)).toEqual(["b", "c"]);
  });

  test("an empty list yields an empty list", () => {
    expect(selectRunsNeedingAttention([])).toEqual([]);
  });
});
