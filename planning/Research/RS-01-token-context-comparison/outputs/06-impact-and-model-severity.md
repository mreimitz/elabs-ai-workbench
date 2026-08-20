---
type: "Research Output"
title: "06 \u2014 Impact & Per-Model Severity"
description: "Adds two things to every test: what concretely breaks when it's non-compliant (impact), and"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# 06 — Impact & Per-Model Severity

> Adds two things to every test: **what concretely breaks** when it's non-compliant (`impact`), and
> **how severe that is for each specific LLM/model** (`model_severity`), resolved from the model's
> documented limits with a generated rationale and dataset **evidence**. The same failure can be a
> hard no-go on one model and merely "not great" on another — this layer makes that explicit and
> traceable. **As-of:** 2026-06-21.
> Fields live in [`tests/test-catalog.json`](./tests/test-catalog.json); reference resolver:
> [`tests/resolve_model_severity.py`](./tests/resolve_model_severity.py).

## 1. Why severity must be per-model

A single intrinsic severity is wrong. Exceeding 130 tools is a **hard request rejection** on OpenAI
(128 cap) and Gemini (512), but a **non-issue** on Anthropic (no cap). A 40%-of-window tool footprint
is **catastrophic** on Phi-4 (16K) and **trivial** on Gemini (1M). So severity is a *function of the
model's documented limits*, and we already have those limits — with sources and confidence — in the
dataset. This layer turns that data into a per-model verdict with a reason and a citation.

## 2. Two new per-test structures

### `impact` — the consequence of non-compliance (mostly model-independent)

```json
"impact": {
  "failure_mode": "request_rejected",
  "what_happens": "The API rejects the entire request (HTTP 400) once tool count exceeds the hard cap.",
  "blast_radius": "request",
  "recoverability": "hard_fail"
}
```

**`failure_mode`** (what kind of bad thing happens) is a closed vocabulary:

| failure_mode | meaning |
|---|---|
| `request_rejected` | hard API error — the whole request fails |
| `tool_dropped` | tool silently excluded from what the model sees (client cap) |
| `tool_misselection` | model calls the wrong tool / misses the right one |
| `context_overflow` | definitions/results exhaust the window → truncation/failure |
| `result_truncated` | a tool result is cut off |
| `call_cancelled` | tool execution killed on timeout |
| `cost_latency_inflation` | works, but more expensive / slower |
| `degraded_accuracy` | works, but lower quality |
| `portability_risk` | fine here, breaks on stricter models |
| `silent_incorrectness` | wrong outcome, no error |
| `none` | not applicable on this model |

`blast_radius ∈ {request, tool, session, cost, future}` · `recoverability ∈ {hard_fail, soft_degrade}`.

### `model_severity` — how bad it is per model (the reasoning + evidence engine)

```json
"model_severity": {
  "variant": true,
  "default": "blocker",
  "rules": [
    {
      "when": "model.tools_mcp.max_tools_hard.value exists",
      "severity": "blocker",
      "failure_mode": "request_rejected",
      "consequence": "Exceeding the hard cap returns HTTP 400; the whole request fails.",
      "evidence_fields": ["tools_mcp.max_tools_hard"],
      "rationale_template": "{provider} enforces a hard cap of {tools_mcp.max_tools_hard} tools/request; beyond it the API rejects the call — a hard no-go."
    },
    { "when": "model.tools_mcp.max_tools_hard.value absent", "severity": "na", "failure_mode": "none",
      "consequence": "No hard cap; governed by the context-fit / practical tests instead.",
      "evidence_fields": ["tools_mcp.max_tools_hard"],
      "rationale_template": "{provider} publishes no hard tool cap, so this check does not apply." }
  ]
}
```

- **`variant: false`** → the test's flat `severity` applies to every model (e.g. a missing
  description is always `medium`). No reasoning needed.
- **`variant: true`** → the engine evaluates `rules` in order against the model's dataset entry; the
  first matching rule yields `{severity, consequence, evidence, rationale}`.

## 3. Resolution: reasoning + evidence

For a (test, model) the resolver ([`resolve_model_severity.py`](./tests/resolve_model_severity.py)):

1. If `variant:false` → return `default`.
2. Else evaluate each rule's `when` predicate against the model's data; take the first true rule.
3. **Evidence** = for each `evidence_fields` path, pull the model's provenanced bundle
   `{value, source_url, source_tier, confidence}` straight from the dataset. This is the citation —
   the actual documented number that justifies the severity.
4. **Rationale** = `rationale_template` with `{provider}` and `{dataset.path}` placeholders filled
   from that model's values. Human-readable, model-specific, and backed by the evidence.

So every non-default verdict carries *why* (rationale) and *proof* (evidence + source URL + confidence).

## 4. Worked examples (real resolver output)

**`SERVER_TOOL_COUNT_HARD`** — impact `request_rejected` / `hard_fail`:

| Model | Severity | Rationale (filled) | Evidence |
|---|---|---|---|
| Gemini 3.5 Flash | **blocker** | Google enforces a hard cap of 512 tools/request; beyond it the API rejects the call — a hard no-go. | `max_tools_hard=512` (high) |
| GPT-5.5 | **blocker** | OpenAI enforces a hard cap of 128 tools/request; … | `max_tools_hard=128` (high) |
| Claude Opus 4.8 | **na** (this per-server test) | Anthropic has no fixed per-request count cap, so one server can't be rejected on count here; binding limits are aggregate (see below) + the ~40 cliff. | `max_tools_hard=null` |
| Phi-4 | **na** (this per-server test) | No fixed per-request count cap; bound by the window + selection cliff. | `max_tools_hard=null` |

