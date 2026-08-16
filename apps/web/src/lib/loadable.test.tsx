import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { loadableData, useLoadable } from "./loadable";

// The `useLoadable` loading | error | data machine + its cancel guard — the fix for the
// `catch(() => setX(null))` swallow. No timers, no network: promises are resolved/rejected inline.

describe("loadableData narrowing", () => {
  test("returns the value only in the data arm", () => {
    expect(loadableData({ status: "loading" })).toBeUndefined();
    expect(loadableData({ status: "error", error: "x" })).toBeUndefined();
    expect(loadableData({ status: "data", data: 7 })).toBe(7);
  });
});

describe("useLoadable", () => {
  test("starts loading then resolves into the data arm", async () => {
    const { result } = renderHook(() => useLoadable(() => Promise.resolve(42), []));
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "data", data: 42 }));
  });

  test("a rejection lands in the error arm (never a silent null)", async () => {
    const { result } = renderHook(() => useLoadable(() => Promise.reject(new Error("boom")), []));
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", error: "boom" }));
  });

  test("a non-Error rejection uses the generic fallback message", async () => {
    const { result } = renderHook(() => useLoadable(() => Promise.reject("nope"), []));
    await waitFor(() =>
      expect(result.current.state).toEqual({ status: "error", error: "Unknown error" }),
    );
  });

  test("cancel guard: a stale in-flight result never clobbers the latest key", async () => {
    let resolveFirst: (v: string) => void = () => {};
    const first = new Promise<string>((r) => {
      resolveFirst = r;
    });
    const { result, rerender } = renderHook(
      ({ key }: { key: number }) =>
        useLoadable(() => (key === 1 ? first : Promise.resolve("second")), [key]),
      { initialProps: { key: 1 } },
    );

    // Re-key before the first load settles — the effect cleanup marks the first as inactive.
    rerender({ key: 2 });
    await waitFor(() => expect(result.current.state).toEqual({ status: "data", data: "second" }));

    // The stale first load resolves late; it must NOT overwrite the second key's data.
    await act(async () => {
      resolveFirst("first");
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "data", data: "second" });
  });

  test("reload() re-runs the loader", async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useLoadable(() => {
        calls += 1;
        return Promise.resolve(calls);
      }, []),
    );
    await waitFor(() => expect(result.current.state).toEqual({ status: "data", data: 1 }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toEqual({ status: "data", data: 2 }));
  });

  test("enabled:false stays loading and never calls the loader", async () => {
    const load = vi.fn(() => Promise.resolve(1));
    const { result } = renderHook(() => useLoadable(load, [], { enabled: false }));
    // Give any (wrongly-scheduled) microtasks a chance to run.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "loading" });
    expect(load).not.toHaveBeenCalled();
  });
});
