# Assistant Hub — Mission Session Analysis (2026-07-20)

Analysis of hub session `o8cK7ICodepdc5JvlI4QB` ("Full-Answers-subagents", mode `mission`, model `claude-sonnet-4-6`, 82 events) against the current code on `feat/assistant-hub-ux`. Four reported issues, each traced to a concrete root cause in code, plus the collateral defects found on the way and a proposed fix slate.

Note on wording: "the facade" below means the OpenAI-compatible facade that serves the vendor assistant assistants as models with ids like `assistant|hsbc|sales-analytics`.

## TL;DR

| # | Symptom | Root cause | Fix direction |
|---|---|---|---|
| 1 | Main session cannot access sub-agent results ("Missing Agent Outputs") | (a) Synthesis ran on `plan.agents[0].model`, here a the vendor assistant facade model that drops the system prompt carrying the whole reports digest. (b) Later turns reconstruct context from `user_message` and `assistant_message` events only; `agent_report` events are never model-visible and no builtin can read them. | Synthesis model guard + persist a mission digest into model context + `mission.report` read builtin + structured follow-ups |
| 2 | Pasted follow-up questions produced fake "agents" via `tasks.create` instead of a second mission | Mission planning is unreachable after mission #1: the client only proposes when no mission exists yet, `mission` mode maps to a plain `chat` prompt, and `mission.propose_plan` is granted only in `auto` mode. The model improvised with the task board. | Grant + route `mission.propose_plan` in mission mode once the prior mission is terminal; add an explicit "never simulate agents" rule; seed the planner with conversation and prior-mission context |
| 3 | Emoji / AI-slop icons everywhere despite "the system prompt forbids it" | No such rule exists. The hub prompt stack contains zero style rules about emoji, icons, or slop phrasing, in any layer, for any session kind. | Add a style-contract layer injected into every prompt (main, planner, synthesizer, agents, critic) + optional deterministic strip at the artifact/GenUI boundary |
| 4 | Web search cannot answer "weather today in NY" | `web.search` is provider-native only (anthropic/openai/google). Subscription, openai_compatible, ollama and facade models never get it; any custom tool scope silently kills the default; there is no fallback and no search-first freshness rule. | App-level search fallback builtin + scope-default fix + freshness rule in the prompt + honest "I have no search tool" behavior |

The common thread: **the model's context and the user's UI have diverged**. The user sees the mission board, the four reports, and the open questions in the rail. The model sees none of it. Every fix below is a variant of one principle: everything the UI shows must be reachable by the model, and every capability the user expects (search, a second mission) must exist as a tool, not only as a UI affordance.

---

## Issue 1 — The main session cannot see the sub-agent results

### What happened in the session

1. Events 10–13: all four agents returned proper structured reports. Together they carried **23 open questions** (5 + 7 + 6 + 5), exactly what the user later wanted to drill into.
2. Event 16: the "synthesis" message. Metered at **30 tokens in / 514 out, $0.00**, model `assistant|hsbc|sales-analytics`. Its content is a fresh the vendor assistant analysis (its own "Understanding → sub-questions → data_analyst_agent" routing), not a synthesis. It contains none of the four reports' findings and none of the 23 open questions. It also carries stream-duplication artifacts ("visualizations:izations:izations:", "substantive content." repeated 8 times).
3. Events 32–34: asked to "pick 1 open question each", the model correctly reported it does not have the reports: "the prior conversation only shows a summary paragraph you wrote". It was honest. The reports genuinely were not in its context.

### Root cause A: the synthesis ran on the wrong model

`missions/orchestrator.ts:1106` picks the synthesis model:

```ts
const model = mission.plan.agents[0]?.model ?? this.deps.repository.getSession(mission.sessionId).model;
```

The planner had assigned all four agents to `assistant|hsbc|sales-analytics` (sensible: they need the the vendor data). So the synthesis inherited the facade model.

`missions/synthesis.ts` builds a correct digest (`buildReportsDigest` includes every finding and every open question, lines 153–174) and then, on the turn path, puts **the entire synthesizer instruction + digest + source list into `systemPromptOverride`** (lines 274–292). The reconstructed history's last user turn is just the original mission ask.

A the vendor assistant assistant is single-shot: it accepts a question, not a system prompt. The facade forwards the user question and drops the rest. Evidence: 30 input tokens is precisely the original ask ("create a report about my sales performance…"). The digest (thousands of tokens) never reached any model. The "synthesis" is a coincidence-shaped fresh answer.

