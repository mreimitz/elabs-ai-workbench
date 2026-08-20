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
- [x] WP 1.1 — contract + service tokens: `api_tokens` (hashed, scoped), auth middleware, Settings UI
      — done 2026-08-19 · `wp/ci/1.1` · spec: [`wp-1.1-service-tokens.md`](./wp-1.1-service-tokens.md).
      Contract-first in `packages/shared/src/api-tokens.ts` (the **frozen D-C4 vocabulary** `read` ·
      `scan:run` · `runs:launch` · `suites:run`, the wire shapes, the zod schemas, and the coarse
      method→scope rule declared **once**); `api_tokens` at **`user_version` 58** (SHA-256 of the full
      `mcpfp_…` plaintext, UNIQUE so auth is one indexed lookup; an 8-char display prefix; a JSON scope
      array; throttled `last_used_at`); `apps/api/src/api-tokens/{repository,service,routes,guard}.ts`
      with `GET`/`POST /api/tokens` + `DELETE /api/tokens/:id` (the plaintext exists **only** in the
      create response — never persisted, never listed, never logged); and Settings › **API tokens**
      (`@elabs-ai/components-*` only, `IconButton` row action, one-time reveal with copy, revoke behind a
      confirm). **No migration hazard** (brand-new table, no FK), **no new dependency**
      (`node:crypto`), `pnpm-lock.yaml` unchanged, **no new `<Route>`** — `ASSISTANT_ROUTE_MANIFEST`
      has a zero-byte diff and the `assistant-route-operability` gate is untouched.
      **The guard's posture (D-C2):** loopback passes exactly as before (the local browser UI is
      unregressed), any non-loopback caller must present a valid bearer token,
      **`API_AUTH_REQUIRED=true`** extends that to loopback, `GET /api/health` is always exempt, a
      *presented* token is always verified (a bad one is 401 even from 127.0.0.1), and loopback is
      decided from `request.socket.remoteAddress` — never a header, with `trustProxy` pinned off by
      test. Coarse scopes only: safe methods need `read`, unsafe methods need an execute scope,
      **`DELETE` is refused for any token** (D-MCP3), and a token may never reach `/api/tokens*`.
      Per-route scope mapping is deliberately left to WP M.2/M.3.
      **Two review rounds — the first cut was bypassable.** An orchestrator path-shape probe found
      that the guard prefix-matched the **raw** request target while Fastify's router percent-decodes
      **before** matching: `/%61pi/tokens` (`%61` = `a`) read as "not under `/api`", the guard passed
      it, and the router then dispatched it to the real `GET /api/tokens` handler — a remote,
      unauthenticated caller could reach the entire API, token CRUD included. Fixed with a shared
      `apps/api/src/utils/request-path.ts` that matches the **union** of the raw and decoded forms and
      treats an undecodable path as governed (always at least as inclusive as the router). **The same
      bypass existed on `main` in the feature-flag guard** — `/%61pi/assistant/…` slipped past
      `feature_disabled`, defeating the "a stale tab or a direct curl cannot keep spending" property —
      and is fixed here on the same helper. Both fixes are pinned by tables that were confirmed to
      **fail against the pre-fix code**.
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`pnpm typecheck && pnpm test && pnpm build && pnpm lint` → **exit 0**; shared 94 · api 3307 ·
      web 3248 passed + 5 skipped · build · lint clean) and an **independent** adversarial probe —
      44 requests over 22 path shapes from a non-loopback socket with no credential, **zero leaks**
      (`/api/health` exempt as designed). **Not independently verified:** the both-theme + keyboard
      walk (A13) — the implementing agent reports driving the built app in Chromium with screenshots
      in both themes and a worst text contrast of 5.71:1 light / 6.47:1 dark, but the orchestrator did
      not re-run it; it stays an owner-acceptance item below.
      ⚠️ **`main` itself is currently red for an UNRELATED reason** — not this WP. Commit `4eddf6f`
      (a model-dataset refresh, committed to `main` mid-session by the owner's identity) grew the
      compatibility roster 33 → 55 models without regenerating the bundle or updating the count the
      test pins, so `apps/api/test/compatibility-data.test.ts` fails 2 of its 8. **Both failures
      reproduce on `4eddf6f` with none of WP 1.1 present**, and all 88 api + 12 web tests this WP
      added pass on merged `main`. Fix belongs to that dataset work: `pnpm build:model-data`, then
      update the hardcoded `33` at `apps/api/test/compatibility-data.test.ts:53`.
- [x] WP 1.2 — `mcpfp` CLI skeleton: config, `scan` + `report`, JSON/markdown output
      — done 2026-08-19 · `wp/ci/1.2` · spec: [`wp-1.2-mcpfp-cli.md`](./wp-1.2-mcpfp-cli.md).
      New workspace package **`apps/cli`** (D-C1) exposing the **`mcpfp`** bin: `scan <id|name>` ·
      `report {scan,server,run,fleet}` · `servers` · `scans` · `config show` · `help` · `--version`,
      with `--url --token --timeout --config --format --output --quiet` and config resolved
      **flag > env > `mcpfp.config.json` (found by walking up) > default**. Contract-first in
      `packages/shared/src/cli-contract.ts` (`MCPFP_OUTPUT_VERSION` · `McpfpOutput<T>` ·
      `MCPFP_EXIT`), so WP 1.3's `assert` and WP 2.2's PR artifact extend **one** envelope.
      **No API route, no migration, no `<Route>`** — `apps/api/src/`, `apps/web/src/`,
      `pnpm-workspace.yaml` and `packages/shared/src/api-tokens.ts` all have a **zero-line diff**,
      and the `assistant-route-operability` gate is untouched. Decisions **D-C5 / D-C6 / D-C7**
      recorded in the decision log below.
      **The client invariant is enforced, not just asserted:** `apps/cli`'s only runtime dependency
      is `@mcp-token-footprint/shared`, pinned by a test that reads the manifest **and** scans every
      import in `apps/cli/src` — so no future convenience can quietly pull in the MCP SDK,
      `better-sqlite3` or `commander`. Redaction is likewise structural: one `Emitter`, and every
      string it writes to stdout/stderr/a file passes a token-shaped mask, which also catches an API
      error body that echoed the credential back.
      **Two measured deviations from the spec, both documented rather than papered over.** (1) The
      spec's A3 said "`pnpm-lock.yaml` unchanged"; it necessarily gains the **16-line `apps/cli`
      importer entry** and **zero packages** (`packages:`/`snapshots:` byte-identical). The
      orchestrator verified the claim by reverting the entry and running `pnpm install
      --frozen-lockfile` → **`ERR_PNPM_OUTDATED_LOCKFILE`**, which would break the `Dockerfile` (2
      call sites) and `.github/workflows/mcp-self-scan.yml`. The invariant that mattered — nothing
      new resolved or downloaded — holds. (2) **`pnpm exec` and `pnpm --silent` collapse a non-zero
      child exit to `1`** — straight onto the code D-C7 reserves for assertion failures — and
      `pnpm`'s banner lands on **stdout**, breaking `--format json > file`. The root `pnpm mcpfp`
      script therefore uses `pnpm --filter … run mcpfp --` (which preserves `2`) and is documented
      as a **dev convenience only**; the CI invocation is `pnpm build` once, then
      `node apps/cli/dist/index.js …`.
      **Verified by the orchestrator on the branch, not taken on report:** `pnpm typecheck` → 0 ·
      `pnpm build` → 0 · shared + **cli 46/46** + **web 316 files, 3248 passed / 5 skipped** (exit
      0) · **api 3305/3307**, the 2 failures being exactly the pre-existing dataset ones below.
      **Independent live smoke** against a freshly built API on `127.0.0.1:8123` with a throwaway
      `DATA_DIR`: `servers` and `report fleet` answer over **loopback with no token** (D-C2 proven
      from a real client); `--format json` stdout is **byte-exact `JSON.parse`-able** while
      narration sits on stderr; `--quiet` empties stderr without touching the payload; `--output`
      creates parent directories, leaves stdout empty and writes a parseable file; and against the
      **real WP 1.1 guard** a malformed `--token` fails **before** the network (exit 2), an unknown
      well-shaped token returns the `invalid_token` sentence, an unreachable port returns
      "No workbench API at … — is it running?", `--format markdown` on `servers` is refused naming
      the supported formats, and a **`read`-only token running `scan` gets the scope sentence naming
      `scan:run`** — with the minted secret appearing in **no** stream (`config show` renders
      `mcpfp_xxxxxxxx…` only).
      ⚠️ **`pnpm lint` is red on `main`, and was before this WP** — a *third* symptom of commit
      `4eddf6f` (below): it grew `research/token-context-comparison/comparison/all-models.json` to
      **1.8 MiB**, over Biome's 1 MiB default cap. Verified independently on a clean `main`
      checkout with `biome check ./research`. Every file this WP adds is lint-clean.
      **Owner-acceptance items** (nothing visual here — the CLI has no UI): a real CI job invoking
      `node apps/cli/dist/index.js` and gating on its exit code, and a **remote** (non-loopback)
      invocation with a service token — both listed below.
      ⚠️ **Correction from WP 1.3:** the "every string it writes passes a token-shaped mask" claim
      above held only for strings routed through the `Emitter`. `runCli`'s top-level catch wrote to
      the **raw** stderr stream, so an API error body echoing the `Authorization` header back was
      printed **unmasked** (the four recognized guard codes get canned sentences that never quote the
      body, which is why the WP 1.2 test missed it). Fixed in `wp/ci/1.3` by routing that handler
      through the same `redactTokens`, pinned by two tests the orchestrator confirmed **fail against
      the pre-fix code**.
- [x] WP 1.3 — assertions engine + `assert` command: footprint/delta rules, exit codes
      — done 2026-08-19 · `wp/ci/1.3` · spec: [`wp-1.3-assertions.md`](./wp-1.3-assertions.md).
      Contract-first in `packages/shared/src/ci-assertions.ts` (`ASSERTIONS_VERSION` ·
      `ASSERTION_RULE_KINDS` · the `.strict()`-at-every-level document schema · `AssertionReport`),
      a server-side engine at `apps/api/src/assertions/{service,routes}.ts` behind
      **`POST /api/assertions/evaluate`**, and **`mcpfp assert [file]`**
      (`--server --scan --baseline --file --format human|json --output --quiet`) with the gate file
      found by the same walk-up `mcpfp.config.json` uses. Six rule kinds — `max-server-tokens` ·
      `max-tool-tokens` (all tools, or one by name, where a **missing** named tool FAILS) ·
      `max-tool-count` · `no-new-tools` · `no-removed-tools` · `max-scan-delta` (absolute magnitudes,
      so a large DROP fails too). **No migration, no new dependency, no `<Route>`, no feature flag**
      — `apps/web/src/`, `packages/shared/src/assistant-route-manifest.ts`,
      `packages/shared/src/api-tokens.ts`, `apps/api/src/api-tokens/`, `apps/api/src/db/`,
      `pnpm-lock.yaml` and `apps/cli/package.json` all have a **zero-line diff** (verified by the
      orchestrator with `git diff 001c8fc..HEAD -- …`). Decisions **D-C3** (owner, at kickoff) and
      **D-C8 / D-C9 / D-C10** recorded in the decision log below.
      **Every baseline question re-projects `buildComparison` (D-MCP4)** — the exact→normalized→fuzzy
      matcher and its `deltasComparable` guard — so this workstream has no second differ. The
      comparison is built as `buildComparison(baseline, subject)`, i.e. **A is the baseline, B is the
      subject**, so `onlyInB` is "added"; the direction is pinned by a test because getting it
      backwards inverts two rules silently.
      **A defect in WP 1.2 was found and fixed here, not deferred.** `runCli`'s top-level catch wrote
      to the **raw** stderr stream rather than through the `Emitter`, so an API error body that echoed
      the `Authorization` header back reached an operator's build log **unredacted** — the WP 1.2
      ledger line's "every string it writes passes a token-shaped mask" was true only of strings
      routed through the emitter, and the four *recognized* guard codes get canned sentences that
      never quote the body, which is why the WP 1.2 test missed it. Fixed by routing that handler
      through the **same** `redactTokens` (not a second masker). **Orchestrator-verified with teeth:**
      reverting just the fix makes both pinning tests fail (`A9 — the token never reaches stdout,
      stderr or the output file` and `A12 — an UNRECOGNIZED status echoing the token is redacted too`
      → `# fail 2`), then passes again restored.
      **Three deliberate deviations from the spec, all reviewed and accepted:** (1) the result type is
      `AssertionRuleResult`, not the spec's `AssertionResult` — that name is already taken in the same
      package by the Benchmarks/SkillFlow **test-gate** assertions, and two exports cannot share a
      name through `index.ts`; (2) a `failed`/`running` scan named as the **subject** is a 400, not
      just as the baseline — a zero-tool failed scan would otherwise satisfy every budget; (3) both
      subject and baseline resolution share one `newestFirst` comparator (`scannedAt` desc, then id
      desc), because `ORDER BY scanned_at DESC` alone is not a total order and two scans in the same
      millisecond made "the newest scan" depend on row order.
      **Verified by the orchestrator on the branch, not taken on report:** the full gate re-run
      (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) — shared **94** · cli **63** (was 46)
      · api **3325 passed / 2 failed** · web **328 files, 3444 passed + 5 skipped** · build **0** —
      with the only failures being the three **pre-existing** ones below; the zero-diff list above;
      the redaction teeth; and the D-C8 case-3 test's use of `maxTokens: 0`, a bound a
      suppressed-to-zero delta would satisfy, so it fails against any implementation that lets the
      fake zero through. **Not independently re-run by the orchestrator:** the implementing agent's
      live end-to-end walk (a built API on a throwaway DB, two real scans of the workbench's own
      `/api/mcp` mount, then the built CLI through walk-up discovery, a first-scan SKIP → 0, a
      breaching gate → 1, an unknown baseline → 2, `--output`/`--quiet`, and a `read`-only token
      getting the D-C10 scope sentence).
      ⚠️ **Pre-existing failures, none of them this WP** (the branch was cut at `001c8fc`): the two
      `apps/api/test/compatibility-data.test.ts` dataset failures and the Biome 1 MiB-cap lint error
      on `research/token-context-comparison/comparison/all-models.json`, both from `4eddf6f` and both
      already recorded above; plus **4 `apps/web` typecheck errors** in the dashboard-overview tile
      test fixtures, which arrived with `001c8fc` and were **fixed on `main` by `998f84b`** while this
      WP was in flight — so they are absent from the merged tree.
      **Open observations for WP 2.2 to decide on** (implemented as specified, flagged rather than
      silently chosen): an explicit `--baseline` is **inert** when no rule in the gate consumes one
      (resolution is lazy by design, so a typo'd id is not reported in that case — the report prints
      `Baseline  none`); an explicit baseline **equal to the subject** is accepted as a trivially
      passing self-compare (the strictly-older rule applies only to `"previous"`); and
      `mcpfp.assert.json` is deliberately **not** gitignored — a gate file carries no credential and
      is the record of what the team agreed the footprint may cost.

## Phase 2 — Suites & PR artifacts
- [x] WP 2.1 — `suite run` command: trigger, poll/stream, result summary — done 2026-08-20 ·
      `wp/ci/2.1` · spec: [`wp-2.1-suite-run.md`](./wp-2.1-suite-run.md).
      `mcpfp suite run <suite>` starts a saved suite's matrix (`POST /api/suites/:id/run`) and, by
      default, **waits by polling** `GET /api/suite-runs/:id` until it settles, then prints the
      summary and the ten worst-scoring members. `<suite>` is an id **or an exact name**, resolved
      id-first exactly as `mcpfp scan` does — `GET /api/suites` is requested **only** after a 404, so
      a token minted with `suites:run` alone is not 403'd for a job it can do. Exit codes (D-C11):
      `completed` → **0**; `error` · `capped` · `stopped` · a wait budget exhausted while still
      running → **2**; **never `1`**, which stays reserved to `mcpfp assert` (D-C7). The wait covers
      the post-run **rating** as well as the terminal status — the same pair the suite SSE stream
      waits for — so a summary is never published while member grades are still landing; a budget
      that expires on a terminal-but-unrated run keeps the status-derived code and prints a warning
      **`--quiet` does not silence**. `--format json`'s `data` is `McpfpSuiteRunResult`
      (`{ suiteRun, members }`, D-C12), each half verbatim from its endpoint. Decisions **D-C11 /
      D-C12** in the log below. **No API change** (`apps/api/**` zero-diff), no schema change, no
      migration, **no dependency** (`apps/cli`'s only runtime dep is still `@mcp-token-footprint/shared`,
      and `pnpm-lock.yaml` is byte-identical).
      **Two stale-doc corrections folded in, both of which this WP owns because it owns `apps/cli`:**
      `help.ts` no longer claims a remote `mcpfp assert` caller needs an execute scope (it needs
      **`read`** — D-C10, closed by WP M.2), and the configuration paragraph now states that
      `suite run` needs **`suites:run` plus `read`**.
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`typecheck` **0** · shared **97/97** · cli **81/81** [63 before] · api **3344 passed / 7
      failed** — the pre-existing compatibility-roster failures — · `build` **0** · `lint` **2**
      errors, both the pre-existing oversized `all-models.json`; web **3556 passed / 5 skipped**, run
      separately — every number byte-identical to the independently measured baseline); the
      eight-file diff and every zero-diff claim; and **three independent teeth checks** — planting
      `MCPFP_EXIT.assertionFailure` in `suite-run.ts` turned the D-C7 source-scan test red, letting
      `capped` exit 0 turned the D-C11 exit-code table red, and demoting the rating warning from
      `warn` to `narrate` turned the `--quiet`-survival test red; all three restored, `git status`
      clean.
      **Not independently re-run by the orchestrator:** nothing was exercised against a live API or a
      real suite matrix — every test drives the CLI in-process against a `node:http` stub, so the
      404-on-unknown-suite behaviour of `POST /api/suites/:id/run` is inferred from
      `apps/api/src/suites/orchestrator.ts:338`, not observed.
      **Follow-up this WP surfaced and did not take** (one line, for WP 2.2, which owns
      `commands/assert.ts`): `apps/cli/src/commands/assert.ts:82` still sends `scope: "scan:run"` on
      `POST /api/assertions/evaluate`. The field only words a 403 message, so nothing is broken — but
      a `scope_forbidden` on `assert` now names the wrong scope. The same stale claim also survives in
      two places in `user-guide/22-mcpfp-cli.md` (the `assert` row of the permissions table, and the
      `#### Permissions` paragraph under `assert`), which this WP's spec scoped to `help.ts` only.
