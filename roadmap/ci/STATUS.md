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
- [ ] WP M.1 — read-only MCP server core: streamable-HTTP mount, read tools + report resources, feature flag
- [ ] WP M.2 — service-token scopes on the mount (localhost bypass per D-MCP2) — depends: 1.1, M.1
- [ ] WP M.3 — scoped write tools: `scan:run` · `runs:launch` · `suites:run` — depends: M.2
- [ ] WP M.4 — agent onboarding docs + self-scan CI gate — depends: M.1

## Decision log
_Entries: date · decision · rationale. Kickoff locks D-C1–D-C3 (Phase 1) / D-MCP1–6 (Phase
MCP) here._

## Owner acceptance (owner-only)
- [ ] A repository with an MCP server gated end-to-end: PR → workflow → scan + suite +
      assertions → PR comment with deltas; a deliberate budget breach fails the check —
      accepted: ____
