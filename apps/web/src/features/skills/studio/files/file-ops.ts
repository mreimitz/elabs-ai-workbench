import type { SkillEditOp, SkillFileNode } from "@mcp-token-footprint/shared";
import {
  SKILL_MD,
  deriveTreeOps,
  describeTreeOp,
  type WorkEntry,
} from "../../workspace/workspace-model";

// ── Skill Studio (RM-30 WP 7.4) — the files layer's pure edge ──────────────────────────────────────
// The Studio's one draft already spans the SKILL.md text (`content`), the canvas op buffer and the
// frontmatter settings layer. This module is the fourth kind of pending change: the version's OTHER
// files, staged as an in-memory working tree (`useWorkspace`, unchanged from the Files tab) and
// turned into the `SkillEditOp[]` tree batch that rides the SAME single save.
//
// Everything here is pure so the ONE invariant that matters can be unit-tested without React:
//
//   SKILL.md is written by `content`, and by nothing else.
//
// `POST /api/skills/:id/save-draft` builds the new tree as "the base tree with SKILL.md ← content",
// and THEN applies `treeOps` on top (see `apps/api/src/skills/routes.ts`). So an `update_file`,
// `rename_file` or `delete_file` op naming SKILL.md in the same request would win over the draft
// text the author just typed — a silent lost update, and the failure mode would look exactly like
// "the editor didn't save my changes". The Studio never mints such an op (the manifest's tab edits
// `content`; `useWorkspace` refuses to rename/move/delete it), so this filter is a belt-and-braces
// guard on the boundary rather than a behaviour — and `studioFileOps` is where it is enforced once,
// for every caller.

/** True when `op` is a tree op that would write, move or remove the SKILL.md manifest. */
export function opTargetsSkillMd(op: SkillEditOp): boolean {
  switch (op.op) {
    case "add_file":
    case "update_file":
    case "delete_file":
      return op.path === SKILL_MD;
    case "rename_file":
      return op.from === SKILL_MD || op.to === SKILL_MD;
    default:
      return false;
  }
}

/**
 * The tree batch the Studio's files layer contributes to a save: every change between the base
 * version's files and the working tree, EXCEPT anything touching SKILL.md (see the module doc).
 */
export function studioFileOps(base: SkillFileNode[], entries: WorkEntry[]): SkillEditOp[] {
  return deriveTreeOps(base, entries).filter((op) => !opTargetsSkillMd(op));
}

/** One human-readable line per staged file change — folded into the save dialog's pending list. */
export function describeStudioFileOps(ops: readonly SkillEditOp[]): string[] {
  return ops.map(describeTreeOp);
}

/**
 * The files the Studio's centre surface can open as EDITOR TABS: everything except the manifest,
 * which is not a tab of its own — it is the Flow/Code/Split surface the whole Studio is built round.
 */
export function isTabbableFile(entry: Pick<WorkEntry, "path" | "originalPath">): boolean {
  return entry.path !== SKILL_MD && entry.originalPath !== SKILL_MD;
}

export { SKILL_MD };
