---
type: "Research Output"
title: "04 \u2014 mcp-builder Skill vs. Our Test Suite (Gap Analysis)"
description: "Reviewed the ComposioHQ mcp-builder skill (SKILL.md, reference/, scripts/) against our"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 04 — `mcp-builder` Skill vs. Our Test Suite (Gap Analysis)

> Reviewed the ComposioHQ `mcp-builder` skill (SKILL.md, `reference/`, `scripts/`) against our
> [`03-compatibility-test-suite.md`](./03-compatibility-test-suite.md). Question: does it care about
> things our suite would miss? **Short answer: yes — on a mostly orthogonal axis, and a few of its
> concerns are directly worth adopting.** **As-of:** 2026-06-21.
> Source: https://github.com/ComposioHQ/awesome-claude-skills/tree/master/mcp-builder

## TL;DR

The two are **complementary, not overlapping**:

| | `mcp-builder` skill | Our compatibility suite |
|---|---|---|
| **Question it answers** | "Are these *well-designed* tools an LLM can actually use to do real work?" | "Will this server *fit and comply* within each model's limits, and what will it cost?" |
| **Nature** | Build-time **design quality** + run-time **agentic effectiveness** | **Mechanical compatibility & cost**, per model |
| **Models** | Claude-centric, **single model** (hardcoded `claude-3-7-sonnet`) | **Multi-model** (33 models, the heatmap is the point) |
| **Method** | Best-practice checklist + a live **agent eval harness** (task success) | Static limit checks + session token/limit assertions |
| **Quantifies tokens/cost?** | No (counts tool calls + duration only) | Yes (footprint %, cost/task, cache, rate) |

So it cares about ~8 things we'd miss, and we cover ~6 things it misses. Neither subsumes the other.

## What the skill actually contains

- **SKILL.md** — a 4-phase build workflow: Research/agent-centric design → Implement → Review →
  **Create evaluations**.
- **`reference/mcp_best_practices.md`** — the substantive checklist: naming, response formats,
  pagination, character limits/truncation, transports, tool annotations, OAuth/security, resource &
  prompt management, error handling, docs.
- **`reference/{python,node}_mcp_server.md`** — language implementation guides + quality checklists.
- **`reference/evaluation.md` + `scripts/evaluation.py`** — an **agent-based eval harness**: writes
  10 realistic read-only Q&A tasks, runs a Claude agent against the live server, and reports
  **accuracy, avg duration, tool-calls/task, and the agent's own qualitative feedback** on each tool.

## Things the skill cares about that WE'D MISS

### A. Statically testable design-quality checks (could drop straight into our catalog)

These are server-design properties, model-agnostic (they apply to every column of the heatmap). Our
28 tests don't cover them — we test whether a tool *fits*, not whether it's *well-built*.

1. **Tool annotations present & coherent** — `readOnlyHint` / `destructiveHint` / `idempotentHint` /
   `openWorldHint`. We carry an `annotations` field but never assert on it. Matters for safe
   execution (our own playground confirms-before-destructive idea needs this).
2. **Pagination support** — does a list-returning tool expose `limit`/`offset`/`cursor` and return
   `has_more`/`next_offset`/`total_count`? Huge driver of runtime footprint; statically detectable
   from the schema.
3. **Response truncation / CHARACTER_LIMIT guard** — does the tool cap output (the skill recommends
   ~25k chars)? Pairs with our runtime `session.toolResult.size` but is checkable at design time.
4. **Dual response format** — a `response_format` (JSON vs Markdown) / "concise vs detailed" param.
5. **Naming convention** — service-prefixed, action-verb, `snake_case` (`slack_send_message`). We
   test name *length/pattern/uniqueness* but not the *convention* that prevents cross-server collisions.
6. **Human-readable identifiers** — returns names alongside IDs (heuristic, partial static check).
7. **Description quality** — includes examples + when-to-use / when-not (we only test present/length/tokens).
8. **stdio transport hygiene** — server must log to stderr, never stdout (corrupts the protocol).

### B. Runtime effectiveness (their harness has it, our session level is specced but empty)

9. **Task success rate** — can an LLM actually answer real questions with these tools? (accuracy).
10. **Tool-call efficiency** — calls per task (fewer, well-designed tools win).
11. **Agent feedback on tools** — the harness asks the model to critique names/params/descriptions/errors.
12. **Error-message actionability** — observed when tools fail mid-task.

