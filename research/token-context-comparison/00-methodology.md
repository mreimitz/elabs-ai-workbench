# 00 — Comparison Methodology

> How we compare top LLMs for the MCP Token Footprint recommendation engine.
> **As-of date:** 2026-06-21. **Owner:** research/token-context-comparison.
> Model specs change frequently — every data file carries its own `as_of` and per-field
> provenance so staleness is visible. See [`README.md`](./README.md) for how this feeds the product.

## 1. Why this exists

The MCP Token Footprint tool measures how much of a model's context budget an MCP server's
tool definitions consume (startup footprint) and what a `tools/call` costs at runtime. Those
token counts are **only meaningful relative to a specific model**: 55k tokens of tool
definitions is a rounding error in Gemini 3.1 Pro's 1M window but a third of an 8k-window
self-hosted model. This dataset is the **per-model baseline** the recommendation engine needs
to answer questions like:

- "Given this server's footprint, which models can host it comfortably?"
- "How many of these tools can I load before crossing the model's practical tool-selection cliff?"
- "What will a typical session of N calls cost on model X vs Y?"

It also feeds the token-counting adapters (`generic_o200k`, `generic_cl100k`, `raw_json_rough`
today; provider-specific later) and the cost-per-task / session-analysis work on the roadmap.

## 2. Scope (the roster)

Two groups, **latest 3 models each**, chosen 2026-06.

**SaaS (hosted-only API / product):** Anthropic (Claude), OpenAI (GPT), Google (Gemini),
xAI (Grok), Mistral, Microsoft Copilot.

**Client-managed (open-weight, self-hostable):** Meta (Llama), DeepSeek, Alibaba (Qwen),
Google (Gemma), Microsoft (Phi).

"Client-managed" = weights you download and run yourself (vLLM, TGI, SGLang, Ollama, on-prem
GPU). For these, most limits are **deployment-configurable**, not vendor-fixed — we record the
model's *native/default* context and the *documented maximum*, and flag that input/output caps
are set by the serving stack, not the vendor.

## 3. The seven comparison axes (what the user asked for)

Every model is profiled on these axes. The field dictionary in
[`01-information-structure.md`](./01-information-structure.md) makes each one a concrete field.

1. **Context window** — total window, and whether input+output share it.
2. **Max input / max output** — separate caps within (or beyond) the window; default vs max
   output; extended/beta context modes.
3. **Tokenization** — tokenizer family, public availability, how text/images/audio become tokens.
4. **Token-consumption accounting** — how the provider counts & bills tokens (incl. reasoning
   tokens, cached/batch, multimodal units), and how to count locally.
5. **MCP / tools** — native MCP support, native function-calling, max tool count, and **how tool
   definitions contribute to the context window** (they are billed as input tokens).
6. **Skills / agentic features** — whether the model/platform has a "skills" concept and **how
   skills, system prompts, and memory contribute to the context window**.
7. **Limits & cost** — price per 1M in/out, caching/batch, rate limits relevant to sessions.

## 4. Source hierarchy (authority ranking)

Each field records its source. When sources conflict, prefer the higher tier and note the conflict.

- **Tier 1 — Primary (authoritative).** The provider's own API reference, model cards, pricing
  pages, and tokenizer docs. Examples: `docs.claude.com`, `platform.openai.com` /
  `developers.openai.com`, `ai.google.dev` / Vertex docs, `docs.x.ai`, `docs.mistral.ai`,
  Microsoft Learn (Copilot / Azure AI Foundry), Hugging Face model cards & `config.json` /
  `tokenizer_config.json` for open weights, Meta/DeepSeek/Qwen/Gemma/Phi official model cards.
- **Tier 2 — Tooling ground-truth.** Tokenizer libraries and count-token endpoints that *define*
  the count: `tiktoken` (`o200k_base`, `cl100k_base`), HF `transformers`/`tokenizers`,
  Anthropic `count_tokens`, Google `countTokens`, vendor tokenizer playgrounds.
