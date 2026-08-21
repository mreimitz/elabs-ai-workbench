import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { SkillEditOp, SkillGraph } from "@mcp-token-footprint/shared";
import {
  addFrontmatterListItem,
  isFrontmatterScalarEditable,
  parseFrontmatterList,
  parseFrontmatterScalar,
  removeFrontmatterListItem,
  setFrontmatterScalar,
} from "../design/frontmatter-servers";
import { applyPreviewOps, isPreviewOnlyNodeId } from "../design/use-edit-ops";
import { useSkillDraft, type SkillDraftController } from "../design/use-skill-draft";
import { useWorkspace, type WorkspaceController } from "../workspace/use-workspace";
import { describeStudioFileOps, studioFileOps } from "./files/file-ops";

// ── Skill Studio (RM-30 WP 7.3) — ONE draft store for the whole workbench ─────────────────────────
// Before this WP the Studio had one draft store (`useSkillDraft`) but it lived INSIDE the editor, so
// nothing outside the centre surface could reach it. That is why WP 7.3a's server binding had to
// save immediately through its own `POST /api/skills/:id/save-draft` call (deviation D-UX18): the
// rail had no draft to write into. This module is the fix — the draft is lifted to the shell,
// published through a context, and consumed by both the editor and the left rail's settings panel.
//
// The store spans FOUR kinds of pending change and reports ONE dirty flag over all of them:
//
//   • canvas  — typed edit ops (`useEditOps` → `apply-preview` → the draft text). Unchanged.
//   • code    — a direct edit of the draft text in the Monaco pane. Unchanged.
//   • frontmatter — `name:` / `description:` / `servers:` / `keywords:`, staged here as declarative
//     {@link SkillSettingsEdit}s and applied as a PURE text transform on top of the op-derived text.
//   • files (RM-30 WP 7.4) — the version's OTHER files, staged as an in-memory working tree and
//     derived into a tree-op batch at save time (`files/file-ops.ts`).
//
// The files layer is a separate layer for the same reason the frontmatter one is — and one more.
// Staging a file op into the shared op buffer would look tempting (`save` already routes tree ops
// out of it), but `setContent` CLEARS that buffer by design: the moment an author typed a character
// in the SKILL.md code pane, a new file they had just created would vanish without a word. As its
// own layer it survives every edit to the manifest, and vice versa.
//
// Frontmatter is a separate layer, not a fourth kind of op, for a concrete reason: the shared edit-op
// vocabulary (`SKILL_EDIT_OP_TYPES`) has no `set_name`, `set_description` or `set_servers`, and
// widening it is a wire change this WP deliberately does not make. Applying the layer as text is
// exact (the WP 7.3a byte-preserving engine does the splicing), SYNCHRONOUS (a settings keystroke
// shows in the Code view immediately, with no `apply-preview` round-trip), and it rides the SAME
// single save — `save()` passes the transform down to `useSkillDraft`, which applies it as the last
// step before posting. One save, one new immutable version.
//
// It never executes anything, and nothing is persisted until the author presses Save as vN.

/** The frontmatter keys the settings panel owns. Everything else in the block is authored text and is
 *  preserved byte-for-byte by the splicing engine. */
export const SETTINGS_NAME_KEY = "name";
export const SETTINGS_DESCRIPTION_KEY = "description";
export const SETTINGS_SERVERS_KEY = "servers";
export const SETTINGS_KEYWORDS_KEY = "keywords";

/**
 * One staged frontmatter change. Declarative on purpose — a stored function could not be collapsed,
 * described, or replayed, and this list is what the save dialog itemizes.
 */
export type SkillSettingsEdit =
  | { field: "name"; value: string }
  | { field: "description"; value: string }
  | { field: "servers"; action: "bind" | "unbind"; name: string }
  | { field: "keywords"; action: "add" | "remove"; value: string };

/** The skill's frontmatter settings, read back out of the LIVE draft text. */
export type SkillSettings = {
  /** `null` when the key is absent or holds a shape the editor refuses to touch. */
  name: string | null;
  description: string | null;
  servers: string[];
  keywords: string[];
  /** False when `name:` is a shape this editor will not write (a list, a block scalar). */
  nameEditable: boolean;
  descriptionEditable: boolean;
};