- [ ] WP 2.2 — suite/grade assertions + baseline-delta PR-comment artifact — depends: 1.3 ✅, 2.1 ✅ · spec: [`wp-2.2-suite-assertions-artifact.md`](./wp-2.2-suite-assertions-artifact.md)
- [ ] WP 2.3 — GitHub Actions packaging: workflow example + docs — depends: 2.2 · spec: [`wp-2.3-github-actions.md`](./wp-2.3-github-actions.md)

## Phase 3 — Posture integration
- [ ] WP 3.1 — `no-new-security-findings` assertion — depends: 1.3 ✅, security-posture 1.2 · spec: [`wp-3.1-no-new-security-findings.md`](./wp-3.1-no-new-security-findings.md). **Serialize after WP 2.2** — both edit `packages/shared/src/ci-assertions.ts` and `apps/api/src/assertions/service.ts`.

## Phase MCP — workbench MCP server (see [`mcp-server.md`](./mcp-server.md))
- [x] WP M.1 — read-only MCP server core: streamable-HTTP mount, read tools + report resources, feature flag — done 2026-08-19 · `wp/ci/M.1`. 21 read tools + 4 report resource templates at `/api/mcp` (stateless streamable HTTP, GET/DELETE→405); new `mcp_server` Settings › Features flag (off ⇒ 403 `feature_disabled`); no new dependency, **no migration** (`user_version` 57 unchanged), additive-only wire. Gate green (shared 89 · api 3254 · web 3178+5 skipped · build · lint). **Live-verified against the built API on a copy of a real 91 MB dev DB**: MCP Inspector `initialize`/`tools/list`/7 tool calls, `resources/read` of a real run report, error + validation paths, flag off→403→on, off-state survives restart, fresh-DB boot. **Self-proof (D-MCP5 seed): the workbench scanned its own mount — 21 tools · 2,224 tokens · 200 resources (`generic_o200k`, countingVersion 2)**; the in-test `tools/list` measurement is 2,206 against a budget of 3,000 (`WORKBENCH_MCP_DEFINITION_TOKEN_BUDGET`). Owner-acceptance pending: the both-theme + keyboard walk of the new Settings › Features row.
- [x] WP M.2 — service-token scopes on the mount (localhost bypass per D-MCP2) — done 2026-08-20 ·
      `wp/ci/M.2` · spec: [`wp-m.2-mount-scopes.md`](./wp-m.2-mount-scopes.md).
      Two mechanisms, both contract-first. **(a) Per-route scope overrides** —
      `API_TOKEN_ROUTE_SCOPES` + `requiredScopesForRoute` in `packages/shared/src/api-tokens.ts`,
      consulted by the guard **before** the coarse method rule, which stays exactly as it was behind
      it. Two entries, and a test asserts there are only two: **`POST /api/mcp → read`** (D-MCP8) and
      **`POST /api/assertions/evaluate → read`** (closing D-C10, WP 1.3's inherited item). **(b)
      Per-tool scopes on the mount** — `WORKBENCH_MCP_TOOL_SCOPES` (all 21 read tools at `read`),
      enforced at dispatch in `mcp-server/server.ts` as an **`isError` result naming the missing
      scope** (what an MCP host actually shows the model), with a tool ABSENT from the map refused to
      every token; plus one audit line per tool call carrying the token's **display prefix**, never
      the secret. Decisions **D-MCP7 / D-MCP8 / D-MCP9** recorded in the decision log below.
      **The security boundary held, and was checked rather than assumed:**
      `packages/shared/src/api-tokens.ts` has a **zero-deletion** diff (the frozen D-C4 vocabulary and
      `requiredScopesForMethod` are byte-identical, their tests passing untouched); the route-rule
      type has **no `DELETE` member**, so a delete rule is a compile error, and `requiredScopesForRoute`
      short-circuits `DELETE` before the table is read; no rule may target `/api/tokens*` (asserted),
      and the guard's token-CRUD refusal still runs first; loopback is still decided from the socket;
      a presented token is still always verified. **No migration, no new dependency, no new
      environment variable** (D-MCP7 — `API_AUTH_REQUIRED` stays the only switch), no `<Route>`, no
      web change, **no write tool** (A8's write-scoped tool is fabricated inside the test file).
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`typecheck` **0** · shared **97** · cli **63** · api **3349 passed / 2 failed** — the two
      pre-existing dataset failures — · `build` **0** · `lint` **1**, the pre-existing 1.8 MiB
      research JSON and nothing else); the zero-diff list; and **two independent teeth checks**:
      swapping the strict (raw-AND-decoded) matcher for the inclusive one in the guard turns
      `M.2/A5 (D-MCP9) — an ambiguous path does NOT inherit a relaxed rule` **red** (33/34), and
      deleting one entry from `WORKBENCH_MCP_TOOL_SCOPES` turns the A7 key-set test **and** the A11
      generated-`llms.txt` test **red** — both restored afterwards.
      **Not independently re-run by the orchestrator:** the implementing agent's live walk against a
      built API on a throwaway DB (a `read` token completing a real `tools/call`; a `scan:run`-only
      token refused at the door with "one of: read"; `POST /%61pi/mcp --path-as-is` refused quoting
      the *execute* scopes, i.e. the relaxation correctly not applying on the wire; one audit line
      with the display prefix and no plaintext anywhere in the log).
      **Three deviations from the spec, all reported rather than taken silently:** (1)
      `AuthenticatedApiToken` gained a `tokenPrefix`, read from the **existing** `api_tokens.token_prefix`
      column — the alternative was re-deriving it from the `Authorization` header, which would put a
      plaintext credential into the MCP layer; additive, no migration. (2) A documented **test seam**
      (`WorkbenchMcpServerOverrides`) on `createWorkbenchMcpServer`/`registerWorkbenchMcpRoutes`, because
      A8 demands a write-scoped tool and none exists until WP M.3; production passes nothing, and
      nothing request-derived is ever forwarded into it. (3) An `UNDECLARED_TOOL_SCOPE` marker so an
      undeclared tool's refusal says *the server is broken* instead of naming a permission that does
      not exist.
      **Orchestrator note (latent, not a defect today):** `createWorkbenchMcpServer`'s `caller`
      parameter **defaults to `TRUSTED_LOCAL_CALLER`** (allow-everything). The only call site passes a
      real caller explicitly (verified by grep — `routes.ts:94` is the sole one), so nothing is open
      today, but a default-open parameter in an authorization path is worth making required if WP M.3
      adds a second embedding.
      **Follow-up this WP could not make (it was told not to touch `apps/cli`):**
      `apps/cli/src/help.ts:142-143` still says a remote `mcpfp assert` caller needs an execute scope.
      That sentence is now false — `POST /api/assertions/evaluate` needs only `read`. One comment-sized
      edit, for WP 2.x or a follow-up.
- [x] WP M.3 — scoped write tools: `scan:run` · `runs:launch` · `suites:run` — done 2026-08-20 ·
      `wp/ci/M.3` · spec: [`wp-m.3-write-tools.md`](./wp-m.3-write-tools.md).
      **Three write tools, one per execute scope in the frozen D-C4 vocabulary** — `scan_run`
      (`scan:run`) re-projecting `ScanService.runScan`, `suite_run_start` (`suites:run`) re-projecting
      `SuiteOrchestrator.startSuiteRun`, `run_plan_start` (`runs:launch`) re-projecting
      `resolveRunPlan` + `startPlanRun`. **`run_plan_start` refuses `source: "suite"` twice** — the
      enum has no such member (the SDK rejects it before dispatch) and the handler rejects the string
      again naming `suite_run_start` — so `runs:launch` is never a back door onto a saved suite and
      `suites:run` is not decorative. Each tool answers with a **ticket, not an outcome** (D-MCP11)
      and names the read tool that polls it (`scans_get` / `suite_runs_get`, both already `read`); a
      `failed` scan comes back as an **`isError`** result so an agent cannot read a zero-tool scan as
      a clean bill of health. Both launch tools carry the launcher's **own** advisory estimate
      (`buildRunPlanEstimate`, re-projected by import — D-MCP12), which never blocks a launch and
      degrades to `estimate: null` + a note if it throws. Decisions **D-MCP10–D-MCP13** in the log
      below. **No migration, no new dependency, no new environment variable, no feature flag, no web
      change** — `apps/web/**`, `apps/cli/**`, `packages/shared/src/api-tokens.ts`,
      `apps/api/src/api-tokens/**`, the three assistant shared modules, `apps/api/src/assistant/**`,
      `feature-flags.ts`, `apps/api/src/db/**`, `pnpm-lock.yaml`, every `package.json`, `.env.example`
      and `config/env.ts` all measured at **zero lines**.
      **WP M.2's gate absorbed the first tools that actually need it with zero change to itself** —
      `missingScopeForTool`, `withScopeEnforcement`, `scopeRefusal` and `UNDECLARED_TOOL_SCOPE` are
      byte-identical. That was the point of building the mechanism before the tools, and it held.
      **The mount now measures 24 tools · 2,749 definition tokens against the UNCHANGED 3,000 budget**
      (`pnpm mcp:self-scan`, exit 0; ~8% headroom). The budget constant was not raised.
      **D-MCP13 closed a latent default-open path:** `createWorkbenchMcpServer`'s `caller` parameter
      used to default to `TRUSTED_LOCAL_CALLER` (allow-everything). Harmless while every tool was a
      read; a forgotten argument would now hand a second embedding the three write tools. The default
      is removed, `TRUSTED_LOCAL_CALLER` stays exported for embeddings that legitimately are trusted
      and local, and omitting the argument is a compile error.
      **Verified by the orchestrator, not taken on report:** the gate re-run on the branch
      (`typecheck` **0** · shared **102/102** · cli **63/63** · api **3374 passed / 7 failed** — the
      pre-existing compatibility-roster failures, byte-for-byte the measured baseline's — · `build`
      **0** · `lint` **2** errors, both the pre-existing oversized `all-models.json`; web **3556
      passed / 5 skipped**, run separately); `pnpm mcp:self-scan` → **24 tools · 2749 tokens · within
      budget**, exit 0; every zero-line-diff claim; and **three independent teeth checks** — making
      `missingScopeForTool` return `null` unconditionally turned **11** scope tests red across both
      suites, deleting `scan_run`'s entry from `WORKBENCH_MCP_TOOL_SCOPES` turned the shared key-set
      and write-surface gates red, and disabling the D-MCP10 handler refusal turned its test red; all
      three restored, `git status` clean.
      **Three deviations from the spec, all declared rather than taken silently, all accepted:**
      (1) `apps/api/src/mcp-server/llms-txt.ts` was modified though the spec did not list it —
      compile-forced (`WorkbenchLlmsTxtTool.name` was typed to the *read* tool union) and
      acceptance-forced (A11 requires the doc to say an execute scope is needed **plus** `read`, and
      its static "Read-only, by construction" section had become a false claim). (2)
      `apps/api/test/workbench-mcp-self-scan.test.ts` was modified — it pinned the tool count to the
      read list and went red at 24. (3) `server.ts` changed more than "signature + JSDoc": its
      `initialize` `instructions` string said *"Read-only access… Nothing here starts a scan, launches
      a run"*, which is the first thing every host reads and would have been a lie. Rewritten to name
      the three action tools and keep the absolute that is still true (nothing deletes, nothing
      changes configuration).
      **Not verified:** nothing was exercised against a live provider or a real third-party MCP
      server — `scan_run`'s success path scans this app's *own* mount, and the launch tools were
      driven with a stubbed run starter, so no provider token was ever spent and the estimate's dollar
      figures were never checked against a real invoice. `pnpm lint`'s clean half is inferred from the
      error **count** (Biome exits 1 on the pre-existing oversized JSON), not from a green run.
      **Two notes for later, neither a defect:** `WORKBENCH_MCP_READ_TOOL_NAMES`' JSDoc still says "a
      gate test asserts this set-equals what `tools/list` returns", which is now true of the union
      rather than of the read half alone — left untouched deliberately, because the spec listed that
      symbol as byte-identical. And `pnpm mcp:self-scan` reports **2** resources where the WP M.1 line
      above records 200: pre-existing and expected, since the self-scan's throwaway DB holds only its
      own in-flight scan.
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

- **2026-08-20 · D-MCP10 / D-MCP11 / D-MCP12 / D-MCP13 locked at the WP M.3 kickoff** (the scoped
  write tools). Full text + the design they bind:
  [`wp-m.3-write-tools.md`](./wp-m.3-write-tools.md). Declared in
  `packages/shared/src/workbench-mcp.ts` + `apps/api/src/mcp-server/{tools,server}.ts` and pinned by
  `packages/shared/src/workbench-mcp.test.ts` +
  `apps/api/test/{mcp-server-write-tools,mcp-server-scopes,workbench-mcp-server}.test.ts`.
  - **D-MCP10 — exactly three write tools, one per execute scope, and the scope decides the tool.**
    `scan_run` needs `scan:run`; `suite_run_start` needs `suites:run`; `run_plan_start` needs
    `runs:launch`. The mapping is declared once, in `WORKBENCH_MCP_TOOL_SCOPES`, and nowhere else.
    **`run_plan_start` refuses `source: "suite"`** and names `suite_run_start` in the refusal, so a
    `runs:launch` token can never run a saved suite through the generic plan endpoint — without that
    refusal the two scopes would be indistinguishable in practice and `suites:run` would be
    decorative. The refusal is enforced twice: the tool's `source` enum has no `"suite"` member (the
    SDK rejects it before dispatch) and the handler rejects the string again with a readable
    `isError` result, never a validation crash.
  - **D-MCP11 — a write tool answers with the ticket, not the outcome, and names the read tool that
    finishes the job.** `scan_run` is synchronous in the API (`ScanService.runScan` awaits), so it
    returns a **compact scan summary** — never a full `ScanDetail`, whose per-tool definitions would
    blow a host's context — and a scan that comes back `failed` is returned as an **`isError`**
    result, so an agent cannot read a zero-tool scan as a clean bill of health (the same distinction
    `mcpfp scan` draws with exit 2, D-C7). The two launch tools are asynchronous by construction (the
    orchestrator returns a `running` `SuiteRun` immediately), so they return the suite-run id +
    status and point at `suite_runs_get`. **No write tool blocks on a matrix, no write tool has a
    `wait` mode, and no polling tool was added** — `scans_get` and `suite_runs_get` already exist and
    are already `read`.
  - **D-MCP12 — every launch tool carries an advisory cost estimate, and it is the SAME estimate the
    UI's launcher shows.** `buildRunPlanEstimate` (`apps/api/src/estimate/service.ts`, behind
    `GET /api/estimate/run-plan`) is re-projected **by import**, not re-derived, so an agent and the
    on-screen launcher quote one number rather than two that drift. It is **advisory only**: it never
    blocks a launch, a model with no pricing entry is reported unpriced rather than zero, and an
    estimate that throws degrades to `estimate: null` plus a one-line note while the launch proceeds.
    A cost preview must never be the reason a launch fails. `suite_run_start` builds it from the
    saved suite's own membership, read **before** the launch so an unknown suite 404s once;
    `run_plan_start` resolves and estimates **before** starting, so a plan that cannot resolve never
    leaves a `suite_runs` row behind.
  - **D-MCP13 — `createWorkbenchMcpServer`'s `caller` parameter is REQUIRED.** It previously
    defaulted to `TRUSTED_LOCAL_CALLER`, which is allow-everything. That was harmless while one call
    site existed and every tool was a read; it stopped being harmless the moment a forgotten argument
    would hand a second embedding the three write tools. A default-open parameter in an authorization
    path is a latent privilege escalation, so the default is removed and every embedding states who
    it is in writing. `TRUSTED_LOCAL_CALLER` stays exported for embeddings that legitimately are
    trusted and local. Omitting the argument at a call site is now a compile error.

  _Rationale:_ D-MCP3 said write tools arrive "only behind explicit token scopes — scope = consent".
  These four are what makes that sentence true rather than aspirational: one scope per tool so
  consent is granular, a refusal that teaches instead of stonewalling, a cost figure in the result so
  an agent's operator can see what a call spent, and no default-open path into any of it.

