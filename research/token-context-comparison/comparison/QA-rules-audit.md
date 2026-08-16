# QA Audit — MCP × Model Compatibility Test Catalog (model_severity rules)

**Auditor:** skeptical QA review pass · **Date:** 2026-06-21
**Scope reviewed:** all 30 tests in `tests/test-catalog.json`, the `scope` model in `02-mcp-limits-taxonomy.md`,
the resolver `tests/resolve_model_severity.py`, and the resolved output against `comparison/all-models.json`
(33 models) + `data/cross-cutting-limits.json`.

**Method:** ran the resolver across `gpt-5.5, gemini-3.5-flash, claude-opus-4-8, microsoft/phi-4,
Qwen/Qwen3.6-27B, grok-4.3, meta-llama/Llama-4-Behemoth-288B-16E` for SERVER_TOOL_COUNT_HARD,
ENV_AGGREGATE_TOOL_COUNT, SERVER_REQUEST_SIZE, TOOL_SCHEMA_UNSUPPORTED_KEYWORDS, SERVER_DEFINITION_FOOTPRINT,
SESSION_CONTEXT_HIGHWATER, SESSION_TOOL_TIMEOUT, TOOL_NAME_LENGTH; cross-checked every headline number
against the dataset provenance bundles.

---

## Summary counts

| Severity | Count |
|---|---|
| CRITICAL | 4 |
| MAJOR | 6 |
| MINOR | 5 |
| **Total** | **15** |

**Did the already-fixed traps stay fixed?** Yes — verified correct:
- `scope` field present and correct on the count/footprint pair (SERVER_* = `per_server`, ENV_AGGREGATE_* = `aggregate`).
- `ENV_AGGREGATE_TOOL_COUNT` now resolves Claude → **blocker** citing the 10,000 catalog max (rule 2, `max_total_tools`), not "unlimited". Confirmed in resolver output.
- `SERVER_TOOL_COUNT_HARD` correctly resolves to `na` for uncapped models and its NA rationale points at the aggregate test + the ~40 cliff (no "no limit" phrasing).

**New instances of the two named traps found beyond what was fixed:** **YES — 2 new scope-trap instances and 1 new no-limit-framing instance** (see CRIT-1, CRIT-2, MAJ-3 below). Details follow.

---

## CRITICAL

### CRIT-1 — `TOOL_SCHEMA_UNSUPPORTED_KEYWORDS`: Gemini rule never fires (provider-id mismatch). The catalog's most safety-relevant strict-schema test silently mis-resolves for Google.
- **Problem:** the rule predicates are `provider.id == openai`, `provider.id == google`, `provider.id == anthropic`. The dataset's `provider_id` for Gemini models is **`google-gemini`**, not `google`. The resolver matches on exact string equality (`prov == m.group(1)`), so the Google rule **never matches** and every Gemini model falls through to `default: low` with rationale `"(default — no rule matched)"`.
- **Evidence:** resolver output for `gemini-3.5-flash` on this test = `sev=low … (default — no rule matched)`, while the intended rule is `medium / degraded_accuracy`. Dataset distinct provider_ids: `['alibaba-qwen','anthropic','deepseek','google-gemini','google-gemma','meta-llama','microsoft-copilot','microsoft-phi','mistral','openai','xai']`. The rule text itself is factually correct (the Gemini schema note confirms `anyOf/$ref` added in 2.5+/3), it just never runs.
- **Why critical:** this is a wrong, under-stated severity on a real provider for the one test about schema-keyword rejection; product cells for all 3 Gemini models would show `low` instead of `medium`.
- **Fix:** change the predicate to `provider.id == google-gemini` (and verify any other provider-id token: OpenAI `openai` ✓, Anthropic `anthropic` ✓ already match). Consider also adding a `provider.id == xai` rule — Grok requires an object root (400 on scalar/array root) which this test currently scores `low`.

