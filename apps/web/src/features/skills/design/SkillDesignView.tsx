import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { BoundTool } from "@mcp-token-footprint/shared";
import { SkillBindingHostContext, type SkillBindingHost } from "./bind-server-context";
import { UnifiedEditor, type UnifiedEditorProps } from "./UnifiedEditor";

export type SkillDesignViewProps = {
  skillId: string;
  versionId: string;
  /** Bubbles the local dirty (unsaved live-draft) state up so the inspector can guard tab/version
   *  switches and its own navigation — WP 4.2's "unsaved changes" requirement. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called right after a version is saved (with the NEW version's id) — the inspector refetches
   *  the skill + version list and switches the active selection to it (mirrors "Pull latest"). */
  onVersionSaved?: (newVersionId: string) => void;
  /** Deep-link into the Diff tab for (fromVersionId, toVersionId) — wired to the inspector's own
   *  A/B pickers, exactly like "Pull latest"'s `openDiff`. */
  onOpenDiff?: (fromVersionId: string, toVersionId: string) => void;
  /** Skill IDE WP 8.5 — open the inline tool-runner Sheet for an ALREADY-RESOLVED bound tool. */
  onTestTool?: (tool: BoundTool) => void;
  /** SI13 — forwarded to {@link UnifiedEditor}: registers the save cluster (dirty chip · Discard ·
   *  Save…) into the inspector's page-header action row while this surface is mounted. */
  onHeaderActionsChange?: (actions: ReactNode | null) => void;
} & Pick<
  UnifiedEditorProps,
  // RM-30 WP 7.9 — WHICH surface the editor paints, and how it asks for the other one. Both are
  // REQUIRED: the host decides them from the tab it has open, and there is no default that would be
  // right for every host.
  "mode" | "onRequestMode"
> &
  Pick<
    UnifiedEditorProps,
    // RM-30 WP 7.1 — the Skill Studio's host-chrome slots, forwarded verbatim (this component
    // already spreads `{...props}` onto the editor). Every one is optional.
    | "onProblemsChange"
    | "problemsOpen"
    | "onProblemsOpenChange"
    | "onProblemsSummaryChange"
    | "initialSelectedNodeId"
    | "onSelectedNodeChange"
    | "flowToolsContainer"
    | "flowDetailContainer"
    // RM-30 WP 7.3 — the palette's deep link into the Studio rail's Settings tab.
    | "onOpenServerSettings"
  >;

/**
 * The authoring surface. Since Skill IDE WP 9.2 (I10 — "one document, two live views") it HOSTS the
 * {@link UnifiedEditor} over one live draft; RM-30 WP 7.9 made WHICH of the two views it paints a
 * required prop rather than a control on the toolbar. All the editing behavior — canvas gestures,
 * the code editor, the single Save/Discard bar, selection sync, deep links — lives in
 * `UnifiedEditor`; this is a thin, prop-preserving host.
 *
 * Skill Studio WP 7.3a: it additionally provides the {@link SkillBindingHostContext} around the
 * editor so the Tools palette (mounted deep inside `UnifiedEditor`) can run the first-class
 * bind/unbind-server flow — identity (skillId/versionId), the editor's live dirty flag (binding is
 * disabled while a draft is unsaved, so the two save paths never race), and the inspector's
 * `onVersionSaved` hand-over. The editor's own props/behavior are untouched: `onDirtyChange` is
 * observed (then forwarded verbatim), nothing else is intercepted.
 */
export function SkillDesignView(props: SkillDesignViewProps) {
  const { skillId, versionId, onDirtyChange, onVersionSaved } = props;

  const [editorDirty, setEditorDirty] = useState(false);
  const handleDirtyChange = useCallback(
    (dirty: boolean) => {
      setEditorDirty(dirty);
      onDirtyChange?.(dirty);
    },
    [onDirtyChange],
  );

  const bindingHost = useMemo<SkillBindingHost>(
    () => ({
      skillId,
      versionId,
      editorDirty,
      ...(onVersionSaved ? { onVersionSaved } : {}),
    }),
    [skillId, versionId, editorDirty, onVersionSaved],
  );

  return (
    <SkillBindingHostContext.Provider value={bindingHost}>
      <UnifiedEditor {...props} onDirtyChange={handleDirtyChange} />
    </SkillBindingHostContext.Provider>
  );
}
