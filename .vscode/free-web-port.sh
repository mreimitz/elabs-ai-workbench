#!/usr/bin/env bash
# =================================================================================================
# Free the Vite dev-server port — but ONLY for a server belonging to THIS workspace.
# =================================================================================================
# WHY THIS EXISTS. `dev web` in tasks.json is an `isBackground` task. VS Code does not stop a
# background task when the debug session ends, and on the next launch it RE-USES the still-running
# instance instead of starting a fresh one. So one Vite process can outlive dozens of debug
# sessions — and it did: a server started 2026-08-19 was still serving on 2026-08-21, two days and
# one dependency-graph change later.
#
# That is not merely untidy. Vite's Tailwind pass resolves `@import` once, at startup, and caches
# the result. `apps/web/src/styles/app.css` imports `@mcp-token-footprint/illustrations/tokens.css`,
# which did not exist as a linked dependency until RM-14 WP 0.1. A server predating that link
# resolved the import to nothing, DROPPED IT SILENTLY — no warning, no error — and served that
# stylesheet ever after. Without the `--illus-*` layer every `fill: var(--illus-…)` is invalid at
# computed-value time and falls back to the CSS initial value for `fill`, which is BLACK. The page
# renders perfectly laid out and completely black, and nothing in the terminal says why.
#
# The general rule the incident taught: a long-running dev server is NOT evidence about the tree it
# points at. Any change to the dependency graph or to the CSS import chain needs a fresh one.
#
# WHY IT IS NOT `lsof -ti tcp:5173 | xargs kill`. More than one checkout of this project can be open
# at once (worktrees, a sibling clone), and the first one to boot wins the port — so the process on
# 5173 is not necessarily ours. Killing it blind would reach into someone else's session. Every
# candidate is therefore matched on its working directory being inside THIS workspace before it is
# signalled, and anything else is reported and left alone.
#
# Usage: free-web-port.sh [port]   (default 5173, matching apps/web's `dev` script)
set -uo pipefail

PORT="${1:-5173}"
WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# `lsof` exits non-zero when nothing is listening, which is the ordinary case — not an error.
PIDS="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true)"

if [ -z "$PIDS" ]; then
  echo "port $PORT is free"
  exit 0
fi

killed=0
for pid in $PIDS; do
  # The process's own working directory, read from lsof's field output (`n` = name, here the path).
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"

  case "$cwd" in
    "$WORKSPACE"/* | "$WORKSPACE")
      echo "stopping this workspace's dev server on port $PORT (pid $pid, cwd $cwd)"
      kill "$pid" 2>/dev/null || true
      killed=$((killed + 1))
      ;;
    *)
      # Deliberately NOT killed: another checkout, another project, or something unrelated that
      # happens to hold the port. Vite will pick the next free port and say so in its banner.
      echo "leaving pid $pid alone — it is not this workspace's (cwd ${cwd:-unknown})" >&2
      ;;
  esac
done

[ "$killed" -eq 0 ] && exit 0

# Give the listener a moment to release the socket, so Vite does not fall through to 5174 and leave
# the launch profile's hardcoded URL pointing at nothing.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 || { echo "port $PORT released"; exit 0; }
  sleep 0.3
done

echo "port $PORT still held after 3s; Vite may start on a different port" >&2
exit 0
