---
type: "Status Ledger"
title: "Reference data pack — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the reference-data-pack plan, read and updated by /next-wp reference-data-pack."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-23T19:30:00Z"
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
      **AMENDED 2026-08-23 — this entry conflates a one-time check with a standing one, and only the
      first half survives.** The manual verification described here is sound and stays: comparing the
      **base-commit blob** against the recorded hash and the current file does prove the file existed
      at `from` with those bytes, so the *content* claim holds. But the **standing test** is weaker
      than the sentence it is cited for. Its `to` half is real mutation detection; its `from` half is
      `existsSync(...) === false`, which passes for a path that never existed. So the test proves the
      bytes at `to` are the bytes recorded, and separately that **a path is absent now** — it is not
      evidence that a *move* occurred rather than a creation. "The relocation is proved" was true of
      what I did by hand; it is not true of what runs in the gate.

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

      **MERGED to `main` 2026-08-23** as `c177411`, no conflicts. Gate re-run on `main` after the
      merge: typecheck **0** · lint **0** · build **0** · `okf:validate` PASS · `pnpm test` **EXIT=0**,
      shared **288** · illustrations **1032** · cli **87** · api **3886** · web **394 files / 4463 + 5
      skipped**.
      **An honest limitation on that green.** Two earlier full-suite runs — one at load 155, one at
      load 32 — reported *2 failed web files*. Web run alone passed 394/394 both times, and a third
      full run captured to name the offenders came back **EXIT=0, 394/394**, so the failure did not
      reproduce and **I never captured which two files they were**. The load-32 recurrence means
      "false red under load" is a weaker explanation than the ledger's earlier note assumes. What is
      solid: this WP touches **zero** `apps/web` files (measured), and web passes in isolation. What
      is not: whether something in the full parallel run is genuinely flaky here. Left as a known
      unknown rather than filed as a flake.

      **One `.dockerignore` comment was corrected** — it described `apps/api/src/compatibility/data`,
      which this WP deletes. Editing a comment its own change falsified is correct; the file's real
      cleanup stays WP 3.3.

## Phase 2 — Migrate the tables

