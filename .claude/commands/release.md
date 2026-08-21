---
description: Build a deliverable Docker image + offline run bundle, and (on request) cut a GitHub Release
argument-hint: "[publish] [version]   — e.g. (nothing) = local bundle · 'publish' = tag + GitHub Release"
allowed-tools: Bash(scripts/release.sh:*), Bash(node -p:*), Bash(gh release view:*), Bash(git rev-parse:*), Bash(git status:*), Bash(du -h:*)
---
Requested: **$ARGUMENTS**

Cut a release of MCP Token Footprint as a **self-contained offline bundle** — a saved Docker image
plus one-click `run.sh` / `run.ps1` launchers — that anyone with Docker Desktop can run **without
access to this repo or any registry**. The engine is [`scripts/release.sh`](../../scripts/release.sh);
recipient artifacts live in [`scripts/release/`](../../scripts/release/). Full concept:
[`planning/Roadmap/completed/RM-19-release/item.md`](../../planning/Roadmap/completed/RM-19-release/item.md).

## Decide the mode from `$ARGUMENTS`

- **No args (default) → local bundle only.** Build + package into `dist/release/v<version>/`. No git
  tag, no GitHub Release. This is the safe default — nothing outward-facing happens.
- **`publish` present → also cut the GitHub Release.** Runs the quality gate, builds, packages, then
  creates git tag `v<version>` + a GitHub Release with the assets attached. **This is outward-facing
  — confirm with the owner before running it** (state the version and that the repo is PRIVATE, so
  release assets are only reachable by people with repo access; outside recipients get the bundle
  handed to them directly).
- **A version token** (e.g. `0.3.0`) overrides the `package.json` version. If bumping, remind the
  owner to also update `package.json` `version`.

## Steps

1. **Confirm the version.** Default is `node -p "require('./package.json').version"` (currently
   `0.2.0`). Echo the resulting tag `v<version>` back before doing anything slow.
2. **Run the engine:**
   - Local bundle: `scripts/release.sh` (optionally `--version X.Y.Z`).
   - Publish: `scripts/release.sh --publish` (after explicit owner OK).
   - The script cross-builds for `linux/amd64` by default (broadest recipient support; this host is
     Apple Silicon). Pass `--platform linux/arm64` only if every recipient is on Apple Silicon.
   - `--no-gate` skips the typecheck/test/build gate (don't skip for a real publish); `--skip-build`
     reuses an already-built image for re-packaging.
3. **Report honestly** (per `.claude/rules/quality-gates.md`): the exact command run, whether the
   gate passed, the bundle path, the image-tarball size, and — for publish — the Release URL. The
   image build is slow (minutes, QEMU cross-build); say so rather than appearing hung.
4. **Tell the owner how to deliver:** hand the recipient the `*-docker-image.tar.gz` **plus** `run.sh`
   (macOS/Linux) or `run.ps1` (Windows) from the bundle; they drop both in one folder and run the
   launcher → app on `http://localhost:8080`.

## Guardrails

- **Never run `--publish` without explicit owner confirmation** — it creates a public-to-repo-members
  artifact and a git tag. The no-arg path is always safe to run.
- The engine refuses to publish if tag `v<version>` or the Release already exists — bump the version
  instead of clobbering.
- Do not weaken the secret/`.env` guardrails; the image is built from the committed tree at HEAD
  (uncommitted changes are **not** in it — the script warns when the tree is dirty).
