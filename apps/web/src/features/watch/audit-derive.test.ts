import { describe, expect, test } from "vitest";
import type { WatchRuleEvent } from "@mcp-token-footprint/shared";
import {
  actionsSummary,
  auditActionLabel,
  deriveRuleFireStats,
  triggerLabel,
} from "./audit-derive";

function event(overrides: Partial<WatchRuleEvent>): WatchRuleEvent {
  return {
    id: overrides.id ?? "evt-1",
    ruleId: "rule-1",
    at: "2026-07-10T00:00:00.000Z",
    action: "notify",
    result: { ok: true },
    ...overrides,
  };
}

describe("deriveRuleFireStats", () => {
  test("no events -> zero fires, null lastFiredAt", () => {
    expect(deriveRuleFireStats([])).toEqual({ fireCount: 0, lastFiredAt: null });
  });

  test("groups multi-action on-terminal fire by runId (2 action rows, 1 occurrence)", () => {
    const events = [
      event({ id: "e1", action: "notify", runId: "run-1", at: "2026-07-10T00:00:01.000Z" }),
      event({ id: "e2", action: "pin", runId: "run-1", at: "2026-07-10T00:00:01.000Z" }),
    ];
    expect(deriveRuleFireStats(events)).toEqual({
      fireCount: 1,
      lastFiredAt: "2026-07-10T00:00:01.000Z",
    });
  });

  test("groups windowed fire by shared timestamp (window_fire + action share `at`)", () => {
    const events = [
      event({ id: "e1", action: "window_fire", at: "2026-07-10T06:00:00.000Z" }),
      event({ id: "e2", action: "webhook", at: "2026-07-10T06:00:00.000Z" }),
    ];
    expect(deriveRuleFireStats(events)).toEqual({
      fireCount: 1,
      lastFiredAt: "2026-07-10T06:00:00.000Z",
    });
  });

  test("excludes decision markers (sampled_out, window_recover, window_catchup, test_fire, error)", () => {
    const events = [
      event({ id: "e1", action: "sampled_out", at: "2026-07-10T00:00:00.000Z" }),
      event({ id: "e2", action: "window_recover", at: "2026-07-10T01:00:00.000Z" }),
      event({ id: "e3", action: "window_catchup", at: "2026-07-10T02:00:00.000Z" }),
      event({ id: "e4", action: "test_fire", at: "2026-07-10T03:00:00.000Z" }),
      event({ id: "e5", action: "error", at: "2026-07-10T04:00:00.000Z" }),
    ];
    expect(deriveRuleFireStats(events)).toEqual({ fireCount: 0, lastFiredAt: null });
  });

  test("counts two separate runs as two fires and picks the max `at` regardless of array order", () => {
    const events = [
      event({ id: "e1", action: "notify", runId: "run-2", at: "2026-07-09T00:00:00.000Z" }),
      event({ id: "e2", action: "notify", runId: "run-1", at: "2026-07-11T00:00:00.000Z" }),
    ];
    expect(deriveRuleFireStats(events)).toEqual({
      fireCount: 2,
      lastFiredAt: "2026-07-11T00:00:00.000Z",
    });
  });
});

describe("triggerLabel", () => {
  test("on_terminal -> On terminal", () => {
    expect(triggerLabel("on_terminal")).toBe("On terminal");
  });
  test("windowed -> Windowed", () => {
    expect(triggerLabel("windowed")).toBe("Windowed");
  });
});

describe("actionsSummary", () => {
  test("empty -> No actions", () => {
    expect(actionsSummary([])).toBe("No actions");
  });
  test("joins labels in order", () => {
    expect(actionsSummary([{ type: "notify", severity: "warning" }, { type: "pin" }])).toBe(
      "Notify, Pin run",
    );
  });
});

describe("auditActionLabel", () => {
  test("maps decision markers", () => {
    expect(auditActionLabel("sampled_out")).toBe("Sampled out");
    expect(auditActionLabel("window_fire")).toBe("Window fired");
    expect(auditActionLabel("window_recover")).toBe("Window recovered");
    expect(auditActionLabel("window_catchup")).toBe("Boot catch-up");
    expect(auditActionLabel("test_fire")).toBe("Test-fire");
    expect(auditActionLabel("error")).toBe("Evaluation error");
  });
  test("maps a real action type", () => {
    expect(auditActionLabel("webhook")).toBe("Webhook");
  });
  test("falls back to the raw string for an unknown marker", () => {
    expect(auditActionLabel("mystery")).toBe("mystery");
  });

  // RM-17 Phase 6 · AM-OB10 — the three new markers.
  test("maps the AM-OB10 markers", () => {
    expect(auditActionLabel("window_no_data")).toBe("No data in window");
    expect(auditActionLabel("paused")).toBe("Paused — suppressed");
    expect(auditActionLabel("rate_limited")).toBe("Rate limited");
  });
});

describe("deriveRuleFireStats — the AM-OB10 markers are not fires", () => {
  test("a no-data / paused / rate-limited row never counts as a fire", () => {
    const at = "2026-08-21T10:00:00.000Z";
    const rows = ["window_no_data", "paused", "rate_limited"].map((action, i) => ({
      id: `e${i}`,
      ruleId: "r",
      at,
      action,
      result: { ok: true },
    }));
    expect(deriveRuleFireStats(rows)).toEqual({ fireCount: 0, lastFiredAt: null });
  });
});
