---
type: "Work Package Spec"
title: "WP 3.3 — publishing a pack, the docs, the .dockerignore correction, and offline verification"
description: "Phase 3 of item.md. Ledger: STATUS.md. The refresh loop proved end to end, and the offline install proved still offline."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T18:41:00Z"
status: "final"
---
# WP 3.3 — publishing a pack, the docs, the `.dockerignore` correction, and offline verification

Phase 3 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). **Depends on WP 3.1, WP 3.2.**

## Scope

1. **The publish path.** A script (`scripts/publish-data-pack.sh`, sibling to `scripts/release.sh`)
   that runs `pnpm build:data-pack`, refuses to publish if the working tree is dirty or the drift test
   fails, bumps `packVersion`, and produces the release asset plus its checksum. Cutting the GitHub
   Release is **owner-gated**, exactly as `release.sh --publish` is — the script prepares, the owner
   publishes.

2. **`.dockerignore` correction.** It currently excludes `research/`, `roadmap/` and `docs/` — the first
   two no longer exist — and does **not** mention `planning/`, so the whole planning bundle (6.3 MB in
   RS-01 alone) is in the build context. Exclude `planning/` and drop the dead entries. Take care: the
   file already carries a comment explaining that `/data` is anchored so nested `data/` dirs survive;
   `data-pack/` **must** stay in the context, so verify the build still finds it after the edit.

3. **Docs.** A `planning/user-guide/DC-NN-*` subject via `/new-docu` covering: what the pack is, what is
   in it and what deliberately is not, how to edit and publish one, what each refusal means and what the
   app does about it, and the offline story. Update the README capability table and add a CHANGELOG
   entry **in the same commit as the last box** (front-page rule), verifying each claim against the
   running app or a passing test.

4. **Offline verification.** With the network unreachable: `docker compose up` boots, serves the bundled
   snapshot, Settings says so plainly, `pnpm mcp:self-scan` passes its budget, and the RM-19 hand-off
   bundle still runs on a machine with only Docker.

## Acceptance

- [ ] A pack published from this repo is picked up by a **restarted container** and its new values are
      visible in the app — a new model in the heatmap picker and a new injection phrase firing on a
      poisoned fixture — with **no image rebuild**. This is the end-to-end proof the whole item exists for.
- [ ] Build context shrinks measurably after the `.dockerignore` fix, and `data-pack/` is still present
      in the build (a build that silently lost the pack would be the exact failure this WP must not ship).
- [ ] Offline: boots, serves bundled, says so, self-scan passes.
- [ ] The DC subject exists, README + CHANGELOG updated in the same commit as the final tick.
- [ ] `okf:validate` and `okf:sync` clean; gate green.

## Explicitly not claimed

Publishing has never been exercised from this repository, and `scripts/release.sh --publish` has never
been run either (recorded in RM-19). If the publish step is prepared but not executed, say that in the
ledger line rather than implying a released pack exists.
