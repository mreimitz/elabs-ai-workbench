---
type: "Work Package Spec"
title: "WP 1.1 — Demo seed + snapshot/restore + Load demo data + self-scan preset"
description: "Phase 1 of item.md. Ledger: STATUS.md. Builds RM-18 WP 1.1 as a concrete, neutral demo dataset that populates every screen of the 10-minute demo path from a fresh install, adds save/restore of the data volume, a Load / Remove demo data pair, and a wizard preset that scans the workbench's own MCP mount."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 1.1 — Demo seed + snapshot/restore + Load demo data + self-scan preset

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Builds **RM-18 WP 1.1** ("seeded demo content behind an explicit load action; guided empty states",
open in [`/Roadmap/RM-18-platform/STATUS.md`](/Roadmap/RM-18-platform/STATUS.md)) and keeps its three
invariants (labelled, removable in one action, never mixed with real data). RM-37 adds what RM-18 left
unspecified: the exact dataset (neutral names, below), the rule that every screen of the demo path
(wp-4.2) is populated by it, a snapshot/restore script for the data volume, the Load / Remove demo data
pair in Settings › Storage and on the first-run empty states, and a wizard preset for the workbench's
own MCP mount. Surfaces: `apps/api/src/db/` (seed + ledger table), a new `apps/api/resources/demo-server/`,
`apps/web/src/features/settings/SettingsView.tsx` (`StorageSection`),
`apps/web/src/features/dashboard/overview/OverviewTab.tsx:161-173`,
`apps/web/src/features/servers/ServersOverview.tsx:337-353`, `apps/web/src/features/servers/ServerWizard.tsx`,
`scripts/`. Out of scope: analyzer quick starts and config import (wp-1.2), illustrations on the same
empty states (wp-4.3), the inline ⓘ sentence rewrite (wp-3.3), screenshots taken from the seed (wp-4.2),
the pre-flight panel that links here (wp-1.4), any Hub sample session (the Hub is off by default, wp-0.1).

## Actions

1. **Bundle a demo stdio server** at `apps/api/resources/demo-server/index.mjs` (same shape as the test
   fixture `apps/api/test/fixtures/echo-mcp-server.mjs`; `@modelcontextprotocol/sdk` is already an API
   runtime dependency; the `Dockerfile` already copies `apps/api/resources`). Name `demo-catalog`, twelve
   tools in a neutral retail domain: `catalog_list_products`, `catalog_get_product`, `catalog_search`,
   `inventory_get_stock`, `inventory_set_threshold`, `orders_list`, `orders_get`, `orders_create`,
   `orders_cancel`, `customers_search`, `customers_get_notes`, `reports_sales_summary`. Deliberate material
   for the analyzers: `reports_sales_summary` carries a ~1,200-token description and a deep schema (the
   largest tool); `inventory_set_threshold` declares `readOnlyHint: true` while it mutates (one true
   annotation finding); `orders_cancel` returns an error for shipped orders; `DEMO_CATALOG_VERSION=1`
   serves ten tools (no `customers_*`) so two scans differ. No network, no credentials. **P0**
2. **Seed loader** `POST /api/demo/load` and `POST /api/demo/remove` (new `apps/api/src/db/demo-seed.ts`):
   every inserted row id is written to a `demo_seed_rows(table, id)` table (next migration); every seeded
   name carries the prefix `Demo —` or the word `demo`; `remove` deletes exactly the ledgered rows through
   the existing delete cascades and refuses when a ledgered row was edited after load (`updated_at` newer)
   unless `?force=1`. Loading twice is a no-op. Rows not in the ledger are never touched. **P0**
