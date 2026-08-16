// Assistant Hub (roadmap/assistant-hub/, WP0.5, D-AH1…D-AH20) — the per-session workspace filesystem
// plumbing. Per execution-plan §1.3: "Workspace (not a table): `/data/hub/ws/<sessionId>/` on the
// `/data` volume; pruned with the session (and by the maintenance endpoint, Wave 4)." This module owns
// ONLY the filesystem confinement (path resolution/guards, tree listing, text read/write/edit) — the
// `files.*` built-ins in `tools/builtins/workspace.ts` are the tool surface that calls it, and the
// output-cap spill path (`tools/output-caps.ts`, R-MCP7) reuses the same write primitive.
//
// Path-traversal discipline mirrors `apps/api/src/assistant/workspace.ts` (the Assistant feature's
// established pattern for a per-thread materialized workspace): a session id becomes a directory name,
// so it is validated against a strict id-shaped charset before it ever touches the filesystem; every
// model-supplied relative path is defensively re-validated (no absolute path, no `..` segment, no NUL
// byte) before being joined onto disk; and a symlink whose target resolves outside the session's own
// workspace directory is refused rather than silently followed — content is read/written, NEVER
// executed (`.claude/rules/mcp-and-security.md`).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HUB_WS_MAX_FILE_BYTES, type HubWorkspaceSnapshot } from "@mcp-token-footprint/shared";
import { nanoid } from "nanoid";
import { httpError } from "../utils/errors.js";

/** A session id is safe to use as a directory name when it matches this charset (this app's own
 *  nanoid ids do; a value that doesn't is rejected outright rather than sanitized). */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertSafeSessionId(id: string): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw httpError(400, `Invalid session id: "${id}" (expected a plain id, no path separators).`);
  }
}

/** A snapshot id is ALSO a route param (`POST .../snapshots/:snapshotId/restore`) that this module
 *  turns directly into a manifest filename — same charset discipline as a session id, same reason. */
function assertSafeSnapshotId(id: string): void {
  if (!id || !SAFE_ID_PATTERN.test(id)) {
    throw httpError(400, `Invalid snapshot id: "${id}" (expected a plain id, no path separators).`);
  }
}

/** Reject a model-supplied relative file path that isn't a clean, relative, forward-slash path —
 *  defense in depth so a crafted `../../etc/passwd`-style path can never land outside the session's
 *  workspace directory. */
function assertSafeRelativePath(relPath: string): void {
  const normalized = relPath.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw httpError(400, `Invalid workspace path: "${relPath}"`);
  }
}

/**
 * The session's workspace root: `<dataDir>/hub/ws/<sessionId>/`. `dataDir` is the app's own
 * `config.dataDirectory` (passed in rather than read from env here, mirroring
 * `assistant/workspace.ts`'s `assistantDataDir` parameter — keeps this module env-free and testable).
 */
export function hubWorkspaceRootFor(dataDir: string, sessionId: string): string {
  assertSafeSessionId(sessionId);
  return path.join(path.resolve(dataDir), "hub", "ws", sessionId);
}

