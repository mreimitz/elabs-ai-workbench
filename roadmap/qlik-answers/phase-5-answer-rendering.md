# Phase 5 — Answer rendering rework (chat fidelity for `qlik_answers` runs)

> **Why:** the first real Qlik Answers session (run `hHGgqkU58F_xYv0e-nHKC`, test `barc-flights`,
> env `BARC-ontime`, 2026-07-11, analyzed in-browser + against the raw step payload 2026-07-12)
> proved the console **inverts the source data's value**: the richest content (structured pipeline
> trace + full formatted drafts) is buried in the collapsed "Thought process", the visible answer is
> 6 flat citation-stripped paragraphs, and the real analytical evidence (5 hypercubes with actual
> data) is discarded down to monospace expression strings. Phases 0–4 got the **wire** right; this
> phase gets the **rendering** right. Ledger: [`STATUS.md`](./STATUS.md) §Phase 5.

## Evidence (what the payload actually carries vs. what renders)

`GET /api/runs/hHGgqkU58F_xYv0e-nHKC` → `steps[1]` (`llm_response`, the answer step):

| Payload field | Contents | What renders today |
| --- | --- | --- |
| `rawResponse` (134 KB) | The full Adaptive Card: `content[0].card.body[]` = `"Conclusion"` TextBlock → **interleaved sequence** of 6 narrative TextBlocks each followed by a `Qlik.Snapshot`, then an ActionSet ("View source") + hidden details Container | Nothing (lossless capture only) |
| TextBlocks | Carry `<citation data-index="N">n</citation>` markers tying each claim to its snapshot | Citations **stripped** by `qlik-answers-message.ts` `stripCitations()` |
| `Qlik.Snapshot` × 5 | **Real hypercube data** (`qHyperCube.qDataPages[].qMatrix` with `qText`/`qNum`): a 1×1 KPI (13.4869 % market share), 20×4, 20×2, 15×2, 20×3 carrier matrices; plus `source.measures/dimensions/reason/appId` | Only `title`/`reason`/expressions as wrapped `Text variant="code"` lines (`SourcesPanel` `InsightsList`) — the data never renders |
| `assistantText` (2.2 KB) | Post-"Conclusion" TextBlocks flattened with `\n\n` | The visible answer: 6 flat paragraphs, no headers, no data, no citations |
| `reasoning` (11.6 KB) | The whole agentic stream: numbered pipeline (Understanding → Current Primary Subject → Rewritten Question), "Search Findings" (keywords + master measures/dimensions/fields **with similarity scores + glossary matches**), a classification line, **and two full markdown draft answers with tables** whose tail duplicates `assistantText` | Dumped verbatim into one collapsed `Reasoning` block — expanded, the thought process looks better than the answer, and the answer paragraphs appear twice |
| `questionsConsumed: 1` | The first-class cost unit (D-QA5) | KPI rail shows "Est. cost $0.00" and "Tool calls 0"; no Questions KPI on the Chat rail; the context-window card promises a "turn-0 baseline" that never comes for this kind |

## Proposed decisions (defaults locked unless the owner overrides at kickoff)