- [x] WP 2.1 — security rules + id ledger + every signature list into the pack — **done 2026-08-23** ·
      `worktree-agent-af9934533d9b19707` · **merged to `main`** in `4534720`.
      **Byte-identity is a PINNED hash, not a regenerated comparison** — the agent wrote the guard
      first, on unmodified `main`, and committed it before touching a literal. Four SHA-256s
      (`serverReport 686f3d33…` · `skillReport ee7bd5ab…` · `serverDiff d7a624ff…` ·
      `skillDiff 2a1267a5…`) unchanged after the move, with coverage tests proving the fixtures fire
      all 18 rules.
      **No id changed spelling, proved four ways rather than inferred** from the hashes: the 18 ids
      diffed against `main`'s source, `id|severity|subject|category` diffed for all 18, and every
      `title` and `rationale` (36 fields) asserted byte-for-byte in the pre-move source.
      `skill-surface.injection-phrasing` is untouched, so RM-37 WP 1.5's confirm gate is unaffected.
      `SECURITY_RULES` still imports from its current path — checked at **runtime**, 18 rules, and
      `SecurityRuleId` is still a literal union, so `SecurityPanel.tsx:356` is unchanged.
      **Tooth 4 is the entry worth reading, and it is a self-caught false pass.** The agent's first
      regex-cap probe went green for a reason it had not designed: there are **two** independent caps,
      and the pack's own JSON Schema `maxLength` caught the payload after the TypeScript one was
      removed. It removed the third layer, resealed the manifest and got the intended red. It would
      otherwise have reported a bitten tooth that was not bitten — the exact failure this ledger has
      been cataloguing, caught by the agent on itself.
      **The comment-laundering probe was run in BOTH directions** (literal as code → red; literal as
      code plus a "moved to the pack" comment → still red; comment only → green), against the real
      900-line file rather than a synthetic string.
      **A measured blind spot in its own byte-identity guard, written into the test file:** deleting a
      *redundant* verb inflection leaves all six hashes green, because the fixture's tool is named
      `delete_everything` and the rule reads the name first. The hashes see a changed **outcome**,
      never a changed **table** — right for a relocation guard, wrong for reviewing a pack edit.
      **The self-scan score changed and the change is explained, not absorbed.** RM-20 recorded
      "49 / high risk on 51 `info` findings"; it is now **100 / clean, 0 findings**. Two causes, both
      verified: analyzer v3 capped `info` deductions, and the mount's tools have since gained
      parameter descriptions and `additionalProperties: false`, so the 51 findings no longer exist.
      **Orchestrator's own live run confirms the budget half:** `24 tools · 3183 definition tokens ·
      budget 3500 → within budget`, EXIT=0.
      **The SCORE half was initially reported to the owner on the agent's word alone — corrected.**
      RM-37 pointed out that a measurement by one session is evidence it *tried*, not evidence anyone
      else verified, and they were right: **no test in the suite asserts the real mount's score** (the
      security tests use synthetic `scan_clean` / `scan_poisoned` fixtures), so the green gate covered
      it not at all. Measured directly since, through `runWorkbenchSelfScan` + `analyzeScanTools` +
      `computeSecurityScore`: **24 tools · 0 findings · `{"value":100,"band":"clean",
      "analyzerVersion":4}`**. It now holds on this session's own measurement.
      **Deliberately NOT propagated.** RM-20's "49 / high risk on 51 info findings" is quoted at
      `RM-20/STATUS.md:325`, `RM-20/STATUS.md:687` and `CLAUDE.md:111`. `:687` is an **open
      owner-acceptance box**, and closing it is the owner's call, not an orchestrator's — RM-37 reached
      the same conclusion independently and left all three alone. Correcting a peer item's authoritative
      ledger on the strength of a number that arrived through two ledgers would *look* like diligence
      and be the opposite. **Surfaced to the owner as a decision instead.**
      **Spec corrections:** the oversized-description ceiling lives in `security-posture.ts`, not
      `analyzer.ts`; and the spec's signature inventory predated RM-37 WP 0.5, which added
      `READ_VERBS_IN_NAME` / `WEAK_MUTATING_VERBS_IN_NAME` / `WEAK_VERB_MAX_LEADING_OFFSET` — moved
      too, since the acceptance says *no* literal may remain.
      **Not verified:** no browser; no pack has been fetched over a network (every D-DP6/D-DP7 refusal
      was exercised through the **cache** rung, which is the same `resolveDataPack` path); no Docker
      image built, though the real compiled API was booted (`packVersion 1.1.0, files 22`, health 200).

- [x] WP 2.2 — advisor + quality thresholds and the model merge chains into the pack — **done
      2026-08-23** · `worktree-agent-a25edd1f907247b54` · **merged to `main`** in `52038b8`.
      **Byte-identity PASS, measured on a genuinely pristine tree** — advisor reports over three
      scopes, two skill-quality reports and two heatmaps as one JSON blob, sha256
      `760fd893d66af1072e70035e42c0489eab3b98ab43077cf6bb853c4f3b796dc0` before and after. The
      baseline was captured under `git stash push -u` with the probe restored from outside the repo,
      not on a partially-reverted tree.
      **It found a real hole in a guard it had just copied from `1687eb8`, by probing rather than
      reasoning:** reverting `quality-validated-trim.ts` to hardcoded `0.5`/`0.2` while leaving the
      comment naming `high_waste_share` left the file **green**. Fixed, and **re-probed by the
      orchestrator independently** — mutation confirmed applied (`2 insertions, 2 deletions`), the
      laundering comment confirmed present at `:74`, and `not ok 1138 - the waste bands are ONE pack
      entry that both trim rules read` observed. A first attempt at that probe targeted a symbol that
      does not exist in the file and was discarded as **no result**, per the standing rule.
      **The env → pack → compiled chain is proved behaviourally, not by source assertion.** The
      agent's first cut asserted the `??` was *spelled* a certain way; it replaced that with three
      spawned child processes, because `config` is frozen at module load and a source assertion
      measures a proxy.
      **The design decision to review, and it is sound:** `packages/shared` cannot read the filesystem
      and `apps/web` consumes `MODEL_CONTEXT_LIMITS` / `DEFAULT_COMPARE_THRESHOLD` /
      `FAILURE_BUCKET_SCORE_THRESHOLD`, so D-DP3's compiled floor must exist as code. Rather than
      hand-maintain it — the second copy D-DP1 forbids — `pnpm build:data-pack` **renders** it into
      `packages/shared/src/pack-defaults.generated.ts` from the same authored files. One authored
      copy, one derived.
      **A REAL GAP this creates, carried to WP 3.2 rather than closed here:** `apps/web` reads the
      **compiled floor**, not the runtime pack. Once WP 3.1 can fetch a pack, the API's answers will
      change while the browser's model list and compare-view default stay on what shipped in the
      image. Structural — `packages/shared` may not touch the filesystem — so it is a surface
      problem, and WP 3.2 must solve it or say plainly that the browser lags the API.
      **Judgement calls left standing:** the three new pack files carry no `as_of` (they are
      judgements, not dated external facts, and inventing a date would be worse than omitting one;
      `additionalProperties: false` stops one being smuggled in later).
      **Spec correction:** `MODEL_ID_ALIASES` / `DEFAULT_HEATMAP_MODELS` are at `dataset.ts:40`/`:102`.
      **Not verified:** no browser, no Docker image; the built API was booted against the shipped
      snapshot (`origin:"bundled", files:24`, health 200).

### The merge of the two, and what it cost

Merged in order 2.2 → 2.1. **The generated-file rule this ledger wrote at `1f13cae` was needed within
the hour:** `data-pack/manifest.json` conflicted, was resolved by taking one side wholesale and
re-running `pnpm build:data-pack`, never hand-merged. `packVersion` was 1.0.0 on one side and 1.1.0 on
the other — resolved to the **single higher version**, as WP 2.1 predicted.

Three further conflicts (`loader.ts`, `build-cli.ts`, `README.md`) were **all** "both, not one" — each
side adding its own outputs — and were resolved by keeping both sides of every hunk. Two things that
needed a human eye afterwards, neither of which git would have flagged: a **duplicated numbered step**
in a comment block (both sides rewrote the same list item), and a **doubled `console.log` argument**
that made the build print its output paths twice. The writes themselves were correct and distinct —
checked, not assumed. **Concatenating both sides is right for declarations and wrong for prose**; that
distinction is the residue worth keeping.

**Gate re-run on `main` after both merges:** typecheck **0** · lint **0** · build **0** · test
**EXIT=0** · `okf:validate` PASS. shared **288** · illustrations **1032** · cli **87** · api **3936**
(3886 + 20 + 30, reconciling exactly) · web **394 files / 4463 + 5 skipped**.

**A validation-method note.** One `pnpm test` invocation on WP 2.2's branch exited **1** with every
suite reporting zero failures; a captured re-run exited **0** with identical counts. The cause was
this session's habit of running the suite twice — once piped for counts, once redirected for an exit
code — which both wastes a full run and produces two results that can disagree. **One run, captured to
a file, both signals read from it.**


## Phase 3 — Refresh, surface, publish

- [x] WP 3.1 — startup fetcher + verifier + `DATA_DIR` cache with atomic swap; all five refusals
      mutation-probed — **done 2026-08-23** · `wp/reference-data-pack/3.1` (3 commits: `7f3c352`
      `a0d8847` `8ef244d`) · spec: [`wp-3.1-fetch-and-verify.md`](./wp-3.1-fetch-and-verify.md).

      **Gate re-run by the orchestrator in the agent's worktree, one captured run, both signals read
      from it: EXIT=0.** shared **288** · illustrations **1032** · cli **87** · api **3965** · web
      **394 files / 4463 + 5 skipped**, `# fail 0` per package, lint 1927 files. api 3964 → 3965 is
      the one guard added on refinement. **Corpus checked, not just the exit code** (the same day's
      correction): web's file and skipped counts are byte-identical to the baseline, and every
      `node --test` package reports `# tests` equal to `# pass`.

      **THE GAP THE ORCHESTRATOR FOUND, AND IT WAS IN THE LOAD-BEARING CLAIM.** `index.ts` said in
      prose that the refresh call's *position* — after `listen()`, not awaited — "is the entire D-DP4
      guarantee and it is structural rather than promised". **Nothing enforced it.** Inserting an
      `await refreshDataPack({...})` above `await server.listen(...)`, which destroys the guarantee
      outright, left the api suite at **`# pass 3964 # fail 0`, EXIT=0**. The agent's proof was a
      one-time live measurement — precisely the manual-check-versus-standing-test distinction this
      ledger drew hours earlier, arriving inside the work being validated.
      **Closed as guard 5** in `data-pack-seam.test.ts`, beside guard 4 and reusing its
      `stripComments` helper: `refreshDataPack(` must appear **exactly once**, after `listen`, with a
      preceding `void` and not `await`. **Re-probed by the orchestrator after the fix, not taken on
      report** — the identical mutation is now **RED**, `# fail 1`, naming that guard.
      **And the laundering direction, which is the one this item actually lost a guard to:** deleting
      the real call while leaving two comment lines that name `refreshDataPack({ ... })` and
      `await refreshDataPack(...)` is **RED** (`0 !== 1`). The comment-stripping is load-bearing, not
      decorative. The agent added that fourth probe itself, unprompted, on the grounds that the
      no-false-red direction alone is the weak half — correct, and it is why the guard is not one this
      item will have to downgrade later.

      **Two more orchestrator probes, one at a time, clean tree between, all through
      `pnpm --filter @mcp-token-footprint/api test`:**
      - Neutering the single `status: "installed"` site → **15 red, EXIT=1**, including all five
        refusals, the CONTROL, the negative control and BOUND 1. **So no refusal test is satisfiable
        by a fetcher that never installs** — species 8 answered, and answered by someone who did not
        write the answer.
      - Forcing `isSafePackRelativePath` true → **3 red**, first among them *"a ROOT-HOSTED manifest
        cannot escape DATA_DIR — the case where the path guard is the ONLY defence"*.
      *(A first attempt at the install probe targeted a string with the wrong indentation; its
      `count == 1` assert failed loudly and it was discarded as no result, not read as green.)*

      **The control-and-case design held.** Every refusal runs through one `controlThenCase` helper
      that asserts the unmutated pack is **installed** first, from the same listener and code path,
      then applies exactly one mutation and asserts the reason **by name**. All five go through a real
      `node:http` listener, plus a negative control proving an *appended* rule-id ledger is still
      accepted. An early orchestrator grep for `CONTROL FAILED` found one occurrence and appeared to
      contradict the agent's claim; reading the helper settled it — **the report was accurate and the
      instrument was naive**, the second time that hour.

      **Both bound tests are stronger than the brief asked for.** BOUND 1 (a server that accepts and
      never answers) and BOUND 2 (every response inside the per-request limit, the *sum* unreasonable)
      each assert **elapsed wall clock**, each set the other bound out of range so exactly one
      explanation survives, and BOUND 2 carries a **non-vacuity assertion on its own fixture**
      (`wouldTake > budget * 2`). The agent reported **T3 (retry/pacing) as N/A with evidence** — no
      retry loop or pacing delay exists to mutate — rather than inventing a probe.

      **Two deviations, both verified sound.** (1) Staging is `DATA_DIR/data-pack.staging/`, a
      sibling, because `rename(2)` cannot move a directory into its own descendant — the spec's swap
      is not expressible; the property is unchanged. (2) The spec's teeth name
      `schema_invalid`/`downgrade`/`rule_ledger_regression`; the code keeps the **frozen**
      `DATA_PACK_REFUSAL_REASONS` tuple, which the orchestrator confirmed pre-exists at the base
      commit and is consumed by WP 1.2/2.1. Keeping the contract over the prose was right.

      **`packages/shared/src/data-pack.ts` is purely additive** — diffed with additions filtered out,
      **zero** removed or modified lines, twelve new exports. `verify.ts` is now one definition both
      rungs call, so a fetched and a cached pack cannot be judged by two subtly different rules.
      `DataPackFs` gained a separate `DataPackWriteFs`, so a module holding the read seam provably
      cannot write under `DATA_DIR`. D-DP6 anchors the rule-id ledger on the **bundled** registry, not
      whatever is in force — otherwise a chain of packs could walk the ledger anywhere one append at a
      time. No migration, no new dependency, no route, no UI.

      **Not verified, and the limits are the agent's own words, not extracted from it.** No Docker
      image was built (assigned to WP 3.3). No browser — this WP has no UI. **Per-request pack
      isolation is NOT enforced**: a consumer calling `getDataPack()` twice inside one operation,
      straddling the swap, gets two packs; the exposure is the seconds after boot, since there is no
      manual trigger and no periodic re-check yet. And the real-HTTP proof's stated open half:
      *it proves the client refuses a pack one mutation away from an accepted one — not that the
      mutation is the kind of change that ought to be refused, because the schemas, the id ledger and
      the digest algorithm are all authored in this repository and travel with the fixture.*
      **No pack from the real publish path has ever been served** — the accepted base is this repo's
      own `data-pack/` with its version bumped.
