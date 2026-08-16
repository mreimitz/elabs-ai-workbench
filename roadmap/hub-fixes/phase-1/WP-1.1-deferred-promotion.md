# WP 1.1 — deferred-tool promotion + `auto` loading policy

**Phase:** 1 · **Size:** L · **Depends on:** — · **Model:** Opus · **Agent profile:** API engine

## Objective

Make deferred loading real: a `tool_search` hit becomes **callable in later steps of the same
turn**. Flip the default loading policy to `auto` (eager when the granted catalog fits a token
threshold, deferred-with-promotion otherwise). This kills RC1.

## Why / evidence

`analysis.md` RC1. Today `mcpResident = mcp.filter(isPinned)` with no pins ⇒ `[]`
(`apps/api/src/hub/tools/registry.ts:69-71`; no `alwaysLoad` passed at
`session-service.ts:626-633`); only `mcpResident` becomes callable (`session-service.ts:664-689`);
`tool_search` returns definitions as data only (`tool-search.ts:8-11, 70-74`); `providerTools` is
built once per turn (`turn-engine.ts:703`, used at `:1029`). Live proof: `/context` shows
`mode:"deferred"`, `resident: []`.

## Design (D-HF1)

- **Registry:** in deferred mode, build ALL granted MCP tools into the AI-SDK tool map (they are
  already connection-backed via `resolveHubMcpGrants`), but partition names into `resident`
  (pinned, none today) and `deferred`. The toolset gains `deferredNames: Set<string>` and a
  per-turn `promoted: Set<string>`.
- **Turn engine:** use the installed AI SDK's per-step tool gating (`ai@^7`: `prepareStep` /
  `activeTools` on `streamText`; verify the exact option name against the installed version first).
  Active tools per step = built-ins + genui + skills + resident + `promoted`. `tool_search.execute`
  adds its match names to `promoted` (cap by `HUB_TOOL_PROMOTE_MAX_TOKENS`, default ~20k, so one
  search cannot blow the context; over-cap matches are returned as data with a "narrow your query"
  note).
- **`auto` policy:** `resolveToolLoading` preference `auto` resolves `eager` when total granted
  catalog tokens ≤ `HUB_TOOL_EAGER_MAX_TOKENS` (new env, default 40_000), else `deferred`. Code
  default for `HUB_TOOL_LOADING_DEFAULT` flips `deferred` → `auto` (`config/env.ts:273-276`).
- **Prompt:** the deferred note in `prompting/layers/tools.ts:20` becomes true ("after `tool_search`,
  matching tools become callable"). No other prompt change here (WP 1.4 owns the list compression).

## Files (exclusive)

- `apps/api/src/hub/tools/registry.ts`, `tool-search.ts`, `loading.ts`, `types.ts`
- `apps/api/src/hub/session-service.ts`, `apps/api/src/hub/turn-engine.ts`
- `apps/api/src/config/env.ts`, `.env.example` (new envs; coordinate with WP 0.1's comment)
- `apps/api/src/hub/prompting/layers/tools.ts` (the one deferred-note sentence only)
- New/updated tests: `session-service.hub-mcp-grants.test.ts` (+ a deferred-callability suite), `tool-search.test.ts`, turn-engine step-gating test

## Implementation steps

1. Verify the per-step tool-gating API in the installed `ai` package (write a 5-line spike test).
2. Registry partition + toolset shape (shared types untouched; this is server-internal).
3. Turn-engine `prepareStep` wiring + promotion set; token-cap guard in `tool_search.execute`.
4. `auto` policy + env plumbing + default flip.
5. Tests, incl. THE missing one: deferred session + grant → first step has no `qlik_*` active →
   `tool_search("qlik")` → next step calls the promoted tool successfully (stub MCP session).

## Acceptance

- [ ] Deferred-mode callability test passes (search → promoted → called → result persisted as `tool_call`/`tool_result` events).
- [ ] Promotion cap enforced + tested; ungranted tools can NEVER be promoted (negative test).
- [ ] `auto` threshold test (small catalog ⇒ eager; large ⇒ deferred) + default flip test.
- [ ] Eager-mode behavior byte-compatible (existing grant tests untouched and green).
- [ ] `/context` inspector still reports resident/deferred truthfully (promoted tools count as resident-for-this-turn is OUT of scope; note it).
- [ ] Gate green.

## Notes

Keep `formatToolListText` semantics unchanged here (WP 1.4 depends on this WP and owns it).
If the installed SDK lacks per-step gating, fall back to: rebuild the toolset and re-issue
`streamText` at the promotion boundary (the engine already loops passes for steering); document
which path was taken in the WP report.
