# Resource / prompt execution (Round 5, `ui-findings5`)

Extends the **tool playground** (north-star #5) to MCP **resources** and **prompts**: read a
resource (`resources/read`) and get a prompt (`prompts/get`) on the live server, show the result,
and **measure the runtime request/response token cost** — the read-only analog of `tools/call`.
Branch **`ui-findings5`** (off `ui-findings4`, i.e. stacked on Round 4's resource/prompt footprint).
Built **contract-first** across two reviewed lanes, each gated + live-verified before merge.

Combined gate on `ui-findings5`: `typecheck` + `test` (**111/111**, +8 schema tests) + `build` green;
`brand-ui audit apps/web/src` unchanged from baseline (the new web files add **0** findings).

## Why this round (and why off `ui-findings4`)

Both candidate follow-ons depend on Round 4's resource/prompt data. **Execution** depends only on R4
and never touches `CompareView`, so it stacks cleanly on `ui-findings4`. (Resource/prompt **compare**
would need *both* R3's compare-depth and R4 — a 3-way base — so it's deferred to a later round.) Both
ops are **read-only** (no side effects), so no destructive-confirm is needed.

## Lane 1 — backend (`ui/exec-api`)

A faithful mirror of the existing `ScanService.callTool` / `POST /api/servers/:id/tools/:toolName/call`.
- **Contract (additive):** `resourceReadRequestSchema` (`{ uri, tokenProfile? }`), `promptGetRequestSchema`
  (`{ arguments: Record<string,string>, tokenProfile? }`), and `ResourceReadResult` / `PromptGetResult`
  types mirroring `ToolCallResult` (`isError`, `durationMs`, `tokenProfile`, `requestTokens/Bytes`,
  `responseTokens/Bytes`, `raw`, `errorMessage?`; resource adds `uri`/`contents`, prompt adds
  `promptName`/`description?`/`messages`).
- **MCP client (`mcp/client.ts`):** `readResource(config, uri)` → `client.readResource({ uri })` and
  `getPrompt(config, name, args)` → `client.getPrompt({ name, arguments })`, connect-once-per-call like
  `callTool`.
- **Service (`scans/service.ts`):** `readResource(...)` / `getPrompt(...)` measure request tokens
  (`countJson` of the request payload) + response tokens (`countJson` of `contents`/`messages`), duration,
  `isError`, with a try/catch that surfaces `errorMessage`. **No persistence** (ephemeral, like the tool call).
- **Routes:** `POST /api/servers/:id/resources/read`, `POST /api/servers/:id/prompts/:name/get`.
- **Tests:** +8 (`exec-schemas.test.ts`) on the two request schemas. The read/get MCP integration is
  live-verified (mirroring how `callTool` is verified — there is no MCP-mock unit harness).

## Lane 2 — web (`ui/exec-web`)

- **`ResourcePromptRun.tsx`** — `ResourceReadDialog` (single-column; auto-reads on open, Re-read button)
  and `PromptGetDialog` (split: a **string-only args form** parsed from the prompt's declared arguments,
  required-first with validation + focus-first-error, mirroring `ToolRunDialog`). Both render the result
  in the read-only Monaco `CodeEditor`, an ok/error `Badge`, a copy button, an error `Alert`, and a
  footer of KPI chips: **Tokens sent · Tokens received · Round-trip · Duration**.
- **Launch points:** `resourcePromptColumns.tsx` became factory functions that append a trailing
  **Read**/**Get** action button when a handler is passed; wired in the Scans-detail and Servers
  Resources/Prompts tabs. **Resource templates show no Read button** (a `uriTemplate` can't be read
  without argument expansion the API doesn't do).

## Live verification (seeded `:8099`, real `everything` server, BOTH themes, screenshots eyeballed)

- **API round-trips:** `resources/read` on `…/architecture.md` → markdown content, req 16 / resp 398 tok.
  `prompts/get` `simple-prompt` (no args) → 1 message, 19/41 tok. `completable-prompt` **with**
  `{department:Engineering, name:Ada}` → message *"Please promote Ada to the head of the Engineering
  team."* (args interpolated), 33/44 tok. Missing-required-args → the server's `-32602` surfaces as
  `isError` + `errorMessage` (not swallowed).
- **Web (qlik-bright):** Resources tab → **Read** opens the dialog, auto-reads, shows the JSON contents +
  KPI footer (16 sent / 398 received / 414 round-trip / 1,480 ms). Prompts tab → **Get** on `simple-prompt`
  → "This prompt takes no arguments." + messages + KPIs (19/41/60/905 ms).
- **Web (qlik-dark):** `completable-prompt` Get → the required `department`/`name` form (badges + help
  text + focus ring) renders cleanly; filling Engineering/Ada and getting shows the interpolated message +
  KPIs (33/44/77/895 ms). Both themes read correctly with visible focus.
- **Template opt-out:** the Resources tab shows **7 Read buttons** for 9 resources (the 2 templates have none).

## Notes / out of scope

- **No persistence** of read/get results (ephemeral, like the tool playground). Untrusted output is rendered
  read-only, never evaluated; no secrets are involved (resource URIs + string prompt args).
- Deferred: resource/prompt **cross-server compare** (needs R3+R4 combined); persisting an execution history.

## State

Nothing pushed from this branch yet; `main` untouched (`origin/main` stayed `5da8228`). `ui-findings5` is
local, stacked on `ui-findings4` (R4 / PR #3): `…R4 → backend lane → web lane → this doc`. It composes with
R4 (the resource/prompt rows it launches from) and does not overlap R3 (PR #2).
