import { describe, expect, test } from "vitest";
import { missionAgentStatusRaw, missionStatusRaw } from "./mission-status";

describe("missionStatusRaw (WP1.2, D-HUX14 mapping call site)", () => {
  test("proposed + not approved -> awaiting-approval", () => {
    expect(missionStatusRaw({ phase: "proposed", approved: false })).toBe("awaiting-approval");
  });

  test("proposed + approved -> pending (approval settled, not yet started)", () => {
    expect(missionStatusRaw({ phase: "proposed", approved: true })).toBe("pending");
  });

  test("approved phase -> pending", () => {
    expect(missionStatusRaw({ phase: "approved", approved: true })).toBe("pending");
  });

  test("running -> running", () => {
    expect(missionStatusRaw({ phase: "running", approved: true })).toBe("running");
  });

  test("synthesizing -> running", () => {
    expect(missionStatusRaw({ phase: "synthesizing", approved: true })).toBe("running");
  });

  test("done -> complete", () => {
    expect(missionStatusRaw({ phase: "done", approved: true })).toBe("complete");
  });
});

describe("missionAgentStatusRaw (WP1.2, D-HUX14 mapping call site)", () => {
  test("reported -> complete, regardless of phase", () => {
    expect(missionAgentStatusRaw({ reported: true }, "running")).toBe("complete");
    expect(missionAgentStatusRaw({ reported: true }, "done")).toBe("complete");
  });

  test("not reported + running/synthesizing -> running", () => {
    expect(missionAgentStatusRaw({ reported: false }, "running")).toBe("running");
    expect(missionAgentStatusRaw({ reported: false }, "synthesizing")).toBe("running");
  });

  test("not reported + done -> skipped (mission settled, agent never reported)", () => {
    expect(missionAgentStatusRaw({ reported: false }, "done")).toBe("skipped");
  });

  test("not reported + proposed/approved -> pending (queued)", () => {
    expect(missionAgentStatusRaw({ reported: false }, "proposed")).toBe("pending");
    expect(missionAgentStatusRaw({ reported: false }, "approved")).toBe("pending");
  });
});
