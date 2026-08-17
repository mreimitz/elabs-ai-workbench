# Model identity — plan

**Mission.** Make a model choice in the Assistant Hub mean *exactly what the operator picked* — the
model **and** the credential behind it — end to end: wire, DB, resolver, executor, missions, cost
attribution and every picker. Today the Hub carries only a bare model-id string and re-guesses the
provider from the model **name**, which routes a signed-in Claude-subscription session onto the
metered Anthropic API key.

> **Authoritative status:** [`STATUS.md`](./STATUS.md). This README holds the mission, the locked
> decision log (D-MI*), the WP index and the dependency graph — never per-WP state.

---

## 1. The defect (owner report, 2026-07-27)

Three reported symptoms, one root cause plus two independent UI problems.

1. **A session on an "Anthropic CLI" model hit the metered API.** Session
   `zRZV8EtZ-9_2hIm67Xhtj` was created on `claude-sonnet-5` and failed with *"Your credit balance is
   too low to access the Anthropic API."* Its persisted `capabilities.costBasis` is `api_exact` —
   it had resolved to the API-key credential **at creation time**, before any message was sent.
2. **The model-selection UI is poor**, for both sessions and agents.
3. **Model/family names are not aligned** with the provider names in Settings.

### Root cause

The operator's chosen credential is discarded in the browser and cannot be re-derived server-side.

| Hop | Fact |
| --- | --- |
| Picker knows the truth | `useHubModelRoster` stamps `kind` + `credentialId` on every `HubModelOption` (`use-hub-models.ts:76-81`) |
| **Choice destroyed** | **`NewSessionDialog.tsx:169` — `const input: HubSessionCreateInput = { mode, model: modelId };`** (state is `useState("")` at `:120`; the family callback is `onSelectModel={setModelId}` at `:246`) |
| Wire cannot carry it | `HubSessionCreateInput` declares only `model: string` (`types.ts:5909`); `hubSessionCreateInputSchema` is `.strict()` (`schemas.ts:3648-3664`) — an extra field is a **400**, not ignored |
| DB cannot record it | `hub_sessions.model TEXT NOT NULL` (`schema.ts:1079`) — no kind, no credential column |
| Server re-guesses | `HubModelResolver` is typed `(modelId: string) => …` (`session-service.ts:141-143`); `createHubModelResolver` computes `inferHubModelKind(modelId)` (`routes.ts:227-251`) |
| **The guess cannot ever be right** | **`inferHubModelKind` returns `HubAiSdkModelKind | undefined` (`routes.ts:214`) — a union that structurally EXCLUDES `claude_subscription`** |

`inferHubModelKind` maps any id starting with `claude` to `"anthropic"` (`routes.ts:216`), then
`createHubModelResolver` picks `pool.find(c => c.kind === hinted) ?? pool[0]`, skips the subscription
early-return, decrypts the API key and returns `buildModel: () => modelFor(decrypted, modelId)` →
`createAnthropic({ apiKey })` → metered `api.anthropic.com`.

**The `claude_subscription` branch at `session-service.ts:696` is therefore dead code for every model
the subscription actually offers.** This is not a heuristic that guesses badly; it is type-level
incapable of selecting the subscription.

**Why it shipped.** The bug only manifests when **both** an API-key and a subscription credential
exist. A subscription-only install works by accident via the untyped `?? pool[0]` fallback.

**Aggravating factor — id collision.** The subscription roster deliberately emits Anthropic's
canonical ids (`subscription-models.ts:205-220`) so `resolvePrice`/`MODEL_CONTEXT_LIMITS` work. Live
rosters on the owner's instance:

| id | `anthropic` (Claude-API) | `claude_subscription` |
| --- | --- | --- |
| `claude-sonnet-5` | Claude Sonnet 5 | **Sonnet** |
| `claude-opus-4-8` | Claude Opus 4.8 | **Opus** |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | **Haiku** |

All three collide byte-for-byte. Compounding it, `useHubModelRoster` dedupes on the **bare model id
globally across credentials** (`use-hub-models.ts:69,74-75`) over a `ORDER BY updated_at DESC` list
(`providers/repository.ts:34`) — so one of each colliding pair is swallowed, and *which* one flips
when an unrelated credential is edited.

