import type {
  AllowedServer,
  AllowedSkill,
  GuardrailConfig,
  ModelParams,
  Scenario,
  ScenarioInput,
  TokenProfileRef,
  ToolLoadingMode,
} from "@mcp-token-footprint/shared";

/**
 * Pure, framework-free form mapping for the Environment editor (WP 2.7). Extracted from the editor
 * component so the round-trip contract — open an existing environment and save it with no edits
 * produces **no diff** — is directly unit-testable without rendering React. The editor imports these;
 * so does `environment-form.test.ts`.
 *
 * The wire shape keeps the `scenario` identifiers (`Scenario`/`ScenarioInput`) — "Environment" is a
 * UI-label rename only (see CLAUDE.md testing-IA note), the wire is frozen.
 */

/** Sentinel for "use the provider/model default reasoning effort" (an absent `reasoningEffort`). */
export const REASONING_NONE = "__none__" as const;

type Reasoning = NonNullable<ModelParams["reasoningEffort"]>;

/** Qlik Answers (WP 2.3, D-QA2) — `packages/shared` inlines this shape on `Scenario`/`ScenarioInput`
 * rather than exporting it standalone; derive it locally instead of adding a shared export. */
type AnswersMode = NonNullable<Scenario["answersMode"]>;

export type FormState = {
  name: string;
  providerId: string;
  model: string;
  temperature: number | null;
  maxOutputTokens: number | null;
  topP: number | null;
  reasoningEffort: Reasoning | typeof REASONING_NONE;
  systemPrompt: string;
  allowedServers: AllowedServer[];
  allowedSkills: AllowedSkill[];
  defaultProfiles: TokenProfileRef[];
  guardrails: GuardrailConfig;
  toolLoadingMode: ToolLoadingMode;
  /** `null` = omit `answersMode` entirely (every non-qlik scenario, or one that never set it). */
  answersMode: AnswersMode | null;
};

export const EMPTY_FORM: FormState = {
  name: "",
  providerId: "",
  model: "",
  temperature: null,
  maxOutputTokens: null,
  topP: null,
  reasoningEffort: REASONING_NONE,
  systemPrompt: "",
  allowedServers: [],
  allowedSkills: [],
  defaultProfiles: ["generic_o200k"],
  guardrails: {},
  toolLoadingMode: "eager",
  answersMode: null,
};

/** Project an existing scenario onto the editor's form state (the "open" side of the round-trip). */
export function fromScenario(scenario: Scenario): FormState {
  return {
    name: scenario.name,
    providerId: scenario.providerId,
    model: scenario.model,
    temperature: scenario.params.temperature ?? null,
    maxOutputTokens: scenario.params.maxOutputTokens ?? null,
    topP: scenario.params.topP ?? null,
    reasoningEffort: scenario.params.reasoningEffort ?? REASONING_NONE,
    systemPrompt: scenario.systemPrompt,
    allowedServers: scenario.allowedServers,
    allowedSkills: scenario.allowedSkills,
    defaultProfiles: scenario.defaultProfiles,
    guardrails: scenario.guardrails,
    toolLoadingMode: scenario.toolLoadingMode,
    answersMode: scenario.answersMode ?? null,
  };
}

/** Serialize the form back to the wire input (the "save" side of the round-trip). */
export function toInput(form: FormState): ScenarioInput {
  const params: ModelParams = {};
  if (form.temperature !== null) params.temperature = form.temperature;
  if (form.maxOutputTokens !== null) params.maxOutputTokens = form.maxOutputTokens;
  if (form.topP !== null) params.topP = form.topP;
  if (form.reasoningEffort !== REASONING_NONE) params.reasoningEffort = form.reasoningEffort;

  const input: ScenarioInput = {
    name: form.name.trim(),
    providerId: form.providerId,
    model: form.model.trim(),
    params,
    systemPrompt: form.systemPrompt,
    allowedServers: form.allowedServers,
    allowedSkills: form.allowedSkills,
    defaultProfiles: form.defaultProfiles,
    guardrails: form.guardrails,
    toolLoadingMode: form.toolLoadingMode,
  };
  // Omit the key entirely rather than sending `answersMode: null` — mirrors how `params` above omits
  // absent fields, and keeps a non-qlik scenario's wire input byte-identical to before this field existed.
  if (form.answersMode !== null) input.answersMode = form.answersMode;
  return input;
}
