import { useEffect, useState } from "react";
import type { HubAgentRole, HubCrew, HubSessionRoster } from "@mcp-token-footprint/shared";
import { Badge, Checkbox, Label, Spinner, Text } from "@elabs-ai/components-ui";
import { SearchInput } from "@elabs-ai/components-data";
import { listHubAgentRoles, listHubCrews } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";

/**
 * Assistant Hub (end-user UX pass) — a compact multi-select over the saved Agents & Crews library
 * (`GET /api/hub/agents` + `/api/hub/crews`, the same lists the Agents & Crews view renders) that
 * records a {@link HubSessionRoster} (`{ crewIds, agentIds }`). The roster is a PREFERRED POOL fed to
 * the mission planner (it prefers + faithfully reuses these saved roles, and may still expand) — it has
 * no effect in a plain Chat/Research session, only when a mission is planned.
 */
export function AgentCrewPicker({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: HubSessionRoster;
  onChange: (next: HubSessionRoster) => void;
  disabled?: boolean;
}) {
  const [agents, setAgents] = useState<HubAgentRole[]>([]);
  const [crews, setCrews] = useState<HubCrew[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [roles, crewList] = await Promise.all([listHubAgentRoles(), listHubCrews()]);
        if (!cancelled) {
          setAgents(roles);
          setCrews(crewList);
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleAgent = (agentId: string, checked: boolean): void => {
    onChange({
      crewIds: value.crewIds,
      agentIds: checked
        ? [...new Set([...value.agentIds, agentId])]
        : value.agentIds.filter((id) => id !== agentId),
    });
  };
  const toggleCrew = (crewId: string, checked: boolean): void => {
    onChange({
      agentIds: value.agentIds,
      crewIds: checked
        ? [...new Set([...value.crewIds, crewId])]
        : value.crewIds.filter((id) => id !== crewId),
    });
  };

  const needle = query.trim().toLowerCase();
  const filteredAgents = agents.filter((agent) =>
    `${agent.displayName ?? ""} ${agent.name}`.toLowerCase().includes(needle),
  );
  const filteredCrews = crews.filter((crew) => crew.name.toLowerCase().includes(needle));

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-body text-muted-foreground">
        <Spinner className="size-4" aria-hidden />
        <span>Loading agents &amp; crews…</span>
      </div>
    );
  }

  if (error) {
    return (
      <Text variant="meta" className="text-destructive" role="alert">
        Couldn’t load agents &amp; crews: {error}
      </Text>
    );
  }

  if (agents.length === 0 && crews.length === 0) {
    return (
      <Text variant="caption" tone="muted">
        No agents or crews are saved yet. Create one from the Agents &amp; Crews view to scope it in
        here.
      </Text>
    );
  }

  const selectedCount = value.agentIds.length + value.crewIds.length;

  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        value={query}
        onValueChange={setQuery}
        label="Filter agents & crews"
        placeholder="Filter agents & crews…"
      />
      <div className="flex max-h-56 flex-col gap-3 overflow-y-auto rounded-md border border-border p-2">
        {filteredAgents.length === 0 && filteredCrews.length === 0 ? (
          <Text variant="caption" tone="muted" className="p-1">
            No agents or crews match “{query}”.
          </Text>
        ) : null}

        {filteredCrews.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Text variant="caption" tone="muted" className="px-1.5 font-medium">
              Crews
            </Text>
            {filteredCrews.map((crew) => {
              const fieldId = `${idPrefix}-crew-${crew.id}`;
              const checked = value.crewIds.includes(crew.id);
              return (
                <Label
                  key={crew.id}
                  htmlFor={fieldId}
                  className="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 font-normal hover:bg-muted"
                >
                  <Checkbox
                    id={fieldId}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(next) => toggleCrew(crew.id, next === true)}
                  />
                  <span className="min-w-0 truncate">{crew.name}</span>
                  <Badge variant="secondary" className="ml-auto tabular-nums">
                    {crew.members.length}
                  </Badge>
                </Label>
              );
            })}
          </div>
        ) : null}

        {filteredAgents.length > 0 ? (
          <div className="flex flex-col gap-1">
            <Text variant="caption" tone="muted" className="px-1.5 font-medium">
              Agents
            </Text>
            {filteredAgents.map((agent) => {
              const fieldId = `${idPrefix}-agent-${agent.id}`;
              const checked = value.agentIds.includes(agent.id);
              return (
                <Label
                  key={agent.id}
                  htmlFor={fieldId}
                  className="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 font-normal hover:bg-muted"
                >
                  <Checkbox
                    id={fieldId}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(next) => toggleAgent(agent.id, next === true)}
                  />
                  <span className="min-w-0 truncate">{agent.displayName ?? agent.name}</span>
                </Label>
              );
            })}
          </div>
        ) : null}
      </div>
      {selectedCount > 0 ? (
        <Text variant="caption" tone="muted" className="tabular-nums">
          {value.crewIds.length} crew{value.crewIds.length === 1 ? "" : "s"} · {value.agentIds.length}{" "}
          agent{value.agentIds.length === 1 ? "" : "s"} scoped in
        </Text>
      ) : null}
    </div>
  );
}