- [x] WP 3.2 — `GET`/`POST /api/data-pack`, Settings row, diagnostics group, `packVersion` stamped into
      every verdict document, **and the browser reading the live pack** — **done 2026-08-23** ·
      `wp/reference-data-pack/3.2` (2 commits: `212b4f3` `0b4ec61`) · spec:
      [`wp-3.2-surfaces.md`](./wp-3.2-surfaces.md).

      **Gate re-run by the orchestrator in the agent's worktree, one captured run: EXIT=0.** shared
      **288** · illustrations **1032** · cli **87** · api **3982** · web **396 files / 4478 + 5
      skipped**, `# fail 0` per package, lint 1937. Corpus **grew** (shrinkage is the tell, not
      growth). 39 files, 10 new.

      **THE DEFECT THE ORCHESTRATOR SENT BACK, and it was this WP inverting WP 3.1's own argument.**
      `main.tsx` raced `hydratePackValues()` against a 2 s budget and mounted on whichever won, so a
      server that accepts connections but answers slowly gave a **blank shell for up to two seconds on
      every cold load** — in the item whose D-DP4 exists to forbid waiting on a dependency that is
      allowed to be slow. The trade bought one slider's default on one route and cost the whole first
      render, and the slow-API case is real here (a scan or suite run can tie up the event loop, which
      is exactly when someone reloads).
      **The agent fixed it and MEASURED it with a control rather than asserting it** — it rebuilt the
      web bundle from the previously-validated commit to get the "before" number, against the same
      route with `/api/data-pack` stalled 10 s: **+2118 ms** before, **−8 ms** after. So the defect was
      real, the instrument could see it, and the fix removes it. `main.tsx` now *fires* hydration
      without awaiting; `CompareView` renders on the floor and adopts the pack's default once
      hydration settles **only while its own seed is untouched** (`seededWith` equality, so a moved
      slider is never yanked). **Re-probed by the orchestrator:** reintroducing the blocking shape
      reddens exactly one test — *"the app entry FIRES hydration and does not await it"*.
      **Stated residual, not smoothed over:** a cold load straight onto `/compare/scans` with the
      endpoint delayed fires compare twice, at `0.6` then `0.4`. It converges; it never blocks.

      **The D-DP8 stamp has ONE definition and the guard around it is the strongest in this item.**
      `stampDataPackVersion` in `packages/shared/src/data-pack.ts`, with `apps/api/src/data-pack/stamp.ts`
      its only production caller; every builder gains one call. **Three non-vacuity guards**, which is
      what this ledger asked for after RM-37 pointed out that a ban is itself an absence assertion:
      (1) the source walk asserts a **corpus floor**; (2) **every stamped builder must be inside the
      walked set** — the precise answer to "a seventh builder under a path the glob misses"; (3) the
      assembly regex is asserted **discriminating** (matches an assembly, does *not* match a zod
      declaration). Plus each builder read by **absolute path**, so a move throws rather than shrinking
      the set. **Orchestrator probe:** hand-assembling `dataPackVersion: "9.9.9"` in `fleet-report.ts`
      reddens **2** — the ban and the per-builder call-site check.
      **The agent disclosed a hole in its own guard rather than hiding it:** under comment-laundering
      the file-level check stays green (the skill path still calls the helper), and the behavioural
      test is what catches it. That is the right disclosure and the right division of labour.
      **Documents stamped:** SecurityReport (scan + skill), SecurityPostureDiff (inherited from the
      subject, never re-invented), AdvisorReport, FleetReport, CompatibilityHeatmap,
      CompatibilityTestReport, AssertionReport, ServerReport, RunReport. **Not stamped:** the scan
      report — its numbers are token counts, and it inherits through the embedded security section.

      **`pnpm format` IS NOT SAFE IN THIS REPO, and this WP is how it was found.** The agent ran it and
      it rewrote **732** files. Measured by the orchestrator on clean `main`: `biome format .` reports
      **735** divergences while `pnpm lint` is clean, because `lint` is
      `biome check --formatter-enabled=false` — **the formatter has never been applied to this tree.**
      The agent restored everything and hand-reverted 20 formatter-only hunks; the orchestrator
      verified the result rather than trusting it and found **two reflows had survived**, in
      `packages/shared/src/{data-pack,security-posture}.ts`, and had them stripped — both files now
      carry **zero** deleted lines. RM-37 independently reported the same accident from a WP 2.6 agent
      that reformatted **556 files belonging to other agents**. **Two agents reaching for a documented
      command is a trap in the documentation, not two mistakes**, and it is now warned in `CLAUDE.md`
      §4 and `.claude/rules/quality-gates.md` (RM-37, `0ac9a77`).

      **Cleared after checking rather than by absence of evidence:** `DIAGNOSTICS_BUNDLE_VERSION`
      1 → 2 was the agent's own call, so every consumer was enumerated — the API emits it, Markdown
      prints it, one api test asserts it **equals the constant** (so it moves with the constant and can
      never fail — species 1, in a file neither session was auditing, left alone rather than widening
      scope), and a web fixture hardcodes `1` without asserting on the real value. **Nothing branches
      on it.** The bump is harmless.

      **Not verified.** No Docker image (WP 3.3 owns that). The compare threshold only *visibly*
      changes the Select label when the pack's value is one of the four fixed options — a value like
      `0.31` leaves the trigger blank while the request still carries the right number; flagged by the
      agent rather than fixed, since that control is outside this WP. The agent's compare walk could
      not select two different servers (selector timeout), so the threshold was proved via the
      outgoing request rather than the rendered label. The two-theme + keyboard walk is the agent's
      own measurement (13 tab stops, `:focus-visible` true, ring visible in both themes); **no human
      has looked at this screen.**
- [x] WP 3.3 — publish path, docs, `.dockerignore` correction, offline verification — **done
      2026-08-23** · `wp/reference-data-pack/3.3` (3 commits: `8b79c0f` `c95d3cc` `4753857`) · spec:
      [`wp-3.3-publish-and-offline.md`](./wp-3.3-publish-and-offline.md).

      **Gate re-run by the orchestrator: EXIT=0.** shared **288** · illustrations **1032** · cli
      **87** · api **3984** · web **396 files / 4478 + 5 skipped**, lint 1939. Corpus unchanged by the
      port rewrite — no test was lost to it.

      **THE FINDING THAT JUSTIFIES THE WP: the published pack could never have been fetched.** WP
      3.1's default `DATA_PACK_URL` named a GitHub **release asset**
      (`…/releases/latest/download/manifest.json`). The fetcher resolves every pack file **relative to
      the manifest**, and the manifest lists **28 nested paths**; a release serves a **flat** set of
      assets whose name is one path segment. So the app would have fetched the manifest and then
      404'd on all 28 files behind it — **permanently, and looking exactly like "nothing has been
      published yet"**. Measured by the agent against a repository that actually has releases, and
      **re-measured independently by the orchestrator**: flat asset `200`, nested asset `404`;
      corrected `raw.githubusercontent.com` URL `200` on the manifest **and** `200` on nested
      `models/saas/openai.json`. **Publishing is therefore a commit, and the version bump is the
      go-live switch** — an unbumped pack edit is answered `up_to_date` and never downloaded.

      **THE ITEM'S OLDEST GAP IS CLOSED, AND THE ORCHESTRATOR CLOSED IT PERSONALLY.** The audit
      section recorded that the real Docker image had never been built for this item. It has now been
      built **and booted**, and the orchestrator ran the offline case itself rather than reading the
      agent's account: `docker run --network none` → `origin:"bundled"`, `packVersion 1.1.0`, **28
      files** from `/app/apps/api/dist/data-pack-bundled` → `Server listening` → `status:"unreachable"
      … durationMs:14`. **The log timestamps put the listen BEFORE the check** (61466 → 61550 →
      61567), which is D-DP4 proved in the real image rather than in `dist`. Health **200** in 3 s.
      `/api/data-pack` answers `source: "bundled"` with the failed check written out and
      `lastRefusal: null`; the diagnostics section explains why the URL is deliberately absent. **It
      never reports a check it did not make.**

      **The agent's own before/after control on the fetch path** (same image `sha256:00a052f0…`, same
      volume, only the process restarted): `1.1.0`/bundled/`disabled` → `1.2.0`/**fetched**/`installed`;
      heatmap picker 55 → 56 models with the canary present; the same poisoned skill scoring
      `100/clean` → `85/medium` on a rule the new pack carries; the D-DP8 stamp moving `1.1.0` → `1.2.0`.

      **The spec was wrong about `.dockerignore` and the agent proved it rather than complying.** It
      said to exclude `planning/`; that **breaks the image build**, because `pnpm build` runs
      `docs:bundle`, which reads `planning/user-guide/` to generate the in-app manual. Probe image
      with a blanket exclusion: `planning_files=0`, `Error: build-docs-bundle: user guide directory
      not found`, EXIT=1. Shipped rule is `planning/**` + `!planning/user-guide/**`, so a future
      subtree is excluded by default rather than silently re-inflating the context. Context
      **64,848 KB / 2,906 files → 47,524 KB / 2,113 files**; the two entries it removed (`research/`,
      `roadmap/`) had been **matching nothing for months** while the tree that replaced them shipped
      whole.

      **The docs — `DC-26-reference-data-pack`**, created with the generator: `doc.md` (what shipped
      vs what was planned, including both spec corrections) and the guide page, which carries the
      owner ruling as a design property under *"Who is trusted, and with what"* with the reopening
      condition named. Docs bundle 22 subjects/27 docs → **23/28**.

      **A DEFECT THIS SESSION INTRODUCED, FOUND BY COLLIDING WITH A PEER — see the fixed-port entry
      below.** The suite bound ports 8131–8134 because the WP 3.1 brief allocated them. Fixed here:
      every listener now binds `{ port: 0 }` and reads the port back, with a non-vacuity assertion
      that the kernel returned `> 0`. **Proved by the orchestrator running the collision itself** —
      two api suites started together, both `# pass 3984 # fail 0`, **zero EADDRINUSE**; the agent's
      stashed-fix control gives `# fail 13` and 26 EADDRINUSE lines. Two corrections to the
      orchestrator's own instruction, both right: `DEAD_PORT` was never a dead port (a live 404
      listener, renamed `notFoundPort`), and `127.0.0.1:1` **must** stay hardcoded because that test
      needs a *refused* connection.

      **Not verified.** `run.sh` from the hand-off bundle was **not executed** — it replaces a
      container and volume named `mcp-token-footprint`, which is the owner's own running container
      from another checkout; the agent stopped rather than kill it, having checked the bundle
      assembles, all four checksums verify, and the image inside is byte-identical to the one proved
      offline. **No browser**: the Settings → Reference data row has no two-theme or keyboard walk.
      **`--publish` never ran against a remote**; nothing was pushed. `run.ps1` remains unrun on
      Windows (RM-19's standing gap, untouched).

      **Two follow-ups for the owner, neither this WP's to fix.** (1) The default URL depends on the
      repository staying **public** — measured today `"visibility": "public"`; if it goes private,
      unauthenticated fetches 404 and every install answers `unreachable`, which is a *logged
      non-event* and therefore easy to miss. (2) `scripts/release.sh` states "this repo is PRIVATE" in
      its header and in the release notes it generates. Measured false.

---

## Two owner decisions, put and answered — 2026-08-23

Both were held open deliberately rather than assumed, and both came back the *less* convenient way.

**1. The mount's security score — CORRECT ALL SITES AND CLOSE THE BOX.** The previous entry left
RM-20's "49 / high risk on 51 `info` findings" alone on the reasoning that an open owner-acceptance
box is the owner's to close. Put to the owner; ruling was to correct it and tick it. Done on `main`
in `ff7cf8b`.

**And measuring it properly made it a bigger finding than a stale number.** Measured here, in the
action that reports it: **24 tools · 0 findings · `{"value":100,"band":"clean","analyzerVersion":4}`**,
pack 1.1.0, 3183/3500 definition tokens. Three things came out of it that were not known before:

- **The 0 is a clean subject, not a deleted rule set.** 18 rules live (7 `error` · 6 `warning` ·
  5 `info`); degrading one real tool from the live scan — parameter descriptions and
  `additionalProperties` stripped — yields exactly 2 `info` findings and 98/`low`. This is audit
  question (c) paying for itself twice: the first pass found a number with no test behind it, and the
  second found that "0 findings" needed its own control before it could be reported as good news.
- **The recorded pair was transposed**: score **51** on **49** findings, not score 49 on 51.
- **The tie cannot be broken by arithmetic, which is why it survived.** Under uncapped v2 *both*
  readings are internally consistent (49→51 and 51→49) and both band `high`, so a reader who checked
  the maths would have **confirmed the wrong pair**. The RM-37 session found this and it is the
  sharpest thing in the exchange. It is settled documentarily instead, by two independent comments in
  `packages/shared/src/security-posture.ts` (`:73-77`, `:479-482`) that agree on 49→51; both read
  here directly rather than relayed.

**A sixth species for this item's taxonomy: a self-consistent transposition — verifying the
arithmetic confirms the error.** No check that stays inside the numbers can catch it; only an
external record can. Related to, but worse than, RM-37's WP 2.9 case (a number right about the wrong
quantity), which *can* be caught by asking what the number measures.

