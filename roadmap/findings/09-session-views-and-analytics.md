# 09 — Session Views: Chat / Raw / Analytics tabs, Gantt timeline, and chat‑render consistency

Concept + execution plan, grounded by the read‑only map (workflow `wf_dab150b9-9e0`). Single‑owner
feature; lands on `feat/runs-session-rework`. Gate per change: `pnpm typecheck && pnpm test && pnpm build`.

---

## 0. Diagnosis — why the chat render looked inconsistent

It is **mostly our renderer's heuristics**, not the model's format. Mapping the observed report:

| Section | Rendered | Root cause (our rule) |
|---|---|---|
| `#` "Demo Banking" (the title) | a card | We card‑wrap **every** heading, incl. the `h1` document title. |
| Headline Performance | card, **huge footer** | `splitBodyFooter` dumps *everything* after the last table into the footer. |
| Pipeline Health (6 rows) | collapsible, **not a card** | `OVERSIZE_TABLE_ROWS = 4` routes any >4‑row table to the fold‑away disclosure. |
| Geographic Concentration (5 rows) | collapsible, **not a card** | same >4‑row threshold. |
| Product Mix (small table) | card ✓ | small table → card, as intended. |

The model *does* vary (`#` vs `##`, table sizes, caption placement); a robust renderer must absorb that.
This is also the strongest argument for the three views: **Chat** = our best‑effort render, **Raw** = the
actual markdown (ground truth, immune to our heuristics), **Analytics** = structured truth from the run data
(immune to markdown formatting entirely).

---

## 1. Track A — Chat‑render consistency (`apps/web/src/features/testing/ChatMarkdown.tsx`)

Single file. Fix spec:

- **`h1` = report header, not a card.** Capture heading *level* in `splitSections` (`HEADING_RE` → `/^(#{1,6})\s+(.*)$/`, record `headingLevel`). A `headingLevel === 1` section renders as a `@elabs-ai/components-ui` `Heading` + its intro prose **inline** (the existing `headingText===null` inline‑prose path), never a Card, never `splitBodyFooter`.
- **Every `h2`–`h6` section = a card.** Remove the oversized→bare‑Collapsible divergence so Pipeline Health / Geographic Concentration become cards like Product Mix.
- **Fold only a genuine tool catalog, inside its card.** Raise to `CATALOG_TABLE_ROWS > 12` / `CATALOG_LIST_ITEMS > 12`. When tripped, the section is **still a Card** (header/title always visible) and only the `CardContent` body collapses (default‑closed `Collapsible` + count Badge). 5–6‑row analytical tables stay full; the multi‑dozen‑row "Available Tools" dump folds.
- **Footer = short single‑paragraph caption only.** `splitBodyFooter`: trailing block after the last table qualifies as footer **iff** it is a single paragraph (no internal blank line) **and** (italic `*…*`/`_…_` **or** < ~300 chars). Else it stays in the body. → Headline Performance's multi‑paragraph analysis stays in the body; Customer Base's italic note becomes the footer.
- **Footer font actually small.** `MessageResponse` applies `[&_p]:text-body`; beat it with an important footer prose class `[&_p]:!text-xs [&_li]:!text-xs` (same `!` technique MD_PROSE uses for headings).
- **Streaming‑safe**: keep the `complete = !isLast || !streaming` gate in front of catalog‑fold AND footer split; prefer body (not footer/fold) for an in‑flight trailing block.
- **Known limit**: nested `h3` under `h2` becomes a *sibling* card (splitSections splits on every level). Acceptable for now; documented.

---

## 2. Track B — Session views shell (`RunConsole.tsx` + `RunBar.tsx` + `PacketInspector.tsx` + `ReplayScrubber.tsx`)

Owns the structural shell + the bug fix; **owns all edits to those four hot files** so Wave‑2 only adds new files.

- **Tabs (Chat / Raw / Analytics)** wrap the LEFT pane. Lift `view` state in `RunConsole`; `Tabs` is already imported there.
  - **Chat** = the existing `ConversationPane` (unchanged).
  - **Raw** = verbatim assistant markdown — per‑turn `timeline[].assistantText` (and `reasoningText`), or run‑wide `stream.deltas.text` — rendered in a token‑styled read‑only block (`@elabs-ai/components-ai CodeBlock` / `<pre>` in a `ScrollArea`); no section‑card restructuring.
  - **Analytics** = mount `<AnalyticsPanel runId stream … />` (B ships a **stub** `AnalyticsPanel.tsx` so build is green; Wave 2 fills it).
- **Replay → a single button.** Remove the `ReplayScrubber`‑in‑`RunBar` `replaySlot`; add one `Replay`/`Restart` Button next to the `StatusBadge` ("stopped" chip) in `RunBar` (lines 231‑240). Retire or shrink `ReplayScrubber` to that single control.
- **Sheet‑bug fix.** `RunConsole.tsx:203‑207` mirrors the scrubber playhead into the shared `selectedStepId`, which is the *only* thing that opens the `PacketInspector` Sheet (`open = !suppressed && selectedStepId!==null && step!==null`). **Decouple**: stop writing `selectedStepId` from the scrubber (delete that effect, or repoint it at a separate `playheadStepId` used only for cross‑highlight). The Sheet then opens **only** on explicit clicks (tool‑card Inspect / StepLog / Console row).

