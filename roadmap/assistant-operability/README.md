# Assistant operability — implementation plan · **PRIORITY: HIGH**

Owner directive (2026-07-26): the right-side "App assistant" dock is meant to be context-aware and
operate the current feature on the user's behalf, but on **Agents & Crews** (`/assistant/agents`)
it shows generic global suggestions. Root cause: the app has **no mandatory rule** requiring a new
view to expose an assistant interface, so the whole Hub was never wired into the assistant's
context/suggestion/navigation registries. This workstream makes assistant-operability a **hard,
gated rule** and brings the Hub up to that bar.

Living state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp assistant-operability`). Shared rules:
the [testing conventions](../testing/conventions.md) apply (gate, contract-first shared→api→web,
package boundaries); plan-specific doctrine is in this README's Invariants. Decisions D-AO1–D-AO6
below are locked into `STATUS.md`'s Decision log at kickoff.

## What we're building
1. **A mandatory `assistant-operability` rule** (`.claude/rules/assistant-operability.md`) — a peer
   hard rule to `brand-ui-only`: every route a user can land on (and every addressable view an agent
   can navigate to) must resolve to a **non-`global` starter surface** appropriate to the page — plus
   an **entity pin** where the URL names one entity — **or** be declared a `redirect`/`exempt` in the
   route manifest. The dock must never fall back to generic global suggestions on a real feature page.
2. **A single source-of-truth route manifest** (`packages/shared/src/assistant-route-manifest.ts`):
   one declared entry per route → `{ surface | "redirect", pin?, addressable?, exempt? }`. This is the
   one declaration a developer touches when adding a route.
3. **A hard CI/test gate** (`apps/api/test/assistant-route-operability.test.ts`, inside `pnpm test`):
   Test A coverage (App.tsx routes ↔ manifest), Test B operability (real surface OR redirect OR
   reasoned exemption), Test C conformance (manifest ↔ the live `resolveStarterSurface` /
   `resolveEntityPin` / `ASSISTANT_UI_VIEWS`).
4. **Hub context-awareness** — new route-keyed, analysis-only starter surfaces `agents` and `hub`
   (mirroring the existing `compatibility` precedent), so the dock shows page-relevant chips.
5. **Full operability** — hub read tools (`hub_agents_list`, `hub_crews_list`, `hub_usage_summary`)
   so those chips are answerable, plus an optional "Ask the assistant" page-hook.

## Decisions to lock at kickoff (owner)
- **D-AO1 — Enforcement = CI/test gate over a shared manifest (NOT a regex hook).** "Every route is
  context-aware" is a whole-repo invariant (a join across the route table, the surfaces, and the
  pins); a PostToolUse hook only sees the one edited file and can't evaluate it, and regex-parsing the
  lazy `<Routes>` JSX is brittle. The gate is a test over `ASSISTANT_ROUTE_MANIFEST`, run in `pnpm
  test`. *(Owner-confirmed 2026-07-26: hard CI/test gate.)*
- **D-AO2 — The enforceable unit is the react-router `<Route>` (+ addressable UI view), not the
  function.** The dock's entire context derives from `location.pathname` (+ `?tab`); it cannot observe
  functions/components. "Every function exposes an assistant interface" is unenforceable and
  meaningless; "every route resolves to a real surface or a documented exemption" is exactly checkable.
- **D-AO3 — Hub integration = route-keyed `agents`/`hub` surfaces, NOT new `agent`/`crew` entity
  kinds.** `ASSISTANT_ENTITY_KINDS` is the write-scope **security boundary** (`SCOPE_WRITE_TOOLS`,
  `deriveAssistantScope`, the persisted `entityKind` wire); expanding it is an owner-gated D-AS7 change
  into security-critical code, unjustified for a suggestion gap. Route-keyed surfaces mirror the
  existing `compatibility` precedent (analysis-only, no write-scope). **Upgrade path** (deferred, needs
  a future D-AS7): add `agent`/`crew` entity kinds only if the dock must *pin*/write-scope agent edits
  or `ui.navigate` to agent/crew profiles.
- **D-AO4 — Escape hatch = an `exempt: "<reason>"` or `surface: "redirect"` manifest entry**,
  owner-reviewed — the operability analogue of `brand-ui-allow:`. Allowed, but visible and reasoned.
- **D-AO5 — This governs the DOCK ("App assistant"), not the Hub's full-page assistant.** D-AH1 ("app
  data is not the center of gravity") governs the Hub's general-purpose assistant; the dock's mission
  is the opposite — operate the *current* app feature. Hub starters therefore stay analysis-only and
  page-operation-flavored ("summarize *this* page's usage"), not "answer anything".
- **D-AO6 — No DB migration; no new runtime dependency.** Pure shared registry + api test + read tools
  over existing `hub/repository.ts` + docs. Confirm no `user_version` claim is needed at kickoff.

## WP index

### Phase 1 — Contract & gate (green baseline)
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 1.1 | Route manifest + operability gate test (A/B/C); every current route declared — existing surfaces + exemptions + redirects, hub rows initially `exempt` → gate green with no behavior change | — | M | Opus |
| 1.2 | `.claude/rules/assistant-operability.md` hard rule + `CLAUDE.md` registration (§10 map + capability row + SoT ledger list) | 1.1 | S | Opus |

### Phase 2 — Hub context-awareness (symptom fix)
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 2.1 | `agents` + `hub` starter surfaces (shared union + `AGENTS_STARTERS`/`HUB_STARTERS` + catalog + `resolveStarterSurface` `HUB_ROUTES`), the mandatory `isScopableSurface` fix (api), catalog-test extension; flip the hub manifest rows `exempt`→real surface (Test C proves the resolver agrees) | 1.1 | M | Sonnet |

### Phase 3 — Full operability (make the chips answerable)
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 3.1 | Hub read tools `hub_agents_list` / `hub_crews_list` / `hub_usage_summary` — definitions + `ASSISTANT_READ_TOOL_NAMES` registration + `AssistantToolDeps`/route wiring + inventory-sanity tests | 2.1 | M | Sonnet |
| 3.2 | "Ask the assistant" page-hook in the Workforce view / agent+crew profile modals (`openAssistant({ prompt })`, prompt builder authored once in shared), gated on `assistant.authConfigured` | 3.1 | S | Sonnet |

### Phase 4 — Hardening (optional / owner-gated)
| WP | Title | Depends on | Size | Model |
|---|---|---|---|---|
| 4.1 | PostToolUse `enforce-assistant-operability.mjs` edit-time nudge (new `path="…"` in App.tsx without a manifest entry) + `.claude/settings.json` wiring — non-blocking; the test stays authority | 1.1 | S | Sonnet |
| 4.2 | Upgrade selected exemptions to real surfaces: `/reports/scans/:scanId` → `scan` pin; `/testing/environments` once it URL-encodes its selection | 2.1 | S | Sonnet |

## Design (settled — the substance each WP implements)

**Manifest (`assistant-route-manifest.ts`).** `AssistantRouteManifestEntry = { pattern, surface:
AssistantStarterSurface | "redirect", pin?: AssistantEntityKind, addressable?: boolean, exempt?:
string }`; `ASSISTANT_ROUTE_MANIFEST` lists one entry per route, `pattern` byte-identical to the
`path=` in `apps/web/src/App.tsx`. The resolvers are **not** regenerated from it — the manifest is an
assertion harness pinned to the live resolvers by Test C.

**Gate (`assistant-route-operability.test.ts`, node test runner, modeled on
`assistant-starters-catalog.test.ts`).** A: regex every `path="…"` literal out of `App.tsx` (strip
commented-out routes first), assert the set equals the manifest patterns. B: every entry is
`redirect` OR non-empty `exempt` OR `surface !== "global"`. C: for each non-redirect entry,
`resolveStarterSurface({route: concretePath}) === surface`; for each `pin`,
`resolveEntityPin(concretePath) === { kind: pin, id: "__id__" }`; `ASSISTANT_UI_VIEWS` reconciles with
the `addressable` entries (with `/settings` — a modal, not a `<Route>` — as a documented known-extra).
Developer workflow: new `<Route>` fails A → add a manifest entry with a real surface (forcing
context-awareness) or a reasoned `exempt`/`redirect`.

**Hub surfaces (shared).** Extend `AssistantStarterSurface` (`assistant-starters.ts:54`) to
`"global" | "compatibility" | "hub" | "agents" | AssistantEntityKind`; add `AGENTS_STARTERS` /
`HUB_STARTERS` (all `kind:"analysis"`, no `writeTool`) and register in `ASSISTANT_STARTER_CATALOG`;
extend `resolveStarterSurface` (`:612`) with a `HUB_ROUTES` helper mirroring `COMPARE_ROUTES` (`:581`),
matching `/assistant/agents` (and `/agent/:id`, `/crew/:id`) **before** `/assistant` (prefix order).
`resolveEntityPin` is unchanged — hub routes stay deliberately unpinned (the envelope can't carry an
`agent` kind, and the dock is read-only over the Hub). Repair the stale `*-analyze.ts` comment
references while here — those files do not exist; the rule/gate reference the manifest only.

**Mandatory api fix.** `apps/api/src/assistant/starters.ts` `isScopableSurface` (`:141`) currently
returns true for anything not `global`/`compatibility`, then indexes `SCOPE_WRITE_TOOLS[surface]`.
Exclude `hub`/`agents` too (return true only for real `AssistantEntityKind`s) or `deriveStarters`
throws on `undefined`. Cover with a starters-service test for the new surfaces.

**Hub read tools.** New `apps/api/src/assistant/tools/hub-read-tools.ts` backed by
`apps/api/src/hub/repository.ts` (`listAgentRoles`, `listCrews`, `listSessions`) + `hub/usage.ts`;
bare names into `read-tool-names.ts` `ASSISTANT_READ_TOOL_NAMES` (auto-allowed side-effect-free
reads); wire into `tools/index.ts` `buildAssistantToolDefinitions` + `AssistantToolDeps` +
`assistant/routes.ts` (names↔definitions move together — `assistant-tools.test.ts` cross-checks them).
No write tools added → no scope-map change.

**Starter chips.** `agents`: "Rank my agents by token & cost this month"; "Summarize how my crews
have been used recently"; "Compare two agents' setup (model, tools, skills) & typical cost"; "Which
agents/crews haven't been used lately and could be archived?"; "Help me draft a new agent for
<role>". `hub`: "Summarize my recent assistant sessions"; "Find my sessions about <topic>"; "Break
down my assistant spend this week by model & mode."

## Backfill appendix (Phase 1's green baseline — every current route → smallest correct action)
Already-compliant real surfaces get straight rows: `/servers/:serverId`→server, `/scans/:scanId`→scan,
`/skills/:skillId`→skill, `/testing/runs/:runId`→run, `/testing/suite-runs/:suiteRunId`→suite_run,
`/testing/collections/:collectionId`→collection, the 4 compare routes→compare,
`/testing/compatibility`→compatibility.

- **New real surface (Phase 2):** `/assistant/agents` (+ `/agent/:agentId`, `/crew/:crewId`) → `agents`;
  `/assistant`, `/assistant/sessions`, `/assistant/projects`, `/assistant/audit` → `hub`. *(Declared
  `exempt` in Phase 1, flipped to the real surface in 2.1.)*
- **Exemptions (reasoned):** `/dashboard` (the canonical global surface); list pages `/servers`,
  `/scans`, `/skills`, `/testing/runs`, `/testing/suites`, `/testing/collections` (surface is the
  drill-in detail); `/testing/environments` (selection in React state, no URL id yet);
  `/testing/suites/:suiteId` (no `suite` entity kind — frozen vocab, D-AS7); `/testing/runs/new`
  (launcher, no entity yet); `/testing/review`, `/testing/observability/rules`,
  `/testing/observability/review-rubrics` (management/config, no single pin); `/reports/scans/:scanId`,
  `/reports/digest/:id` (report routes); `*` (404); `/settings/:section` (deep-linkable modal, D-TB10;
  addressable via `ASSISTANT_UI_VIEWS`).
- **Redirects (`surface:"redirect"`):** `/`→`/dashboard`; `/compare`→`/compare/scans`;
  `/testing`→`/testing/collections`; `/testing/scenarios`→`/testing/environments`;
  `/testing/compare`→`/testing/runs/compare`; `/testing/runs/review`→`/testing/review`;
  `/assistant/memory`→`/assistant?memory=profile`; `/assistant/usage`→`/assistant/agents?tab=usage`.

## Invariants
- **Contract-first**: the manifest + surfaces land in `packages/shared` first, then api, then web.
- **Do NOT touch** `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` / `deriveAssistantScope` (frozen
  write-scope security boundary; D-AO3). Any expansion is an owner-gated D-AS7 change.
- **No DB migration; no new runtime dependency** (D-AO6).
- The rule and gate reference the **manifest** only — never the non-existent `*-analyze.ts` builders.
- Gate green each WP (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`); any visible change
  verified by looking, in **both** themes (`light` + `dark`).

## Definition of done (every WP)
Gate green from repo root + the WP's Acceptance met; ledger discipline per [`STATUS.md`](./STATUS.md).

## Owner acceptance (see STATUS.md)
The end-to-end walk on the real running app: `/assistant/agents` dock shows the agent/crew chips (not
the global set) in both themes; a chip produces a real answer via the hub read tools; `/dashboard`
still shows global chips; an entity page is unaffected; and the gate fails/passes correctly when a
route is added without/with a manifest entry.