> ⚠️ **Scope note (post-QA):** `SERVER_TOOL_COUNT_HARD` is **per-server** (does one server alone bust
> the cap). The cap itself is **aggregate**, so the binding gate is the companion **`ENV_AGGREGATE_TOOL_COUNT`**
> (scope `aggregate`), which sums *all* connected servers. There, Claude resolves to **blocker** —
> *"Anthropic's aggregate ceiling is 10,000 tools (catalog, with tool search)"* (`max_total_tools=10000`) —
> so Claude is **never** shown as "unlimited." Earlier wording ("publishes no hard cap / doesn't apply")
> was corrected: a model with no per-request cap still has binding aggregate + practical limits.

**`TOOL_SCHEMA_UNSUPPORTED_KEYWORDS`** — impact `request_rejected` / `hard_fail`:

| Model | Severity | Rationale | Evidence |
|---|---|---|---|
| GPT-5.5 | **blocker** | OpenAI strict schemas reject oneOf/$ref; the call fails until rewritten. | `tool_schema_limits_notes` (strict-mode rules) |
| Gemini 3.5 Flash | **medium** | Gemini supports more keywords but still rejects oversized/forced-mode schemas. | `tool_schema_limits_notes` |
| Claude Opus 4.8 | **low** | Anthropic is permissive; mainly a portability risk to stricter models. | `tool_schema_limits_notes` |

**`SERVER_DEFINITION_FOOTPRINT`** — impact `cost_latency_inflation` / `soft_degrade`, severity scales with the window:

| Model | Severity | Rationale | Evidence |
|---|---|---|---|
| Phi-4 | **blocker** | Phi's 16,384-token window is small; a heavy footprint risks overflow before the user speaks. | `context_window_tokens=16384` (high) |
| Qwen3.6-27B | **low** | Qwen's 262,144-token window easily absorbs the footprint. | `context_window_tokens=262144` |
| Gemini / GPT-5.5 / Claude | **low** | 1M-token window absorbs it; impact is mostly per-call cost. | `context_window_tokens≈1,000,000` |

This is exactly the "hard no-go for one model, just *not good* for another" behavior, derived — not
hand-set — from the dataset.

## 5. How it changes the heatmap

The resolved **per-model severity replaces the flat severity** in scoring (`03-…` §5):

- **Gate:** a `blocker` *resolved for that model* with `verdict=fail` turns the cell red. The same
  failing tool is red on Phi-4 (footprint→blocker) and amber/green on Gemini (footprint→low).
- **Weight:** the cell score uses the resolved severity's weight, so a model where the test is `low`
  is barely dinged while one where it's `blocker` is dominated by it.
- **`na` drops out** of that model's denominator (the test doesn't apply there).
- **Drill-down** shows, per cell: the `failure_mode` ("what breaks"), the filled rationale ("why,
  for this model"), and the evidence chips (the documented value + source link + confidence).

Net: the heatmap colors and the explanations are now both model-specific and cited.

## 6. Predicate DSL (for `when`)

Minimal, evaluated against the resolved model row + cross-cutting file:

- `provider.id == openai` — provider match.
- `model.<path>.value exists` / `absent` — is the limit documented for this model.
- `model.<path>.value < N` / `<= N` / `> N` / `>= N` — numeric thresholds (e.g. window size bands).
- `cross.clients.<target>.<field> exists` — client/host-keyed (severity can be host-driven, not just model-driven — see `SESSION_TOOL_TIMEOUT`).
- combine with `&&` / `||` (reference impl handles the common single-clause forms; extend as needed).

## 7. Status & what's left

> **Counts corrected 2026-06-21** after the TS engine port (`apps/api/src/compatibility/`). The
> catalog has **31 tests** (8 server · 11 tool · 8 session · 4 environment). The earlier "28"/"18
> pending" figures were stale — several variant rule sets were authored since.

- **`impact`: all 31 tests populated.**
- **`model_severity`: 6 invariant** (flat severity, no reasoning needed) —
  `SERVER_TOOL_NAME_DUPLICATE`, `SERVER_PRIMITIVE_FOOTPRINT`, `TOOL_DESCRIPTION_PRESENT`,
  `TOOL_DESCRIPTION_TOKEN_BUDGET`, `TOOL_SCHEMA_ENUM_SIZE`, `SESSION_TOOL_TIMEOUT`.
- **14 variant tests fully ruled** — the pattern is proven and validated by the resolver (and by the
  TS fixture-parity test `apps/api/test/compatibility-resolve.test.ts`).
- **11 variant tests carry `variant:true` + `rules:[]`** — flagged as needing model-specific rules,
  to be authored on the same pattern (predicate → severity + consequence + evidence_fields +
  rationale_template). These are the next batch (Phase 5 / WP-5.5):
  `SERVER_TOOL_COUNT_CONTEXT`, `SERVER_REQUEST_SIZE`, `SERVER_CLIENT_TOOL_CAP`,
  `SERVER_NAMESPACED_NAME_LENGTH`, `TOOL_SCHEMA_PRESENT`, `TOOL_DEFINITION_TOKENS`,
  `SESSION_TOOL_RESULT_SIZE`, `SESSION_CONTEXT_HIGHWATER`, `SESSION_PARALLEL_CALLS`,
  `SESSION_CACHE_ELIGIBILITY`, `SESSION_RATE_LIMIT_THROUGHPUT`.

Authoring the remaining 11 is mechanical given the dataset; each needs 2–3 predicate→severity rules.
Until authored they resolve to the test's `default` severity (the engine handles this gracefully).

# Citations

None.
