---
type: "Work Package Spec"
title: "WP 0.3 \u2014 Shared contract (types + zod + constants)"
description: "Phase: 0 \u00b7 Size: M \u00b7 Depends on"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 0.3 — Shared contract (types + zod + constants)

**Phase:** 0 · **Size:** M · **Depends on:** —

## Objective
Define **every wire shape** for Testing in `packages/shared` before any API/web work, per
contract-first (`conventions.md`). This is the single source of truth both ends import.

## Why / references
Scope decisions #2 (profiles as lenses), #5 (matrix), #6 (allow-list), #7 (profile inheritance),
#8 (full replay), #11 (guardrails), #13 (system prompt), #14 (attachments), #15 (credentials). Token
field names mirror OTel GenAI conventions ([`../references.md`](../references.md) → *OpenTelemetry
GenAI*). Follow the existing style in `packages/shared/src/{types,schemas,constants}.ts` (discriminated
unions, `z.enum`, `.default(...)`, `superRefine`).

## Files
- `packages/shared/src/constants.ts` *(modify)*
- `packages/shared/src/types.ts` *(modify)*
- `packages/shared/src/schemas.ts` *(modify)*
- `packages/shared/src/index.ts` *(modify — re-export)*

## Design — constants (sketch)
```ts
export const PROVIDER_KINDS = ["anthropic", "openai", "google", "openai_compatible", "ollama"] as const;
export const RUN_MODES = ["automated", "interactive"] as const;
export const RUN_STATUSES = ["pending", "running", "completed", "stopped", "error", "aborted"] as const;
export const RUN_OUTCOMES = ["completed", "stopped_guardrail", "context_overflow", "error", "aborted"] as const;
export const RUN_STEP_TYPES = ["llm_request", "llm_response", "tool_call", "tool_result", "context_event"] as const;
export const CONTEXT_SEGMENTS = ["system", "tool_defs", "history", "tool_results", "output"] as const;
// Seed map; treat a provider limit error as ground truth regardless (WP 1.4).
export const MODEL_CONTEXT_LIMITS: Record<string, number> = { /* "claude-…": 200000, "gpt-…": 128000, … */ };
```

## Design — types (sketch)
```ts
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type RunMode = (typeof RUN_MODES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunOutcome = (typeof RUN_OUTCOMES)[number];
export type RunStepType = (typeof RUN_STEP_TYPES)[number];
export type ContextSegment = (typeof CONTEXT_SEGMENTS)[number];

export type ModelParams = {
  temperature?: number; maxOutputTokens?: number; topP?: number; reasoningEffort?: "low" | "medium" | "high";
};

// Redacted — never carries the key.
export type ProviderCredential = {
  id: string; kind: ProviderKind; label: string; baseUrl?: string; hasKey: boolean;
  createdAt: string; updatedAt: string;
};
export type ProviderCredentialInput = { kind: ProviderKind; label: string; baseUrl?: string; apiKey?: string };

export type GuardrailConfig = { maxTurns?: number; maxToolCalls?: number; maxTokens?: number; maxContextTokens?: number; maxCostUsd?: number };

export type TokenProfileRef = TokenProfileId; // reuse existing union; "provider_actual" is handled as a separate lens, not a TokenCounter

export type AllowedServer = { serverId: string; allowedTools: string[] | null }; // null = all tools

export type Scenario = {
  id: string; name: string; providerId: string; model: string; params: ModelParams;
  systemPrompt: string; allowedServers: AllowedServer[]; defaultProfiles: TokenProfileRef[];
  guardrails: GuardrailConfig; createdAt: string; updatedAt: string;
};
export type ScenarioInput = Omit<Scenario, "id" | "createdAt" | "updatedAt">;

export type TestAttachment = { id: string; kind: "file" | "image" | "text"; name: string; bytes: number; createdAt: string };
export type Test = {
  id: string; name: string; userPrompt: string; systemPromptOverride?: string;
  addedProfiles: TokenProfileRef[]; attachments: TestAttachment[];
  assertions?: unknown; // reserved (phased, decision #4)
  createdAt: string; updatedAt: string;
};
export type TestInput = Omit<Test, "id" | "attachments" | "createdAt" | "updatedAt">;

export type TokenUsageActual = { inputTokens: number; outputTokens: number; cachedInputTokens?: number; reasoningTokens?: number };
export type ContextSnapshot = { total: number; limit: number; segments: Record<ContextSegment, number> };

export type RunStep = {
  id: string; runId: string; index: number; type: RunStepType; label: string; status: "ok" | "error" | "running";
  durationMs?: number; serverId?: string; toolName?: string;
  profileTokens: Record<TokenProfileRef, number>;   // estimator lenses
  usageActual?: TokenUsageActual;                    // provider-actual (llm steps)
  context?: ContextSnapshot;                         // snapshot after this step
  payload: unknown;                                  // redacted request/response/args/result
};
export type RunEvent =
  | { type: "status"; status: RunStatus; outcome?: RunOutcome; stopReason?: string }
  | { type: "step"; step: RunStep }
  | { type: "delta"; channel: "text" | "reasoning"; text: string }
  | { type: "kpi"; turns: number; toolCalls: number; tokensIn: number; tokensOut: number; contextTokens: number; costUsd: number }
  | { type: "error"; message: string };

export type RunSummary = {
  id: string; testId: string; scenarioId: string; mode: RunMode; status: RunStatus; outcome?: RunOutcome;
  startedAt: string; durationMs?: number; turns: number; toolCalls: number;
  peakContextTokens: number; tokensIn: number; tokensOut: number; costUsd: number;
};
export type RunDetail = RunSummary & { steps: RunStep[]; events: RunEvent[] };
export type RunStartRequest = { testId: string; scenarioId: string; mode: RunMode };
export type RunStartResponse = { runId: string; streamUrl: string };
export type CompareRow = RunSummary & { scenarioName: string; model: string };
```

## Design — schemas (sketch)
zod for every `*Input`/request body, mirroring `serverConfigInputSchema`:
`providerCredentialInputSchema`, `modelParamsSchema`, `guardrailConfigSchema`, `allowedServerSchema`,
`scenarioInputSchema` (+ `superRefine`: model non-empty; providerId resolvable),
`testInputSchema`, `runStartSchema` (`mode` ∈ RUN_MODES), `runTurnSchema` (`{ text }`).

## Acceptance
- `pnpm --filter @mcp-token-footprint/shared build` green; all new symbols exported from `index.ts`.
- A throwaway type-level check (or a tiny test) parses a valid `ScenarioInput`/`TestInput`/
  `RunStartRequest` with the zod schemas and rejects an invalid one.
- No `api`/`web` changes yet — this WP is the contract only.

## Notes
- Keep `payload`/`assertions` as `unknown` in the wire type; the API redacts and the UI renders via
  `CodeBlock`. Don't bake secret-bearing shapes into the contract.