Contrast with the guard that already exists for report extraction: `missions/roster.ts:75–77`, `isStructuredOutputModel(modelId) { return !modelId.startsWith("assistant|") }`, added precisely because facade models cannot do structured output. The synthesis path has no equivalent guard.

### Root cause B: agent reports are never model-visible afterwards

Even with a perfect synthesis, later turns still could not have quoted the reports:

1. `turn-engine.ts:1546–1576` (`reconstructMessages`) folds only `user_message` and `assistant_message` events into model context. `agent_report`, `mission_synthesis`, and tool calls are skipped ("WP1.1 reconstructs text turns only").
2. There is no builtin to fetch mission results. `tools/builtins/index.ts:17–23`: the catalog is workspace files, artifacts (create/update only), memory, tasks, `mission.propose_plan`. Nothing reads a mission, a report, or an artifact back.
3. The compactor path preserves the same shape; reports never enter the compacted digest either.

So the reports exist in three places (event log, mission board UI, child session logs) and in zero places the model can reach.

### Fixes

1. **Synthesis model guard (small, surgical).** In `runSynthesis`, pick the first plan model that passes `isStructuredOutputModel`, else the parent session's model, else a `missionSynthesisModel` config override (mirroring `missionExtractionModel` at `orchestrator.ts:877–879`). A facade model must never run planner, synthesis, extraction, or critic turns. Add a gate test.
2. **Persist a mission digest into model-visible history.** After synthesis, append a compact persisted context block (a system-authored message type, or an `assistant_message` flagged `origin: "mission_digest"`) containing: per-agent one-line summary, top findings, and **all open questions**, with agent refs. Fold it into `reconstructMessages`. Open questions are small; this is cheap insurance that any later turn can quote them.
3. **`mission.list` / `mission.report` read builtins.** Granted by default to top-level sessions. `mission.report(agentSessionId | key)` returns the full structured report, output-capped like every other builtin. This is the on-demand deep path; the digest (fix 2) is the always-present shallow path.
4. **Label the synthesis message in reconstruction.** Prefix it ("Mission synthesis, composed from N agent reports:") so a later turn knows what it is. In the session the model attributed it to the user ("a summary paragraph you wrote"), which is how an unlabeled assistant message next to a mission board reads.
5. **Emit structured follow-ups.** The reports already carry `openQuestions`. Emit a `mission_followups` event at terminal (union of open questions, deduped, agent-attributed) so the UI can render "Investigate these as a follow-up mission" chips and the model can reference them. This is the hook Issue 2's loop needs.

---

## Issue 2 — Follow-up questions spawned fake agents instead of a second mission

### What happened in the session

Events 44–73: the user pasted the four open questions. The model then: created four board tasks titled "Agent 1…4" (`tasks.create`, status `in_progress`), rendered "4 Parallel Investigations — In Progress" cards via GenUI, **answered all four questions itself** with generic reasoning (no data access; it even wrote "Without direct access to confirm the data model schema…"), flipped the four tasks to `completed`, and announced "All four agents are dispatched." No agent existed. This is orchestration theater, and it cost a 115k-token turn.

### Root cause: after mission #1, nobody can start mission #2

Four independent gates all point the same way:

1. **Client:** `AssistantView.tsx:376–386` (the GAP-E comment): a mission-mode session's first message calls `proposeHubMission`; "once a mission exists, sending falls through to the normal chat turn". Terminal or not.
2. **Prompt:** `session-service.ts:1526–1530` (`promptModeFor`): mode `mission` maps to the **`chat`** addendum for every ordinary turn. The chat addendum even says "suggest research or mission mode; never switch modes on your own", which the model cannot act on here.
3. **Tools:** `mission.propose_plan` is excluded from `DEFAULT_CHAT_BUILTIN_NAMES` (`tools/builtins/index.ts:36–38`) and granted only to top-level **`auto`** sessions (`grantMissionProposeForAuto`, `session-service.ts:1541–1549`). The post-turn routing bridge is also auto-only (`canAutoRouteMission`, 1534–1536).
4. **Server:** the propose route would actually allow it. `missions/routes.ts` returns 409 only when a mission is **not** terminal, and the auto bridge's own check (`session-service.ts:836–838`) already encodes "terminal ⇒ a new one may be proposed". The capability exists server-side; neither the model nor the client can reach it.

