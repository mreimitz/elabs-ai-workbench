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
- [ ] WP M.4 — agent onboarding docs + self-scan CI gate — depends: M.1

## Decision log
_Entries: date · decision · rationale. Kickoff locks D-C1–D-C3 (Phase 1) / D-MCP1–6 (Phase
MCP) here._

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
