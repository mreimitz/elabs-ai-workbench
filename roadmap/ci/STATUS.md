# CI & headless automation — work-package status ledger · **PRIORITY: HIGH**

Living state for the **CI** plan, read and updated by `/next-wp ci`. A box is ticked **only**
when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines record date + branch: `… — done <YYYY-MM-DD> ·
wp/ci/<id>`.

> Plan + kickoff decisions (D-C1–D-C3) in [`README.md`](./README.md). **Blocked-on notes:**
> 2.1/2.2 need Benchmarks Phase 3 (`../benchmarks/STATUS.md`); 3.1 needs security-posture
> Phase 1 (`../security-posture/STATUS.md`). Migration numbers: claim the next free
> `user_version` at kickoff via the cross-workstream decision-log convention (Benchmarks holds
> v13–v15). **Phase MCP** (WP M.1–M.4, decisions **D-MCP1–6**) added 2026-08-19 — plan:
> [`mcp-server.md`](./mcp-server.md); M.1 is independent of Phase 1 (localhost trust,
> D-MCP2), M.2+ consume WP 1.1 tokens; kickoff prompt:
> [`kickoff-prompt-mcp.md`](./kickoff-prompt-mcp.md).

## Phase 1 — Tokens + CLI core
- [ ] WP 1.1 — contract + service tokens: `api_tokens` (hashed, scoped), auth middleware, Settings UI
      — spec: [`wp-1.1-service-tokens.md`](./wp-1.1-service-tokens.md) · status: **in progress** (`wp/ci/1.1`)
- [ ] WP 1.2 — `mcpfp` CLI skeleton: config, `scan` + `report`, JSON/markdown output
- [ ] WP 1.3 — assertions engine + `assert` command: footprint/delta rules, exit codes

## Phase 2 — Suites & PR artifacts
- [ ] WP 2.1 — `suite run` command: trigger, poll/stream, result summary
- [ ] WP 2.2 — suite/grade assertions + baseline-delta PR-comment artifact
- [ ] WP 2.3 — GitHub Actions packaging: workflow example + docs

## Phase 3 — Posture integration
- [ ] WP 3.1 — `no-new-security-findings` assertion

## Phase MCP — workbench MCP server (see [`mcp-server.md`](./mcp-server.md))
- [x] WP M.1 — read-only MCP server core: streamable-HTTP mount, read tools + report resources, feature flag — done 2026-08-19 · `wp/ci/M.1`. 21 read tools + 4 report resource templates at `/api/mcp` (stateless streamable HTTP, GET/DELETE→405); new `mcp_server` Settings › Features flag (off ⇒ 403 `feature_disabled`); no new dependency, **no migration** (`user_version` 57 unchanged), additive-only wire. Gate green (shared 89 · api 3254 · web 3178+5 skipped · build · lint). **Live-verified against the built API on a copy of a real 91 MB dev DB**: MCP Inspector `initialize`/`tools/list`/7 tool calls, `resources/read` of a real run report, error + validation paths, flag off→403→on, off-state survives restart, fresh-DB boot. **Self-proof (D-MCP5 seed): the workbench scanned its own mount — 21 tools · 2,224 tokens · 200 resources (`generic_o200k`, countingVersion 2)**; the in-test `tools/list` measurement is 2,206 against a budget of 3,000 (`WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET`). Owner-acceptance pending: the both-theme + keyboard walk of the new Settings › Features row.
- [ ] WP M.2 — service-token scopes on the mount (localhost bypass per D-MCP2) — depends: 1.1, M.1
- [ ] WP M.3 — scoped write tools: `scan:run` · `runs:launch` · `suites:run` — depends: M.2
- [x] WP M.4 — agent onboarding docs + self-scan CI gate — done 2026-08-19 · `wp/ci/M.4`. Three
      deliverables, all additive: **(a)** `GET /api/mcp/llms.txt` — an `llms.txt`-style usage doc
      **rendered per request from the registered tool definitions** (same name+description
      `tools/list` returns) grouped by a new `WORKBENCH_MCP_TOOL_FAMILIES` declaration, so it cannot
      drift; it sits *under* the mount path, so the `mcp_server` feature's existing `/api/mcp` prefix
      403s it with the endpoint it documents (`GET /api/mcp` itself still answers 405). **(b)**
      [`user-guide/20-workbench-mcp-server.md`](../../user-guide/20-workbench-mcp-server.md) — the
      owner-facing playbook (connect Claude Code / Cursor, worked questions, the read-only guarantee,
      the Settings › Features switch, what is *not* built yet). **(c) The D-MCP5 dogfood gate:**
      `pnpm mcp:self-scan` serves the real mount on an ephemeral loopback port against a throwaway DB
      and runs **the app's own `ScanService.runScan`** against it — a real scan row, not a
      re-implementation — writing a gitignored `.artifacts/mcp-self-scan/footprint.{json,md}`
      artifact; exit 0 under budget · **1 over budget** · 2 on failure. Wired as
      `.github/workflows/mcp-self-scan.yml` (the repo's **only** workflow — the four-command quality
      gate is still local; the stale "root `ci.yml`" claims in `CLAUDE.md` §§3–4 and
      `.claude/rules/quality-gates.md` were corrected in the same merge) and exercised hermetically
      inside `pnpm test` (`apps/api/test/workbench-mcp-self-scan.test.ts`). No new dependency, **no
      migration**, no web route (`assistant-route-operability` untouched); `pnpm-lock.yaml` unchanged.
      Gate green (shared 94 · api 3261 · web 3187 passed + 5 skipped · build · lint), re-run by the
      orchestrator on the branch. **Independently verified at merge:** `pnpm mcp:self-scan` →
      `21 tools · 2224 definition tokens (generic_o200k, countingVersion 2) · budget 3000 → within
      budget`, exit 0; the breach path re-checked by temporarily setting the budget to 100 → exit
      **1** with the FAIL message, then reverted. **Not verified:** the GitHub Actions workflow has
      never executed (no CI in this repo yet), and no third-party host (Claude Code / Cursor) was
      connected — both are owner-acceptance items below.

