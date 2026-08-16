# 02 — Current architecture map (the template we clone)

Everything below is the *existing* MCP-server subsystem, captured with file/line anchors so the
Skills implementation is copy-and-adapt rather than invent. Verified 2026-07-01.

## Layering (per domain)

```
packages/shared/src/{types,schemas,constants}.ts   ← the wire contract (edit FIRST)
apps/api/src/db/schema.ts + database.ts            ← CREATE TABLE IF NOT EXISTS + additive migrations
apps/api/src/<domain>/repository.ts                ← better-sqlite3 CRUD, nanoid ids, secret enc/dec
apps/api/src/<domain>/service.ts                   ← orchestration (discovery, token counting, …)
apps/api/src/<domain>/routes.ts                    ← Fastify routes, zod .parse(), throw typed errors
apps/api/src/index.ts                              ← wire repos+services, register route plugins
apps/web/src/lib/api.ts                            ← apiGet/apiPost/apiPut/apiDelete wrappers
apps/web/src/components/AppShell.tsx               ← ViewKey + nav groups (side menu)
apps/web/src/App.tsx                               ← activeView switch, CRUD orchestration, toasts
apps/web/src/features/<domain>/*                   ← Rail (secondary nav) + Wizard + View components
```

## Database (`apps/api/src/db/schema.ts`, `database.ts`)

- Tables are created with `CREATE TABLE IF NOT EXISTS` executed on startup; **`applyMigrations(db)`**
  adds columns idempotently via an `ensureColumn(db, table, col, ddl)` helper. CHECK-constraint
  changes require the rename→recreate→copy dance (`widenRunStepsTypeCheck()` is the precedent).
- `openDatabase()` sets `WAL` + `foreign_keys` pragmas, then `db.exec(schemaSql)`, then migrations.
- **`mcp_servers`** (id, name, transport, command, args_json, url, headers_json, env_json,
  auth_type, auth_header_name, created_at, updated_at). Secrets (`env_json`, `headers_json`) are
  encrypted.
- Scan tables (`mcp_scans`, `mcp_tool_scans`, …) carry the **token accounting** columns
  (`total_tokens`, `name_tokens`, `description_tokens`, `schema_tokens`, `raw_bytes`,
  `contribution_percent`) — the vocabulary we reuse for skill files.
- IDs everywhere are `nanoid()` (21-char). Multi-table writes use `db.transaction(...)`.

## Repository / service / secrets

- `apps/api/src/servers/repository.ts` — `ServerRepository(db, secrets)` with
  `list/getPublic/getInternal/create/update/delete`. **Public vs internal split is the security
  seam:** `toPublicServer()` returns booleans (`hasEnvSecrets`, `hasHeaderSecrets`) never values;
  `toInternalServer()` decrypts for API-side use only.
- `apps/api/src/secrets/secret-store.ts` — **AES-256-GCM**, blobs prefixed `enc:v1:`, key from
  `MCP_SECRET_KEY` or auto-generated `DATA_DIR/mcp-secret.key`. Methods: `encryptText/decryptText`,
  `encryptJson/readJson`, `normalizeJson` (plaintext→re-encrypt migration). **Reuse verbatim** for
  GitHub credentials on private skill repos.
- `apps/api/src/scans/service.ts` — orchestrates discovery + token counting; the shape our
  `SkillIngestService` mirrors (parse → count tokens per component → persist aggregates).

## Routes & wiring

- `apps/api/src/servers/routes.ts` — `export async function registerServerRoutes(app, servers,
  scanService, oauthService)`; handlers call `schema.parse(request.body)` then the repo/service;
  `201` on create, `204` on delete.
- `apps/api/src/index.ts` — constructs repos+services then `await registerXxxRoutes(server, …)`.
  Central error handler maps `ZodError → 400`, else `statusCode`/500. **Add `registerSkillRoutes`
  here.**

## Shared contract (`packages/shared`)

- `types.ts` — `ServerConfigInput` (web→api) vs `ServerConfig` (api→web, redacted with
  `hasEnvSecrets`/`hasHeaderSecrets`), `ScanSummary`/`ScanDetail`/`ToolScan` with the
  `TokenBreakdown` mixin. Scenario types live here too (below).
- `schemas.ts` — zod: `serverConfigInputSchema` (with `.superRefine` for transport-specific required
  fields), `serverAuthInputSchema` (discriminatedUnion). Our `skillImportSchema` will likewise be a
  discriminated union on `source: 'upload' | 'github'`.
