import { useEffect, useState } from "react";
import type { HubCrewColor, HubTopology } from "@mcp-token-footprint/shared";
import {
  HUB_AGENT_NAME_MAX_LENGTH,
  HUB_CREW_COLORS,
  HUB_CREW_NAME_MAX_LENGTH,
  HUB_TOPOLOGIES,
} from "@mcp-token-footprint/shared";
import { Input, Text, Textarea, toast } from "@elabs-ai/components-ui";
import { FormDialog } from "../../../components/dialogs";
import { FieldRow } from "../../../components/FieldRow";
import { SelectField } from "../../../components/SelectField";
import { createHubAgentRole, createHubCrew } from "../../../lib/api";
import { getErrorMessage } from "../../../lib/errors";
import { HubModelPicker } from "../HubModelPicker";
import { findHubModelOption, useHubModelRoster } from "../use-hub-models";
import { crewAccentClasses } from "../lib/hub-ux";
import {
  ROLE_PLACEHOLDER_EXPECTED_OUTCOME,
  ROLE_PLACEHOLDER_TARGET,
  rolePlaceholderSystemPrompt,
} from "../mission-role-placeholders";
import { notifyError } from "../../../lib/notify";

/**
 * Assistant Hub UX WP2.2 (D-HUX5, D-HUX6 "Quick-create stays a ≤6-field FormDialog") — the two
 * 'New agent' / 'New crew' quick-create dialogs. Triggered by the PageHeader "+ New" split button
 * (AgentsView), the Directory tab's all-scope empty state (agent only), and — since ui-wave U5
 * (owner feedback) — the org rail's inline "+" affordances (the Directory toolbar's own duplicate
 * "+ New" menu was removed in that pass).
 * Deliberately minimal: just enough to make a real, valid library entry — "Create, then open profile"
 * (D-HUX5) means every OTHER field (system prompt, target, expected outcome, members, …) is filled in
 * afterward in the full profile modal (WP2.3/WP2.4), not here. The agent's required-but-not-asked
 * fields (`systemPrompt`/`target`/`expectedOutcome` — `hubAgentRoleInputSchema` requires all three)
 * get an honest placeholder that reads as "not yet configured" rather than an invented persona.
 */

const TOPOLOGY_OPTIONS: { value: HubTopology; label: string }[] = HUB_TOPOLOGIES.map(
  (topology) => ({
    value: topology,
    label:
      topology === "best_of_n" ? "Best of N" : topology.charAt(0).toUpperCase() + topology.slice(1),
  }),
);

const NO_COLOR = "none";
const COLOR_OPTIONS: { value: string; label: string }[] = [
  { value: NO_COLOR, label: "No color" },
  ...HUB_CREW_COLORS.map((color, index) => ({ value: color, label: `Color ${index + 1}` })),
];

