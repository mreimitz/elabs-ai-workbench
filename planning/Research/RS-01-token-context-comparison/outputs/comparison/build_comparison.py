#!/usr/bin/env python3
"""
Build the combined dataset + comparison matrix from the per-provider data files.
Re-run whenever a data/<group>/<provider>.json changes:

    python3 comparison/build_comparison.py

Outputs (deterministic, derived only from data/ — never hand-edit these):
  - comparison/all-models.json     merged flat index + full detail
  - comparison/comparison-matrix.md cross-model tables, one per axis
"""
import json, glob, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "comparison")
AS_OF = "2026-08-19"

GROUP_ORDER = {"saas": 0, "open_weight": 1}


def pv(node):
    """Return (value, confidence) from a Provenanced object; tolerate plain values/None."""
    if isinstance(node, dict) and "value" in node:
        return node.get("value"), node.get("confidence")
    if isinstance(node, dict):
        return None, None
    return node, None


def g(model, *path):
    cur = model
    for p in path:
        if not isinstance(cur, dict):
            return {}
        cur = cur.get(p, {})
    return cur


def fmt(node, *, money=False, show_unit=False, mark_conf=True):
    """Render a cell value with a confidence marker for low/medium confidence."""
    val, conf = pv(node)
    unit = node.get("unit") if isinstance(node, dict) else None
    if val is None:
        return "—"
    if isinstance(val, bool):
        s = "yes" if val else "no"
    elif money and isinstance(val, (int, float)):
        s = f"${val:g}"
    elif isinstance(val, (int, float)):
        s = f"{val:,}"
    else:
        s = str(val)
    if show_unit and unit:
        s += f" {unit}"
    if mark_conf and conf == "low":
        s += " °"
    elif mark_conf and conf == "medium":
        s += " ~"
    return s


def load():
    providers = []
    for f in sorted(glob.glob(os.path.join(DATA, "*", "*.json"))):
        with open(f) as fh:
            d = json.load(fh)
        d["_file"] = os.path.relpath(f, ROOT)
        providers.append(d)
    providers.sort(key=lambda d: (GROUP_ORDER.get(d["provider"]["group"], 9),
                                  d["provider"]["name"].lower()))
    return providers


def flat(provider, m):
    p = provider["provider"]
    sh = m.get("self_host") or {}
    return {
        "provider_id": p["id"], "provider_name": p["name"], "group": p["group"],
        "model_id": m["id"], "display_name": m.get("display_name"),
        "family": m.get("family"), "status": m.get("status"),
        "context_window_tokens": pv(g(m, "context", "context_window_tokens"))[0],
        "max_input_tokens": pv(g(m, "context", "max_input_tokens"))[0],
        "max_output_tokens_max": pv(g(m, "context", "max_output_tokens_max"))[0],
        "extended_context": pv(g(m, "context", "extended_context"))[0],
        "tokenizer_family": pv(g(m, "tokenization", "tokenizer_family"))[0],
        "tokenizer_public": pv(g(m, "tokenization", "tokenizer_public"))[0],
        "function_calling": pv(g(m, "tools_mcp", "function_calling"))[0],
        "native_mcp": pv(g(m, "tools_mcp", "native_mcp"))[0],
        "max_tools_hard": pv(g(m, "tools_mcp", "max_tools_hard"))[0],
        "max_tools_practical": pv(g(m, "tools_mcp", "max_tools_practical"))[0],
        "tool_definition_shape": pv(g(m, "tools_mcp", "tool_definition_shape"))[0],
        "tool_search_deferral": pv(g(m, "tools_mcp", "tool_search_deferral"))[0],
        "tool_defs_count_as_input": pv(g(m, "tools_mcp", "tool_defs_count_as_input"))[0],
        "skills_supported": pv(g(m, "skills_context", "skills_supported"))[0],
        "prompt_caching": pv(g(m, "skills_context", "prompt_caching"))[0],
        "input_per_mtok_usd": pv(g(m, "cost", "input_per_mtok_usd"))[0],
        "output_per_mtok_usd": pv(g(m, "cost", "output_per_mtok_usd"))[0],
        "cached_input_per_mtok_usd": pv(g(m, "cost", "cached_input_per_mtok_usd"))[0],
        "billing_unit": pv(g(m, "cost", "billing_unit"))[0],
        "reasoning_billed_as_output": pv(g(m, "cost", "reasoning_billed_as_output"))[0],
        "self_host_license": pv(sh.get("license", {}))[0] if sh else None,
        "self_host_native_ctx": pv(sh.get("native_context_config", {}))[0] if sh else None,
        "self_host_max_ctx": pv(sh.get("max_context_documented", {}))[0] if sh else None,
        "source_file": provider["_file"],
    }


