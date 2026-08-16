# model-identity — WP 5.R adversarial refute-review

**Reviewer posture:** refuter, not reviewer. The working assumption was that at least one acceptance
claim is wrong, overstated, or vacuously satisfied. It was. Two of the six acceptance criteria do
not hold, and both failures are in code the plan itself shipped.

**Base:** `19643220` (tip of `feat/model-identity`), reviewed on `wp/model-identity/5.R`.
**Date:** 2026-07-27.

---

## 0. What I could NOT verify — read this first

Nothing below is a substitute for the owner walk. Where the proof stops:

1. **Acceptance criterion 1 cannot be closed by any agent, and was not closed here.** There is no
   signed-in Claude subscription in this environment, no child process was spawned, and no network
   was observed. The proof chain stops at exactly one observable: `createHubModelResolver`
   (`apps/api/src/hub/routes.ts:395-399`) returning `{ providerKind: "claude_subscription", modelId,
   contextWindow }` **with no `buildModel`**, which is what routes the turn away from
   `createAnthropic({ apiKey })`. Everything after that branch — the Agent-SDK child actually
   starting, answering, and making **zero** calls to `api.anthropic.com` — is **unproven**. STATUS's
   own "verified against real data" section stops at the same point and says so honestly; I confirm
   that the stopping point is where it says it is, and that it is not further along than claimed.
2. **No browser was run.** Every visual, two-theme, keyboard, focus-order and screen-reader claim
   about `HubModelPicker` at its call sites is unverified by me. Criterion 2's "distinguishably"
   is verified only as *data and DOM contract*, never as *legibility*.
3. **No real MCP server was connected.** WP 3.2's wiring is stub-tested at the driver boundary
   only. I verified the code path and the secret-flow, not that a real server connects.
4. **The Agent SDK's `allowedTools` matcher is a bun-compiled binary** (`@anthropic-ai/claude-agent-sdk`
   ships `sdk.mjs`/`bridge.mjs` + `extractFromBunfs.js`). How it interprets our
   `mcp__<id>__<tool>` strings — in particular whether a prefix can widen — **could not be read**.
   The "no widening" property is proven for our own `canUseTool` gate and **unproven** for the SDK's
   auto-approve path.
5. **Whether a child MCP process inherits the parent's environment** (finding S3) depends on the same
   unreadable CLI. The exposure is structural and plausible; I could not execute it.
6. **The `ROSTER_GAP_MODEL_PRICING` numbers could not be checked against Anthropic's published list
   prices** — no network. They are hand-authored with no dataset provenance (finding F6).
7. **One of my own mutation probes contaminated a concurrent analysis pass** (see §3, methodology
   note). I caught it and discarded the resulting false positive; flagging it so nobody re-derives it.

---

## 1. Verdict per acceptance criterion

### Criterion 1 — subscription session runs on the subscription child, persists `provider_credential_id`
**HOLDS WITH CAVEAT** (primary flow), and see criterion 4 for the agent flow.

*Evidence.* Mutation probe 1: forcing `createHubModelResolver` to discard its `providerCredentialId`
argument (`apps/api/src/hub/routes.ts:360`) fails **11 api tests**, naming the exact behaviours —
`"an explicit claude_subscription credential wins over the claude- name hint (no buildModel ⇒ the
subscription executor runs the turn)"`, the three D-MI9 409s, the three session-create 409s, the
unpin PATCH, and the three WP-4.4 `/messages` sink tests. This is not a vacuous suite. Persistence is
locked by migration v55 (`apps/api/src/db/database.ts:1642-1657`) plus a baseline-DDL mirror
(`apps/api/src/db/schema.ts:1041`, `:1094`) and round-trip tests
(`apps/api/test/migrations.test.ts:2643`, `:2664`).

*Attack that failed to break it.* I tried to reach the resolver with a dropped credential on the
**primary** path (NewSessionDialog → create → send). Probe 2 (`hubModelWireFields` drops
`providerCredentialId`) fails **19 web tests** across 7 files; probe 3 (D-MI8 dedupe reverted) fails
5 more. The primary path is genuinely wired end to end.

