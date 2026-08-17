# Production-readiness review 04 — Shared contract & infrastructure

**Date:** 2026-07-11 · **Reviewer:** automated agent pass (shared-contract / config / Docker / CI / e2e scope)

## Scope & method

Reviewed: `packages/shared/**` (the wire contract), root config (`package.json` + all workspace
`package.json`s, `pnpm-workspace.yaml`, `tsconfig*.json`, `biome.json`, `playwright.config.ts`,
`.env.example`, `patches/`), `Dockerfile`, `docker-compose.yml`, `.github/workflows/**`, `e2e/**`,
`apps/api/src/config/env.ts`, `.gitignore` / `data/` handling.

Method: direct file reads of every in-scope file; exhaustive `env.ts` ↔ `.env.example` variable
diff; grep-based usage counts for **all 108 exported constants** in `constants.ts` and **all 139
exported symbols** in `schemas.ts`; spot-check of 6 route families (servers, scans, compare,
skills, testing/runs, maintenance) against the shared zod schemas/TS types; inspection of the
built web bundle (`apps/web/dist/assets`) for contract-package leakage. Every citation below was
re-verified against the file before inclusion. Caveat: the git repository root is the **parent**
directory (`qlabs-ai-benchmark/`), which is outside this review's file access — findings that
depend on the parent (H1) state that explicitly. The quality gate itself was not run in this pass
(covered by review task 01).

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 2 |
| Medium | 10 |
| Low | 12 |
| **Total** | **24** |

Overall: the shared contract is unusually disciplined — all 6 spot-checked route families validate
request bodies with the shared zod schemas and type responses against shared TS types; no deep-path
imports bypass the `exports` map; secrets/env handling matches the documented rules. The real gaps
are infrastructural (CI absent from the project tree, LAN-exposed compose port, unfiltered prod
dependency tree) and systemic (the hand-mirrored zod↔TS split, version/changelog drift).

---

## High

### H1 — CI workflow does not exist in the project tree; docs and the quality gate claim it does
- **Category:** CI / docs drift
- **Files:** `.github/` (absent from `mcp-token-footprint/`); `README.md:34–35`; `CLAUDE.md` §1/§4; `.claude/rules/quality-gates.md`; `.dockerignore` (lists `.github/`)
- **Evidence:** `ls .github` → `No such file or directory` at the project root. `README.md:34–35`: "the root … `.github/workflows/ci.yml` runs typecheck/test/build/lint." `.dockerignore` even excludes `.github/` from the build context, implying it is expected to exist here.
- **Caveat:** the git root is the parent `qlabs-ai-benchmark/` (not accessible to this review). If `ci.yml` lives there it would run — but then every doc pointer inside this project ("root `.github/workflows/ci.yml`") refers to a file outside the project tree, and this review cannot verify its gates, its node/pnpm pinning against `packageManager: "pnpm@9.15.4"`, or whether it runs the web tests. If it does **not** live there, there is no CI at all.
- **Additionally verified:** even per the docs' own description, CI runs only the four gates — `pnpm test:e2e` (root `package.json:18`) is wired into **no** gate anywhere.
- **Recommendation:** place (or symlink docs to) the workflow where the git root actually is; pin node 22 + `packageManager`-driven pnpm in it; add an e2e job (the Playwright suite is deterministic and self-contained per `playwright.config.ts`); make the in-repo doc pointers resolve.

### H2 — docker-compose publishes the no-auth app on all interfaces
- **Category:** Security / infra
- **File:** `docker-compose.yml:10–11`
- **Evidence:** `ports:` → `- "8080:8080"` (no host-IP prefix, so Docker binds `0.0.0.0`).
- **Why it matters:** the app has **no authentication** (single-owner local tool by design, `CLAUDE.md` §1), stores provider/OAuth/MCP secrets, and its API can register + scan a **stdio** MCP server — i.e. `POST /api/servers` with an arbitrary `command` is remote command execution inside the container for anyone on the LAN. `.claude/rules/mcp-and-security.md` treats secret redaction as non-negotiable, but the network boundary is left wide open.
- **Recommendation:** change to `"127.0.0.1:8080:8080"` (document an override for the planned team-server mode). This is a one-line change and the single highest-leverage hardening in scope.

