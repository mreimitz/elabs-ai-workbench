#!/usr/bin/env bash
# PreToolUse wrapper for path policy and projected OKF document validation.

if ! command -v python3 >/dev/null 2>&1; then
  echo "BLOCKED: python3 is required for OKF validation." >&2
  exit 2
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The bundle root is this script's own grandparent, so the hook works whether the bundle is
# opened as its own project or lives inside a larger repository.
ROOT="$(cd "$DIR/../.." && pwd)"
exec python3 "$DIR/../scripts/okf.py" --root "$ROOT" hook-pre
