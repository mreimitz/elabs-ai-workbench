# Assistant Hub: Root-Cause Analysis and Fix Plan

**Date:** 2026-07-19 · **Scope:** MCP access (sessions + mission subagents), answer rendering, mission board UX, internet access, chat-vs-mission routing.
**Evidence base:** full source read of the working tree (`apps/api/src/hub/*`, `apps/web/src/features/hub/*`, shared contract, e2e stubs) plus live inspection of the running instance via `GET /api/hub/sessions/oNiw1PCAmxc5_ietGD_0h` and `.../context`. Every root cause below is code-proven and, where possible, confirmed against the real session.

---

## 1. Executive summary

The session you shared fails for reasons that are almost all **downstream of your setup, not caused by it**. Your crew configuration was correct: the plan really did grant `acme-demo` (`p_m2aMW4hyPJb3q8Evd6s: "all"`) to both agents. The app then dropped that grant at several independent points.

| # | Finding | Severity | Status |
|---|---|---|---|
| RC1 | **No MCP tool is ever callable in any hub session.** Deferred tool loading is the default, zero tools are promoted to "resident", and `tool_search` results never become callable. | Critical | Confirmed (code + live) |
| RC2 | **Mission subagents cannot call tools at all.** The agent runner is a one-shot `generateObject` with no `tools` parameter; the plan's grants are turned into prose and dropped. | Critical | Confirmed (code + live) |
| RC3 | **The Tools rail and the grant picker are disconnected from the runtime.** The Context rail lists every scanned server regardless of scope; your session's `toolScope` was `null`; grants are not editable after create; connection failures are swallowed silently. | High | Confirmed (code + live) |
| RC4 | **Any answer with citations renders as raw markdown.** The citation-chip weaver returns a text array that bypasses the Streamdown markdown renderer. Mission syntheses always carry citations, so they always render raw. | High | Confirmed (code + live) |
| RC5 | **No internet capability exists anywhere, by design decision D-AH10.** No built-in web tool, no provider-native web search, and the research presets require manual server setup with your own API key. | High (expectation gap) | Confirmed (code) |
| RC6 | **Mission board: the flow is honest about order but misleading in shape; no expand modal, no per-agent live view, stacked cards.** Debate genuinely runs sequentially (verified live: reports 50 s apart). | Medium | Confirmed (code + live) |
| RC7 | **There is no chat-vs-mission decision or clarify step.** Mode is fixed at session creation; the composer "Auto" chip is the autonomy dial, not the mode. | Medium | Confirmed (code) |

Side findings: mission cost telemetry is fake (`costUsd: 0` hardcoded, so the $2.00 budget cap can never trip), the tools prompt section runs 6,000 tokens against a 400-token budget, and the crew ran with placeholder role prompts ("Finish configuring this agent's instructions in its profile") without any warning.

---

## 2. Ground truth from the live session

Facts read from the running instance for session `oNiw1PCAmxc5_ietGD_0h`:

| Fact | Value | Meaning |
|---|---|---|
| `session.mode` / `autonomy` | `mission` / `auto` | Mission mode was set at creation (crew-bound session). |
| `session.toolScope` | `null` | No session-level scope was persisted. `null` means "auto: grant every reachable server", so your acme-demo-only selection never reached the DB (see RC3). |
| `context.tools.mode` | `"deferred"` | Deferred loading active (the default). |
| `context.tools.resident` | `[]`, `residentTokens: 0` | **Zero callable MCP tools.** All 281 tool definitions (~245k tokens across all 5 servers) sit in the "deferred" list that the model can search but never call (RC1). |
| Mission plan `toolGrants` (both agents) | `{"servers":{"p_m2aMW4hyPJb3q8Evd6s":"all"}}` | The crew roles **did** grant the the vendor server. The failure is downstream (RC2). |
| Agent reports | 13:34:49 and 13:35:40 | Debater 2 started after debater 1 finished: sequential execution, 50 s apart (RC6). Debater 2's report cites debater 1 (`c1`), as designed. |
| Synthesis message | `parts[0].text` starts `## Synthesis:` with `[1]` markers, `citations:[{id:"1",…}]` | Exactly the shape that triggers the raw-markdown branch (RC4). |
| Mission `costUsd` / plan `estimatedCostUsd` | `0` / `0` | Cost tracking inert (side finding). |
| Prompt sections | tools = 6,000 tokens vs 400 budget | Deferred name list alone blows the section budget. |

---

## 3. Root causes in detail

### RC1. Deferred-by-default tool loading with no promotion path (kills MCP in *every* hub session)

