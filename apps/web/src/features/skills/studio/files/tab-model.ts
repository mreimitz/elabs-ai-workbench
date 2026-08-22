import { SKILL_MD } from "./file-ops";

// ── Skill Studio (RM-30 WP 7.4, reworked by WP 7.9) — the centre surface's tab set (pure) ──────────
// The Studio's centre is a multi-tab editor. RM-30 WP 7.9 (D-UX19 #2) changed WHAT is pinned:
//
//   • The DESIGNER is the pinned first tab and is never closable. It is not a file — it is the
//     visual composer, and it is what the workbench shows when the URL names no file at all.
//   • Every FILE is an ordinary, closable tab, INCLUDING `SKILL.md`, which is now the manifest's
//     source tab rather than a surface with a mode switch bolted onto it.
//
// Which tab is ACTIVE is not held here — it is `?file=` in the URL, so the state below is only the
// OPEN SET and its ordering. That split is deliberate: the active tab is the thing an author
// bookmarks and shares, the open set is a session convenience.
//
// Everything is pure and path-keyed, which makes the two operations that go wrong in every tabbed
// editor testable without a DOM: closing the active tab (what becomes active?) and renaming an open
// file (does its tab survive, and does the URL follow it?).

/**
 * The pinned first tab — the visual composer. It is deliberately NOT a working-tree path: it names
 * no file, it is never written to `?file=` (an absent param means the Designer), and `openTab`
 * refuses to add it to the open set. The `studio:` prefix keeps it unspellable as a posix path a
 * skill version could actually contain.
 */
export const DESIGNER_TAB = "studio:designer";

/** Open `path` as a tab, keeping the existing order and never duplicating it. */
export function openTab(open: readonly string[], path: string): string[] {
  if (path === DESIGNER_TAB) return [...open]; // the Designer is pinned, not an openable tab
  return open.includes(path) ? [...open] : [...open, path];
}

/**
 * Close `path`. Returns the remaining tabs and the path that should become active IF the closed tab
 * was the active one: the NEXT tab to the right, else the one to the left, else the pinned Designer.
 * (The caller decides whether to use `next` — closing a background tab must not steal focus.)
 */
export function closeTab(open: readonly string[], path: string): { open: string[]; next: string } {
  const index = open.indexOf(path);
  const remaining = open.filter((entry) => entry !== path);
  if (index === -1) return { open: remaining, next: DESIGNER_TAB };
  return { open: remaining, next: remaining[index] ?? remaining[index - 1] ?? DESIGNER_TAB };
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

/**
 * The active tab for a `?file=` value: the pinned Designer unless the URL names a live file.
 *
 * `SKILL.md` gets no special case any more — it is in the working tree like every other file, so a
 * `?file=SKILL.md` on a version that somehow lacks a manifest falls back to the Designer by the
 * same rule that catches a deleted resource.
 */
export function activeTab(file: string | null, existingPaths: ReadonlySet<string>): string {
  if (file === null || file === DESIGNER_TAB || !existingPaths.has(file)) return DESIGNER_TAB;
  return file;
}

export { SKILL_MD };
