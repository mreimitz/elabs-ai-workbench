import type { RunSummary } from "@mcp-token-footprint/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TimelineItem } from "./use-run-stream";

const searchRunScoped = vi.fn();
vi.mock("../../lib/api", () => ({
  searchRunScoped: (...args: unknown[]) => searchRunScoped(...args),
}));

// Import AFTER the mock so `use-run-search` resolves the mocked `lib/api` export.
const { useRunSearch } = await import("./use-run-search");

const TIMELINE_TWO_MATCHES: TimelineItem[] = [
  { kind: "user", id: "u0", text: "Tell me about widgets" },
  {
    kind: "assistant_turn",
    id: "t0",
    turnIndex: 0,
    stepId: "resp-0",
    assistantText: "Widgets are great.",
    toolCalls: [],
    status: "ok",
    streaming: false,
  },
];

describe("useRunSearch — live path (acceptance #1: prev/next + highlight)", () => {
  test("an empty query yields no hits and never calls the FTS endpoint", () => {
    const { result } = renderHook(() =>
      useRunSearch({
        query: "",
        timeline: TIMELINE_TWO_MATCHES,
        runError: null,
        isReplay: false,
        runId: null,
        testId: "test-1",
      }),
    );
    expect(result.current.hits).toEqual([]);
    expect(result.current.activeHit).toBeNull();
    expect(searchRunScoped).not.toHaveBeenCalled();
  });

  test("finds live matches and next()/prev() cycle the active index with wraparound", () => {
    const { result } = renderHook(() =>
      useRunSearch({
        query: "widget",
        timeline: TIMELINE_TWO_MATCHES,
        runError: null,
        isReplay: false,
        runId: null,
        testId: "test-1",
      }),
    );
    expect(result.current.hits).toHaveLength(2);
    expect(result.current.activeIndex).toBe(0);

    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);

    // Wraps back to the first match.
    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(0);

    // prev() wraps the other way.
    act(() => result.current.prev());
    expect(result.current.activeIndex).toBe(1);
  });

  test("changing the query resets the active index to the first match", () => {
    const { result, rerender } = renderHook(
      ({ query }) =>
        useRunSearch({
          query,
          timeline: TIMELINE_TWO_MATCHES,
          runError: null,
          isReplay: false,
          runId: null,
          testId: "test-1",
        }),
      { initialProps: { query: "widget" } },
    );
    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);

    rerender({ query: "great" });
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.hits).toHaveLength(1);
  });
});

describe("useRunSearch — replay FTS merge (acceptance #1: stubbed FTS route merges)", () => {
  afterEach(() => {
    searchRunScoped.mockReset();
  });

  test("merges the ONE FTS hit onto the live hits when replaying, without calling it live", async () => {
    const ftsRun: RunSummary = {
      id: "run-1",
      searchSnippet: "…deep in a [truncated] payload…",
      searchMatchKind: "tool_result",
    } as RunSummary;
    searchRunScoped.mockResolvedValue([ftsRun]);

    const { result, rerender } = renderHook(
      ({ isReplay, runId }) =>
        useRunSearch({
          query: "truncated",
          timeline: [],
          runError: null,
          isReplay,
          runId,
          testId: "test-1",
        }),
      { initialProps: { isReplay: false, runId: null as string | null } },
    );

    // Live (not replaying): never calls the FTS endpoint.
    expect(searchRunScoped).not.toHaveBeenCalled();
    expect(result.current.hits).toEqual([]);

    // Now the console has settled into replay for this run.
    rerender({ isReplay: true, runId: "run-1" });

    await waitFor(() => expect(result.current.hits).toHaveLength(1));
    expect(searchRunScoped).toHaveBeenCalledWith("test-1", "truncated", expect.anything());
    expect(result.current.hits[0]).toMatchObject({ source: "fts", kind: "tool_result" });
  });

  test("a genuine FTS failure surfaces ftsError but never clears the (always-available) live hits", async () => {
    searchRunScoped.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() =>
      useRunSearch({
        query: "widget",
        timeline: TIMELINE_TWO_MATCHES,
        runError: null,
        isReplay: true,
        runId: "run-1",
        testId: "test-1",
      }),
    );

    await waitFor(() => expect(result.current.ftsError).toBe("network down"));
    expect(result.current.hits).toHaveLength(2); // the live hits are untouched
  });
});
