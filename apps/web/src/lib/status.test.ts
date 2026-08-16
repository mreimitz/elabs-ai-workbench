import { describe, expect, test } from "vitest";
import type { RunStatus, StopReasonCode } from "@mcp-token-footprint/shared";
import { RUN_STATUSES, STOP_REASON_CODES } from "@mcp-token-footprint/shared";
import {
  CLOSED_BADGE_STATUS_TONE,
  deriveRunStatusView,
  deriveStatusView,
  isReviewPending,
  isTerminalRunStatus,
  REVIEWING_STATUS_VIEW,
  type RunStatusInput,
} from "./status";

// Unified Sessions (roadmap/unified-sessions/, WP3.1, D-US5) — behavior lock for the LOCKED label
// table (execution-plan.md §1). Every row renders through `deriveRunStatusView`, the ONE derivation
// `(status, outcome, stopReasonCode, phase, ratingState) → {label, tone, spinner}` every run/session
// status surface adopts. This test covers EVERY row, including all 15 `StopReasonCode`s, so no surface
// can silently drift off-table.

function chip(input: RunStatusInput) {
  const view = deriveRunStatusView(input);
  if (view.kind !== "chip") throw new Error("expected a chip view");
  return view;
}

describe("deriveRunStatusView — the locked label table (D-US5)", () => {
  test("pending + phase queued → Queued, gray dashed, no spinner", () => {
    const view = chip({ status: "pending", phase: "queued" });
    expect(view).toEqual({ kind: "chip", label: "Queued", tone: "pending", spinner: false, dashed: true });
  });

  test("pending + phase queued + position → Queued with the position enrichment", () => {
    const view = chip({ status: "pending", phase: "queued", queuePosition: 3 });
    expect(view.label).toBe("Queued — position 3");
    expect(view.tone).toBe("pending");
    expect(view.dashed).toBe(true);
  });

  test("pending, no phase (and pending + phase starting, undistinguished) → Pending, gray dashed", () => {
    expect(chip({ status: "pending" })).toEqual({
      kind: "chip",
      label: "Pending",
      tone: "pending",
      spinner: false,
      dashed: true,
    });
    // `starting` has no distinct row in the locked table — reads as plain Pending.
    expect(chip({ status: "pending", phase: "starting" }).label).toBe("Pending");
  });

  test("running → Running, blue + spinner", () => {
    expect(chip({ status: "running" })).toEqual({
      kind: "chip",
      label: "Running",
      tone: "info",
      spinner: true,
      dashed: false,
    });
  });

  test("running + waiting_input → Waiting for you, blue outline, NO spinner", () => {
    expect(chip({ status: "running", phase: "waiting_input" })).toEqual({
      kind: "chip",
      label: "Waiting for you",
      tone: "info",
      spinner: false,
      dashed: false,
    });
  });

  test("running + stopping → Stopping…, gray + spinner", () => {
    expect(chip({ status: "running", phase: "stopping" })).toEqual({
      kind: "chip",
      label: "Stopping…",
      tone: "neutral",
      spinner: true,
      dashed: false,
    });
  });

  test("terminal + ratingState pending/rating → Reviewing…, blue + spinner, REGARDLESS of outcome", () => {
    const reviewing = { kind: "chip", label: "Reviewing…", tone: "info", spinner: true, dashed: false };
    expect(chip({ status: "completed", outcome: "completed", ratingState: "pending" })).toEqual(
      reviewing,
    );
    expect(chip({ status: "completed", outcome: "completed", ratingState: "rating" })).toEqual(
      reviewing,
    );
    expect(chip({ status: "error", outcome: "error", ratingState: "rating" })).toEqual(reviewing);
    expect(
      chip({ status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "max_turns", ratingState: "pending" }),
    ).toEqual(reviewing);
    expect(chip({ status: "aborted", outcome: "aborted", ratingState: "pending" })).toEqual(reviewing);
    // The overlay is the exported shared constant — every adopter renders the SAME object.
    expect(deriveRunStatusView({ status: "completed", ratingState: "rating" })).toBe(
      REVIEWING_STATUS_VIEW,
    );
  });

  test("terminal + settled/absent ratingState renders the normal terminal chip, not Reviewing…", () => {
    for (const ratingState of ["rated", "failed", "skipped", undefined, null] as const) {
      const view = chip({ status: "completed", outcome: "completed", ratingState });
      expect(view.label).toBe("Completed");
    }
  });

  test("a LIVE run (pending/running) never reads Reviewing…, even with a stray pending ratingState", () => {
    expect(chip({ status: "running", ratingState: "pending" }).label).toBe("Running");
    expect(chip({ status: "pending", ratingState: "rating" }).label).toBe("Pending");
  });

  test("completed → Completed, green outline", () => {
    expect(chip({ status: "completed", outcome: "completed" })).toEqual({
      kind: "chip",
      label: "Completed",
      tone: "success",
      spinner: false,
      dashed: false,
    });
  });

  test("ended → Ended, green outline (distinct from Completed)", () => {
    expect(chip({ status: "ended", outcome: "ended", stopReasonCode: "session_ended" })).toEqual({
      kind: "chip",
      label: "Ended",
      tone: "success",
      spinner: false,
      dashed: false,
    });
  });

  // The 7 guardrail-meter codes — `stopped` + each renders "Stopped — <suffix>", amber outline.
  const GUARDRAIL_SUFFIXES: [StopReasonCode, string][] = [
    ["max_duration", "time limit"],
    ["max_turns", "turn limit"],
    ["max_tokens", "token limit"],
    ["max_context_tokens", "context limit"],
    ["max_cost", "cost limit"],
    ["max_tool_calls", "tool-call limit"],
    ["stalled", "stalled"],
  ];
  test.each(GUARDRAIL_SUFFIXES)("stopped + %s → Stopped — %s, amber outline", (code, suffix) => {
    const view = chip({ status: "stopped", outcome: "stopped_guardrail", stopReasonCode: code });
    expect(view).toEqual({
      kind: "chip",
      label: `Stopped — ${suffix}`,
      tone: "warning",
      spinner: false,
      dashed: false,
    });
  });

  test("stopped + wait_expired → Expired, gray outline", () => {
    expect(chip({ status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "wait_expired" })).toEqual({
      kind: "chip",
      label: "Expired",
      tone: "neutral",
      spinner: false,
      dashed: false,
    });
  });

  test("stopped + prompt_rejected → Rejected by assistant, amber outline", () => {
    expect(
      chip({ status: "stopped", outcome: "stopped_guardrail", stopReasonCode: "prompt_rejected" }),
    ).toEqual({
      kind: "chip",
      label: "Rejected by assistant",
      tone: "warning",
      spinner: false,
      dashed: false,
    });
  });

  test("context_overflow (outcome OR stopReasonCode) → Context overflow, amber outline", () => {
    const byOutcome = chip({
      status: "stopped",
      outcome: "context_overflow",
      stopReasonCode: "context_overflow",
    });
    expect(byOutcome).toEqual({
      kind: "chip",
      label: "Context overflow",
      tone: "warning",
      spinner: false,
      dashed: false,
    });
    // Even if only the code is present (defensive — the two always co-occur per `terminalFor`).
    expect(chip({ status: "stopped", stopReasonCode: "context_overflow" }).label).toBe(
      "Context overflow",
    );
  });

  test("aborted → Stopped by you, gray outline", () => {
    expect(chip({ status: "aborted", outcome: "aborted", stopReasonCode: "user_stop" })).toEqual({
      kind: "chip",
      label: "Stopped by you",
      tone: "neutral",
      spinner: false,
      dashed: false,
    });
  });

  // The 3 error codes all render the SAME "Failed" label — the specific cause isn't distinguished in
  // the badge (it's error-forensics/report material, not a status-chip concern).
  test.each(["provider_error", "auth", "rate_limit"] as const)(
    "error + %s → Failed, red filled",
    (code) => {
      expect(chip({ status: "error", outcome: "error", stopReasonCode: code })).toEqual({
        kind: "chip",
        label: "Failed",
        tone: "danger",
        spinner: false,
        dashed: false,
      });
    },
  );

  test("outcome assertions_failed → Assertions failed, amber outline (overrides the plain `completed` status)", () => {
    expect(chip({ status: "completed", outcome: "assertions_failed" })).toEqual({
      kind: "chip",
      label: "Assertions failed",
      tone: "warning",
      spinner: false,
      dashed: false,
    });
  });

  test("a pre-contract `stopped` run (no stopReasonCode) falls back to the generic wire vocabulary, never a raw string", () => {
    expect(chip({ status: "stopped", outcome: "stopped_guardrail" }).label).toBe("Stopped (guardrail)");
    // No outcome either — the ultimate defensive fallback.
    expect(deriveRunStatusView({ status: "stopped" }).kind).toBe("chip");
  });

  test("every StopReasonCode is accounted for by SOME table row (no silent drop)", () => {
    // Realistic (status, outcome) pairing per `apps/api/src/testing/session-terminal.ts` terminalFor() —
    // the single writer of this triple — so this doubles as a cross-check that the web derivation and
    // the API's terminal table agree on what a real run looks like.
    const REALISTIC_PAIRING: Record<StopReasonCode, { status: RunStatusInput["status"]; outcome: RunStatusInput["outcome"] }> = {
      user_stop: { status: "aborted", outcome: "aborted" },
      session_ended: { status: "ended", outcome: "ended" },
      max_duration: { status: "stopped", outcome: "stopped_guardrail" },
      stalled: { status: "stopped", outcome: "stopped_guardrail" },
      wait_expired: { status: "stopped", outcome: "stopped_guardrail" },
      max_turns: { status: "stopped", outcome: "stopped_guardrail" },
      max_tokens: { status: "stopped", outcome: "stopped_guardrail" },
      max_context_tokens: { status: "stopped", outcome: "stopped_guardrail" },
      max_cost: { status: "stopped", outcome: "stopped_guardrail" },
      max_tool_calls: { status: "stopped", outcome: "stopped_guardrail" },
      context_overflow: { status: "stopped", outcome: "context_overflow" },
      prompt_rejected: { status: "stopped", outcome: "stopped_guardrail" },
      provider_error: { status: "error", outcome: "error" },
      auth: { status: "error", outcome: "error" },
      rate_limit: { status: "error", outcome: "error" },
    };
    expect(Object.keys(REALISTIC_PAIRING).sort()).toEqual([...STOP_REASON_CODES].sort());
    for (const code of STOP_REASON_CODES) {
      const pairing = REALISTIC_PAIRING[code];
      const view = chip({ status: pairing.status, outcome: pairing.outcome, stopReasonCode: code });
      // Never a raw/off-table string (no leaked snake_case, no bare stopReasonCode literal).
      expect(view.label).not.toMatch(/_/);
      expect(view.label.length).toBeGreaterThan(0);
    }
  });
});

