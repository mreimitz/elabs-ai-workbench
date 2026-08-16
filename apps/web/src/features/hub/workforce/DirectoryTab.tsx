import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { SearchInput } from "@brand/data";
import {
  Button,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
} from "@brand/ui";
import { Bot, Plus, Users } from "lucide-react";
import { InlineError } from "../../../components/InlineError";
import {
  createHubSession,
  listHubAgentRoles,
  listHubCrews,
  updateHubAgentRole,
} from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { loadableData, useLoadable } from "../../../lib/loadable";
import { HubModelPicker } from "../HubModelPicker";
import { defaultHubModelOption } from "../hub-model-picker";
import { hubModelWireFields, useHubModelRoster, type HubModelOption } from "../use-hub-models";
import { AgentCard } from "./AgentCard";
import { CrewHeaderCard } from "./CrewHeaderCard";
import { type CrewClosure, resolveCrewAgents, resolveCrewClosure } from "./crew-membership";
import { parseOrgRailScope } from "./OrgRail";
import { QuickCreateAgentDialog } from "./QuickCreate";
import { notifyError } from "../../../lib/notify";

/**
 * Assistant Hub UX WP2.2 (D-HUX5 §7.3 Tab 1) — the workforce Directory tab: fills `WorkforceView`'s
 * `directoryTab` slot. Self-contained per the frame's own contract (see `WorkforceView.tsx`'s class
 * doc): reads `?scope=` itself via `parseOrgRailScope` (the SAME codec `OrgRail`/`WorkforceView`
 * write), fetches its own roles + crews, and owns every Directory-specific interaction — search,
 * sort, select/open/quick-create — without any props threaded in from the frame.
 *
 * VIRTUALIZATION IF >50 CARDS IN THIS WORKTHROUGH IS NEEDED: `content-visibility: auto` per card
 * (see `AgentCard`'s `virtualizeHint`) — see that component's doc for why neither `DataTable` nor
 * `Gallery` fits a card grid.
 *
 * `reloadKey` (WP2.8) — the one prop the frame threads in: a monotonically bumped number that forces
 * a re-fetch of the roles + crews. `AgentsView` bumps it after a PageHeader quick-create — and, since
 * ui-wave U5 (owner feedback), after any org-rail mutation (inline create, crew reassignment) — so
 * this (never-remounted — App.tsx's three sibling routes reconcile as one fiber) grid picks up the
 * change when the user returns from its profile. The tab's own scope/search/sort state stays entirely
 * URL/local-driven; this is purely a reload trigger.
 */

const CARD_VIRTUALIZE_THRESHOLD = 50;

type SortOrder = "name" | "updated";
const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "name", label: "Name (A–Z)" },
  { value: "updated", label: "Recently updated" },
];

function sortRoles(roles: HubAgentRole[], sort: SortOrder): HubAgentRole[] {
  const copy = [...roles];
  if (sort === "updated") {
    copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } else {
    copy.sort((a, b) => (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name));
  }
  return copy;
}

