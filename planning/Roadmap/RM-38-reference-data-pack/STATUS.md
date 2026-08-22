---
type: "Status Ledger"
title: "Reference data pack — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the reference-data-pack plan, read and updated by /next-wp reference-data-pack."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T19:25:00Z"
status: "active"
---
# Reference data pack — work-package status ledger · **PRIORITY: HIGH**

Living state for the **reference-data-pack** plan, read and updated by `/next-wp reference-data-pack`.
A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/reference-data-pack/<id>`.

> Plan + invariants in [`item.md`](./item.md). Locked decisions **D-DP1–D-DP9** below are the
> constraints the code must keep honouring — a WP may not quietly relax one.

---

## Locked decisions

- **D-DP1 — one folder, one source of truth.** `data-pack/` at the repository root is where every
  external fact and judgement table is maintained. `planning/Research/RS-01-*` keeps the *investigation*
  and a pointer; it stops being the file the build reads. Nothing else in the tree may hold a second
  copy of a pack value.
- **D-DP2 — resolution order is fetched → bundled → in-code fallback**, evaluated once at boot and
  swapped atomically. A pack is applied whole or not at all; there is no per-file merge across sources.
- **D-DP3 — the in-code fallback survives only where its absence is unsafe.** `MODEL_CONTEXT_LIMITS`
  and the priced-model table stay compiled in, because an unknown window disables a guardrail and an
  unpriced model makes `isModelPriced()` false — which REFUSES a cost-capped run (issue #10). Every
  other table may be pack-only.
- **D-DP4 — boot never waits on the network and never fails on it.** The remote check is bounded by
  `DATA_PACK_TIMEOUT_MS`; any failure (unreachable, 404, hang, corrupt, unverifiable) keeps the current
  pack, logs structured, surfaces in Settings + `/api/diagnostics`, and leaves `GET /api/health` green.
- **D-DP5 — a pack is refused, not partially trusted.** Five refusals, each proved by a mutation probe:
  unknown/unsupported `schemaVersion`; any file whose SHA-256 disagrees with the manifest; any file that
  fails its JSON Schema; a `packVersion` lower than the one in force; a security rule-id ledger that is
  not append-only against the bundled ledger.
- **D-DP6 — security rule ids stay frozen, now by validation rather than convention.**
  `security/rules.json` carries `idLedger`. A pack that drops, renames or re-points a ledger id is
  refused. This is D-SP2 restated as a load-time check, because the registry is now a fetchable file.
- **D-DP7 — a severity change requires an analyzer-version bump.** A pack whose rule severities differ
  from the bundled registry must carry a greater `analyzerVersion`; the posture diff already refuses to
  compare across analyzer versions, so the change becomes visible instead of silently re-scoring history.
- **D-DP8 — the resolved `packVersion` is stamped into every document a verdict travels in**: security
  reports, advisor reports, compatibility reports, the CI gate document, and `/api/diagnostics`. A
  verdict that cannot name the data it was computed against is not reproducible.
- **D-DP9 — regex arrives as strings and is compiled once, under a cap.** Pattern sources carry a
  length cap and are compiled at load, never per-call; a malformed pattern refuses the pack rather than
  throwing at scan time. Same exposure reasoning as `pricing-repository.ts`'s ReDoS note.

---

## Phase 1 — The folder and the seam (mechanical, no behaviour change)

- [ ] WP 1.1 — `data-pack/` + manifest + JSON Schemas + shared contract; RS-01 model data and the
      build script moved — spec: [`wp-1.1-pack-contract.md`](./wp-1.1-pack-contract.md).
      **status: in progress** · `wp/reference-data-pack/1.1` · dispatched 2026-08-22. Runs **solo**:
      it moves files three other WPs will read, so nothing may run beside it.
- [ ] WP 1.2 — pack loader + `installDataPackSource()` boot seam; compatibility dataset/catalog read
      the resolved pack; snapshot copy replaces `copy-data.mjs` — spec:
      [`wp-1.2-loader-seam.md`](./wp-1.2-loader-seam.md). **Depends on 1.1.**

## Phase 2 — Migrate the tables

- [ ] WP 2.1 — security rules + id ledger + every signature list into the pack — spec:
      [`wp-2.1-security-tables.md`](./wp-2.1-security-tables.md). **Depends on 1.2.**
- [ ] WP 2.2 — advisor + quality thresholds and the model merge chains into the pack — spec:
      [`wp-2.2-thresholds-and-model-chains.md`](./wp-2.2-thresholds-and-model-chains.md). **Depends on 1.2.**

## Phase 3 — Refresh, surface, publish

- [ ] WP 3.1 — startup fetcher + verifier + `DATA_DIR` cache with atomic swap; all five refusals
      mutation-probed — spec: [`wp-3.1-fetch-and-verify.md`](./wp-3.1-fetch-and-verify.md). **Depends on 1.2.**
- [ ] WP 3.2 — `GET`/`POST /api/data-pack`, Settings row, diagnostics group, `packVersion` stamped into
      every verdict document — spec: [`wp-3.2-surfaces.md`](./wp-3.2-surfaces.md). **Depends on 3.1.**
- [ ] WP 3.3 — publish path, docs, `.dockerignore` correction, offline verification — spec:
      [`wp-3.3-publish-and-offline.md`](./wp-3.3-publish-and-offline.md). **Depends on 3.1, 3.2.**

---

## Known facts carried into the work (verified 2026-08-22, not taken on report)

- The two-stage pipeline already exists for models only: `pnpm build:model-data` →
  `apps/api/src/compatibility/{build,build-cli}.ts` → `apps/api/src/compatibility/data/*.json` (2.0 MB
  across three files) + `packages/shared/src/model-data.generated.ts`, shipped by
  `apps/api/scripts/copy-data.mjs`, pinned by `apps/api/test/compatibility-data.test.ts` (rebuild +
  byte-compare against the research source). WP 1.1 relocates this, it does not invent it.
- `installPricingResolver(pricingRepository)` at `apps/api/src/index.ts:198-202` is the precedent for
  installing a data source at boot ahead of every consumer. The pack loader copies that seam.
- `.dockerignore` still excludes `research/`, `roadmap/` and `docs/` — two of which no longer exist —
  and does **not** mention `planning/`, so the whole 6.3 MB+ planning bundle is in the build context
  today. WP 3.3 fixes this; it is a build-context cost, not a leak.
- The compatibility test catalog is already the engine's rule source ("the engine never hand-authors
  test logic — it reads this", `catalog.ts:3`). Moving it changes its address, not its authority.
- `pnpm lint` currently reports 2 pre-existing errors, both the oversized `all-models.json`. Relocating
  that file is an opportunity to resolve them; a WP that does not resolve them must say so rather than
  let the count drift.

## Carried in from RM-37 (announcement readiness) — 2026-08-22

RM-37 has renamed the product's machine handle on its own branch, not yet on `main`:
`mcpfp` → **`aiwb`** (CLI binary, Docker image `ai-workbench`, data volume, service-token prefix
`aiwb_`, CI gate filename `aiwb.assert.json`); version **0.3.0**, licence **Apache-2.0**, product name
still "AI Workbench".

**Every WP here that mints an identifier, names a file or documents a command uses `aiwb`** — WP 3.1's
env vars are already neutral (`DATA_PACK_*`), but WP 3.3's publish script, release-asset name and DC
documentation must not be written against the old handle and renamed twice. WP 3.2's stamp lands in the
CI gate document, whose filename RM-37 is changing.

## Sequencing against RM-37 — 2026-08-22

`wp/rm37/0.5` (merged into `rm37/integration`) adds a `finding_name` field to every test in the
compatibility catalog and declares it in the schema. It touches **four files WP 1.1 relocates**:

```
planning/Research/RS-01-token-context-comparison/outputs/tests/test-catalog.json
planning/Research/RS-01-token-context-comparison/outputs/tests/test-catalog.schema.json
apps/api/src/compatibility/data/test-catalog.json
apps/api/test/compatibility-data.test.ts
```

A content edit against a file move does **not** produce a textual conflict. WP 1.1's branch would
carry the pre-`finding_name` bytes to a new path and silently revert 39 lines, with no conflict and no
red test. **Decision: RM-37 lands first; WP 1.1 rebases onto it.** Re-applying a move onto new content
is cheap; re-applying a content edit onto a moved file is not. Verified 2026-08-22 that both sides of
their branch hash identically, so their drift test is green and the field is deliberate work, not drift.

`packages/shared/src/index.ts` currently has **three** branches appending one export line each — the
textbook clean-auto-merge-wrong case. Merge one branch at a time and re-gate between.

**WP 2.1 will collide harder.** RM-37 adds `packages/shared/src/severity-ramp.ts`, a
`risk-vocabulary.guardrail.test.ts` and 65 lines to `security-posture.ts` — the file WP 2.1 empties of
literals. Sequence, do not race, and announce before dispatch.

## Test-count baselines (measured by the RM-35 session, 2026-08-22, gate green)

Check **counts**, not just the exit code — the failure mode under this machine's load is a truncated
run that exits 0 over fewer files. shared **287** · illustrations **1032** · cli **87** · api **3832** ·
web **383 files / 4337 passed + 5 skipped**. A bare `Test timed out in 5000ms` in the web suite under
load is a **false red** (a different file each run, all pass in isolation); a green under load is still
a green. Below baseline must be reconciled, never assumed to be either.

## Owner-acceptance (nothing below is verified)

- [ ] A pack published from this repo reaches a running container on restart and its new values are
      visible in the app, with no image rebuild.
- [ ] The Settings data-pack row and its error state read correctly in **both** themes and are
      keyboard-reachable.
- [ ] An offline install (RM-19 bundle, network unreachable) boots, serves the bundled snapshot, and
      says so plainly rather than reporting a successful check.
- [ ] Owner sign-off on **D-DP6/D-DP7** specifically: the security rule registry now ships as a
      fetchable file, and the append-only ledger plus analyzer-version bump are the only things
      standing between a bad pack and a changed CI verdict.