Mechanism, in order:

1. `HUB_TOOL_LOADING_DEFAULT` defaults to `"deferred"` (`apps/api/src/config/env.ts:273-276`); `docker-compose.yml` does not override it, so the running container uses deferred.
2. In deferred mode only "pinned" tools become resident: `mcpResident = mcp.filter(isPinned)` (`apps/api/src/hub/tools/registry.ts:69-71`). `resolveToolset` never passes an `alwaysLoad` list (`apps/api/src/hub/session-service.ts:626-633`), so nothing is ever pinned and **`mcpResident` is always `[]`**.
3. Only `resolution.mcpResident` is built into callable AI-SDK tools (`session-service.ts:664-689`). Deferred tools get exactly one affordance: the `tool_search` built-in, which returns matching definitions **as data** (`apps/api/src/hub/tools/tool-search.ts:70-74`). Its own header comment admits that making a discovered tool callable "is a turn-engine wiring question … outside WP0.5's scope" (`tool-search.ts:8-11`). That wiring was never built.
4. The turn engine builds `providerTools` once per turn and never re-injects (`apps/api/src/hub/turn-engine.ts:703`, `:1029`).

Net effect: the model is told "Definitions load on demand: call `tool_search` … " (`apps/api/src/hub/prompting/layers/tools.ts:20`), it can *find* `acme_search`, but the tool is not in the provider tool list, so it can never invoke it. The model then correctly reports it has no access.

Why the gate never caught it: the only test asserting a callable granted MCP tool forces `toolLoadingDefault: "eager"` (`apps/api/src/hub/session-service.hub-mcp-grants.test.ts:165`). The production default path (deferred) has no callability test.

### RC2. Mission subagents run through a tool-less one-shot call; grants are dropped twice

1. **Child sessions are created without any scope:** `createSession({ mode:"chat", model, kind:"agent", parentSessionId, missionId, title })`, no `toolScope` (`apps/api/src/hub/missions/orchestrator.ts:381-391`).
2. **`planned.toolGrants` is consumed only as prose:** `agentToolSignatures(planned.toolGrants)` becomes a `Tools:` line in the role prompt (`orchestrator.ts:563`, `prompting/layers/role-template.ts:37`). With empty grants it renders "(none — reasoning only)" (`missions/shared.ts:38`); the role prompt's tools layer renders the fallback sentence both your debaters echoed (`prompting/layers/tools.ts:37-40`).
3. **The production runner cannot call tools at all:** `createStructuredAgentRunner` executes a single `generateObject({ model, schema, system, prompt })` with **no `tools` parameter** (`orchestrator.ts:723-741`), and `HubAgentRunInput` has no channel for a toolset (`orchestrator.ts:72-85`). A turn-engine-based runner is explicitly deferred as "future" (`orchestrator.ts:341-343`).
4. **The planner cannot propose grants for prompt-planned missions** because it is never shown the parent's servers: `buildMissionPlannerPrompt` passes no tools injection (`missions/planner.ts:75-100`), so the planner's own prompt says "No MCP tools are granted", and rule 1 forbids inventing server names. Your session took the *crew* path, so grants were present anyway, which proves the drop is downstream.

Also: the runner returns `costUsd: 0` hardcoded, so `isBudgetTripped()` can never trip and the board's budget display is fiction.

### RC3. Grant picker, Tools rail, and connection failures are all disconnected from the truth

1. **The Context rail ignores the session's scope.** `GET /api/hub/sessions/:id/context` builds its tool list from `buildHubContextMcpCatalogProvider`, which iterates `servers.list()` and grants every scanned server `"all"` (`apps/api/src/hub/routes.ts:1428-1462`). Its docstring admits "no session-level MCP configuration yet". That is why you always see all 5 servers with full counts.
2. **Your session had `toolScope: null`.** `NewSessionDialog` only sends a scope when the "MCP & tools" tab was explicitly switched to *Scoped* (`NewSessionDialog.tsx:154-155`); crew-driven flows and the default "Auto" send nothing. So the runtime treated the session as grant-everything, and the rail displayed the same, making your selection look (and be) inert.
3. **Grants are write-once.** `PATCH /api/hub/sessions/:id` accepts only title/model/autonomy (`routes.ts:1732-1737`). A mis-scoped session cannot be fixed afterward.
4. **Connection failures are silent.** At turn time each granted server must open a live MCP session; a failure logs a warning, drops the server from the grant, and if all drop, the resolver returns `null` (`apps/api/src/index.ts:379-385`, `:418-427`). The prompt then shows the literal "No MCP tools are granted in this session" fallback. Nothing surfaces in the UI.
5. Minor: the scope's `builtins` selection is ignored at turn time (`DEFAULT_CHAT_BUILTIN_NAMES` always wins, `index.ts:430`), and every MCP call is approval-gated (`serverTrusted: false`, `session-service.ts:682-687`).

