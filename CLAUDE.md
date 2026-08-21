# CLAUDE.md

Guidance for Claude (and humans) working in this repository. Read this first, then load
the focused rules in [`.claude/rules/`](./.claude/rules/) as needed.

---

## 1. What this project is

**MCP Token Footprint** is a local, Dockerized web app for **analyzing MCP servers**: connect
to one or many, extract their full tool surface, measure the model-context token cost of those
definitions, track how a server changes over time, compare servers against each other, and
exercise individual tools through generated forms.

It is a single-owner developer tool. It runs locally (no auth, no multi-tenant, no cloud) and
talks to MCP servers over **stdio** and **streamable HTTP**.

### North star (the target — this is what we are building toward)

> Treat this section as authoritative when planning work. It intentionally supersedes the
> narrower "non-goals" framing in the original `planning/Roadmap/completed/RM-31-mvp-footprint-analyzer/00-product-brief.md`; the roadmap docs
> have been reconciled — see [`planning/Roadmap/completed/RM-31-mvp-footprint-analyzer/08-expanded-target.md`](./planning/Roadmap/completed/RM-31-mvp-footprint-analyzer/08-expanded-target.md).

> **Single source of truth for in-flight status:** the `planning/Roadmap/*/STATUS.md` ledgers (currently
> [`planning/Roadmap/RM-01-advisor/STATUS.md`](./planning/Roadmap/RM-01-advisor/STATUS.md),
> [`planning/Roadmap/RM-02-assistant/STATUS.md`](./planning/Roadmap/RM-02-assistant/STATUS.md),
> [`planning/Roadmap/RM-03-assistant-hub/STATUS.md`](./planning/Roadmap/RM-03-assistant-hub/STATUS.md),
> [`planning/Roadmap/RM-05-assistant-operability/STATUS.md`](./planning/Roadmap/RM-05-assistant-operability/STATUS.md),
> [`planning/Roadmap/RM-06-auto-rating/STATUS.md`](./planning/Roadmap/RM-06-auto-rating/STATUS.md),
> [`planning/Roadmap/RM-07-benchmarks/STATUS.md`](./planning/Roadmap/RM-07-benchmarks/STATUS.md),
> [`planning/Roadmap/RM-08-ci/STATUS.md`](./planning/Roadmap/RM-08-ci/STATUS.md),
> [`planning/Roadmap/RM-09-claude-subscription/STATUS.md`](./planning/Roadmap/RM-09-claude-subscription/STATUS.md),
> [`planning/Roadmap/RM-10-crew-nesting/STATUS.md`](./planning/Roadmap/RM-10-crew-nesting/STATUS.md),
> [`planning/Roadmap/completed/RM-11-dashboard-bento/STATUS.md`](./planning/Roadmap/completed/RM-11-dashboard-bento/STATUS.md),
> [`planning/Roadmap/completed/RM-13-hub-fixes/STATUS.md`](./planning/Roadmap/completed/RM-13-hub-fixes/STATUS.md),
> [`planning/Roadmap/RM-14-illustrations/STATUS.md`](./planning/Roadmap/RM-14-illustrations/STATUS.md),
> [`planning/Roadmap/RM-16-model-identity/STATUS.md`](./planning/Roadmap/RM-16-model-identity/STATUS.md),
> [`planning/Roadmap/RM-17-observability/STATUS.md`](./planning/Roadmap/RM-17-observability/STATUS.md),
> [`planning/Roadmap/RM-18-platform/STATUS.md`](./planning/Roadmap/RM-18-platform/STATUS.md),
> [`planning/Roadmap/RM-20-security-posture/STATUS.md`](./planning/Roadmap/RM-20-security-posture/STATUS.md),
> [`planning/Roadmap/RM-22-skill-ide/STATUS.md`](./planning/Roadmap/RM-22-skill-ide/STATUS.md),
> [`planning/Roadmap/RM-23-skillflow/STATUS.md`](./planning/Roadmap/RM-23-skillflow/STATUS.md),
> [`planning/Roadmap/RM-24-skills/STATUS.md`](./planning/Roadmap/RM-24-skills/STATUS.md),
> [`planning/Roadmap/RM-25-team-server/STATUS.md`](./planning/Roadmap/RM-25-team-server/STATUS.md),
> [`planning/Roadmap/RM-26-testing/STATUS.md`](./planning/Roadmap/RM-26-testing/STATUS.md),
> [`planning/Roadmap/RM-27-testing-ia/STATUS.md`](./planning/Roadmap/RM-27-testing-ia/STATUS.md),
> [`planning/Roadmap/RM-32-overview-detail/STATUS.md`](./planning/Roadmap/RM-32-overview-detail/STATUS.md),
> [`planning/Roadmap/RM-34-estimator-turn-model-calibrate/STATUS.md`](./planning/Roadmap/RM-34-estimator-turn-model-calibrate/STATUS.md),
> [`planning/Roadmap/RM-35-roadmap-cleanup-close-what/STATUS.md`](./planning/Roadmap/RM-35-roadmap-cleanup-close-what/STATUS.md), and
> [`planning/Roadmap/completed/RM-29-unified-sessions/STATUS.md`](./planning/Roadmap/completed/RM-29-unified-sessions/STATUS.md)) are **authoritative** for what is
> in-progress / done / owner-pending. This table and every other doc **link** to them rather than
> restate per-WP state, so status lives in exactly one place. The older narrative roadmap docs
> (`ROADMAP.md`, and the MVP-era planning docs now filed under
> [`planning/Roadmap/completed/RM-31-mvp-footprint-analyzer/`](./planning/Roadmap/completed/RM-31-mvp-footprint-analyzer/))
> are **historical** — see the pointer at the top of each.

1. **Connect to multiple MCP servers** and extract *all* details (`initialize`, `tools/list`,
   names, descriptions, input schemas, annotations; `resources/list`, `prompts/list`).
2. **Token & payload accounting** — compute expected token consumption and raw payload size
   from definitions, per token profile.
3. **Diff over time** — compare a server against its own previous runs (added / removed /
   changed tools, token deltas).
4. **Diff across servers** — compare two *different* MCP servers, including **tool-level**
   comparison (same/similar tools side by side).
5. **Tool playground** — read a tool's input schema, **generate a form on the fly**, let the
   user fill it, **execute the tool** (`tools/call`), show the result, and **measure the token
   cost of the request + response**.
6. **A genuinely good UI/UX.** The current UI works but is rough; a clean, dense, operator-grade
   redesign is part of the target, not an afterthought.

### Current state vs. target

