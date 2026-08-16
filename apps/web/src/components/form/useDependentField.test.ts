import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useDependentField } from "./useDependentField";

describe("useDependentField", () => {
  test("is disabled with the first unmet reason", () => {
    const { result } = renderHook(() =>
      useDependentField([{ met: false, reason: "Select a provider credential first" }]),
    );
    expect(result.current.disabled).toBe(true);
    expect(result.current.reason).toBe("Select a provider credential first");
    expect(result.current.controlProps).toEqual({
      disabled: true,
      "aria-disabled": true,
      title: "Select a provider credential first",
    });
  });

  test("is enabled with no reason once all prerequisites are met", () => {
    const { result } = renderHook(() =>
      useDependentField([
        { met: true, reason: "Select a provider credential first" },
        { met: true, reason: "Pick a model" },
      ]),
    );
    expect(result.current.disabled).toBe(false);
    expect(result.current.reason).toBeUndefined();
    expect(result.current.controlProps).toEqual({
      disabled: false,
      "aria-disabled": false,
      title: undefined,
    });
  });

  test("reports the FIRST unmet prerequisite when several are unmet", () => {
    const { result } = renderHook(() =>
      useDependentField([
        { met: true, reason: "Select a provider credential first" },
        { met: false, reason: "Pick a model" },
        { met: false, reason: "Enter a prompt" },
      ]),
    );
    expect(result.current.reason).toBe("Pick a model");
  });

  test("recomputes when a prerequisite flips", () => {
    const { result, rerender } = renderHook(
      ({ met }) => useDependentField([{ met, reason: "Select a provider credential first" }]),
      { initialProps: { met: false } },
    );
    expect(result.current.disabled).toBe(true);
    rerender({ met: true });
    expect(result.current.disabled).toBe(false);
  });

  test("an empty prerequisite list is always enabled", () => {
    const { result } = renderHook(() => useDependentField([]));
    expect(result.current.disabled).toBe(false);
  });
});
