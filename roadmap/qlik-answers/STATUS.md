# Qlik Answers — work-package status ledger · **PRIORITY: HIGH**

Living state for the **qlik-answers** plan, read and updated by `/next-wp qlik-answers`. A box is
ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/qlik-answers/<id>`.

> Plan + locked decisions D-QA1–D-QA7 in [`README.md`](./README.md). API ground truth in
> [`../research/qlik-answers-as-model.md`](../research/qlik-answers-as-model.md). Orchestrator
> handover: [`kickoff-prompt.md`](./kickoff-prompt.md). **Kickoff done
> (owner, 2026-07-11):** all seven decisions locked — see README table. WP 0.2 claims the
> migration `user_version` at claim time (**v23 expected** — `apps/api/src/db/database.ts`
> `MIGRATIONS` is at v22 today [claimed by auto-rating WP 4.1]; re-verify + check sibling
> ledgers). **Execute in parallel** per README §Parallel execution map.
>
> ⚠️ **Contention note (2026-07-11):** other workstream sessions (auto-rating, others) may hold
> `packages/shared` and `apps/api/src/testing/run-service.ts`. **WP 0.1 (shared) and WP 1.2
> (run-service) start only when no other session is writing those files.** WP 2.1 (servers/oauth
> modules) and WP 0.3 (providers module) are safe starters. Remove this note once parallel
> sessions have merged.
>
> **Naming rule:** internal kind `qlik_answers`, executor `qlik-answers-executor`; never bare
> "assistant" in code (collides with the embedded Claude dock, `apps/api/src/assistant/*`).

## Phase 0 — Contract & provider foundation
- [x] WP 0.1 — shared contract: `PROVIDER_KINDS` + `"qlik_answers"`, zod, additive types
      (`qlikTenant?`, step payload `sources`/`assistantVersion`/`estimatedTokens`/
      `questionsConsumed`, estimate `answersQuestions?`, env `answersMode?`, provider
      `mcpServerId?`) — done 2026-07-11 · wp/qlik-answers/0.1
- [x] WP 0.2 — credential link + migration (claim next free user_version; **v23 expected**):
      `provider_credentials.mcp_server_id` (NULL, ON DELETE SET NULL); dual auth resolution
      (linked server headers/OAuth token · own API key); "auth broken" surfacing
      — done 2026-07-11 · wp/qlik-answers/0.2
- [x] WP 0.3 — assistants roster in model-catalog (classic only¹) + registry/accounting cases +
      Settings Providers form (tenant URL, key-or-linked)
      — done 2026-07-11 · wp/qlik-answers/0.3
      ¹ classic-only filter **deferred** — the public assistants API exposes no classic/agentic
      distinguisher (owner decision 2026-07-11: ship all, revisit on live-tenant verification)

## Phase 1 — Executor
- [x] WP 1.1 — invoke path: thread create (named `mcpfp run <id>`, kept per D-QA4) → one-shot
      invoke → standard events (`llm_response.assistantText` + payload), AE-x mapping
      (AE-4 → `prompt_rejected`), estimated tokens, questions metric + optional €/question,
      `maxRunDurationMs` (stubbed tenant tests) — done 2026-07-11 · wp/qlik-answers/1.1
- [x] WP 1.2 — `RunService.execute()`/`resolve()` branch on `cred.kind` (no sessions/tools/
      skills) + interactive turns → `promptType:"thread"` on the kept thread
      — done 2026-07-11 · wp/qlik-answers/1.2
- [x] WP 1.3 — stream path (default per D-QA2): chunked-JSON parser (`}{` boundaries, trailing
      `sources`, partial-fragment tolerant) → `delta` events; per-env `transport` fallback
      — done 2026-07-11 · wp/qlik-answers/1.3
- [x] WP 1.4 — clean-session enforcement (3 layers): ScenarioService kind-aware reject ·
      plan-time member skipping per D-QA6 (`skipped: incompatible`; all-skip plan → 400; variant
      plans reject the kind) · executor structurally attach-free; compatibility CTA hidden¹
      — done 2026-07-11 · wp/qlik-answers/1.4
      ¹ compat-CTA hide is **N/A** — no web caller of `POST /api/runs/:id/compatibility` exists yet
      (API route built, never wired to UI); whoever builds it (testing WP 5.7) must gate on `qlik_answers`
- [x] WP 1.5 — orchestrator per-provider concurrency cap + 429/`AE-6` backoff for the kind
      — done 2026-07-11 · wp/qlik-answers/1.5

## Phase 2 — Detection & onboarding
- [x] WP 2.1 — server-side qlik-detect + list-only answers probe (server creds; 401/403 →
      `needsOwnKey`; **never invokes**) + `POST /api/servers/:id/qlik/answers-probe` + additive
      probe fields — done 2026-07-11 · wp/qlik-answers/2.1
- [x] WP 2.2 — wizard offer step (assistant multi-select → one-click provider [linked-auth
      preferred, API-key fallback] + locked env per assistant) + server-detail "Answers
      available" badge/CTA + scan-time recheck; consent-gated, never silent
      — done 2026-07-11 · wp/qlik-answers/2.2
- [x] WP 2.3 — environment editor conditionals for the kind (hide servers/skills + irrelevant
      guardrails; assistants picker; transport toggle); both themes
      — done 2026-07-11 · wp/qlik-answers/2.3 (+ migration v24 answersMode persistence, closes 1.2 gap)

## Phase 3 — Analytics polish & docs
- [x] WP 3.1 — sources panel on the answer step + assistant-version (Etag) drift marker vs
      previous run of the same test×environment; both themes
      — done 2026-07-11 · wp/qlik-answers/3.1
- [x] WP 3.2 — cost surfaces: launcher preview `answersQuestions` (matrix multiplier explicit),
      KPI rail "est." token labels, suite question totals
      — done 2026-07-11 · wp/qlik-answers/3.2
- [x] WP 3.3 — docs: CLAUDE.md row → ✅, research-doc live-verification addendum,
      owner-acceptance checklist final
      — done 2026-07-11 · (orchestrator; docs-only)

## Phase 4 — cloud-assistants rework (2026-07-11, live-verified)

> **Why:** Phases 0–3 shipped gate-green but LIVE testing on the `barcbenchmark` tenant proved they
> call the **wrong** Qlik API — `POST /api/v1/assistants/{aid}/threads/{tid}/actions/{invoke,stream}`
> with `{input:{prompt,promptType}}` binds NO data source for an **app**-backed assistant, so a run
> returns HTTP 200 with *"I'm sorry, I don't have any information…"* + zero sources. The **working**
> path (mirrored from the customer's `answers_extract_script/.../call_answers.py`) binds a Qlik Sense
> **app** as the data context through the internal `/api/v1/cloud-assistants/` API. Full ground truth:
> [`../research/qlik-answers-as-model.md`](../research/qlik-answers-as-model.md) §2.6 (revised).
> Handover: [`cloud-assistants-rework-handover.md`](./cloud-assistants-rework-handover.md).

- [x] WP 4.1 — **app-context resolution** (`providers/model-catalog.ts` `resolveQlikAnswersAppContext`,
      cached per `(baseUrl, assistantId)`): the env "model" stays the assistant UUID; resolve its bound
      Qlik Sense app id from `GET /api/v1/assistants/{id}` → **`appIds[]`** (live shape), with
      cloud-assistants-detail + knowledge-base data-source fallbacks and a field-guided `findAppId` scan;
      **unresolvable → `QlikAnswersAppResolutionError` → terminal `error`** (the owner-locked STOP case,
      never a silent wrong-answer) — done 2026-07-11 · wp/qlik-answers/4.1
- [x] WP 4.2 — **executor rework** (`testing/qlik-answers-executor.ts`): resolve app → `POST
      /api/v1/cloud-assistants/threads` `{name, context:{type:"app", id, data:{mode:"live"}}}` → `POST
      /api/v1/cloud-assistants/{threadId}/actions/stream` `{context, content:[{text}]}` (SSE/NDJSON,
      new `qlik-answers-sse.ts` parser: last `messageId` under `params` + best-effort deltas) → `GET
      /api/v1/cloud-assistants/threads/{threadId}/messages` → Adaptive-Card extraction (`qlik-answers-
      message.ts`: first TextBlock after "Conclusion", citations stripped; `qMeasures[].qDef.qDef`
      expressions; `_find_last_ai_message`/`_last_text` fallback). The old chunked `}{` parser
      (`qlik-answers-stream.ts`) + its test were removed. `promptType` is GONE (the cloud-assistants
      body has none). Retry/backoff (WP 1.5), deadline, AE-4→`prompt_rejected`, questions metering all
      preserved — done 2026-07-11 · wp/qlik-answers/4.2
- [x] WP 4.3 — **additive contract** (`packages/shared`): `AnswersStepPayload` gains `appId`, `messageId`,
      `expressions[]`, `reasoning`, `rawResponse` (`sources` kept optional — `[]` for app assistants; the
      answer text = `assistantText`, graders unchanged) + zod — done 2026-07-11 · wp/qlik-answers/4.3
- [x] WP 4.4 — **tests reworked to the cloud-assistants wire** (all stubbed fetch, NO live tenant): new
      `qlik-answers-message.test.ts` + `qlik-answers-sse.test.ts` + `qlik-answers-resolve.test.ts`;
      `qlik-answers-executor` / `-run-service` / `-backoff` rewritten to the new wire. Gate green — API
      **1521/1521**, typecheck, build, lint — done 2026-07-11 · wp/qlik-answers/4.4
- [x] WP 4.5 — **live verification** (owner tenant `barcbenchmark`, env `nytaxi-assistant`): a run now
      returns a **real** answer — *"There are 118,425,410 taxi trips in the dataset."* — with
      `expressions:["=[Trips]"]`, resolved `appId 8ac375d0-…`, `messageId`, and lossless `rawResponse`
      (not "no information"). Done 2026-07-11 · wp/qlik-answers/4.5

## Phase 5 — Answer rendering rework (chat fidelity; planned 2026-07-12)

> **Why:** the first real Qlik Answers session (run `hHGgqkU58F_xYv0e-nHKC`) showed the console
> inverts the payload's value — the answer renders as 6 flat citation-stripped paragraphs, the 5
> hypercube snapshots (real data) render as expression strings only, the full formatted drafts hide
> inside "Thought process" (duplicating the answer), and the KPI rail shows $0.00/Tool-calls-0
> instead of questions. Plan + proposed decisions **D-QA8–D-QA13** (defaults locked unless the
> owner overrides at kickoff): [`phase-5-answer-rendering.md`](./phase-5-answer-rendering.md).
> Kickoff prompt: [`phase-5-kickoff-prompt.md`](./phase-5-kickoff-prompt.md).
> **Grader invariant: `assistantText`/`reasoning` stay byte-identical — grading untouched.**

- [x] WP 5.1 — shared contract: `AnswersAnswerBlock` union + `AnswersStepPayload.blocks?` +
      `AnswersSnapshot.data?` (columns/rows/totalRows, cap 50) + zod; additive only
      — done 2026-07-12 · wp/qlik-answers/5.1
- [x] WP 5.2 — API extraction rework: ordered card-body walk → `blocks[]` (per-block `citations[]`),
      hypercube data extraction, `qlik-answers-reasoning.ts` phase parser (verbatim fallback),
      executor attach + replay-read derivation for legacy runs (D-QA8); real-run-shaped fixtures.
      Landed the `ReasoningSection` shared-contract add (D-QA11 kept IN FULL, owner 2026-07-12) as the
      sole batch-2 `packages/shared` writer. — done 2026-07-12 · wp/qlik-answers/5.2
- [x] WP 5.3 — web answer renderer: `AnswersAnswerView` (blocks → ChatMarkdown / MetricCard /
      DataTable insets; citation chips anchor-scroll to insights; `assistantText` fallback; dangling
      citation indices inert). — done 2026-07-12 · wp/qlik-answers/5.3
      **Shared for 5.4:** `AnswersSnapshotData({snapshot, variant?: "inset"|"panel"})` (1×1→MetricCard,
      else compact `@brand` table + "Showing N of M"; `variant` = density only) and
      `insightAnchorValue(index) → "insight:<index>"` (5.4 spreads `{...consoleAnchor(insightAnchorValue(i))}`
      onto the InsightRow = the scroll TARGET; chips are the SOURCE). ConversationPane PROSE block only.
- [x] WP 5.4 — web insights + reasoning rework: data-first insight rows (`AnswersSnapshotData`
      `variant="panel"` + reason; expressions → collapsed "Definition"; InsightRow carries the
      `insightAnchorValue` citation-scroll target), structured reasoning sections (new `AnswersReasoning`:
      asset table, `draft` collapsed when `duplicatesAnswer`, verbatim fallback) in the ConversationPane
      REASONING block only, streaming-guarded. — done 2026-07-12 · wp/qlik-answers/5.4
- [x] WP 5.5 — kind-aware KPI rail + console chrome: Questions KPI, question-first cost tile,
      assistant-identity card replaces the context-window card for the kind (+ ContextChart & turn-0
      baseline hidden for the kind). — done 2026-07-12 · wp/qlik-answers/5.5
- [x] WP 5.6 — report parity (blocks/data/citations in JSON+markdown export) + docs
      — done 2026-07-12 · wp/qlik-answers/5.6

**Batches (as run):** 5.1 solo · 5.2 ∥ 5.5 · **5.3 → 5.4 sequential** (not the planned `∥` — shared
`ConversationPane`/`AnswersSnapshotData`/anchor coupling; see the Decision log) · 5.6.

> **🎉 Phase 5 COMPLETE — all 6 WPs (5.1–5.6) on `main` (`33f9aa5`), gate green** (typecheck; test
> shared 5/5 · web 86 files 791 passed/5 skipped · api 1563/1563; build; lint 735 clean). NOT pushed
> to origin (owner-gated). Everything below is OWNER-ACCEPTANCE — code paths exist + are stub-tested,
> but nothing here was walked in a live browser or run against a real tenant.

### Phase 5 owner-acceptance
- [ ] Both-theme (`qlik-bright`/`qlik-dark`) + keyboard walk of every reworked surface on the REPLAY
      of `hHGgqkU58F_xYv0e-nHKC` AND one fresh live run: the answer view (ordered blocks + hypercube
      MetricCard/table insets), the data-first insight rows + "Definition" disclosure, the structured
      reasoning sections (asset table + collapsed duplicate-Draft), and the question-first KPI rail
      (Questions tile · assistant-identity card · context surfaces gated off).
- [ ] Citation-chip → insight **scroll-to-insight** behavior/flash (the `insight:<n>` anchor plumbing
      is unit-tested; the actual scroll FEEL is not) — incl. a **dangling** citation (real run cites
      `0..5` with only 5 snapshots → the 6th chip is inert by design).
- [ ] A **pre-Phase-5 legacy** run confirmed rendering via the read-time `deriveLegacyAnswerStep`
      derivation (console AND the run report's block tables / `[^n]` citations).

## Phase 6 — Streaming fidelity + table affordances (owner live-acceptance feedback, 2026-07-12)

> **Why:** owner walked a live streaming run and found Phase 5 only fixed the SETTLED answer. Three gaps:
> (1) the live thinking process is hidden — `ConversationPane` forces `defaultOpen={false}` on the
> `@brand/ai` `Reasoning` disclosure, overriding its built-in `defaultOpen ?? isStreaming` (open while
> streaming, auto-close after), so a live run only shows "Thinking…"; (2) while streaming, the reasoning
> renders FLAT (raw `ReasoningContent` = Streamdown) with no structure for the technical elements
> (asset-search, classification, planned charts); (3) TWO table renderers — the streaming reasoning uses
> Streamdown's native toolbar (ugly card + copy/**download**/**fullscreen**-expand), the settled answer
> uses our clean `@brand` tables (`AnswersSnapshotData`/`ChatMarkdown` override) with NO export/expand.
> **Owner decision (2026-07-12): FULL live structure** — parse the reasoning stream client-side,
> incrementally, so the phase sections render structured AS they stream (matching the settled view).

