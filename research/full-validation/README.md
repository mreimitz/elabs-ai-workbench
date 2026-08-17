# Full-validation — production-readiness review

A complete review of the MCP Token Footprint app measuring the gap between the current state and a
**production release candidate**. Commissioned 2026-07-12. Covers dead code, hardcoded elements,
duplicated code, general bugs/correctness, security, optimization potential, docs accuracy, and an
actual run of the quality gate.

## how this was produced

Seven parallel deep reviews (API, web, shared+infra, dead-code tooling, security, docs) plus one
executed quality-gate run against a clean checkout. Every reviewer was required to verify each cited
`file:line` against source before writing it; Critical/High findings were independently re-verified.
Nothing here is speculative — findings are grounded in the code as of the 2026-07-12 working tree.

## the documents

| # | Document | What it covers | Findings |
| --- | --- | --- | --- |
| 02 | [`02-api-review.md`](./02-api-review.md) | `apps/api/src/**` (22 subdirs, ~46k LOC) | 1 C · 11 H · 35 M · 56 L |
| 03 | [`03-web-review.md`](./03-web-review.md) | `apps/web/src/**` (347 files) | 0 C · 3 H · 22 M · 30 L |
| 04 | [`04-shared-contract-infra.md`](./04-shared-contract-infra.md) | `packages/shared`, Docker, CI, e2e, config | 0 C · 2 H · 10 M · 12 L |
| 05 | [`05-dead-code-duplication.md`](./05-dead-code-duplication.md) | jscpd/knip/ts-prune/depcheck + manual verify | 3.36% dup · 2 dead files · ~12 dead exports · 1 dead dep |
| 06 | [`06-security-review.md`](./06-security-review.md) | secrets, zip ingest, injection, SSRF, container | 0 C · 1 H · 4 M · 6 L · 2 I |
| 07 | [`07-docs-consistency.md`](./07-docs-consistency.md) | CLAUDE.md/README/rules/roadmap vs code | 3 H · 5 M · 9 L |
| 08 | [`08-quality-gate.md`](./08-quality-gate.md) | Executed typecheck·test·build·lint | ✅ gate green |

## headline: the gate is green, the RC gap is small and sharp

The definition-of-done gate **passes on a clean checkout** — typecheck, lint, build, and 1532 API +
746 web tests all green (doc 08). The codebase is unusually well-engineered for its size: SSE
lifecycle, run-manager fan-out, secret encryption/redaction (AES-256-GCM, per-op random IV),
zip-bomb caps, parameterized SQL, migration discipline, and the streaming/terminal-error separation
all held up under targeted scrutiny. Web is remarkably clean — **zero** raw colors, palette classes,
`dark:` overrides, raw `fetch`, or raw interactive HTML across 347 files.

So the gap to a release candidate is not "make it work" — it's a **defined shortlist of latent
issues a passing gate cannot catch**: one path-traversal class of bug, git-sync data-safety gaps, no
graceful shutdown, a couple of leftover debug/dead artifacts, bundle-splitting, and stale docs.

## release-candidate blocker list (do these before tagging an RC)

Ranked by risk. Full detail + fix in the linked doc.

1. **Path traversal → arbitrary host file write/delete** — `POST /api/collections/:id/resolve`
   accepts an unconstrained `path` (`collections/routes.ts:17`) joined under the clone dir and
   `writeFileSync`/`rmSync`'d before git validates it (`collections/git-sync.ts:196`). A fix helper
   (`assertSafeRelativePath`) already exists in-repo. Critical local, worse on the planned
   team-server. *(02 C-1 / 06 H1)*
2. **Collections git-sync data-safety** — no per-collection mutex; `status()` mutates the worktree
   on a GET; `exportKind` can overwrite a *different* member's file and push the deletion, breaking
   its own "remote-only files untouched" invariant. *(02 H-1/H-5/H-6)*
3. **No graceful shutdown anywhere** — zero SIGTERM/SIGINT handlers (`index.ts:615`); on `pnpm
   start` the DB is never closed and MCP / Agent-SDK child processes are orphaned, so every deploy
   relies on crash-recovery reconciliation. *(02 H-9)*