---

## Medium

### M1 — Hand-duplicated token-profile union drifted: `generic_estimate` dropped in two places
- **Category:** Contract drift (latent bug)
- **Files:** `apps/web/src/App.tsx:1142–1144`; `apps/api/src/db/rows.ts:407` (contrast `rows.ts:38`); source of truth `packages/shared/src/constants.ts:7–14` (`TOKEN_PROFILES`)
- **Evidence:** `App.tsx:1142–1144`:
  ```ts
  function isTokenProfile(value: string | null): value is TokenProfileId {
    return value === "generic_o200k" || value === "generic_cl100k" || value === "raw_json_rough";
  }
  ```
  omits `"generic_estimate"`, a valid `TOKEN_PROFILES` member — a user who selected it is silently reset to the default on reload (the guard validates the persisted value). `rows.ts:38` lists all four profiles; `rows.ts:407` lists only three (`"generic_o200k" | "generic_cl100k" | "raw_json_rough"`).
- **Recommendation:** derive the guard from `TOKEN_PROFILES.includes(...)` and type both row fields as the shared `TokenProfileId`.

### M2 — `.env.example` missing variables the code reads: `COLLECTIONS_DIR`, `VENDOR_ASSISTANT_DEBUG`
- **Category:** Config / docs
- **Files:** `.env.example` (neither var present, verified against the full 137-line file); `apps/api/src/config/env.ts:88–90` (`process.env.COLLECTIONS_DIR`); `apps/api/src/providers/model-catalog.ts:85`, `apps/api/src/testing/vendor-assistant-executor.ts:170,814,819,824` (`process.env.VENDOR_ASSISTANT_DEBUG`); `docker-compose.yml:19` (`VENDOR_ASSISTANT_DEBUG: "${VENDOR_ASSISTANT_DEBUG:-}"`)
- **Evidence:** env.ts comment: "Benchmarks (WP 4.2, B11) — base dir for per-collection git working clones" — but `.env.example` documents every other `DATA_DIR`-derived dir (`ATTACHMENTS_DIR`, `ASSISTANT_DATA_DIR`) and skips this one. `VENDOR_ASSISTANT_DEBUG` is even plumbed through compose yet documented nowhere. It is also the only env var read via bare `process.env` outside `config/env.ts` (all other API reads are `PATH`/`CLAUDE_CONFIG_DIR` in spawn-env plumbing).
- **Recommendation:** add both to `.env.example`; move the `VENDOR_ASSISTANT_DEBUG` read into `config/env.ts` so the config hub stays exhaustive.

### M3 — Five orphaned zod schemas; zod↔TS wire types are hand-mirrored with no compile-time link
- **Category:** Contract drift (systemic)
- **Files:** `packages/shared/src/schemas.ts:353` (`judgeSettingsResolvedSchema`), `:370` (`toolHygieneFindingSchema`), `:1255` (`skillTraceResponseSchema = sessionTraceSchema` — dead alias), `:1648` (`boundToolSchema`), `:1701` (`skillUsageSchema`); `packages/shared/src/types.ts` (zero `z.infer`, no import from `schemas.ts`)
- **Evidence:** whole-repo grep of each schema name returns only its definition line, while the parallel TS types are live on the wire (`BoundTool` 15 references, `SkillUsage` 5, `JudgeSettingsResolved` used by `apps/api/src/grading/routes.ts:69,76,129`). `schemas.ts` itself admits the design: "mirrors the TS shapes in types.ts exactly" — mirrored by hand, so nothing forces sync.
- **Recommendation:** either delete the five dead schemas, or (better, incrementally) make TS types `z.infer<typeof schema>` for new/touched shapes so one side is derived from the other.