### Blast radius — 16 sites

| # | Site | file:line | Consequence |
|---|---|---|---|
| 1 | Per-message model override | `Composer.tsx:362`, picker `:756-772` | Same discard, per message |
| 2 | Session model patch | `types.ts:5932`, `schemas.ts:3666` | Re-pinning is impossible |
| 3 | Chat turn re-resolve | `session-service.ts:591`, `:659` | Every turn re-guesses |
| 4 | Mission agent turn | `session-service.ts:872` | Child re-guesses independently |
| 5 | Mission synthesis turn | `session-service.ts:978` | Same |
| 6 | Review critic | `routes.ts:314`, model at `:2852` | Same |
| 7 | Planner / structured runner / synthesizer / best-of-N judge | `index.ts:665-675`, wired `:758,775,786,794` | Same; **and** throws on a subscription resolution |
| 8 | Mission child spawn | `orchestrator.ts:1005-1013` | Provider identity cannot cross parent→child |
| 9 | Saved agent default model | `schema.ts:1029`, `types.ts:5517` | An agent cannot be bound to the subscription |
| 10 | Crew member override | `types.ts:5692`, blob `schema.ts:1059` | Same |
| 11 | Planned agent | `types.ts:5761`, blob `schema.ts:1143` | Same |
| 12 | Usage `byProvider` | `routes.ts:1472`; `PROVIDER_LABELS` `usage.ts:26-30` | Subscription spend buckets as **"Anthropic"** |
| 13 | Dock `hub_usage_summary` | `assistant/tools/hub-read-tools.ts:214` | Same mislabel, answered to the assistant |
| 14 | Limit-error retry | `HubLimitErrorBanner.tsx:68-78` → `ConversationPane.tsx:1962` | "Retry on subscription" retries on the API key |
| 15 | Roster dedupe | `use-hub-models.ts:69,74-75` | Colliding model swallowed; winner flips |
| 16 | Mission planner roster | `index.ts:696-702`; `formatModelRoster` `roster.ts:109-124` | Planner has no vocabulary for "the subscription Sonnet" |

**Two failure modes worth naming.** A subscription-pinned **mission** agent does not error — the
throw is caught (`orchestrator.ts:1678-1686`, `:1743-1752`) and settles as *"The agent failed to
produce a report."*; synthesis degrades to `deterministicSynthesis`. And the **usage report launders
the evidence**: `byProvider`'s key domain is `inferHubModelKind`'s return type, which cannot emit
`claude_subscription`, so the one report an operator would check to catch mis-billing is the one that
hides it.

### Independent data gap

`claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-fable-5` and `claude-opus-5` are **absent**
from `MODEL_CONTEXT_LIMITS` and `MODEL_PRICING` (`model-data.generated.ts` — verified: only
`claude-haiku-4-5` and `claude-opus-4-8` are present). A session on `claude-sonnet-5` therefore runs
with `contextWindow: 0` (`routes.ts:239`) — which **disables compaction** (`compaction.ts:161-163`) —
and price-unknown, making `shouldAutoApprove` (`orchestrator.ts:1926-1935`) compare spend against $0.

---

## 2. Locked decisions (D-MI*)

Owner-confirmed 2026-07-27 unless marked otherwise.

### D-MI1 — Model identity rides an **additive optional `providerCredentialId`**

Alongside the existing `model: string`, never replacing it.

**Rejected — a composite string id** (`"credId::modelId"`). Five verified consumers do prefix/exact
matching on the bare id and would silently misbehave: `isStructuredOutputModel` =
`!modelId.startsWith("assistant|")` (`roster.ts:76`, re-opening the exact defect it was added for);
`inferHubModelKind` → `undefined` → `pool[0]`, **strictly worse than today**;
`MODEL_CONTEXT_LIMITS[modelId] ?? 0` and `resolvePrice(modelId)` (plain map lookups → 0 window, $0
price, cost caps silently inert); `inferModelLogoProvider`; roster-membership checks. It also mutates
a value already persisted on historical events, breaking replay.

