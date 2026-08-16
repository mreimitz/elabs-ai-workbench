import { describe, expect, test } from "vitest";
import { deriveRunStatusView } from "../../lib/status";
import {
  deriveRunBarView,
  isReviewInFlight,
  runStatusBadgeStatus,
  runStatusBadgeView,
} from "./RunBar";

// (The suite-side `suiteStatusBadge` review-awareness is locked in `suites/SuiteRunConsole.test.tsx`,
// which already neutralizes that module's heavy chart imports.)

// Behaviour lock for the review-aware status decision (Auto-Rating AR11): a TERMINAL run/suite whose
// post-run review hasn't settled reads as ONE blue-spinner "Reviewing…" chip everywhere; a settled
// (or absent) rating renders exactly today's terminal view — including a FAILED review, which must
// never turn the run red (the Report tab surfaces the rating failure).

describe("isReviewInFlight", () => {
  test("pending / rating are in flight", () => {
    expect(isReviewInFlight("pending")).toBe(true);
    expect(isReviewInFlight("rating")).toBe(true);
  });

  test("rated / failed / skipped are settled; absent reads settled (older payloads)", () => {
    expect(isReviewInFlight("rated")).toBe(false);
    expect(isReviewInFlight("failed")).toBe(false);
    expect(isReviewInFlight("skipped")).toBe(false);
    expect(isReviewInFlight(undefined)).toBe(false);
    expect(isReviewInFlight(null)).toBe(false);
  });
});

// WP3.fix (WP3.R Defect 2, D-US5 conformance sweep) — `runStatusBadgeView` no longer returns the
// coarse `{status, label}` pair; it's the bridge every "render a run's OWN status" surface routes
// through, delegating straight to the LOCKED table (`deriveRunStatusView`, `lib/status.ts`) and
// returning the full `StatusView` (label + tone + spinner/dashed). The coarse 5-value bucket some
// callers still genuinely need (facets, rollups, the decorative `StatusIcon`) is `runStatusBadgeStatus`
// — a SEPARATE, still-coarse function (locked below).
describe("runStatusBadgeView — the locked-table bridge (WP3.fix, D-US5)", () => {
  test("terminal + pending/rating → the Reviewing… view, for EVERY terminal status/outcome", () => {
    const reviewing = { kind: "chip", label: "Reviewing…", tone: "info", spinner: true, dashed: false };
    expect(runStatusBadgeView("completed", "completed", "pending")).toEqual(reviewing);
    expect(runStatusBadgeView("completed", "completed", "rating")).toEqual(reviewing);
    expect(runStatusBadgeView("error", "error", "rating")).toEqual(reviewing);
    expect(runStatusBadgeView("aborted", "aborted", "pending")).toEqual(reviewing);
  });

  test("a settled rating renders today's terminal view — a FAILED review never turns the run red", () => {
    const completed = { kind: "chip", label: "Completed", tone: "success", spinner: false, dashed: false };
    expect(runStatusBadgeView("completed", "completed", "rated")).toEqual(completed);
    expect(runStatusBadgeView("completed", "completed", "failed")).toEqual(completed);
    // `skipped` behaves like settled.
    expect(runStatusBadgeView("completed", "completed", "skipped")).toEqual(completed);
  });

  test("no stopReasonCode (older payload) falls back to the pre-contract generic wording", () => {
    expect(runStatusBadgeView("stopped", "stopped_guardrail", undefined)).toEqual({
      kind: "chip",
      label: "Stopped (guardrail)",
      tone: "warning",
      spinner: false,
      dashed: false,
    });
    expect(runStatusBadgeView("error", "error", undefined)).toEqual({
      kind: "chip",
      label: "Failed",
      tone: "danger",
      spinner: false,
      dashed: false,
    });
  });

  test("WP3.R Defect 2: WITH stopReasonCode, the precise locked-table label/tone renders — the exact bug the sweep fixes", () => {
    // Before this WP: `wait_expired` rendered "Stopped (guardrail)" (amber) via the generic mapper.
    expect(runStatusBadgeView("stopped", "stopped_guardrail", "rated", "wait_expired")).toEqual({
      kind: "chip",
      label: "Expired",
      tone: "neutral",
      spinner: false,
      dashed: false,
    });
    // Before this WP: `context_overflow` rendered red (`error`-bucket) instead of amber.
    expect(
      runStatusBadgeView("stopped", "context_overflow", "rated", "context_overflow"),
    ).toEqual({
      kind: "chip",
      label: "Context overflow",
      tone: "warning",
      spinner: false,
      dashed: false,
    });
    expect(runStatusBadgeView("stopped", "stopped_guardrail", "rated", "stalled")).toEqual({
      kind: "chip",
      label: "Stopped — stalled",
      tone: "warning",
      spinner: false,
      dashed: false,
    });
  });

  test("a LIVE run is Running, never Reviewing — even with a stray pending ratingState; `waiting_input` reads Waiting for you", () => {
    expect(runStatusBadgeView("running", undefined, "pending")).toEqual({
      kind: "chip",
      label: "Running",
      tone: "info",
      spinner: true,
      dashed: false,
    });
    // Before this WP: `runStatusBadgeView` had no `phase` param at all — WP3.R Defect 2, "waiting_input
    // → Running" instead of the locked table's "Waiting for you".
    expect(
      runStatusBadgeView("running", undefined, undefined, undefined, "waiting_input"),
    ).toEqual({ kind: "chip", label: "Waiting for you", tone: "info", spinner: false, dashed: false });
  });

  test("mirrors deriveRunStatusView exactly (it's a thin positional-args wrapper)", () => {
    expect(runStatusBadgeView("stopped", "stopped_guardrail", "rated", "wait_expired", null)).toEqual(
      deriveRunStatusView({
        status: "stopped",
        outcome: "stopped_guardrail",
        ratingState: "rated",
        stopReasonCode: "wait_expired",
        phase: null,
      }),
    );
  });
});

