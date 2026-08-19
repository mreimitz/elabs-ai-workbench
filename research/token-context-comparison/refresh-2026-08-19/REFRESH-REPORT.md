# Model / MCP-limits dataset refresh — 2026-08-19

Refresh and validation of `research/token-context-comparison/data/**`, the hand-curated source of
truth for per-model MCP/tool limits. Previous research date: **2026-06-21** (~2 months stale).

**Method.** One research agent per vendor (11 in parallel), then three independent evidence auditors
that re-opened the cited URLs to *refute* rather than confirm, then two remediation rounds and a
final re-audit. ~800 distinct public pages opened across ~1,400 tool calls.

**Evidence policy (as instructed).** Tier-1 vendor documentation required for every hard limit
(`max_tools_hard`, context window, `max_output`, `native_mcp`, `function_calling`, shape caps,
pricing). Tier-3/4 sources admissible only for empirical/practical fields, and then only at
medium/low confidence with the measured model named. No value without a URL the agent actually
opened. Unknown ⇒ `null` + a note on what was searched — never a guess. The methodology's anti-trap
rule was enforced: no "unlimited"/"no limit"/"no cap"; absences are recorded as "no per-request
numeric cap documented" alongside the limits that *do* bind.

---

## 1. Roster: 33 → 55 models

| Provider | Before → After | Added | Marked deprecated |
|---|---|---|---|
| Anthropic | 3 → 7 | claude-opus-5, claude-sonnet-5, claude-fable-5, claude-mythos-5 (preview) | — |
| OpenAI | 3 → 6 | gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna | — |
| Google Gemini | 3 → 6 | gemini-3.7-flash, gemini-3.6-flash, gemini-3.5-flash-lite | gemini-3.1-flash-lite |
| Microsoft Copilot | 3 → 6 | microsoft-copilot-cowork, microsoft-copilot-studio, mai-code-1-1-flash | — |
| xAI Grok | 3 → 5 | grok-4.6, grok-4.5 | — |
| Mistral | 3 → 3 | — | — |
| Meta | 3 → 5 | meta-models/Muse-Glimmer-30B, muse-spark-1.2 | Llama-4-Behemoth-288B-16E |
| Alibaba Qwen | 3 → 5 | Qwen3.8-2.4T-A95B, Qwen3.8-27B | — |
| DeepSeek | 3 → 5 | DeepSeek-V4-Pro-0813, DeepSeek-V4-Flash-0731 | V4-Pro, V4-Flash, V3.2 |
| Google Gemma | 3 → 3 | — | — |
| Microsoft Phi | 3 → 4 | Phi-4-reasoning-vision-15B | — |

**No entry was deleted and no `id` was renamed** — superseded models carry a `status` change instead,
so the run-engine crosswalk in `apps/api/src/compatibility/dataset.ts` keeps resolving.

## 2. The corrections that matter most

Four **blockers** and eight **majors** were caught by the auditors. Almost none were invented
numbers — they were citations that did not support the claim:

| # | Finding | Resolution |
|---|---|---|
| B1 | OpenAI's 128-tool cap cited to the **Assistants API deep-dive** — wrong API surface for GPT-5.x, and that page announces the Assistants API shuts down **2026-08-26**, 7 days after this file's `as_of` | `max_tools_hard` → **null**. Current function-calling guide publishes no tools-array cap; it advises "fewer than 20 functions at the start of a turn". The 128 reports are recorded as observed-only |
| B2 | Gemini's 512-declaration cap recorded at **tier 2** citing a GitHub issue (tier 4 by methodology §4) | Kept 512, honestly re-graded **tier 4 / medium**, labelled an observed API rejection. A tier-1 Google figure exists on another surface (Firebase AI Logic: **128**) and is recorded in notes as the conservative planning number |
| B3 | Qwen3.6-27B marked `native_mcp: true` citing a page reading "Qwen3.6 open-source series (**except qwen3.6-27b**)" | Re-sourced to the model's own HF card; the bogus 10-server cap removed |
| B4 | Both new Qwen3.8 ids asserted a 10-MCP-server cap from a page not listing Qwen3.8 at all | → **null** |
| M1 | xAI's "200 tools" asserted tier-1/high on grok-4.5, grok-4.3, grok-build-0.1 from a page naming only grok-4.6 — *added by a remediation pass* | 200 kept on **grok-4.6 only** (confidence → medium); null elsewhere. Discovery: xAI documents **two conflicting numbers** for the same array — 200 (function-calling guide) vs **128** (REST API reference) |
| M2 | claude-sonnet-5's 10,000-tool ceiling from a page whose compatibility table omits sonnet-5 | → **null**; the six sibling models the table does name keep 10,000/high |
| M3 | Mistral's practical-20 from a benchmark measuring **no Mistral model** | → **null**. No public tool-count-vs-accuracy measurement of any Mistral model appears to exist |
| M4 | M365 Copilot `max_total_tools: 10` conflated *plugin objects* with *tools* — would have rendered Copilot as a 10-tool ceiling vs GitHub Copilot's 128 | → **null**, plugin-object cap moved to `max_connected_servers` as `derived: true` |
| M5 | Phi's per-variant practical numbers (3/5/20/15) all cited a post that never mentions Phi and measured `claude-3-5-sonnet-20241022` | All four → **null** |
| M6 | **Regression introduced by the refresh**: "video" added to gemma-4-E4B modalities, contradicting the card's per-variant table | Reverted; 31B and 12B stale modality lists also corrected |
| M7 | M365 Copilot `max_request_size` = 4096 **tokens** where every other vendor records bytes | → null; the 4,096-token product budget preserved in notes as what it is |
| M8 | OpenAI `"512MB"` string with `unit: "bytes"` | → `{value: 512, unit: "MB"}`, scope narrowed to image-carrying requests |

