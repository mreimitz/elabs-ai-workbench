---
type: "Guide Page"
title: "Running the workbench container"
description: "How the workbench is built into one Docker image, what it listens on, where its data lives, and how to start and stop it."
tags: ["documentation", "DC-22"]
timestamp: "2026-08-20T16:30:00Z"
status: "current"
---

# Running the workbench container

The whole workbench — API, the built web UI, the CLI — ships as **one Docker image**. The API
serves the web build, so there is a single process and a single port.

## Start it

From the repository root:

```bash
docker compose up --build
```

Then open **http://localhost:8081/**.

The compose project is named `elabs-ai-workbench` explicitly, so its identity never depends on the
folder name and it can never recreate or overwrite a different checkout's container or volume.

To stop it:

```bash
docker compose down          # keep the data volume
docker compose down -v       # ALSO delete the database and the encryption key — see below
```

## What it listens on

| | Value |
| --- | --- |
| Inside the container | `0.0.0.0:8080` |
| Published on the host | `127.0.0.1:8081` |

The published port is bound to **loopback only, deliberately**. The workbench has no
authentication for browser users — it is a single-owner local tool — so it must not be reachable
from the network until the team-server work lands. Keep `HOST=0.0.0.0` inside the container; that
is what lets the port mapping reach Node.

A **healthcheck** polls `/api/health` every 30 seconds after a 20-second grace period, so
`docker compose ps` reports the container as healthy only once the API actually answers.

## Where the data lives

Everything persistent sits in the `/data` volume:

- `app.sqlite` — the database: servers, scans, runs, skills, suites, everything.
- `mcp-secret.key` — the auto-generated encryption key for stored MCP secrets and OAuth tokens.

**Losing that key makes every stored secret unrecoverable**, so it lives in the same persistent
volume as the database. If you set `MCP_SECRET_KEY` yourself, keep it somewhere you can restore
from; if you do not, the container generates one on first start and keeps it in the volume.

`docker compose down -v` deletes the volume — the database *and* the key. Use plain
`docker compose down` unless you mean to start from nothing.

## Configuration

The container sets sensible production defaults (`NODE_ENV=production`, `PORT=8080`,
`HOST=0.0.0.0`, `DATA_DIR=/data`, `DATABASE_PATH=/data/app.sqlite`). Everything else is optional and
documented in `.env.example` at the repository root — retention limits, skill ingest caps, the OAuth
callback URL, and whether the API requires a service token on loopback.

Provider API keys are **not** environment variables. They are entered in the UI under Settings and
stored encrypted in the database.

## How it is built

The image is a multi-stage build on `node:22-bookworm-slim`: install dependencies, build all four
packages, then copy only the production dependencies and build output into a slim runtime stage. The
runtime stage runs as the unprivileged `node` user and starts `apps/api/dist/index.js` under an init
process, which reaps the child processes the assistant features spawn per session.

The web bundle is memory-hungry to build (Monaco, Milkdown and Mermaid are all in it), so the build
stage raises Node's heap to 3400 MB. On a constrained machine building outside Docker, pass the same
`NODE_OPTIONS=--max-old-space-size=3400`.

## Running it without Docker

For development, `pnpm dev` runs the API on `127.0.0.1:8080` and Vite on `127.0.0.1:5173`, with Vite
proxying `/api` to the API. `pnpm build && pnpm start` runs the built API, which serves the web
build the same way the container does.