// WP3.fix (WP3.R Defect 1) — `isTerminalRunStatus` is the ONE terminal classifier `RunConsole.tsx`,
// `RunConsoleRoute.tsx`, and `AnalyticsPanel.tsx` now share (replacing two identical private copies
// that OMITTED `ended`, so an operator-ended interactive session opened in the live shell instead of
// replay/read-only). This locks its full RUN_STATUSES coverage, including the regression itself.
describe("isTerminalRunStatus — the shared terminal classifier (WP3.fix)", () => {
  test("completed, stopped, error, aborted, AND ended are all terminal", () => {
    expect(isTerminalRunStatus("completed")).toBe(true);
    expect(isTerminalRunStatus("stopped")).toBe(true);
    expect(isTerminalRunStatus("error")).toBe(true);
    expect(isTerminalRunStatus("aborted")).toBe(true);
    // The regression this WP fixes: `ended` was missing from two private copies of this check.
    expect(isTerminalRunStatus("ended")).toBe(true);
  });

  test("pending and running are NOT terminal", () => {
    expect(isTerminalRunStatus("pending")).toBe(false);
    expect(isTerminalRunStatus("running")).toBe(false);
  });

  test("exhaustively covers every RunStatus (no future member silently falls through)", () => {
    const expectedTerminal: Record<RunStatus, boolean> = {
      pending: false,
      running: false,
      completed: true,
      stopped: true,
      error: true,
      aborted: true,
      ended: true,
    };
    for (const status of RUN_STATUSES) {
      expect(isTerminalRunStatus(status)).toBe(expectedTerminal[status]);
    }
    expect(RUN_STATUSES.length).toBe(Object.keys(expectedTerminal).length);
  });
});

