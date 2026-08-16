// Assistant Hub — prompt-architecture types (D-AH14 / execution-plan §1.8).
//
// The prompt is assembled from versioned LAYER modules (one file each under `./layers/`) in the
// §1.8 order:
//   identity → capabilities & tool guidance → citation rules → memory → project instructions →
//   mode addendum (chat|research|mission-planner|synthesizer|critic) → role template (agents) →
//   untrusted-content & safety rules.
// Every section carries a per-section TOKEN BUDGET measured by the app's own TokenCounter (the
// budget test fails the gate if a section bloats — R-SES7 dogfood), and the same section list feeds
// the context inspector (WP4.1) so the owner can see the window itemized by layer.
//
// NOTE: this module imports ONLY types from `@mcp-token-footprint/shared` (erased at runtime) and
// declares no runtime dependency on the token counter — measurement takes a `TokenCounter` as a
// parameter (see `./budgets.ts`) so the counter stays injectable and the prompt modules stay pure.

import type { HubSessionMode } from "@mcp-token-footprint/shared";

// The prompt MODE selects LAYER 9's addendum. It is a SUPERSET of the wire `HubSessionMode`
// (`chat`/`research`/`mission`/`auto`): a `mission` session assembles a different prompt for its
// planning turn vs. its synthesis turn vs. an adversarial-critique turn, so the prompt layer splits
// `mission` into three orchestrator-side modes. hub-fixes WP6.1 (RC7) adds `auto` — the per-message
// routing rubric addendum. Kept internal to the prompting module (not a wire type).
export type HubPromptMode =
  | "chat"
  | "research"
  | "auto"
  | "mission-planner"
  // assistant-hub v1-fixes (F4) — a mission session's ORDINARY turns (post-mission): results are
  // readable, follow-up missions are proposable, and agent-simulation is explicitly forbidden.
  | "mission-followup"
  | "synthesizer"
  | "critic";

// Stable ids for every assembled section — the key the context inspector groups by and the budget
// map is keyed on. `memory`/`project` split LAYER 6; `role-template` is Appendix A (agent sessions).
export type HubPromptSectionId =
  | "identity"
  | "session-context"
  | "tools"
  | "genui"
  | "citations"
  | "memory"
  | "project"
  | "working-visibly"
  // assistant-hub v1-fixes (F5) — the style contract, present in EVERY assembled prompt.
  | "style"
  | "orchestration"
  | "mode-addendum"
  | "role-template"
  | "safety"
  | "self-check";

// One assembled section: its authored/rendered body, a human title for the inspector, and the token
// budget the body must stay within. `budgetTokens` is the ceiling; the inspector shows the measured
// count against it.
export interface HubPromptSection {
  id: HubPromptSectionId;
  title: string;
  text: string;
  budgetTokens: number;
}

// A layer module: a pure function from its injection to a rendered body, plus its identity + budget.
// `render(injection)` returns the section BODY (no `## Title` header — the assembler adds that);
// calling it with the injection omitted yields the STATIC frame the budget test measures.
export interface HubPromptLayer<I = void> {
  id: HubPromptSectionId;
  title: string;
  budgetTokens: number;
  render(injection?: I): string;
}

// ---- Runtime injection shapes (the `{{DOUBLE_BRACE}}` markers in the draft) --------------------
// All optional so the turn engine (WP1.1) can wire them incrementally; each layer renders a safe,
// honest placeholder when its injection is absent (e.g. "no tools are granted in this session").

// LAYER 2 — session context. `mode` is the WIRE session mode (chat|research|mission), distinct from
// the prompt `HubPromptMode` above.
export interface HubPromptSessionContext {
  sessionTitle?: string;
  mode?: HubSessionMode;
  modelId?: string;
  modelTier?: string;
  projectName?: string | null;
  budgets?: string;
  capabilities?: string;
  date?: string;
  ownerName?: string;
}

// LAYER 3 — the granted tool surface, PRE-FORMATTED by the tool registry (WP0.5). Eager mode passes
// compact per-server signatures; deferred mode passes server names + the tool-search note.
// `skillsListText` (WP2.4/R-SK1) is the attached-skill L1 catalog, pre-formatted by
// `hub/skill-attachments.ts`'s `computeSkillListing` — absent/`""` means no skill is attached (or every
// attachment is `user_only`), in which case the layer omits `skills.load` from its built-ins line
// entirely (R-SK1: "zero skills → no catalog at all" — the model is never told about a tool it wasn't
// actually given).
export interface HubPromptToolsInjection {
  toolListText?: string;
  skillsListText?: string;
  loadingMode?: "eager" | "deferred";
}

