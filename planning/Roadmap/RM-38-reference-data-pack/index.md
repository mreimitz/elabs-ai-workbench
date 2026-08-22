# Reference data pack

## Concepts

* [Reference data pack](item.md) - Move every ageing external fact and judgement table the app validates servers and skills against — model windows/pricing/tool caps, MCP protocol + client/host limits, the compatibility test catalog, the security rule registry and its signature lists, advisor and quality thresholds — out of compiled source into one top-level, versioned, schema-validated data-pack/ folder; ship a snapshot inside the image and let every installed container refresh it from this repo at startup, verified by checksum, schema version and an append-only security rule-id ledger.
* [Reference data pack — work-package status ledger · PRIORITY: HIGH](STATUS.md) - Living state for the reference-data-pack plan, read and updated by /next-wp reference-data-pack.
* [WP 1.1 — data-pack/: manifest, JSON Schemas, shared contract, and the model data moved in](wp-1.1-pack-contract.md) - Phase 1 of item.md. Ledger: STATUS.md. Mechanical relocation plus the pack contract — no behaviour change.
* [WP 1.2 — the pack loader and the install-at-boot resolver seam](wp-1.2-loader-seam.md) - Phase 1 of item.md. Ledger: STATUS.md. One loader, installed before every consumer; the compatibility engine reads the resolved pack.
* [WP 2.1 — the security rule registry, its frozen id ledger, and every signature list into the pack](wp-2.1-security-tables.md) - Phase 2 of item.md. Ledger: STATUS.md. The analyzers keep their logic and lose their literals.
* [WP 2.2 — advisor and quality thresholds, and the model merge chains, into the pack](wp-2.2-thresholds-and-model-chains.md) - Phase 2 of item.md. Ledger: STATUS.md. Only the unsafe-if-missing fallbacks stay compiled in.
* [WP 3.1 — the startup fetcher, the verifier, and the DATA_DIR cache](wp-3.1-fetch-and-verify.md) - Phase 3 of item.md. Ledger: STATUS.md. Boot never waits on the network and never fails on it.
* [WP 3.2 — the data-pack routes, the Settings row, diagnostics, and the version stamp on every verdict](wp-3.2-surfaces.md) - Phase 3 of item.md. Ledger: STATUS.md. A verdict that cannot name the data it was computed against is not reproducible.
* [WP 3.3 — publishing a pack, the docs, the .dockerignore correction, and offline verification](wp-3.3-publish-and-offline.md) - Phase 3 of item.md. Ledger: STATUS.md. The refresh loop proved end to end, and the offline install proved still offline.
