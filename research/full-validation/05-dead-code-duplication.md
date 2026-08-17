# 05 — Dead code, duplication & dependency analysis

Automated tooling pass (jscpd · knip · ts-prune · depcheck · grep sweeps) over the pnpm
workspace, followed by manual verification of every significant hit. Run 2026-07-11 in the
sandboxed Linux workspace against the current working tree.

**Bottom line:** the codebase is remarkably clean for its size (~140k lines of TS/TSX across
514 source files). Verified dead code amounts to **2 unused component files** and **roughly a
dozen dead exports**; exactly **1 genuinely unused dependency** (`pino`); duplication is a low
**3.36% overall (~2.2% for TS/TSX once the generated model dataset is excluded)** and is
concentrated in 4–5 identifiable clusters. One real hygiene bug surfaced: a leftover
**"TEMP DEBUG — REMOVE"** `console.error` that dumps raw the vendor assistant roster data on every
roster fetch.

---

## 1. Tools & exact commands

All tools ran via `npx --yes` in the sandbox (registry access worked; the repo itself was not
modified — knip/ts-prune/depcheck ran against a source copy in `/tmp/kniproot` with
`node_modules` symlinked, because knip resolves module realpaths and a symlinked root made
every file look unused).

| Tool | Command | Status |
| --- | --- | --- |
| jscpd | `npx --yes jscpd apps/api/src apps/web/src packages/shared/src --min-tokens 50 --ignore "**/*.test.ts,**/*.test.tsx" --reporters json` | ✅ ran |
| knip (latest) | `npx --yes knip --no-config-hints --reporter compact` | ❌ crashed — `oxc-parser` `RangeError: Array buffer allocation failed` (sandbox has 3.9 GB RAM; oxc raw-transfer needs a huge ArrayBuffer) |
| knip 5.41.1 | `npx --yes -p typescript@5.8.3 -p knip@5.41.1 knip --no-config-hints` with a config that pins entries (`apps/api`: `src/index.ts` + `test/**/*.test.ts` + `src/compatibility/build-cli.ts`; `apps/web`: `src/main.tsx` + co-located tests; `packages/shared`: `src/index.ts`) and disables the vite/vitest/playwright/postcss/tailwind plugins (they `import` `vite.config.ts`, which pulls the **macOS-built** `lightningcss` native binary and dies on Linux) | ✅ ran (with the caveats below) |
| ts-prune | `npx --yes -p typescript@5.8.3 -p ts-prune ts-prune` per package, `grep -v "(used in module)"` | ✅ ran (apps/api: 23 hits, apps/web: 48, packages/shared: 606 — the shared numbers are meaningless standalone, see §7) |
| depcheck | `npx --yes depcheck .` per package | ✅ ran |
| grep sweeps | ripgrep over `apps/**`, `packages/**`, `e2e/**` for TODO/FIXME/HACK/XXX, `@ts-ignore`/`@ts-expect-error`, `biome-ignore`, `eslint-disable`, `console.*`, `.only(`/`.skip(` | ✅ ran |

Environment notes: the sandbox kills background processes between calls (no `nohup`/`tmux`
persistence), so every tool had to finish inside a single 45 s window — all did. knip's
plugin-disabling config means its *binary/devDep* findings are unreliable (it reported `vite`,
`vitest`, `tsx` as "unlisted binaries" purely because the plugins that map them were off);
those were discarded after manual checks.

---

## 2. Summary table

