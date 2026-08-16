import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApplyPreviewRequest,
  ApplyPreviewResponse,
  ProjectPreviewRequest,
  ProjectPreviewResponse,
  SaveSkillDraftRequest,
  SkillEditOp,
  SkillEditsResponse,
  SkillFileNode,
  SkillGraph,
  SkillIntentLogEntry,
} from "@mcp-token-footprint/shared";
import { apiPost } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import {
  getSkillFile,
  getSkillFiles,
  getSkillGraph,
  getSkillVersion,
} from "../skills-inspector-api";
import { describeEditOp, useEditOps, type EditOpsController } from "./use-edit-ops";

// ── Skill IDE WP 9.1 (I10) — the live-draft store ─────────────────────────────────────────────────
// The I10 foundation: while editing there is exactly ONE working state — the draft SKILL.md text (plus
// pending tree ops + an op INTENT LOG). Canvas interactions still compile to the edit-op vocabulary
// (`useEditOps`, kept as the interaction layer), but the draft is derived by feeding that buffer through
// the SAME server-side splice the persisted save uses (`apply-preview`), so a canvas edit is reflected
// in the draft text immediately and a future code editor edits the SAME draft. The canvas re-projects
// from the draft via `project-preview` (debounced, last-good retention). Save is content-canonical
// (`POST /api/skills/:id/save-draft`) — the intent log rides along as version metadata (audit granularity
// survives the text save); a moved head is a surfaced 409. Nothing mutates until Save (I2, amended by I10).

const APPLY_PREVIEW_DEBOUNCE_MS = 150;
const PROJECT_PREVIEW_DEBOUNCE_MS = 300;

/** Op discriminants that are TREE/file ops (not text splices) — routed to `treeOps`, not apply-preview. */
const TREE_OP_TYPES = new Set(["add_file", "update_file", "rename_file", "delete_file"]);
const isTreeOp = (op: SkillEditOp): boolean => TREE_OP_TYPES.has(op.op);

// The two stateless preview endpoints + the content-canonical save (defined here — the shared
// skills-inspector-api module is owned by another surface; these are WP 9.1's own calls).
const applyPreview = (body: ApplyPreviewRequest): Promise<ApplyPreviewResponse> =>
  apiPost<ApplyPreviewResponse>("/api/skillflow/apply-preview", body);
const projectPreview = (body: ProjectPreviewRequest): Promise<ProjectPreviewResponse> =>
  apiPost<ProjectPreviewResponse>("/api/skillflow/project-preview", body);
const saveSkillDraft = (
  skillId: string,
  body: SaveSkillDraftRequest,
): Promise<SkillEditsResponse> =>
  apiPost<SkillEditsResponse>(`/api/skills/${skillId}/save-draft`, body);

/** The loaded base a draft forks from: the head version's SKILL.md, its file list, tree sha, and the
 *  authoritative projected graph (the graph every staged op targets — never the live preview). */
type DraftBase = {
  versionId: string;
  treeSha: string;
  content: string;
  files: SkillFileNode[];
  graph: SkillGraph;
};

export type SkillDraftController = {
  /** The op buffer (the interaction layer). Panels stage ops here EXACTLY as before — the draft store
   *  watches the buffer and derives the live draft from it. Public API unchanged (WP 9.1). */
  edit: EditOpsController;
  /** The authoritative base graph — every op's anchors resolve against THIS (not the live preview). */
  baseGraph: SkillGraph | null;
  /** The base version's tree sha (kept for reference; the save's staleness check is head-based). */
  treeSha: string | null;
  /** The version the draft forked from (the save's `baseVersionId`). */
  baseVersionId: string;
  loading: boolean;
  error: string | null;
  /** The LIVE draft SKILL.md — the ops buffer fed through `apply-preview` (canonical; a code editor
   *  would edit this directly). Equals the base content when nothing is staged. */
  content: string;
  /** The LIVE projection of {@link content} (`project-preview`, debounced, last-good on error). */
  draftGraph: SkillGraph | null;
  /** True while a debounced `project-preview` is in flight (there is still a last-good graph to show). */
  projecting: boolean;
  /** True once the draft TEXT was edited directly (code mode) — the op buffer no longer describes the
   *  content, so consumers must render the live projection ({@link draftGraph}) rather than the
   *  client-side op preview. Cleared on reset/reload/version switch. WP 9.2 reads this to pick which
   *  graph the flow canvas renders (one document, two projections). */
  manualEdit: boolean;
  /** Edit the draft text directly (the code-mode writer — WP 9.2 consumes this). Clears the op buffer
   *  since the text is now the source of truth, not the ops. */
  setContent: (next: string) => void;
  /** Staged edits exist (op buffer non-empty OR the draft text diverged from base). */
  dirty: boolean;
  /** Re-fetch the base version (after a 409 / external change). The op buffer is KEPT. */
  reload: () => Promise<void>;
  /** Drop every staged op and revert the draft to the base content. */
  reset: () => void;
  /** Content-canonical save → a new immutable version (409 when the head moved). The op buffer becomes
   *  the intent log attached to the new version's metadata. */
  save: (note?: string) => Promise<SkillEditsResponse>;
};

/**
 * The live-draft store for one skill version. Loads the base (graph + files + SKILL.md + tree sha),
 * owns the op buffer, and keeps the derived draft text + its projection in sync.
 *
 * @param onLoaded called once each time a version's base graph finishes loading (lets the view open a
 *   blank skill straight into edit mode, as before).
 */
