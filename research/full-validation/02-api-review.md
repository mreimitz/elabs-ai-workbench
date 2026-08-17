# API package review — production readiness

Part of the full-validation series. Scope: `apps/api/src/**` (all 22 subdirectories + `index.ts`, ~46 000 lines across 159 files). `apps/api/test/` was consulted only to judge coverage gaps.

## scope-and-method

- Read `CLAUDE.md`, `.claude/rules/architecture.md`, `.claude/rules/mcp-and-security.md`, `.claude/rules/quality-gates.md` for the intended design, then reviewed every subdirectory: `assistant` (+`tools`), `collections`, `compare`, `compatibility` (+`data`), `config`, `db`, `estimate`, `git`, `grading`, `mcp`, `oauth`, `providers`, `reports`, `scans`, `secrets`, `servers`, `skillflow`, `skills`, `suites`, `testing`, `token-counting`, `utils`, plus `index.ts`.
- Review was executed by six parallel sub-reviews (testing+estimate · assistant · skills+skillflow · grading+suites+collections+git · compatibility+reports+compare · core infra), each required to verify every citation by reading the file at the cited offset. All Critical/High findings (and the load-bearing Medium ones) were then independently re-verified against the source by the compiling reviewer.
- Hunted for: dead code, hardcoded values, duplication, bugs/races (SSE, run orchestration, child processes), resource leaks, zod validation gaps, contract drift vs `packages/shared`, transaction misuse, N+1 patterns, and perf concerns — against the repo's stated conventions (contract-first, routes-thin/services/repositories, typed errors with `statusCode`, secrets never returned, additive-only `/api`).
- Overlapping findings from different sub-reviews were merged (graceful shutdown; route-param validation; `VENDOR_ASSISTANT_DEBUG` scaffolding), so each issue appears once.

Line numbers are as of this review (2026-07-11, current working tree).

## summary

| Severity | Count |
| --- | ---: |
| Critical | 1 |
| High | 11 |
| Medium | 35 |
| Low | 56 |
| **Total** | **103** |

Overall verdict: the codebase is unusually well-engineered for its size — SSE lifecycle, run-manager fan-out, secret encryption/redaction, zip-bomb caps, path-traversal defenses in the skills/assistant workspaces, and migration discipline all held up under targeted scrutiny. The release-blocking set is small and sharply defined: **C-1** (path traversal in collection conflict resolve), **H-1/H-5/H-6** (collections git-sync gaps), **H-9** (no graceful shutdown), **H-10** (unconditional debug dump of tenant data), and **H-11** (leaked MCP child on failed connect).

---

## critical-findings

### c-1-collections-resolve-path-traversal

**Severity:** Critical · **Category:** security

**Files:** `apps/api/src/collections/routes.ts:17`, `apps/api/src/collections/git-sync.ts:195-213`

The `POST /api/collections/:id/resolve` body schema puts no constraint on the conflicted-file path:

```ts
// routes.ts:17
path: z.string().min(1),
```

and the sync engine joins it straight under the clone dir and writes:

```ts
// git-sync.ts:196-200
const abs = path.join(clonePath, ...res.path.split("/"));
if (res.resolution === "edited") {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, res.content ?? "");
```

A body like `{"path":"../../../../home/user/.zshrc","resolution":"edited","content":"…"}` writes arbitrary content anywhere the API process can write (the clone lives at `DATA_DIR/collections/<id>`; two `..` reach `DATA_DIR`, more reach the whole filesystem). The `take-local`/`take-remote` branch has the same hole via `fs.rmSync(abs, { force: true })` (git-sync.ts:206) — arbitrary file **deletion**. The subsequent `git add -- res.path` failing does not undo the filesystem write. No traversal test exists in `apps/api/test/benchmarks-git-sync.test.ts`.

**Recommendation:** validate `path` in the schema (reject absolute paths, `\`, and any `..` segment); in `resolve()` verify `path.resolve(abs)` starts with `path.resolve(clonePath) + path.sep`; best, accept only paths that appear in `parseConflicts(clonePath)` — the server already knows the legal set.

---

## high-findings

### h-1-collections-repourl-bypasses-ssrf-guard

**Severity:** High · **Category:** security / contract drift

**Files:** `packages/shared/src/schemas.ts:620`, `apps/api/src/git/git-credential.ts:74-85`

Skills imports use `safeRepoUrlSchema` (https-only + blocked-host list). Collections do not: `repoUrl: z.string().trim().url().optional()`. The shared git module explicitly skips non-https URLs, relying on a schema guard that collections never apply:

```ts
// git-credential.ts:85
if (url.protocol !== "https:") return;
```

with the comment "the schema's literal guard already rejects them at the route boundary" — false for collections. `http://169.254.169.254/x.git`, `git://…`, `ssh://…`, `file:///…` are accepted by `PUT/POST /api/collections` and handed to `git clone`/`fetch`/`push`.

**Recommendation:** reuse `safeRepoUrlSchema` for `collectionInputSchema.repoUrl` (tests needing `file://` repos can construct the service directly, as they already do).

### h-2-test-scenario-delete-cascades-live-run

**Severity:** High · **Category:** bug

**Files:** `apps/api/src/testing/routes.ts:49-53, 71-75`, `apps/api/src/db/schema.ts:231-232`

`DELETE /api/tests/:id` / `DELETE /api/scenarios/:id` have no live-run guard (`tests.delete(id);` straight through), while `runs.test_id`/`runs.scenario_id` are `ON DELETE CASCADE`. Deleting a test or scenario with a live run deletes the run row (and steps/events) mid-flight, while the provider loop keeps calling the LLM and MCP servers to completion — every persistence write silently fails (FK violation swallowed by `run-manager.ts:141-143` `.catch(() => undefined)`). Contrast `DELETE /api/runs/:id` (routes.ts:139-147), which explicitly detaches the active run first (the F3 fix).

**Recommendation:** in `TestService.delete`/`ScenarioService.delete`, reject deletion while a live run references the entity (409), or detach+abort affected runs first, mirroring the F3 path.

### h-3-assistant-reference-dir-writable-under-auto-accept

**Severity:** High · **Category:** security

**File:** `apps/api/src/assistant/session-manager.ts:649-652, 1179-1194`

```ts
const additionalDirectories =
  startScope?.entityKind === "skill" && this.config.assistantSkillAuthoringDir
    ? [workspaceRoot, this.config.assistantSkillAuthoringDir]
    : [workspaceRoot];
```

`additionalDirectories` grants the Agent SDK's native `Edit`/`Write`/`MultiEdit` **write** permission, not just read — but the skill-authoring reference dir is documented as "bundled, READ-ONLY" (session-manager.ts:191-199, `config/env.ts:132-144`). Native write tools are exempted from the D-AS19 scope gate (line 1181) and are auto-accept-eligible, so with a thread's auto-accept toggle ON the agent can modify these app resource files with no owner prompt; `workspaceFileChangedFrame` (line 1044) deliberately emits no workspace frame for paths outside the workspace root, so nothing surfaces in the dock. A tampered authoring guide feeds every future skill-scoped session — a prompt-injection persistence vector. Secondary: the workspace root covers every skill the thread ever opened, so a native write can touch skill B's open workspace while the message scope pins skill A.

**Recommendation:** don't put the reference dir in `additionalDirectories`; copy it into the thread scratch cwd at session start, or hard-deny in `handlePermission` any native write whose resolved `file_path` is under `assistantSkillAuthoringDir` (and consider denying native writes into a non-scoped skill's workspace).

