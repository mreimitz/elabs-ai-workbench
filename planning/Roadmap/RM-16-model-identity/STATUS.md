---
type: "Status Ledger"
title: "model-identity \u2014 work-package status ledger"
description: "Living state for the model-identity plan, read and updated by the next-wp skill (and the /next-wp"
tags: ["roadmap", "RM-16"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---
# model-identity — work-package status ledger

Living state for the model-identity plan, read and updated by the `next-wp` skill (and the `/next-wp`
command). It picks the next open WPs whose dependencies are done, runs them with parallel worktree
sub-agents, and ticks a box only when that WP's Acceptance is met and the quality gate is green.

**Plan:** [`README.md`](./item.md) (mission + D-MI log + WP index + dependency graph) ·
per-WP specs under `phase-*/`.

**Legend:** `[ ]` open · `[x]` done. A trailing `status:` note marks `in progress` / `in review` /
`blocked` / `owner-gated`. Done lines record the date + branch: `… — done YYYY-MM-DD ·
wp/model-identity/<id>`.

**Status:** 🔄 **IN PROGRESS** — started 2026-07-27 on **`feat/model-identity`** (forked from `main`
@ `72c67aea`). Owner locked all four gating decisions on 2026-07-27: real MCP tools in the
subscription adapter (D-MI3), subscription executor in mission agents (D-MI4), the label
**"Anthropic CLI"** (D-MI5), and full scope (all WPs).

**ALL 16 WPs done** (1.1–1.3, 2.1–2.3, 3.1–3.3, 4.1–4.4, 5.1, 5.R, 6.1). Integrated on
`feat/model-identity` (tip `467ff955`), **authoritative full gate green** 2026-07-27: typecheck ✅ ·
lint ✅ (1471 files) · **shared 85 / api 3343 pass 0 fail / web 310 files 3180 pass + 5 skipped** ·
build ✅. Not merged to `main` — the owner merges after acceptance.

### Acceptance (README §5) — final standing

| # | Criterion | Standing |
| --- | --- | --- |
| 1 | Anthropic CLI → Sonnet runs on the subscription child; session persists the pin | **Holds for the primary flow — last mile unprovable offline.** No agent can run a signed-in subscription; the strongest evidence is the WP 2.1 run against a *copy* of the owner's real DB (same id `claude-sonnet-5` → `subscription_reference` when pinned to the subscription vs `api_exact` when pinned to the API key), which proves the branch is reachable, not that a turn ran on it. **Owner-acceptance.** |
| 2 | Same-kind credentials distinguishable everywhere; no swallowed twin | **Holds** (5.R verified; tests fail for the right reasons) |
| 3 | Exactly one `Record<ProviderKind, …>` label map | **Holds** (5.R grepped the repo; the one survivor is a derived projection) |
| 4 | Subscription-pinned agent runs in a mission, or fails **by name** | **Failed at 5.R, fixed in 6.1 (F2)** |
| 5 | Subscription spend never buckets as "Anthropic" | **DOES NOT HOLD — owner-deferred** (see below) |
| 6 | Gate green | **Holds** (numbers above) |

> **Criterion 5 ships as a known failure, by owner decision (2026-07-27).** Cost is attributed from the
> session row, but billing happens per **turn**, and a per-message `providerCredentialId` is never
> persisted — so a turn run on the subscription via a per-message override reports under the session's
> old pin, badged **Metered**, with `unpinned: false` (asserted, not flagged as a guess). Not exotic: WP
> 3.1 shipped per-message override deliberately and WP 4.3's retry button depends on it. **Nothing
> regressed** — this is a pre-existing reporting inaccuracy the review surfaced, not something the
> workstream introduced. Fix shape when picked up: attribute at the **event** level (`costBasis` is
> already per-event) and give `HubUsageBucket` the `unpinned` marker it lacks. Tracked as **F1** in
> [`refute-review.md`](./refute-review.md).

**Standard adopted mid-plan:** from WP 2.2 onward every behavioural fix is **mutation-probed** — the fix
is reverted, the new tests are observed failing with the specific wrong behaviour, then restored. This
caught real weakness repeatedly: WP 2.2's first round passed at the resolver while the route still
500'd; WP 4.1's probe showed 4 of 7 cmdk tests load-bearing and the rest decorative; WP 6.1's probe of
`hub_agent_create` confirmed ineligible pins were being silently accepted. WP 5.R found one ledger probe
claim that was **not reproducible as written** — see F10. The plan grew from 14 to 15 WPs: WP 4.4 was promoted out of
the "owner follow-up" note once WP 4.3 proved it makes a *retry silently do nothing*, and once the 2.2
agent found the codebase already contains the fix pattern — so it is a bug, not the owner-gated
contract change it was first filed as.

**Standard adopted mid-plan:** from WP 2.2 onward every behavioural fix is **mutation-probed** — the
fix is reverted, the new tests are observed failing with the specific wrong behaviour, then restored.
Three WPs (2.2, 4.1, 4.3) found that a test which *passes* proves less than a test that *fails for the
right reason*; 4.1's probe in particular showed 4 of 7 cmdk tests were load-bearing and the rest
decorative.

> **Plan-folder note:** README §4 and this ledger both say "specs live under `phase-*/`", but that
> folder does **not** exist — the plan is README §4's WP table plus the D-MI decision log. WP briefs
> are derived from those. Either write the specs or correct both pointers.

> **Unrelated pre-existing flake, fixed in passing** (`06d8a8c7`, committed separately so it can be
> dropped): `hub-workspace.test.ts`'s "listWorkspaceSnapshots is newest-first" failed ~20% of runs
> (1-in-5 locally; the WP 3.3 agent independently hit it too). `workspace.ts` and its test are
> byte-identical between this branch and its base, so it predates the workstream. Cause:
> `createWorkspaceSnapshot` stamps millisecond-precision `createdAt` and the sort is `createdAt` DESC
> then `id` DESC, so two back-to-back snapshots usually tie and the order falls to a random nanoid.
> The **product** behaviour is correct and deliberate (the adjacent F3 test locks the tie-break); only
> the assertion was wrong. Fixed by spinning until the clock ticks. Verified stable 8/8.

### The root-cause fix is VERIFIED against the owner's real data (2026-07-27)

Ran the built API against a **copy** of the live `/data/app.sqlite` on port 8099 (the owner's running
instance was never touched; the copy + its `mcp-secret.key` were deleted after). Migration v55 applied
cleanly to the real 95 MB DB (`PRAGMA user_version` 54 → 55, both columns present). Creating a session
on the SAME model id `claude-sonnet-5` three ways:

| request | `providerCredentialId` | `capabilities.costBasis` |
| --- | --- | --- |
| unpinned — byte-identical to the owner's failing session | `null` | `api_exact` (legacy heuristic, deliberately preserved) |
| pinned to the `claude_subscription` credential | persisted | **`subscription_reference`** |
| pinned to the `anthropic` API credential | persisted | `api_exact` (explicit metered choice honoured) |

`subscription_reference` is the observable that proves the `claude_subscription` branch in
`session-service.ts` is **reachable for the first time** — the failing session's persisted
capabilities read `api_exact`, which is how the mis-routing was diagnosed. Row 1 is the regression
lock: a pre-v55 session still resolves exactly as before.

**Still NOT verified** (needs the owner): an actual turn on the subscription child against a real
signed-in account. The proof above stops at the resolution/branch point — no model was called.

**Origin.** Owner report 2026-07-27 against the running instance: a Hub session on an "Anthropic CLI"
model failed with *"Your credit balance is too low to access the Anthropic API."* Root-caused by a
54-agent audit (6 investigation areas, every finding adversarially verified) — see README §1.

---

## Phase 1 — Shared contract (no dependencies; all three run in parallel)

- [x] WP 1.1 — additive optional `providerCredentialId` on 9 wire types + 8 zod schemas (7 are `.strict()`; `hubPlannedAgentSchema` **stripped silently**); read side exposes `string | null`, patch variants `.nullable()` — depends: — — done 2026-07-27 · `3a4c1c7f`
- [x] WP 1.2 — `PROVIDER_KIND_META` exhaustive `Record<ProviderKind, {label, shortLabel, logoProvider, billing}>` + `providerKindLabel()`/`providerKindShortLabel()`/`providerKindBilling()` + `PROVIDER_KIND_BILLING_LABELS` in `packages/shared/src/constants.ts`; `claude_subscription` label = **"Anthropic CLI"** (D-MI5) — depends: — — done 2026-07-27 · `3a4c1c7f`
- [x] WP 1.3 — model-data gap closed via `ROSTER_GAP_MODEL_CONTEXT_LIMITS` + `ROSTER_GAP_MODEL_PRICING` (merged **before** the `GENERATED_*` maps, so a dataset refresh wins and the seed becomes dead weight — `model-data.generated.ts` NOT hand-edited); dated snapshot ids listed explicitly (no alias normalization exists); 3 invariant tests over `ASSISTANT_DEFAULT_MODEL_ROSTER` — depends: — — done 2026-07-27 · `caea18a5`

## Phase 2 — Resolver + registry adoption

- [x] WP 2.1 — **the correctness fix.** `HubModelResolver` widened to `(modelId, providerCredentialId?)`; explicit credential validated (exists · `isHubModelKind` · `authBroken !== true`) and used as-is, heuristic never runs; absent ⇒ byte-identical legacy behaviour + a structured `log.warn`; migration **v55** (`hub_sessions` + `hub_agents` `provider_credential_id`, `ON DELETE SET NULL`) + baseline DDL + repository round-trip; mission child sessions carry the planned agent's pin (else the column would be permanently NULL on that path). 6 new tests incl. the rewritten `hub-routes.test.ts` block that previously locked the bug — depends: 1.1 — done 2026-07-27 · `bf7df8d6` (merge `a63a1788`)
- [x] WP 2.2 — fail honestly (D-MI9). `resolveExplicitHubCredential` now **throws 409** (unknown / non-hub-eligible / `authBroken`) instead of returning `undefined` and degrading to the heuristic, and the guard is applied at **all four** routes that write a `provider_credential_id`: session create, session **PATCH re-pin**, and **saved-role create/patch**. Heuristic fallbacks log `heuristic: "name_hint_match" | "first_eligible"`, so the accidental `?? pool[0]` path (the one that makes a subscription-only install work by luck) is finally distinguishable from a deliberate hinted match. **Took three review rounds — two genuine defects were only found at the route level:** (a) session create persisted the row *before* resolving, so an unknown pin died on the FK as an opaque **500** (`foreign_keys = ON`; `index.ts:1361` maps only `ZodError`) and the resolver never ran — resolving first also removed the orphan `hub_sessions` row a refused create used to leave, including the pre-existing `assertHubModelKind` case; (b) PATCH re-pin and saved-role create/patch wrote the column with **no resolver call at all**, so a non-eligible/`authBroken` pin was **silently persisted with a 200/201**, deferring failure to the next turn. Every failure mode was proven by reverting the guard and observing the wrong status before restoring. Surface sweep confirmed (independently re-verified): exactly 4 write bindings, all guarded; the Assistant dock's `fallback_provider_credential_id` is a different column that already validates. api 852 → 867 hub tests — depends: 2.1 — done 2026-07-27 · `wp/model-identity/2.2` `73d4a24a` (merge `ca0fc31a`)
- [x] WP 2.3 — adopted `PROVIDER_KIND_META`; deleted the 3 competing label maps + 2 raw-`kind` renders; qualified `resolvedSourceLabel` to **"Claude CLI judge"** at 3 call sites (D-MI5 consequence); `NO_PROVIDER_MESSAGE` + the Assistant empty-state prose now GENERATED from the registry. Confirms the owner's defect 3 concretely: Settings said **"Claude (subscription)"** while the Hub picker said **"Anthropic CLI"** for the same provider. Follow-on `f8bf1a44` extends it to `assertHubModelKind`'s 400, which leaked raw wire literals. Web suite 307 files / 3101 pass — depends: 1.2 — done 2026-07-27 · `1568a95c` (merge `b5406173`)

## Phase 3 — Threading + the subscription session made whole

- [x] WP 3.1 — threaded the credential through the **existing** pickers (no redesign): selection state in `NewSessionDialog` / `Composer` / `workforce/DirectoryTab` / `crew-profile/CrewProfileModal` now holds the whole roster **row**, so `providerCredentialId` reaches the wire on session-create and per-message override. Roster dedupe keys on `hubModelOptionKey()` = `${credentialId}::${modelId}` (D-MI8) — colliding twins both survive; the composite is **local only** (never the wire, never a cmdk `value`, never a `MODEL_CONTEXT_LIMITS`/`resolvePrice` key). New `findHubModelOption()` + `hubModelWireFields()` — one helper so no call site can drop the credential again. **In-scope catch:** Composer's "Switch model" excluded the session's model *by bare id*, so a session on the metered `claude-sonnet-5` could not reach the subscription twin; it now excludes by credential × model (unpinned sessions keep by-id). Web suite 3101 → 3117 pass — depends: 1.1, 2.1 — done 2026-07-27 · `wp/model-identity/3.1-web` `bbef2b17` (merge `f7d78d76`)
- [x] WP 3.2 — **real MCP tools in the Hub subscription adapter** (D-MI3): new `hub/subscription-tools.ts` (`createHubSubscriptionMcpResolver`) **reuses** the Testing path's `buildSubscriptionToolWiring` rather than forking it; granted servers become Agent-SDK `mcpServers` + `mcp__<serverId>__<toolName>` allow patterns, fed to `assembleSessionPrompt` (the hardcoded `tools: {}` is gone) and gated by the Testing executor's **default-deny** `makeAllowListGate` (exported, not copied). The `ask_user` bridge is **merged**, never displaced; grant rule mirrors `resolveHubMcpGrants` but opens **no** `McpSession` (the SDK child connects them itself, D-CS9). Decrypted stdio env / http headers reach `driver.start()` and nothing else. Absent resolver ⇒ byte-identical pre-WP3.2 shape. 16 new tests — depends: 2.1 — done 2026-07-27 · `wp/model-identity/3.2-tools` `962cf52a` (merge `e91fafd5`)
- [x] WP 3.3 — honest cost attribution (D-MI10): `providerKindFor` widened from `(modelId)` to take the **session**, so `createHubUsageProviderResolver` reads the persisted `provider_credential_id` first and calls the name heuristic **only** for a NULL (pre-v55) row — those flagged `unpinned`, never blended. A set-but-unresolvable id degrades to the heuristic (no phantom bucket). `usage.ts`'s local `PROVIDER_LABELS` **deleted** in favour of the D-MI6 registry, so subscription spend buckets as **"Anthropic CLI"**. Additive `byProviderCredential` wire field + a "Billed to" panel (`UsageBilling.tsx`, all `@elabs-ai/components-*`); `SubscriptionCostMarker` deliberately **not** reused. Both call sites updated (`hub/routes.ts` usage wiring + the dock's `hub_usage_summary`, which now gets the **redacted** provider list). Both rollups share one memoized attribution so they cannot disagree. 400-line attribution suite — depends: 2.1, 1.2 — done 2026-07-27 · `wp/model-identity/3.3` `b2c17ed3` (merge `e3af19b2`)

