# Docs-vs-Code Consistency Audit — 07

Release-candidate validation pass over `CLAUDE.md`, `README.md`, `.claude/rules/*`, the
`roadmap/*/STATUS.md` ledgers, `CHANGELOG.md`, and the older audit/research docs, checked against
the code as of **2026-07-11**.

## Method

- Spot-checked ~18 concrete factual claims in `CLAUDE.md` against source (`Read`/`Grep` on
  `packages/shared/src/constants.ts`, `apps/api/src/db/database.ts`, `apps/api/src/db/schema.ts`,
  `apps/api/src/config/env.ts`, `apps/api/src/index.ts`, `package.json`, `.mcp.json`,
  `apps/web/src/App.tsx`, `apps/web/package.json`).
- Verified every `roadmap/*/STATUS.md` ledger named in `CLAUDE.md` exists; deep-read three ledgers
  (`skill-ide`, `auto-rating`, `qlik-answers`/`assistant` spot checks) and confirmed their "Built"
  claims against real files.
- Resolved every relative link/path cited in `CLAUDE.md`, `README.md`, and the rules docs.
- Test counts were **not** obtained by running tests (out of scope); they are grep counts of
  line-leading `test(`/`it(` occurrences: **~1,494 in `apps/api/test` (154 files)** and
  **~725 in `apps/web/src` (79 test files)**. Subtests (`t.test(...)`) make the true `node:test`
  count higher, so the dated per-row snapshots in CLAUDE.md (851 → 1511) are plausible but
  unverifiable here.
- The quality gate itself (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) was **not run**
  in this pass (covered by validation task 01).

## Summary table

| # | Severity | Doc | Claim | Reality |
|---|----------|-----|-------|---------|
| 1 | **High** | CLAUDE.md §1 table | Skill IDE "🔜 Planned, HIGH priority" | All 20 WPs done + e2e-validated per `roadmap/skill-ide/STATUS.md`; code shipped |
| 2 | **High** | CLAUDE.md §1 table | Auto-Rating "🔜 Planned, HIGH priority" | Phases 1–4 (11/13 WPs) done 2026-07-11 per `roadmap/auto-rating/STATUS.md`; grading routes + env wired |
| 3 | **High** | `.claude/rules/quality-gates.md` | "Web has no tests yet." | 79 web test files / ~725 tests; `apps/web` has a vitest `test` script that `pnpm test` runs |
| 4 | Medium | CLAUDE.md §4 | `pnpm test` — "web has no tests yet" | Same as #3; contradicts CLAUDE.md's own table ("566 web tests") |
| 5 | Medium | `.claude/rules/architecture.md` | "View switching is local state (`activeView: ViewKey` in `App.tsx`), not a router" | `App.tsx:888` renders react-router `<Routes>`; contradicts CLAUDE.md §3/§5 |
| 6 | Medium | CLAUDE.md §6 | Endpoint families list (10 families) | Omits 6 registered families: estimate, grading, suites/run-plans, collections, skillflow, assistant |
| 7 | Medium | CHANGELOG.md | Last entry `0.2.0 — 2026-07-02` | Major shipped work since (UX overhaul, Skill IDE, testing-ia v16, Qlik Answers v23/v24, Assistant, Auto-Rating) unrecorded |
| 8 | Medium | CLAUDE.md §8 + `.claude/rules/library-first.md` | `apps/web/src/components/` contains `CodeBlock` / `components/CodeBlock.tsx` | No such file; only `features/testing/CodeSnippet.tsx` exists |
| 9 | Low | CLAUDE.md §7 | "Current tables span: …" (19 tables) | `schema.ts` defines 35 tables; suites/collections/grades/assistant families missing from the list |
| 10 | Low | CLAUDE.md §7 | Environment list (11 vars) | `env.ts` reads ~25 (ATTACHMENTS_DIR, COLLECTIONS_DIR, SKILL_QUALITY_*, ASSISTANT_* ×12, AUTO_RATING_* missing) |
| 11 | Low | `.claude/rules/dependencies.md` | Router library = "STOP and ask"; app uses "local view switching on purpose" | `react-router-dom` v7 already adopted (CLAUDE.md §3) |
| 12 | Low | `.claude/rules/architecture.md` | "Schema is created/migrated on startup in `schema.ts`" | Versioned migrations live in `database.ts` (schema.ts holds the baseline DDL) |
| 13 | Low | `roadmap/auto-rating/STATUS.md` header | "`MIGRATIONS` is at v21 today … v22 expected" | Migrations now end at v24; WP 4.1 (ticked) landed `suite_run_reports` |
| 14 | Low | README.md | "After implementation, the target command is:" | Implementation is done; phrasing is pre-MVP leftover |
| 15 | Low | README.md | Feature list + ledger pointers | Omits Benchmarks/suites, Collections, Compare workspace, SkillFlow/Skill IDE, Qlik Answers; points to only 2 of 15 ledgers (does defer to CLAUDE.md) |
| 16 | Low | `docs/UI-AUDIT-2026-06-20.md` (+ `UI-FIX-PROMPT-2026-06-20.md`) | Presented as live audit | Superseded by `UI-UX-AUDIT-2026-07-05.md` + completed ux-overhaul; no "historical" banner |
| 17 | Low | `research/EXPLORATION_FINDINGS.md` | Research "to inform a new model-compatibility test suite" | That suite (testing Phase 5) is built; doc is undated and unmarked |

