---
type: "Roadmap Item"
title: "Reference data pack"
description: "Move every ageing external fact and judgement table the app validates servers and skills against — model windows/pricing/tool caps, MCP protocol + client/host limits, the compatibility test catalog, the security rule registry and its signature lists, advisor and quality thresholds — out of compiled source into one top-level, versioned, schema-validated data-pack/ folder; ship a snapshot inside the image and let every installed container refresh it from this repo at startup, verified by checksum, schema version and an append-only security rule-id ledger."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T18:15:37Z"
status: "planned"
---

# Reference data pack

## Goal

Move every ageing external fact and judgement table the app validates servers and skills against — model windows/pricing/tool caps, MCP protocol + client/host limits, the compatibility test catalog, the security rule registry and its signature lists, advisor and quality thresholds — out of compiled source into one top-level, versioned, schema-validated data-pack/ folder; ship a snapshot inside the image and let every installed container refresh it from this repo at startup, verified by checksum, schema version and an append-only security rule-id ledger.

## Why it matters

Today a price change, a new model, a newly seen prompt-injection payload or a re-tuned threshold each require a code edit, the full quality gate, an image rebuild and a re-deploy of every install. The facts age on the vendors' schedule, not ours, so an installed container is wrong the moment a provider ships. A pack that is data — not code — lets the bench stay accurate without a release, while the verification gate keeps a remotely fetched file from silently changing a security verdict or a CI gate outcome.

## Milestones

- [ ] WP 1.1 — data-pack/ folder, manifest + JSON schemas, shared contract; RS-01 model data and the build script moved, drift test green, no behaviour change
- [ ] WP 1.2 — pack loader + install-at-boot resolver seam; compatibility dataset/catalog read the resolved pack; snapshot copy replaces copy-data.mjs
- [ ] WP 2.1 — security rules, id ledger and every signature list (injection phrases, verb/term lists, secret + OAuth-scope + allowed-tools patterns) migrated into the pack
- [ ] WP 2.2 — advisor and quality thresholds plus the model merge chains migrated; only the unsafe-if-missing fallbacks stay in code
- [ ] WP 3.1 — startup fetcher, verifier and DATA_DIR cache with atomic swap; every refusal proved by a mutation probe
- [ ] WP 3.2 — GET/POST /api/data-pack, Settings row, diagnostics group, pack version stamped into security, advisor, compatibility and CI gate documents
- [ ] WP 3.3 — publish path (release asset + checksum), docs, .dockerignore corrected, offline bundle verified with the network unreachable

## Linked research

- [RS-01](/Research/RS-01-token-context-comparison/topic.md)
