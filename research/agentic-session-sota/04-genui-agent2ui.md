# 04 — Generative UI / Agent2UI: Thesys OpenUI · CopilotKit · assistant-ui

Researched 2026-07-17 (repos cloned/verified at that day's main: CopilotKit v1.63.1,
assistant-ui `@assistant-ui/react` 0.14.27, `thesysdev/openui` via npm `@openuidev/*`; docs
sites live-fetched). Owner brief: **don't copy components — identify gaps in `@brand/ai`, and
above all learn how these systems PROMPT the model so UI output comes out correctly.**
Normative output: the **R-GUI** group in [`roadmap/assistant-hub/requirements.md`](../../roadmap/assistant-hub/requirements.md).

## 0. The frame: three tiers of generative UI (CopilotKit's taxonomy, verbatim)

> "**Controlled** — you wrote the component; the agent only picks *which* one to render and
> *what data* to pass… **Declarative** — the agent emits a structured spec; the frontend
> composes from a catalog you registered. Creativity inside a guardrail… **Open-Ended** — the
> UI is invented elsewhere (an MCP server) and you sandbox it."

The Hub's plan already covers **Controlled** (tool-call rendering, R-UX1). What this research
adds is a bounded **Declarative** capability over a curated `@brand`-part catalog (R-GUI).
**Open-Ended** (LLM-written sandboxed HTML — CopilotKit's `generateSandboxedUi`; MCP Apps
iframes) stays **[P2]** — consistent with the A2UI non-goal and the MCP-Apps deferral.

## 1. Thesys OpenUI (the deepest prompt-engineering artifact of the three)

- **What it is:** a full-stack GenUI framework around **OpenUI Lang** — a line-oriented
  assignment DSL ("`title = TextContent("Q4 dashboard", "large-heavy")`"), NOT JSON. C1 (their
  hosted "Generative UI API", now OpenUI Cloud) switched its wire format to it in `v-20260331`.
  Benchmarks (their own, methodology published): **4,800 tokens vs 9,122 YAML / 10,180
  Vercel json-render / 9,948 C1-JSON** across 7 scenarios (~50% cheaper).
- **Why not JSON (their words):** "JSON is a data format pretending to be a language… we tried
  to make the UI interactive and JSON started fighting us at every step." Why not JSX: "The LLM
  can't go off-script because there is no off-script." Line-orientation dropped structural parse
  errors to zero (no document-level nesting to get wrong).
