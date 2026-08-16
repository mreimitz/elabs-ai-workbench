import { createContext, useContext } from "react";

// Skill Studio WP 7.3a — the host bridge that lets the Tools palette (mounted deep inside the
// unified editor) run the bind/unbind flow WITHOUT threading new props through the editor shell:
// `SkillDesignView` provides it around `UnifiedEditor`, the palette consumes it. It deliberately
// carries only identity + guard state — the binding edit itself is applied through the SAME
// content-canonical save the draft uses (`POST /api/skills/:id/save-draft`), and `onVersionSaved`
// hands the new version to the inspector exactly like the editor's own save does.

export type SkillBindingHost = {
  skillId: string;
  /** The version the palette is looking at — bindings only save when this is still the head. */
  versionId: string;
  /**
   * True while the unified editor holds unsaved draft changes. Binding is DISABLED then: it saves a
   * new version from the SAVED document, which would move the head under the open draft (409 on the
   * user's own save). Save or discard first — the guard keeps the two save paths from colliding.
   */
  editorDirty: boolean;
  /** The inspector's refresh-and-select-new-version callback (same contract as the editor's save). */
  onVersionSaved?: (newVersionId: string) => void;
};

export const SkillBindingHostContext = createContext<SkillBindingHost | null>(null);

/** The palette's accessor. `null` ⇒ no binding host (the bind UI degrades to read-only chips). */
export function useSkillBindingHost(): SkillBindingHost | null {
  return useContext(SkillBindingHostContext);
}
