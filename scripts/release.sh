#!/usr/bin/env bash
#
# release.sh — cut a deliverable release of MCP Token Footprint.
#
# Produces a SELF-CONTAINED offline bundle you can hand to anyone with Docker Desktop —
# no access to this repository and no container-registry login required:
#
#   dist/release/v<version>/
#   ├── mcp-token-footprint-v<version>-docker-image.tar.gz   (the saved Docker image)
#   ├── run.sh                                                (macOS / Linux launcher)
#   ├── run.ps1                                               (Windows launcher)
#   ├── README.md                                            (recipient quickstart)
#   └── SHA256SUMS.txt                                        (integrity check)
#
# The recipient drops run.sh (or run.ps1) next to the .tar.gz and runs it — it `docker load`s
# the image and starts the container in Docker Desktop on http://localhost:8080.
#
# Optionally (--publish) it also creates a matching GitHub Release (tag v<version>) with those
# same files attached, as the owner's versioned artifact vault. NOTE: this repo is PRIVATE, so
# release assets are only downloadable by people who already have repo access — hand the offline
# bundle to outside recipients directly.
#
# Usage:
#   scripts/release.sh [options]
#
# Options:
#   --version X.Y.Z    Release version (default: version in package.json)
#   --publish          Also create the git tag + GitHub Release and upload the assets
#   --platform P       Target image platform (default: linux/amd64 — broadest recipient support)
#   --skip-build       Reuse an already-built local image tag instead of rebuilding
#   --no-gate          Skip the pre-flight quality gate (typecheck + test + build)
#   --notes-file PATH  Use PATH as the GitHub Release notes body (default: auto-generated)
#   -h, --help         Show this help
#
# Env overrides: RELEASE_PLATFORM, PORT (only used by the recipient launcher, not here).
#
set -euo pipefail

# --------------------------------------------------------------------------------------------
# Config / defaults
# --------------------------------------------------------------------------------------------
IMAGE_NAME="mcp-token-footprint"
PLATFORM="${RELEASE_PLATFORM:-linux/amd64}"
PUBLISH=0
SKIP_BUILD=0
RUN_GATE=1
VERSION=""
NOTES_FILE=""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# --------------------------------------------------------------------------------------------
# Pretty output
# --------------------------------------------------------------------------------------------
c_reset=$'\033[0m'; c_cyan=$'\033[1;36m'; c_green=$'\033[1;32m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'
step() { printf '%s▸ %s%s\n' "$c_cyan" "$*" "$c_reset"; }
ok()   { printf '%s✓ %s%s\n' "$c_green" "$*" "$c_reset"; }
warn() { printf '%s! %s%s\n' "$c_yellow" "$*" "$c_reset"; }
die()  { printf '%s✗ %s%s\n' "$c_red" "$*" "$c_reset" >&2; exit 1; }

usage() { sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

# --------------------------------------------------------------------------------------------
# Parse args
# --------------------------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --version)    VERSION="${2:-}"; shift 2 ;;
    --platform)   PLATFORM="${2:-}"; shift 2 ;;
    --notes-file) NOTES_FILE="${2:-}"; shift 2 ;;
    --publish)    PUBLISH=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-gate)    RUN_GATE=0; shift ;;
    -h|--help)    usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# --------------------------------------------------------------------------------------------
# Resolve version
# --------------------------------------------------------------------------------------------
if [ -z "$VERSION" ]; then
  VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
  [ -n "$VERSION" ] || die "Could not read version from package.json; pass --version X.Y.Z"
fi
TAG="v$VERSION"
IMAGE_REF="$IMAGE_NAME:$TAG"
REL_DIR="$ROOT_DIR/dist/release/$TAG"
TARBALL_NAME="$IMAGE_NAME-$TAG-docker-image.tar.gz"

printf '\n%s══ Release %s ══%s\n' "$c_cyan" "$TAG" "$c_reset"
printf '  image      %s\n' "$IMAGE_REF"
printf '  platform   %s\n' "$PLATFORM"
printf '  output     %s\n' "${REL_DIR#$ROOT_DIR/}"
printf '  publish    %s\n\n' "$([ "$PUBLISH" = 1 ] && echo 'yes (git tag + GitHub Release)' || echo 'no (offline bundle only)')"

# --------------------------------------------------------------------------------------------
# Pre-flight
# --------------------------------------------------------------------------------------------
step "Pre-flight checks…"
command -v docker >/dev/null 2>&1 || die "docker not found — install/start Docker Desktop."
docker info >/dev/null 2>&1 || die "Docker Desktop is not running — start it and retry."
docker buildx version >/dev/null 2>&1 || die "docker buildx unavailable — needed for --platform builds."

if [ "$PUBLISH" = 1 ]; then
  command -v gh >/dev/null 2>&1 || die "gh (GitHub CLI) not found — needed for --publish."
  gh auth status >/dev/null 2>&1 || die "gh is not authenticated — run 'gh auth login'."
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    die "Tag $TAG already exists. Bump --version or delete the tag first."
  fi
  if gh release view "$TAG" >/dev/null 2>&1; then
    die "A GitHub Release $TAG already exists. Bump --version or delete it first."
  fi
  if [ -n "$(git status --porcelain)" ]; then
    warn "Working tree is not clean — the release will be tagged at HEAD ($(git rev-parse --short HEAD)); uncommitted changes are NOT in the image."
  fi
