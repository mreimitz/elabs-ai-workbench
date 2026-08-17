import { HUB_AGENT_NAME_MAX_LENGTH } from "@mcp-token-footprint/shared";
import { Input, Spinner, Text, Textarea } from "@elabs-ai/components-ui";
import { FieldRow } from "../../../../components/FieldRow";
import { BudgetsFields } from "../../agents/BudgetsFields";
import { HubModelPicker } from "../../HubModelPicker";
import { IconPicker } from "../../agents/IconPicker";
import { RoleAvatar } from "../../agents/RoleAvatar";
import { SkillPicker } from "../../agents/SkillPicker";
import { findHubModelOption, useHubModelRoster } from "../../use-hub-models";
import type { AgentFieldErrors, AgentProfileFormValue } from "./agent-profile-form";

/**
 * Assistant Hub UX WP2.3 — the five "plain-field" sections of the agent-profile modal (Profile /
 * Instructions / Model / Skills / Budgets), split out of the old single-page `RoleEditor` per D-HUX6.
 * The heavy Access / Usage / Memory sections live in their own files. `Skills` + `Budgets` reuse the
 * existing `SkillPicker` / `BudgetsFields` internals in place (`../../agents/`) — moving those would
 * break their non-owned importers (`CrewEditor`, `ProjectEditor`).
 */

type Update = (patch: Partial<AgentProfileFormValue>) => void;

/** Profile (D-HUX8 identity): a live avatar + display-name/role-title preview, then the editable
 *  persona name, role title, description, and icon. */
export function ProfileSection({
  roleId,
  value,
  errors,
  update,
  disabled,
}: {
  roleId: string;
  value: AgentProfileFormValue;
  errors: AgentFieldErrors;
  update: Update;
  disabled?: boolean;
}) {
  const personaName = value.displayName.trim() || value.name.trim() || "Unnamed agent";
  const showTitleFallback = value.displayName.trim().length > 0 && value.name.trim().length > 0;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-4 py-3">
        <RoleAvatar
          id={roleId}
          icon={value.icon}
          model={value.defaultModel}
          className="size-11 shrink-0"
        />
        <div className="min-w-0">
          <Text className="truncate font-medium">{personaName}</Text>
          {showTitleFallback ? (
            <Text variant="caption" tone="muted" className="truncate">
              {value.name.trim()}
            </Text>
          ) : (
            <Text variant="caption" tone="muted">
              The display name shown across the workforce; the role title is the fallback.
            </Text>
          )}
        </div>
      </div>

      <FieldRow id="agent-profile-display-name" label="Display name (optional)">
        <Input
          id="agent-profile-display-name"
          value={value.displayName}
          onChange={(event) => update({ displayName: event.target.value })}
          placeholder="A persona name, e.g. Ada…"
          maxLength={HUB_AGENT_NAME_MAX_LENGTH}
          autoComplete="off"
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow id="agent-profile-name" label="Role title" error={errors.name}>
        <Input
          id="agent-profile-name"
          value={value.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="e.g. Research Analyst…"
          maxLength={HUB_AGENT_NAME_MAX_LENGTH}
          aria-invalid={!!errors.name}
          autoComplete="off"
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow id="agent-profile-description" label="Description">
        <Textarea
          id="agent-profile-description"
          value={value.description}
          onChange={(event) => update({ description: event.target.value })}
          placeholder="A short summary shown in cards and the planner's role library…"
          rows={2}
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow id="agent-profile-icon" label="Icon (optional)">
        <IconPicker
          id="agent-profile-icon"
          value={value.icon}
          onChange={(next) => update({ icon: next })}
          model={value.defaultModel}
          previewId={roleId}
          disabled={disabled}
        />
      </FieldRow>
    </div>
  );
}

/** Instructions: the system prompt, the target (objective), and the expected-outcome contract. */
export function InstructionsSection({
  value,
  errors,
  update,
  disabled,
}: {
  value: AgentProfileFormValue;
  errors: AgentFieldErrors;
  update: Update;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <FieldRow id="agent-profile-system-prompt" label="System prompt" error={errors.systemPrompt}>
        <Textarea
          id="agent-profile-system-prompt"
          value={value.systemPrompt}
          onChange={(event) => update({ systemPrompt: event.target.value })}
          placeholder="You are a…"
          rows={10}
          spellCheck={false}
          aria-invalid={!!errors.systemPrompt}
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow id="agent-profile-target" label="Target (objective)" error={errors.target}>
        <Textarea
          id="agent-profile-target"
          value={value.target}
          onChange={(event) => update({ target: event.target.value })}
          placeholder="What this role is responsible for accomplishing…"
          rows={3}
          aria-invalid={!!errors.target}
          disabled={disabled}
        />
      </FieldRow>

      <FieldRow
        id="agent-profile-expected-outcome"
        label="Expected outcome"
        error={errors.expectedOutcome}
      >
        <Textarea
          id="agent-profile-expected-outcome"
          value={value.expectedOutcome}
          onChange={(event) => update({ expectedOutcome: event.target.value })}
          placeholder="The structured-output contract this role's reports should satisfy…"
          rows={4}
          aria-invalid={!!errors.expectedOutcome}
          disabled={disabled}
        />
      </FieldRow>
    </div>
  );
}