### h-4-skills-save-draft-ignores-env-caps

**Severity:** High · **Category:** bug / convention

**Files:** `apps/api/src/skills/routes.ts:532, 738-744`, `apps/api/src/index.ts:385-398, 556-569`

`index.ts` builds env-overridable `skillCaps` (from `SKILL_MAX_FILE_BYTES/TOTAL_BYTES/FILES`) and threads them into `SkillIngestService`, `SkillGitService`, and `registerSkillflowRoutes(server, skills, runRepository, skillCaps)` — but `registerSkillRoutes` is never handed `skillCaps`, so save-draft and scaffold fall back to compiled-in defaults:

```ts
// routes.ts:532
const treeResult = applyTreeOps(baseTree, treeOps, DEFAULT_INGEST_CAPS);
// routes.ts:738-744
assertFileCountCap(scaffold.length, DEFAULT_INGEST_CAPS); … assertTotalCap(totalBytes, DEFAULT_INGEST_CAPS);
```

An operator who tightens `SKILL_MAX_*` for security does not get that limit on these two write routes (which accept caller-supplied base64 `add_file` bodies), while the sibling skillflow `/edits` route enforces the env cap.

**Recommendation:** pass `skillCaps` into `registerSkillRoutes` and thread it to `applyTreeOps` in save-draft and to `persistScaffoldedSkill`.

### h-5-collections-no-per-collection-mutex

**Severity:** High · **Category:** bug (race)

**File:** `apps/api/src/collections/git-sync.ts:83-236, 264`

`sync()`, `status()`, and `resolve()` all operate on the same persistent clone at `<baseDir>/<id>` with many `await` points between git subprocesses, and nothing serializes them. `status()` even mutates the worktree on a GET (`git-sync.ts:171` — `this.exportLocalMembers(clonePath, repoPath, collectionId);`). Two overlapping HTTP calls interleave `git add -A`/`commit`/`merge`/`checkout -B` on one index; worst case, `ensureClone` in one call `fs.rmSync(clonePath, …)` (line 264) while another call's `git commit` is mid-flight.

**Recommendation:** a per-collection-id promise-chain/mutex around the three public entry points.

### h-6-export-overwrites-other-members-file

**Severity:** High · **Category:** bug

**File:** `apps/api/src/collections/git-sync.ts:327-346`

`exportKind`'s `uniqueFileName(kebab(name), usedNames)` de-duplicates only within the current batch; it never consults files already on disk. If `tests/foo.json` exists and belongs to a **different** `external_key` (e.g. a locally-detached member whose file legitimately stays for the remote side), a current member whose name kebabs to `foo` silently overwrites it —

```ts
const old = existingByKey.get(row.external_key);
if (old && path.resolve(old) !== path.resolve(desiredPath)) {
  fs.rmSync(old, { force: true });
}
fs.writeFileSync(desiredPath, content);
```

— and `commitIfDirty` + `push` propagate the destruction, violating the module's own invariant ("Remote-only files … are NEVER touched", line ~310).

**Recommendation:** seed `usedNames` with (or check against) on-disk files whose parsed `externalKey` differs, and pick the `-2`/`-3` suffix instead of overwriting.

### h-7-compatibility-catalog-not-source-of-truth

**Severity:** High · **Category:** hardcoded / duplication

**Files:** `apps/api/src/compatibility/runner.ts:66-72, 146, 183, 216, 265, 286, 335-337, 350, 374, 384-387`, `apps/api/src/compatibility/session.ts:245, 274, 302, 316, 387`, `apps/api/src/compatibility/data/test-catalog.json` (`scoring` block)

`catalog.ts:1-3` claims the catalog is "the source of truth for the rules; … The engine never hand-authors test logic — it reads this." In reality the scoring weights are re-hardcoded:

```ts
const WEIGHTS: Record<CompatibilitySeverity, number> = { blocker: 1.0, high: 0.7, medium: 0.4, low: 0.2 };
const VERDICT_VALUE: Record<"pass" | "warn" | "fail", number> = { pass: 1.0, warn: 0.5, fail: 0.0 };
```

and nearly every band re-hardcodes a `warn_at`/`fail_at` the catalog already carries (e.g. `bandUpper(tool.descriptionTokens, 200, 500)` vs catalog `TOOL_DESCRIPTION_TOKEN_BUDGET` `"warn_at": 200, "fail_at": 500`). Editing the catalog (the documented workflow) silently changes nothing at runtime.

**Recommendation:** read `scoring.weights`/`verdict_value` and `threshold.warn_at`/`fail_at` from the catalog (typed fallbacks in code); minimum bar, a drift test asserting the hardcoded constants equal the catalog values.

### h-8-heatmap-double-evaluation

**Severity:** High · **Category:** perf / duplication

**Files:** `apps/api/src/compatibility/service.ts:325-330`, `apps/api/src/reports/server-report.ts:45-57`

```ts
const toolCells = scan.tools.map((tool) => scoreCell(modelId, runToolLevel(tool, modelId, { client: opts.client })));
const toolResults: CompatibilityResult[] = scan.tools.flatMap((tool) => runToolLevel(tool, modelId, { client: opts.client }));
```

`runToolLevel` (~16 catalog tests, each with schema traversal + regex rule resolution) runs **twice per tool per model** on the default heatmap; the server-report path compounds it (`buildToolFindings` over all tools × models, then `buildToolTestReport` re-running the same evaluations for every flagged tool) — all synchronous CPU on the Fastify event loop.

**Recommendation:** compute `runToolLevel` once per tool and derive both outputs; in `createServerReport`, reuse per-tool results already produced; consider memoizing `resolveSeverity(test, modelId, client)`.

### h-9-no-graceful-shutdown

**Severity:** High · **Category:** bug

**Files:** `apps/api/src/index.ts:615` (and absence repo-wide: `grep "SIGTERM|SIGINT" apps/api/src` → zero hits), `apps/api/src/assistant/session-manager.ts:588-590`, `apps/api/src/assistant/claude-auth.ts:369`

The file ends with `await server.listen({ port: config.port, host: config.host });` and there is no signal handler anywhere in `apps/api/src`. On every `docker compose stop`/deploy, in-flight requests are dropped and the SQLite handle is never closed (WAL recovers, but the `-wal` sidecar is left un-checkpointed). MCP stdio children and Agent-SDK children (~1 GiB each per `env.ts:193-195`) are reaped only because `docker-compose.yml` sets `init: true` — under bare `pnpm start` they are orphaned, including an in-flight `claude setup-token` PTY (the only assistant kill path is the sign-out hook, `index.ts:463`). The startup reconciliations (`abortOrphanedScans`/`abortOrphanedRuns`/`reconcileOrphanThreads`) exist precisely because shutdown is currently a crash.

