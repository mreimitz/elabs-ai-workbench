---
type: "Research Output"
title: "QA Report \u2014 token-context-comparison dataset"
description: "Adversarial Tier-1 spot-check of the highest-value claims in the assembled comparison."
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# QA Report — token-context-comparison dataset

> Adversarial Tier-1 spot-check of the highest-value claims in the assembled comparison.
> **QA date:** 2026-06-21 · **Reviewer:** QA verification subagent · **Method:** WebSearch + direct `web_fetch` of provider docs, prioritizing Tier-1 sources.

## Summary verdict

| # | Check | Verdict |
|---|---|---|
| 1 | Anthropic context-window semantics (1M GA vs beta) | **PASS** |
| 2 | Google Gemini model selection (flagship Pro gap) | **FLAG** (model-selection; documented, not changed) |
| 3 | xAI Grok model picks + "2M context" claim | **PASS** (with note) |
| 4 | Gemma 4 license (Apache-2.0 vs custom terms) | **PASS** (data already correct) |
| 5 | Headline prices: GPT-5.5, DeepSeek V4-Flash, Mistral Large 3 | **PASS** (3/3) |
| 6 | Existence sanity: DeepSeek-V4, Qwen3.6, Gemma 4, Llama 4 Scout | **PASS** (4/4) |

**Tally: 5 PASS · 1 FLAG · 0 CORRECTED.**

No data JSON files were edited. The two checks pre-identified as highest-risk for correction — #1 (Anthropic window encoding) and #4 (Gemma license) — were both found to be **already correct** in the data. The one genuine issue (#2, Gemini flagship-Pro selection gap) is a debatable model-selection matter and, per the QA brief, is documented as a recommendation rather than changed.

---

## Check 1 — Anthropic context-window semantics (`anthropic.json`)

**Verdict: PASS. No change made.**

**Claim under test:** `context_window_tokens = 1,000,000` for Claude Opus 4.8 and Sonnet 4.6, with `extended_context = null`. The concern was that the standard Claude window is historically 200K with a 1M *beta* (header-gated), in which case the correct encoding would be `context_window_tokens = 200000` + `extended_context = 1000000`.

**Finding:** For the **current** generation (Opus 4.8 / Sonnet 4.6), 1M is the **GA default window** on the Claude API, Claude Platform on AWS, Amazon Bedrock, and Vertex AI — **no beta header required**. The 200K window applies only on **Microsoft Foundry**. The historical "200K + 1M beta header" arrangement was true for **Opus 4.6/4.7** but was superseded; the 1M window is now standard and billed at standard per-token pricing across the full window. Therefore the data file's encoding (`context_window_tokens = 1000000`, `extended_context = null`) is **correct for 4.8/4.6**, and the per-model `notes` already document the Foundry 200K exception.

- Confirmed **Opus 4.8 / Sonnet 4.6 max output = 300k** via the Message Batches API with beta header `output-300k-2026-03-24` (sync cap 128k Opus / 64k Sonnet) — matches the data file.
- Confirmed **Opus 4.8 pricing $5 in / $25 out per 1M** (consistent with the pricing-page citations in the file).

**Note on the methodology doc:** `00-methodology.md` §6 snapshot table still lists Anthropic as "~200K (1M flat-rate beta)". That is now **stale** relative to the 4.8 GA docs. The *data file* is the authoritative artifact and is correct; recommend updating the methodology snapshot line to avoid confusion (snapshot is explicitly labeled "pointer, not a source", so this is cosmetic).

**Tier-1 sources:**
- https://platform.claude.com/docs/en/about-claude/models/overview (1M window for current models; Foundry = 200k footnote; 300k batch-output beta header)
- https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8 (Opus 4.8: 1M default, no beta header; 128k max output)

---

## Check 2 — Google Gemini model selection (`google-gemini.json`)

**Verdict: FLAG (model-selection representativeness gap). Documented only — no data field changed (debatable per QA brief).**

