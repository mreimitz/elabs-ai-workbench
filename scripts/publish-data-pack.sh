#!/usr/bin/env bash
#
# publish-data-pack.sh — seal, verify and stage a reference data pack for publication (RM-38 WP 3.3).
#
# Sibling of scripts/release.sh, and deliberately the same shape: it PREPARES an artifact, prints
# what the owner would run next, and only touches a remote when explicitly asked with --publish.
#
# WHAT A "PUBLISHED PACK" ACTUALLY IS
#   A DIRECTORY, not a release asset. The fetcher resolves every pack file relative to the manifest
#   URL, and the manifest lists nested paths (models/saas/openai.json, security/rules.json, …).
#   A GitHub release serves a flat set of assets whose name is one path segment, so a release asset
#   can host the manifest and none of the 25 files under it. The publish target is therefore this
#   repository's own data-pack/ tree, served by raw.githubusercontent.com — which is what
#   apps/api/src/config/env.ts now names as the default DATA_PACK_URL.
#
#   Consequence, and it is the useful one: PUBLISHING IS A COMMIT. Push a bumped pack to the publish
#   branch and every install picks it up on its next restart. Push a pack EDIT without a version
#   bump and nothing happens at all — every container answers `up_to_date` and never downloads it.
#   The version bump is the go-live switch, not the push.
#
# WHAT THIS SCRIPT PRODUCES
#   dist/data-pack/v<packVersion>/
#   ├── manifest.json + the pack tree      exactly what a static host must serve
#   ├── data-pack-v<packVersion>.tar.gz    the same tree, for archival / an air-gapped hand-off
#   └── SHA256SUMS.txt                     over every staged file
#
# Usage:
#   scripts/publish-data-pack.sh [options]
#
# Options:
#   --bump patch|minor|major   Bump data-pack/package.json's version, then re-seal
#   --version X.Y.Z            Set an exact packVersion, then re-seal
#   --allow-dirty              Stage from a dirty tree (a REHEARSAL — refuses --publish)
#   --no-verify                Skip the app's own verifier (not recommended; say why)
#   --publish                  Owner-gated: commit the sealed pack and push it to the publish branch
#   --remote NAME              Git remote for --publish (default: origin)
#   --branch NAME              Publish branch for --publish (default: main)
#   -h, --help                 Show this help
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

PACK_DIR="$ROOT_DIR/data-pack"
BUMP=""
EXPLICIT_VERSION=""
ALLOW_DIRTY=0
RUN_VERIFY=1
PUBLISH=0
REMOTE="origin"
BRANCH="main"

c_reset=$'\033[0m'; c_cyan=$'\033[1;36m'; c_green=$'\033[1;32m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'
step() { printf '%s▸ %s%s\n' "$c_cyan" "$*" "$c_reset"; }
ok()   { printf '%s✓ %s%s\n' "$c_green" "$*" "$c_reset"; }
warn() { printf '%s! %s%s\n' "$c_yellow" "$*" "$c_reset"; }
die()  { printf '%s✗ %s%s\n' "$c_red" "$*" "$c_reset" >&2; exit 1; }

usage() { sed -n '2,41p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --bump)        BUMP="${2:-}"; shift 2 ;;
    --version)     EXPLICIT_VERSION="${2:-}"; shift 2 ;;
    --remote)      REMOTE="${2:-}"; shift 2 ;;
    --branch)      BRANCH="${2:-}"; shift 2 ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --no-verify)   RUN_VERIFY=0; shift ;;
    --publish)     PUBLISH=1; shift ;;
    -h|--help)     usage ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

[ -d "$PACK_DIR" ] || die "data-pack/ not found at $PACK_DIR — run this from the repository."
command -v pnpm >/dev/null 2>&1 || die "pnpm not found."
if [ -n "$BUMP" ] && [ -n "$EXPLICIT_VERSION" ]; then
  die "--bump and --version are mutually exclusive; pick one."
fi
case "${BUMP:-none}" in patch|minor|major|none) ;; *) die "--bump must be patch, minor or major." ;; esac
if [ -n "$EXPLICIT_VERSION" ] && ! printf '%s' "$EXPLICIT_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  die "--version must be a semver core, e.g. 1.2.0."
fi
if [ "$ALLOW_DIRTY" = 1 ] && [ "$PUBLISH" = 1 ]; then
  die "--allow-dirty cannot be combined with --publish: a published pack must be reproducible from a commit."
fi

# ------------------------------------------------------------------------------------------------
# 1. The tree must be clean.
#
# Not fussiness. The published pack is served FROM A COMMIT, so an uncommitted edit means the bytes
# staged here and the bytes the world would fetch are different files, and nothing downstream would
# ever tell you. --allow-dirty exists for a rehearsal and disables --publish for exactly this reason.
# ------------------------------------------------------------------------------------------------
step "Checking the working tree…"
DIRT="$(git status --porcelain)"
if [ -n "$DIRT" ]; then
  if [ "$ALLOW_DIRTY" = 1 ]; then
    warn "Working tree is dirty and --allow-dirty was passed — this is a REHEARSAL."
    warn "The staged artifact will NOT match any commit. Do not serve it as a release."
  else
    printf '%s\n' "$DIRT" | head -20
    die "Working tree is not clean. Commit or stash first (or pass --allow-dirty to stage a rehearsal)."
  fi
