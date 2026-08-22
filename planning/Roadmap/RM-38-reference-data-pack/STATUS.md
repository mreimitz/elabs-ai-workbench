---
type: "Status Ledger"
title: "Reference data pack — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the reference-data-pack plan, read and updated by /next-wp reference-data-pack."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-23T02:15:00Z"
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

- [x] WP 1.1 — `data-pack/` + manifest + JSON Schemas + shared contract; RS-01 model data and the
      build script moved — **done 2026-08-22** · `worktree-agent-ab7c7d0267b9c491f` (2 commits on
      `a0179f1`) · spec: [`wp-1.1-pack-contract.md`](./wp-1.1-pack-contract.md).
      **MERGED to `main` 2026-08-23** as `4795165`, on the owner's explicit instruction after the
      orchestrator verified `main` carried none of it. The merge brought **20** commits, not the one
      that had been described to the owner. **Split measured 2026-08-23 by commit-subject tag, after RM-37
      challenged the arithmetic — the corrected figures, not the reported ones:** `RM-38` **4** ·
      `RM-37` **9** · `RM-35` **5** · `RM-18,RM-35` **1** · `RM-18` **1** = 20. The original report said
      "RM-37 (10)" and never mentioned the standalone `RM-18` commit at all; the *total* was right and
      both component claims were not. RM-37's own correction was also partly wrong (it read the split as
      12/8, which counts subjects *mentioning* RM-37 rather than tagged with it, and asserted the
      arithmetic did not sum when it did). Recorded rather than tidied: two sessions restated the same
      number four times across one hour — report, ledger copy, correction, counter-correction — each
      borrowing the confidence of the one before, **and every one of the four was wrong, corrections
      included.** A `git log` would have settled it at any point.
      **A fourth error sits inside this very entry's first draft**, and it is the sharpest of them: in
      correcting RM-37 I claimed their arithmetic objection was unsound because "the sentence before
      said WP 1.1 contributed 4". It did not — that message named the merge and stated no count at all.
      I reconstructed a term I remembered from a *different* message and argued from it. Conceded in
      full: as sent, the arithmetic really was 10 + 6 = 20, and their objection was sound.
      RM-37's own diagnosis of their error is worth more than the count: their 12 was **correct
      arithmetic on the wrong question** — `grep -c "RM-37"` over subjects counts commits that *mention*
      RM-37, and three of RM-35's ledger commits name the concurrent session in their subject lines. A
      measurement of the wrong quantity survives the "did you actually run it?" check, which makes it
      more dangerous than a recalled number, not less.
      **The line to carry forward: a number that has been argued about is not thereby a measured
      number.** Five conflicts were
      hand-resolved: `CHANGELOG.md` (both Unreleased entries kept), `package.json` (**both** needed —
      RM-18's `docs:bundle` **and** `build:data-pack`), RM-18's ledger (timestamp only, newer kept),
      and this item's own `STATUS.md` + WP 1.1 spec (add/add; `main`'s copies were strictly ahead —
      268 lines vs 110 — and the branch-only lines were the superseded unticked box and the struck
      lint claim).
      **Gate re-run on `main` after the merge, at load 3.0:** typecheck **0** · lint clean (1905 files)
      · build **0** · test **0** — shared **288** · illustrations **1032** · cli **87** · api **3857** ·
      web **394 files / 4463 + 5 skipped**. `pnpm okf:validate` PASS. `pnpm build:data-pack` on `main`
      is idempotent (clean tree after). On `main`: 26 `data-pack/` files, **39** `finding_name` values
      in both the pack catalog and the api snapshot, old research path gone.
      **One install step the merge introduces:** `data-pack/` is a new workspace package, so a checkout
      that skips `pnpm install` fails typecheck with `node_modules missing`. Hit and fixed here; worth
      knowing for anyone pulling.

      **Validated by the orchestrator, not taken on report.** The gate was re-run by me in the agent's
      worktree with load at 9.5 (not the 170–300 that makes web reds meaningless): `typecheck` **0** ·
      `lint` clean (`Checked 1862 files`) · `build` **0** · `test` **0**. Every count reconciles —
      shared **287** · illustrations **957** · cli **87** · api **3832** · web **382 files / 4319 + 5
      skipped**. api is 3814 + the 18 tests this WP adds; illustrations reads 957 rather than the
      ledger's 1032 because the base predates RM-14 2.3, which is on `main` and not on this branch.

      **The relocation is proved, not asserted.** I independently recomputed all 15 moved files'
      hashes: for every one, the base-commit blob, the recorded `gitBlobSha1` and the current file
      agree — 15 files, 0 mismatches. `data-pack/relocation-ledger.json` records them permanently and a
      test re-asserts them in-process.

      **I broke the guards myself and watched them go red.** Tampering the SHIPPED snapshot alone (pack
      source untouched — the erasure path) turned **two** independent tests red, including the
      repointed verbatim-copy assert. Tampering a MOVED pack file by one field turned **four** red:
      the verbatim-copy assert, the manifest digest check, the relocation-hash ledger, and the
      snapshot-equality check. Both restored, worktree clean.

      **The spec was wrong and the agent was right to refuse it.** WP 1.1 demanded byte-identical
      regeneration of `all-models.json`. That is **impossible by construction** — the file embeds a
      `generator` string and a `source_file` per model, all naming paths this WP moves. The agent did
      not adjust the expected output to make the claim true; it proved the stronger thing instead, and
      I verified it independently: of 112 differing lines, **110 are `source_file` and 2 are
      `generator`; zero are data.** Stripping only those keys and sorting, both sides hash identically
      (`ab5639e1…84f8` by my own computation). `model-data.generated.ts` differs by **one line**, its
      source-of-truth header.

      **A correction to this ledger's own "Known facts".** The claim that `pnpm lint` carries 2
      pre-existing errors was **stale** — I checked `biome.json` at the base commit and both
      `all-models.json` paths were already in `files.ignore` (added by `88acce2`). Lint was clean
      before and is clean after; the new 1.8 MiB `data-pack/generated/all-models.json` was added to the
      same list. The stale claim is struck below.

      **Decisions taken by the agent that I accepted, listed so they are reviewable:** `data-pack/` is
      a pnpm workspace package (`@mcp-token-footprint/data-pack`) because `zod` will not otherwise
      resolve from `data-pack/build/`; **no new external dependency** — the lockfile delta is `zod`,
      `tsx`, `typescript`, `@types/node`, all already in the tree, verified. A ~250-line draft-2020-12
      JSON Schema subset validator was written rather than adding `ajv`; it **throws on an
      unimplemented keyword** instead of ignoring it, so an unsupported construct fails loudly. A new
      `packages/shared/src/model-dataset.ts` holds `FlatModel`/`AllModels`, forced because moving
      `build.ts` out of `apps/api/src` put those types outside every app's `rootDir`; it imports
      nothing. `packages/shared/src/index.ts` gained **two** lines, not one — both alphabetically
      correct, and I eyeballed the auto-merge against `main` (which adds `manual-send.js`): all three
      survive, none lost.

      **Merge preconditions — do not merge without these.** (1) `wp/rm37/0.5` on `main` first.
      (2) After rebasing, `relocation-ledger.json`'s two entries for `compatibility/test-catalog.json`
      and `schema/test-catalog.schema.json` **will go red** — that is the designed signal that the
      rebase landed on RM-37's post-`finding_name` bytes. Update those two `gitBlobSha1` values in the
      same commit as the content change; **never** normalise a file to make the test pass.
      (3) Re-run `pnpm build:data-pack` and recommit `manifest.json`, `generated/all-models.json` and
      the api snapshot, or the digest test fails. (4) Two known textual conflicts against current
      `main`, both trivial and visible: `CHANGELOG.md` (competing Unreleased entries) and
      `package.json` (scripts).

      **Not verified:** no browser, no running app, no route — this WP has no UI. The real `Dockerfile`
      was not built, though a probe image confirmed all 25 `data-pack/` files enter the build context
      and `.dockerignore`'s anchored `/data` does not match `data-pack`.

      **Follow-up, not this WP's to fix:** stale `pnpm build:model-data` / old-path references survive
      in other items' planning docs — RM-26 (4), RM-16 (2), RM-08 (1), RS-07 (2). `CHANGELOG.md:774`
      and the RS-01 refresh report are historical records and were correctly left alone.