| # | Decision |
| --- | --- |
| **D-QA8** | **The answer renders as the ordered card-block sequence, not a flattened string.** A typed `blocks[]` (`text` \| `snapshot` refs) is **derived** from the persisted `rawResponse` — server-side, both at event-emit time and at replay read (`GET /api/runs/:id`) — so legacy runs get the new rendering with **no migration and no persistence change**. `assistantText` stays exactly as today: **the grader contract is untouched** (answer graders + Auto-Rating read `assistantText`; nothing about grading changes in this phase). |
| **D-QA9** | **Citations become footnote chips, not stripped text.** `<citation data-index="N">` markers are extracted per text block (`citations: number[]`, index = snapshot order) and rendered as superscript chips that anchor-scroll to the matching insight (reuse the `consoleAnchor` pattern from WP 3.2 of ux-overhaul). `assistantText` remains citation-stripped (grader input stability). |
| **D-QA10** | **Hypercube data is surfaced, capped.** `AnswersSnapshot` gains optional `data` (`columns: string[]` from `qDimensionInfo`/`qMeasureInfo` labels, `rows: (string \| number)[][]` from `qMatrix`, row cap **50**, `totalRows` for the honest "showing N of M"). Rendering: 1×1 → `MetricCard`; everything else → compact `DataTable` (or `Table*`) inset. Charts are a later nicety, not v1 of this phase. |
| **D-QA11** | **Reasoning is structured and deduped.** A pure parser (`qlik-answers-reasoning.ts`) splits the stream into recognized phases (Understanding · Rewritten question · Asset search · Classification · Draft); the similarity-scored asset lists become tabular data (`asset · type · similarity · glossary match`); draft-answer text that substantially duplicates the final `assistantText` is folded into a collapsed "Draft" disclosure (never shown twice). Unrecognized content falls back to today's verbatim markdown — **never drop text on a parse miss**. |
| **D-QA12** | **Kind-aware KPI rail.** For `qlik_answers`: "Tool calls" → **"Questions"** (sum of `questionsConsumed`); the cost tile counts questions first (€ only when priced per D-QA5); the context-window card is replaced by an assistant-identity card (assistant/app id, thread mode, transport) instead of a permanently unfulfilled "No context yet" empty state. Non-qlik runs render byte-identically to today. |
| **D-QA13** | **Insights show data first, definitions second.** Each insight row's face is its data (`MetricCard`/mini table per D-QA10) + `reason`; the Qlik set-analysis expressions demote to a collapsed per-insight "Definition" disclosure. Expressions stay in the payload and the report export (they are the evidence trail). |

Naming rule unchanged: kind `qlik_answers`, module prefix `qlik-answers-`, never bare "assistant".

## The seams (verified in-code, 2026-07-12)

- `apps/api/src/testing/qlik-answers-message.ts` — `extractAnswerMessage`/`cardAnswer`/
  `collectSnapshots`/`stripCitations` (the flattener to rework; pure + unit-tested, no network).
- `apps/api/src/testing/qlik-answers-executor.ts` — builds the `llm_response` payload (attach the
  derived blocks/data here for live events).
- `GET /api/runs/:id` replay read — the legacy-run derivation point (blocks computed from the
  step's persisted `rawResponse` when absent).
- `packages/shared` — `AnswersStepPayload`/`AnswersSnapshot` + `answersStepPayloadSchema`
  (WP 0.1/4.3 precedents; **additive only**).
- `apps/web/src/features/testing/ConversationPane.tsx` `AssistantTurn` — reasoning collapsible +
  prose `ChatMarkdown` + `SourcesPanel` mount (the render seam).
- `apps/web/src/features/testing/SourcesPanel.tsx` — `InsightsList`/`InsightRow`/`ExprLine`.
- `apps/web/src/features/testing/KpiRail.tsx` — already kind-aware since WP 3.2 (`providerKind`
  prop plumbed via `RunConsoleRoute`); extend, don't re-plumb.
- `apps/api/src/reports/reports.ts` — run report export (markdown/JSON parity for blocks/data).
- ⚠️ `run-repository.ts` redaction: keys matching `…Tokens` get stripped/redacted on persist (the
  WP 3.1 `promptMode` lesson) — name new payload fields to survive it, and never rely on a field
  that redaction rewrites.

## Work packages

### Batch 1 (solo — touches `packages/shared`)
- **WP 5.1 — shared contract:** `AnswersAnswerBlock` union (`{ kind: "text", markdown,
  citations?: number[] }` \| `{ kind: "snapshot", index }`), `AnswersStepPayload.blocks?`,
  `AnswersSnapshot.data?` (`columns`, `rows`, `totalRows?`) + `title?` already exists; zod
  (`answersAnswerBlockSchema`, extend `answersStepPayloadSchema`); additive, wire-frozen elsewhere.
  *Acceptance:* typecheck green across packages; zod round-trips the run-`hHGgqkU…`-shaped fixture.

### Batch 2 (parallel)
- **WP 5.2 — API extraction rework:** in `qlik-answers-message.ts`, an ordered card-body walk
  producing `blocks[]` (text blocks keep per-block `citations[]`; snapshot blocks reference the
  snapshot array by index — same tree order as `collectSnapshots`); hypercube extraction into
  `AnswersSnapshot.data` (labels from `qDimensionInfo[].qFallbackTitle`/`qMeasureInfo[]
  .qFallbackTitle`, rows from `qDataPages[0].qMatrix` `qText`/`qNum`, cap 50 + `totalRows`); new
  pure `qlik-answers-reasoning.ts` phase parser per D-QA11 (typed `ReasoningSection[]`, verbatim
  fallback). Executor attaches blocks/data to the live payload; the replay read derives them for
  legacy steps (D-QA8). Fixtures cut from the real run's `rawResponse` (redact nothing — it holds
  no secrets — but trim to representative size). `assistantText`/`reasoning` outputs byte-identical
  to today (grader + existing-test stability).
  *Acceptance:* new unit tests for blocks/citations/hypercube/phases; every pre-existing
  `qlik-answers-*` test green unchanged; a replay-derivation test on a legacy-shaped step.