## 3. Genuine findings worth knowing

- **Anthropic now states the tool cliff itself**: "Claude's ability to pick the right tool degrades
  once you exceed 30-50 available tools" — `max_tools_practical` moved from tier 4 to tier 1.
- **Programmatic tool calling** (`code_execution_20260120`) keeps tool results out of context —
  ~38% fewer billed input tokens on Anthropic's own 75-tool benchmark. Supported on Opus/Sonnet 5,
  Fable 5, Mythos 5, Opus 4.5–4.8, Sonnet 4.5/4.6 — **not** Haiku 4.5. Directly relevant to what
  this workbench measures.
- **Corrections to prior data**: Sonnet 4.6 max output is 128k (not 64k); previous-turn thinking
  blocks are *kept* and billed as input on Opus 4.5+/Sonnet 4.6+ (the 2026-06 entry said the
  opposite); Sonnet 4.6 uses the *previous* tokenizer, and the newer-tokenizer inflation is ~30%.
- **Minimum cacheable prompt length** now captured per model (512 / 1,024 / 4,096 tokens) — a small
  MCP tool array can be **uncacheable on Haiku 4.5**.
- **DeepSeek pricing is a two-tier clock**: peak (01:00–04:00, 06:00–10:00 UTC) is exactly double
  off-peak. The schema has no peak/off-peak dimension, so both tiers live in notes — a consumer
  reading `cost.*.value` alone sees the peak rate.

## 4. Validation

Deterministic sweep over all 55 models after remediation:

- 0 missing schema blocks, 0 stringly-typed numbers, 0 values without a source URL, 0 stale
  file-level `as_of`.
- 118 `source_tier` grades that had **no `source_url` behind them** (all on null values) were
  dropped — a tier grade with no document reads as evidence to anything that filters by tier.
- Remaining, pre-existing and unfixed: 6 `strict_function_schema` objects in
  `microsoft-copilot.json` carry no `as_of` (inherited from the 2026-06 dataset; not stamped,
  because stamping would assert a re-verification that did not happen).
- 2 notes quote a vendor sentence containing "unlimited" verbatim ("A plugin can include an
  unlimited number of functions or MCP tools"). Left as a quoted vendor claim, not our phrasing.

Final auditor verdict: **ship-with-caveats** → the three majors it raised were then fixed.

## 5. Owner decisions still open

1. **Gemini `max_tools_hard`**: carry the observed **512** (tier 4) or the documented-but-different-
   surface **128** (tier 1, Firebase AI Logic)? Currently 512 / tier 4 / medium.
2. **xAI 200 vs 128**: unresolvable without a live API key. Currently 200 on grok-4.6 only, both
   numbers recorded.
3. **Claude Sonnet 5 tool search**: absent from the compatibility table — docs lag or real gap?
   `max_total_tools` is null but `tool_search_deferral` stays true/medium. Needs one live call.
4. **Mistral / Phi practical limits** are now null. Filling them requires running a BFCL-style
   benchmark ourselves.
5. **Gemma practical** = 15 for all three variants (top of the source's 10–15 band); no per-variant
   evidence exists.

## 6. Repo impact — read before running the gate

The research source of truth changed, so **`pnpm test` will fail until you regenerate**:

1. `pnpm build:model-data` — rebuilds `apps/api/src/compatibility/data/all-models.json` and
   `packages/shared/src/model-data.generated.ts`. The drift test byte-compares them against a fresh
   build from `research/**`.
2. `apps/api/test/compatibility-data.test.ts` hardcodes the roster size — **lines 50/53/54/78/79
   assert 33**; they need to become 55.

This was left for you deliberately: regenerating `model-data.generated.ts` changes the context-limit
and pricing maps the run engine and cost caps consume, which is a behavioural change, not a data
edit. The research artifacts (`comparison/all-models.json`, `comparison-matrix.md`) *were*
regenerated here, and `build_comparison.py`'s `AS_OF` constant was bumped to 2026-08-19.

Also stale and not touched: the `As-of: 2026-06-21` headers in `00-methodology.md`,
`02-mcp-limits-taxonomy.md` and `README.md`, and the regenerated cross-provider table at the bottom
of the taxonomy doc.

## 7. Per-vendor detail

Full change tables — every field, old → new value, source URL, tier, confidence — plus the pages
each agent opened and what it could not source, are in `refresh-2026-08-19/<vendor>.md`.