### Carry-forward findings from Phase 3 (fold into the WP that owns them — do not re-discover)

- ~~**WP 4.1 — duplicate cmdk `value` for twins.**~~ **Closed by 4.1**, and the intended fix was
  *insufficient*: `keywords` feed `commandScore` only — cmdk writes just `value` into `data-value`, so
  twins sharing one still collapse under ArrowDown/Enter. Resolved by composing `value` from human text
  + a deterministic ordinal, never the nanoid. Mutation-probed.
- ~~**WP 4.1 — same-kind credentials are visually indistinguishable.**~~ **Closed by 4.1** (credential
  chip + per-credential grouping).
- ~~**WP 4.1 — no re-pin UI exists.**~~ **Closed by 4.1** — a composer footer action PATCHes via
  `updateHubSession` + `hubModelWireFields`. Note it lands on the PATCH route WP 2.2 hardened, so an
  unusable pin now 409s there rather than being silently persisted.
- **Regenerate cannot carry a credential (needs a shared-type change).** `ConversationPane.tsx:~1920`
  replays a persisted `user_message`'s `model`, but `HubUserMessageEvent` / `HubQueuedUserMessageEvent`
  (`packages/shared/src/types.ts`) expose **no** `providerCredentialId` — so a regenerate silently falls
  back to the session pin. D-MI2 says per-message overrides "ride the existing `user_message` event
  blob", but the **read** wire doesn't surface it. Closing it is an additive WP-1.1-shaped change
  (shared type + API emit) — assign it deliberately; it is currently owned by no WP.