// The coarse 5-value bucket a FEW surfaces still genuinely need on purpose (facets, rollups, a
// decorative status dot) — `runStatusBadgeStatus`, unchanged in return shape, now review-aware via an
// optional 3rd `ratingState` param (every existing 2-arg call site keeps compiling/behaving as before).
describe("runStatusBadgeStatus — the coarse bucket (facets/rollups/decorative dot)", () => {
  test("2-arg calls (no ratingState) behave exactly as before", () => {
    expect(runStatusBadgeStatus("completed", "completed")).toBe("complete");
    expect(runStatusBadgeStatus("stopped", "stopped_guardrail")).toBe("denied");
    expect(runStatusBadgeStatus("error", "error")).toBe("failed");
    expect(runStatusBadgeStatus("running", undefined)).toBe("running");
    expect(runStatusBadgeStatus("pending", undefined)).toBe("pending");
  });

  test("review-aware when ratingState is supplied: a terminal run still being rated buckets as running", () => {
    expect(runStatusBadgeStatus("completed", "completed", "pending")).toBe("running");
    expect(runStatusBadgeStatus("completed", "completed", "rating")).toBe("running");
    expect(runStatusBadgeStatus("completed", "completed", "rated")).toBe("complete");
  });
});

// Unified Sessions (roadmap/unified-sessions/, WP3.1) — `deriveRunBarView` now ALSO returns a
// `statusView` computed via the ONE locked-table derivation (`lib/status.ts` `deriveRunStatusView`),
// which `RunBar`'s own badge renders through the app-local `StatusBadge` (replacing the previous
// `@brand/ui`-closed-enum + hand-typed `PHASE_LABEL` render). This locks that adoption, the WP1.1
// `ended` stub's real fix (its own phase + "Ended" label, distinct from `completed`), and that the old
// `guardrailFromReason` free-text sniff is gone (trippedMeter now reads the machine-readable
// `stopReasonCode`, not a substring match on the human `stopReason`).
describe("deriveRunBarView — statusView adoption + the ended-phase fix (WP3.1)", () => {
  test("outcome `ended` gets its OWN phase + the locked table's Ended label — no longer aliased to completed", () => {
    const view = deriveRunBarView("ended", "ended", undefined, "session_ended");
    expect(view.phase).toBe("ended");
    expect(view.phase).not.toBe("completed");
    expect(view.statusView).toEqual(deriveRunStatusView({ status: "ended", outcome: "ended", stopReasonCode: "session_ended" }));
    expect(view.statusView).toEqual({
      kind: "chip",
      label: "Ended",
      tone: "success",
      spinner: false,
      dashed: false,
    });
  });

  test("status `ended` (outcome absent) also gets the ended phase", () => {
    expect(deriveRunBarView("ended", undefined, undefined).phase).toBe("ended");
  });

  test("statusView mirrors deriveRunStatusView for a plain completed run", () => {
    const view = deriveRunBarView("completed", "completed", undefined);
    expect(view.statusView).toEqual(deriveRunStatusView({ status: "completed", outcome: "completed" }));
  });

  test("trippedMeter reads the machine-readable stopReasonCode, not a stopReason text sniff", () => {
    // A human `stopReason` string containing NONE of the old keywords, paired with a real code — the
    // OLD `guardrailFromReason("Budget exceeded")` would have returned `null`; the code-driven version
    // correctly attributes it.
    expect(
      deriveRunBarView("stopped", "stopped_guardrail", "Budget exceeded", "max_turns").trippedMeter,
    ).toBe("turns");
    expect(
      deriveRunBarView("stopped", "stopped_guardrail", undefined, "max_tokens").trippedMeter,
    ).toBe("tokens");
    expect(
      deriveRunBarView("stopped", "stopped_guardrail", undefined, "max_context_tokens").trippedMeter,
    ).toBe("tokens");
    expect(deriveRunBarView("stopped", "stopped_guardrail", undefined, "max_cost").trippedMeter).toBe(
      "spend",
    );
    // A code that isn't a budget meter (e.g. `stalled`) attributes to no meter.
    expect(deriveRunBarView("stopped", "stopped_guardrail", undefined, "stalled").trippedMeter).toBe(
      null,
    );
    // No code at all (a caller that hasn't threaded it through yet) — null, same as the old function's
    // "no match" behavior for an empty/unmatched stopReason.
    expect(deriveRunBarView("stopped", "stopped_guardrail", undefined).trippedMeter).toBe(null);
  });

  test("the specific stopped-guardrail wording (time limit / stalled / …) surfaces on statusView when a code is supplied", () => {
    expect(
      deriveRunBarView("stopped", "stopped_guardrail", undefined, "max_duration").statusView,
    ).toMatchObject({ label: "Stopped — time limit" });
    expect(
      deriveRunBarView("stopped", "stopped_guardrail", undefined, "stalled").statusView,
    ).toMatchObject({ label: "Stopped — stalled" });
    expect(
      deriveRunBarView("stopped", "stopped_guardrail", undefined, "wait_expired").statusView,
    ).toMatchObject({ label: "Expired" });
    expect(
      deriveRunBarView("stopped", "stopped_guardrail", undefined, "prompt_rejected").statusView,
    ).toMatchObject({ label: "Rejected by assistant" });
  });

  test("aborted reads Stopped by you on statusView (richer than the coarse Stopped phase bucket)", () => {
    const view = deriveRunBarView("aborted", "aborted", undefined, "user_stop");
    expect(view.phase).toBe("stopped");
    expect(view.statusView).toMatchObject({ label: "Stopped by you", tone: "neutral" });
  });
});