Claims verified **accurate** (no finding): `TOKEN_COUNTING_VERSION = 2`
(`packages/shared/src/constants.ts:24`); latest migration **v24** (`database.ts:557`, with
`LATEST_SCHEMA_VERSION` auto-derived at `database.ts:568`); exactly **four token profiles**
(`constants.ts:7–14`: `generic_o200k`, `generic_cl100k`, `generic_estimate`, `raw_json_rough`);
`pnpm@9.15.4` (`package.json:6`); `.mcp.json` exists and registers the `brand-ui` MCP server;
ROADMAP.md carries a proper "Historical document" banner; all **15** `roadmap/*/STATUS.md` ledgers
named in CLAUDE.md exist; Qlik Answers code is real
(`apps/api/src/testing/qlik-answers-{executor,message,sse}.ts`, migration v23/v24); Assistant code
is real (`apps/api/src/assistant/` — 20+ modules incl. `spawn-env.ts`, `retention.ts`,
`session-manager.ts`); `.env.example` is current and thorough (incl. Assistant + Auto-Rating vars);
CI workflow exists at the **git** root `../.github/workflows/ci.yml` (one level above the project
root — the docs' "root" phrasing is fine but worth knowing).

---

## Findings by document

### CLAUDE.md

**F1 · High — Skill IDE row says "Planned"; it is built.**
- Claim: capability table — "**Skill IDE** … 🔜 Planned, **HIGH priority** — plan + locked
  decisions at `roadmap/skill-ide/`".
- Reality: `roadmap/skill-ide/STATUS.md` shows **every WP in Phases 1–9 ticked** (done
  2026-07-03…07-05, e.g. WP 9.4 line 58) plus an "E2E validation (2026-07-05)" section (lines
  60–79: "All 20 open WPs are merged into local `main` … gate green … test 851/851"). Code exists:
  `apps/web/src/features/skills/design/code-intel/`, `apps/api/src/skillflow/*` (quality, triggers,
  tool-validation, publish), env ceilings `SKILL_QUALITY_L1/L2_TOKEN_CEILING` at
  `apps/api/src/config/env.ts:111–118`, and migrations v17/v18 in `database.ts`.
- Fix: flip the row to ✅ Built (owner-acceptance walks pending, per the ledger's
  "Owner acceptance" section), mirroring how the SkillFlow/Assistant rows are written.

**F2 · High — Auto-Rating row says "Planned"; Phases 1–4 are done.**
- Claim: capability table — "**Auto-Rating** … 🔜 Planned, **HIGH priority**".
- Reality: `roadmap/auto-rating/STATUS.md` ticks WP 1.1–1.5, 2.1–2.3, 3.1–3.2, 4.1–4.3 — all
  "done 2026-07-11" (lines 29–74); only Phase 5 (owner-gated backlog) is open. Code:
  `judgeResolver, registerGradingRoutes` imported/registered in `apps/api/src/index.ts:49,546`;
  `AUTO_RATING_MAX_CONCURRENCY` / `AUTO_RATING_ENABLED` in `apps/api/src/config/env.ts:198,204`;
  `suite_run_reports` + `run_grades` in `apps/api/src/db/schema.ts` (lines 309, 381);
  `.env.example:121–130` documents the vars.
- Fix: flip the row to ✅ Built (Phases 1–4; Phase 5 owner-gated backlog open).

**F4 · Medium — §4 "web has no tests yet".**
- Claim: §4 command table — "`pnpm test`  # API tests (node test runner via tsx); web has no
  tests yet".
- Reality: 79 `*.test.ts(x)` files under `apps/web/src` (~725 tests);
  `apps/web/package.json:11` — `"test": "pnpm --filter @mcp-token-footprint/shared build && vitest run"`,
  which `pnpm -r --if-present test` executes. CLAUDE.md itself cites "566 web tests"
  (Assistant row) and "web tests 68→254" (UX overhaul row) — an internal contradiction.
- Fix: "`pnpm test` — API tests (node test runner via tsx) + web tests (vitest)".

**F6 · Medium — §6 endpoint families incomplete.**
- Claim: §6 — "the endpoint **families** are:" then 10 families (servers/scans, reports, compare,
  oauth, providers, testing, skills, compatibility, maintenance, health).
- Reality: `apps/api/src/index.ts:498–570` additionally registers **estimate**
  (`registerEstimateRoutes`, :510), **grading** (:546), **collections** (:547), **run-plans/suites**
  (:533, :551), **skillflow** (:569), and **assistant** (:570). Mitigated by §6's own "source of
  truth is `apps/api/src/**/routes.ts`" disclaimer, but the list is presented as the family
  enumeration and is 6 families short.
- Fix: add the six missing family bullets.

**F9 · Low — §7 table list is ~half the schema.**
- Claim: §7 — "Current tables span: MCP scans (…8 tables…); Testing (…8…); and Skills (…5…)".
- Reality: `apps/api/src/db/schema.ts` defines **35** tables, additionally `collections`, `suites`,
  `suite_tests`, `suite_scenarios`, `suite_runs`, `suite_run_reports`, `run_grades`, `app_settings`,
  `run_skills`, `skill_server_bindings`, and 4 `assistant_*` tables. §7 does say "Read `schema.ts`
  before assuming a column exists".
- Fix: either add "…; Benchmarks/suites (…); Assistant (…)" groups or reduce the sentence to the
  pointer alone.

**F10 · Low — §7 env-var list is a subset.**
- Claim: §7 lists `HOST, PORT, DATA_DIR, DATABASE_PATH, DEFAULT_TOKEN_PROFILE,
  MCP_SECRET_KEY[_PATH], OAUTH_REDIRECT_URL, WEB_DIST_PATH, DOCKER_MODE,
  SCAN_RETENTION_PER_SERVER, SKILL_MAX_*`.
- Reality: `apps/api/src/config/env.ts` also reads `ATTACHMENTS_DIR`, `COLLECTIONS_DIR`,
  `SKILL_QUALITY_L1/L2_TOKEN_CEILING`, 12 `ASSISTANT_*` vars, and 2 `AUTO_RATING_*` vars — all
  present in `.env.example` (which is current).
- Fix: append "… plus the Assistant (`ASSISTANT_*`), Auto-Rating (`AUTO_RATING_*`), and
  attachments/collections dirs — see `.env.example` for the full set".

**F8 · Medium — `CodeBlock` component no longer exists.**
- Claim: §8 — "App-specific compositions … live in `apps/web/src/components/` (`SelectField`,
  `CodeBlock`, `TokenViz`)"; same in `.claude/rules/library-first.md` ("the one sanctioned 'bring
  your own' is … `components/CodeBlock.tsx`").
