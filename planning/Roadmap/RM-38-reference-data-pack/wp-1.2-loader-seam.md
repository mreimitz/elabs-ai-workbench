---
type: "Work Package Spec"
title: "WP 1.2 — the pack loader and the install-at-boot resolver seam"
description: "Phase 1 of item.md. Ledger: STATUS.md. One loader, installed before every consumer; the compatibility engine reads the resolved pack."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T18:36:00Z"
status: "final"
---
# WP 1.2 — the pack loader and the install-at-boot resolver seam

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). **Depends on WP 1.1.**

## Why

Today `dataset.ts` and `catalog.ts` each do `readFileSync(new URL("./data/x.json", import.meta.url))`
at module load. That is two hard-coded addresses and no way to swap the data. This WP replaces both
with one resolved pack, installed at boot — the exact shape `installPricingResolver(pricingRepository)`
already uses at `apps/api/src/index.ts:198-202`, which resolves prices before anything can price a model.

## Scope

1. **`apps/api/src/data-pack/loader.ts`** — reads a pack from a directory, validates manifest + digests
   + per-file schemas, and returns either a `ResolvedDataPack` or a typed `DataPackRefusal`. Pure over
   an injected filesystem seam so tests never touch the real tree. **Never throws on bad input** —
   refusal is a value, because D-DP4 says boot cannot fail on data.

2. **`apps/api/src/data-pack/source.ts`** — the module-level holder plus
   `installDataPackSource(pack)` / `getDataPack()`. Wired in `index.ts` **before**
   `installPricingResolver`, so no consumer can observe an unresolved pack.

3. **Resolution at boot (D-DP2, the first two rungs only — the fetch is WP 3.1):**
   bundled snapshot → `DATA_DIR/data-pack/` cache if valid **and** a higher `packVersion`.
   Atomic: build the whole `ResolvedDataPack` first, install it in one assignment, or keep the previous.

4. **Repoint the readers.** `apps/api/src/compatibility/dataset.ts` and `catalog.ts` take their JSON
   from `getDataPack()` instead of `readFileSync`. Their exported function signatures do not change —
   `getAllModels()`, `getCrossCutting()`, `getCatalog()`, `getModel()`, `listModelRefs()` all keep
   their shapes, so nothing downstream is touched.

5. **Shipping the snapshot.** `apps/api/scripts/copy-data.mjs` is replaced by a step that copies
   `data-pack/` (schemas, data, manifest, generated) into `apps/api/dist/data-pack/`. The Dockerfile
   build stage needs no change — it already `COPY . .` before `pnpm build` — but confirm the snapshot
   lands in the runtime image, since only `apps/api/dist` is copied forward.

## Explicitly out of scope

No network. No fetcher, no `DATA_PACK_URL`, no route, no UI. No value moves into the pack that was not
already there in WP 1.1. The security registry, the signature lists and every threshold stay exactly
where they are.

## Acceptance

- [ ] `getDataPack()` is the only path by which compatibility data is read; a source-scan test fails on
      a `readFileSync` of `all-models.json` / `cross-cutting-limits.json` / `test-catalog.json` anywhere
      outside `data-pack/loader.ts`.
- [ ] `installDataPackSource` is called before `installPricingResolver` in `index.ts`; a test asserts the
      order by observing that a consumer resolving at import time sees an installed pack.
- [ ] **Byte-identity**: a compatibility heatmap and a compatibility run report over a fixture scan are
      byte-identical to the pre-WP output. Same for `MODEL_CONTEXT_LIMITS` and the priced-model set.
- [ ] A cache directory holding a **valid, higher-versioned** pack is preferred over the bundled snapshot;
      a cache holding an invalid or lower-versioned pack is ignored and the bundled snapshot serves.
- [ ] `node apps/api/dist/index.js` (built, not `tsx`) boots and serves the compatibility endpoints —
      the snapshot really is in `dist`.
- [ ] Gate green.

## Teeth

1. Truncate the cached `manifest.json` → loader refuses, bundled snapshot serves, boot succeeds, the
   refusal is logged with its reason.
2. Point the cache at a pack with `schemaVersion` one above the supported max → refused as unsupported,
   not partially loaded.
3. Delete `apps/api/dist/data-pack/` after a build → the built API must fail loudly at boot with a
   message naming the missing snapshot, not silently serve an empty model list.