*Caveat.* Identity is still dropped on **six** other hops (F2, F3, F4, F7, F12, and the review
critic F9), four of them unrecorded. Criterion 1 is scoped to "picking Anthropic CLI → Sonnet and
sending a message", and for that exact flow it holds. It does **not** generalise to agents, crews,
regenerate, steering, or mission propose.

### Criterion 2 — two same-kind credentials both surface distinguishably; no swallowed twin
**HOLDS.**

*Evidence.* `hubModelOptionKey` = `${credentialId}::${modelId}`
(`apps/web/src/features/hub/use-hub-models.ts:87-91`) keys the roster dedupe (`:219`); probe 3
reverting it to the bare id fails 5 tests including `"two credentials exposing the SAME model id both
survive"`. cmdk row identity is separately guaranteed: probe 4b (below) fails **7 tests**, 4 of them
against real cmdk (`ArrowDown moves the highlight from the first twin to the SECOND`). `HubModelPicker`
is adopted at 8 production call sites; **no surviving `models[0]`** anywhere under `features/hub`
(all remaining occurrences are comments explaining why it was replaced by `defaultHubModelOption`).

*Attack that failed to break it.* Attempted to find a picker still resolving by bare id — none. The
server-side sibling is also fixed (`apps/api/src/index.ts:737` keys per credential × model).

*Caveat (untested, cosmetic).* See F11 — the picker's *selected-row marking* for twins is not covered.

### Criterion 3 — exactly one `Record<ProviderKind, …>` label map repo-wide
**HOLDS.**

*Evidence.* Repo-wide grep for `Record<ProviderKind` / `Record<ProviderKindLocal` /
`ProviderKind, string>` returns exactly two non-comment hits: the authoring registry
`PROVIDER_KIND_META` (`packages/shared/src/constants.ts:123`) and
`PROVIDER_KIND_LABELS` (`apps/web/src/features/dashboard/testing/metrics-derive.ts:108-110`). The
latter is **genuinely derived**, not a hand-authored twin:
`Object.fromEntries(PROVIDER_KINDS.map((kind) => [kind, providerKindLabel(kind)]))` — it authors no
strings. Only one object literal in the repo has a `claude_subscription:` key (`constants.ts:160`).

*Attack that failed to break it.* Exhaustiveness probe: adding `"mutation_probe_new_kind"` to
`PROVIDER_KINDS` produced `src/constants.ts(124,14): error TS2741: Property 'mutation_probe_new_kind'
is missing … but required in type 'Record<…, ProviderKindMeta>'`. The D-MI6 "a new kind fails
typecheck until classified" guarantee is real, and `ProviderKindLocal` is `(typeof PROVIDER_KINDS)[number]`
so it cannot drift from `ProviderKind`.

### Criterion 4 — a subscription-pinned agent runs in a mission, or fails BY NAME
**DOES NOT HOLD.**

*What does hold.* The generic string is gone from every live path — repo-wide grep for
`"failed to produce a report"` returns only a test fixture and three explanatory comments. For an
agent pinned inside `hub_missions.plan_json` (a planner-emitted `pin=`), the pin reaches the child
(`apps/api/src/hub/missions/orchestrator.ts:1161`) and WP 4.2's tests exercise it.

*What breaks it.* **The only way an operator can pin an agent in the UI — a saved agent's
`providerCredentialId`, or a crew member's override — is silently discarded at mission
instantiation.** `roleToPlannedAgent` (`apps/api/src/hub/missions/topologies.ts:573-586`) copies
`model`, `toolGrants`, `skillIds`, `budgets`, `systemPrompt`, `target` and `expectedOutcome` from the
member/role — and **no `providerCredentialId`**. A repo-wide grep for `.providerCredentialId` across
`apps/api/src` confirms `topologies.ts` never reads one, and that a role's pin is consumed at exactly
**one** execution site in the entire API: the review critic (`apps/api/src/hub/routes.ts:3100`). A
crew member's pin is read **nowhere**.