**Two sites the ruling did not name carried the same claim** and were corrected under it, flagged as
such: RM-18's consolidated checklist (block A9 box 4 — closed; 191 open since assembly, totals left
at their assembly figures) and RM-35's WP 0.5 record (a description of an edit that happened, so the
correction was appended rather than the history rewritten).

**The honest limit, written into the box itself:** no test asserts the real mount's score — the
security suite uses synthetic `scan_clean`/`scan_poisoned` fixtures — so the closed box rests on one
session's measurement and the green gate covers it not at all.

**2. The browser lagging the API — FIX IT IN WP 3.2, not "state it plainly".** WP 2.2's carried gap
is now scope item 6 of [`wp-3.2-surfaces.md`](./wp-3.2-surfaces.md), with the consumer surface
**measured at `ff7cf8b` rather than assumed** — and the measurement found **six** sites where the
ledger's statement of the gap named two kinds. The one nobody had listed is
`features/security/SecurityPanel.tsx`: `SECURITY_RULES` is `BUNDLED_SECURITY_RULES`, the compiled
table, so a pack that adds or retitles a rule leaves the panel's "N rules" wrong and the API's verdict
sitting beside the image's title. The one that matters most is `RunConsole.tsx:656`
(`MODEL_CONTEXT_LIMITS[model] ?? 0`), where an empty store does not error — it renders a confident,
meaningless "0% of context used".

Three design constraints are written into the spec because they are where this goes wrong: the
compiled floor is the initial value **and** the fallback so the store is never empty;
`CompareView`'s threshold is an **initial** value and must not become reactive (it would yank a
slider the operator moved); and the guard is a **ban**, not a presence check — this item already lost
one guard to a comment, and a ban fails the safe way.

## WP 3.1's real-HTTP proof — the design, hardened before dispatch — 2026-08-23

The ledger already records that WP 3.1's five D-DP5 refusals must not be proved only through an
injected `fetch` seam. RM-37 sharpened it and the sharpening changes the design, not the wording:
**a local listener written to satisfy a refusal is the same self-fulfilling loop one layer down, with
sockets.** It closes "does the client survive a real socket" and closes nothing about whether the
refusal is the right refusal.

**So the brief requires control-and-case from one server:** the `node:http` listener serves a pack
that is byte-valid and **would be ACCEPTED**, that acceptance is asserted first, and then a **single
mutation** is applied to what the listener serves. The agent never authors a failing response, so it
cannot author the refusal it is testing. The accept path is the control; the refusal is the case.

**And the probe-validity rule is now FOUR checks, not three** (RM-37, after a WP 2.3 agent had two
probes in flight masking each other): the edit applied · the test ran · the mutation reached the code
under test · **it was the only mutation in flight.** One probe at a time, clean tree between,
`git diff --stat` each time.

~~**Ports: 8131–8134 are RM-38's.**~~ **REVERSED** — see the fixed-port entry below; the suite binds ephemeral ports and the reservation is gone. 8126–8130 belong to the RM-37 session's batch. Any browser or
container work copies `data/app.sqlite`; nothing opens the live file. **No migration from this item** —
Phase 3's cache is a `DATA_DIR` filesystem tree, not a table. `v65` is RM-37's.

## WP 3.1's own Acceptance had a hole, found after dispatch — 2026-08-23

RM-37's verification agent found that in `apps/api/src/token-counting/`, **removing the request
timeout entirely — and separately disabling the rate limiter — each left the pre-existing 19-test
suite fully green.** Two production paths with no coverage at all, in the very file the suite was
written to test. Species 3 (no test at all, with a green gate nearby mistaken for coverage), found
twice in one file, and only by mutating them.

**The same hole is in WP 3.1's Acceptance, written by this session and not seen until RM-37's finding
made it visible.** The item reads: *"Boot time with an unreachable URL is not measurably worse than
with the fetch disabled — the request is genuinely off the critical path."* Read adversarially,
**that passes even if `DATA_PACK_TIMEOUT_MS` does nothing whatsoever** — a fetch fired and never
awaited on the critical path is also "not measurably worse". The acceptance cannot distinguish a
bounded request from an unbounded one that nobody waits for. And the timeout is not incidental here;
it is the load-bearing half of D-DP4.

**Sent to the agent as an additive brief** (minutes after dispatch, so no mid-flight hazard): three
mutations, each alone with a clean tree between — delete the timeout · neutralise the total budget
separately from the per-request timeout · break the retry pacing. Proved against a listener that
**accepts the connection and never responds**, not one that refuses: a hang is genuinely hard to fake
with a stub, and it is the same control-and-case discipline (assert a normal response is handled,
then make that one server stop answering). *"Nothing went red"* is a reportable finding, not a
failure.

**The lesson is about acceptance criteria, not about timeouts.** An acceptance item phrased as an
*absence* — nothing got slower, nothing was requested, no error appeared — is satisfied by the code
doing nothing at all. It is the ledger's own "an absence is never a measurement", arriving this time
inside a criterion rather than inside a merge.

**One more from the same session, recorded because it validates check 1 in someone else's hands:**
two of their sixteen probes returned an **empty `git diff --stat`** (a malformed mutation command),
and their harness declared those `INVALID PROBE` rather than reading the green as a pass.

## A fetched pack can put text in the operator's UI that no source guard can ever see — 2026-08-23

**For WP 3.2 to decide. Not a defect today: 0 hits.** Surfaced when RM-37's planning-id guardrail —
which scans `packages/shared` because reports render server-side — flagged two RM-38 strings, and
they path-exempted `security-tables.generated.ts` (correctly: a per-string edit there is erased by
the next `pnpm build:data-pack`, and a fix the generator silently undoes is the regression the guard
exists to catch). They flagged the resulting blind spot as a constraint on this item. It is bigger
than that, and all four links were measured on `main` rather than reasoned:

1. `data-pack/schema/security-rules.schema.json` constrains rule `title` (`maxLength` 120) and
   `rationale` (`minLength` 40, `maxLength` 2000) **by LENGTH ONLY — no content constraint.**