def build_json(providers):
    models = []
    for prov in providers:
        for m in prov["models"]:
            row = flat(prov, m)
            row["detail"] = m
            models.append(row)
    doc = {
        "schema_version": "1.0", "as_of": AS_OF,
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "generator": "comparison/build_comparison.py",
        "provider_count": len(providers), "model_count": len(models),
        "models": models,
    }
    with open(os.path.join(OUT, "all-models.json"), "w") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
    return models


def rows(providers):
    for prov in providers:
        for m in prov["models"]:
            yield prov, m


def table(providers, headers, cellfn):
    lines = ["| " + " | ".join(headers) + " |",
             "|" + "|".join("---" for _ in headers) + "|"]
    for prov, m in rows(providers):
        lines.append("| " + " | ".join(cellfn(prov, m)) + " |")
    return "\n".join(lines)


def name_cell(prov, m):
    return f"**{m.get('display_name', m['id'])}**"


def build_md(providers, models):
    n_models = len(models)
    n_prov = len(providers)
    saas = sum(1 for p in providers if p["provider"]["group"] == "saas")
    parts = []
    parts.append(f"""# Comparison Matrix — Token & Context Baseline

> Auto-generated by `comparison/build_comparison.py` from `data/`. **Do not hand-edit.**
> As-of **{AS_OF}** · {n_prov} providers ({saas} SaaS, {n_prov-saas} open-weight) · {n_models} models.
>
> **Confidence markers:** `°` = low confidence, `~` = medium, no mark = high. `—` = not documented / not applicable.
> Open-weight max input/output and many limits are **deployment-defined**; see each provider's data file and `00-methodology.md`.
""")

    parts.append("## 1. Context window & I/O limits\n\n" + table(
        providers,
        ["Provider", "Model", "Group", "Status", "Context window", "Max output", "Extended ctx", "In/Out shared"],
        lambda prov, m: [
            prov["provider"]["name"], name_cell(prov, m), prov["provider"]["group"],
            m.get("status", "—"),
            fmt(g(m, "context", "context_window_tokens")),
            fmt(g(m, "context", "max_output_tokens_max")),
            fmt(g(m, "context", "extended_context")),
            fmt(g(m, "context", "input_output_shared")),
        ]))

    parts.append("\n\n## 2. Tokenization\n\n" + table(
        providers,
        ["Provider", "Model", "Tokenizer family", "Public?", "Access / count method", "~chars/token"],
        lambda prov, m: [
            prov["provider"]["name"], name_cell(prov, m),
            fmt(g(m, "tokenization", "tokenizer_family")),
            fmt(g(m, "tokenization", "tokenizer_public")),
            fmt(g(m, "tokenization", "tokenizer_access")),
            fmt(g(m, "tokenization", "chars_per_token_estimate")),
        ]))

    parts.append("\n\n## 3. Tools & MCP (the footprint axis)\n\n" + table(
        providers,
        ["Provider", "Model", "Fn calling", "Native MCP", "Max tools (hard)", "Max tools (practical)", "Tool shape", "Deferral", "Defs=input"],
        lambda prov, m: [
            prov["provider"]["name"], name_cell(prov, m),
            fmt(g(m, "tools_mcp", "function_calling")),
            fmt(g(m, "tools_mcp", "native_mcp")),
            fmt(g(m, "tools_mcp", "max_tools_hard")),
            fmt(g(m, "tools_mcp", "max_tools_practical")),
            fmt(g(m, "tools_mcp", "tool_definition_shape")),
            fmt(g(m, "tools_mcp", "tool_search_deferral")),
            fmt(g(m, "tools_mcp", "tool_defs_count_as_input")),
        ]))

    parts.append("\n\n## 3b. Extended MCP / tool limits (beyond the count)\n\n"
                 "_Other limit types that govern whether a server fits — see `02-mcp-limits-taxonomy.md`._\n\n" + table(
        providers,
        ["Provider", "Model", "Tool name len", "Req size", "Tool-result size", "Parallel calls", "Per-turn", "Max servers", "Max total tools"],
        lambda prov, m: [
            prov["provider"]["name"], name_cell(prov, m),
            fmt(g(m, "tools_mcp", "max_tool_name_len")),
            fmt(g(m, "tools_mcp", "max_request_size"), show_unit=True),
            fmt(g(m, "tools_mcp", "max_tool_result_size"), show_unit=True),
            fmt(g(m, "tools_mcp", "max_parallel_tool_calls_count")),
            fmt(g(m, "tools_mcp", "tool_use_per_turn_limit")),
            fmt(g(m, "tools_mcp", "max_connected_servers")),
            fmt(g(m, "tools_mcp", "max_total_tools")),
        ]))

    parts.append("\n\n## 4. Skills & context contribution\n\n" + table(
        providers,
        ["Provider", "Model", "Skills?", "Loading model", "Prompt caching", "Memory"],
        lambda prov, m: [
            prov["provider"]["name"], name_cell(prov, m),
            fmt(g(m, "skills_context", "skills_supported")),
            fmt(g(m, "skills_context", "skills_loading_model")),
            fmt(g(m, "skills_context", "prompt_caching")),
            fmt(g(m, "skills_context", "memory_feature")),
        ]))

    parts.append("\n\n## 5. Token cost & accounting\n\n" + table(
        providers,
        ["Provider", "Model", "Input $/M", "Output $/M", "Cached in $/M", "Batch", "Billing unit", "Reasoning=output"],
        lambda prov, m: [
            prov["provider"]["name"], name_cell(prov, m),
            fmt(g(m, "cost", "input_per_mtok_usd"), money=True),
            fmt(g(m, "cost", "output_per_mtok_usd"), money=True),
            fmt(g(m, "cost", "cached_input_per_mtok_usd"), money=True),
            fmt(g(m, "cost", "batch_discount")),
            fmt(g(m, "cost", "billing_unit")),
            fmt(g(m, "cost", "reasoning_billed_as_output")),
        ]))

    # Self-host table: open-weight only
    ow = [p for p in providers if p["provider"]["group"] == "open_weight"]
    sh_lines = ["| Provider | Model | License | Param variants | Native ctx | Max ctx (documented) | Serving frameworks |",
                "|---|---|---|---|---|---|---|"]
    for prov in ow:
        for m in prov["models"]:
            sh = m.get("self_host") or {}
            sh_lines.append("| " + " | ".join([
                prov["provider"]["name"], name_cell(prov, m),
                fmt(sh.get("license", {})),
                fmt(sh.get("param_variants", {})),
                fmt(sh.get("native_context_config", {})),
                fmt(sh.get("max_context_documented", {})),
                fmt(sh.get("serving_frameworks", {})),
            ]) + " |")
    parts.append("\n\n## 6. Self-host (open-weight only)\n\n" + "\n".join(sh_lines))

    parts.append(f"""\n\n## How to read this for the recommender

- **Footprint headroom** = `context window − tool-definition tokens`. Divide a scan's `total_tokens`
  by **Context window** (table 1) to get "% of window consumed before the first user message".
- **Tool ceiling** = **Max tools (practical)** (table 3), not the hard cap — that is where
  tool-selection accuracy degrades, well below the API limit.
- **Count with the right shape** = **Tool shape** (table 3) picks the adapter
  (`toOpenAIStyleTool` / `toClaudeStyleTool` / raw MCP).
- **Cost per task** = combine **Input/Output $/M** (table 5) with the session's token mix;
  remember reasoning tokens bill at the output rate where **Reasoning=output** is yes.
- **Levers** = **Prompt caching** (table 4) and tool **Deferral** (table 3) are the two biggest
  footprint/cost reducers the recommender can suggest.

_Regenerate with `python3 comparison/build_comparison.py`._
""")
    with open(os.path.join(OUT, "comparison-matrix.md"), "w") as fh:
        fh.write("\n".join(parts))


if __name__ == "__main__":
    provs = load()
    models = build_json(provs)
    build_md(provs, models)
    print(f"Built all-models.json + comparison-matrix.md: {len(provs)} providers, {len(models)} models.")