### RC4. Citation weaving defeats the markdown renderer

`ConversationPane` renders assistant text via `renderCitedText(part.text, citations)` (`ConversationPane.tsx:913`). That helper returns the original **string** when nothing resolves (then `MessageResponse`, the Streamdown markdown renderer from `@elabs-ai/components-ai`, renders it), but returns an **array of runs + `InlineCitationChip`s** when any `[n]` marker resolves. The array branch renders inside a plain `whitespace-pre-wrap` `Text` (`ConversationPane.tsx:918-921`), so every markdown token shows literally. The code comment states the trade openly: "markdown yields to the inline-citation MUST" (`ConversationPane.tsx:909-912`; helper at `SourcesPanel.tsx:113-131`).

Mission syntheses **always** carry merged citations plus `[n]` markers (`missions/synthesis.ts:262-274`), so they always hit the raw branch. Research-mode answers with citations do too. Uncited chat answers render fine, which is why the bug looks intermittent. The dock does not have this bug because it renders everything through `ChatMarkdown` (Streamdown + `@elabs-ai/components-ui` table overrides, `features/testing/ChatMarkdown.tsx`, used by `AssistantMessageBody.tsx:36-48`).

Additionally, the synthesis step is a bare `generateText` with no tools (`synthesis.ts:306-319`), so the GenUI `present` tools (Table, StatGroup, Chart, …) are structurally unavailable to the final answer. "Use all the AI components we have" is impossible on this path today.

### RC5. Internet access does not exist, by design decision

Four independent gates, each confirmed:

1. The built-in catalog has no web tool: `ALL_BUILTINS` = workspace + artifacts + memory + tasks + mission (`hub/tools/builtins/index.ts:10-16`).
2. Provider calls enable no native search: `providerOptions()` sets only Anthropic `cacheControl`/`thinking` (`providers/registry.ts:125-150`); the only provider tool used is Anthropic's tool-search-regex for deferred MCP discovery (`registry.ts:183`). `anthropic.tools.webSearch_*`, OpenAI `webSearchPreview`, and Gemini grounding exist in the installed SDKs but are never referenced.
3. Research **mode** is a prompt addendum plus an empty-state hint, nothing more (`prompting/layers/mode-addenda.ts:13`, `ConversationPane.tsx:1614-1633`).
4. The dock assistant explicitly disallows `WebSearch`/`WebFetch` (`assistant/session-manager.ts:99-100`).

The intended path is D-AH10 (`roadmap/assistant-hub/README.md:68`): register a Tavily/Brave/Exa MCP server via the wizard presets (`features/servers/researchServerPresets.ts:32-63`, `ServerWizard.tsx:372-441`), with your own API key. You have not registered one, so no session (main or agent) can reach the internet, and RC1/RC2 would break it even if you had.

### RC6. Mission board: honest order, misleading shape, missing interactions

