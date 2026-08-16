import type { HubAgentRole, HubAgentRolePatch, HubToolGrants } from "@mcp-token-footprint/shared";
import { HUB_AGENT_NAME_MAX_LENGTH } from "@mcp-token-footprint/shared";
import {
  type BudgetsFormValue,
  budgetsFromWire,
  budgetsToWire,
} from "../../agents/BudgetsFields";

/**
 * Assistant Hub UX WP2.3 (D-HUX6/D-HUX8) — the agent-profile modal's form model, kept PURE and
 * framework-free so its validation + section routing is unit-testable without rendering the dialog.
 *
 * This mirrors `RoleEditor`'s `RoleFormValue`/`validate`/save mapping (the single-page editor the
 * old Roles library used) but SPLIT across the eight D-HUX6 sections and extended with the D-HUX8
 * `displayName` (persona name, role title as fallback) — the field the old editor never surfaced.
 * The internals it reuses (`BudgetsFields`, `SkillPicker`, `RoleAvatar`) stay in `../../agents/` and
 * are imported in place: moving them would break their non-owned importers (`CrewEditor`,
 * `ProjectEditor`), which this WP must not touch.
 */

const EMPTY_GRANTS: HubToolGrants = { servers: {}, builtins: [] };

export type AgentProfileFormValue = {
  /** D-HUX8 — persona/display name; the role `name` (title) is the fallback shown when it's empty. */
  displayName: string;
  name: string;
  description: string;
  icon: string;
  systemPrompt: string;
  defaultModel: string;
  /**
   * D-MI1/D-MI7 (`roadmap/model-identity/`, WP 4.1) — WHICH credential `defaultModel` was picked
   * from. `null` = unpinned: the API falls back to its name heuristic, which is exactly how a
   * subscription-intended agent silently ran on the metered Anthropic key. The picker sets it
   * alongside the model id and they are always written together.
   */
  providerCredentialId: string | null;
  toolGrants: HubToolGrants;
  skillIds: string[];
  target: string;
  expectedOutcome: string;
  budgets: BudgetsFormValue;
};

export function formFromRole(role: HubAgentRole): AgentProfileFormValue {
  return {
    displayName: role.displayName ?? "",
    name: role.name ?? "",
    description: role.description ?? "",
    icon: role.icon ?? "",
    systemPrompt: role.systemPrompt ?? "",
    defaultModel: role.defaultModel ?? "",
    providerCredentialId: role.providerCredentialId ?? null,
    toolGrants: role.toolGrants ?? EMPTY_GRANTS,
    skillIds: role.skills?.map((s) => s.skillId) ?? [],
    target: role.target ?? "",
    expectedOutcome: role.expectedOutcome ?? "",
    budgets: budgetsFromWire(role.budgets),
  };
}

/** The eight D-HUX6 agent sections, in rail order. `?settings=<id>` deep-links each one. */
export const AGENT_SECTION_IDS = [
  "profile",
  "instructions",
  "model",
  "access",
  "skills",
  "memory",
  "budgets",
  "usage",
] as const;

export type AgentSectionId = (typeof AGENT_SECTION_IDS)[number];

export function isAgentSectionId(value: string | null | undefined): value is AgentSectionId {
  return value != null && (AGENT_SECTION_IDS as readonly string[]).includes(value);
}

/** The five required-field keys (mirrors `RoleEditor.validate`). */
export type AgentFieldKey =
  | "name"
  | "systemPrompt"
  | "defaultModel"
  | "target"
  | "expectedOutcome";

export type AgentFieldErrors = Partial<Record<AgentFieldKey, string>>;

/** Which SECTION each validated field lives in — a submit error routes the rail there before focus. */
export const FIELD_SECTION: Record<AgentFieldKey, AgentSectionId> = {
  name: "profile",
  systemPrompt: "instructions",
  defaultModel: "model",
  target: "instructions",
  expectedOutcome: "instructions",
};

/** Element ids (kebab-case) for focusing the first invalid field on submit. */
export const FIELD_IDS: Record<AgentFieldKey, string> = {
  name: "agent-profile-name",
  systemPrompt: "agent-profile-system-prompt",
  defaultModel: "agent-profile-default-model",
  target: "agent-profile-target",
  expectedOutcome: "agent-profile-expected-outcome",
};

export function validate(value: AgentProfileFormValue): AgentFieldErrors {
  const errors: AgentFieldErrors = {};
  if (!value.name.trim()) errors.name = "Name is required.";
  else if (value.name.length > HUB_AGENT_NAME_MAX_LENGTH) {
    errors.name = `Name must be ${HUB_AGENT_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (!value.systemPrompt.trim()) errors.systemPrompt = "A system prompt is required.";
  if (!value.defaultModel.trim()) errors.defaultModel = "Pick a default model.";
  if (!value.target.trim()) errors.target = "A target (objective) is required.";
  if (!value.expectedOutcome.trim()) errors.expectedOutcome = "An expected outcome is required.";
  return errors;
}

/** The first invalid field (in validation order) — the one the submit handler routes + focuses to. */
export function firstErrorField(errors: AgentFieldErrors): AgentFieldKey | undefined {
  return (Object.keys(errors) as AgentFieldKey[]).find((key) => errors[key] != null);
}

/**
 * Build the PATCH for a save (this modal only ever edits an existing role — quick-create makes the
 * role first, then opens the profile, D-HUX6). An optional field the user CLEARED goes over the wire
 * as explicit `null` (not omitted), matching `HubRepository.updateAgentRole`'s "omit = leave
 * unchanged" contract — so a clear isn't a silent no-op. Mirrors `RoleLibraryPanel.handleSave`.
 */
export function patchFromForm(value: AgentProfileFormValue): HubAgentRolePatch {
  const displayName = value.displayName.trim();
  const description = value.description.trim();
  const icon = value.icon.trim();
  const budgets = budgetsToWire(value.budgets);
  return {
    name: value.name.trim(),
    displayName: displayName || null,
    description: description || null,
    icon: icon || null,
    systemPrompt: value.systemPrompt,
    defaultModel: value.defaultModel.trim(),
    // D-MI1 — always written WITH the model id (explicit `null` when unpinned, matching the
    // "omit = leave unchanged" contract this patch builder already follows for cleared fields), so
    // a re-picked model can never leave a stale credential behind.
    providerCredentialId: value.providerCredentialId,
    toolGrants: value.toolGrants,
    skills: value.skillIds.map((id) => ({
      skillId: id,
      versionMode: "latest" as const,
      invocationMode: "model_invocable" as const,
    })),
    target: value.target,
    expectedOutcome: value.expectedOutcome,
    budgets: budgets ?? null,
  };
}

/** Structural dirty check (same JSON-equality approach the editors use). */
export function isDirty(value: AgentProfileFormValue, initial: AgentProfileFormValue): boolean {
  return JSON.stringify(value) !== JSON.stringify(initial);
}
