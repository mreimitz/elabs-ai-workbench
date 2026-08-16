# 11 — How real products load skills (research) + our decision

Research pass (2026-07-01) across Claude API, Claude Code, Claude Desktop / claude.ai / Cowork,
OpenAI Codex + ChatGPT, the agentskills.io reference runtime (`skills-ref`), and LangChain deep
agents. This settles [`10`](./10-open-questions.md) **Q1** — what "attaching a skill to a scenario"
should feed the agent-under-test.

## The universal model (every product agrees)

| Level | When it enters context | Mechanism | Token cost |
|---|---|---|---|
| **L1 — metadata** (`name` + `description`) | **Always**, at startup, in the system prompt, for **every** installed/available skill | injected as an `<available_skills>` block (name + description + on-disk **location**) | ~55–235 tok/skill (~100 typical) |
| **L2 — SKILL.md body** | **On demand**, only when the model decides the skill is relevant | model **reads the file via a tool** (bash/`read_file`) — **not** eagerly inlined | < ~5k tok when triggered |
| **L3 — resources/scripts** | **On demand**, when referenced | file reads via bash; scripts **executed**, only stdout returns (code never enters context) | effectively unbounded, pay-per-use |

Per-surface confirmation:

- **Claude API** (Skills beta: `code-execution-2025-08-25` + `skills-2025-10-02` + `files-api-…`;
  `container.skills[]` with `{type, skill_id, version}`, ≤8/request). Skills mount at
  `/mnt/skills/{public,user,organization,examples}/<name>/SKILL.md`; the model reads `SKILL.md` **via
  bash** on trigger. L1 injected as `<available_skills>`.
- **Claude Code** — L1 descriptions always in context (budgeted ~1% of the window,
  `skillListingBudgetFraction`); L2 loaded on invocation. *Implementation nuance:* Claude Code
  **injects the rendered body as a message** (via the Skill tool / `/name`) rather than a bash read,
  and it persists for the session. Same net effect: L1 always, L2 on trigger.
- **Claude Desktop / claude.ai / Cowork** — same three-level model in a code-execution VM; claude.ai
  uploads are ZIPs via Settings → Features. Cowork is Claude Code CLI in a local VM
  (`--plugin-dir …/.skills`), so it inherits the Claude Code model.
- **OpenAI Codex + ChatGPT** — **adopted the same SKILL.md format** (Dec 2025): preloads
  `name`+`description`+path (capped ~2% of context / 8k chars), loads full `SKILL.md` only when it
  decides to use the skill. (Contrast: `AGENTS.md` is the *eager* always-loaded flat-file model — the
  opposite of skills.)
- **agentskills.io `skills-ref`** — the reference runtime's `to-prompt` emits exactly the
  `<available_skills>`/`<skill>`/`<name>`/`<description>`/`<location>` block and **defers L2 to the
  agent** reading the file at `<location>`. This is the standard L1 wire format we adopt verbatim.
- **LangChain deep agents** (`SkillsMiddleware`) — frontmatter into the system prompt at discovery;
  full body read via a `read_file` tool on activation; L3 only when referenced.

Sources: platform.claude.com Agent Skills overview; anthropic.com/engineering *Equipping agents…*;
code.claude.com/skills; developers.openai.com/codex/skills; agents.md; agentskills.io/specification +
`skills-ref`; docs.langchain.com deep agents skills; anthropics/claude-code#26254 (container mount).

## Implication for a token-**footprint** test harness

The product exists to measure *real* model-context cost. The faithful reproduction of what a real
product puts in the window when a skill is "attached" is therefore:

- **Always:** inject the standard `<available_skills>` **L1 block** (name + description + a synthetic
  location) for each attached skill → this is the true *always-on* cost, and it is exactly what every
  product pays up front.
- **On demand:** expose a **read-only disclosure tool** the model calls to pull L2 (the `SKILL.md`
  body) and L3 (resource files) when it judges the skill relevant → this reproduces the real
  bash/`read_file` mechanism and lets us **measure the realized cost per run** (metered exactly like
  the existing MCP `tools/call` request/response token measurement).

Eagerly inlining the body (the naive "attach = paste the whole skill") **overstates** the real
always-on cost and does not match any product — so it must not be the default.

## Decision (Q1) — **Faithful default + optional eager toggle** ✅ (owner-approved)

Phase 2 (`08-scenario-attachment.md`) implements, per scenario-skill attachment:

1. **L1 always** — build one `<available_skills>` block for all attached skills and prepend it to the
   run's system prompt. Uses the `skills-ref` XML shape:
   ```xml
   <available_skills>
     <skill><name>pdf-processing</name>
       <description>Extract PDF text, fill forms, merge…</description>
       <location>skill://pdf-processing@v5/SKILL.md</location></skill>
   </available_skills>
   ```
2. **L2/L3 via a read-only disclosure tool** — register a `read_skill_file` tool in the existing
   `tool-bridge.ts` agent loop, backed by the attached skill **version's** files (resolved latest or
   pinned). It exposes `list_skill_files()` / `read_skill_file(path)` only — **read-only, never
   executes** `scripts/*`. Each call is measured (request/response tokens) exactly like MCP tool
   calls, so the run shows the **realized** disclosure cost, not a guess.
3. **Eager toggle (optional, per attachment)** — a checkbox that additionally inlines the full
   `SKILL.md` body (L2) into context up front, for a deliberate worst-case comparison. Off by
   default (faithful).

Token accounting: the run's context snapshot gains a **skills** contribution (L1 block always;
inlined L2 when eager; disclosure-tool reads counted as tool-result tokens). This slots into the
existing `ContextSnapshot`/KPI machinery from the Testing subsystem.

**The app never executes skill scripts** — the disclosure tool only reads file contents for the
model. This preserves the Phase-1 non-goal ("we do not execute skills") into Phase 2.