1. **Debate is sequential by design** (`missions/topologies.ts:191-206`: a `for` loop; each debater's brief folds in all prior reports with "challenge, rebut, or strengthen"; a mission-level synthesis acts as the resolver, `topologies.ts:202`). Live timestamps confirm it. Your instinct that they ran in parallel was wrong, but the confusion is earned: the *org-chart* view draws debate as face-to-face pairs (`workforce/org-chart/topology-edges.ts:80-86`), contradicting the board, and the board's chain (`topology-graph.ts:109-131`: edge `i-1 → i`, then `last → Resolver`) reads as an arbitrary pipeline. The "Resolver" node is not an agent; it is the synthesis step, unlabeled as such.
2. **No expand affordance, no node interaction:** graph fixed at `h-56`, `ZoomControls` only (`MissionBoard.tsx:285-289`); nodes are `selectable: false` (`TopologyGraph.tsx:31`, `:83`).
3. **Agent cards stack vertically:** `<ul className="flex min-w-0 flex-col gap-3">` (`MissionBoard.tsx:294`).
4. **No live per-agent session view exists** and cannot exist yet: the structured runner (RC2) writes almost nothing into the child session, so there is nothing to stream. The child sessions are real hub sessions (`agentSessionId`s in the mission events), so once agents run real turns, streaming their transcript is straightforward.

### RC7. No chat-vs-mission decision, no clarify step

Mode is chosen once in `NewSessionDialog` (D-AH5) and is not patchable per message (`ComposerCommands.tsx:60-64`). The composer's "Auto" chip is the **autonomy** dial (`AutonomyModeSelect.tsx:46-50`), a different axis, which is easy to misread as "auto mode". `proposePlan` refuses non-mission sessions (`orchestrator.ts:177`). The `askUser` capability is coerced off (`capabilities.ts:89`), and no planner step ever asks "quick answer or full mission?". Your expectation #2 is simply not implemented today. (Your #4, approval before launch, works: the plan card gated the mission and you approved it, `plan_approved, approvedBy:"user"`.)

---

## 4. Fix plan

Phased so that each phase lands value on its own, respects the repo's conventions (contract-first `packages/shared`, brand-ui only, both themes, gate green), and can be driven as a `roadmap/hub-fixes/` workstream with a STATUS ledger and `/next-wp`.

### Phase 0: Same-day mitigation (no code)

1. Add `HUB_TOOL_LOADING_DEFAULT: "eager"` to `docker-compose.yml` environment and recreate the container.
2. Create sessions with an explicit scope: New session → MCP & tools → *Scoped* → pick only `acme-demo` (roughly 45-50k tokens of definitions; workable eager on Opus-class context, unusable with all 5 servers at ~245k).
3. Result: main-session chat can actually call the vendor tools today (each call approval-gated). Missions stay broken until Phase 2. This validates the diagnosis cheaply.

### Phase 1: Make MCP real in main sessions (critical)

- **WP1.1 Tool-loading correctness.** Keep `deferred` as default but make it functional: register the full granted set with the turn engine and expose only the resident subset per step (AI SDK per-step active-tool limiting), promoting `tool_search` hits into the active set for subsequent steps of the same turn. Add an `auto` policy: small scoped catalogs load eager; large catalogs defer. Acceptance: a deferred-mode session calls a granted MCP tool end-to-end in a gate test (the missing test from RC1).
- **WP1.2 Grant plumbing honesty.** Persist and honor scope everywhere: context inspector reads `session.toolScope` (fix `routes.ts:1428-1462`); add `toolScope` to the session PATCH + a "Manage tools" editor in the rail; honor the `builtins` selection; crew/session create flows always persist the effective scope instead of `null`.
- **WP1.3 Connection-failure surfacing.** Replace silent grant-drop with per-server status: rail shows granted servers with `connected / error (reason) / connecting` chips; a turn that loses servers emits a visible system line ("acme-demo unreachable: OAuth expired") instead of the misleading "no tools granted" prompt; add a retry affordance.
- **WP1.4 Prompt-budget sanity.** Deferred name list currently costs ~6k tokens against a 400 budget; compress to per-server groups with counts.

### Phase 2: Mission agents become real tool-using sessions (critical)

- **WP2.1 Turn-engine agent runner.** Replace `createStructuredAgentRunner` with a runner that executes the child session through the normal session-service/turn-engine pipeline: `createSession(... toolScope: planned.toolGrants)`, real streaming turns and tool calls persisted as child-session events, final report via the existing structured-output tool. This simultaneously fixes tools, live transcripts (RC6.4), and cost/token accounting (real `costUsd`, working budget trip).
- **WP2.2 Planner catalog + plan-card grants.** Feed the planner the parent's reachable servers (names, tool-group summaries, token cost) so prompt-planned missions propose real grants; validate proposed server ids; show per-agent server chips on `MissionPlanCard` with add/edit; warn on unconfigured roles ("Finish configuring…" placeholders) before launch.
- **WP2.3 Inheritance rule.** Child effective grants = plan grants ∩ parent session scope (auto parent ⇒ plan grants as-is). One documented rule, one test.
- **WP2.4 Mission approval policy.** Decide how per-call HITL approval behaves inside missions (recommend: mission autonomy governs it; `always_ask` queues approvals to the board, `auto` within budget does not gate reads).

### Phase 3: Answer rendering (high)

- **WP3.1 Markdown + citation chips together.** Route hub text parts through the existing `ChatMarkdown`/Streamdown renderer and weave `[n]` chips via a component/remark override instead of string-splitting (kill the array branch in `ConversationPane.tsx:918-921`). Applies to synthesis, research answers, everything.
- **WP3.2 Synthesis through the turn engine.** Run mission synthesis as a real turn of the parent session with GenUI tools available, so the final answer can use `present` (Table, StatGroup, Chart) plus prose. This is what makes "the answer uses all the AI components" true. Keep the current text path as fallback.

### Phase 4: Mission board UX (medium)

- **WP4.1 Truthful topology graphs.** Give debate its own layout: debaters in one row, directed "sees + rebuts" edges showing the actual order, every debater feeding a terminal node labeled **"Synthesis (resolver)"**; unify the org-chart depiction with the board; add a per-topology legend line ("debate runs sequentially; each debater sees prior arguments").
- **WP4.2 Agent grid + detail box.** Reported agents in a responsive 2-up grid (`grid gap-3 sm:grid-cols-2` on `MissionBoard.tsx:294`); clicking a card (or a graph node) opens a detail box below with tabs: Status / Live session / Report.
- **WP4.3 Expand modal with live session panel.** `Maximize2` button top-right of the graph → `Dialog size="full"` (exact pattern: `features/testing/TraceLeafDetail.tsx:62-77`); nodes selectable; right panel streams the selected agent's child session via the existing SSE endpoint + a read-only `ConversationPane`. Depends on WP2.1 for content.
- **WP4.4 (owner decision) Parallel opening round for debate.** Optionally restructure debate as round-based: parallel opening statements, then a rebuttal round where each sees the others, then synthesis. Matches your intuition, keeps adversarial semantics, costs one extra round.

### Phase 5: Internet access (high, expectation gap)

- **WP5.1 Provider-native web search as a grantable capability.** Add `web.search` (and `web.fetch`) as built-ins backed by the provider's native tool where supported (Anthropic web search, OpenAI search preview, Gemini grounding), failing honestly elsewhere; grantable per session and per mission agent through the same scope; search cost surfaced in usage. This revises D-AH10 and needs your sign-off.
- **WP5.2 Research-server onboarding.** Keep the MCP path as the pluralistic option: surface the Tavily/Brave/Exa presets inline when a research session or a planner needs the web and none is registered (the empty-state hint exists; extend it to the planner and mission plan card).

### Phase 6: Mode routing + clarify step (medium)

- **WP6.1 "Auto" session mode.** New default mode that routes per message: plain questions answer as chat; multi-step/research-shaped prompts propose; when a mission looks warranted but unstated, ask first via a GenUI `prompt_user` card ("Quick chat answer, or a mission with N agents ≈ $X?") and remember the choice. Requires allowing `mission.propose_plan` from non-mission sessions (`orchestrator.ts:177`) and enabling the ask affordance for top-level sessions.
- **WP6.2 Composer clarity.** Label the autonomy chip distinctly from mode (this confusion produced your report's framing), and show the session's mode in the composer with a switch affordance.

### Decisions needed from you

| ID | Decision | Recommendation |
|---|---|---|
| D-HF1 | Tool-loading default + promotion mechanics (eager / auto / deferred-with-promotion) | `auto` with promotion; eager for scoped ≤ ~30 tools |
| D-HF2 | Native provider web search (revises D-AH10) | Yes, as grantable built-in, MCP research servers stay first-class |
| D-HF3 | Debate semantics: keep sequential vs round-based with parallel openings | Round-based (WP4.4) |
| D-HF4 | Synthesis through turn engine with GenUI | Yes |
| D-HF5 | Child grant inheritance (intersection vs plan-as-is) | Intersection with parent scope |
| D-HF6 | HITL approval inside missions | Governed by mission autonomy |

### Suggested sequencing

Phase 1 and Phase 3 are independent and both small enough to start immediately; Phase 2 is the largest single item and unblocks WP4.3; Phase 4 can begin with WP4.1/4.2 (pure UI) right away. Phases 5 and 6 gate on D-HF2 and the mode-routing design. Every WP ships behind the usual gate (`pnpm typecheck && pnpm test && pnpm build`, Biome clean) with tests named in the WP.

---

## 5. Verified vs. not verified

**Verified:** every file:line claim above against the working tree; live session state, mission plan grants, deferred/resident tool split, synthesis message shape, and timing via the running instance's API; the debate execution order from both code and event timestamps.

**Not verified (needs runtime access I did not have):** whether the `acme-demo` MCP connection itself opens cleanly at turn time (the silent-drop path in RC3.4 makes this invisible; the API log would show `hub: MCP session open failed` if not), and eager-mode end-to-end the vendor calls (Phase 0 will prove this immediately). The Docker volume DB was not directly readable from this session; all live facts came from the HTTP API.

## 6. Housekeeping

The analysis staged a source snapshot from your working tree; the leftover archive was moved to `_to_delete/.claude-src-snapshot.tar.gz` in the repo root (this session cannot delete files on your machine, so please remove that folder at your convenience).
