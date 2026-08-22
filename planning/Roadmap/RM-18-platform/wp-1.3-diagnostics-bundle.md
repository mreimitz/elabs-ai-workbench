---
type: "Work Package Spec"
title: "WP 1.3 - diagnostics bundle (one-click redacted export for bug reports, proven secret-free by test)"
description: "RM-18 Phase 1. Ledger: STATUS.md. One endpoint and one Settings action that produce a self-contained, redacted diagnostics document — versions, environment sans secrets, DB table counts and sizes, migration level, recent errors — whose secret-freedom is asserted by an automated test rather than trusted to review."
tags: ["roadmap", "RM-18"]
timestamp: "2026-08-22T13:05:00Z"
status: "final"
---
# WP 1.3 — diagnostics bundle

RM-18 Phase 1. Ledger: [`STATUS.md`](./STATUS.md). Plan: [`item.md`](./item.md), WP index row 1.3.

> **The item's own invariant, verbatim:** *"The diagnostics bundle is proven secret-free by an
> automated test (same discipline as PAT redaction), not by review."* That sentence is the whole
> work package. Everything else is plumbing around it.

**Depends on:** nothing. The item's WP index lists no dependency, and the two stale
"blocked on Benchmarks" flags on RM-18 were rechecked and cleared on 2026-08-21 — both were false.

**Size:** S. This is deliberately the small one in the batch; spend the saved effort on the
redaction proof, not on the payload's breadth.

---

## 1. What it is

A person hits a bug in this app. Today the only way to tell anyone what their install looks like is
to describe it by hand. This WP gives them **one action that produces one document they can paste
into a bug report without reading it line by line first** — because the code has already guaranteed
there is nothing in it they would not want to send.

That guarantee is the product. A bundle that *is* safe but cannot be *shown* to be safe fails this
WP, because the user's real decision — "can I paste this?" — is unchanged.

---

## 2. What goes in the bundle

Exactly the five groups the item names, and nothing invented beyond them:

| Group | Content | Source |
| --- | --- | --- |
| **Versions** | app version, Node version, platform/arch, `DOCKER_MODE` | `config.appVersion`, `process.version`, `process.platform`/`arch` |
| **Environment** | the **names** of every recognised environment variable and, for each, only a **classification** — set / unset / defaulted — never a value | `apps/api/src/config/env.ts` |
| **Database** | migration level (`PRAGMA user_version`) vs the latest the binary knows, file size on disk, and per-table row counts | `apps/api/src/db/` |
| **Recent errors** | the most recent N error-level entries, redacted | see §3 |
| **Feature state** | which feature flags are on/off, which provider *kinds* have a credential (a boolean per kind, never an id, never a label a user typed) | features + providers repositories |

**The environment group is the trap, so it is specified narrowly.** Do **not** enumerate
`process.env`. Iterate a **hard-coded list of the variables this app actually recognises**, taken
from `config/env.ts`, and emit `{ name, status }` where status is one of `set` / `unset` /
`default`. A value is never read into the payload — not truncated, not hashed, not fingerprinted.
This makes the secret-freedom argument *structural*: there is no code path from a variable's value
to the document, so no redaction regex has to be trusted.

Apply the same reasoning everywhere it fits. Prefer **shapes and counts over content**:
row counts, not rows; "3 servers configured", not their names or commands.

> **Names are user data too.** An MCP server's name, a skill's title and a scenario's label are all
> free text the owner typed, and any of them can carry a hostname, a client name or a path. The
> bundle carries **counts** of those things, never the strings. If you find yourself wanting a name
> to make the bundle useful, report that as a finding — do not add it.

---

## 3. Recent errors — the one genuinely risky group

Error text is the only place in this bundle where **free-form strings from anywhere in the system**
are emitted, so it is the only place a secret can plausibly reach the document. Treat it that way.

- Reuse the existing redaction discipline rather than writing a second one. `packages/shared`
  already owns `redactSecurityEvidence` and `SECURITY_REDACTION_MARKER` for exactly this class of
  problem (D-SP4 — *"evidence is redacted and capped by construction, not by convention"*). Read it
  first and reuse it if it fits; if it genuinely does not, extend it in place with a documented
  reason. **Do not create a parallel redactor** — two redactors means one of them is weaker and
  nobody knows which.
