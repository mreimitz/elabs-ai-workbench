#!/usr/bin/env bash
# PostToolUse: validate the whole planning bundle after a write.
python3 "${CLAUDE_PROJECT_DIR:-$(pwd)}/planning/.claude/scripts/okf.py" \
  --root "${CLAUDE_PROJECT_DIR:-$(pwd)}/planning" validate || exit 2