- [x] **WP 6.1 — table affordances (item C):** reusable `ExpandableTable` (`@brand` table + CSV download
      via new `lib/csv.ts` + expand → `Dialog size="xl"` modal, hover/focus-revealed toolbar) wired into
      `AnswersSnapshotData` (N×M; 1×1 MetricCard unchanged), `AnswersReasoning`'s assets table, and the
      `ChatMarkdown` markdown-table override (structured `csv` prop OR DOM-extraction fallback for markdown).
      — done 2026-07-12 · wp/qlik-answers/6.1
      **API for 6.2:** `<ExpandableTable title? downloadName? csv?={columns,rows} scrollClassName?>{table}</>`
      — omit `csv` and it reads the rendered `<table>` DOM; modal re-renders the same children.
- [x] **WP 6.2 — live structured reasoning (items A+B):** `parseReasoningSections` MOVED to
      `packages/shared` (API = thin re-export shim, byte-identical); `ConversationPane` REASONING block
      auto-opens while streaming (`defaultOpen={turn.streaming ? undefined : false}` → `@brand/ai`'s own
      open-while-streaming/auto-close) AND renders `AnswersReasoning` LIVE from a memoized, partial-tolerant
      client-parse of `turn.reasoningText` for `qlik_answers` turns (`providerKind`-plumbed via `RunConsole`);
      settled uses the canonical server `reasoningSections`; verbatim fallback for non-qlik. Reuses 6.1's
      tables. — done 2026-07-12 · wp/qlik-answers/6.2

