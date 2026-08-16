import type {
  HubCrew,
  HubCrewColor,
  HubCrewMember,
  HubCrewPatch,
  HubTopology,
} from "@mcp-token-footprint/shared";
import { HUB_CREW_NAME_MAX_LENGTH, HUB_MISSION_MAX_DEPTH } from "@mcp-token-footprint/shared";

/**
 * Assistant Hub UX WP2.4 (D-HUX6) — the crew profile modal's UNIFIED form value. One shared state
 * across the Profile / Members / Topology / Budgets sections (mirrors `CrewEditor.tsx`'s
 * `CrewFormValue`, PLUS `color` — D-HUX8's crew accent). One `dirty` check, one Save in the sticky
 * footer, per the concept's wireframe (a single Cancel/Save pair, not a save-per-section). Memory and
 * Usage are read-only informational sections and carry no form state.
 */
export type CrewProfileFormValue = {
  name: string;
  description: string;
  /** `null` = no explicit accent (D-HUX8). */
  color: HubCrewColor | null;
  /** The crew's avatar icon (`parseHubIcon` encoding); `""` ⇒ the `Persona` fallback. */
  icon: string;
  topology: HubTopology;
  members: HubCrewMember[];
};

export function crewProfileFormFromCrew(crew: HubCrew): CrewProfileFormValue {
  return {
    name: crew.name,
    description: crew.description ?? "",
    color: crew.color ?? null,
    icon: crew.icon ?? "",
    topology: crew.topology,
    members: crew.members,
  };
}

export type CrewProfileFieldErrors = Partial<Record<"name" | "members", string>>;

/** Crew nesting (WP4.1, D-CN4 author-time/client-side half) — the crew graph + host crew id
 *  `validateCrewProfileForm` needs to author-time-reject a cycle/over-depth `crewId` member.
 *  `maxDepth` defaults to {@link HUB_MISSION_MAX_DEPTH} when omitted. */
export type CrewNestingContext = {
  crewId: string;
  crews: HubCrew[];
  maxDepth?: number;
};

/** D-CN5 — a member is EXACTLY ONE of a library role (`agentId`) or a nested saved crew (`crewId`),
 *  enforced server-side by `hubCrewMemberSchema`'s `.strict().superRefine`. This is the one place
 *  that decision is named on the client, so every render/validation site branches on `memberKind`
 *  instead of re-deriving the same `member.crewId ? … : …` ternary inline. */
export function memberKind(member: HubCrewMember): "agent" | "crew" {
  return member.crewId ? "crew" : "agent";
}

/**
 * D-CN4 (author-time, CLIENT-SIDE half — advisory UX over a point-in-time `listHubCrews()` snapshot;
 * WP1.1's repository `assertCrewGraphValid` remains the authoritative reject) — can `fromCrewId`
 * reach `toCrewId` by walking forward `crewId` member edges? `true` when `fromCrewId === toCrewId`
 * (a node trivially reaches itself), which is what makes a direct self-nest register as a "cycle"
 * with no separate check needed.
 *
 * `visited` guards each DFS **path**, not the whole walk — mirrors the server's
 * `assertCrewGraphValid` (`new Set([...path, childId])`): a fresh copy is threaded down each branch,
 * so a diamond (two paths converging on the same crew) is still explored down both branches, while a
 * genuine cycle — a crew already on the CURRENT path — stops that branch instead of looping forever.
 * A pre-existing, unrelated cycle elsewhere in the fetched graph therefore can never infinite-loop
 * this purely-advisory calculation.
 */
export function crewReachable(
  crews: HubCrew[],
  fromCrewId: string,
  toCrewId: string,
  visited: ReadonlySet<string> = new Set(),
): boolean {
  if (fromCrewId === toCrewId) return true;
  if (visited.has(fromCrewId)) return false;
  const crew = crews.find((c) => c.id === fromCrewId);
  if (!crew) return false;
  const nextVisited = new Set([...visited, fromCrewId]);
  return crew.members.some(
    (member) => member.crewId != null && crewReachable(crews, member.crewId, toCrewId, nextVisited),
  );
}

/**
 * The longest chain of nested `crewId` members reachable BELOW `crewId` (`0` = a leaf crew with no
 * sub-crew members of its own). Same per-path `visited` cycle guard as {@link crewReachable}.
 */
export function crewSubtreeDepth(
  crews: HubCrew[],
  crewId: string,
  visited: ReadonlySet<string> = new Set(),
): number {
  if (visited.has(crewId)) return 0;
  const crew = crews.find((c) => c.id === crewId);
  if (!crew) return 0;
  const nextVisited = new Set([...visited, crewId]);
  let deepest = 0;
  for (const member of crew.members) {
    if (member.crewId == null) continue;
    const childDepth = 1 + crewSubtreeDepth(crews, member.crewId, nextVisited);
    if (childDepth > deepest) deepest = childDepth;
  }
  return deepest;
}

/**
 * The longest chain of crews that ALREADY (transitively) nest `crewId` as a member (`0` = `crewId`
 * isn't nested inside anything today, as far as this snapshot shows — it's effectively a root).
 * Walks the REVERSE edge (which crews list `crewId` as one of their `crewId` members) rather than
 * the forward edge {@link crewReachable}/{@link crewSubtreeDepth} walk. Same per-path cycle guard.
 */
