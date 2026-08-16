import type { DragEvent, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { HubAgentRole, HubCrew, HubCrewMember } from "@mcp-token-footprint/shared";
import { SearchInput } from "@brand/data";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
  Text,
  type TreeNode,
  cn,
  toast,
  useTreeKeyboard,
} from "@brand/ui";
import {
  AlertTriangle,
  Archive,
  ChevronRight,
  CircleDashed,
  MoreHorizontal,
  Plus,
  Users,
} from "lucide-react";
import { IconButton } from "../../../components/IconButton";
import { InlineError } from "../../../components/InlineError";
import { listHubAgentRoles, listHubCrews, updateHubCrew } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { loadableData, useLoadable } from "../../../lib/loadable";
import { RoleAvatar } from "../agents/RoleAvatar";
import { crewAccentClasses } from "../lib/hub-ux";
import { type CrewClosure, formatCrewMembershipCount, resolveCrewClosure } from "./crew-membership";
import { QuickCreateAgentDialog, QuickCreateCrewDialog } from "./QuickCreate";
import { notifyError } from "../../../lib/notify";

/** Crew nesting (WP4.2 / D-CN8) — a defensive cap on RENDER recursion depth, well above any realistic
 *  nesting (comfortably above `HUB_MISSION_MAX_DEPTH`'s default of 2). Never fires in normal operation;
 *  it exists so a non-cyclic but pathological chain can't blow the tree — same treatment as a genuine
 *  cycle (a contained, non-interactive placeholder row, never a hang or crash). */
const ORG_RAIL_MAX_RENDER_DEPTH = 8;

/** Stable empty selection for `useTreeKeyboard` — the rail runs it in `selectionMode: "none"` purely
 *  for keyboard TRAVERSAL (arrow keys/type-ahead/Home/End), never selection; a shared reference avoids
 *  minting a fresh `Set` every render. */
const EMPTY_SELECTED_IDS: Set<string> = new Set();

/**
 * Assistant Hub UX WP2.1 (D-HUX5), rebuilt at ui-wave U5 (owner feedback); N-level at WP4.2 (D-CN8) —
 * the workforce "Organization browser": a treeview over the crew model. Root branches:
 *   • `All agents` (count — a leaf, it IS the default scope, nothing to expand),
 *   • each crew, EXPANDABLE to its member agents (avatar + name + role title) AND, since crew nesting
 *     (WP0.1/D-CN5), to member SUB-CREWS — expandable to arbitrary depth, cycle-safe,
 *   • `Unassigned` (active agents in no crew) and `Archived`, expandable the same way.
 *
 * Selection contract is UNCHANGED from WP2.1: selecting a branch row scopes the Directory/Org-chart
 * tabs through the caller's `scope`/`onScopeChange` (the same `?scope=` codec below). NEW at U5:
 * selecting an AGENT row navigates to that agent's profile — the exact same target the Directory
 * card's open action uses (preserve `tab`/`scope`, drop stale `?settings=`) — and the rail owns two
 * inline-create affordances (the CREWS header "+" → crew quick-create; a crew row's hover "+" →
 * agent quick-create, then membership) plus drag-to-reassign between crew branches (the same
 * `updateHubCrew` members-array mutation the crew profile's Members section saves through). The
 * row's ⋯ menu ("Move to crew") is the keyboard-accessible equivalent of the drag.
 *
 * Still self-contained (fetches its own roles + crews) and still CONTROLLED by `WorkforceView` for
 * the one shareable thing — the selected scope. Branch expansion is deliberately component state,
 * not URL state (the WP text only puts "scope in URL"); default collapsed, with the currently-scoped
 * branch auto-expanded so a deep link lands with its context visible.
 */

/** One of the four rail groupings — the whole "org rail scoping a card grid" contract (D-HUX5).
 *  Serialized into WorkforceView's single `?scope=` query param (see the codec functions below). */
export type OrgRailScope =
  | { kind: "all" }
  | { kind: "crew"; crewId: string }
  | { kind: "unassigned" }
  | { kind: "archived" };

const SCOPE_ALL: OrgRailScope = { kind: "all" };

/**
 * `?scope=` codec (WorkforceView owns reading/writing the URL; these are pure so they're unit-
 * testable in isolation and so Directory/Org-chart (WP2.2/WP2.5) can parse the SAME param when they
 * read `useSearchParams()` themselves). `null` = the default ("all") scope, OMITTED from the URL —
 * mirrors `DashboardView`'s `?tab=` convention (a default-scoped link stays the clean canonical URL).
 * Values: absent | "unassigned" | "archived" | "crew:<crewId>".
 */
export function encodeOrgRailScope(scope: OrgRailScope): string | null {
  switch (scope.kind) {
    case "all":
      return null;
    case "unassigned":
      return "unassigned";
    case "archived":
      return "archived";
    case "crew":
      return `crew:${scope.crewId}`;
    default:
      return null;
  }
}