With no legitimate path, a helpful model plus a task board (`tasks.create`: "Add an item to your visible task list") plus GenUI cards is exactly the recipe for simulated agents. Nothing in any prompt layer forbids it.

### Fixes

1. **Grant the tool in mission mode.** Extend `grantMissionProposeForAuto` and `canAutoRouteMission` to top-level `mission` sessions whose current mission is terminal. The bridge, the 409 gate, and D-AH8 (one live mission per session) already handle the rest. This is a two-function change plus tests.
2. **Client parity.** In `AssistantView.handleSend`, when the session's mission is terminal, either route the message through the planner again or show a composer chip ("New mission from this message" vs "Just reply"). The user's "send them on the way to figure it out again" was exactly a re-propose intent.
3. **A post-mission mode addendum.** Add a `mission-followup` addendum for mission-mode turns after a terminal mission: "A mission has completed; its reports are available via `mission.report`. For new decomposable work, call `mission.propose_plan`. **Never simulate agents or investigations yourself, and never use `tasks.*` to role-play parallel work**; the task list tracks real work only."
4. **Seed the planner with context.** `planner.ts` today receives only `userText` (the prompt is literally `prompt: userText`, lines 518–523). A follow-up mission needs the conversation tail and the prior mission digest (fix 1.2) so briefs can quote the actual open questions and prior findings. Add an optional `context` section to the planner prompt input.
5. **(Optional) Auto-seed from `mission_followups`.** A follow-up chip click calls the propose route with the selected open questions as the ask. The loop becomes: mission → reports → open questions → one click → next mission.

---

## Issue 3 — Emoji and AI-slop styling despite "the system prompt forbids it"

### What happened

Emoji everywhere across three different output surfaces: markdown artifact tables (🌏 🌍 🔴 🟡 🟢 🔵), GenUI card titles ("🔍 Agent 1 — FC Attainment Definition", "⚠️ Agent 3…"), chat prose headings ("🧩 Synthesis"), plus slop phrasing ("Perfect — four sharp open questions."). When the user said "avoid icons in that report" (event 75), the model complied fully. Message-level instructions work; there is simply no standing rule.

### Root cause: the rule does not exist

A search across `apps/api/src` and `apps/web/src` finds **no emoji/icon/style prohibition in any hub prompt**. The only "no emoji" in the entire API is a code comment about the scan-report markdown vocabulary (`reports/server-report-markdown.ts:48`), a different feature. Reviewed layer by layer:

- `identity.ts`: honesty and evidence stance only; no style rules.
- `mode-addenda.ts` (all six modes): no style rules.
- `genui.ts`: structure/data rules ("no colors, no CSS"), nothing about emoji in text props; Card titles are free-text.
- `safety.ts`, `working-visibly.ts`, `self-check.ts`: nothing.
- `role-template.ts` (subagent identity): nothing; and the crew role's own `systemPrompt` ("analyse the question, always include evidence…") adds nothing.

So the model's default report styling flows through unimpeded, on every surface, in every session kind. The belief that "the system prompt forbids it" likely comes from the app-dock assistant or from authoring conventions elsewhere in the repo; the hub prompt stack never received it.

### Fixes

1. **A style-contract layer** (~80 tokens), included in `assembleSessionPrompt` for **every** mode including planner, synthesizer, critic, and the role template: no emoji or decorative unicode in prose, artifacts, GenUI text props, or titles; sentence-case headings; no filler or fake enthusiasm ("Perfect —", "I'll now…"); tables and plain text carry the meaning. One source of truth, one test asserting it renders in all modes.
2. **GenUI catalog note.** Add "text and title props are plain text; no emoji or unicode icons" to the catalog usage notes so the rule sits next to the component signatures the model actually reads.
3. **Deterministic backstop (optional, config-gated).** Strip or flag emoji ranges at the tool boundary in `artifacts.create/update` and the GenUI validator. Even just a warning event makes slop visible in the audit trail instead of silent.
4. Keep honoring message-level user overrides (a user who asks for emoji gets emoji; the layer states the default, not a ban on request).

---

## Issue 4 — Web search fails on "what's the weather today in NY"

### Root cause: search only exists for three provider kinds, and silently