**Rejected — a full `{ credentialId, modelId }` object.** A breaking wire change on nine shapes,
which under `.claude/rules/architecture.md` graduates to `/api/v2`, and it invalidates every
persisted row. Option (a) reaches the same expressive power additively.

**Semantics.**
- **Present** ⇒ authoritative. Resolve `providers.get(id)`, validate hub-eligible (`isHubModelKind`)
  and `authBroken !== true`; **never** re-infer.
- **Absent / NULL** ⇒ legacy row ⇒ today's heuristic, unchanged, plus a structured `log.warn` naming
  the model and the credential chosen, so the guess is visible.
- **Set-but-unresolvable** (credential deleted mid-session) ⇒ `ON DELETE SET NULL` degrades it to the
  legacy path; the resolver logs the downgrade and the read wire exposes `providerCredentialId: null`
  so the UI can show *"provider not pinned"*.

### D-MI2 — Migration **v55**, `ON DELETE SET NULL`

Verified next free: the last `MIGRATIONS` entry is `version: 54` (`db/database.ts:1607`);
`LATEST_SCHEMA_VERSION` auto-derives at `:1627`.

```
hub_sessions.provider_credential_id TEXT REFERENCES provider_credentials(id) ON DELETE SET NULL
hub_agents.provider_credential_id   TEXT REFERENCES provider_credentials(id) ON DELETE SET NULL
```

`SET NULL`, **not** the Testing feature's `RESTRICT` (`schema.ts:178`): `hub_sessions` is a
historical replay table, so `RESTRICT` would make a credential permanently undeletable once any
session used it. NULL is already the defined legacy state, so the degraded path is the tested one.
Mirror both into the baseline DDL (`schema.ts:1022`, `:1067`) so a fresh DB matches. Nullable, **no
backfill** — every pre-v55 row reads back NULL and replays byte-identically.

No DDL for crew members or planned agents — `hub_crews.members_json` and `hub_missions.plan_json` are
JSON blobs. Per-message overrides ride the existing `user_message` event blob.

### D-MI3 — Wire **real MCP tools** into the Hub subscription adapter *(owner decision)*

Fixing the routing exposes a second defect: `subscription-adapter.ts:406-411` wires only the
`ask_user` bridge (`mcpServers: askBridge ? {…} : {}`) and passes `tools: {}` to the prompt assembler
(`:400`), while `hubCapabilitiesForKind` reports `toolCalls: true`. A correctly-routed subscription
chat session would be **tool-less while claiming tools**.

The owner chose to wire real tools rather than degrade the capability. Port the Testing path's
proven approach (`run-service.ts:1300`, `resolveSubscriptionTools`): translate the session's granted
MCP servers into Agent-SDK `mcpServers` + `mcp__<serverKey>__<toolName>` allow patterns, and feed the
real tool set to `assembleSessionPrompt`. Decrypted stdio env / HTTP auth headers go into the child
config **only** — never returned to the web, never logged (`.claude/rules/mcp-and-security.md`).

### D-MI4 — Wire the **subscription executor into mission agents** *(owner decision)*

Rather than refusing a subscription-pinned agent at save/plan time. The constraint to solve, not
ignore: child spawn, topologies, synthesis and best-of-N judging assume an AI-SDK model with
**structured output** (`generateObject`), which the Agent-SDK path does not provide. The subscription
child must therefore produce a `HubAgentReport` through a prompt-enforced contract + parse-and-repair,
never a fabricated report. A parse failure settles the child **honestly and by name** — never today's
generic *"The agent failed to produce a report."*

### D-MI5 — The label is **"Anthropic CLI"** *(owner decision)*

Overriding the analysis recommendation of "Claude subscription". **Consequence that must be handled:**
`constants.ts:55-58` reserves "CLI" for `CLAUDE_CLI_PROVIDER_ID` (the Auto-Rating judge provider) — a
genuinely different thing. Since both now carry "CLI", `resolvedSourceLabel`'s bare "Claude CLI"
(`SettingsView.tsx:1144`, `ReportTab.tsx:1100`, `suites/SuiteReportTab.tsx:735`) **must** be
qualified to **"Claude CLI judge"** so the two never read as one provider. The `claude_subscription`
vs `claude_cli` **identifier** lock is untouched — this is a display-label decision only.