// LAYER 4 — the catalog-compilation SEAM WP2.6 plugs into (R-GUI1/2). WP2.6 compiles the GenUI
// catalog (compact one-line typed signatures grouped with usage notes) from the single zod registry
// and injects it here as `catalogText`; the prompt module never hand-lists components. When this is
// absent the GenUI layer is omitted entirely (no `present` capability advertised → the model stays
// in plain markdown), keeping chat turns lighter (Appendix B).
export interface HubGenuiCatalogInjection {
  // Compiled catalog text: the grouped one-line signatures + per-group notes (R-GUI1). Injected
  // verbatim at the LAYER-4 catalog marker.
  catalogText: string;
  // The catalog/spec version WP2.6 stamps on `generative-ui` events (`HUB_GENUI_SPEC_VERSION`).
  // Surfaced in the layer so a reader can tell which catalog the model was shown.
  specVersion?: string;
}

// LAYER 6 — memory + project. Content is rendered AND budget-capped BY THE CALLER (the turn engine
// truncates to the env cap before injection); the layer only frames it. Splitting keeps the §1.8
// order (memory before project) and lets the inspector itemize the two independently.
export interface HubPromptMemoryInjection {
  // Owner-visible profile + durable preferences + standing instructions (D-AH11: nothing hidden).
  memoryAndInstructions?: string;
}
export interface HubPromptProjectInjection {
  // The active project's instructions + pinned context (present only when the session is in a project).
  projectInstructionsAndPinned?: string;
}

// LAYER 8 — orchestration runtime values (mission-planner mode). Caps come from env
// (`HUB_MISSION_MAX_PARALLEL`, `HUB_MISSION_MAX_AGENTS`, autonomy thresholds); the roster is the
// live provider roster pre-formatted with tier tags (Appendix B derives tiers from `MODEL_PRICING`).
export interface HubOrchestrationInjection {
  maxParallel?: number;
  maxAgents?: number;
  modelRoster?: string;
  askAboveAgents?: number;
  askAboveUsd?: string;
}

// Appendix A — the mission-subagent role template. Everything here is CURATED by the orchestrator;
// the subagent never sees the parent conversation (the isolation contract).
export interface HubRoleTemplateInjection {
  roleName: string;
  roleSystemPrompt: string;
  briefTarget: string;
  briefInputs: string;
  expectedOutcome: string;
  agentBudget: string;
  agentToolSignatures?: string;
  roleSkillsContent?: string;
  /**
   * model-identity WP4.2 (**D-MI4**) — the PROMPT-ENFORCED report contract, appended verbatim as the
   * last block of the role prompt.
   *
   * Set only for an agent whose transport has no structured-output mode — today, a `claude_subscription`
   * (Agent-SDK) child, where the report cannot come from a `generateObject` extraction call and must be
   * emitted by the agent itself. Built by
   * `missions/agent-report-contract.ts#buildAgentReportContractInstruction`, which also owns the parser,
   * so the instruction and what we accept back cannot drift. Absent (every AI-SDK agent) ⇒ the role
   * prompt is byte-identical to pre-WP4.2.
   */
  reportContract?: string;
}

// ---- Assembler inputs --------------------------------------------------------------------------

// A top-level (chat/research/mission) session prompt.
export interface HubSessionPromptInput {
  mode: HubPromptMode;
  session?: HubPromptSessionContext;
  tools?: HubPromptToolsInjection;
  // The WP2.6 seam: when present, LAYER 4 (GenUI contract) is included with this catalog.
  genuiCatalog?: HubGenuiCatalogInjection;
  memory?: HubPromptMemoryInjection;
  project?: HubPromptProjectInjection;
  // Used only by `mission-planner` mode (LAYER 8).
  orchestration?: HubOrchestrationInjection;
}

// A mission-subagent prompt (Appendix A). The role template REPLACES LAYER 1 identity; the shared
// rule layers (tools, citations, safety, self-check) still apply. `lens` optionally overlays a mode
// addendum (e.g. `critic` for an adversarial-critique agent).
export interface HubRolePromptInput {
  role: HubRoleTemplateInjection;
  lens?: "critic" | null;
  session?: HubPromptSessionContext;
  tools?: HubPromptToolsInjection;
  genuiCatalog?: HubGenuiCatalogInjection;
}

// ---- Assembler output --------------------------------------------------------------------------

export interface AssembledHubPrompt {
  // Stamped onto every settled `assistant_message` (WP1.1). See `./version.ts`.
  promptVersion: string;
  // Which addendum shaped this prompt (or "role" for a subagent).
  mode: HubPromptMode | "role";
  // The itemized sections, in assembly order — feeds the context inspector (R-SES7).
  sections: HubPromptSection[];
  // The full system prompt string handed to the model (sections joined with `## Title` headers).
  text: string;
}

// One section's measurement against its budget — the shape the context inspector renders and the
// budget test asserts on (R-SES7).
export interface HubPromptSectionMeasurement {
  id: HubPromptSectionId;
  title: string;
  tokens: number;
  budgetTokens: number;
  withinBudget: boolean;
}