- Reality: no `CodeBlock.tsx` anywhere in `apps/web/src` (glob + grep). `SelectField.tsx` and
  `TokenViz.tsx` exist; read-only code display is now `@brand/editor`'s Monaco `CodeEditor` and
  `features/testing/CodeSnippet.tsx`.
- Fix: drop `CodeBlock` from both docs (and update library-first.md's "sanctioned bring-your-own"
  paragraph to name the current mechanism).

**Verified accurate in CLAUDE.md** (sample): `TOKEN_COUNTING_VERSION` currently 2 ✓
(`constants.ts:24`); migrations end at **v24** ✓ (`database.ts:543–564`; `LATEST_SCHEMA_VERSION`
derived at :568 — note it's derived, not a literal, which the doc phrasing matches); four token
profiles with the exact names ✓; pnpm 9.15.4 ✓; `.mcp.json` with the `brand-ui mcp` stdio server ✓;
two themes + blueprint filtering (`apps/web/src/lib/theme.ts` exists) ✓; per-row test-count
snapshots (851/867/697/1143/1511 API · 254/566 web) are dated point-in-time values — current grep
floor is ~1,494 API / ~725 web, so ordering and magnitude are consistent, exact values uncheckable
without running the suite.

### .claude/rules/*

**F3 · High — `quality-gates.md` misstates the test gate.**
- Claim: "**Test** | `pnpm test` | API tests (node test runner via `tsx`, in `apps/api/test/`)
  pass. **Web has no tests yet.**"
- Reality: web has 79 vitest files (~725 tests) and they run under `pnpm test`
  (`apps/web/package.json:11`). A rules doc that defines "done" should not exclude ~⅓ of the suite.
- Fix: "API tests (node test runner via tsx) **and web tests (vitest)** pass."

**F5 · Medium — `architecture.md` still describes the pre-router UI.**
- Claim: "View switching is local state (`activeView: ViewKey` in `App.tsx`), **not a router**."
- Reality: `apps/web/src/App.tsx:888` — `<Routes location={location}>` (react-router-dom v7);
  CLAUDE.md §3/§5 and the capability table say URL routing is built.
- Fix: replace with "URL routing via `react-router-dom` v7 (`<Routes>` in `App.tsx`; deep-linkable
  routes + breadcrumbs)".