**Claim under test:** the roster picks `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`. The concern: a current flagship "Gemini 3.x Pro" may exist, so including an older 2.5 Pro while omitting the current Pro is a selection gap.

**Finding:** The current flagship Pro is **Gemini 3.1 Pro**, released **2026-02-19**. Critically, on the Gemini **Developer API (`ai.google.dev`) it is available only in *preview*** (`gemini-3.1-pro-preview`); `gemini-3-pro-preview` now points to it, and **Gemini 3 Pro Preview was shut down 2026-03-09**. There is **no GA Gemini 3.x Pro** as of 2026-06-21. So:

- The roster's two 3.x picks (3.5 Flash, 3.1 Flash-Lite) are current-generation and GA — good.
- `gemini-2.5-pro` is the **most recent GA Pro-tier** model, since 3.1 Pro is preview-only. The data file's own `notes` already acknowledge this: *"Gemini 3.1 Pro Preview (preview status, not included as the 3rd GA model)..."* — so the omission is deliberate and disclosed, consistent with the methodology's GA-first scoping.

This is therefore **defensible**, but it is still a **representativeness gap**: the dataset presents a Pro-tier model that is a full generation behind the actual flagship, and a reader scanning the matrix may not realize the current Pro (3.1) exists at all in the comparison universe. Because the brief says model-selection issues that are debatable should be documented and **not** changed, I did not alter the file.

- Confirmed **1M context window** (1,048,576) for all three picks and the **image rule of 258 tokens per tile** (≤384px → 258 tokens; larger tiled at 768×768, 258 tokens/tile) — both match the data file.

**Recommendation:** Either (a) add `gemini-3.1-pro-preview` as a fourth Pro-tier entry with `status: "preview"` for flagship coverage, or (b) add a one-line caveat in the matrix that the current flagship Pro (3.1) is preview-only and intentionally excluded. (a) is preferable for the recommender's "most representative latest" goal.

**Tier-1 sources:**
- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview (3.1 Pro is preview on the Developer API)
- https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/ (3.1 Pro announced 2026-02-19)
- https://discuss.ai.google.dev/t/migrate-from-gemini-3-pro-preview-to-gemini-3-1-pro-preview-before-march-9-2026/127062 (3 Pro Preview shutdown 2026-03-09)

---

## Check 3 — xAI Grok model picks (`xai-grok.json`)

**Verdict: PASS (with documentation note). No change made.**

**Claim under test:** the roster picks `grok-4.3`, `grok-4.20-multi-agent`, `grok-build-0.1` — which "look unusual" — plus the data file's assertion that the aggregator "2M context" claim is NOT confirmed.

**Finding — model IDs are real and current:**
- **grok-4.3** is xAI's current flagship per its model card. Confirmed **context window = 1,000,000**, pricing **$1.25 in / $2.50 out per 1M**, cached $0.20, function calling + structured outputs + configurable reasoning. Its alias list **absorbs** `grok-4`, `grok-4-latest`, `grok-4-fast`, `grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`, `grok-4-1-fast-*`, `grok-3*`, `grok-4-0709`, etc. So the "more standard" IDs the brief asked about (`grok-4`, `grok-4-fast`) are **not separate live models** — they redirect to grok-4.3.
- **grok-4.20-multi-agent-0309** (preview, launched 2026-03-10) and **grok-build-0.1** (early access, 2026-05-19) are both documented real models. Picks are defensible as "latest 3".

**Finding — the "2M context" claim:** The 2M-token window belonged to **grok-4-fast-reasoning / grok-4-fast-non-reasoning**, which were **retired 2026-05-15** and now redirect to grok-4.3 (1M). The data file's note is therefore **accurate**: *"The 'Grok 4 Fast ~2M context' referenced in some aggregators is NOT confirmed in current docs — the grok-4-fast alias now points to grok-4.3 with a 1M context window."* The original agent's flag was correct.

