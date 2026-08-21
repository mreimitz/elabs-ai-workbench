// ── Skill Studio (RM-30 WP 7.1) — the workbench's URL state ────────────────────────────────────────
// The Studio is a ROUTE, not a dialog (`.claude/rules/routes-vs-dialogs.md`, D-TB10): an author
// bookmarks it, pastes it into a message, and refreshes it. So everything that decides WHAT the
// workbench is showing lives in the query string, never in component state:
//
//   /skills/:skillId/studio?mode=flow|code|split & file=<path> & sel=<graph node id>
//
// This closes the carry-forward the phase-7 plan names explicitly ("the skill inspector's sub-tab
// selection is local state — the new `/skills/:id/studio` route must carry mode/file/selection in
// the URL"). Pure, framework-free helpers so the round-trip is unit-testable without a router.
//
// `mode` deliberately shares its key with the editor's OWN `?mode=` param (`UnifiedEditor`) — one
// param, one meaning, read by both the Studio toolbar and the editor it frames.

/** The three views of one document the unified editor offers. */
export type StudioMode = "flow" | "code" | "split";

export const STUDIO_MODES: readonly StudioMode[] = ["flow", "code", "split"];

/** What the Studio opens in when the URL names no mode — the visual view (the authoring default). */
export const STUDIO_DEFAULT_MODE: StudioMode = "flow";

/** The file the centre surface edits when the URL names none. WP 7.1 only mounts `SKILL.md`; the
 *  multi-tab file editor lands in WP 7.4, which reuses this same param. */
export const STUDIO_DEFAULT_FILE = "SKILL.md";

export function isStudioMode(value: string | null | undefined): value is StudioMode {
  return (
    value !== null && value !== undefined && (STUDIO_MODES as readonly string[]).includes(value)
  );
}

/** The left rail's three tabs. RM-30 WP 7.3 put this in the URL so the Tools palette's empty state
 *  can DEEP-LINK the Settings tab ("Bind a server in Settings →") rather than reach across the tree
 *  for a callback — and so an author can share "open this skill on its settings". */
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
  mode: StudioMode;
  rail: StudioRail;
  file: string | null;
  sel: string | null;
};

type SearchLike = string | URLSearchParams;

function toParams(search: SearchLike): URLSearchParams {
  return typeof search === "string" ? new URLSearchParams(search) : new URLSearchParams(search);
}

/** Read the Studio's view state out of a query string. An unrecognised `mode` degrades to the
 *  default rather than throwing — a hand-typed URL must still land on a usable workbench. */
export function readStudioUrlState(search: SearchLike): StudioUrlState {
  const params = toParams(search);
  const mode = params.get("mode");
  const rail = params.get("rail");
  const file = params.get("file");
  const sel = params.get("sel");
  return {
    mode: isStudioMode(mode) ? mode : STUDIO_DEFAULT_MODE,
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
  if (next.mode !== undefined) params.set("mode", next.mode);
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