// Unified Sessions (WP3.3, D-US1) — `deriveRunBarView`'s new `livePhase`/`queuePosition` params thread
// straight into `deriveRunStatusView`, so a LIVE run's badge renders the locked table's "Queued —
// position N" / "Waiting for you" / "Stopping…" overlays. Additive/optional: every existing 3–4 arg
// call site above renders exactly as before (asserted throughout this file already).
describe("deriveRunBarView — live phase chips (WP3.3)", () => {
  test("pending + queued phase + position renders 'Queued — position N'", () => {
    const view = deriveRunBarView("pending", undefined, undefined, undefined, "queued", 3);
    expect(view.phase).toBe("pending");
    expect(view.isLive).toBe(true);
    expect(view.statusView).toMatchObject({ label: "Queued — position 3", tone: "pending" });
  });

  test("pending + queued phase with NO position yet renders the bare 'Queued' label", () => {
    const view = deriveRunBarView("pending", undefined, undefined, undefined, "queued", null);
    expect(view.statusView).toMatchObject({ label: "Queued" });
  });

  test("running + waiting_input renders 'Waiting for you'", () => {
    const view = deriveRunBarView("running", undefined, undefined, undefined, "waiting_input");
    expect(view.phase).toBe("running");
    expect(view.isLive).toBe(true);
    expect(view.statusView).toMatchObject({ label: "Waiting for you", tone: "info" });
  });

  test("running + stopping renders 'Stopping…'", () => {
    const view = deriveRunBarView("running", undefined, undefined, undefined, "stopping");
    expect(view.statusView).toMatchObject({ label: "Stopping…", tone: "neutral", spinner: true });
  });

  test("a caller without livePhase (the pre-WP3.3 shape) still renders the plain Running/Pending chip", () => {
    expect(deriveRunBarView("running", undefined, undefined).statusView).toMatchObject({
      label: "Running",
    });
    expect(deriveRunBarView("pending", undefined, undefined).statusView).toMatchObject({
      label: "Pending",
    });
  });

  test("livePhase is ignored once the run is terminal — the outcome-driven chip wins", () => {
    const view = deriveRunBarView("completed", "completed", undefined, undefined, "waiting_input");
    expect(view.statusView).toMatchObject({ label: "Completed" });
  });
});
