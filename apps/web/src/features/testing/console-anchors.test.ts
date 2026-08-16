import type { RunStep } from "@mcp-token-footprint/shared";
import { beforeAll, describe, expect, test, vi } from "vitest";
import {
  anchorValueForRef,
  citationAnchorValue,
  consoleAnchor,
  CONSOLE_ANCHOR_ATTR,
  fallbackAnchorValueForRef,
  findConsoleAnchor,
  insightAnchorValue,
  scrollToInsight,
  toolAnchorValue,
  toolCallIdOfStep,
  turnAnchorValue,
  userAnchorValue,
} from "./console-anchors";

describe("console-anchors", () => {
  test("turn/tool anchor values are stable and distinct", () => {
    expect(turnAnchorValue(2)).toBe("turn:2");
    expect(toolAnchorValue("call_abc")).toBe("tool:call_abc");
    expect(turnAnchorValue(2)).not.toBe(toolAnchorValue("2"));
  });

  test("anchorValueForRef resolves the primary value per kind (turn/tool byte-identical)", () => {
    expect(anchorValueForRef({ kind: "turn", turnIndex: 3 })).toBe("turn:3");
    expect(anchorValueForRef({ kind: "tool", toolCallId: "c1" })).toBe("tool:c1");
    // WP 7.1 — an insight ref's PRIMARY anchor is the citation chip in the answer (the reverse leg).
    expect(anchorValueForRef({ kind: "insight", turnIndex: 1, snapshotIndex: 2 })).toBe(
      "citation:1:2",
    );
  });

  test("a tool ref falls back to its turn, a turn ref has no fallback, an insight falls back to its turn", () => {
    expect(fallbackAnchorValueForRef({ kind: "tool", toolCallId: "c1", turnIndex: 2 })).toBe(
      "turn:2",
    );
    expect(fallbackAnchorValueForRef({ kind: "tool", toolCallId: "c1" })).toBeNull();
    expect(fallbackAnchorValueForRef({ kind: "turn", turnIndex: 2 })).toBeNull();
    // WP 7.1 — a snapshot cited by NO text block has no chip, so it lands on the whole turn.
    expect(fallbackAnchorValueForRef({ kind: "insight", turnIndex: 1, snapshotIndex: 2 })).toBe(
      "turn:1",
    );
  });

  test("WP3.4 — a user ref anchors on its own step id with no fallback", () => {
    expect(userAnchorValue("step-9")).toBe("user:step-9");
    expect(anchorValueForRef({ kind: "user", stepId: "step-9" })).toBe("user:step-9");
    expect(fallbackAnchorValueForRef({ kind: "user", stepId: "step-9" })).toBeNull();
  });

  test("WP 7.1 — insight/citation anchor values are turn-qualified + distinct across turns", () => {
    expect(insightAnchorValue(1, 2)).toBe("insight:1:2");
    expect(citationAnchorValue(1, 2)).toBe("citation:1:2");
    // The turn prefix is what fixes the real multi-turn `insight:0` collision.
    expect(insightAnchorValue(0, 2)).not.toBe(insightAnchorValue(1, 2));
    expect(insightAnchorValue(1, 2)).not.toBe(citationAnchorValue(1, 2));
  });

  test("consoleAnchor spreads the attribute", () => {
    expect(consoleAnchor("turn:1")).toEqual({ [CONSOLE_ANCHOR_ATTR]: "turn:1" });
  });

  test("toolCallIdOfStep reads the payload id or returns undefined", () => {
    const step = { payload: { toolCallId: "c9", args: {} } } as unknown as RunStep;
    expect(toolCallIdOfStep(step)).toBe("c9");
    expect(toolCallIdOfStep({ payload: {} } as unknown as RunStep)).toBeUndefined();
    expect(toolCallIdOfStep({ payload: null } as unknown as RunStep)).toBeUndefined();
  });

  test("findConsoleAnchor matches by value even with `:mcp:`-style separators, scoped to the container", () => {
    const container = document.createElement("div");
    const a = document.createElement("div");
    a.setAttribute(CONSOLE_ANCHOR_ATTR, "tool:run:mcp:0");
    const b = document.createElement("div");
    b.setAttribute(CONSOLE_ANCHOR_ATTR, "turn:0");
    container.append(a, b);

    expect(findConsoleAnchor(container, "tool:run:mcp:0")).toBe(a);
    expect(findConsoleAnchor(container, "turn:0")).toBe(b);
    expect(findConsoleAnchor(container, "turn:9")).toBeNull();
    expect(findConsoleAnchor(null, "turn:0")).toBeNull();
  });
});

describe("scrollToInsight (WP 7.1 — cross-pane forward leg, chip → rail)", () => {
  beforeAll(() => {
    // jsdom doesn't implement scrollIntoView; scrollToConsoleAnchorValue calls it on the found node.
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  test("flashes the turn-qualified BODY-level target; a same-snap-different-turn target is NOT flashed (no collision)", () => {
    // The target now lives in the OTHER pane, so the search is document-wide (not turn-scoped). Two
    // targets share snapshot index 2 but on DIFFERENT turns — only the exact `insight:1:2` must flash.
    const source = document.createElement("button");
    const target = document.createElement("div");
    target.setAttribute(CONSOLE_ANCHOR_ATTR, insightAnchorValue(1, 2));
    const otherTurn = document.createElement("div");
    otherTurn.setAttribute(CONSOLE_ANCHOR_ATTR, insightAnchorValue(0, 2));
    document.body.append(source, target, otherTurn);
    try {
      expect(target.style.outline).toBe(""); // not yet flashed

      const scrolled = scrollToInsight(source, 1, 2);

      expect(scrolled).toBe(true);
      expect(target.style.outline).toContain("var(--ring)"); // the exact turn's insight flashed
      expect(otherTurn.style.outline).toBe(""); // the other turn's same-index insight did NOT
    } finally {
      source.remove();
      target.remove();
      otherTurn.remove();
    }
  });

  test("a missing target (rail not mounted / dangling citation) is a silent no-op", () => {
    const source = document.createElement("button");
    document.body.append(source);
    try {
      expect(scrollToInsight(source, 9, 9)).toBe(false); // no throw, no scroll
      expect(scrollToInsight(null, 0, 0)).toBe(false);
    } finally {
      source.remove();
    }
  });
});