2. Both are rendered **verbatim to an app user** — `SecurityPanel.tsx`'s `RuleCell` popover, whose
   own comment says the component deliberately "does not paraphrase it, shorten it or turn it into a
   tooltip".
3. They render into `packages/shared/src/security-tables.generated.ts`, now path-exempted.
4. **After WP 3.1 they can arrive from a FETCHED pack** — text that was never in this repository, in
   any file.

**Link 4 is the finding, and it is this item's, not RM-37's.** Their exemption creates a blind spot
in a source scan; the fetcher makes source scanning **structurally incapable**. Un-exempting would
not fix it: a guard that reads files in this repository cannot see a string that arrives over HTTP at
boot. So the enforcement point for user-visible pack text is the **verifier** — D-DP5 refusal 3, "any
file fails its JSON Schema" — and today that verifier checks length and nothing else.

**Deliberately NOT added to WP 3.1.** It is a class, not a defect; 3.1 already carries five refusals
plus three timeout mutations, and loading a speculative content rule onto it would trade a real proof
for an imagined one. **WP 3.2 owns it**, because 3.2 is what puts these strings in a browser, and it
arrives as a choice with both branches stated: constrain user-visible pack fields in the schema, or
accept explicitly that a published pack can put arbitrary text in the operator's UI.

**The measurement, corrected — and the correction is the more useful half.** 18 rules carry exactly
six keys (`id`, `category`, `subject`, `severity`, `title`, `rationale`), so the user-visible surface
is **36 strings, not 72**. This entry originally said the scan covered
`title`/`rationale`/`remediation`/`description`; **`remediation` and `description` do not exist on a
rule object.** RM-37 caught it. The 0 hits stands — reproduced by them against their guardrail's
actual `PLANNING_ID_RX` rather than a paraphrase, and their run confirms the same regex *does* match
a planted `"(see D-DP6)"`, so the zero is a reading and not a blind spot.

**But the defect in the probe is real and is this item's own lesson biting the orchestrator.** The
scan looped a hard-coded field list with `r.get(field)`, which **silently skips a key that is not
there**. Two of my four names were wrong, and it reported a confident 0. Had all four been wrong —
had the field been `why` rather than `rationale` — **it would have scanned zero strings and reported
exactly the same 0 hits.** A green over an empty set, which is the shape this ledger has now
catalogued in a merge, in an acceptance line, in a probe's diff and in an assertion. **Rule: a scan
that iterates a hard-coded field list must assert it found something** — the non-vacuity guard WP 2.2
put on its own byte-identity test, which I did not apply to my own measurement.

## Species 8 — an absence test cannot detect a change that MANUFACTURES the absence — 2026-08-23

From RM-37's batch, found by probing: a mutation that dropped a SQL column reddened four of five
tests, and **the fifth could not redden — it asserts `null`, and dropping the column also yields
`null`.**

**WP 3.1's five refusals are absence-shaped by construction**, so this lands directly on the WP in
flight. A refusal test asserting only "the pack in force did not change" passes for the right reason
**and** for every wrong one: the fetcher threw early, the URL was never built, `.staging/` was never
written, verify was never called at all. A refusal test that a completely broken fetcher also
satisfies is not testing the refusal.

**Sent to the agent as a sharpening, not new scope:** two assertions per refusal — the typed reason
asserted **by name** (`digest_mismatch`, not "a refusal happened"), plus the control that the same
pack minus the one mutation is **accepted**. The second is what the control-and-case listener was
already worth; what was missed is that it generalises past the HTTP test to every refusal. Where a
refusal genuinely has nothing positive to assert, the test says so and names what else could produce
the same nothing.

**Relation to the earlier entries:** this is the third distinct way an absence has failed as evidence
in this item — a conflict that did not appear, an acceptance line satisfied by doing nothing, and now
an assertion the defect itself can satisfy. A fourth landed within the hour (the field-list scan
above, a green over an empty set). "An absence is never a measurement" has earned its place as the
item's one-line summary.

## Species 9 — a guard belongs where data ENTERS, not where the source lives — 2026-08-23

RM-37's generalisation of link 4 above, and it outgrows both work packages. Once content can arrive
over HTTP at boot, a scan of source text is not a *weakened* instrument — it is **the wrong
instrument**, structurally incapable of seeing the string it is meant to police. Un-exempting a file
fixes nothing.

**Why it is dangerous: it is species 3 arriving by ARCHITECTURE rather than by omission.** No test at
all for a claim everyone believes is tested — because the test that used to cover it **still passes,
over the shrinking part it can still see.** Nothing fails, nothing changes, and the coverage quietly
stops meaning what it meant.

**It generalises past packs**, which is why it is recorded as a species rather than as a note on this
item: the same shape waits wherever this app renders text it did not author — an uploaded skill's
body, a tool description from a scanned MCP server, an imported collection. Any source-scanning guard
over those is already partly decorative. (The security analyzer is the app's existing answer to
exactly this for MCP tool text; the point is that a *copy* guard is not.)

## Species 7 — an acceptance line that cannot fail the defect it was written for

Named here after WP 3.1's own Acceptance hole (above). Distinguished from species 1 by the fact that
it **fails freely on other things**, so it looks alive. The real cost, in RM-37's sharpening: **it
lives in the spec, so it poisons every implementation, and the agent that satisfies it has done
nothing wrong.** Its worst form carries a prose escape hatch — RM-37 found one of their own in
flight, *"X is reachable from the Studio, or `CLAUDE.md` says it is not"*, satisfiable by an agent
that builds nothing and is correct to do so — and the disposition that works is to rule such a branch
a **named residual before the agent reports**, since deciding afterwards lets whatever happened set
the standard.

## The fifth absence, found in THIS item's own relocation test — 2026-08-23

RM-37's fifth shape is **an exemption that governs nothing while reading as a live decision**: a
typo'd entry fails loudly (it exempts nothing, so the violation still reports), but an entry left
behind by a deleted or moved file **exempts nothing while looking deliberate**, and the next author
extends the list rather than questioning it. Species 3 by drift, in a decision record.

**Applied to RM-38 and it finds one, in `apps/api/test/data-pack.test.ts`'s relocation assertion.**
The test is better than my scan was — it carries a real non-vacuity guard
(`assert.equal(ledger.files.length, 15)`), and a vanished `to` path throws out of `readFileSync`, so
that direction is loud. But the other assertion is absence-shaped:

```
assert.equal(existsSync(path.join(repoRoot, entry.from)), false,
  `${entry.from} must not still exist — a move leaves no copy behind (D-DP1)`)
```

**A `from` path is never proved to have EVER existed.** It passes because the file was moved — the
right reason — and it passes identically for a misspelled path, or one that never existed at all,
while reading as a record of a real move. Species 8 wearing species 9's clothes.

**Measured, both directions, rather than argued:**
- All **15/15** `from` paths resolve at the recorded `baseCommit` (`a0179f1`) via
  `git cat-file -e <base>:<path>`. **The ledger is honest today** — this is a hole, not a defect.
- A planted `…/saas/NEVER-EXISTED.json` **passes the current assertion** (it is absent from the
  worktree, which is all the test asks) and **fails the proposed control** (unresolvable at
  `baseCommit`). So the control discriminates, which is the only thing that makes it worth adding.

**The fix is one assertion — `from` must resolve at `baseCommit` — and it is deliberately NOT being
made now.** That file is the pack test file, and WP 3.1's agent is in flight and likely editing it;
taking it would trade a certain merge conflict for a hole that is currently empty. **Queued for
immediately after 3.1 merges**, recorded here so it is not lost.

**RM-37's sharpening of the non-vacuity rule, which corrects my own phrasing of it:** their scan
*printed* `checked=36` beside `hits=0`, and that number is what produced my field-list correction —
but **a printed count is only a guard if a human reads it.** Had they skimmed past it, their scan and
mine fail identically. So: **in a test it must be an assertion; in a one-off script it is a number
somebody has to actually look at**, and saying "my script printed the count" is not the same claim as
"my test asserts it".

**The five absences, as one sentence** (RM-37's formulation, and the best summary this item has
produced): *nothing happened, and nothing was supposed to happen, and no one can tell those apart
without a control.* The five: a merge conflict that did not appear · an acceptance line satisfied by
doing nothing · an assertion the defect itself satisfies · a scan that found nothing because it
looked nowhere · an exemption that governs nothing while reading as a decision.

## Species 5, committed by this session inside the run validating someone else's — 2026-08-23

Recorded because of who made it and where, not because it was costly. Validating WP 3.1, I grepped
my own gate output for failures with a pattern that also matched the word `FAIL` **inside test
names**, got **38**, and briefly held an unexplained number beside an `EXIT=0`. All 38 were `ok`
lines; `^not ok` was **0**.

**That is species 5 — a count measured over the wrong quantity — committed by the session that had
spent the day finding it in others, inside the very run being used to validate another session's
measurement discipline.** RM-37's framing is the one to keep: *the defence is never knowing better;
it is the mechanical habit.* **Read the count the runner prints. Never a grep over its prose.**

