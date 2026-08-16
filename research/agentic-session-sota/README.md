# Agentic-session SOTA — research package (for `roadmap/assistant-hub/`)

Researched 2026-07-17 (web-verified against live docs that day) to answer the owner's brief:

> The Assistant must behave like a **Fable 5 session** — state-of-the-art MCP server & tool
> handling, state-of-the-art skill handling, state-of-the-art user interaction and visual
> feedback.

Docs:

- [`00-fable-session-anatomy.md`](./00-fable-session-anatomy.md) — the reference harness
  (Claude Code v2.1.x / Cowork, mid-2026): the 12 behaviors that make a session feel like this
  one, with exact mechanics.
- [`01-mcp-tool-handling.md`](./01-mcp-tool-handling.md) — MCP spec state (2025-11-25 + the
  2026-07-28 RC), tool annotations/elicitation/progress/structured output, Anthropic's
  tool-search & advanced tool use, client landscape (Claude Code, ChatGPT, Cursor, Windsurf).
- [`02-skills-handling.md`](./02-skills-handling.md) — Agent Skills spec + how harnesses load,
  budget, trigger, invoke and meter skills; interop landscape.
- [`03-interaction-visual-feedback.md`](./03-interaction-visual-feedback.md) — AI SDK 7 parts
  model, AI Elements ↔ `@brand/ai`, AG-UI, and the interaction patterns worth stealing
  (Perplexity, ChatGPT, Cursor, Devin, Smashing's agentic-UX patterns).
- [`04-genui-agent2ui.md`](./04-genui-agent2ui.md) — generative UI / Agent2UI deep dive
  (Thesys OpenUI · CopilotKit · assistant-ui): the model→UI pipelines, the **system-prompt
  playbook** (16 rules, verbatim-sourced), the `@brand/ai` capability-gap list
  (raise-upstream vs hub-engine), and what the Hub adopts (R-GUI1–8, WP2.6).

**Normative output:** the requirement catalog distilled from these docs lives at
[`roadmap/assistant-hub/requirements.md`](../../roadmap/assistant-hub/requirements.md)
(R-SES / R-MCP / R-SK / R-UX ids, each mapped to an owning WP). These research docs are the
evidence; the annex is what WPs implement.

**Dogfood thesis (recurring in every doc):** the app already measures exactly what SOTA
harnesses now optimize — per-tool definition tokens (incl. annotations), eager vs `deferred`
tool loading (`TOOL_LOADING_MODES`), prompt/resource surfaces (`mcp_prompt_scans` /
`mcp_resource_scans`), schema→form generation (tool playground), and skill L1/L2/L3 footprints.
The Hub doesn't just adopt the SOTA — it can **display the numbers behind it live**, which no
mainstream assistant does.