/** The identity of an edit for collapsing: two edits with the same key replace each other. */
function editKey(edit: SkillSettingsEdit): string {
  switch (edit.field) {
    case "name":
    case "description":
      return edit.field;
    case "servers":
      return `servers:${edit.name}`;
    case "keywords":
      return `keywords:${edit.value}`;
  }
}

/**
 * Collapse a staged list so each target is named once, LAST WRITE WINS, in first-staged order.
 * Binding a server then unbinding it leaves one `unbind`; if the server was never bound, applying
 * that unbind is a no-op and the draft comes out byte-identical — which is exactly how "I changed my
 * mind" stops being a pending change without any special-casing.
 */
export function collapseSettingsEdits(edits: readonly SkillSettingsEdit[]): SkillSettingsEdit[] {
  const byKey = new Map<string, SkillSettingsEdit>();
  for (const edit of edits) byKey.set(editKey(edit), edit);
  return [...byKey.values()];
}

/** Apply ONE staged change to a SKILL.md document. Pure; refuses rather than corrupts (see the
 *  engine's own contract) and returns its input unchanged when the edit is a no-op. */
export function applySettingsEdit(text: string, edit: SkillSettingsEdit): string {
  switch (edit.field) {
    case "name":
      return setFrontmatterScalar(text, SETTINGS_NAME_KEY, edit.value);
    case "description":
      return setFrontmatterScalar(text, SETTINGS_DESCRIPTION_KEY, edit.value);
    case "servers":
      return edit.action === "bind"
        ? addFrontmatterListItem(text, SETTINGS_SERVERS_KEY, edit.name)
        : removeFrontmatterListItem(text, SETTINGS_SERVERS_KEY, edit.name);
    case "keywords":
      return edit.action === "add"
        ? addFrontmatterListItem(text, SETTINGS_KEYWORDS_KEY, edit.value)
        : removeFrontmatterListItem(text, SETTINGS_KEYWORDS_KEY, edit.value);
  }
}

/** Apply every staged change, in collapsed order. */
export function applySettingsEdits(text: string, edits: readonly SkillSettingsEdit[]): string {
  let next = text;
  for (const edit of collapseSettingsEdits(edits)) next = applySettingsEdit(next, edit);
  return next;
}

/** A one-line description of a staged change — the save dialog's pending list. */
export function describeSettingsEdit(edit: SkillSettingsEdit): string {
  switch (edit.field) {
    case "name":
      return edit.value === "" ? "Clear the skill name" : `Set the skill name to “${edit.value}”`;
    case "description":
      return edit.value === ""
        ? "Clear the description"
        : `Set the description to “${edit.value}”`;
    case "servers":
      return edit.action === "bind"
        ? `Bind the server “${edit.name}”`
        : `Unbind the server “${edit.name}”`;
    case "keywords":
      return edit.action === "add"
        ? `Add the trigger keyword “${edit.value}”`
        : `Remove the trigger keyword “${edit.value}”`;
  }
}

/** Read the settings back out of a SKILL.md document. */
export function readSkillSettings(text: string): SkillSettings {
  return {
    name: parseFrontmatterScalar(text, SETTINGS_NAME_KEY),
    description: parseFrontmatterScalar(text, SETTINGS_DESCRIPTION_KEY),
    servers: parseFrontmatterList(text, SETTINGS_SERVERS_KEY),
    keywords: parseFrontmatterList(text, SETTINGS_KEYWORDS_KEY),
    nameEditable: isFrontmatterScalarEditable(text, SETTINGS_NAME_KEY),
    descriptionEditable: isFrontmatterScalarEditable(text, SETTINGS_DESCRIPTION_KEY),
  };
}

/** One `/command` entry point projected from the live draft graph. */
export type StudioCommandEntry = {
  /** The projected node id — `null` for a command staged but not yet saved (it has no real node
   *  until the server re-projects the saved document, so it cannot be renamed or deleted by id). */
  nodeId: string | null;
  /** The trigger token, e.g. `/report`. */
  command: string;
  label: string;
};