export function crewAncestorDepth(
  crews: HubCrew[],
  crewId: string,
  visited: ReadonlySet<string> = new Set(),
): number {
  if (visited.has(crewId)) return 0;
  const nextVisited = new Set([...visited, crewId]);
  const parents = crews.filter((c) => c.members.some((m) => m.crewId === crewId));
  let deepest = 0;
  for (const parent of parents) {
    const parentDepth = 1 + crewAncestorDepth(crews, parent.id, nextVisited);
    if (parentDepth > deepest) deepest = parentDepth;
  }
  return deepest;
}

/**
 * D-CN4's author-time, client-side cycle/depth check for nesting `candidateCrewId` as a NEW member
 * of `hostCrewId`. `cycle` is checked first: nesting the candidate into the host closes a cycle
 * exactly when the candidate can already reach the host by walking forward `crewId` edges (a path
 * back to the host already exists, so the new host→candidate edge would complete a loop) — this
 * also catches a direct self-nest (`hostCrewId === candidateCrewId`) with no separate check. When
 * it's not a cycle, `overDepth` bounds the deepest node the new edge could produce: the host's own
 * depth-from-a-root ({@link crewAncestorDepth}) + 2 (counting the host and the candidate themselves)
 * + however much deeper the candidate's own subtree already reaches ({@link crewSubtreeDepth}) —
 * mirrors the server's (`assertCrewGraphValid`) depth-cap arithmetic. `maxDepth` defaults to
 * {@link HUB_MISSION_MAX_DEPTH}.
 */
export function evaluateCrewNesting(
  crews: HubCrew[],
  hostCrewId: string,
  candidateCrewId: string,
  maxDepth: number = HUB_MISSION_MAX_DEPTH,
): { cycle: boolean; overDepth: boolean } {
  if (crewReachable(crews, candidateCrewId, hostCrewId)) {
    return { cycle: true, overDepth: false };
  }
  const overDepth =
    crewAncestorDepth(crews, hostCrewId) + 2 + crewSubtreeDepth(crews, candidateCrewId) > maxDepth;
  return { cycle: false, overDepth };
}

/** Mirrors `CrewEditor.tsx`'s `validate` (same two constraints — a name, and at least one member) so
 *  the crew profile modal never accepts something the old crew builder would have rejected. Given a
 *  `context`, ALSO author-time-rejects (D-CN4, client-side half) any `crewId` member that would
 *  create a crew-nesting cycle or breach the max depth — the first hit stops the modal from saving,
 *  naming the offending crew. `context` is optional so this stays a drop-in replacement wherever it
 *  was called with one argument before. */
export function validateCrewProfileForm(
  value: CrewProfileFormValue,
  context?: CrewNestingContext,
): CrewProfileFieldErrors {
  const errors: CrewProfileFieldErrors = {};
  if (!value.name.trim()) errors.name = "Name is required.";
  else if (value.name.length > HUB_CREW_NAME_MAX_LENGTH) {
    errors.name = `Name must be ${HUB_CREW_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (value.members.length === 0) errors.members = "Add at least one role.";

  if (context) {
    const maxDepth = context.maxDepth ?? HUB_MISSION_MAX_DEPTH;
    for (const member of value.members) {
      if (member.crewId == null) continue;
      const { cycle, overDepth } = evaluateCrewNesting(
        context.crews,
        context.crewId,
        member.crewId,
        maxDepth,
      );
      if (!cycle && !overDepth) continue;
      const candidate = context.crews.find((c) => c.id === member.crewId);
      const label = candidate ? `“${candidate.name}”` : `“${member.crewId}”`;
      errors.members = cycle
        ? `${label} would create a circular crew reference — remove it.`
        : `${label} exceeds the maximum crew nesting depth (${maxDepth}).`;
      break;
    }
  }

  return errors;
}

/** Trims name/description exactly like `CrewLibraryPanel.tsx`'s `handleSave` (empty description ⇒
 *  `null`, clearing it on the patch rather than sending `""`). `color: null` explicitly clears the
 *  accent (`HubCrewPatch.color` is `HubCrewColor | null`, D-HUX8). */
export function crewProfileFormToPatch(value: CrewProfileFormValue): HubCrewPatch {
  const description = value.description.trim();
  const icon = value.icon.trim();
  return {
    name: value.name.trim(),
    description: description ? description : null,
    color: value.color,
    // `null` clears the icon back to the default (member-strip / Persona fallback).
    icon: icon ? icon : null,
    topology: value.topology,
    members: value.members,
  };
}

/** Move the member at `index` one slot up (`-1`) or down (`+1`); a boundary move is a no-op (returns
 *  the SAME array reference so a caller can skip a state update / know nothing changed). Order matters
 *  for `pipeline`/`debate` topologies (D-HUX9's chain/alternating-turns edges read straight off array
 *  order via `deriveTopologyGraph`), which is why Members needs an explicit reorder affordance the old
 *  `CrewEditor` never had. */
export function moveMember(
  members: HubCrewMember[],
  index: number,
  direction: -1 | 1,
): HubCrewMember[] {
  const target = index + direction;
  if (target < 0 || target >= members.length) return members;
  const next = [...members];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as HubCrewMember);
  return next;
}