- **Tier 3 — Aggregators (cross-check).** [Artificial Analysis](https://artificialanalysis.ai/models),
  [llm-stats.com](https://llm-stats.com/), [Morph](https://www.morphllm.com/llm-context-window-comparison).
  Good for a sanity pass across many models; never the sole source for a hard number.
- **Tier 4 — Practitioner reports.** Berkeley Function-Calling Leaderboard, engineering blogs,
  GitHub discussions. Used **only** for *practical* limits that vendors don't publish (e.g. "tool
  accuracy degrades past 30–50 tools"), clearly labeled as empirical, not spec.

## 5. Definitions & normalization rules

To keep models comparable, every contributor uses these definitions verbatim.

- **Context window (`context_window_tokens`)** — the maximum total tokens the model attends to in
  one request, **input + output combined**, unless the provider documents them as fully separate
  pools (note which). Record the *production-GA* value; record beta/extended windows (e.g. 1M
  betas) separately in `extended_context`.
- **Max input tokens** — the largest prompt accepted. Often ≈ context window − minimum output.
  If undocumented, derive as `context_window − max_output` and mark `derived: true`.
- **Max output tokens** — the cap on a single completion. Record both the **default** and the
  **maximum** (some models need a parameter or beta header to reach max). Reasoning/"thinking"
  tokens usually count toward output — note if so.
- **Token** — the provider's billed unit. Note the tokenizer so counts are reproducible. For
  multimodal, record the conversion rule (image → tiles/tokens, audio → tokens/second).
- **Tool definition footprint** — tools/functions are serialized into the request and **count as
  input tokens**. We record any documented per-tool or total-tools limit and, where known, the
  shape used (OpenAI function JSON vs Anthropic tool block vs raw MCP) since shape changes the count.
- **Max tools** — distinguish **hard limit** (API rejects more — e.g. OpenAI's 128) from
  **practical limit** (accuracy/context degradation — empirical, Tier 4). Also distinguish the
  **scope**: per-request/**aggregate** caps (all tools+servers combined — where 128/512/10k bind)
  vs a single server. **There is no documented per-MCP-server hard tool cap** — a server's "limit"
  is just its share of the aggregate budget.
- **Recording absence (anti-trap).** The absence of an OpenAI-style per-request count cap is **not**
  "no limit." Record it as *"no per-request numeric cap"* and always point to the limits that **do**
  bind (aggregate catalog max, the ~30–50 selection cliff, the context window). Never write
  *"no hard cap / no limit / unlimited / doesn't apply"* in prose or rationale templates — that
  phrasing misrepresents models like Claude, which has a documented 10,000-tool aggregate ceiling.
- **Skill** — a packaged, model-invokable capability/instruction bundle (Anthropic Agent Skills,
  OpenAI GPTs/Assistants, Copilot agents/extensions). Record whether it exists, how it is loaded
  (always-on vs progressive disclosure), and its context cost (system-prompt/tool-injection tokens).
- **Provenance is mandatory.** Every non-obvious number gets `{value, source_url, source_tier,
  as_of, confidence}`. `confidence ∈ {high, medium, low}`. Unknowns are `null` with a `notes`
  reason — never a guess presented as fact.

## 6. 2026-06 landscape snapshot (orientation, verify per-model)

A quick map so contributors recognize the current generation. **Treat as a pointer, not a source —
confirm every number against Tier 1/2.**

| Provider | Group | Current lead model(s) | Window (GA) | Notable |
|---|---|---|---|---|
| Anthropic | SaaS | Claude Opus 4.8, Sonnet 4.6, Haiku 4.5 | 1M GA (Opus/Sonnet, flat-rate); 200K (Haiku) | MCP-native; Agent Skills |
| OpenAI | SaaS | GPT-5.5 family | ~400K–1M | Responses API + MCP; 128-tool hard cap |
| Google | SaaS | Gemini 3.1 Pro / Flash | 1M | `countTokens` API; multimodal |
| xAI | SaaS | Grok 4.3, Grok 4 Fast | up to ~2M (Fast) | largest practical window |
| Mistral | SaaS | Mistral Large/Medium (latest) | ~128K–256K | also open-weights heritage |
| Microsoft | SaaS | Copilot (GPT-5.x + MAI) | product-level | limits are product, not raw API |
| Meta | Open | Llama 4 Scout/Maverick (+next) | up to 10M (Scout) | huge window; deployment-set caps |
| DeepSeek | Open | DeepSeek V4 / R-series | ~128K+ | cheap; MoE; reasoning variant |
| Alibaba | Open | Qwen3.5 / Qwen3 series | ~256K (1M ext.) | strong tool-use; HF tokenizer |
| Google | Open | Gemma 3 series | ~128K | small, self-host friendly |
| Microsoft | Open | Phi-4 series | ~16K–128K | small models; modest windows |

## 7. Cross-cutting findings that shape the schema

These are *why* certain fields exist; they apply to every model.

- **Tool definitions are input tokens.** Function/tool JSON is injected into the prompt and billed
  as input. This is the entire premise of the footprint tool — so `tools` is a first-class axis,
  not a footnote.
- **Two different "max tools."** A *hard* API cap (OpenAI = 128 tools/request; Claude Desktop shows
  ~100) and a *practical* cliff (Berkeley FCL: scheduling accuracy fell 43%→2% as tools went 4→51;
  community consensus: degradation begins ~30–50 tools). Record both; the recommendation engine
  needs the practical number more than the hard one.
- **Mitigations exist and matter for sessions.** Tool search / deferred loading (Claude Code
  `ENABLE_TOOL_SEARCH`, `defer_loading`), prompt caching (≈90% off cached input), and batch
  (≈50% off) materially change real session cost — capture as boolean+notes per model.
- **Tokenizer family determines count reproducibility.** OpenAI = `o200k_base`/`cl100k_base` via
  `tiktoken`; open weights = the model's HF tokenizer; Anthropic/Google = closed, use their
  count-token APIs. The `raw_json_rough` profile is the floor when no tokenizer is available.
- **Output is the expensive direction.** Output is typically 3–5× input price; reasoning tokens
  bill as output. Cost-per-task estimates must weight output and reasoning, not just prompt size.

## 8. Method (process)

1. Research methodology + sources (this doc).
2. Define the information structure + JSON Schema + template ([`01-information-structure.md`](./01-information-structure.md), [`schema/`](./schema/)).
3. One research **subagent per provider** fills `data/<group>/<provider>.json` + writes
   `docs/<group>/<provider>.md`, using only the source hierarchy above and recording provenance.
4. Orchestrator merges into [`comparison/`](./comparison/) (matrix + combined `all-models.json`).
5. QA pass: schema-validate, spot-check headline numbers against Tier 1, flag low-confidence fields.

## 9. Known limitations

- **Volatility:** point-in-time as of 2026-06-21; frontier models rev monthly. Re-run per provider.
- **Closed tokenizers:** Anthropic/Google/xAI counts depend on their APIs; local estimates approximate.
- **Open-weight caps are deployment-defined:** "max input/output" reflects native config + documented
  max, not a vendor guarantee — the operator's serving stack is the real limit.
- **Copilot is a product, not a raw model:** its limits are surfaced at the app/Foundry layer and
  shift with the underlying model; we record product-level + underlying-model where separable.

## Sources (methodology grounding)

- [Artificial Analysis — Models](https://artificialanalysis.ai/models)
- [llm-stats.com — Leaderboard](https://llm-stats.com/)
- [Morph — LLM Context Window Comparison 2026](https://www.morphllm.com/llm-context-window-comparison)
- [OpenAI — Function calling guide](https://developers.openai.com/api/docs/guides/function-calling)
- [MCP discussion — max tools for Claude Desktop](https://github.com/orgs/modelcontextprotocol/discussions/537)
- [Start Debugging — reducing MCP tools to avoid tool-use limit (2026)](https://startdebugging.net/2026/05/how-to-reduce-the-number-of-mcp-tools-claude-loads/)
- [Anthropic API pricing breakdown (2026)](https://www.finout.io/blog/anthropic-api-pricing)
- [Hugging Face — Tokenizer docs](https://huggingface.co/docs/transformers/en/main_classes/tokenizer)
