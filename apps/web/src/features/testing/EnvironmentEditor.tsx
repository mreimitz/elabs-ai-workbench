import { useEffect, useMemo, useState } from "react";
import type {
  AllowedServer,
  AllowedSkill,
  AvailableModel,
  GuardrailConfig,
  ProviderCredential,
  ScanDetail,
  Scenario,
  ScenarioInput,
  ServerConfig,
  ServerType,
  Skill,
  SkillVersion,
  ToolLoadingMode,
} from "@mcp-token-footprint/shared";
import { providerKindLabel, scenarioInputSchema } from "@mcp-token-footprint/shared";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  cn,
  Combobox,
  Input,
  Label,
  MetricCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatePanel,
  Text,
  Textarea,
} from "@brand/ui";
import { Cpu, Loader2, Plus, ServerCog, Shield, Sparkles, Trash2, Wifi } from "lucide-react";
import { WideDialog, type WideDialogSection, DialogSection } from "../../components/dialogs";
import { StatusBadge } from "../../components/StatusBadge";
import {
  BoundedNumber,
  SegmentedField,
  SliderNumber,
  useDependentField,
} from "../../components/form";
import { FieldRow } from "../../components/FieldRow";
import { IconButton } from "../../components/IconButton";
import { getErrorMessage } from "../../lib/errors";
import { RankedTokenList } from "../../components/TokenViz";
import { KpiStat } from "../../components/KpiStat";
import { listProviderModels } from "../../lib/api";
import { formatNumber, formatRelativeTime } from "../../lib/format";
import {
  credentialHealthView,
  getCredentialHealth,
  testCredential,
  type CredentialHealth,
} from "./credential-health";
import { ServerTypeStatusBadge } from "../servers/ServerTypeStatusBadge";
import { AddServerModal } from "./AddServerModal";
import { AddSkillModal } from "./AddSkillModal";
import { TokenProfileField } from "./TokenProfileField";
import {
  EMPTY_FORM,
  type FormState,
  fromScenario,
  REASONING_NONE,
  toInput,
} from "./environment-form";
import { modelSupportsDeferred, modelSupportsReasoning } from "./environment-model-caps";
import {
  computeFootprint,
  computeSkillFootprint,
  entryFootprint,
  isKnownModel,
  modelsForKind,
  resolveSkillVersion,
  skillEntryFootprint,
} from "./allow-list";

/** Map a Zod issue path back to the field key used for inline errors. */
type FieldErrors = Partial<Record<string, string>>;

/** Field ids in submit order — drives focus-first-error (interaction-guidelines). */
const FIELD_ORDER: { key: string; id: string }[] = [
  { key: "name", id: "scenario-name" },
  { key: "providerId", id: "scenario-provider" },
  { key: "model", id: "scenario-model" },
];

const MODEL_SECTION_ID = "model";