/** Create (idempotent) and return the session's workspace root. */
export function ensureHubWorkspaceRoot(dataDir: string, sessionId: string): string {
  const root = hubWorkspaceRootFor(dataDir, sessionId);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Remove a session's ENTIRE workspace — session delete / retention pruning (Wave 4). */
export function removeHubWorkspaceRoot(dataDir: string, sessionId: string): void {
  fs.rmSync(hubWorkspaceRootFor(dataDir, sessionId), { recursive: true, force: true });
}

/**
 * Canonicalize the nearest EXISTING ancestor directory of `absPath` (walking up from
 * `path.dirname(absPath)`, since `absPath` itself is the about-to-be-created target and may not exist
 * yet — nor may several of its parent segments). Used by {@link resolveWorkspacePath}'s CREATE guard
 * (Wave-3 adversarial-review F1): a symlinked parent directory has nothing to do with whether `absPath`
 * itself exists, so the escape check has to walk up to real filesystem state rather than stopping at
 * the first missing segment.
 */
function realpathNearestExistingAncestor(absPath: string): string {
  let current = path.dirname(absPath);
  for (;;) {
    if (fs.existsSync(current)) return fs.realpathSync(current);
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(current); // reached the filesystem root; defensive stop
    current = parent;
  }
}

/**
 * Resolve a workspace-relative path to an absolute, IN-BOUNDS path under `root`. Guards syntactic
 * traversal (via {@link assertSafeRelativePath}) unconditionally, plus TWO symlink-escape checks:
 *  - an EXISTING target is realpath'd directly (mirrors `assistant/workspace.ts`'s read-back
 *    discipline — a symlink planted by an earlier write is refused rather than silently followed).
 *  - a target that does NOT exist yet — a CREATE, e.g. a brand-new `files.write` — has its nearest
 *    EXISTING ancestor directory realpath'd and bounds-checked instead (Wave-3 adversarial-review F1):
 *    without this, writing through a symlinked parent directory (`linkdir -> /outside`, then
 *    `linkdir/new.txt`) skipped the escape check entirely, because the OLD check only ever looked at
 *    whether the target itself already existed — and a brand-new file never does.
 * `mustExist` additionally 404s when the target is missing (checked first, so a 404 wins over a 400).
 */
export function resolveWorkspacePath(
  root: string,
  relPath: string,
  opts: { mustExist?: boolean } = {},
): string {
  assertSafeRelativePath(relPath);
  const target = path.join(root, relPath);
  if (opts.mustExist && !fs.existsSync(target)) {
    throw httpError(404, `No file "${relPath}" in the session workspace.`);
  }
  const rootReal = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  if (fs.existsSync(target)) {
    const targetReal = fs.realpathSync(target);
    if (targetReal !== rootReal && !targetReal.startsWith(rootReal + path.sep)) {
      throw httpError(
        400,
        `Refusing to access "${relPath}": it resolves outside the session workspace.`,
      );
    }
  } else {
    const parentReal = realpathNearestExistingAncestor(target);
    if (parentReal !== rootReal && !parentReal.startsWith(rootReal + path.sep)) {
      throw httpError(
        400,
        `Refusing to create "${relPath}": its parent directory resolves outside the session workspace.`,
      );
    }
  }
  return target;
}

export type HubWorkspaceEntry = { path: string; size: number; isDirectory: boolean };

/**
 * List a (sub)directory of the workspace, recursively. `subPath` defaults to the root. Returns `[]`
 * for a subdirectory that doesn't exist (an empty/unused workspace is not an error).
 */
export function listWorkspaceTree(root: string, subPath = ""): HubWorkspaceEntry[] {
  const startAbs = subPath ? resolveWorkspacePath(root, subPath) : root;
  if (!fs.existsSync(startAbs)) return [];
  if (!fs.statSync(startAbs).isDirectory()) {
    throw httpError(400, `"${subPath}" is not a directory.`);
  }

  const entries: HubWorkspaceEntry[] = [];
  const walk = (current: string, relPrefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        entries.push({ path: rel, size: 0, isDirectory: true });
        walk(abs, rel);
      } else if (entry.isFile()) {
        entries.push({ path: rel, size: fs.statSync(abs).size, isDirectory: false });
      }
      // Symlinks are skipped at listing time (never followed implicitly); a read/edit against a
      // symlinked path is still guarded by `resolveWorkspacePath`'s escape check.
    }
  };
  walk(startAbs, subPath);
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

/** Read a workspace text file (UTF-8) back. Throws (404) if it doesn't exist. */
export function readWorkspaceTextFile(root: string, relPath: string): string {
  const target = resolveWorkspacePath(root, relPath, { mustExist: true });
  if (!fs.statSync(target).isFile()) throw httpError(400, `"${relPath}" is not a file.`);
  return fs.readFileSync(target, "utf8");
}

/**
 * Create or overwrite a workspace text file (UTF-8), creating parent directories as needed.
 *
 * Wave-3 adversarial-review F2: content was previously unbounded — a model-driven `files.write`/
 * `files.edit` call (and the R-MCP7 output-cap spill path) could write an arbitrarily large file into
 * the workspace. `opts.maxBytes` lets a caller thread in the configured cap
 * (`config.hubWsMaxFileBytes`, env `HUB_WS_MAX_FILE_BYTES`); it falls back to the SAME shared-constant
 * default (`HUB_WS_MAX_FILE_BYTES`) the config layer itself defaults to, so the guard is active even
 * for a caller that doesn't thread anything in.
 */
