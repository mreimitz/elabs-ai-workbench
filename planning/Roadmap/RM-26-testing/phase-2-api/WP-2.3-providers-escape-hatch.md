---
type: "Work Package Spec"
title: "WP 2.3 \u2014 Remaining providers + native escape hatch"
description: "Phase: 2 \u00b7 Size: M \u00b7 Depends on: 1.4"
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.3 — Remaining providers + native escape hatch

**Phase:** 2 · **Size:** M · **Depends on:** 1.4

## Objective
Make OpenAI, Google, OpenAI-compatible local, and Ollama work (decision #9), and surface Anthropic's
native context management (decision #3) via an escape hatch where the AI SDK doesn't expose it.

## Why / references
Scope decisions #9, #3. [`../references.md`](../references.md) → *AI SDK providers*, *Anthropic prompt
caching* (`cache_read_input_tokens`/`cache_creation_input_tokens`), *OpenTelemetry GenAI* (portable
usage names). Centralize all provider differences in two files only (per WP 0.2 isolation rule).

## Files
- `apps/api/src/providers/registry.ts` *(modify — add provider cases)*
- `apps/api/src/testing/accounting.ts` *(modify — per-provider usage mapping)*

## Design — registry cases
```ts
case "google":            return createGoogleGenerativeAI({ apiKey: cred.apiKey })(model);
case "openai_compatible": return createOpenAICompatible({ baseURL: cred.baseUrl!, apiKey: cred.apiKey })(model);
case "ollama":            return createOllama({ baseURL: cred.baseUrl ?? "http://localhost:11434/api" })(model);
```
- **Escape hatch:** a `providerOptions(cred, scenario)` builder injects provider-specific options
  (e.g. Anthropic `cacheControl`/thinking, or context-management beta) via the AI SDK's
  `providerOptions` passthrough. If a feature isn't exposed at all, drop to the native
  `@anthropic-ai/sdk` behind the same `engine.ts` seam — document any such case here.

## Design — usage normalization
Map each provider's usage fields to `TokenUsageActual`:
- OpenAI: `prompt_tokens`/`completion_tokens` (+ `prompt_tokens_details.cached_tokens`,
  reasoning tokens).
- Anthropic: `input_tokens`/`output_tokens` + `cache_read_input_tokens`/`cache_creation_input_tokens`.
- Google/Ollama: map available fields; if a provider omits a field, leave it `undefined` (the
  estimator lens always covers it).
Keep this mapping in one switch in `accounting.ts`.

## Implementation steps
1. Fill registry cases; ensure `openai_compatible`/`ollama` require a `baseUrl` (validate at create).
2. Extend usage mapping + `MODEL_CONTEXT_LIMITS` / `MODEL_PRICING` seeds for the added models.
3. Add the `providerOptions` builder + document the Anthropic native-context hook.

## Acceptance
- The WP 1.3 loop test runs green against **≥2** providers behind env-gated keys (skips when absent).
- Usage normalization unit-tested per provider with sample payloads (cached/reasoning where relevant).
- A local OpenAI-compatible/Ollama base-URL round-trips a simple generation (manual/integration).
- Gate green.
