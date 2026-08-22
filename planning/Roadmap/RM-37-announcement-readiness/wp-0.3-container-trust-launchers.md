---
type: "Work Package Spec"
title: "WP 0.3 — Container trust boundary and launchers proven on clean machines"
description: "Phase 0 of item.md. Ledger: STATUS.md. Make the service-token guard container-aware so the browser UI loads through a published Docker port, bind the bundle launchers to loopback, pass the OAuth redirect for the chosen port, fix the compose healthcheck and the stale Hub override, back up before migrating, boot in a degraded mode on a key mismatch, run run.ps1 on Windows, ship arm64, and record one cold start per OS."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 0.3 — Container trust boundary and launchers proven on clean machines

Phase 0 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Files: `apps/api/src/api-tokens/guard.ts:97-104` (`isLoopbackAddress`) and `:179` (tokenless pass only
on loopback), `apps/api/test/api-tokens-guard.test.ts:589-606`, `docker-compose.yml` (`:24` port bind,
`:31-36` `OAUTH_REDIRECT_URL`, `:38-43` `HUB_TOOL_LOADING_DEFAULT: eager`, `:45-57` healthcheck against
port 8081), `scripts/release/run.sh` (`:85` `docker rm -f`, `:101` `-p "${PORT}:8080"`, `:122` URL,
`:135` `uname`), `scripts/release/run.ps1` (`:1` `#Requires -Version 5`, `:15` `$ErrorActionPreference`,
`:49`, `:76`, `:88-93` native calls with `*> $null`), `scripts/release.sh:43` (`linux/amd64` only),
`scripts/release/README.md` (Ports `:63`, Upgrading `:86`, Troubleshooting `:91`),
`apps/api/src/config/env.ts:155-157` (redirect default) and `:74-80,306` (hub loading default `auto`),
the boot secret migration (`apps/api/src/index.ts:200-228`, `apps/api/src/servers/repository.ts:147-179`,
`apps/api/src/secrets/secret-store.ts:33-60`), `apps/api/src/assistant/claude-auth.ts:94-105`
(`process.arch`), `Dockerfile:63-66` (runtime stage), `apps/api/src/mcp/connection-error.ts`, README
`:495-496`. Out of scope: Origin/Host/CSRF and security headers (WP 0.4), `ci.yml`/`release.yml` and
build-from-HEAD (WP 0.6 — the Docker smoke written here is wired there), the upgrade-path test harness
(RM-18 WP 1.4), diagnostics export (WP 1.4), team-server auth (RM-25).

## Actions

1. Container-aware trust decision (`guard.ts:97-104,179`): add `API_TRUSTED_PEER_CIDRS` (read in
   `config/env.ts`, default empty); a tokenless request passes when the socket peer is loopback **or**
   inside a listed CIDR and `API_AUTH_REQUIRED` is false; `docker-compose.yml` and both launchers set the
   Docker gateway ranges (`172.16.0.0/12`, `192.168.65.0/24`). Alternative with the same tests:
   `DOCKER_MODE=true` + a loopback-bound published port ⇒ the port binding is the boundary. A presented
   token is always verified. Tests: gateway peer without CIDR → 401; with CIDR → pass; bad token → 401. — P0
2. Docker smoke: `scripts/docker-smoke.sh` (or a Playwright project) builds the image, starts it,
   asserts `GET /api/health` and `GET /api/servers` through the published port return 200 and that
   `/servers` renders without the "needs a service token" toast. WP 0.6 runs it in CI. — P0
3. Launchers bind loopback: `run.sh:101` and `run.ps1:88` publish `127.0.0.1:${PORT}:8080`;
   `scripts/release/README.md` documents `BIND=0.0.0.0` as an explicit opt-in that requires
   `API_AUTH_REQUIRED=true` plus a service token; the printed URL stays `http://localhost:PORT`. — P1
4. OAuth redirect follows the chosen port: after the port probe both launchers pass
   `-e OAUTH_REDIRECT_URL="http://localhost:${PORT}/api/oauth/callback"` (code default at `env.ts:155-157`
   uses the internal 8080); the API logs the effective redirect URL at startup; the recipient README
   "Ports" section says the callback follows the port. — P1
5. Compose healthcheck (`docker-compose.yml:45-57`): fetch `http://127.0.0.1:8080/api/health` (the
   container-internal port) or delete the block and inherit the image `HEALTHCHECK` (`Dockerfile:119`). — P1
6. Delete the `HUB_TOOL_LOADING_DEFAULT: eager` override and its comment (`docker-compose.yml:38-43`);
   the code default is `auto` (`env.ts:74-80,306`). Add a test that `docker-compose.yml` sets no `HUB_*`
   variable the code already defaults. — P1