**Recommendation:** register SIGTERM/SIGINT + Fastify `onClose` handling: `await server.close()`, stop active runs/suites, `assistantSessionManager.killAllSessions()` + `flowManager.cancel()`, `wal_checkpoint(TRUNCATE)`, `db.close()`.

### h-10-unconditional-vendor-debug-dump

**Severity:** High · **Category:** bug / security

**File:** `apps/api/src/providers/model-catalog.ts:300-301`

```ts
// TEMP DEBUG (vendor retrieval diagnosis) — REMOVE. Raw assistant objects incl. knowledgeBases/spaceId.
console.error("[QA-DEBUG roster]", JSON.stringify(record?.data).slice(0, 6000));
```

Runs on **every** `GET /api/providers/:id/models` for a `vendor_assistant` credential, on every pagination page, dumping up to 6 KB of raw tenant assistant metadata to stderr. Unlike its sibling `qaDebug()` (line 84-92) it is not gated by `VENDOR_ASSISTANT_DEBUG`, and it bypasses pino. Self-labelled "REMOVE".

**Recommendation:** delete the line (or route through `qaDebug`).

### h-11-opensession-leaks-child-on-failed-connect

**Severity:** High · **Category:** bug (resource leak)

**File:** `apps/api/src/mcp/client.ts:342-360`

```ts
const transport = createTransport(config, options);
await withTimeout(client.connect(transport), MCP_TIMEOUT_MS, "MCP initialize");
return { … };
```

No `try/catch` closes the client on failure — contrast `discoverTools` (line 97-99, `finally { await client.close().catch(() => undefined); }`) and the four one-shot helpers. `StdioClientTransport` spawns the child inside `connect()`; if the handshake hangs, `withTimeout` rejects after 30 s but the spawned child (or open HTTP connection) is never closed — one leaked child process per failed run start against a hung stdio server (`withTimeout`, `utils/timeout.ts:15`, races and does not cancel the underlying operation).

**Recommendation:** `try { … } catch (e) { await client.close().catch(() => undefined); throw e; }`.

---

## medium-findings

### testing-run-engine

#### m-1-post-runs-unknown-id-500

**Category:** bug/convention · `apps/api/src/testing/run-service.ts:269-270`
`start()` inserts before any existence check (`this.runs.createRun(runId, { testId, scenarioId, mode });`); with `foreign_keys = ON` (`db/database.ts:14`) an unknown `testId`/`scenarioId` throws a raw `SqliteError: FOREIGN KEY constraint failed` → HTTP 500 from the central handler, violating the typed-error convention and the route's own comment (routes.ts:92-93). **Fix:** call `this.tests.get(testId)`/`this.scenarios.get(scenarioId)` (both throw typed 404s) before `createRun`.

#### m-2-sessionstats-dead-instrumentation

**Category:** dead-code · `apps/api/src/testing/accounting.ts:516` (+ state at 311-318, types at 70-106)
`sessionStats(): SessionStats` has **zero callers** across src and test; the backing state (`sessionStartMs`, `turnStats`, `toolResultStats`) and the exported `TurnToolStats`/`ToolResultStat`/`SessionStats` types exist only to feed it. The doc comment claims WP 5.6 reads it, but WP 5.6 reads persisted `run_steps`. **Fix:** delete or wire to the compatibility scorer.

#### m-3-tool-defs-recounted-every-step

**Category:** perf · `apps/api/src/testing/accounting.ts:388-393, 591-597`
Inside the per-step per-counter loop, `countToolDefs` re-BPE-counts **all** tool definitions and the system prompt on every settled step for every non-primary lens (the primary lens caches via `ensureFixedSegments`). 100 tools × 3 profiles × 50 turns = 15 000 redundant BPE counts per run, on the event loop. **Fix:** memoize per-counter `toolDefTokens`/`systemTokens` once.

#### m-4-vendor-assistant-debug-scaffolding

**Category:** dead-code/convention · `apps/api/src/testing/vendor-assistant-executor.ts:169-177, 795-829`, `apps/api/src/providers/model-catalog.ts:87`
`VENDOR_ASSISTANT_DEBUG` gates `console.error`/`process.stderr` output that bypasses pino; when set, `rawDebug += decoded` accumulates the **entire tenant SSE stream unbounded in memory** and writes it verbatim to stderr (`[QA-RAWSTREAM-START]`). The env var is not declared in `config/env.ts` or `.env.example`. **Fix:** remove, or route through the Fastify logger at `debug`, declare the flag in `config/env.ts`, cap `rawDebug`.

#### m-5-vendor-executor-duplication

**Category:** duplication · `apps/api/src/testing/vendor-assistant-executor.ts:198-214 vs 387-403, 257-363 vs 506-555`
`runVendorAssistant` vs `runVendorAssistantInteractive` duplicate ~150 lines: two identical `nextStep` factories (a third in `engine.ts:356-371`) and a copy-pasted abort/deadline → AE-4 → generic-error terminal ladder. **Fix:** extract a shared `classifyAnswersTerminal(...)` + step factory.

### assistant

#### m-6-no-turn-watchdog

**Category:** bug · `apps/api/src/assistant/session-manager.ts:1080-1082, 417-423, 863-870`
`idleTimer`/`releaseTimer` are only armed on `turn_done`/`error`/`limit_error`. If the SDK child hangs mid-turn emitting nothing, `turnInFlight` stays `true` forever: `park()` refuses, `sendMessage` 409s, and one of the `maxActiveSessions` (default 2) slots is held until restart; `stop()` merely calls `interrupt()` on the same hung child. **Fix:** arm a configurable turn-deadline timer when `turnInFlight` flips true; on expiry emit a settled `error` and abort/detach (resume-by-`sdkSessionId` recovers the conversation).

#### m-7-runs-search-unbounded-n-plus-1

**Category:** perf · `apps/api/src/assistant/tools/index.ts:255-268` (also 225-230)
`runs_search`/`runs_list` call `deps.runs.listRuns(...)` with no SQL `limit` (the repository supports one — `run-repository.ts:420-450`), then the `skillId` filter fires one synchronous `getRunSkills` query per run over the entire history **before** the 50-row cap. **Fix:** push `since`/`until`/`skillId` into the repository query (join `run_skills`) and pass a limit when no post-filters apply.

#### m-8-sse-boilerplate-triplicated

**Category:** duplication · `apps/api/src/assistant/routes.ts:262, 291-292`, `apps/api/src/testing/routes.ts:88, 205-206`, `apps/api/src/suites/routes.ts:85, 265-266`
Three identical `const SSE_HEARTBEAT_MS = 15_000;` + heartbeat/hijack/replay/close scaffoldings. The assistant copy already fixed a bug the others may lack (`flushHeaders()` at assistant/routes.ts:368) — exactly the drift this invites. **Fix:** extract a shared `sse.ts` helper (head-writer, heartbeat, idempotent close, frame writer).

