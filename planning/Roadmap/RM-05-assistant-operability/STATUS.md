---
type: "Status Ledger"
title: "Assistant operability \u2014 work-package status ledger \u00b7 PRIORITY: HIGH"
description: "Living state for the assistant-operability plan, read and updated by"
tags: ["roadmap", "RM-05"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---
# Assistant operability — work-package status ledger · **PRIORITY: HIGH**

Living state for the **assistant-operability** plan, read and updated by
`/next-wp assistant-operability`. A box is ticked **only** when the WP's Acceptance is met and the
gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/assistant-operability/<id>`.

> Plan + invariants + decisions D-AO1–D-AO6 in [`README.md`](./item.md). No DB migration expected
> (pure shared registry + api test + read tools + docs); if one becomes necessary, claim the next free
> `user_version` via the cross-workstream decision-log convention (check `apps/api/src/db/database.ts`
> AND sibling `roadmap/*/STATUS.md` ledgers). **Do not** touch the frozen `ASSISTANT_ENTITY_KINDS` /
> write-scope maps (D-AO3).

## Phase 1 — Contract & gate
- [x] WP 1.1 — route manifest (`assistant-route-manifest.ts`) + operability gate test (A/B/C); all current routes declared (surfaces + exemptions + redirects, hub rows initially `exempt`) → green baseline — done 2026-07-26 · wp/assistant-operability/1.1
- [x] WP 1.2 — `.claude/rules/assistant-operability.md` hard rule + `CLAUDE.md` registration (§10 map + capability row + SoT list) — done 2026-07-26 · wp/assistant-operability/1.2

## Phase 2 — Hub context-awareness
- [x] WP 2.1 — `agents`/`hub` starter surfaces (shared) + `isScopableSurface` fix (api) + catalog-test extension; flip hub manifest rows `exempt`→surface — done 2026-07-26 · wp/assistant-operability/2.1

## Phase 3 — Full operability
- [x] WP 3.1 — hub read tools `hub_agents_list`/`hub_crews_list`/`hub_usage_summary` + name registry + deps wiring + inventory tests — done 2026-07-26 · wp/assistant-operability/3.1
- [x] WP 3.2 — "Ask the assistant" page-hook in Workforce view / agent+crew profile modals (`openAssistant({prompt})`) — done 2026-07-26 · wp/assistant-operability/3.2

## Phase 4 — Hardening (optional)
- [x] WP 4.1 — PostToolUse `enforce-assistant-operability.mjs` edit-time nudge + settings wiring (non-blocking) — done 2026-07-26 · wp/assistant-operability/4.1
- [x] WP 4.2 — upgrade selected exemptions to real surfaces (`/reports/scans/:scanId`→scan pin; `/testing/environments` **deferred** — needs URL-encoded selection) — done 2026-07-26 · wp/assistant-operability/4.2

## Phase 5 — Hub WRITE operability (owner-requested 2026-07-26)
> Symptom: on `/assistant/agents` the (now context-aware) dock still REFUSES "create the crew and the
> agents" — Phases 1–4 made the Hub aware + read/analysis-capable, not write-capable. Fix per **D-AO7**:
> add hub create/update WRITE tools as **scope-exempt, approval-gated ACTION tools** (the existing
> `mcp_tool_call`/`rating_issue_file` / issue-loop pattern) — **NOT** new `agent`/`crew` entity kinds
> (the frozen `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS` boundary stays untouched, D-AO3 intact).
- [x] WP 5.1 — `hub_agent_create` / `hub_agent_update` / `hub_crew_create` / `hub_crew_update` scope-exempt approval-gated action tools (reuse the shared `hubAgentRoleInputSchema`/`hubCrewInputSchema`/patches + `HubRepository.create/updateAgentRole`/`create/updateCrew`), wired into `buildAssistantToolDefinitions` + `SCOPE_EXEMPT_ACTION_TOOLS` + the scope/classifier consistency tests; direct-handler + gating tests — done 2026-07-26 · wp/assistant-operability/5.1 (adversarial security review clean — no approval/validation/scope bypass)

## Decision log
_Entries: date · decision · rationale._ Kickoff locks D-AO1–D-AO6 here (see README). Owner confirmed
2026-07-26: rule + gate + backfill; hard CI/test gate; full-operability Hub depth.

- **D-AO7 · 2026-07-26 · Hub WRITE operability via scope-exempt gated ACTION tools, NOT new entity
  kinds (owner-requested).** Phases 1–4 made the dock aware + read-capable but it still refuses to
  create/edit agents & crews from `/assistant/agents` (unpinned → the general write tools hard-deny,
  and no agent/crew write tools existed). Add `hub_agent_create`/`hub_agent_update`/`hub_crew_create`/
  `hub_crew_update` as **scope-EXEMPT, approval-gated** action tools — the exact `mcp_tool_call` /
  `rating_issue_file` / issue-loop precedent (`SCOPE_EXEMPT_ACTION_TOOLS`, page-scope-lock exempt,
  still D-AS4 approval-gated). They **reuse** the shared route schemas + `HubRepository` methods (no
  reinvented validation). This satisfies "operate the current feature" WITHOUT expanding the frozen
  `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS` security vocabulary (D-AO3 intact) — the deferred
  "upgrade path" from D-AO3, done the low-risk way. Hard-DELETE deliberately NOT added (create/update
  only; deletes stay a UI action per D-AS4's "deletes always ask" caution).

- **2026-07-26 · ALL 7 WPs done + merged to `main` (tip after WP 4.2).** Full gate green throughout
  (final: typecheck · test shared 82 / api 3085 / web 3010 · build · lint 1441). Only owner-acceptance
  (the running-app two-theme walk, below) remains.
- **2026-07-26 · WP 4.2 · owner-scoped to the `/reports/scans/:scanId` → scan-pin upgrade ONLY.** The
  `/testing/environments` half is DEFERRED: that view holds its selection in React state, not the URL,
  so a per-entity pin needs a separate URL-encoding feature first. `resolveEntityPin` now pins
  `/reports/scans/:scanId` to the EXISTING `scan` kind (prefix-safe — never collides with `/scans/` or
  `/reports/digest/`); the manifest row flipped `global`+exempt → `{surface:"scan", pin:"scan"}` (not
  addressable — the `scan` UI view still maps only to `/scans/:scanId`). Gate test files were NOT
  edited — the resolver+manifest change alone turns Test C-web green for the new pin.

- **2026-07-26 · WP 1.1 · the gate is SPLIT across the package boundary, not one api test.** The plan
  sketched a single `apps/api/test/assistant-route-operability.test.ts` reconciling the manifest with
  `resolveStarterSurface` **and** `resolveEntityPin`/`ASSISTANT_UI_VIEWS`. But `resolveEntityPin` /
  `deriveAssistantEnvelope` live in `apps/web` as a React `.tsx` — a node-runner api test may not import
  them (architecture.md forbids api↔web source imports; the runner can't load `.tsx`). So Test C is
  split: the **api** gate covers A (coverage), B (operability), C-surface (`resolveStarterSurface`) +
  addressable↔`ASSISTANT_UI_VIEWS`; a **web** vitest sibling (`apps/web/.../assistant-route-operability.test.tsx`)
  covers C-pin (`deriveAssistantEnvelope`). Both run inside `pnpm test`; the manifest is pinned to
  BOTH live resolvers. Rationale: enforce the full invariant without breaking the package boundary.
- **2026-07-26 · WP 1.1 · manifest = 41 entries** (40 App.tsx routes + the `/settings/:section`
  known-extra, a `matchPath` modal not a `<Route>`). `collection` is pinned but **not** addressable
  (no `collection` member in `ASSISTANT_UI_VIEWS`); the 7 addressable views are exactly the registry.
  Gate proven to bite (bogus route → Test A fails; global-without-exempt → Test B fails), then reverted.
- **2026-07-26 · WP 3.2 · the Workforce-toolbar "Ask the assistant" hook was deliberately OMITTED
  (D-TB3).** The plan suggested a third page-hook at the Workforce view (Directory/header) level, but
  that surface is `ViewToolbar`, which carries a locked prior rule **D-TB3** ("`actions` is NEVER an
  assistant 'Analyze…'/'Explain…' hook — those live only in the Assistant dock", from the
  `ux-overhaul` toolbar-standard workstream). The hook lives only on the two `WideDialog` profile
  modals (not a toolbar), matching the pre-existing `CrewProfileModal` "Instantiate" header-action
  precedent. `buildHubWorkforceOverviewPrompt` is authored + tested but left dormant (same "authored
  wording of record" pattern as the retired analyze builders). Acceptance minimum (both profile
  modals) met. Also: `AgentsView.test.tsx` (a thin-shell suite in `hub/agents/`, outside the agent's
  `hub/workforce/` scope) mounts the modals via routes without the app-root `AssistantProvider`, so it
  needed the same `useAssistant` stub the modal suites use — fixed at integration (test-only; prod
  always mounts the provider).
- **2026-07-26 · WP 3.1 · `hub_usage_summary` is backed by `buildHubUsageAggregates`, not
  `buildHubUsageSummary`.** The plan prose named `buildHubUsageSummary`, but that export requires a
  `groupBy` + a single entity `id` (it answers "how was ONE agent/crew/project used") — which neither
  the tool's `{from,to,projectId}` args nor the open-ended `hub` chips ("break down my spend",
  "summarize recent sessions") supply. `buildHubUsageAggregates(repository, query, providerKindFor)` —
  the same fleet-wide rollup `GET /api/hub/usage` returns, with `inferHubModelKind` as the provider
  heuristic — matches the args and the intent. Naming-vs-behavior correction, not a scope change.

## Owner acceptance (owner-only)
- [ ] On the running app, `/assistant/agents` dock empty-state shows the agent/crew chips (not "Most
      expensive server / Token savings / Recent failures") in both themes; clicking "Rank my agents by
      token & cost" yields a real answer via the hub read tools; `/dashboard` still shows global chips;
      an entity page (e.g. `/servers/:id`) is unaffected — accepted: ____
- [ ] The gate fails when a bogus `<Route path="/zzz">` is added to `App.tsx` with no manifest entry
      (Test A) and when an entry is `surface:"global"` with no `exempt` (Test B); passes once a real
      surface or a reasoned exemption is added — accepted: ____