/** Any unrecognized/malformed value (a dangling `crew:` with no id, a stale/garbage string) falls
 *  back to "all" — the rail never renders a scope it can't resolve. */
export function parseOrgRailScope(raw: string | null): OrgRailScope {
  if (!raw) return SCOPE_ALL;
  if (raw === "unassigned") return { kind: "unassigned" };
  if (raw === "archived") return { kind: "archived" };
  if (raw.startsWith("crew:")) {
    const crewId = raw.slice("crew:".length);
    if (crewId) return { kind: "crew", crewId };
  }
  return SCOPE_ALL;
}

export function orgRailScopesEqual(a: OrgRailScope, b: OrgRailScope): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "crew" && b.kind === "crew" ? a.crewId === b.crewId : true;
}

type OrgRailData = { roles: HubAgentRole[]; crews: HubCrew[] };

/** Expansion keys for the tree's branches — the crew scopes reuse the `?scope=` encoding so "the
 *  scoped branch" maps 1:1 onto a key; `unassigned`/`archived` are their own branches. A NESTED crew
 *  branch (WP4.2) reuses the SAME bare `crew:<id>` key wherever it renders (not path-scoped) — the
 *  simplest correct choice, matching the `?scope=` codec, which also has no notion of nesting path. */
type BranchKey = string;

function branchKeyForScope(scope: OrgRailScope): BranchKey | null {
  if (scope.kind === "crew") return `crew:${scope.crewId}`;
  if (scope.kind === "unassigned" || scope.kind === "archived") return scope.kind;
  return null; // "all" is a leaf — nothing to auto-expand
}

/** What an in-flight agent-row drag carries. Kept in COMPONENT state, not `dataTransfer` (jsdom's
 *  synthetic drag events have no real DataTransfer, and the rail is the only drop surface anyway —
 *  `dataTransfer` is decorated for drag-image/effect fidelity, never load-bearing). `memberIndex`
 *  identifies the exact members-array entry, since a crew may list the same agent twice. */
type DragAgent = { agentId: string; fromCrewId: string | null; memberIndex: number | null };

function roleTitleFor(role: HubAgentRole): { title: string; roleTitle?: string } {
  // Mirrors AgentCard's identity line: persona display name first, the library role (job title) as
  // the sub-label — so a rail row and its directory card always read as the same agent.
  const title = role.displayName ?? role.name;
  return role.displayName ? { title, roleTitle: role.name } : { title };
}

/**
 * Crew nesting (WP4.2) — the keyboard-traversal TREE MODEL (`@brand/ui`'s `TreeNode<never>`,
 * `label: null` throughout since `useTreeKeyboard` only ever reads `.id`/`.children`) mirroring the
 * JSX rendered below, recursively, cycle-safe (the SAME ancestor-path + depth-cap guard `renderMember`
 * uses — a cyclic/dangling/over-depth member is simply absent from BOTH, since neither renders an
 * interactive row for it). A separate pure "model" from the JSX renderer, same posture as
 * `org-chart/org-model.ts` vs. its `OrgChartTab.tsx`.
 */
function crewKeyboardNode(
  crew: HubCrew,
  crewsById: ReadonlyMap<string, HubCrew>,
  rolesById: ReadonlyMap<string, HubAgentRole>,
  ancestorCrewIds: readonly string[],
): TreeNode<never> {
  const children: TreeNode<never>[] = [];
  crew.members.forEach((member, index) => {
    if (member.agentId) {
      if (!rolesById.has(member.agentId)) return; // unresolved role — no row rendered, not in the model
      children.push({ id: `agent:${crew.id}:${index}`, label: null });
      return;
    }
    if (!member.crewId) return;
    const nextAncestors = [...ancestorCrewIds, crew.id];
    if (nextAncestors.includes(member.crewId) || nextAncestors.length >= ORG_RAIL_MAX_RENDER_DEPTH) {
      return; // cyclic / over-depth — a non-interactive placeholder row, not part of the keyboard model
    }
    const child = crewsById.get(member.crewId);
    if (!child) return; // "(deleted crew)" — a non-interactive placeholder row, not part of the model
    children.push(crewKeyboardNode(child, crewsById, rolesById, nextAncestors));
  });
  return { id: `crew:${crew.id}`, label: null, children };
}