4. **Leftover live debug dump** — `providers/model-catalog.ts:300-301` unconditionally
   `console.error`s up to ~6 KB of raw the vendor tenant assistant metadata on **every**
   `GET /api/providers/:id/models`; self-labeled "REMOVE", not env-gated like its siblings.
   *(02 H-10 / 05 #1 / 06 M3)*
5. **Resource leaks** — `openSession` leaks the MCP stdio child on a failed connect
   (`mcp/client.ts:342`); deleting a test/scenario cascade-deletes a live run's rows while the agent
   loop keeps spending (`testing/routes.ts:49` + `ON DELETE CASCADE`). *(02 H-11 + related)*
6. **Assistant "read-only" reference dir is writable** under auto-accept
   (`assistant/session-manager.ts:649`) — a prompt-injection persistence vector into future skill
   sessions. *(02 H, 06)*
7. **Skill ingest caps ignored on two paths** — `save-draft`/scaffold bypass the env-configured
   `SKILL_MAX_*` caps (`skills/routes.ts:532,738`); GitHub-import `subpath` traversal
   (`skills/git-service.ts:300`). *(02 H / 06 M2)*
8. **Deployment exposure** — `docker-compose.yml:11` publishes `8080` on `0.0.0.0` for a no-auth API
   that can spawn arbitrary stdio commands (= LAN RCE). Bind `127.0.0.1:8080:8080` until team-server
   auth lands. *(04 H / 06 M4)*
9. **Asset-proxy SSRF + auth-header leak** — `servers/routes.ts:169` follows redirects by default
   and forwards stored custom auth headers off-origin. Add `redirect:"manual"` + origin re-check +
   timeout. *(06 M1)*
10. **CI reality** — no `.github/workflows/ci.yml` is reachable in the project tree, yet README /
    CLAUDE.md / quality-gates.md all claim CI runs the four gates and e2e is wired in. Either it
    lives outside the project root or it doesn't exist; e2e is in no gate either way. *(04 H)*

## strongly-recommended before RC (not strict blockers)

- **Web bundle splitting** — one ~9.3 MB eager chunk (measured, doc 08); Monaco + React Flow +
  Mermaid + the *unreachable* Skill Design/Trace surfaces all ship on first paint. `React.lazy` the
  heavy routes. *(03 H1 + M1)*
- **`isTokenProfile` drift** — omits `generic_estimate` in two places (`App.tsx:1142`, `rows.ts:407`)
  so selecting that profile silently reverts on reload. *(03 H2 / 04 M)*
- **Dead code removal** — `insert-as-context` feature (built, tested, never wired), 2 unused web
  components, ~12 dead exports incl. 6 orphaned `lib/api.ts` wrappers, unused `pino` dep. *(03 H3 /
  05)*
- **Duplication cleanup** — save/diff dialog trio (~450 lines), grading judge-chain scaffolding
  (~340 lines across 5 modules), suite-table UI pair. 3.36% overall (≈2.2% excluding generated
  JSON). *(05)*
- **Docs truth-up** — CLAUDE.md still marks Skill IDE and Auto-Rating "🔜 Planned" though both
  shipped; rules docs say "web has no tests yet" (79 files exist) and "not a router" (it is);
  CHANGELOG frozen at 2026-07-02 through the heaviest feature wave. *(07)*
- **Unguarded `localStorage.setItem`** in two spots that can abort a report / unmount a view via the
  error boundary (`ServerReportDialog.tsx:187`, `CompatibilityView.tsx:99`). *(03 M2/M3)*

## totals

Across the six review docs: **1 Critical · 17 High · 71 Medium · 108 Low** (~197 findings; the
Critical and several Highs overlap across the API and security docs and are de-duplicated in the
blocker list above). None break the build; all are latent. The single Critical and the git-sync /
shutdown / debug-dump / leak Highs are the true RC gate.

## explicitly NOT verified here

- **Nothing visual / live** — no running app, no both-theme walk, no keyboard/a11y pass against the
  real UI (the roadmap ledgers already track owner-acceptance for those).
- **No live provider/tenant paths** — anything needing a real API key or the vendor cloud tenant (LLM
  judge grades, the vendor assistant runs, PTY assistant sign-in) was read, not executed.
- **Exact historical test counts** in the docs (1511/566) — the current suite is 1532/751; the doc
  numbers are stale snapshots, not validated point-in-time.
- The gate was run on Linux, not the owner's macOS; JS results transfer, native-binary specifics may
  not.
