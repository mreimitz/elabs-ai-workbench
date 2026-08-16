// Assistant (WP 2.2) — the skill-workspace materialized-filesystem loop (D-AS13). A per-thread scratch
// root under the assistant data dir holds skill file trees the agent edits with the SDK's NATIVE file
// tools (Read/Edit/Write/Glob/Grep — see `permission-classifier.ts`'s native-tool sets and
// `session-manager.ts`'s `startSession`, which wires this root onto the SDK's `additionalDirectories`).
// This module owns the filesystem plumbing ONLY: computing/creating the thread's workspace root,
// materializing one skill version's blobs into real files, reading the (possibly agent-edited) tree
// back for a commit, and removing it (successful commit / thread delete). It is deliberately SDK-free —
// the tool definitions that call this live in `tools/workspace-tools.ts`; the SDK session wiring lives
// in `session-manager.ts`. WP R1.3 adds `readWorkspaceFile` — the same read-back discipline as
// `readWorkspaceTree`, but for ONE file at a time (the live-workspace single-file read route in
// `assistant/routes.ts`, which never touches the DB or any secret — skill files only).
//
// Path-traversal discipline (ground rule): a skill id supplied by the AGENT becomes a directory name
// under the thread's workspace root, so it is validated against a strict id-shaped charset (matches how
// this app's own nanoid ids look — no path separators, no `..`) before it ever touches the filesystem.
// Every relative path materialized FROM the DB (already content-addressed and effectively trusted) is
// still defensively re-validated (no absolute path, no `..` segment, no NUL byte) before being joined
// onto disk. On the READ-BACK side (commit), the tree walk refuses to follow a symlink whose target
// resolves outside the skill's own workspace directory — never a silent escape onto the host filesystem.
import fs from "node:fs";
import path from "node:path";
import { httpError } from "../utils/errors.js";
import type { SkillFileInput } from "../skills/repository.js";

/** A skill/thread id is safe to use as a directory name when it matches this charset (this app's own
 *  nanoid ids do; a value that doesn't is rejected outright rather than sanitized). */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** One file in a materialized workspace tree listing (`skills_open_workspace`'s response). */
export type WorkspaceFileEntry = {
  path: string;
  size: number;
  isBinary: boolean;
};

function assertSafeId(id: string, label: string): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw httpError(400, `Invalid ${label}: "${id}" (expected a plain id, no path separators).`);
  }
}

/** Reject a stored/agent-facing relative file path that isn't a clean, relative, forward-slash path —
 *  defense in depth so a corrupted DB row or a symlink-escaped read can never land outside the skill's
 *  workspace directory on materialize. */
function assertSafeRelativePath(relPath: string): void {
  const normalized = relPath.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw httpError(400, `Invalid file path in skill tree: "${relPath}"`);
  }
}

/**
 * The thread's workspace root: `<assistantDataDir>/ws/<threadId>/`. A SIBLING of the WP 1.1 scratch
 * cwd (`<assistantDataDir>/threads/<threadId>/`, see `session-manager.ts`'s `scratchDirFor`) — kept
 * OUT of cwd so it is reachable ONLY because it's explicitly listed in the SDK's `additionalDirectories`,
 * never implicitly because it happens to live under cwd.
 */
export function workspaceRootFor(assistantDataDir: string, threadId: string): string {
  assertSafeId(threadId, "thread id");
  return path.join(path.resolve(assistantDataDir), "ws", threadId);
}

/**
 * Create (idempotent) and return the thread's workspace root. Called once per session start
 * (`session-manager.ts`'s `startSession`, on EVERY start — fresh or resumed) so the directory named in
 * `additionalDirectories` always exists before the SDK child spawns.
 */
