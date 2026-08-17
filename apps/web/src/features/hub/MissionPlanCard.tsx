// Assistant Hub (roadmap/assistant-hub/, WP1.7 · D-AH6/D-AH7 · R-UX6) — the editable MISSION PLAN
// card, rendered IN-BAND when the planner has proposed a team (`plan_proposed`) and the mission is
// still awaiting approval. Composes `@brand/ai`'s `Plan*` shell + `@brand/ui` primitives (brand-ui
// only, both themes). Each agent shows its role, model chip, target, brief, per-agent RATIONALE
// (R-UX6 — "because your prompt asks…"), budget and tool grants; the footer approves, adjusts (removes
// an agent → a `PATCH`), or cancels. Hard caps are enforced server-side regardless of any edit here.
//
// hub-fixes WP2.2 (RC2.4): grants are shown as per-server CHIPS (not one text line); each agent gets an
// "Edit access" affordance that reuses `ToolGrantPicker` (constrained to the parent's grantable catalog)
// and persists the change through the existing plan PATCH; a half-configured role (its instructions /
// target still carrying a "finish configuring" placeholder) shows a per-agent warning badge instead of
// silently running.
//
// hub-fixes WP2.3 (D-HF5): when the parent session is SCOPED, each agent's chips get a small subtitle
// showing its EFFECTIVE access (plan grants ∩ parent scope) — the same intersection rule the orchestrator
// applies at spawn (`apps/api/src/hub/tools/grants.ts`'s `effectiveAgentGrants`), mirrored here as a tiny
// pure fn (web can't import API source) so the card previews what will ACTUALLY be granted before the
// owner approves. `parentScope` is a new optional prop — absent/`null` (an "auto"/unscoped parent, the
// D-HF5 pass-through case) renders exactly as before. Not yet threaded from `ConversationPane.tsx` (that
// file is out of this WP's exclusive scope) — a follow-up wires `session.toolScope` through when a scoped
// parent shows its plan card.
//
// hub-fixes WP5.2 (RC5, D-HF2): an inline notice above the agent list when the plan's own text reads as
// wanting the web (`missionTextWantsWebCapability`, a brief/target/expectedOutcome/rationale keyword
// heuristic) but the parent's reachable MCP catalog has nothing that looks research-capable
// (`catalogHasResearchServer === false`, resolved by `ConversationPane.tsx` off the SAME
// `hasResearchCapableServer` check the research-mode empty-state hint uses). `sessionHasWebSearch`
// (WP 5.1 acknowledgement) softens the copy — an MCP server stays the pluralistic upgrade (multi-engine,
// custom sources, page fetch) even once the model's own `web.search` covers the basic case.

