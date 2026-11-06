#!/usr/bin/env bash
# PreToolUse: reject a nonconformant write inside planning/.
# A path outside the bundle root exits 0 — okf.py only judges what it governs.
exec python3 "${CLAUDE_PROJECT_DIR:-$(pwd)}/planning/.claude/scripts/okf.py" \
  --root "${CLAUDE_PROJECT_DIR:-$(pwd)}/planning" hook-pre