export function EnvironmentEditor(props: {
  open: boolean;
  scenario: Scenario | null;
  providers: ProviderCredential[];
  servers: ServerConfig[];
  /** Server types (roadmap/server-types) — used, read-only, to surface each allowed server's
   *  type + lifecycle status. Optional/defaulted so callers that don't have types still render. */
  serverTypes?: ServerType[];
  latestScans: Map<string, ScanDetail>;
  skills: Skill[];
  skillVersions: Map<string, SkillVersion[]>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ScenarioInput) => Promise<void>;
}) {
  const {
    open,
    scenario,
    providers,
    servers,
    serverTypes = [],
    latestScans,
    skills,
    skillVersions,
  } = props;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [addServerOpen, setAddServerOpen] = useState(false);
  const [addSkillOpen, setAddSkillOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(MODEL_SECTION_ID);
  // The live model roster for the selected credential (null = none loaded yet / fetch failed, in
  // which case the picker falls back to the curated known-models list). See the fetch effect below.
  const [liveModels, setLiveModels] = useState<AvailableModel[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // Credential health ("is this key usable?", T7) — an explicit "Test connection" records the result
  // to the shared store (`credential-health.ts`) that the Environments table + run launcher read.
  // `credentialTick` re-reads the store after a test.
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialTick, setCredentialTick] = useState(0);
  // A snapshot of the form at open, for the dirty check.
  const [baseline, setBaseline] = useState<string>("");

  const editing = Boolean(scenario);

  useEffect(() => {
    if (!open) return;
    const next = scenario ? fromScenario(scenario) : EMPTY_FORM;
    setForm(next);
    setBaseline(JSON.stringify(next));
    setErrors({});
    setFormError(null);
    setSaving(false);
    setActiveSection(MODEL_SECTION_ID);
    // When editing a scenario whose model isn't in the known list, start in custom mode so the
    // value is preserved and visible (it would otherwise vanish from a known-only Combobox).
    setCustomModel(next.model !== "" && !isKnownModel(next.model));
  }, [open, scenario]);

  // Pull the live model roster from the selected credential's provider API (the list the user's key
  // can actually run). On success it replaces the curated list in the picker; on failure we fall
  // back to the curated list and surface `modelsError` as an inline notice. The `ignore` flag drops
  // a stale response when the credential changes (or the dialog closes) mid-flight.
  useEffect(() => {
    if (!open || !form.providerId) {
      setLiveModels(null);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }
    let ignore = false;
    setModelsLoading(true);
    setModelsError(null);
    setLiveModels(null);
    listProviderModels(form.providerId)
      .then((response) => {
        if (!ignore) setLiveModels(response.models);
      })
      .catch((error: unknown) => {
        if (ignore) return;
        setLiveModels(null);
        setModelsError(getErrorMessage(error, "Couldn’t load models from the provider."));
      })
      .finally(() => {
        if (!ignore) setModelsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [open, form.providerId]);

  const dirty = JSON.stringify(form) !== baseline;

  // Owner finding #7 — "adding a skill immediately pops the discard prompt."
  //
  // The add-server / add-skill pickers are separate Radix Dialogs portalled to <body>, stacked over
  // this editor's WideDialog. Confirming one ("Add skill") is a pointer-down *outside* the parent
  // WideDialog's content, so Radix's DismissableLayer fires the parent Dialog's `onOpenChange(false)`.
  // Because Radix defers that outside-dismiss onto the *click* event, it lands AFTER the nested modal
  // has closed and after `onAdd` has mutated the form to dirty — so the parent's unsaved-changes guard
  // sees a dirty close and pops "Discard changes?". A real close can never originate from the editor
  // while a nested modal is open (Escape/overlay/X all target the topmost nested layer), so we simply
  // neutralize any close while a nested picker is (or was just) open.
  //
  // `nestedModalGuard` stays true while a picker is open AND for one macrotask after it closes, which
  // spans that deferred dismiss: we (a) hide `dirty` from the guard so no discard prompt can open, and
  // (b) swallow the stray `onOpenChange(false)` so the editor doesn't silently close either. The
  // genuine dirty guard is fully restored a tick after the picker closes.
  const nestedModalOpen = addServerOpen || addSkillOpen;
  const [nestedModalRecentlyOpen, setNestedModalRecentlyOpen] = useState(false);
  useEffect(() => {
    if (nestedModalOpen) {
      setNestedModalRecentlyOpen(true);
      return;
    }
    // Picker closed: hold the guard through the current event's deferred outside-dismiss, then release.
    const id = window.setTimeout(() => setNestedModalRecentlyOpen(false), 0);
    return () => window.clearTimeout(id);
  }, [nestedModalOpen]);
  const nestedModalGuard = nestedModalOpen || nestedModalRecentlyOpen;

  const handleWideDialogOpenChange = (next: boolean) => {
    if (!next && nestedModalGuard) return; // stray close bubbling from a nested picker — ignore
    props.onOpenChange(next);
  };

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function patchGuardrail(key: keyof GuardrailConfig, value: number | null) {
    setForm((current) => {
      const next = { ...current.guardrails };
      if (value === null) delete next[key];
      else next[key] = value;
      return { ...current, guardrails: next };
    });
  }

  // D-MI6 (`roadmap/model-identity/`, WP 2.3): show the provider kind's DISPLAY name, never the raw
  // wire literal — this option used to read "My key · claude_subscription".
  const providerOptions = useMemo(
    () =>
      providers.map((provider) => ({
        value: provider.id,
        label: `${provider.label} · ${providerKindLabel(provider.kind)}`,
      })),
    [providers],
  );

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === form.providerId),
    [providers, form.providerId],
  );

  // The recorded health of the selected credential (re-read after each explicit test). `null` until a
  // credential is chosen.
  const credentialHealth: CredentialHealth | null = useMemo(
    () => (selectedProvider ? getCredentialHealth(selectedProvider) : null),
    // credentialTick forces a re-read once a test records a new outcome.
    [selectedProvider, credentialTick],
  );

  async function onTestCredential() {
    if (!selectedProvider) return;
    setCredentialBusy(true);
    try {
      await testCredential(selectedProvider);
      setCredentialTick((tick) => tick + 1);
    } finally {
      setCredentialBusy(false);
    }
  }

  // Picker options: the provider's LIVE roster when it loaded (`liveModels`), otherwise the curated
  // known-models list filtered to the provider kind (offline fallback). Either way we append the
  // current `form.model` if missing — a custom id, or a model the live list / kind filter omits — so
  // the Combobox trigger always reflects the selected value (never an empty placeholder).
  const modelOptions = useMemo(() => {
    const options = liveModels
      ? liveModels.map((model) => ({ label: model.displayName ?? model.id, value: model.id }))
      : modelsForKind(selectedProvider?.kind).map((model) => ({ label: model, value: model }));
    if (form.model && !options.some((option) => option.value === form.model)) {
      options.push({ label: form.model, value: form.model });
    }
    return options;
  }, [liveModels, selectedProvider, form.model]);

  // S19 dependency: the model picker stays disabled — and says WHY — until a credential is chosen,
  // and is then strictly filtered by it. The "+ Custom model id" link remains the escape hatch.
  const modelField = useDependentField([
    { met: Boolean(form.providerId), reason: "Pick a credential first…" },
  ]);

  const reasoningSupported = modelSupportsReasoning(selectedProvider?.kind, form.model);
  const deferredSupported = modelSupportsDeferred(selectedProvider?.kind, form.model);

  const footprint = useMemo(
    () => computeFootprint(servers, form.allowedServers, latestScans),
    [servers, form.allowedServers, latestScans],
  );

  const skillsById = useMemo(() => {
    const map = new Map<string, Skill>();
    for (const skill of skills) map.set(skill.id, skill);
    return map;
  }, [skills]);

  // Server-type lookup (read-only, roadmap/server-types WP 4.1). A server's `typeId` only counts
  // when it references a KNOWN type; a dangling id (its type was deleted) resolves to `null` and
  // renders as "Untyped" — never crashes.
  const typesById = useMemo(
    () => new Map(serverTypes.map((type) => [type.id, type] as const)),
    [serverTypes],
  );
  const resolveServerType = (server: ServerConfig | undefined): ServerType | null =>
    server?.typeId ? (typesById.get(server.typeId) ?? null) : null;

  const skillFootprint = useMemo(
    () => computeSkillFootprint(form.allowedSkills, skillsById, skillVersions),
    [form.allowedSkills, skillsById, skillVersions],
  );

  // When deferred is selected but the provider/model can't do tool search, the run falls back to
  // eager — surface that here instead of letting it be a run-time surprise (mirrors the engine's
  // `registry.supportsToolSearch`). `null` when deferred is supported / not selected.
  const deferFallbackNote =
    form.toolLoadingMode === "deferred" && selectedProvider && !deferredSupported
      ? selectedProvider.kind !== "anthropic"
        ? `Tool search runs on Anthropic models only — this ${selectedProvider.kind} environment will fall back to eager at run time.`
        : "Tool search isn’t available on Haiku models — this environment will fall back to eager at run time."
      : null;

  function removeServer(serverId: string) {
    patch(
      "allowedServers",
      form.allowedServers.filter((entry) => entry.serverId !== serverId),
    );
  }

  function addServer(entry: AllowedServer) {
    patch("allowedServers", [...form.allowedServers, entry]);
  }

  function removeSkill(skillId: string) {
    patch(
      "allowedSkills",
      form.allowedSkills.filter((entry) => entry.skillId !== skillId),
    );
  }

  function addSkill(entry: AllowedSkill) {
    patch("allowedSkills", [...form.allowedSkills, entry]);
  }

  async function submit() {
    const input = toInput(form);
    const parsed = scenarioInputSchema.safeParse(input);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "form");
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setFormError("Fix the highlighted fields and try again.");
      // Every validated field (name/provider/model) lives in the Model section — surface it there.
      setActiveSection(MODEL_SECTION_ID);
      const firstInvalid = FIELD_ORDER.find((field) => next[field.key]);
      if (firstInvalid)
        window.requestAnimationFrame(() => document.getElementById(firstInvalid.id)?.focus());
      return;
    }

    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      await props.onSubmit(parsed.data);
      // Direct close on success (bypasses the unsaved-changes guard).
      props.onOpenChange(false);
    } catch (error) {
      setFormError(`Couldn’t save the environment. ${getErrorMessage(error)} Try again.`);
      setActiveSection(MODEL_SECTION_ID);
    } finally {
      setSaving(false);
    }
  }

  const toolLoadingHelp =
    form.toolLoadingMode === "deferred"
      ? "Deferred withholds MCP tool definitions from the prompt prefix and lets the model search for them on demand, cutting the resident tool-definition footprint to near zero. Anthropic (non-Haiku) models only."
      : "Eager loads every allow-listed tool definition into the prompt prefix up front — the resident footprint the token panel measures.";

  // --- Section content ---------------------------------------------------------------------------

  const modelSection = (
    <div className="flex flex-col gap-6">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      <DialogSection
        title="Identity"
        description="What this environment is and the system prompt every run starts from."
      >
        <FieldRow id="scenario-name" label="Name" error={errors.name}>
          <Input
            id="scenario-name"
            name="environment-name"
            value={form.name}
            placeholder="Prod-Claude…"
            autoComplete="off"
            aria-invalid={errors.name ? true : undefined}
            onChange={(event) => patch("name", event.target.value)}
          />
        </FieldRow>
        <FieldRow id="scenario-system" label="System prompt">
          <Textarea
            id="scenario-system"
            rows={4}
            value={form.systemPrompt}
            placeholder="You are an operator assistant…"
            onChange={(event) => patch("systemPrompt", event.target.value)}
          />
        </FieldRow>
      </DialogSection>

      <DialogSection
        title="Model & sampling"
        description="The provider credential, the model it can run, and the sampling parameters."
      >
        {/* Credential (60%) + model (40%) on one row; the model picker is gated on the credential. */}
        <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
          <FieldRow id="scenario-provider" label="Provider credential" error={errors.providerId}>
            {providers.length === 0 ? (
              <Text variant="meta" tone="muted">
                No provider credentials yet. Add one in Settings → Provider credentials first.
              </Text>
            ) : (
              <Select value={form.providerId} onValueChange={(value) => patch("providerId", value)}>
                <SelectTrigger
                  id="scenario-provider"
                  className="w-full"
                  aria-invalid={errors.providerId ? true : undefined}
                >
                  <SelectValue placeholder="Select a credential…" />
                </SelectTrigger>
                <SelectContent>
                  {providerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FieldRow>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="scenario-model">Model</Label>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => {
                  setCustomModel((on) => !on);
                  if (!customModel) patch("model", "");
                }}
              >
                {customModel ? "Choose a known model" : "+ Custom model id"}
              </Button>
            </div>
            {customModel ? (
              <Input
                id="scenario-model"
                value={form.model}
                placeholder="my-org/custom-model…"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={errors.model ? true : undefined}
                onChange={(event) => patch("model", event.target.value)}
              />
            ) : modelField.disabled ? (
              // S19: disabled-with-reason until a credential is chosen (Combobox has no disabled prop,
              // so the gated state is a real disabled input carrying the reason).
              <Input
                id="scenario-model"
                value=""
                readOnly
                disabled
                placeholder={modelField.reason}
                aria-disabled
                title={modelField.reason}
              />
            ) : (
              <Combobox
                options={modelOptions}
                value={form.model}
                onValueChange={(value) => patch("model", value)}
                placeholder="Select a model…"
                searchPlaceholder="Search models…"
                emptyText="No models — use a custom id."
              />
            )}
            {/* Live-roster status (hidden in custom / gated mode). */}
            {!customModel && !modelField.disabled && modelsLoading ? (
              <Text variant="meta" tone="muted">
                Loading models from the provider…
              </Text>
            ) : null}
            {!customModel && !modelField.disabled && !modelsLoading && modelsError ? (
              <Text variant="meta" tone="muted">
                {modelsError} — showing known models.
              </Text>
            ) : null}
            {!customModel &&
            !modelField.disabled &&
            !modelsLoading &&
            !modelsError &&
            liveModels ? (
              <Text variant="meta" tone="muted">
                {liveModels.length > 0
                  ? `${liveModels.length} ${liveModels.length === 1 ? "model" : "models"} available from this credential.`
                  : "The provider returned no compatible models — use a custom id."}
              </Text>
            ) : null}
            {errors.model ? (
              <Text variant="meta" className="text-destructive" role="alert">
                {errors.model}
              </Text>
            ) : null}
          </div>
        </div>

        {/* Credential health (T7): confirm this key can reach the provider BEFORE a paid run relies
            on it. The result is recorded to the shared store the Environments table + launcher read. */}
        {selectedProvider ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Text variant="meta" tone="muted">
                Credential
              </Text>
              {credentialHealth ? (
                <StatusBadge view={credentialHealthView(credentialHealth.state)} />
              ) : null}
              {credentialHealth?.checkedAt ? (
                <Text variant="meta" tone="muted" className="tabular-nums">
                  Checked {formatRelativeTime(credentialHealth.checkedAt)}
                </Text>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => void onTestCredential()}
                disabled={credentialBusy}
              >
                {credentialBusy ? (
                  <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
                ) : (
                  <Wifi aria-hidden />
                )}
                <span>{credentialBusy ? "Testing…" : "Test connection"}</span>
              </Button>
            </div>
            {credentialHealth?.state === "failed" && credentialHealth.error ? (
              <Text variant="meta" className="text-destructive text-pretty" role="alert">
                {credentialHealth.error}
              </Text>
            ) : credentialHealth?.state === "unknown" ? (
              <Text variant="meta" tone="muted" className="text-pretty">
                Test the connection to confirm this key reaches the provider before a run relies on
                it.
              </Text>
            ) : null}
          </div>
        ) : null}

        {/* Bounded continuous scales — slider + input, provider-default marked (S12/S19). */}
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scenario-temp">Temperature</Label>
            <SliderNumber
              id="scenario-temp"
              value={form.temperature}
              min={0}
              max={2}
              step={0.1}
              decimals={2}
              allowDefault
              aria-label="Temperature"
              onChange={(value) => patch("temperature", value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scenario-topp">Top P</Label>
            <SliderNumber
              id="scenario-topp"
              value={form.topP}
              min={0}
              max={1}
              step={0.05}
              decimals={2}
              allowDefault
              aria-label="Top P"
              onChange={(value) => patch("topP", value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="scenario-maxout">Max output tokens</Label>
            <BoundedNumber
              id="scenario-maxout"
              value={form.maxOutputTokens}
              min={256}
              step={256}
              placeholder="Model default"
              unit="tokens"
              aria-label="Max output tokens"
              onChange={(value) => patch("maxOutputTokens", value)}
            />
            <Text variant="meta" tone="muted">
              Leave empty to use the model’s default output budget.
            </Text>
          </div>
          <SegmentedField
            id="scenario-reasoning"
            label="Reasoning effort"
            value={form.reasoningEffort}
            disabled={!reasoningSupported}
            onChange={(value) => patch("reasoningEffort", value as FormState["reasoningEffort"])}
            options={[
              { value: REASONING_NONE, label: "Default" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
            help={
              reasoningSupported
                ? "Higher effort lets a reasoning model think longer before answering."
                : "This model doesn’t expose a reasoning-effort control."
            }
          />
        </div>
      </DialogSection>

      <DialogSection
        title="Token profiles"
        description="The estimator lenses applied to every run of this environment; a test can add more."
      >
        <TokenProfileField
          value={form.defaultProfiles}
          onChange={(next) => patch("defaultProfiles", next)}
          ariaLabel="Default token profiles"
        />
      </DialogSection>

      <DialogSection title="Tool loading" description="How MCP tool definitions reach the model.">
        <SegmentedField
          id="scenario-toolmode"
          label="Tool loading"
          value={form.toolLoadingMode}
          onChange={(value) => patch("toolLoadingMode", value as ToolLoadingMode)}
          options={[
            { value: "eager", label: "Eager" },
            {
              value: "deferred",
              label: "Deferred",
              disabled: !deferredSupported,
            },
          ]}
          help={toolLoadingHelp}
        />
        {deferFallbackNote ? (
          <Text variant="meta" className="text-warning" role="alert">
            {deferFallbackNote}
          </Text>
        ) : null}
      </DialogSection>

    </div>
  );

  const guardrailsSection = (
    <DialogSection
      title="Guardrails"
      description="Hard stops for a run. Leave a field empty for no limit on that dimension."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FieldRow id="gr-turns" label="Max turns">
          <BoundedNumber
            id="gr-turns"
            value={form.guardrails.maxTurns ?? null}
            min={1}
            step={1}
            unit="turns"
            aria-label="Max turns"
            onChange={(value) => patchGuardrail("maxTurns", value)}
          />
        </FieldRow>
        <FieldRow id="gr-toolcalls" label="Max tool calls">
          <BoundedNumber
            id="gr-toolcalls"
            value={form.guardrails.maxToolCalls ?? null}
            min={1}
            step={1}
            unit="calls"
            aria-label="Max tool calls"
            onChange={(value) => patchGuardrail("maxToolCalls", value)}
          />
        </FieldRow>
        <FieldRow id="gr-tokens" label="Max tokens">
          <BoundedNumber
            id="gr-tokens"
            value={form.guardrails.maxTokens ?? null}
            min={1}
            step={1000}
            unit="tokens"
            aria-label="Max tokens"
            onChange={(value) => patchGuardrail("maxTokens", value)}
          />
        </FieldRow>
        <FieldRow id="gr-ctx" label="Max context tokens">
          <BoundedNumber
            id="gr-ctx"
            value={form.guardrails.maxContextTokens ?? null}
            min={1}
            step={1000}
            unit="tokens"
            aria-label="Max context tokens"
            onChange={(value) => patchGuardrail("maxContextTokens", value)}
          />
        </FieldRow>
        <FieldRow id="gr-cost" label="Max cost">
          <BoundedNumber
            id="gr-cost"
            value={form.guardrails.maxCostUsd ?? null}
            min={0}
            step={0.5}
            decimals={2}
            unit="USD"
            aria-label="Max cost in US dollars"
            onChange={(value) => patchGuardrail("maxCostUsd", value)}
          />
        </FieldRow>
        {/* Unified Sessions (roadmap/unified-sessions/, D-US3) — this is the wall CAP, opt-in only:
            leave it empty for no cap (the app default), matching the session clock's actual behavior
            (the previous "30 min default" placeholder here was stale — both executors went cap-less by
            default once WP1.3–1.7 adopted the SessionClock). */}
        <FieldRow id="gr-duration" label="Max run duration">
          <BoundedNumber
            id="gr-duration"
            value={form.guardrails.maxRunDurationMs ?? null}
            min={1000}
            step={60000}
            unit="ms"
            placeholder="No cap"
            aria-label="Max run duration in milliseconds"
            onChange={(value) => patchGuardrail("maxRunDurationMs", value)}
          />
        </FieldRow>

        {/* Unified Sessions (WP3.4, D-US3/D-US7) — the stall timeout and wait budget the run's
            SessionClock actually uses. Read-only: `GuardrailConfig` (packages/shared) has NO field for
            either (only `maxRunDurationMs`, wired above), and the engine's `sessionClockOptions` seam
            that WOULD carry a per-environment override is never populated from scenario data today —
            see the WP3.4 report for the full backend-gap writeup. These figures mirror
            `apps/api/src/testing/session-clock.ts`'s `DEFAULT_STALL_MS`/`DEFAULT_WAIT_BUDGET_MS`. */}
        <KpiStat label="Stall timeout" value="10 min" />
        <KpiStat label="Wait budget" value="10 min" />
      </div>
      <Text variant="meta" tone="muted" className="text-pretty">
        Stall timeout and wait budget are fixed app-wide defaults — there’s no per-environment
        override yet; only the max run duration above is configurable per environment.
      </Text>
    </DialogSection>
  );

  const allowSection = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      {/* LEFT — the allow-list editors. */}
      <div className="flex flex-col gap-6">
        <DialogSection
          title="Allowed servers & tools"
          description="Which MCP servers (and which of their tools) this environment can call."
          actions={
            <Button
              size="sm"
              onClick={() => setAddServerOpen(true)}
              disabled={servers.length === 0}
            >
              <Plus aria-hidden />
              <span>Add server</span>
            </Button>
          }
        >
          {form.allowedServers.length === 0 ? (
            <StatePanel
              kind="empty"
              icon={<ServerCog aria-hidden />}
              title="No servers yet"
              description={
                servers.length === 0
                  ? "No MCP servers configured. Add one under Servers, then allow its tools here."
                  : "Add a server to allow its tools."
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {form.allowedServers.map((entry) => {
                const server = servers.find((candidate) => candidate.id === entry.serverId);
                const scan = latestScans.get(entry.serverId);
                const name = server?.name ?? entry.serverId;
                const total = scan?.tools.length ?? 0;
                const { tokens, toolCount } = entryFootprint(entry, scan);
                // Read-only type/status surfacing (WP 4.1): a deprecated fleet reads de-emphasized.
                const type = resolveServerType(server);
                const deprecated = type?.status === "deprecated";
                return (
                  <li
                    key={entry.serverId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <ServerCog className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <Text
                          className={cn(
                            "truncate font-medium",
                            deprecated && "text-muted-foreground",
                          )}
                          title={name}
                        >
                          {name}
                        </Text>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="tabular-nums">
                          {entry.allowedTools === null
                            ? "all tools"
                            : `${entry.allowedTools.length} of ${total}`}
                        </Badge>
                        {type ? (
                          <>
                            <Badge variant="outline">{type.name}</Badge>
                            <ServerTypeStatusBadge status={type.status} />
                          </>
                        ) : (
                          <Text variant="meta" tone="muted">
                            Untyped
                          </Text>
                        )}
                        {scan ? (
                          <Text variant="meta" tone="muted" className="tabular-nums">
                            {formatNumber(tokens)} tok · {toolCount} tools
                          </Text>
                        ) : (
                          <Text variant="meta" tone="muted">
                            no scan
                          </Text>
                        )}
                      </div>
                    </div>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      label={`Remove ${name}`}
                      onClick={() => removeServer(entry.serverId)}
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogSection>

        <DialogSection
          title="Allowed skills"
          description="Attached skills add their always-on (L1) tokens — and, when eager, their SKILL.md body (L2)."
          actions={
            <Button
              size="sm"
              onClick={() => setAddSkillOpen(true)}
              disabled={skills.length === 0 || skills.length === form.allowedSkills.length}
            >
              <Plus aria-hidden />
              <span>Add skill</span>
            </Button>
          }
        >
          {form.allowedSkills.length === 0 ? (
            <StatePanel
              kind="empty"
              icon={<Sparkles aria-hidden />}
              title="No skills yet"
              description={
                skills.length === 0
                  ? "No skills registered. Register one under Skills, then attach it here."
                  : "Attach a skill to add its always-on (L1) tokens to this environment."
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {form.allowedSkills.map((entry) => {
                const skill = skillsById.get(entry.skillId);
                const version = resolveSkillVersion(entry, skill, skillVersions.get(entry.skillId));
                const name = skill?.displayName ?? entry.skillId;
                const { tokens, l2 } = skillEntryFootprint(entry, version);
                const versionChip =
                  entry.versionMode === "latest" ? "Latest" : (version?.versionLabel ?? "pinned");
                return (
                  <li
                    key={entry.skillId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        <Text className="truncate font-medium" title={name}>
                          {name}
                        </Text>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="tabular-nums">
                          {versionChip}
                        </Badge>
                        {entry.eager ? <Badge variant="outline">eager</Badge> : null}
                        {version ? (
                          <Text variant="meta" tone="muted" className="tabular-nums">
                            {formatNumber(tokens)} tok ·{" "}
                            {entry.eager ? `L1 + L2 (${formatNumber(l2)})` : "L1"}
                          </Text>
                        ) : (
                          <Text variant="meta" tone="muted">
                            no version
                          </Text>
                        )}
                      </div>
                    </div>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      label={`Remove ${name}`}
                      onClick={() => removeSkill(entry.skillId)}
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogSection>
      </div>

      {/* RIGHT — the live definition footprint (the app's best panel; kept intact). */}
      <aside className="flex flex-col gap-4 rounded-lg border border-border bg-muted/30 p-4">
        <Text className="font-medium">Context footprint</Text>

        {/* F3: hide the "0 tools across 0 servers" number card while empty — the empty state says it. */}
        {form.allowedServers.length > 0 ? (
          <MetricCard
            label="Selected server footprint"
            value={<span className="tabular-nums">{formatNumber(footprint.total)}</span>}
            description={`${footprint.selectedToolCount} tools across ${form.allowedServers.length} servers`}
          />
        ) : null}
        {footprint.ranked.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3">
            <Text variant="meta" tone="muted">
              By server
            </Text>
            <RankedTokenList items={footprint.ranked} />
          </div>
        ) : (
          <Text variant="meta" tone="muted">
            Add a server or tools to see the token footprint here.
          </Text>
        )}

        {skillFootprint.ranked.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-3">
            <Text variant="meta" tone="muted">
              By skill
            </Text>
            <RankedTokenList items={skillFootprint.ranked} />
          </div>
        ) : null}

        <MetricCard
          label="Total context footprint"
          value={
            <span className="tabular-nums">
              {formatNumber(footprint.total + skillFootprint.total)}
            </span>
          }
          description={`${formatNumber(footprint.total)} tools + ${formatNumber(skillFootprint.total)} skills`}
        />
      </aside>
    </div>
  );

  const sections: WideDialogSection[] = [
    { id: MODEL_SECTION_ID, label: "Model", icon: <Cpu aria-hidden />, content: modelSection },
    {
      id: "guardrails",
      label: "Guardrails",
      icon: <Shield aria-hidden />,
      content: guardrailsSection,
    },
    {
      id: "allow",
      label: "Servers & skills",
      icon: <ServerCog aria-hidden />,
      content: allowSection,
    },
  ];

  return (
    <>
      <WideDialog
        open={open}
        onOpenChange={handleWideDialogOpenChange}
        title={editing ? "Edit environment" : "New environment"}
        description="An environment is the harness — a provider, model, allowed tools, and guardrails a test runs against."
        sections={sections}
        nav="rail"
        activeSectionId={activeSection}
        onActiveSectionChange={setActiveSection}
        dirty={dirty && !nestedModalGuard}
        busy={saving}
        primaryLabel={editing ? "Save environment" : "Create environment"}
        onSubmit={() => void submit()}
        footerStart={
          <span className="tabular-nums">
            Total context {formatNumber(footprint.total + skillFootprint.total)} tokens
          </span>
        }
      />

      <AddServerModal
        open={addServerOpen}
        onOpenChange={setAddServerOpen}
        servers={servers}
        serverTypes={serverTypes}
        latestScans={latestScans}
        existing={form.allowedServers}
        onAdd={addServer}
      />

      <AddSkillModal
        open={addSkillOpen}
        onOpenChange={setAddSkillOpen}
        skills={skills}
        skillVersions={skillVersions}
        existing={form.allowedSkills}
        onAdd={addSkill}
      />
    </>
  );
}
