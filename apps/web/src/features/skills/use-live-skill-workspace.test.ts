import type { AssistantStreamFrame } from "@mcp-token-footprint/shared";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, getAssistantWorkspaceFiles: vi.fn() };
});

import { ApiError, getAssistantWorkspaceFiles } from "../../lib/api";
import {
  EMPTY_LIVE_WORKSPACE_FOLD_STATE,
  LIVE_WORKSPACE_DEBOUNCE_MS,
  reduceLiveWorkspaceFrame,
  useLiveSkillWorkspace,
} from "./use-live-skill-workspace";

// ── FakeEventSource — mirrors `use-assistant-stream.test.ts`'s harness (a per-test-file convention in
// this codebase, not a shared util) — only the subset `openAssistantStream` actually uses. ──────────
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(): void {
    // `openAssistantStream`'s optional `replay_complete` listener — unused by this hook.
  }

  emit(frame: AssistantStreamFrame): void {
    if (this.closed) return;
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  static latest(): FakeEventSource {
    const es = FakeEventSource.instances.at(-1);
    if (!es) throw new Error("no EventSource opened");
    return es;
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  vi.mocked(getAssistantWorkspaceFiles).mockReset();
});

afterEach(() => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = undefined;
  vi.useRealTimers();
});

const SKILL = "skill-1";
const OTHER_SKILL = "skill-2";
const THREAD = "thread-1";

function opened(
  skillId: string,
  versionId: string,
  files: Array<{ path: string; size: number }> = [],
): AssistantStreamFrame {
  return { type: "workspace_opened", skillId, versionId, files };
}
function fileChanged(
  skillId: string,
  path: string,
  changeKind: "created" | "modified" = "modified",
): AssistantStreamFrame {
  return { type: "workspace_file_changed", skillId, path, changeKind };
}
function committed(skillId: string, versionId: string): AssistantStreamFrame {
  return { type: "workspace_committed", skillId, versionId };
}

// ── reduceLiveWorkspaceFrame — pure, no React/timers/network ──────────────────────────────────────

describe("reduceLiveWorkspaceFrame", () => {
  test("workspace_opened for THIS skill enters live mode with the base version", () => {
    const next = reduceLiveWorkspaceFrame(
      EMPTY_LIVE_WORKSPACE_FOLD_STATE,
      opened(SKILL, "v1"),
      SKILL,
    );
    expect(next.isLive).toBe(true);
    expect(next.baseVersionId).toBe("v1");
    expect(next.changedPaths.size).toBe(0);
  });

  test("a frame naming a DIFFERENT skill is a no-op (same object reference)", () => {
    const state = reduceLiveWorkspaceFrame(
      EMPTY_LIVE_WORKSPACE_FOLD_STATE,
      opened(SKILL, "v1"),
      SKILL,
    );
    const next = reduceLiveWorkspaceFrame(state, opened(OTHER_SKILL, "v9"), SKILL);
    expect(next).toBe(state);
  });

  test("a non-workspace frame passes through unchanged (same object reference)", () => {
    const state = reduceLiveWorkspaceFrame(
      EMPTY_LIVE_WORKSPACE_FOLD_STATE,
      opened(SKILL, "v1"),
      SKILL,
    );
    const next = reduceLiveWorkspaceFrame(state, { type: "assistant_delta", text: "hi" }, SKILL);
    expect(next).toBe(state);
  });

  test("workspace_file_changed accumulates the changed-file set and implies live even without a prior open", () => {
    let state = EMPTY_LIVE_WORKSPACE_FOLD_STATE;
    state = reduceLiveWorkspaceFrame(state, fileChanged(SKILL, "a.md", "created"), SKILL);
    expect(state.isLive).toBe(true);
    expect(state.changeSeq).toBe(1);
    expect(state.lastChangedPath).toBe("a.md");
    expect(state.changedPaths.get("a.md")).toBe("created");

    state = reduceLiveWorkspaceFrame(state, fileChanged(SKILL, "b.md", "modified"), SKILL);
    expect(state.changeSeq).toBe(2);
    expect(state.lastChangedPath).toBe("b.md");
    // The set BUILDS UP — "a.md" is still there alongside the new "b.md" (loading-states.md: never
    // collapse a growing set to just the latest item).
    expect([...state.changedPaths.entries()]).toEqual([
      ["a.md", "created"],
      ["b.md", "modified"],
    ]);
  });

  test("workspace_committed exits live mode and reports a nonce that increments per commit", () => {
    let state = reduceLiveWorkspaceFrame(
      EMPTY_LIVE_WORKSPACE_FOLD_STATE,
      opened(SKILL, "v1"),
      SKILL,
    );
    state = reduceLiveWorkspaceFrame(state, fileChanged(SKILL, "a.md"), SKILL);
    state = reduceLiveWorkspaceFrame(state, committed(SKILL, "v2"), SKILL);
    expect(state.isLive).toBe(false);
    expect(state.changedPaths.size).toBe(0);
    expect(state.committed).toEqual({ versionId: "v2", nonce: 1 });

    // Open again, edit, commit again — the SAME versionId shape is still a distinct signal (nonce 2).
    state = reduceLiveWorkspaceFrame(state, opened(SKILL, "v2"), SKILL);
    state = reduceLiveWorkspaceFrame(state, committed(SKILL, "v3"), SKILL);
    expect(state.committed).toEqual({ versionId: "v3", nonce: 2 });
  });
});