**Batches:** 6.1 → 6.2 sequential (both touch `AnswersReasoning`; 6.2 reused 6.1's table + the same
`ConversationPane` reasoning region). Grader invariant held — render-only; no payload/API answer-text change.

> **🎉 Phase 6 COMPLETE — both WPs on `main` (`adfd228`), gate green** (typecheck; **CI-equivalent
> recursive** `pnpm test` — shared 11 · web 89 files 816 passed/5 skipped · api 1563/1563; build ✓; lint
> 742 clean). NOT pushed (owner-gated). ⚠️ **Gate-order note:** the web/api `test` scripts run
> `pnpm --filter @mcp-token-footprint/shared build && …` — shared runtime resolves to `dist` (gitignored),
> so **web tests need shared built first**. A bare `vitest run` (bypassing the script) fails on a stale
> dist when a shared runtime export changed (as WP 6.2 added `parseReasoningSections`). Always validate via
> the `test` SCRIPT / recursive `pnpm test`, not `--filter web exec vitest run`.
> **⚑ Owner veto point:** WP 6.2's **auto-open-while-streaming applies to ALL run kinds** (it's `@brand/ai`'s
> intended `defaultOpen ?? isStreaming` behavior; non-qlik reasoning CONTENT stays byte-identical verbatim —
> only the disclosure's open state changes). If you want it gated to `qlik_answers` only, it's a 1-line change.

### Phase 6 owner-acceptance
- [ ] Live run: the thinking process is VISIBLE + STRUCTURED while streaming (auto-opens, phase sections
      + asset table build up live, collapses when done); tables everywhere (streaming + settled) are the
      same clean table with working CSV download + expand-to-**modal**; both themes + keyboard.

## Phase 7 — Answers right-panel restructure (owner live feedback, 2026-07-12)

> **Why:** owner walked a settled `qlik_answers` run and found the right rail token-heavy/useless — the
> estimated Tokens ↑/↓ cards are meaningless (the API reports no usage). Wants the rail to be **Turns +
> Insights** (the snapshot evidence roll-up) as an expandable/collapsible list, with **bidirectional,
> cross-pane scroll linking** (chat citation chip ↔ rail insight). Designed via a 5-agent
> understand→design→critique workflow (blueprint + adversarial critique). **Owner decision (2026-07-12):
> DE-DUP** — the standalone Insights roll-up moves ENTIRELY to the rail; the chat keeps its inline
> narrative snapshot insets + citation chips + document Sources/version badge (each insight's evidence
> appears once). Render-only; no `packages/shared`/API/grader/payload change; non-qlik byte-identical.

- [x] **WP 7.1 — answers rail = Turns + Insights + bidirectional links** — done 2026-07-12 · wp/qlik-answers/7.1
      (merged `db5de7c`; gate green — typecheck; CI-recursive test shared 11 · web 90 files 828 passed/5
      skipped · api 1563; build ✓. `pnpm lint` clean on all Phase-7 files — the only 3 lint errors are
      PRE-EXISTING in the concurrent illustrations session's `roadmap/illustrations/examples/Agent.example.tsx`
      [`useSingleVarDeclarator`, generated file, NOT this WP — flagged for that workstream]). **Adversarially
      reviewed** (4-dimension find→verify workflow: 3 findings refuted, core linking/parity/switches CONFIRMED
      sound; 4 low-sev fixes applied — forward-leg anchor now ALWAYS mounted (dropped RailInsightsPanel's
      section-level Collapsible, kept the bounded `ScrollArea max-h-96` + per-row collapse), InsightRow renders
      a plain non-interactive row when nothing to disclose (no dangling `aria-controls`), + 2 test tightenings).
      **Scope shipped:** (1) KpiRail hides the two Tokens
      ↑/↓ tiles for `qlik_answers` (→ 4 tiles: Assistant-identity · Est. cost · Questions · Turns; delete the
      now-dead `EstimatedTokenLabel` + its Tooltip imports). (2) New `RailInsightsPanel` (a bounded/collapsible
      `@brand` Card) aggregating every settled answer turn's `AnswersSnapshot[]` (via a `viewStream.timeline`
      memo, as-of-k safe), reusing the exported `SourcesPanel` `InsightRow` + `AnswersSnapshotData`; mounted in
      the rail after `TurnIndex`, gated on the kind + non-empty. (3) `SourcesPanel` DROPS its `InsightsList`
      (de-dup → Sources + version only) and EXPORTS `InsightRow` (header restructured so the collapse trigger,
      the `reason` text, and a ghost "Show in answer" button are SIBLINGS — no nested interactives, sane a11y
      name). (4) **Turn-qualified anchors** in `console-anchors.ts`: `insightAnchorValue(turnIndex, snapIndex)`
      = `insight:T:S` (fixes the real multi-turn `insight:0` collision), new `citationAnchorValue(T,S)` =
      `citation:T:S`, new `{kind:"insight",turnIndex,snapshotIndex}` `ConsoleNavRef` — and rewrite
      `anchorValueForRef`/`fallbackAnchorValueForRef` as **exhaustive switches** (the current ternary won't
      compile with a 3rd kind; keep `turn:`/`tool:` outputs byte-identical). (5) Citation chip (`AnswersAnswerView`,
      gets `turnIndex`) = forward SOURCE (`scrollToInsight` via `document.body` — cross-pane) AND reverse TARGET
      (`consoleAnchor(citationAnchorValue)`); rail row "Show in answer" → `navigateTo("chat",{kind:"insight",…})`
      (reuses the existing `navTarget`/`ChatAnchorScroller` — zero changes there). Update ALL 6 `AnswersAnswerView`
      test sites + the stale KpiRail test for the required `turnIndex` prop. Web tests. **Cross-pane scroll into
      the rail's Radix ScrollArea is jsdom-unprovable → owner-live-verify (side-by-side AND stacked <1200px).**

### Phase 7 owner-acceptance
- [ ] Live run: rail shows Turns + an expandable Insights list (no token cards); clicking a chat citation
      scrolls the RAIL to that insight (+ flash), clicking a rail insight scrolls the CHAT to its citation —
      in BOTH side-by-side and stacked (<1200px) layouts; both themes + keyboard/focus on every new control.

## Owner-acceptance (needs a real Qlik Cloud tenant — API key or OAuth-connected Qlik MCP server)

