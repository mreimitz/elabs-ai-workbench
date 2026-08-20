---
type: "Work Package Spec"
title: "WP 1.2 \u2014 mcpfp CLI skeleton (config, scan + report, JSON/markdown output)"
description: "Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 1.2 — `mcpfp` CLI skeleton (config, `scan` + `report`, JSON/markdown output)

Phase 1 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](../RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 1.1 (service tokens — done 2026-08-19, `wp/ci/1.1`).
**Consumed by:** WP 1.3 (`assert`), WP 2.1 (`suite run`), WP 2.2 (PR-comment artifact),
WP 2.3 (GitHub Actions packaging).

---

## Locked decisions this WP implements

- **D-C1 (locked 2026-08-19)** — `mcpfp` is a new workspace package **`apps/cli`**, published
  nowhere, invoked via `pnpm --filter cli`. This WP creates that package.
- **D-C2 / D-C4 (locked 2026-08-19)** — the credential the CLI presents is a WP 1.1 service token
  (`Authorization: Bearer mcpfp_…`), carrying the frozen scope tuple `read` · `scan:run` ·
  `runs:launch` · `suites:run`. **Against a loopback API a token is optional** (loopback is open
  unless `API_AUTH_REQUIRED=true`); against a remote one it is mandatory. The CLI does not
  re-implement that rule — it forwards the credential and renders whatever the guard answers.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-C5 — argument parsing has no dependency.** Use `node:util`'s built-in `parseArgs`. The repo
  rule is "no new runtime dependency without a reason"; a 4-command CLI is not a reason to take on
  `commander`/`yargs`. `pnpm-lock.yaml` must be unchanged by this WP.
- **D-C6 — stdout is the payload, stderr is the narration.** Everything a machine consumes
  (JSON, markdown, the human table) goes to **stdout**; every progress line, warning and error goes
  to **stderr**. `mcpfp report scan <id> --format json > report.json` must produce a byte-exact,
  parseable file with nothing else in it.
- **D-C7 — exit codes are reserved now, not later.** `0` success · `1` **assertion failure
  (reserved — WP 1.3, never emitted by this WP)** · `2` execution/config/transport error. A
  non-2xx API response is a `2`, not a `1`. This is stated in the README's invariants; pin it with a
  test so WP 1.3 inherits a stable contract.

---

## What we're building

A **thin API client**. The CLI is transport + formatting and nothing else:

1. **`apps/cli`** — the workspace package, its `mcpfp` bin, and the arg/route dispatch.
2. **Config resolution** — where the API URL and the token come from, with a documented precedence.
3. **`mcpfp scan`** — run a discovery scan against a registered server and render the footprint.
4. **`mcpfp report`** — fetch a persisted report (scan · server · run · fleet) as JSON or markdown.
5. **`mcpfp servers` / `mcpfp scans`** — the minimum listing needed to *find* the id the other two
   commands take (a CLI that can only accept opaque ids is not usable from a terminal).
6. **The machine-output envelope** — declared in `packages/shared`, so WP 1.3's assertion results
   and WP 2.2's PR artifact extend one shape instead of inventing a second.

### Explicitly NOT in this WP

Assertions and `mcpfp.assert.json` (WP 1.3) · `suite run` (WP 2.1) · the baseline-delta PR comment
(WP 2.2) · the packaged GitHub Actions workflow (WP 2.3) · publishing to npm (D-C1: published
nowhere) · any interactive prompt (a CI job has no TTY).

---

## Design (implement this, don't redesign it)

### The invariant that governs every line of this WP

> **The CLI is a client.** No MCP connections, no `better-sqlite3`, no `data/` access, no secret
> material beyond the bearer token it forwards, no token counting, no report *rendering* it did not
> receive from the API. The API keeps the runtime boundary
> (`.claude/rules/architecture.md`); the CLI is transport + formatting.

Concretely: `apps/cli/package.json` may depend on **`@mcp-token-footprint/shared`** and nothing
else at runtime. Adding `@modelcontextprotocol/sdk`, `better-sqlite3`, `js-tiktoken` or
`@mcp-token-footprint/api` to it is a failure of this WP, not a shortcut. Pin it with a test that
reads the manifest's `dependencies` keys.

### Package (`apps/cli`)

- Name **`@mcp-token-footprint/cli`**, `private: true`, `"type": "module"`, `bin: { "mcpfp":
  "./dist/index.js" }`, with a `#!/usr/bin/env node` shebang on `src/index.ts` (tsc preserves it).
- Scripts mirroring `apps/api` so the root recursive scripts pick it up with no root-script change
  to `build`/`typecheck`/`test`:
  - `"build": "tsc -p tsconfig.json"`
  - `"typecheck": "tsc -p tsconfig.json --noEmit"`
  - `"test": "pnpm --filter @mcp-token-footprint/shared build && tsx --test test/*.test.ts"`
- `tsconfig.json` extends the root one exactly as `apps/api`'s does (`outDir: dist`,
  `rootDir: src`, `declaration`, ESM/NodeNext, strict + `noUncheckedIndexedAccess`).
