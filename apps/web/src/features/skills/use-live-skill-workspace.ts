import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssistantStreamFrame,
  AssistantWorkspaceChangeKind,
  AssistantWorkspaceFileNode,
} from "@mcp-token-footprint/shared";
import { ApiError, getAssistantWorkspaceFiles, openAssistantStream } from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";

// WP R1.4 (D-AS22) — the Skills Files-view's live-workspace consumer. Turns the active assistant
// thread's `workspace_*` stream frames (WP R1.3 — transient, no `seq`, never persisted/replayed — see
// `AssistantWorkspaceFrame`'s doc in shared) into "is this skill's workspace open live right now, and
// what's changed" state, and layers the two live-workspace READ routes on top for actual content:
//   - `workspace_opened`  → enter live mode, remember the diff BASE version.
//   - `workspace_file_changed` → badge the path as changed immediately (never debounced — per
//     `.claude/rules/loading-states.md` the changed-file SET builds up live); a DEBOUNCED settle then
//     re-fetches the live tree (a burst of edits shouldn't re-fetch on every single one) and offers the
//     latest path as an auto-navigate target.
//   - `workspace_committed` → exit live mode; the caller rebases onto the new version (this hook only
//     reports the new versionId + a nonce, mirroring the dock's own pendingRequest/nonce pattern so a
//     second commit to the same version is still a distinct signal).
//
// Because the three frames are transient, a subscriber that attaches AFTER `workspace_opened` already
// fired never sees it — so `isLive`/`files` are ALSO established by the live-workspace GET endpoint
// itself on mount (the source of truth for content, per WP R1.3's handback): a 200 means a workspace is
// already open (enter live mode without ever having seen the frame); a 400 is the documented "no open
// workspace" signal, not an error. Only `baseVersionId` can legitimately stay unknown in that specific
// late-subscribe case (the GET response carries no versionId) — the caller falls back to the skill's
// current committed version, which is what `skills_open_workspace` itself defaults to when the agent
// doesn't pick one explicitly.

/** Debounce window for the auto-navigate/tree-refetch settle — exported so tests can assert against it
 *  with fake timers instead of a magic number. */
export const LIVE_WORKSPACE_DEBOUNCE_MS = 600;

/** The subset of live-workspace state that folds purely from stream frames (no network) — kept apart
 *  from `files`/`filesError` (which come from the GET endpoint) so the pure fold stays unit-testable
 *  with no fetch/timer involved, mirroring `use-assistant-stream.ts`'s `reduceAssistantFrame`. */
export type LiveWorkspaceFoldState = {
  isLive: boolean;
  /** The version the live workspace opened FROM (the diff base) — set only when a `workspace_opened`
   *  frame for this skill was actually observed; `null` otherwise (see the module doc's late-subscribe
   *  note). */
  baseVersionId: string | null;
  /** Every path the agent has touched THIS live session — accumulates, never cleared until the
   *  workspace re-opens or commits (mirrors the dock's own commit-diff card's "changed" vocabulary). */
  changedPaths: ReadonlyMap<string, AssistantWorkspaceChangeKind>;
  /** Bumped once per `workspace_file_changed` for this skill — a stable trigger the hook debounces off,
   *  and tests can assert on directly without touching timers. */
  changeSeq: number;
  /** The path from the MOST RECENT `workspace_file_changed` — the debounced auto-navigate target once
   *  a burst of edits settles. */
  lastChangedPath: string | null;
  /** Set once per `workspace_committed` for this skill; `null` once no commit is pending handling. The
   *  nonce distinguishes two separate commits that happen to mint the exact same versionId shape from
   *  each other (defensive — mirrors the dock's `AssistantPendingRequest` nonce). */
  committed: { versionId: string; nonce: number } | null;
  /** Monotonic across the whole fold's lifetime — UNLIKE every other field, never reset by a
   *  `workspace_opened` full-reset, so a second open→edit→commit cycle still mints a strictly higher
   *  nonce than the first. Internal bookkeeping only; not part of {@link UseLiveSkillWorkspaceResult}. */
  commitNonceCounter: number;
};

export const EMPTY_LIVE_WORKSPACE_FOLD_STATE: LiveWorkspaceFoldState = {
  isLive: false,
  baseVersionId: null,
  changedPaths: new Map(),
  changeSeq: 0,
  lastChangedPath: null,
  committed: null,
  commitNonceCounter: 0,
};

/**
 * Fold ONE stream frame into {@link LiveWorkspaceFoldState}, for `skillId`'s own workspace only — every
 * other frame (a different skill's workspace frame, a settled `AssistantEvent`, an `assistant_delta`)
 * passes through as the SAME object reference (a React-friendly no-op, exactly like
 * `reduceAssistantFrame`'s fallthrough). Pure and exported for direct unit testing.
 */