// ── useLiveSkillWorkspace — the impure GET+SSE+debounce layer ─────────────────────────────────────

describe("useLiveSkillWorkspace", () => {
  test("no active thread resolves to the empty, not-checking, not-live state", async () => {
    const { result } = renderHook(() => useLiveSkillWorkspace(null, SKILL));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.isLive).toBe(false);
    expect(result.current.files).toEqual([]);
    expect(getAssistantWorkspaceFiles).not.toHaveBeenCalled();
  });

  test("a 400 from the initial check (no open workspace) is NOT an error — stays not-live", async () => {
    vi.mocked(getAssistantWorkspaceFiles).mockRejectedValue(new ApiError(400, "No open workspace"));
    const { result } = renderHook(() => useLiveSkillWorkspace(THREAD, SKILL));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.isLive).toBe(false);
    expect(result.current.filesError).toBeNull();
  });

  test("a 200 from the initial check enters live mode with the fetched tree (late-subscribe recovery)", async () => {
    vi.mocked(getAssistantWorkspaceFiles).mockResolvedValue({
      skillId: SKILL,
      files: [{ path: "SKILL.md", size: 10, isBinary: false }],
    });
    const { result } = renderHook(() => useLiveSkillWorkspace(THREAD, SKILL));
    await waitFor(() => expect(result.current.isLive).toBe(true));
    expect(result.current.files).toEqual([{ path: "SKILL.md", size: 10, isBinary: false }]);
    // The late-subscribe case never saw `workspace_opened`, so the base version genuinely isn't known —
    // the CALLER falls back to the skill's current committed version (see the hook's module doc).
    expect(result.current.baseVersionId).toBeNull();
  });

  test("a genuine fetch failure (not a 400) surfaces as filesError, not a silent not-live", async () => {
    vi.mocked(getAssistantWorkspaceFiles).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useLiveSkillWorkspace(THREAD, SKILL));
    await waitFor(() => expect(result.current.filesError).toBe("network down"));
    expect(result.current.isLive).toBe(false);
  });

  test("workspace_opened live enters live mode, sets the base version, and refetches the tree", async () => {
    vi.mocked(getAssistantWorkspaceFiles)
      .mockRejectedValueOnce(new ApiError(400, "No open workspace")) // initial check: not live yet
      .mockResolvedValueOnce({
        skillId: SKILL,
        files: [{ path: "SKILL.md", size: 5, isBinary: false }],
      });

    const { result } = renderHook(() => useLiveSkillWorkspace(THREAD, SKILL));
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(result.current.isLive).toBe(false);

    act(() => FakeEventSource.latest().emit(opened(SKILL, "v1")));

    await waitFor(() => expect(result.current.isLive).toBe(true));
    expect(result.current.baseVersionId).toBe("v1");
    await waitFor(() =>
      expect(result.current.files).toEqual([{ path: "SKILL.md", size: 5, isBinary: false }]),
    );
  });

  test("workspace_file_changed badges the path IMMEDIATELY, then debounces the auto-navigate settle", async () => {
    vi.mocked(getAssistantWorkspaceFiles).mockResolvedValue({ skillId: SKILL, files: [] });

    const { result } = renderHook(() => useLiveSkillWorkspace(THREAD, SKILL));
    // Establish the initial (real-timer) settle FIRST — `vi.useFakeTimers()` only starts once that's
    // done, so it never has to fake the Testing Library `waitFor` polling itself.
    await waitFor(() => expect(result.current.checking).toBe(false));
    vi.mocked(getAssistantWorkspaceFiles).mockClear();

    vi.useFakeTimers();
    act(() => FakeEventSource.latest().emit(fileChanged(SKILL, "a.md", "modified")));

    // The changed-file set updates synchronously — no debounce on the badge itself.
    expect(result.current.changedPaths.get("a.md")).toBe("modified");
    expect(result.current.autoOpenNonce).toBe(0); // not settled yet

    await act(async () => {
      vi.advanceTimersByTime(LIVE_WORKSPACE_DEBOUNCE_MS);
      await Promise.resolve(); // flush the settle's re-fetch microtask
    });

    expect(result.current.autoOpenNonce).toBe(1);
    expect(result.current.autoOpenPath).toBe("a.md");
    expect(getAssistantWorkspaceFiles).toHaveBeenCalledTimes(1); // the settle's re-fetch
  });

  test("a BURST of changes within the debounce window collapses to ONE settle, targeting the LAST path", async () => {
    vi.mocked(getAssistantWorkspaceFiles).mockResolvedValue({ skillId: SKILL, files: [] });

    const { result } = renderHook(() => useLiveSkillWorkspace(THREAD, SKILL));
    await waitFor(() => expect(result.current.checking).toBe(false));
    vi.mocked(getAssistantWorkspaceFiles).mockClear();

    vi.useFakeTimers();
    act(() => {
      FakeEventSource.latest().emit(fileChanged(SKILL, "a.md"));
    });
    act(() => {
      vi.advanceTimersByTime(LIVE_WORKSPACE_DEBOUNCE_MS / 2);
      FakeEventSource.latest().emit(fileChanged(SKILL, "b.md"));
    });

    await act(async () => {
      vi.advanceTimersByTime(LIVE_WORKSPACE_DEBOUNCE_MS);
      await Promise.resolve(); // flush the settle's re-fetch microtask
    });

    expect(result.current.autoOpenNonce).toBe(1); // ONE settle, not two
    expect(result.current.autoOpenPath).toBe("b.md"); // the LAST path in the burst
    expect(result.current.changedPaths.size).toBe(2); // both still tracked
    expect(getAssistantWorkspaceFiles).toHaveBeenCalledTimes(1);
  });

  test("workspace_committed exits live mode and clears the tree; a subsequent 400 refetch is not an error", async () => {
    vi.mocked(getAssistantWorkspaceFiles).mockResolvedValue({
      skillId: SKILL,
      files: [{ path: "SKILL.md", size: 1, isBinary: false }],
    });

    const { result } = renderHook(() => useLiveSkillWorkspace(THREAD, SKILL));
    await waitFor(() => expect(result.current.isLive).toBe(true));

    act(() => FakeEventSource.latest().emit(committed(SKILL, "v2")));

    expect(result.current.isLive).toBe(false);
    expect(result.current.files).toEqual([]);
    expect(result.current.committed).toEqual({ versionId: "v2", nonce: 1 });

    // A pending debounced re-fetch that lands AFTER the commit (workspace now closed underneath it)
    // 400s — the documented "not live" signal, never surfaced as filesError.
    vi.mocked(getAssistantWorkspaceFiles).mockRejectedValueOnce(
      new ApiError(400, "No open workspace"),
    );
    vi.useFakeTimers();
    act(() => FakeEventSource.latest().emit(fileChanged(SKILL, "c.md")));
    await act(async () => {
      vi.advanceTimersByTime(LIVE_WORKSPACE_DEBOUNCE_MS);
      await Promise.resolve(); // flush the rejected fetch's microtask
      await Promise.resolve();
    });
    expect(getAssistantWorkspaceFiles).toHaveBeenCalled();
    expect(result.current.filesError).toBeNull();
  });

  test("switching threads closes the previous EventSource and resets to a fresh check", async () => {
    vi.mocked(getAssistantWorkspaceFiles).mockRejectedValue(new ApiError(400, "No open workspace"));
    const { result, rerender } = renderHook(
      ({ threadId }) => useLiveSkillWorkspace(threadId, SKILL),
      {
        initialProps: { threadId: THREAD },
      },
    );
    await waitFor(() => expect(result.current.checking).toBe(false));
    const first = FakeEventSource.latest();
    expect(first.closed).toBe(false);

    rerender({ threadId: "thread-2" });
    expect(first.closed).toBe(true);
    await waitFor(() => expect(FakeEventSource.instances.length).toBe(2));
  });
});