- **WP 5.5 — kind-aware KPI rail + console chrome (web):** Questions KPI replaces Tool calls for
  the kind; cost tile counts questions (€ when priced); context-window card → assistant-identity
  card (D-QA12); remove the "No context yet" turn-0 hint for the kind. Uses the existing
  `providerKind` plumbing (WP 3.2) — no new prop drilling. Non-qlik rails proven unchanged.
  *Acceptance:* web unit tests for the kind-switch (the repo HAS a web test runner — see the
  WP 3.2 gap note); both-theme walk = owner-acceptance.

### Batch 3 (parallel — both consume WP 5.1/5.2)
- **WP 5.3 — answer renderer (web):** `AnswersAnswerView` (new, `features/testing/`) rendering
  `blocks[]`: text → `ChatMarkdown`; snapshot refs → `MetricCard` (1×1) / compact `DataTable`
  inset at their card position; citation chips per D-QA9 anchor-scrolling to the insight; falls
  back to today's `ChatMarkdown(assistantText)` when `blocks` is absent (non-qlik runs and any
  extraction miss render exactly as before). Copy action still copies `assistantText`. brand-ui
  only, both themes, `tabular-nums` on all data cells.
- **WP 5.4 — insights + reasoning rework (web):** `InsightRow` face = data (D-QA10/D-QA13) +
  reason, expressions in a per-insight collapsed "Definition"; reasoning renders
  `ReasoningSection[]` as structured sections (asset search as a compact table, Draft as a
  collapsed disclosure, dedupe per D-QA11) inside the existing `Reasoning` collapsible, verbatim
  fallback preserved.
  *Acceptance (both):* web tests for block/section rendering + fallbacks; no regression on
  non-qlik runs (existing ConversationPane tests green); visual/keyboard walks = owner-acceptance.

### Batch 4
- **WP 5.6 — report parity + docs:** run report JSON/markdown export includes blocks (markdown
  tables for snapshot data, footnote-style citations); CLAUDE.md capability-row note; STATUS
  owner-acceptance checklist finalized.
  *Acceptance:* report snapshot tests; docs verified against the running app.

### Parallel execution map
Batch 1: **5.1 solo** · batch 2: 5.2 ∥ 5.5 · batch 3: 5.3 ∥ 5.4 · batch 4: 5.6.
`packages/shared` writers serialize across workstreams (standing contention rule).

## Out of scope (this phase)

Charts for hypercube data (`@brand/charts` — a later nicety once tables prove the data path);
live card-patch delta reconstruction (the Phase 4 known cosmetic limitation — settled answer stays
authoritative); grading changes of any kind; the ActionSet/"View source" affordance (no in-app
equivalent yet); Compare/Analytics surfaces.

## Owner-acceptance (added to STATUS §Phase 5)

Both-theme + keyboard walk of the reworked answer view, insights, reasoning sections, and the
kind-aware rail on run `hHGgqkU58F_xYv0e-nHKC` (replay) **and** one fresh live run; citation-chip
scroll behavior; a legacy run (pre-Phase-5) confirmed rendering via the derivation path.