fi
ok "Pre-flight OK"

# --------------------------------------------------------------------------------------------
# Quality gate (fast-fail on the host before the slow image build)
# --------------------------------------------------------------------------------------------
if [ "$RUN_GATE" = 1 ]; then
  step "Quality gate: pnpm typecheck && pnpm test && pnpm build …"
  pnpm typecheck && pnpm test && pnpm build || die "Quality gate failed — fix before releasing (or pass --no-gate to override)."
  ok "Quality gate green"
else
  warn "Quality gate skipped (--no-gate)."
fi

# --------------------------------------------------------------------------------------------
# Build the image
# --------------------------------------------------------------------------------------------
if [ "$SKIP_BUILD" = 1 ]; then
  docker image inspect "$IMAGE_REF" >/dev/null 2>&1 || die "--skip-build set but image $IMAGE_REF does not exist locally."
  ok "Reusing existing image $IMAGE_REF (--skip-build)"
else
  step "Building image $IMAGE_REF for $PLATFORM (cross-build via QEMU can take several minutes)…"
  docker buildx build \
    --platform "$PLATFORM" \
    --load \
    -t "$IMAGE_REF" \
    -t "$IMAGE_NAME:latest" \
    "$ROOT_DIR" \
    || die "docker build failed."
  ok "Built $IMAGE_REF"
fi

# --------------------------------------------------------------------------------------------
# Assemble the offline bundle
# --------------------------------------------------------------------------------------------
step "Assembling the offline bundle…"
rm -rf "$REL_DIR"
mkdir -p "$REL_DIR"

step "Saving image → $TARBALL_NAME (this is the big one; gzip takes a while)…"
docker save "$IMAGE_REF" | gzip > "$REL_DIR/$TARBALL_NAME"

cp "$SCRIPT_DIR/release/run.sh"  "$REL_DIR/run.sh"
cp "$SCRIPT_DIR/release/run.ps1" "$REL_DIR/run.ps1"
cp "$SCRIPT_DIR/release/README.md" "$REL_DIR/README.md"
chmod +x "$REL_DIR/run.sh"

step "Computing checksums…"
( cd "$REL_DIR" && shasum -a 256 "$TARBALL_NAME" run.sh run.ps1 README.md > SHA256SUMS.txt )

TARBALL_SIZE="$(du -h "$REL_DIR/$TARBALL_NAME" | cut -f1 | tr -d ' ')"
ok "Bundle ready in ${REL_DIR#$ROOT_DIR/}  (image tarball: $TARBALL_SIZE)"

# --------------------------------------------------------------------------------------------
# Publish (optional)
# --------------------------------------------------------------------------------------------
if [ "$PUBLISH" = 1 ]; then
  if [ -n "$NOTES_FILE" ]; then
    [ -f "$NOTES_FILE" ] || die "--notes-file $NOTES_FILE not found."
    NOTES_PATH="$NOTES_FILE"
  else
    NOTES_PATH="$REL_DIR/RELEASE_NOTES.md"
    cat > "$NOTES_PATH" <<EOF
# MCP Token Footprint $TAG

A self-contained Docker image of MCP Token Footprint, built from \`$(git rev-parse --short HEAD)\`
for \`$PLATFORM\`.

## Run it (Docker Desktop, no repo access needed)

1. Download **$TARBALL_NAME** and **run.sh** (macOS/Linux) or **run.ps1** (Windows) into the same folder.
2. macOS/Linux: \`chmod +x run.sh && ./run.sh\`  ·  Windows: right-click **run.ps1** → *Run with PowerShell*.
3. It loads the image and starts the app at **http://localhost:8080**. Data persists in the
   Docker volume \`mcp-token-footprint-data\`.

Verify integrity with \`shasum -a 256 -c SHA256SUMS.txt\` (macOS/Linux).

> This repository is private, so these assets are only downloadable by people with repo access.
> To share with someone **outside** the repo, hand them the files from the offline bundle directly.
EOF
  fi

  step "Creating GitHub Release $TAG and uploading assets…"
  gh release create "$TAG" \
    --target "$(git rev-parse HEAD)" \
    --title "MCP Token Footprint $TAG" \
    --notes-file "$NOTES_PATH" \
    "$REL_DIR/$TARBALL_NAME" \
    "$REL_DIR/run.sh" \
    "$REL_DIR/run.ps1" \
    "$REL_DIR/README.md" \
    "$REL_DIR/SHA256SUMS.txt" \
    || die "gh release create failed."
  ok "Published GitHub Release $TAG"
fi

# --------------------------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------------------------
printf '\n%s══ Done ══%s\n' "$c_green" "$c_reset"
printf '  Offline bundle:  %s\n' "${REL_DIR#$ROOT_DIR/}/"
printf '  Hand recipients: %s  +  run.sh (mac/Linux) or run.ps1 (Windows)\n' "$TARBALL_NAME"
if [ "$PUBLISH" = 1 ]; then
  printf '  GitHub Release:  %s\n' "$TAG"
else
  printf '  (offline only — re-run with --publish to also cut the GitHub Release)\n'
fi
printf '\n'