**F12 · Low — `architecture.md` Persistence paragraph.**
- Claim: "Schema is created/migrated on startup in `schema.ts`."
- Reality: baseline DDL in `schema.ts`; the versioned `PRAGMA user_version` migration engine is
  `apps/api/src/db/database.ts` (`MIGRATIONS`, `applyMigrations`). CLAUDE.md §7 states this
  correctly.
- Fix: "…created in `schema.ts`, migrated via versioned migrations in `database.ts`."

**F11 · Low — `dependencies.md` router wording.**
- Claim: "STOP and ask … A **state/data/router library** — the app uses `useState` +
  `localStorage` + `fetch` and local view switching on purpose."
- Reality: `react-router-dom` is an installed, sanctioned dependency (CLAUDE.md §3). The
  stop-rule should now read "state/data library" and drop "local view switching".

`loading-states.md`, `mcp-and-security.md`, `styling-and-tokens.md`, `brand-ui-only.md`,
`interaction-guidelines.md`: all file references checked resolve
(`use-run-stream.ts`, `ConversationPane.tsx`, `ChatMarkdown.tsx`, `ToolCallCard.tsx`,
`theme.ts`, hooks `guard-secrets.mjs`/`check-tokens.mjs`/`enforce-brand-ui.mjs`) — no findings
beyond F8's `library-first.md` CodeBlock mention.

### README.md

Largely current: features, ports (8080/5173), commands, brand-ui vendoring, secrets model, the
Assistant section (egress allowlist, node-pty patch — `patches/node-pty@1.1.0.patch` exists), and
the Qlik Cloud OAuth guidance all match code.

**F14 · Low —** "## Run / **After implementation, the target command is:**" — pre-MVP phrasing;
the app is long since implemented. Fix: "Run it with:".

**F15 · Low —** The "What it does" list and the ledger pointer (only `roadmap/testing/STATUS.md` +
`roadmap/skills/STATUS.md`) predate Benchmarks/suites, Collections, the Compare workspace,
SkillFlow/Skill IDE, and Qlik Answers. It does defer to CLAUDE.md for the authoritative picture,
so this is currency polish, not misinformation. Fix: one bullet each for suite/benchmark runs and
the visual skill designer, and point at "the `roadmap/*/STATUS.md` ledgers" generically (as the
closing line already does).

### roadmap/*/STATUS.md ledgers

- **Existence:** all 15 ledgers referenced from CLAUDE.md exist (glob-verified):
  testing, skills, skillflow, skill-ide, benchmarks, auto-rating, testing-ia, ci,
  security-posture, advisor, assistant, qlik-answers, team-server, platform, ux-overhaul.
- **Built-claims spot checks (pass):**
  - *qlik-answers* — executor/message/SSE modules exist
    (`apps/api/src/testing/qlik-answers-executor.ts` et al.); `answers_mode` migration v24 in
    `database.ts:543–563`; provider/model-catalog + suites member-compatibility touchpoints exist.
  - *assistant* — full module tree exists (`apps/api/src/assistant/`: session-manager,
    session-driver, spawn-env, retention, tools/{read,write,ui,workspace}); routes registered in
    `index.ts:570`.
  - *skill-ide* — see F1; ledger claims map to real files and to migrations v17/v18.