export function writeWorkspaceTextFile(
  root: string,
  relPath: string,
  content: string,
  opts: { maxBytes?: number } = {},
): { path: string; bytes: number } {
  const target = resolveWorkspacePath(root, relPath);
  const bytes = Buffer.byteLength(content, "utf8");
  const maxBytes = opts.maxBytes ?? HUB_WS_MAX_FILE_BYTES;
  if (bytes > maxBytes) {
    throw httpError(
      400,
      `The write to "${relPath}" is ${bytes} bytes, exceeding the ${maxBytes}-byte workspace file limit.`,
    );
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return { path: relPath, bytes };
}

/**
 * Replace an exact, unique occurrence of `oldText` with `newText` in an existing workspace text file
 * (the common LLM-tool "surgical edit" idiom). Zero matches or (without `replaceAll`) more than one
 * match is a 400 — never a silent partial/wrong edit.
 *
 * Wave-3 adversarial-review F2: an edit (especially `replaceAll`) can grow a file arbitrarily, so this
 * enforces the SAME workspace-write cap as {@link writeWorkspaceTextFile} on the RESULTING content,
 * before anything is written.
 */
export function editWorkspaceTextFile(
  root: string,
  relPath: string,
  oldText: string,
  newText: string,
  replaceAll = false,
  opts: { maxBytes?: number } = {},
): { path: string; bytes: number; replacements: number } {
  const target = resolveWorkspacePath(root, relPath, { mustExist: true });
  if (!fs.statSync(target).isFile()) throw httpError(400, `"${relPath}" is not a file.`);
  const current = fs.readFileSync(target, "utf8");
  const occurrences = countOccurrences(current, oldText);
  if (occurrences === 0) {
    throw httpError(400, `No match for the given text in "${relPath}".`);
  }
  if (occurrences > 1 && !replaceAll) {
    throw httpError(
      400,
      `The given text is not unique in "${relPath}" (${occurrences} matches) — pass replaceAll:true or supply more surrounding context.`,
    );
  }
  const updated = replaceAll
    ? current.split(oldText).join(newText)
    : replaceFirst(current, oldText, newText);
  const updatedBytes = Buffer.byteLength(updated, "utf8");
  const maxBytes = opts.maxBytes ?? HUB_WS_MAX_FILE_BYTES;
  if (updatedBytes > maxBytes) {
    throw httpError(
      400,
      `The edit to "${relPath}" would be ${updatedBytes} bytes, exceeding the ${maxBytes}-byte workspace file limit.`,
    );
  }
  fs.writeFileSync(target, updated, "utf8");
  return {
    path: relPath,
    bytes: updatedBytes,
    replacements: replaceAll ? occurrences : 1,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) return haystack;
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

// ── Content-addressed workspace snapshots (WP3.4, R-SES6) ──────────────────────────────────────────
//
// A snapshot is NOT a `hub_*` table (no migration this WP) — it lives entirely in the workspace
// filesystem, git-like: each file's bytes are stored ONCE under `_snapshots/blobs/<sha256>` (so two
// snapshots that share a file share its blob), and a small JSON manifest under
// `_snapshots/manifests/<snapshotId>.json` records the tree — `{path, sha256, bytes}` per file — at
// the moment the snapshot was taken. Restoring copies each manifest entry's blob back to its path;
// files the workspace has gained SINCE the snapshot are left untouched (a restore is a checkout of
// the recorded paths, never an implicit delete of untracked work).

const SNAPSHOTS_DIR = "_snapshots";
const SNAPSHOT_BLOBS_SUBDIR = `${SNAPSHOTS_DIR}/blobs`;
const SNAPSHOT_MANIFESTS_SUBDIR = `${SNAPSHOTS_DIR}/manifests`;

type SnapshotManifestEntry = { path: string; sha256: string; bytes: number };
type SnapshotManifest = {
  id: string;
  label?: string;
  createdAt: string;
  entries: SnapshotManifestEntry[];
};

function snapshotFromManifest(manifest: SnapshotManifest): HubWorkspaceSnapshot {
  const totalBytes = manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    id: manifest.id,
    ...(manifest.label ? { label: manifest.label } : {}),
    createdAt: manifest.createdAt,
    fileCount: manifest.entries.length,
    totalBytes,
  };
}

/**
 * Snapshot the ENTIRE current workspace tree (recursively), excluding the snapshot store itself
 * (`_snapshots/` — never recursively snapshots its own history). Symlinks are skipped, mirroring
 * {@link listWorkspaceTree}. Returns the new snapshot's summary.
 */
export function createWorkspaceSnapshot(root: string, label?: string): HubWorkspaceSnapshot {
  const id = nanoid();
  const createdAt = new Date().toISOString();
  const entries: SnapshotManifestEntry[] = [];

  const walk = (currentAbs: string, relPrefix: string): void => {
    if (!fs.existsSync(currentAbs)) return;
    for (const entry of fs.readdirSync(currentAbs, { withFileTypes: true })) {
      if (relPrefix === "" && entry.name === SNAPSHOTS_DIR) continue;
      const abs = path.join(currentAbs, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(abs);
        const sha256 = crypto.createHash("sha256").update(content).digest("hex");
        const blobPath = path.join(root, SNAPSHOT_BLOBS_SUBDIR, sha256);
        if (!fs.existsSync(blobPath)) {
          fs.mkdirSync(path.dirname(blobPath), { recursive: true });
          fs.writeFileSync(blobPath, content);
        }
        entries.push({ path: rel, sha256, bytes: content.byteLength });
      }
      // symlinks are skipped (never followed implicitly) — same discipline as listWorkspaceTree.
    }
  };
  walk(root, "");

  const manifest: SnapshotManifest = { id, ...(label ? { label } : {}), createdAt, entries };
  const manifestDir = path.join(root, SNAPSHOT_MANIFESTS_SUBDIR);
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(path.join(manifestDir, `${id}.json`), JSON.stringify(manifest), "utf8");

  return snapshotFromManifest(manifest);
}

/**
 * List a session's snapshots, newest first. `[]` for a workspace with none (not an error).
 *
 * Wave-3 adversarial-review F3: `createdAt` alone is only millisecond-resolution (`Date.toISOString()`),
 * so two snapshots taken within the same millisecond previously sorted non-deterministically (the
 * comparator returned 0, and `Array.prototype.sort` doesn't promise a stable order for every engine/
 * input size). `id` (descending) is the deterministic tiebreaker — it doesn't need to correlate with
 * creation order, only to make equal-`createdAt` snapshots list in the SAME order every time.
 */
export function listWorkspaceSnapshots(root: string): HubWorkspaceSnapshot[] {
  const manifestDir = path.join(root, SNAPSHOT_MANIFESTS_SUBDIR);
  if (!fs.existsSync(manifestDir)) return [];
  const manifests = fs
    .readdirSync(manifestDir)
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(fs.readFileSync(path.join(manifestDir, name), "utf8")) as SnapshotManifest,
    );
  return manifests
    .map(snapshotFromManifest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/**
 * Restore a workspace to a prior snapshot: every manifest entry's blob is copied back to its
 * recorded path (creating parent directories as needed). A file the workspace gained AFTER the
 * snapshot (not in the manifest) is left alone — restore is a checkout, never an implicit prune.
 * 404s on an unknown snapshot id.
 */
export function restoreWorkspaceSnapshot(root: string, snapshotId: string): { restored: number } {
  assertSafeSnapshotId(snapshotId);
  const manifestPath = path.join(root, SNAPSHOT_MANIFESTS_SUBDIR, `${snapshotId}.json`);
  if (!fs.existsSync(manifestPath)) {
    throw httpError(404, `No workspace snapshot "${snapshotId}".`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as SnapshotManifest;
  for (const entry of manifest.entries) {
    const blobPath = path.join(root, SNAPSHOT_BLOBS_SUBDIR, entry.sha256);
    if (!fs.existsSync(blobPath)) continue; // defensive: a manually-pruned blob store shouldn't crash a restore
    const target = resolveWorkspacePath(root, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(blobPath, target);
  }
  return { restored: manifest.entries.length };
}