- `constants.ts` — enums (`TOKEN_PROFILES`, `DEFAULT_TOKEN_PROFILE`, transports, auth types).

## Web shell & navigation (`apps/web`)

- `components/AppShell.tsx` — `ViewKey` union (lines ~41–51) + two nav groups: primary
  `NAV_ITEMS` ("MCP analyzer": dashboard/servers/scans/compare) and `TESTING_NAV_ITEMS` ("Testing":
  scenarios/tests/runs/run-compare/compatibility). Sidebar is `@brand/ui`
  `Sidebar`/`SidebarMenu`/`SidebarMenuItem`. A **secondary rail** appears when a view passes
  `secondaryContent` (a right-hand `<aside class="w-72 …">`).
- `App.tsx` — `const [activeView, setActiveView] = useState<ViewKey>("dashboard")`; conditional
  `{activeView === "servers" ? <ServersView …/> : null}`. State is `useState` + `localStorage`
  (e.g. `mcp-token-footprint.selected-server`). Feedback via `pushToast(tone,title,detail)`.
- `lib/api.ts` — `apiGet/apiPost/apiPut/apiDelete<T>` thin `fetch` wrappers; `readResponse` throws
  `Error(payload.error ?? payload.message)` on non-2xx.
- MCP add/edit flow: `features/servers/ServerWizard.tsx` (multi-step `Dialog`:
  connection → auth → review), `ServerRail.tsx` (searchable list + add button + per-row actions),
  `ServersView.tsx` (detail with `Tabs`).

## UI primitives available for the inspector (verified in `vendor/brand-ui-agent-kit/`)

| Need | Component | Package |
|---|---|---|
| Folder/file explorer | `FileTree`, `FileTreeFolder`, `FileTreeFile`, `FileTreeName`, `FileTreeActions`, `FileTreeIcon` | `@brand/ai` |
| Side-by-side code diff | `DiffEditor` (Monaco) | `@brand/editor` |
| Code viewing | `CodeEditor` (read-only Monaco), `CodeBlock` (Shiki, read-only), `CodeWorkspace` | `@brand/editor` / `@brand/ai` |
| Markdown render (SKILL.md) | `MarkdownEditor` + `@brand/editor/markdown` primitives | `@brand/editor` |
| Split panes | `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle` | `@brand/ui` |
| Tabs / breadcrumbs / scroll | `Tabs`, `Breadcrumb`, `ScrollArea` | `@brand/ui` |
| Tables (versions, files) | `DataTable`, `SearchInput`, `FilterBar` + local `col()` helper | `@brand/data` |
| Metrics / viz | `MetricCard`, existing `TokenViz` (`SegmentedBar`, `RankedTokenList`) | `@brand/charts` / app |
| States | `StatePanel`, `EmptyState`, `Badge`, `StatusBadge`, `Descriptions`, `Alert` | `@brand/ui` |

Everything the "enterprise-grade inspector" needs already ships in the vendored `@brand/*` v1.6.0 —
**no new UI dependency required.** (New *API-side* deps are covered in [`06`](./06-ingestion-and-github.md).)

## Scenario attachment (Phase 2 template)

- DB (`schema.ts`): `scenarios` (+ `provider_id`, `model`, `tool_loading_mode`, …) and the join
  **`scenario_servers(scenario_id, server_id, allowed_tools_json, PRIMARY KEY(scenario_id,
  server_id))`** — `allowed_tools_json NULL = all tools`.
- Contract: `AllowedServer { serverId, allowedTools: string[] | null }` on
  `Scenario.allowedServers`; `allowedServerSchema` + `scenarioInputSchema` in `schemas.ts`.
- Repo: `apps/api/src/testing/scenario-repository.ts` — `replaceServers()` clears+reinserts the join
  inside the create/update transaction; `hydrate()` fills `allowedServers` from `listServers()`.
- Resolution: `scenario-service.ts` `resolveAllowedTools(scenarioId)` pulls each server's **latest
  scan** (`scans.getLatestForServer`) and intersects with the allow-list. Run engine
  (`run-service.ts` `resolve()`, `tool-bridge.ts` `buildTools()`) turns that into live MCP sessions.
- Web: `features/testing/ScenarioEditor.tsx` "Allowed servers & tools" panel + `AddServerModal.tsx`
  (two-step `Wizard`: pick server → pick tools). **No versioning exists today** — servers resolve to
  "latest scan," never a pinned one. Skills will *add* the version-pinning concept.