- **No inverse case found** (a ledger claiming built for missing code).
- **F13 · Low —** `roadmap/auto-rating/STATUS.md:13–15` header still says "WP 4.1 … **v22
  expected** — `MIGRATIONS` is at v21 today" while WP 4.1 is ticked and migrations end at v24;
  the "Contention override (2026-07-11)" note (lines 21–26) also says to remove itself once
  parallel sessions finish. Fix: tidy both notes.

### CHANGELOG.md

**F7 · Medium — not maintained past 2026-07-02.**
- Last entry: `## 0.2.0 — 2026-07-02 — Docs & process remediation wave` (line 7).
- Since then (per ledgers + docs dated in-repo): UX overhaul incl. the Compare Workspace rebuild
  (audit dated 2026-07-05), Skill IDE (2026-07-03…05), Assistant phases + refinements, testing-ia
  v16, Qlik Answers (migrations v23/v24), Auto-Rating (2026-07-11). Nine days of the heaviest
  feature work in the repo's history is unrecorded, and `package.json` still says `0.2.0`.
- Fix: add a `0.3.0` (or dated "unreleased") entry summarizing the shipped workstreams, or state
  in the header that the ledgers replace per-feature changelog entries entirely.

---

## Broken-links list

Every relative link/path checked resolves, **except**:

| Reference | Where | Status |
|---|---|---|
| `apps/web/src/components/CodeBlock.tsx` (`CodeBlock`) | CLAUDE.md §8; `.claude/rules/library-first.md` | **Missing** — component removed/renamed (see F8) |

Checked and resolving (sample of ~35): `roadmap/08-expanded-target.md`,
`UI-UX-AUDIT-2026-07-05.md`, `roadmap/ux-overhaul/verification-report.md`,
`roadmap/testing/{STATUS,conventions,ia-restructure-handover}.md`,
`roadmap/skills/{STATUS,conventions}.md`,
`roadmap/research/{insights-bench-qlik-assessment,qlik-answers-as-model}.md`, all 15
`roadmap/*/STATUS.md`, `vendor/brand/PROVENANCE.md` + 9 tarballs,
`vendor/brand-ui-agent-kit/` (manifest, llms/, playbooks/, skills/),
`.claude/commands/{quality,scan-server,audit-brand-usage,next-wp}.md`,
`.claude/hooks/{guard-secrets,check-tokens,enforce-brand-ui}.mjs`,
`.claude/skills/next-wp/SKILL.md`, `.mcp.json`, `.env.example`,
`apps/web/src/lib/{theme.ts,table.tsx}`, `apps/web/src/components/{SelectField,TokenViz}.tsx`,
`apps/api/src/providers/pricing.ts`, `patches/node-pty@1.1.0.patch`,
`docs/skill-authoring.md`. Note: the CI workflow is at the **git-repo** root
(`qlabs-ai-benchmark/.github/workflows/ci.yml`), one level above the project root the docs call
"root" — present, just outside `mcp-token-footprint/`.

## Stale-docs list

| Doc | State | Suggested action |
|---|---|---|
| `ROADMAP.md` | ✅ Properly marked "Historical document" with pointers | none |
| `roadmap/00-…02-*.md` | Marked historical per CLAUDE.md/CHANGELOG (not re-verified individually this pass) | none |
| `docs/UI-AUDIT-2026-06-20.md` | Superseded by `UI-UX-AUDIT-2026-07-05.md` + the completed ux-overhaul; **no banner** | add a one-line "superseded by …" header |
| `docs/UI-FIX-PROMPT-2026-06-20.md` | Companion prompt to the above; same staleness | same banner |
| `research/EXPLORATION_FINDINGS.md` | Undated pre-work for the compatibility suite, which is now built (testing Phase 5) | add date + "historical input to roadmap/testing phase 5" header |
| `roadmap/auto-rating/STATUS.md` header notes | "v21 today / v22 expected" + self-deleting contention override, both overtaken | tidy (F13) |
| `CHANGELOG.md` | Last entry 2026-07-02 | F7 |

## Severity counts

- **High: 3** (F1 Skill IDE row, F2 Auto-Rating row, F3 quality-gates test-gate claim)
- **Medium: 5** (F4 §4 web-tests, F5 architecture.md router, F6 §6 route families, F7 CHANGELOG,
  F8 CodeBlock reference)
- **Low: 9** (F9–F17: §7 tables, §7 env vars, dependencies.md router wording, architecture.md
  persistence, auto-rating header note, README phrasing, README feature currency, 2 unbannered
  stale docs + EXPLORATION_FINDINGS)