**Minor observation (not corrected):** `grok-4.3` `release_date` is `2026-05-19` at `medium` confidence; an aggregator suggests 2026-04-30. The model card does not state an unambiguous GA date, so the existing `medium` confidence is appropriately hedged. Left as-is.

**Tier-1 sources:**
- https://docs.x.ai/developers/models/grok-4.3 (context 1M; $1.25/$2.50; alias list incl. grok-4 / grok-4-fast)
- https://docs.x.ai/developers/migration/may-15-retirement (grok-4-fast etc. retired 2026-05-15, redirect to grok-4.3)
- https://docs.x.ai/developers/models (lineup)

---

## Check 4 — Gemma 4 license (`google-gemma.json`)

**Verdict: PASS — data is already correct. No change made.** (The pre-supplied hypothesis that this was wrong is itself incorrect for Gemma **4**.)

**Claim under test:** the file states Gemma 4 (31B / 12B / E4B) is **Apache-2.0**. The concern: Gemma historically shipped under a custom "Gemma Terms of Use," not Apache-2.0.

**Finding:** Gemma **4** is genuinely **Apache-2.0** — a deliberate licensing change from Gemma 1/2/3 (which used the custom Gemma Terms of Use). This is confirmed three independent ways:
1. The official **Gemma Terms of Use** page states at the top: *"For Gemma 4 terms, see the **Gemma 4 license**"*, linking to `https://ai.google.dev/gemma/apache_2`. Its sidebar lists "**Gemma 4 license**" as a separate legal entry distinct from "Terms of use".
2. The **Appendix** of that same Terms-of-Use page enumerates the models it governs — Gemma 1, 1.1, 2, 3, 3n, CodeGemma, PaliGemma, ShieldGemma, etc. — and **Gemma 4 is deliberately absent**, because it is governed by Apache-2.0 instead.
3. The Gemma 4 HF model cards and Google's launch blog both state Apache-2.0 with no MAU thresholds / industry carve-outs.

The data file's per-field `notes` already explain this correctly: *"This is a significant change from Gemma 1/2/3 which used the custom Gemma Terms of Use."* The high confidence is warranted.

**Tier-1 sources:**
- https://ai.google.dev/gemma/terms ("For Gemma 4 terms, see the Gemma 4 license"; Appendix excludes Gemma 4)
- https://ai.google.dev/gemma/apache_2 (the Gemma 4 Apache-2.0 license)
- https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/ (Apache-2.0 launch)

---

## Check 5 — Headline prices (Tier-1 pricing pages)

**Verdict: PASS (3/3). No changes made.**

| Model | Data file value | Tier-1 finding | Result |
|---|---|---|---|
| OpenAI GPT-5.5 | $5 in / $30 out | $5.00 / $30.00 per 1M (1,050,000 ctx, 128k out) | **PASS** |
| DeepSeek V4-Flash | $0.14 in / $0.28 out | $0.14 / $0.28 per 1M (1M ctx, 384k out, cache-hit $0.0028) | **PASS** |
| Mistral Large 3 | $0.5 in / $1.5 out | `mistral-large-2512` (v25.12) = $0.50 / $1.50 per 1M | **PASS** (see note) |

**Note on Mistral Large 3:** Some aggregators list a "standard Mistral Large 3" at **$2 / $6**. The data file pins the specific dated SKU **`mistral-large-2512`** (released 2025-12-02, the model `mistral-large-latest` resolves to), and cites the dated model card `mistral-large-3-25-12`. Search corroborated **that SKU** at $0.50 / $1.50. The $2/$6 figure appears to be a different/older listing or a different tier; the file is internally consistent and tied to a dated Tier-1 model card, so it is accepted. Recommend a one-line `notes` on the cost field disambiguating from the $2/$6 listing if the team wants to remove all ambiguity. (Could not re-fetch the rendered `mistral.ai/pricing` table within this pass — output exceeded fetch limit and the persisted copy was outside the bash sandbox; verdict rests on the dated model-card SKU + multiple aggregator agreement.)