- **2026-08-20 · D-C11 / D-C12 locked at the WP 2.1 kickoff** (`mcpfp suite run`). Full text + the
  design they bind: [`wp-2.1-suite-run.md`](./wp-2.1-suite-run.md). Declared in
  `packages/shared/src/cli-contract.ts` and pinned by `apps/cli/test/{suite-run,exit-codes,contract}.test.ts`.
  - **D-C11 — `mcpfp suite run` waits by default, waits by POLLING, and maps a terminal suite-run
    status onto an exit code.** A CI step that fires and forgets cannot gate anything, so waiting is
    the default and `--no-wait` is the deliberate opt-out (exit `0` straight after the `202`);
    `--wait <seconds>` sets the total budget, default 30 minutes. It polls
    `GET /api/suite-runs/:id` rather than consuming the SSE stream: an event-stream parser is exactly
    the dependency D-C5 refuses, and the stream is the fragile half of the transport through proxies
    and CI runners — the matrix runs in the API either way. Exit codes: `completed` → **0**; `error`,
    `capped` (the aggregate cost cap soft-stopped the matrix) and `stopped` (an operator halted it) →
    **2**; a budget exhausted while the status is still `pending`/`running` → **2**, naming the
    suite-run id. **Never `1`** — D-C7 reserves that for `mcpfp assert`, and WP 2.2's suite/grade
    assertions are what will legitimately emit it. "Settled" means a terminal status **and** a settled
    `ratingState` (`rated`/`failed`/`skipped`), the same pair the suite SSE stream waits for, so a
    summary is never published while member grades are still landing; a budget that runs out with a
    terminal status but an unsettled rating is **not** a failure — the exit code comes from the status
    and a loud warning says the grades may be incomplete, and **`--quiet` does not silence it**
    (D-C8's posture).
  - **D-C12 — the suite-run envelope composes exactly two reads, and says so in the type.**
    `--format json`'s `data` is `{ suiteRun, members }`, declared as `McpfpSuiteRunResult` in
    `packages/shared/src/cli-contract.ts`. The CLI does not compute, re-rank or re-shape either half:
    `suiteRun` is `GET /api/suite-runs/:id` verbatim and `members` is
    `GET /api/suite-runs/:id/members` verbatim, because no single endpoint returns both and WP 2.2's
    PR artifact needs the member rows. Display ordering (worst score first) and the ten-row human cap
    are presentation and never touch `data`; `--no-wait` yields `members: []`. The client invariant is
    intact (transport + formatting), and the composition is declared in `shared` so WP 2.2 types
    against it rather than re-deriving it from prose. `MCPFP_OUTPUT_VERSION` stays **1** — a new
    command putting a new `data` in the existing envelope is precisely what `data` is for.

  _Rationale:_ a suite gate is only worth building if a pipeline can tell three outcomes apart — the
  matrix finished and scored, the matrix did not finish, and a later `mcpfp assert` said the scores
  were not good enough. D-C11 keeps the first two distinguishable without spending the `1` that the
  third needs.

- **2026-08-20 · D-MCP7 / D-MCP8 / D-MCP9 locked at the WP M.2 kickoff** (owner). Full text + the
  design they bind: [`wp-m.2-mount-scopes.md`](./wp-m.2-mount-scopes.md). Declared in
  `packages/shared/src/{api-tokens,workbench-mcp}.ts` and pinned by
  `apps/api/test/{mcp-server-scopes,api-tokens,api-tokens-guard}.test.ts` +
  `packages/shared/src/workbench-mcp.test.ts`.
  - **D-MCP7 — a tokenless loopback caller keeps FULL access to the mount**, including the write
    tools WP M.3 will add. This is the posture the rest of the API already has (a loopback caller can
    `POST /api/runs` from `curl` today with no credential), and the mount does not get a stricter
    rule than the API it is mounted on. **Scope enforcement therefore applies only to a request that
    authenticated with a token** — `grantedScopes: null` means "no credential was involved", never "a
    token with no scopes" (a token cannot have zero scopes; `apiTokenCreateSchema` requires one). The
    switch that changes this is the existing **`API_AUTH_REQUIRED=true`**, which forces token auth on
    loopback for the whole API, mount included — **no new environment variable** (an off-switch
    beside an auth check is the foot-gun WP 1.1 called out; two overlapping auth knobs is that
    foot-gun twice).
  - **D-MCP8 — `read` is the price of admission to the mount.** `API_TOKEN_ROUTE_SCOPES` maps
    `POST /api/mcp → read`, because `initialize` / `tools/list` / `resources/read` are reads and a
    client cannot speak MCP without them. A write-capable agent therefore holds `read` **plus** its
    write scope; a `scan:run`-only token cannot open the mount at all. The rule is **exact**, not a
    prefix — `/api/mcp/llms.txt` is a GET that already needs only `read`, and a prefix would silently
    relax any future `POST /api/mcp/*`. Per-TOOL scopes then live in `WORKBENCH_MCP_TOOL_SCOPES` (all
    21 at `read` today), enforced at dispatch as an `isError` result naming the missing scope; a tool
    ABSENT from that map is refused to every token (fail closed) with a message that says the server
    is broken rather than inventing a permission to grant. Resources need no per-resource scope:
    every token-authenticated caller that reached the mount already holds `read`, and every resource
    is a read. Stated in `user-guide/20-…`, `user-guide/21-…` and the **generated** `llms.txt`.
  - **D-MCP9 — per-route scope mapping RELAXES conservatively, and the path match proves it.**
    WP 1.1 matches a governed path on the **union** of the raw and percent-decoded forms, because for
    *deciding what is governed* the inclusive answer is the safe one. A route→scope entry does the
    opposite job — it *lowers* what a request needs — so it matches on the **intersection**: a rule
    applies only when the raw form and the decoded form **both** match it, and an undecodable path
    matches nothing. An ambiguous path (`/%61pi/mcp`) therefore falls back to the coarse method rule
    rather than inheriting the relaxed one. Same helper module, opposite direction, on purpose
    (`requestPathEqualsStrict`/`requestPathIsUnderStrict` beside the untouched
    `requestPathEquals`/`requestPathIsUnder`), pinned by a table the **orchestrator** confirmed goes
    red when the strict matcher is swapped for the union one.
  - **Also inherited and now closed: D-C10.** `POST /api/assertions/evaluate → read`. WP 1.3's
    endpoint reads a persisted scan and is a POST only because it carries a gate document; a remote
    assert-only token now needs nothing but `read`.

  _Rationale:_ the coarse method rule cannot tell a read that travels in a POST body from a write, so
  it made both the MCP mount and the assertions endpoint demand an execute scope — a lie about what
  they do, and one that pushes an operator toward over-granting. The fix is a table that can only
  ever relax a named route, cannot express a delete, and does not fire on an ambiguous path.

- **2026-08-19 · D-C3 locked at the WP 1.3 kickoff** (owner). **Baseline semantics: symbolic in,
  concrete out.** A baseline is named either symbolically (`"previous"` — the newest earlier
  *succeeded* scan of the subject's own server) or as an explicit scan id; **either way the API
  resolves it server-side to exactly ONE concrete scan** and the report echoes that `scanId` +
  `scannedAt` under `baseline.requested` / `baseline.scan`. This is a superset of the README's
  original "explicit ids only" recommendation: a PR gate does not have to discover an id up front,
  and the artifact still records precisely what was compared, so the same gate re-run later against
  an unchanged database compares the same pair. Ordering is a **total** order (`scannedAt` desc, id
  desc), not `ORDER BY scanned_at DESC` alone. The owner also scoped WP 1.3's rule set to the
  README's footprint+delta list — suite/grade rules stay WP 2.2, security findings WP 3.1.

- **2026-08-19 · D-C8 / D-C9 / D-C10 locked at the WP 1.3 kickoff** (the assertions engine +
  `mcpfp assert`). Full text + the design they bind:
  [`wp-1.3-assertions.md`](./wp-1.3-assertions.md). Declared in
  `packages/shared/src/ci-assertions.ts`, enforced in `apps/api/src/assertions/service.ts`, and
  pinned by `apps/api/test/ci-assertions.test.ts` + `apps/cli/test/assert.test.ts`.
  - **D-C8 — an unevaluable rule is never a silent pass.** Three distinguishable outcomes, three
    different exit codes. (1) **The baseline cannot exist yet** — this is the server's first scan:
    the baseline-dependent rules report `status: "skipped"` with a reason, the CLI prints one loud
    stderr warning per skipped rule (**`--quiet` does not silence them**), and the command exits
    **0**. A first-ever run must not fail a pipeline for having no history. (2) **A baseline was
    named and does not resolve** — an unknown scan id, a scan of a different server, a `failed`
    scan: a **400**, so the CLI exits **2**. A typo'd baseline never quietly degrades into case 1.
    (3) **The baseline resolves but the two scans are not on the same scale** —
    `ScanComparison.deltasComparable === false`, where the compare service suppresses every token
    delta to 0: a `max-scan-delta` rule measured against that suppressed 0 would pass every single
    time, so it is an **error (exit 2)** naming both token profiles and both counting versions,
    never a pass. Tool matching *is* still valid in that state (the type's own contract), so
    `no-new-tools` / `no-removed-tools` evaluate normally and the request succeeds.
    _Implementation note:_ the case-3 test uses `maxTokens: 0` — a bound a suppressed-0 delta would
    satisfy — so it fails against any implementation that lets the fake zero through.
  - **D-C9 — `assert` never runs a scan.** It evaluates an already-persisted one. Scanning is
    `mcpfp scan`; a CI job chains the two, which is what keeps the exit codes honest — a scan that
    could not run is *that* command's `2`, not this one's `1`. Pinned by a test asserting the stub
    receives exactly one `POST /api/assertions/evaluate` and no `/scan` at all. Extended, in the
    same spirit, to the subject: a `failed` or `running` scan named as the target is a **400**, not
    a zero-tool scan that would silently satisfy every budget.
  - **D-C10 — the evaluation endpoint is a POST and therefore needs an EXECUTE scope from a remote
    token even though it only reads.** WP 1.1's `requiredScopesForMethod` maps scopes coarsely by
    method; carving an exception into it was explicitly rejected (WP 1.1 deferred per-route mapping
    to WP M.2, and that file is security-critical). The consequence is documented instead: a
    **loopback** caller needs no token; a **remote** assert-only token needs an execute scope
    (`scan:run` is the natural one — a footprint pipeline already holds it to run the scan being
    checked). `packages/shared/src/api-tokens.ts` and `apps/api/src/api-tokens/**` have a
    **zero-line diff**. WP M.2 should map `POST /api/assertions/evaluate → read`.

  _Rationale:_ the whole value of a footprint gate is that `1` ("the gate said no") and `2` ("the
  gate could not run") mean different things to a pipeline. D-C8 is that distinction applied to the
  one case where it is easy to get wrong — a rule that quietly evaluates to "fine" because the data
  it needed was missing or incomparable.

- **2026-08-19 · D-C5 / D-C6 / D-C7 locked at the WP 1.2 kickoff** (the `mcpfp` CLI). Full text +
  the design they bind: [`wp-1.2-mcpfp-cli.md`](./wp-1.2-mcpfp-cli.md). Declared in
  `packages/shared/src/cli-contract.ts` and pinned by `apps/cli/test/*.test.ts`.
  - **D-C5 — argument parsing has no dependency.** `node:util`'s built-in `parseArgs`; HTTP is
    global `fetch`. A four-command CLI is not a reason to take on `commander`/`yargs`, so
    **`apps/cli`'s only runtime dependency is `@mcp-token-footprint/shared`** — no MCP SDK, no
    `better-sqlite3`, no `js-tiktoken`, no `apps/api` import. A test reads the manifest AND scans
    every import in `apps/cli/src` so the invariant survives a future convenience.
    _Implementation note:_ `pnpm-lock.yaml` gains **no package** — its `packages:`/`snapshots:`
    sections are byte-identical. It does gain the 16-line `apps/cli` **importer** entry, which is
    unavoidable for any new workspace package and is *required*: the `Dockerfile` (twice) and
    `.github/workflows/mcp-self-scan.yml` run `pnpm install --frozen-lockfile`, which refuses to
    install when a workspace `package.json` is absent from the lockfile (verified: reverting the
    entry produces `ERR_PNPM_OUTDATED_LOCKFILE`). The WP spec's "the lockfile is unchanged" is met
    in the sense that matters — nothing new is resolved or downloaded.
  - **D-C6 — stdout is the payload, stderr is the narration.** Everything a machine consumes (the
    JSON envelope, the API's markdown, the human table) goes to stdout or to `--output`; every
    progress line, warning and error goes to stderr, so
    `mcpfp report scan <id> --format json > report.json` is a byte-exact parseable file.
    Structurally guaranteed rather than left to each command: there is one `Emitter` with
    `payload`/`narrate`/`warn`/`fail`, and every string it writes passes a redaction pass that masks
    anything token-shaped — including an API error body that echoed the credential back.
  - **D-C7 — the exit codes are reserved now, not later.** `0` success · `1` **assertion failure,
    reserved for WP 1.3 and emitted by nothing in WP 1.2** (a test asserts no source line even
    references the constant) · `2` execution/config/transport error. A non-2xx API response is a
    `2`, not a `1`; so is a scan whose `status` comes back `failed`, so a CI step cannot go green
    against an MCP server that could not be reached.
    _Implementation note (matters for WP 2.3's workflow):_ **`pnpm exec` and `pnpm --silent` both
    collapse a non-zero child exit to `1`** (measured on pnpm 9.15.4) — i.e. straight onto the code
    reserved for assertions. The root convenience script therefore uses
    `pnpm --filter … run mcpfp --` (which preserves `2`), and the documented CI invocation is
    `pnpm build` once, then `node apps/cli/dist/index.js …` — clean stdout *and* honest exit codes.
    `pnpm mcpfp` stays a dev convenience: pnpm's own banner lands on **stdout**, so it must not be
    used with `--format json > file`. Documented in `user-guide/22-mcpfp-cli.md`, `CLAUDE.md` §4 and
    `mcpfp help`.

  _Rationale:_ WP 1.3's `assert` and WP 2.2's PR artifact both extend the WP 1.2 envelope rather
  than inventing a second one, so the envelope + exit codes had to be a contract in
  `packages/shared` from the first command, not a shape that emerges later.

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
- [ ] **WP 1.1** — Settings › **API tokens** reads correctly in **both themes** and is
      keyboard-reachable with visible focus; creating a token reveals the secret **once** with an
      unmissable "you will not see this again" and a working copy; revoking asks first; a real remote
      caller (another machine on the LAN, or `curl` from a container) is refused without a token and
      succeeds with one — accepted: ____
- [ ] **WP 1.1 — three consequences of D-C2 to rule on** (all working as specified, none a defect;
      each is a one-line change if the owner wants it different):
      1. **`API_AUTH_REQUIRED=true` makes Settings › API tokens unreachable** — the host's browser
         presents no token (401) and a token may never manage tokens (403). Documented workaround:
         mint the tokens you need first, then switch it on. Alternative: exempt `/api/tokens*` on
         loopback even under the flag — accepted: ____
      2. **A remote browser loads the SPA shell but every `/api` call 401s** — non-`/api` paths are
         deliberately untouched, so a remote user sees the app with nothing in it. A friendlier
         "this instance needs a token" surface is possible but unbuilt — accepted: ____
      3. **The workbench MCP mount is POST-based**, so under the WP 1.1 coarse rule a remote MCP
         client needs an **execute** scope, not `read`. Per-route mapping is WP M.2's job — confirm
         M.2 picks this up — accepted: ____
- [ ] **WP 1.2** — `mcpfp` from a real pipeline: a CI step runs `pnpm build` then
      `node apps/cli/dist/index.js report scan <id> --format json > report.json`, the file parses,
      and a deliberate failure (stop the API) fails the step with exit **2**; and a **non-loopback**
      invocation (`--url http://<lan-ip>:8080 --token mcpfp_…`) succeeds with a `read` token and is
      refused without one — accepted: ____
- [ ] **WP 1.3** — `mcpfp assert` from a real pipeline: a gate file that a change genuinely breaches
      fails the step with exit **1** and names the rule; the same job with the API stopped fails with
      exit **2**; a server's **first** scan reports the baseline rules as skipped, warns, and still
      exits **0**; and a **remote** (non-loopback) `assert` is refused without a token and succeeds
      with an **execute**-scoped one (D-C10) — accepted: ____
- [ ] **WP M.2** — from a second machine: an MCP host (Claude Code / Cursor) pointed at
      `http://<lan-ip>:8080/api/mcp` with a **`read`** token connects and answers a real question;
      the same host with **no** token is refused; a token holding only `scan:run` is refused at the
      door naming `read`; and the API log shows one audit line per tool call carrying
      `mcpfp_xxxxxxxx` and no secret — accepted: ____
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