- Add **one** root convenience script: `"mcpfp": "pnpm --filter @mcp-token-footprint/cli exec tsx
  src/index.ts --"` so `pnpm mcpfp scan <server>` works in a dev checkout without a build.
- `pnpm-workspace.yaml` already globs `apps/*` — **do not edit it**.

### Config resolution (`apps/cli/src/config.ts`)

One resolver, one precedence, stated once and tested:

| Setting | Flag | Env | Config file | Default |
| --- | --- | --- | --- | --- |
| API base URL | `--url <url>` | `MCPFP_URL` | `"url"` | `http://127.0.0.1:8080` |
| Service token | `--token <t>` | `MCPFP_TOKEN` | `"token"` | *(none — loopback is open)* |
| Request timeout (ms) | `--timeout <ms>` | `MCPFP_TIMEOUT_MS` | `"timeoutMs"` | `120000` |

**Precedence: flag > env > config file > default.** The config file is `mcpfp.config.json`,
discovered by walking **up** from the cwd to the filesystem root (first hit wins); `--config <path>`
names one explicitly, and a `--config` path that does not exist is a **`2`**, not a silent fallback.
Parse it with a zod schema (`.strict()`, so a typo'd key is an error rather than a silently ignored
setting).

Rules:

- **The token is never printed, ever.** Not by `mcpfp config show`, not in a verbose line, not in an
  error message, not in the machine JSON. Where the token must be *acknowledged*, print its
  `mcpfp_ab12cd34…` display prefix only — reuse `API_TOKEN_PREFIX_LENGTH` from
  `packages/shared/src/api-tokens.ts`, do not re-derive the number.
- **Storing a token in `mcpfp.config.json` is supported but discouraged**: when the token is
  resolved *from the file*, emit a one-line stderr warning naming `MCPFP_TOKEN` as the CI-safe
  source. Add `mcpfp.config.json` to `.gitignore`.
- Validate the URL with `new URL()` and reject a non-`http:`/`https:` protocol with a `2`.
- Refuse to send a token that fails `looksLikeApiToken()` (from shared) with a `2` **before** any
  network call — a truncated secret pasted into CI should fail with "that is not a token", not with
  a confusing 401 later.

### Command surface

```
mcpfp <command> [subcommand] [args] [options]

  scan <server>              Run a discovery scan. <server> is a server id OR its exact name.
  report scan <scanId>       The scan (token-footprint) report.
  report server <scanId>     The server-level report for that scan.
  report run <runId>         The run report.
  report fleet               The fleet report.
  servers                    List registered servers (id, name, transport).
  scans [--server <server>]  List scans, newest first; optionally one server's.
  config show                The resolved config, with the token REDACTED to its prefix.
  help [command] | --help    Usage. Also printed on an unknown command (exit 2).
  --version                  The CLI version + the output-envelope version.

Global options: --url --token --timeout --config --format <human|json|markdown> --output <file> --quiet
```

- **`--format`** (default `human`). `json` is the machine envelope below; `markdown` is the API's
  own markdown for the report commands. `--format markdown` on a command with no markdown
  representation (`servers`, `scans`, `config show`) is a **`2`** with a message naming the formats
  that command does support — never a silent downgrade to `human`.
- **`--output <file>`** writes the payload to a file instead of stdout (and then prints a one-line
  confirmation to **stderr**). Parent directories are created.
- **`--quiet`** suppresses progress narration on stderr; it does **not** suppress errors.
- `scan <server>` resolves a **name** by `GET /api/servers` and exact-matching `name`. An ambiguous
  name (two servers, same name) is a `2` listing the candidate ids — never a silent "first match".

### API calls (`apps/cli/src/client.ts`)

Global `fetch` (Node 22 — no dependency). One `request()` helper that:

- joins the path onto the base URL, sets `Accept`, sets `Authorization: Bearer <token>` **only when
  a token is configured**, and applies the timeout via `AbortSignal.timeout`;