else
  ok "Working tree clean at $(git rev-parse --short HEAD)"
fi

# ------------------------------------------------------------------------------------------------
# 2. Re-seal, and refuse if that changes anything — THE DRIFT CHECK.
#
# `pnpm build:data-pack` is deterministic by construction (sorted file list, digests from disk,
# `asOf` derived from the sources rather than the clock). So on a committed pack it must be a no-op.
# If it is not, the committed manifest or a committed generated file does not match the pack sources
# it claims to describe, and publishing would ship a manifest nobody can reproduce.
# ------------------------------------------------------------------------------------------------
step "Re-sealing the pack (pnpm build:data-pack) — this must be a no-op…"
pnpm build:data-pack >/dev/null || die "pnpm build:data-pack failed."
DRIFT="$(git status --porcelain -- data-pack packages/shared/src)"
if [ -n "$DRIFT" ]; then
  if [ "$ALLOW_DIRTY" = 1 ]; then
    warn "Re-seal changed files, but the tree was already dirty so drift cannot be distinguished from your edits:"
    printf '%s\n' "$DRIFT"
  else
    printf '%s\n' "$DRIFT"
    die "DRIFT: the committed pack does not reproduce from its own sources. Commit the re-seal, then retry."
  fi
else
  ok "No drift — the committed pack reproduces exactly"
fi

# ------------------------------------------------------------------------------------------------
# 3. Version.
#
# packVersion lives in data-pack/package.json and is stamped into the manifest by the build, so a
# bump is one edit plus one re-seal. Nothing else in the repository carries it.
# ------------------------------------------------------------------------------------------------
CURRENT_VERSION="$(node -p "require('$PACK_DIR/package.json').version")"
NEW_VERSION="$CURRENT_VERSION"
if [ -n "$EXPLICIT_VERSION" ]; then
  NEW_VERSION="$EXPLICIT_VERSION"
elif [ -n "$BUMP" ]; then
  NEW_VERSION="$(node -e '
    const [cur, kind] = process.argv.slice(1);
    const [a, b, c] = cur.split(".").map(Number);
    const next = kind === "major" ? [a + 1, 0, 0] : kind === "minor" ? [a, b + 1, 0] : [a, b, c + 1];
    process.stdout.write(next.join("."));
  ' "$CURRENT_VERSION" "$BUMP")"
fi

if [ "$NEW_VERSION" != "$CURRENT_VERSION" ]; then
  step "Bumping packVersion $CURRENT_VERSION → $NEW_VERSION and re-sealing…"
  node -e '
    const { readFileSync, writeFileSync } = require("node:fs");
    const [file, version] = process.argv.slice(1);
    const raw = readFileSync(file, "utf8");
    // A targeted replacement of the version LINE, not a JSON round trip: re-serializing would
    // reformat a hand-maintained manifest and put unrelated noise in the publish commit.
    const next = raw.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${version}"`);
    if (next === raw) throw new Error(`could not rewrite the version in ${file}`);
    writeFileSync(file, next);
  ' "$PACK_DIR/package.json" "$NEW_VERSION"
  pnpm build:data-pack >/dev/null || die "pnpm build:data-pack failed after the version bump."
  ok "packVersion is now $NEW_VERSION (uncommitted — review the diff before publishing)"
else
  ok "packVersion stays $CURRENT_VERSION (pass --bump to make this pack go live)"
fi

MANIFEST_VERSION="$(node -p "require('$PACK_DIR/manifest.json').packVersion")"
[ "$MANIFEST_VERSION" = "$NEW_VERSION" ] || die "manifest.json says $MANIFEST_VERSION but package.json says $NEW_VERSION."