So a subscription-pinned saved agent does not run on the subscription and does not fail by name — it
runs on the metered key via the heuristic, which is the original defect, reproduced on the agent
path. See F2.

### Criterion 5 — subscription spend never buckets as "Anthropic"
**DOES NOT HOLD.**

*The break (no legacy data required).* Attribution granularity is the **session row**; billing
granularity is the **turn**. Nothing writes the credential that actually ran a turn back onto the row.

1. A per-message `providerCredentialId` overrides the session pin for routing:
   `effectiveCredentialId = input.providerCredentialId ?? session.providerCredentialId ?? undefined`
   (`apps/api/src/hub/session-service.ts:731-732`). This is a **first-class, tested** feature — WP 3.1
   shipped it (`Composer` test: *"a session pinned to one credential can still override to the SAME
   model id on the other"*) and WP 4.3's "Retry on subscription" button depends on it.
2. The subscription turn's cost is folded into **that same session row**:
   `costUsd: current.costUsd + totals.costUsd` (`apps/api/src/hub/subscription-adapter.ts:275`).
3. The per-message credential is **never persisted**: `updateSession` has exactly two call sites in
   `apps/api/src`, both operator-driven routes (`apps/api/src/hub/routes.ts:1903`, `:2140`). Neither
   `createSession` nor `dispatchMessage` writes it back.
4. Usage attribution reads the **session's** pin (`apps/api/src/hub/usage.ts:83`), which still names
   the metered credential → `byProvider` = `{ key: "anthropic", label: "Anthropic" }`, and
   `byProviderCredential` = the metered key with **`unpinned: false`**.

Result: subscription-billed dollars are reported under **"Anthropic"**, badged **Metered**, and
marked as a *measured fact* rather than a guess. The "a guess and a fact must not read the same"
guarantee does not fire, because the attribution *is* a fact — just a fact about the session, not
about the turn that spent the money.

*Aggravating.* `HubUsageBucket` (`packages/shared/src/types.ts:6912-6919`) — the type behind
`byProvider` — has **no `unpinned` field** at all, so the kind roll-up cannot flag a guess even in
the pre-v55 case it was designed for. Only `HubUsageProviderCredentialBucket` carries the flag. And
`byProvider` is the surface the dock's `hub_usage_summary` hands the assistant.

*Attacks that did NOT break it.* The two rollups genuinely cannot disagree — both consume one
memoized attribution (`usage.ts:172-184`), and route + dock construct it identically. No other
aggregator in the repo buckets hub spend by provider (no `SUM(cost_usd) … GROUP BY`; the Testing
dashboard aggregates the `runs` table's persisted `provider_kind`, correctly labelled through the
registry). A set-but-unresolvable id degrades to the heuristic without fabricating a bucket.

### Criterion 6 — gate green
**HOLDS.** Run in full on a clean tree at `19643220`:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | ✅ shared · api · web, all clean |
| `pnpm test` — shared | ✅ **85 pass / 0 fail** |
| `pnpm test` — api | ✅ **3317 pass / 0 fail** (`# fail 0`, 25.9 s) |
| `pnpm test` — web | ✅ **310 files, 3180 pass + 5 skipped (3185)** |
| `pnpm -r --workspace-concurrency=1 build` | ✅ (web built in 25.12 s; chunk-size warnings only) |
| `pnpm lint` | ✅ Biome, **1470 files, no fixes applied** |

Every number matches STATUS exactly. **`hub-workspace.test.ts` did not flake** — the
`listWorkspaceSnapshots is newest-first` test passed in both the full run and a separate api-only run
(2/2). The de-flake at `06d8a8c7` is holding.

---

## 2. Findings, severity-ordered

Each marked **RECORDED** (already in STATUS's carry-forward) or **UNRECORDED**.

### F1 · HIGH · UNRECORDED — subscription spend buckets as "Anthropic" whenever a turn used a per-message credential
`apps/api/src/hub/session-service.ts:731-732` · `apps/api/src/hub/subscription-adapter.ts:275` ·
`apps/api/src/hub/usage.ts:83` · `apps/api/src/hub/routes.ts:1903,2140`

Falsifies acceptance criterion 5 outright — see §1. **Why it matters:** the usage report is the one
surface an operator opens to catch mis-billing, and it reports subscription spend as metered spend
with `unpinned: false`, i.e. asserted rather than inferred. This is a *softer version of the very
defect the workstream exists to fix.*

**Recorded status:** the *root* ("the per-message credential is not on the read wire / is only the
session pin") is recorded **twice** — under the regenerate gap and under the `currentCredentialId`
approximation. The **cost-attribution consequence is recorded nowhere**, and it is an acceptance
criterion, not a nicety. Two WPs are mutually inconsistent: WP 3.1 deliberately shipped per-message
credential override; WP 3.3 attributes cost per session.

**Shape of a fix (not applied — structural):** persist the resolved credential onto the row at turn
time, or attribute at the event level (`costBasis` is already per-event); and give `HubUsageBucket`
the `unpinned` marker it lacks.

### F2 · HIGH · UNRECORDED — a saved agent's / crew member's pin is write-only: validated, persisted, then dropped at mission instantiation
`apps/api/src/hub/missions/topologies.ts:573-586` (`roleToPlannedAgent`) and `:642-660`
(`hydratePlannedAgentFromRole`)

Falsifies acceptance criterion 4 for the only path a UI operator can use — see §1. The field exists
on the wire (`packages/shared/src/types.ts:5735`, `:5808`), is validated on saved-role write
(`routes.ts:2871`, `:2889`), and is persisted (`repository.ts:354`) — and then no execution path
reads it except the review critic. **A `providerCredentialId` on a crew member is inert end to end.**

Two consequences worth separating:
- **Drop:** the role's/member's own pin never reaches `HubPlannedAgent`, so the child session spawns
  with `provider_credential_id = NULL` and `runAgentTurn` (`session-service.ts:997`) falls to the
  heuristic → the metered key.
- **Stale mis-pin** (`topologies.ts:647-651`): `hydratePlannedAgentFromRole` spreads `...planned`
  (keeping a planner-emitted pin) and then **replaces `model` with `role.defaultModel`** — so a pin
  chosen for model A ends up authoritative for model B. The docstring right above deliberately drops
  `estimatedCostUsd` for exactly this staleness reason; the credential was missed.

**This also makes a RECORDED note wrong.** STATUS says crew/planned-agent JSON pins "409 at agent/
synthesis turn time" because they have no FK. True for `plan_json`; **false for
`hub_crews.members_json`** — the pin is never read, so it never reaches the resolver and never 409s.
It is silently ignored on every crew launch, and `clampPlannedCredentials`' nested-crew rationale
(`orchestrator.ts:1441-1446`) is therefore a permanent no-op on that path.

### F3 · MEDIUM-HIGH · RECORDED BUT INACCURATE — regenerate is worse than the ledger says
`apps/api/src/hub/routes.ts:2256-2264` (branch route) · `apps/web/src/features/hub/ConversationPane.tsx:1943-1947`

STATUS records: regenerate "silently falls back to **the session pin**." It does not. Regenerate is
`branchHubSession(...)` → `sendHubMessage(forked.id, { text, model })`, and the branch route builds
the fork with `mode`/`model`/`title`/`projectId`/`topology`/`autonomy`/`crewId` — **omitting
`source.providerCredentialId`**, which `HubSessionCreateOptions` can express. The fork has *no* pin,
so regenerate falls back to the **heuristic**, i.e. the metered key. The recorded description
understates the impact and points at the wrong hop; the unpinned-fork hop is unrecorded.

### F4 · MEDIUM · UNRECORDED — the steering/queued path silently discards a credential the caller DID send, and stamps a model that never ran
`apps/api/src/hub/session-service.ts:685-689` · `apps/api/src/hub/turn-engine.ts:218` ·
`packages/shared/src/types.ts:6313-6320`

`enqueue({ text, model?, attachmentFileIds? })` has no slot for `providerCredentialId`, so a message
sent while a turn is running drops it. Worse, the drained batch is injected into a pass whose
`resolution` was fixed before the loop (`session-service.ts:766`), and the persisted `user_message`
is stamped with a `model` that **was not used**. This is the write-side twin of the recorded
read-side regenerate gap, and it is a transcript-integrity issue, not just a fallback: clicking
"Retry on the other auth source" mid-turn queues onto the *current* credential while the log claims
otherwise.

### F5 · MEDIUM · UNRECORDED — validation asymmetry: crew routes and dock write-tools accept pins the agent routes would 409
`apps/api/src/hub/routes.ts:2919-2934` (crews: bare `repository.createCrew`/`updateCrew`) vs
`:2871`/`:2889` (agents: `resolveExplicitHubCredential`) · `apps/api/src/assistant/tools/hub-write-tools.ts:88-158`

WP 2.2's surface sweep concluded "exactly 4 write bindings, all guarded". That is true for the four
bindings it enumerated, but crew-member pins are a **fifth** write of a credential id, unguarded —
and the dock's `hub_agent_create`/`hub_crew_create` tools call the repository directly, bypassing the
route guards entirely. A `qlik_answers` or `authBroken` pin is accepted there; only the unknown-id
case is caught, and only as a raw `SQLITE_CONSTRAINT` → **500**, not the D-MI9 409. (Inert today
because of F2 — but F2 is the bug, not the mitigation.)

### F6 · MEDIUM · PARTIALLY RECORDED — D-MI11 was not implemented as decided, and its regression guard is a static allow-list
`packages/shared/src/constants.ts:1180-1189` · `apps/api/src/providers/pricing.ts:77-90` ·
`apps/api/test/pricing.test.ts:118-146`

D-MI11 says the gap is "closed **at the dataset**, never by hand": add the ids to
`research/token-context-comparison/data/saas/anthropic.json` and run `pnpm build:model-data`. The
diff shows `research/`, `scripts/` and `model-data.generated.ts` are **untouched**. Instead two
hand-authored maps were added. The mitigating structure is real (merged *before* the `GENERATED_*`
maps so a dataset refresh wins; the generated file was not hand-edited) and STATUS describes the
approach honestly — but it is a deviation from a locked decision, not flagged as one, and it
reintroduces exactly the second-source-of-model-truth D-MI11 forbade. It also conflicts with the
project's standing "compatibility dataset is the single source of truth" rule.

Two unrecorded consequences:
- **D-MI11's "unpriced-by-design path (surfaced as 'not priced', not a silent `$0`)" does not
  exist.** Every gap id was given a hand-authored list price with no provenance, including
  `claude-fable-5` at $10/$50 — a number I cannot verify offline. A *wrong* price is not a silent
  `$0`, but it silently mis-computes cost caps and `shouldAutoApprove`.
- **The guard cannot catch a reopening.** The three D-MI11 tests iterate
  `ASSISTANT_DEFAULT_MODEL_ROSTER` (a static 4-element list, `constants.ts:1435-1440`) and one
  hardcoded 3-id list. The **live** roster ids come from the SDK
  (`apps/api/src/providers/subscription-models.ts` `mapModels` → `model.resolvedModel`) and never
  join that constant. The test comment claims it "locks the invariant so the gap cannot silently
  reopen when a new model joins the roster" — it cannot. When the subscription starts reporting a new
  id, `MODEL_CONTEXT_LIMITS[modelId] ?? 0` (`apps/api/src/hub/routes.ts:396`) silently yields **0**
  again — compaction off, context surfaces meaningless — with **no log, no flag, no test failure**.
  That is the owner's original secondary defect, still armed.

### F7 · MEDIUM · UNRECORDED — mission propose discards the composer's model + credential
`apps/web/src/features/hub/AssistantView.tsx:433-436` · `apps/web/src/lib/api.ts:2083-2089` ·
`apps/api/src/hub/missions/routes.ts:52-58`

On the first message of a mission session the composer renders its model-override chip, but
`proposeHubMission(id, input.text)` posts only `{ text }` and the `.strict()` body schema would 400
on anything else. Model, credential, attachments and mentions are dropped with no signal. The
planner falls back to the session pin (safe), but the operator's explicit pick is silently ignored.

### F8 · LOW-MEDIUM · PARTIALLY RECORDED — `editPlan` writes unvalidated pins; the spawn failure is a 500, not the documented 409
`apps/api/src/hub/missions/orchestrator.ts:836-854` · `apps/api/src/hub/missions/routes.ts:95-110` ·
`apps/api/src/hub/missions/orchestrator.ts:1150-1163`

`PATCH /api/hub/missions/:id` clamps budgets and grants but never runs `clampPlannedCredentials` or
`resolveExplicitHubCredential`, while `hubPlannedAgentSchema` happily parses a `providerCredentialId`.
The child spawn is a **raw** `repository.createSession` with no resolver, so with `foreign_keys = ON`
an unknown id surfaces as `SQLITE_CONSTRAINT` → **500** — precisely the failure mode WP 2.2 rewrote
`createSession` to avoid on the request path, still open on the mission path. STATUS records this
class as "409s at turn time"; it is a 500 on this hop.

### F9 · LOW · UNRECORDED — review critic: a free-text model can never name a credential, and a role pin can attach to an overridden model
`apps/api/src/hub/routes.ts:1404-1415` (`.strict()`, no `providerCredentialId`) · `:3084`, `:3097-3100`

`modelId = input.model ?? role?.defaultModel`, but `role.providerCredentialId` is attached whenever
the role has one — including when `input.model` overrode the role's model. So (a) a critic run
without a `roleId` can never use the subscription, and (b) a model/credential mismatch is possible.
The code comment documents (a) but not (b).

### F10 · LOW · UNRECORDED — STATUS's WP 4.1 mutation-probe claim is not reproducible as written
STATUS WP 4.1: *"Mutation-probed — forcing `value = modelId` fails 4 of 7 real-cmdk tests."*

Reproducing that literally — `value = row.modelId` in
`apps/web/src/features/hub/hub-model-picker.ts:199`, ordinal disambiguator left intact — **fails zero
of 1117 hub tests** (probe 4a). The load-bearing element is not the composed human text; it is the
uniqueness loop at `:201-205`. Disabling that too (probe 4b) fails 7. The guarantee is well covered;
the *claim about what the probe demonstrated* is wrong, and it is the exemplar the ledger singles out
("4.1's probe in particular showed 4 of 7 cmdk tests were load-bearing"). Search-by-provider — D-MI7's
stated rationale for the composed `value` — is in fact carried by `keywords`, and *is* independently
tested (`HubModelPicker.test.tsx:96-116`, `hub-model-picker.test.ts:169-175`), so no functional hole.

### F11 · LOW · UNRECORDED — the picker's selected-row marking is untested for twins
`apps/web/src/features/hub/HubModelPicker.tsx:130`, `:242`, `:269`

`selectedKey = hubModelOptionKey(value)` and rows compare `row.key === selectedKey`. Under probe 3
(key collapsed to the bare id) **both** twins satisfy that comparison — two rows would render the
selected indicator — and `HubModelPicker.test.tsx` / `.cmdk.test.tsx` pass regardless. Cosmetic, but
it is the one place the composite key's *row-identity* role is unguarded.

### F12 · LOW · UNRECORDED — `normalizePlannedModels` backfills the model but not the pin
`apps/api/src/hub/missions/planner.ts:586-591`

`return { ...agent, model: fallbackModel }` substitutes the parent session's model for a tier
label — without inheriting the parent's `providerCredentialId`. On a subscription-pinned parent the
safety net silently re-routes the agent to the metered twin. Same shape as F2.

---

### Security findings (WP 3.2, D-MI3)

The core secret-flow is **clean**: decrypted stdio `env` / HTTP headers / OAuth tokens reach exactly
one sink, `driver.start()` (`apps/api/src/hub/subscription-adapter.ts:490-502`), and nothing else.
They are not logged (the two new log statements carry a server *name* + `error.message` only), not
persisted (every `persist()` call carries phase/message/usage/tool-part data only), not put in the
prompt (`toolListText` is names only), and not returned by any route — `createHubSubscriptionMcpResolver`
is referenced only from `apps/api/src/index.ts:95,603`. This is locked by a real test that deep-scans
prompt, allowlist, env, events, session row, result and log buffer for all three secrets
(`apps/api/test/hub-subscription-mcp-tools.test.ts:565-596`). The `hub_usage_summary` payload carries
only a credential nanoid + the operator's own label (`ProviderRepository.list()` redacts; `hasKey` is
a boolean) — no key, no ciphertext, no fingerprint. The allow-list gate is genuine default-deny
(`makeAllowListGate`, exact `Set.has` — no regex, glob, prefix or case folding; `ListMcpResources` /
`ReadMcpResource` are denied by it). No `McpSession` is opened, no process is spawned in the API, and
the temp workspace is cleaned in `finally`.

Three real gaps:

**S1 · MEDIUM · UNRECORDED — zero grants ⇒ no gate at all.**
`apps/api/src/hub/subscription-adapter.ts:498-500`:
`...(allowedTools.length > 0 ? { allowedTools, canUseTool: makeAllowListGate(allowedTools) } : {})`.
A **mission-agent** subscription turn has no `ask_user` bridge (`session-service.ts:1113-1115`) and
may have zero MCP grants — in which case neither `allowedTools` nor `canUseTool` is passed and the
only protection is the 20-name `disallowedTools` deny-list, against an SDK whose built-in roster is
larger (`ListMcpResources`, `ReadMcpResource`, `EnterWorktree`, `SendMessage`, `AskUserQuestion` are
all in the installed typings and **not** on the list). Preserved deliberately as the "byte-identical
pre-WP3.2 shape", but WP 3.2 + WP 4.2 are what made this branch reachable. `tools: []` plus an
always-on `canUseTool` would close it.

**S2 · LOW-MEDIUM · UNRECORDED — a stated invariant is false: nanoid *can* contain `__`.**
`apps/api/src/hub/subscription-tools.ts:211-212` asserts *"The server key is a nanoid server id,
which never contains `__`"*. nanoid's alphabet is
`useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict` — it contains `_`, so ~0.5% of
21-char ids contain `__`. Consequence: `parseSubscriptionToolName` mis-splits, and
`subscription-adapter.ts:694` stamps `HubToolPart.serverId` with the **wrong server** on a persisted
event — a provenance lie in the console's per-server chips. A contrived aliasing case also follows
(tool `Y__Z` on server `X` produces the same qualified string as tool `Z` on server `X__Y`). Fix:
use a sanitized per-turn key (`s0`, `s1`, …) and keep a key→serverId map for attribution.

**S3 · LOW-MEDIUM · UNRECORDED (inherited, newly reachable) — an MCP child may inherit the subscription token.**
`apps/api/src/testing/subscription-tools.ts:96` sets `entry.env` **only** when the server has
configured env vars, so a server with none gets no `env` key and its environment is whatever the CLI
decides. The Agent-SDK child's own env contains `CLAUDE_CODE_OAUTH_TOKEN`
(`apps/api/src/assistant/spawn-env.ts:58`), and tool output is persisted verbatim
(`subscription-adapter.ts:709-717`) and streamed to the browser. A hostile or merely curious MCP
server that returns its `process.env` would land the operator's subscription token in the DB and the
UI. The file is **pre-existing** (not in this diff) — but WP 3.2 is what first reaches it from the
Hub with operator-registered stdio binaries. One-line mitigation: always set `env` (to `{}` when
empty). Related: `subscription-adapter.ts:622-625` takes the SDK's `driver.start` error text verbatim
into a persisted+streamed `error` event, so the "no secret in a persisted event" contract currently
rests on trusting a third-party bundle's error strings.

---

## 3. Mutation-probe results

Every mutation was reverted with `git checkout --`; the tree is clean at `19643220` (`git status
--porcelain` empty, verified after each probe and at the end).

| # | WP | Mutation | Caught by |
| --- | --- | --- | --- |
| 1 | **2.1 / 2.2 / 4.4** (2.1 never claimed a probe) | `createHubModelResolver` discards its `providerCredentialId` arg | **11 api tests** — subscription-wins, 3× D-MI9 409, 3× create-409-writes-no-row, unpin PATCH, 3× `/messages` sink |
| 2 | **3.1** (unclaimed) | `hubModelWireFields` drops `providerCredentialId` | **19 web tests / 7 files** — NewSessionDialog ×5, Composer ×4, ConversationPane ×4, CrewProfileModal ×2, DirectoryTab, AssistantView, use-hub-models ×2 |
| 3 | **3.1 / D-MI8** (unclaimed) | `hubModelOptionKey` → bare `modelId` | **5 web tests** — roster twin survival, key scoping, 3× limit-retry |
| 4a | **4.1** (claimed) | cmdk `value = modelId`, ordinal loop intact | **NOTHING — 0 of 1117** → finding F10 |
| 4b | **4.1** (claimed) | `value = modelId` **and** ordinal disambiguator disabled | **7 tests** (4 real-cmdk + 3 pure) — this is the real guarantee |
| 5 | **1.2 / D-MI6** | add a kind to `PROVIDER_KINDS` | **typecheck** — `TS2741` at `constants.ts:124` |
| 6 | **3.3** (unclaimed) | attribution ignores `session.providerCredentialId` | **5 api tests** — Anthropic-CLI bucket, 2-credential split, pinned-vs-legacy, reconciliation, dock/route parity |
| 7 | **4.2** (unclaimed) | `isStructuredOutputModel` drops the `providerKind` branch | **1 test only** — its own unit test. No behavioural/integration test notices |

### Things I broke that NO test caught

1. **Probe 4a** — the human-text composition of the cmdk `value`. Harmless in effect (search rides
   `keywords`, uniqueness rides the ordinal), but it falsifies STATUS's WP 4.1 probe claim → **F10**.
2. **Probe 3, second-order** — with the key collapsed, both twins render as selected
   (`HubModelPicker.tsx:269`) and `HubModelPicker.test.tsx`/`.cmdk.test.tsx` still pass → **F11**.
3. **Probe 7's thinness** — reverting the *core* of WP 4.2's kind-aware structured-output reasoning
   costs exactly one unit test. Nothing downstream (synthesis routing, best-of-N judge,
   `pickAuxiliaryModel`) notices, even though WP 4.2 claims all three were rewired for it. The
   guarantee is asserted at the unit, not at the behaviour.
4. **Not reachable by mutation at all** — F1, F2, F3, F4, F7 and F12 are *missing* code, not wrong
   code. No mutation can surface them, and no existing test covers them: there is no test anywhere
   for a session whose turns ran on two different credentials, and none asserting a saved
   agent's/crew member's pin reaches a mission child.

### Methodology note (a false positive I generated)

A concurrent read-only analysis pass read `use-hub-models.ts` **while probe 3 was applied** and
reported the mutation as a genuine CRITICAL defect in the tip commit. It was my mutation. I
discarded it. Recording it because it is exactly the kind of artefact that gets copied forward — the
tip commit's `hubModelOptionKey` is correct, and `git status` is clean.

---

## 4. Bottom line

- **Criteria 2, 3, 6 hold** and are backed by tests that fail for the right reasons.
- **Criterion 1 holds for the primary flow only**, and its last mile is unprovable offline.
- **Criteria 4 and 5 do not hold**, for two unrecorded structural reasons (F2, F1) that share one
  root: *the plan added `providerCredentialId` to nine wire shapes but only wired it through on the
  session path.* On the agent/crew path it is validated, persisted and never read; on the per-turn
  path it routes the turn but is never recorded, so the money is attributed to the wrong credential.
- Neither is a regression — both are gaps the workstream set out to close and did not — but both are
  **stated acceptance criteria**, and the ledger currently reads as though all six are met pending
  only an owner walk. They are not.
