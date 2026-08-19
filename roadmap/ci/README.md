# CI & headless automation — implementation plan · **PRIORITY: HIGH**

Owner directive (2026-07-04): the app's measurements must be usable **without a browser** —
scans, suites, and grading runnable from a terminal or a CI pipeline, with machine-readable
assertions, exit codes, and a PR-comment artifact — so a repository owning an MCP server or a
skill can gate every change on footprint, quality, and posture deltas.

Living state: [`STATUS.md`](./STATUS.md) (driven by `/next-wp ci`). Shared rules: the
[testing conventions](../testing/conventions.md) apply; decisions below to be locked at kickoff.

## What we're building

1. **Service tokens**: API-token auth for automation (created/revoked in Settings, hashed at
   rest, scoped read/execute) so headless callers never touch provider secrets or the browser
   session. Consumed later by `roadmap/team-server/`.
2. **`mcpfp` CLI**: a thin client against a running API instance — `scan`, `suite run`,
   `assert`, `report`. The CLI never spawns MCP servers or reads secrets itself: the API keeps
   the runtime boundary (architecture rule), the CLI is transport + formatting.
3. **Assertions**: a versioned, zod-validated assertions file (`mcpfp.assert.json`) evaluated
   server-side: max tokens per server / per tool, no-new-tools / no-removed-tools, max scan
   delta vs baseline, min suite score (needs Benchmarks P1–P3), max suite cost, no new
   security findings (needs `roadmap/security-posture/`). Failed assertions → non-zero exit,
   itemized report.
4. **CI artifacts**: a markdown PR-comment body (deltas vs a named baseline: scan-to-scan,
   suite-to-suite) + JSON output for machines; a packaged GitHub Actions workflow example.
5. **Workbench MCP server** (added 2026-08-19): the bench itself MCP-operable by external
   agents (Claude Code, Cursor, CI) — a streamable-HTTP MCP mount on the API projecting the
   read surface, then token-scoped writes. Plan, decisions **D-MCP1–6**, and WPs **M.1–M.4**:
   [`mcp-server.md`](./mcp-server.md) (evidence:
   [`research/langfuse-landscape/`](../../research/langfuse-landscape/) — every compared
   platform ships an MCP server over itself).

## Decisions to lock at kickoff (owner)

- **D-C1 — CLI packaging**: new workspace package `apps/cli` (tsx/node bin) vs a `pnpm mcpfp`
  script. Recommendation: `apps/cli`, published nowhere, invoked via `pnpm --filter cli`.
- **D-C2 — token storage**: new `api_tokens` table (hash, scope, label, last_used) — migration
  number claimed via the cross-workstream decision-log convention (Benchmarks holds v13–v15;
  claim the next free at kickoff, never a duplicate).
- **D-C3 — baseline semantics**: baseline = named scan/suite-run id vs "latest on branch X"
  label. Recommendation: explicit ids recorded in the artifact for reproducibility.

## WP index

### Phase 1 — Tokens + CLI core
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Contract + service tokens: `api_tokens` (hashed, scoped), auth middleware, Settings UI | — | M |
| 1.2 | `mcpfp` CLI skeleton: config (URL+token), `scan` + `report` commands, JSON/markdown output | 1.1 | M |
| 1.3 | Assertions engine (server-side) + `assert` command: footprint/delta rules, exit codes | 1.2 | L |

### Phase 2 — Suites & PR artifacts
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | `suite run` command: trigger, poll/stream, result summary (needs Benchmarks P3) | 1.2, benchmarks 3.2 | M |
| 2.2 | Suite/grade assertions (min score, max cost) + baseline-delta PR-comment artifact | 1.3, 2.1 | M |
| 2.3 | GitHub Actions packaging: workflow example, docs, containerized runner notes | 2.2 | S |

### Phase 3 — Posture integration
| WP | Title | Depends on | Size |
|---|---|---|---|
| 3.1 | `no-new-security-findings` assertion (needs security-posture P1) | 1.3, security-posture 1.2 | S |

### Phase MCP — workbench MCP server (plan: [`mcp-server.md`](./mcp-server.md))
| WP | Title | Depends on | Size |
|---|---|---|---|
| M.1 | Read-only MCP server core: streamable-HTTP mount on the API, read tools + report resources, feature flag | — | L |
| M.2 | Service-token scopes on the mount (localhost bypass per D-MCP2) | 1.1, M.1 | M |
| M.3 | Scoped write tools: `scan:run` · `runs:launch` · `suites:run` | M.2 | M |
| M.4 | Agent onboarding docs + self-scan CI gate (D-MCP5) | M.1 | S |

## Invariants

- The CLI is a **client**: no MCP connections, no secret material, no DB access. Tokens are
  shown once at creation, stored hashed, revocable, and never appear in logs or CI output.
- Assertions are evaluated **server-side** and versioned (`ASSERTIONS_VERSION`); the CLI only
  renders results. Exit codes: 0 pass · 1 assertion failure · 2 execution/config error.
- Artifacts contain no secrets and no absolute local paths.

## Definition of done (every WP)

`pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root + WP
acceptance; ledger discipline per [`STATUS.md`](./STATUS.md).