export type StudioDraftController = SkillDraftController & {
  /** The skill's frontmatter settings, read from the LIVE draft text (so a hand edit in the Code
   *  view and a settings edit are the same source of truth, in both directions). */
  settings: SkillSettings;
  /** The staged frontmatter changes, collapsed. */
  settingsEdits: SkillSettingsEdit[];
  /** Stage one frontmatter change. Takes effect on `content` synchronously. */
  stageSettingsEdit: (edit: SkillSettingsEdit) => void;
  /** The `/command` entry points of the live projection, in document order. */
  commands: StudioCommandEntry[];
  /**
   * RM-30 WP 7.4 — the files layer: the version's working tree plus every mutation the Files rail
   * offers (create · upload · rename · move · delete · edit). Its `ops` are ONE half of the same
   * save; nothing here writes anything until the author presses Save as vN.
   */
  files: WorkspaceController;
  /** The staged file changes as tree ops, with anything targeting SKILL.md filtered out (the
   *  manifest is written by `content`, and by nothing else — see `files/file-ops.ts`). */
  fileOps: SkillEditOp[];
  /** True when the SKILL.md DOCUMENT itself has unsaved changes — canvas ops, a hand edit, or a
   *  settings change. Deliberately narrower than {@link SkillDraftController.dirty}, which also
   *  counts staged file changes: the manifest's editor tab marks itself, and a new resource file
   *  must not make SKILL.md look edited. */
  manifestDirty: boolean;
};

/** `null` outside a Studio — every other host (the inspector, a test) keeps its own private draft. */
export const StudioDraftContext = createContext<StudioDraftController | null>(null);

/** The Studio draft, or `null` when this tree is not inside one. */
export function useOptionalStudioDraft(): StudioDraftController | null {
  return useContext(StudioDraftContext);
}

/** The Studio draft. Throws outside a Studio — a settings panel with no draft has nothing to edit,
 *  and a silent no-op there would look exactly like a save that quietly lost the author's work. */
export function useStudioDraft(): StudioDraftController {
  const draft = useOptionalStudioDraft();
  if (!draft) {
    throw new Error("useStudioDraft() must be used inside a StudioDraftContext provider.");
  }
  return draft;
}

/**
 * Build the Studio's one draft: the existing live-draft store plus the frontmatter layer.
 *
 * @param nextVersionLabel what the save would create, e.g. `"v5"` — carried on the controller so the
 *   toolbar's one save action can name the version bump.
 */