---

## 3. Track E — Per‑step timing contract (Gantt foundation; `packages/shared` + `apps/api`)

**There is no per‑step wall‑clock time today** (run_steps has no time column; only `tool_call` steps carry `duration_ms`; LLM steps carry none; `run_events.created_at` exists but is stripped before the client). A real Gantt needs this, so it precedes Track D.

- **shared/types.ts**: add additive `RunStep.startedAt?: string` + `endedAt?: string` (ISO).
- **db**: `run_steps.started_at TEXT`, `ended_at TEXT` (additive, `ensureColumn` migration, NULL on old rows); `rows.ts` `RunStepRow`; `run-repository.ts` INSERT + `toRunStep` mapper.
- **engine emit**: stamp `startedAt`/`endedAt` — tool steps from `Date.now()` around `tool-bridge` `callTool` (it already measures `performance.now()`); LLM steps from `Date.now()` around each `streamText` step boundary (`onStepFinish`), which **also** finally gives LLM‑turn latency.
- **Regression test** locking that an interactive run persists monotonic per‑step `startedAt`/`endedAt` for both tool and llm steps.
- *(Optional follow‑up E2)*: snapshot the run's **allowed tool set + per‑tool definition token cost** (new `run_allowed_tools` rows) so used‑vs‑unused tools + wasted‑definition‑tokens become exact — today the allowed set isn't persisted on the run (only the *called* tools are recoverable).

---

## 4. Tracks C + D — Analytics dashboard concept (built together as the Analytics tab)

One worktree, two files: `AnalyticsPanel.tsx` (sub‑tabbed dashboard) + `RunGantt.tsx` (the timeline). Everything reads `RunDetail` (steps/events) + the existing run report payload (`GET /api/reports/run/:id/json` → `statistics` + per‑step `stepKpis`) + `buildRunKpiByStep`. All series use `var(--chart-1..5)`; both themes.

A second‑level `Tabs` inside the Analytics `TabsContent`:

1. **Overview** — `MetricGrid` of KPI `MetricCard`s (tokens in/out, cached %, est. cost `$`, turns, tool calls, tool errors, peak context %, duration; `positiveIsGood={false}` for cost/errors/context) + cost‑development `LineChart` (cumulative `costUsd` per turn) + context‑growth `AreaChart` (the now‑monotonic staircase) toward the model limit.
2. **Tokens** — per‑turn **stacked** `BarChart` of context segments (`system / tool_defs / history / tool_results / output` from `context_snapshot_json`; ≤5 series → bucket if needed) · cached‑vs‑uncached · estimate‑vs‑actual (`profile_tokens` vs `usage_actual`) · tokens‑per‑tool `BarChart` (tool‑result size from the MCP‑sink `tool_call` step's `profile_tokens`).
3. **Tools** — `@elabs-ai/components-data DataTable` (tool, server, calls, result tokens, avg/max latency from `duration_ms`, error rate) + calls‑per‑server `BarChart` + **used‑vs‑unused** tools (used = distinct `tool_name` over `tool_call` steps; *unused + wasted‑def‑tokens needs Track E2 — until then show used set + a "unused tools not yet snapshotted on the run" note rather than a wrong number*).
4. **Timeline (Gantt)** — `@elabs-ai/components-charts Gantt`: one `GanttTask` per LLM request/response + per tool call, `start`/`end` from Track E timing, `dependencies` chaining request→tool→response, `status` mapped to the semantic union (`info` = request, `pending` = response, `success` = ok tool, `destructive`/`error` = failed call). Shows **what failed and where time went**. (Bars are colored by `status`, *not* `--chart-N` — that's a Gantt rule.)
5. **Errors** — failed steps (`status === 'error'`, `transportError`, tool_result errors) + the terminal `context_overflow` / guardrail‑stop, each linking to the step (opens the inspector on explicit click).

---

## 5. Wave plan (worktrees)

Forced by `RunConsole.tsx` being the file C/D mount into — B must own it first.

- **Wave 1 (parallel, own worktrees):**
  - **A** — `ChatMarkdown.tsx` only (disjoint; lowest contention).
  - **B** — `RunConsole.tsx` + `RunBar.tsx` + `PacketInspector.tsx` + `ReplayScrubber.tsx`; ships the Tabs shell, Raw tab, single Replay button, sheet‑bug fix, and a **stub `AnalyticsPanel.tsx`** exposing the Analytics mount slot.
  - **E** — `packages/shared` + `apps/api` (timing contract + test); additive‑only, disjoint from web.
  - Gate per agent: `pnpm typecheck` (A, B) · `pnpm typecheck && pnpm test` (E). Integrated `pnpm build` runs once after merge (avoids parallel‑build OOM).
- **Wave 2 (after Wave 1 merges):**
  - **C + D** — replace the `AnalyticsPanel.tsx` stub with the real sub‑tabbed dashboard + add `RunGantt.tsx`, consuming Track E's timing. New files only (no `RunConsole.tsx` edit beyond B's slot).

File‑overlap: `RunConsole/RunBar/PacketInspector/ReplayScrubber` touched only by B; `ChatMarkdown` only by A; `shared`+`api` only by E; `AnalyticsPanel`/`RunGantt` only by C+D. `KpiRail`/`ContextChart` are read‑only inputs (props frozen).