- **WP 2.2 overlaps WP 3.3 in `hub/routes.ts`.** 3.3 has landed (usage wiring ~:1584 + the corrected
  `inferHubModelKind` doc comment); 2.2's target — `createHubModelResolver` ~:291-320 — was left
  untouched on purpose. 2.2 is now unblocked and conflict-free.
- ~~**WP 4.2 also collides with 2.2 in `createHubModelResolver`.**~~ **Resolved** — 2.2 merged
  (`ca0fc31a`), so 4.2 is unblocked. (For the record: README §1 blast-radius row 6 points the "review
  critic" at `routes.ts:314`, inside `createHubModelResolver` ~:291-320 — 2.2's exact target. The
  kickoff's `{4.1, 4.3}`-then-4.2 grouping missed this.)
- **WP 4.2 — D-MI9 makes the generic-failure string reachable more often (from the 2.2 agent).** A
  credential pinned inside `hub_missions.plan_json` / `hub_crews.members_json` has **no FK** (they are
  JSON blobs, D-MI2), so a since-deleted credential cannot degrade via `ON DELETE SET NULL` — under
  D-MI9 it now **409s at agent/synthesis turn time**. `orchestrator.ts:~1690` / `~1756` catch that into
  the generic *"The agent failed to produce a report."* — precisely the string D-MI4 charters WP 4.2 to
  replace with a by-name failure. Fold it in; don't re-discover it.
- ~~**Owner follow-up, owned by no WP — `/messages` is fire-and-forget.**~~ **Promoted to WP 4.4**
  (Phase 4). Two later findings changed its status: WP 4.3 showed the consequence is a **silent no-op
  retry**, not merely a missing log; and the fix needs **no** 202-contract change, because
  `session-service.ts:681-687` already emits `error` + `turn_done` to the sink for the same reason.
- **Mission board cannot show a by-name agent failure (from the 4.2 agent).** WP 4.2's named failure
  lands as an `error` event on the **child** session log — visible only by drilling into that agent's
  console. `board.ts` has no per-agent failure event, so the mission board still renders a failed agent
  as `reported: false`, indistinguishable from "still running/skipped". Pre-existing; closing it means a
  new parent-log event (shared wire change + `MissionBoard.tsx`). The by-name guarantee is honest but
  **buried**. Owned by no WP — owner's call.
- **`acquireSlot`'s cap-409 is silent over the same 202 route (from the 4.4 agent).** The active-session
  concurrency cap rejects with a 409 that, for the *identical structural reason* WP 4.4 just fixed,
  never reaches the operator. It is a different condition — retry-later, not a refused credential — and
  has nothing to do with model identity, so 4.4 deliberately left it rejecting and recorded it in a code
  comment. **The WP 4.4 guard is the template for fixing it.** Owned by no WP.
- **Duplicate topology vocabulary (from the 5.1 agent).** `workforce/CrewCard.tsx:12` defines its own
  local `TOPOLOGY_LABELS` with short-form values — a duplicate of the vocabulary now centralized in
  `agents/crew-topology.ts`. Pre-existing drift, deliberately left alone (outside 5.1's named scope).
- **`currentCredentialId` in the retry picker is an approximation (from the 4.3 agent).** It is the
  *session* pin, not the failed turn's actual per-message credential — the read wire cannot express the
  latter (same root as the regenerate gap below). It only feeds twin-selection and the avoid-the-failed-
  credential guard, and `retrySourcesFor` already offers disjoint classes, so it degrades safely.

## Phase 4 — One picker, missions, retry

- [x] WP 4.1 — **one `HubModelPicker`** (`HubModelPicker.tsx` + pure `hub-model-picker.ts`) adopted at **9 call sites**, replacing 4 implementations *and* 3 surfaces that had **no picker at all** (they silently took `roster.models[0]`): NewSessionDialog · Composer · agent-profile/FormSections · QuickCreate · agents/RoleEditor · crew-profile/MembersSection · HubLimitErrorBanner · workforce/DirectoryTab · crew-profile/CrewProfileModal. Row = logo · display name · raw model id · billing badge · credential chip **only when its kind has >1 credential**; grouping per credential when a kind has several, else per kind, ordered `kind`→`label`→`credentialId` (never `updated_at DESC`). `authBroken` renders **disabled-and-visible** with its reason via `aria-describedby`. Labels all from the D-MI6 registry — no new map. **Load-bearing finding: `keywords` alone was NOT sufficient** — verified against cmdk 1.1.1 source, only `value` is written to `data-value` and `getSelectedItem()` returns the *first* `aria-selected` match, so two twins sharing a `value` are one item to ArrowDown/Enter, permanently. Fix without the nanoid (D-MI7): `value` is composed from **human text** (display name · raw id · credential label, + a deterministic `(n)` ordinal only when two credentials of one kind share a label), assigned after group ordering so it is stable; `commandScore` already scores `value + keywords`, so the credential label costs nothing while a nanoid would be pure noise. **Mutation-probed** — forcing `value = modelId` fails 4 of 7 real-cmdk tests. **Latent bug also closed:** `defaultHubModelOption()` replaces every `models[0]`, so editing an unrelated credential's label no longer changes which provider a crew instantiates on. **Re-pin UI built** (composer footer "Pin ⟨model⟩ as this session's model", offered only when the override differs by credential × model), closing WP 3.1's wire-level-only gap. `brand-ai-mock.tsx` repaired (controlled search, filters on `value` + `keywords`, honours `disabled`/`aria-*`) + a separate real-cmdk mock for role fidelity. Web 308→**311 files, 3123→3175 pass** — depends: 3.1, 2.3 — done 2026-07-27 · `wp/model-identity/4.1` `54dded86` (merge `a29bc4ed`)
- [x] WP 4.2 — **subscription executor in mission agents** (D-MI4). New `missions/agent-report-contract.ts` owns **both** halves of the prompt-enforced `HubAgentReport` contract (instruction + parse-and-repair) so they cannot drift, with exactly three honest outcomes — `parsed` / `absent` (deterministic prose projection, visibly noted) / `unusable` (named throw). **A report is never fabricated.** The generic *"The agent failed to produce a report."* is gone from every live path (`describeAgentFailure` names agent + model + cause); it survives only in explanatory comments. **`isStructuredOutputModel(modelId, providerKind?)` now reasons about the resolved credential KIND** — a subscription-pinned agent carries a canonical Anthropic id, so the old `!startsWith("assistant|")` string test wrongly reported it `generateObject`-capable; ids stay un-namespaced (D-MI1). Also: the **server-side sibling of D-MI8** — the mission roster in `index.ts` deduped on the bare id, swallowing a colliding twin with the winner flipping on `updated_at DESC`; synthesis carries `providerCredentialId` + a `degradedNote` so a subscription-only mission says *why* its answer is mechanical instead of silently landing on `deterministicSynthesis`; the planner strips an invented/deleted pin under its own distinct notice prefix; `pickAuxiliaryModel` routes extraction + the best-of-N judge to a model that can actually run them. Stubbed at the `AgentSessionDriver` boundary throughout — no SDK, no child process, no `api.anthropic.com`, no real MCP server. api 3286 → **3310** — depends: 2.1, 3.2 — done 2026-07-27 · `wp/model-identity/4.2` `5a6ab5d7` (merge `1ee36e2a`)
- [x] WP 4.3 — limit-error retry actually switches source. `onRetry(source, modelId)` → `onRetry(source, target: HubModelOption)`, threaded banner → `LimitErrorRetryHandlers` → `TrailingLimitErrorTurn` → `handleRetryLimitError` → `sendHubMessage(…hubModelWireFields(target))`. A bare id cannot name a credential (the subscription roster emits Anthropic's canonical ids on purpose), which is why "Retry on subscription" retried on the API key. New pure `hub-limit-retry.ts` picks the target: rows of the named source only · never the credential that just failed · **prefer the colliding twin** of the failed model · else the first row in `buildHubModelGroups`' deterministic order. The button now states which model on which credential it will run; `unavailable` credentials reach the picker and distinguish "configured but broken" from "never configured". Two tests asserted the broken contract and were rewritten. **Mutation-probed** (revert to `model: target.modelId` ⇒ 4 wire tests fail; naive `roster.find` ⇒ 3 selection tests fail). `STOP_REASON_CODES` / `TerminalCause` **not** repurposed — locked byte-identical. No shared/api change needed: WP 1.1 already shipped `HubSendMessageInput.providerCredentialId` and `session-service.ts:701` already prefers it; the defect was three **web** hops dropping it. Web 311 → **312 files, 3193 pass** — depends: 3.1 — done 2026-07-27 · `wp/model-identity/4.3` `016763b6` (merge `fa688d71`). **Acceptance item 4 is PARTIAL** — see WP 4.4 below

- [x] WP 4.4 — **a refused pin on `/messages` is no longer a silent no-op** (added 2026-07-27, promoted from an owner-follow-up note). `dispatchMessage` awaited `resolveModel` with no try/catch — *before* `acquireSlot`, before the `user_message` `appendEvent`, before any `sink.onEvent` — while the route returns **202** and dispatches fire-and-forget into `.catch(… log.warn)`. So WP 2.2's D-MI9 409 on a per-message override reached **nobody**: a 202 followed by permanent silence, which made WP 4.3's "retry on the other source" button silently do nothing. The guard now emits `error` + `turn_done` over the same live sink, **matching the `@`-mention handoff path (`session-service.ts:681-687`) byte-for-byte** — same order, same `{type, message}` shape — so the client's existing handling works unchanged, and returns a new api-internal `HubDispatchResult` member. **The 202 and the route's `.catch` are UNCHANGED** (`routes.ts` is a comment-only diff — verified at integration); no `STOP_REASON_CODES` / `TerminalCause` value added or repurposed. Verified rather than assumed: no slot is acquired before the guard (nothing to release or double-release), no `user_message` persists for a refused send, and the steering/queued branch returns *before* the guard and is untouched. **Mutation-probed** — reverting the guard reproduces the bug verbatim: three route tests die with *"timed out waiting for turn 1 to settle"*. This upgrades WP 4.3's acceptance item 4 from client-proven-only to **end-to-end within the offline harness**. api 3310 → **3317** — depends: 2.2, 4.3 — done 2026-07-27 · `wp/model-identity/4.4` `edc89950` (merge `0a5bdb84`)

## Phase 5 — Cleanup + review

- [x] WP 5.1 — dead pickers deleted (`RoleEditor`, `RoleLibraryPanel`, `CrewEditor`, `CrewLibraryPanel` + their tests). **Extraction first, as its own commit:** `crewFormToTopoInput` / `TOPOLOGY_LABELS` / `TOPOLOGY_SHORT` moved verbatim to `agents/crew-topology.ts`, with **`CrewEditor` itself repointed at the new module before deletion** — so the move is proven behaviour-preserving by that component's own 4 tests, not merely by typecheck. New `crew-topology.test.ts` (7 tests) locks it, including the subtle case: dropping a nested-crew member (no `agentId`) must **not** shift a surviving node's index-derived id. **Unreachability proven, not assumed** (the plan's list predated 4.1, which had already found its own inherited list drifted): the importer graph over the four is **closed** — every inbound edge lands on another candidate or a candidate's own test — and checked beyond static imports for lazy `import()`, barrel re-exports (`agents/` has no `index.ts`), and routes (`App.tsx`'s only edge into `hub/agents` is the lazy `AgentsView`, which stays). Independently re-verified at integration: on the pre-deletion tree the only importers are the candidates + their tests, and every surviving mention on the branch is a **comment**. No route removed ⇒ `ASSISTANT_ROUTE_MANIFEST` untouched, both halves of the `assistant-route-operability` gate pass. **Root cause was upstream of 4.1:** assistant-hub-ux WP2.1 deleted `AgentsView`'s Roles/Crews `TabPanel` and replaced it with the workforce frame, orphaning both library panels; 4.1's picker adoption then cut the last shared symbol. Web 312 → **310 files, 3193 → 3180 pass** (−20 from three deleted suites, +7 from `crew-topology.test.ts`, no collateral) — depends: 4.1 — done 2026-07-27 · `wp/model-identity/5.1` `625cda82` (merge `be649815`)
- [x] WP 5.R — adversarial refute-review. **Found that 2 of 6 acceptance criteria did NOT hold**, both independently re-verified at integration before acceptance. Report: [`refute-review.md`](./refute-review.md) (12 findings, severity-ordered, + 7 mutation probes + a security pass). **Criterion 5 FAILED** — attribution granularity is the session row while billing granularity is the turn: a per-message `providerCredentialId` routes the turn but is never persisted (`updateSession` has exactly two call sites, both operator routes), so subscription spend reported under **"Anthropic"**, badged Metered, with `unpinned: false` — asserted as measured fact. **Criterion 4 FAILED** — `roleToPlannedAgent` copied model/toolGrants/skillIds/budgets but **not** `providerCredentialId`, so a saved agent's validated, persisted pin was silently dropped on every crew launch. **One root cause: the field was threaded through the SESSION path only.** The review also corrected two ledger errors of my own (the regenerate gap named the wrong hop — it falls back to the *heuristic*, not the session pin; and WP 4.1's exemplar probe claim is not reproducible as written — the ordinal disambiguator is the load-bearing part) and caught + discarded a false positive a concurrent analysis pass generated by reading a file mid-mutation. Gate re-run in full and clean; `hub-workspace.test.ts` did **not** flake — depends: all — done 2026-07-27 · `wp/model-identity/5.R` `3517e30f` (merge `be15cb4b`)

## Phase 6 — refute-review remediation

- [x] WP 6.1 — **finish threading the pin.** Closes 8 of 12 findings, one commit each, all mutation-probed (14 reverts, **every one caught**; nothing broken went unnoticed). **F2** (HIGH, criterion 4) `roleToPlannedAgent` + `hydratePlannedAgentFromRole` carry the pin. **F5** crew routes + all four dock write tools now share the D-MI9 validator (`hub/credential-guard.ts`) — WP 2.2's sweep counted four *bindings* and missed crew-member pins as a fifth *write*; the probe confirmed ineligible/`authBroken` pins were being **silently accepted**. **F3** a branch (regenerate) carries the source pin instead of forking unpinned onto the heuristic. **F4** the steering queue stops dropping a sent credential and stops stamping a model that never ran *(partial by design — see below)*. **F7** mission propose carries the composer's pick. **F8** plan edits validate their pins. **F9** review critic. **F12** `normalizePlannedModels`. **The organising rule is one new function, `pinForModel`: a pin survives only alongside the model it was authored with** — a layer that pins without naming a model re-pins what it inherited (criterion 2's twin case), while a pin whose authoring model was overridden is **dropped to the heuristic**, deliberately *not* a 409, because the operator never made that stale choice. **F6** per the owner's decision (keep the hand-authored maps): built D-MI11's missing **unpriced-by-design** path and made the roster gap **loud** — the old guard iterated a static 4-item constant while live ids come from the SDK, so a new subscription model silently re-armed `contextWindow: 0` (compaction off) with no log and no test failure; the misleading test comment is corrected. api 3317 → **3343** — depends: 5.R — done 2026-07-27 · `wp/model-identity/6.1` `9e78616c` (merge `467ff955`)

---

## Open items carried out of the plan (owned by no WP)

Ranked. Full evidence in [`refute-review.md`](./refute-review.md).

1. **F1 — cost attribution (criterion 5).** Owner-deferred; see the box above.
2. **F4 residual — a queued credential is recorded, not applied.** WP 6.1 fixed the drop and the false
   model stamp; honouring a mid-turn override needs rebuilding the model inside the drain loop (or, for
   a `claude_subscription` pin, switching executors mid-stream on a warm child). Structural. A
   `log.warn` names the un-applied override.
3. **F8 residual — a credential deleted *between* approve and spawn** still reaches `runLevel`'s raw
   `createSession` and 500s. `clampPlannedCredentials` runs at propose and for nested crews, but approve
   does not re-clamp.
4. **`acquireSlot`'s cap-409 is silent over the same 202 route** — identical structure to the bug WP 4.4
   fixed, different condition (retry-later, not a refused credential). WP 4.4's guard is the template.
5. **Mission board can't show a by-name agent failure** — WP 4.2's named failure lands on the *child*
   session log; `board.ts` has no per-agent failure event, so the board still renders `reported: false`.
   The guarantee is honest but **buried**. Needs a parent-log event (shared wire + `MissionBoard.tsx`).
6. **Security, report-only (5.R §S1/S3).** With zero MCP grants and no ask-bridge — the mission-agent
   subscription case — neither `allowedTools` nor `canUseTool` is passed, leaving only a 20-name
   deny-list; and `entry.env` is set only when non-empty, so an MCP child may inherit
   `CLAUDE_CODE_OAUTH_TOKEN`. The core secret-flow is otherwise clean and well-tested.
7. **F7 scope** — attachments and `@`-mentions are still dropped on mission propose.
   **F6 scope** — `notePlanPricingGaps` reads the root plan only; an unpriced model appearing solely
   inside a nested crew is not named.
8. **F11** — the picker's selected-row marking is untested for twins.
   **`CrewCard.tsx:12`** still carries a duplicate `TOPOLOGY_LABELS`.
9. **Convention deviation, flagged by the 6.1 agent:** F9's `providerCredentialId` was added to the
   *route-local* `hubReviewRequestBodySchema` + its documented web mirror rather than relocated to
   `packages/shared` — that file explicitly documents why request-only bodies stay local, and both ends
   were kept in sync in one commit. F7's propose body, which had no such mirror, *was* moved to shared.

## Owner acceptance (not self-certifiable by an agent)

- [ ] A real turn on **Anthropic CLI → Sonnet** against the signed-in subscription: it answers, and no metered call is made. **This is the only way criterion 1 can be closed** — every agent proof stops at the resolution/branch point or a stubbed driver boundary.
- [ ] Both-theme (`light` + `dark`) + keyboard walk of **`HubModelPicker` at all nine call sites** — plus the surfaces added during the plan: the **"Billed to"** panel (WP 3.3), the rebuilt **limit-error banner** (WP 4.3), and the composer's **"Pin ⟨model⟩ as this session's model"** action (WP 4.1). WP 4.1's keyboard proof is real cmdk under **jsdom, not a browser**.
- [ ] A **saved agent pinned to the subscription, launched via a crew**, runs on that credential (the criterion-4 defect WP 6.1 fixed — worth confirming live, since it was write-only for the entire plan until the review found it).
- [ ] Two same-kind credentials are distinguishable in the picker; the broken-credential row reads clearly.
- [ ] A mission with a subscription-pinned agent (D-MI4) behaves as specified.
- [ ] Usage/`byProvider` shows a distinct **Anthropic CLI** bucket, not "Anthropic".
- [ ] The label decision (D-MI5, "Anthropic CLI") reads correctly next to the qualified "Claude CLI judge".
