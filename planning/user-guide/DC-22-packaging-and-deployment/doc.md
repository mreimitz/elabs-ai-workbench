---
type: "Documentation"
title: "Packaging & deployment"
description: "How the workbench is built, containerized and handed to someone who will run it."
tags: ["documentation", "DC-22"]
timestamp: "2026-08-21T15:42:04Z"
status: "current"
---

# Packaging & deployment

## Subject

How the workbench is built, containerized and handed to someone who will run it.

## Scope

**In:** The Docker image, compose, environment configuration and the offline delivery bundle.

**Out:** Continuous-integration gates, which are their own subject.

## Where the code lives

- `Dockerfile`
- `docker-compose.yml`
- `scripts/`

## Delivered increments

### RM-19 — Release & delivery — the offline hand-off bundle

Completed 2026-08-21. Roadmap item: [RM-19](/Roadmap/completed/RM-19-release/item.md).

**Shipped:** An offline hand-off bundle so someone with only Docker Desktop - no repository access, no container registry - can run the workbench. scripts/release.sh resolves the version from package.json, runs the quality gate on the host first (so a failure is cheap rather than arriving after the slow image build), cross-builds the image, saves and gzips it, writes checksums and assembles dist/release/v<version>/ holding the image tarball, run.sh, run.ps1, a recipient-facing README.md and SHA256SUMS.txt. scripts/release/ holds the recipient-facing files, copied verbatim into every bundle. The launcher checks Docker is running, verifies the checksums, docker loads the image, replaces any previous container while KEEPING its data volume, probes upward from port 8080 for a free port and reports which it chose, waits for /api/health and opens the browser; PORT= overrides the starting point. Data persists in the named volume mcp-token-footprint-data, so re-running with a newer bundle is an upgrade, not a reset. The image is cross-built to linux/amd64 by default (the build host is Apple Silicon, most recipients are not) with --platform to override, and is built from committed HEAD with a warning on a dirty tree. No secrets ship: .dockerignore excludes .env*, data/ and .git, so each install generates its own mcp-secret.key in its own volume on first boot. Reachable as scripts/release.sh or the /release slash command, where no argument builds the bundle only and 'publish' also cuts the git tag plus GitHub Release.

**Planned vs delivered:** This item never had a STATUS.md ledger and was never driven through /next-wp - it is a retro stub whose three milestones (define the bundle format, build the image and launchers, verify a cold start on a clean machine) were written after the code already existed. It was retired on 2026-08-21 by RM-35 WP 4.3 using --no-ledger, which is the sanctioned path for an item that never had a ledger, not a waiver past an open box. The optional GHCR pull path described in the plan was deliberately NOT implemented; the offline bundle stays the only delivery path because it needs nothing but Docker Desktop.

**Known gaps:** MILESTONE 3 - 'verify a cold start on a clean machine' - HAS NOT BEEN DONE, and is the one thing this item most needed. Nothing here has been run end to end: the bundle has not been built by this session, no bundle has been handed to a recipient, and no launcher has been executed on a clean machine that lacks the repository. What was verified on 2026-08-21 is narrower and should not be mistaken for the milestone: both shell scripts parse (bash -n), and the launcher's source genuinely contains the checksum verification, the docker load, the free-port probe, the health wait and the named-volume reuse that the documentation claims. run.ps1 was NOT syntax-checked (no PowerShell on the build host) and has never been executed on Windows, which is the platform most recipients are on. The GitHub Release path (--publish) has never been exercised either.

**Where the code lives:**

- `scripts/release.sh and scripts/release/{run.sh,run.ps1,README.md}; the /release slash command at .claude/commands/release.md`
