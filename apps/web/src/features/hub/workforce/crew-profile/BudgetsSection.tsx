import type { HubAgentRole, HubCrewMember } from "@mcp-token-footprint/shared";
import { EmptyState, Label, Switch, Text } from "@elabs-ai/components-ui";
import { DialogSection } from "../../../../components/dialogs";
import { BudgetsFields, budgetsFromWire, budgetsToWire } from "../../agents/BudgetsFields";
import { RoleAvatar } from "../../agents/RoleAvatar";

/**
 * Assistant Hub UX WP2.4 (D-HUX6) — the crew profile modal's Budgets section: per-member hard-cap
 * overrides, pulled OUT of the Members accordion into their own rail entry (D-HUX6 lists Budgets as a
 * sibling of Members, not nested inside it). Same data + same `BudgetsFields` control `CrewEditor.tsx`
 * already used per member — just surfaced at the top level instead of buried in an accordion, so
 * "what will this crew cost" is answerable without opening every member's overrides one at a time.
 * There is no crew-LEVEL budgets field on the wire (`HubCrew` carries none) — this is deliberately the
 * per-member rollup, not a new field.
 */
export function BudgetsSection({
  members,
  roles,
  onChange,
  disabled,
}: {
  members: HubCrewMember[];
  roles: HubAgentRole[];
  onChange: (members: HubCrewMember[]) => void;
  disabled?: boolean;
}) {
  const roleById = new Map(roles.map((role) => [role.id, role]));

  const patchMember = (index: number, budgets: HubCrewMember["budgets"]): void => {
    onChange(members.map((member, i) => (i === index ? { ...member, budgets } : member)));
  };

  return (
    <DialogSection
      title="Budgets"
      description="Per-member hard caps that override the role's own budget — enforced server-side regardless of the autonomy dial."
    >
      {members.length === 0 ? (
        <EmptyState
          title="No members yet"
          description="Add members in the Members section first — budgets override each member's own role."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {members.map((member, index) => {
            // Crew nesting (WP0.1 / D-CN5) — `agentId` is optional; skip a nested-crew member (no
            // `agentId`), leaving agent-member behavior identical to before.
            const roleId = member.agentId;
            if (!roleId) return null;
            const role = roleById.get(roleId);
            const overrideOn = member.budgets !== undefined;
            const budgetsValue = budgetsFromWire(member.budgets);
            const switchId = `crew-profile-budgets-${index}-override`;
            return (
              <div
                key={`${roleId}-${index}`}
                className="flex flex-col gap-3 rounded-md border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <RoleAvatar
                      id={roleId}
                      icon={role?.icon}
                      model={member.model ?? role?.defaultModel}
                      className="size-6 shrink-0"
                    />
                    <span className="min-w-0 truncate">{role?.name ?? `(deleted role · ${roleId.slice(0, 6)})`}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Label htmlFor={switchId}>Override budgets</Label>
                    <Switch
                      id={switchId}
                      checked={overrideOn}
                      disabled={disabled}
                      onCheckedChange={(on) =>
                        patchMember(index, on ? (member.budgets ?? role?.budgets ?? {}) : undefined)
                      }
                    />
                  </div>
                </div>
                {overrideOn ? (
                  <BudgetsFields
                    idPrefix={`crew-profile-budgets-${index}`}
                    value={budgetsValue}
                    onChange={(next) => patchMember(index, budgetsToWire(next))}
                    disabled={disabled}
                  />
                ) : (
                  <Text variant="caption" tone="muted">
                    {role?.budgets
                      ? "Inheriting the role's own budget limits."
                      : "Inheriting the role's budgets (none set — unlimited)."}
                  </Text>
                )}
              </div>
            );
          })}
        </div>
      )}
    </DialogSection>
  );
}
