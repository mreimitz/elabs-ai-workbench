---
type: "Documentation"
title: "Reference data pack"
description: "The versioned, schema-validated data-pack/ folder of external facts and judgement tables the app validates servers and skills against, the startup refresh that keeps an installed container current without an image rebuild, and the publish path that produces one."
tags: ["documentation", "DC-26"]
timestamp: "2026-08-23T16:20:00Z"
status: "draft"
---

# Reference data pack

## Subject

The versioned, schema-validated data-pack/ folder of external facts and judgement tables the app validates servers and skills against, the startup refresh that keeps an installed container current without an image rebuild, and the publish path that produces one.

## Scope

**In:** What the pack holds and what deliberately stays compiled in; how a pack is edited, sealed and published; the five refusals and what the app does about each; the resolution order (fetched, bundled, in-code) and where the resolved version is stamped; the Settings and diagnostics surfaces; the offline story.

**Out:** The security analyzer's rules themselves (DC-24), the compatibility engine (DC-10), the advisor rules (DC-25), and the offline image hand-off bundle (DC-22) — this subject documents the DATA those parts read, not those parts.

## Where the code lives

- `data-pack/`
- `apps/api/src/data-pack/`
- `packages/shared/src/data-pack.ts`
- `scripts/publish-data-pack.sh`

## What shipped, versus what was planned

The plan is [RM-38](/Roadmap/RM-38-reference-data-pack/item.md); its ledger
[`STATUS.md`](/Roadmap/RM-38-reference-data-pack/STATUS.md) is authoritative for per-work-package
state, and the locked decisions **D-DP1–D-DP9** are the constraints the code keeps honouring.

**Delivered as planned.** One top-level `data-pack/` folder is the single home for every ageing
external fact and judgement table (D-DP1); it carries a manifest with a SHA-256 and byte length per
file, a JSON Schema per file kind, and a `packVersion` taken from `data-pack/package.json`. A loader
installed at boot resolves **fetched → bundled → compiled floor** (D-DP2) and applies a pack whole
or not at all. The compiled floor survives only where its absence is unsafe — model context limits
and the priced-model table (D-DP3) — and is *generated* from the same authored files rather than
hand-maintained, so it cannot drift into a second source of truth. A startup fetcher checks a
published manifest after `listen()` and never on the boot path, bounded per request and again for
the whole check, with every failure keeping the pack in force (D-DP4). Five refusals reject a whole
pack (D-DP5), the security rule-id ledger is anchored on the **bundled** registry rather than the
pack in force (D-DP6), a severity change requires an analyzer-version bump (D-DP7), the resolved
`packVersion` is stamped into every document a verdict travels in (D-DP8), and pattern sources are
compiled once under a length cap (D-DP9). Surfaces: `GET`/`POST /api/data-pack`, a Settings row, a
diagnostics group, and the browser reading the live pack rather than the compiled floor.

**No migration, no new runtime dependency, and no feature flag** across the whole item. The cache is
a filesystem tree under `DATA_DIR`, not a table.

### Where it differed from the plan

- **The publish target changed, because the planned one could not work.** WP 3.1 shipped a default
  `DATA_PACK_URL` naming a GitHub *release asset*. The fetcher resolves every pack file relative to
  the manifest and the manifest lists nested paths, while a release serves a flat set of assets
  whose name is one path segment — so the manifest would have been fetched and all 28 files under it
  would have 404'd. Measured against a repository that actually has releases, and against this one.
  The pack is therefore published as a **directory** served from the repository, the default URL was
  corrected, and a guard now bans a flat release-asset address (WP 3.3).
- **`.dockerignore` was corrected, but not the way the work package asked.** It still excluded
  `research/` and `roadmap/` — two trees that no longer exist — and did not mention `planning/`. The
  spec said to exclude `planning/`; that would have **broken the image build**, because
  `pnpm build:data-pack`'s sibling `pnpm docs:bundle` reads `planning/user-guide/` to generate the
  in-app manual. Measured, not reasoned: a probe image with a blanket exclusion dies with
  `build-docs-bundle: user guide directory not found`. The exclusion shipped is the bundle minus
  that one subtree.
- **The publish script verifies with the app's own verifier**, which the plan did not ask for. A
  sealer knows a pack is internally consistent; it does not know whether a running container would
  accept it, and publishing a pack the fleet refuses is the failure this item exists to prevent.

### Deliberately left out

- **No content constraint on user-visible pack text.** A pack's security rule titles and rationales
  are rendered verbatim to an operator and are validated for length only. Whoever publishes
  reference data is trusted with what it says — today the owner, from their own repository, which is
  the same trust boundary as the image. Recorded as a property of the design; the condition that
  reopens it is a pack accepted from a publisher the operator does not control.
- **No per-request pack isolation.** A consumer calling the resolver twice inside one operation,
  straddling the boot-time swap, could see two packs. The exposure is the seconds after boot, since
  there is no manual trigger and no periodic re-check.
- **No manual "check now" trigger and no scheduled re-check.** The check runs at startup only.

### Where the code lives

- `data-pack/` — the authored pack, its schemas, and `build/` (the sealer behind `pnpm build:data-pack`)
- `apps/api/src/data-pack/` — loader, resolver, verifier, fetcher, the boot seam, routes, the D-DP8
  stamp, and `verify-cli.ts` (the publish-time verifier)
- `packages/shared/src/data-pack.ts` — the contract: manifest shape, refusal vocabulary, URL
  resolution, version ordering, the security-registry checks
- `scripts/publish-data-pack.sh` — seal → drift check → bump → stage → verify → archive → publish
- `apps/api/src/config/env.ts` — `DATA_PACK_URL` / `DATA_PACK_CHECK_ON_START` / `DATA_PACK_TIMEOUT_MS`

## Delivered increments

No delivered increments have been recorded yet.
