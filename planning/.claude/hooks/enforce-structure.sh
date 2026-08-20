#!/usr/bin/env bash
# PreToolUse wrapper for path policy and projected OKF document validation.

if ! command -v python3 >/dev/null 2>&1; then
  echo "BLOCKED: python3 is required for OKF validation." >&2
  exit 2
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
exec python3 "$DIR/../scripts/okf.py" --root "$ROOT" hook-pre