export function reduceLiveWorkspaceFrame(
  state: LiveWorkspaceFoldState,
  frame: AssistantStreamFrame,
  skillId: string,
): LiveWorkspaceFoldState {
  switch (frame.type) {
    case "workspace_opened": {
      if (frame.skillId !== skillId) return state;
      // A fresh open REPLACES whatever was there (see `skills_open_workspace`'s own tool description —
      // re-opening discards uncommitted edits), so this is a full reset, not a merge — EXCEPT the
      // commit-nonce counter, which must stay monotonic across the whole fold's lifetime (see its doc).
      return {
        ...EMPTY_LIVE_WORKSPACE_FOLD_STATE,
        isLive: true,
        baseVersionId: frame.versionId,
        commitNonceCounter: state.commitNonceCounter,
      };
    }
    case "workspace_file_changed": {
      if (frame.skillId !== skillId) return state;
      const changedPaths = new Map(state.changedPaths);
      changedPaths.set(frame.path, frame.changeKind);
      return {
        ...state,
        // Defensive: a change frame implies an open workspace even if this subscriber missed the
        // `workspace_opened` one (see the module doc's late-subscribe note).
        isLive: true,
        changedPaths,
        changeSeq: state.changeSeq + 1,
        lastChangedPath: frame.path,
      };
    }
    case "workspace_committed": {
      if (frame.skillId !== skillId) return state;
      const nonce = state.commitNonceCounter + 1;
      return {
        ...EMPTY_LIVE_WORKSPACE_FOLD_STATE,
        committed: { versionId: frame.versionId, nonce },
        commitNonceCounter: nonce,
      };
    }
    default:
      return state;
  }
}

export type UseLiveSkillWorkspaceResult = {
  /** True once a live skill-workspace is confirmed open (via the GET check or a live frame). */
  isLive: boolean;
  /** True while the initial "is a workspace open" check is in flight — a BACKGROUND check; callers
   *  should keep showing the committed-version Files view during it, never a blocking spinner (there is
   *  always committed content to show already). */
  checking: boolean;
  baseVersionId: string | null;
  /** The live (possibly agent-edited) file tree — empty until the first successful fetch. */
  files: AssistantWorkspaceFileNode[];
  /** Set on a genuine fetch failure (network/5xx) — NOT on the expected 400 "no open workspace". */
  filesError: string | null;
  changedPaths: ReadonlyMap<string, AssistantWorkspaceChangeKind>;
  /** Bumped once per debounced settle; the caller's effect should key off THIS (not `autoOpenPath` alone)
   *  so a repeat edit to the already-selected file still re-fires (the path string wouldn't change). */
  autoOpenNonce: number;
  autoOpenPath: string | null;
  committed: { versionId: string; nonce: number } | null;
};

/**
 * Subscribe ONE skill's live assistant workspace on `threadId` (pass `null` for "no active thread" —
 * resolves to the empty/not-live state). See the module doc for the overall design; this is the
 * impure layer (GET fetch + `EventSource` + the debounce timer) on top of the pure
 * {@link reduceLiveWorkspaceFrame}.
 */
export function useLiveSkillWorkspace(
  threadId: string | null,
  skillId: string,
): UseLiveSkillWorkspaceResult {
  const [fold, setFold] = useState<LiveWorkspaceFoldState>(EMPTY_LIVE_WORKSPACE_FOLD_STATE);
  const [files, setFiles] = useState<AssistantWorkspaceFileNode[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [autoOpen, setAutoOpen] = useState<{ path: string | null; nonce: number }>({
    path: null,
    nonce: 0,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshFiles = useCallback(async (tid: string, sid: string): Promise<void> => {
    try {
      const response = await getAssistantWorkspaceFiles(tid, sid);
      setFiles(response.files);
      setFilesError(null);
    } catch (err) {
      // A 400 here is the documented "no open workspace" signal (e.g. it closed underneath us between
      // the triggering frame and this fetch, most commonly right after a commit) — an ordinary, EXPECTED
      // transition back to committed mode, never surfaced as an error (`.claude/rules/loading-states.md`
      // — no terminal-error flash for an expected close).
      if (err instanceof ApiError && err.status === 400) return;
      setFilesError(getErrorMessage(err, "Couldn’t load the live workspace"));
    }
  }, []);

  useEffect(() => {
    setFold(EMPTY_LIVE_WORKSPACE_FOLD_STATE);
    setFiles([]);
    setFilesError(null);
    setAutoOpen({ path: null, nonce: 0 });
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!threadId) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    setChecking(true);

    // The initial "is a workspace already open" check — see the module doc's late-subscribe note.
    getAssistantWorkspaceFiles(threadId, skillId)
      .then((response) => {
        if (cancelled) return;
        setFiles(response.files);
        setFold((current) => (current.isLive ? current : { ...current, isLive: true }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 400) return; // no open workspace — expected
        setFilesError(getErrorMessage(err, "Couldn’t check the live workspace"));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    const close = openAssistantStream(threadId, (frame) => {
      if (cancelled) return;
      setFold((current) => reduceLiveWorkspaceFrame(current, frame, skillId));

      if (frame.type === "workspace_opened" && frame.skillId === skillId) {
        // A fresh open can fully replace the tree's content — refetch right away (not debounced; this
        // is a discrete, rare event, not a burst).
        void refreshFiles(threadId, skillId);
      } else if (frame.type === "workspace_file_changed" && frame.skillId === skillId) {
        // Debounced settle: re-fetch the tree (a `created` change means a brand-new path) and offer the
        // latest changed path as the auto-navigate target — a burst of edits collapses to ONE settle.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        const path = frame.path;
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          setAutoOpen((current) => ({ path, nonce: current.nonce + 1 }));
          void refreshFiles(threadId, skillId);
        }, LIVE_WORKSPACE_DEBOUNCE_MS);
      } else if (frame.type === "workspace_committed" && frame.skillId === skillId) {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        setFiles([]);
      }
    });

    return () => {
      cancelled = true;
      close();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [threadId, skillId, refreshFiles]);

  return {
    isLive: fold.isLive,
    checking,
    baseVersionId: fold.baseVersionId,
    files,
    filesError,
    changedPaths: fold.changedPaths,
    autoOpenNonce: autoOpen.nonce,
    autoOpenPath: autoOpen.path,
    committed: fold.committed,
  };
}