export function ensureWorkspaceRoot(assistantDataDir: string, threadId: string): string {
  const root = workspaceRootFor(assistantDataDir, threadId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Remove a thread's ENTIRE workspace (every skill it ever opened, committed or not) — thread delete. */
export function removeWorkspaceRoot(assistantDataDir: string, threadId: string): void {
  fs.rmSync(workspaceRootFor(assistantDataDir, threadId), { recursive: true, force: true });
}

/** Resolve `<root>/<skillId>` for one skill's workspace directory, guarding the id. */
export function skillWorkspaceDir(root: string, skillId: string): string {
  assertSafeId(skillId, "skill id");
  return path.join(root, skillId);
}

/**
 * Materialize a skill version's files onto the real filesystem at `<root>/<skillId>/…`, REPLACING
 * anything already there — re-opening a skill already present in the workspace is a deliberate, gated
 * action that resets it to a fresh copy of the requested version (see `workspace-tools.ts`'s tool
 * description, which warns the agent this discards uncommitted edits). Returns the tree listing.
 */
export function materializeWorkspace(
  root: string,
  skillId: string,
  files: readonly SkillFileInput[],
): WorkspaceFileEntry[] {
  const dir = skillWorkspaceDir(root, skillId);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const entries: WorkspaceFileEntry[] = [];
  for (const file of files) {
    assertSafeRelativePath(file.path);
    const target = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.bytes);
    entries.push({
      path: file.path,
      size: file.bytes.byteLength,
      isBinary: looksBinary(file.bytes),
    });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Read a skill's workspace directory back into a flat tree — `skills_commit_workspace`'s input to
 * `SkillRepository.createVersion`. Throws (400-shaped) if nothing was ever materialized/edited there
 * (empty or missing directory), or if a symlink resolves outside the skill's own directory — refused
 * outright rather than silently followed off the workspace.
 */
export function readWorkspaceTree(root: string, skillId: string): SkillFileInput[] {
  const dir = skillWorkspaceDir(root, skillId);
  if (!fs.existsSync(dir)) {
    throw httpError(
      400,
      `No open workspace for skill "${skillId}" — call skills_open_workspace first.`,
    );
  }
  const dirReal = fs.realpathSync(dir);
  const files: SkillFileInput[] = [];

  const walk = (current: string, relPrefix: string): void => {
    const dirEntries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of dirEntries) {
      const abs = path.join(current, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        const real = fs.realpathSync(abs);
        if (real !== dirReal && !real.startsWith(dirReal + path.sep)) {
          throw httpError(
            400,
            `Refusing to commit "${rel}": it links outside the skill workspace.`,
          );
        }
        const stat = fs.statSync(abs); // follows the now-verified-in-bounds link
        if (stat.isDirectory()) walk(abs, rel);
        else if (stat.isFile()) files.push({ path: rel, bytes: fs.readFileSync(abs) });
        continue;
      }
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        files.push({ path: rel, bytes: fs.readFileSync(abs) });
      }
      // Sockets/FIFOs/devices etc. are silently skipped — never expected in a skill tree.
    }
  };
  walk(dir, "");

  if (files.length === 0) {
    throw httpError(400, `The workspace for skill "${skillId}" is empty — nothing to commit.`);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Remove one skill's workspace directory (post-commit cleanup) — leaves the thread's other open
 *  skill workspaces (if any) and the root itself untouched. */
export function removeSkillWorkspace(root: string, skillId: string): void {
  fs.rmSync(skillWorkspaceDir(root, skillId), { recursive: true, force: true });
}

/**
 * WP R1.3 — read ONE file back from a skill's (possibly agent-edited) workspace directory: the
 * live-workspace single-file read endpoint's plumbing. Deliberately the single-file sibling of
 * {@link readWorkspaceTree} rather than a full tree walk, but SAME discipline: `relPath` is validated
 * by {@link assertSafeRelativePath} (no absolute path, no `..` segment, no NUL byte), and a symlink
 * that resolves outside the skill's own directory is refused (400) rather than followed — never a
 * silent escape onto the host filesystem, mirroring `readWorkspaceTree`'s commit-time guard. Throws
 * (400-shaped) if the skill has no open workspace at all; throws (404-shaped) if `relPath` doesn't
 * name an existing plain file within it.
 */
export function readWorkspaceFile(root: string, skillId: string, relPath: string): SkillFileInput {
  assertSafeRelativePath(relPath);
  const dir = skillWorkspaceDir(root, skillId);
  if (!fs.existsSync(dir)) {
    throw httpError(
      400,
      `No open workspace for skill "${skillId}" — call skills_open_workspace first.`,
    );
  }
  const dirReal = fs.realpathSync(dir);
  const target = path.join(dir, relPath);
  if (!fs.existsSync(target)) {
    throw httpError(404, `No file "${relPath}" in the workspace for skill "${skillId}".`);
  }
  const targetReal = fs.realpathSync(target);
  if (targetReal !== dirReal && !targetReal.startsWith(dirReal + path.sep)) {
    throw httpError(400, `Refusing to read "${relPath}": it links outside the skill workspace.`);
  }
  if (!fs.statSync(targetReal).isFile()) {
    throw httpError(400, `"${relPath}" is not a file.`);
  }
  return { path: relPath, bytes: fs.readFileSync(targetReal) };
}

/** Binary heuristic — mirrors `skills/repository.ts`'s `isBinary` exactly (a NUL byte, or bytes that
 *  don't round-trip as UTF-8). Kept local so this module's public API doesn't leak a repository import
 *  into every caller; `tools/workspace-tools.ts` reuses the repository's own `isBinary` for footprint
 *  counting, so the two never drift in practice (same definition, verified by the workspace tests). */
function looksBinary(bytes: Buffer): boolean {
  if (bytes.includes(0)) return true;
  const decoded = bytes.toString("utf8");
  return !Buffer.from(decoded, "utf8").equals(bytes);
}