export function OrgRail(props: {
  scope: OrgRailScope;
  onScopeChange: (scope: OrgRailScope) => void;
  className?: string;
  /** ui-wave U5 — fires after a rail-side org MUTATION (crew created, agent created/assigned, drag
   *  or menu move) so the host can refresh sibling surfaces (the Directory grid fetches its own
   *  copy of roles+crews and would otherwise go stale). The rail reloads itself regardless. */
  onMutated?: () => void;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");

  const { state, reload } = useLoadable<OrgRailData>(
    () =>
      Promise.all([listHubAgentRoles({ includeArchived: true }), listHubCrews()]).then(
        ([roles, crews]) => ({ roles, crews }),
      ),
    [],
  );
  const data = loadableData(state);

  // ── Expansion (component state, D-HUX5 keeps only the SCOPE in the URL) ─────────────────────────
  const scopedBranch = branchKeyForScope(props.scope);
  // `Set` (not `ReadonlySet`) — `useTreeKeyboard`'s `expandedIds`/`onExpandedChange` (below) work in
  // terms of a mutable `Set<string>`; every actual mutation still goes through `setExpanded`, which
  // always builds a fresh `Set`, so this widening changes no behavior.
  const [expanded, setExpanded] = useState<Set<BranchKey>>(
    () => new Set(scopedBranch ? [scopedBranch] : []),
  );
  // Auto-expand the branch the scope points at whenever the scope CHANGES (a deep link restored, a
  // crew row clicked, a navigation from the Directory side). Render-phase derived-state adjustment
  // (the React-documented alternative to a "sync state from props" effect) — deliberately NOT a
  // useEffect: the U5 org-chart #185 fix is exactly the failure mode such effects invite.
  const [prevScopedBranch, setPrevScopedBranch] = useState<BranchKey | null>(scopedBranch);
  if (scopedBranch !== prevScopedBranch) {
    setPrevScopedBranch(scopedBranch);
    if (scopedBranch && !expanded.has(scopedBranch)) {
      setExpanded(new Set(expanded).add(scopedBranch));
    }
  }
  const toggleBranch = (key: BranchKey): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Derived org model (unchanged semantics: D-AH7 archive rules, no double counting) ────────────
  const rolesById = useMemo(() => new Map((data?.roles ?? []).map((r) => [r.id, r])), [data]);
  const activeRoles = useMemo(() => (data?.roles ?? []).filter((role) => !role.archivedAt), [data]);
  const archivedRoles = useMemo(
    () => (data?.roles ?? []).filter((role) => role.archivedAt),
    [data],
  );
  // Crew nesting (WP4.2 / D-CN8) — the recursive, cycle-safe closure substrate every count/assignment
  // computation below draws from. ONE memo per fetched `data`, shared across every crew's closure so a
  // shared sub-crew (a diamond) is only walked once.
  const crewsById = useMemo(() => new Map((data?.crews ?? []).map((c) => [c.id, c])), [data]);
  const closureMemo = useMemo(() => new Map<string, CrewClosure>(), [data]);
  const assignedRoleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const crew of data?.crews ?? []) {
      // An agent reachable only via a nested sub-crew is now "assigned" too (D-CN8) — the closure
      // already resolves the whole subtree, cycle-safe.
      const closure = resolveCrewClosure(crew.id, crewsById, closureMemo);
      for (const agentId of closure.agentIds) ids.add(agentId);
    }
    return ids;
  }, [data, crewsById, closureMemo]);
  const unassignedRoles = useMemo(
    () => activeRoles.filter((role) => !assignedRoleIds.has(role.id)),
    [activeRoles, assignedRoleIds],
  );

  const crews = useMemo(
    () => [...(data?.crews ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const visibleCrews = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return crews;
    return crews.filter((crew) => crew.name.toLowerCase().includes(q));
  }, [crews, search]);

  // ── Keyboard traversal (WP4.2 / WP2.R precedent) — `@brand/ui`'s `useTreeKeyboard` gives arrow-key/
  // Home/End/type-ahead navigation across arbitrary depth WITHOUT migrating onto the `Tree` component
  // (rejected: `Tree`'s row click conflates select+expand, which would regress this rail's deliberately
  // independent select/expand UX — see the WP's design note). Existing per-row click semantics are
  // untouched; the hook only adds keyboard traversal + roving focus, never owns click handling.
  const keyboardTreeNodes = useMemo<TreeNode<never>[]>(() => {
    const crewNodes = visibleCrews.map((crew) => crewKeyboardNode(crew, crewsById, rolesById, []));
    const unassignedChildren: TreeNode<never>[] = unassignedRoles.map((_role, index) => ({
      id: `agent:unassigned:${index}`,
      label: null,
    }));
    const archivedChildren: TreeNode<never>[] = archivedRoles.map((_role, index) => ({
      id: `agent:archived:${index}`,
      label: null,
    }));
    return [
      { id: "all", label: null },
      ...crewNodes,
      { id: "unassigned", label: null, children: unassignedChildren },
      { id: "archived", label: null, children: archivedChildren },
    ];
  }, [visibleCrews, crewsById, rolesById, unassignedRoles, archivedRoles]);

  const { activeId, registerNodeRef, onKeyDown: onTreeKeyDown } = useTreeKeyboard<never>({
    nodes: keyboardTreeNodes,
    expandedIds: expanded,
    onExpandedChange: setExpanded,
    selectionMode: "none",
    selectedIds: EMPTY_SELECTED_IDS,
    onSelectionChange: () => {},
  });
  /** Threads this row's keyboard identity through to `BranchRow`/`AgentRow` in one spread. */
  const kb = (kbId: string) => ({ kbId, activeId, registerNodeRef });

  // ── Navigation: an agent row opens the SAME profile target the Directory card does ──────────────
  // (preserve `tab`/`scope`, drop any stale `?settings=` — the D-HUX5 URL scheme, byte-for-byte the
  // navigation `DirectoryTab.openProfile` performs, so rail and grid can never drift apart).
  function openProfile(kind: "agent" | "crew", id: string): void {
    const params = new URLSearchParams(searchParams);
    params.delete("settings");
    const qs = params.toString();
    navigate(`/assistant/agents/${kind}/${id}${qs ? `?${qs}` : ""}`);
  }

  // ── Reassign (drag between crew branches, or the row menu's keyboard path) ──────────────────────
  const [dragAgent, setDragAgent] = useState<DragAgent | null>(null);
  const [dropCrewId, setDropCrewId] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  async function moveAgentToCrew(drag: DragAgent, targetCrewId: string): Promise<void> {
    const target = (data?.crews ?? []).find((c) => c.id === targetCrewId);
    if (!target || drag.fromCrewId === targetCrewId) return;
    const identity = rolesById.get(drag.agentId)?.name ?? "This agent";
    if (target.members.some((m) => m.agentId === drag.agentId)) {
      toast.info("Already a member", {
        description: `${identity} is already in “${target.name}”.`,
      });
      return;
    }
    const source = drag.fromCrewId
      ? (data?.crews ?? []).find((c) => c.id === drag.fromCrewId)
      : undefined;
    // Move the FULL member entry (not a bare `{ agentId }`) so per-member overrides (model, prompt,
    // grants…) travel with the agent — the same members-array shape the crew profile saves.
    const entry: HubCrewMember =
      source && drag.memberIndex != null
        ? (source.members[drag.memberIndex] ?? { agentId: drag.agentId })
        : { agentId: drag.agentId };
    setMoveBusy(true);
    try {
      // Add to the target FIRST, then remove from the source: if the second call fails the agent is
      // briefly in both crews (visible, user-recoverable) — never silently dropped from the org.
      await updateHubCrew(target.id, { members: [...target.members, entry] });
      if (source) {
        await updateHubCrew(source.id, {
          members: source.members.filter((_, index) => index !== drag.memberIndex),
        });
      }
      toast.success(source ? `Moved to “${target.name}”` : `Added to “${target.name}”`);
    } catch (error) {
      notifyError("Couldn’t move the agent", { description: getErrorMessage(error) });
    } finally {
      setMoveBusy(false);
      // Re-fetch on failure too — a partial move (added, remove failed) must surface, not go stale.
      reload();
      props.onMutated?.();
    }
  }

  function handleAgentDragStart(event: DragEvent, drag: DragAgent): void {
    setDragAgent(drag);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-hub-agent", drag.agentId);
    }
  }
  function clearDrag(): void {
    setDragAgent(null);
    setDropCrewId(null);
  }

  // ── Inline create (reuses the existing quick-create dialogs — D-HUX6's ≤6-field FormDialogs) ────
  const [quickCreate, setQuickCreate] = useState<"agent" | "crew" | null>(null);
  // The crew a crew-row "+" launched the agent quick-create FROM. Held separately from `quickCreate`
  // because the dialog closes itself (onOpenChange(false)) BEFORE firing onCreated — by then the
  // open-state is already null, so the target must survive it.
  const [agentTargetCrewId, setAgentTargetCrewId] = useState<string | null>(null);

  async function handleAgentCreated(roleId: string): Promise<void> {
    const targetCrew = agentTargetCrewId
      ? (data?.crews ?? []).find((c) => c.id === agentTargetCrewId)
      : undefined;
    setAgentTargetCrewId(null);
    // `QuickCreateAgentDialog`'s API has no crew field (create-only), so "add to THAT crew" is
    // composed here: create, then the same members-array mutation the drag path uses. A failure
    // leaves a created-but-unassigned agent — surfaced honestly, never rolled back silently.
    if (targetCrew && !targetCrew.members.some((m) => m.agentId === roleId)) {
      try {
        await updateHubCrew(targetCrew.id, {
          members: [...targetCrew.members, { agentId: roleId }],
        });
      } catch (error) {
        notifyError(`Created, but couldn’t add to “${targetCrew.name}”`, {
          description: getErrorMessage(error),
        });
      }
    }
    reload();
    props.onMutated?.();
    // "Create, then open profile" (D-HUX5) — the same landing every other create path uses.
    openProfile("agent", roleId);
  }

  function handleCrewCreated(crewId: string): void {
    reload();
    props.onMutated?.();
    openProfile("crew", crewId);
  }

  const renderAgentRow = (
    role: HubAgentRole,
    options: {
      key: string;
      drag: DragAgent | null;
      /** Crews offered by the row menu's "Move to crew" (the keyboard path for the drag). */
      moveTargets: HubCrew[];
      /** Crew nesting (WP4.2) — this row's keyboard-traversal identity (see `keyboardTreeNodes`). */
      kbId: string;
    },
  ): ReactNode => (
    <AgentRow
      {...kb(options.kbId)}
      key={options.key}
      role={role}
      onOpen={() => openProfile("agent", role.id)}
      drag={options.drag}
      onDragStart={handleAgentDragStart}
      onDragEnd={clearDrag}
      moveTargets={options.moveTargets}
      moveBusy={moveBusy}
      onMoveToCrew={(crewId) => {
        if (options.drag) void moveAgentToCrew(options.drag, crewId);
      }}
    />
  );

  const moveTargetsFor = (excludeCrewId: string | null): HubCrew[] =>
    crews.filter((crew) => crew.id !== excludeCrewId);

  /**
   * Crew nesting (WP4.2 / D-CN8) — one crew member, branching on kind. `agentId` → today's `AgentRow`,
   * unchanged. `crewId` → a nested branch: a dangling reference (crew deleted after this one saved a
   * reference to it) renders a disabled "(deleted crew)" leaf; a cycle (this crewId already on the
   * render path) or the defensive depth cap renders a non-interactive warning placeholder instead of
   * recursing again; otherwise recurse into `renderCrewBranch` — the SAME function top-level crews use.
   */
  const renderMember = (
    parentCrew: HubCrew,
    member: HubCrewMember,
    index: number,
    ancestorCrewIds: readonly string[],
  ): ReactNode => {
    if (member.agentId) {
      const roleId = member.agentId;
      const role = rolesById.get(roleId);
      // Parity with the Directory grid: an unresolvable member (deleted role) doesn't render a dead row.
      if (!role) return null;
      return renderAgentRow(role, {
        key: `${roleId}-${index}`,
        drag: { agentId: roleId, fromCrewId: parentCrew.id, memberIndex: index },
        moveTargets: moveTargetsFor(parentCrew.id),
        kbId: `agent:${parentCrew.id}:${index}`,
      });
    }
    if (member.crewId) {
      const childId = member.crewId;
      const nextAncestors = [...ancestorCrewIds, parentCrew.id];
      if (nextAncestors.includes(childId) || nextAncestors.length >= ORG_RAIL_MAX_RENDER_DEPTH) {
        return (
          <li key={`cycle-${parentCrew.id}-${index}`} className="flex h-8 min-w-0 items-center gap-1.5 px-1.5">
            <span aria-hidden className="size-5 shrink-0" />
            <Badge variant="warning" className="min-w-0 gap-1">
              <AlertTriangle aria-hidden className="size-3 shrink-0" />
              <span className="min-w-0 truncate">Circular reference — hidden to avoid a loop</span>
            </Badge>
          </li>
        );
      }
      const childCrew = crewsById.get(childId);
      if (!childCrew) {
        return (
          <li key={`deleted-${parentCrew.id}-${index}`} className="flex h-8 min-w-0 items-center gap-2 px-1.5">
            <span aria-hidden className="size-5 shrink-0" />
            <Text variant="caption" tone="muted" className="min-w-0 truncate">
              (deleted crew · {childId.slice(0, 6)})
            </Text>
          </li>
        );
      }
      return renderCrewBranch(childCrew, nextAncestors);
    }
    return null; // malformed member (neither key set) — defensive; schema `.strict()+.superRefine` blocks this
  };

  /** One crew branch — recursive (WP4.2): a nested `crewId` member renders via this SAME function, so
   *  a crew nested to any depth looks and behaves identically to a top-level one. */
  const renderCrewBranch = (crew: HubCrew, ancestorCrewIds: readonly string[]): ReactNode => {
    const accent = crewAccentClasses(crew.color);
    const branchKey = `crew:${crew.id}`;
    const isExpanded = expanded.has(branchKey);
    const closure = resolveCrewClosure(crew.id, crewsById, closureMemo);

    return (
      <li key={crew.id} className="min-w-0">
        <BranchRow
          {...kb(branchKey)}
          icon={
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", accent.dot)} />
          }
          label={crew.name}
          count={formatCrewMembershipCount(closure)}
          active={props.scope.kind === "crew" && props.scope.crewId === crew.id}
          onSelect={() => props.onScopeChange({ kind: "crew", crewId: crew.id })}
          expandable={{
            expanded: isExpanded,
            onToggle: () => toggleBranch(branchKey),
          }}
          onAddAgent={() => {
            setAgentTargetCrewId(crew.id);
            setQuickCreate("agent");
          }}
          // A drop target only while a drag from ANOTHER branch is live — dropping an agent back on
          // its own crew must read as a no-op, not an invitation. Works at any depth: `fromCrewId` is
          // always the drag's IMMEDIATE containing crew.
          drop={
            dragAgent && dragAgent.fromCrewId !== crew.id
              ? {
                  active: dropCrewId === crew.id,
                  onDragOver: (event) => {
                    event.preventDefault(); // required to allow the HTML5 drop at all
                    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
                    setDropCrewId(crew.id);
                  },
                  onDragLeave: () => setDropCrewId((prev) => (prev === crew.id ? null : prev)),
                  onDrop: () => {
                    const drag = dragAgent;
                    clearDrag();
                    if (drag) void moveAgentToCrew(drag, crew.id);
                  },
                }
              : undefined
          }
        />
        {isExpanded ? (
          <TreeChildren label={`${crew.name} members`}>
            {crew.members.length === 0 ? (
              <li>
                <Text variant="caption" tone="muted" className="px-1.5 py-1">
                  No members yet.
                </Text>
              </li>
            ) : (
              crew.members.map((member, index) =>
                renderMember(crew, member, index, ancestorCrewIds),
              )
            )}
          </TreeChildren>
        ) : null}
      </li>
    );
  };

  return (
    <div className={cn("flex h-full min-w-0 flex-col gap-3 overflow-hidden p-3", props.className)}>
      <Text className="px-1 font-semibold leading-tight">Organization</Text>

      {crews.length > 0 ? (
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search crews…"
          aria-label="Search crews"
        />
      ) : null}

      {state.status === "loading" ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : state.status === "error" ? (
        <InlineError title="Couldn’t load agents & crews" detail={state.error} onRetry={reload} />
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable]"
          onKeyDown={onTreeKeyDown}
        >
          <BranchRow
            {...kb("all")}
            icon={<Users aria-hidden className="size-4" />}
            label="All agents"
            count={activeRoles.length}
            active={props.scope.kind === "all"}
            onSelect={() => props.onScopeChange(SCOPE_ALL)}
          />

          <section aria-label="Crews">
            <div className="mb-1 flex h-6 items-center justify-between gap-2 px-1">
              <Text variant="meta" tone="muted" className="font-semibold uppercase tracking-wide">
                Crews
              </Text>
              {/* Inline create on the group header — the SAME crew quick-create flow the page
                  header's "+ New" menu opens, just one click closer to where crews live. */}
              <IconButton
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                label="New crew"
                onClick={() => setQuickCreate("crew")}
              >
                <Plus aria-hidden className="size-3.5" />
              </IconButton>
            </div>
            {crews.length === 0 ? (
              <Text variant="caption" tone="muted" className="px-1">
                No saved crews yet.
              </Text>
            ) : visibleCrews.length === 0 ? (
              <Text variant="caption" tone="muted" className="px-1">
                No crews match “{search}”.
              </Text>
            ) : (
              <ul className="flex min-w-0 flex-col gap-0.5">
                {visibleCrews.map((crew) => renderCrewBranch(crew, []))}
              </ul>
            )}
          </section>

          <div className="min-w-0">
            <BranchRow
              {...kb("unassigned")}
              icon={<CircleDashed aria-hidden className="size-4" />}
              label="Unassigned"
              count={unassignedRoles.length}
              active={props.scope.kind === "unassigned"}
              onSelect={() => props.onScopeChange({ kind: "unassigned" })}
              expandable={{
                expanded: expanded.has("unassigned"),
                onToggle: () => toggleBranch("unassigned"),
              }}
            />
            {expanded.has("unassigned") ? (
              <TreeChildren label="Unassigned agents">
                {unassignedRoles.length === 0 ? (
                  <li>
                    <Text variant="caption" tone="muted" className="px-1.5 py-1">
                      No unassigned agents.
                    </Text>
                  </li>
                ) : (
                  unassignedRoles.map((role, index) =>
                    renderAgentRow(role, {
                      key: role.id,
                      // Dragging FROM Unassigned assigns (no source crew to remove from) — the same
                      // mutation path, source simply absent.
                      drag: { agentId: role.id, fromCrewId: null, memberIndex: null },
                      moveTargets: moveTargetsFor(null),
                      kbId: `agent:unassigned:${index}`,
                    }),
                  )
                )}
              </TreeChildren>
            ) : null}
          </div>

          <div className="min-w-0">
            <BranchRow
              {...kb("archived")}
              icon={<Archive aria-hidden className="size-4" />}
              label="Archived"
              count={archivedRoles.length}
              active={props.scope.kind === "archived"}
              onSelect={() => props.onScopeChange({ kind: "archived" })}
              expandable={{
                expanded: expanded.has("archived"),
                onToggle: () => toggleBranch("archived"),
              }}
            />
            {expanded.has("archived") ? (
              <TreeChildren label="Archived agents">
                {archivedRoles.length === 0 ? (
                  <li>
                    <Text variant="caption" tone="muted" className="px-1.5 py-1">
                      No archived agents.
                    </Text>
                  </li>
                ) : (
                  archivedRoles.map((role, index) =>
                    // Archived roles are not crew-assignable (the crew profile's own member picker
                    // excludes them) — no drag, no move targets; restore first, from the profile.
                    renderAgentRow(role, {
                      key: role.id,
                      drag: null,
                      moveTargets: [],
                      kbId: `agent:archived:${index}`,
                    }),
                  )
                )}
              </TreeChildren>
            ) : null}
          </div>
        </div>
      )}

      <QuickCreateAgentDialog
        open={quickCreate === "agent"}
        onOpenChange={(open) => setQuickCreate(open ? "agent" : null)}
        onCreated={(roleId) => void handleAgentCreated(roleId)}
      />
      <QuickCreateCrewDialog
        open={quickCreate === "crew"}
        onOpenChange={(open) => setQuickCreate(open ? "crew" : null)}
        onCreated={handleCrewCreated}
      />
    </div>
  );
}

