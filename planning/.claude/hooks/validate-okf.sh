#!/usr/bin/env bash
# PostToolUse wrapper for full-bundle OKF validation.

if ! command -v python3 >/dev/null 2>&1; then
  echo "OKF validation failed: python3 is required." >&2
  exit 2
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
python3 "$DIR/../scripts/okf.py" --root "$ROOT" validate
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  exit 2
fi
