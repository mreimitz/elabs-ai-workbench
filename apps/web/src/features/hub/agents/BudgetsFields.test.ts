import { describe, expect, test } from "vitest";
import { budgetsFromWire, budgetsToWire, EMPTY_BUDGETS } from "./BudgetsFields";

describe("budgetsFromWire", () => {
  test("undefined/null budgets become every field null", () => {
    expect(budgetsFromWire(undefined)).toEqual(EMPTY_BUDGETS);
    expect(budgetsFromWire(null)).toEqual(EMPTY_BUDGETS);
  });

  test("partial budgets fill the set fields, leave the rest null", () => {
    expect(budgetsFromWire({ maxTurns: 10, maxCostUsd: 1.5 })).toEqual({
      maxTurns: 10,
      maxTokens: null,
      maxToolCalls: null,
      maxCostUsd: 1.5,
      maxDurationMs: null,
    });
  });
});

describe("budgetsToWire", () => {
  test("every field null → undefined (omit the whole budgets object)", () => {
    expect(budgetsToWire(EMPTY_BUDGETS)).toBeUndefined();
  });

  test("any set field → a HubBudgets object with only the set fields", () => {
    expect(budgetsToWire({ ...EMPTY_BUDGETS, maxTokens: 4096 })).toEqual({ maxTokens: 4096 });
  });

  test("round-trips through budgetsFromWire", () => {
    const wire = { maxTurns: 5, maxTokens: 1000, maxToolCalls: 20, maxCostUsd: 2, maxDurationMs: 60_000 };
    expect(budgetsToWire(budgetsFromWire(wire))).toEqual(wire);
  });
});
