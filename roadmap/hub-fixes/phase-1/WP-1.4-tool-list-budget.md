# WP 1.4 — tools prompt-budget compression

**Phase:** 1 · **Size:** S · **Depends on:** 1.1 · **Model:** Sonnet · **Agent profile:** API prompt

## Objective

Stop the deferred tool list from costing ~6k tokens against a 400-token section budget. Deferred
mode lists per-server summaries, not every bare tool name.

## Why / evidence

Live `/context` for the defect session: prompt section `tools` = 6,000 tokens vs budget 400
(`withinBudget: false`). `formatToolListText` lists one line per tool even in deferred mode
(`apps/api/src/hub/tools/registry.ts` bottom half). With promotion (WP 1.1) the model no longer
needs the full name list: `tool_search` finds tools by task description.

## Design

- Deferred mode: one line per server: `<serverName>: <N> tools (searchable) — e.g. <3 sample names>`.
  Eager mode: unchanged (full names + descriptions).
- Raise `HUB_PROMPT_SECTION_BUDGETS.tools` to a value the compressed list honestly fits
  (measure; likely 600-800) and add a unit test that the deferred list for a 5-server, 280-tool
  catalog stays under budget.
- Context inspector keeps reporting true per-layer tokens (no change needed; verify).

## Files (exclusive)

- `apps/api/src/hub/tools/registry.ts` (`formatToolListText`)
- `apps/api/src/hub/prompting/budgets.ts`
- Tests: `registry.test.ts` (or colocated) list-shape + budget assertions

## Acceptance

- [ ] Deferred list = per-server summary lines; eager list unchanged (snapshot tests both).
- [ ] 280-tool catalog fits the tools budget (token-counted test using the repo's token counter).
- [ ] Prompt still forbids inventing names and still points at `tool_search` (layer text untouched or minimally adjusted).
- [ ] Gate green.
