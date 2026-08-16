# WP 2.1 — Scenario & Test CRUD (+ attachments)

**Phase:** 2 · **Size:** L · **Depends on:** 0.3, 0.4

## Objective
Manage the harness (Scenario) and the reusable workloads (Test), including the server/per-tool
allow-list, profile inheritance, system-prompt override, and attachments.

## Why / references
Scope decisions #5 (matrix → Test is first-class, reusable), #6 (server-first then per-tool),
#7 (profiles: scenario default + test adds), #13 (system prompt inheritance), #14 (prompt +
attachments). Contract from WP 0.3; tables from WP 0.4. Layering per `conventions.md`.

## Files (new unless noted)
- `apps/api/src/testing/scenario-repository.ts`, `scenario-service.ts`
- `apps/api/src/testing/test-repository.ts`, `test-service.ts`
- `apps/api/src/testing/routes.ts` *(shared with WP 2.2 run routes — or split files, both registered together)*
- `apps/api/src/config/env.ts` *(modify — add `ATTACHMENTS_DIR`, default `DATA_DIR/attachments`)*
- `apps/api/src/index.ts` *(modify — construct + register)*

## Design — resolution helpers (used by the run engine)
- **Effective tool set:** for each `scenario_servers` row, take all the server's scanned tools, then
  intersect with `allowed_tools_json` (null = all). Expose `resolveAllowedTools(scenarioId)` →
  `{ serverId, tools: NormalizedToolDefinition[] }[]`.
- **Effective profiles:** `scenario.defaultProfiles ∪ test.addedProfiles` (dedupe).
- **System prompt:** `test.systemPromptOverride ?? scenario.systemPrompt`.
These are unit-tested here and consumed by WP 1.3.

## Routes
```
GET/POST /api/scenarios            PUT/DELETE /api/scenarios/:id
GET/POST /api/tests                PUT/DELETE /api/tests/:id
POST     /api/tests/:id/attachments    # multipart; store under ATTACHMENTS_DIR/<id>
```
Validate bodies with `scenarioInputSchema` / `testInputSchema` (WP 0.3). Scenario writes also upsert
`scenario_servers` rows.

## Attachments
- Store the blob at `ATTACHMENTS_DIR/<attachmentId>`; row in `test_attachments` with `kind/name/
  path/bytes`. v1: text/file first; images allowed but only meaningful for multimodal models (counted
  per that model's rules, WP 1.4/2.3).
- Multipart: add `@fastify/multipart` **only if** needed (owner-gated dep); otherwise accept base64 in
  JSON for v1 to avoid a new dependency — decide and record here.

## Implementation steps
1. Repositories (SQL for scenarios + `scenario_servers` join + tests + attachments) and services.
2. Routes (thin) registered in `index.ts` next to the existing ones.
3. Resolution helpers + their unit tests.

## Acceptance
- CRUD round-trips for scenarios (with allow-list) and tests (with attachments).
- `resolveAllowedTools` returns exactly the selected tools; flipping a per-tool toggle changes the
  set; `null` means all.
- Effective-profiles and system-prompt resolution unit-tested.
- Gate green.