- [ ] Availability probe against the real tenant (both auth flavors; confirm whether the MCP
      OAuth token can call `GET /api/v1/assistants` — feeds D-QA1's preferred path)
- [ ] Wizard walk: add the Qlik MCP server → offer → one-click setup → locked environment exists
- [ ] Live run in the console (stream default): deltas, sources panel, KPI rail (est. tokens,
      1 question), thread visible in the Qlik Answers UI as `mcpfp run <id>`
- [ ] `promptType`-omitted semantics vs assistant `defaultPromptType` verified (README
      live-verification list); AE-4 rejection reproduced if possible
- [ ] **Classic-vs-agentic distinguisher (D-QA7):** confirm on a live tenant whether the assistants
      list payload carries a field separating classic from agentic (the undocumented `legacy` flag, or
      another). Until then the roster ships ALL assistants (owner-decided 2026-07-11, WP 0.3). If a
      field exists, add the filter (small follow-up in `model-catalog.listQlikAnswers`).
- [ ] Suite of ≥3 repetitions: questions total correct, consistency variance in the suite report,
      Compare walk — assistant vs raw LLM+MCP on the same tests
- [ ] Both-theme + keyboard walk of every new surface (Settings form, wizard step, env editor,
      sources panel, badges)

## Decision log

- 2026-07-12 · **PHASE 7 — answers rail restructure DONE (WP 7.1, merged `db5de7c`).** Owner live feedback:
  the settled-answer right rail was token-heavy/useless. **Designed via a 5-agent understand→design→critique
  workflow**, which caught a latent bug (`insightAnchorValue` wasn't turn-qualified → multi-turn `insight:0`
  collision) and confirmed the rail can read `snapshots[]` from `viewStream.timeline` with zero new plumbing.
  **Owner decision: DE-DUP** — the Insights roll-up moves ENTIRELY to the rail (chat keeps inline insets +
  citations + document Sources). Shipped: KpiRail drops the est. Tokens tiles for the kind; `RailInsightsPanel`
  (bounded `ScrollArea`, always-mounted anchors) reuses the exported `SourcesPanel.InsightRow`; **turn-qualified
  `insight:T:S`/`citation:T:S` anchors** + an exhaustive `anchorValueForRef`/`fallback` switch drive
  bidirectional cross-pane scroll (chat chip→rail via `scrollToInsight`/`document.body`; rail "Show in answer"→
  chat via the existing `navTarget`/`ChatAnchorScroller`, zero changes there). Render-only; non-qlik
  byte-identical (grader/payload/API untouched). **Adversarially reviewed** (4-dim find→verify workflow, 12
  agents): core linking/parity/switches CONFIRMED sound (3 findings refuted); 4 low-sev fixes applied
  (forward-leg anchor always mounted; no dangling ARIA on no-disclosure rows; 2 test tightenings).
  **Owner-live-verify (jsdom-unprovable):** the cross-pane scroll both ways in side-by-side AND stacked
  (<1200px) layouts, both themes, keyboard — see the Phase 7 owner-acceptance section. **⚠️ Repo note:** the
  concurrent **illustrations** session's committed `roadmap/illustrations/examples/Agent.example.tsx` has 3
  `useSingleVarDeclarator` lint errors (generated file) making repo-wide `pnpm lint`/CI red — NOT this WP;
  flagged for that workstream (a `biome check --write` fix, ideally in the generator). NOT pushed (owner-gated).
- 2026-07-12 · **🎉 PHASE 6 COMPLETE — streaming fidelity + table affordances (WP 6.1 + 6.2).** From owner
  live-acceptance feedback on a streaming run: Phase 5 only fixed the SETTLED answer. **WP 6.1** (merged
  0b78662): reusable `ExpandableTable` (`@brand` table + CSV download via new pure `lib/csv.ts` + expand →
  `Dialog size="xl"` MODAL — not Streamdown's fullscreen — with a hover/focus-revealed `Button` toolbar
  mirroring `CopyMessageAction`), wired into `AnswersSnapshotData` (N×M; 1×1 MetricCard untouched),
  `AnswersReasoning`'s assets table, and the `ChatMarkdown` markdown-table override (structured `csv` prop OR
  DOM-extraction fallback). **WP 6.2** (merged adfd228): `parseReasoningSections` MOVED to `packages/shared`
  (pure; API is a thin re-export shim → all `qlik-answers-*` tests green unchanged; +6 shared tests);
  `ConversationPane` REASONING block auto-opens while streaming (root cause was our forced
  `defaultOpen={false}` overriding `@brand/ai`'s `defaultOpen ?? isStreaming`) AND renders `AnswersReasoning`
  LIVE from a memoized (`[isQlik, streaming, reasoningText, assistantText]`), partial-tolerant client-parse
  for `qlik_answers` turns (`providerKind` plumbed one prop through `RunConsole`); settled still uses the
  canonical server `reasoningSections`. Once B routes streaming through our renderer, Streamdown's native
  table toolbar is gone → 6.1's ONE table is used everywhere (streaming + settled). **Owner decision:** FULL
  live structure (client-side incremental parse), not just auto-open. **Two accepted judgment calls (flagged
  for owner):** (1) auto-open applies to ALL run kinds (library-intended; non-qlik content byte-identical) —
  a 1-line gate if the owner wants qlik-only; (2) discovered the web/api `test` scripts build shared first
  (`--filter shared build && …`) because shared runtime resolves to gitignored `dist` — so validation MUST
  go through the `test` script / recursive `pnpm test`, never a bare `vitest run` (which fails on stale dist
  once a shared runtime export changes). Grader invariant untouched (render-only). Both-theme + keyboard +
  the live streaming FEEL are owner-acceptance (Phase 6 section above). NOT pushed (owner-gated).
- 2026-07-12 · **🎉 PHASE 5 COMPLETE — WP 5.6 done; all 6 WPs on `main`** (`wp/qlik-answers/5.6`
  merged 33f9aa5; final clean-detached-worktree gate green — typecheck; test shared 5/5 · web 86 files
  791 passed/5 skipped · api **1563/1563**; build ✓; lint 735 clean). **WP 5.6:** the run report (JSON
  + Markdown, `GET /api/reports/run/:id/{json,markdown}`) now carries the Phase-5 fields — the report
  route wraps `runRepository.getRun(id)` in `withDerivedAnswerSteps` = the SAME read-time
  `deriveLegacyAnswerStep` `.map` projection `GET /api/runs/:id` uses, so JSON parity is automatic and
  LEGACY runs' reports get blocks/data too (the pure builders stay DB-free/unchanged). Markdown gains an
  additive "Answer (structured):" subsection: `text` blocks with `[^n]` footnote citations (dangling
  index → `[^n] (unavailable)`, never throws), `snapshot` blocks → a 1×1 `**label:** value` line or an
  `escapeMarkdownTable`-escaped hypercube table (`totalRows` "showing N of M", bounds-checked). NON-qlik
  `llm_response` steps render byte-identically (guarded on `blocks` presence; all pre-existing
  `run-report` tests green). 6 new report tests. CLAUDE.md qlik row extended with a factual Phase-5
  paragraph. (Agent repeated the STALE "web has no test runner" belief — inconsequential: 5.6 is API+docs
  only; the orchestrator confirmed all 791 web tests green in the final gate.) **Phase 5 summary:** the
  console now renders a `qlik_answers` answer as the assistant's own ordered Adaptive-Card block sequence
  (text + hypercube MetricCard/table insets, D-QA8) with footnote citation chips that anchor-scroll to
  data-first insights (D-QA9/D-QA10/D-QA13), structured/deduped reasoning phases (D-QA11), a question-first
  KPI rail with an assistant-identity card and no dead context surfaces (D-QA12), and matching report
  export — ALL derived additively from the persisted `rawResponse` with the grader contract
  (`assistantText`/`reasoning` byte-identical) untouched and verbatim fallbacks on every parse miss, no
  migration. **Owner-acceptance (live browser + real tenant) pending — see the Phase 5 owner-acceptance
  section above.** **NOT pushed to origin (owner-gated).**
- 2026-07-12 · **Phase 5 batch 3 complete — WP 5.4 done** (`wp/qlik-answers/5.4` merged ce81a1a;
  clean-detached-worktree gate green — typecheck; web 86 files 791 passed/5 skipped · api 1557/1557 ·
  shared 5/5; build ✓; lint 734 clean). `SourcesPanel.InsightRow` face now = 5.3's `AnswersSnapshotData`
  (`variant="panel"`, the hypercube data) + `reason`; Qlik expressions demoted to a default-closed
  "Definition" `Collapsible` (relocated `ExprLine`, unchanged — still the report/evidence trail); the
  `<li>` root carries `{...consoleAnchor(insightAnchorValue(index))}` so 5.3's citation chips land. New
  `AnswersReasoning` renders `ReasoningSection[]` (titled prose via `ChatMarkdown`; `assets` → `@brand`
  table asset/type/similarity/glossary, tabular-nums; `draft` → collapsed "Same as answer" disclosure
  when `duplicatesAnswer`, inline otherwise; `raw` verbatim). ConversationPane REASONING block only:
  settled + sections → `AnswersReasoning`, else verbatim `ReasoningContent(reasoning)` (streaming-guarded,
  non-qlik byte-identical). **Correct brand call:** `@brand/ai` `ReasoningContent`'s `children` is typed
  `string` (Streamdown), so the structured branch renders through `@brand/ui` `CollapsibleContent` — which
  is *exactly* what `ReasoningContent` is internally (verified in the vendored `@brand/ai` dist:
  `ReasoningContent = <CollapsibleContent className="mt-4 text-sm …">`); it binds to the SAME `Reasoning`
  Collapsible context + open/close state, no mismatch. **Process note:** the 5.4 agent left its work
  UNCOMMITTED (gate-tested but not committed) — orchestrator reviewed the working-tree diff (scope +
  brand-ui + the CollapsibleContent context) and committed it (da5ac4e) before merging. **Batch 3 done;
  all 5 code WPs (5.1–5.5) on `main`. Only WP 5.6 (report parity + docs) remains.**
- 2026-07-12 · **Phase 5 batch 3 — run SEQUENTIALLY (not the plan's `5.3 ∥ 5.4`); WP 5.3 done**
  (`wp/qlik-answers/5.3` merged 424a9c3; clean-detached-worktree gate green — typecheck; test shared
  5/5 · web 84 files 774 passed/5 skipped · api 1557/1557; build ✓; lint 731 clean). **Why sequential:**
  5.3 and 5.4 are coupled three ways — both edit `ConversationPane.AssistantTurn` (5.3 the PROSE block,
  5.4 the REASONING block + `SourcesPanel`), both render `AnswersSnapshot.data` (one shared component),
  and D-QA9's citation chips (5.3) must anchor-scroll to the insight rows (5.4) via one shared anchor
  scheme — none of which parallel worktrees can share without collisions. So 5.3 first (builds the
  reusable pieces), 5.4 rebased. **WP 5.3:** new `AnswersAnswerView` (ordered `blocks[]` → `ChatMarkdown`
  + citation chips / snapshot insets) + reusable `AnswersSnapshotData` (1×1→MetricCard, else compact
  `@brand` table + honest "Showing N of M") + `insightAnchorValue` in `console-anchors.ts`; ConversationPane
  PROSE block swaps to the block view only for a SETTLED qlik turn (streaming-guarded), else byte-identical
  `ChatMarkdown(assistantText)`; Copy still copies `assistantText`. **Dangling citations handled** (the
  index-5-with-5-snapshots case): out-of-range citation → inert `<sup>` marker (no button/handler/crash),
  out-of-range snapshot block → null. 18 web tests. brand-ui only (`text-caption` not `text-xs`); the one
  `brand-ui-allow` is a test-only `@brand/ai` stub. **Flaky-gate note:** a first recursive `pnpm test` run
  under install+build contention flaked 9 web tests (jsdom-timing files); two isolated web runs + a second
  recursive run were clean 774/774 — transient resource starvation, not a regression (watch for it in CI).
- 2026-07-12 · **Phase 5 batch 2 — WP 5.2 + 5.5 done** (5.2 `wp/qlik-answers/5.2` merged a4c9572; 5.5
  `wp/qlik-answers/5.5` merged 3f94be4; **combined post-merge gate green on a clean detached worktree** —
  typecheck; test shared 5/5 · web 756 passed/5 skipped/81 files · api 1557/1557; build ✓ 22s; lint 726
  files clean). **WP 5.2 (API extraction):** `qlik-answers-message.ts` ordered `cardBlocks` walk → 11
  `AnswersAnswerBlock`s (6 text + 5 snapshot) with per-block `citations`; `snapshotFrom` refactored to take
  the whole snapshot record so it reads BOTH `.source` (existing title/reason/measures/dimensions,
  byte-identical) AND `.data.qHyperCube` for the new `AnswersSnapshot.data` (columns from
  `qDimensionInfo`/`qMeasureInfo` `qFallbackTitle`, rows from `qMatrix` preferring finite `qNum` else
  `qText`, cap 50 + `totalRows`); all 5 real cubes extracted (1×1/20×4/20×2/15×2/20×3). New pure
  `qlik-answers-reasoning.ts` → `ReasoningSection[]` (`understanding`/`rewritten`/`classification`/`prose`/
  `assets`[tabular]/`draft`[`duplicatesAnswer`]/`raw` verbatim fallback); against the real stream:
  understanding·prose·rewritten·prose·assets×3·prose·classification·draft×2 (both drafts flagged
  duplicate). Executor attaches `blocks`+`reasoningSections`; **`GET /api/runs/:id` derives them at READ
  time** for legacy steps via pure `deriveLegacyAnswerStep` (a `.map` projection — no row rewrite, no
  migration). **Grader invariant PROVEN:** `extractAnswerMessage(rawResponse).answer === assistantText`
  (2198==2198); `assistantText`/`reasoning`/`reasoningText` byte-identical; all 6 pre-existing
  `qlik-answers-message` tests + full suite green unchanged. **WP 5.5 (KPI rail):** "Tool calls"→"Questions"
  (Σ `questionsConsumed`), question-first cost tile, `AnswersIdentityCard` (assistant/app id · thread mode ·
  transport) replacing the Context tile; a follow-up refine also gated the `ContextChart` + turn-0
  `BaselineFootprint` OFF for the kind at the `RunConsole` render site (the "No context yet"/never-coming
  baseline the evidence table flags) — shared component sources untouched; non-qlik rails byte-identical
  (dedicated tests). **Carried to WP 5.3:** citation data-index can DANGLE (real run cites `0..5`, only 5
  snapshots) — the chip renderer must no-op an out-of-range index. **Concurrent session** was editing
  Runs-feed/compare web files (`RunsView`/`CollectionTests`/`RunsCompareBar`/`RunsTableHead`/`api.ts`)
  UNCOMMITTED in the shared main checkout throughout — disjoint from every qlik-answers file; merges
  pathspec-committed over them, gate run in `.worktrees/qa-verify` (detached) to dodge their in-flight noise.
- 2026-07-12 · **Phase 5 batch 1 — WP 5.1 done + pre-flight reconciliation** (`wp/qlik-answers/5.1`,
  merged into `main` c3c0b21; post-merge gate green — typecheck; test shared 3/3 · api all-`ok` · web
  746 passed/5 skipped; build ✓; lint 720 files clean). Additive-only shared contract: `AnswersAnswerBlock`
  union (`{kind:"text",markdown,citations?}` | `{kind:"snapshot",index}`), `AnswersStepPayload.blocks?`,
  `AnswersSnapshot.data?` (`columns`/`rows`/`totalRows`, cap 50) + zod (`answersAnswerBlockSchema` exported);
  `packages/shared` also gained a `tsx --test` runner (was untested — net coverage gain, picked up by
  `pnpm -r test` + CI). **Orchestrator pre-flight found the plan partly overtaken by two commits merged
  AFTER the plan was authored** (c1321ac "full answer narrative + Qlik.Snapshot insights" 23:35; 400381d
  "live agent-process streaming" — both before the plan's 02:17): `assistantText` is now the FULL narrative
  (not 6 flat paragraphs) and reasoning is now LIVE-streamed + tag-cleaned (`reasoningText`, answer/reasoning
  channels separated). **Verified still-open & unchanged (evidence table holds for the replayed run):**
  D-QA8 (no `blocks[]`), D-QA9 (citations still `stripCitations`'d), D-QA10 (no hypercube `data` — only
  expression labels; the 5 cubes match the evidence table exactly: 1×1 "AA Market Share %" + 20×4/20×2/15×2/20×3
  carrier matrices, labels from `qFallbackTitle`), D-QA12 (KpiRail kind-aware for token/context LABELS only —
  "Tool calls" not renamed, no identity card), D-QA13 (SourcesPanel `InsightsList` renders snapshots but
  data-less → WP 5.4 EXTENDS it, doesn't build fresh). **Owner decision (AskUserQuestion 2026-07-12): D-QA11
  kept IN FULL** — the phase parser is complementary to 400381d (reasoning is streamed but still an
  unstructured blob on render); `ReasoningSection` wire type assigned to WP 5.2 (see its note). **Concurrent
  session** landed grading work (`87aedc3` validate-whole-conversation) + `research/full-validation/*` docs on
  `main` (354a15c→2d9ec64) — no `packages/shared`/Phase-5-seam overlap; 5.1 merged clean over it. Two
  post-merge gate hiccups were ENV cruft, not 5.1 defects: `tsx` unlinked in the main checkout (fixed by
  `pnpm install` of the merged lockfile) + orphaned gitignored `vitest.config.ts.timestamp-*.mjs` files that
  Biome scans (deleted; vitest cleans its own on a completed run — orphans were from an interrupted run).
- 2026-07-12 · **Phase 5 planned — answer rendering rework.** Analysis of the first real Qlik
  Answers session (run `hHGgqkU58F_xYv0e-nHKC`, in-browser walk + raw payload inspection): the
  Adaptive Card is an interleaved narrative+snapshot sequence with `<citation>` markers and 5
  hypercubes carrying real data (1×1 KPI + four carrier matrices), but the console flattens it to
  6 plain paragraphs, strips citations, discards hypercube data, dumps the 11.6 KB stream (incl.
  two full markdown drafts duplicating the answer) into the reasoning collapsible, and shows
  $0.00/Tool-calls-0 instead of questions. Plan + proposed decisions D-QA8–D-QA13 in
  [`phase-5-answer-rendering.md`](./phase-5-answer-rendering.md); 6 WPs registered above. Key
  design choices: blocks/data **derived from the persisted `rawResponse`** (no migration; legacy
  runs covered at replay read), `assistantText`/`reasoning` byte-identical (graders untouched),
  verbatim fallbacks on every parse miss.

- 2026-07-11 · **Phase 4 cloud-assistants rework — DONE + live-verified** (see the Phase 4 section
  above). **Root cause:** Phases 0–3 executed against the public `/api/v1/assistants/{aid}/threads/{tid}/
  actions/{invoke,stream}` API with `{input:{prompt,promptType}}`; for an **app**-backed assistant that
  binds no data source → "no information", zero sources (API key vs OAuth, scopes, one-shot-vs-thread all
  made zero difference). **Fix:** execute through the internal `/api/v1/cloud-assistants/` API with a Qlik
  Sense **app** data context (`context:{type:"app", id, data:{mode:"live"}}`), resolving the app id from
  the assistant UUID via `GET /api/v1/assistants/{id}` → `appIds[]`. **Decisions:** (1) **D-QA3 amended**
  — the cloud-assistants prompt body has NO `promptType`; thread continuity is the kept thread itself, so
  the opener/follow-up distinction is now only the payload `promptMode` label. (2) **D-QA2 amended** —
  the cloud-assistants prompt API is stream-shaped (JSON-RPC card-patch SSE frames); both `transport`
  values POST to `actions/stream`, and `invoke` only suppresses live console deltas. (3) The evidence
  model for app assistants is **`expressions`** (`qMeasures[].qDef.qDef`), NOT document `sources` (which
  are `[]`); `AnswersStepPayload` gained `appId`/`messageId`/`expressions`/`reasoning`/`rawResponse`
  (additive). (4) **App-id UNRESOLVABLE → terminal `error`** (never a silent wrong answer). **Known
  cosmetic limitation:** the stream's card-patch delta frames are NOT reconstructed into live console
  text (the settled answer, fetched from `…/messages`, is authoritative) — a future enhancement.
  See [[qlik-answers-real-api-is-cloud-assistants]].

- 2026-07-11 · **Kickoff — D-QA1–D-QA7 locked by owner** (see README table). Notable: D-QA1 =
  reuse MCP-server OAuth when the probe proves it, API key fallback (drives WP 0.2's link
  column); D-QA6 = skip incompatible members, don't fail plans.
- 2026-07-11 · **Migration expectation set: WP 0.2 → v23.** `MIGRATIONS` max is v22 today
  (auto-rating WP 4.1 `suite_run_reports`). Re-verify at claim time; bump if a concurrent
  session claims v23 first.
- 2026-07-11 · **Scaffold created** from the research doc; no code yet — every WP open.
- 2026-07-11 · **Trunk consolidated to `main`** (owner directive, pre-implementation). `ux/integration`
  (auto-rating Phases 1–4 + qlik-answers scaffold) **plus** `ux/compare-redesign` (Compare Workspace
  refactor, WP-1..WP-7) merged into `main` and pushed (`origin/main` = `bfe50a3`); combined gate green
  (API 1406/1406, web 723 passed/5 skipped, build, lint); `main`'s tree byte-identical to
  `ux/integration` at merge. **All qlik-answers WP worktrees branch from `main` from here on** (not
  the kickoff's implied older `main`). Pre-batch seam verification (read-only): all 12 research-doc
  §3.2 anchors current, **zero drift**; `MIGRATIONS` max **v22**, `v23` free (WP 0.2 still expected v23).
- 2026-07-11 · **WP 0.1 done** (`wp/qlik-answers/0.1`, merged 351eac0; gate green — API 1406/1406, web
  723 passed/5 skipped, build, lint). Enum + additive wire only; 4 exhaustive-consumer glue sites got a
  `qlik_answers` case (registry `modelFor()` **throws** "uses the answers executor" [final behavior];
  `model-catalog.listAvailableModels()` returns `[]` [WP 0.3 fills the real roster]; compat
  `PROVIDER_KIND_TO_RESEARCH_IDS` `[]`; web `PROVIDER_KIND_LABELS` "Qlik Answers"). Two accepted
  judgment calls: (1) `RunPlanEstimate.answersQuestions` is **type-only, no standalone zod** — response
  types have no zod precedent here and no route validates it (WP 3.2 constructs it). (2) The Settings
  provider-kind `Select` now **lists "Qlik Answers"**, but saving one with just an API key would fail the
  DB `CHECK (kind IN …)` (schema.ts still the original 5 kinds) — inert interim side-effect; **WP 0.2
  must widen that CHECK (table rebuild) as part of its migration**, and WP 0.3/2.3 give the kind a real
  form. Canonical `answersStepPayloadSchema`/`answersSourceSchema` exported for WP 1.1/3.1 to reuse.
- 2026-07-11 · **WP 0.2 done** (`wp/qlik-answers/0.2`, merged 79ad5b2; gate green — API 1421/1421, web
  723 passed/5 skipped, build, lint). Migration **v23** claimed (re-verified free). CHECK-widening
  needs the SQLite 12-step **table rebuild** (`rebuildProviderCredentialsForServerLink`, mirrors v16):
  widen `provider_credentials.kind` + add `mcp_server_id` (FK `mcp_servers` ON DELETE SET NULL), rows
  copied by same `id` so BOTH child FKs (`scenarios.provider_id` RESTRICT + `assistant_settings`
  .fallback SET NULL) stay valid; runner already runs FK-off + `foreign_key_check`; self-guards on
  table + column presence → idempotent on a v22 DB + no-op on fresh. Dual auth via new
  `providers/linked-auth.ts` (`McpServerLinkedAuth`, DI'd, synchronous local resolve — no tenant
  contact): a linked cred's `getDecrypted` yields a resolved bearer(`apiKey`)+origin(`baseUrl`); broken
  link → fixed **non-leaking** 400 + `authBroken` redacted flag; `redact()` computes it via a caught
  resolve attempt. Additive redacted fields `linkedServerId`/`authSource`/`authBroken` (ids/flags, no
  secrets). Secret-leak proofs in tests. **Seam for 1.1/0.3:** `DecryptedCredential` = `{kind, apiKey
  (raw bearer, no "Bearer "), baseUrl (origin), mcpServerId?}`; downstream sets `Authorization: Bearer`.
- 2026-07-11 · **WP 0.3 done** (`wp/qlik-answers/0.3`, rebased on 0.2, merged 67b5b26; gate green — API
  **1427/1427**, web 723 passed/5 skipped, build, lint). `model-catalog.listQlikAnswers()`: bearer-authed
  `GET /api/v1/assistants`, cursor paging via `links.next.href`, injectable `FetchLike` (stub-tested, no
  real tenant), `MAX_PAGES` guard, pure `parseQlikAnswersAssistants` (id+name). `registry`/`accounting`
  **untouched** (confirmed plain `default:` fallthroughs already correct for the kind — no case needed).
  Settings form: Tenant-URL + API-key fields + read-only linked/`authBroken` badges (brand-ui, no raw
  colors), reads 0.2's redacted fields via a defensive local cast. **D-QA7 classic-only filter — OPEN
  ITEM (owner-decided: ship all, defer):** the public Qlik assistants API (OpenAPI spec + generated TS
  types, checked 2026-07-11) exposes NO classic-vs-agentic distinguisher (`type`/`kind`/`mode` absent;
  only an undocumented `legacy` flag). Owner decision 2026-07-11: return every assistant (documented in
  `listQlikAnswers`), revisit when a live tenant confirms a real field. **Live-verification item** →
  added to Owner-acceptance. Minor follow-up: 0.3's SettingsView `qlikAnswersAuthMeta` cast is now
  redundant (0.2's fields are on `ProviderCredential`) — harmless, tidy opportunistically later.
- 2026-07-11 · **Concurrent session on the main checkout** (per [[concurrent-autocommit-in-repo]]): while
  landing batch 2, the assistant-dock workstream was editing `apps/api/src/assistant/*` + web
  `App/AppShell/AssistantDock*` **uncommitted** in the shared main worktree. qlik-answers merges touch
  disjoint files, so they float over it; landed via merge-into-main-while-on-`main` + pathspec ledger
  commits (never `git add -A`), re-verifying `origin/main` before each push. Do not touch those files.
- 2026-07-11 · **WP 1.1 done** (`wp/qlik-answers/1.1`, merged a54de98; gate green — API 1436/1436, web
  723/5 skipped, build, lint). `testing/qlik-answers-executor.ts` `runQlikAnswers(runId,cfg,emit)→
  LoopResult`, emits the exact §3.3 vocabulary (`status running` → `user_message` step → ONE
  `llm_response` step w/ `assistantText`=full answer + `AnswersStepPayload` → `kpi` turns1/toolCalls0/est
  tokens → terminal). **Seam for WP 1.2 = `QlikAnswersRunConfig`** `{assistantId=scenario.model,
  prompt=test.userPrompt, auth={apiKey,baseUrl} from resolved DecryptedCredential, profiles,
  transport?(default invoke), maxRunDurationMs?, abortSignal?, fetchImpl?}`. Per-request pricing entry in
  `pricing.ts` (`PerRequestPricing`/`PER_REQUEST_PRICING`, empty → cost 0, never blocks). Structurally
  attach-free. **Judgment calls (accepted):** (1) **AE-4 → `outcome:"stopped_guardrail"` + free-form
  `stopReason:"prompt_rejected"` + `rejected:true`** (NOT a new RunOutcome — `RUN_OUTCOMES` unchanged; the
  assistant's own guardrail is a gradeable stop, kept out of the error-forensics bucket). (2) **AE-4 sets
  `assistantText:""`** (a refusal has no answer → graders read `unevaluable`) — REVISIT on live AE-4 (if
  the invoke response carries rejection text, WP 3.1 may surface it). tool_hygiene `unevaluable` (no
  tool_call steps). Deadline timer intentionally NOT `unref`'d (only in-flight work is one `fetch`).
- 2026-07-11 · **WP 2.1 done** (`wp/qlik-answers/2.1`, rebased on 1.1, merged b3bf071; gate green — API
  **1455/1455**, web 723/5 skipped, build, lint). `servers/qlik-detect.ts` (URL-based, verbatim mirror of
  web `isLikelyQlikMcpUrl` + tenant origin) + `servers/qlik-answers-probe.ts` (list-only: GET
  `/api/v1/assistants` with the server's own creds — OAuth token / decrypted headers reused via
  `McpServerLinkedAuth` precedents; 401/403 → `needsOwnKey`). `POST /api/servers/:id/qlik/answers-probe`;
  `qlikTenant` folded into `POST /api/servers/probe` + `checkConnectivity`; **additive
  `ConnectivityResponse.qlikTenant?`** (only shared change). **List-only BY CONSTRUCTION** — the module
  imports no invoke/stream helper and a source-level test asserts the executable code has no
  `invoke`/`stream` substring (only `api/v1/assistants`); a probe can never consume a question. Secrets
  never in any response/error (bearer only into the `Authorization` header; proven by `JSON.stringify`
  greps in tests). 4 auth flavors + 401/403 + non-Qlik/stdio tested. **Honest gap:** no route-level
  integration test for `ScanService.checkConnectivity`'s fold (no existing harness — covered by typecheck
  + the tested injected prober). Phases 1–2 executor+detection foundations now on `main`.
- 2026-07-11 · **Fix-forward on a concurrent RED main (owner-authorized).** The parallel session's
  commit `636c426` (mis-titled "add RouteCrumb context" but ~60 files: compatibility/model-data/oauth/
  assistant/collections/compare) landed on **local** main (origin/main stayed green at 1b23f3a) and was
  **RED**: it edited the research token-context data but left the derived bundle stale → the
  `all-models.json is not stale` SoT test failed (and cascaded shared-state pollution into an
  order-dependent oauth test). Owner chose "I fix forward": regenerated the bundle via
  `pnpm build:model-data` (2 files: `all-models.json` + `model-data.generated.ts`; never hand-edited —
  see [[model-data-sot]]), committed on top of `636c426`. Full API suite green 1460/1460; both failures
  cleared. See [[concurrent-autocommit-in-repo]].
- 2026-07-11 · **WP 1.3 done** (`wp/qlik-answers/1.3`, rebased on fixed main, merged a2c5cb8; gate green —
  API tests, web, build, lint). `testing/qlik-answers-stream.ts` chunked-JSON parser (depth-counted
  top-level objects, tolerant of `}{` split across network chunks + partial fragments + trailing
  `sources`) fills the executor's `performPrompt` `stream` branch → `delta` events (`{type:"delta",
  channel:"text", text, turnIndex:0}`, matches `engine.ts`) + returns the SAME `AnswerResult` so
  downstream emit is byte-identical to invoke. Parser fuzz tests (8 re-split strategies incl. byte-by-byte
  + exact `}{`). Recommends WP 1.2 pass `answersMode.transport` (default `stream`, D-QA2) explicitly (the
  executor's internal `?? "invoke"` fallback left untouched, now vestigial).
- 2026-07-11 · **WP 2.2 done** (`wp/qlik-answers/2.2`, rebased on fixed main, merged a3a2ab4; gate green —
  API 1460/1460, web 721 passed/5 skipped [81 files], build, lint). `QlikAnswersOfferDialog` (post-save
  wizard offer: probe → consent → `createProvider` [linked-auth if `!needsOwnKey`, else API-key step] →
  `listProviderModels` → one locked empty env per selected assistant, "Qlik Answers — <name>",
  `answersMode:{transport:"stream"}`) + ServersView "Answers available" badge + `Wand2` CTA (re-probed on
  select + scan) + `probeServerAnswers` client. brand-ui, consent-gated. **Rebase conflicts vs `636c426`
  (App/ServerWizard/ServersView) resolved keep-both** — incl. honoring 2.2's `text-xs`→`text-caption`
  role-token fix (brand-ui taxonomy guard flagged `text-xs`). **Documented scope limit:** the ServersView
  CTA doesn't de-dup an already-onboarded server (re-running the offer would create duplicate
  provider/envs) — not in acceptance; a later follow-up. **Owner-acceptance:** both-theme + keyboard walk
  of the offer/badge, and the live-tenant flow.
- 2026-07-11 · **WP 1.2 done** (`wp/qlik-answers/1.2`, merged cb11d89; gate green — typecheck; API
  **1477/1477** [+6]; web; build; lint). **Keystone:** an additive early-return in `execute()` BEFORE
  `resolve()` — `resolveAnswers()` returns a `QlikAnswersRunConfig` for a `qlik_answers` cred (else
  `undefined` → the original `resolve()`+`runAgentLoop` lines run byte-for-byte). Structural clean-session
  (no MCP session/tool/skill; `sessions` stays empty). Non-qlik path **provably undisturbed** — all 1471
  pre-existing tests green (agent-loop covered by run-stream-routes/grading/skillflow suites). Lightweight
  resolution reuses `test.userPrompt` + `resolveProfiles(scenario,test)` (same lens as the agent loop);
  `transport = answersMode.transport ?? "stream"`. Optional `answersFetch` constructor seam (stub in
  tests, global fetch in prod). Grading fires post-terminal (`tool_hygiene` → `unevaluable`). Suite/
  collection/adhoc route through it via `RunService.start`. **Accepted design deviation (interactive
  turns):** a literal post-terminal append is a no-op (RunManager/RunRepository close on terminal — fixing
  it needs the FORBIDDEN `run-repository`/`run-manager`), so an interactive qlik run stays **LIVE**
  (never terminal after the opener) and reuses the EXISTING turn queue (`nextTurnProvider`/`control.
  pendingTurn`) — the existing `POST /api/runs/:id/turns` bridges in with **no routes.ts change**; opener
  omits `promptType` (one-shot), each follow-up continues the kept thread with `promptType:"thread"`
  (D-QA3), 1 question/turn. Arguably more correct (a live session shouldn't read "completed" after turn 1).
- 2026-07-11 · **⚠️ Two gaps for later WPs (surfaced by WP 1.2; not blockers — 1.2 behaves correctly):**
  (1) **`answersMode` is NOT persisted server-side** — WP 0.1 added the type + `scenarioInputSchema`
  field, but `scenario-repository.ts` doesn't write/read it and there's no `answers_mode` column, so
  `scenario.answersMode` is always `undefined` → 1.2 defaults to `"stream"` (correct per D-QA2). **The
  per-env `invoke` override won't take effect until persistence is added** (migration + repo). **→ FOLD
  INTO WP 2.3** (which adds the transport toggle UI) or a micro-fix; check first whether scenarios store
  config as JSON (no migration) vs columns (migration v24). (2) **`estimatedTokens` is stripped on
  persist** — its key matches `run-repository.ts`'s `…Tokens` secret-strip heuristic (a boolean false
  positive), so the flag is dropped from the persisted step payload (present on the live event only).
  **→ WP 3.2** should mark KPI tokens "est." **by provider kind** (`qlik_answers` ⇒ always estimated),
  robust to the strip — or exempt the flag in `run-repository.ts`.
- 2026-07-11 · **Phase 1 executor path COMPLETE** (WP 1.1–1.5? no — 1.4/1.5 remain): the run engine now
  routes `qlik_answers` runs end-to-end (branch → executor → invoke/stream → grading), stub-tested. Clean-
  session ENFORCEMENT (WP 1.4, plan-time skip + scenario write-reject) and the throttle (WP 1.5) still open.
- 2026-07-11 · **WP 2.3 done** (`wp/qlik-answers/2.3`, merged; gate green — API 1480/1480, web 731/5
  skipped, build, lint). **Migration v24** (additive guarded `ensureColumn scenarios.answers_mode TEXT`,
  no rebuild) + `scenario-repository` write/read → **closes the WP 1.2 `answersMode` persistence gap**
  (a test proves a persisted `transport:"invoke"` actually reaches `/actions/invoke`). `EnvironmentEditor`
  gates on `kind === "qlik_answers"`: hides servers/skills + `maxTurns`/`maxContextTokens`/`maxToolCalls`,
  keeps + **newly exposes** `maxRunDurationMs` (a pre-existing UI gap), transport toggle via `SegmentedField`
  (`@brand ToggleGroup`). Both-theme/keyboard walk = owner-acceptance.
- 2026-07-11 · **WP 1.4 done** (`wp/qlik-answers/1.4`, merged; gate green — API 1495/1495, web 721/5
  skipped, build, lint). 3 layers: **L1** `scenario-service.assertCleanSession` (create/update reject a
  `qlik_answers` scenario carrying servers/skills → 400; cheap `ProviderRepository.get` kind lookup, no
  decrypt); **L2** `orchestrator.startPlanRun` — D-QA6 marks incompatible members (attachments /
  `systemPromptOverride` / legacy servers-skills) `skipped:"incompatible"`, filters them from the
  scheduler, all-skip → 400, variant plans on the kind → 400 (pure logic in new `member-compatibility.ts`;
  chose `startPlanRun` over `plan-routes.resolveRunPlan` because it's the single entry for suite/
  collection/adhoc — `resolveRunPlan` isn't on the `POST /api/suites/:id/run` path); **L3** structural
  (cited WP 1.2's zero-session test). Skip travels `SuiteCell.skipped` → `SuiteAggregates.skippedMembers`
  (cached on the existing `aggregates_json` — **no migration**) → `SuiteReport.skippedMembers` (additive
  shared). **Compat-CTA hide N/A** — exhaustive search found NO web caller of `/runs/:id/compatibility`
  (route built by testing WP 5.6, never wired to UI); did not fabricate one; flagged for testing WP 5.7.
- 2026-07-11 · **⚠️ Concurrent 'toolbar' orchestration collision + recovery** (see
  [[concurrent-autocommit-in-repo]]). Mid-batch-5 the other session started its OWN parallel orchestration
  (local `toolbar/integration` branch + `wp/tb/*` worktrees) and **switched the shared main checkout to
  `toolbar/integration`** — so my WP 2.3 `git merge` landed on THAT branch (`be8f0bf`), not `main`. Work
  intact (branches fine; earlier 8 WPs safe on origin/main). **Owner: "dedicated worktree + continue".**
  Recovery: created `.worktrees/main-int` on `main`, re-merged `wp/qlik-answers/2.3` + `1.4` cleanly there.
  **Going forward ALL qlik-answers main integration happens in `.worktrees/main-int` — never the shared
  checkout** (which the toolbar session controls). The stray `be8f0bf` on `toolbar/integration` is harmless
  (git dedups 2.3's commits when either path reaches main).
- 2026-07-11 · **WP 1.5 done** (`wp/qlik-answers/1.5`, merged via `.worktrees/main-int`; gate green — API
  1508/1508 [+10], web 731/5 skipped, build, lint). Orchestrator per-provider cap
  `QLIK_ANSWERS_MAX_CONCURRENCY = 4` (process-local `Map<providerId,count>` shared across suite runs — the
  Tier-2 100/min limit is per credential; a parked-resolver slot queue, no deadlock/busy-loop;
  `claimRunnableCell` = `queue[0]` byte-identical for non-qlik so the full `maxConcurrency` is preserved).
  Executor `requestWithRetry` wraps thread-create/invoke/stream, retries HTTP 429 / `AE-6` only
  (exp backoff 200ms→4s + ≤25% jitter + `Retry-After`), honoring abort/deadline → `aborted` (never past
  it); AE-4 + every other AE-x single-attempt as before; 1 question on eventual success (429s uncounted).
  Injectable `retrySleep`/`retryRandom` on `QlikAnswersRunConfig` (no real sleeps in tests). Non-qlik
  scheduling proven undisturbed (`benchmarks-orchestrator` maxConcurrency-bound test green).
- 2026-07-11 · **PHASE 1 (executor) + PHASE 2 (detection) COMPLETE — 11/14 WPs on origin/main.** All done
  except Phase 3: **3.1** (console sources panel + Etag drift) · **3.2** (cost surfaces — launcher
  `answersQuestions` preview, KPI "est." labels [do est-by-kind per the WP 1.2 gap], suite question totals) ·
  **3.3** (docs — CLAUDE.md row → ✅, research addendum, owner-acceptance checklist). Batch 6 next.
- 2026-07-11 · **WP 3.1 done** (`wp/qlik-answers/3.1`, merged; gate green — API 1508/1508, web 743/5
  skipped, build, lint). New `SourcesPanel.tsx` on the answer step (`@brand` Collapsible citation list;
  `rejected:true` → a "prompt declined" Alert) + assistant-version (Etag) **drift badge** vs the previous
  run of the same test×environment (existing `GET /api/runs` + `getRun` — no new endpoint). `RunConsole`/
  `ConsolePanel` untouched (wired via `ConversationPane`). **Orchestrator review-fix:** `answersPayloadOf`
  narrows on **`promptMode`** ("oneshot"/"thread"), NOT `estimatedTokens` — run-repository redaction turns
  the boolean `estimatedTokens` into `"[redacted]"` on persist (a `…Tokens`-keyed non-number, line ~636),
  so the original discriminator worked LIVE but broke on REPLAY; `promptMode` survives. +1 replay test.
- 2026-07-11 · **WP 3.2 done** (`wp/qlik-answers/3.2`, merged; gate green — API 1511/1511, web 743/5
  skipped, build, lint). Estimate service computes `RunPlanEstimate.answersQuestions` (qlik envs × tests ×
  reps); `RunLauncher` CostPreview shows the multiplier + shared-quota note. `KpiRail` marks token figures
  "(est.)" + context "N/A" for `qlik_answers` **by provider kind** (threaded via `RunConsoleRoute`'s
  existing `listProviders` — robust to the `estimatedTokens` persist-strip [WP 1.2 gap], `run-repository`
  NOT touched). Suite question totals in `SuiteKpiRail`. **Two accepted deviations:** (1) touched
  `RunConsole.tsx`/`RunConsoleRoute.tsx` for pure `providerKind` prop-plumbing (KpiRail is a leaf); (2) the
  suite total is **derived client-side** in `SuiteRunConsole.tsx` (count members with outcome
  `completed`/`stopped_guardrail` = the executor's 1-question branches) because the "proper" home
  (`SuiteAggregates.answersQuestions`) is a forbidden shared/suites edit — **exact by construction but
  couples web to the executor's outcome branches** (future: a backend field like the 1.4 `skippedMembers`
  precedent). **Web-test gap:** the KpiRail/RunLauncher/suite-total display logic is code-reviewed +
  build/typecheck/lint-green but NOT unit-tested (the agent believed the repo had no web test runner — a
  stale CLAUDE.md note; it does). Backend estimate computation IS unit-tested (3 tests). Low-risk display
  logic; a follow-up could add web tests. Both-theme walk = owner-acceptance.
- 2026-07-11 · **WP 3.3 done (docs, orchestrator).** CLAUDE.md capability row flipped **🔜 → ✅** (all 14
  WPs, honest "stub-tested, no real tenant; owner-acceptance pending"); research-doc status header updated
  to **BUILT** with the live-verification notes; owner-acceptance section below unchanged (still the
  authoritative live-tenant checklist).
- 2026-07-11 · **🎉 PLAN COMPLETE — all 14 WPs done, on origin/main, gate green (API 1511, web 743/5).**
  qlik-answers is BUILT end-to-end and stub-tested. **Nothing was ever run against a real Qlik tenant** —
  the entire Owner-acceptance section below (live probe/run/suite, both-theme + keyboard walks, D-QA7
  distinguisher, AE-4, MCP-OAuth-token question) is unverified and needs a real Qlik Cloud tenant. Known
  follow-ups (non-blocking, logged above): WP 3.2 web tests + backend suite-question field; the WP 2.2
  offer-dedup; the WP 3.1 note. Landed via `.worktrees/main-int` throughout the toolbar-session collision.