export function useStudioDraftController(
  skillId: string,
  versionId: string,
  nextVersionLabel: string,
): StudioDraftController {
  const inner = useSkillDraft(skillId, versionId);
  const [staged, setStaged] = useState<SkillSettingsEdit[]>([]);

  // ── the files layer ────────────────────────────────────────────────────────────────────────────
  // Seeded from the SAME base-file load the draft already made (no second `getSkillFiles` fetch).
  // `useWorkspace` re-seeds — dropping every staged file change — whenever the array it is handed
  // changes IDENTITY, so the identity is pinned to the tree's CONTENT here. That is what makes the
  // save dialog's 409 recovery honest: `reload()` re-fetches and hands back a fresh array, and its
  // toast promises "your pending edits are kept". If the head moved for an unrelated reason the
  // file list is byte-identical, the same array comes back, and the promise holds; if the files
  // themselves moved, re-seeding from the new base is the correct — and the only safe — answer.
  const baseFilesKey = inner.baseFiles
    .map((file) => `${file.path}|${file.size}|${file.isBinary}`)
    .join("\n");
  // The deps are deliberately the content key, not the array itself.
  const baseFiles = useMemo(() => inner.baseFiles, [baseFilesKey]);

  const files = useWorkspace(baseFiles);
  const fileOps = useMemo(
    () => studioFileOps(baseFiles, files.entries),
    [baseFiles, files.entries],
  );

  const settingsEdits = useMemo(() => collapseSettingsEdits(staged), [staged]);

  // The live document: op-derived text (or the hand-edited text) with the frontmatter layer on top.
  const content = useMemo(
    () => applySettingsEdits(inner.content, settingsEdits),
    [inner.content, settingsEdits],
  );

  const settings = useMemo(() => readSkillSettings(content), [content]);

  // Only the edits that actually MOVE the document are pending. A bind of an already-bound server,
  // or a bind followed by an unbind, changes no bytes and must not read as an unsaved change.
  const extraPendingLines = useMemo(
    () => [
      ...settingsEdits
        .filter((edit) => applySettingsEdit(inner.content, edit) !== inner.content)
        .map(describeSettingsEdit),
      ...describeStudioFileOps(fileOps),
    ],
    [settingsEdits, inner.content, fileOps],
  );

  const settingsDirty = content !== inner.content;
  /** The manifest document alone — file changes are a separate half of the same draft. */
  const manifestDirty = inner.dirty || settingsDirty;

  const stageSettingsEdit = useCallback((edit: SkillSettingsEdit) => {
    setStaged((current) => [...current, edit]);
  }, []);

  // A direct text edit makes the TEXT authoritative — the staged frontmatter changes are already
  // baked into what the author is now typing over, so replaying them would clobber a hand edit.
  const innerSetContent = inner.setContent;
  const setContent = useCallback(
    (next: string) => {
      setStaged([]);
      innerSetContent(next);
    },
    [innerSetContent],
  );

  const innerReset = inner.reset;
  const resetFiles = files.reset;
  const reset = useCallback(() => {
    setStaged([]);
    resetFiles(baseFiles);
    innerReset();
  }, [innerReset, resetFiles, baseFiles]);

  const innerSave = inner.save;
  const save = useCallback(
    (note?: string, transformContent?: (text: string) => string, extraTreeOps?: SkillEditOp[]) =>
      innerSave(
        note,
        (text) => {
          const withSettings = applySettingsEdits(text, settingsEdits);
          return transformContent ? transformContent(withSettings) : withSettings;
        },
        // The files layer rides the SAME one save. A caller's own extra ops (there are none today)
        // are kept rather than replaced, so this can never silently drop a second contributor.
        [...fileOps, ...(extraTreeOps ?? [])],
      ),
    [innerSave, settingsEdits, fileOps],
  );

  // The `/command` entry points, read from the same projection the canvas renders: the live
  // `project-preview` graph once the text has been hand-edited, else the snappy client-side op
  // preview. Reading them from the graph rather than the text is deliberate — the projector is the
  // authority on what a command IS, and the settings panel must not grow a second opinion.
  const { baseGraph, draftGraph, manualEdit } = inner;
  const ops = inner.edit.ops;
  const commands = useMemo(() => {
    const preview = baseGraph ? applyPreviewOps(baseGraph, ops) : null;
    return commandEntries(manualEdit ? draftGraph : preview);
  }, [baseGraph, ops, manualEdit, draftGraph]);

  return useMemo(
    () => ({
      ...inner,
      content,
      dirty: inner.dirty || settingsDirty || fileOps.length > 0,
      setContent,
      reset,
      save,
      extraPendingLines,
      nextVersionLabel,
      settings,
      settingsEdits,
      stageSettingsEdit,
      commands,
      files,
      fileOps,
      manifestDirty,
    }),
    [
      inner,
      content,
      settingsDirty,
      setContent,
      reset,
      save,
      extraPendingLines,
      nextVersionLabel,
      settings,
      settingsEdits,
      stageSettingsEdit,
      commands,
      files,
      fileOps,
      manifestDirty,
    ],
  );
}

/** Project a graph's `/command` entry points, in the order the graph lists them. */
export function commandEntries(graph: SkillGraph | null): StudioCommandEntry[] {
  if (!graph) return [];
  const entries: StudioCommandEntry[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== "entry_point" || node.trigger.type !== "command") continue;
    entries.push({
      // A preview node minted by `applyPreviewOps` has no server-side identity yet, so the rename /
      // delete ops (which target a real nodeId) cannot address it until the draft is saved.
      nodeId: isPreviewOnlyNodeId(node.id) ? null : node.id,
      command: node.trigger.value,
      label: node.label,
    });
  }
  return entries;
}
