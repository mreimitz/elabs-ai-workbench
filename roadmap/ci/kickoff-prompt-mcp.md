# Kickoff prompt — Workbench MCP server (ci · Phase MCP · WP M.1)

Paste this into a fresh Claude Code session at the repo root to start implementing.

---

Use the **next-wp** skill (`/next-wp`) with plan **`roadmap/ci/`** — target **Phase MCP,
WP M.1 only** (read-only MCP server core), run **solo** (it touches the contested surfaces
`packages/shared` and `apps/api/src/index.ts`; do not batch anything beside it).

**Read first, in order:**
1. `CLAUDE.md` — capability table + working rules; then `.claude/rules/` as it directs
   (architecture, mcp-and-security, quality-gates).
2. `roadmap/ci/mcp-server.md` — the Phase MCP plan: decisions **D-MCP1–6** and WPs
   **M.1–M.4**. This kickoff locks D-MCP1–6 — record that in the `roadmap/ci/STATUS.md`
   Decision log as your first ledger write (date · "D-MCP1–6 locked at kickoff" · pointer),
   and set the WP M.1 line to `in progress`.
3. `roadmap/ci/README.md` + `STATUS.md` — plan index, invariants, ledger discipline.
4. Evidence, skim: `research/langfuse-landscape/01-gap-analysis.md` §G10 and
   `04-roadmap-handoff.md` (why this exists: every compared platform ships an MCP server
   over itself; the MCP workbench must be MCP-operable).

**Scope of WP M.1 (from `mcp-server.md` — implement only this):** mount an
`@modelcontextprotocol/sdk` **McpServer over streamable HTTP** on the existing Fastify API
(e.g. `/api/mcp`, same process — D-MCP1); **read-only v1 tool families**: servers & scans
(list, latest scan, per-tool footprints, findings), runs & reports (list with simple filters,
run report), skills (list, versions, footprint, security surface), suites/collections +
grades, compatibility results; **resources** for the big report documents; localhost trust
per the app's no-auth posture (D-MCP2 — token scopes are WP M.2, not yours); behind a
**Settings › Features flag** per the feature-flags registry precedent (off → the mount
answers 403 `feature_disabled`); tool descriptions written to a deliberate token budget
(D-MCP5 will measure us with our own scanner).

**Hard rules:** contract-first (`packages/shared` types + zod before API); additive-only
wire; the API remains the only process touching MCP/secrets — the new mount reuses the
existing service/repository layer (D-MCP4: no logic in the MCP layer; re-project, don't
reimplement); **no new runtime dependency** (`@modelcontextprotocol/sdk` is already a
dependency — you are using its server side); **no DB migration expected** — if one becomes
unavoidable, stop and claim the next free `user_version` per the cross-workstream convention
first; no deletes and no write tools of any kind in M.1; kebab-case files, tests co-located.

**Gate (definition of done):** `pnpm typecheck && pnpm test && pnpm build && pnpm lint`
green from the repo root, plus in-process MCP-client tests (SDK client against the Fastify
instance with a seeded DB) covering initialize, tools/list, each tool family happy path +
one invalid-args case, resource read, and the feature-flag 403.

**Real-runtime verification (mandatory — do it yourself, do not hand it to the owner):**
1. `pnpm build && pnpm start`, then connect **MCP Inspector**
   (`npx @modelcontextprotocol/inspector`) to `http://127.0.0.1:8080/api/mcp` — initialize,
   list tools, call at least three read tools against real seeded data; capture the evidence
   in your report.
2. **The self-proof:** in the running app, add `http://127.0.0.1:8080/api/mcp` as a
   streamable-HTTP server and run a **discovery scan — the workbench scanning its own MCP
   surface**. Record the measured definition footprint in the WP report (this number seeds
   the WP M.4 budget assertion). No provider key is needed for any of this.
3. Flip the feature flag off → the mount 403s (`feature_disabled`) → flip back on.

**Report honestly:** lead with what you did **not** verify (e.g. the both-theme walk of any
Settings/flag UI you touched is owner-acceptance; say so). Tick WP M.1 in
`roadmap/ci/STATUS.md` only when the gate is green and every acceptance item above holds;
record date + branch (`wp/ci/M.1`).

**Then stop and offer the next batch:** WP M.4 (self-scan CI gate — dep M.1 ✅) and/or
`roadmap/observability/` **WP 3.5 agent-graph lens** (proposed, deps built — needs owner
lock), or ci WP 1.1 (service tokens, prerequisite for M.2).
