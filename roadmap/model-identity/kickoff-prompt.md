# Continuation prompt — `model-identity`

Paste everything below the line into a fresh session started in
`/Users/czq/Documents/DEV/qlabs/qlabs-ai-benchmark/mcp-token-footprint`.

---

Continue the **`model-identity`** workstream. Read
[`roadmap/model-identity/README.md`](./README.md) (mission + locked decisions D-MI1–D-MI11) and
[`roadmap/model-identity/STATUS.md`](./STATUS.md) (**authoritative** per-WP state) before doing
anything else. Work on branch **`feat/model-identity`**; do **not** merge to `main` (the owner does
that after acceptance).

## Why this workstream exists

The owner reported three defects on 2026-07-27, against the running instance at
`http://127.0.0.1:8080`:

1. A Hub session created on an **"Anthropic CLI"** (`claude_subscription`) model ran on the **metered
   Anthropic API key** and failed with *"Your credit balance is too low."*
2. The model-selection UI is poor — for both sessions and agents.
3. Model/family names don't match the provider names in Settings.

**Root cause (confirmed, and worse than "a bug").** The web picker knows which credential a model came
from (`useHubModelRoster` stamps `kind` + `credentialId`), but `NewSessionDialog` collapsed the
selection to a bare string and the wire carried only `model`. The API then re-guessed the provider from
the model *name* via `inferHubModelKind`, whose return type `HubAiSdkModelKind` **structurally excludes
`claude_subscription`** — so the subscription branch in `hub/session-service.ts` was **dead code**.
Aggravating: all three ids the subscription actually reports (`claude-sonnet-5`, `claude-opus-4-8`,
`claude-haiku-4-5-20251001`) are **byte-identical** to Anthropic API ids, so the guess was always wrong
whenever both credential kinds exist — which is why it shipped (a subscription-only install works by
accident via an untyped `?? pool[0]` fallback).

Full root-cause narrative, the 16-site blast radius, and the rejected alternatives are in
[`README.md`](./README.md) §1–§2. **Do not re-derive them.**

## State at handoff

Branch `feat/model-identity`, tip **`5b8f675a`**. Nothing pushed, nothing merged to `main`.

**Done (5 WPs, all merged into the branch, authoritative full gate green):** 1.1 (additive
`providerCredentialId` on 9 wire types + 8 zod schemas), 1.2 (`PROVIDER_KIND_META` registry), 1.3
(model-data gap + invariant tests), 2.1 (**the correctness fix** — resolver honors an explicit
credential, migration **v55**), 2.3 (registry adoption, competing label maps deleted).

Last full gate on `5b8f675a`: typecheck ✅ · lint ✅ (1460 files) · **shared 85 / api 3245 / web 307
files 3101 pass + 5 skipped** · build ✅.

**The fix is verified against the owner's real data.** The built API was run against a *copy* of the
live 95 MB `app.sqlite` on port 8099 (their instance untouched; copy + `mcp-secret.key` deleted after).
Migration v55 applied cleanly. Same model id `claude-sonnet-5`, three outcomes:

| request | `providerCredentialId` | `capabilities.costBasis` |
| --- | --- | --- |
| unpinned (byte-identical to the failing session) | `null` | `api_exact` — legacy heuristic, deliberately preserved |
| pinned to the `claude_subscription` credential | persisted | **`subscription_reference`** |
| pinned to the `anthropic` credential | persisted | `api_exact` |

`subscription_reference` proves the subscription branch is reachable **for the first time**.

**In flight — check before dispatching anything.** Two worktree agents were dispatched from a previous
session for **WP 3.1** and **WP 3.2**; their completion notifications went to that session, not yours.
Run this first:

```bash
git log --oneline feat/model-identity -1
git branch --list 'wp/model-identity/*'
for b in $(git branch --list 'wp/model-identity/*' | tr -d ' +*'); do
  echo "== $b"; git log --oneline "$b" -1; git merge-base --is-ancestor "$b" feat/model-identity \
    && echo "   already merged" || echo "   NOT merged"
done
```

For any `wp/model-identity/3.1` or `3.2` commit that is **not** an ancestor of `feat/model-identity`:
review the diff, merge it with `git merge --no-ff`, then re-run the full gate. If a branch exists but
has no commit beyond the base, that agent did not finish — re-dispatch it.

## Remaining work

`STATUS.md` is authoritative; this is the shape:

| WP | Title | Layer | Depends |
| --- | --- | --- | --- |
| 2.2 | Fail honestly (D-MI9) — unknown / non-eligible / `authBroken` explicit id ⇒ **409**, never a silent re-pick; every heuristic fallback logs a structured warn | api | 2.1 ✅ |
| 3.1 | Thread the credential through the **existing** pickers + dedupe on `${credentialId}::${modelId}` **atomically** (D-MI8) | web | 1.1 ✅ 2.1 ✅ |
| 3.2 | **Real MCP tools in the Hub subscription adapter** (D-MI3, owner-decided) | api | 2.1 ✅ |
| 3.3 | Honest cost attribution (D-MI10) — `byProvider` per credential, rolled up by kind, reading the persisted column; heuristic for NULL rows only | api + web | 2.1 ✅ 1.2 ✅ |
| 4.1 | `HubModelPicker` + adopt at 9 call sites (D-MI7) | web | 3.1 · 2.3 ✅ |
| 4.2 | **Subscription executor in mission agents** (D-MI4, owner-decided) | api + shared + web | 2.1 ✅ 3.2 |
| 4.3 | Limit-error retry actually switches source | web | 3.1 |
| 5.1 | Delete dead pickers (`RoleEditor`, `RoleLibraryPanel`, `CrewLibraryPanel`, `CrewEditor`'s component export) — verified unreachable; move topology helpers out first | web | 4.1 |
| 5.R | Adversarial refute-review of the whole plan against README §5 acceptance | review | all |

**Parallel-safe groupings** (file sets are disjoint): {2.2, 3.3} after 3.1/3.2 land; then {4.1, 4.3};
4.2 needs 3.2 merged first; 5.1 after 4.1; 5.R last.

## Known open issues to fold in (already diagnosed — don't re-discover)

- **`apps/api/src/hub/usage.ts` `byProvider` is now genuinely inconsistent**, not just latent: for a
  *pinned* session its provider label can disagree with the credential that actually ran the turn, and
  its comment still claims they always match. Its key domain is `inferHubModelKind`'s return type,
  which cannot emit `claude_subscription` — so swapping the label map there would *look* fixed while
  still bucketing subscription spend as "Anthropic". That is WP 3.3's job: widen `providerKindFor` to
  take the **session** so it reads the persisted `provider_credential_id`. Also update the second call
  site, `apps/api/src/assistant/tools/hub-read-tools.ts` (`hub_usage_summary`).
- **`hubSessionSchema` in `packages/shared` does not list `providerCredentialId`.** It is a
  non-`.strict()` `z.object()` used only inside shared's own contract test — nothing in `apps/web`
  parses hub sessions through it, so returning the field is safe today. If a future WP starts parsing
  responses with it, the field will be **silently stripped**. Flagged, not fixed.
- **`hubBuildModel`'s new second parameter is an enabling seam** — no orchestrator call site passes it
  yet. WP 4.2 is where mission children start using it.
- **Per-message model override without a credential** falls back to the session's pin. If a user
  overrides to a *different provider's* model without sending its credential, that pin is wrong. This
  is the locked WP 1.1 contract, not an accident — but WP 4.1's picker should always send both.

## How to run the work

Use **`/next-wp model-identity`** (the canonical orchestrator skill), or dispatch worktree sub-agents
directly. Either way:

- **Bake the base SHA into every agent's first action** — worktree isolation forks from a possibly
  stale commit:
  ```
  git checkout -B wp/model-identity/<id> <CURRENT-TIP-SHA>
  git log --oneline -1   # must print <CURRENT-TIP-SHA>
  ```
  and have them run `corepack pnpm@9.15.4 install` if the worktree has no `node_modules`.
- **Agents run `typecheck` + `lint` + targeted tests only.** The full `pnpm test` can exceed an agent's
  bash timeout. **You** run the authoritative full gate at integration.
- Use `corepack pnpm@9.15.4` (a bare `pnpm` resolves to v11 and breaks install).
- Build serially if memory is tight: `corepack pnpm@9.15.4 -r --workspace-concurrency=1 build`.
- Web tests need `packages/shared` **built** first (its runtime resolves to a gitignored `dist`).

## Doctrine that governs every WP (from `.claude/rules/`)

- **Contract-first**: wire changes go in `packages/shared` (types + zod) first, then api, then web.
  **Additive only** — `model` stays required and byte-identical; `/api` stays versionless.
- **brand-ui only**: every visible element is a `@brand/*` component; no raw interactive HTML; no raw
  colors; `className` is layout-only. Verify props against `vendor/brand-ui-agent-kit/` or the `.d.ts`
  — never guess. New UI must read in **both** themes.
- **Frozen**: never touch `ASSISTANT_ENTITY_KINDS` / `SCOPE_WRITE_TOOLS` / `deriveAssistantScope`
  (write-scope security boundary, D-AO3), `STOP_REASON_CODES` / `TerminalCause`, or the
  `claude_subscription` vs `claude_cli` **identifiers** (D-MI5 changed a display label only).
- **Secrets stay server-side** — decrypted env/headers reach the spawned child config only; never
  logged, never returned to the web.
- **Historical replay**: a NULL `provider_credential_id` must keep resolving through the unchanged
  heuristic. Never backfill.
- **Honest reporting**: "green" means you ran `pnpm typecheck && pnpm test && pnpm build` and `pnpm
  lint`. Lead with what you did **not** verify — especially visual/UX claims, which must cite the real
  running app, not a mock.

## Acceptance this is measured against (README §5)

1. Picking **Anthropic CLI → Sonnet** and sending a message runs on the subscription child — **zero**
   calls to `api.anthropic.com` — and the session persists `provider_credential_id`.
2. Two credentials of the same kind both surface, distinguishably, in every picker; a colliding model
   id no longer swallows its twin.
3. Exactly **one** authoring `Record<ProviderKind, …>` label map repo-wide.
4. A subscription-pinned agent runs in a mission (D-MI4), or fails **by name** — never the generic
   *"The agent failed to produce a report."*
5. Subscription spend never buckets as "Anthropic".
6. `pnpm typecheck && pnpm test && pnpm build` green, `pnpm lint` clean.

**Not self-certifiable by an agent** — keep these in the ledger's Owner-acceptance section: a live turn
on a real signed-in Claude subscription, and the both-theme + keyboard walk of every picker surface.
The owner's Anthropic credits are exhausted, so a metered end-to-end run is not currently possible
either.