/** Model: the agent's default model.
 *
 *  D-MI7 (WP 4.1) — the bespoke `SearchInput` + card-grid this used to be is replaced by the shared
 *  {@link HubModelPicker}, so an agent bound to "Anthropic CLI · Sonnet" reads the same here as in the
 *  composer and the new-session dialog. The card grid also could not tell two credentials of the same
 *  kind apart (they rendered identical cards in one family), and it stored a bare model-id string —
 *  which is exactly how a subscription-intended agent ended up on the metered key. The picked row's
 *  credential is now stored beside the id (`providerCredentialId`) and the two are written together.
 *
 *  Falls back to a free-text field when no live roster exists yet, and keeps an off-roster assigned id
 *  visible + selected (with no credential invented for it) so it is never silently dropped. */
export function ModelSection({
  value,
  errors,
  update,
  disabled,
}: {
  value: AgentProfileFormValue;
  errors: AgentFieldErrors;
  update: Update;
  disabled?: boolean;
}) {
  const roster = useHubModelRoster();

  const selected = findHubModelOption(
    roster.models,
    value.defaultModel.trim() || undefined,
    value.providerCredentialId,
  );

  return (
    <FieldRow id="agent-profile-default-model" label="Default model" error={errors.defaultModel}>
      {roster.loading ? (
        <div className="flex items-center gap-2 text-body text-muted-foreground">
          <Spinner className="size-4" aria-hidden />
          <span>Loading models…</span>
        </div>
      ) : roster.models.length === 0 ? (
        <>
          {/* No live roster yet — a free-text field so a role stays definable before any provider
              exists; the typed id resolves once a matching credential is added. It stays UNPINNED
              (`providerCredentialId: null`): inventing a credential for a typed id would be the very
              guess this workstream removes. */}
          <Input
            id="agent-profile-default-model"
            value={value.defaultModel}
            onChange={(event) =>
              update({ defaultModel: event.target.value, providerCredentialId: null })
            }
            placeholder="e.g. claude-sonnet-4-5…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!errors.defaultModel}
            disabled={disabled}
          />
          <Text variant="caption" tone="muted">
            No provider credential has a usable model roster yet — type a model id; it resolves once a
            matching credential exists.
          </Text>
        </>
      ) : (
        <HubModelPicker
          id="agent-profile-default-model"
          name="Default model"
          models={roster.models}
          unavailable={roster.unavailable}
          value={selected ?? null}
          fallbackModelId={value.defaultModel}
          disabled={disabled}
          dialogTitle="Choose this agent's default model"
          onChange={(option) =>
            update({ defaultModel: option.modelId, providerCredentialId: option.credentialId })
          }
        />
      )}
    </FieldRow>
  );
}

/** Skills: reuse the existing multi-select over the Skills registry. */
export function SkillsSection({
  value,
  update,
  disabled,
}: {
  value: AgentProfileFormValue;
  update: Update;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Text variant="caption" tone="muted">
        Skills attached here are preloaded into this agent's brief when it runs — read-only and
        metered, never executed.
      </Text>
      <SkillPicker
        idPrefix="agent-profile"
        value={value.skillIds}
        onChange={(next) => update({ skillIds: next })}
        disabled={disabled}
      />
    </div>
  );
}

/** Budgets: reuse the shared hard-cap sub-form. */
export function BudgetsSection({
  value,
  update,
  disabled,
}: {
  value: AgentProfileFormValue;
  update: Update;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Text variant="caption" tone="muted">
        Optional hard caps, enforced server-side on every run regardless of the autonomy dial. Leave
        a field empty for no limit.
      </Text>
      <BudgetsFields
        idPrefix="agent-profile"
        value={value.budgets}
        onChange={(next) => update({ budgets: next })}
        disabled={disabled}
      />
    </div>
  );
}