- [x] WP 1.2 — pack loader + `installDataPackSource()` boot seam; compatibility dataset/catalog read
      the resolved pack; snapshot copy replaces `copy-data.mjs` — **done 2026-08-23** ·
      `worktree-agent-a698f04118cfc6f9f` (3 commits on `e6cd217`) · spec:
      [`wp-1.2-loader-seam.md`](./wp-1.2-loader-seam.md).

      **The erasure hazard WP 1.1 fought to preserve is now GONE BY CONSTRUCTION, not merely guarded.**
      `apps/api/src/compatibility/data/` is deleted and `build-cli.ts` no longer writes there
      (verified by reading its source, not its report), so the "build silently overwrites the shipped
      copy from a stale source" path does not exist any more. WP 1.1's verbatim-copy assert is
      correctly replaced by an assertion that the directory is *absent*. A guard retired because the
      hazard was removed is the right kind of retirement; a guard retired because it was noisy is not.

      **Validated by the orchestrator.** Gate re-run in the agent's worktree: typecheck **0** · lint
      clean (1903 files) · build **0**. `pnpm test` first came back with **2 failed web files at load
      155**; re-run alone at the same load it is **394 files / 4463 + 5 skipped, all passing**, and
      this WP touches **zero** `apps/web` files (measured). False red, per the documented behaviour —
      recorded rather than hidden. Counts: shared **288** · illustrations **1032** · cli **87** · api
      **3886** (3857 **+29**, reconciling to 19 loader + 8 seam + 3 − 1) · web unchanged.

      **No data changed at all — stronger than the byte-identity the spec asked for.** Not one blob
      under `data-pack/{models,limits,compatibility,generated,schema}/` differs from `main`, nor does
      `model-data.generated.ts` (same sha256 both sides), nor `manifest.json`, nor
      `relocation-ledger.json`. The relocation's data is untouched by the seam that now reads it.

      **Teeth broken by me, not taken on report.** Reintroducing a module-load read in `dataset.ts`
      reddened both seam guards (`importing the compatibility readers resolves NOTHING`, `a pack
      installed AFTER the readers were imported is the pack they return`). Booting the **built** API
      with `apps/api/dist/data-pack-bundled/` removed exits **1** with
      `DataPackUnavailableError: The bundled reference data pack is missing. Looked for manifest.json
      in: …`; restored, it logs `origin:"bundled", files:18, packVersion:"1.0.0"` and listens.

      **D-DP4 ruling, which the agent explicitly asked for — AGREED, and recorded as the boundary:**
      a missing **bundled snapshot** throws and stops boot; a bad **cache** never does. D-DP4 governs
      *data* — a refresh that cannot be trusted must not take the process down. A missing shipped
      artifact is a **broken build**, and the only alternative is serving an empty model roster, which
      is a fabricated result of exactly the kind `.claude/rules/` forbids ("never fake scan results").
      Fail loudly.

      **Three places the spec was wrong about the tree, all corrected the right way:** (1) shipping the
      pack to `apps/api/dist/data-pack/` would have collided with the loader's own compiled output —
      it ships to `dist/data-pack-bundled/`; (2) `apps/api`'s `rootDir: "src"` made the pack's JSON
      Schema validator unimportable, so it moved to `packages/shared/src/json-schema.ts` (imports
      nothing) rather than being copied and held equal by a hash — **the exact trap this ledger
      records**; (3) `data-pack.ts` gained the pack's layout constants, still `zod`-only, with the
      build's copy held equal by test on WP 1.1's precedent.

      **Judgement calls left standing, with their limits stated in the test files:** "missing manifest"
      maps to `schema_violation`, the closest of the five frozen D-DP5 reasons, and says so in its
      detail string; the source scan is a tripwire that cannot see a computed path. The agent stating
      each guard's blind spot in the file is this item's own hash-ledger lesson being applied.

      **Not verified:** no browser (no UI in this WP), the real `Dockerfile` was not built (only
      `apps/api/dist` exercised directly), `nodeDataPackFs` has no dedicated unit test.

      **One `.dockerignore` comment was corrected** — it described `apps/api/src/compatibility/data`,
      which this WP deletes. Editing a comment its own change falsified is correct; the file's real
      cleanup stays WP 3.3.

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
- ~~`pnpm lint` currently reports 2 pre-existing errors, both the oversized `all-models.json`.~~
  **STRUCK 2026-08-22 — this was false.** `biome.json` already ignored both `all-models.json` paths at
  the base commit (added by `88acce2`); lint was clean. Verified by reading `biome.json` at `a0179f1`,
  not by re-running the linter. A "known fact" that nobody re-checks is how a plan goes stale.

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