| Capability | Status |
| --- | --- |
| Multi-server config (stdio + streamable HTTP, auth/OAuth) | ✅ Built |
| Discovery scan (`initialize` + `tools/list`), tool normalization | ✅ Built |
| Token footprint per tool + ranked breakdown (4 profiles) | ✅ Built (2 real tiktoken BPE + `generic_estimate` heuristic + `raw_json_rough`) |
| Scan history + same-server scan-to-scan compare | ✅ Built |
| JSON / Markdown report export (scan, server, run) | ✅ Built |
| **Cross-server compare (server- and tool-level)** | ✅ Built (`GET /api/compare`; exact→normalized→fuzzy tool matching, token deltas; web Compare view) |
| **Tool playground: schema → form → `tools/call` → result** | ✅ Built (schema-generated form, executes the call) |
| **Runtime request/response token measurement** | ✅ Built (request + response tokens & bytes per call) |
| **Resource / prompt footprint** | ✅ Built (scan also runs `resources/list` + `prompts/list` → `mcp_resource_scans` / `mcp_prompt_scans`; `POST /api/servers/:id/resources/read`, `/prompts/:name/get`) |
| **Real tokenizer + serialized-payload counting** | ✅ Built (`js-tiktoken` BPE for `o200k`/`cl100k`; per-tool total = tokens of the **serialized provider payload**, not summed facets; every scan carries a `counting_version` [now 2]; cross-profile deltas guarded) |
| **URL routing (react-router)** | ✅ Built (`react-router-dom` in `apps/web`; deep-linkable routes + breadcrumbs; run console is the route `/testing/runs/:runId`; Settings and reports are routes) |
| **Versioned DB migrations + scan/run delete + retention** | ✅ Built (`PRAGMA user_version` migrations in `db/database.ts`; `DELETE /api/scans/:id` · `DELETE /api/runs/:id`; `POST /api/maintenance/{checkpoint,vacuum,prune-scans}`; `SCAN_RETENTION_PER_SERVER`) |
| **CI + lint** | ✅ Built (Biome via `pnpm lint`/`pnpm format`, `biome.json`). **The four-command quality gate is run locally** — the repo's only workflow is `.github/workflows/mcp-self-scan.yml` (the D-MCP5 dogfood gate); there is no `ci.yml` |
| **Polished UI/UX** | ✅ Web UI rebuilt on the `@elabs-ai/components-*` design system (exposes 2 themes: `light` default + `dark`, plus a **System** OS-preference option; per-action busy state, error surfacing, shared formatters/components); typecheck + build green |
| **UX overhaul — one shell, one grammar, applied to every view + the rebuilt Compare Workspace** | ✅ Built on `ux/integration` (all 34 WPs, Phases 0–5). One page shell (PageShell/PageHeader + scroll contract S22), one tab shell (TabPanel, stable strip), one status vocabulary (StatusBadge/`lib/status`), one modal system (4 dialog tiers), one form kit (`components/form/*`), one table recipe (TableToolbar + `lib/table` pinning/sticky); master-detail views (Servers/Scans/Skills/Collections) unified via the AppShell `fullBleed+secondaryContent` variant (D-UX14); workflow cross-links (scan Δ + diff-vs-previous, console turn/error/trace links, skills usage + test-this-skill, operational dashboard, launcher cost preview via additive `GET /api/estimate/run-plan`); **Compare Workspace rebuilt per audit §H** (letter-chip run identity + URL state, Summary Δ-matrix + verdict sentences, Flow LCS trace-diff + lenses, lossless drill drawer, change markers + next-steps, suite compare) — the efficiency radar deleted. Gate green throughout (web tests 68→254, API 851→867). Plan + authoritative ledger: [`planning/Roadmap/RM-30-ux-overhaul/`](./planning/Roadmap/RM-30-ux-overhaul/) ([`STATUS.md`](./planning/Roadmap/RM-30-ux-overhaul/STATUS.md), [`verification-report.md`](./planning/Roadmap/RM-30-ux-overhaul/verification-report.md)). Source of findings: `UI-UX-AUDIT-2026-07-05.md` — **never committed to this repository**; the findings it carried survive as the WP specs and the `verification-report.md` in the item folder. **Owner-acceptance walk pending** (two-theme + keyboard + shell walks + a real compare-workspace decision; provider-key-only checks — live run-console replay, skill Trace, model rosters, live cost preview — listed in the ledger's Owner-acceptance section). Not yet merged to `main` (owner merges `ux/integration → main`). |
| **Testing — run engine (agent loop + MCP tool bridge, multi-provider)** | ✅ Built (API; Phase 0–2) |
| **Testing — token/context accounting, guardrails + pricing** | ✅ Built (API; Phase 0–2; cost cap rejects unpriced models) |
| **Testing — run persistence (full replay) + SSE streaming/run control** | ✅ Built (API; Phase 0–2; startup orphan reconciliation) |
| **Testing — scenario/test CRUD (+ multimodal attachments) + provider credentials (encrypted)** | ✅ Built (API; Phase 0–2) |
| **Testing — API test suite (behavior lock)** | ✅ Built (Phase 0–2; gate green) |
| **Testing — Web UI (run console, conversation, KPI rail, inspector, replay, compare)** | ✅ Built (Phase 3 · `apps/web/src/features/testing/*`) |
| **Testing — hardening (run report export, Docker/config/docs)** | ✅ Built (Phase 4 · `GET /api/reports/run/:id/{json,markdown}`; non-root container + healthcheck). Two-theme/a11y walk (WP 4.1) + e2e (WP 4.4) are **owner-acceptance pending** — see `planning/Roadmap/RM-26-testing/STATUS.md` |
| **MCP × model compatibility (limits & heatmap)** | ✅ Built (Phase 5 · `GET /api/scans/:id/heatmap`, `/api/compatibility/models`, `POST /api/runs/:runId/compatibility`; web `apps/web/src/features/compatibility/`). Trends/recommendations (WP 5.7) **absorbed by Advisor Phase 1** 2026-08-18 — see `planning/Roadmap/RM-26-testing/STATUS.md` |
| **Skills registry — register (upload `.zip`/`SKILL.md` or GitHub import), versioning, GitHub pull, size/zip-bomb caps** | ✅ Built (API; Phase 1 · `POST/GET /api/skills*`; `apps/api/src/skills/`) |
| **Skills inspector — rendered `SKILL.md`, L1/L2/L3 token footprint, security surface, file explorer, versions, full-tree diff** | ✅ Built (web; Phase 1 · `apps/web/src/features/skills/`) |
| **Skills — attach to test scenarios (auto-latest / pinned version + eager inline)** | ✅ Built (Phase 2 · `scenario_skills`; latest@runtime / pinned; skill files exposed to the agent read-only + metered, **never executed**) |
| **Skill IDE — enterprise-grade IDE on top of SkillFlow (per-command entry-point flows + canvas flow editing, file/folder workspace, quality engine + optimization, MCP-scan-aware tool validation, trigger/keyword management + collision report, publish-to-GitHub, server-bound skill authoring: frontmatter server binding → exact registered server, `tool_ref` graph nodes, scan-backed completion/hover/palette + scaffold-from-server; unified Flow/Code editing — one live draft, Show flow \| Show code \| Split with anchor selection sync, code-mode decorations/hovers/snippets, guide-anchored explainer registry + unified problems panel)** | ✅ Built (Phases 1–9, all 20 WPs · `apps/api/src/skillflow/*` + `apps/web/src/features/skills/*` · migration v17/v18 · 851 API tests). Live-validated (fresh DB migration + provider-free endpoint E2E). Plan + locked decisions I1–I10 at [`planning/Roadmap/RM-22-skill-ide/`](./planning/Roadmap/RM-22-skill-ide/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-22-skill-ide/STATUS.md) — authoritative). **Owner-acceptance pending** (browser-driven UI walks for all phases — multiflow canvas lanes, command/file/folder CRUD, quality findings + fixes, tool completion/hover/palette/test-run, unified Flow \| Code \| Split sync + one-save-one-version, problems panel deep-links; registered MCP server needed for tool-ref live surface) — tracked in the ledger's Owner-acceptance section. |
| **SkillFlow — visual skill designer (Design/Trace tabs in the skill inspector, blank-skill source, graph edits as new immutable versions, test-run conformance overlay, gate assertions on tests, fracture→suggestion feedback loop)** | ✅ Built (all 5 phases · `apps/api/src/skillflow/*`, `apps/web/src/features/skills/{design,trace}/*`; plan + locked decisions at [`planning/Roadmap/RM-23-skillflow/`](./planning/Roadmap/RM-23-skillflow/), ledger [`STATUS.md`](./planning/Roadmap/RM-23-skillflow/STATUS.md)). Never executes skills — observes the app's **own test runs** of scenarios the skill is attached to (external session-JSONL upload was built then removed by owner decision 2026-07-03 — see D6 amendment). Owner visual/a11y acceptance walks pending — see the ledger |
| **Benchmarks — output-quality grading (Test `expectations` + graders: ROUGE-1, logprob-weighted LLM judge, tool-hygiene, trajectory-vs-reference, SkillFlow-conformance), suite mass-runs (test × scenario × repetition matrix, parallel, soft-stop cost cap), quality×cost analytics, Collections with two-way GitHub sync (real git merge), InsightBench importer, skill-effect A/B** | ✅ Built (all 5 phases · 17 WPs 1.1→5.1 · `apps/api/src/{grading,suites,collections}/*`, `apps/web/src/features/testing/suites/*` + grade UI; migrations v13–v15; 666 API tests). **Phase 6 (judge calibration & trust) was owner-gated backlog and the owner said BUILD on 2026-08-21**, so RM-07 no longer retires on its owner walk alone. **WP 6.1 ✅ done 2026-08-21** — a thumbs-up/down + optional note on every grade card (run console + suite matrix), an exportable **calibration set** (derived: a run joins when one of its grades carries a verdict), migration **v60**, and `POST /api/grades/:gradeId/feedback` · `GET /api/runs/:runId/grade-feedback` · `GET /api/calibration/{json,markdown}`. **AR6 is enforced by test, not convention:** a verdict leaves the grade row, the grades document and the suite aggregates/analytics **byte-identical** — proved by injecting a grade mutation and watching exactly those three assertions go red. Settings shows counts, deliberately not an agreement percentage (that is **WP 6.2**, still open, which also guards a judge change by re-grading only the calibration set). **Both-theme and keyboard checks were NOT done** — no browser was opened. Plan + locked decisions (B1–B15) at [`planning/Roadmap/RM-07-benchmarks/`](./planning/Roadmap/RM-07-benchmarks/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-07-benchmarks/STATUS.md) — authoritative, incl. E2E + owner-acceptance). Live suite runs / LLM-judge grades / ± skill deltas need a provider key (owner-acceptance). Concept origin: [`planning/Research/RS-08-insights-bench-assessment/notes/insights-bench-assessment.md`](./planning/Research/RS-08-insights-bench-assessment/notes/insights-bench-assessment.md) |
| **Testing IA consolidation — Collections as the test home (default "Local", git binding optional), one run engine (suite · collection · interactive ad-hoc plans all run as suite-runs; "Save as suite"), unified Runs feed (suite-run summary → member list → drill into session) with Compare folded in as a tab, two-path run launcher, Scenario→Environment rename (UI labels only), Testing nav 7→4** | ✅ Built (all 11 WPs 1.1→4.2 · migration **v16** · `POST /api/run-plans` = one engine [suite · collection · adhoc all run through the suite orchestrator] · collections git-decouple + undeletable default **"Local"** + membership write/read · unified Runs feed + Compare tab · two-path run launcher + "Save as suite" · **Scenario→Environment UI-label rename with the wire frozen** [`scenarioId`/`Scenario` type/`/api/scenarios`/`/testing/scenarios` redirect kept] · nav 7→4 + 4 redirects · **697 API tests**). Plan + locked decisions D-T1–D-T7 at [`planning/Roadmap/RM-27-testing-ia/`](./planning/Roadmap/RM-27-testing-ia/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-27-testing-ia/STATUS.md) — authoritative); decision record [`planning/Roadmap/RM-26-testing/ia-restructure-handover.md`](./planning/Roadmap/RM-26-testing/ia-restructure-handover.md). On **local `main` only (not pushed to origin)**. **Owner-acceptance pending** (not run live — no provider key): the two-theme / keyboard-focus / 4-redirect / collections-as-home / launcher-both-paths / Runs-feed summary→member→drill / rename spot-check walk — tracked in the ledger's Owner-acceptance section |
| **Auto-Rating — mandatory post-run validation on every terminal run (answer-vs-prompt verdict, double-edged insight surplus, error forensics: 5-bucket root causes + skill/MCP-server fix targets with drafted fixes), Claude-CLI-first judge chain for ALL LLM graders (CLI → provider judge → deterministic-only), per-run Report tab + composed `GET /api/runs/:id/report`, auto suite report when ≥2 members (consistency variance + per-test-group LLM agreement, costs, error clustering)** | ✅ Built (all 13 WPs, Phases 1–4 · `apps/api/src/grading/*` · migrations v22–v26). Base rating (`answer_validation`/`insight_surplus`/`error_forensics`) + CLI-first judge chain + a Rating Issues registry (v26) blend into Benchmarks grading (`run_grades`, append-only, AR6 keeps expectation metrics' meaning; B15 amended — suite failure buckets may auto-run). Post-workstream session (2026-07-12, gate being verified): an additive `ratingState` axis (`pending→rating→rated/failed/skipped`, migration v27) surfaces "Reviewing…" everywhere a run/suite status renders, plus a Report-tab redesign (Outcome/Trajectory judge donuts, `scoreTone()` score thresholds, a run-rating radar chart); a `rouge1`→`ai_pattern` deterministic-grader swap is planned (owner-decided — see [`planning/Roadmap/RM-06-auto-rating/wp-ai-pattern-grader.md`](./planning/Roadmap/RM-06-auto-rating/wp-ai-pattern-grader.md)). Phase 5 (skill/CI cross-links) is owner-gated backlog, not started. Plan + locked decisions AR1–AR16 at [`planning/Roadmap/RM-06-auto-rating/`](./planning/Roadmap/RM-06-auto-rating/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-06-auto-rating/STATUS.md) — authoritative). **Owner-acceptance pending**: live CLI-subscription/provider-judge fallback walk, error-forensics believability, suite-consistency spot-check, both-theme + keyboard walk of the Report tabs (incl. the new donuts/radar/reviewing chips) — tracked in the ledger's Owner-acceptance section |
| **Unified Sessions — one session experience across every run backend (shared terminal table via `stopReasonCode`, additive `ended` terminal + `seen`, stall-based clock [no default wall cap, 10-min stall + wait budget → `wait_expired`], persisted `phase` + queue visibility, capability manifest `capabilities_json`, one status module, SSE cursor resume)** | ✅ Built — **workstream complete 2026-07-16** per [`planning/Roadmap/completed/RM-29-unified-sessions/STATUS.md`](./planning/Roadmap/completed/RM-29-unified-sessions/STATUS.md) (Waves 1–5 merged incl. the facade lane; decisions **D-US1–D-US15** locked 2026-07-16; row synced to the ledger 2026-08-19). Plan: [`planning/Roadmap/completed/RM-29-unified-sessions/`](./planning/Roadmap/completed/RM-29-unified-sessions/) (ledger: [`STATUS.md`](./planning/Roadmap/completed/RM-29-unified-sessions/STATUS.md) — authoritative; [`execution-plan.md`](./planning/Roadmap/completed/RM-29-unified-sessions/execution-plan.md) + [`kickoff-prompt.md`](./planning/Roadmap/completed/RM-29-unified-sessions/kickoff-prompt.md), Waves 1–5 with per-WP model tags). Research: [`planning/Research/RS-03-unified-run-sessions/`](./planning/Research/RS-03-unified-run-sessions/) (docs 00–04) |
| **Observability — fleet monitoring, search & issues on top of the Unified Sessions contract (metrics-over-time + SQLite-FTS5 search + `RunFilter` grammar + saved-views + human-feedback backbone [feedback never blends into grades, AR6 intact], Dashboard grows Scans \| Testing \| Issues tabs with chart→feed drill-down, runs-feed filter/search/views upgrade, console depth [wire-level step hierarchy `parentStepId`, per-step economics + hotspots, fork-from-step with `derivedFromRunId` lineage, in-run search], watch rules [on-terminal + windowed with catch-up-on-boot, in-app notification center + one generic webhook, promote-run-to-test], fleet issues extending the v26 rating-issues registry [deterministic clustering + auto-reopen on regression, opt-in LLM assist via the CLI-first judge chain, owner-initiated Assistant fix loop], pricing editor [DB + effective dates], custom chart composer, review-queue lite, scheduled digest)** | ✅ Built — **all 27 WPs (Phases 1–5) merged to local `main` 2026-07-17**, plus **WP 3.5 — the agent-graph lens — merged 2026-08-21** (the run as a node-link diagram: *Aggregated* merges calls sharing a name into one node with a ×N counter so a loop renders as a real cycle, *Expanded* unrolls every call in execution order; node chips carry count/tokens/cost/duration, selecting a node filters the Steps lens to exactly that node's steps, and lens+mode+selection ride in the URL. A pure projection — no schema, wire, migration or dependency change — on `@elabs-ai/components-flow`'s canvas; a pre-hierarchy run renders flat **and says so**, and cost reads UNKNOWN rather than `$0.00` when a run carries no per-step snapshots. Two-theme + keyboard walk is owner-acceptance, not done) per the ledger (migrations v32–v46; **owner-acceptance pending; not pushed to origin**; row synced to the ledger 2026-08-19). Plan + locked decisions **D-OB1–D-OB28** at [`planning/Roadmap/RM-17-observability/`](./planning/Roadmap/RM-17-observability/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-17-observability/STATUS.md) — authoritative; [`kickoff-prompt.md`](./planning/Roadmap/RM-17-observability/kickoff-prompt.md), 27 WPs across Phases 1–5 with a per-WP model map; superseded first-cut Phase 0 preserved at `_superseded/`). Research: [`planning/Research/RS-04-langsmith-observability/`](./planning/Research/RS-04-langsmith-observability/) + [`planning/Research/RS-05-langfuse-landscape/`](./planning/Research/RS-05-langfuse-landscape/) (2026-08-18). **Additive amendment LOCKED 2026-08-21 (D-OB29)** — the Langfuse/landscape design imports **AM-OB1–14** ([`amendment-2026-08-langfuse.md`](./planning/Roadmap/RM-17-observability/amendment-2026-08-langfuse.md)) are now **ledger Phase 6 work packages, deliberately NOT renumbered into D-OB29+ decisions** — a `D-OB` number is a constraint the code must keep honouring, and these fourteen are things to build, each individually droppable. **AM-OB9 was promoted into Phase 3 as WP 3.5** (agent-graph lens over a run — **built and merged 2026-08-21**, described above). Consequence: the workstream reopened with **14 boxes** — before the lock it had one, and rejecting the amendment would have retired it outright. **11 remain as of 2026-08-21**: WP 3.5 plus two Phase 6 items are done. **AM-OB1** — the runs feed's whole view state (applied saved view · sort · grouping · type facet · visible columns, on top of the `filter=` that already round-tripped) now serializes into the URL, so an arrangement is a shareable link and a saved view is a short named URL, with a default omitted so zero-param `/testing/runs` is byte-unchanged (D-TB10) and a malformed value degrading rather than throwing; web-only, no wire change, no migration. **AM-OB10** — watch rules gain a WARNING level below ALERT (a warn→alert escalation re-fires **through** an active cooldown), an explicit **NO_DATA** outcome with a per-rule hold/notify/ignore policy, **PAUSED** as distinct from disabled (a timestamp, so it expires itself; a paused rule still evaluates and records, only dispatch is suppressed), and a minimum alert interval for `on_terminal` rules, which had **no** suppression at all. That one fixed a **live defect**, not a gap: an empty window returned `breached:false`, so the not-breached branch wrote `window_recover` and re-armed — a bench that went silent while a rule was firing reported as **recovered**. One shared module (`packages/shared/src/watch-state.ts`) is the single definition the evaluator, the zod refinement and the editor all call; migration **v61** adds two additive nullable `watch_rules` columns (pause + interval — the thresholds and the policy needed none). Neither item was walked in a browser: no two-theme look, no keyboard pass, no live notification sent. Six Phase 6 items are marked *verify-at-pickup* (the surface shipped 27 WPs before the amendment was written — shrink each to its true residual, do not rebuild), and four touch charts, where the panel suites mock `@elabs-ai/components-charts` as no-ops so a chart-prop bug passes the gate silently |
| **Illustration design system — theme-token-driven isometric "3D blueprint" illustration components for the app's core entities (`packages/illustrations`: LLMs/agents, MCP servers, skills, runs, suites, …), colors derived live from `light`/`dark` via a closed `--illus-*` token layer; machine-readable registry + in-app asset-repository gallery (`/illustrations`); declarative zod scene spec (the only composition path) + deterministic scene renderer; explain-mode step player for app-internal processes; assistant-composed scenes (describe a workflow in chat → validated spec → preview → save)** | 🚧 **Partially built, HIGH priority** — **Phase 0 complete (WPs 0.1–0.3)**: `packages/illustrations` with the closed `--illus-*` token layer (one mapping file, zero colour literals, enforced by a recursive package-wide scan), `iso-math.ts` + the D-IL16 layer order + **ten primitives**, the **three pilot entities** (`mcp-server` stdio/streamable-http · `skill` plain/versioned · `agent` honouring D-IL17 `facing`) composed only from those primitives — each entity's contract test asserts its rendered markup contains **no `<path>` at all** — **registry v0.1** (`REGISTRY_VERSION` `0.1.0`, entries validated against the WP 0.1 zod schema at module load, component map held equal to the entry ids in both directions), and the **`/illustrations` gallery route**: a live grid in the current theme + a detail dialog with the states × sizes × variants × facing matrix, a port overlay and the registry entry, plus a Primitives tab. The route is registered in **both** `ASSISTANT_ROUTE_MANIFEST` (a reasoned D-AO4 exemption naming WP 4.1) and `PAGESHELL_EXACT_ROUTES`; it has **no nav item** (IA placement is an owner decision). **Phase 1 COMPLETE 2026-08-21 (WPs 1.1–1.4)**: the catalog is **24 components**, not 3 — the runtime cast (`model`, `provider`, `validator`, `run`, `prompt`), the assets cast (`tool`, `resource`, `prompt-template`, `file`, `feedback-report`, `scan`, `token-meter`) and the orchestration cast (`suite`, `collection`, `orchestrator`, `diff-compare`, `environment`, `database`, `credentials-vault`, `assistant`), all on a **cast-module seam** (`entities/cast-*.ts`, one per work package, each with its own census beside it) so `registry.ts` and `entities/index.ts` name no entity and two work packages adding entities share no file. Three primitives were extracted along the way — `IsoFigure` (agent/validator/assistant), `IsoSheetStack` (skill/file/feedback-report) and `IsoTrack` (run/suite/orchestrator). Adding one is now a **recipe, not an act of imitation**: `scripts/new-component.mjs` scaffolds the entity, its contract test, its cast module, that module's census and a changelog line — never `registry.ts` or `entities/index.ts` — and the 24th (`owner`) was made that way as the proof. `REGISTRY_VERSION` stays **`0.1.0`**: per a dated 2026-08-21 amendment to D-IL12, adding a component does **not** move it (it is a flag-don't-break marker for authored scenes, and an addition cannot invalidate a scene that could not have referenced it); the growth record is `packages/illustrations/CHANGELOG.md`, and a checked-in scene-visible-contract snapshot (`registry-contract.snapshot.json`) now **fails** if an existing entry loses or renames a port/variant/state/size without a bump, while staying silent on additions. **Not built:** the scene spec's layout engine/renderer, explain mode, scene persistence, and the assistant `illustrations_*` tools (Phases 2–4). Plan + locked decisions D-IL1–D-IL17 at [`planning/Roadmap/RM-14-illustrations/`](./planning/Roadmap/RM-14-illustrations/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-14-illustrations/STATUS.md) — authoritative). **Phase 0 owner-acceptance ACCEPTED 2026-08-21** (gallery walked in both themes at `http://localhost:8081/illustrations`, the container — `:8080` was held by a dev server predating the whole workstream), which is what opened Phase 1. Origin: the owner's Self-Learning Agentic Loop reference image; the repo-root `illustrations/` folder is export output only |
| **CI & headless automation — service tokens, `mcpfp` CLI (scan/suite/assert/report as a thin API client), server-side assertions with exit codes, baseline-delta PR-comment artifact, GitHub Actions packaging, workbench MCP server (the bench itself MCP-operable by external agents)** | ✅ **Built — all 11 WPs, Phases 1–3 + Phase MCP, complete 2026-08-20** (decisions **D-C1–D-C22**, **D-MCP1–D-MCP13**); plan at [`planning/Roadmap/RM-08-ci/`](./planning/Roadmap/RM-08-ci/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-08-ci/STATUS.md) — authoritative). **Phase 1**: service tokens (`api_tokens`, `user_version` 58, hashed + scoped, Settings UI), the `mcpfp` CLI (`apps/cli`, one runtime dependency), and the server-side assertions engine with the D-C7 exit-code contract (`0` pass · `1` **assertion failure, reserved to `mcpfp assert`** · `2` the gate could not run). **Phase 2**: `mcpfp suite run` (start a saved suite, poll to a settled terminal state, summary; `completed` → 0, everything else → 2), suite/grade assertions (`min-suite-score`, `max-suite-cost`) over `{suite}`/`{suiteRun}` targets with a **single-family** gate-document rule, `renderAssertionMarkdown` as the one PR-comment renderer, and two copyable GitHub Actions gates in [`examples/github-actions/`](./examples/github-actions/) — shipped as **examples**, not live workflows here, and held honest by a text test. **Phase 3**: `no-new-security-findings`, which diffs security-posture reports by **(ruleId, anchor) set membership, never a count**, defaulting to a `warning` floor. **Phase MCP** — the workbench serves its **own** MCP server at **`/api/mcp`** (stateless streamable HTTP on the existing Fastify process, D-MCP1): **24 tools — 21 read + 3 scoped write** — over servers/scans, runs/grades/reports, skills, suites/collections and compatibility, plus 4 report resource templates, all re-projecting the existing repositories (D-MCP4) and returning **no secret values**. **Phase MCP — decisions D-MCP1–6 locked 2026-08-19; WP M.1 ✅ built** (plan: [`planning/Roadmap/RM-08-ci/mcp-server.md`](./planning/Roadmap/RM-08-ci/mcp-server.md), ledger: [`STATUS.md`](./planning/Roadmap/RM-08-ci/STATUS.md) — authoritative). The workbench now serves its **own** MCP server at **`/api/mcp`** (stateless streamable HTTP on the existing Fastify process, D-MCP1): **24 tools — 21 read + 3 scoped write** — over servers/scans, runs/grades/reports, skills (incl. footprint + security surface), suites/collections and compatibility, plus 4 report resource templates (`workbench://reports/{run,scan}/…`), all re-projecting the existing repositories (D-MCP4 — no logic in the MCP layer) and returning **no secret values**. The three write tools (WP M.3, D-MCP10–13) are `scan_run` (`scan:run`), `suite_run_start` (`suites:run`) and `run_plan_start` (`runs:launch`) — one per execute scope in the frozen D-C4 vocabulary, each answering with a ticket to poll rather than blocking, each carrying the launcher's own advisory cost estimate, and `run_plan_start` refusing `source:"suite"` so `runs:launch` is never a back door onto a saved suite. **Nothing on the surface deletes, prunes, revokes or edits configuration, at any scope, at any phase** (D-MCP3). Behind the new `mcp_server` Settings › Features flag (D-MCP6; off ⇒ 403 `feature_disabled`). No new dependency, no migration. **Dogfooded (D-MCP5): the app scans its own mount — now 24 tools · 2,749 tokens**, against the unchanged 3,000-token definition budget. Agent onboarding rides on the same mount: `GET /api/mcp/llms.txt` serves a usage doc **generated from the registered tool surface**, the owner-facing walkthrough is [`planning/user-guide/DC-16-workbench-mcp-server/20-workbench-mcp-server.md`](./planning/user-guide/DC-16-workbench-mcp-server/20-workbench-mcp-server.md), and `pnpm mcp:self-scan` re-measures the mount with the app's own discovery scanner (gitignored `.artifacts/mcp-self-scan/` JSON+Markdown artifact; exit 1 over budget, 2 on failure; wired as `.github/workflows/mcp-self-scan.yml`, the repo's only workflow) — **WP M.4 ✅ built 2026-08-19**; **WP M.2 (mount scopes) and WP M.3 (the write tools) 2026-08-20** — Phase MCP complete. **Owner-acceptance pending across the whole workstream** — most importantly, **the example workflows have never been executed by GitHub Actions** (this repo has no place to run them); see the ledger's Owner-acceptance section. Evidence: [`planning/Research/RS-05-langfuse-landscape/`](./planning/Research/RS-05-langfuse-landscape/) (every compared platform ships an MCP server over itself; the MCP workbench now does too) |
| **Security posture — deterministic versioned analyzer over persisted scans/skills (tool-poisoning heuristics, annotation sanity, schema hygiene, OAuth scope breadth, skill security roll-up) → findings + score + posture diff; feeds a CI assertion** | ✅ **Built — all 6 WPs (Phases 1–2) done 2026-08-20**, owner-acceptance pending — plan at [`planning/Roadmap/RM-20-security-posture/`](./planning/Roadmap/RM-20-security-posture/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-20-security-posture/STATUS.md) — authoritative). **WP 1.1 ✅ + WP 1.2 ✅ built 2026-08-20** (decisions **D-SP1–D-SP11**): the contract lives in `packages/shared/src/security-posture.ts` — `SECURITY_ANALYZER_VERSION`, a **frozen eleven-rule server registry** (4 `error` · 4 `warning` · 3 `info`), the finding/report/score shapes with `.strict()` zod schemas, and five pure functions (one score, one total order, one evidence redactor, one cap, one finding factory that reads severity from the registry so a rule can never choose its own). The analyzer itself is `apps/api/src/security/{analyzer,service,routes}.ts`, served at **`GET /api/scans/:scanId/security`**: eleven deterministic rules over an ALREADY-persisted scan, **computed on read and persisted nowhere** (no migration, no table, no column), byte-stable for the same input, and refusing a non-`success` scan with a 400 rather than scoring a partial tool list. The one credential read is `OAuthRepository.listGrantedScopes` — scope **names** only, never token material (**D-SP9, owner-reviewable**). No new dependency, no environment variable, no feature flag. **WP 1.3 ✅ built 2026-08-20** (D-SP12–D-SP16): a **seven-rule `skill-surface.*` registry** — 3 `error` (injection phrasing, hidden instruction block, invisible unicode) · 2 `warning` (credential-shaped value in the body, broad `allowed-tools` grant) · 2 `info` (ships executable scripts, references the network) — over an already-persisted skill version, scored by the same WP 1.1 contract, served at **`GET /api/skills/:id/versions/:vid/security`** (`apps/api/src/security/skill-analyzer.ts`; `analyzeSkillFiles` is pure, `apps/api/src/skills/**` is a zero-line diff). **WP 1.4 ✅** (D-SP17–D-SP20): **one differ in the contract** — `diffSecurityReports(baseline, subject)` in `packages/shared/src/security-posture.ts` is the only definition of `added`/`resolved`/`unchanged`, and the `no-new-security-findings` CI assertion re-projects it instead of keeping its own identity set; served at **`GET /api/scans/:scanId/security/diff?baseline=`** and **`…/skills/:id/versions/:vid/security/diff?baseline=`**, both sides analysed through the same `analyzeScan`/`analyzeSkillVersion` the report routes serve (D-MCP4). **Phase 2 ✅**: WP 2.1 (D-SP21–D-SP23) puts the analyzer on the page — a Security tab on scan detail and in the skill inspector (findings worst-first, redacted evidence, score + band + per-severity tiles), a per-server posture badge, and a baseline-picker diff inside each tab (`apps/web/src/features/security/`); WP 2.2 (D-SP24–D-SP26) adds a `## Security posture` section to the scan and server exports, JSON and Markdown, built in **exactly one file** (`apps/api/src/reports/security-section.ts`) pinned by a source-walk test. Everything is **computed on read and persisted nowhere** — no migration, no table, no column, no dependency, no environment variable, no feature flag, across all six WPs. **Owner-acceptance pending** (10 boxes): the false-positive rate on the owner's **own** servers and skills, the diff on real history + its four refusals, one exported document read end to end, the two-theme keyboard walk, a poisoned-fixture check, and explicit sign-off on **D-SP9** (the one decryption-path touch) and **D-SP15** (the skill analyzer's read boundary) — plus the recorded finding that the bench's own MCP mount scores **49 / high risk** on 51 `info` findings. |
| **Cache-aware token accounting & display — the prompt-cache composition (uncached / cache read / cache write) behind every token and cost figure; nullable run columns + backfill; `cacheReadTokens` / `cacheWriteTokens` / `cacheHitRate` observability measures; a `TokenAmount` display grammar; a cache-aware run-plan cost preview** | ✅ Built — **all 7 WPs done 2026-08-21** per [`planning/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md`](./planning/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md) (decisions **D-CT1–D-CT6**). The accounting was already correct — `estimateCost` has always priced a cache read at `cachedInPer1M` (~0.1×) and a cache write at 1.25× — but nothing downstream showed it: the `kpi` event dropped the split, `runs.cached_tokens` was **write-only** (persisted since the run engine shipped, mapped onto the wire nowhere), and exactly three web files mentioned cache. **D-CT1**: `tokensIn`/`tokensOut` keep their meaning (gross, cache-inclusive) — the split is added alongside, never subtracted. **D-CT2**: a cache READ (discount) and a cache WRITE (premium) are never merged in a new surface. **D-CT5**: `computeCostBreakdown` is the app's single cost formula and `estimateCost` is a thin caller of it (source-grep enforced). **D-CT6**: absent means UNKNOWN, never zero — a run with no known split is EXCLUDED from a metrics bucket and rendered "not measured", because a 0% cache-hit line is indistinguishable from a caching regression. Migration **v59** adds two **nullable** `runs` columns and backfills them from `run_steps.usage_actual_json` (recovered 141 of 163 runs on the owner's own database; 6 merged-only runs correctly left NULL rather than zeroed). Surfaces: run console (tiles, tooltips, context popover, relationship note), Trace/Turns/Steps, runs feed + an opt-in **Cache hit** column, suite rollups (all-or-nothing — one unknown member makes the total unknown), Analytics (three stacked series), the Testing dashboard's **Prompt cache** panel, reports (JSON + Markdown, with `RunReportStatistics` finally given a shared type + zod schema), the compare workspace + export, and the workbench MCP `compactRun`. The three measures are picked up automatically by the custom chart composer and the watch-rule editor. No new dependency, no feature flag, one migration. **Verified against the running app in both themes** (isolated DB copy, never the live file): the rail reads "sent · 96.2% from cache", the dashboard panel shows 51.9M reads vs 6.9M writes, and the not-measured state renders over a genuine pre-v59 window. **Owner-acceptance pending**: a hand-driven keyboard walk of the dashboard panel, its hover tooltip (the dashboard chart stub no-ops `ChartTooltip`, so it is unit-tested only), the Step-log chip and compare Δ rows in both themes, and a judgement call on whether the launcher's cost band is usefully narrow — it BRACKETS a real run's cost ($0.42–$1.59 against $0.80 billed) but cannot land near it, because the estimator's 8-turn ceiling is now the dominant error source where that run took 19 turns. **Superseded on that last point 2026-08-21 by [`RM-34`](./planning/Roadmap/RM-34-estimator-turn-model-calibrate/STATUS.md)**: the 8-turn ceiling is gone (the band is measured from completed-run history, `basis`/`sampleSize` on the wire and shown in the launcher), and that run now falls inside the token band. RM-34's own live pass found the estimator still wrong for a *different* reason — the per-turn prefix is charged in full from turn one and the estimator never sees `tool_loading_mode` at all, and fitted against real runs that over-states them by ~93k–175k tokens — so the cost band's floor is now above a typical run's real cost, and the token/dollar band's coverage of real runs is *lower* than before RM-34. Both are recorded as follow-ups in RM-34's ledger, not fixed. |
| **Advisor — evidenced recommendations from measurements (unused-tool trims with token savings, description bloat, eager-vs-deferred comparison, cross-server overlap; grade-aware trims + skill ROI + fleet report)** | ✅ Built — **Phases 1–2 (all 5 WPs) done 2026-08-18** per [`planning/Roadmap/RM-01-advisor/STATUS.md`](./planning/Roadmap/RM-01-advisor/STATUS.md) (`/advisor` view + `GET /api/advisor/report` + seven evidenced rules + `GET /api/reports/fleet/{json,markdown}`; owner-acceptance pending; row synced 2026-08-19); absorbed testing WP 5.7 |
| **Assistant — embedded Claude agent chat (global right dock + page hooks; Agent SDK in the container on the owner's Claude subscription with API-key fallback, in-app sign-in via Settings; in-process MCP tools over app data + context envelope; approval-gated writes incl. skill edits → new immutable versions via a materialized workspace; agent-driven UI navigation)** | ✅ Built (Phases 0–3, all 12 WPs 0.1→3.3, behind the gate). Session engine (streaming-input Agent SDK `query()` behind a DI seam — tests never spawn a real child) + 23 read tools + system prompt/context-envelope; dock UI (`@elabs-ai/components-ai` `ChatShell`) + page-hook "Analyze…" entry points; write-permission protocol (D-AS4 — gated by default, deletes always ask) + a skill-workspace edit loop (materialized filesystem → new immutable skill version) + the remaining app-data write tools; UI-navigation tools over an addressable-view registry (agent-driven `ui.*` navigation, live vs. replayed). **WP 3.3 hardening:** an explicit "retry on the other auth source" action after a subscription/API-key limit error (D-AS14 — never a silent fallback) with a dock banner + re-sign-in hint; a token-expiry warning badge in the dock (not just Settings); `POST /api/maintenance/prune-assistant` thread/workspace/session-transcript retention (also reachable from Settings); doc/env-var/wording cleanup. Gate green throughout (1143 API + 566 web tests). Plan + locked decisions D-AS1–D-AS18 at [`planning/Roadmap/RM-02-assistant/`](./planning/Roadmap/RM-02-assistant/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-02-assistant/STATUS.md) — authoritative). **Owner-acceptance pending** (live PTY sign-in with a real Max/Pro account; the two canonical flows — run-console failure triage, and skill page → analyze → edit → approve → new version; a real subscription-limit → explicit retry-on-key walk; both-theme + keyboard walk of the dock, the Settings Assistant/Storage cards, and the new limit-error banner + expiry badge; container-restart-mid-thread resume) — tracked in the ledger's Owner-acceptance section. |
| **Assistant Hub — the full-page, multi-model, multi-agent Assistant (nav item "Assistant" below Dashboard, route `/assistant`, internal namespace `hub` — distinct from the dock, which relabels to "App assistant"): general-purpose identity; session modes chat · research · mission; Perplexity-class MCP-native research with a first-class inline-citation contract; the harness (a planner proposes subagent teams — per-agent role, system prompt, model, MCP server+tool grants, skills, target, expected outcome, budgets — running as parallel child sessions with full live mission control, structured reports, cited synthesis); role library + saved crews + topologies (parallel/pipeline/debate/best-of-N); declarative generative UI (model-composed forms/tables/charts from a curated `@elabs-ai/components-*`-part catalog); artifacts (versioned canvas, uploads, review workflow, per-session file workspace, self-contained `share.html` export); memory (profile/preferences with propose-to-save, session compaction, projects with pinned context); usage telemetry + audit timeline; a bundled research-server recipe (curated Tavily/Brave/Exa presets in the add-server wizard); built on the full `@elabs-ai/components-ai` component set over the existing provider/MCP/skills/metering infrastructure and the Unified Sessions contract** | ✅ Built (all 5 waves 0–4 · migrations v47–v48 · `apps/api/src/hub/*` + `apps/web/src/features/hub/*`; decisions D-AH1–D-AH20). e2e smoke (`e2e/smoke.spec.ts`) drives the full chat-tool-call-creates-an-artifact + mission propose→approve→run→synthesize flow against a deterministic stubbed model (`e2e/fixtures/hub-stub-llm-server.ts`) — no provider key needed; gate green (`pnpm typecheck && pnpm test`). **UI rebuild (Waves 0–4, all 24 WPs):** the workspace was rebuilt onto the app shell grammar (meta rail with Progress/Outputs/Context sections, session switcher in toolbar, first-prompt choreography), Sessions table at `/assistant/sessions` (sortable/filterable), workforce section (Directory/Org chart/Usage tabs with agent & crew profile modals, per-tool scan-cost visibility in Access), scoped memory (profile/project/agent/crew), nav 6→4 (Assistant+Sessions child, Agents & Crews, Projects, Audit) with legacy redirects; plan + authoritative ledger at [`planning/Roadmap/completed/RM-04-assistant-hub-ux/`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/) (ledger: [`STATUS.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/STATUS.md), [`execution-plan.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/execution-plan.md), 24 WPs Waves 0–4; owner-acceptance walk at [`owner-acceptance-walk.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/owner-acceptance-walk.md) — both-theme, keyboard, choreography, workforce, drill). Documented in [`planning/user-guide/DC-13-assistant-hub/16-assistant-hub.md`](./planning/user-guide/DC-13-assistant-hub/16-assistant-hub.md). On **`feat/assistant-hub-ux`** (merged into `feat/assistant-hub`, owner merges to `main`). **Owner-acceptance pending** (live provider keys, real mission ≥3 agents/mixed models, research mode against real search server, both-theme + keyboard walk per the ledger's Owner-acceptance section). Original plan at [`planning/Roadmap/RM-03-assistant-hub/`](./planning/Roadmap/RM-03-assistant-hub/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-03-assistant-hub/STATUS.md) — authoritative; [`execution-plan.md`](./planning/Roadmap/RM-03-assistant-hub/execution-plan.md), 5 waves / 31 WPs incl. declarative GenUI (WP2.6, R-GUI1–8); normative SOTA requirements annex [`requirements.md`](./planning/Roadmap/RM-03-assistant-hub/requirements.md) with evidence in [`planning/Research/RS-06-agentic-session-sota/`](./planning/Research/RS-06-agentic-session-sota/) docs 00–04) |
| **Assistant operability — mandatory rule + hard CI gate that every route/view exposes an assistant interface (single source-of-truth route manifest → context-aware starter surface or reasoned exemption; Hub made operable: `agents`/`hub` starter surfaces + `hub_agents_list`/`hub_crews_list`/`hub_usage_summary` read tools; route-keyed surfaces, frozen entity vocabulary untouched)** | ✅ Built (all 8 WPs, Phases 1–5 · `packages/shared/src/assistant-route-manifest.ts` + the `assistant-route-operability` gate [api A/B/C-surface + web C-pin, both in `pnpm test`] · `.claude/rules/assistant-operability.md` hard rule [test-enforced] + non-blocking `enforce-assistant-operability.mjs` nudge · `agents`/`hub` dock surfaces + `hub_agents_list`/`hub_crews_list`/`hub_usage_summary` read tools · "Ask the assistant" page-hook on the agent/crew profile modals · `/reports/scans/:scanId`→scan pin · **Phase 5 (D-AO7) Hub WRITE operability: `hub_agent_create`/`hub_agent_update`/`hub_crew_create`/`hub_crew_update` as scope-exempt, approval-gated action tools so the dock creates/edits agents & crews from the unpinned `/assistant/agents` page — reuse the shared route schemas + `HubRepository`, adversarial-security-reviewed clean**). 41-entry manifest = every App.tsx route (+ the `/settings` known-extra); frozen write-scope vocab (`ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS`/`deriveAssistantScope`) untouched even by the Phase 5 writes (D-AO3 — they ride the `mcp_tool_call`/`rating_issue_file` scope-EXEMPT precedent, no new entity kind); no migration, no new dep. Gate green throughout (final: typecheck · test shared 82 / api 3096 / web 3010 · build · lint). Plan + locked decisions D-AO1–D-AO7 at [`planning/Roadmap/RM-05-assistant-operability/`](./planning/Roadmap/RM-05-assistant-operability/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-05-assistant-operability/STATUS.md) — authoritative). On **local `main`**. **Owner-acceptance pending**: the running-app two-theme walk (`/assistant/agents` dock shows the agent/crew chips not the global set; a chip answers via the hub read tools; the profile-modal "Ask the assistant" button; **creating a crew + agents via the dock → approval prompt → they appear**; `/dashboard` still global; the gate bites on a bogus route) — tracked in the ledger's Owner-acceptance section. `/testing/environments` real-surface upgrade deferred (needs URL-encoded selection). |
| **Hierarchical crews — runtime-recursive saved-crew composition** | ✅ Built (all 5 phases, 21 WPs 0.1→5.1 · migrations v54 · `apps/api/src/hub/{repository,missions/*}` + `apps/web/src/features/hub/*` · deterministic crew recursion; nested crews run as sub-missions under their own topology; budget cascade monotone + transitive agent ceilings; two-layer cycle/depth guard (author-time + run-time); event-sourced tree replay; transitive grant/autonomy non-escalation; `HUB_MISSION_MAX_DEPTH` default 2, `HUB_MISSION_MAX_TOTAL_AGENTS` default 24; security boundary frozen — `ASSISTANT_ENTITY_KINDS`/`SCOPE_WRITE_TOOLS`/`deriveAssistantScope` untouched). Plan + locked decisions D-CN1–D-CN10 at [`planning/Roadmap/RM-10-crew-nesting/`](./planning/Roadmap/RM-10-crew-nesting/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-10-crew-nesting/STATUS.md) — authoritative, with full-tree adversarial-review findings). Documented in [`planning/user-guide/DC-13-assistant-hub/17-crew-nesting.md`](./planning/user-guide/DC-13-assistant-hub/17-crew-nesting.md). On **`feat/crew-nesting`** (not yet merged to `main`). **Owner-acceptance pending** (live nested missions ≥2 levels, both-theme + keyboard walks of org rail/mission board, budget-exhaustion traces, cycle/depth rejection UX, transitive grant intersection, hierarchical run report, constraints & defaults) — tracked in the ledger's Owner-acceptance section. |
| **Feature flags — Settings › Features, per-capability on/off switches** | ✅ Built (`packages/shared/src/feature-flags.ts` registry → `apps/api/src/features/*` [`app_settings` key `app.features`, **no migration**] → `apps/web/src/features/feature-flags/*` + the Settings › Features pane). Two flags today. **Assistant**: off hides the five Hub nav items, the App-assistant dock + its ⌘J binding and the page-hook "Ask/Analyze the assistant" buttons, swaps every `/assistant/*` route for a "turned off" panel deep-linking `/settings/features`, and makes the API answer **403 `feature_disabled`** on `/api/assistant/*` + `/api/hub/*` (a stale tab or a direct request cannot keep spending). **Workbench MCP server** (added 2026-08-19 by ci WP M.1): off makes `/api/mcp` answer 403 `feature_disabled` (it owns no nav item and no web route). Absent/corrupt flag state resolves to ENABLED by construction; the `<Route path="…">` literals are untouched, so the `assistant-route-operability` gate is unaffected. Gate green (shared 89 · api 3234 · web 3174 · build · lint); guard + persistence-across-restart verified against the running built API. **Owner-acceptance pending**: the both-theme + keyboard walk of the Features pane, the confirm dialog and the turned-off panel. |
| **Claude subscription as a run model — Claude models on the owner's signed-in subscription as a first-class selectable run model for single *and* suite runs, with an explicit estimate marker wherever a metric is not provider-exact** | ✅ Built (all 13 WPs, Phases 0–3) — `"claude_subscription"` joins `PROVIDER_KINDS` (additive shared contract + zod; `provider_credentials.kind` CHECK widened), a `claude-subscription-executor` runs the multi-turn `AgentSessionDriver` loop, MCP tools reach it through the SDK's `mcpServers` with the allow-list expressed as `disallowedTools`/patterns, skills are materialized **read-only** into the SDK workspace (`additionalDirectories`), and cost is **shadow-priced** from exact tokens via `MODEL_PRICING` (D-CS8) so the cost cap and budgets still bite. Suite runs go through the orchestrator unchanged behind a shared run+judge subscription **semaphore** (D-CS2/D-CS10); reports carry `costBasis`/`meteringEstimated` + a footnote, the UI marks the affected KPIs "est." / "subscription-reference" (D-CS4), and auto-rating still rates a subscription run. Ledger: [`STATUS.md`](./planning/Roadmap/RM-09-claude-subscription/STATUS.md) — authoritative. **Owner-acceptance pending** (needs a signed-in subscription; cannot run headless): a live single run driving an MCP server end to end, a live suite mass-run holding under the semaphore, the both-theme + keyboard walk of the accuracy markers, and the not-signed-in path reading as an honest error rather than a fake result (D-CS7). |
| **Dashboard bento — the homepage Overview** | ✅ Built (all 12 WPs, Phases 0–2) — the landing surface rebuilt on the bento grid by switching on four capabilities the design system already shipped and the app never used: the **full twelve-colour** chart ramp (was 5), chart `onDatapointClick` drill-through (the stale workaround retired), and metric-card trend/sparkline/featured props. Overview is the default tab: a hero footprint chart + KPI tiles, attention/movers/advisor list tiles, and scan-inventory tiles (Servers · Tools scanned · Resources · Prompts), all derived client-side by `use-overview-data` with **no new endpoint**. Phase 2 answered owner feedback: one page-level toolbar with a shared timeline (Scans merged in, spotlight removed), the fleet footprint plotting **every** server held at its last successful scan, and footprint lines differentiated by **stroke pattern, not colour alone** (D-DB4). Ledger: [`STATUS.md`](./planning/Roadmap/completed/RM-11-dashboard-bento/STATUS.md). **Retired 2026-08-21** into [`DC-11`](./planning/user-guide/DC-11-observability/doc.md) — no owner-acceptance section existed, so no live both-theme/keyboard walk of the Overview tab is on record. |
| **Assistant Hub defect fixes — the six verified root causes from the Hub diagnosis** | ✅ Built (all 21 WPs, Phases 0–7) — the Hub shipped with mission subagents that **could not actually call tools**, so missions produced confident output from no evidence. Fixed: deferred-tool promotion + an `auto` loading policy so deferred MCP tools are built into the callable map and gated natively (`ai@7` `prepareStep`/`activeTools`); scope plumbing made honest (persisted, PATCH-able, grant-aware rail); MCP connection status surfaced as events + chips + retry; a tools prompt-budget compression pass. Mission agents became **real child hub sessions** created with `toolScope: planned.toolGrants` and run through the turn engine, with a planner server catalog + least-privilege plan-card grant editing, a `effectiveAgentGrants = plan grants ∩ parent scope` inheritance rule (D-HF5), real per-agent cost/token rollup, and a mission HITL approval policy (D-HF6). Plus round-based debate (parallel openings, then rebuttals), truthful topology graphs, per-agent live session panels, provider-native `web.search`/`web.fetch` built-ins (D-HF2), and an `auto` session mode that routes chat-vs-mission per message. WP 7.R was an adversarial review (forged plan JSON, hostile `tool_search` queries, an SSRF probe) that also assembled [`owner-acceptance-walk.md`](./planning/Roadmap/completed/RM-13-hub-fixes/owner-acceptance-walk.md). Ledger: [`STATUS.md`](./planning/Roadmap/completed/RM-13-hub-fixes/STATUS.md). **Retired 2026-08-21** into [`DC-13`](./planning/user-guide/DC-13-assistant-hub/doc.md) with its ledger clean — but **the 28-item live walk was never run** ("Nothing below is verified"), and it travels with the item as the outstanding verification. |
| **Model identity — a model choice means the model *and* the credential** | ✅ Built (all 16 WPs, Phases 1–6) — the Hub carried a bare model-id string and **re-guessed the provider from the model name**, which routed a signed-in subscription session onto a metered API key. Now an additive optional `providerCredentialId` rides 9 wire types + 8 zod schemas, `HubModelResolver` takes `(modelId, providerCredentialId?)` and uses an explicit credential **as-is** (validated: exists · `isHubModelKind` · not `authBroken`) with the heuristic never running, and an unknown/ineligible/broken pin **throws 409** rather than silently degrading (D-MI9). One `PROVIDER_KIND_META` replaced three competing label maps; **one `HubModelPicker`** replaced four implementations *and* three surfaces that had no picker at all (nine call sites); the subscription adapter got real MCP tools by reusing the Testing path's `buildSubscriptionToolWiring` (D-MI3); cost attribution reads the persisted `provider_credential_id` first (D-MI10); and a limit-error retry now actually switches source. WP 5.R was an adversarial refute-review that **found 2 of 6 acceptance criteria did not hold** — Phase 6 remediated all 12 findings, each mutation-probed. Ledger: [`STATUS.md`](./planning/Roadmap/RM-16-model-identity/STATUS.md). **Owner-acceptance pending** (needs a signed-in subscription): a real Anthropic-CLI→Sonnet turn with **no metered call**, the nine-call-site picker walk in both themes, and a subscription-pinned agent launched via a crew. |
| **Release & delivery — the offline hand-off bundle** | ✅ Built — **retired 2026-08-21** into [`DC-22`](./planning/user-guide/DC-22-packaging-and-deployment/doc.md). `scripts/release.sh` builds `dist/release/v<version>/`: the image via `docker save` + gzip, `run.sh` + `run.ps1`, a recipient-facing `README.md` and `SHA256SUMS.txt` — so someone with only Docker Desktop, **no repository access and no registry**, can run the app. The launcher verifies the checksums, `docker load`s the image, replaces any previous container **keeping its data volume**, probes upward from port 8080 for a free one, waits for `/api/health` and opens the browser (`PORT=` overrides). Cross-built to `linux/amd64` by default, from committed `HEAD`, with the quality gate run on the host *first*; `.dockerignore` excludes `.env*`/`data/`/`.git`, so **no secrets ship** and each install generates its own `mcp-secret.key` on first boot. Reachable as `/release` (no argument = build only; `publish` = also cut the git tag + GitHub Release, owner-gated). **The item never had a ledger** — retired with `--no-ledger`, the sanctioned path for that, not a waiver past an open box. **Never verified end to end:** its own milestone "verify a cold start on a clean machine" was not done, no bundle has been built or handed over by this session, `run.ps1` has never been syntax-checked or run on Windows (the platform most recipients use), and `--publish` has never been exercised. Item: [`planning/Roadmap/completed/RM-19-release/`](./planning/Roadmap/completed/RM-19-release/). |
| **Overview → Detail (Servers · Skills · Collections) — a real overview page in place of the 288px master-detail rail** | ✅ Built (all 6 WPs, Phases 1–3) — a generic **`EntityBrowser`** kit (grouping, search, grid ⇄ table with persisted view mode, the card recipe) plus a **`BreadcrumbEntitySwitcher`** (the breadcrumb leaf becomes a searchable, grouped entity popover), built once and used three times. Servers, Skills and Collections each gained an overview route and a **full-width, de-railed** detail page; `ServerRail`/`SkillRail` and the collections rail are deleted, and `AppShell.secondaryContent`/`secondaryTitle` plus the mobile Sheet branch are removed with them. Ledger: [`STATUS.md`](./planning/Roadmap/RM-32-overview-detail/STATUS.md) — authoritative. **Owner-acceptance pending (8 boxes — this is what blocks retirement)**: `/servers` cold-load shows the grid with **no redirect**, the grid⇄table toggle and `?view=` survive a reload, search + zero-match Clear, card→full-width detail, the breadcrumb popover navigating, a keyboard-only pass with one tab stop per card, the same walk on `/skills` + `/testing/collections`, and the layout below 768px. |
| **Estimator turn model — the run-plan preview calibrated against measured run history** | ✅ **Built — all 4 WPs done 2026-08-21**, and it concluded that the estimator is *still wrong* on a second axis (see below) — the run-plan estimator assumed fixed 1/3/8 turns and a flat 350 output tokens per turn. Measured on the owner's own database: completed runs have a **median of 6 turns and a p90 of 16** against a hard ceiling of 8, and produce a mean of **1,148** output tokens per turn against the assumed 350 — so a real 19-turn run could not be reproduced at any price. Built: a shared turn-profile contract + a **completed-runs-only** percentile query over `runs.turns` and output-tokens-per-turn (WP 1.1); the pure estimator consuming a measured profile per environment, keyed narrowest-first (environment+test → environment → global) with the static constants as the only fallback, `maxTurns` clamping kept, and the **turn basis reported on the wire** (WP 1.2); the launcher and suite preview showing that basis and its sample size (WP 1.3). **WP 2.1 ✅** — re-measured live against recorded runs (isolated DB copy; the real `data/app.sqlite` untouched, md5 confirmed unchanged by the orchestrator). **The chartered defect is CLOSED:** RM-33's reference run (19 turns, 966,904 gross, $0.7985 billed) now falls **inside** the token band, where the pre-RM-34 band topped out 1.86× below it; the band brackets **93–96%** of real runs' turn counts against 49–61% for the old constants. Every basis was observed on the wire (`pair` · `environment` · `global` · `default`), the D-ET1/D-ET2 fallback confirmed **both** ways, and contamination answered per run by leave-one-out. **But the money half got WORSE, and that is stated on the front page rather than smoothed over:** on the most-measured pair the dollar band's floor now sits above what **27 of 28** real runs cost, where the old band contained 19. **Why — proven, and separated from hypothesis by an adversarial second review:** the estimator charges `turns × (footprintTokens + systemPromptTokens)` unconditionally (`apps/api/src/estimate/estimate.ts:148–153`), its own header states its premise as *"eager tool loading"* (`:8`), and **`tool_loading_mode` is not an input it ever sees** — zero occurrences anywhere in `apps/api/src/estimate/`. So it is mode-blind **by construction**, and least-squares fits over the real samples put the slope close (0.77×–1.33×) but the **intercept 93k–175k tokens too high, always upward**. The reviewer **refuted** three tempting explanations — a turn-counting mismatch, conversation-growth convexity, and the original author's own "live context peaked at 27–34k" support, which is circular because `accounting.ts` sets `toolDefs = 0` in deferred mode by construction (`:362`, `:651`) — and noted the effective mode is never persisted (`run-service.ts:1389–1392` silently downgrades `deferred`→`eager` unless the model supports tool search). **The follow-up must therefore measure per-turn billed input directly from `run_steps` before assuming a cause.** Ledger: [`STATUS.md`](./planning/Roadmap/RM-34-estimator-turn-model-calibrate/STATUS.md) — **now at zero open CHECKBOXES — but do NOT read that as retirable.** Its Owner-acceptance section carries three live items as *prose*: the owner judgement call on option (c) (which breaks RM-33's `no cachedInPer1M ⇒ low === high` acceptance), the follow-up work package for the unmodelled intercept, and two hand walks never done (a keyboard pass over the launcher estimate block, and a real-value two-theme look at the **suite run-confirm** and **fork dialog** basis lines — only the launcher was re-walked live). `/complete-roadmap` reads checkboxes only, so it would not refuse — the same trap that made RM-13 look retirable. The two remaining estimator defects belong to a NEW item, not this one. Ledger: [`STATUS.md`](./planning/Roadmap/RM-34-estimator-turn-model-calibrate/STATUS.md) — authoritative. Origin: [`RM-33`](./planning/Roadmap/completed/RM-33-cache-aware-token-accounting/STATUS.md)'s live acceptance call, where the band bracketed a real run at $0.42–$1.59 against $0.80 billed. |
| **Team server — shared-instance operation (local-account auth via scrypt, roles admin/editor/viewer, append-only audit log, backup/restore + retention UI; OIDC owner-gated)** | 🔜 Planned, MEDIUM (after `planning/Roadmap/RM-08-ci/` Phase 1) — plan at [`planning/Roadmap/RM-25-team-server/`](./planning/Roadmap/RM-25-team-server/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-25-team-server/STATUS.md)); revises the earlier "single-owner local" scope note; multi-tenancy stays a non-goal |
| **Platform hardening — first-run demo seed, in-app docs + changelog, redacted diagnostics bundle, migration upgrade-test harness, fleet-scale performance budgets, owner-acceptance consolidation** | 🔜 Planned, MEDIUM (rolling) — plan at [`planning/Roadmap/RM-18-platform/`](./planning/Roadmap/RM-18-platform/) (ledger: [`STATUS.md`](./planning/Roadmap/RM-18-platform/STATUS.md)) |

When you pick up work, check this table first so you build toward the north star rather than
re-cementing the old MVP boundary. Per-WP in-flight status lives in the
[`planning/Roadmap/*/STATUS.md`](./planning/Roadmap/) ledgers (authoritative); this table only summarizes.

### Testing feature (run engine + console)

A separate, executable workstream lives under [`planning/Roadmap/RM-26-testing/`](./planning/Roadmap/RM-26-testing/): a Dockerized
**Testing console** that drives MCP servers through a real LLM agent loop (Vercel AI SDK +
`@ai-sdk/*`), measuring token/context cost, cost (estimated), and guardrails per run. **Phases 0–3
(the headless run engine + full API + the web console) are built and behind the gate**, as is
**Phase 5 (MCP × model compatibility)**; **Phase 4 (hardening) is built except owner visual/a11y
acceptance (WP 4.1) and end-to-end verification (WP 4.4).** The run console is a deep-linkable route
(`/testing/runs/:runId`). The plan and its live, authoritative state are the
[`planning/Roadmap/RM-26-testing/STATUS.md`](./planning/Roadmap/RM-26-testing/STATUS.md) ledger (driven by `/next-wp testing`),
with shared rules in [`planning/Roadmap/RM-26-testing/conventions.md`](./planning/Roadmap/RM-26-testing/conventions.md). Provider
API keys are entered in the UI and stored **encrypted in the DB** (no env-var fallback); per-model
pricing is maintained in code at `apps/api/src/providers/pricing.ts`.

### Skills registry & inspector

A **Skills** capability lives under [`planning/Roadmap/RM-24-skills/`](./planning/Roadmap/RM-24-skills/): register an
[Agent Skill](https://agentskills.io) (upload a `.zip`/lone `SKILL.md` **or** import a GitHub repo),
**version** it, **pull the latest** from GitHub as a new version, and inspect the rendered
`SKILL.md`, its **L1/L2/L3 token footprint**, a **security surface** (script files + languages,
network references, file + byte totals), a full file explorer, the version list, and a **full-tree
diff** between any two versions. **Phase 1 (the registry + inspector) is built and behind the gate**
(API `apps/api/src/skills/*`, `/api/skills*` routes; web `apps/web/src/features/skills/*`). **Phase 2
— attaching skills to test scenarios (auto-latest / pinned version, optional eager inline) — is also
built** (`scenario_skills`; `planning/Roadmap/RM-24-skills/phase-2-attachment/`).
Ingestion enforces env-configurable size/zip-bomb caps (`SKILL_MAX_FILE_BYTES` /
`SKILL_MAX_TOTAL_BYTES` / `SKILL_MAX_FILES`, see §7) on **both** the upload and GitHub paths; skill
content is stored but **never executed** (including when a skill is attached to a scenario — its
files are exposed to the agent read-only and metered, never run). The plan + live, authoritative
state are the [`planning/Roadmap/RM-24-skills/STATUS.md`](./planning/Roadmap/RM-24-skills/STATUS.md) ledger with shared rules in
[`planning/Roadmap/RM-24-skills/conventions.md`](./planning/Roadmap/RM-24-skills/conventions.md).

---

## 2. Repository layout

The repository (`elabs-ai-workbench`) **is** the project root — `CLAUDE.md`, `.claude/`,
`package.json` and `pnpm-workspace.yaml` all live at the top level. (Older documents describe a
`mcp-token-footprint/` subfolder holding the app; that folder no longer exists, and every path in
this file is relative to the repository root. The npm package scope is still
`@mcp-token-footprint/*` — the scope kept the original name, the directory did not.)

```
elabs-ai-workbench/
├── apps/
│   ├── api/        Fastify API: DB, MCP client, token counting, scans, OAuth, reports, static serving
│   ├── cli/        `mcpfp` — a thin HTTP client of a RUNNING api (no DB, no MCP, no secrets)
│   └── web/        React 19 + Vite SPA (the UI)
├── packages/
│   └── shared/     Cross-cutting types, zod schemas, constants (the API contract)
├── planning/       The Open Knowledge Format planning bundle (see §11) — the ONLY home for
│   │               research, roadmap and guide documents
│   ├── Research/   RS-NN-slug investigations (sources / notes / outputs)
│   ├── Roadmap/    RM-NN-slug initiatives, each with its own STATUS.md ledger;
│   │               finished ones live in Roadmap/completed/
│   ├── user-guide/ DC-NN-slug documentation subjects — the delivery record (doc.md)
│   │               plus that part of the user-facing guide
│   ├── .claude/    okf.py, hooks, templates, commands, the profile, the tag registry
│   └── tools/      doc-intake helpers (no Markdown allowed here)
├── data/           SQLite database + generated secret key (git-ignored at runtime)
├── Dockerfile, docker-compose.yml
└── .claude/        Rules, commands, hooks, settings for agents working here
```

Package names are scoped `@mcp-token-footprint/{api,cli,web,shared}` and wired with `workspace:*`.

---

## 3. Tech stack (ground truth — do not assume otherwise)

- **Package manager: pnpm** (`pnpm@9.15.4`), workspaces. **Not npm, not yarn.**
- **Language:** TypeScript, ESM (`"type": "module"`, `NodeNext`), strict mode +
  `noUncheckedIndexedAccess`.
- **API:** Fastify 5, `better-sqlite3`, `@modelcontextprotocol/sdk`, `zod`, `pino`, `nanoid`.
- **Web:** React **19**, Vite 6, `lucide-react`, **`react-router-dom` v7** — navigation is real URL
  routing (deep-linkable routes + breadcrumbs; `<Routes>`/`<Route>` in `apps/web/src/App.tsx`, e.g.
  the run console at `/testing/runs/:runId`, Settings and reports as routes). Server/UI state is
  still `useState` + `localStorage` + `fetch`; no Redux/Zustand/React Query.
- **UI / styling:** the upstream **`@elabs-ai/components-*` design system** (brand-ui `^4.0.0`, Radix +
  CVA), installed from **public npm** (lockstep versions, anonymous install — no registry config, no
  token). **Tailwind v4** (`@tailwindcss/vite`) with semantic **oklch tokens** from
  `@elabs-ai/components-tokens`. `cn()` from `@elabs-ai/components-ui`. Peers the app owns itself
  because each holds a global/context: `monaco-editor`, `@xyflow/react`, `ai` (^6), `tailwindcss`.
  See §8.
- **CLI (`apps/cli`, the `mcpfp` bin):** a **client only** — its single runtime dependency is
  `@mcp-token-footprint/shared`. Arg parsing is `node:util`'s `parseArgs`, HTTP is global `fetch`;
  **no MCP SDK, no `better-sqlite3`, no token counting, no `apps/api` import** (a test reads the
  manifest and scans every import to keep it that way). It talks to a running API over HTTP and
  formats what comes back.
- **Persistence:** one SQLite file at `data/app.sqlite` (`/data/app.sqlite` in Docker).
- **Deploy target:** one Docker container listening on **8080** internally, published on host port
  **8081** (API serves the built web SPA). A separate, older checkout runs its own container on
  8080 — see the note at the top of `docker-compose.yml`.

There is **no Tauri** and no ESLint; linting/formatting is **Biome** (`biome.json`) via `pnpm lint`
(`biome check`) and `pnpm format` (`biome format --write`). (Note: the **only** workflow in this
repo is `.github/workflows/mcp-self-scan.yml`, the D-MCP5 dogfood gate added by ci WP M.4 — there is
no `ci.yml`, so the four-command quality gate is still run **locally** wherever this file or
`.claude/rules/quality-gates.md` says otherwise.) `@elabs-ai/components-cli` is a root
devDependency — run `pnpm exec brand-ui <cmd>` (`info`/`search`/`docs`/`audit`) for the **real**
component API, never memory; the same engine is registered as an MCP server in `.mcp.json`, and a
generated snapshot lives at `docs/brand-ui-context.md`. The old hand-rolled `packages/brand-ui`
adapter has been **removed** (it was retired and unused; the `enforce-brand-ui` hook still blocks any
`@mcp-token-footprint/brand-ui` import).

---

## 4. Commands

Run everything from `mcp-token-footprint/`.

```bash
pnpm install                 # install workspace deps
pnpm dev                     # build shared, then run API (:8080) + web (:5173) in parallel
pnpm dev:api                 # API only
pnpm dev:web                 # web only (Vite proxies /api → :8080)
pnpm build                   # build all packages (tsc + vite build)
pnpm start                   # run the built API (serves the web build) — node apps/api/dist/index.js
pnpm typecheck               # tsc --noEmit across all packages
pnpm test                    # API tests (node test runner via tsx) + web tests (vitest; 97 files)
pnpm lint                    # Biome lint (biome check --formatter-enabled=false)
pnpm format                  # Biome formatter (biome format --write)
pnpm mcpfp <command>         # the `mcpfp` CLI against a RUNNING api (see planning/user-guide/DC-18-mcpfp-cli/22-mcpfp-cli.md)
docker compose up --build    # production-style single container at http://localhost:8081
```

**Quality gate / definition of done:** `pnpm typecheck && pnpm test && pnpm build` must pass, and
`pnpm lint` must be clean. This gate is run **locally** — no workflow runs it (see §3). See
[`.claude/rules/quality-gates.md`](./.claude/rules/quality-gates.md) and the `/quality` command.

Dev URLs: API `http://127.0.0.1:8080`, Vite `http://127.0.0.1:5173`. The containerized instance is
at `http://localhost:8081/`.

**`pnpm mcpfp` is a dev convenience, not the CI invocation.** pnpm prints its own banner on
**stdout**, which breaks `--format json > file`; `pnpm --silent` fixes that but makes pnpm collapse
every non-zero exit to **1** — the code D-C7 reserves for assertion failures. In a script, run
`pnpm build` once and call `node apps/cli/dist/index.js …`, which has clean stdout and honest exit
codes. Both are documented in [`planning/user-guide/DC-18-mcpfp-cli/22-mcpfp-cli.md`](./planning/user-guide/DC-18-mcpfp-cli/22-mcpfp-cli.md).

---

## 5. Architecture

```
Browser SPA (apps/web)
   │  fetch /api/*   (apps/web/src/lib/api.ts)
   ▼
Fastify API (apps/api)
   │  better-sqlite3
   ▼
data/app.sqlite
   │  MCP SDK: child process (stdio) or HTTP client (streamable_http)
   ▼
MCP servers
```

**Runtime boundary (important):** the **API is the only process** that spawns MCP stdio
commands, performs HTTP MCP calls, or reads decrypted secrets. The web UI only ever receives
**redacted** server configs (`hasEnvSecrets`/`hasHeaderSecrets` booleans, never the values).
Keep it that way — see [`.claude/rules/mcp-and-security.md`](./.claude/rules/mcp-and-security.md).

**Package boundaries:**
- `apps/web` owns screen composition, local UI state, URL routing (`react-router-dom` — routes,
  breadcrumbs, deep links; the run console is the route `/testing/runs/:runId`), and API calls. No
  DB, no MCP, no secrets.
- `apps/api` owns DB, MCP connections, token counting, scan orchestration, and serves the web
  build in production.
- `packages/shared` owns the API contract: `types.ts`, `schemas.ts` (zod), `constants.ts`. Both
  sides import from here — **change a request/response shape here first**, then both ends.

**API conventions:** versionless `/api` routes for now; additive response fields only during the
MVP. A breaking change graduates to `/api/v2`. Structured Fastify logging; errors flow through
the central error handler (`ZodError` → 400; otherwise `statusCode` or 500).

---

## 6. API surface (current)

**Source of truth is `apps/api/src/**/routes.ts`** (each feature registers its own `routes.ts`,
wired from `apps/api/src/index.ts`); the wire contract is `packages/shared` (`types.ts` +
`schemas.ts`). Rather than enumerate every path here (it drifts), the endpoint **families** are:

- **Servers & scans** (`servers/`, `scans/`) — server CRUD + URL-first `POST /api/servers/probe`,
  `POST /api/servers/:id/{scan,test,connectivity}`, tool playground
  `POST /api/servers/:id/tools/:toolName/call` (runtime token cost), resource/prompt reads
  (`/resources/read`, `/prompts/:name/get`), scan list/detail, `DELETE /api/scans/:id`.
- **Reports** (`reports/`) — scan, server, and **run** JSON/Markdown export.
- **Compare** (`compare/`) — `GET /api/compare` cross-server/tool-level scan diff (exact→normalized→fuzzy).
- **OAuth** (`oauth/`) — start / status / callback for streamable-HTTP auth.
- **Providers** (`providers/`) — encrypted provider-credential CRUD + `:id/models` (Testing).
- **Testing** (`testing/`) — scenario/test CRUD (+ attachments), `POST /api/runs`, SSE
  `GET /api/runs/:id/stream`, `:id/{turns,stop}`, `DELETE /api/runs/:id`, `GET /api/runs/compare`.
- **Skills** (`skills/`) — register/version/pull/inspect/diff/export (`/api/skills*`).
- **Compatibility** (`compatibility/`) — `GET /api/scans/:id/heatmap`, `/api/compatibility/models`,
  `POST /api/runs/:runId/compatibility`, per-scan tests/findings.
- **Assertions** (`assertions/`) — `POST /api/assertions/evaluate`: evaluate a versioned
  `mcpfp.assert.json` (contract in `packages/shared/src/ci-assertions.ts`) against an
  **already-persisted** scan and return an itemized `AssertionReport`. Read-only — **it never runs a
  scan** (D-C9; scanning is `mcpfp scan`, and a CI job chains the two so `1` = "the gate said no"
  stays distinct from `2` = "the gate could not run"). Every baseline question re-projects
  `compare/service.ts`'s `buildComparison` (D-MCP4) rather than adding a second differ, and a
  `deltasComparable === false` pair is a **400**, never a suppressed-to-zero pass (D-C8). No
  migration, no feature flag. Consumed by `mcpfp assert`; see
  [`planning/user-guide/DC-18-mcpfp-cli/22-mcpfp-cli.md`](./planning/user-guide/DC-18-mcpfp-cli/22-mcpfp-cli.md).
- **Estimate** (`estimate/`) — `POST /api/estimate/run-plan` for additive cost previews and context warnings.
- **Grading** (`grading/`) — LLM judge settings/resolution, run/suite auto-rating, rating-issue persistence.
- **Collections** (`collections/`) — collection CRUD + git-binding + membership write/read.
- **Suites & run-plans** (`suites/`) — suite CRUD + mass-run orchestration, `POST /api/run-plans` as the unified run engine.
- **SkillFlow** (`skillflow/`) — `POST /api/skillflow/{project,apply}-preview`, graph projection, versioned edits.
- **Assistant** (`assistant/`) — session engine + 23 read tools + write-permission protocol, workspace sync.
- **Features** (`features/`) — `GET`/`PUT /api/features` (Settings › Features feature flags) plus the
  root `onRequest` guard that 403s (`code: "feature_disabled"`) every request owned by a switched-off
  feature.
- **Workbench MCP server** (`mcp-server/`) — `POST /api/mcp`, the app's OWN MCP mount
  (stateless streamable HTTP; `GET`/`DELETE` answer 405), plus `GET /api/mcp/llms.txt`, the
  agent-onboarding usage doc **generated from the registered surface** (never hand-written — see
  `mcp-server/llms-txt.ts`). Contract in `packages/shared/src/workbench-mcp.ts`; feature-flagged by
  `mcp_server` (the flag's `/api/mcp` prefix covers the doc too). Owner-facing walkthrough:
  [`planning/user-guide/DC-16-workbench-mcp-server/20-workbench-mcp-server.md`](./planning/user-guide/DC-16-workbench-mcp-server/20-workbench-mcp-server.md); the dogfood
  gate is `pnpm mcp:self-scan` (`mcp-server/self-scan.ts`). **Scopes (WP M.2):** a *tokenless
  loopback* caller reaches everything, exactly as before (D-MCP7 — the mount gets no stricter rule
  than the API it is mounted on; `API_AUTH_REQUIRED=true` is the one switch that changes it, for the
  whole API). A *token-authenticated* caller needs **`read` just to open the mount**
  (`API_TOKEN_ROUTE_SCOPES`, D-MCP8 — `initialize`/`tools/list` are reads), and then each tool's own
  scope from `WORKBENCH_MCP_TOOL_SCOPES` (all `read` today), enforced at dispatch in
  `mcp-server/server.ts` as a readable `isError` result naming the missing scope, with one audit line
  per tool call carrying the token's **display prefix** (never the credential).
- **Tokens** (`api-tokens/`) — service-token CRUD for headless callers: `GET`/`POST /api/tokens`,
  `DELETE /api/tokens/:id` (the plaintext is returned **once**, from the create response, and never
  again). Plus the root `onRequest` **guard** that authenticates a presented `Authorization: Bearer
  mcpfp_…`, enforces "loopback open · remote requires a token" (D-C2, `API_AUTH_REQUIRED` forces it
  on loopback too), and scope-checks a token-authenticated request — `API_TOKEN_ROUTE_SCOPES` first
  (WP M.2: `POST /api/mcp` and `POST /api/assertions/evaluate` need only `read`, since both are reads
  that travel in a POST body), then the coarse `requiredScopesForMethod` rule; deletes and token CRUD
  are refused to any token. A route rule can only ever **relax**, cannot express a `DELETE` (the type
  has no such member), and is matched on the raw-**and**-decoded path *intersection* — the opposite of
  the inclusive union used to decide what is governed (D-MCP9, `utils/request-path.ts`). Contract in
  `packages/shared/src/api-tokens.ts`; **no feature flag** (an off-switch on an auth check is a
  foot-gun). See §7 and
  [`planning/user-guide/DC-17-service-tokens/21-service-tokens.md`](./planning/user-guide/DC-17-service-tokens/21-service-tokens.md).
- **Maintenance** (`db/maintenance.ts`) — `POST /api/maintenance/{checkpoint,vacuum,prune-scans,prune-assistant}`.
- **Health** — `GET /api/health`.

Any wire change goes **types + zod in `packages/shared` first**, then API, then web. Versionless
`/api` for now; additive response fields only (a breaking change graduates to `/api/v2`).

---

## 7. Data, token counting, and secrets

**Data model — source of truth is `apps/api/src/db/schema.ts`** (`planning/user-guide/DC-21-architecture/03-data-model.md` is the
original MVP subset and is now partial). The schema is applied through **versioned migrations gated
by `PRAGMA user_version`** (`apps/api/src/db/database.ts`; a pre-versioning DB is brought forward,
a fresh DB is stamped at `LATEST_SCHEMA_VERSION`). Current tables span: MCP scans (`mcp_servers`,
`mcp_oauth_credentials`, `mcp_oauth_flows`, `mcp_scans`, `mcp_tool_scans`, **`mcp_resource_scans`**,
**`mcp_prompt_scans`**, `scan_events`); Testing (`provider_credentials`, `scenarios`,
`scenario_servers`, `tests`, `test_attachments`, `runs`, `run_steps`, `run_events`); and Skills
(`skills`, `skill_versions`, `skill_blobs`, `skill_files`, `scenario_skills`). Read `schema.ts`
before assuming a column exists.

**Token counting** (`apps/api/src/token-counting/`): a `TokenCounter` interface with **four**
profiles — two **real `js-tiktoken` BPE** encodings, `generic_o200k` (default) and `generic_cl100k`
(rank data bundled, offline/accurate), and two heuristics named so nothing carrying a real-encoding
name uses an estimate: `generic_estimate` (lexical/byte-ratio) and `raw_json_rough` (bytes/4). A
tool's token total is the count of its **serialized provider payload** (the JSON envelope actually
sent to a model), not the sum of isolated name/description/schema facets; raw bytes come from stable
JSON serialization; `contributionPercent = tool_tokens / scan_total * 100`. Every scan is stamped
with a `counting_version` (`TOKEN_COUNTING_VERSION`, currently **2**) so scans produced under
different counting methods aren't silently compared, and cross-profile compare deltas are guarded.
New profiles/provider adapters go **behind the `TokenCounter` interface** without changing
persistence or UI contracts. See `planning/Research/RS-09-token-counting-strategy/outputs/token-counting-strategy.md`.

**Secrets** (`apps/api/src/secrets/`, `oauth/`): MCP env/header secrets and OAuth tokens are
**encrypted before SQLite persistence** and **never returned** by the API. The key is
`MCP_SECRET_KEY` (base64 32-byte) or an auto-generated `DATA_DIR/mcp-secret.key`. Losing both
makes stored secrets unrecoverable. Plaintext rows are migrated to encrypted on startup. Full
rules in [`.claude/rules/mcp-and-security.md`](./.claude/rules/mcp-and-security.md).

**Environment** (`apps/api/src/config/env.ts`, template in `.env.example`): `HOST`, `PORT`
(8080), `DATA_DIR`, `DATABASE_PATH`, `DEFAULT_TOKEN_PROFILE`, `MCP_SECRET_KEY[_PATH]`,
`OAUTH_REDIRECT_URL`, `WEB_DIST_PATH`, `DOCKER_MODE`, `SCAN_RETENTION_PER_SERVER` (0 = keep all;
otherwise prune to N newest scans per server), and the Skills ingest caps
`SKILL_MAX_FILE_BYTES` / `SKILL_MAX_TOTAL_BYTES` / `SKILL_MAX_FILES` (optional; each falls back to
its shared-constant default and is enforced on both skill ingestion paths — the zip-bomb guard), plus
**`API_AUTH_REQUIRED`** (service tokens, D-C2; default `false` — loopback passes without a token, so
the browser UI is unaffected; `true` requires a token on loopback too, which also makes Settings ›
API tokens unreachable, since a token may never manage tokens. A **non-loopback** request always
requires a token regardless — that is not configurable. `GET /api/health` is always exempt).
Keep real secrets in `.env.local` (never committed); only `.env.example` is tracked.

**Service tokens** (`apps/api/src/api-tokens/`): the credential a headless caller (CI, the `mcpfp`
CLI, an external agent on the MCP mount) presents instead of a browser session. A token is
`mcpfp_` + 43 base64url chars (256 bits from `node:crypto`), stored as a **SHA-256 digest** with an
8-character display prefix — the plaintext is returned **exactly once** by `POST /api/tokens` and is
never persisted, listed, or logged (an audit line may carry the **display prefix**, never the
credential). Scopes are a **frozen** tuple (D-C4) — `read` · `scan:run` · `runs:launch` ·
`suites:run`, exactly the write scopes D-MCP3 names, consumed unchanged by WP M.2/M.3; there is **no
delete scope** and a token-authenticated `DELETE` is refused outright. Mapping onto routes is
`API_TOKEN_ROUTE_SCOPES` + `requiredScopesForRoute` in `packages/shared/src/api-tokens.ts` (WP M.2) —
a table that can only ever **relax** a named route, backed by the unchanged coarse
`requiredScopesForMethod` fallback. The root `onRequest` guard (`api-tokens/guard.ts`) decides
loopback **from the socket peer, never from a header** — do not enable `trustProxy` (a test pins it
off) — and matches a *relaxing* rule on the raw-**and**-decoded path intersection while it still
decides what is *governed* on the union (D-MCP9: `requestPathEqualsStrict`/`requestPathIsUnderStrict`
vs `requestPathEquals`/`requestPathIsUnder`; swapping the two directions is a privilege escalation,
and a table in `api-tokens-guard.test.ts` goes red if you do). No feature flag: an off-switch on an
auth check is a foot-gun. Owner-facing walkthrough:
[`planning/user-guide/DC-17-service-tokens/21-service-tokens.md`](./planning/user-guide/DC-17-service-tokens/21-service-tokens.md).

---

## 8. UI & styling discipline

> **Hard rule — brand-ui only.** Every visible element comes from the `@elabs-ai/components-*` design system.
> See [`.claude/rules/brand-ui-only.md`](./.claude/rules/brand-ui-only.md) (enforced by the
> `enforce-brand-ui` hook), plus
> [`styling-and-tokens.md`](./.claude/rules/styling-and-tokens.md),
> [`library-first.md`](./.claude/rules/library-first.md), and
> [`dependencies.md`](./.claude/rules/dependencies.md).

UI primitives come from **`@elabs-ai/components-ui`** (Button, Card, MetricCard, Dialog, Wizard, Sidebar,
AppShell, EmptyState/ErrorState, Badge, Alert, Descriptions, …), tables from **`@elabs-ai/components-data`**
(`DataTable`, `SearchInput`, `FilterBar`), icons from `lucide-react` / `@elabs-ai/components-icons`, theming from
**`@elabs-ai/components-tokens`**. Styling is **Tailwind v4 + semantic oklch tokens** (`bg-card`,
`text-muted-foreground`, `border-border`, …) — **no raw hex/rgb, no palette colors** (the
`check-tokens` hook warns). `className` is layout-only; use a component's `variant`/`size` for looks.

**Two themes** are exposed — `light` (default, and the library's `DEFAULT_THEME`) and `dark` —
applied with `data-theme` on `<html>` by `ThemeProvider` and switched in Settings or the top-bar
theme menu. These are the only themes the library ships; theming is an open registry, and
`ThemeName` is `string` (not a union), so narrow with `isBuiltInThemeName` / `useTheme().themes`
rather than bare literals. **Theme CSS is opt-in per theme** — `app.css` imports
`tokens/styles.css` (engine) plus `themes/light.css` and `themes/dark.css`. New UI must read
correctly in both themes. One deliberate app-side token override lives in `app.css`: the **light**
focus ring (`--ring` / `--sidebar-ring`), because upstream's lime ring measures 1.30–1.42:1 there and
fails WCAG 2.4.7 / 1.4.11 — it is gated by tests, don't delete it (see §8 rules).

App-specific compositions of `@elabs-ai/components-*` parts live in `apps/web/src/components/` (`SelectField`,
`TokenViz`) and `apps/web/src/lib/table.tsx` (`col` helper). Code/text display uses `@elabs-ai/components-editor`
Monaco `CodeEditor` (web workers in `apps/web/src/main.tsx`) and read-only code components like
`features/testing/CodeSnippet.tsx`. When `@elabs-ai/components-*` lacks a component it's a real upstream gap —
compose from primitives or raise it; don't hand-roll. The authoritative component reference is the
CLI (`pnpm exec brand-ui docs <Component>`) / the MCP server in `.mcp.json`; if `docs` lists
anti-patterns for a component, follow them. `pnpm typecheck && pnpm test && pnpm build && pnpm lint`
are green.

---

## 9. Conventions & where things go

- **Contract-first:** new feature touching the wire → add/adjust types + zod schemas in
  `packages/shared` first, then API, then web.
- **TS files kebab-case; React components PascalCase.** Co-locate tests as `name.test.ts`.
- **Errors:** API throws typed errors with `statusCode`; the central handler formats them. UI
  surfaces failures through the toast region + error boundary — never swallow MCP/connection
  errors, never fake scan results.
- **No new runtime dependency without a reason** — prefer the existing stack. Owner approval for
  any new UI dependency or any `@elabs-ai/components-*`/brand-ui version change.
- **Honest reporting:** "done"/"green" means you actually ran `pnpm typecheck && pnpm test &&
  pnpm build`. Lead with what you did *not* verify (especially visual/UX claims — verify against
  the running app, not a mock).
- **Where a new document goes, by kind** (see §11 — nothing lands loose):
  - an investigation → a `planning/Research/RS-NN-*/` topic (`/new-research`), with raw capture in
    `sources/`, thinking in `notes/`, deliverables in `outputs/`;
  - a plan, a work-package spec, a conventions or kickoff document, a decision record → the owning
    `planning/Roadmap/RM-NN-*/` item (`/new-roadmap` if it needs a new one);
  - a manual page, or the record of what a work package actually shipped → the
    `planning/user-guide/DC-NN-*/` subject for that part of the system (`/new-docu`);
  - **never** a `README.md` inside `planning/` — `index.md` is the navigation file and is generated.

---

## 10. Map of `.claude/`

- `rules/brand-ui-only.md` — **the hard rule:** every visible element is a `@elabs-ai/components-*` component.
- `rules/architecture.md` — package boundaries, runtime boundary, API contract.
- `rules/mcp-and-security.md` — MCP connection model + secret encryption/redaction (core).
- `rules/dependencies.md` — pnpm workspace, `@elabs-ai/components-*` from public npm, the peers the app owns, Tailwind v4, the CLI as ground truth.
- `rules/library-first.md` — compose from `@elabs-ai/components-*`; when something's missing, raise the gap.
- `rules/styling-and-tokens.md` — Tailwind v4 + `@elabs-ai/components-tokens`, two themes, no raw colors.
- `rules/interaction-guidelines.md` — front-end/form hygiene (relevant to the tool-playground forms).
- `rules/icon-affordances.md` — **D-TB5:** one icon affordance — `IconButton`'s tooltip == its `aria-label` (never `title`); disabled reasons via tooltip + `aria-describedby`.
- `rules/routes-vs-dialogs.md` — **D-TB10:** anything bookmarkable/deep-linkable/shareable is a route; anything transient is a dialog; every route renders something useful with zero query params.
- `rules/assistant-operability.md` — **the hard rule:** every route/addressable view resolves to a real assistant starter surface (or a reasoned `exempt`/`redirect`) via the `ASSISTANT_ROUTE_MANIFEST`; enforced by the `assistant-route-operability` test, not a hook.
- `rules/loading-states.md` — `loading` vs `isStreaming` vs terminal-only errors (the SSE/run-console surface).
- `rules/quality-gates.md` — the real definition of done (typecheck · test · build · Biome lint).
- `commands/` — `/quality`, `/scan-server`, `/audit-brand-usage`, `/next-wp` (work-package runner;
  the canonical definition lives in the `next-wp` **skill** — the command is a thin pointer to it).
- `hooks/okf-pre.sh` — **PreToolUse:** rejects a nonconformant write inside `planning/` at the moment
  of the edit (a `README.md`, a by-hand `status: "done"` flip, a file outside its domain folder, a
  meaningful edit that leaves the `timestamp` untouched). A path outside `planning/` passes.
- `hooks/okf-post.sh` — **PostToolUse:** revalidates the whole bundle (both conformance layers) after
  a write, catching the cross-file violations a single-file check cannot see.
- The bundle's own controls live in **`planning/.claude/`**: `scripts/okf.py` (the only sanctioned
  writer for anything structural), `commands/` (`/new-research`, `/new-roadmap`, `/new-docu`,
  `/complete-roadmap`, `/doc-intake`, `/research-status`, `/sync-okf`, `/validate-okf`),
  `skills/research-intake/`, `templates/`, `okf-profile.json` and `tag-registry.json`.
- `skills/next-wp/` — the canonical `/next-wp` orchestrator (plan → parallel worktree sub-agents →
  validate → tick the `planning/Roadmap/*/STATUS.md` ledger).
- `hooks/` — `guard-secrets.mjs` (block committing secrets), `check-tokens.mjs` (warn on raw colors),
  `enforce-brand-ui.mjs` (block raw interactive HTML + retired-adapter imports in `apps/web/src`).

---

## 11. Knowledge, planning and the delivery record (HARD RULE)

All research, planning and user-facing documentation lives in **one Open Knowledge Format bundle at
[`planning/`](./planning/)**. The old loose `research/`, `roadmap/` and `user-guide/` trees no
longer exist — every document in them is now a typed concept inside a tagged folder. Read
[`planning/CLAUDE.md`](./planning/CLAUDE.md) before writing anything there.

### The lifecycle — four steps, none optional

> **Work that is not an `RM-NN` roadmap item does not get built. It is built against its own
> `STATUS.md` ledger. Its delivery is recorded in a `user-guide/DC-NN` subject. It is retired with
> `complete-roadmap`. An item is not finished until all four have happened.**

1. **Plan it** — `/new-roadmap` creates `planning/Roadmap/RM-NN-<slug>/` with an `item.md` and a
   `log.md`. Link the research it depends on by `RS-NN` tag.
2. **Build it** — against that item's `STATUS.md` ledger, normally through `/next-wp`. A work
   package is done only when the quality gate passes and its box is ticked.
3. **Document it** — `/new-docu` creates or extends a `planning/user-guide/DC-NN-<slug>/` subject.
   A subject is a **part of the system**, not a roadmap item; one item usually writes into several.
   `doc.md` records **what shipped versus what was planned** — the delivery, how it differed, where
   the code lives, and what was deliberately left out.
4. **Retire it** — `/complete-roadmap` moves the item to `Roadmap/completed/`, sets its status to
   `done`, ticks its milestones, writes a `### RM-NN` increment into each named subject, re-points
   bundle links and revalidates — all in one transaction, rolled back on any failure. It **refuses
   while any box in the item's ledger is still open.**

### The front page follows the work (HARD RULE)

When a work package's last box ticks, **in the same commit**: update the capability table in
[`README.md`](./README.md), move what the work package made real out of "planned" and into what the
app does today, correct anything the work package made false, and add a [`CHANGELOG.md`](./CHANGELOG.md)
entry. **Verify each claim against the running app or a passing test — never from the work-package
description.** A ledger box does not tick while the front page still describes software that does
not match.

### Tags

`RS-NN` research · `RM-NN` roadmap · `DC-NN` documentation. Two digits, zero-padded, allocated
atomically by the generator and **never reused** — a completed item keeps its number forever. The
tag is the primary key; reference work by tag in notes, commits and ledgers. The cross-links
between tags are the project's memory.

### Never hand-edit the bundle's structure

Create items with the generators, retire them with `complete-roadmap`, regenerate navigation with
`sync-indexes`. Never `mkdir` a tagged folder, never edit `planning/.claude/tag-registry.json`,
never move an item into `Roadmap/completed/` yourself, never set an item's status to `done` by
hand, and never create a `README.md` inside `planning/`. The `okf-pre` hook rejects all of that at
the moment of the edit; renaming a path to dodge a check is itself a violation.

### The four commands

```bash
pnpm okf:validate    # both conformance layers over the whole bundle
pnpm okf:sync        # regenerate every index.md + the master roadmap view
pnpm okf:test        # the bundle's own test suite
pnpm okf status      # the RS / RM / DC table with statuses
```

Inside a Claude session the generators are `/new-research`, `/new-roadmap`, `/new-docu` and
`/complete-roadmap` (defined in `planning/.claude/commands/`). Both conformance layers also run in
CI, in the `planning-bundle` job of `.github/workflows/mcp-self-scan.yml`.