function matchesSearch(role: HubAgentRole, needle: string): boolean {
  if (!needle) return true;
  const haystack = `${role.displayName ?? ""} ${role.name} ${role.description ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

export function DirectoryTab({ reloadKey }: { reloadKey?: number } = {}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const scope = parseOrgRailScope(searchParams.get("scope"));

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOrder>("name");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  // ui-wave U5 (owner feedback) — the toolbar's "+ New" menu was a duplicate of the PageHeader's
  // split button (WorkforceView) and was removed; the agent quick-create stays mounted for the
  // all-scope empty state's ONE primary action (D-HUX14), the crew dialog now has no trigger here.
  const [quickCreateAgentOpen, setQuickCreateAgentOpen] = useState(false);
  const [archiveBusyId, setArchiveBusyId] = useState<string | null>(null);
  const [instantiateBusy, setInstantiateBusy] = useState(false);
  /** D-MI7 (WP 4.1) — an explicit coordinating-model choice for Instantiate; `null` = the default. */
  const [instantiateModel, setInstantiateModel] = useState<HubModelOption | null>(null);

  const { state, reload } = useLoadable(
    () =>
      Promise.all([listHubAgentRoles({ includeArchived: true }), listHubCrews()]).then(
        ([roles, crews]) => ({ roles, crews }),
      ),
    [reloadKey],
  );
  const data = loadableData(state);
  const roster = useHubModelRoster();

  // Preserves `tab`/`scope` (and drops any stale `?settings=`) — the D-HUX5 URL scheme.
  function openProfile(kind: "agent" | "crew", id: string): void {
    const params = new URLSearchParams(searchParams);
    params.delete("settings");
    const qs = params.toString();
    navigate(`/assistant/agents/${kind}/${id}${qs ? `?${qs}` : ""}`);
  }

  async function handleArchiveToggle(role: HubAgentRole, archived: boolean): Promise<void> {
    setArchiveBusyId(role.id);
    try {
      await updateHubAgentRole(role.id, { archived });
      toast.success(archived ? "Agent archived" : "Agent restored");
      reload();
    } catch (error) {
      notifyError("Couldn’t update the agent", { description: getErrorMessage(error) });
    } finally {
      setArchiveBusyId(null);
    }
  }

  /**
   * D-MI1/D-MI7 — the model the crew's coordinating session starts on. An explicit pick from the
   * {@link HubModelPicker} always wins; otherwise a member role's own pin (the more specific saved
   * choice); otherwise the deterministic first roster row. Never `models[0]`, which follows
   * `ORDER BY updated_at DESC` and therefore moved whenever an unrelated credential was edited.
   */
  function resolveInstantiateWire(
    memberRoles: HubAgentRole[],
  ): { model: string; providerCredentialId?: string } | null {
    if (instantiateModel) return hubModelWireFields(instantiateModel);
    const seedRole = memberRoles.find((role) => role.defaultModel);
    if (seedRole?.defaultModel) {
      return {
        model: seedRole.defaultModel,
        ...(seedRole.providerCredentialId
          ? { providerCredentialId: seedRole.providerCredentialId }
          : {}),
      };
    }
    const fallback = defaultHubModelOption(roster.models);
    return fallback ? hubModelWireFields(fallback) : null;
  }

  async function handleInstantiate(crew: HubCrew, memberRoles: HubAgentRole[]): Promise<void> {
    const wire = resolveInstantiateWire(memberRoles);
    if (!wire) return;
    setInstantiateBusy(true);
    try {
      const created = await createHubSession({ mode: "mission", ...wire, crewId: crew.id });
      navigate(`/assistant?session=${created.id}`);
    } catch (error) {
      notifyError("Couldn’t start a session with this crew", {
        description: getErrorMessage(error),
      });
    } finally {
      setInstantiateBusy(false);
    }
  }

  const roles = data?.roles ?? [];
  const crews = data?.crews ?? [];

  const crewById = useMemo(() => new Map(crews.map((crew) => [crew.id, crew])), [crews]);
  const activeRoles = useMemo(() => roles.filter((role) => !role.archivedAt), [roles]);
  const archivedRoles = useMemo(() => roles.filter((role) => role.archivedAt), [roles]);
  // Crew nesting (WP4.2 / D-CN8) — the recursive, cycle-safe closure substrate every count/assignment
  // computation below draws from. ONE memo per fetched crew list, shared across every crew's closure.
  const closureMemo = useMemo(() => new Map<string, CrewClosure>(), [crews]);
  const assignedRoleIds = useMemo(() => {
    const ids = new Set<string>();
    // An agent reachable only via a nested sub-crew is now "assigned" too (D-CN8) — the closure
    // already resolves the whole subtree, cycle-safe.
    for (const crew of crews) {
      const closure = resolveCrewClosure(crew.id, crewById, closureMemo);
      for (const agentId of closure.agentIds) ids.add(agentId);
    }
    return ids;
  }, [crews, crewById, closureMemo]);
  const unassignedRoles = useMemo(
    () => activeRoles.filter((role) => !assignedRoleIds.has(role.id)),
    [activeRoles, assignedRoleIds],
  );
  /** Every crew a role belongs to — feeds `AgentCard`'s D-HUX8 stacked-dots accent in non-crew scopes. */
  const crewsByRoleId = useMemo(() => {
    const map = new Map<string, HubCrew[]>();
    for (const crew of crews) {
      for (const member of crew.members) {
        // Crew nesting (WP0.1 / D-CN5) — index only agent members into the role→crews map.
        const roleId = member.agentId;
        if (!roleId) continue;
        const list = map.get(roleId) ?? [];
        list.push(crew);
        map.set(roleId, list);
      }
    }
    return map;
  }, [crews]);

  const rolesById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const scopedCrew = scope.kind === "crew" ? (crewById.get(scope.crewId) ?? null) : null;
  // Crew nesting (WP4.2 / D-CN8) — recursive: the scoped crew's member grid shows every agent
  // reachable through the WHOLE nested subtree, not just direct members (the natural complement of
  // "assignedRoleIds" being recursive too).
  const scopedCrewMembers = useMemo(() => {
    if (!scopedCrew) return [];
    return resolveCrewAgents(scopedCrew.id, crewById, rolesById);
  }, [scopedCrew, crewById, rolesById]);

  const baseList =
    scope.kind === "all"
      ? activeRoles
      : scope.kind === "unassigned"
        ? unassignedRoles
        : scope.kind === "archived"
          ? archivedRoles
          : scopedCrewMembers;

  const needle = search.trim().toLowerCase();
  const visibleRoles = useMemo(
    () =>
      sortRoles(
        baseList.filter((role) => matchesSearch(role, needle)),
        sort,
      ),
    [baseList, needle, sort],
  );

  const virtualize = visibleRoles.length > CARD_VIRTUALIZE_THRESHOLD;

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" aria-hidden />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="p-6">
        <InlineError title="Couldn’t load the directory" detail={state.error} onRetry={reload} />
      </div>
    );
  }

  const gridLabel =
    scope.kind === "crew"
      ? `${scopedCrew?.name ?? "Crew"} members`
      : scope.kind === "unassigned"
        ? "Unassigned agents"
        : scope.kind === "archived"
          ? "Archived agents"
          : "All agents";

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto p-4 [scrollbar-gutter:stable]">
      {/* ui-wave U5 (owner feedback) — ONE aligned h-9 control row: search (fixed w-64) + a Sort
          select. The old `SelectField` floated a "Sort" label ABOVE the control, breaking the row's
          baseline; the trigger now carries its own muted "Sort:" prefix (aria-hidden — the trigger's
          aria-label names it for AT) so the row stays a single quiet line. The "+ New" menu that
          used to sit here duplicated the PageHeader's split button and was removed — see the class
          doc; one create entry point per surface. */}
      <div className="flex items-center gap-2">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search in this scope…"
          aria-label="Search agents"
          containerClassName="w-64"
        />
        <Select value={sort} onValueChange={(value) => setSort(value as SortOrder)}>
          <SelectTrigger aria-label="Sort" className="h-9 w-auto shrink-0 gap-1.5">
            <span aria-hidden className="text-muted-foreground">
              Sort:
            </span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {scope.kind === "crew" ? (
        scopedCrew ? (
          <CrewHeaderCard
            crew={scopedCrew}
            roles={roles}
            crews={crews}
            onOpenProfile={() => openProfile("crew", scopedCrew.id)}
            onInstantiate={() => void handleInstantiate(scopedCrew, scopedCrewMembers)}
            instantiateBusy={instantiateBusy}
            instantiateModelPicker={
              roster.models.length > 0 ? (
                <HubModelPicker
                  id="directory-instantiate-model"
                  name="Coordinating model"
                  models={roster.models}
                  loading={roster.loading}
                  unavailable={roster.unavailable}
                  value={instantiateModel ?? defaultHubModelOption(roster.models) ?? null}
                  disabled={instantiateBusy}
                  dialogTitle="Choose this crew's coordinating model"
                  onChange={setInstantiateModel}
                />
              ) : null
            }
            instantiateDisabledReason={
              scopedCrewMembers.some((role) => role.defaultModel) || roster.models.length > 0
                ? null
                : "No model available yet — configure a provider or a member's default model."
            }
          />
        ) : (
          <EmptyState
            icon={<Users aria-hidden />}
            title="Crew not found"
            description="This crew may have been deleted. Pick another from the organization rail."
          />
        )
      ) : null}

      {/* Single-EmptyState rule (D-HUX14): when a crew scope resolves to a deleted/stale crew, the
          "Crew not found" EmptyState above already covers the empty region — don't also stack the
          "no members yet" box (WP3.R-D1). */}
      {visibleRoles.length === 0 && !(scope.kind === "crew" && !scopedCrew) ? (
        <EmptyState
          className="mt-6"
          icon={<Bot aria-hidden />}
          title={
            needle
              ? `No agents match “${search.trim()}”`
              : scope.kind === "all"
                ? "No agents yet"
                : scope.kind === "unassigned"
                  ? "No unassigned agents"
                  : scope.kind === "archived"
                    ? "No archived agents"
                    : "This crew has no members yet"
          }
          description={
            needle
              ? "Try a different search term, or clear the filter to see every agent in this scope."
              : scope.kind === "all"
                ? "Create an agent to build the library the planner and crews draw from."
                : undefined
          }
          actions={
            needle ? (
              <Button variant="outline" onClick={() => setSearch("")}>
                Clear filter
              </Button>
            ) : scope.kind === "all" ? (
              <Button onClick={() => setQuickCreateAgentOpen(true)}>
                <Plus aria-hidden />
                <span>New agent</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <section
          aria-label={gridLabel}
          className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4"
        >
          {visibleRoles.map((role) => (
            <AgentCard
              key={role.id}
              role={role}
              memberOfCrews={scopedCrew ? [scopedCrew] : (crewsByRoleId.get(role.id) ?? [])}
              selected={role.id === selectedRoleId}
              onSelect={() => setSelectedRoleId(role.id)}
              onOpen={() => openProfile("agent", role.id)}
              onArchiveToggle={(archived) => void handleArchiveToggle(role, archived)}
              archiveBusy={archiveBusyId === role.id}
              virtualizeHint={virtualize}
            />
          ))}
        </section>
      )}

      <QuickCreateAgentDialog
        open={quickCreateAgentOpen}
        onOpenChange={setQuickCreateAgentOpen}
        onCreated={(roleId) => {
          reload();
          openProfile("agent", roleId);
        }}
      />
    </div>
  );
}