### D-MI6 — One source of truth for provider-kind presentation

`PROVIDER_KIND_META` in `packages/shared/src/constants.ts`, beside `PROVIDER_KINDS`, as an
**exhaustive `Record<ProviderKind, …>`** so a newly-added kind fails `pnpm typecheck` until
classified. (`usage.ts:26` uses `Record<string, string>`, which is exactly why `claude_subscription`
falls through silently.) Carries `label`, `shortLabel`, `logoProvider` and `billing`
(`metered_api_key` | `subscription` | `local` | `tenant_questions`).

### D-MI7 — One picker: `HubModelPicker`

Replaces four implementations across nine call sites. Composes **only** verified `@elabs-ai/components-*` parts
(`@elabs-ai/components-ai` `ModelSelector*`, `@elabs-ai/components-ui` `Badge`/`Text`/`Skeleton`/`Alert`/`Tooltip`, `@elabs-ai/components-data`
`SearchInput`). A row shows: logo · display name · raw model id · billing badge · credential label
**when its kind has >1 credential**. Grouping is per **credential** when a kind has several,
otherwise per **kind**, in a deterministic `kind`-then-`label` order — never `updated_at DESC`.

**Load-bearing:** `ModelSelectorItem` is `ComponentProps<typeof CommandItem>` which accepts
`keywords?: string[]`; today `Composer.tsx:760` passes `value={model.modelId}` and **no keywords**,
which is why the palette cannot be searched by provider. The credential nanoid must **not** go into
`value` (cmdk fuzzy-scores `value`); identity rides the `onSelect` closure.

A broken credential (`authBroken`) renders **disabled-and-visible**, never hidden — hiding is what
makes *"why did it use the other one?"* unanswerable.

### D-MI8 — Roster dedupe keys on `${credentialId}::${modelId}`

Must ship **atomically with** the selection-state change (same WP): it injects duplicate `modelId`s
that today's id-keyed consumers (`NewSessionDialog.tsx:158`, `HubLimitErrorBanner.tsx:52-55`) would
resolve to the wrong row.

### D-MI9 — Fail honestly, never re-guess

An explicit `providerCredentialId` that is unknown / not hub-eligible / `authBroken` ⇒ **409**
matching the module's `NO_PROVIDER_MESSAGE` posture (`routes.ts:191-193`), never a silent re-pick.
Every heuristic fallback emits a structured `log.warn`.

### D-MI10 — `byProvider` buckets per **credential**, rolled up by kind

Per-credential answers *"which key is being billed"* — the question that surfaced this bug — while a
kind roll-up preserves today's chart. `providerKindFor` widens from `(modelId: string)` to take the
**session** so it can read the persisted `provider_credential_id`; the heuristic serves NULL rows
only. Do **not** reuse `SubscriptionCostMarker` (`components/SubscriptionCostMarker.tsx:33`) — its
copy is run-scoped ("this run's cost…") and meaningless pre-run.

### D-MI11 — Model-data gap closed at the dataset, never by hand

`claude-sonnet-5` / `claude-haiku-4-5-20251001` / `claude-fable-5` / `claude-opus-5` are added to
`research/token-context-comparison/data/saas/anthropic.json` and regenerated with
`pnpm build:model-data`. **Never hand-edit `model-data.generated.ts`.** A subscription id with no
published API price takes an explicit *unpriced-by-design* path (surfaced as "not priced", not a
silent `$0`), so a cost cap is never silently inert.

---

## 3. Frozen surfaces — must NOT change

- **`ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` / `deriveAssistantScope`** — the write-scope
  security boundary (D-AO3, `.claude/rules/assistant-operability.md`). Nothing here needs it. This
  plan adds **no `<Route>`**, so `ASSISTANT_ROUTE_MANIFEST` is untouched.
- **Every existing wire field.** `model: string` stays required and byte-identical on all nine
  shapes. Additive-only ⇒ `/api` stays versionless.