import { Plan, PlanContent, PlanDescription, PlanFooter, PlanHeader, PlanTitle } from "@brand/ai";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Text,
} from "@brand/ui";
import type {
  HubBudgets,
  HubCrew,
  HubMissionPlan,
  HubPlannedAgent,
  HubServerToolGrant,
  HubToolGrants,
} from "@mcp-token-footprint/shared";
import { AlertTriangle, Check, Globe, Server, SlidersHorizontal, Users, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { IconButton } from "../../components/IconButton";
import { RoleAvatar } from "./agents/RoleAvatar";
import {
  type MissionCrewLookup,
  type MissionRoleLookup,
  plannedAgentIcon,
} from "./lib/mission-agent-icon";
import { ToolGrantPicker } from "./agents/ToolGrantPicker";
import { plannedAgentNeedsConfiguration } from "./mission-role-placeholders";
import { clampDebateRounds, type TopoGraphInput } from "./topology-graph";
import { TopologyGraph } from "./TopologyGraph";
import { missionTextWantsWebCapability } from "../servers/researchServerPresets";

function summarizeBudgets(budgets?: HubBudgets): string {
  if (!budgets) return "no explicit budget";
  const bits: string[] = [];
  if (budgets.maxTurns) bits.push(`${budgets.maxTurns} turns`);
  if (budgets.maxTokens) bits.push(`${budgets.maxTokens.toLocaleString()} tokens`);
  if (budgets.maxToolCalls) bits.push(`${budgets.maxToolCalls} tool calls`);
  if (budgets.maxCostUsd) bits.push(`$${budgets.maxCostUsd}`);
  return bits.length > 0 ? bits.join(" · ") : "no explicit budget";
}

/** hub-fixes WP2.2 (RC2.4) — one chip label per granted server ("acme · all" / "files · 3 tools"). */
function grantServerChips(grants: HubToolGrants): { id: string; label: string }[] {
  return Object.entries(grants.servers ?? {}).map(([serverId, grant]) => ({
    id: serverId,
    label:
      grant === "all"
        ? `${serverId} · all`
        : `${serverId} · ${grant.length} tool${grant.length === 1 ? "" : "s"}`,
  }));
}

/** hub-fixes WP2.3 (D-HF5) — mirrors `apps/api/src/hub/tools/grants.ts`'s `effectiveAgentGrants` (the
 *  web can't import API source, and this fn is tiny + pure — kept in sync manually): one server's grant
 *  ∩ the parent's grant for that SAME server. */
function intersectServerGrant(planGrant: HubServerToolGrant, parentGrant: HubServerToolGrant): HubServerToolGrant {
  if (planGrant === "all" && parentGrant === "all") return "all";
  if (planGrant === "all") return parentGrant;
  if (parentGrant === "all") return planGrant;
  const parentSet = new Set(parentGrant);
  return planGrant.filter((name) => parentSet.has(name));
}

/** hub-fixes WP2.3 (D-HF5) — the plan-card's local mirror of `effectiveAgentGrants`: a server present in
 *  `planGrants` but absent from `parentScope.servers` is DROPPED; builtins intersect the same way, except
 *  an EMPTY parent builtins list means "unset" (the plan's own builtins pass through). */
function effectiveGrantsPreview(planGrants: HubToolGrants, parentScope: HubToolGrants): HubToolGrants {
  const servers: Record<string, HubServerToolGrant> = {};
  for (const [serverId, planGrant] of Object.entries(planGrants.servers ?? {})) {
    const parentGrant = parentScope.servers?.[serverId];
    if (parentGrant === undefined) continue;
    servers[serverId] = intersectServerGrant(planGrant, parentGrant);
  }
  const parentBuiltins = parentScope.builtins ?? [];
  const planBuiltins = planGrants.builtins ?? [];
  const builtins = parentBuiltins.length === 0 ? planBuiltins : planBuiltins.filter((b) => parentBuiltins.includes(b));
  return { servers, builtins };
}

/** hub-fixes WP2.3 (D-HF5) — a compact "N of M … after session scope" subtitle describing what a scoped
 *  parent narrowed away from an agent's plan grants. Literal TOOL counts when every considered server
 *  grant on both sides is an explicit allowlist (a real number is knowable); falls back to a SERVER count
 *  when either side carries an `"all"` grant (an unbounded count isn't knowable client-side without the
 *  live catalog). Returns `null` when nothing was narrowed — an unchanged agent gets no subtitle. */
function summarizeEffectiveAccess(planGrants: HubToolGrants, effective: HubToolGrants): string | null {
  const planServerIds = Object.keys(planGrants.servers ?? {});
  if (planServerIds.length === 0) return null;
  const effectiveServerIds = Object.keys(effective.servers ?? {});

  const sameServers =
    planServerIds.length === effectiveServerIds.length &&
    planServerIds.every((id) => {
      const before = planGrants.servers[id];
      const after = effective.servers[id];
      if (after === undefined || before === undefined) return false;
      if (before === "all" || after === "all") return before === after;
      return before.length === after.length && before.every((name) => after.includes(name));
    });
  const planBuiltins = planGrants.builtins ?? [];
  const effectiveBuiltins = effective.builtins ?? [];
  const sameBuiltins =
    planBuiltins.length === effectiveBuiltins.length && planBuiltins.every((b) => effectiveBuiltins.includes(b));
  if (sameServers && sameBuiltins) return null;

  const anyAll = [...planServerIds, ...effectiveServerIds].some(
    (id) => planGrants.servers[id] === "all" || effective.servers[id] === "all",
  );
  if (!anyAll) {
    const planTools = planServerIds.reduce((sum, id) => sum + (planGrants.servers[id] as string[]).length, 0);
    const effectiveTools = effectiveServerIds.reduce(
      (sum, id) => sum + (effective.servers[id] as string[]).length,
      0,
    );
    return `${effectiveTools} of ${planTools} tool${planTools === 1 ? "" : "s"} after session scope`;
  }
  return `${effectiveServerIds.length} of ${planServerIds.length} server${planServerIds.length === 1 ? "" : "s"} after session scope`;
}

function fmtUsd(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `≈ $${value.toFixed(2)}`;
}

/**
 * crew-nesting WP4.3 (D-CN2/D-CN5) — a STATIC preview of a nested crew's shape for `PlannedCrewCard`:
 * idle-state placeholder nodes from `crew.members`, mirroring `CrewEditor.tsx`'s `crewFormToTopoInput`
 * pattern (read for the shape, NOT imported — that file is WP4.1's exclusive scope). Capped at ONE
 * level: a nested crew's own `crewId` members render as a generic "Sub-crew" placeholder chip rather
 * than recursing the static preview further (full recursive drill is a RUN-time-only affordance, via
 * `MissionExpandDialog`'s `SubCrewNodePanel`).
 */
function crewPreviewTopoInput(crew: HubCrew, roleLookup?: MissionRoleLookup): TopoGraphInput {
  return {
    topology: crew.topology,
    agents: crew.members.map((member, index) => {
      if (member.crewId) {
        return {
          id: `${member.crewId}-${index}`,
          title: "Sub-crew",
          state: "idle" as const,
        };
      }
      const roleId = member.agentId;
      const role = roleId ? roleLookup?.byId.get(roleId) : undefined;
      const idSlice = roleId ? roleId.slice(0, 6) : `${index}`;
      return {
        id: `${roleId ?? "member"}-${index}`,
        title: role?.name ?? (roleId ? `(deleted role · ${idSlice})` : "(unknown role)"),
        subtitle: member.model ?? role?.defaultModel ?? "",
        state: "idle" as const,
      };
    }),
    terminal: { state: "idle" },
  };
}

export type MissionPlanCardProps = {
  missionId: string;
  plan: HubMissionPlan;
  /** The role library (id → role), for resolving each planned agent's avatar icon (`agent.roleId`).
   *  Absent ⇒ `RoleAvatar` falls back to the model provider logo / `Persona`. */
  roleLookup?: MissionRoleLookup;
  /** crew-nesting WP4.3 (D-CN5) — the saved-crew library (by id), for resolving a `crewId`-bearing
   *  planned agent's name/icon/topology in its `PlannedCrewCard`. Absent/unresolved ⇒ the card falls
   *  back to the plan's own `agent.name` and shows the crew as not-found (e.g. deleted, or the library
   *  hasn't loaded yet) rather than fabricating a shape. */
  crewLookup?: MissionCrewLookup;
  onApprove?: (missionId: string) => void;
  onEditPlan?: (missionId: string, plan: HubMissionPlan) => void;
  onCancel?: (missionId: string) => void;
  busy?: boolean;
  /** hub-fixes WP2.2 (RC2.4) — the parent session's grantable MCP server ids; the per-agent grant
   *  editor is constrained to these. Absent ⇒ the picker offers every registered server (the default,
   *  correct for an "auto" parent session). */
  catalogServerIds?: readonly string[];
  /** hub-fixes WP2.3 (D-HF5) — the parent session's own tool scope (`session.toolScope`). When present,
   *  each agent's chips get an EFFECTIVE-access subtitle (plan grants ∩ this scope). `null`/absent ⇒ an
   *  "auto"/unscoped parent — D-HF5's pass-through case — so no subtitle renders (nothing was narrowed). */
  parentScope?: HubToolGrants | null;
  /** hub-fixes WP5.2 (RC5, D-HF2) — does the parent session's reachable MCP catalog have at least one
   *  server that LOOKS research-capable (`hasResearchCapableServer`, the SAME heuristic the research-
   *  mode empty-state hint uses)? `undefined` ⇒ not yet known (the caller hasn't resolved it) — the
   *  notice stays silent rather than guessing off a false negative; `false` is the only value that can
   *  trigger it (mirrors `ConversationPane`'s own `hasResearchServer === false` convention for the SAME
   *  underlying check). */
  catalogHasResearchServer?: boolean;
  /** hub-fixes WP5.2 (RC5, D-HF2, acknowledging WP 5.1) — does the parent session already have real web
   *  access via the provider-native `web.search` built-in (explicitly granted, or the capability-derived
   *  default for an unscoped/default-builtins session on a search-capable model)? When true, the notice
   *  (still shown — an MCP research server stays the pluralistic upgrade: multi-engine, custom sources,
   *  page fetch) softens its copy to ACKNOWLEDGE the built-in instead of implying zero web access.
   *  Absent/`false` ⇒ the plain "no research capability at all" copy. */
  sessionHasWebSearch?: boolean;
};

export function MissionPlanCard({
  missionId,
  plan,
  roleLookup,
  crewLookup,
  onApprove,
  onEditPlan,
  onCancel,
  busy,
  catalogServerIds,
  parentScope,
  catalogHasResearchServer,
  sessionHasWebSearch,
}: MissionPlanCardProps) {
  const est = fmtUsd(plan.estimatedCostUsd);
  // hub-fixes WP4.4 (D-HF3) — the debate round count shown as a chip (only for a debate plan); absent ⇒
  // the runtime default (2). Clamp mirrors the API so the chip never shows an out-of-range value.
  const debateRounds = clampDebateRounds(plan.debateRounds);
  const editable = Boolean(onEditPlan);
  const canRemove = editable && plan.agents.length > 1;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // hub-fixes WP5.2 (RC5, D-HF2) — does the PLAN's own text (any agent, or the plan's own rationale)
  // read as wanting the web? One card-level notice, not per-agent (the catalog is shared).
  const missionWantsWeb =
    plan.agents.some((agent) =>
      missionTextWantsWebCapability(agent.brief, agent.target, agent.expectedOutcome, agent.rationale),
    ) || missionTextWantsWebCapability(plan.rationale);
  const showWebCapabilityNotice = missionWantsWeb && catalogHasResearchServer === false;

  const editingAgent = editingKey ? plan.agents.find((a) => a.key === editingKey) : undefined;

  const removeAgent = (key: string): void => {
    if (!onEditPlan) return;
    onEditPlan(missionId, { ...plan, agents: plan.agents.filter((a) => a.key !== key) });
  };

  const saveAgentGrants = (key: string, grants: HubToolGrants): void => {
    if (!onEditPlan) return;
    onEditPlan(missionId, {
      ...plan,
      agents: plan.agents.map((a) => (a.key === key ? { ...a, toolGrants: grants } : a)),
    });
    setEditingKey(null);
  };

  return (
    <Plan defaultOpen data-testid="mission-plan-card" className="border-border">
      <PlanHeader>
        <div className="flex items-center gap-2">
          <Users aria-hidden className="size-4 text-primary" />
          <PlanTitle>Proposed mission</PlanTitle>
          <Badge variant="secondary">
            {plan.agents.length} agent{plan.agents.length === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline">{plan.topology}</Badge>
          {plan.topology === "debate" ? (
            <Badge variant="outline" data-testid="mission-debate-rounds">
              {debateRounds} round{debateRounds === 1 ? "" : "s"}
            </Badge>
          ) : null}
          <Badge variant="outline">autonomy: {plan.autonomy}</Badge>
          {est ? <Badge variant="outline">{est}</Badge> : null}
        </div>
        {plan.rationale ? (
          <PlanDescription className="whitespace-pre-line">{plan.rationale}</PlanDescription>
        ) : (
          <PlanDescription>
            A team is proposed below. Review it, then approve to run — or adjust it first.
          </PlanDescription>
        )}
      </PlanHeader>

      <PlanContent>
        {showWebCapabilityNotice ? (
          <Alert variant="info" className="mb-3" data-testid="mission-web-capability-notice">
            <Globe aria-hidden className="size-4" />
            <AlertTitle>No research server registered</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <Text tone="muted" className="text-caption">
                {sessionHasWebSearch
                  ? "This mission mentions research. The model already answers with its own built-in web search — add an MCP research server (Tavily, Brave Search, or Exa) too, for multi-engine search, custom sources, and page fetch across every agent."
                  : "This mission mentions research, but none of your registered MCP servers look search/fetch-capable yet. Add one from the bundled recipe (Tavily, Brave Search, or Exa) — you'll paste your own API key; no key is bundled."}
              </Text>
              <Button asChild size="sm" variant="outline" className="self-start">
                <Link to="/servers">
                  <Server aria-hidden />
                  <span>Add MCP server</span>
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <ul className="flex min-w-0 flex-col gap-3">
          {plan.agents.map((agent) =>
            // crew-nesting WP4.3 (D-CN2/D-CN5) — a `crewId`-bearing slot renders as a nested crew
            // preview instead of the single-role card, interleaved in the plan's existing flat order.
            agent.crewId ? (
              <li key={agent.key} className="min-w-0">
                <PlannedCrewCard
                  agent={agent}
                  crew={crewLookup?.get(agent.crewId)}
                  {...(roleLookup ? { roleLookup } : {})}
                  {...(canRemove ? { onRemove: () => removeAgent(agent.key) } : {})}
                  busy={busy}
                />
              </li>
            ) : (
              <li key={agent.key} className="min-w-0">
                <PlannedAgentCard
                  agent={agent}
                  icon={plannedAgentIcon(roleLookup, agent)}
                  {...(canRemove ? { onRemove: () => removeAgent(agent.key) } : {})}
                  {...(editable ? { onEditGrants: () => setEditingKey(agent.key) } : {})}
                  {...(parentScope ? { parentScope } : {})}
                  busy={busy}
                />
              </li>
            ),
          )}
        </ul>
      </PlanContent>

      <PlanFooter>
        {/* Approval gates are visually neutral (P1) — Approve used to be the solid/primary button next
            to a `ghost`-variant (the WEAKEST) Cancel, so the consequential action (spends budget, runs
            agents) visually dominated the safe/reversible one at the exact moment the system should
            stay neutral. Both are `outline`, same size and weight; only the icon/label differ. */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {onCancel ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onCancel(missionId)}>
              <X aria-hidden className="size-4" />
              Cancel
            </Button>
          ) : null}
          {onApprove ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onApprove(missionId)}
            >
              <Check aria-hidden className="size-4" />
              Approve &amp; run
            </Button>
          ) : null}
        </div>
      </PlanFooter>

      {editingAgent ? (
        <AgentGrantsDialog
          agent={editingAgent}
          {...(catalogServerIds ? { catalogServerIds } : {})}
          busy={busy}
          onSave={(grants) => saveAgentGrants(editingAgent.key, grants)}
          onClose={() => setEditingKey(null)}
        />
      ) : null}
    </Plan>
  );
}

function PlannedAgentCard({
  agent,
  icon,
  onRemove,
  onEditGrants,
  parentScope,
  busy,
}: {
  agent: HubPlannedAgent;
  icon?: string;
  onRemove?: () => void;
  onEditGrants?: () => void;
  /** hub-fixes WP2.3 (D-HF5) — see `MissionPlanCardProps.parentScope`. */
  parentScope?: HubToolGrants | null;
  busy?: boolean;
}) {
  const est = fmtUsd(agent.estimatedCostUsd);
  const chips = grantServerChips(agent.toolGrants);
  const builtinCount = agent.toolGrants.builtins?.length ?? 0;
  const needsConfig = plannedAgentNeedsConfiguration(agent);
  // hub-fixes WP2.3 (D-HF5) — a scoped parent's EFFECTIVE-access subtitle (plan ∩ session scope).
  const accessNote = parentScope
    ? summarizeEffectiveAccess(agent.toolGrants, effectiveGrantsPreview(agent.toolGrants, parentScope))
    : null;
  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <RoleAvatar
            id={agent.key}
            icon={icon}
            model={agent.model}
            className="mt-0.5 size-8 shrink-0 rounded-full"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Text className="font-medium">{agent.name}</Text>
              <Badge variant="outline">{agent.model}</Badge>
              {est ? <Badge variant="outline">{est}</Badge> : null}
              {needsConfig ? (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle aria-hidden className="size-3" />
                  Not fully configured
                </Badge>
              ) : null}
            </div>
            <Text tone="muted" className="text-caption min-w-0">
              {agent.target}
            </Text>
          </div>
        </div>
        {onRemove ? (
          <IconButton variant="ghost" size="sm" disabled={busy} onClick={onRemove} label={`Remove ${agent.name}`}>
            <X aria-hidden className="size-4" />
          </IconButton>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <Text tone="muted" className="text-caption font-medium">
            Brief
          </Text>
          <Text className="text-caption min-w-0">{agent.brief}</Text>
        </div>
        {agent.rationale ? (
          <div className="flex flex-col gap-1">
            <Text tone="muted" className="text-caption font-medium">
              Why this agent
            </Text>
            <Text tone="muted" className="text-caption min-w-0">
              {agent.rationale}
            </Text>
          </div>
        ) : null}
        {needsConfig ? (
          <Text tone="muted" className="text-caption" role="alert">
            This role still has placeholder instructions — finish its profile before running the
            mission.
          </Text>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Text tone="muted" className="text-caption">
                Access:
              </Text>
              {chips.length === 0 && builtinCount === 0 ? (
                <Text tone="muted" className="text-caption">
                  reasoning only
                </Text>
              ) : (
                <>
                  {chips.map((chip) => (
                    <Badge key={chip.id} variant="secondary" className="font-normal">
                      {chip.label}
                    </Badge>
                  ))}
                  {builtinCount > 0 ? (
                    <Badge variant="outline" className="font-normal">
                      {builtinCount} built-in{builtinCount === 1 ? "" : "s"}
                    </Badge>
                  ) : null}
                </>
              )}
              {onEditGrants ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  disabled={busy}
                  onClick={onEditGrants}
                  aria-label={`Edit access for ${agent.name}`}
                >
                  <SlidersHorizontal aria-hidden className="size-3.5" />
                  Edit access
                </Button>
              ) : null}
            </div>
            {accessNote ? (
              <Text tone="muted" className="text-caption" data-testid={`agent-effective-access-${agent.key}`}>
                {accessNote}
              </Text>
            ) : null}
          </div>
          <Text tone="muted" className="text-caption">
            Budget: {summarizeBudgets(agent.budgets)}
          </Text>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * crew-nesting WP4.3 (D-CN2/D-CN5) — the pre-run preview for a `crewId`-bearing plan row: the resolved
 * crew's name/icon, a nested `TopologyGraph variant="plain"` shape preview, its member count, and the
 * SAME `agent.budgets` every slot already carries (a crew-ref slot's allocated budget, no new field).
 * The "Edit access" grant editor is deliberately NOT offered here — nested-grant editing isn't designed
 * yet (out of this WP's scope); `onRemove` (dropping the whole slot from the plan) still applies, same
 * as an ordinary agent row.
 */
function PlannedCrewCard({
  agent,
  crew,
  roleLookup,
  onRemove,
  busy,
}: {
  agent: HubPlannedAgent;
  /** The resolved saved crew (`crewLookup.get(agent.crewId)`). Absent ⇒ the crew couldn't be resolved
   *  (deleted, or the library hasn't loaded yet) — the card shows a not-found notice instead of a
   *  fabricated preview. */
  crew?: HubCrew;
  roleLookup?: MissionRoleLookup;
  onRemove?: () => void;
  busy?: boolean;
}) {
  const est = fmtUsd(agent.estimatedCostUsd);
  const name = crew?.name ?? agent.name;
  const memberCount = crew?.members.length ?? 0;
  return (
    <Card className="border-border">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <RoleAvatar id={agent.key} icon={crew?.icon} className="mt-0.5 size-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Text className="font-medium">{name}</Text>
              <Badge variant="secondary" className="gap-1">
                <Users aria-hidden className="size-3" />
                {memberCount} member{memberCount === 1 ? "" : "s"}
              </Badge>
              {est ? <Badge variant="outline">{est}</Badge> : null}
            </div>
            <Text tone="muted" className="text-caption min-w-0">
              {agent.target}
            </Text>
          </div>
        </div>
        {onRemove ? (
          <IconButton variant="ghost" size="sm" disabled={busy} onClick={onRemove} label={`Remove ${name}`}>
            <X aria-hidden className="size-4" />
          </IconButton>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Text tone="muted" className="text-caption font-medium">
            Brief
          </Text>
          <Text className="text-caption min-w-0">{agent.brief}</Text>
        </div>
        {crew ? (
          <TopologyGraph
            input={crewPreviewTopoInput(crew, roleLookup)}
            variant="plain"
            ariaLabel={`${name} topology preview`}
            className="h-40"
          />
        ) : (
          <Text tone="muted" className="text-caption" role="alert">
            This saved crew could not be found — it may have been deleted.
          </Text>
        )}
        <Text tone="muted" className="text-caption">
          Budget: {summarizeBudgets(agent.budgets)}
        </Text>
      </CardContent>
    </Card>
  );
}

/** hub-fixes WP2.2 (RC2.4) — the per-agent grant editor: `ToolGrantPicker` constrained to the parent's
 *  grantable catalog, seeded from the agent's current grants, persisted through the plan PATCH on Save. */
function AgentGrantsDialog({
  agent,
  catalogServerIds,
  busy,
  onSave,
  onClose,
}: {
  agent: HubPlannedAgent;
  catalogServerIds?: readonly string[];
  busy?: boolean;
  onSave: (grants: HubToolGrants) => void;
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<HubToolGrants>({
    servers: { ...agent.toolGrants.servers },
    builtins: [...(agent.toolGrants.builtins ?? [])],
  });

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <DialogHeader className="flex-none gap-1 border-b border-border p-4 pe-12">
          <DialogTitle>Edit access — {agent.name}</DialogTitle>
          <DialogDescription>
            Grant only the MCP servers and tools this role needs. Grants are limited to the servers
            reachable from this session.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <ToolGrantPicker
            idPrefix={`mission-agent-grants-${agent.key}`}
            value={grants}
            onChange={setGrants}
            disabled={busy}
            {...(catalogServerIds ? { allowedServerIds: catalogServerIds } : {})}
          />
        </div>

        <DialogFooter className="flex-none border-t border-border p-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(grants)} disabled={busy}>
            Save access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