- Cap both the number of entries and the length of each, by construction.
- If the app has no persisted error log to read from, **say so in the bundle** with an explicit
  "not captured" marker and report it. An empty section that looks like "no errors" would be the
  same class of lie this project has already fixed twice — a silent gap must not read as a clean
  bill of health.

---

## 4. Shape and delivery

- **Endpoint:** `GET /api/diagnostics` returning the typed JSON payload, and
  `GET /api/diagnostics/markdown` returning the human-pasteable rendering — mirroring the existing
  reports convention (`/api/reports/**` already serves `{json,markdown}` pairs). One builder, two
  renderings; the Markdown must be **derived from the same payload**, never assembled separately,
  or the two will drift and only one of them will be the tested one.
- **Contract-first:** the payload type + zod schema go in `packages/shared` first, then the API,
  then the web. This is a hard repo rule.
- **UI:** one action in Settings, beside the existing maintenance/storage controls, using the
  `@elabs-ai/components-*` kit like everything else. The viewer must be able to **see the bundle
  before sending it** — a copy-to-clipboard or an inline preview, not a blind download. Trusting a
  redaction claim is exactly what this WP refuses to ask of the user.
- **No new dependency. No migration. No feature flag.** If you conclude one is needed, stop and
  report it rather than adding it.
- **Auth:** the endpoint is a read. Follow whatever the existing `/api/reports/**` reads do for the
  service-token scope table; do not invent a new scope, and do not add a write scope.

---

## 5. Files

| File | Change |
| --- | --- |
| `packages/shared/src/diagnostics.ts` | **New.** Payload type + `.strict()` zod schema + the recognised-env-var list if it belongs in shared. |
| `packages/shared/src/index.ts` | One export line. **Shared barrel — another agent in this batch may also append here; keep the edit to a single line so a merge is trivial.** |
| `apps/api/src/diagnostics/{service,routes}.ts` | **New.** The builder and the two routes. |
| `apps/api/src/index.ts` | One registration line. **Same shared-barrel note applies.** |
| `apps/api/test/diagnostics.test.ts` | **New.** Including the secret-freedom proof (§6). |
| `apps/web/src/features/settings/**` | The Settings action + its test. |

---

## 6. Acceptance

- [ ] `GET /api/diagnostics` returns a payload validating against the shared zod schema, and
      `GET /api/diagnostics/markdown` returns a rendering **derived from that same payload** — a
      test asserts the Markdown is produced from the JSON builder, not assembled independently.
- [ ] The environment group emits `{ name, status }` from a hard-coded recognised-variable list. A
      test asserts that **no environment variable value appears in the payload** by seeding
      `process.env` with distinctive sentinel values for every recognised name and asserting none of
      the sentinels appears anywhere in the serialized JSON **or** the Markdown.
- [ ] The same sentinel sweep covers the encryption key, provider credentials and OAuth material:
      seed recognisable secrets through the real persistence paths, build the bundle, assert none
      appears in either rendering.
- [ ] No user-typed free text (server names, skill titles, scenario labels, MCP commands, URLs
      with credentials) reaches the bundle. Test with a fixture whose names carry sentinels.
- [ ] The error group is capped in count and per-entry length by construction, and goes through the
      existing shared redactor. A test feeds an over-long, secret-bearing error and asserts both
      the cap and the redaction marker.
- [ ] If no error source exists, the bundle carries an explicit "not captured" marker and a test
      asserts it is distinguishable from "zero errors".
- [ ] Migration level is reported as **both** the database's `user_version` and the latest the
      binary knows, so a mid-upgrade install is legible.
- [ ] The Settings action lets the user **see** the bundle before sending it.
- [ ] No new dependency, no migration, no feature flag — verifiable from the diff.
- [ ] Gate green from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

**Prove the teeth, do not assert them.** The sentinel sweep is the whole point of this WP, so it
must be seen to fail. Deliberately leak one value — emit a single env var's real value into the
payload — confirm the sweep goes **red**, then revert. Do the same for the error redactor. Report
exactly what you broke and which assertion caught it. A redaction test that has never failed is
indistinguishable from one that asserts nothing.

---

## 7. Out of scope

- Any automatic upload, phone-home, or "send to support" transport. The user copies it themselves.
- Log file collection from disk, log rotation, or a new logging sink.
- Performance metrics or timing data — that is WP 1.5.
- A support-ticket integration, a GitHub issue template, or anything that leaves the machine.
- Widening the bundle with names "because they are useful" — see §2.
