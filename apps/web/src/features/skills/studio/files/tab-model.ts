import { SKILL_MD } from "./file-ops";

// ── Skill Studio (RM-30 WP 7.4) — the centre surface's tab set (pure) ──────────────────────────────
// The Studio's centre is a multi-tab editor. SKILL.md is the PINNED first tab and is never closable
// (it is the Flow | Code | Split surface, and closing it would leave the workbench with nothing to
// show); every other tab is one of the version's files, opened by picking it in the Files rail.
//
// Which tab is ACTIVE is not held here — it is `?file=` in the URL (WP 7.1's param, unchanged), so
// the state below is only the OPEN SET and its ordering. That split is deliberate: the active tab is
// the thing an author bookmarks and shares, the open set is a session convenience.
//
// Everything is pure and path-keyed, which makes the two operations that go wrong in every tabbed
// editor testable without a DOM: closing the active tab (what becomes active?) and renaming an open
// file (does its tab survive, and does the URL follow it?).

/** Open `path` as a tab, keeping the existing order and never duplicating it. */
export function openTab(open: readonly string[], path: string): string[] {
  if (path === SKILL_MD) return [...open]; // the manifest is pinned, not an openable tab
  return open.includes(path) ? [...open] : [...open, path];
}

/**
 * Close `path`. Returns the remaining tabs and the path that should become active IF the closed tab
 * was the active one: the NEXT tab to the right, else the one to the left, else the pinned SKILL.md.
 * (The caller decides whether to use `next` — closing a background tab must not steal focus.)
 */
export function closeTab(open: readonly string[], path: string): { open: string[]; next: string } {
  const index = open.indexOf(path);
  const remaining = open.filter((entry) => entry !== path);
  if (index === -1) return { open: remaining, next: SKILL_MD };
  return { open: remaining, next: remaining[index] ?? remaining[index - 1] ?? SKILL_MD };
}

/** True when `path` IS `prefix`, or lives under it — the folder-rename/move test. */
export function isPathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Re-home one path across a rename/move of `from` → `to` (a file, or a folder and everything under
 *  it). A path outside the moved subtree comes back unchanged. */
export function remapPath(path: string, from: string, to: string): string {
  if (!isPathWithin(path, from)) return path;
  return path === from ? to : `${to}${path.slice(from.length)}`;
}

/** Re-home every open tab across a rename/move, preserving order. */
export function remapTabs(open: readonly string[], from: string, to: string): string[] {
  return open.map((path) => remapPath(path, from, to));
}

/**
 * Drop tabs whose file no longer exists (it was deleted, or a folder containing it was). Kept as a
 * DERIVATION over the live working tree rather than a delete handler, so a file that disappears by
 * any route — a folder delete, a discard, a version switch — can never leave a tab pointing at
 * nothing.
 */
export function liveTabs(open: readonly string[], existingPaths: ReadonlySet<string>): string[] {
  return open.filter((path) => existingPaths.has(path));
}

/** The active tab for a `?file=` value: the pinned manifest unless the URL names a live open file. */
export function activeTab(file: string | null, existingPaths: ReadonlySet<string>): string {
  if (file === null || file === SKILL_MD || !existingPaths.has(file)) return SKILL_MD;
  return file;
}
