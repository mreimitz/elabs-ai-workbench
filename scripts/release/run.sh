#!/usr/bin/env bash
#
# MCP Token Footprint — one-shot launcher for Docker Desktop (macOS / Linux).
#
# You do NOT need this project's source code or any registry login. Just:
#   1. Put this script in the SAME folder as the mcp-token-footprint-*-docker-image.tar.gz
#      you were given.
#   2. Make sure Docker Desktop is installed and running.
#   3. Run:   chmod +x run.sh && ./run.sh
#
# It loads the image and starts the app at http://localhost:8080. Your data is kept in a
# Docker volume ("mcp-token-footprint-data") and survives restarts and upgrades.
#
# To use a different port:   PORT=9090 ./run.sh
#
set -euo pipefail

CONTAINER_NAME="mcp-token-footprint"
VOLUME_NAME="mcp-token-footprint-data"
PORT="${PORT:-8080}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

c_reset=$'\033[0m'; c_cyan=$'\033[1;36m'; c_green=$'\033[1;32m'; c_yellow=$'\033[1;33m'; c_red=$'\033[1;31m'
say()  { printf '%s▸ %s%s\n' "$c_cyan" "$*" "$c_reset"; }
ok()   { printf '%s✓ %s%s\n' "$c_green" "$*" "$c_reset"; }
warn() { printf '%s! %s%s\n' "$c_yellow" "$*" "$c_reset"; }
die()  { printf '%s✗ %s%s\n' "$c_red" "$*" "$c_reset" >&2; exit 1; }

# Return 0 if something is already listening on port $1.
# Prefer lsof (accurate, checks for a LISTEN socket, no side effects); fall back to a bash
# /dev/tcp connect probe when lsof is unavailable. Either way, a wrong answer is backstopped by
# the docker-run "port already allocated" retry loop below.
port_in_use() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    return 1
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then return 0; fi
  return 1
}
# Echo the first free port at or after $1 (scans a 50-port window); non-zero exit if none free.
find_free_port() {
  local start="$1" p
  for p in $(seq "$start" $((start + 50))); do
    if ! port_in_use "$p"; then printf '%s\n' "$p"; return 0; fi
  done
  return 1
}

# 1. Docker present & running -----------------------------------------------------------------
command -v docker >/dev/null 2>&1 \
  || die "Docker is not installed. Get Docker Desktop from https://www.docker.com/products/docker-desktop/ , start it, then re-run this."
docker info >/dev/null 2>&1 \
  || die "Docker Desktop is installed but not running. Open it, wait until it says 'running', then re-run this."

# 2. Locate the image tarball next to this script ---------------------------------------------
IMAGE_TARBALL="$(ls -1 "$SCRIPT_DIR"/mcp-token-footprint-*-docker-image.tar.gz 2>/dev/null | head -1 || true)"
[ -n "$IMAGE_TARBALL" ] || IMAGE_TARBALL="$(ls -1 "$SCRIPT_DIR"/mcp-token-footprint-*-docker-image.tar 2>/dev/null | head -1 || true)"
[ -n "$IMAGE_TARBALL" ] \
  || die "No image file found next to this script. Expected something like 'mcp-token-footprint-v0.2.0-docker-image.tar.gz' in: $SCRIPT_DIR"
ok "Found image file: $(basename "$IMAGE_TARBALL")"

# 3. Optional integrity check -----------------------------------------------------------------
if [ -f "$SCRIPT_DIR/SHA256SUMS.txt" ] && command -v shasum >/dev/null 2>&1; then
  say "Verifying checksum…"
  if ( cd "$SCRIPT_DIR" && shasum -a 256 -c SHA256SUMS.txt --ignore-missing >/dev/null 2>&1 ); then
    ok "Checksum verified"
  else
    warn "Checksum did not verify — the file may be corrupted or altered. Continuing anyway."
  fi
fi

# 4. Load the image ---------------------------------------------------------------------------
say "Loading the image into Docker (first time can take a minute)…"
LOAD_OUT="$(docker load -i "$IMAGE_TARBALL")"
IMAGE_REF="$(printf '%s\n' "$LOAD_OUT" | sed -n 's/^Loaded image: //p' | head -1)"
[ -n "$IMAGE_REF" ] || IMAGE_REF="$(printf '%s\n' "$LOAD_OUT" | sed -n 's/^Loaded image ID: //p' | head -1)"
[ -n "$IMAGE_REF" ] || die "Could not determine the loaded image reference from:\n$LOAD_OUT"
ok "Loaded $IMAGE_REF"

# 5. Replace any existing container (the data volume is kept) ----------------------------------
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  say "Replacing the existing '$CONTAINER_NAME' container (your data volume is kept)…"
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

# 6. Pick a free host port (starting from the requested one) and run --------------------------
DESIRED_PORT="$PORT"
PORT="$(find_free_port "$DESIRED_PORT")" \
  || die "No free port found in ${DESIRED_PORT}..$((DESIRED_PORT + 50)). Free one up and retry."
[ "$PORT" = "$DESIRED_PORT" ] || warn "Port $DESIRED_PORT is in use — using the next free port: $PORT"

say "Starting the container on port $PORT…"
attempt=0
while :; do
  if docker run -d \
        --name "$CONTAINER_NAME" \
        --init \
        --restart unless-stopped \
        -p "${PORT}:8080" \
        -v "${VOLUME_NAME}:/data" \
        "$IMAGE_REF" >/dev/null 2>"$SCRIPT_DIR/.run_err"; then
    break
  fi
  # A port can be grabbed between the probe and the run — advance and retry a few times.
  if grep -qiE 'port is already allocated|address already in use|bind for' "$SCRIPT_DIR/.run_err" && [ "$attempt" -lt 10 ]; then
    attempt=$((attempt + 1))
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    NEXT="$(find_free_port "$((PORT + 1))")" \
      || { rm -f "$SCRIPT_DIR/.run_err"; die "No free port available."; }
    warn "Port $PORT was taken — retrying on $NEXT…"
    PORT="$NEXT"
    continue
  fi
  cat "$SCRIPT_DIR/.run_err" >&2; rm -f "$SCRIPT_DIR/.run_err"
  die "Failed to start the container."
done
rm -f "$SCRIPT_DIR/.run_err"

# 7. Wait for health --------------------------------------------------------------------------
URL="http://localhost:${PORT}"
if command -v curl >/dev/null 2>&1; then
  say "Waiting for the app to become healthy…"
  for _ in $(seq 1 45); do
    if curl -fsS "${URL}/api/health" >/dev/null 2>&1; then ok "App is healthy"; break; fi
    sleep 2
  done
else
  sleep 5
fi

# 8. Open the browser -------------------------------------------------------------------------
ok "MCP Token Footprint is running → ${URL}"
case "$(uname -s)" in
  Darwin) open "$URL" >/dev/null 2>&1 || true ;;
  Linux)  command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 || true ;;
esac

cat <<EOF

  Open in your browser:  ${URL}

  Stop it:     docker stop ${CONTAINER_NAME}
  Start again: docker start ${CONTAINER_NAME}
  Remove it:   docker rm -f ${CONTAINER_NAME}      (your data volume '${VOLUME_NAME}' is kept)
  Wipe data:   docker volume rm ${VOLUME_NAME}     (only after removing the container)

EOF