### skills-and-skillflow

#### m-9-tool-diagnostics-n-plus-1

**Category:** perf · `apps/api/src/skillflow/routes.ts:550-567`
`loadRegisteredServerScans` maps every completed scan of every registered server through `scans.getDetail(summary.id)` (summary + tool + resource + prompt queries each) just to get tool names — ~N servers × M scans × 4 synchronous queries per GET, with resource/prompt rows discarded. **Fix:** a lightweight repo method (`SELECT tool_name FROM mcp_tool_scans WHERE scan_id IN (…)`) or restrict history depth.

#### m-10-frontmatter-parser-drift

**Category:** duplication · `skills/manifest.ts:90`, `skillflow/projector.ts:346, 520`, `skillflow/roundtrip.ts:242`, `skillflow/extract-tools.ts:59-105`, `skillflow/suggestions.ts:654`
At least four independent frontmatter parsers and three ATX-heading scanners with slightly different rules (regex vs fence-tracking line loops; BOM handling varies). Projector and roundtrip must agree on heading line numbers for anchor-based splicing to stay byte-exact — divergence is a correctness hazard. **Fix:** one shared `parseFrontmatter(lines)` + `scanHeadings(lines)` (fence- and BOM-aware) consumed by all five.

#### m-11-repository-private-db-cast

**Category:** convention · `apps/api/src/skillflow/routes.ts:570-572`
```ts
function skillflowDatabase(repo: SkillRepository): AppDatabase {
  return (repo as unknown as { db: AppDatabase }).db;
}
```
Routes defeat repository encapsulation to reach the connection and `new ScanRepository(db)` per request (line 552) — a field rename breaks it with no type error. **Fix:** inject a `ScanRepository` into `registerSkillflowRoutes` explicitly.

#### m-12-skillflow-helper-duplication

**Category:** duplication · `skillflow/quality.ts:257` = `skillflow/suggestions.ts:613` (`referencedFilePaths`, byte-identical); `owningSectionOf` in `aligner.ts:406` and `suggestions.ts:198`; `slugify`/`basename` re-implemented in `projector.ts:646/640`, `suggestions.ts:623`, `scaffold.ts`, `repository.ts:850`, `git-service.ts:583`, `aligner.ts:529`. **Fix:** consolidate into a small `skillflow/graph-util.ts`.

#### m-13-manifest-constants-hand-mirrored

