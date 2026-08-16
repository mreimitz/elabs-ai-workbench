# Resource / prompt footprint (Round 4, `ui-findings4`)

Closes the last unbuilt **north-star #1** capability: a scan now captures **resources**, **resource
templates**, and **prompts** (definition footprint — token-counted, never executed), alongside tools.
Branch **`ui-findings4`** (off `origin/main` @ `5da8228`). Built **contract-first** across two reviewed
lanes, each in its own worktree, each gated + live-verified before merge.

Combined gate on `ui-findings4`: `typecheck` + `test` (**103/103**, +5 new) + `build` green;
`brand-ui audit apps/web/src` unchanged from baseline (3 issue(s)/14 advisory — all pre-existing
testing-subsystem; the new web files add **0**).

## Scope (owner-confirmed)

Definition footprint for **resources + prompts + resource templates**. **No execution** (no
`resources/read` / `prompts/get`) — that is the runtime analog, a later round. Resource *templates*
fold into the Resources surface via a `kind: "resource" | "template"` discriminator (one table, one
tab, a Type column) rather than a 4th surface.

## Lane 1 — backend (`ui/rp-api`)

Contract-first `packages/shared` → `apps/api` (mcp · token-counting · db · scans · reports) → tests.

- **Contract (additive):** `ResourceScan` (`kind`/`uri`/`name?`/`description?`/`mimeType?` + per-facet
  tokens `uriTokens/nameTokens/descriptionTokens/mimeTypeTokens` + `rawBytes` + `contributionPercent`),
  `PromptScan` (`promptName`/`description?`/`arguments?` + `nameTokens/descriptionTokens/argumentsTokens`
  …), `ResourceKind`. `ScanDetail` gains `resources[]` + `prompts[]`; `ScanSummary` gains
  `totalResources`/`totalResourceTemplates`/`totalPrompts`/`totalResourceTokens`/`totalPromptTokens` +
  largest-of-each. **`totalTokens` stays TOOLS-ONLY** (preserves compare deltas + existing dashboards);
  the full footprint = `totalTokens + totalResourceTokens + totalPromptTokens`, computed in the UI.
- **MCP discovery (`mcp/client.ts`):** one connection now also does `resources/list`,
  `resources/templates/list`, `prompts/list`, **capability-gated** off `client.getServerCapabilities()`
  — a server that doesn't advertise the capability is skipped (no call, no error); one that advertises
  but errors degrades to `[]` with a warning so tools still scan. Normalizers fold a template's
  `uriTemplate` into `uri`.
- **Token counting:** `countResourceDefinition`/`countPromptDefinition` added behind the `TokenCounter`
  interface, reusing the existing estimate helpers.
- **Persistence:** new `mcp_resource_scans` + `mcp_prompt_scans` tables + 9 additive `mcp_scans` summary
  columns, created on a fresh DB and **idempotently migrated** on an existing DB via the established
  `ensureColumn` pattern. Repository inserts/reads them in the same transaction as tools.
- **Reports:** the markdown scan report gains `## Resources` + `## Prompts` sections (only when
  non-empty); JSON already serializes the full `ScanDetail`.

### A regression the gate did NOT catch — found by live scan, fixed

`totalRawBytes` was extended to sum `jsonBytes()` over all four raw lists. For a server lacking a
capability the raw list is `undefined`, and `jsonBytes(undefined)` **throws** (`stableStringify(undefined)`
is `undefined`, not a string → `Buffer.byteLength(undefined)`), which **failed the entire scan for any
tools-only server** (e.g. `filesystem`). The `everything` server (all lists present) passed, so typecheck
+ unit tests were green and only a live scan surfaced it. Fixed by skipping absent lists (absent
capability ⇒ 0 bytes). This is exactly why the merge bar is *live verification*, not a subagent's PASS.

## Lane 2 — web (`ui/rp-web`)

- **Scans detail:** the per-scan table is now a `Tabs` — **Tools (N) · Resources (M) · Prompts (P)**.
  Resources tab: `DataTable` with Type (`Resource`/`Template` Badge) · Resource (`name ?? uri`, mono,
  truncating with the uri as a muted second line) · MIME · Tokens · Share. Prompts tab: Prompt · Tokens ·
  Args · Share. Real `StatePanel` empty states when a server exposes none. Shared column defs in
  `apps/web/src/features/scans/resourcePromptColumns.tsx`.
- **Servers:** new **Resources** + **Prompts** tabs (same tables) alongside Overview/Tools/Scans, plus
  Resources/Prompts `MetricCard`s in the overview KPI band.
- **Dashboard:** "Total startup tokens" now reflects the **full footprint** (tools + resources + prompts);
  a "Resources & prompts" KPI and a "Tools scanned" KPI were added (6-card grid).

## Live verification (seeded `:8099`, real stdio MCP servers, BOTH themes, screenshots eyeballed)

- **Capture (API):** scanning `@modelcontextprotocol/server-everything` captured **7 resources + 2
  templates + 4 prompts** (totalResourceTokens 310, totalPromptTokens 236), with correct per-facet
  breakdowns, the `kind` discriminator, template `uriTemplate`→`uri`, and contribution %.
- **Capability-gating:** `server-filesystem` (no resources/prompts capability) scans **successfully**
  with 0 resources/0 prompts (14 tools, 2403 tok — matches Round 3).
- **Migration:** pointed the build at the **Round-3 legacy DB** — it booted clean (9 columns + 2 tables
  added), and an old tools-only scan read back with `resources:[]`/`prompts:[]`/zeroed summaries.
- **Web (qlik-bright + qlik-dark):** Scans Tools/Resources/Prompts tabs; Servers Resources/Prompts tabs
  (a pre-feature scan correctly shows `(0)` + empty state); Dashboard footprint = **5,875** ("Tools +
  resources + prompts") and "Resources & prompts **9 / 4 · 546 tokens**". Type badges, MIME, tokens, and
  share all read cleanly with visible focus in both themes.
- **Reports:** the `everything` markdown report renders the `## Resources` + `## Prompts` sections.

## Known polish / not done

- **Minor:** the Scans-**detail** "Total footprint" MetricCard still shows the **tools-only** total
  (it predates this round). The Dashboard was updated to the combined footprint; the detail card should
  either be relabeled "Tool footprint" or show the combined total. Cosmetic, low-risk follow-up.
- **Out of scope (by design):** resource/prompt **execution** (runtime cost) and **cross-server compare**
  of resources/prompts (Compare stays tools-only). Both are natural next rounds.
- Web has no unit tests (pre-existing); the resource/prompt UI is verified live, not by a test.

## State

Nothing pushed from this branch yet; `main` untouched (`origin/main` stayed `5da8228` throughout).
`ui-findings4` is local: `5da8228 → backend lane (+fix) → web lane → this doc`. This round is independent
of Round 3 (PR #2): R3 touches compare + the delete dialog; R4 touches scans/servers/dashboard + the API.
