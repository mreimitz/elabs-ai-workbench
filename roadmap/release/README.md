# Release & delivery concept

How MCP Token Footprint is packaged and handed to someone who has **no access to this repository**
and no container registry — just Docker Desktop. This is a small owner tool, not a phased plan.

## The problem

The app already ships as one Docker container (`Dockerfile`, `docker-compose.yml`). But
`docker compose up --build` needs the **source tree**. Recipients outside the repo can't build it,
and — because this repo is **private** — they can't pull a GitHub Release asset either. We need a
delivery format that carries the running app in a single file, plus a trivial way to start it.

## The shape

Two roles, one build:

1. **Offline bundle — the actual deliverable.** A directory (`dist/release/v<version>/`) containing:
   - `mcp-token-footprint-v<version>-docker-image.tar.gz` — the image via `docker save | gzip`.
   - `run.sh` (macOS/Linux) + `run.ps1` (Windows) — self-detecting launchers: check Docker,
     `docker load` the tarball, **auto-select a free host port** (prefer 8080, probe upward if
     taken), run it with a persistent named volume, wait for `/api/health`, open the browser.
   - `README.md` — recipient quickstart.
   - `SHA256SUMS.txt` — integrity check the launcher verifies.

   It is **registry-free and repo-free**: the recipient drops the launcher next to the `.tar.gz`,
   runs it, and gets `http://localhost:8080`. Hand it over by any file channel (AirDrop, share
   link, USB).

2. **GitHub Release — the owner's versioned artifact vault.** `--publish` creates git tag
   `v<version>` and a GitHub Release with the same files attached, as the canonical build record.
   Because the repo is private, **these assets are only downloadable by people with repo access** —
   so the Release is for provenance and for repo members, while outside recipients get the bundle
   directly.

## Entry points

- **`/release`** — slash command ([`.claude/commands/release.md`](../../.claude/commands/release.md)).
  No args = build the offline bundle only (safe, nothing outward-facing). `publish` = also cut the
  GitHub Release (owner-confirmed).
- **[`scripts/release.sh`](../../scripts/release.sh)** — the engine. Resolves the version from
  `package.json`, runs the quality gate, cross-builds the image, saves + gzips it, writes checksums,
  assembles the bundle, and optionally publishes. Flags: `--version`, `--publish`, `--platform`,
  `--skip-build`, `--no-gate`, `--notes-file`.
- **[`scripts/release/`](../../scripts/release/)** — the recipient-facing `run.sh`, `run.ps1`,
  `README.md`, copied verbatim into every bundle.

## Key decisions

- **Saved-image tarball, not a registry pull.** The delivery target explicitly lacks repo/registry
  access. `docker save`/`docker load` needs neither. (GHCR is noted as an optional path below.)
- **Cross-build to `linux/amd64` by default.** The build host is Apple Silicon (arm64), but most
  recipients are on Windows/Intel; amd64 runs everywhere Docker Desktop does (Apple Silicon
  emulates it). Override with `--platform linux/arm64` when every recipient is Apple Silicon.
- **Version = `package.json` `version`**, tag = `v<version>`. First release is `v0.2.0`.
- **Persistent named volume** `mcp-token-footprint-data` (mirrors compose) so a re-run/upgrade keeps
  the SQLite DB, generated secret key, and attachments. `--init` reaps the Assistant SDK's child
  processes (mirrors compose `init: true`).
- **Image built from committed HEAD.** Uncommitted changes aren't in it; the engine warns on a dirty
  tree. The quality gate runs on the host first to fail fast before the slow image build.
- **Secrets never shipped.** `.dockerignore` already excludes `.env*`, `data/`, `.git`. Each install
  generates its own `mcp-secret.key` in its volume on first boot.

## Optional: GHCR pull path (not implemented)

If a shareable `docker pull` URL is ever wanted, `scripts/release.sh` could gain a `--push ghcr`
that tags `ghcr.io/mreimitz/mcp-token-footprint:v<version>` and pushes it. The package would need to
be made **public** per-package (GHCR packages from a private repo default to private). The offline
bundle stays the primary path because it needs nothing but Docker Desktop.

## Try it

```bash
scripts/release.sh                 # build the offline bundle in dist/release/v0.2.0/
scripts/release.sh --publish       # + git tag v0.2.0 + GitHub Release (owner-gated)
```