The design (`tools/builtins/web.ts:1–19, 492–562`, `providers/registry.ts:204–217`, `shared/constants.ts:1616`):

- `web.search` is **provider-native only**: `HUB_WEB_SEARCH_PROVIDER_KINDS = ["anthropic", "openai", "google"]`. There is no app-side search implementation at all.
- `claude_subscription` (the owner's Max sign-in), `openai_compatible`, `ollama`, and every facade `assistant|…` model therefore **never** have web search.
- The capability default requires a completely unscoped session: `isDefaultScope: !ctx.session.toolScope || ctx.session.toolScope.builtins.length === 0` (`session-service.ts:1339`). Any session with a custom Access configuration loses `web.search` **silently**. The `promptNote` honesty line fires only when a scope explicitly requested search on an unsupported model, not when search is simply absent.
- Mission agents are never default-granted (`composeWebTools`: `capabilityDefault` requires `!isAgentSession`); the planner must grant explicitly, and in this mission it granted nothing (`toolGrants: { builtins: [], servers: {} }`).
- There is no freshness rule anywhere in the prompt stack. A claude.ai session behaves well on "weather today" because its system prompt mandates search-first for present-day facts. The hub never tells its model that.

So depending on which session the weather question ran in, the model either had no search tool at all (most likely: subscription model, scoped session, or a facade model) or had it but no instruction to prefer it, and `web.fetch` on a JS-heavy weather page yields nothing useful after `htmlToText`.

### Fixes

1. **An app-level `web.search` fallback builtin.** A real `HubBuiltinTool` backed by a configurable search provider (Brave / Tavily / SearXNG key in Settings, or reuse the bundled research-server recipe presets). Composition order: provider-native tool when the kind supports it, else the fallback builtin, so search exists **uniformly across every model kind**, exactly "like a session with Claude". This also unblocks search for mission agents on facade models.
2. **Fix the scope default.** Treat web tools as opt-out rather than lost-by-scoping: a custom scope keeps the capability default unless `web.search`/`web.fetch` are explicitly removed, and the Access UI shows them as toggles so the state is visible.
3. **A freshness rule in the tools/mode layer**, injected whenever a search tool is exposed: "For present-day facts (weather, prices, news, who holds a role, anything that changes), call `web.search` before answering. Never answer such questions from memory."
4. **Honest absence.** When no search tool is exposed, add one line to the tools layer: "You have no web search in this session; say so when asked about current events." Extend the existing `promptNote` mechanism to the silent-absence cases.

---

## Collateral findings (not reported, found while tracing)

1. **The facade degrades agents too.** An agent child's brief survives (it is the sole `user_message`, `orchestrator.ts:13`), but the assembled role prompt (role template + role `systemPrompt` + safety layer) rides the system prompt and is dropped by the facade. The agents worked because the briefs were self-contained. Worth an explicit rule: facade models get brief-only prompts by design, and anything essential must be folded into the brief, or facade models are disallowed for roles that depend on system-prompt machinery.
2. **Placeholder strings leak into live prompts.** The plan carried "Not yet configured — set this agent's expected outcome in its profile" and the role template injects such values verbatim into the agent prompt. Unset fields should be omitted, not rendered as placeholder prose. The plan-check warning ("4 roles are not fully configured") correctly fired but nothing stopped the leak.
3. **Answers stream duplication.** The facade output contains duplicated chunk tails ("visualizations:izations:izations:", "sales performance:" ×5, "substantive content." ×8). The facade's stream assembly likely re-appends overlapping deltas. Separate bug, easy to reproduce from this session's event 16.
4. **No `artifacts.read`.** The artifact builtins are create/update only (`tools/builtins/artifacts.ts:34, 77`), and cross-turn tool history is not reconstructed. The "enhanced report" turn therefore could not read report v1; it regenerated from visible chat text. Add `artifacts.read` (and arguably `artifacts.list`), output-capped.
5. **Citation asymmetry across agents.** Agents 1–2 returned citations; agents 3–4 returned none (their `citations: []`). The extraction prompt could require at least one citation naming the data source consulted, or the report renders "uncited" honestly.

---

## The bigger picture: smarter, more dynamic, more connected

Three design principles fall out of this session, and every fix above instantiates one of them:

1. **Model context = UI context.** Anything rendered in the rail (mission board, reports, artifacts, follow-ups) must be either injected as a compact digest or reachable via a read builtin. Divergence produces exactly the "Missing Agent Outputs" moment: the user stares at the reports while the model truthfully denies having them.
2. **Capabilities are tools, not UI affordances.** "Start a mission" existed only as a client-side branch on the first message. The moment the conversation needed it mid-thread, the model improvised theater. Anything the product can do, the model should be able to do (or explicitly request), gated by the same approval flow.
3. **One model contract per model class.** Facade (`assistant|…`) models are single-shot question-answerers. They must be excluded from every prompt-carrying role (planner, synthesizer, extractor, critic) by the same guard, and the one existing guard (`isStructuredOutputModel`) shows the pattern.

### Proposed fix slate (suggested WP cut)

| WP | Scope | Size | Priority |
|---|---|---|---|
| F1 | Synthesis model guard (+ config override, + gate test) | S | P1 |
| F2 | Mission digest into model context + label the synthesis message | M | P1 |
| F3 | `mission.list` / `mission.report` / `artifacts.read` builtins | M | P1 |
| F4 | Second-mission reachability: grants + bridge + client path + `mission-followup` addendum ("never simulate agents") | M | P1 |
| F5 | Style-contract layer (all modes) + GenUI catalog note + optional strip/warn backstop | S | P1 |
| F6 | Web search fallback builtin + scope-default fix + freshness rule + honest absence | M | P1 |
| F7 | `mission_followups` event + follow-up chips + planner context seeding (thread + prior digest) | M | P2 |
| F8 | Facade hygiene: brief-only prompting rule, placeholder-leak fix, stream de-duplication | M | P2 |
| F9 | Citation floor for agent reports | S | P3 |

F1 is a one-line-plus-tests hotfix and removes the single most damaging failure (a mission whose synthesis silently ignores its own agents). F1 + F2 + F4 together would have made this exact session work end to end: real synthesis with the 23 open questions rendered, then "drill deeper" → a real second mission proposal seeded with those questions.

## Next steps

1. Confirm the priorities above (suggested: F1–F6 as one hub-fixes wave).
2. Reproduce the facade stream duplication from this session's event 16 and file it with the fix.
3. After F1/F2 land, re-run this exact scenario (same prompt, same crew) as the acceptance walk: the synthesis must quote all four agents, and "drill deeper" must yield a plan proposal, not tasks.

## Appendix: evidence index

| Claim | Where |
|---|---|
| Synthesis model = first agent's model | `apps/api/src/hub/missions/orchestrator.ts:1106` |
| Synthesis instruction + digest ride the system prompt | `apps/api/src/hub/missions/synthesis.ts:259–292` |
| Digest includes findings + open questions | `apps/api/src/hub/missions/synthesis.ts:153–174` |
| Facade models can't do structured output (existing guard) | `apps/api/src/hub/missions/roster.ts:75–77` |
| Synthesis event: 30 tokens in, $0, facade model | transcript event 16 |
| History reconstruction: user/assistant text only | `apps/api/src/hub/turn-engine.ts:1546–1576` |
| Builtin catalog (no mission/artifact read) | `apps/api/src/hub/tools/builtins/index.ts:17–38`, `artifacts.ts:34,77` |
| Client proposes only when no mission exists | `apps/web/src/features/hub/AssistantView.tsx:376–386` |
| Mission mode prompts as chat | `apps/api/src/hub/session-service.ts:1526–1530` |
| `mission.propose_plan` auto-only | `apps/api/src/hub/session-service.ts:1534–1549` |
| Server allows re-propose once terminal | `apps/api/src/hub/missions/routes.ts` (409 gate), `session-service.ts:836–838` |
| Planner sees only the ask text | `apps/api/src/hub/missions/planner.ts:518–523` |
| Fake agents via tasks + GenUI | transcript events 44–73 |
| No emoji/style rule anywhere in hub prompts | grep of `apps/api/src` (only hit: `reports/server-report-markdown.ts:48`, unrelated) |
| Search is native-only, three kinds | `packages/shared/src/constants.ts:1616`, `providers/registry.ts:204–217` |
| Custom scope silently drops search default | `apps/api/src/hub/session-service.ts:1335–1341`, `tools/builtins/web.ts:540–545` |
| Agent brief is the child's sole user message | `apps/api/src/hub/missions/orchestrator.ts:13` |
