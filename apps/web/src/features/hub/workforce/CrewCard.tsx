import { useMemo } from "react";
import type { HubAgentRole, HubCrew } from "@mcp-token-footprint/shared";
import { Sparkline } from "@brand/charts";
import { Badge, Skeleton, Text, cn } from "@brand/ui";
import { Users } from "lucide-react";
import { getHubUsageSummary } from "../../../lib/api";
import { loadableData, useLoadable } from "../../../lib/loadable";
import { RoleAvatar } from "../agents/RoleAvatar";
import { formatCrewMembershipCount, resolveCrewClosure } from "./crew-membership";
import { crewAccentClasses } from "../lib/hub-ux";

const TOPOLOGY_LABELS: Record<HubCrew["topology"], string> = {
  parallel: "Parallel",
  pipeline: "Pipeline",
  debate: "Debate",
  best_of_n: "Best of N",
};

/**
 * Assistant Hub UX WP2.2 — a crew's compact identity tile: color dot + name (D-HUX8's "always paired
 * with the name" rule), description, a small member-avatar row, its topology, and its own 30-day
 * usage strip. Purely presentational (no select/open interaction of its own) — {@link CrewHeaderCard}
 * composes this as the top of the crew scope's header, and it stays exported/standalone so a future
 * "browse crews" surface can reuse the exact same identity treatment without duplicating it.
 *
 * Crew nesting (WP4.2 / D-CN8) — `crews` (the FULL crew library) is needed to resolve a `crewId`
 * member's name and to compute the crew's RECURSIVE membership count. The avatar strip stays
 * deliberately agent-only/direct (a sub-crew member is surfaced as its own name-chip row below, never
 * blended into the avatar strip — a crew is not an agent, and pretending otherwise there would be
 * misleading); the count badge, however, is honest about the whole subtree.
 */
export function CrewCard(props: {
  crew: HubCrew;
  roles: HubAgentRole[];
  crews: HubCrew[];
  className?: string;
}) {
  const { crew, roles, crews } = props;
  const accent = crewAccentClasses(crew.color);
  const members = crew.members
    .map((member) => (member.agentId ? roles.find((role) => role.id === member.agentId) : undefined))
    .filter((role): role is HubAgentRole => role != null);

  const crewsById = useMemo(() => new Map(crews.map((c) => [c.id, c])), [crews]);
  const closure = useMemo(() => resolveCrewClosure(crew.id, crewsById), [crew.id, crewsById]);
  // Direct sub-crew members only (by NAME chip, below) — distinct from the recursive closure the
  // count badge reads, so "this crew's own declared sub-crews" stays visible even though the count
  // already folds their agents in.
  const directSubCrews = crew.members
    .map((member) => (member.crewId ? crewsById.get(member.crewId) : undefined))
    .filter((sub): sub is HubCrew => sub != null);

  const { state } = useLoadable(
    () => getHubUsageSummary({ groupBy: "crew", id: crew.id, days: 30 }),
    [crew.id],
  );
  const usage = loadableData(state);

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", props.className)}>
      <div className="flex min-w-0 items-center gap-2">
        <RoleAvatar
          id={crew.id}
          icon={crew.icon}
          className={cn(
            "size-7 shrink-0 rounded-full",
            crew.color && cn("ring-2 ring-offset-1 ring-offset-card", accent.ring),
          )}
        />
        <Text className="min-w-0 truncate font-medium" title={crew.name}>
          {crew.name}
        </Text>
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {formatCrewMembershipCount(closure)}
        </Badge>
        <Badge variant="outline" className="shrink-0">
          {TOPOLOGY_LABELS[crew.topology]}
        </Badge>
      </div>

      {crew.description ? (
        // D-IC10 (interface-craft WP 2.1) — the 2-line clamp hides the text that distinguishes
        // similar crews; carry the full description as a `title` so it's recoverable on hover
        // (mirrors AgentCard.tsx's identical D-10 fix for the agent description).
        <Text
          variant="caption"
          tone="muted"
          className="line-clamp-2 min-w-0"
          title={crew.description}
        >
          {crew.description}
        </Text>
      ) : null}

      {members.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Members">
          {members.slice(0, 6).map((role) => (
            <span key={role.id} title={role.displayName ?? role.name}>
              <RoleAvatar
                id={role.id}
                icon={role.icon}
                model={role.defaultModel}
                className="size-6 shrink-0 rounded-full"
              />
            </span>
          ))}
          {members.length > 6 ? (
            <Text variant="meta" tone="muted">
              +{members.length - 6}
            </Text>
          ) : null}
        </div>
      ) : directSubCrews.length === 0 ? (
        <Text variant="meta" tone="muted">
          <Users aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />
          No members yet
        </Text>
      ) : null}

      {/* Crew nesting (WP4.2 / D-CN8) — the crew's DIRECT sub-crew members, by name. The avatar strip
          above stays agent-only/direct (a sub-crew is not an agent); this makes the nesting relationship
          visible without blending a crew's identity into it. */}
      {directSubCrews.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Nested crews">
          {directSubCrews.map((sub) => (
            <Badge key={sub.id} variant="outline" className="min-w-0 max-w-full gap-1">
              <span className="truncate">+ {sub.name} sub-crew</span>
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex min-w-0 items-center justify-between gap-2">
        {state.status === "loading" ? (
          <Skeleton className="h-5 w-24" />
        ) : usage ? (
          <>
            <Sparkline
              values={usage.strip.map((day) => day.costUsd)}
              variant="bar"
              width={64}
              height={20}
              label={`Spend trend, last ${usage.strip.length} days`}
            />
            <Text variant="meta" tone="muted" className="shrink-0 tabular-nums">
              {usage.totals.sessions} run{usage.totals.sessions === 1 ? "" : "s"} · $
              {usage.totals.costUsd.toFixed(2)} · 30d
            </Text>
          </>
        ) : (
          <Text variant="meta" tone="muted">
            Usage unavailable
          </Text>
        )}
      </div>
    </div>
  );
}
