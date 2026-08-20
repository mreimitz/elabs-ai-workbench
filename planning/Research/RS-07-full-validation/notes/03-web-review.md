---
type: "Research Note"
title: "Web package review \u2014 apps/web/src/"
description: "Date: 2026-07-11 \u00b7 Reviewer: production-readiness code review (automated deep pass)"
tags: ["research", "RS-07"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Web package review — `apps/web/src/**`

**Date:** 2026-07-11 · **Reviewer:** production-readiness code review (automated deep pass)
**Target:** `apps/web` (React 19 + Vite 6, `react-router-dom` v7, `@elabs-ai/components-*` design system, Tailwind v4 semantic tokens; state = `useState` + `localStorage` + `fetch` via `lib/api.ts`)

## Scope & method

- Conventions loaded first: `CLAUDE.md` and `.claude/rules/{brand-ui-only,styling-and-tokens,interaction-guidelines,loading-states}.md`.
- All 347 files under `apps/web/src` were in scope; every non-test file was read (five parallel deep-review passes: testing core + `runs/`; testing `collections/suites/compare/run-launcher`; skills incl. `design/`, `code-intel/`, `trace/`, `workspace/`, `quality/`; the misc feature dirs `servers/scans/compare/compatibility/dashboard/reports/settings/assistant`; and the shared infra `App.tsx`, `main.tsx`, `components/`, `lib/`, `styles/`, `vite.config.ts`).
- Global sweeps run independently: raw color literals (`#hex`/`rgb()`/`hsl()`), Tailwind palette / `*-black` / `*-white` classes, `dark:` overrides, hardcoded URLs/ports, raw `fetch(` outside `lib/api.ts`, raw interactive HTML (`<button>/<input>/<select>/<table>`), `div`-with-`onClick`, `key={index}`, empty `catch {}`, unguarded `localStorage`, `TODO/FIXME/HACK`, `React.lazy/Suspense`.
- Every Critical/High and most Medium citations were re-verified line-by-line by the coordinating reviewer; line numbers reflect the tree as of 2026-07-11.

**Headline:** the web package is unusually disciplined. The sweeps found **zero** raw color literals, palette classes, `dark:` overrides, raw `fetch` calls in features, raw interactive HTML (the single `brand-ui-allow` escape hatch in `AppShell.tsx:560` is justified), `div`-as-button, empty catch blocks, or TODO markers. Async cancellation, loading/streaming/error separation, EmptyStates, and form hygiene are near-uniformly correct. The gap to a production release candidate is concentrated in: **no code-splitting at all** (Monaco + React Flow in the eager bundle), a handful of real but small bugs (a settings-persistence bug, two unguarded `localStorage.setItem` writes, two stale-response races), a built-but-unwired feature module, and a long tail of cross-file duplication that will drift.

## Summary

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 3 |
| Medium | 22 |
| Low | 30 |
| **Total** | **55** |

By category: perf 10 · bug 12 · dead-code 11 · duplication 15 · hardcoded 4 · convention 6 · a11y 1 (several findings span two categories; counted by primary).

---

## High

### H1 · perf — Zero code-splitting: Monaco, React Flow, and charts all ship in the eager bundle
- **Files:** `apps/web/src/App.tsx:29-63` (every route component statically imported), `apps/web/src/main.tsx:8` (`import "@elabs-ai/components-editor/monaco-environment";`) and `:13` (`import "@xyflow/react/dist/style.css";`)
- **Evidence:** grep for `React.lazy|lazy(|Suspense` across `apps/web/src` → no matches.
- Every view — including the Skill Design surface (`UnifiedEditor.tsx`, `SkillGraphCanvas.tsx` → `@elabs-ai/components-editor`/Monaco + `@elabs-ai/components-flow`/`@xyflow/react`), `components/ToolRunner.tsx` (Monaco), and the chart-heavy analytics — is loaded on first paint of `/dashboard`. `CLAUDE.md` already notes the build is memory-hungry (`NODE_OPTIONS=--max-old-space-size=3400`); users pay that cost as initial-load bytes.
- **Recommendation:** wrap heavy leaf routes in `React.lazy` + a `<Suspense>` boundary in the `<Routes>` block; move the Monaco environment import from `main.tsx` to first editor mount; add `build.rollupOptions.output.manualChunks` for `@elabs-ai/components-editor`, `@xyflow`, `@elabs-ai/components-charts`. Compounds with M1 (the parked Design/Trace surface is bundled despite being unreachable).

### H2 · bug — Choosing `generic_estimate` as the default token profile is silently lost on reload
- **Files:** `apps/web/src/App.tsx:1142-1144` vs `apps/web/src/features/settings/SettingsView.tsx:482`
- **Evidence:** `return value === "generic_o200k" || value === "generic_cl100k" || value === "raw_json_rough";` — the guard omits `generic_estimate`, while the Settings default-profile `Select` renders **all four** shared profiles (`{TOKEN_PROFILES.map((profile) => (`). The stored value is read back through this guard (`App.tsx:233-234`), so a persisted `"generic_estimate"` fails the check and falls back to `DEFAULT_TOKEN_PROFILE` on every app start.
- The guard also hardcodes/duplicates the profile vocabulary that exists canonically as `TOKEN_PROFILES` in `@mcp-token-footprint/shared` — the drift this causes is exactly this bug.
- **Recommendation:** `isTokenProfile = (v) => (TOKEN_PROFILES as readonly string[]).includes(v ?? "")`. One-line fix; add a unit test.

### H3 · dead-code — `assistant/insert-as-context.ts`: an entire built + tested feature module is unwired
- **File:** `apps/web/src/features/assistant/insert-as-context.ts` (exports `buildToolAsContextRequest:13`, `buildCompareRunToolAsContextRequest:29`)
- **Evidence:** repo-wide grep shows the only importer is `insert-as-context.test.ts`. No production component references either export — the WP 3.2 "insert as context" row-action was built and unit-tested but never wired into any table/drawer.
- **Recommendation:** either wire the helpers into the scan/compare row actions they were built for, or delete the module and its test. As shipped it is untruthful surface area (tests green for a feature users cannot reach).

---

## Medium

### M1 · dead-code / perf — The entire Design + Trace skill surfaces are unreachable but fully bundled
- **File:** `apps/web/src/features/skills/SkillInspector.tsx:259-273`
- **Evidence:** `const target = next === "design" || next === "trace" ? "files" : next;` plus the bounce effect `if (tab === "design" || tab === "trace") setTab("files");` — the `<TabsContent value="design">` (`:580-596`) and `"trace"` (`:598-611`) blocks can never activate. The whole subtree (`design/SkillDesignView.tsx`, `UnifiedEditor.tsx`, `SkillGraphCanvas.tsx`, `ToolsPalette.tsx`, `NodeDetailPanel.tsx`, `ProblemsPanel.tsx`, all of `design/code-intel/**` and `trace/**`) is compiled into the bundle with exactly one importer each: the hidden tabs.
- Deliberately parked ("O2b … roadmap Phase 7"), but it ships the Monaco + React-Flow dependency weight to every user (see H1).
- **Recommendation:** code-split the parked subtree behind `React.lazy` (so parking costs nothing), or remove the dead `<TabsContent>` wiring until Phase 7 un-parks it.

### M2 · bug — `ServerReportDialog`: unguarded `localStorage.setItem` can abort report generation
- **File:** `apps/web/src/features/reports/ServerReportDialog.tsx:187-190`
- **Evidence:** `window.localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(modelIds));` + three more unguarded `setItem` calls run **before** `onGenerate(...)` in the click handler. In Safari private mode / quota-exceeded, the throw aborts the handler — the report is never generated, with no feedback. Every other writer in the app (`theme.ts:88`, `oauth-helpers.ts:40`, `assistant-context.tsx:102`, `DashboardView.tsx:79`) wraps `setItem` in try/catch.
- **Recommendation:** wrap the four writes in a try/catch (best-effort persistence) so `onGenerate` always runs.

### M3 · bug — `CompatibilityView`: unguarded `setItem` inside an effect can crash the view
- **File:** `apps/web/src/features/compatibility/CompatibilityView.tsx:99`
- **Evidence:** `window.localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(selectedModelIds));` — a throw inside a `useEffect` body propagates to the error boundary and unmounts the Compatibility view. The paired read (`readStoredModels`, `:546`) is correctly guarded; the write is not.
- **Recommendation:** try/catch to match the read and the rest of the app.

### M4 · bug — `ResourceReadDialog` auto-fetch has no stale-response guard
- **File:** `apps/web/src/features/scans/ResourcePromptRun.tsx:137-183`
- **Evidence:** the effect at `:179-183` calls `void read()` on `[open, uri, serverId]`, and `read()` awaits `apiPost` then unconditionally `setResult(res)`. Retarget the dialog to a new `uri` while a prior read is in flight and a slow earlier response can overwrite the newer one. Every other async surface in these features uses an `active` flag — this is the outlier.
- **Recommendation:** add an `active`/cancelled flag captured in the effect (or a request token) gating `setResult`/`setError`/`setAuthExpired`.

### M5 · bug — `ScaffoldFromServerWizard.pickServer` stale-server race
- **File:** `apps/web/src/features/skills/ScaffoldFromServerWizard.tsx:150-165`
- **Evidence:** `apiGet<ScanDetail>(\`/api/scans/${scan.id}\`).then((detail) => setTools(detail.tools))` with no cancellation/latest-wins guard. Rapidly picking server A then B can resolve A last and list the wrong server's tools while `serverId` is B (the selection set is keyed by tool name).
- **Recommendation:** track a request token / cancelled ref keyed to the selected id, as every other fetch in the feature already does. Note: this file has no test coverage.

### M6 · perf — `AssistantProvider` context value + envelope rebuilt every render (app-wide re-render trap)
- **File:** `apps/web/src/features/assistant/assistant-context.tsx:269` and `:288-302`
- **Evidence:** `const currentEnvelope = deriveAssistantEnvelope(location.pathname, location.search);` and `const value: AssistantContextValue = { … }` are fresh objects each render, passed to `<AssistantContext.Provider value={value}>`. The provider wraps `<App/>` (`main.tsx`) and re-renders on every route change (`useLocation`), so **every** `useAssistant()` consumer — including `App` itself (`App.tsx:121`) — re-renders on each navigation/auth/dock change even when the fields it reads are unchanged. `lib/api.ts:509-516` even warns callers to key off envelope primitives "instead of a fresh object reference every render."
- **Recommendation:** `useMemo` the envelope on `[location.pathname, location.search]` and the `value` on its real dependencies.

### M7 · bug — `lib/api.ts` fetch helpers have no abort support
- **File:** `apps/web/src/lib/api.ts:89-92, 139-162, 170-182`
- **Evidence:** `apiGet`/`apiPost`/`apiPut`/`apiDelete`/`apiUpload` accept no `AbortSignal` (grep for `AbortSignal` in the file: none). Callers can only discard stale results with `active` booleans; the underlying requests keep running after unmount/re-key — on fast selection switches, in-flight requests are never cancelled.
- **Recommendation:** add an optional `signal?: AbortSignal` threaded into `fetch`; drive it from `useLoadable` and the App effects' cleanup.

### M8 · perf — Runs feed fires one grades request per standalone run
- **File:** `apps/web/src/features/testing/RunsView.tsx:164-182`
- **Evidence:** `standaloneRuns.map((run) => getRunGrades(run.id)…)` inside `Promise.all`, re-triggered whenever `standaloneRuns` changes. A feed with dozens/hundreds of runs issues that many concurrent `GET /api/runs/:id/grades` calls just to render glance chips; per-run errors are swallowed to `[]` (documented best-effort).
- **Recommendation:** a batch grades endpoint (`?ids=`), or lazy fetch for visible/expanded rows only.

### M9 · perf / duplication — `getServerTests(scanId)` fetched two–three times for one server Overview
- **Files:** `apps/web/src/features/servers/ServersView.tsx:187-191` (via `useLoadable`, only for the tab count) and `apps/web/src/features/compatibility/CompatibilityTests.tsx:565` (`ServerFindings` fetches the same scan independently); switching to the Tests tab triggers a third via `ServerTestsTab`.
- **Recommendation:** lift one fetch into `ServersView` and pass the report down.

### M10 · perf — Design surface triple-fetches the same reads on mount
- **Files:** `getToolDiagnostics(skillId, versionId)` independently fetched by `apps/web/src/features/skills/design/SkillGraphCanvas.tsx:848`, `NodeDetailPanel.tsx:1145`, `ProblemsPanel.tsx:115`; `getSkillFile(…, "SKILL.md")` likewise by `NodeDetailPanel`, `ToolsPalette`, and `use-skill-draft` concurrently.
- Mitigated today by M1 (surface parked), but must be fixed before un-parking.
- **Recommendation:** lift both reads to the Design host and pass down, as already done for `boundTools` (`NodeDetailPanel.tsx:1121-1122` notes the pattern).

### M11 · duplication / bug-risk — abnormal-run predicate triplicated and divergent
- **Files:** `apps/web/src/features/testing/compare/compare-runs.ts:290` (`isAbnormal`, private), `compare/summary-derive.ts:71` (`isAbnormal`, exported, byte-identical), `compare/suite/suite-data.ts:283-287` (`isErroredMember`)
- **Evidence:** the suite copy's comment says "Mirrors the run-compare `isAbnormal` rule" but adds an exception the others lack: `if (outcome && outcome !== "completed" && outcome !== "assertions_failed") return true;` — so run-compare and suite-compare classify an `assertions_failed` run differently (verified).
- **Recommendation:** hoist one predicate and apply the `assertions_failed` decision consistently (or document the intentional divergence in both places).

### M12 · dead-code — CompareBar "Explain diff" feature fully built but never wired
- **File:** `apps/web/src/features/testing/compare/CompareBar.tsx:87-89, 105-109, 186, 199-204`
- **Evidence:** `{explainAvailable && onExplain ? (<Button …><Sparkles/>…Explain…` — the only caller (`CompareWorkspace.tsx:191-203`) passes neither `explainAvailable`, `onExplain`, nor `modeControlsDisabled`, so the button never renders and `modeControlsDisabled` is always its `false` default (verified by grep: no other call site).
- **Recommendation:** wire the Explain action from the workspace or remove the dead props + button + the class-doc paragraph describing it.

### M13 · bug — `AssertionsEditor`: array-index keys on removable lists
- **File:** `apps/web/src/features/testing/AssertionsEditor.tsx:171, 235`
- **Evidence:** `key={index}` on the gates and routes lists whose remove actions splice from the middle (`filter((_, i) => i !== index)`). Controlled values keep the data correct, but per-row uncontrolled state (open dropdown, focus) can attach to the wrong item after a middle removal.
- **Recommendation:** synthesize a stable id per row (ref counter on add) and key on it.

### M14 · dead-code — Orphaned shared components: `ScanStatusBadge`, `ProfilePicker`, `AdvancedGroup`
- **Files & evidence (all verified by repo-wide grep):**
  - `apps/web/src/components/ScanStatusBadge.tsx:19` — sole occurrence of the symbol; superseded by `lib/status.ts` → `StatusBadge`.
  - `apps/web/src/components/ProfilePicker.tsx:10` — no importer; only other hit is a prose mention in `features/testing/TokenProfileField.tsx:8` (its replacement).
  - `apps/web/src/components/dialogs/DialogSection.tsx:51` `AdvancedGroup` — exported via the barrel (`dialogs/index.ts:48`) and unit-tested, but has zero JSX consumers.
- **Recommendation:** delete `ScanStatusBadge.tsx` and `ProfilePicker.tsx` (and the stale comment reference); adopt or remove `AdvancedGroup`.

### M15 · convention / duplication — Server-report download URLs hand-built in `App.tsx`, bypassing `lib/api.ts`
- **File:** `apps/web/src/App.tsx:1091-1110`
- **Evidence:** `a.href = \`/api/reports/server/${scanId}/markdown?${q.toString()}\`;` and a near-duplicate `URLSearchParams` block for the HTML branch. `api.ts` already has the href-builder pattern (`suiteRunReportMarkdownHref`, `:946-949`) but no server-report equivalent.
- **Recommendation:** add `serverReportMarkdownHref(scanId, {models, client, detail})` to `api.ts`; share the query construction.

### M16 · duplication — `SEGMENT_LABELS` defined four times, `SEGMENT_FILL` twice
- **Files:** `apps/web/src/features/testing/AnalyticsPanel.tsx:94`, `ContextChart.tsx:55`, `PacketInspector.tsx:455`, `compare/summary-derive.ts:409` (`Record<ContextSegment, string>` verbatim); `SEGMENT_FILL` (`CONTEXT_SEGMENTS → var(--chart-N)`) duplicated in `AnalyticsPanel.tsx:103` and `ContextChart.tsx:69`.
- **Recommendation:** one shared `context-segments.ts` module.

### M17 · duplication — Three near-identical "save as new version" dialogs
- **Files:** `apps/web/src/features/skills/design/SaveVersionDialog.tsx`, `workspace/SaveWorkspaceDialog.tsx`, and `UnifiedEditor.tsx:1295` (`UnifiedSaveDialog`) share ~80%: `formatSigned` defined 3× (`SaveVersionDialog.tsx:36`, `SaveWorkspaceDialog.tsx:30`, `UnifiedEditor.tsx:1289`) while `SkillDiffView.tsx:50` already exports an identical one; `RollupTile` verbatim 3× (`:377`, `:356`, `:1570`); the diff-status label map 3× (`:41`, `:35`, `:1281`) duplicating `SkillDiffView.tsx:38` `STATUS_META`.
- **Recommendation:** extract a shared `SavedVersionResultView` + `formatSigned` + status-label map (the comments themselves say "Phase 9 unifies all staging later" — this is the accrued cost).

### M18 · duplication — Quality-severity vocabulary defined twice
- **Files:** `apps/web/src/features/skills/quality/quality-meta.ts:10` `SEVERITY_META` re-declared at `design/ProblemsPanel.tsx:50` (adds a `rank`); the ProblemsPanel comment admits it "mirrors the Quality tab's `SEVERITY_META`".
- **Recommendation:** hoist one `SEVERITY_META` (with optional `rank`).

### M19 · duplication — `SuiteRow` card duplicated, matrix-cell math triplicated
- **Files:** `apps/web/src/features/testing/suites/SuitesView.tsx:376-441` and `collections/CollectionSuites.tsx:255-318` are near-identical `SuiteRow` components; the `testIds.length * axisCount * repetitions` cell math appears a third time in `run-launcher/RunLauncher.tsx:276-283`.
- **Recommendation:** one shared `SuiteRow` + a `suiteCellCount()` helper.

### M20 · duplication — Caveat chip and failure-bucket table each duplicated
- **Files:** `apps/web/src/features/testing/compare/SummaryMode.tsx:276-309` (`VerdictCaveatChip`) is a near-verbatim copy of `compare/CompareBar.tsx:311-343` (`CaveatChip`) — the comment acknowledges "mirroring the compare bar's own caveat chip". `suites/FailureBuckets.tsx:175-222` and `suites/SuiteReportTab.tsx:456-525` (`ErrorClusteringCard`) both render `FailureBucket[]` as the same label/share/`#{runId.slice(0,6)}` table.
- **Recommendation:** extract one shared component for each.

### M21 · duplication — Local time/duration formatters shadow the canonical `lib/format` set
- **Files:** `apps/web/src/features/testing/compare/compare-runs.ts:526` defines a bespoke `relativeTime(iso)` near-duplicating `lib/format.ts` `formatRelativeTime` (differs only weekday vs "yesterday" band); `compare/flow/LaneCell.tsx:242-245` re-implements `formatDuration` — one of exactly the "~6 hand-rolled copies" `lib/format.ts` says its canonical version replaced — and renders "500ms"/"1.0s" vs the canonical "500 ms"/"1.00 s" (a visible inconsistency).
- **Recommendation:** import from `lib/format` (or move the weekday variant into `lib/` if intentional).

### M22 · perf — Compare workspace double-fetches grades and run details
- **Files:** `apps/web/src/features/testing/compare/CompareWorkspace.tsx:105` (`loadGradesForRuns`) and `SummaryMode.tsx:92` (`getRunGrades` per run) fetch grades twice for the same set; `SummaryMode.tsx:91` and `FlowMode.tsx:46` each re-fetch `getRun` on every mode switch with no shared cache. Bounded and cancelled (not a storm), but redundant round-trips on the hot compare path.
- **Recommendation:** a per-workspace run/grade cache passed to the modes.

---

## Low

### L1 · dead-code — Empty `routes/` directory
- **Path:** `apps/web/src/routes/` — verified empty (routing lives in `App.tsx`). Delete it.

### L2 · perf — `SourcesPanel` fetches the entire run history per answer turn
- **File:** `apps/web/src/features/testing/SourcesPanel.tsx:277` (`useVersionDrift`) — each rendered panel independently fetches `/api/runs` (full history) + a `getRun(previous.id)`; a multi-turn `vendor_assistant` run mounts several. Hoist to the pane or cache.

### L3 · duplication — Terminal-run-status predicate copies
- `isTerminalRunStatus` identical in `features/testing/RunConsole.tsx:1028` and `RunConsoleRoute.tsx:245`, inlined again in `AnalyticsPanel.tsx:114-118`; `use-run-stream.ts:152` has a separate exhaustive `isTerminalStatus`. Export one shared helper. Related: `runs/SuiteTableRows.tsx:48` `TERMINAL_SUITE_STATUSES` is (per its own comment) a hand-synced copy of the suite console's set.

### L4 · duplication — Small pure-helper cluster copied across testing modules
- Finite-number coercion (`typeof x === "number" && Number.isFinite(x) ? x : 0`) ×5: `analytics-derive.ts:61`, `AnalyticsPanel.tsx:1099`, `ContextChart.tsx:353`, `turn-index.ts:27`, `RunConsole.tsx:1042`.
- `firstProfileTokens` exported identically from `analytics-derive.ts:66` and `StepLog.tsx:86`.
- `payload.toolCallId` reader ×5: `use-run-stream.ts:246`, `RunGantt.tsx:49`, `analytics-derive.ts:448`, `dedupe-tool-steps.ts:118`, `console-anchors.ts:78` (the last already exports one — reuse it).

### L5 · dead-code — `deriveTurnTrend`'s synthetic date axis is dead
- `apps/web/src/features/testing/analytics-derive.ts:184-216` — `x: new Date(EPOCH + turn * STEP_MS)` feeds a retired date-scaled chart; `AnalyticsPanel.tsx:246` bar-charts off `turn` only and `trendBars` never reads `x`. Drop the field + constants.

### L6 · convention — Dynamically constructed Tailwind class `bg-chart-${i + 1}`
- `apps/web/src/features/testing/AnalyticsPanel.tsx:1087` (`SegmentLegend`) — only resolves because the static forms happen to exist elsewhere; if that changes the legend silently loses its swatches. Use the static `SEGMENT_SWATCH` map as `ContextChart` does.

### L7 · duplication — `index → var(--chart-N)` helper triplicated
- `compare/compare-runs.ts:69` `runColor`, `suites/SuiteScatter.tsx:39` and `suites/SuiteBreakdowns.tsx:35` `chartVar` — identical `var(--chart-${(index % 5) + 1})`. Consolidate.

### L8 · duplication — Inline `"… tok"` token label in 5+ sites
- `compare/flow/build-flow.ts:255` `formatTokens`, plus inline `n.toLocaleString() + " tok"` in `LaneCell.tsx:166`, `ResultSection.tsx:79`, `ResultCompareDialog.tsx:154`, `SkillsSummary.tsx:63`. One shared helper.

### L9 · duplication — Download-blob helper reimplemented
- `compare/next-steps/NextSteps.tsx:76` exports `downloadText(...)`; `compare/SuiteCompareMode.tsx:76-86` open-codes the same Blob/anchor/click/revoke sequence. Import it.

### L10 · duplication — Local number/cost formatters diverge from `lib/format`
- `compare/next-steps/next-steps-derive.ts:182` `formatInt` uses `new Intl.NumberFormat()` with no locale (lib pins `"en-US"`); `compare/suite/suite-data.ts:171,175` `costText`/`tokenText` re-implement `formatCostUsd`/`formatNumber`. Also in shared infra: `lib/optimize.ts:324-326` `formatTok`, `lib/table.tsx:5,38` local `Intl.NumberFormat`, `components/TokenViz.tsx:87,218` `.toFixed(1)}%` instead of `formatPercent`.

### L11 · convention — Inconsistent "better" delta color token
- `suites/SuiteDeltas.tsx:245` colors improvement `text-primary`; every other delta surface (`matrix/DeltaMatrix.tsx:332`, `matrix/DeltaBarPanel.tsx:154`, `suite/suite-data.ts:48`) maps better → `text-success-text` per D-UX9. Align.

### L12 · hardcoded — Scattered magic numbers
- Truncation/clamp: `ARGS_SUMMARY_MAX_CHARS = 96` (`tool-call-view.ts:8`) and `oneLine(text, 96)` (`trace-tree.ts`); `slice(0, 99)` / `slice(0, 79)` (`ConsolePanel.tsx:286/127`); `truncate(value, 40)` (`tool-call-view.ts:32`).
- Launcher/lists: debounce `300` (`run-launcher/RunLauncher.tsx:1204`); duplicated `> 5` search threshold (`RunLauncher.tsx:696,774`); `pageSize={25}` (`collections/CollectionTests.tsx:307`); `runs.slice(0, 8)` (`suites/SuitesView.tsx:233`); `CAP = 3` (`compare/VerdictBand.tsx:96`).
- Name constants where duplicated (the `> 5` pair especially).

### L13 · bug (minor) — `SuiteEditor` variants list keyed by index
- `suites/SuiteEditor.tsx:635` `key={index}` on a middle-removable list; `variant.label` (required unique at submit) is a stable key.

### L14 · convention — Raw `<label>` where `@elabs-ai/components-*` `Label` is the house component
- `run-launcher/RunLauncher.tsx:716,794`, `suites/SuiteEditor.tsx:572`, `compare/CompareBar.tsx:490`, `compare/FlowMode.tsx:134`, `reports/ServerReportDialog.tsx:305,320`, `compare/CompareView.tsx:943`. Not on the forbidden-element list and implicit association works — consistency only.

### L15 · dead-code — Unused destructured prop in `SummaryMode`
- `compare/SummaryMode.tsx:73` destructures `focus: _focus` and never uses it. Drop from the destructure.

### L16 · dead-code — `isBlankSkillGraph` exported but never used
- `features/skills/design/use-edit-ops.ts:192` — only the definition exists (repo-wide grep incl. tests). Vestigial from the removed blank-skill edit flow.

### L17 · dead-code — `useSkillDraft`'s `onLoaded` parameter is dead
- `features/skills/design/use-skill-draft.ts:111` (+ `onLoadedRef` at `:123-124`, `:161`) — the only caller (`UnifiedEditor.tsx:191`) never supplies it.

### L18 · bug (latent) — Overview "open flow" deep-link lands on Files
- `features/skills/SkillInspector.tsx:571` passes `onOpenFlow={() => requestTabChange("design")}` but `requestTabChange` redirects `design → files` (M1), so the Triggers-card `/command` section link (`SkillOverview.tsx:411-421`) goes to Files. Harmless while parked; revisit with M1.

### L19 · duplication / hardcoded — `excerpt()` ×3 with divergent limits; `inFrontmatter()` ×3
- `features/skills/use-bound-tools.ts:224` (max 240), `design/code-intel/hovers.ts:251` (240), `design/code-intel/tool-completions.ts:227` (**200** — hover and completion truncate differently). `inFrontmatter()` byte-identical in `hovers.ts:217`, `snippets.ts:97`, `tool-completions.ts:216`. Share both helpers + one truncation constant.

### L20 · convention — Index keys in static (non-reorderable) lists
- Save dialogs: `design/SaveVersionDialog.tsx:334`, `workspace/SaveWorkspaceDialog.tsx:311`, `design/UnifiedEditor.tsx:1527` (op snapshots; op strings would be stabler keys). Static print lists: `testing/ReportTab.tsx:357`, `testing/AssertionResults.tsx:80`, `reports/reportRender.tsx:157`. Benign today; noted for completeness.

### L21 · a11y — Canvas drag-to-connect has no keyboard equivalent
- `features/skills/design/SkillGraphCanvas.tsx` (`nodesConnectable`/`onConnect`) + `ToolsPalette.tsx:577` draggable rows — section→asset connection is drag-only (tool insertion does have a keyboard `Plus` path at `ToolsPalette.tsx:609-631`). Parked surface; fix before un-parking.

### L22 · perf — `DashboardView` derived data recomputed every render
- `features/dashboard/DashboardView.tsx:85-152` — `latestScansByServer(props.scans, …)` called twice (each a full sort), `rankedServers` sorts again, then ~10 `reduce` passes — all unmemoized (only `deltaIndex:92` is). Memoize on `[props.scans, props.servers]`.

### L23 · convention — `LAST_VISIT_KEY` breaks the localStorage namespace convention
- `features/dashboard/DashboardView.tsx:58` `"mcpfp:dashboard:last-visit-at"` vs the `mcp-token-footprint.*` dotted prefix used by every other key. Rename (harmless one-time reset).

### L24 · perf / bug — `ServerReportView` effect keyed on array identity re-fires per render
- `features/reports/ServerReportView.tsx:158` depends on `target.modelIds`, but `ServerReportRoute` (`:112`) rebuilds `target` (fresh `modelsParam.split(",")` at `:129`) each render — any route re-render re-fires `getServerReport`. Depend on `target.modelIds.join(",")`.

### L25 · dead-code — Orphaned JSDoc blocks in `CompatibilityCellSheet`
- `features/compatibility/CompatibilityCellSheet.tsx:307-310` — two doc comments (`/** A labelled measured/limit value…`, `/** One cited limit…`) with no declaration beneath them. Delete.

### L26 · dead-code — `ServerWizard` `custom_headers` path unreachable, with an unguarded parser behind it
- `features/servers/ServerWizard.tsx` — `FormState.customHeadersText` (`:61`, default `"{}"`) and the `custom_headers` branch in `authInputFromForm` (`:804-805`) are unreachable (`AUTH_OPTIONS:743-752` offers only bearer/api_key/oauth; nothing edits the field). The `parseJson` it would call (`:849-852`) is `JSON.parse(text) as T` with no try/catch. Remove the path, or add the UI and guard the parse.

### L27 · convention — Stale `eslint-disable` comments in a Biome-only repo; mount effect omits deps
- `apps/web/src/App.tsx:334-336` runs `refreshAll()` with `[]` deps and no suppression note; `features/scans/ResourcePromptRun.tsx:181` carries `// eslint-disable-next-line react-hooks/exhaustive-deps` — but the repo has **no ESLint** (Biome). Replace with `biome-ignore lint/correctness/useExhaustiveDependencies: <reason>` (or list the deps) so the suppressions actually bind.

### L28 · bug (edge) — `readResponse` assumes a JSON body on every 2xx
- `apps/web/src/lib/api.ts:184-190` — `return (await response.json()) as T;` with no guard; `apiPost<void>` callers (`stopRun:320`, `sendTurn:316`, `stopSuiteRun:854`) would surface a raw `SyntaxError` (not an `ApiError`) if the API ever answers 200 with an empty body. Tolerate an empty body for void helpers.

### L29 · hardcoded — Dev proxy target duplicated in `vite.config.ts`
- `apps/web/vite.config.ts:9-13` and `:19-23` — `target: "http://127.0.0.1:8080"` verbatim in both `server` and `preview` blocks. Hoist one env-overridable constant. (App code itself uses relative `/api` paths everywhere; the only other literal is a placeholder example string in `SettingsView.tsx:897`, which is fine per the interaction guidelines.)

### L30 · convention — Test-coverage gaps on the riskiest untested code
- Branch-heavy pure derivers `features/testing/analytics-derive.ts` and `trace-tree.ts` have no `*.test.ts` siblings (unlike peers `dedupe-tool-steps`, `turn-index`, `console-anchors`, `runs-table-model`). In skills, the M5 race and the M17 dialog trio live in untested files (`ScaffoldFromServerWizard`, the three save dialogs, `UnifiedEditor`); the entire `quality/` directory is untested. In testing subfeatures, hooks (`use-suite-*`, `useCompareState`) and view components have no direct tests.

---

## Verified-clean (non-findings)

For the record, the following were explicitly checked across the whole package and are clean:
- **brand-ui-only:** no raw `<button>/<input>/<select>/<table>/<textarea>` in production code; single justified `brand-ui-allow` (`components/AppShell.tsx:560`, ResizableHandle); no `div`-as-button.
- **Tokens/themes:** zero raw `#hex`/`rgb()`/`hsl()`, palette classes, `*-black`/`*-white`, or `dark:` overrides anywhere in `apps/web/src` — including `SkillGraphCanvas`, trace overlays, and `design/code-intel/decorations.css` (all `var(--…)` tokens). `app.css` raw values are documented rem type-scale tokens plus one print fallback.
- **HTTP discipline:** zero raw `fetch(` outside `lib/api.ts`; SSE/EventSource handling centralized and cleaned up.
- **Loading-states rule:** `use-run-stream.ts` terminal-ref, `use-suite-stream.ts`, `use-live-skill-workspace.ts`, and the assistant stream (`use-assistant-stream.ts`) all separate loading/streaming and surface errors only on settled terminal failure.
- **Router migration:** no `activeView`/`ViewKey` remnants; legacy URLs preserved via `Navigate replace` redirects (`App.tsx:963-979`).
- **localStorage:** all keys have paired read+write; reads are try/catch-guarded everywhere (the two unguarded *writes* are M2/M3); `MODELS_STORAGE_KEY` in compatibility vs reports are correctly distinct keys, not a collision.
- **Monaco lifecycle:** providers/markers/decorations/listeners disposed consistently across `use-bound-tools.ts`, `code-intel/index.ts`, `WorkspaceEditor.tsx`, `UnifiedEditor.tsx`.
- **package.json:** no unused runtime dependencies found.

# Citations

None.