**Category:** duplication/hardcoded · `skills/manifest.ts:28-32` vs `skills/scaffold.ts:22-24`
`NAME_MAX=64`, `DESCRIPTION_MAX=1024`, `NAME_PATTERN` re-declared; scaffold.ts documents the hazard ("kept in sync by hand since manifest.ts doesn't export its constants"). A drifted tweak would produce an unstorable version. **Fix:** export from `manifest.ts` (or promote to `packages/shared` — it's the Agent-Skills contract).

### grading-suites-collections

#### m-14-orchestrator-unhandled-rejection

**Category:** bug · `apps/api/src/suites/orchestrator.ts:509, 740-755`
`control.done = this.run(control);` is fire-and-forget ("Never awaited here."), and `finish(control)` runs in the `finally` **outside** the try — if `suiteRuns.finalize(...)` or `manager.emit(...)` throws (SQLITE_BUSY, disk full), the promise rejects with no production catch (`whenSettled` is test-only). Node's default policy terminates the process, taking every in-flight run down. **Fix:** `.catch((err) => log.error(...))` on `control.done` and/or try/catch inside `finish()`.

#### m-15-suite-errors-swallowed

**Category:** bug/convention · `apps/api/src/suites/orchestrator.ts:571-572` (also 639, 652, 811-823)
`} catch { control.errored = true;` — any exception escaping the workers marks the suite run `error` with no log, no SSE message, no persisted reason. Same in `runCell`'s start-failure catch. Violates "never swallow errors". **Fix:** inject the Fastify logger at each swallow point; consider an additive `error`-detail field on the suite-run SSE `status` event.

#### m-16-judge-plumbing-six-copies

**Category:** duplication · `grading/judge.ts:358`, `grading/base-rating-judge.ts:277`, `grading/trajectory-judge.ts:578`, `grading/error-forensics.ts:620`, `grading/failure-buckets.ts:315`, `suites/suite-report-service.ts:936`
`callWithTimeout` exists six times verbatim; `judgeLedger` four times; `stripFences` four times; `errorResult`/`truncate`/`firstJsonObject`/`coerceNumber` two–three times each — self-acknowledged ("Mirrors the identical local helper … kept local here too"), a per-WP file-surface constraint that no longer applies. `base-rating-judge.ts` already exports canonical versions. **Fix:** consolidate; six timeout implementations is six places for an abort-semantics fix to miss.

#### m-17-grade-body-unvalidated

**Category:** convention · `apps/api/src/grading/routes.ts:99-100`
`const body = (request.body ?? {}) as { graderIds?: GraderId[] };` — no schema exists in `packages/shared`; a non-array or typo'd grader id is silently mangled/ignored. **Fix:** add `gradeRunBodySchema = z.object({ graderIds: z.array(z.enum(GRADER_IDS)).optional() })` to shared and `.parse()` it.

#### m-18-suite-aggregates-o-n-squared

**Category:** perf · `apps/api/src/suites/orchestrator.ts:666, 760-769, 156-183, 706-715`
Every settled cell triggers `emitAggregates` → `collectChildData`, re-running `runs.getSummary` + `grades.listByRun` for **every** child run so far (~20 k+ synchronous queries for a 40×5 suite), and `claimRunnableCell` → `vendorAssistantProviderIdFor` does two uncached repo lookups per scanned queue cell per claim. **Fix:** accumulate incremental aggregates in `SuiteControl` for the live SSE snapshot (full recompute only in `finish()`); cache scenarioId→providerId per suite run.

#### m-19-tool-path-empty-separator

**Category:** bug · `apps/api/src/suites/suite-report-service.ts:315, 359`
`const TOOL_PATH_SEP = "";` + `runs.getToolCallSequence(runId).join(TOOL_PATH_SEP)` — `["a","bc"]` and `["ab","c"]` produce identical signatures, so `toolPathVariance` undercounts distinct paths. **Fix:** a separator that can't appear in a tool name (`" "` / `"\n"`).

#### m-20-insightbench-import-not-transactional

**Category:** bug · `apps/api/src/collections/insightbench-import.ts:106-202`
N test creates, then a suite, then per-test + suite collection assignments as independent writes — a mid-way failure leaves partial tests with no suite (the "no partial writes" comment at line 109 only covers the up-front collection lookup). **Fix:** wrap the whole import in one `db.transaction`.

#### m-21-suite-defaults-duplicated

**Category:** hardcoded/duplication · `apps/api/src/suites/repository.ts:180`, `apps/api/src/suites/suite-run-repository.ts:174-177`
`{ repetitions: 1, maxConcurrency: 3 }` fallbacks are literals although `SUITE_DEFAULT_REPETITIONS`/`SUITE_DEFAULT_CONCURRENCY` exist in `packages/shared/src/constants.ts:596,600` (and insightbench-import.ts uses them correctly). **Fix:** import the constants.

### compatibility-reports-compare

#### m-22-markdown-table-newline-injection

**Category:** bug/security · `apps/api/src/reports/reports.ts:100-102` (call sites :53, :70, :85, :487; `suite-run-report.ts:350, 511, 526`)
`escapeMarkdownTable` escapes pipes only — not newlines — and is used on untrusted MCP-server names/URIs and LLM-drafted multi-line prose in table rows; a `\n` breaks the table and lets subsequent content render as arbitrary markdown. Sibling `escapeText` (`reports.ts:108-110`) already collapses `[\r\n]+`. **Fix:** make `escapeMarkdownTable` a superset of `escapeText` (collapse newlines); consider escaping backticks/brackets in untrusted cells.

#### m-23-test-group-table-broken-by-list-item

**Category:** bug · `apps/api/src/reports/suite-run-report.ts:484-492`
`renderTestGroups` pushes an indented `- summary` line between two `|`-rows, terminating the markdown table; every group after the first summary renders as literal pipe text. **Fix:** collect summaries after the table or add a column.

#### m-24-compare-o-n-squared-retokenization

**Category:** perf · `apps/api/src/compare/matching.ts:126-137, 143-151` (used ×3 via `compare/service.ts:151,184`)
The fuzzy phase computes `similarity(aTools[i], bTools[j])` for every remaining cross pair, and `similarity` rebuilds both token sets (three regex passes over name + full description) per call — O(n²·L); phase 2 recomputes `normalizeName` in the inner loop. Two ~500-tool scans ≈ 250 k description tokenizations per request, synchronously. **Fix:** precompute `normalizeName` + token sets once per tool; index phases 1-2 by name.

#### m-25-run-compatibility-route-unvalidated-untyped-unconsumed

**Category:** convention/dead-code · `apps/api/src/compatibility/routes.ts:99, 115-125`
`const { client } = (request.query ?? {}) as { client?: string };` (repeated `?client=` arrives as `string[]`); the `{ runId, modelId, results, cell }` response shape exists nowhere in `packages/shared`; the web app never calls the endpoint and no API test exercises the handler (the 422 `unknown_model` branch is entirely unverified). **Fix:** shared query schema + response type + a route test — or cut the endpoint until the UI needs it.

#### m-26-embed-full-suite-export-unbounded

**Category:** perf · `apps/api/src/reports/suite-run-report.ts:155-206`
Per child run: `getSummary` (158), `grades.listByRun` (163), and for `embed=full` a full `runs.getRun` (194) **plus a second** `grades.listByRun` (200, result already in hand); each member's complete `RunDetail` is embedded into one in-memory payload with no member-count cap. **Fix:** drop the duplicated grade read; add a configurable member cap (400/413) or stream the markdown.

#### m-27-severity-ordering-three-ways

**Category:** duplication · `packages/shared/src/report-derive.ts:35` (`SEVERITY_RANK` 4..1), `apps/api/src/compatibility/service.ts:118` (`SEVERITY_WEIGHT` 4..1 re-declared), `apps/api/src/reports/server-report.ts:23-28` (`{ blocker: 1000, high: 100, medium: 10, low: 1 }`)
Three expressions of "blocker ≫ high ≫ medium ≫ low". **Fix:** use shared `SEVERITY_RANK` for ordering; move the tally-weight variant to shared with a distinguishing comment.

### core-infrastructure

#### m-28-prune-scans-keep-0-contradiction

**Category:** bug/convention · `apps/api/src/db/maintenance.ts:70-77` (same for `?days=` at 83-89)
The comment promises "both 0/absent mean 'use the configured retention'", but `parsed >= 0` accepts `0` → `pruneAllServers(0)` → no-op (`scans/repository.ts:376 if (keep <= 0) return`). Query params are hand-cast, not zod-validated. **Fix:** decide semantics (`>= 0` → `> 0` or fix the comment) and validate with a shared schema.

#### m-29-double-url-decoding

**Category:** bug · `apps/api/src/scans/routes.ts:32, 44`
`decodeURIComponent(toolName)` on an already-decoded Fastify path param corrupts names with `%xx`-looking sequences, and a name decoding to a bare `%` throws `URIError` → 500. **Fix:** drop the `decodeURIComponent` calls (with a regression test using a `%`-bearing tool name).

#### m-30-linked-auth-first-header-guess

**Category:** security/bug · `apps/api/src/providers/linked-auth.ts:108-112`, duplicated in `apps/api/src/servers/vendor-assistant-probe.ts:121-124`
```ts
for (const value of Object.values(headers)) {
  if (value.trim()) return value.trim();
}
```
For a `custom_headers` server with multiple headers, the "bearer" is whichever header value comes first by insertion order — possibly `x-tenant-id`, sent as `Authorization: Bearer <value>` to the tenant. `auth_header_name` is stored but ignored here. **Fix:** prefer the header named by `authHeaderName`; report "auth broken" instead of guessing when several custom headers exist and none matches.

#### m-31-asset-proxy-buffers-before-cap

**Category:** perf/bug · `apps/api/src/servers/routes.ts:174-182` (`asset-proxy.ts:16 MAX_ASSET_BYTES = 5 MiB`)
A chunked upstream response with no `content-length` is fully read via `await response.arrayBuffer()` before the 5 MB check — an untrusted MCP server can force unbounded buffering. **Fix:** stream the body and abort once the running byte count exceeds the cap.

#### m-32-no-busy-timeout

**Category:** bug · `apps/api/src/db/database.ts:12-14`
Only `journal_mode = WAL` and `foreign_keys = ON` are set; no `busy_timeout`. Any second process on `/data/app.sqlite` (the planned `mcpfp` CLI, an external reader racing a checkpoint) gets an immediate `SQLITE_BUSY`. **Fix:** `db.pragma("busy_timeout = 5000")` at open.

#### m-33-mcp-timeout-hardcoded

**Category:** hardcoded · `apps/api/src/mcp/client.ts:31`
`const MCP_TIMEOUT_MS = 30_000;` applies to initialize, tools/list, tools/call, resources/read, prompts/get, and every persistent-session call, with no env override. First-run `npx …` stdio servers and long-running tools routinely exceed 30 s. **Fix:** lift to `config` with an env override; consider a separate longer tools/call timeout.

#### m-34-legacy-pricing-no-provenance

**Category:** hardcoded · `apps/api/src/providers/pricing.ts:32-63` (also `ZERO_PRICE_MODELS`, line 26)
`LEGACY_MODEL_PRICING` carries no "as-of" date or source (contrast the generated dataset's `"as-of 2026-06-21; 33 models"` header). These numbers feed the **spend-cap guardrail**. **Fix:** add per-block as-of dates + sources and a re-verification note.

#### m-35-route-params-never-zod-validated

**Category:** convention (systemic) · examples: `servers/routes.ts:102, 107, 113, 148-149`; `oauth/routes.ts:12, 17, 22`; `providers/routes.ts:15, 27, 33`; `scans/routes.ts:17, 30-31`; `testing/routes.ts:44`; `reports/routes.ts:56`; `compatibility/routes.ts:38, 60, 69, 79, 99`; `assistant/routes.ts:381-394` (`parseThreadFilter` hand-parses, `entityKind` unchecked); `testing/routes.ts:112-115` (`GET /api/runs/compare` hand-rolls `parseIds`)
Bodies are consistently zod-parsed; params and most queries are `as`-cast everywhere — contrary to "routes validate with zod from shared". Practical risk is low for opaque ids, but the maintenance queries (m-28) and `assets/file`'s `path` query carry real semantics. **Fix:** one shared `idParamsSchema` + per-route query schemas in `packages/shared`, applied mechanically.

---

## low-findings

### low-testing

| # | Category | Location | Issue → recommendation |
| --- | --- | --- | --- |
| L-1 | duplication | `testing/routes.ts:245-248` vs `testing/run-manager.ts:5-14` | `TERMINAL_SSE_STATUSES` set duplicates `isTerminalStatus`; drift would hang SSE streams on a new terminal status → import `isTerminalStatus`. |
| L-2 | bug/docs | `testing/run-service.ts:338-346` | `stop()` documented "Idempotent / safe after finish" but throws 404 on a finished run — a UI stop racing natural completion gets an error toast → return OK for already-finished, or fix the doc + client. |
| L-3 | dead-code | `testing/run-service.ts:929-930`, `testing/engine.ts:934-936` | `export { httpError }` re-export and `export type { Tool, ToolSet }` have zero importers → delete. |
| L-4 | dead-code | `testing/accounting.ts:360` + `run-service.ts:755-777` | `llmStep`'s `LlmStepRecord` return is always discarded ("Discard the per-step record") → return `Promise<void>`, drop the type. |
| L-5 | docs | `testing/run-service.ts:759-760`, `testing/tool-bridge.ts:52-53` | Comments cite "installed `ai` v6"; installed is `ai@7.0.11` (engine.ts:680-684 is correct) → update. |
| L-6 | convention | `testing/engine.ts:315, 330-332, 538, 764` | `console.warn`/`console.error` instead of pino → thread a logger into `EngineConfig`. |
| L-7 | security/docs | `testing/run-repository.ts:601-606` | `SECRET_VALUE_PATTERN` doc claims bearer-token coverage; regex only matches `sk-ant-`/`sk-`/`AIza` prefixes → extend pattern (`Bearer …`, `ghp_`, JWT `eyJ`) or fix the comment. |
| L-8 | hardcoded | `testing/run-service.ts:800` | `maxTurns: scenario.guardrails.maxTurns ?? 20` — magic default while peers are named constants → promote to a shared `DEFAULT_RUN_MAX_TURNS`. |
| L-9 | duplication | `vendor-assistant-executor.ts:948-956` / `vendor-assistant-message.ts:249-257` / `vendor-assistant-sse.ts:136-140`; `engine.ts:463-471` vs `703-712`; `test-service.ts:59-60` | `asRecord`/`asString` ×3; guardrail step-fold loop duplicated (with a double `estimateCost` call at :706/:711); `addAttachment` re-parses an already-parsed schema → extract shared util / single fold / drop double parse. |
| L-10 | perf | `scenario-repository.ts:24-29, 180-204`; `test-repository.ts:29-32, 213-214`; `testing/routes.ts:108` | `list()` hydration is N+1 (2 child queries per scenario, 1 per test); `GET /api/runs` returns unbounded history though the repo supports `limit` → batch with `IN (…)`, expose `?limit=`. |
| L-11 | bug | `testing/test-service.ts:67-71`; `packages/shared/src/schemas.ts:762-766` | Attachment blob written to disk before the DB insert (orphan on failure); `contentBase64` has no max length — only Fastify's default 1 MiB bodyLimit bounds it incidentally → unlink on insert failure, add an explicit shared max-bytes constant. |

### low-assistant

| # | Category | Location | Issue → recommendation |
| --- | --- | --- | --- |
| L-12 | bug | `assistant/routes.ts:352` | `request.raw.on("close", close)` attached after a potentially long synchronous replay — if the socket already closed, the heartbeat interval + channel subscription leak → after attaching, `if (request.raw.destroyed) close();` (same pattern in the other two SSE copies). |
| L-13 | bug/validation | `packages/shared/src/schemas.ts:1794` + `session-manager.ts:488` | `updatedInput: z.unknown()` cast to `Record<string, unknown>` — a string passes validation, then the SDK rejects the approved tool call → `z.record(z.unknown()).optional()` in shared. |
| L-14 | hardcoded | `assistant/repository.ts:60-63` | `const DEFAULT_MODEL = "claude-sonnet-4-5";` with a stale "WP 1.2 replaces this" comment; the roster shipped (`ASSISTANT_DEFAULT_MODEL_ROSTER`) but the literal was never replaced → derive from the shared constant. |
| L-15 | dead-code | `assistant/auth-service.ts:41, 48`; `packages/shared/src/types.ts:2834` | `AssistantAuthStatus.models` is permanently `[]` and unread (the dock uses `GET /api/assistant/models`) → keep on the wire (additive rule) but mark deprecated, remove the stale comment. |
| L-16 | dead-code | `claude-auth.ts:381-383`; `session-driver.ts:174/339, 197-199`; `context-envelope.ts:54-58`; `repository.ts:127-129`; `permission-classifier.ts:145-147` | `hasActiveFlow()` (zero callers anywhere), `DriverSession.sessionId()`, `createEmptyToolServer()` (stale WP 1.1 comment), `appendContextEnvelope()`, `listByEntity()`, `requiresApproval()` — test-only or unused → prune or `@internal`-tag. |
| L-17 | duplication | `auth-service.ts:19`/`retention.ts:32` (`MS_PER_DAY`); `tools/index.ts:99`/`workspace-tools.ts:34` (`DEFAULT_LIST_LIMIT`); `workspace.ts:214-218` vs `skills/repository.ts` (`looksBinary`); `session-manager.ts:385-393` vs `retention.ts:55-57` (thread-artifact cleanup trio) | Known-drift duplicates (one self-documents as "Mirrors…") → share one export each; extract `removeThreadArtifacts(dataDir, id)`. |
| L-18 | perf | `session-manager.ts:873-878, 888-891` (`repository.ts:261-266`) | Turn completion re-reads and `JSON.parse`s **every** event to answer count-shaped questions → `SELECT COUNT(*) … WHERE type = ?`. Also `permission_request`/`tool_call` events persist full raw `input` (an entire file body for a native `Write`) — `MAX_BUFFERED_EVENTS` bounds count, not bytes. |
| L-19 | perf | `assistant/routes.ts:223-231` (`workspace.ts:151/157`) | Workspace file-list route `readFileSync`s every file's full contents just to report `path`/`size`/`isBinary` → `stat` + bounded head-read sniff. |
| L-20 | convention | `assistant/routes.ts:381-394` | `parseThreadFilter` hand-parses the thread-list query; `entityKind` unvalidated against `ASSISTANT_ENTITY_KINDS` → shared zod query schema (also counted under m-35). |
| L-21 | observation | `session-manager.ts:543-545` | `retrySource` re-appends the last user message as a second persisted `user_message` with no marker linking it to the `source_switch` — transcript shows the text twice → tag the resent event (additive field). |

### low-skills

| # | Category | Location | Issue → recommendation |
| --- | --- | --- | --- |
| L-22 | perf/dead-code | `skills/ingest-service.ts:62-64` | Upload is spooled to disk (`fs.writeFileSync(path.join(tmpDir, sanitizeFilename(filename)), buffer)`) then never read — `stage()` uses the in-memory buffer; up to 50 MB of pointless I/O per upload → drop the spool write. |
| L-23 | duplication | `skills/routes.ts:738-744`, `skills/git-service.ts:547-552` | Cap-enforcement loops inlined instead of `assertTreeWithinCaps` (git-service's incremental ordering is a justified exception) → use the shared helper in `persistScaffoldedSkill`; factor an incremental variant. |
| L-24 | bug (edge) | `skills/ingest-service.ts:262-269` | `looksLikeZip` matches only `PK\x03\x04`; a mis-named empty archive (`PK\x05\x06`) falls through to the lone-SKILL.md branch → also match `PK\x05\x06`/`PK\x07\x08`. |
| L-25 | bug (edge) | `skills/routes.ts:788-811, 858-865` | A filename of only punctuation slugs to empty → falls back to `"skill"`; cosmetic (manifest name overwrites it) — no change strictly required. |

### low-grading-suites-collections

| # | Category | Location | Issue → recommendation |
| --- | --- | --- | --- |
| L-26 | dead-code | `grading/grader.ts:90-95` | `export function graderById(` — zero call sites in src and test → remove or use. |
| L-27 | bug | `collections/routes.ts:88-92, 100-104` | `DELETE /api/collections/A/tests/:testId` ignores `:id` — detaches the test even if it belongs to collection B → verify membership (or re-shape the route). |
| L-28 | bug | `suites/orchestrator.ts:475`; `packages/shared/src/schemas.ts:593-594` | Empty `testIds`/`scenarioIds` allowed; a 0-cell suite instantly finalizes `completed` while the collection path 400s → mirror the 400 for `cells.length === 0`. |
| L-29 | bug | `suites/orchestrator.ts:529-536, 615` | `stop()` 404s on a finished suite run (409 fits better) and doesn't wake workers parked in `waitForVendorAssistantSlot` — a stopped suite can't finalize until an unrelated slot frees → wake this control's waiters on stop. |
| L-30 | security | `git/git-credential.ts:117-119` | `redactUrl` regex requires `user:pass@`; a `https://token@host` form is not redacted → broaden to `https:\/\/[^@\s/]+@`. |
| L-31 | bug | `grading/judge.ts:432` vs `:156` | `extractRatingLogprobs` (`/<rating>(\d+)<\/rating>/i`) stricter than `parseRating` (whitespace + decimals) — `<rating> 8 </rating>` silently loses logprob weighting → align the regexes. |
| L-32 | bug | `grading/skillflow-conformance.ts:89-90`, `grading/tool-hygiene.ts:144-146` | Unvalidated enum indexing (`tallies[key]`, `TOOL_HYGIENE_CHECKS[...]`) throws on an unknown kind/checkId (caught into an `error` grade row, but silently breaks the grader) → guard the lookup. |
| L-33 | hardcoded | `git/git-credential.ts:56` (`maxBuffer: 16 MiB`), `collections/git-sync.ts:71` (`gitTimeoutMs ?? 120_000`, no env), `suites/orchestrator.ts:113` (`VENDOR_ASSISTANT_MAX_CONCURRENCY = 4`) | Ops knobs not tunable without a rebuild → env entries for at least the git timeout. |
| L-34 | bug | `grading/failure-buckets.ts:235-238` | Docs say "Given a FINISHED suite run" but status is never checked; buckets on a running suite run get clobbered by `finalize()` → reject non-terminal status (409). |
| L-35 | perf | `suites/suite-report-service.ts:356, 451, 494, 665, 671` | `grades.latestByGrader(runId)` executed 3× per member + `runs.getRun(runId)` hydrates full step detail just for `finalAssistantText` → batch per member; lighter answer projection. |

### low-compatibility-reports-compare

| # | Category | Location | Issue → recommendation |
| --- | --- | --- | --- |
| L-36 | dead-code | `compatibility/session.ts:381-397, 627, 64, 369`; `compatibility/routes.ts:93, 127` | `SESSION_RATE_LIMIT_THROUGHPUT` fully implemented but in the `EXCLUDED` set (unreachable); `costBudgetUsd` option never passed by production callers; route doc says "8 session tests" — 6 run → wire or mark test-only; fix the doc. |
| L-37 | duplication | `compare/routes.ts:17-25` = `compatibility/routes.ts:23-30` (+ run variant :102-110) | Byte-identical `loadScanOrNull` → hoist a `getDetailOrNull` onto the repository. |
| L-38 | bug | `compatibility/runner.ts:521, 527-528` | All-`na` cell gets `score: null` but `band: "green"` — "no data" reads as "compatible" (the unknown-model flavor is guarded at routes.ts:113-125; the in-dataset flavor isn't) → neutral band or explicit UI treatment of `score === null`. |
| L-39 | hardcoded | `reports/reports.ts:51, 67, 83` | `.slice(0, 25)` repeated 3× unnamed, with no "+N more" note (server-report markdown advertises "no truncation") → name the constant, emit "…and N more". |
| L-40 | bug (cosmetic) | `suite-run-report.ts:430-434` | `demoteMarkdownHeadings` regex rewrites `# `-prefixed lines inside fenced blocks and clamps `###`/`####` both to `######` → skip fenced regions, demote by less. |
| L-41 | bug | `reports/reports.ts:148, 208, 274` | `MODEL_CONTEXT_LIMITS[scenario.model]` misses snapshot-pinned ids ("context limit unknown") while the compatibility engine alias-resolves the same id (`compatibility/dataset.ts:71-79`) → shared alias-aware lookup. |
| L-42 | hardcoded | `compatibility/dataset.ts:117-123`; `apps/web/src/features/reports/ServerReportDialog.tsx:34` | `DEFAULT_HEATMAP_MODELS` hand-maintained with an admitted web mirror; a dataset rotation silently shrinks default columns → drift test that every default id resolves; serve the default set from `/api/compatibility/models`. |
| L-43 | duplication | `runner.ts:74-82` = `session.ts:77-87` = `resolve.ts:23-33` (`getPath`); `session.ts:406-433` ≈ `runner.ts:475-504` (`toResult`) | Three copies of `getPath` in one directory (one with a "do not import across" comment) → a `./paths.ts` util wouldn't couple the engines. |
| L-44 | duplication | `reports/run-kpi-by-step.ts:7-11` | Declared verbatim fork of `RunConsole.tsx` "lines ~671–733 … keep in lockstep" — line refs rot, nothing enforces parity → move the pure logic to `packages/shared` (it has no web/api deps). |
| L-45 | bug (cosmetic) | `suite-run-report.ts:347` | Cell links are root-relative API paths (`[id](/api/reports/run/…)`) inside a downloadable `.md` — resolve nowhere outside the app origin → inline code or a base-URL option. |

### low-core

| # | Category | Location | Issue → recommendation |
| --- | --- | --- | --- |
| L-46 | dead-code | `db/database.ts:27-28` | Stale `// TODO: use the shared LOCAL_COLLECTION_NAME constant once WP 1.1 lands` — WP 1.1 landed (`DEFAULT_COLLECTION_NAME`, `packages/shared/src/constants.ts:624`) → import the shared constant. |
| L-47 | duplication/hardcoded | `mcp/client.ts:41, 233, 262, 280, 300, 347` | Six copy-pasted `new Client({ name: "mcp-token-footprint", version: "0.1.0" }, …)` (version diverges from `config.appVersion`) and four identical connect-try/close-finally wrappers → `makeClient()` + `withClient(config, options, fn)`. |
| L-48 | duplication | `providers/registry.ts:32, 80-89` vs `providers/model-catalog.ts:19, 441-450` | Identical `DEFAULT_OLLAMA_BASE_URL` and byte-identical `requireBaseUrl` in both files → extract. |
| L-49 | duplication | `scans/service.ts:295-451` | `callTool`/`readResource`/`getPrompt` are three near-identical ~50-line measure-request → call → measure-response → identical-catch blocks → extract `measuredCall(...)`. |
| L-50 | bug | `config/env.ts:75, 97` | `port: Number(process.env.PORT ?? 8080)` — `PORT=""` → 0 (random bind), `PORT=abc` → NaN; line 97 re-parses `PORT` instead of reusing → `readPositiveInt(process.env.PORT, 8080)` (helper already exists at line 34). |
| L-51 | bug (minor) | `mcp/auth-error.ts:26-31` | `message.includes("401")` — any error text containing "401" (port, byte count) classifies as auth-required → anchor the match (`/\b(401|403)\b/` near "status"/"HTTP"). |
| L-52 | bug (minor race) | `oauth/service.ts:86-108` | Callback completion is check-then-act; two concurrent callbacks with the same `state` both pass the `completed_at` guard → `completeFlow` guarded by `WHERE completed_at IS NULL` + `changes` check. |
| L-53 | perf (minor) | `oauth/provider.ts:41, 49, 65, 79`; `providers/repository.ts:199-211` | Every provider callback re-fetches + decrypts all four credential fields; `redact()` performs a full linked-auth resolve per row on every `GET /api/providers` → memoize per instance if flows get chatty. |
| L-54 | bug (verify intent) | `scans/repository.ts:271-284` | `latest-scan` has no `status` filter — a just-failed or still-running scan shadows the last good one → filter to success/terminal or expose both. |
| L-55 | convention/security (minor) | `index.ts:475, 490-492` | Central handler logs expected 4xx at `error` level (alert fatigue); `GET /api/health` returns `databasePath` + `dataDirectory` unauthenticated — fine local-only, revisit before the team-server workstream → 4xx at `warn`, trim health payload when auth lands. |
| L-56 | hardcoded | `providers/service.ts:14` (`MODEL_CACHE_TTL_MS`), `model-catalog.ts:81, 21` (`APP_CONTEXT_TTL_MS`, `MAX_PAGES`), `vendor-assistant-probe.ts:33` (`ASSISTANTS_PROBE_LIMIT = 100`), `servers/asset-proxy.ts:16` (`MAX_ASSET_BYTES`), `oauth/repository.ts:16` (`OAUTH_FLOW_TTL_MS`), `pricing.ts:80` (`CACHE_WRITE_MULTIPLIER = 1.25`) | Documented-in-place operational constants; none env-tunable — acceptable, but sweep alongside m-33. |

---

## verified-clean

Areas explicitly checked and found sound (worth preserving through any refactor):

- **Secrets** (`secrets/secret-store.ts`, `servers/repository.ts:140-172, 258-259`, `providers/repository.ts:147-170`): AES-256-GCM with AAD + per-value IV; key file `0o600`/`wx` with race-safe EEXIST re-read; transactional plaintext→encrypted migrations; public shapes expose only booleans. No secret logging found anywhere in scope (h-10 leaks tenant *metadata*, not keys). PATs argv-only in git; every surfaced git error passes `redactUrl` (modulo L-30).
- **Migrations** (`db/database.ts`): FK-off + `foreign_key_check`-before-commit rebuild discipline; self-guarding rebuilds (v5/v16/v23); documented v10 placeholder.
- **Indexes**: every hot lookup found has a matching index (scans by `(server_id, scanned_at DESC)`, tool scans by `(scan_id, total_tokens DESC)`, `idx_run_grades_run`, the v19 `runs(suite_run_id)` index).
- **Token counting**: encoders lazily built once per profile and cached; single serialized-payload counting path; `counting_version` guard in compare **is** enforced (`compare/service.ts:82-85`) with deltas suppressed on mismatch.
- **Testing SSE + run lifecycle**: heartbeat/listener cleanup on disconnect and terminal; `terminalRef`-style settled guards; session teardown cannot reject; orphan-run reconciliation wired at startup; delete-run detach (F3) correct; several suspected races (stop-vs-step, subscribe-vs-terminal) are handled by seq/settled/carry mechanisms.
- **Skills ingestion**: zip-slip rejected pre-inflation; zip-bomb caps enforced on both real ingest paths (streaming abort + stat-before-read) — the gap is only the two routes in h-4; blob dedup/orphan GC transactionally correct; SSRF guard (https-only + DNS resolution check) on skills GitHub paths — the gap is collections (h-1).
- **Assistant permission protocol**: all settle paths idempotent; timers/abort listeners detached; stop/detach/timeout fail closed to deny; deletes always ask; path traversal in workspace materialize/commit/read guarded incl. symlink-escape realpath checks.
- **Estimate module**: contract-first, thin route, pure math, unit-tested — no findings.
- **Test coverage** is broad (~154 test files). Notable gaps: no path-traversal test for collection `/resolve` (c-1), no concurrent-sync test (h-5), no route test for `POST /api/runs/:runId/compatibility` (m-25), no zero-cell suite-plan test (L-28).

## recommended-release-gate

Before an RC: fix **c-1**, **h-1**, **h-5**, **h-6** (collections git surface), **h-9** (graceful shutdown), **h-10** (debug dump), **h-11** (MCP child leak), **h-2**, **h-3**, **h-4**; then m-1, m-14, m-15, m-22, m-28–m-31 as the next tranche. The Lows are hygiene and can be batched opportunistically.
