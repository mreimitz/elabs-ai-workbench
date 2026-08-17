import type { HubAgentRole, HubCrew, HubCrewMember, HubToolGrants } from "@mcp-token-footprint/shared";
import { HUB_MISSION_MAX_DEPTH } from "@mcp-token-footprint/shared";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  EmptyState,
  Label,
  Spinner,
  Switch,
  Text,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@elabs-ai/components-ui";
import { ChevronDown, ChevronUp, ExternalLink, Network, UserPlus, UserRound, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DialogSection } from "../../../../components/dialogs";
import { FieldRow } from "../../../../components/FieldRow";
import { IconButton } from "../../../../components/IconButton";
import { SelectField } from "../../../../components/SelectField";
import { BudgetsFields, budgetsFromWire, budgetsToWire } from "../../agents/BudgetsFields";
import { HubModelPicker } from "../../HubModelPicker";
import { findHubModelOption, useHubModelRoster } from "../../use-hub-models";
import { RoleAvatar } from "../../agents/RoleAvatar";
import { SkillPicker } from "../../agents/SkillPicker";
import { ToolGrantPicker } from "../../agents/ToolGrantPicker";
import { evaluateCrewNesting, memberKind, moveMember } from "./crew-profile-form";

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

type AddKind = "role" | "crew";

/**
 * Assistant Hub UX WP2.4 (D-HUX6) — the crew profile modal's Members section: add / remove / REORDER
 * (new — the old `CrewEditor` had no reorder affordance, but `pipeline`/`debate` topologies read
 * member ORDER as the chain/turn sequence, D-HUX9) from the agent pool, plus every per-member override
 * `CrewEditor.tsx`'s accordion already had (model, system prompt, target, expected outcome, tool
 * grants, skills) — "Keep: every existing role and crew field" (the workstream's own delta list).
 * Budget overrides move to their own top-level `BudgetsSection` (D-HUX6 gives Budgets its own rail
 * entry); everything else stays here.
 */
