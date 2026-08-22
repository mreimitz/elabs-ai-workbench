---
type: "Work Package Spec"
title: "WP 1.2 — Import MCP servers from config files, analyzer quick starts, research presets behind the Hub flag"
description: "Phase 1 of item.md. Ledger: STATUS.md. Adds an Import from config file path (claude_desktop_config.json, .mcp.json, Cursor mcp.json) to the Add-server wizard and the /servers empty state, replaces the wizard's first block with analyzer quick starts, and shows the Tavily/Brave/Exa research presets only while the assistant flag is on."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 1.2 — Import MCP servers from config files, analyzer quick starts, research presets behind the Hub flag

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

The Add-server wizard's Connection step (`apps/web/src/features/servers/ServerWizard.tsx:376-409`,
presets in `apps/web/src/features/servers/researchServerPresets.ts`), the `/servers` empty state
(`apps/web/src/features/servers/ServersOverview.tsx:337-353`), a new client-side parser
`apps/web/src/features/servers/config-import.ts`, the existing `POST /api/servers`
(`apps/api/src/servers/routes.ts:87`) and the spawn-error hints in `apps/api/src/mcp/connection-error.ts`.
The wire shape stays `ServerConfigInput` (`packages/shared/src/types.ts`: `transport`, `command`, `args`,
`env`, `url`, `headers`); no new API route. The self-mount preset is wp-1.1 action 7; the demo seed is
wp-1.1; flag defaults for fresh installs are wp-0.2/wp-0.1; the `uvx` runtime question for the image is
wp-0.3 — this WP only makes the wizard say what the container cannot run. Out of scope: new transports
(SSE entries are skipped with a reason), OAuth configuration import, and environment (scenario) import.

## Actions

1. **Gate the research presets on the `assistant` flag.** The "Quick start: research servers" block in
   `ServerWizard.tsx:376-409` renders only when `useFeatureEnabled("assistant")`
   (`apps/web/src/features/feature-flags/feature-flags-context.tsx:117`) is true; when shown it moves
   below the analyzer quick starts under the label "Research servers (for the Assistant)". With the flag
   off the wizard opens on the analyzer block. **P1**
2. **Analyzer quick starts** in a new `apps/web/src/features/servers/analyzerServerPresets.ts`, rendered
   first on the Connection step: "This workbench's own MCP server" (wp-1.1 action 7), then two or three
   `npx`-launchable reference servers (e.g. `@modelcontextprotocol/server-filesystem <dir>`,
   `@modelcontextprotocol/server-memory`), each prefilling transport, command, args and env variable
   NAMES only. A preset ships only if it starts inside the built image (`npx` only — the runtime image has
   no `python3`/`uvx`); the block's caption states that `npx` presets need network access on first start. **P1**
3. **"Import from config file…"** as the second entry on the Connection step and as a button on the
   `/servers` empty state beside "Add server" (order: Import from config · Add server · Load demo data).
   Opens a dialog that accepts pasted JSON or an uploaded file; `config-import.ts` parses the one shape
   all three sources share — `{ "mcpServers": { "<name>": { … } } }` from `claude_desktop_config.json`,
   Claude Code `.mcp.json` and `.cursor/mcp.json` — mapping `command`/`args`/`env` → `stdio`,
   `url` (+ `headers`, `type: "http"` or `"streamable-http"`) → `streamable_http`, and marking
   `type: "sse"` entries, entries without `command`/`url`, and duplicates of an existing server name as
   *skipped* with a one-line reason. **P1**
4. **Review table before import**: one row per entry (checkbox · name · transport · command or URL · env
   keys · status), all rows checked by default except skipped ones; env VALUES are masked in the table
   (`••••`) and stored only through the existing encrypted env path of `POST /api/servers` — never logged,
   never echoed back; a name collision with an existing server gets a `-2` suffix (editable); "Import n
   servers" posts sequentially and reports per-row success/failure inline; a "Scan after import" checkbox
   (default on) triggers the existing scan per created server. Entries whose command is `uvx` or
   `python` are marked "will not start in the container — use an `npx` command or a URL" and unchecked
   by default when `dockerMode` is true (`GET /api/health`). **P1**
5. **Spawn-error hint**: `connection-error.ts` maps `spawn <cmd> ENOENT` to "`<cmd>` is not installed
   where the workbench runs" + (in Docker) "this container ships `node`/`npx` only — use an `npx`
   command or a URL"; the wizard's error alert shows it verbatim. **P2**
6. **User guide**: `planning/user-guide/DC-02-mcp-servers/` gains "Import servers from a config file"
   (supported files, what is imported, what is skipped and why, where env values go) and the quick-start
   list; served in-image by wp-1.4. **P2**

## Acceptance

- [ ] With the `assistant` flag off, the wizard shows no Tavily/Brave/Exa preset and opens on the
      analyzer quick starts; with the flag on, the research presets appear below them (test both).
- [ ] Each shipped analyzer preset starts and scans green inside the built image (e2e, one per preset).
- [ ] Importing a fixture config with 3 stdio entries (one `uvx`), 1 `url` entry and 1 `sse` entry yields
      4 created servers (the `uvx` row unchecked by default in Docker mode, importable when checked
      outside it), 1 skipped row with its reason, and env values present in the DB only encrypted (test
      reads `servers` rows; a plaintext key value never appears in the DB, the response or the logs).
- [ ] The `/servers` empty state offers Import from config · Add server · Load demo data in that order
      and reads correctly in both themes at 1440×900.
- [ ] Name collisions are suffixed, not rejected; re-importing the same file creates nothing new
      (every row reads "already exists").
- [ ] `spawn uvx ENOENT` produces the action-5 sentence in the wizard alert (test on
      `formatConnectionError`).
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — one parser with fixtures, one dialog with a review table, a preset file and a copy change;
`POST /api/servers` and the scan trigger already exist.

## Sources

PO-06 · PO-07 · PS-22 (wizard leads with research presets) · MK-12 (a public reference server as a
first scan) · ENG-20 (no `uvx` in the runtime image → `npx`/URL presets and the ENOENT hint) ·
walkthrough `/servers` note (no import from `mcp.json` / `claude_desktop_config.json` / Cursor config) ·
presales B.3 question 4.