/** The chevron cell — a separate control from the row's select target so a user can browse a
 *  branch's members WITHOUT changing the active scope (and vice versa). Rotates 90° when open. */
function TreeChevron(props: { expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      label={`${props.expanded ? "Collapse" : "Expand"} ${props.label}`}
      aria-expanded={props.expanded}
      className="size-5 shrink-0 rounded-sm p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
      onClick={props.onToggle}
    >
      <ChevronRight
        aria-hidden
        className={cn(
          "size-3.5 transition-transform duration-fast ease-standard",
          props.expanded && "rotate-90",
        )}
      />
    </IconButton>
  );
}

/** A branch's child list — indented behind a guide line that hangs under the parent's chevron. */
function TreeChildren(props: { label: string; children: ReactNode }) {
  return (
    <ul
      aria-label={props.label}
      className="ms-2.5 flex min-w-0 flex-col gap-0.5 border-s border-border ps-1.5 py-0.5"
    >
      {props.children}
    </ul>
  );
}

/**
 * One branch row (All agents / a crew / Unassigned / Archived): chevron (when expandable) + a
 * full-width select target (icon, truncating label, right-aligned muted count) + a crew row's
 * hover "+" and drop-target treatment. Row hover/selection styling lives on the WRAPPER (the row
 * holds several controls); the inner buttons stay transparent so the row reads as one surface —
 * the same recipe `SkillRail`'s rows use.
 *
 * `count` is `number | string` (WP4.2 / D-CN8): a crew branch passes `formatCrewMembershipCount`'s
 * output ("N agents" / "N agents, M crews (T total)") so nesting reads honestly; the other three
 * fixed branches (All agents/Unassigned/Archived, which never nest) keep a plain `number`.
 */