The same instrument had already failed once that hour: my first grep for `CONTROL FAILED` in the
agent's HTTP test found one occurrence and appeared to contradict its claim that every refusal
asserts an accept first. Reading the file showed the assertion lives in a shared `controlThenCase`
helper used by all five. **The agent's report was accurate and my instrument was naive — twice, in
opposite directions, within one validation.**

## The prose-merge rule has a price, and no text scan can enforce it — 2026-08-23

**The fourth artifact of the WP 2.1 + WP 2.2 merge, and the first on a file people read.** The
`README.md` `data-pack/` tree entry was **duplicated**: `c594580` (WP 2.2) and `5da963f` (WP 2.1)
each rewrote the same block, the merge kept both, and it sat on `main` as a sentence that restarts
mid-clause — *"…SHA-256 per file (`pnpm build:data-pack`) / entries, protocol/client limits, …"*.
Found by reading the file to write a front-page update, not by any check. Joins the duplicated
comment step and the doubled `console.log` argument already recorded from that same merge. **Three
silent artifacts, one merge, all in prose, none detectable by the gate.**

**And the check that was clearing these merges cannot see them — measured, not argued.** RM-37 had
been resolving prose conflicts by concatenation and clearing each with a duplicate-*sentence* scan
that returned 0 every time; on this find they upgraded it to a repeated-non-trivial-*line* scan. Run
against `90e3fde:README.md`, the exact bytes carrying the defect:

```
PRE-FIX README: 715 lines, repeated non-trivial lines = 0
PRE-FIX README: duplicate SENTENCES                   = 0
```

**Both return 0 on the defective file.** They are the same instrument at different granularity, and
both are **wrapping-sensitive**, which is why they miss it: `grep -n "SHA-256 per file"` puts the
duplicated phrase on lines **622 and 626**, and those two lines differ only in where they wrap, so
line-granularity sees two distinct lines while sentence-granularity sees no whole sentence at all.

**AMENDED — this entry first said the defect has "no lexical signature by construction", and that
was an over-concession.** RM-37 refuted it and I reproduced their refutation rather than accepting
it: collapse whitespace and scan for repeated **12-word** phrases and the block shows up —
`n=12` gives 3 repeated regions, all of them windows over the one duplicate. (`n=8` also matches
markdown table rules `| --- | --- |`, so 8 is too loose and 12 is not.) **The signature was there the
whole time.** A whitespace-collapsed n-gram is a genuinely better smoke test than either scan above.

**The conclusion survives, for a reason neither of us stated first: the CLASS is not guaranteed a
signature even though this INSTANCE has one.** Two rewrites of one block need not share phrasing at
all — a rewrite that reworded everything leaves no trace at any granularity. So a scan can only ever
be a smoke test over the subset where the two sides happen to overlap, never the decision procedure.

**And the over-concession is this item's own lesson pointing back at me.** "No lexical signature by
construction" was the blanket downgrade in the opposite direction — the exact error I corrected
RM-37 on hours earlier when they erased the manual relocation proof alongside the standing test's
false one. **Conceding more than the evidence supports reads as rigour and costs exactly as much
accuracy as over-claiming.** It survived one round because the framing was more elegant than the
truth.

**What does work is on the diff side, before resolving:** were the two sides **additions of different
blocks** (union is right) or **rewrites of the same block** (union is always wrong — take a side or
write a third version)? That is decidable by reading what each side changed against the merge base,
and it is not decidable afterwards by inspecting the merged text.

**The general form, and it is the day's pattern arriving one level up.** A check returned 0; the 0
was true about the wrong quantity; and **the fix had the same defect as the original** — moving from
sentence granularity to line granularity felt like closing the hole and moved nothing, because the
**axis** was wrong rather than the resolution. *A refinement along the wrong axis is
indistinguishable from progress until someone measures it against the actual failure.* It was only
caught by running the new check against the **defective bytes** in `git show` rather than against
current files, where it returns 0 and reads as confirmation. **Test a fix against the state it was
meant to fix, not against the state you have** — which is a non-vacuity control one level up.

Current state, checked rather than assumed: `README.md` **0** repeated lines · `CHANGELOG.md` **0** ·
`CLAUDE.md` **1**, the `DC-17` service-tokens link at lines 372 and 440 closing §6's and §7's own
paragraphs — legitimate, pre-existing, left alone.

## A ban is an absence too — the rule from this morning was half a rule — 2026-08-23

