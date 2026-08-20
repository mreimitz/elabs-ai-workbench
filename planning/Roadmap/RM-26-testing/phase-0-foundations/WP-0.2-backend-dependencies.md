---
type: "Work Package Spec"
title: "WP 0.2 \u2014 Backend run-engine dependencies"
description: "Phase: 0 \u00b7 Size: S \u00b7 Depends on: \u2014 \u00b7 Owner action: approve adding ai + @ai-sdk/."
tags: ["roadmap", "RM-26"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 0.2 — Backend run-engine dependencies

**Phase:** 0 · **Size:** S · **Depends on:** — · **Owner action:** approve adding `ai` + `@ai-sdk/*`.

## Objective
Add the Vercel AI SDK spine and the provider adapters that the run engine (WP 1.3, 2.3) uses. Scope
decision #10 chose "AI SDK + native escape hatches."

## Why / references
The AI SDK gives one TS abstraction over all five providers with streaming, a multi-step tool loop,
and per-step `usage`. See [`../references.md`](../references.md) → *AI SDK — Tool Calling* and *Loop
Control*. SSE is implemented on raw Fastify (WP 2.2) — **no SSE dependency**.

## Files
- `apps/api/package.json` *(modify — add dependencies)*

## Design / implementation steps
1. Add to `apps/api/package.json` dependencies using **caret ranges**, consistent with the rest of
   the repo (`fastify ^5.1.0`, `zod ^3.24.1`, `@modelcontextprotocol/sdk ^1.12.1`). The committed
   `pnpm-lock.yaml` is what makes installs reproducible; the caret keeps you on the current major so a
   breaking new major isn't pulled in automatically (bump deliberately via `pnpm update`). **Do not
   pin exact versions** — it's inconsistent with the repo and the lockfile already handles
   reproducibility. The real upgrade insulation is the isolation seam in step 3, not the version
   string:
   - `ai` (core: `streamText`, `tool`, `jsonSchema`, `stepCountIs`)
   - `@ai-sdk/anthropic`
   - `@ai-sdk/openai`
   - `@ai-sdk/google`
   - `@ai-sdk/openai-compatible` (local OpenAI-compatible endpoints)
   - an Ollama provider (`ollama-ai-provider` or the OpenAI-compatible endpoint — decide in WP 2.3)
2. `pnpm install` from the repo root.
3. Keep all AI SDK imports behind `apps/api/src/providers/registry.ts` and
   `apps/api/src/testing/engine.ts` (WP 1.1/1.3) so a future SDK upgrade touches two files.

## Acceptance
- Packages install; `pnpm --filter @mcp-token-footprint/api build` green.
- A smoke unit test (`apps/api/test/ai-sdk-smoke.test.ts`) calls `generateText` against Anthropic and
  asserts a non-empty result **and** a populated `usage`. Guard it with
  `if (!process.env.ANTHROPIC_API_KEY) return;` so CI without a key skips cleanly (follow the
  node-test style in `apps/api/test/`).

## Notes
- Note the installed version range here once added, so the engine WPs target a known API surface;
  bump it deliberately via `pnpm update`, never automatically.
- Zod is already `^3.24`; the AI SDK's `jsonSchema()` helper lets us pass MCP `inputSchema` straight
  through without re-deriving zod (WP 1.3).