### M4 — Runtime Docker image ships the web app's runtime dependencies although the web is static
- **Category:** Docker / image size
- **Files:** `Dockerfile:49` (`pnpm install --frozen-lockfile --prod` — unfiltered, whole workspace), `Dockerfile:77` (`COPY --from=prod-deps /app/node_modules ./node_modules`); `apps/web/package.json` `dependencies` (`react`, `react-dom`, `react-router-dom`, `lucide-react ^0.577.0`, `@xyflow/react ^12.3.6`)
- **Evidence:** the Dockerfile comment (lines 29–34) correctly notes the web **dev** toolchain is excluded, but the web's `dependencies` are still prod-installed and land in the hoisted `/app/node_modules` copied into the runtime image — dead weight, since `apps/web/dist` is static and served by `@fastify/static`.
- **Recommendation:** `pnpm install --prod --filter @mcp-token-footprint/api...` in the `prod-deps` stage (or move the web's deps to `devDependencies`, matching how `@brand/*` is already handled).

### M5 — zod + all schema-construction code is bundled into the browser SPA
- **Category:** Web bundle / contract packaging
- **Files:** `packages/shared/src/index.ts:8` (`export * from "./schemas.js";`); `packages/shared/package.json` (no `"sideEffects": false`); verified: `grep -l "ZodError" apps/web/dist/assets` → `index-DbMezVmr.js`
- **Evidence:** `apps/web/src` never imports zod or any schema (grep: zero `from "zod"` hits), yet the built entry chunk contains `ZodError` — the barrel re-export plus the missing `sideEffects` hint defeat tree-shaking, so ~1,900 lines of schema construction + zod ship to every browser.
- **Recommendation:** add `"sideEffects": false` to `packages/shared/package.json`, and/or have the web import from a schemas-free entry (the unused `./types`/`./constants` subpath exports already exist — see L3).

### M6 — Version reporting is inconsistent and the changelog is stale
- **Category:** Release hygiene
- **Files:** root `package.json:3` (`"version": "0.2.0"`); `apps/api|web/package.json`, `packages/shared/package.json` (all `0.1.0`); `apps/api/src/config/env.ts:73` (`appVersion: process.env.npm_package_version ?? "0.1.0"`); `Dockerfile:116` (`CMD ["node", "apps/api/dist/index.js"]`); `apps/api/src/index.ts:485–495` (`/api/health` returns `version: config.appVersion`); `CHANGELOG.md` (last entry `0.2.0 — 2026-07-02`)
- **Evidence:** in Docker the process is started by `node` directly, so `npm_package_version` is unset and `/api/health` reports **0.1.0**; `pnpm start` on a dev box reports **0.2.0**. Meanwhile CLAUDE.md documents whole feature waves shipped after 2026-07-02 (testing-IA v16, the vendor assistant v23/v24, Assistant Phases 0–3, the UX overhaul) with no changelog entry and no version bump.
- **Recommendation:** derive `appVersion` from the root `package.json` at build/startup (read the file) instead of `npm_package_version`; bump to 0.3.x and backfill the changelog before calling anything a release candidate.

### M7 — No `engines` field anywhere; Node version pinned only implicitly
- **Category:** Version pinning
- **Files:** root + all workspace `package.json`s (grep `"engines"` → zero hits); `Dockerfile:1` (`node:22-bookworm-slim`); `@types/node ^22.20.0`
- **Evidence:** pnpm is pinned (`packageManager: "pnpm@9.15.4"`, honored by corepack in the Dockerfile), but nothing stops a contributor on Node 18/20 — where `--env-file-if-exists` (used by `apps/api/package.json` `dev`/`start` scripts, Node ≥ 22.9 for the `-if-exists` variant) and the healthcheck's global `fetch` assumptions differ.
- **Recommendation:** add `"engines": { "node": ">=22.9" }` to the root `package.json` plus `engine-strict=true` in `.npmrc`.

### M8 — e2e suite is real but wired into nothing, and its config/specs are never typechecked
- **Category:** Dead config / CI gap
- **Files:** `e2e/smoke.spec.ts` (747 lines, 10 tests); root `package.json:18` (`"test:e2e": "pnpm build && playwright test"`); `playwright.config.ts:43–45`; root `tsconfig.json` (base-only, no `include`; no package's `tsc -p` covers `e2e/` or `playwright.config.ts`)
- **Evidence:** `pnpm typecheck` is `pnpm -r --sort typecheck` (per-package), so `e2e/smoke.spec.ts` and `playwright.config.ts` are linted by Biome but typechecked by nobody. `playwright.config.ts:44–45` bakes in a sandbox-specific browser path: `existsSync("/opt/pw-browsers/chromium")` (guarded, so harmless off-sandbox, but environment-coupled). No CI job runs it (see H1).
- **Recommendation:** add a root `typecheck:e2e` (a small `tsconfig.e2e.json`), fold it into the gate, and give e2e a CI job with `playwright install --with-deps chromium`.

### M9 — No SQLite backup/restore path and no container log rotation
- **Category:** Production readiness / ops
- **Files:** `apps/api/src/db/maintenance.ts` (only `checkpoint` / `vacuum` / `prune-scans` / `prune-assistant`); `docker-compose.yml` (no `logging:` block); `CLAUDE.md` team-server row ("backup/restore + retention UI" — 🔜 Planned)
- **Evidence:** the only copy of all scans, runs, skills, and **encrypted secrets** is `/data/app.sqlite` + `mcp-secret.key` in one named volume; there is no `VACUUM INTO`/backup endpoint, and losing the volume loses everything (the secrets are unrecoverable by design). Container stdout logging (pino) uses Docker's default unbounded `json-file` driver.
- **Recommendation:** add a `POST /api/maintenance/backup` using SQLite's online backup (`VACUUM INTO` a timestamped file under `/data/backups`) + a documented volume-backup recipe, and a `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }` block in compose. Cheap wins that shouldn't wait for the team-server phase.

### M10 — The Biome lint gate is substantially weakened
- **Category:** CI / quality gate
- **File:** `biome.json:36–62`
- **Evidence:** on top of `"recommended": true`, **15 recommended rules are switched off**, including correctness/suspicious ones: `useExhaustiveDependencies` (React hooks deps — a real bug class in a hooks-heavy SPA), `noImplicitAnyLet`, `noAssignInExpressions`, `noArrayIndexKey`, `useConst`, `noAccumulatingSpread`. Also `"vcs": { "enabled": false }` (line 13–15) means Biome does not respect `.gitignore` beyond the manual ignore list.
- **Recommendation:** re-enable at least `useExhaustiveDependencies` and `noImplicitAnyLet` (as `"warn"` first if the diff is large); the "clean lint" gate currently proves less than the docs imply.

---

## Low

### L1 — Dockerfile healthcheck hardcodes port 8080 while `PORT` is configurable
- **Category:** Docker
- **Files:** `Dockerfile:68` (`ENV PORT=8080`) vs `Dockerfile:111–112`
- **Evidence:** `CMD node -e "fetch('http://127.0.0.1:8080/api/health')…"` — overriding `PORT` at runtime silently makes the container permanently unhealthy. Same literal in `docker-compose.yml:27`.
- **Recommendation:** `fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health')`.

### L2 — No init process in the image itself; zombie-reaping depends on compose
- **Category:** Docker
- **Files:** `docker-compose.yml:6–9` (`init: true` + the comment admitting the risk); `Dockerfile` (no tini/ENTRYPOINT)
- **Evidence:** compose comment: "without a real init process, a killed/crashed SDK child can be left as a zombie under the Node PID 1." Anyone running `docker run` without `--init` (the README's compose path is fine) inherits the zombie problem.
- **Recommendation:** add `tini` (or document `--init` as required) so the image is safe standalone.

### L3 — Dead exports in the shared package
- **Category:** Dead code
- **Files:** `packages/shared/src/constants.ts:202` (`ASSERTION_KINDS`) and `:773` (`ASSISTANT_DEFAULT_IDLE_TIMEOUT_MS`) — zero references outside their definition lines (verified for all 108 exported constants); `packages/shared/package.json` `exports` subpaths `./types`, `./schemas`, `./constants` — all 634 workspace imports use the bare specifier, none uses a subpath.
- **Recommendation:** delete the two constants (env.ts hardcodes `600_000` at line 151 instead of using the idle-timeout constant — either wire it up or drop it); keep or drop the subpaths deliberately (M5 gives them a purpose).

### L4 — Constants duplicated as literals instead of imported from shared
- **Category:** Duplication
- **Files/Evidence:**
  - `apps/web/src/features/testing/environment-form.ts:60` `defaultProfiles: ["generic_o200k"]` and `:62` `toolLoadingMode: "eager"` — duplicate `DEFAULT_TOKEN_PROFILE` (`constants.ts:16`) and `DEFAULT_TOOL_LOADING_MODE` (`constants.ts:62`); `DEFAULT_TOOL_LOADING_MODE` has zero non-test app references at all.
  - `DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1"` defined twice: `apps/api/src/providers/model-catalog.ts:19` and `apps/api/src/providers/registry.ts:32`.
- **Recommendation:** import the shared defaults; hoist the Ollama URL to one module.

### L5 — Maintenance routes bypass the shared-zod validation pattern
- **Category:** Contract consistency
- **File:** `apps/api/src/db/maintenance.ts:72–75, 84–89`
- **Evidence:** `const raw = (request.query as { keep?: string }).keep;` + hand-rolled `Number(...)` coercion — the only route family of the six checked that validates nothing with zod (defensive clamping makes it safe, but it breaks the codebase's own convention).
- **Recommendation:** add tiny `maintenancePruneQuerySchema`s in shared.

### L6 — Stale on-disk artifacts
- **Category:** Dead config / hygiene
- **Files:** `dist/next-wp.skill` at the project root (dated Jun 20; `dist` is gitignored, so a local orphan); `packages/brand-ui/` still present containing only `dist/` + `node_modules/` (the adapter's source was deleted per `CLAUDE.md` §3 — no `package.json`, so pnpm ignores it, but the corpse invites confusion); 8 × `apps/web/vitest.config.ts.timestamp-*.mjs` litter (gitignored, but a symptom of vitest config transpile crashes).
- **Recommendation:** `rm -rf dist packages/brand-ui apps/web/vitest.config.ts.timestamp-*` locally.

### L7 — `/api/health` discloses server filesystem paths to the browser
- **Category:** Security (minor, local tool)
- **File:** `apps/api/src/index.ts:485–495`
- **Evidence:** the health payload returns `databasePath` and `dataDirectory` (absolute host paths). Combined with H2's default LAN exposure this leaks layout information to any network caller.
- **Recommendation:** gate the path fields behind `dockerMode`/debug, or drop them from the payload.

### L8 — Docs still claim "web has no tests yet"
- **Category:** Docs drift
- **Files:** `CLAUDE.md` §4 ("`pnpm test` — API tests …; web has no tests yet") and `.claude/rules/quality-gates.md` (Test row: "Web has no tests yet")
- **Evidence:** `apps/web` has a full vitest harness (`vitest.config.ts` with coverage thresholds; CLAUDE.md's own UX-overhaul row cites "web tests 68→254"). The root `pnpm test` (`pnpm -r --if-present test`) does run them.
- **Recommendation:** fix both docs.

### L9 — No LICENSE file
- **Category:** Release hygiene
- **Evidence:** `ls LICENSE*` → nothing at the project root; packages are `"private": true` so nothing is published, but a "production release candidate" (even internal) should declare terms.
- **Recommendation:** add a LICENSE (or an explicit "proprietary — internal" notice).

### L10 — compose duplicates the image healthcheck and passes through almost no tunables
- **Category:** Config
- **Files:** `docker-compose.yml:21–32` (verbatim copy of `Dockerfile:111–112`'s check — two places to drift); `docker-compose.yml:12–19` (environment: only the fixed basics + `VENDOR_ASSISTANT_DEBUG`; no passthrough for `MCP_SECRET_KEY`, `SCAN_RETENTION_PER_SERVER`, `ASSISTANT_*`, `DEFAULT_TOKEN_PROFILE` override, etc.)
- **Recommendation:** drop the compose healthcheck (inherit the image's) and add an `env_file: .env.local`-style passthrough so operators don't edit compose to tune retention/assistant settings.

### L11 — Shared package types resolve to `src` while runtime resolves to `dist`
- **Category:** Build correctness (latent)
- **File:** `packages/shared/package.json` (`"types": "./src/index.ts"`, `"default": "./dist/index.js"`)
- **Evidence:** typecheck always sees current source, but the API at runtime imports a **built** `dist` — a stale `dist` (e.g. running `pnpm --filter api test` after editing shared without the script's rebuild step) type-checks green and runs old code. Mitigated by the `dev`/`test` scripts pre-building shared, but nothing enforces it for ad-hoc invocations.
- **Recommendation:** consider `tsc --build` project references or a `prepare` script so shared can't be consumed stale.

### L12 — `apps/web` tsconfig does not cover its own vitest config/setup
- **Category:** Typecheck coverage
- **File:** `apps/web/tsconfig.json` (`"include": ["src", "vite.config.ts"]`)
- **Evidence:** `vitest.config.ts` and `vitest.setup.ts` sit outside `include`, so `pnpm typecheck` never checks them (Biome lints them only).
- **Recommendation:** add both to `include`.

---

## What was checked and found clean (for the record)

- **Route-family contract spot-checks (6/6 in sync):** servers (`serverProbeRequestSchema`/`serverConfigInputSchema`/`serverConfigUpdateSchema` at `apps/api/src/servers/routes.ts:40,96,108`), scans (4 schemas), compare (`compareQuerySchema`, `routes.ts:28`), skills (7 mutating handlers all validated), testing/runs (5 schemas; `testInputSchema` field-diffed against `TestInput` — exact match), grading (`runReportSchema`↔`RunReport`, `runGradeSchema`↔`RunGrade` — identical). Maintenance is the lone exception (L5).
- **No deep-path `@mcp-token-footprint/shared/*` imports** (634/634 bare-specifier imports); `index.ts` re-exports all nine modules.
- **`.gitignore` / data handling correct:** `/data` (root-only, deliberately not nested `data/` dirs), `.env*` except `.env.example`, Playwright artifacts, worktree litter all covered; `data/app.sqlite` + `data/mcp-secret.key` exist locally and are ignored.
- **node-pty patch:** still required (upstream 1.1.0 ships `spawn-helper` without +x), correctly declared in `pnpm.patchedDependencies`, present in `pnpm-lock.yaml` (`patch_hash=…`), and copied into **both** Docker install stages before `pnpm install` (`Dockerfile:25,47`) — applied in Docker. ✔
- **Dockerfile fundamentals:** multi-stage with sensible layer caching (manifests before source), `NODE_OPTIONS=--max-old-space-size=3400` honored and scoped to the build stage (`Dockerfile:56`), non-root `node` user with `/data` chown (`:105,114`), working healthcheck, prod image free of the web dev toolchain, read-only skill-authoring resources enforced via root ownership.
- **pnpm/corepack pinning consistent** (`packageManager` + `corepack enable`); TypeScript `^5.6.3` and React 19 aligned across packages; Playwright pinned exactly (`1.56.0`).
