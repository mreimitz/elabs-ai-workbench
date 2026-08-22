---
type: "Research Output"
title: "07 — Where the shipped dataset lives now: data-pack/"
description: "Pointer note: the per-provider model files, the cross-cutting limits and the compatibility test catalog moved out of this topic into the repository-root data-pack/ (RM-38 WP 1.1)."
tags: ["research", "RS-01", "RM-38"]
timestamp: "2026-08-22T20:55:00Z"
status: "final"
---
# 07 — Where the shipped dataset lives now: `data-pack/`

> The **research finding** stays here. The **shipped file** does not.

## What moved, and where to

On 2026-08-22, [RM-38](/Roadmap/RM-38-reference-data-pack/item.md) WP 1.1 relocated every file in
this topic that the running application reads into a single top-level, versioned, schema-validated
`data-pack/` folder at the repository root:

| Was, in this topic | Is now |
| --- | --- |
| `outputs/data/saas/*.json` | `data-pack/models/saas/*.json` |
| `outputs/data/open-weight/*.json` | `data-pack/models/open-weight/*.json` |
| `outputs/data/cross-cutting-limits.json` | `data-pack/limits/cross-cutting.json` |
| `outputs/tests/test-catalog.json` | `data-pack/compatibility/test-catalog.json` |
| `outputs/schema/model-entry.schema.json` | `data-pack/schema/model-entry.schema.json` |
| `outputs/tests/test-catalog.schema.json` | `data-pack/schema/test-catalog.schema.json` |

Every one of them moved with `git mv`, so `git log --follow` still reaches the research history that
produced them. The build that merges them (`build.ts` / `build-cli.ts`) moved with them, from
`apps/api/src/compatibility/` to `data-pack/build/`, and its entry point is now
**`pnpm build:data-pack`** (`pnpm build:model-data` still works and prints a deprecation line).

`data-pack/` additionally carries a generated `manifest.json` — `packVersion`, `schemaVersion`,
`asOf`, and a SHA-256 per shipped file — plus two schemas this topic never had:
`manifest.schema.json` and `cross-cutting.schema.json`.

## Why the move

The facts in those files age on the vendors' schedule, not ours. While they lived inside a research
topic, changing a price or adding a model meant a code edit, a full quality gate, an image rebuild
and a redeploy of every install. RM-38 makes the pack **data rather than code**, so an installed
container can refresh it — verified by checksum, schema version and an append-only rule-id ledger —
without a release. Keeping a second copy inside `Research/` would defeat that, so this note replaces
the files rather than sitting beside them (locked decision **D-DP1**: one folder, one source of
truth).

## What stayed here, and is still authoritative

- Every note under `notes/`, including the per-provider working notes the entries were built from,
  and `notes/02-mcp-limits-taxonomy.md`, which is where the cross-cutting limits' *meaning* is
  argued.
- `outputs/03-compatibility-test-suite.md`, `05-test-execution-modes.md` and
  `06-impact-and-model-severity.md` — the reasoning the test catalog is a machine-readable
  projection of.
- `outputs/comparison/` — the original Python reference build (`build_comparison.py`) and its QA
  reports. This is a **historical reference**, not a build step; its `all-models.json` is a separate
  artifact of that Python run and is not the file the application reads.
- `outputs/schema/template.provider.json` — the authoring template for a new provider file. It is a
  worked example rather than a schema, so it did not move; the schema it is an example *of* now
  lives at `data-pack/schema/model-entry.schema.json`.
- `outputs/tests/resolve_model_severity.py` — the reference severity resolver, ported to TypeScript
  in `apps/api/src/compatibility/resolve.ts`.

## How to change a fact now

Edit the file under `data-pack/models/**` (or `limits/`, or `compatibility/`), then run
`pnpm build:data-pack`. That regenerates `data-pack/generated/all-models.json`,
`packages/shared/src/model-data.generated.ts`, the compatibility engine's snapshot under
`apps/api/src/compatibility/data/`, and `manifest.json` with fresh digests. A stale artifact fails
`apps/api/test/compatibility-data.test.ts`, which rebuilds in memory and byte-compares; a file whose
bytes disagree with the manifest fails `apps/api/test/data-pack.test.ts`.

# Citations

None. This note records a relocation inside this repository; every claim above is a path in the
working tree, verifiable with `git log --follow`.