### CRIT-2 — `SERVER_REQUEST_SIZE`: unit mismatch makes the test meaningless (and it carries a lingering scope mismatch the fix missed).
- **Problem A (units / factual):** `measured.expr = scan.total_raw_bytes` (bytes), but `threshold.source = model.tools_mcp.max_request_size.value` whose values are **not bytes**: Anthropic `32` (unit **MB**), Gemini `100` (unit **MB**), M365 `4096` (unit **tokens**). Comparing raw bytes `<= 32` (interpreting 32 MB as the number 32) fails virtually any real payload; comparing bytes against a *token* budget (M365) is a category error. The resolver leaves this test as flat `blocker / (default — no rule matched)` for every model, so the defect is latent but the comparison as written is wrong.
- **Problem B (scope — NEW instance of the aggregate-vs-per-server trap):** `what_it_does` explicitly says *"The request carries ALL connected servers' tool definitions, so the real payload is the aggregate, not one server,"* yet `scope` is set to **`per_server`** and `measured` uses single-server `scan.total_raw_bytes`. This is exactly the aggregate-vs-per-server mismatch that was fixed for count/footprint — it was **not** fixed here. There is no `ENV_AGGREGATE_REQUEST_SIZE` counterpart.
- **Evidence:** dataset provenance — `claude-opus-4-8 max_request_size = {value:32, unit:"MB"}`; `microsoft-365-copilot = {value:4096, unit:"tokens"}`; `gemini-3.5-flash = {value:100, unit:"MB"}`. Test `measured.unit = "bytes"`.
- **Fix:** (1) normalize units in the comparison (convert MB→bytes; treat M365's 4096-token plugin budget as a *token* check, not bytes — arguably it belongs with footprint, not payload). (2) Either re-scope to `aggregate` + `env.total_raw_bytes`, or add an `ENV_AGGREGATE_REQUEST_SIZE` (`aggregate`) sibling and demote this one to an explicit single-server lower bound, mirroring what was done for count/footprint.

### CRIT-3 — `SERVER_TOOL_COUNT_CONTEXT` computed ceiling goes **negative/zero** for small-window models, forcing a false `fail` on any non-empty server.
- **Problem (factual/logic):** the derived ceiling is `floor((context_window * 0.5 - max_output_tokens_max) / avg_tool_tokens)`. The `* 0.5` already reserves half the window for output, and then the **full** `max_output` is subtracted again — double-counting headroom. When `max_output >= 0.5 * context_window` the numerator is ≤ 0, so the ceiling is ≤ 0 and the verdict is `fail` for *any* server (even one tool), independent of actual footprint.
- **Evidence (computed from dataset):** `microsoft/phi-4` cw=16,384 / max_output=16,384 → `0.5*cw - max_output = -8,192` (negative). `microsoft-copilot-consumer` cw=200,000 / max_output=100,000 → `0`. Both yield a non-positive ceiling. (Phi-4 is exactly the small-window model this test is meant to serve.)
- **Why critical:** the test that is supposed to be *primary for uncapped/open-weight models* produces a degenerate guaranteed-fail on the smallest-window member of that very set.
- **Fix:** use `context_window - max_output` (single subtraction) for headroom, then apply the share factor to that, e.g. `floor((context_window - max_output) * 0.5 / avg_tool_tokens)`, and guard `max(0, …)`. Decide one consistent headroom convention and document it.

### CRIT-4 — `applies_to.capability_field: "strict_function_schema"` references a dataset field that does not exist.
- **Problem (consistency):** `TOOL_SCHEMA_PROPERTY_COUNT`, `TOOL_SCHEMA_NESTING_DEPTH`, and `TOOL_SCHEMA_UNSUPPORTED_KEYWORDS` all declare `applies_to.rule = "capability"` with `capability_field = "strict_function_schema"`. A recursive walk of every model's `detail` finds **no key containing "strict"** anywhere in `all-models.json`. The gate these tests claim to use cannot be evaluated; the product engine that ports `applies_to` would treat applicability as undefined/false for all models.
- **Evidence:** capability-flag scan returned empty for all 33 models; OpenAI's strict-mode facts live only in `cross.providers.openai.schema_micro_limits` and in free-text `tools_mcp.tool_schema_limits_notes`, never as a boolean capability.
- **Fix:** either add a real `tools_mcp.strict_function_schema` boolean to the dataset (true for OpenAI, etc.), or change `applies_to.rule` to `capability` keyed on a field that exists, or to `universal`/`threshold_present` with the provider gating done in `model_severity.rules` (as UNSUPPORTED_KEYWORDS already does for OpenAI/Anthropic).

---

## MAJOR

### MAJ-1 — `SERVER_TOOL_COUNT_PRACTICAL` has empty `rules: []` but severity OBVIOUSLY varies by model (flat-default latent bug).
- **Problem:** `variant: true` but `rules: []`, so every model resolves to flat `high`. The practical selection-cliff in the dataset ranges from **5 (phi-4)** and **10 (gemma-4-E4B, M365)** to **40 (frontier)**. A 20-tool server is catastrophic for Phi-4/Gemma (4× their cliff) but only mild for Opus — yet both score identical `high`. Worse, models with `max_tools_practical = null` (all Gemini, all Llama, grok multi-agent, copilot-consumer) fall back to **40**, which is wildly wrong for the small ones if they were small (here they are large-window, but the fallback is still a blind spot).
- **Evidence:** practical values per model (5→40 spread) pulled from `tools_mcp.max_tools_practical.value`.
- **Fix:** add rules keyed on the practical value, e.g. `max_tools_practical <= 10 → blocker` (tiny lists; small models break hard), `<= 20 → high`, `else → high/medium`. At minimum, make the consequence/rationale cite `{tools_mcp.max_tools_practical}` so a Phi-4 user sees "5", not a generic line.

### MAJ-2 — `SERVER_DEFINITION_FOOTPRINT` / `ENV_AGGREGATE_FOOTPRINT`: window-band rule is correct but the `< 200000` "high" band mis-buckets several mid models, and 1M-window models always resolve `low` even at 49% share.
- **Problem (factual nuance):** rules bucket purely on `context_window` (`<32k blocker`, `<200k high`, `>=200k low`). A 1,000,000-token model at a 45% footprint share resolves `low` ("mostly per-call cost"), but the test's own `fail_at: 0.5` means 45% is one step from a hard fail and is already starving half the window. The per-model severity contradicts the test's own verdict bands at high shares.
- **Evidence:** resolver shows `claude-opus-4-8` (1M) → `low` regardless of share; the verdict band would `warn` at 25% and `fail` at 50%. Severity should track the *share*, not only the window size.
- **Fix:** make the rule consider the measured share too (e.g. `share >= 0.5 → blocker/high even on large windows`), or document that `model_severity` here rates *baseline window adequacy* and the share-based pass/warn/fail is layered on top. As written the `low` label undersells a 49%-share large-window case.

### MAJ-3 — `ENV_AGGREGATE_TOOL_COUNT` rule-3 rationale is a NEW soft "no-limit" framing for uncapped models.
- **Problem (no-limit trap, semantic):** rule 3 (`max_tools_hard absent`) emits *"{provider} has no documented aggregate tool-count cap; the combined set is bound by the {context_window}-token window and the ~40 selection cliff,"* and crucially **does not** consult `max_total_tools`. For models that have neither `max_tools_hard` nor `max_total_tools` (Qwen, Phi, Gemma, Llama, grok-build) this is acceptable, BUT the rule ORDER means any model with `max_total_tools` is caught by rule 2 first — except the wording of rule 3 still asserts "no aggregate cap" which, for a host-targeted run, is false (Cursor 40 / Desktop 100 are the binding aggregate caps and the `models_note` says to use `cross.clients.<target>.max_tools`). The resolver never substitutes `<target>` here, so the host cap is silently dropped and the model is framed as effectively uncapped.
- **Evidence:** `microsoft/phi-4` and `Qwen/Qwen3.6-27B` resolve `high` with "no documented aggregate tool-count cap"; neither rationale mentions that under Cursor the real wall is 40. `SERVER_CLIENT_TOOL_CAP` exists separately but this aggregate test's rationale still reads as "unconstrained except context + cliff."
- **Fix:** append "(under a host like Cursor/Claude Desktop the binding aggregate cap is ~40/~100 — see SERVER_CLIENT_TOOL_CAP)" to the rule-3 rationale, mirroring the wording rule applied to SERVER_TOOL_COUNT_HARD's NA branch.

### MAJ-4 — `SESSION_CALLS_PER_TURN`: source field is null for **every** model, so the test is permanently NA despite a real, documented Anthropic guardrail.
- **Problem (factual / dead test):** `threshold.source = model.tools_mcp.tool_use_per_turn_limit.value` is `null` for all 33 models (verified). The `models_note` itself says the binding numbers are the Anthropic server guardrail (~20 calls / 10 iterations) and the OpenAI Agents SDK default (10 turns) — both of which live in `cross.providers.*` / `cross.sdk_defaults`, not in the per-model field the threshold reads. So the test can only ever return NA, never the blocker/high it's designed for.
- **Evidence:** `models with tool_use_per_turn_limit set: NONE`. Taxonomy §6 documents the Anthropic ~20-call pause_turn guardrail (Tier-4) and OpenAI SDK max_turns=10 (Tier-1).
- **Fix:** point the threshold/rules at `cross.providers.<provider>.tool_use_per_turn_limit` (Anthropic) and `cross.sdk_defaults.*` (OpenAI Agents SDK), or populate `tools_mcp.tool_use_per_turn_limit` for Anthropic models. Without this the test is inert.

### MAJ-5 — `SESSION_TOOL_RESULT_SIZE`: heterogeneous, non-comparable units in the threshold source (mirrors CRIT-2 but for results).
- **Problem (factual):** `measured` is `response_tokens` (with `response_bytes` available), but `threshold.source = model.tools_mcp.max_tool_result_size.value` carries mixed, non-token units: OpenAI `"512KB"` (string, unit bytes, Tier-4 community), M365 `25` (unit **items**), everyone else `null`. Comparing token counts against "25 items" or the string "512KB" cannot be done numerically; the fallback window-share path (10%/25%) is the only coherent branch.
- **Evidence:** `gpt-5.5 max_tool_result_size = {value:"512KB", source_tier:4}`; `microsoft-365-copilot = {value:25, unit:"items"}`.
- **Fix:** parse/normalize: treat OpenAI as bytes (512 KB → bytes, flag low confidence), treat M365's "25 items" as a *separate item-count* check (not a token/byte comparison), and otherwise use the window-share fallback. Document that the documented-cap branch only applies where the unit is bytes/tokens.

### MAJ-6 — `SESSION_TOOL_TIMEOUT`: severity and rationale are entirely client-driven, but the test is filed as a per-model `variant: true` test with `default: high`, and resolves identically for all models (including non-scorable ones).
- **Problem (consistency / scope):** the only rule keys on `cross.clients.<target>.tool_call_timeout_ms`; severity does not depend on the model at all (the rationale even admits "Severity is client-driven, not model-driven"). It resolves `high` for every model, including `Llama-4-Behemoth` which is flagged non-scorable elsewhere. Marking it `variant: true` over models is misleading; it's a per-host test.
- **Evidence:** resolver output — identical `high` + identical 60,000 ms rationale for all 7 probed models. `is_scorable(Behemoth) = False` yet it still emits a confident verdict here.
- **Fix:** either set `variant: false` (flat client-driven) or make the resolver gate the model-severity tests on `is_scorable` so non-scorable models (null context window) return an "insufficient data" marker uniformly. NOTE: `is_scorable()` exists in the resolver but is **never called inside `resolve()`** — Behemoth currently renders real verdicts on every variant test rather than being flagged. (See MIN-1.)

---

## MINOR

### MIN-1 — `is_scorable()` is defined but never wired into `resolve()`; Llama-4-Behemoth (null context) renders real verdicts.
- **Problem:** the resolver has `is_scorable(model_id)` to flag models with no documented context window, but `resolve()` never calls it. Behemoth (`context_window = null`) therefore produces confident outputs: `ENV_AGGREGATE_TOOL_COUNT → high "bound by the (undocumented)-token window…"`, `SERVER_DEFINITION_FOOTPRINT → high (default — no rule matched)` (no window rule matched because all 3 predicates need a numeric value), `SESSION_TOOL_TIMEOUT → high`. The `(undocumented)` placeholder renders gracefully (good), but the verdict itself should be suppressed as insufficient-data.
- **Fix:** in `resolve()`, early-return an `na / insufficient_data` result when `not is_scorable(model_id)` for tests whose threshold/rules depend on the context window (footprint, context, count-context). Confirm this is the intended product behavior and document it.

### MIN-2 — `SERVER_DEFINITION_FOOTPRINT` rule for `< 32000` claims "no-go" / blocker, but a tiny *footprint* on a small window is fine.
- **Problem (nuance):** rule 1 fires purely on `context_window < 32000` and labels it `blocker` ("effectively a no-go") regardless of the actual footprint share. A 2%-share server on Phi-4 is not a blocker. The blocker should be gated on share, not window alone. (Currently masked because the resolver's `model_severity` ignores the measured value, so it always escalates small-window models to blocker.)
- **Fix:** condition the blocker on `share >= fail_at` (0.5) AND small window, or clearly document that this severity is the *worst-case* rating for that window class, with the verdict band carrying the actual pass/warn/fail.

### MIN-3 — `TOOL_NAME_PATTERN` is `variant: true` with empty `rules: []`, but it hard-fails only on OpenAI and is advisory elsewhere — severity varies by provider.
- **Problem:** flat `high` for all models, yet `verdict_bands` distinguish `fail` (OpenAI, pattern enforced) from `warn` (providers with no published pattern). The per-model severity should be `blocker/high` on OpenAI and `low/medium` (portability) elsewhere, matching how UNSUPPORTED_KEYWORDS is structured.
- **Fix:** add rules: `provider.id == openai → high/blocker (request_rejected)`; default → `low (portability_risk)`.

### MIN-4 — `SESSION_COST_PER_TASK` rationale risks a soft no-limit framing for open-weight ("price NA").
- **Problem (wording):** `applies_to.models_note` and verdict `na: "no per-token pricing (self-hosted)"` are fine, but ensure the resolved rationale for open-weight (Phi/Gemma/Llama/Qwen self-host) says "cost = self-hosted compute, not unconstrained" rather than implying free/unlimited. Currently `variant: true` with empty rules → flat `low` and the generic `impact.what_happens`, which is acceptable, but the NA framing for price should explicitly name compute cost.
- **Fix:** minor wording: in the NA branch, "no per-token price (self-hosted); cost is GPU/compute time, not zero."

### MIN-5 — `applies_to.rule` vs `model_severity.variant` consistency drift on several tests.
- **Problem (consistency):** e.g. `SESSION_PARALLEL_CALLS` is `variant: true` with empty rules and `threshold_present`, but only `microsoft-365-copilot` has a numeric `max_parallel_tool_calls_count` (`1`); for everyone else it's NA, so `variant:true` buys nothing. Same pattern on `TOOL_DESCRIPTION_LENGTH` (only OpenAI 1024 documented), `TOOL_SCHEMA_PROPERTY_COUNT`/`NESTING_DEPTH` (effectively OpenAI-only). These resolve to flat default and are fine functionally, but `variant:true` + empty `rules` is a smell that hides where a real per-provider split (OpenAI vs rest) is warranted.
- **Fix:** for the OpenAI-strict family, add an explicit `provider.id == openai` blocker/high rule and a non-OpenAI advisory rule so the resolved severity and rationale are provider-accurate, then either populate rules or set `variant:false` where it truly is invariant.

---

## Cross-check: headline numbers vs dataset (spot audit)

| Claim in catalog | Dataset value | Verdict |
|---|---|---|
| OpenAI hard cap 128 | `gpt-5.5 max_tools_hard=128`, `max_total_tools=128` | ✓ |
| Gemini 512 | `gemini-3.5-flash max_tools_hard=512` | ✓ |
| Claude 10k aggregate catalog | `claude-opus-4-8 max_total_tools=10000`, `max_tools_hard=null` | ✓ |
| Grok 200 | `grok-4.3 max_tools_hard=200` | ✓ |
| Mistral 128 | `mistral-medium-3-5 max_tools_hard=128` | ✓ |
| Cursor 40 / Desktop 100 / VS Code 128 | `cross.clients` cursor=40, claude_desktop=100, vscode_github_copilot=128 | ✓ |
| OpenAI strict: 100 props / 5 depth / oneOf+$ref banned | `cross.providers.openai.schema_micro_limits` matches | ✓ |
| "reasoning bills as output" | `cost.reasoning_billed_as_output=true` for gpt-5.5/gemini/opus/grok/qwen | ✓ |
| Anthropic cache min 1,024 / OpenAI 1,024 / Gemini 2,048–4,096 | taxonomy §3 matches provider docs | ✓ |
| Anthropic 32 MB request | `max_request_size={32,"MB"}` | ✓ value, ✗ comparison units (CRIT-2) |
| Gemini added anyOf/$ref in 2.5+/3 | confirmed in `tool_schema_limits_notes` | ✓ fact, ✗ rule never fires (CRIT-1) |

The headline numbers are accurate; the defects are in **rule wiring (provider-id), unit normalization, computed-ceiling math, a missing capability field, and several `variant:true`+empty-rules tests where severity genuinely varies by model.**

---

## Recommended fix priority
1. CRIT-1 (one-token predicate fix; wrong Gemini severity today).
2. CRIT-3 (negative-ceiling math; false fails on small-window models).
3. CRIT-2 (request-size units + scope sibling).
4. CRIT-4 (non-existent capability field) + MIN-1 (`is_scorable` not wired).
5. MAJ-1 (practical-count rules) and MAJ-3/MAJ-4 (no-limit framing + dead per-turn test).

---

## RESOLUTION (applied 2026-06-21) — all 15 fixed & verified

| # | Fix applied | Verified by |
|---|---|---|
| CRIT-1 | `provider.id == google` → `google-gemini`; `UNSUPPORTED_KEYWORDS` re-scoped `applies_to: universal` | resolver: Gemini now **medium** (was low) |
| CRIT-2 | added `ENV_AGGREGATE_REQUEST_SIZE` (aggregate); per-server kept; unit-normalization note (MB→bytes, M365 tokens→footprint) on both | catalog now 31 tests; schema-valid |
| CRIT-3 | ceiling formula = `floor(max(0, cw − min(max_output, 0.25·cw))·0.5 / avg)` — no negatives, no zero on tiny windows | phi-4 ceiling now **30** (was −8192/0) |
| CRIT-4 | added real `tools_mcp.strict_function_schema` boolean to all 33 models (true for OpenAI); PROPERTY_COUNT/NESTING_DEPTH gate on it | all models have the field; strict=true only for the 3 OpenAI models |
| MAJ-1 | `SERVER_TOOL_COUNT_PRACTICAL` rules added — cite the per-model cliff value | resolver: phi-4 "~5 tools", OpenAI "~40" |
| MAJ-2 / MIN-2 | footprint rationales reworded — small-window not "no-go", large-window notes share still warns/fails | re-audit wording: 0 |
| MAJ-3 | `ENV_AGGREGATE_TOOL_COUNT` rule-3 now references host caps (Cursor ~40 / Desktop ~100 → see SERVER_CLIENT_TOOL_CAP) | re-audit na_no_xref: 0 |
| MAJ-4 | `SESSION_CALLS_PER_TURN` threshold → `cross.providers.<provider>.agent_loop_default_turns`; rules added (Anthropic ~20 high, OpenAI SDK 10 medium) | resolver: no longer permanent-NA |
| MAJ-5 | `SESSION_TOOL_RESULT_SIZE` unit-normalization note (512KB→bytes / 25 items / window-share) | documented in `threshold.computed` |
| MAJ-6 | `SESSION_TOOL_TIMEOUT` set `variant:false` (host-driven, not per-model) | resolver consistent across models |
| MIN-1 | `is_scorable()` wired into `resolve()` — null-context models return "insufficient data" | Behemoth → **insufficient data** on window tests |
| MIN-3 | `TOOL_NAME_PATTERN` rules added (OpenAI/Anthropic high, else low portability) | resolver provider-split |
| MIN-4 | `SESSION_COST_PER_TASK` self-host rule — "GPU/compute time, not zero" | re-audit wording: 0 |
| MIN-5 | OpenAI-strict family (`DESCRIPTION_LENGTH`, `PROPERTY_COUNT`, `NESTING_DEPTH`) given explicit provider rules | resolver provider-accurate |

**Plus, the programmatic sweep found 1 item the rules-auditor didn't:** the **"Claude unlimited"** trap
recurring in `microsoft-copilot.json` GitHub Copilot `other_limits_notes` — reworded to "Claude no fixed
per-request cap but 10k aggregate catalog."

**Post-fix state:** 31 tests, schema-valid (0 errors); re-audit wording/na-no-xref/null-render all **0**;
headline numbers unchanged (the dataset was already correct). Residual design note for a later pass: the
context-derived ceiling's output-reserve convention (cap at 25% of window) is a heuristic — expose it as a
tunable. Resolver reference impl updated accordingly.