function BranchRow(props: {
  icon: ReactNode;
  label: string;
  count: number | string;
  active: boolean;
  onSelect: () => void;
  expandable?: { expanded: boolean; onToggle: () => void };
  /** Hover "+" (crew rows): add an agent to THIS crew. */
  onAddAgent?: () => void;
  /** Drag-reassign drop wiring (crew rows, only while a foreign drag is live). */
  drop?: {
    active: boolean;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: () => void;
  };
  /** Crew nesting (WP4.2) — `useTreeKeyboard` roving-focus wiring: this row's keyboard-model id, the
   *  hook's current `activeId`, and its `registerNodeRef` (so Home/End/arrow-key focus can find the
   *  DOM element). Click/select semantics are untouched — this only adds keyboard traversal. */
  kbId?: string;
  activeId?: string | null;
  registerNodeRef?: (id: string, el: HTMLElement | null) => void;
}) {
  return (
    <div
      className={cn(
        "group/row relative flex h-8 min-w-0 items-center gap-0.5 rounded-md text-body transition-colors",
        "hover:bg-accent/60",
        // interface-craft WP 4.3 FIX 3 (P1): the active row is a primary-tinted CHIP, not a neutral
        // `bg-accent` tint carrying `text-primary` body text (that measured 4.28:1, below AA). The
        // label now stays at the default foreground (~12:1 on this light chip) and the primary/active
        // read moves to the tint + the primary icon below. qlik-dark stays high-contrast (foreground
        // on a subtle dark tint).
        props.active && "bg-primary/10",
        props.drop?.active && "bg-accent ring-1 ring-inset ring-ring",
      )}
      data-drop-target={props.drop?.active ? "true" : undefined}
      onDragOver={props.drop?.onDragOver}
      onDragLeave={props.drop?.onDragLeave}
      onDrop={
        props.drop
          ? (event) => {
              event.preventDefault();
              props.drop?.onDrop();
            }
          : undefined
      }
    >
      {props.expandable ? (
        <TreeChevron
          expanded={props.expandable.expanded}
          label={props.label}
          onToggle={props.expandable.onToggle}
        />
      ) : (
        // Leaf rows keep a chevron-sized spacer so every label starts on the same indent column.
        <span aria-hidden className="size-5 shrink-0" />
      )}
      <Button
        type="button"
        variant="ghost"
        aria-current={props.active ? "true" : undefined}
        ref={props.kbId ? (el) => props.registerNodeRef?.(props.kbId as string, el) : undefined}
        tabIndex={props.kbId ? (props.kbId === props.activeId ? 0 : -1) : undefined}
        className={cn(
          "h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-1.5 font-normal hover:bg-transparent",
          // FIX 3: emphasize the active label with WEIGHT (AA-safe), not color — the failing
          // `text-primary` on the tint is gone; the label inherits the default foreground.
          props.active && "font-medium",
        )}
        onClick={props.onSelect}
      >
        {/* FIX 3: the active row's primary-green affordance lives on the ICON — a graphical element
            (WCAG non-text 3:1, which primary-on-tint clears) — so no 13px body text is recolored. */}
        <span className={cn("flex shrink-0 items-center", props.active && "text-primary")}>
          {props.icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{props.label}</span>
        <span
          className={cn(
            "shrink-0 tabular-nums text-muted-foreground",
            // The hover "+" appears IN the count's slot (the VS Code tree pattern) — opacity only,
            // so the count stays in the row's accessible name.
            props.onAddAgent && "transition-opacity group-hover/row:opacity-0",
          )}
        >
          {props.count}
        </span>
      </Button>
      {props.onAddAgent ? (
        <IconButton
          type="button"
          variant="ghost"
          size="icon-sm"
          label={`Add agent to ${props.label}`}
          className="absolute end-0.5 top-1/2 size-6 shrink-0 -translate-y-1/2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100"
          onClick={props.onAddAgent}
        >
          <Plus aria-hidden className="size-3.5" />
        </IconButton>
      ) : null}
    </div>
  );
}

/**
 * One member/agent row: avatar + name + role title. Click opens the agent's profile (the Directory
 * card's own open target). Draggable between crew branches when `drag` is set; the ⋯ menu's "Move
 * to crew" entries are the keyboard-accessible equivalent, calling the SAME mutation.
 */
function AgentRow(props: {
  role: HubAgentRole;
  onOpen: () => void;
  /** This row's drag payload — `null` disables dragging (archived rows). */
  drag: DragAgent | null;
  onDragStart: (event: DragEvent, drag: DragAgent) => void;
  onDragEnd: () => void;
  moveTargets: HubCrew[];
  moveBusy: boolean;
  onMoveToCrew: (crewId: string) => void;
  /** Crew nesting (WP4.2) — `useTreeKeyboard` roving-focus wiring, see `BranchRow`'s doc. */
  kbId?: string;
  activeId?: string | null;
  registerNodeRef?: (id: string, el: HTMLElement | null) => void;
}) {
  const { title, roleTitle } = roleTitleFor(props.role);
  const drag = props.drag;
  return (
    <li
      className="group/row relative flex h-8 min-w-0 items-center rounded-md text-body transition-colors hover:bg-accent/60"
      draggable={drag ? true : undefined}
      onDragStart={drag ? (event) => props.onDragStart(event, drag) : undefined}
      onDragEnd={drag ? props.onDragEnd : undefined}
    >
      <Button
        type="button"
        variant="ghost"
        ref={props.kbId ? (el) => props.registerNodeRef?.(props.kbId as string, el) : undefined}
        tabIndex={props.kbId ? (props.kbId === props.activeId ? 0 : -1) : undefined}
        className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-1.5 pe-7 font-normal hover:bg-transparent"
        onClick={props.onOpen}
      >
        <RoleAvatar
          id={props.role.id}
          icon={props.role.icon}
          model={props.role.defaultModel}
          className="size-5 shrink-0"
        />
        <span className="min-w-0 truncate text-left">{title}</span>
        {roleTitle ? (
          <Text variant="meta" tone="muted" as="span" className="min-w-0 truncate text-left">
            {roleTitle}
          </Text>
        ) : null}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            label={`${title} actions`}
            className="absolute end-0.5 top-1/2 size-6 shrink-0 -translate-y-1/2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal aria-hidden className="size-3.5" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={props.onOpen}>Open profile</DropdownMenuItem>
          {drag && props.moveTargets.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Move to crew</DropdownMenuLabel>
              {props.moveTargets.map((crew) => (
                <DropdownMenuItem
                  key={crew.id}
                  disabled={props.moveBusy}
                  onSelect={() => props.onMoveToCrew(crew.id)}
                >
                  {crew.name}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