7. Upgrade safety: launchers run `docker stop` (10 s grace) before `docker rm` (`run.sh:85`,
   `run.ps1:76`); before starting a newer image they snapshot the volume to `./backup-<date>.tgz`
   (`docker run --rm -v <volume>:/data -v "$PWD":/out alpine tar czf /out/backup-<date>.tgz /data`);
   the API copies `app.sqlite` (+`-wal`) to `app.sqlite.pre-v<N>.bak` when `user_version <
   LATEST_SCHEMA_VERSION` before `applyMigrations`, keeping the last two; the recipient README gains
   "Back up / restore" with the two `tar` commands. — P1
8. Key-mismatch degraded boot: decrypt failures inside `migratePlaintextSecrets`
   (`servers/repository.ts:147-179`, provider keys at `index.ts:222`) mark the rows `secrets_unreadable`
   instead of throwing; the process boots, `/api/health` answers 200, Settings › Storage shows "The
   encryption key at `<path>` does not match N stored secrets — re-enter them or restore the key", one
   log line names the key path. Test: boot with a wrong `MCP_SECRET_KEY` → 200 + banner payload. — P1
9. `run.ps1` on a real Windows 10/11 VM: wrap the native calls (`:49`, `:76`, `:88-93`) so a redirected
   stderr line under PowerShell 5.1 cannot become a terminating error (`$ErrorActionPreference =
   'Continue'` around them and branch on `$LASTEXITCODE`, or `cmd /c docker … 2>&1`); "Docker Desktop
   not running" and "port already allocated" reach `Die`/the retry loop; add `Get-FileHash -Algorithm
   SHA256` checksum verification and a WSL2-backend check with the "enable WSL2" hint. — P1
10. arm64 bundle: `scripts/release.sh` builds `linux/arm64` alongside `linux/amd64` (`:43`; a loop, or
    a multi-arch manifest via the containerd image store); `run.sh` picks the tarball by `uname -m`;
    verify `better-sqlite3`, the patched `node-pty` and the SDK binary resolved from `process.arch`
    (`claude-auth.ts:94-105`) on an Apple-Silicon Mac, including the subscription sign-in PTY. — P1
11. Cold starts recorded: one clean macOS (Apple Silicon) and one clean Windows machine from the built
    bundle, one clean Linux `docker compose up --build`; each record (date, OS, image tag, first screen
    reached, time to first scan of the workbench's own `/api/mcp`) goes into `STATUS.md` and replaces
    README `:495-496` "Not yet proven end to end". Until recorded, README recommends only
    `docker compose up --build`. — P0
12. Runtime gaps: `connection-error.ts` adds an `ENOENT` hint ("this container has no `uvx`; use an
    `npx` command or a URL") or the runtime stage (`Dockerfile:63-66`) ships `uv` + `python3`; the
    recipient README states that `npx -y …` servers need network access. — P2
13. Linux hosts: `run.sh` passes `--add-host=host.docker.internal:host-gateway` when `uname -s` is
    `Linux`, so the `host.docker.internal` hints in `connection-error.ts` resolve. — P2
14. Supported topologies documented in `scripts/release/README.md` and README §Data & security: laptop
    (loopback, no token), published to a LAN (token required), behind a reverse proxy (every proxied
    user looks local → `API_AUTH_REQUIRED=true`). — P1

## Acceptance

- [ ] Clean machine: `docker compose up --build`, open `http://127.0.0.1:8081/servers` → the list loads,
      no 401 toast; `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/api/servers` → 200;
      the same with `-H 'Authorization: Bearer mcpfp_bad'` → 401.
- [ ] `docker ps` shows `(healthy)` within 60 s; `docker compose config` shows no `HUB_TOOL_LOADING_DEFAULT`.
- [ ] Host socket list shows the launcher's port bound to `127.0.0.1` only.
- [ ] With 8080 busy the launcher lands on 8081, the startup log prints
      `OAUTH_REDIRECT_URL=http://localhost:8081/api/oauth/callback`, and an OAuth sign-in completes.
- [ ] Upgrade from the previous tag: `backup-<date>.tgz` exists, `app.sqlite.pre-v<N>.bak` exists in the
      volume, data is visible afterwards; the restore recipe was exercised once.
- [ ] Wrong key: container stays up, `/api/health` 200, Settings › Storage shows the banner with a count.
- [ ] `run.ps1` transcript from Windows 10/11: friendly message with Docker Desktop stopped, retry message
      with the port taken, checksum verified — attached to the ledger.
- [ ] `docker image inspect` on the arm64 tarball reports `arm64`; the bundle starts natively on Apple
      Silicon and the subscription sign-in PTY works.
- [ ] Three cold-start records in `STATUS.md`; README `:495-496` replaced.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**L** — eight code changes of S–M each plus three machine verifications that need a Windows VM, an
Apple-Silicon Mac and a Linux host.

## Sources

`ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06, ENG-07, ENG-09, ENG-10, ENG-20, ENG-32, SEC-11, PO-23, PS-22, MK-03`