### C. Security & governance (we have zero of this)

13. **OAuth 2.1 / token audience validation / no token pass-through**, input sanitization
    (injection, path traversal), PII minimization, HTTPS, DNS-rebinding. Mostly manual/server-impl,
    but a "security posture" checklist is a real gap if this suite is meant to vet servers, not just
    size them.

## What WE cover that the skill MISSES

- **Per-model limits & the heatmap** — Gemini's 512 cap, OpenAI's 128, context-window fit, client
  caps (Cursor 40). The skill is single-model and limit-agnostic.
- **Token footprint quantification** — % of each model's window, per tokenizer/tool-shape. The skill
  says "make tokens count" but never measures them.
- **Cost-per-task, cache eligibility, rate-limit interaction** — none of this exists in the skill.
- **The 4-layer limit taxonomy** (model/client/protocol/serving) and the cross-cutting limits file.
- **Multi-model comparison** — their harness hardcodes one Claude model; ours is built to rank across the roster.

## Recommended integration (high value, low effort)

1. **Adopt their eval harness as our SESSION-level effectiveness runner — and extend it.**
   `scripts/evaluation.py` already collects tool-call counts + durations; it does **not** capture
   tokens, cost, or multiple models. Wrap it to (a) record input/output/cached tokens per task and
   apply our pricing → real **cost-per-task**; (b) loop over our roster with the right
   `tool_definition_shape` per model → populate `session.*` tests (`context.highWater`,
   `turn.toolCallCount`, `cost.perTask`) with measured data instead of estimates. Their `<feedback>`
   block is a free qualitative signal to surface per tool.
2. **Fold the §A checks into the catalog as a new `design-quality` category** (~8 model-agnostic
   static tests) — see stubs below. Back each `recommendation` with the relevant
   `mcp_best_practices.md` section.
3. **Borrow their evaluation rigor** (read-only, idempotent, stable answers) as the safety contract
   for how our session tests are allowed to execute tools — closes the destructive-call risk noted in
   `roadmap/08-expanded-target.md`.

## Proposed new tests (catalog-ready stubs)

Model-agnostic, `data_phase: static` unless noted. Format matches `tests/test-catalog.json`.

| Tech name | User-facing name | Level | What it does | Recommendation |
|---|---|---|---|---|
| `tool.annotations.coherent` | Tool declares behavior hints | tool | Asserts `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` present and self-consistent. | Add annotations; flag destructive/openWorld tools so hosts can gate them. |
| `tool.pagination.supported` | List tool supports pagination | tool | For list-returning tools, checks for `limit`/`offset`/`cursor` input and `has_more`/`next`/`total` output. | Add a `limit` param + pagination metadata; never return unbounded lists. |
| `tool.output.truncationGuard` | Tool caps response size | tool | Detects a documented character/row cap (skill: ~25k chars) + truncation message. | Add a CHARACTER_LIMIT with a "use filters/offset" truncation note. |
| `tool.output.dualFormat` | Tool offers concise/detailed output | tool | Checks for a `response_format` / detail-level param. | Offer JSON for machines, Markdown/concise for context economy. |
| `tool.naming.convention` | Name follows MCP conventions | tool | Service-prefixed, action-verb, snake_case (`slack_send_message`). | Prefix with the service + a verb to avoid cross-server collisions. |
| `tool.description.quality` | Description is agent-ready | tool | Heuristic: has usage examples + when-to-use guidance, not just a title. | Add examples and "use when…/not when…" to lift tool-selection accuracy. |
| `server.transport.stdioHygiene` | stdio server logs to stderr | server | Flags stdout logging that would corrupt the stdio protocol. | Route all logs to stderr; keep stdout for protocol frames only. |
| `session.task.successRate` | Tools complete real tasks | session (runtime) | Runs the agent eval harness; reports accuracy + calls/task + token cost per model. | Iterate on tools the agent failed/criticized; fewer, higher-signal tools. |

## Verdict

Worth borrowing from. The skill's **agent-eval harness** is the most valuable asset — it's a
ready-made, extensible runner for our entire (currently spec-only) session level, and it already
emits two of our metrics. Its **best-practices checklist** gives us a clean set of ~8 design-quality
tests that broaden the suite from "does it fit this model" to "is it a good server at all." Neither
touches our core differentiator — per-model limits, token footprint, and cost — so they slot in
alongside it cleanly.

# Citations

None.
