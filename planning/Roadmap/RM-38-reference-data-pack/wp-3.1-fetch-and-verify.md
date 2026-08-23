---
type: "Work Package Spec"
title: "WP 3.1 — the startup fetcher, the verifier, and the DATA_DIR cache"
description: "Phase 3 of item.md. Ledger: STATUS.md. Boot never waits on the network and never fails on it."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-23T09:50:00Z"
status: "final"
---
# WP 3.1 — the startup fetcher, the verifier, and the `DATA_DIR` cache

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). **Depends on WP 1.2.**

## The thing to be careful about

This is the first outbound network call this application makes at boot. It is a local-first tool whose
offline hand-off bundle (RM-19) is explicitly built for someone with **no repository access and no
registry**. So the contract is narrow and absolute: **the fetch is an optimisation that can always
fail.** D-DP4 is not a nice-to-have — a container that will not start because GitHub is slow is a worse
product than one running last week's model prices.

## Scope

1. **`apps/api/src/data-pack/fetcher.ts`** — fetch the manifest from `DATA_PACK_URL`, compare
   `packVersion` against the pack in force, and if newer download the listed files. Global `fetch`,
   no new dependency. Bounded by `DATA_PACK_TIMEOUT_MS` (default 5000) **per request** and by a total
   budget; aborts cleanly via `AbortSignal`.

2. **`apps/api/src/data-pack/verify.ts`** — the five refusals of D-DP5, in this order, each returning a
   typed reason rather than throwing:
   1. `schemaVersion` outside the supported range;
   2. any file's SHA-256 disagrees with the manifest;
   3. any file fails its JSON Schema;
   4. `packVersion` lower than the pack in force (no downgrade);
   5. the security rule-id ledger is not append-only (WP 2.1's `idLedger`) or a severity changed
      without an `analyzerVersion` bump.

3. **Cache + atomic swap.** Download to `DATA_DIR/data-pack/.staging/`, verify **there**, and only then
   `rename` into `DATA_DIR/data-pack/`. An interrupted download can never become the pack in force.
   The newly verified pack is installed via `installDataPackSource` in one assignment, or not at all.

4. **When it runs.** The check is fired after the bundled/cache resolution has already installed a
   usable pack, so the API is serving before the network is touched. A successful swap takes effect
   for every subsequent request; **in-flight work keeps the pack it started with** (hold a reference,
   do not re-read a module global mid-scan).

5. **Env (`apps/api/src/config/env.ts` + `.env.example`):** `DATA_PACK_URL` (default: this repo's
   release asset), `DATA_PACK_CHECK_ON_START` (default `true`), `DATA_PACK_TIMEOUT_MS` (default `5000`).
   Setting `DATA_PACK_URL` empty disables the fetch entirely.

## Explicitly out of scope

No route, no UI, no diagnostics group — WP 3.2. No signing (the owner chose checksum + schema-version
gating; a signature is a later decision, not a silent addition here). No periodic re-check: startup and
the manual trigger only.

## Acceptance

- [ ] With `DATA_PACK_URL` unreachable / 404 / hanging / serving a corrupt pack: the app boots, serves
      the previous pack, logs one structured line naming the refusal reason, and `GET /api/health`
      stays green. Measured against a running built API, not a mock.
- [ ] Boot time with an unreachable URL is not measurably worse than with the fetch disabled — the
      request is genuinely off the critical path.
- [ ] A verified newer pack lands in `DATA_DIR/data-pack/` and is in force for the next request.
- [ ] An interrupted download leaves the in-force pack untouched and no partial tree outside `.staging/`.
- [ ] `DATA_PACK_CHECK_ON_START=false` makes zero outbound requests (asserted by a fetch seam that
      records calls).
- [ ] Gate green.

## How the refusals must be proved — read this before writing a test

**The trap this WP is built on, recorded in the ledger before the WP was dispatched.** Every refusal
below will be exercised through an injected `fetch` seam — a stub written by the same agent that
writes the assumption it encodes. **Every refusal will pass against a stub built to produce that
refusal.** The verification and the thing verified share an author, so the check cannot contradict
what it checks.

**So at least one refusal is proved against a real `node:http` listener, and the listener is built
control-and-case:**

1. The listener serves a pack that is **byte-valid and would be ACCEPTED**.
2. **Assert the acceptance first.** That is the control, and it is what makes the case mean anything.
3. Apply **one** mutation to what the listener serves, and assert the refusal.

The point is that you never author a failing response. A listener written to satisfy a refusal is the
same self-fulfilling loop one layer down, with sockets — it closes "does the client survive a real
socket" and closes nothing about whether the refusal is the right refusal. (RM-37's formulation,
adopted.) **Ports 8131–8134 are this item's**; nothing else on the machine may be assumed free.

**State in one sentence, in the test file, which half you did NOT close.** Writing "now tested
against real HTTP" without that qualifier reproduces the defect this requirement exists to prevent.

**Probe validity is FOUR checks, not three.** A probe proves nothing unless: (1) the edit applied —
`git diff --stat`; (2) the test ran — an exit code or a count, because silence is also what a command
that never started produces; (3) the mutation reached the code under test; and (4) **it was the only
mutation in flight** — two probes running together mask each other. One at a time, clean tree between.

**Check (3) has a live exposure in exactly this WP's shape.** `apps/api` tests import
`packages/shared` from its **built `dist`**. This WP puts the fetcher contract in `shared` with the
consumers in `api`. **Run the package's own `test` script (`pnpm --filter @mcp-token-footprint/api
test`), never a bare `npx tsx --test`** — the bare runner skips `build-shared-once.mjs`, so a shared
mutation sits in source while the test runs against the previous artifact and yields a confident
false negative: a working guard recorded as inert, and then "fixed".

**And a guard that asserts a string is PRESENT can be satisfied by a comment.** This item lost one
that way. Where you need a source-level assertion, prefer a **ban** (assert the string is absent) —
it fails the safe way. If a presence check is unavoidable, strip comments before matching, and probe
it in two steps: delete the code **and** add a plausible comment naming it, then confirm still red.

## Teeth — all five refusals, each mutation-probed

1. Serve a pack with `schemaVersion` = supported max + 1 → refused, reason `unsupported_schema_version`.
2. Flip one byte of one file after the manifest is written → refused, `digest_mismatch`.
3. Serve a model entry that violates its schema → refused, `schema_invalid`.
4. Serve `packVersion` below the one in force → refused, `downgrade`.
5. Serve a pack that drops a rule id from `idLedger` → refused, `rule_ledger_regression`.
6. Kill the process mid-download → restart serves the previous pack and `.staging/` is discarded.
