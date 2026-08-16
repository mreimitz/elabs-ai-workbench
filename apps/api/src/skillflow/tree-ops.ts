import type { SkillEditOp, SkillFileEncoding } from "@mcp-token-footprint/shared";
import { assertTreeWithinCaps, type IngestCaps } from "../skills/caps.js";
import { httpError } from "../utils/errors.js";

/** A file of the in-memory workspace tree: a posix path plus its raw bytes. */
export type TreeFile = { path: string; content: Buffer };

export type ApplyTreeOpsResult = {
  /** The new tree after every op applied, sorted by path (blobs of untouched files are the SAME bytes). */
  files: TreeFile[];
  /** Soft, non-fatal notes (kept for symmetry with `applyEditOps`; hard violations throw a typed 4xx). */
  warnings: string[];
};

/** The manifest-invariant file that every version must keep — never renamed or deleted (I3). */
const SKILL_MD = "SKILL.md";

/** The tree/file ops this engine understands (the other IDE ops are text/graph edits, not tree ops). */
const FILE_OPS = new Set(["add_file", "update_file", "rename_file", "delete_file"]);

/**
 * Apply a batch of TREE-level edit ops (I3) over an in-memory file tree, producing the new tree — a
 * pure function (no I/O, no clock): the route materializes the version's stored blobs into
 * `{ path, content }[]`, hands them here, and persists the result as ONE new immutable version.
 *
 * Semantics (folders are IMPLICIT path prefixes — there is no folder object; a file landing under a
 * new prefix "creates" the folder, and a folder rename is just the batch of `rename_file` ops the UI
 * composes — no persistent empty folders exist server-side):
 * - `add_file { path, content, encoding? }` — decode `content` (`utf8` default | `base64`) and add
 *   at `path`; the path must NOT already exist (target-exists → 400). Caps (per-file / total /
 *   file-count) are enforced over the FINAL tree via the shared ingest helpers — an oversize add
 *   throws before anything is persisted.
 * - `update_file { path, content, encoding? }` — replace the bytes at an EXISTING `path`. `SKILL.md`
 *   may be updated (a legal content edit); the route additionally refuses a batch that BOTH
 *   text-edits `SKILL.md` (section ops) AND `update_file`s it (conflicting → 400).
 * - `rename_file { from, to }` — move the blob from `from` (must exist) to `to` (must NOT exist);
 *   "move" is just a rename whose `to` has a different directory prefix. The bytes are preserved
 *   verbatim, so an untouched blob keeps its content-addressed sha (rename shows in the diff as a
 *   rename, not add+remove).
 * - `delete_file { path }` — remove an EXISTING `path`.
 *
 * Guards (every violation is a typed 400 — nothing is persisted):
 * - `SKILL.md` may be `update_file`'d but NEVER `rename_file`'d (as `from`) or `delete_file`'d.
 * - path traversal is refused: a `..` segment, an absolute path, a Windows drive, or a backslash.
 * - CASE-ONLY renames are handled EXPLICITLY: paths are treated as case-SENSITIVE exact strings
 *   (git object model), so `README.md` → `readme.md` is a legal rename here — `from` exists exactly
 *   and `to` (the differently-cased name) does not — even though a case-insensitive filesystem would
 *   consider them the same name. The blob is preserved; only the stored path string changes.
 *
 * Ops apply in array order over the tree; the route validates set-level issues (unknown paths,
 * conflicting pairs, target collisions with original paths) up front via `edit-ops.ts`, so a
 * well-formed batch reaching here never needs delete-then-re-add semantics (to replace a file, use
 * `update_file`).
 */
export function applyTreeOps(
  files: TreeFile[],
  ops: SkillEditOp[],
  caps: IngestCaps,
): ApplyTreeOpsResult {
  const warnings: string[] = [];
  // Case-sensitive exact-path map (git object model) seeded from the version's tree.
  const tree = new Map<string, Buffer>();
  for (const file of files) tree.set(file.path, file.content);

  for (const op of ops) {
    if (!FILE_OPS.has(op.op)) continue; // defensive — the route hands us only file ops
    switch (op.op) {
      case "add_file": {
        assertSafePath(op.op, op.path);
        if (tree.has(op.path)) {
          throw httpError(400, `add_file: "${op.path}" already exists in this version.`);
        }
        tree.set(op.path, decodeContent(op.content, op.encoding));
        break;
      }
      case "update_file": {
        assertSafePath(op.op, op.path);
        if (!tree.has(op.path)) {
          throw httpError(400, `update_file: "${op.path}" does not exist in this version.`);
        }
        tree.set(op.path, decodeContent(op.content, op.encoding));
        break;
      }
      case "rename_file": {
        assertSafePath("rename_file", op.from);
        assertSafePath("rename_file", op.to);
        if (op.from === SKILL_MD) {
          throw httpError(400, `SKILL.md cannot be renamed (manifest invariant).`);
        }
        if (op.to === SKILL_MD) {
          throw httpError(
            400,
            `Cannot rename a file to SKILL.md (it already exists / is reserved).`,
          );
        }
        const bytes = tree.get(op.from);
        if (bytes === undefined) {
          throw httpError(400, `rename_file: "${op.from}" does not exist in this version.`);
        }
        if (op.from === op.to) {
          throw httpError(400, `rename_file: "from" and "to" are the same path ("${op.from}").`);
        }
        if (tree.has(op.to)) {
          throw httpError(400, `rename_file: target "${op.to}" already exists in this version.`);
        }
        tree.delete(op.from);
        tree.set(op.to, bytes); // bytes carried verbatim → same content-addressed sha (a real rename)
        break;
      }
      case "delete_file": {
        assertSafePath("delete_file", op.path);
        if (op.path === SKILL_MD) {
          throw httpError(400, `SKILL.md cannot be deleted (manifest invariant).`);
        }
        if (!tree.has(op.path)) {
          throw httpError(400, `delete_file: "${op.path}" does not exist in this version.`);
        }
        tree.delete(op.path);
        break;
      }
    }
  }

  const result: TreeFile[] = [...tree.entries()]
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => a.path.localeCompare(b.path));

  // Enforce the zip-bomb / oversized-tree caps over the FINAL tree (count → per-file → total). This
  // runs AFTER the ops so a batch that deletes before it adds is measured on its net result; a single
  // oversize `add_file` still trips the per-file cap here and throws before the caller persists.
  assertTreeWithinCaps(
    result.map((file) => ({ byteLength: file.content.byteLength })),
    caps,
  );

  return { files: result, warnings };
}

/** Decode an `add_file`/`update_file` op's content per its encoding (absent ⇒ utf8). */
function decodeContent(content: string, encoding: SkillFileEncoding | undefined): Buffer {
  return encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf8");
}

/**
 * Refuse a dangerous path: an absolute path, a Windows drive prefix, a backslash separator, or any
 * `..` traversal segment. A skill tree is a flat set of posix paths relative to the skill root; a
 * tree op can only ever name a path inside it.
 */
function assertSafePath(opLabel: string, rawPath: string): void {
  if (rawPath.includes("\\")) {
    throw httpError(400, `${opLabel}: path "${rawPath}" contains a backslash (posix paths only).`);
  }
  if (rawPath.startsWith("/") || /^[a-zA-Z]:\//.test(rawPath)) {
    throw httpError(
      400,
      `${opLabel}: path "${rawPath}" is absolute (paths must be skill-relative).`,
    );
  }
  if (rawPath.split("/").some((segment) => segment === "..")) {
    throw httpError(400, `${opLabel}: path "${rawPath}" contains a ".." traversal segment.`);
  }
}