This item told WP 3.2 to guard the D-DP8 stamp with a **ban** ("no builder assembles the field
itself") on the grounds that a ban fails the safe way where a presence check can be satisfied by a
comment. RM-37 pointed out that this is **half a rule**: a ban is *itself* an absence assertion, and
it passes when the scan looks in the wrong place or walks an empty set. **If a seventh builder is
added under a path the glob does not match, the test stays green and the guarantee is gone** — and
D-DP8's reproducibility claim rests entirely on that guarantee.

**So a ban needs the same two things every other absence in this ledger needed:** a **non-vacuity**
assertion (it walked a non-empty set, and — stronger — found the sanctioned call site in *every*
builder it expects), and a **positive control** run as the two-step probe (delete a real call, leave
a plausible comment naming the helper, confirm still red).

**Two precedents on `main`, both read here rather than recalled, and the distinction between them is
the load-bearing part:**
- `apps/api/test/estimate.test.ts:333-346` — the D-CT5 tooth for "one pricing code path". Strips
  comments before matching and states why the naive strip is exact there. **The call-site variant**:
  one function is the only producer. It reads **one hardcoded file**, so it cannot go vacuous —
  `readFileSync` throws if the file moves. **A glob over several builders has no such protection.**
- `apps/api/test/security-report-export.test.ts` — **the structural variant**: one file owns the
  thing.

**The stamp needs the call-site variant**, because six builders each legitimately call the helper. A
one-file rule would be the wrong shape and would read as satisfied while being unenforceable.

**And the design's own priority, restated because the brief had it second.** The single definition is
required because *a document that names its data version is worthless if two builders can disagree
about the version* — a correctness requirement, not a merge convenience. The clean additive merge
with the concurrent workstream is a side effect of getting the correctness right. Choosing a shape
because it merges well is the priority inverted.

**Why the stamp is not being routed around the four hot trees at all** (advisor, compatibility,
`assertions/service.ts`, the report builders, plus `grading/run-report.ts` which is a report builder
in all but name): routing around a shared file means writing the same value in two places, which is
the duplication problem one level up — the very class that produced the README defect above. One
definition, one call per builder, additive-vs-additive at the merge.

## Two owner rulings — 2026-08-23

**1. Published pack text: ACCEPT IT, AND STATE THE BOUNDARY.** The open question recorded above —
rule `title`/`rationale` are free text, rendered verbatim to an operator, and after WP 3.1 they can
arrive from a fetched pack that no source guard can ever inspect — was put to the owner with three
branches (constrain in the schema · accept and document · sanitise at display). **Ruling: accept.**
Whoever publishes reference data is trusted with what it says, which today is the owner from their
own repository. **So no content constraint goes into the JSON Schema**, and the earlier "WP 3.2 owns
it as a choice with both branches open" resolves to the documented-boundary branch.
**WP 3.3 owns writing it down** — the DC subject must state plainly that a published pack can set the
text an operator reads, so it is a stated property rather than an oversight. That sentence is the
whole deliverable of this ruling; do not let it become a code change.

**2. The formatter: ADOPT ONCE, THEN ENFORCE.** One deliberate commit formatting the tree, then
`lint` drops `--formatter-enabled=false` so it cannot drift again.
**Explicitly NOT RM-38's work and not to be done inside it.** It is repo-wide, it changes
`quality-gates.md`'s definition of done, and per the lifecycle rule it wants its own `RM-NN` item.
**It also cannot be done while anything is in flight** — 735 files landing under three sessions'
branches is precisely the accident it exists to prevent, done deliberately and to everyone at once.
Agreed with RM-37: a quiet tree, no agents running on either side, one mechanical commit with nothing
else in it, announced before and confirmed clear. **Carried here only so the decision is not lost**;
the warning documentation stays correct in the meantime and must not be reverted when it happens.

## A coordination fact written into code that the code cannot enforce — 2026-08-23

**This item shipped the only fixed-port bind in the repository, and it fired against a peer session
within hours.** `data-pack-fetch-http.test.ts` binds **8131/8132/8133/8134** because the WP 3.1
brief allocated that range — an orchestrator instruction, inherited without question. A concurrent
session ran the api suite while this session probed, and **13 tests went red together** with
`listen EADDRINUSE: address already in use 127.0.0.1:8131`: the CONTROL, all five REFUSALs, the
negative control, both BOUNDs and the network-failure cases. **Every test NAME points at the
fetcher; only the error line names the cause.**

**Measured, after the first instrument failed.** A grep for `port:\s*[0-9]{2,5}` returned **zero**
fixed binds — because the code reads `listen({ port: SERVE_PORT })`, a constant, not a literal. The
scan measured the wrong quantity and its clean result was a **false clean on a file this session had
just probed by hand**. Re-run by printing every `.listen(` site in **tracked source** with its port
expression, exact figures:

| | |
| --- | --- |
| `.listen(` lines in tracked source | **69** |
| genuinely non-ephemeral | **2** |
| `apps/api/src/index.ts:1915` | production, `config.port` — correct |
| `data-pack-fetch-http.test.ts:172` | **the sole fixed test bind** |

(The three further hits in `data-pack-seam.test.ts` are string literals inside its source-scanning
guard, not binds.) So it is not a judgement call the repo makes differently elsewhere — it is **one
outlier against 66 sites already ephemeral**.

**BOTH SESSIONS' FIRST INSTRUMENTS FAILED THE SAME WAY, AND ONE WAS HANDED OVER AS A CHECKED FACT.**
RM-37 reported "I scanned the whole repo, this is the only fixed-port bind" — a **true claim their
instrument had not established**: they grepped for a 4-digit *literal* inside `.listen(`, which could
never match `listen(port, …)` where `port` is a constant, so **zero was what it always returned,
about any tree.** They then passed it to this session and to two of their agents as verified. This
session made the identical error one message earlier. **Two independent sessions, same question, same
wrong instrument, within minutes** — which is the strongest available evidence that this is
structural rather than personal carelessness, and that "be more careful" is not the fix.
**The fix is the habit: when scanning source, PRINT what matched and look at it.** A count answers
*"how many of the thing I described"*; only the printout answers *"is the thing I described the thing
I meant"* (RM-37's formulation). It caught all four failures the moment it was applied. A related
trap in the same exchange: their honest re-run first drowned in `apps/web/dist`, so **scan tracked
source, not the working tree**.

**RM-37's diagnosis is the species and it is worth more than the fix.** The file carries a comment at
`:44`: *"8131–8134 are RM-38's allocation (see the ledger). Nothing else on the machine may be
assumed…"* — **a coordination fact, written into code, that the code cannot enforce and a future
reader cannot verify.** It was true when written. It stops being true silently, because the test
outlives the conversation that allocated the range and gets run by a session that never saw the
message. `listen({ port: 0 })` needs no comment, no ledger and no agreement.

**The general test, and it is the most portable thing this exchange produced:** *if the correctness
of a line depends on a fact recorded somewhere else, the line is wrong.* It covers all three of this
week's mechanisms with one rule — the reserved port (correctness depends on a ledger), the `49`/`51`
transposition (correctness depends on a code comment to disambiguate a self-consistent pair), and a
stale exemption path (correctness depends on a file still existing).

**And a note on why neither session questioned the allocation.** RM-37 used these ranges happily for
four batches of browser walks — *"the range worked perfectly for my case, which is exactly why I
never examined it"*. **A convention that works in the case you use it in is invisible until someone
uses it in the case it fails.**

**And the allocation was the wrong instrument, not a mis-used right one.** A reserved range works for
a container a human opens in a browser — a person can see which port is theirs. For anything a *test*
binds it only relocates the collision onto whoever forgets the reservation. The two cases were
conflated in the WP 3.1 brief and inherited straight into WP 3.3.

**Sent back for `listen({ port: 0 })`**, reading the assigned port off the server, with the
`DEAD_PORT` case handled by binding-then-closing rather than hoping a number is free. **The cost of
finding it late was borne by a peer**, and the only reason it was cheap is that the signature was
reported mid-flight rather than after their gate went red.

**Third naive-instrument failure by this session in one day**, all the same shape — a grep that
measured something adjacent to the question: `FAIL` inside test names, `CONTROL FAILED` counted
outside its helper, and now a port literal that is a constant. **Read the count the runner prints;
when scanning source, print what matched and look at it.**

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

~~**Every WP here that mints an identifier, names a file or documents a command uses `aiwb`**~~ —
**REVERSED 2026-08-23, because the premise expired.** That instruction assumed RM-37 would land
first. It has not: measured on `main` today, the handle is still `mcpfp` (`apps/cli/package.json`
name and bin, root `package.json`), and `aiwb` appears in **no** code path — only in three planning
ledgers and one temp-directory prefix.

**So WP 3.3 uses the handle the tree actually carries.** A publish script, a release-asset name or a
documented command written as `aiwb` on a tree whose binary is `mcpfp` is **documentation that does
not work** — and the cost of being renamed twice is one `sed` in RM-37's own sweep, which is already
scoped to do exactly that. Trading a working document for a saved rename is the wrong way round.

**A known fact that nobody re-checks is how a plan goes stale** — this ledger's own words, from the
struck lint claim above, now applied to an instruction it wrote itself six days earlier. The
instruction was right when written and wrong when read, and nothing about it announced the change.

*(One harmless artifact: WP 3.1's `data-pack-fetch-http.test.ts:229` mints a temp-directory prefix
`aiwb-datapack-http-`. It resolves to nothing and breaks nothing — noted so RM-37's sweep is not
surprised to find their target name already present.)*

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
   against a bad merge. **SHARPENED 2026-08-23, and the sharpening is the point: this downgrade was
   not enough.** RM-37 arrived at the same correction on their own copy of the rule and stated the
   residue better than either of us had — the `from` half is not evidence a move happened either,
   only that **a path is absent now**. That is all it has ever been.
   **And a DOWNGRADE IS NOT A FIX.** This rule was written after a real incident, in this file, saying
   in as many words "trust this less" — and the second, larger hole survived it untouched, because a
   note telling readers to trust something less leaves the untrustworthy thing in place doing exactly
   what it did before. Both of us then caught the same mechanism a second time with different
   instruments. **When a guard is found to be weaker than its citation, change the guard or delete
   it; do not annotate it and move on.**
   **And the symmetric error, which completes the rule.** RM-37's first amendment restated the
   standing as a flat *"not evidence the move happened"* — erasing the manual base-commit check,
   which is a **real** proof, alongside the standing test's false one. **A blanket downgrade is the
   same error wearing the opposite sign, and it is the easier one to feel virtuous about**: throwing
   out a sound proof beside an unsound one reads as rigour and costs exactly as much accuracy as
   over-claiming did. Their own note on it is the part worth keeping — they did it *inside* an
   exchange whose entire subject was that distinction, one message after receiving the correction,
   which is as clear a demonstration as either of us will get that **this failure is not a knowledge
   problem.** So: correct a citation to what the evidence actually supports — neither up nor down.
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

## A guard a COMMENT can satisfy — found in WP 1.2's own merged code, 2026-08-23

RM-37 hit this while repairing a guard of their own and passed it on. Probed on **this item's** code,
on `main`, and it was live:

`data-pack-seam.test.ts`'s shipping guard read `copy-data-pack.mjs` **un-stripped** and asserted
`/manifest\.json/`. Deleting the two lines that actually copy the manifest turned it red — but only
because that string happened to appear nowhere in a comment. **Adding one comment line — "this script
also copies manifest.json" — with the copying code still deleted made the test GREEN.** The manifest
would have stopped shipping and a passing gate would have said nothing.

Fixed on `main`: that scan and the `index.ts` boot-order scan now strip comments before matching, and
both carry the probe result in the test file. Re-probed after the fix — same mutation, now red.
`# pass 3886 # fail 0` restored.

**The general form, which is why it is recorded here and not just fixed:** a guard that reads
un-stripped source asserts *"someone wrote this string"*, never *"the code does this"* — and
documentation is the thing most likely to keep the string alive after the code is gone. It is the
hash-ledger error again in a new costume: precisely right about the wrong quantity. **This matters
most exactly when tables move between files**, which is what WP 2.1 is doing right now — a comment
describing the old location routinely outlives it.

### `data-pack/manifest.json` is a generated file two workstreams will both rewrite — 2026-08-23

RM-37 WP 2.9 edits `data-pack/compatibility/test-catalog.json` as its authoring path and runs
`pnpm build:data-pack`. RM-38 WP 2.1 adds `security/rules.json` + `security/signatures.json` to the
pack and will run the same build. **Both regenerate `manifest.json`, which carries a SHA-256 and byte
length per file — 18 today — and is stamped by the generator.**

So the two branches will collide on a **generated** file whose contents encode *the other side's data
too*. A textual merge of it is meaningless: resolving by hand produces a manifest that matches
neither tree, and the digest test then fails for a reason that looks like corruption.

**The rule, for whoever merges first:** never hand-merge `manifest.json`. Take **either** side wholesale,
then run `pnpm build:data-pack` and commit what it writes. The manifest is derived; the pack files are
the truth. Same for `data-pack/generated/all-models.json`.

This is the third face of "both, not one" — the first two were two work packages needing both halves of
a hand-written file; this is a **derived** file where neither side is right and the fix is to re-derive.

#### Probe validity is THREE checks, not two — and the third is the dangerous one

From RM-37, who lost three probes to it. A probe proves nothing unless:
1. **The edit applied** — `git diff --stat`. (Hit twice in this item: a mutation targeting a symbol
   that did not exist reported a confident GREEN both times.)
2. **The test ran** — an exit code or a count. Silence is also what a command that never started
   produces.
3. **The mutation reached the code under test** — build boundary, stale `dist`, cached artifact, or a
   mock standing in for the module.

**Item 3 is qualitatively worse than the other two.** They catch you doing *nothing*; item 3 has you
doing everything correctly **against the wrong copy**, and it yields a *confident false negative* — a
working guard recorded as inert, and then "fixed". Same family as a chart stub that discards its props:
a real test, really running, against something that is not the thing.

**The concrete exposure in this repo:** `apps/api` tests import `packages/shared` from its **built
`dist`**, and the package's `test` script runs `scripts/build-shared-once.mjs` first. Invoking
`npx tsx --test` directly — which "just run the files you touched" actively encourages — **skips that
build**, so a shared mutation sits in source while the test runs against the previous artifact. Phase 3
puts the fetcher contract in `shared` with consumers in `api`: exactly this shape.

**Verified here rather than assumed** (2026-08-23): mutating `computeSecurityScore` in
`packages/shared/src/security-posture.ts` (`100 - deduction` → `42 - deduction`) and running
`pnpm --filter @mcp-token-footprint/api test` turned **12 tests red**, first among them
`A4 — a clean server scores 100/clean`. So this session's probes have been sound — but by the habit of
using the package's `test` script, not by care. `build-shared-once.mjs` keys freshness on a stamp
compared against the newest **source** mtime, so a source edit does invalidate it; that was read in the
code *and then proved*, because reading it is exactly what item 3 punishes.

**Standing rule for every RM-38 probe from here: run the package's own `test` script, never the bare
runner.** Slower loop, honest result.

## The second audit question, and what it finds in RM-38 — 2026-08-23

RM-37 turned an aside of mine into a second audit question, and it finds a **different** set from the
first: **"is this check the only thing standing behind something that has never run?"** The two barely
overlap — a presence check can be perfectly sound and still be the sole evidence for an artifact
nobody has executed. Its degenerate form is the comment-satisfies-grep case: **the verification and the
thing verified share an author and an assumption, so the check cannot contradict what it checks.**

**Applied honestly to RM-38, it finds three, none of them fixed:**

1. **The real Docker image has never been built for this item.** WP 1.2 verified `node apps/api/dist`
   boots and resolves a pack, and WP 1.1 ran a probe image confirming `data-pack/` enters the build
   context — but the `Dockerfile` never names `data-pack-bundled`, no workflow runs `docker build`, and
   the only workflow on `main` is `mcp-self-scan.yml`. So "the pack reaches the runtime image" rests on
   two partial checks plus reasoning about a `COPY --from=build /app/apps/api/dist`. **Assigned to WP
   3.3**, which already owns offline verification — it must actually build and boot the image, not
   reason about it.
2. **The 279-line JSON Schema validator is self-authored and validates schemas this repo also
   authors.** If a schema states the wrong constraint, the validator agrees with it. It throws on an
   unimplemented keyword, which is the right failure direction, but nothing independent checks that a
   schema means what it claims.
3. **WP 3.1's fetcher will land in exactly RM-37's token-counter shape unless it is designed against
   it.** Its remote behaviour will be exercised through an injected `fetch` seam — a stub written by the
   same agent that writes the assumption it encodes. Every refusal will pass against a stub built to
   produce that refusal. **Recorded now, before the WP is dispatched:** at least one refusal must be
   proved against a real HTTP server (a throwaway `node:http` listener serving a corrupt manifest is
   enough) rather than a stub, or the five D-DP5 refusals are self-fulfilling.

**And it re-frames a hole this ledger already named.** WP 2.1's byte-identity acceptance is a check
whose **fixtures move with the thing they verify** — an id renamed in both the registry and the
fixtures passes silently. That is the same family, not a separate quirk, and the mitigation stays what
it was: treat ids as frozen rather than expect the tests to notice.

### The audit that follows, and RM-37's narrowing of it

RM-37 applied the two-step probe to their own guards and found a **fourth** hole, worse-placed than
mine: a source scan over `scripts/release/run.ps1`, a file that has **never been executed on Windows**
because nobody in that item has a Windows machine. So the assertion was not one of several
verifications behind that file — it was the **only** one, and a comment could satisfy it. My manifest
case at least had a boot failure waiting downstream.

**Their narrowing, which shrinks the audit surface a lot:** only a **presence** assertion
(`assert.ok(src.includes(x))`, `assert.match(src, /x/)`) is vulnerable. A **ban** — assert the string
is absent — fails the *safe* way: a comment containing the banned word causes a false **red**, which is
annoying, not dangerous. So the audit question is not "does this guard read source" but **"does it
assert something is THERE"**.

**RM-38 audited on that basis. Result: exactly one hole, the one already fixed.** The other presence
assertions in this item's tests are safe by construction and were checked rather than assumed —
`data-pack.test.ts:99/201/383` assert over **file listings**, not source text;
`data-pack-seam.test.ts:199` matches `package.json`'s `scripts.build`, and **JSON has no comments**;
`data-pack-loader.test.ts:164` matches a refusal *detail string* off a result object, not a file.

**A hazard in this session's own validation method, from RM-37:** one of their probe invocations never
ran at all — wrong working directory, `grep` matched nothing — and **empty output reads exactly like a
clean pass**. This session has repeatedly validated by piping a test run through `grep -E "^not ok"`
and reading silence as success. Silence is also what a command that failed to start produces.
`git diff --stat` confirms the *mutation* applied; an exit code or a baseline count confirms the
*test actually executed*. Both halves, or neither is evidence.

## The web "flake" — evidence DOWNGRADED, 2026-08-23

**Corrected the same night by RM-37, and the correction cuts the evidence in half.** RM-37's own
full-gate reds turned out to be **two real, deterministic defects** — a source-scanning guardrail that
cannot be load-sensitive by construction, and a test rendering a view without the shell its button
moved into. Both fail in isolation, repeatedly; both are fixed; the re-run is green **in parallel**
(415 files / 4771 passed, EXIT=0). That run is a **control, not a fourth sighting.**

So the standing evidence is **two sightings, both confirmed-by-agent-report and neither reproduced by
an orchestrator**, plus my own two-file failure whose names I never captured. "The cluster is
hub/assistant/watch dialogs" is **not established** and should not be repeated as though it were.

| Sighting | Failed | Named | Alone |
| --- | --- | --- | --- |
| RM-38 WP 1.2 (this item) | 2 files, at load **155** *and* at load **32** | not captured — a third full run came back EXIT=0 | 394/394 twice |
| RM-37 WP 2.1's agent | 4 files | **`CrewProfileModal`** (hub), **`RuleEditorDialog`** (watch) | 26/26 and 22/22; 37 files / 461 green together |
| RM-37 WP 2.5's agent | 3 files | all under `features/assistant` + `features/hub` | 85/85 at load **97** |

**The cluster is hub / assistant / watch dialogs — heavy modal-rendering suites.** Combined with a
recurrence at load 32, CPU starvation is a **poor** fit; cross-file shared state, or a timer/portal
leak between parallel workers, is a much better one. None of the three work packages that saw it
touched those files.

**This is deliberately NOT filed as "the documented load flake."** That conclusion is absence-shaped —
it costs nothing to reach, explains a load-32 failure badly, and would hide a real bug that only
appears under parallelism, which is exactly the bug this evidence describes. It belongs to the testing
workstream, not to RM-38; recorded here because this item is where the evidence was pooled.

**The next step that would settle it**, for whoever picks it up: run the full web suite with file
parallelism disabled (`vitest --no-file-parallelism`) against a run with it on. Green serial + red
parallel converts this from folklore into a reproducible defect and points straight at shared state.

## Test-count baselines (measured by the RM-35 session, 2026-08-22, gate green)

Check **counts**, not just the exit code — the failure mode under this machine's load is a truncated
run that exits 0 over fewer files. shared **287** · illustrations **1032** · cli **87** · api **3832** ·
web **383 files / 4337 passed + 5 skipped**. A bare `Test timed out in 5000ms` in the web suite under
load is a **false red** (a different file each run, all pass in isolation). Below baseline must be
reconciled, never assumed to be either.

**"A green under load is still a green" — CORRECTED 2026-08-23, and the correction is why counts are
read at all.** The asymmetry is real and its mechanism is plain: starvation makes a test exceed
vitest's 5 s ceiling, which is reported as a **failure**. Starvation cannot manufacture a pass. So a
red under load is not evidence and a green is — **but only over an unshrunken corpus.** A starved run
that never *executed* a file reports **fewer tests**, not failures, and that is a green over a
smaller set, which is the one way a green under load can lie. RM-37 supplied the missing half.

**The check is therefore the corpus, not the exit code**: file count *and* skipped count against
baseline, every time. Applied to this session's own WP 3.1 validation rather than asserted — it ran
at load **66** and returned `Test Files 394 passed (394)` · `Tests 4463 passed | 5 skipped (4468)`,
byte-identical to the baseline above, and the four `node --test` packages each reported `# tests`
equal to `# pass`. That green stands. A green at load whose corpus was never checked does not.

**A cross-session count note, so a future reader does not read a phantom regression.** As of
2026-08-23 this session measures shared **288** / api **3964** on `main`+WP 3.1, while the RM-37
session measures shared **382** / api **4149** on `rm37/integration`. The delta is RM-37's batch, not
a drop. Compare counts only within one branch.

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
