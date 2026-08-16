import type { SkillEditOp, SkillFileNode } from "@mcp-token-footprint/shared";

// ── Skill IDE WP 3.2 — the file-manager working-tree model (pure) ───────────────────────────────────
// The Files tab becomes a workspace: the user mutates an in-memory working tree (create/rename/move/
// delete files + folders, edit text), and on ONE Save we DERIVE a `SkillEditOp[]` tree batch from the
// base version → working tree and POST it through the existing edits route (WP 3.1 applies mixed
// text+tree batches in one `createVersion`). Everything here is pure (no React, no JSX, no I/O) so the
// derivation is easy to reason about and mirrors the server's tree engine (`apps/api/.../tree-ops.ts`)
// and its set-level validator (`edit-ops.ts`) 1:1.

/** The manifest-invariant file every version must keep — never renamed/deleted (mirrors the server). */
export const SKILL_MD = "SKILL.md";

/**
 * One node of the working tree. `id` is STABLE across renames/moves (so content drafts and the tree
 * selection survive a path change); `path` is the current posix path. `originalPath` is the path in
 * the base version, or `null` for a newly added/uploaded file. Text files carry `baseText` (the
 * fetched base content, for the dirty compare) and `text` (the current draft); an uploaded binary
 * carries `base64`.
 */
export type WorkEntry = {
  id: string;
  path: string;
  originalPath: string | null;
  isBinary: boolean;
  /** Base metadata (size / tokenTotal / kind) for files carried over from the base version. */
  base?: SkillFileNode;
  /** Fetched base content of a base text file (undefined until the file is opened once). */
  baseText?: string;
  /** Current draft text (a base file being edited, or a new/uploaded text file's content). */
  text?: string;
  /** Content of a newly uploaded binary file (base64), for the `add_file` op's payload. */
  base64?: string;
};

/** Build the initial working tree from the base version's flat file list. */
export function buildWorkingTree(files: SkillFileNode[]): WorkEntry[] {
  return files.map((file) => ({
    id: file.path, // base files start with a stable id === their original path
    path: file.path,
    originalPath: file.path,
    isBinary: file.isBinary,
    base: file,
  }));
}

/** Is this entry the SKILL.md manifest (which may be edited but never renamed/moved/deleted)? */
export function isSkillMd(entry: Pick<WorkEntry, "path" | "originalPath">): boolean {
  return entry.path === SKILL_MD || entry.originalPath === SKILL_MD;
}

/** True once a text entry's draft differs from its base content (drives `update_file` emission). */
export function isContentDirty(entry: WorkEntry): boolean {
  if (entry.originalPath === null || entry.isBinary) return false;
  return entry.text !== undefined && entry.baseText !== undefined && entry.text !== entry.baseText;
}

// ── path helpers ────────────────────────────────────────────────────────────────────────────────

/** The directory prefix of a posix path ("" for a root-level path). */
export function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/** The final segment (file/folder name) of a posix path. */
export function baseNameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/** Join a directory prefix and a name into a posix path (dir may be ""). */
export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * Validate a single path SEGMENT (a file or folder name the user typed). Returns an error string or
 * null. Mirrors the server's path guards (no slashes/backslashes/traversal) so the UI never composes
 * an op the route would 400 on — surfaced inline next to the field.
 */
export function validateSegment(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (trimmed === "." || trimmed === "..") return "“.” and “..” are not valid names.";
  if (trimmed.includes("/")) return "A name cannot contain “/”.";
  if (trimmed.includes("\\")) return "A name cannot contain “\\”.";
  return null;
}

/** All folder paths implied by the working tree's files, plus any pending (empty) folders. */
export function collectFolders(entries: WorkEntry[], pendingFolders: string[]): Set<string> {
  const folders = new Set<string>(pendingFolders);
  for (const entry of entries) {
    let dir = dirOf(entry.path);
    while (dir) {
      folders.add(dir);
      dir = dirOf(dir);
    }
  }
  // A pending folder implies its own ancestors too.
  for (const folder of pendingFolders) {
    let dir = dirOf(folder);
    while (dir) {
      folders.add(dir);
      dir = dirOf(dir);
    }
  }
  return folders;
}

/**
 * Derive the `SkillEditOp[]` tree batch from the base version → the working tree. Emission order is
 * chosen so the server's tree engine (which applies ops in array order) never trips: `update_file`
 * (targets the still-original path) → `rename_file` (original → current) → `add_file` → `delete_file`.
 * Only genuine changes produce ops (an unedited/unmoved file yields nothing), so an empty result means
 * "nothing to save".
 */
export function deriveTreeOps(base: SkillFileNode[], entries: WorkEntry[]): SkillEditOp[] {
  const ops: SkillEditOp[] = [];
  const survivingOriginals = new Set(
    entries.filter((e) => e.originalPath !== null).map((e) => e.originalPath as string),
  );

  // 1. update_file — a base text file whose draft differs from its base content (target the ORIGINAL
  //    path, which still exists in the base tree at apply time).
  for (const entry of entries) {
    if (entry.originalPath !== null && isContentDirty(entry)) {
      ops.push({ op: "update_file", path: entry.originalPath, content: entry.text ?? "" });
    }
  }
  // 2. rename_file — a moved/renamed base file (blob preserved → the diff shows a rename).
  for (const entry of entries) {
    if (entry.originalPath !== null && entry.path !== entry.originalPath) {
      ops.push({ op: "rename_file", from: entry.originalPath, to: entry.path });
    }
  }
  // 3. add_file — a newly created / uploaded file (binary rides base64).
  for (const entry of entries) {
    if (entry.originalPath === null) {
      ops.push(
        entry.isBinary
          ? { op: "add_file", path: entry.path, content: entry.base64 ?? "", encoding: "base64" }
          : { op: "add_file", path: entry.path, content: entry.text ?? "" },
      );
    }
  }
  // 4. delete_file — a base file with no surviving entry.
  for (const file of base) {
    if (!survivingOriginals.has(file.path)) {
      ops.push({ op: "delete_file", path: file.path });
    }
  }
  return ops;
}

/** A human-readable one-liner for one derived tree op — the Save dialog's review list. */
export function describeTreeOp(op: SkillEditOp): string {
  switch (op.op) {
    case "add_file":
      return `Add ${op.path}`;
    case "update_file":
      return `Edit ${op.path}`;
    case "rename_file": {
      const moved = dirOf(op.from) !== dirOf(op.to);
      return `${moved ? "Move" : "Rename"} ${op.from} → ${op.to}`;
    }
    case "delete_file":
      return `Delete ${op.path}`;
    default:
      return op.op;
  }
}

/**
 * Decode an uploaded file's bytes into a working-tree content payload. Binary detection mirrors the
 * server's `isBinary` (NUL byte, or a non-utf8 roundtrip) — a client heuristic ONLY to pick the wire
 * encoding for the `add_file` op; the API re-classifies `isBinary` authoritatively from the stored
 * bytes on ingest, so this never becomes the persisted truth.
 */
export function decodeUpload(
  bytes: Uint8Array,
): { isBinary: true; base64: string } | { isBinary: false; text: string } {
  if (bytes.includes(0)) return { isBinary: true, base64: bytesToBase64(bytes) };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { isBinary: false, text };
  } catch {
    return { isBinary: true, base64: bytesToBase64(bytes) };
  }
}

/** Base64-encode raw bytes (browser `btoa` over a binary string, chunked to avoid call-stack limits). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