**Tier-1 sources:**
- https://developers.openai.com/api/docs/models/gpt-5.5 ; https://openai.com/api/pricing/ (GPT-5.5 $5/$30)
- https://api-docs.deepseek.com/quick_start/pricing (DeepSeek V4-Flash $0.14/$0.28)
- https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12 (Mistral Large 3 / `mistral-large-2512`)

---

## Check 6 — Existence sanity (one Tier-1 source each)

**Verdict: PASS (4/4). All real, current models — none hallucinated.**

| Model | Confirmed | Tier-1 source |
|---|---|---|
| **DeepSeek-V4** (Pro 1.6T / Flash 284B) | Real; released 2026-04-24, MIT, 1M context | https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro ; https://api-docs.deepseek.com/news/news260424 |
| **Qwen3.6** (35B-A3B / 27B) | Real; on HF Hub under Apache-2.0 | https://github.com/QwenLM/Qwen3.6 |
| **Gemma 4** (31B / 12B / E4B) | Real; released 2026-04-02, Apache-2.0, up to 256K | https://ai.google.dev/gemma/docs/core/model_card_4 |
| **Llama 4 Scout (10M context)** | Real; Meta states "industry-leading context window of 10M" | https://ai.meta.com/blog/llama-4-multimodal-intelligence/ |

**Note on Qwen3.6 naming:** The data file's open-weight entries (`Qwen3.6-35B-A3B`, `Qwen3.6-27B`) are the **downloadable Apache-2.0 weights** and are correct. Be aware there is *also* a separate **`Qwen3.6-Plus`** flagship that is **proprietary / API-only** (not open-weight) — correctly **excluded** from the open-weight group. No action needed; just confirming the distinction so a future reviewer doesn't "add the flagship".

---

## Recommended follow-ups

1. **Gemini flagship-Pro coverage (from Check 2).** Add `gemini-3.1-pro-preview` (status `preview`) as a fourth Pro-tier entry, *or* add a matrix caveat that the current flagship Pro (3.1) is preview-only and intentionally excluded. As-is, the only Pro in the comparison is a generation behind the real flagship.
2. **Refresh the methodology snapshot (from Check 1).** `00-methodology.md` §6 still says Anthropic "~200K (1M flat-rate beta)" and "Gemini 3.1 Pro / Flash … 1M". The Anthropic line is stale vs the 4.8 GA docs (1M is now the default, not a beta). Update the snapshot line (it is explicitly a non-authoritative pointer, so low urgency).
3. **Disambiguate Mistral Large 3 pricing (from Check 5).** Add a `notes` on the cost field clarifying the file uses the `mistral-large-2512` SKU at $0.50/$1.50 and that aggregator "$2/$6" refers to a different/older listing.
4. **Per-field source_url coverage.** Approximately **39 medium/high-confidence fields across the data files carry a model-level `sources[]` array but lack a per-field `source_url`** (many are `null` source_url with `confidence: low/medium`, or inherit only from the model-level sources list). Provenance is "mostly there" but not field-complete per the methodology's "provenance is mandatory" rule. Recommend a sweep to attach per-field `source_url` to every non-`null`, medium+-confidence field — especially the Tier-4 `max_tools_practical` estimates and the open-weight `max_output_tokens_*` fields that are currently `null`/derived.
5. **Grok release-date precision (from Check 3).** `grok-4.3.release_date` is `medium` confidence with conflicting aggregator dates (2026-04-30 vs the file's 2026-05-19). If xAI publishes a definitive GA date, tighten it; otherwise the current hedge is fine.

_No `data/*.json` files were modified during this QA pass; therefore no re-validation of JSON parsing was required._

# Citations

None.
