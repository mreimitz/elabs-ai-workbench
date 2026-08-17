# Testing → Runs → Run — session-view rework (findings + plan)

The owner reported six problems with the run-session console (Testing → Runs → open a run):

1. The whole LLM session lands in **one large white card**; user inputs are invisible.
2. **Tool calls stack on top** of that card instead of in the sequence they were called — timeline/timestamps look ignored.
3. The right-pane inspector (**Network / Console / Application**) "doesn't look properly sorted".
4. The KPI box says **9 Turns but the bar chart shows only 2** (stats inconsistent).
5. Clicking an **Application Turn-tree** entry opens a **sheet that covers** the detail it should reveal.
6. **Export** is a poor small overview — it must be a complete session-log dump.

This document is the deep root-cause analysis (Part A), the remediation plan as worktree-isolated tasks
(Part B), and the `@elabs-ai/components-ai` component map for the conversation rebuild (Part C). Evidence is
file:line; every claim below was traced first-hand and adversarially re-verified (8 confirmed, the rest
sharpened — see notes).

---

## Part A — Root causes

### A0. The spine: there is no turn-segmented timeline; ordering authority is broken

Three independent defects in the data model make every symptom above downstream:

**A0.1 — `step.index` collides across three 0-based counters.** Steps are emitted by three producers,
each numbering from `index: 0`:
- engine `:step:` — `tool_call` / `tool_result` from the stream ([engine.ts:167,187](../../apps/api/src/testing/engine.ts#L167))
- accounting `:acct:` — `llm_response` / `context_event` ([accounting.ts:244,391](../../apps/api/src/testing/accounting.ts#L244))
- MCP sink `:mcp:` — a *second* `tool_call` per call (timing/serverId) ([run-service.ts:47,93](../../apps/api/src/testing/run-service.ts#L47))

The web reducer dedupes/sorts steps by `step.index` ([use-run-stream.ts:87](../../apps/web/src/features/testing/use-run-stream.ts#L87)), so in **live** mode steps with equal index **clobber each other**. Persistence sidesteps this with a separate gapless `idx` and `getRun` returns `index = row.idx` ([run-repository.ts:80,408](../../apps/api/src/testing/run-repository.ts#L80)) — so **live and replay diverge**. *(Verified: real, exactly as cited.)*

**A0.2 — Assistant prose is a flat global accumulator with no turn/step association.** `delta` events
carry only `{channel, text}` — no turn index ([types.ts:375](../../packages/shared/src/types.ts#L375), [engine.ts:289](../../apps/api/src/testing/engine.ts#L289)); the reducer concatenates them into one `deltas.text` / `deltas.reasoning` string for the whole run ([use-run-stream.ts:16,117](../../apps/web/src/features/testing/use-run-stream.ts#L16)). The persisted `llm_response` step stores only `{deltas, snapshot}` token-accounting — **no per-turn text** ([accounting.ts:401](../../apps/api/src/testing/accounting.ts#L401)). The code admits it: [ArtifactPreview.tsx:146](../../apps/web/src/features/testing/ArtifactPreview.tsx#L146) *"per-turn assistant prose is NOT persisted."*

**A0.3 — Emission order is unreliable for turn reconstruction.** The accounting `llm_response` steps are
pushed to `accountingWork` and awaited **after** the `fullStream` drains ([engine.ts:280,376](../../apps/api/src/testing/engine.ts#L280)), so they land *late* — after their turn's tool steps, often after the next turn's. **Reconstructing turns by step order is therefore fragile.** The fix is an explicit, engine-authored `turnIndex` on steps + deltas (do **not** infer turns from emission order). *(This is the key refinement over a naive frontend reconstruction.)*

### A1. Chat collapses into one card (complaints 1, 2)

[ConversationPane.tsx](../../apps/web/src/features/testing/ConversationPane.tsx) renders exactly **one**
`UserTurn` (the seeded `test.userPrompt`, line 92) and **one** `AssistantTurn` (line 94). The assistant
`Card` maps **all** tool groups (line 181) and *then* the single concatenated `deltas.text` (line 192) —
so tool cards always render on top and all text lands underneath, regardless of real order. There is no
loop over turns. Interactive user follow-ups never render: `submitTurn` → engine appends a `user`
message ([engine.ts:424](../../apps/api/src/testing/engine.ts#L424)) but emits **no event**, so the UI
can't see them. **Root fix needs the contract (A0.2/A0.3) + a flat per-turn timeline renderer.**

### A2. "9 Turns vs 2 columns" (complaint 4)

KPI "Turns" reads `kpis.turns` ([KpiRail.tsx:135](../../apps/web/src/features/testing/KpiRail.tsx#L135)); at end-of-run that is the engine's **final** `kpi` where `turns = Math.max(steps, 1)` and `steps` counts every `onStepFinish` ([engine.ts:431,433](../../apps/api/src/testing/engine.ts#L431)) — and that final kpi **overwrites** the accounting per-step kpis in the last-write-wins reducer. The chart plots one column per step carrying a `context` snapshot — i.e. the accounting `llm_response` steps ([ContextChart.tsx:362](../../apps/web/src/features/testing/ContextChart.tsx#L362)). These two counts come from **different counters** and diverge when (a) accounting fails for a step — silently swallowed by `.catch(() => undefined)` ([engine.ts:280](../../apps/api/src/testing/engine.ts#L280)) — still bumping the engine `steps` count but emitting no column; and/or (b) live index-collision (A0.1) drops context-bearing steps. *(Adversarial verdict: this is a real bug, not a benign definition gap — the engine final kpi clobbering the accounting count is the defect. Fix = single KPI source.)*

### A3. Inspector "not sorted" + duplicate rows (complaint 3)

`StepLog` (Network) and `ConsolePanel` render steps in array order ([StepLog.tsx:269](../../apps/web/src/features/testing/StepLog.tsx#L269), [ConsolePanel.tsx:214](../../apps/web/src/features/testing/ConsolePanel.tsx#L214)) — correct on replay, scrambled/lossy live (A0.1). Worse, **every logical tool call yields two `tool_call` rows** (engine stream + MCP-sink timing) plus a `tool_result`, so the Network/Console look cluttered and the step-count badge over-counts. Fix = single ordinal (A0.1) + de-dupe the MCP-sink step against the engine step by `toolCallId`.

### A4. Application sheet covers the detail (complaint 5)

`ApplicationPanel` has its **own** in-pane preview (`SplitPanel` + `ArtifactPreview`, [ApplicationPanel.tsx:106](../../apps/web/src/features/testing/ApplicationPanel.tsx#L106)), but selecting a tree node also sets the shared `selectedStepId`, which opens the global `PacketInspector` `Sheet side="right"` ([RunConsole.tsx:496](../../apps/web/src/features/testing/RunConsole.tsx#L496), [PacketInspector.tsx:72](../../apps/web/src/features/testing/PacketInspector.tsx#L72)) **over** that very pane. Two competing detail surfaces, one selection. Fix = one detail surface: gate the global Sheet to non-Application tabs (lift active tab into `RunConsole`), so Application keeps its tree+preview and the Network/Console tabs keep the Sheet.

### A5. Export is a flat metadata table (complaint 6)

[reports.ts](../../apps/api/src/reports/reports.ts) `createRunMarkdownReport` emits a small header + a
flat `# | type | label | status | tok↑ | tok↓ | dur` table — no full static header, no per-step context
evolution, no per-turn conversation, no KPI trajectory. **All the data already exists** in
`RunDetail.steps` (per-step `context`, `cumulativeTokens`, `usageActual`, `profileTokens`, redacted
`payload`) + `RunDetail.events` (ordered, incl. deltas) — so the rich report needs **no contract change**
beyond what A0 already adds. Per-step cost is recoverable by porting `kpiSnapshotsByStepId` /
`withSummaryTotals` from [RunConsole.tsx:671-733](../../apps/web/src/features/testing/RunConsole.tsx#L671).

---

## Part B — Remediation plan (waves; worktree-isolated tasks)

Dependency: the **Foundation** (contract + API + client timeline model) must land first; the four
visible reworks then run in parallel worktrees off it. All tasks end on the gate
`pnpm typecheck && pnpm test && pnpm build` (green) and use `corepack pnpm@9.15.4`.

### Wave 1 — Foundation (one task; on critical path)
**F1** single monotonic step ordinal stamped in `RunManager.emit`; client upsert keyed by `step.id`.
**F2** persist per-turn `assistantText` / `reasoningText` on the `llm_response` step (+ DB columns, redacted).
**F3** single KPI source: engine final `kpi` uses accounting totals ⇒ Turns == chart columns by construction.
**F4** stop swallowing accounting failures (surface them; non-fatal).
**F5** thread AI-SDK `toolCallId` onto the MCP-sink step for de-dupe correlation.
**F6** emit `user_message` steps (opener + interactive follow-ups) so user turns are in the stream/replay.
**F7** **`turnIndex`** on `RunStep` + `delta` events, engine as authority (robust to post-drain A0.3) + an
additive `timeline` model in `use-run-stream` (typed timeline items) that Wave 3 consumes. Existing panes keep compiling.

### Wave 3 (parallel, off Foundation)
- **C1 — Conversation timeline** rebuilt as flat `@elabs-ai/components-ai` sibling blocks (Part C). Renders the
  `timeline`: `UserMessage` per user turn; per assistant turn `Reasoning` → tool blocks
  (`AgentTimeline`/`AgentStep` or `Tool`) → `AgentMessage emphasis="answer"`; in-flight via `Shimmer`.
  Preserves the cross-pane `Inspect` (composed `@elabs-ai/components-ui` Button). Keeps `ChatShell`/`Composer`.
- **C2 — Statistics** `KpiRail` + `ContextChart`: consume the unified turn count; one "Turn" definition
  everywhere (KpiRail value, sparklines, chart columns, RunRow, report); handle the overflow
  `context_event` distinctly so it isn't a phantom column.
- **C3 — Inspector** `StepLog`/`ConsolePanel`/`ApplicationPanel`/`PacketInspector`: single detail surface
  (gate the Sheet by active tab); de-dupe the double `tool_call` rows by `toolCallId`; verify ordering.
- **C4 — Export** rewrite `createRun{Json,Markdown}Report` into a 3-part session log: (1) full static
  header, (2) statistics overview, (3) ordered per-step breakdown with per-step KPI + context-window
  state. Wire the web export menu copy.

---

## Part C — `@elabs-ai/components-ai` component map (reference: `patterns-scenarios-agentic-ai-workspace`)

The reference sequences a turn as a **flat series of sibling blocks** inside `ConversationContent` — not
one wrapping card. Map:

| Current (hand-rolled) | Replace with | Notes |
|---|---|---|
| `ChatShell`+`Conversation`+`ConversationContent` | keep as-is (already correct, `variant="bare"`) | only the *content* changes |
| `UserTurn` Card | `UserMessage` > `MessageContent` | attachments as chips inside, or `Attachment*` |
| `Thinking` Collapsible | `Reasoning` > `ReasoningTrigger` + `ReasoningContent` | `duration?`, `isStreaming?`; append token Badge |
| single `AssistantTurn` Card | **flatten** → `Reasoning`, then `AgentTimeline`/`Tool` blocks, then `AgentMessage emphasis="answer"` | `MessageResponse` (markdown) for prose; `Shimmer` for in-flight |
| stacked `ToolCallCard`s | `AgentTimeline` > `AgentStep` (status spine) and/or `Tool` > `ToolHeader`+`ToolContent`>`ToolDetails`>`ToolInput`/`ToolOutput`; `ToolResultCard` for artifacts | 7-state `status`; put tok/ms in the `summary` slot |
| `Inspect ↗` button | composed `@elabs-ai/components-ui` Button (`ExternalLink`) inside the step/tool | no `@elabs-ai/components-ai` equivalent; keep lifted `selectedStepId` |
| `Composer` | keep `@elabs-ai/components-ai` `Composer`; optional `Suggestions` | already canonical |
| `ApplicationPanel` browser | `ContextPanel`/`ProducedAssetTree`/`AssetPreview` for assets; keep `SplitPanel`+`Tree`+`CodeEditor` for raw redacted-JSON | per-step JSON stays on read-only Monaco |

**Gaps (hand-compose):** cross-pane inspect; per-step token/duration chips (via `summary` slot or
`Badge`); arbitrary redacted-JSON preview (keep `@elabs-ai/components-editor` `CodeEditor`); terminal/error notices
(`Alert`/`ErrorState`); automated-mode lock note.

Reference & key stories (theme `light`): `patterns-scenarios-agentic-ai-workspace--default`,
`ai-agenttimeline--default`, `ai-tool--default`, `ai-reasoning--default`, `ai-message--final-answer`,
`ai-toolresultcard--default`, `ai-composer--default`, `ai-contextpanel--detail-view`.

---

## Status

- [x] **Wave 1 Foundation** — single monotonic step ordinal (RunManager), per-turn `assistantText`/
  `reasoningText` on `llm_response`, single KPI source (turns == chart columns), surfaced accounting
  failures, `toolCallId` correlation, `user_message` steps, the `timeline` model, AND the
  engine-authored **`turnIndex`** (steps + deltas) so turn grouping is deterministic despite the
  post-drain `llm_response` (the key robustness fix). Green.
- [x] **C1 Conversation** — flat `@elabs-ai/components-ai` timeline (`UserMessage`/`Reasoning`/`AgentTimeline`+
  `AgentStep`/`Tool*`/`AgentMessage`), cross-pane Inspect preserved.
- [x] **C2 Statistics** — KPI turns == chart columns by construction; columns labelled by real
  `turnIndex`; overflow `context_event` is a distinct "Overflow" column.
- [x] **C3 Inspector** — single detail surface (PacketInspector Sheet gated off on the Application
  tab via a lifted `inspectorTab`); double tool-call rows de-duped by `toolCallId` in Network +
  Console; step count counts logical steps.
- [x] **C4 Export** — 3-part session-log report (static header → statistics overview → ordered
  per-step breakdown with per-step context-window + cumulative KPIs, grouped by turn, with per-turn
  prose); ported `kpiSnapshotsByStepId` to `apps/api/src/reports/run-kpi-by-step.ts`.
- [x] **Integration + full gate** — all merged into `feat/runs-session-rework`; `pnpm typecheck` +
  `pnpm test` (166/166) + `pnpm build` all green.
- [~] **Visual verify** (both themes, against a real/seeded run) — see verification note below.

> **Verification note.** Code gate is green (`typecheck` + `test` 166/166 + `build`), and every
> `@elabs-ai/components-ai` composition was checked against its Storybook story in both themes. The behavior path is
> also covered by the API tests (run-persistence / accounting / agent-loop / run-report /
> run-kpi-by-step). The fully-assembled multi-turn pane is being visually confirmed by seeding a
> realistic finished run into the local SQLite (driven through the REAL engine + persistence, so the UI
> reconstructs from the persisted `RunDetail`/event log exactly as a real run does) and opening it in
> the running app at :8080.