| Metric | Tool-reported | After manual verification |
| --- | --- | --- |
| Duplicated lines (all formats) | 294 clones · 4 843 lines · **3.36%** (24 771 tokens, 3.50%) | Real, but 74 clones / ~2 000 lines are inside the **generated** `apps/api/src/compatibility/data/all-models.json`; TS/TSX-only duplication ≈ **2.2%** |
| Unused files | knip: 2 | **2 verified dead** (§3.1) |
| Unused exports | knip: 115 (+311 unused exported types) | **~12 verified dead**; the majority are *exported-but-only-used-in-own-module* (removable `export` keyword) or *test-only* exports (§3.2, §7) |
| Unused dependencies | depcheck/knip: `pino`, `tsx` (api); `@vitest/coverage-v8`, `jsdom`, `tailwindcss`, `tw-animate-css` (web); `@brand/cli` (root) | **1 verified: `pino`** — all others are false positives (§5) |
| TODO/FIXME/HACK | 1 | 1 (tracked, references WP 1.1) |
| Suppression comments | 15 `eslint-disable` + 3 `biome-ignore` + 2 `@ts-expect-error` | The 15 `eslint-disable` are **inert** (no ESLint in the repo; Biome's `useExhaustiveDependencies` is `"off"`) |
| `console.log` left in src | 0 `console.log`; 1 **ungated debug `console.error` marked "REMOVE"** | 1 real leftover (§3.3) |
| `.only(` / `.skip(` in tests | 0 `.only`; 2 `describe.skip` + conditional `t.skip("git unavailable")` | All intentional/documented |

---

## 3. Verified dead code

### 3.1 Dead files (2)

| File | Evidence |
| --- | --- |
| `apps/web/src/components/ProfilePicker.tsx` | Zero imports anywhere in `apps/`, `packages/`, `e2e/`. Only reference is a *comment* in `features/testing/TokenProfileField.tsx:8` explaining why it was superseded ("`ProfilePicker` renders the same chips but has no way to say what o200k vs cl100k … means"). Superseded component, safe to delete. |
| `apps/web/src/components/ScanStatusBadge.tsx` | Zero imports anywhere. Presumably superseded by the unified `StatusBadge`/`lib/status` vocabulary from the UX overhaul. Safe to delete. |

Both flagged by knip *and* ts-prune, confirmed by repo-wide grep.

### 3.2 Dead exports (verified individually — no references anywhere, including tests)

apps/api:

| Symbol | Location | Note |
| --- | --- | --- |
| `graderById()` | `apps/api/src/grading/grader.ts:90` | No caller, no test. |
| `testsForLevel()` | `apps/api/src/compatibility/catalog.ts:93` | No caller, no test. |
| `PROVIDER_KIND_TO_RESEARCH_IDS` | `apps/api/src/compatibility/dataset.ts:40` | No caller (sibling `MODEL_ID_ALIASES` *is* used in-module). |
| `parseOauthToken()` | `apps/api/src/assistant/claude-auth.ts:201` | No caller, no test (`parseAuthUrl` at :189 also has no non-test caller). |
| `VendorAssistantAppResolutionError` re-export | `apps/api/src/testing/vendor-assistant-executor.ts:994` | The class itself lives (and is used/tested) in `providers/model-catalog.ts`; this re-export line has no importer. |
| `SkillBlobRow`, `AssistantSettingsRow` (types) | `apps/api/src/db/rows.ts:421, 498` | No references outside their declarations. |

apps/web:

| Symbol | Location | Note |
| --- | --- | --- |
| `getOAuthStatus`, `startOAuth`, `getRunComparison`, `deleteAssistantThread`, `updateSkill`, `deleteSuiteRun` | `apps/web/src/lib/api.ts:119, 123, 330, 466, 763, 858` | Six API-client wrappers with no call sites (the `startOAuth` hits in `App.tsx`/`ServerWizard.tsx` are unrelated local functions). Likely orphaned by the Testing-IA/UX rebuilds. Deleting them would also reveal whether their response types in `packages/shared` are still needed. |
| `serverRecommendations()`, `groupFindings()` | `apps/web/src/lib/optimize.ts:122, 243` | No callers; `optimize.test.ts` tests other exports of the module. Looks like the not-yet-built Advisor's precursor — flag to owner rather than silently delete. |
| `TokenBars` | `apps/web/src/components/TokenViz.tsx:270` | No usage (other TokenViz exports are used). |
| `layoutSkillGraph()` | `apps/web/src/features/skills/design/graph-layout.ts:281` | Thin wrapper over `layoutSkillGraphWithLanes`; its own doc-comment says "kept for callers that don't need lanes" — no such caller exists. Deliberate, but currently dead. |
| `isBlankSkillGraph()` | `apps/web/src/features/skills/design/use-edit-ops.ts:192` | No references. |

Also verified: `packages/brand-ui/` on disk contains **only** a stale `dist/` + `node_modules/`
(no `package.json`, no source — both paths git-ignored). The retired adapter was properly
deleted from git; this is harmless local build residue that pnpm ignores, worth an
`rm -rf packages/brand-ui` locally so the directory stops contradicting the docs.

### 3.3 Leftover debug code (1 — recommend fixing before release)

`apps/api/src/providers/model-catalog.ts:300-301`:

```ts
// TEMP DEBUG (vendor retrieval diagnosis) — REMOVE. Raw assistant objects incl. knowledgeBases/spaceId.
console.error("[QA-DEBUG roster]", JSON.stringify(record?.data).slice(0, 6000));
```

This is **ungated** — it fires on every the vendor assistant assistants-roster fetch and dumps up to
6 KB of raw tenant assistant metadata to stderr. The two `qaDebug()` helpers in the same file
(:84) and in `testing/vendor-assistant-executor.ts:169` are correctly gated behind
`process.env.VENDOR_ASSISTANT_DEBUG`; this one line escaped its own gate and its own comment says
REMOVE.

---

## 4. Verified duplication clusters (jscpd, min-tokens 50, tests excluded)

Headline: **294 clones, 4 843 duplicated lines (3.36% of 143 983 lines / 434 files)**.
Of that, 74 clones (~2 000 lines) are inside `apps/api/src/compatibility/data/all-models.json`
— a **generated** research dataset (built by `build-cli.ts`), self-similar by nature; not
actionable. 66 clones are same-file self-clones (~660 lines, mostly repeated zod/route
patterns). The actionable cross-file clusters, verified by reading both sides:

| # | Cluster (file ↔ file) | Size | Verdict |
| --- | --- | --- | --- |
| 1 | `apps/web/src/features/skills/design/SaveVersionDialog.tsx` ↔ `apps/web/src/features/skills/workspace/SaveWorkspaceDialog.tsx` | **10 clones, ~237 lines** (largest single clone 86 lines: 227–312 ↔ 192–277) | Verified near-identical: the whole "review diff before saving" surface (RollupTile grid, skipped-ops `Alert`, changed-files list, error/dirty handling) is maintained twice. |
| 2 | `SaveVersionDialog.tsx` ↔ `features/skills/design/UnifiedEditor.tsx` | **9 clones, ~213 lines** (60-line clone at 207–266 ↔ 1400–1459; plus 1354–1382 ↔ `SaveWorkspaceDialog.tsx:124–153`) | The same save/diff-review UI inlined a *third* time inside UnifiedEditor. Clusters 1+2 together are one extract-component refactor (~450 lines). |
| 3 | `features/testing/collections/CollectionSuites.tsx` ↔ `features/testing/suites/SuitesView.tsx` | **6 clones, ~137 lines** (80–120 ↔ 95–136; 264–301 ↔ 385–423; 226–256 ↔ 347–377) | Suite-list table/toolbar/row-actions duplicated between the collection-scoped and global suites views (Testing-IA consolidation leftover). Related: `EnvironmentsView.tsx` ↔ `collections/CollectionTests.tsx` (~47 lines) and ↔ `CollectionSuites.tsx` (~45 lines). |
| 4 | `apps/api/src/grading/answer-validation.ts` ↔ `apps/api/src/grading/insight-surplus.ts` | **5 clones, ~123 lines** (44-line clone 7–50 ↔ 9–49 = imports + judge scaffolding; 133–161 ↔ 153–180) | The two auto-rating judges share their CLI-first judge-chain scaffolding by copy. Same family: `judge.ts` ↔ `trajectory-judge.ts` (**79-line clone**, 303–381 ↔ 521–601), `error-forensics.ts` ↔ `judge.ts` (~50), `error-forensics.ts` ↔ `failure-buckets.ts` (~43), `base-rating-judge.ts` ↔ `trajectory-judge.ts` (~42). A shared judge-runner helper would collapse most of the grading-module duplication. |
| 5 | `features/testing/ReportTab.tsx` ↔ `features/testing/suites/SuiteReportTab.tsx` (~58 lines) · `use-suite-stream.ts` ↔ `use-run-stream.ts` (~53 lines) · `AddServerModal.tsx` ↔ `AddSkillModal.tsx` (~48 lines) | smaller | Real but lower-value; the stream-hook pair is the most defensible duplication (different SSE payloads). |

Self-duplication worth a mention: `packages/shared/src/schemas.ts` (8 self-clones, ~75 lines
of repeated zod envelope patterns — arguably idiomatic for a contract file) and
`apps/api/src/skillflow/routes.ts` (7 self-clones, ~64 lines of repeated route scaffolding);
`apps/api/src/testing/vendor-assistant-executor.ts` (6 self-clones, ~83 lines of retry/backoff
blocks).

Raw report: jscpd JSON was written to the sandbox at `/tmp/analysis/jscpd/jscpd-report.json`
(not persisted into the repo).

---

## 5. Dependencies

**Verified unused (1):**

- **`pino` (`^10.3.1`) — `apps/api/package.json:32`.** Never imported anywhere in
  `apps/api/src` or `test` (grep: only the package.json line and one comment mentioning "pino
  log stream"). Fastify 5 brings its own pino; the app always logs through `app.log`.
  Mildly misleading too: the declared `^10` is a different major than the pino Fastify
  actually uses. Safe to remove (re-add explicitly if direct imports are ever needed).

**Tool-reported but verified FALSE positives (do not remove):**

| Package | Flagged by | Why it's needed |
| --- | --- | --- |
| `tsx` (api devDep) | knip+depcheck | `dev`/`test`/`test:coverage` scripts run `tsx …` (binary usage). |
| `tailwindcss` (web devDep) | knip+depcheck | `@import "tailwindcss"` lives inside the vendored `@brand/tokens/styles.css` and resolves from the app's `node_modules` via `@tailwindcss/vite`. |
| `tw-animate-css` (web devDep) | knip+depcheck | `@import "tw-animate-css"` inside `@brand/tokens` `themes.css:26`. |
| `jsdom` (web devDep) | knip+depcheck | `vitest.config.ts` `environment: "jsdom"`. |
| `@vitest/coverage-v8` (web devDep) | knip+depcheck | `test:coverage` script (`vitest run --coverage`). |
| `@vitejs/plugin-react`, `@tailwindcss/vite` (web devDeps) | knip only | Used in `vite.config.ts`; knip's vite plugin had to be disabled in the sandbox (native lightningcss), so it never saw the config. |
| `@brand/cli` (root devDep) | knip | Used as `pnpm exec brand-ui …` and as the brand-ui MCP server registered in `.mcp.json` — invisible to static analysis. |

`packages/shared`: depcheck reported no issues. The web `Missing dependencies:
./vitest.config.ts.timestamp-…mjs` line is a Vite temp-file artifact, not real.

---

## 6. Suppression / TODO inventory

- **TODO (1):** `apps/api/src/db/database.ts:27` — "use the shared LOCAL_COLLECTION_NAME
  constant once WP 1.1 lands". Tracked against a WP; fine.
- **`eslint-disable` (15 occurrences, 12 files):** 14× `react-hooks/exhaustive-deps` in
  `apps/web` (`NodeDetailPanel.tsx` alone has 4: 306, 611, 661, 709; also `ResourcePromptRun`,
  `PublishGithubDialog`, `TraceTimeline`, `WorkspaceEditor`, `use-workspace`, `use-skill-draft`,
  `SaveVersionDialog`, `SkillFileExplorer`, `ConversationPane`, `UnifiedEditor`) and 1×
  `no-console` in `apps/api/src/compatibility/build-cli.ts:74`. **These are all no-ops**: the
  repo has no ESLint, and Biome's equivalent `correctness/useExhaustiveDependencies` is
  explicitly `"off"` in `biome.json:52`. They document intent but enforce nothing — worth a
  one-line cleanup decision (delete them, or keep as documentation).
- **`biome-ignore` (3):** all in `apps/api/src/assistant/claude-auth.ts:161–170`
  (`noControlCharactersInRegex` — matching terminal escape sequences is the point). Justified.
- **`@ts-expect-error` (2):** both in `apps/api/test/skillflow-assertions.test.ts:364, 377`
  ("deliberately malformed for the zod-rejection test"). Justified. Zero `@ts-ignore`.
- **`console.*` in src:** apps/web has only `ErrorBoundary.tsx:15` and
  `assistant-context.tsx:280` (both `console.error` for genuinely unrenderable failures).
  apps/api has structured warn/error in `testing/engine.ts` (documented non-fatal accounting
  paths), env-gated `qaDebug()` helpers — and the one ungated leftover in §3.3.
- **Skipped/focused tests:** zero `.only`. Two `describe.skip` in
  `apps/web/src/features/skills/design/design-chrome.test.tsx:235, 278` with explicit
  rationale ("parked with the Design tab (O2b)"). Runtime-conditional
  `t.skip("git unavailable")` in `skill-ide-publish.test.ts` / `skills-github.test.ts` (7+7
  sites) — correct pattern. Playwright `e2e/smoke.spec.ts` has no skip/only/fixme.

---

## 7. Tool-reported, UNVERIFIED / known-noise output (clearly labeled — do not act without checking)

- **knip "unused exports" (115) and "unused exported types" (311), beyond the ~12 verified in
  §3.2.** Spot-checking ~30 of them showed the overwhelming majority fall into two benign
  buckets: **(a) exported but only used within their own module** — the `export` keyword is
  removable but the code is live (verified examples: `checkpointWal`/`vacuumDatabase` in
  `db/maintenance.ts` are called by the routes registered in the same file;
  `G_EVAL_JUDGE_SYSTEM`/`buildJudgePrompt` in `grading/judge.ts`; `FORENSICS_SYSTEM`,
  `runLevelEvidence`, `parseAndMergeClassification` in `error-forensics.ts`; `httpError` in
  `run-service.ts`; `boundString`/`pushFenced` in `reports.ts`; `sha256`/`computeTreeSha` in
  `skills/repository.ts`; `MODEL_ID_ALIASES`; `isTerminalSuiteStatus`; `DEFAULT_IDLE_TIMEOUT_MS`;
  web: `ServerReportView`, `apiUpload`, and the four `lib/theme.ts` names) — and **(b) test-only
  exports** (verified: `createDefaultStepSink`, `appendContextEnvelope`, `requiresApproval`,
  `lineDelta`, `perRequestPrice`, `listTokenCounters`, `getAllModels`, `vendorTenantOrigin`,
  `_clearVendorAssistantAppContextCache`, `deriveContextLimits`/`derivePricing` [entry
  `build-cli.ts` uses `buildModelData` which calls them in-module]). The remaining ~70
  unchecked names most plausibly follow the same distribution but were **not individually
  verified**.
- **ts-prune barrel false positives:** ts-prune flagged the whole `components/dialogs/index.ts`
  and `components/form/index.ts` barrels, but `ConfirmDialog`, `FormDialog`, `WideDialog`,
  `DialogSection`, `BoundedNumber`, `KeyValueEditor`, `ListEditor`, `SegmentedField`,
  `TagInput`, `useDependentField` are all imported *through those barrels* (8 and 5 importing
  files respectively) — ts-prune simply doesn't track re-export chains. Genuinely
  interesting subset: **`WorkbenchDialog`, `AdvancedGroup` (dialogs) and `SliderNumber`
  (form)** are currently used **only by their own co-located tests** — design-system tier
  components with no production consumer yet (the dialogs barrel's doc-comment describes
  WorkbenchDialog as one of the 4 dialog tiers, so this looks intentional, not dead).
- **ts-prune on `packages/shared` (606 hits): meaningless** — shared is the wire contract
  consumed by both apps; ts-prune ran per-package and cannot see cross-package usage. knip
  (workspace-aware) reported no unused files in shared, but note knip treats everything
  re-exported from the `src/index.ts` entry as public API, so *neither tool* can currently
  answer "which shared contract types are no longer referenced by either app" — that would
  need a bespoke check.
- **knip "unused files" run with the symlinked root (262 files incl. `App.tsx`):** an artifact
  of realpath resolution, fully superseded by the copied-tree run (2 files). Mentioned only so
  nobody re-runs it that way and panics.
- **knip "unlisted binaries" (`tsx`, `vite`, `vitest`):** artifacts of the disabled plugins;
  all three are properly declared where they're used.

---

## 8. Suggested actions (prioritized)

1. **Remove the ungated `[QA-DEBUG roster]` console.error** (`model-catalog.ts:301`) or gate it
   behind `VENDOR_ASSISTANT_DEBUG` like its siblings — it leaks tenant metadata to logs and its own
   comment says REMOVE. *(pre-release)*
2. **Drop `pino` from `apps/api/package.json`.** *(trivial)*
3. **Delete `ProfilePicker.tsx` and `ScanStatusBadge.tsx`** and the ~12 verified dead exports
   (§3.2) — the six dead `lib/api.ts` wrappers are the most valuable to remove because they
   mask real coverage of the wire contract. Exception: confirm with the owner whether
   `optimize.ts` `serverRecommendations`/`groupFindings` are Advisor groundwork. *(small)*
4. **Extract the shared save/diff-review component** for clusters 1–2 (SaveVersionDialog /
   SaveWorkspaceDialog / UnifiedEditor, ~450 duplicated lines) next time that surface is
   touched; same for the grading judge-chain scaffolding (cluster 4). *(opportunistic)*
5. **Decide on the 15 inert `eslint-disable` comments** — either delete them or enable Biome's
   `useExhaustiveDependencies` and convert the genuinely-needed ones to `biome-ignore`. *(hygiene)*
6. `rm -rf packages/brand-ui` locally (stale ignored `dist/` of the retired adapter). *(local-only)*