export function useSkillDraft(
  skillId: string,
  versionId: string,
  onLoaded?: (graph: SkillGraph) => void,
): SkillDraftController {
  const edit = useEditOps();
  const [base, setBase] = useState<DraftBase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [content, setContentState] = useState("");
  const [manualEdit, setManualEdit] = useState(false); // a code edit made content authoritative over the ops
  const [draftGraph, setDraftGraph] = useState<SkillGraph | null>(null);
  const [projecting, setProjecting] = useState(false);

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const clear = edit.clear;

  const load = useCallback(async (): Promise<DraftBase> => {
    const [graphResponse, files, skillMd, version] = await Promise.all([
      getSkillGraph(skillId, versionId),
      getSkillFiles(skillId, versionId),
      getSkillFile(skillId, versionId, "SKILL.md"),
      getSkillVersion(skillId, versionId),
    ]);
    return {
      versionId,
      treeSha: version.treeSha,
      content: skillMd.isBinary ? "" : skillMd.text,
      files,
      graph: graphResponse.graph,
    };
  }, [skillId, versionId]);

  // Load (and reset all local state) on every version switch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBase(null);
    setDraftGraph(null);
    setManualEdit(false);
    setContentState("");
    clear();
    load()
      .then((loaded) => {
        if (cancelled) return;
        setBase(loaded);
        setContentState(loaded.content);
        setDraftGraph(loaded.graph);
        setLoading(false);
        onLoadedRef.current?.(loaded.graph);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(getErrorMessage(err, "Couldn’t load the skill draft"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId, versionId]);

  // Derive the draft CONTENT from the op buffer via apply-preview (debounced). A manual code edit takes
  // over (`manualEdit`) — the ops no longer describe the text. With no ops the draft is the base content.
  const ops = edit.ops;
  useEffect(() => {
    if (!base || manualEdit) return;
    const textOps = ops.filter((op) => !isTreeOp(op));
    if (textOps.length === 0) {
      setContentState(base.content);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      applyPreview({ content: base.content, ops: textOps, files: base.files })
        .then((res) => {
          if (!cancelled) setContentState(res.content);
        })
        .catch(() => {
          /* keep the last-good draft content — a transient/validation failure never blanks the editor */
        });
    }, APPLY_PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [base, ops, manualEdit]);

  // Re-project the draft CONTENT (debounced ~300 ms) with LAST-GOOD retention: on a transient failure
  // the previous graph stays on screen rather than flashing empty.
  useEffect(() => {
    if (!base) return;
    let cancelled = false;
    setProjecting(true);
    const handle = setTimeout(() => {
      projectPreview({ content, files: base.files })
        .then((res) => {
          if (cancelled) return;
          setDraftGraph(res.graph);
          setProjecting(false);
        })
        .catch(() => {
          if (!cancelled) setProjecting(false); // keep the last-good draftGraph
        });
    }, PROJECT_PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [base, content]);

  const setContent = useCallback(
    (next: string) => {
      setManualEdit(true);
      setContentState(next);
      clear(); // the text is now authoritative; the op buffer no longer describes it
    },
    [clear],
  );

  const reset = useCallback(() => {
    clear();
    setManualEdit(false);
    if (base) setContentState(base.content);
  }, [clear, base]);

  const reload = useCallback(async () => {
    const loaded = await load();
    setBase(loaded);
    // Keep the op buffer (the user's pending edits) — the draft content re-derives from the effect.
    if (!manualEdit && edit.ops.filter((op) => !isTreeOp(op)).length === 0) {
      setContentState(loaded.content);
    }
    setDraftGraph(loaded.graph);
  }, [load, manualEdit, edit.ops]);

  const save = useCallback(
    async (note?: string): Promise<SkillEditsResponse> => {
      if (!base) throw new Error("The draft is not loaded yet.");
      const treeOps = edit.ops.filter(isTreeOp);
      const textOps = edit.ops.filter((op) => !isTreeOp(op));
      // Recompute the content FRESH at save time so it reflects every staged op even if the ~150 ms
      // apply-preview debounce hasn't fired yet — the saved version is then byte-exact for the ops. A
      // manual code edit keeps `content` authoritative (the ops no longer describe the text).
      let finalContent = content;
      if (!manualEdit) {
        finalContent =
          textOps.length === 0
            ? base.content
            : (await applyPreview({ content: base.content, ops: textOps, files: base.files }))
                .content;
      }
      const intentLog: SkillIntentLogEntry[] = edit.ops.map((op) => ({
        op,
        summary: describeEditOp(op, base.graph),
        at: new Date().toISOString(),
      }));
      return saveSkillDraft(skillId, {
        baseVersionId: base.versionId,
        content: finalContent,
        treeOps,
        intentLog,
        ...(note ? { note } : {}),
      });
    },
    [base, edit.ops, content, manualEdit, skillId],
  );

  const dirty = edit.dirty || (base ? content !== base.content : false);

  return {
    edit,
    baseGraph: base?.graph ?? null,
    treeSha: base?.treeSha ?? null,
    baseVersionId: versionId,
    loading,
    error,
    content,
    draftGraph,
    projecting,
    manualEdit,
    setContent,
    dirty,
    reload,
    reset,
    save,
  };
}