- maps a non-2xx response to a typed error carrying `status` + the API's `{ error, code }` body when
  it parses. **Translate the WP 1.1 guard's codes into an operator sentence**, since these are the
  errors a CI user will actually hit:
  - `401 authentication_required` → "This instance requires a service token. Create one in
    Settings › API tokens and pass it with `--token` or `MCPFP_TOKEN`."
  - `401 invalid_token` → "The service token was rejected (unknown, revoked or expired)."
  - `403 scope_forbidden` → "The token authenticated but lacks the scope for this request." — and
    for `scan`, name the missing scope (`scan:run`) explicitly.
  - `403 feature_disabled` → "That feature is switched off in Settings › Features."
  - A connection refusal → "No workbench API at `<url>` — is it running?" **with the URL, never the
    token.**
- All of these exit **2** (D-C7).

Endpoints this WP calls (all exist today — this WP adds **no API route** and **no migration**):
`GET /api/servers` · `POST /api/servers/:id/scan` · `GET /api/scans` · `GET /api/servers/:id/scans`
· `GET /api/reports/scan/:id/{json,markdown}` · `GET /api/reports/server/:scanId{,/markdown}` ·
`GET /api/reports/run/:id/{json,markdown}` · `GET /api/reports/fleet/{json,markdown}`.

### The machine envelope (`packages/shared/src/cli-contract.ts`, contract-first)

Every `--format json` payload is one shape, so WP 1.3 can add `assertions` to it additively and
WP 2.2 can render a PR comment from it without re-parsing prose:

```ts
export const MCPFP_OUTPUT_VERSION = 1;

export type McpfpOutput<T> = {
  outputVersion: typeof MCPFP_OUTPUT_VERSION;
  command: string;          // "scan", "report scan", …
  generatedAt: string;      // ISO 8601
  apiUrl: string;           // the base URL used — never any credential
  data: T;
};

export const MCPFP_EXIT = { success: 0, assertionFailure: 1, error: 2 } as const;
```

Declared in `packages/shared`, exported from its `index.ts`, imported by the CLI. A test asserts the
envelope carries **no** credential field and that `MCPFP_EXIT` matches the README invariant.

### Human output

`human` is the default because a person runs this locally too. Keep it plain text — no chalk, no
box-drawing dependency, no spinner:

- `scan` → server name, scan id, status, tool count, total tokens, top 5 tools by contribution, and
  the one line an operator wants: total tokens + counting profile + `countingVersion`.
- `servers` / `scans` → an aligned column listing, numbers right-aligned.
- Anything already markdown from the API renders verbatim under `--format markdown`.

### Docs

- `user-guide/22-mcpfp-cli.md` — install/invoke (`pnpm mcpfp …`), config precedence, the token
  posture (loopback open · remote requires a token, and the `scan:run` scope `scan` needs), each
  command with a worked example, the exit codes, and what is **not** built yet (assert · suite run ·
  PR artifact), naming WP 1.3 / 2.1 / 2.2. Link from `user-guide/README.md`.
- `CLAUDE.md` — §2 repository layout gains `apps/cli`; §4 commands gains the `pnpm mcpfp` line;
  §3 tech stack notes the CLI as a **client only** (no MCP, no DB).
- `roadmap/ci/STATUS.md` — record **D-C5 / D-C6 / D-C7** in the decision log.

---

## Files (for parallel-safety bookkeeping — this WP runs **solo**)

- `packages/shared/src/cli-contract.ts` (new), `packages/shared/src/index.ts` (one export line)
- `apps/cli/package.json`, `apps/cli/tsconfig.json` (new)
- `apps/cli/src/{index,config,client,output,commands/*}.ts` (new)
- `apps/cli/test/*.test.ts` (new — stub the API with `node:http`, never a real workbench)
- `package.json` (one `mcpfp` script), `.gitignore` (`mcpfp.config.json`)
- `CLAUDE.md`, `user-guide/22-mcpfp-cli.md` (new), `user-guide/README.md`
- `roadmap/ci/STATUS.md` (decision log only — the orchestrator ticks the box)

**Do not touch** `apps/api/src/**` (this WP adds no route and no migration), `apps/web/src/**`,
`pnpm-workspace.yaml`, or `packages/shared/src/api-tokens.ts`.

---

## Acceptance

Tick only what is actually observed — the gate output and the tests, not intent.

- [ ] **A1 — the package exists and is wired.** `apps/cli` is a workspace package
      `@mcp-token-footprint/cli` with a `mcpfp` bin; root `pnpm build`, `pnpm typecheck` and
      `pnpm test` all include it with **no** edit to `pnpm-workspace.yaml`.