describe("isReviewPending", () => {
  test("pending / rating are in flight; settled/absent reads settled", () => {
    expect(isReviewPending("pending")).toBe(true);
    expect(isReviewPending("rating")).toBe(true);
    expect(isReviewPending("rated")).toBe(false);
    expect(isReviewPending("failed")).toBe(false);
    expect(isReviewPending("skipped")).toBe(false);
    expect(isReviewPending(undefined)).toBe(false);
    expect(isReviewPending(null)).toBe(false);
  });
});

describe("CLOSED_BADGE_STATUS_TONE — the legacy-enum bridge", () => {
  test("covers every value of the closed @brand/ui-style status enum", () => {
    expect(CLOSED_BADGE_STATUS_TONE).toEqual({
      pending: "pending",
      running: "info",
      complete: "success",
      failed: "danger",
      denied: "warning",
      skipped: "neutral",
    });
  });
});

// The GENERIC vocabulary (`deriveStatusView`) stays behavior-locked — this WP adds a DIFFERENT,
// run/session-specific function (`deriveRunStatusView`) rather than repurposing the generic one, so
// its existing non-run consumers (scans, step statuses, …) are provably untouched.
describe("deriveStatusView — unaffected by the WP3.1 run/session addition", () => {
  test("still renders the pre-existing generic vocabulary exactly as before", () => {
    expect(deriveStatusView("aborted")).toEqual({
      kind: "chip",
      label: "Aborted",
      tone: "neutral",
      spinner: false,
      dashed: false,
    });
    expect(deriveStatusView("stopped_guardrail")).toEqual({
      kind: "chip",
      label: "Stopped (guardrail)",
      tone: "warning",
      spinner: false,
      dashed: false,
    });
  });
});