## Decision log
_Entries: date · decision · rationale. Kickoff locks D-C1–D-C3 (Phase 1) / D-MCP1–6 (Phase
MCP) here._

- **2026-08-19 · D-C1 / D-C2 / D-C4 locked at Phase 1 kickoff** (owner, at the WP 1.1 kickoff).
  Full text + the design they bind: [`wp-1.1-service-tokens.md`](./wp-1.1-service-tokens.md).
  - **D-C1 — CLI packaging:** `mcpfp` is a new workspace package **`apps/cli`** (the README's own
    recommendation), published nowhere, invoked via `pnpm --filter cli`. Binds WP 1.2.
  - **D-C2 — token storage + auth posture:** an **`api_tokens`** table at **`user_version` v58**
    (57 was the latest). **Loopback stays open, remote requires a bearer token** — D-MCP2's trust
    model applied to the whole API, so the local browser UI is unregressed; the env switch
    **`API_AUTH_REQUIRED=true`** forces token auth on loopback too. A *presented* token is always
    verified (a bad one is 401 even from loopback — never a silent fall-through to the open path),
    and loopback is decided from the socket, never a header (`trustProxy` stays off).
  - **D-C4 — scope vocabulary (new):** the frozen tuple `read` · `scan:run` · `runs:launch` ·
    `suites:run` — exactly D-MCP3's write scopes, so WP M.2/M.3 consume it unchanged. **No delete
    scope at any phase**; token-authenticated `DELETE` is refused, and a token can never mint or
    revoke another token. WP 1.1 enforces scopes coarsely (safe methods need `read`, unsafe methods
    need an execute scope); per-route mapping is WP M.2/M.3.
  - **No feature flag** for service tokens: an auth primitive, not a capability — a Settings switch
    that could turn an auth check *off* is a foot-gun (contrast `mcp_server`/D-MCP6, which gates a
    capability).

  _Rationale:_ D-MCP2 already committed the trust model ("non-local exposure requires a Phase 1
  service token; tokens carry scopes"); Phase 1 implements it rather than inventing a second one.

- **2026-08-19 · D-MCP1–D-MCP6 locked at kickoff** (Phase MCP — workbench MCP server). Locked
  verbatim as proposed in [`mcp-server.md`](./mcp-server.md) §"Decisions to lock", by the WP M.1
  kickoff prompt [`kickoff-prompt-mcp.md`](./kickoff-prompt-mcp.md):
  - **D-MCP1 — Transport & mount:** streamable HTTP served by the existing Fastify API
    (`/api/mcp`), same process, no sidecar. Stdio optional later via a thin launcher.
  - **D-MCP2 — Trust model:** on localhost the mount follows the app's no-auth-by-design posture
    (bind-scoped, same trust as the web UI). Non-local exposure requires a Phase 1 service token
    (WP M.2); tokens carry scopes.
  - **D-MCP3 — Read-first:** v1 is read-only. Write tools arrive only behind explicit token scopes
    (`scan:run`, `runs:launch`) — headless has no interactive approval, so **scope = consent**;
    deletes are excluded entirely, at every phase.
  - **D-MCP4 — One tool registry:** the MCP tools re-project the SAME service/repository functions
    and zod schemas the Assistant tools and (later) `mcpfp` resolve to. **No logic in the MCP
    layer** — re-project, don't reimplement.
  - **D-MCP5 — Dogfood gate:** the workbench scans its own MCP server; the footprint report is a
    build artifact and a budget assertion on the tool definitions (WP M.4 wires the CI job; WP M.1
    records the first measured number).
  - **D-MCP6 — Feature flag:** ships behind a Settings › Features flag (the `feature-flags.ts`
    registry precedent); off = 403 `feature_disabled` on the mount, nav untouched.

  _Rationale:_ [`research/langfuse-landscape/`](../../research/langfuse-landscape/) `01 §G10` +
  the `02` matrix row "Exposes an MCP server over itself" — every compared platform (Langfuse,
  LangSmith, Phoenix, Opik, Braintrust, Weave) ships one; the MCP workbench does not.

## Owner acceptance (owner-only)
- [ ] A repository with an MCP server gated end-to-end: PR → workflow → scan + suite +
      assertions → PR comment with deltas; a deliberate budget breach fails the check —
      accepted: ____
- [ ] **WP M.1** — Settings › Features shows the new **Workbench MCP server** row and reads
      correctly in **both themes**, keyboard-reachable with visible focus; its turn-off confirm
      dialog states the blast radius; an external agent host (Claude Code / Cursor) connects to
      `http://127.0.0.1:8080/api/mcp` and answers a real question from the tools —
      accepted: ____
- [ ] **WP M.4** — a real external host onboards from the served doc: open
      `http://127.0.0.1:8080/api/mcp/llms.txt` in a browser, then run
      `claude mcp add --transport http workbench http://127.0.0.1:8080/api/mcp` in another repo and
      have that session answer a question from the tools without further explanation; the
      `.github/workflows/mcp-self-scan.yml` job runs green once the branch reaches GitHub (never yet
      executed) — accepted: ____