3. **Dataset contents** (the whole of it; nothing copied from the owner's instance):
   - Servers: `demo-catalog` (stdio, the bundled server) and `Demo — workbench` (URL, the app's own
     `/api/mcp` mount, 24 tools, scanned live at load; needs the `mcp_server` flag, on by default).
   - Scans: `demo-catalog` scanned twice at load (`DEMO_CATALOG_VERSION=1`, then `2`: 10 → 12 tools, a
     positive Δ) plus one live scan of the workbench mount; scan dates are real (load time).
   - Skill: `demo-catalog-analyst` (upload source; SKILL.md with two keyword triggers and a
     `/catalog-report` command; references four `demo-catalog` tools; no scripts, no network references).
   - Environment: `Demo — catalog` on credential `Demo provider (recorded runs only)` (kind
     `openai_compatible`, no key, model `demo-model` with its own pricing row so costs render in `$`);
     loads `demo-catalog` (all tools) + the skill, eager tool loading.
   - Collection `Demo` with two tests: "Which products are below their stock threshold, and what would it
     cost to restock them?" and "Cancel order 1042 and confirm the refund."
   - Suite `Demo suite` (2 tests × 1 environment × 1 rep), one completed suite run; child run A completed
     and rated (Answered 1.00 · Valuable 0.80 · judge 0.8; 7 turns, 6 tool calls over 5 distinct tools,
     ~68 % cache reads, $0.31); child run B completed with one error (`orders_cancel` → "order 1042 has
     already shipped"), answered, judge 0.6.
   - Issue: one open issue "Recurring mcp server on demo-catalog — orders_cancel" with two occurrences
     and a drafted fix (return a structured `already_shipped` result instead of an error).
   - Advisor (computed on read, not seeded): the unused-tool-trim card "Trim 7 never-called tools from
     demo-catalog" follows from runs A/B; the heavy-definition card follows from `reports_sales_summary`.
   Runs, steps, grades and the issue are inserted as finished rows from
   `apps/api/resources/demo-server/seed.json`; nothing executes a model at load. **P0**
4. **What each demo-path screen shows with the seed** (wp-4.2's pre-flight reads this list):
   `/dashboard` — 2 servers · 36 tools, Needs you = 1 open issue, top recommendation = the trim card,
   footprint table with both servers and a Δ; `/servers` — two scanned cards, no failed/unscanned card;
   `/servers/:id` (demo-catalog) Overview — startup tokens, top-3 share, recoverable, findings including
   the annotation finding; Issues — the one issue with its draft fix; `/advisor` — the trim card first;
   `/skills/:id` — footprint tiles, clean security surface, Usage with 2 runs; `/testing/runs` — 1 suite
   run + 2 child runs, no 0-cell row; `/testing/runs/:id` (run A) Chat and Report — rated;
   `/dashboard?tab=testing` — 2 runs inside the default window. **P0**
5. **Load / Remove demo data in the UI**: Settings › Storage (`StorageSection` in `SettingsView.tsx`)
   gains a "Demo data" block (state: not loaded / loaded on <date>; Load · Remove with a confirm); the
   dashboard first-run state (`OverviewTab.tsx:161-173`) and the `/servers` empty state
   (`ServersOverview.tsx:337-353`) gain a secondary "Load demo data" button beside the primary action; a
   `Demo` chip renders on every seeded server card, skill card, collection and environment row. **P0**
6. **Snapshot / restore** `scripts/demo-snapshot.sh save|restore <name>`: copies `app.sqlite` (+ `-wal`,
   `-shm`) and `mcp-secret.key` from the data directory (`DATA_DIR`, default `./data`) or from the Docker
   volume `mcp-token-footprint-data` (`docker run --rm -v <volume>:/data -v "$PWD/snapshots":/backup
   alpine tar …`, the recipe ENG-06 asks for) into `snapshots/<name>/`; `restore` stops the container,
   copies back, restarts, and prints the md5 of both files. The same two commands for Windows go into
   `scripts/release/README.md` under a new "Back up / restore" heading. **P1**
7. **Wizard preset "Scan this workbench's own MCP server"** as the first quick start on the Connection
   step of `ServerWizard.tsx`: prefills transport URL with the mount URL the API reports in
   `GET /api/health` as `selfMcpUrl` (`http://127.0.0.1:<listen port>/api/mcp`, loopback, no credential)
   and the name `workbench`, then "Test & continue" → "Scan now"; hidden while the `mcp_server` flag is
   off. The reference-server presets beside it are wp-1.2. **P1**
8. **Fixture hygiene test**: a test greps `seed.json`, the demo server source and the demo SKILL.md for
   tenant hostnames, person names, tunnel hostnames, the owner's vendor prefix, server names and run ids
   (the pattern list lives in the test, not in this spec); any hit fails the suite. **P1**

## Acceptance

- [ ] Fresh DB → Settings › Storage › Load demo data completes in ≤ 60 s and every screen in action 4
      shows the listed content (e2e over the built image, both themes).
- [ ] Remove demo data returns every main view to its empty state; `demo_seed_rows` is empty; a real
      server registered before the load is untouched (test).
- [ ] The `Demo` chip is visible on every seeded card/row; no seeded name lacks the prefix (test).
- [ ] The hygiene test (action 8) passes; the seed contains no hostname, person name or id from the
      owner's instance.
- [ ] `demo-snapshot.sh save` then `restore` reproduces both files byte-identical (md5 printed; e2e on a
      throwaway volume); documented for macOS, Linux and Windows in `scripts/release/README.md`.
- [ ] The self-scan preset yields a scanned server with 24 tools in ≤ 15 s on the container.
- [ ] RM-18's owner-acceptance line ("fresh install → load demo data → every main view populated →
      remove → clean empty states") is walkable and is listed in wp-4.1.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — a small MCP server, a JSON fixture with two recorded runs, one migration, two UI blocks and a
shell script; the advisor, issues and grading stacks already compute from the rows.

## Sources

PO-05 · PS-21 · PS-22 (self-mount preset) · PS-02 (neutral data; masking live data for a demo stays
with wp-4.2) · MK-12 · PO-33 (the Load-demo action on empty states; the inline ⓘ sentence is wp-3.3) ·
PO-34 (illustrations on the same empty states → wp-4.3) · RM-18 WP 1.1 invariants.
