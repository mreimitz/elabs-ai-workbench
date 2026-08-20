---
type: "Work Package Spec"
title: "WP 5.1 \u2014 web.search / web.fetch built-ins (provider-native)"
description: "Phase: 5 \u00b7 Size: L \u00b7 Depends on: 1.1 \u00b7 Model: Opus \u00b7 Agent profile: API engine + security"
tags: ["roadmap", "RM-13"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 5.1 — `web.search` / `web.fetch` built-ins (provider-native)

**Phase:** 5 · **Size:** L · **Depends on:** 1.1 · **Model:** Opus · **Agent profile:** API engine + security

## Objective

Give hub sessions (and, via grants, mission agents) a real internet capability (D-HF2, revising
D-AH10): `web.search` backed by the provider's native web-search tool where the session's model
supports one, and `web.fetch` as a guarded server-side URL fetch. Grantable, off-switchable,
cost-visible, honest when unsupported.

## Why / evidence

`analysis.md` RC5: no web tool in `ALL_BUILTINS` (`builtins/index.ts:10-16`); `providerOptions()`
enables nothing beyond cacheControl/thinking (`providers/registry.ts:125-150`); the installed
`@ai-sdk/anthropic`/`openai`/`google` packages ship native web-search/grounding tools that are
never referenced. Owner expectation: "access to the internet like a normal claude session".

## Design

- **`web.search`:** per provider kind: anthropic ⇒ the SDK's server web-search tool; openai ⇒ its
  search tool; google ⇒ search grounding; openai_compatible/ollama ⇒ NOT offered (the tool is
  absent from the toolset, and the tools prompt layer says why when a scope requested it). Compose
  via the provider-tools seam so it coexists with MCP tools + WP 1.1's per-step gating. Provider
  search results must surface as hub citations (map the provider's citation payload into the
  existing citation apparatus; graceful when absent).
- **`web.fetch`:** app-level built-in: GET only, public http(s), SSRF guard (deny private/link-local/
  loopback ranges + re-resolve at connect), size cap + text extraction (reuse conventions from the
  scanner's fetch paths if present), output-cap spill via the existing wrapper.
- **Granting:** both ride `HubToolGrants.builtins` (scope picker + role Access tab list them);
  default-granted for new sessions ONLY when the model supports search (capability-derived), never
  silently for agents (planner must grant explicitly). Env kill-switch `HUB_WEB_TOOLS=off`.
- **Cost:** provider search billing noted per call into the usage sink + a per-turn count in usage
  views ("web searches: N").
- **Safety:** fetched content is untrusted data (the tools layer rule 5 already states it); fetch
  results pass through the output cap; no cookies/auth headers ever.

## Files (exclusive)

- New `apps/api/src/hub/tools/builtins/web.ts` (+ test), `builtins/index.ts`
- `apps/api/src/providers/registry.ts` (native tool factories per kind), `apps/api/src/hub/session-service.ts` + `turn-engine.ts` (composition seam; later batch than WPs owning those files)
- `packages/shared/src/types.ts` (builtin names/capability surface, additive), `apps/api/src/config/env.ts`, `.env.example`
- Tests: SSRF matrix (unit), provider gating matrix, citation mapping (stubbed), kill-switch, grant plumbing to a mission agent

## Acceptance

- [ ] Provider matrix test: anthropic/openai/google sessions expose `web.search`; compatible/ollama do not and the prompt says so when requested.
- [ ] SSRF guard blocks private/loopback/redirect-to-private (table-driven test); size cap + spill proven.
- [ ] Search results produce hub citations that weave as chips (with WP 3.1).
- [ ] `HUB_WEB_TOOLS=off` removes both tools everywhere incl. agents.
- [ ] A mission agent granted `web.search` uses it in the stubbed e2e path.
- [ ] Gate green.

## Notes / owner-acceptance

Live search against a real provider key (at least one provider) + spot-check of billing surface.
Provider tool option names MUST be verified against the installed SDK versions at implementation
time (spike first, like WP 1.1).