- **Subscription model ids stay canonical.** `subscription-models.ts:205-220` deliberately emits
  `resolvedModel` (`sonnet` → `claude-sonnet-5`) because `resolvePrice` / `MODEL_CONTEXT_LIMITS` /
  `estimateCost` are exact-key lookups. Namespacing them is the same trap as the rejected composite id.
- **Historical replay.** `hub_sessions.model`, `assistant_message.model`, `user_message.model` and
  `plan_json` are already persisted; a NULL `provider_credential_id` must replay through the
  unchanged heuristic.
- **`STOP_REASON_CODES` / `TerminalCause`** — do not route a billing failure into `rate_limit` to get
  the retry banner; that corrupts every observability/auto-rating bucket built on it
  (`session-terminal.ts:88`).
- **`claude_subscription` vs `claude_cli` identifiers** (`constants.ts:55-58`) — D-MI5 changes a
  *display label* only.
- **`SUBSCRIPTION_SESSION_CAPABILITIES`** (`testing/session-capabilities.ts:41`) is shared with
  Testing, where tools *are* wired. Any hub-only capability change belongs in `hub/capabilities.ts:94`.

---

## 4. Work packages

Specs live under `phase-*/`. State is [`STATUS.md`](./STATUS.md).

| WP | Title | Layer | Depends |
|---|---|---|---|
| 1.1 | Additive `providerCredentialId` on the wire (9 types, 8 schemas) | shared | — |
| 1.2 | `PROVIDER_KIND_META` registry | shared | — |
| 1.3 | Model-data gap + unpriced-by-design path (D-MI11) | shared | — |
| 2.1 | Resolver honors an explicit credential + migration **v55** | api | 1.1 |
| 2.2 | Fail honestly instead of re-guessing (D-MI9) | api | 2.1 |
| 2.3 | Adopt the registry; delete the competing label maps | web | 1.2 |
| 3.1 | Thread the credential through the existing pickers + dedupe (D-MI8) | web | 1.1, 2.1 |
| 3.2 | **Real MCP tools in the subscription adapter** (D-MI3) | api | 2.1 |
| 3.3 | Honest cost attribution (D-MI10) | api + web | 2.1, 1.2 |
| 4.1 | `HubModelPicker` + adopt at 9 call sites (D-MI7) | web | 3.1, 2.3 |
| 4.2 | **Subscription executor in mission agents** (D-MI4) | api + shared + web | 2.1, 3.2 |
| 4.3 | Limit-error retry actually switches source | web | 3.1 |
| 5.1 | Delete dead pickers (`RoleEditor`, `CrewEditor`, library panels) | web | 4.1 |
| 5.R | Adversarial refute-review of the whole plan | review | all |

### Dependency graph

```
1.1 ──┬── 2.1 ──┬── 2.2
      │         ├── 3.1 ──┬── 4.1 ── 5.1
      │         ├── 3.2 ──┤
      │         └── 3.3   ├── 4.2
      │                   └── 4.3
1.2 ──┴── 2.3 ── 4.1
1.3 (independent)
                                    all ── 5.R
```

**Parallelism.** 1.1 · 1.2 · 1.3 start together. Then 2.1 and 2.3 in parallel. Then 3.1 · 3.2 · 3.3.
Then 4.1 · 4.2 · 4.3. Then 5.1, then 5.R.

---

## 5. Acceptance the plan is measured against

The owner-reported defects, restated as checks:

1. Picking **Anthropic CLI → Sonnet** and sending a message runs on the subscription child — **zero**
   calls to `api.anthropic.com` — and the session persists `provider_credential_id`.
2. Two credentials of the same kind both surface, distinguishably, in every picker; a colliding
   model id no longer swallows its twin.
3. Exactly **one** `Record<ProviderKind, …>` label map repo-wide; `claude_subscription` renders
   identically in Settings, Dashboard and every Hub picker.
4. A subscription-pinned agent runs in a mission (D-MI4), or fails **by name** — never
   *"The agent failed to produce a report."*
5. Subscription spend never buckets as "Anthropic".
6. `pnpm typecheck && pnpm test && pnpm build` green, `pnpm lint` clean.

**Not self-certifiable by an agent** (owner acceptance): the live two-theme + keyboard walk of every
new picker surface, and a real subscription turn against the owner's signed-in account.