**Agreed order with RM-37: `wp/rm37/0.5` lands → WP 1.1 rebases and relocates → RM-37 WP 2.9
dispatches against `data-pack/`.** RM-37 WP 2.9 (compatibility thresholds, Phase 2, not yet dispatched)
edits `scoring.bands` in the catalog; RM-37 has written the live-path question into that WP's own spec
rather than relying on memory. **`apps/api/src/compatibility/data/*` is never the authoring copy in
either regime** — `build-cli.ts` writes it verbatim from source.

**That WP 2.9 change is itself evidence for this item's premise.** Its stated reason is that the
catalog's `scoring.bands` cannot go green at all today — not one cell of the best model can read
"Within limits". A wrong threshold in shipped reference data currently needs a code edit, the gate, an
image rebuild and a re-deploy of every install. After RM-38 it is a pack update. Cite it in the DC
subject (WP 3.3) as a real instance rather than a hypothetical.

**Validation hygiene (three forms of the same trap, all hit in this checkout today):** (1) `git add -A`
sweeps a peer's uncommitted edit into your commit — stage explicit paths; (2) `git checkout` in the
shared tree moves the branch *for everyone* — use `git worktree add`; (3) a stray `cd` leaves the shell
in the shared checkout, so you **read** the wrong branch's tree and believe it. When validating a WP
branch, every path-sensitive command must name its worktree explicitly (`git -C <worktree>`), never
rely on the ambient working directory.