export function MembersSection({
  members,
  roles,
  rolesLoading,
  crews,
  crewsLoading,
  crewId,
  onChange,
  error,
  disabled,
}: {
  members: HubCrewMember[];
  roles: HubAgentRole[];
  rolesLoading: boolean;
  /** Crew nesting (WP4.1, D-CN8) — the full saved-crew set, for the sub-crew add path + the
   *  cycle/depth-filtered picker. */
  crews: HubCrew[];
  crewsLoading: boolean;
  /** The crew being edited (the "host") — excluded from the sub-crew picker (no self-nesting) and
   *  the nesting cycle/depth check's anchor. */
  crewId: string;
  onChange: (members: HubCrewMember[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  // D-MI7 (WP 4.1) — one roster fetch for the whole section; each member's override picker reads it.
  const modelRoster = useHubModelRoster();
  const [addKind, setAddKind] = useState<AddKind>("role");
  const [addRoleId, setAddRoleId] = useState("");
  const [addCrewId, setAddCrewId] = useState("");
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const availableRoles = roles.filter(
    (role) => !role.archivedAt && !members.some((m) => m.agentId === role.id),
  );
  const availableCrews = crews.filter((candidate) => {
    if (candidate.id === crewId) return false; // no self-nesting
    if (members.some((m) => m.crewId === candidate.id)) return false; // already a member
    const { cycle, overDepth } = evaluateCrewNesting(
      crews,
      crewId,
      candidate.id,
      HUB_MISSION_MAX_DEPTH,
    );
    return !cycle && !overDepth;
  });

  const addMember = (): void => {
    if (!addRoleId) return;
    onChange([...members, { agentId: addRoleId }]);
    setAddRoleId("");
  };

  const addCrewMember = (): void => {
    if (!addCrewId) return;
    onChange([...members, { crewId: addCrewId }]);
    setAddCrewId("");
  };

  const removeMember = (index: number): void => {
    onChange(members.filter((_, i) => i !== index));
  };

  const move = (index: number, direction: -1 | 1): void => {
    onChange(moveMember(members, index, direction));
  };

  const patchMember = (index: number, patch: Partial<HubCrewMember>): void => {
    onChange(members.map((member, i) => (i === index ? { ...member, ...patch } : member)));
  };

  return (
    <DialogSection
      title="Members"
      description="Add roles from the library, in the order they should work — order drives pipeline/debate turn sequence."
    >
      {error ? (
        <Text variant="meta" className="text-destructive" role="alert">
          {error}
        </Text>
      ) : null}

      <div className="flex flex-col gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Add member kind"
          value={addKind}
          onValueChange={(value) => value && setAddKind(value as AddKind)}
          className="self-start"
        >
          <ToggleGroupItem value="role">
            <UserRound aria-hidden className="size-4" />
            <span>Role</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="crew">
            <Network aria-hidden className="size-4" />
            <span>Sub-crew</span>
          </ToggleGroupItem>
        </ToggleGroup>

        {addKind === "role" ? (
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <SelectField
                id="crew-profile-add-member"
                label="Add a role from the library"
                value={addRoleId}
                onChange={setAddRoleId}
                options={availableRoles.map((role) => ({ value: role.id, label: role.name }))}
                placeholder={
                  rolesLoading
                    ? "Loading roles…"
                    : availableRoles.length === 0
                      ? "No more roles to add"
                      : "Choose a role…"
                }
                disabled={disabled || rolesLoading || availableRoles.length === 0}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addMember}
              disabled={disabled || !addRoleId}
            >
              <UserPlus aria-hidden className="size-4" />
              <span>Add</span>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <SelectField
                  id="crew-profile-add-subcrew"
                  label="Add a sub-crew"
                  value={addCrewId}
                  onChange={setAddCrewId}
                  options={availableCrews.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder={
                    crewsLoading
                      ? "Loading crews…"
                      : availableCrews.length === 0
                        ? "No nestable crews available"
                        : "Choose a crew…"
                  }
                  disabled={disabled || crewsLoading || availableCrews.length === 0}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={addCrewMember}
                disabled={disabled || !addCrewId}
              >
                <UserPlus aria-hidden className="size-4" />
                <span>Add</span>
              </Button>
            </div>
            {availableCrews.length < crews.length ? (
              <Text variant="caption" tone="muted">
                Some crews aren’t offered here — nesting itself, already a member, forming a cycle,
                or exceeding the max crew depth ({HUB_MISSION_MAX_DEPTH}).
              </Text>
            ) : null}
          </div>
        )}
      </div>

      {rolesLoading ? (
        <div className="flex items-center gap-2 text-body text-muted-foreground">
          <Spinner className="size-4" aria-hidden />
          <span>Loading the role library…</span>
        </div>
      ) : members.length === 0 && roles.length === 0 ? (
        <EmptyState
          title="No roles in the library yet"
          description="Create a role first — a crew is a named team of library roles."
        />
      ) : members.length === 0 ? (
        <EmptyState
          title="No members yet"
          description="Add at least one role or sub-crew above to build this crew."
        />
      ) : (
        // Crew nesting (WP4.1) — an existing member list (which may be ENTIRELY sub-crews) is
        // always shown once non-empty, even when the role library itself is empty; `roles.length
        // === 0` used to imply `members.length === 0` too (a role was the only way to add a
        // member), but that invariant no longer holds now that a `crewId` member needs no role.
        <Accordion type="multiple" className="rounded-md border border-border px-2">
          {members.map((member, index) => {
            // Crew nesting (WP0.1/WP4.1, D-CN5) — a member is EXACTLY one of a role (`agentId`) or a
            // nested saved crew (`crewId`); `memberKind` is the single source of truth for which.
            const kind = memberKind(member);
            const roleId = member.agentId;
            const role = roleId ? roleById.get(roleId) : undefined;
            const subCrewId = member.crewId;
            const subCrew = subCrewId ? crewById.get(subCrewId) : undefined;
            const displayName =
              kind === "crew" ? (subCrew?.name ?? "this sub-crew") : (role?.name ?? "this member");
            const itemKey = `${member.agentId ?? member.crewId}-${index}`;
            return (
              <AccordionItem key={itemKey} value={itemKey} className="last:border-b-0">
                {/* The move/remove buttons are SIBLINGS of `AccordionTrigger`, not children — the
                    library's trigger always renders a real button element (see its source), and a
                    button nested inside another button is invalid HTML (a real React hydration
                    warning, not just a lint nit). This flex row keeps the same visual result:
                    trigger content + chevron on the left, actions on the right. */}
                <div className="flex items-center gap-0.5 pe-1">
                  <AccordionTrigger className="gap-2 hover:no-underline">
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      {kind === "crew" ? (
                        <>
                          <RoleAvatar id={subCrewId ?? ""} icon={subCrew?.icon} className="size-6" />
                          <span className="min-w-0 truncate font-medium">
                            {subCrew?.name ?? `(missing crew · ${(subCrewId ?? "").slice(0, 6)})`}
                          </span>
                          <Badge variant="secondary" className="shrink-0">
                            Sub-crew
                          </Badge>
                        </>
                      ) : (
                        <>
                          <RoleAvatar
                            id={roleId ?? ""}
                            icon={role?.icon}
                            model={member.model ?? role?.defaultModel}
                            className="size-6"
                          />
                          <span className="min-w-0 truncate font-medium">
                            {role?.name ?? `(deleted role · ${(roleId ?? "").slice(0, 6)})`}
                          </span>
                          {member.model ? (
                            <Badge variant="secondary" className="shrink-0">
                              {member.model}
                            </Badge>
                          ) : null}
                        </>
                      )}
                    </span>
                  </AccordionTrigger>
                  <span className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      label={`Move ${displayName} up`}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUp aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      label={`Move ${displayName} down`}
                      disabled={disabled || index === members.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      label={`Remove ${displayName}`}
                      disabled={disabled}
                      onClick={() => removeMember(index)}
                    >
                      <X aria-hidden className="size-4" />
                    </IconButton>
                  </span>
                </div>
                <AccordionContent className="flex flex-col gap-3">
                  {kind === "crew" ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => navigate(`/assistant/agents/crew/${subCrewId}`)}
                      >
                        <ExternalLink aria-hidden className="size-4" />
                        <span>Open sub-crew</span>
                      </Button>

                      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor={`crew-profile-member-${index}-subcrew-budgets-override`}
                            className="font-medium"
                          >
                            Override budgets
                          </Label>
                          <Switch
                            id={`crew-profile-member-${index}-subcrew-budgets-override`}
                            checked={member.budgets !== undefined}
                            disabled={disabled}
                            onCheckedChange={(on) =>
                              patchMember(index, { budgets: on ? (member.budgets ?? {}) : undefined })
                            }
                          />
                        </div>
                        {member.budgets !== undefined ? (
                          <BudgetsFields
                            idPrefix={`crew-profile-member-${index}-subcrew-budgets`}
                            value={budgetsFromWire(member.budgets)}
                            onChange={(next) => patchMember(index, { budgets: budgetsToWire(next) })}
                            disabled={disabled}
                          />
                        ) : (
                          <Text variant="caption" tone="muted">
                            Inheriting the sub-crew's own member budgets.
                          </Text>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <FieldRow id={`crew-profile-member-${index}-model`} label="Model override">
                        {/* D-MI7 (WP 4.1) — a bare free-text field before: it offered no roster at
                            all, so an operator had to know a model id by heart, and it could not
                            express WHICH credential (`HubCrewMember.providerCredentialId`, added in
                            WP 1.1, was unreachable from the UI). */}
                        <HubModelPicker
                          id={`crew-profile-member-${index}-model`}
                          name="Model override"
                          models={modelRoster.models}
                          loading={modelRoster.loading}
                          unavailable={modelRoster.unavailable}
                          disabled={disabled}
                          placeholder={
                            role?.defaultModel
                              ? `Role default — ${role.defaultModel}`
                              : "Use the role's default model"
                          }
                          dialogTitle="Choose this member's model override"
                          value={
                            findHubModelOption(
                              modelRoster.models,
                              member.model,
                              member.providerCredentialId,
                            ) ?? null
                          }
                          fallbackModelId={member.model ?? null}
                          clearOption={{
                            label: "Use the role's default model",
                            ...(role?.defaultModel ? { hint: role.defaultModel } : {}),
                            onClear: () =>
                              patchMember(index, {
                                model: undefined,
                                providerCredentialId: undefined,
                              }),
                          }}
                          onChange={(option) =>
                            patchMember(index, {
                              model: option.modelId,
                              providerCredentialId: option.credentialId,
                            })
                          }
                        />
                      </FieldRow>
                      <FieldRow
                        id={`crew-profile-member-${index}-system-prompt`}
                        label="System prompt override"
                      >
                        <Textarea
                          id={`crew-profile-member-${index}-system-prompt`}
                          value={member.systemPromptOverride ?? ""}
                          onChange={(event) =>
                            patchMember(index, {
                              systemPromptOverride: event.target.value || undefined,
                            })
                          }
                          placeholder={
                            role?.systemPrompt
                              ? "Leave blank to use the role's system prompt"
                              : "Use the role's system prompt"
                          }
                          rows={3}
                          spellCheck={false}
                          disabled={disabled}
                        />
                      </FieldRow>
                      <FieldRow id={`crew-profile-member-${index}-target`} label="Target override">
                        <Textarea
                          id={`crew-profile-member-${index}-target`}
                          value={member.target ?? ""}
                          onChange={(event) =>
                            patchMember(index, { target: event.target.value || undefined })
                          }
                          placeholder={role?.target ?? "Use the role's default target"}
                          rows={2}
                          disabled={disabled}
                        />
                      </FieldRow>
                      <FieldRow
                        id={`crew-profile-member-${index}-expected-outcome`}
                        label="Expected outcome override"
                      >
                        <Textarea
                          id={`crew-profile-member-${index}-expected-outcome`}
                          value={member.expectedOutcome ?? ""}
                          onChange={(event) =>
                            patchMember(index, { expectedOutcome: event.target.value || undefined })
                          }
                          placeholder={
                            role?.expectedOutcome ?? "Use the role's default expected outcome"
                          }
                          rows={2}
                          disabled={disabled}
                        />
                      </FieldRow>

                      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor={`crew-profile-member-${index}-tools-override`}
                            className="font-medium"
                          >
                            Override tool grants
                          </Label>
                          <Switch
                            id={`crew-profile-member-${index}-tools-override`}
                            checked={member.toolGrants !== undefined}
                            disabled={disabled}
                            onCheckedChange={(on) =>
                              patchMember(index, {
                                toolGrants: on
                                  ? (member.toolGrants ?? role?.toolGrants ?? EMPTY_GRANTS)
                                  : undefined,
                              })
                            }
                          />
                        </div>
                        {member.toolGrants !== undefined ? (
                          <ToolGrantPicker
                            idPrefix={`crew-profile-member-${index}-tools`}
                            value={member.toolGrants}
                            onChange={(next) => patchMember(index, { toolGrants: next })}
                            disabled={disabled}
                          />
                        ) : (
                          <Text variant="caption" tone="muted">
                            Inheriting the role's tool grants.
                          </Text>
                        )}
                      </div>

                      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor={`crew-profile-member-${index}-skills-override`}
                            className="font-medium"
                          >
                            Override skills
                          </Label>
                          <Switch
                            id={`crew-profile-member-${index}-skills-override`}
                            checked={member.skillIds !== undefined}
                            disabled={disabled}
                            onCheckedChange={(on) =>
                              patchMember(index, {
                                skillIds: on
                                  ? (member.skillIds ?? role?.skills.map((skill) => skill.skillId) ?? [])
                                  : undefined,
                              })
                            }
                          />
                        </div>
                        {member.skillIds !== undefined ? (
                          <SkillPicker
                            idPrefix={`crew-profile-member-${index}-skills`}
                            value={member.skillIds}
                            onChange={(next) => patchMember(index, { skillIds: next })}
                            disabled={disabled}
                          />
                        ) : (
                          <Text variant="caption" tone="muted">
                            Inheriting the role's skills.
                          </Text>
                        )}
                      </div>
                    </>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </DialogSection>
  );
}