- [ ] **A2 — the CLI is a client (D-C1 invariant).** `apps/cli/package.json`'s runtime
      `dependencies` are exactly `{ "@mcp-token-footprint/shared": "workspace:*" }`. No MCP SDK, no
      `better-sqlite3`, no api import. **A test asserts this by reading the manifest.**
- [ ] **A3 — no new dependency (D-C5).** Arg parsing is `node:util` `parseArgs`; HTTP is global
      `fetch`. **`pnpm-lock.yaml` is unchanged** by this WP (verify with `git diff --stat`).
- [ ] **A4 — contract-first.** `MCPFP_OUTPUT_VERSION`, `McpfpOutput<T>` and `MCPFP_EXIT` live in
      `packages/shared/src/cli-contract.ts`, are exported from its `index.ts`, and the CLI imports
      them from `@mcp-token-footprint/shared` rather than re-declaring them.
- [ ] **A5 — config precedence.** flag > env > `mcpfp.config.json` (found by walking up) > default,
      covered by a test per level. `--config <missing path>` exits **2**. An unknown key in the
      config file is an error (`.strict()`), not silently ignored.
- [ ] **A6 — the token is never printed.** `config show` renders the prefix only; no code path
      writes the plaintext to stdout, stderr, a file, or the JSON envelope. A test runs
      `config show` (and an error path) with a known token and asserts the full string appears in
      **no** stream. Reusing `API_TOKEN_PREFIX_LENGTH` from shared, not a literal `8`.
- [ ] **A7 — a bad token fails before the network.** A `--token` failing `looksLikeApiToken()` exits
      **2** with a "that is not a workbench token" message and **no** request is made (assert the
      stub server received zero requests).
- [ ] **A8 — `scan` works end to end against a stub API.** `mcpfp scan <id>` POSTs
      `/api/servers/:id/scan` and renders the footprint; `mcpfp scan <name>` resolves the name via
      `GET /api/servers`; a duplicate name exits **2** listing the candidates.
- [ ] **A9 — `report` works for all four targets** (`scan`, `server`, `run`, `fleet`) in both
      `--format json` and `--format markdown`, hitting the endpoints listed above.
- [ ] **A10 — stdout/stderr split (D-C6).** With `--format json`, **stdout is byte-exact parseable
      JSON** — a test pipes it through `JSON.parse` — while progress/warnings land on stderr. Pinned
      for at least one command with narration on.
- [ ] **A11 — exit codes (D-C7).** `0` on success; `2` on a config error, an unknown command, an
      unreachable API, and a non-2xx response. **`1` is emitted by nothing in this WP** — a test
      asserts the constant exists and is reserved.
- [ ] **A12 — guard errors are translated.** Stubbed `401 authentication_required`, `401
      invalid_token`, `403 scope_forbidden` and `403 feature_disabled` each produce their operator
      sentence on stderr and exit **2**; the `scan` path names the `scan:run` scope. **No response
      body or header echoes the token.**
- [ ] **A13 — `--format markdown` on an unsupported command exits 2** naming the supported formats
      (no silent downgrade).
- [ ] **A14 — `--output` writes the payload to the file** (creating parent dirs) and puts only the
      confirmation on stderr; the file contains exactly what stdout would have carried.
- [ ] **A15 — API untouched.** `git diff` shows **no** change under `apps/api/src/`, no new route,
      no migration (`LATEST_SCHEMA_VERSION` unchanged at 58), no `<Route>` and therefore no
      `ASSISTANT_ROUTE_MANIFEST` edit — the `assistant-route-operability` gate is untouched and
      green.
- [ ] **A16 — docs.** `user-guide/22-mcpfp-cli.md` exists, is linked from `user-guide/README.md`,
      and documents config precedence, the token posture, every command, and the exit codes;
      `CLAUDE.md` §§2–4 mention `apps/cli`; **D-C5/D-C6/D-C7 are recorded in
      `roadmap/ci/STATUS.md`'s decision log.** Every path cited resolves.
- [ ] **A17 — real end-to-end smoke against the running app.** Against a locally built + started
      API (`pnpm build && pnpm start`) with at least one registered server, `pnpm mcpfp servers` and
      `pnpm mcpfp report fleet --format markdown` return real data over loopback **with no token**
      (proving D-C2's loopback-open posture from a real client). *Report exactly what you ran and
      what came back; if you could not start the app, say so and leave this for owner acceptance
      rather than claiming it.*
- [ ] **A18 — gate green** from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm
      lint`, with the new CLI tests included in the run.
