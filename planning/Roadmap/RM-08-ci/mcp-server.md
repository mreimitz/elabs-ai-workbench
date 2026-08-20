---
type: "Work Package Spec"
title: "Workbench MCP server \u2014 plan (extends roadmap/ci/)"
description: "Status: PROPOSED 2026-08-18 \u2014 pending owner lock. New phase inside the CI & headless"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Workbench MCP server — plan (extends `roadmap/ci/`)

> **Status: PROPOSED 2026-08-18 — pending owner lock.** New phase inside the CI & headless
> automation workstream (referenced from this folder's README/STATUS as **Phase MCP**; WPs
> below numbered **WP M.1–M.4** to avoid renumbering the existing plan). Evidence:
> [`research/langfuse-landscape/`](../../Research/RS-05-langfuse-landscape/) — `01 §G10` and the
> `02` matrix row "Exposes an MCP server over itself": **every compared platform (Langfuse,
> LangSmith, Phoenix, Opik, Braintrust, Weave) ships one; the MCP workbench does not.**

## Why (and why here)

External agents are becoming the second operator of every tool in this category — Langfuse
ships a hosted MCP server + CLI "built for AI agents"; Phoenix builds `/mcp` into every
instance. For us the story is sharper: **the MCP bench must be MCP-operable.** A Claude Code
session working in a skill repo should be able to ask the bench "what did the last scan of
server X cost, which runs failed since skill v3, give me the run report" — and, with an
explicitly scoped token, kick off a scan or a suite run and read the graded result. That is
this workstream's mission (headless automation) delivered over a standard protocol; service
tokens (Phase 1) are its auth story, and `mcpfp` and the MCP server should share one
service layer.

We already own the hard parts: the typed contract in `packages/shared`, the Assistant's
23+ read tools with context envelopes, and an approval-gated write vocabulary. The MCP
server is largely a **re-projection of that tool surface** onto `@modelcontextprotocol/sdk`'s
server side — the same SDK the app already vendors as a client.

## Decisions to lock (proposed)

- **D-MCP1 — Transport & mount:** streamable HTTP served by the existing Fastify API (e.g.
  `/api/mcp`), same process, no sidecar. Stdio optional later via a thin launcher.
- **D-MCP2 — Trust model:** on localhost the server follows the app's no-auth-by-design
  posture (bind-scoped, same trust as the web UI). Any non-local exposure **requires a
  service token** (Phase 1); tokens carry scopes.
- **D-MCP3 — Read-first:** v1 ships read-only. Write tools (start scan, launch run-plan)
  arrive only behind explicit token scopes (`scan:run`, `runs:launch`) — the headless mirror
  of D-AS4's gated-writes principle; no interactive approval exists headless, so **scope =
  consent**, deletes stay excluded entirely.
- **D-MCP4 — One tool registry:** MCP tools, Assistant tools, and (later) `mcpfp` commands
  resolve to the same service functions and zod schemas in `packages/shared` — one source of
  truth, three surfaces. No logic in the MCP layer.
- **D-MCP5 — Dogfood gate:** the workbench **scans its own MCP server** in CI; the footprint
  report is a build artifact and a budget assertion (tool definitions under a token budget).
  Our own medicine, applied.
- **D-MCP6 — Feature flag:** ships behind a Settings › Features flag (registry precedent);
  off = 403 `feature_disabled` on the mount, nav untouched (no nav for it anyway).

## Work packages

### WP M.1 — Read-only MCP server core

Mount `@modelcontextprotocol/sdk` McpServer on the API (D-MCP1); project the read surface:
servers & scans (list, latest scan, per-tool footprints, findings), runs & reports (list via
RunFilter once available; run report JSON), skills (list, versions, footprint, security
surface), suites/collections + grades, compatibility results. Resources for the big
documents (run/scan reports) so hosts can read without token-heavy tool results. Tool
descriptions written to a token budget (D-MCP5 measures us). Tests: in-process MCP client
(SDK) against a seeded DB; gate green.

### WP M.2 — Service-token scopes on the MCP mount

Integrates Phase 1 tokens: Authorization header on the streamable-HTTP mount; scope
enforcement per tool family; localhost bypass per D-MCP2 (configurable off). Audit line per
tool call (reuses the request logging).

### WP M.3 — Scoped write tools

`scan:run` (trigger scan, return scan id + poll tool), `runs:launch` (run-plan submit with
the same estimate/cost-cap guardrails as the UI; returns run ids), `suites:run`. No deletes,
no config writes. Each write tool's description states its cost behavior (estimate preview
included in the result).

### WP M.4 — Agent onboarding + self-scan gate

`llms.txt`-style usage doc served at the mount; a "workbench agent playbook" page in
`user-guide/`; **CI job: the app scans its own MCP server and asserts the definition
footprint budget** (D-MCP5) — doubling as the first end-to-end proof of scan-over-own-mount.
Docs cross-link from README/CLAUDE.md.

Where it landed: `GET /api/mcp/llms.txt` (rendered by `apps/api/src/mcp-server/llms-txt.ts` from the
registered definitions + `WORKBENCH_MCP_TOOL_FAMILIES`, so the doc cannot drift from `tools/list`);
[`user-guide/20-workbench-mcp-server.md`](../../user-guide/DC-16-workbench-mcp-server/20-workbench-mcp-server.md); the gate is
`pnpm mcp:self-scan` (`apps/api/src/mcp-server/self-scan{,-cli}.ts` → gitignored
`.artifacts/mcp-self-scan/footprint.{json,md}`, exit 1 over budget / 2 on failure), run in CI by
`.github/workflows/mcp-self-scan.yml` and in `pnpm test` by
`apps/api/test/workbench-mcp-self-scan.test.ts`.

## Dependencies & sequencing

WP M.1 has **no dependency on Phase 1** under D-MCP2 (localhost trust) — it can run first if
prioritized; M.2 depends on service tokens; M.3 depends on M.2; M.4 closes. Runs-feed read
tools get richer after observability WP-1.1 (RunFilter) but don't block on it (v1: simple
filters). No migration expected; additive routes only; `assistant-route-operability` gate
unaffected (no new web route).

## Non-goals

Not a remote-tenant surface (team-server owns auth-for-humans); not a replacement for the
Assistant dock (in-app operation stays Assistant-first); no MCP *client* changes (the
analyzer side is untouched).