# ------------------------------------------------------------------------------------------------
# 4. Stage the served tree.
#
# Copied from the manifest's OWN file list rather than by globbing the directory, so the staged tree
# is exactly what the manifest claims and cannot pick up a stray file the pack does not declare.
# ------------------------------------------------------------------------------------------------
OUT_DIR="$ROOT_DIR/dist/data-pack/v$NEW_VERSION"
step "Staging the served tree → ${OUT_DIR#$ROOT_DIR/}"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp "$PACK_DIR/manifest.json" "$OUT_DIR/manifest.json"
FILE_COUNT="$(node -e '
  const { copyFileSync, mkdirSync, readFileSync } = require("node:fs");
  const path = require("node:path");
  const [packDir, outDir] = process.argv.slice(1);
  const manifest = JSON.parse(readFileSync(path.join(packDir, "manifest.json"), "utf8"));
  for (const entry of manifest.files) {
    const from = path.join(packDir, ...entry.path.split("/"));
    const to = path.join(outDir, ...entry.path.split("/"));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  process.stdout.write(String(manifest.files.length));
' "$PACK_DIR" "$OUT_DIR")"
ok "Staged $FILE_COUNT pack files + manifest.json"

# ------------------------------------------------------------------------------------------------
# 5. Verify the STAGED tree with the app's own verifier.
#
# Not the sealer's word for it. `verifyCandidatePack` is the same function every install runs on a
# fetched pack — digests, JSON Schemas, the D-DP9 regex compilation, the D-DP6 rule-id ledger and
# the D-DP7 severity rule. If it refuses here, publishing would ship a pack the whole fleet refuses.
# ------------------------------------------------------------------------------------------------
if [ "$RUN_VERIFY" = 1 ]; then
  step "Verifying the staged pack with the app's own verifier…"
  pnpm --filter @mcp-token-footprint/shared build >/dev/null \
    || die "could not build packages/shared (the verifier imports it)."

  # THE BASELINE IS THE COMMITTED PACK, NOT THE WORKING TREE.
  #
  # Two of the verifier's checks are comparisons — the D-DP6 rule-id ledger and the version
  # ordering — and comparing the staged pack against the tree it was just sealed from makes both
  # vacuous: a pack always has the same rule ids as itself and is never newer than itself. The pack
  # AT HEAD is what the last image was built from, so it is what an installed container is actually
  # running, which is the only comparison that answers "would the fleet take this?".
  BASELINE_DIR="$(mktemp -d)"
  trap 'rm -rf "$BASELINE_DIR"' EXIT
  if git archive HEAD data-pack 2>/dev/null | tar -x -C "$BASELINE_DIR"; then
    pnpm --silent --filter @mcp-token-footprint/api exec tsx src/data-pack/verify-cli.ts \
      "$OUT_DIR" --baseline "$BASELINE_DIR/data-pack" \
      || die "the staged pack was refused by the app's own verifier — see above."
  else
    warn "HEAD carries no data-pack/ — verifying structure only, with no baseline to compare against."
    pnpm --silent --filter @mcp-token-footprint/api exec tsx src/data-pack/verify-cli.ts "$OUT_DIR" \
      || die "the staged pack was refused by the app's own verifier — see above."
  fi
else
  warn "Verification skipped (--no-verify): nothing has checked that an install would accept this pack."
fi

# ------------------------------------------------------------------------------------------------
# 6. Archive + checksums.
# ------------------------------------------------------------------------------------------------
TARBALL="data-pack-v$NEW_VERSION.tar.gz"
step "Archiving → $TARBALL + SHA256SUMS.txt"
tar -czf "$ROOT_DIR/dist/data-pack/$TARBALL" -C "$OUT_DIR" .
mv "$ROOT_DIR/dist/data-pack/$TARBALL" "$OUT_DIR/$TARBALL"
( cd "$OUT_DIR" && find . -type f ! -name SHA256SUMS.txt | sort | xargs shasum -a 256 > SHA256SUMS.txt )
ok "Archive + checksums written"

# ------------------------------------------------------------------------------------------------
# 7. Publish (owner-gated).
# ------------------------------------------------------------------------------------------------
PUBLISH_URL="https://raw.githubusercontent.com/mreimitz/elabs-ai-workbench/$BRANCH/data-pack/manifest.json"
if [ "$PUBLISH" = 1 ]; then
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  [ "$CURRENT_BRANCH" = "$BRANCH" ] || die "--publish must run on $BRANCH (currently on $CURRENT_BRANCH)."
  step "Committing the sealed pack and pushing to $REMOTE/$BRANCH…"
  git add -- data-pack packages/shared/src
  if git diff --cached --quiet; then
    warn "Nothing to commit — the pack is already committed at this version."
  else
    git commit -m "data-pack: publish $NEW_VERSION" || die "commit failed."
  fi
  git push "$REMOTE" "$BRANCH" || die "push failed."
  ok "Published — installs will pick $NEW_VERSION up on their next restart"
fi

# ------------------------------------------------------------------------------------------------
printf '\n%s══ Data pack v%s ══%s\n' "$c_green" "$NEW_VERSION" "$c_reset"
printf '  Staged tree     %s/\n' "${OUT_DIR#$ROOT_DIR/}"
printf '  Serve it as     %s\n' "$PUBLISH_URL"
printf '  Files           %s + manifest.json\n' "$FILE_COUNT"
if [ "$PUBLISH" = 0 ]; then
  printf '\n  Not published. To go live, the owner runs:\n'
  printf '    git add data-pack packages/shared/src && git commit -m "data-pack: publish %s"\n' "$NEW_VERSION"
  printf '    git push %s %s\n' "$REMOTE" "$BRANCH"
  printf '  (or re-run this script with --publish, from %s, on a clean tree)\n' "$BRANCH"
fi
printf '\n  Rehearse against a running container without publishing anything:\n'
printf '    python3 -m http.server 8141 --directory %s\n' "${OUT_DIR#$ROOT_DIR/}"
printf '    DATA_PACK_URL=http://host.docker.internal:8141/manifest.json  (then restart the container)\n\n'