export function QuickCreateAgentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires with the new role's id once created — the caller navigates to its profile
   *  ("Create, then open profile", D-HUX5). */
  onCreated: (roleId: string) => void;
}) {
  const { open, onOpenChange, onCreated } = props;
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  // D-MI1 (WP 4.1) — the credential the model was picked from, stored beside the id and always
  // written with it. `null` = a typed, off-roster id (deliberately unpinned).
  const [modelCredentialId, setModelCredentialId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const roster = useHubModelRoster();

  useEffect(() => {
    if (!open) return;
    setName("");
    setDisplayName("");
    setDescription("");
    setDefaultModel("");
    setModelCredentialId(null);
  }, [open]);

  const trimmedName = name.trim();
  const trimmedModel = defaultModel.trim();
  const submitDisabled = trimmedName.length === 0 || trimmedModel.length === 0;

  async function submit() {
    setSaving(true);
    try {
      const created = await createHubAgentRole({
        name: trimmedName,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        systemPrompt: rolePlaceholderSystemPrompt(trimmedName),
        defaultModel: trimmedModel,
        // D-MI1 — the picked row's credential travels with the model id (omitted when the id was
        // typed free-hand, which is an honest "unpinned", not a guess).
        ...(modelCredentialId ? { providerCredentialId: modelCredentialId } : {}),
        target: ROLE_PLACEHOLDER_TARGET,
        expectedOutcome: ROLE_PLACEHOLDER_EXPECTED_OUTCOME,
      });
      toast.success(`Created “${created.name}”`);
      onOpenChange(false);
      onCreated(created.id);
    } catch (error) {
      notifyError("Couldn’t create the agent", { description: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New agent"
      description="A minimal starting identity — you'll finish setting it up (instructions, access, budgets…) in its profile next."
      primaryLabel="Create agent"
      busy={saving}
      submitDisabled={submitDisabled}
      onSubmit={() => void submit()}
    >
      <FieldRow id="qc-agent-name" label="Name">
        <Input
          id="qc-agent-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Research Analyst…"
          maxLength={HUB_AGENT_NAME_MAX_LENGTH}
          autoComplete="off"
          autoFocus
        />
      </FieldRow>

      <FieldRow id="qc-agent-display-name" label="Display name (optional)">
        <Input
          id="qc-agent-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="e.g. Nova…"
          maxLength={HUB_AGENT_NAME_MAX_LENGTH}
          autoComplete="off"
        />
      </FieldRow>

      <FieldRow id="qc-agent-description" label="Description (optional)">
        <Textarea
          id="qc-agent-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="A short summary shown on its card…"
          rows={2}
        />
      </FieldRow>

      <FieldRow id="qc-agent-model" label="Default model">
        {/* D-MI7 (WP 4.1) — the free-text field + datalist this used to be could not show two
            credentials of the same kind apart (a datalist option's value IS the bare model id, so
            twins collapsed) and stored no credential at all. The shared picker does both. A library
            agent must still stay definable before any provider exists, so an empty roster keeps the
            free-text field — unpinned, deliberately. */}
        {roster.models.length === 0 ? (
          <>
            <Input
              id="qc-agent-model"
              value={defaultModel}
              onChange={(event) => {
                setDefaultModel(event.target.value);
                setModelCredentialId(null);
              }}
              placeholder="e.g. claude-sonnet-4-5…"
              spellCheck={false}
              autoComplete="off"
            />
            {!roster.loading ? (
              <Text variant="caption" tone="muted">
                No provider credential has a usable model roster yet — type a model id.
              </Text>
            ) : null}
          </>
        ) : (
          <HubModelPicker
            id="qc-agent-model"
            name="Default model"
            models={roster.models}
            loading={roster.loading}
            unavailable={roster.unavailable}
            value={findHubModelOption(roster.models, trimmedModel || undefined, modelCredentialId) ?? null}
            fallbackModelId={defaultModel}
            dialogTitle="Choose this agent's default model"
            onChange={(option) => {
              setDefaultModel(option.modelId);
              setModelCredentialId(option.credentialId);
            }}
          />
        )}
      </FieldRow>
    </FormDialog>
  );
}

export function QuickCreateCrewDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires with the new crew's id once created — the caller navigates to its profile. */
  onCreated: (crewId: string) => void;
}) {
  const { open, onOpenChange, onCreated } = props;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(NO_COLOR);
  const [topology, setTopology] = useState<HubTopology>("parallel");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setColor(NO_COLOR);
    setTopology("parallel");
  }, [open]);

  const trimmedName = name.trim();
  const submitDisabled = trimmedName.length === 0;

  async function submit() {
    setSaving(true);
    try {
      const created = await createHubCrew({
        name: trimmedName,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(color !== NO_COLOR ? { color: color as HubCrewColor } : {}),
        topology,
        members: [],
      });
      toast.success(`Created “${created.name}”`);
      onOpenChange(false);
      onCreated(created.id);
    } catch (error) {
      notifyError("Couldn’t create the crew", { description: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New crew"
      description="A minimal starting team — add members and fine-tune its topology in its profile next."
      primaryLabel="Create crew"
      busy={saving}
      submitDisabled={submitDisabled}
      onSubmit={() => void submit()}
    >
      <FieldRow id="qc-crew-name" label="Name">
        <Input
          id="qc-crew-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Research Team…"
          maxLength={HUB_CREW_NAME_MAX_LENGTH}
          autoComplete="off"
          autoFocus
        />
      </FieldRow>

      <FieldRow id="qc-crew-description" label="Description (optional)">
        <Textarea
          id="qc-crew-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What this crew is for…"
          rows={2}
        />
      </FieldRow>

      <div className="grid grid-cols-2 gap-4">
        <SelectField
          id="qc-crew-color"
          label="Color (optional)"
          value={color}
          onChange={setColor}
          options={COLOR_OPTIONS}
        />
        <SelectField
          id="qc-crew-topology"
          label="Topology"
          value={topology}
          onChange={(value) => setTopology(value as HubTopology)}
          options={TOPOLOGY_OPTIONS}
        />
      </div>

      {color !== NO_COLOR ? (
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`size-2.5 shrink-0 rounded-full ${crewAccentClasses(color as HubCrewColor).dot}`}
          />
          <Text variant="caption" tone="muted">
            Shown as a small accent next to “{trimmedName || "this crew"}” everywhere it appears.
          </Text>
        </div>
      ) : null}
    </FormDialog>
  );
}
