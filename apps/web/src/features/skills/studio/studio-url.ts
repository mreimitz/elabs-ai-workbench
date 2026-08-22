// ── Skill Studio (RM-30 WP 7.1) — the workbench's URL state ────────────────────────────────────────
// The Studio is a ROUTE, not a dialog (`.claude/rules/routes-vs-dialogs.md`, D-TB10): an author
// bookmarks it, pastes it into a message, and refreshes it. So everything that decides WHAT the
// workbench is showing lives in the query string, never in component state:
//
//   /skills/:skillId/studio?file=<path> & rail=<files|tools|settings> & sel=<graph node id>
//
// RM-30 WP 7.9 (D-UX19 #2) DELETED the view-mode axis. There is no "mode" any more: which surface
// is showing is a consequence of which tab is open, and `?file=` alone says that.
//
//   • `?file=` ABSENT   ⇒ the Designer (the visual composer) — the zero-param landing surface.
//   • `?file=SKILL.md`  ⇒ the manifest's SOURCE tab, written explicitly like every other path.
//   • `?file=<path>`    ⇒ that file's source tab.
//
// A legacy bookmark still carrying the old view-mode param is simply IGNORED — the reader below
// only reads the params it owns, so a stale link still lands on a usable workbench rather than
// throwing or painting a blank pane. `studio-url.test.ts` pins that.
//
// Pure, framework-free helpers so the round-trip is unit-testable without a router.

/** The left rail's three tabs. RM-30 WP 7.3 put this in the URL so the palette's empty state can
 *  DEEP-LINK the Settings tab ("Bind a server in Settings →") rather than reach across the tree for
 *  a callback — and so an author can share "open this skill on its settings". */
export type StudioRail = "files" | "tools" | "settings";

export const STUDIO_RAILS: readonly StudioRail[] = ["files", "tools", "settings"];

/** What the left rail opens on when the URL names no tab. */
export const STUDIO_DEFAULT_RAIL: StudioRail = "files";

export function isStudioRail(value: string | null | undefined): value is StudioRail {
  return (
    value !== null && value !== undefined && (STUDIO_RAILS as readonly string[]).includes(value)
  );
}

/** The Studio's complete, URL-carried view state. `file`/`sel` are `null` when the URL omits them —
 *  an absent param is NOT the same as an empty one, and the writer keeps absent URLs clean. */
export type StudioUrlState = {
  rail: StudioRail;
  file: string | null;
  sel: string | null;
};

type SearchLike = string | URLSearchParams;

function toParams(search: SearchLike): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(search);
}

/** Read the Studio's view state out of a query string. An unrecognised value degrades to the default
 *  rather than throwing — a hand-typed or stale URL must still land on a usable workbench. */
export function readStudioUrlState(search: SearchLike): StudioUrlState {
  const params = toParams(search);
  const rail = params.get("rail");
  const file = params.get("file");
  const sel = params.get("sel");
  return {
    rail: isStudioRail(rail) ? rail : STUDIO_DEFAULT_RAIL,
    file: file !== null && file.length > 0 ? file : null,
    sel: sel !== null && sel.length > 0 ? sel : null,
  };
}

/**
 * Apply a partial view-state change onto existing params, returning a NEW `URLSearchParams`.
 * `null`/`""` deletes a key, so a cleared selection leaves `?sel=` off the URL instead of stranding
 * an empty value. Any param the Studio doesn't own (e.g. the editor's own one-shot `?node=`/`?line=`
 * deep links) is carried through untouched.
 */
export function writeStudioUrlState(
  previous: SearchLike,
  next: Partial<StudioUrlState>,
): URLSearchParams {
  const params = toParams(previous);
  // The default rail is omitted rather than written, so a zero-param Studio URL stays clean (D-TB10).
  if (next.rail !== undefined) {
    if (next.rail === STUDIO_DEFAULT_RAIL) params.delete("rail");
    else params.set("rail", next.rail);
  }
  if (next.file !== undefined) {
    if (next.file === null || next.file.length === 0) params.delete("file");
    else params.set("file", next.file);
  }
  if (next.sel !== undefined) {
    if (next.sel === null || next.sel.length === 0) params.delete("sel");
    else params.set("sel", next.sel);
  }
  return params;
}

/** The Studio route for one skill, optionally opened at a given view state. */
export function skillStudioPath(skillId: string, state?: Partial<StudioUrlState>): string {
  const base = `/skills/${encodeURIComponent(skillId)}/studio`;
  if (!state) return base;
  const params = writeStudioUrlState("", state);
  const query = params.toString();
  return query.length > 0 ? `${base}?${query}` : base;
}