- **The system prompt is COMPILED, not written:** `library.prompt()` generates it from the Zod
  component registry — the same registry emits the JSON Schema the parser validates against, so
  *prompt and validator cannot disagree*. Catalog format: **one-line typed signatures grouped
  with usage "notes"** (recipes/anti-patterns like "Never nest Form inside Form", "Table is
  COLUMN-oriented"), not full JSON Schemas.
- **Reliability workhorses in the prompt:** inline failure modes in caps ("Unreferenced
  variables are silently dropped and will NOT render", "colon syntax… silently breaks");
  contrastive **WRONG/RIGHT few-shots** ("WRONG — you inlined the results… RIGHT — use
  Query()"); vocabulary clamps with a legal fallback ("These are the ONLY functions available —
  do NOT invent new ones… use realistic mock data instead of fabricating a tool call");
  **streaming order taught in-prompt** ("Always write the root statement first so the UI shell
  appears immediately"); a closing **mechanical self-verification checklist** ("Every referenced
  name is defined… reachable from root…").
- **Streaming = hoisting:** forward references resolve as chunks arrive; unresolved refs are
  *dropped from arrays, not left as null holes*; re-parse per chunk is O(N) via statement-level
  incremental caching (their Rust/WASM parser was a mistake — the boundary overhead ate the
  wins; TypeScript rewrite was 2.2–4.6× faster).
- **Two-tier interactivity:** client-side steps (`@Set/@Reset/@Run` a Query/Mutation against a
  tool map or MCP client) never re-enter the model — "The LLM generated the wiring. The runtime
  executes it. Every click costs tokens" was the problem being solved. Only deliberate
  `@ToAssistant` actions round-trip, carrying **dual-audience payloads**: `humanFriendlyMessage`
  (rendered as the user's turn) + `llmFriendlyMessage`/`formState` (sent to the model).
  Per-message UI state persists via `onStateUpdate`/`initialState`.
- **Error→repair loop is a designed contract:** typed `OpenUIError[]` with `statementId` and
  machine-generated **hints** ("Available components: <list>", signature hints); docs show the
  literal `sendToLLM("Fix these errors:\n\n" + msg)` loop; render-what's-valid recovery. Edit
  mode teaches patch discipline: "A typical edit patch is 1-10 statements, not 20+… If you are
  about to output more than 10 statements, reconsider."
- **Security + theming:** "Safe by default: the model only composes your components and never
  runs arbitrary code"; the model **never chooses colors** — theming is runtime tokens
  (oklch maps) — exactly the brand-ui-only posture.

## 2. CopilotKit (the protocol company: AG-UI-native since v1.50, Dec 2025)

- **Architecture now:** GraphQL runtime deleted; plain SSE + typed AG-UI events; frontend tools
  travel to the model as ordinary tools — "the wire makes no prompt-level distinction between
  frontend and backend tools." Render contract is a **three-state discriminated union**:
  `InProgress (args: Partial<T>, via total-function partialJSONParse) → Executing (respond
  available ONLY here) → Complete (result: string)`.
- **The client no longer authors the system prompt** — their v1 `makeSystemMessage` was
  **removed**: "System-prompt ownership moved server/agent-side; the client contributes only
  structured `context` items and tools on the wire." v2 assembly (verbatim structure):
  `config.prompt` + `"\n## Context from the application\n"` (flat `description: value` items) +
  `"\n## Application State\n This is state from the application that you can edit by calling
  AGUISendStateSnapshot or AGUISendStateDelta.\n \`\`\`json …"`. State becomes model-writable
  via two always-injected tools (full snapshot / RFC 6902 JSON-Patch delta) whose **descriptions
  are the instruction**.
- **The surviving v1 default prompt** carries three keepers: context fenced and attributed to
  the user; "**If you would like to call a function, call it without saying anything else**"
  (silent tool calls = clean component-only turns); a two-branch tool-error retry policy
  ("retry with corrected arguments" only if the error stems from parameters/syntax).
- **Suggestions engine:** a **forced-tool-choice side run** (`copilotkitSuggest`; title = "shown
  as a button and should be short", message = "clear, complete sentence… sent as an instruction
  to the AI"), chips extracted from streaming partial args with a trailing `isLoading` chip —
  and a **stateless `/suggest` endpoint** after the "thread flood" lesson (suggestion runs were
  polluting thread persistence; the stateless path writes no thread/lock/telemetry and skips
  middleware/MCP setup).
- **HITL two ways:** (a) promise-holding frontend tools (`respond` handed to the renderer only
  in Executing); (b) **AG-UI standard interrupts**: run terminates with
  `outcome: {type:"interrupt", interrupts:[{id, reason, toolCallId?, responseSchema?,
  expiresAt?}]}`; the next run carries `resume:[…]` covering ALL open interrupts;
  `editedArgs` in `responseSchema` is the standardized approve-with-edits signal ("Full
  replacement of the tool args. Not merged."). Provider strictness lesson: tool-results must
  carry the original tool name recovered by id — "Anthropic and Google reject a tool-result
  whose name doesn't match; OpenAI tolerates it."
- **Open Generative UI** (their open-ended tier): tool description enforces **parameter order
  for perceived progress** ("PARAMETER ORDER IS CRITICAL… css FIRST… html streams in live…
  jsExpressions applied one-by-one") and a **design system shipped as a context item**
  ("design skill": shadcn-style rules — borders not shadows, neutral palette, 6–8px radius…).
  A2UI (Google's declarative spec; CopilotKit launch partner) ships its component **catalog
  schema as an exactly-named context item** plus a NEVER/MUST rule list ("NEVER call render_a2ui
  without the components array", "Root must be a layout component", "No placeholder images"),
  with **bounded validation retries → typed `a2ui_recovery_exhausted` envelope** rendered as
  recovery UI.
- **Capability manifest** (`AgentCapabilities`: reasoning `{supported, streamed, encrypted}`,
  humanInTheLoop `{interrupts, approveWithEdits}`, multimodal, execution limits) gates the UI at
  handshake — the same idea as the Unified-Sessions capability manifest, independently arrived at.

## 3. assistant-ui (the data-model perfectionist)

- **Headline for our prompt research:** assistant-ui ships **no persona/formatting prompts at
  all** — rendering-side it is a pure consumer of provider parts. Its prompt surface is
  mechanical: a **priority-sorted model-context registry** (system strings concatenated `\n\n`,
  tools merged by name with collision errors), forwarded to the backend as
  `{ messages, system, tools }` on every request; page components register instructions and
  **lazily-evaluated context** (`getContext()` at send time).
- **The richest part contract in the field** (`ToolCallMessagePart`): `args` (partial parse) +
  **`argsText` (raw)**, `result` vs **`modelContent`** (what the model saw) vs **`artifact`
  ("UI-only artifact")**, `interrupt`, `approval`, **`messages` (nested sub-agent thread)**,
  `parentId`, per-part tri-state statuses + `requires-action`. Message metadata carries
  per-step `usage`, **`timing` (TTFT, tokens/sec, chunk counts)**, `submittedFeedback`.
- **Chain-of-thought is DERIVED, not prompted:** the dedicated primitive is legacy; the
  recommended mechanism is `GroupedParts` + `groupPartByType` — a **pure client-side view
  transform** coalescing adjacent parts into synthetic `group-*` nodes (status roll-up, stable
  leaf keys so rows don't remount mid-stream). Tools are classified into three buckets —
  "prompting the user (HITL), informing the user (generative UI), and **traces**… the last
  belongs folded into a collapsible chain-of-thought group" — via a `display:
  "inline"|"standalone"` hint (human/approval tools forced standalone).
- **Declarative GenUI with an allowlist:** `{type:"generative-ui", spec:{root}}` parts resolved
  against a consumer allowlist — "Any component referenced that is not present in the allowlist
  is rejected with a typed error — **the allowlist is the security boundary**." The `present`/
  `prompt_user` tool schema is **deliberately flat** — "Tool schemas (OpenAI and others) reject
  a top-level `oneOf`… the model is guided instead by `$type`'s description… a looser schema
  only costs the model a hint, not safety." `$key` = "Stable identity for this UI node."
- **Interactables** (agent+user co-edited state): auto-generated `update_{name}` tools with the
  exact wording "**Only include the fields you want to change; omitted fields keep their
  current values**", and send-time snapshots stamped into user turns:
  `[Current state of "{name}" (id: {id}): {json}]` / `[State … changed — updated fields: {json};
  fields not listed are unchanged]`. Model-visible error strings list valid ids.
- **Approval contract** (three-state `approved: undefined|true|false`; option kinds
  `allow-once/allow-always/reject-once/reject-always` + `_custom`; `grants` disclosure;
  `confirm` step; `isAutomatic`; terminal `resolution: "cancelled"|"expired"`; "Persistence is
  entirely host-owned — assistant-ui never stores a decision") and **queue/steer primitives**
  (`QueueItemPrimitive.Steer` "Run Now", `AppendMessage.steer`) that independently validate our
  R-SES3/R-UX1 designs.
- **Context-injection helpers as explicit middlewares:** quotes prepended as `> `-blockquote
  text parts (idempotent); mentions serialized inline as `:tool[Label]{name=id}` directives;
  everything else rides `metadata.custom`, "explicitly invisible to the model until injected."

## 4. The system-prompt playbook (the distilled, cross-validated learnings → WP0.3)

Sixteen rules, each observed in ≥1 system and consistent across all three:

1. **Compile the catalog from the component registry** — one Zod/JSON-schema registry emits BOTH
   the prompt catalog and the runtime validator, regenerated together (Thesys; assistant-ui
   buildPresentParameters; CopilotKit A2UI catalog-in-context).
2. **Compact typed signatures + usage notes, not JSON Schemas** — one line per component,
   grouped, with recipe/anti-pattern notes carrying the taste (Thesys).
3. **Failure modes stated inline, in caps, with WRONG/RIGHT contrastive pairs** (Thesys).
4. **Clamp the vocabulary + provide a legal fallback** — "ONLY these… do NOT invent"; when
   nothing fits, the prompt names the alternative (mock data / plain text) (Thesys, A2UI rules).
5. **Teach streaming order in the prompt; design the contract for out-of-order arrival** —
   root/shell first; drop unresolved, never null holes (Thesys hoisting; CopilotKit
   "PARAMETER ORDER IS CRITICAL").
6. **End with a mechanical self-verification checklist** (Thesys Final Verification).
7. **Typed, promptable error→repair loop with bounded retries** — machine hints ("Available
   components: …"), literal "Fix these errors:" reprompt, typed exhaustion envelope rendered as
   recovery status (Thesys; A2UI `a2ui_recovery_exhausted`).
8. **The prompt is agent-owned and server-assembled; clients contribute structured context
   only** — `prompt + "## Context from the application" (description: value) + "## Application
   State" (fenced JSON)` (CopilotKit v2, after removing client-authored prompts). *Validates
   WP0.3's server-side prompting module.*
9. **Tools carry the instruction; tool calls are silent** — per-part description formula ("Use
   this tool to display the X component… for the user"), "call it without saying anything else",
   two-branch tool-error retry policy (CopilotKit).
10. **Flat tool schemas — providers reject top-level `oneOf`** — guidance moves into the `$type`
    enum description; render-time allowlist validation is the real safety net (assistant-ui).
11. **Dual-audience payloads + model-visible/UI-visible separation everywhere** —
    `humanFriendlyMessage` vs `llmFriendlyMessage`+`formState` (Thesys); `result` vs
    `modelContent` vs `artifact` (assistant-ui).
12. **Editable-surface snapshot wording** — auto-generated `update_{name}` tools ("Only include
    the fields you want to change…") + `[Current state of "…" (id): …]` snapshots stamped on
    user turns, ids kept model-visible (assistant-ui interactables; CopilotKit state tools).
13. **Design system as a prompt block, colors as runtime tokens** — ship an overridable
    design-rules context item; the model never picks colors (CopilotKit design skill; Thesys
    theming) — congruent with brand-ui-only + `check-tokens`.
14. **Suggestions as forced-tool, stateless side runs** — never through thread persistence;
    chip title/message description language; streaming chips with trailing loader (CopilotKit).
15. **Patch discipline for edits** — "output only changed statements; >10 means reconsider";
    merge-by-name replace/append/keep semantics (Thesys editMode).
16. **Never prompt for chain-of-thought structure — derive the trace client-side** from
    adjacent parts + a tool prompt/inform/trace classification (assistant-ui).

## 5. `@brand/ai` gap analysis (capability-level; cross-validated; NOT a to-copy list)

> **Correction (owner recheck, 2026-07-17, against the LIVE brand-ui Storybook at
> localhost:6006 — 227 titles, 10 packages incl. `maps`):** the vendored agent kit (1.6.0
> tarball) is **behind the live library**. Two gaps first listed here are already closed
> upstream, and new AI components exist that the kit doesn't list (`AI/ChangeReview`,
> `AI/Gallery`, `AI/InteractiveTerminal`, plus `Patterns/Scenarios/Agentic AI Workspace` and
> `Patterns/Templates/AI Assistant`). **Rule for every UI WP: verify against the running
> Storybook / `pnpm exec brand-ui` at build time — never against the tarball manifest alone.**

**Closed upstream (consume, don't build):**

| Capability | What exists (live Storybook, verified) | Hub consumer |
|---|---|---|
| **Charts as model-emittable content** | `@brand/charts` **`AutoChart`** — `spec` prop documented as "**The serializable chart specification produced by an LLM tool-call**"; Core-7 types (line/bar grouped+stacked/donut/scatter/radar/funnel, inference from data), `valueFormat` hints, **never throws** (unsupported type / empty data → `ChartFallback`), plus the copy-owned **`ai-chart` registry block** composing it with `@brand/ai` Conversation/Message/Tool (packages can't cross-import siblings; registry blocks can — see brand-ui `research/ai-charts/01-ai-chart-integration-plan.md`) | R-GUI1 catalog adopts **ChartSpec as-is** as its chart contract; AutoChart's fallback semantics already match R-GUI4 |
| **Review workflow (accept/reject changes)** | `AI/ChangeReview` — "**AI-edit trust gate**": hunk-by-hunk approve/reject (`ChangeHunk[]`, controlled `approved` set, approve/reject-all, custom hunk renderers) with **`ChangeProvenance`** (author, model, timestamp, run note) | WP3.5 artifact review + workspace-edit approvals render on this, not on `Commit*` improvisation |

**Still-open upstream candidates — raise per `library-first.md` (compose-from-primitives
fallback until then); re-verify against the live Storybook before filing:**

| Gap | Evidence | Hub urgency |
|---|---|---|
| Model-emittable **in-message forms** with declarative validation + submit → structured formState | all three | HIGH (R-GUI catalog; MCP elicitation R-MCP4 shares the form renderer) |
| **Tables as model-emittable message content** (typed columns, component cells; `@brand/data` DataTable is app-chrome, not a catalog part) | Thesys, A2UI | HIGH (R-GUI catalog) |
| **Part-grouping engine** — derive collapsible trace groups from adjacent parts (status roll-up, stable keys) | assistant-ui | MEDIUM (R-GUI7; ChainOfThought renders, doesn't derive) |
| **Message edit-in-place** (edit-composer mode; `MessageBranch` exists, edit UX doesn't) | assistant-ui | MEDIUM (pairs with R-SES3/branching) |
| **Per-message feedback** (thumbs + submitted state) | assistant-ui, CopilotKit | LOW (observability workstream owns human feedback — link, don't duplicate) |
| **Selection/quote toolbar** (quote message text into the composer as `> ` context) | assistant-ui | LOW (delightful; P2) |
| Suggestion chips with **streaming trailing-loader** mechanics | CopilotKit | LOW (Suggestions + Shimmer compose) |

**Hub-engine capabilities (contracts, not components — land in R-GUI/R-SES):** catalog→prompt
compiler + validator (one registry); `generative-ui` part type + flat `present` tool; partial-args
contract (`args` + raw `argsText`, three-state render); bounded repair loop; two-tier
interactivity + per-message UI state; `update_{name}` snapshot contract for artifacts/plan/tasks;
model-visible vs UI-visible result channels (`modelContent`/`artifact`); suggestion side-run
(stateless); message timing telemetry (TTFT/tok-s — fits the app's metering DNA).

**Deliberately NOT adopted (stays [P2]/non-goal):** Open-ended sandboxed HTML generation
(CopilotKit `generateSandboxedUi`) and MCP Apps embedding (already P2); adopting A2UI/OpenUI
Lang as an external wire format (we compile our own catalog over `@brand` parts — same
technique, our vocabulary); channel surfaces (Slack/Teams bots); agentic textarea autocomplete
(CopilotKit killed theirs); enterprise memories/learning loops (D-AH11 already scoped memory).

## 6. What the Hub adopts → R-GUI1–8 (+ prompt playbook into WP0.3)

A bounded **Declarative GenUI capability**: a curated, versioned catalog of `@brand`-part-backed
components (forms, tables, charts, stat/KPI, media, layout) compiled into the prompt + validator
from one registry; emitted via a flat silent `present` tool; streamed parent-first with typed
partial-args; validated against the allowlist with a bounded, machine-hinted repair loop;
interactive via the two-tier model (client-side state ops + dual-audience to-assistant actions);
per-message UI state event-sourced; traces derived, never prompted; themed exclusively by
`@brand/tokens`. Full normative text: `roadmap/assistant-hub/requirements.md` §R-GUI; owning WP:
**WP2.6** (+ WP0.1 contract, WP0.3 prompt sections).

Primary sources: github.com/thesysdev/openui (+ openui.com docs/blogs, npm `@openuidev/*`
source maps), github.com/CopilotKit/CopilotKit @ v1.63.1 (+ docs.copilotkit.ai,
docs.ag-ui.com interrupts/capabilities/events), github.com/assistant-ui/assistant-ui @ 0.14.27
(+ assistant-ui.com docs). Full agent reports with verbatim quotes + caveats retained in the
session transcript of 2026-07-17; each system's self-reported benchmarks flagged as such.
