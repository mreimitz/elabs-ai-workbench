---
type: "Work Package Spec"
title: "WP (parked) \u2014 real Claude account identity via our own OAuth exchange"
description: "Status: \ud83c\udd7f\ufe0f Parked (owner decision, 2026-07-28). Not scheduled. This document records the"
tags: ["roadmap", "RM-02"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP (parked) — real Claude account identity via our own OAuth exchange

**Status:** 🅿️ Parked (owner decision, 2026-07-28). Not scheduled. This document records the
investigation so nobody re-derives it, and states what building it would actually take.

**Origin:** the owner could not see *which Claude account* the "Anthropic CLI" provider credential
is signed in as, and could not change it from where they were looking (Settings → Providers). The
"change it" half shipped immediately — see *What shipped instead* below. The "see the account" half
turned out to be impossible with the credential we store, and is parked here.

---

## The finding: a `setup-token` credential carries no identity, by design

The token this app stores is the long-lived token minted by the Anthropic CLI's `setup-token` flow
(`sk-ant-oat01-…`, captured by `apps/api/src/assistant/claude-auth.ts` and persisted encrypted in
`assistant_credentials`). Anthropic scopes those tokens to **inference only**.

Verified against the live Anthropic API on 2026-07-28, using the token actually stored in the
running container:

| Probe | Result |
| --- | --- |
| `GET https://api.anthropic.com/api/oauth/profile` | `403 permission_error` — "OAuth token does not meet scope requirement any_of(user:profile, user:office)" |
| `GET https://api.anthropic.com/api/oauth/claude_cli/roles` | `403 permission_error` — "…does not meet scope requirement user:profile" |
| `POST https://api.anthropic.com/api/oauth/validate` | `403 permission_error` — "…any_of(user:profile, user:office, user:ccr_inference)" |

Three further checks close off the remaining workarounds:

1. **No offline decode.** The token is opaque — 108 chars, zero `.` separators, so there is no JWT
   payload to read. (The CLI *does* decode claims like `account_email` — but only for its own
   `CLAUDE_CODE_SESSION_ACCESS_TOKEN` remote-session tokens, which are real JWTs. Ours is not.)
2. **The CLI prints nothing.** On success the sign-in TUI renders the "Logged in as &lt;email&gt;"
   line only when the flow is *not* `setup-token`; for `setup-token` that branch is explicitly
   `null` and the token is printed instead. So the PTY buffer we already parse has no email in it.
3. **The CLI persists nothing.** `/data/assistant/claude/.claude.json` has no `oauthAccount` key
   (only `userID`, feature-flag caches, …). Injecting `CLAUDE_CODE_OAUTH_TOKEN` into the child env
   — which `buildAssistantSpawnEnv` does by design (D-AS17) — short-circuits the CLI's credential
   lookup entirely, so no account record is ever written.

Anthropic states the constraint in their own product copy, verbatim in the bundled CLI binary:

> Long-lived tokens (from `claude setup-token` or `CLAUDE_CODE_OAUTH_TOKEN`) are limited to
> inference-only for security reasons.

**Conclusion:** the signed-in account is not derivable from anything this app holds. Any UI that
claimed to show it would be fabricating it.

---

## What shipped instead (2026-07-28)

No identity guess. Instead the app is honest about the constraint and gives the owner the control
they actually needed:

- `apps/web/src/features/settings/ClaudeSubscriptionAuth.tsx` — one shared panel rendered in
  **both** Settings → Assistant and the Settings → Providers credential modal, so the two can't
  drift. It states the constraint in-place ("Which account is this? …"), reports what we *can* know
  honestly (signed in / not, token age, stored-on date, one-year-expiry warning), and carries a
  first-class **Reset token** action (confirm-gated; calls the existing `signOutAssistant`, which
  deletes the stored token and ends live sessions) plus explicit guidance that resetting and
  re-authorizing in a browser signed in to another account is how you switch accounts.
- Per-credential provider settings moved from an inline form under the list into a `FormDialog`.

---

## What building the parked WP would take

Stop using `claude setup-token` and run the OAuth exchange ourselves:

1. Generate our own PKCE verifier + `state`, build the authorize URL against
   `https://claude.com/cai/oauth/authorize` (or the console URL) with the CLI's client id, and
   request `user:profile` **alongside** `user:inference` — the scope the setup-token flow omits.
2. Exchange the pasted code at `https://platform.claude.com/v1/oauth/token` ourselves. The token
   response carries `account.email_address` / `account.uuid` and `organization.uuid` — real,
   verified identity, persisted next to the credential.
3. `GET /api/oauth/profile` then also works, yielding `account.display_name` and organization
   `billing_type` / `seat_tier` for richer surfaces.

**Why it is a workstream, not a settings fix:** the exchange returns a short-lived access token +
refresh token rather than a long-lived token, so we would own refresh scheduling, expiry, and
failure handling — and every consumer of the current credential changes with it: the assistant
session engine (`spawn-env.ts`), the CLI-first judge chain (`resolveJudgeAuth`), the
`claude_subscription` provider resolver (`providers/subscription-auth.ts`), and the model-roster
probe. It also widens the scope of a stored secret from inference-only to profile-readable, which
is an owner-gated security decision (see `.claude/rules/mcp-and-security.md`).

**Cheaper half-step, if identity is wanted before the full exchange:** Anthropic's own CLI accepts
`CLAUDE_CODE_USER_EMAIL` / `CLAUDE_CODE_ACCOUNT_UUID` / `CLAUDE_CODE_ORGANIZATION_UUID` as an
owner-supplied fallback for exactly this headless case. An optional owner-recorded account field on
the credential could be displayed *and* fed to the spawned child — honest (clearly owner-asserted,
never presented as verified) and cheap. Not built; the credential's existing **Label** covers the
"tell two accounts apart" need for now, and the provider modal now says so.
