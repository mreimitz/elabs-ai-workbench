---
type: "Work Package Spec"
title: "WP 1.1 — data-pack/: manifest, JSON Schemas, shared contract, and the model data moved in"
description: "Phase 1 of item.md. Ledger: STATUS.md. Mechanical relocation plus the pack contract — no behaviour change."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T19:25:00Z"
status: "final"
---
# WP 1.1 — `data-pack/`: manifest, JSON Schemas, shared contract, and the model data moved in

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Repo rules in `.claude/rules/`.

## Why this one is first

The two-stage pipeline this whole item generalises **already exists**, for models only, buried under
`planning/Research/RS-01-token-context-comparison/outputs/`. This WP moves it to a top-level home and
gives it a manifest and schemas. It changes **no runtime behaviour whatsoever** — that is the point:
every later WP moves values that change verdicts, and they need a mechanical, provably-neutral base.

## Scope

1. **Create `data-pack/` at the repository root** with this layout (empty files are not created —
   only what this WP fills):

   ```
   data-pack/
     manifest.json
     schema/
       manifest.schema.json
       model-entry.schema.json        # moved from planning/Research/RS-01-*/outputs/schema/
       test-catalog.schema.json       # moved from planning/Research/RS-01-*/outputs/tests/
       cross-cutting.schema.json      # NEW — cross-cutting-limits.json has no schema today
     models/saas/*.json               # git mv from RS-01 outputs/data/saas/
     models/open-weight/*.json        # git mv from RS-01 outputs/data/open-weight/
     limits/cross-cutting.json        # git mv from RS-01 outputs/data/cross-cutting-limits.json
     compatibility/test-catalog.json  # git mv from RS-01 outputs/tests/test-catalog.json
     build/{build.ts,build-cli.ts}    # git mv from apps/api/src/compatibility/
     generated/                       # build output: all-models.json, model-data.generated.ts
   ```

2. **`manifest.json`** — `{ packVersion, schemaVersion, asOf, generator, files: [{ path, sha256, bytes }] }`.
   `packVersion` is semver. `schemaVersion` is an integer the app compares against its supported range.
   The manifest is **generated** by the build, never hand-edited, and `files[]` covers every shipped
   file except the manifest itself.

3. **`packages/shared/src/data-pack.ts`** — the contract both ends read:
   `DATA_PACK_SCHEMA_VERSION` (starts at `1`), `DATA_PACK_MIN_SUPPORTED_SCHEMA_VERSION`, the manifest
   type + `.strict()` zod schema, a `DataPackRefusalReason` union covering D-DP5's five refusals, and
   the pure helpers `verifyManifestDigests(files)` / `comparePackVersions(a, b)`. Its only import is
   `zod` — no `node:fs`, no network. Export it from `packages/shared/src/index.ts`.

4. **`pnpm build:data-pack`** replaces `pnpm build:model-data` (keep the old script name as an alias
   for one release, printing a deprecation line). The build reads `data-pack/models/**` +
   `limits/` + `compatibility/`, writes `data-pack/generated/all-models.json` and
   `packages/shared/src/model-data.generated.ts`, then writes `manifest.json` with fresh digests.

5. **Keep the drift guard**, repointed: `apps/api/test/compatibility-data.test.ts` rebuilds in memory
   and byte-compares the committed generated artifacts, and additionally asserts every
   `manifest.files[].sha256` matches the file on disk.

## Explicitly out of scope

No loader. No fetcher. No route. No env var. Nothing reads `data-pack/` at runtime yet —
`apps/api/src/compatibility/data/` keeps being the file the engine reads, now produced into that
location by the relocated build (or copied by the existing `copy-data.mjs`). **WP 1.2 moves the read.**
Do not touch `security-posture.ts`, the analyzers, the advisor rules, or any threshold constant.

## Acceptance

- [ ] `data-pack/` exists with the layout above; every moved file moved with `git mv` (history preserved).
- [ ] `planning/Research/RS-01-token-context-comparison/outputs/data/` and `outputs/tests/test-catalog.json`
      are replaced by a short pointer note naming `data-pack/` — the research *finding* stays, the
      *shipped file* does not live there any more. `okf:validate` passes.
- [ ] `pnpm build:data-pack` regenerates `all-models.json` + `model-data.generated.ts` **byte-identical**
      to what is committed today. This is the proof the relocation is a move.
- [ ] **Every relocation is verified by hash, not by eye.** For each `git mv`, `git hash-object` the
      path before and after and assert equality, as a checked-in test or script — not a one-off shell
      command. The drift test proves only that the *generated* artifacts are unchanged; it says nothing
      about the hand-curated *inputs*, where a stray formatter or a normalised trailing newline would
      pass unnoticed. A differing hash is a finding to report, never something to fix by normalising the
      file. This is also how the RM-37 rebase (see STATUS.md's sequencing note) is mechanically confirmed
      to have landed on the post-`finding_name` bytes rather than silently reinstating the pre- ones.
- [ ] `manifest.json` validates against `manifest.schema.json`; every listed digest matches disk.
- [ ] Every `models/**/*.json` validates against `model-entry.schema.json`; `limits/cross-cutting.json`
      against the new `cross-cutting.schema.json`; `compatibility/test-catalog.json` against its schema.
- [ ] `packages/shared/src/data-pack.ts` imports nothing but `zod` (source-scan test).
- [ ] The gate is green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`. If the two
      pre-existing `all-models.json` lint errors are resolved by the move, say so; if they follow the
      file, say that instead — do not let the count drift silently.

## Teeth to verify (break it, watch it go red, restore)

1. Edit one byte of a moved model JSON without rebuilding → the drift test must fail.
2. Corrupt one `sha256` in `manifest.json` → the digest assertion must fail.
3. Add an unknown required-shaped field violating `model-entry.schema.json` → schema validation must fail.
