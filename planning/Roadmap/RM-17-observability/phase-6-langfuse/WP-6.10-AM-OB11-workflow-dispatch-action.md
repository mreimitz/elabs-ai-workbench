---
type: "Work Package Spec"
title: "WP 6.10 (AM-OB11) — a typed GitHub Actions workflow_dispatch rule action"
description: "A watch rule that dispatches a GitHub Actions workflow, closing \"regression detected → CI re-runs the suite\" with no new infrastructure and reusing the shipped encrypted-credential pattern."
tags: ["roadmap", "RM-17"]
timestamp: "2026-08-21T16:05:00Z"
status: "draft"
---
# WP 6.10 (AM-OB11) — a typed GitHub Actions `workflow_dispatch` rule action

## Verification finding

**No GitHub-Actions-shaped anything exists. But every piece this needs — the action seam, the
encrypted-credential pattern, and a signed-in GitHub account — is already shipped.**

Not built:

- The action union is a **closed six-member set** (`packages/shared/src/types.ts:2279-2286` persisted,
  `:2292-2299` input; frozen vocabulary `WATCH_ACTION_TYPES` at `constants.ts:589-597`; zod
  discriminated unions `schemas.ts:1193-1214` / `:1218-1239`): `notify`, `pin`, `add_to_collection`,
  `promote_to_test`, `run_grader`, `webhook`.
- A grep for `workflow_dispatch` across `apps/api/src`, `apps/web/src` and `packages/shared/src`
  returns **zero hits**.

The seam to extend, both in `apps/api/src/watch/actions.ts`:

- `executeWatchAction(action, {runId, run}, services)` — `:93-139`, `switch (action.type)` at `:99`,
  cases at `:100/104/108/112/116/131`, catch-all guard `:135-138`.
- `executeWatchWindowAction(action, {window}, services)` — `:205-247`; only `notify` (`:212`) and
  `webhook` (`:227`) are meaningful, and `default:` returns
  `"action '<type>' requires a run; not applicable to a windowed rule"` (`:237-242`).
- Injectable services: `WatchActionServices` (`:72-87`) — this is where a dispatcher would be injected
  so tests never touch the network (conventions §12).

Adding an action type therefore touches: the two unions + zod + `WATCH_ACTION_TYPES` + both switches +
`WatchActionServices` + the **fixed-slot** web form (`apps/web/src/features/watch/rule-form.ts:62-70`,
one slot per action type — a real constraint, not an incidental one).

The generic webhook, which stays as the base primitive:

- **URL storage is already encrypted, and the pattern is the one to copy.** Input carries plaintext
  `url` (`types.ts:2298`); `WatchRuleRepository.prepareActions` mints a `nanoid` `secretRef`, calls
  `this.secrets.encryptText(action.url)` and persists only the ref into `actions_json`
  (`apps/api/src/watch/repository.ts:239-262`, encryption at `:251`). Rows land in `watch_secrets`
  (`:264-272`; DDL `apps/api/src/db/schema.ts:862-868`, `ref` PK, `rule_id` FK `ON DELETE CASCADE`).
  Resolution is transient (`resolveWebhookUrl`, `:229-235`); update rotates
  (`DELETE FROM watch_secrets WHERE rule_id = ?` then re-mint, `:107-110`).
- **No request signing, no retry.** `postWebhook` (`actions.ts:173-195`) sends only
  `content-type: application/json` (`:182`) — no HMAC, no auth header, no custom headers anywhere in
  the contract — and does one `fetch` with `AbortSignal.timeout(WATCH_WEBHOOK_TIMEOUT_MS)` = 10 000 ms
  (`:184`, `constants.ts:605`). Non-2xx ⇒ `"webhook responded <status>"` (`:186-189`); network failure
  ⇒ `"webhook request failed"` (`:191-194`). No backoff, no dead-letter. The URL never enters a result
  or error, and `scrub()` (`:257-259`) strips URL-shaped text defensively.

**Credential storage — the important finding: do not invent anything.**

- **`api_tokens` from RM-08 exists but is the WRONG primitive here.** `hashToken()` is a plain SHA-256
  hex digest of the plaintext (`apps/api/src/api-tokens/service.ts:36-38`); the plaintext is returned
  once by `POST /api/tokens` and never persisted. That is correct for authenticating an *inbound*
  caller and useless for presenting an *outbound* credential — you cannot read a PAT back out of a
  hash. The Phase 6 ledger's instruction to "reuse `api_tokens`, do not invent a second token store"
  is right about not inventing one, but `api_tokens` is not the store to reuse.