`packages/shared/src/index.ts` currently has **three** branches appending one export line each — the
textbook clean-auto-merge-wrong case. Merge one branch at a time and re-gate between.

**WP 2.1 will collide harder.** RM-37 adds `packages/shared/src/severity-ramp.ts`, a
`risk-vocabulary.guardrail.test.ts` and 65 lines to `security-posture.ts` — the file WP 2.1 empties of
literals. Sequence, do not race, and announce before dispatch.

## The rebase happened, and it disproved one of this ledger's own guards — 2026-08-22

WP 1.1 was rebased onto `wp/rm37/0.5`. Gate green after: typecheck **0** · lint clean (1866 files) ·
build **0** · test **0**, counts now base + RM-37's additions (shared **288** · illustrations **957** ·
cli **87** · api **3839** · web **385 files / 4357 + 5 skipped**). All 39 `finding_name` values are in
`data-pack/compatibility/test-catalog.json` and in the api snapshot; the old path is gone.

**But the reversion this ledger predicted DID occur, and the guard designed to catch it did NOT.**

Applying the relocation commit moved the **pre-edit** bytes to `data-pack/` and git raised **no
conflict on that file** — all 39 values silently gone. And `relocation-ledger.json` **passed**, because
it records *pre-move* bytes: a silent reversion **to** pre-move bytes is exactly what it asserts. It
detects mutation during a move. It cannot detect reversion, and it is green in the failure case.

Both this session and RM-37 believed a red there would signal a correct rebase. That was wrong in both
directions. **What actually caught it** was the ordinary git modify/delete conflict raised one commit
later, when the second commit deleted the old path — a signal that exists only because the WP *removed*
the source rather than leaving a copy behind.

**Rules that follow, for WP 2.1 and any later relocation:**
1. A hash ledger is a mutation detector, never a reversion detector. Do not cite it as protection
   against a bad merge.
2. ~~**Delete the old path in the same change that creates the new one.** The modify/delete conflict is
   the only reliable signal here.~~ **CORRECTED 2026-08-23 — this over-claimed, and a minimal
   reproduction disproves it.** In a clean two-branch fixture, git's rename detection carried an
   upstream edit onto the relocated path **with no conflict at all** — in a merge *and* in a rebase,
   edit intact. So the modify/delete conflict is **not** a property of deleting the old path; it did
   not fire in the simple case, and in the real 26-file relocation it fired only after the reversion
   had already happened in an earlier commit. RM-37 independently observed a third outcome: a clean,
   correct, silent deletion. **Three different outcomes from the same shape.** The rule that survives:
   *nothing about the merge mechanism is a guard.* Rename detection is heuristic — it may follow the
   edit, revert it, or drop the file cleanly, and it gives no signal distinguishing them. Verify by
   comparing content across the merge, never by whether git complained.
   **RM-37's sharpening of this, worth more than the git detail:** the two things each session
   trusted were both **absences** — this one trusted a conflict *appearing*, RM-37 trusted a conflict
   *not* appearing. An absence is never a measurement. The content comparison was the only one of the
   three instruments that was ever doing work.
3. After any rebase or merge across a relocation, assert a **content invariant the incoming change
   introduced** (here: 39 `finding_name` values present), not merely that hashes are self-consistent.
   This is now the **only** rule of the three that has survived contact — and RM-37 arrived at the same
   place by a different route, having verified their side with a byte-compare against their own blob
   rather than trusting a clean merge.
4. **A conflict between two work packages is far more often "both" than "one"** (RM-37's formulation,
   after we each hit it independently in one day): `package.json` needed RM-18's `docs:bundle` *and*
   `build:data-pack`; `packages/shared/src/index.ts` needed RM-37's `demo-seed.js` *and* this item's
   `data-pack.js`. Taking a side is the default that quietly deletes a work package's public surface.

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
