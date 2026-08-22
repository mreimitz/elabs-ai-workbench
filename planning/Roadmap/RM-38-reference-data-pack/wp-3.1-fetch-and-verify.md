---
type: "Work Package Spec"
title: "WP 3.1 — the startup fetcher, the verifier, and the DATA_DIR cache"
description: "Phase 3 of item.md. Ledger: STATUS.md. Boot never waits on the network and never fails on it."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T18:39:00Z"
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

## Teeth — all five refusals, each mutation-probed

1. Serve a pack with `schemaVersion` = supported max + 1 → refused, reason `unsupported_schema_version`.
2. Flip one byte of one file after the manifest is written → refused, `digest_mismatch`.
3. Serve a model entry that violates its schema → refused, `schema_invalid`.
4. Serve `packVersion` below the one in force → refused, `downgrade`.
5. Serve a pack that drops a rule id from `idLedger` → refused, `rule_ledger_regression`.
6. Kill the process mid-download → restart serves the previous pack and `.staging/` is discarded.