- **The right existing pattern is the GitHub account service — a real GitHub credential, already
  shipped, with no migration.** `apps/api/src/github-account/service.ts` runs an OAuth **device flow**
  with scope `"repo"` (`:15`), stores the token as `this.secrets.encryptText(token)` into the
  `app_settings` KV under key `github_account` (`:12`, `:194-198`, write helper `:273`), reads it back
  via `decryptText` in `token()` (`:98-107`, degrading to `undefined` on an undecryptable blob), and
  exposes a redacted `GithubAccountStatus` that never carries the token (`:67-80`). Routes at
  `apps/api/src/github-account/routes.ts:21,24,30,36,42`. **It needed no migration** because it is KV.
  ⚠ **Verify the scope**: it requests `repo`, which is not necessarily what a `workflow_dispatch` call
  needs — check before assuming reuse.
- Three more encrypted-credential precedents if a per-rule credential is preferred to the account-wide
  one: collection git PAT (`apps/api/src/collections/repository.ts:53`, `:124`, `:188-191`
  `decryptPat()` marked "INTERNAL ONLY … never exposed by a route"), skill GitHub token
  (`apps/api/src/skills/repository.ts:213,246,263,318`), provider API keys
  (`apps/api/src/providers/repository.ts:42,82,130,136-149`).
- The encryption helpers, one place: `SecretStore.encryptText` (`apps/api/src/secrets/secret-store.ts:22`),
  `decryptText` (`:33`), `isEncrypted` (`:18`), `encryptJson` (`:62`), `readJson` (`:66`),
  `normalizeJson` (`:77`) — AES-256-GCM, AAD `mcp-token-footprint:secrets:v1`, format
  `enc:v1:<iv>:<tag>:<ct>` (`:5-9`, `:28`).

**Verdict: NOT BUILT.**

## Goal

Afterwards a watch rule can do something about what it noticed: "score dropped below 0.7 on the
nightly suite" stops being a notification the operator reads on Monday and becomes a GitHub Actions run
that re-tests and reports back — closing the loop between the bench detecting a regression and CI
confirming it, with no new service, no new infrastructure, and no new credential store.

## Scope

- **`packages/shared`** — add a seventh member to the action union and to `WATCH_ACTION_TYPES`, with
  its zod variant in both discriminated unions. The persisted shape carries `owner`, `repo`,
  `workflow` (file name or id), `ref` (branch/tag) and an optional small `inputs` map; **it carries no
  credential**, exactly as the `webhook` variant carries a `secretRef` rather than a URL.
- **`apps/api/src/watch/actions.ts`** — a case in **both** switches. Unlike most actions this one
  **is** meaningful for a windowed rule (a regression detected over a window is precisely when you
  want CI to re-run), so it must not fall into the `:237-242` "requires a run" default. The dispatcher
  goes behind `WatchActionServices` (`:72-87`) so the gate never makes a real GitHub call
  (conventions §12).
- **Credential** — reuse the shipped `github-account` service (`apps/api/src/github-account/service.ts`)
  rather than adding a store. **First verify its `repo` scope suffices for `workflow_dispatch`**; if it
  does not, the honest options are widening that service's requested scope (which re-prompts the owner
  to re-authorise — an owner decision) or a per-rule PAT following the collections
  `encryptText`/`decryptPat` pattern. Record the choice in the decision log.
- **Failure handling matches the webhook's** — one attempt, a bounded timeout, a scrubbed error, an
  audit event. **No credential, no URL and no `inputs` value may appear in a result, an error, a log
  line or the notification centre.** Extend `scrub()` coverage if the GitHub API's error bodies can
  echo request content.
- **`apps/web/src/features/watch/rule-form.ts` + `RuleEditorDialog.tsx`** — a new fixed slot for the
  action, with the credential presented as "uses your connected GitHub account" and a clear disabled
  state (tooltip + `aria-describedby`, D-TB5) when no account is connected, deep-linking to where it is
  connected.
- **Quiet by default** (conventions §11): the action ships disabled in any template, and the editor
  makes it obvious this action **spends CI minutes and can start a run**, which no other action type
  does.

## Files

Modify:

- `packages/shared/src/types.ts` — ⚠ **contended**
- `packages/shared/src/schemas.ts` — ⚠ **contended**
- `packages/shared/src/constants.ts` — ⚠ **contended**
- `apps/api/src/watch/actions.ts` (both switches + `WatchActionServices`)
- `apps/api/src/watch/repository.ts` (only if a per-rule credential is chosen — the
  `prepareActions`/`watch_secrets` path at `:239-272`)
- `apps/api/src/index.ts` (service wiring)
- `apps/web/src/features/watch/rule-form.ts` — ⚠ **contended with AM-OB4 and AM-OB10**
- `apps/web/src/features/watch/RuleEditorDialog.tsx` — ⚠ **contended with AM-OB4 and AM-OB10**
- `apps/web/src/features/watch/RuleEditorDialog.test.tsx`
- `apps/api/test/watch-rules.test.ts`

Add:

- `apps/api/src/watch/github-dispatch.ts`
- `apps/api/test/watch-github-dispatch.test.ts`

Untouched on purpose: `apps/api/src/api-tokens/**` (the wrong primitive — see the finding),
`apps/api/src/db/**`.

## Non-goals

- **No second token store.** Reuse `github-account` (or, if per-rule, the existing collections PAT
  pattern). Do not add a table, and do not reuse `api_tokens`, whose SHA-256 digest cannot be read
  back.
- No general "call any HTTP API with auth" action. The generic `webhook` stays the base primitive
  (unsigned, unauthenticated, by design); this is one typed action for one named integration.
- No retry, no backoff, no dead-letter queue — match the webhook's single-attempt semantics rather
  than inventing a second reliability model for one action type.
- No polling the dispatched workflow, no ingesting its result. Dispatch is fire-and-record.
- No new runtime dependency: GitHub's REST dispatch endpoint is a `fetch` call. Adding an Octokit-style
  client would be **owner-gated** and is not justified for one endpoint.
- No change to `WATCH_ACTION_TYPES`' existing six members.

## Dependencies

- Depends on shipped WP 4.1 (rules engine + action dispatch) and WP 4.3 (webhook channel, whose
  encrypted-secret pattern this follows) — both done.
- Depends on the shipped **`github-account`** service (device-flow OAuth, encrypted in `app_settings`).
- **RM-08 is done**, but its `api_tokens` are *inbound* credentials and are not what this reuses —
  read the finding before following the ledger note.
- ⚠ Shares `rule-form.ts` and `RuleEditorDialog.tsx` with **AM-OB4** and **AM-OB10**. **Do not batch
  any two of those three.**

## Migration

**None**, on the recommended path: the action rides in the existing `actions_json` blob, and the
credential lives in the existing `app_settings` KV that `github-account` already uses (which is
precisely why that service needed no migration). If a **per-rule** credential is chosen instead, it
reuses the existing `watch_secrets` table — still no migration. `apps/api/src/db/{database,schema}.ts`
must be a zero-line diff and no `user_version` is claimed.

## Acceptance

1. A rule can carry a `workflow_dispatch` action naming owner/repo/workflow/ref and optional inputs,
   round-tripping through `watch_rules` unchanged.
2. The action fires from **both** an on-terminal rule and a **windowed** rule — a test asserts it is
   not caught by the `actions.ts:237-242` "requires a run" default.
3. The dispatcher is injected through `WatchActionServices`; the whole test suite runs against a local
   stub and **no test makes a real GitHub call** (conventions §12) — verified by a source-walk or by
   the absence of any network permission in the test path.
4. **No credential, URL or input value appears** in an action result, an error string, a log line, an
   audit row, or the notification centre — asserted by a test that seeds a recognisable secret and
   greps every persisted and returned surface for it.
5. A missing or unauthorised GitHub account produces a readable, non-leaking failure and a recorded
   audit event — never a silent no-op.
6. The editor exposes the action with a clear disabled state and reason when no account is connected
   (tooltip text == `aria-label`, D-TB5), and makes plain that this action can start a CI run.
7. The credential/scope decision (reuse `github-account`'s `repo` scope, widen it, or per-rule PAT) is
   recorded in the RM-17 decision log with the verification behind it.
8. No `user_version` claimed; `apps/api/src/db/**` a zero-line diff; no new runtime dependency.
9. Both themes and a keyboard pass over the new action slot — or recorded as an owner-acceptance line
   rather than claimed. A live dispatch against a real repository is **owner-acceptance**, never
   claimed by an agent.
10. Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`).
