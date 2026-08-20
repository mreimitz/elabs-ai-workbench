#!/usr/bin/env python3
"""
Reference implementation of the per-model severity resolver (see 06-impact-and-model-severity.md).

Given a test from test-catalog.json and a model id, resolve:
  { severity, consequence, rationale (filled), evidence:[{field,value,source_url,confidence}] }

This is the logic the app's compatibility engine should port. Run it to print a worked table:
    python3 tests/resolve_model_severity.py
"""
import json, re, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = json.load(open(os.path.join(ROOT, "tests/test-catalog.json")))
ALLM = json.load(open(os.path.join(ROOT, "comparison/all-models.json")))
CROSS = json.load(open(os.path.join(ROOT, "data/cross-cutting-limits.json")))
ROWS = {m["model_id"]: m for m in ALLM["models"]}


def getpath(obj, path):
    cur = obj
    for s in path.split("."):
        if isinstance(cur, dict) and s in cur:
            cur = cur[s]
        else:
            return None
    return cur


def resolve_field(row, field, target_client=None):
    """Return the provenance bundle for an evidence field path."""
    if field.startswith("cross."):
        p = field[6:].replace("<target>", target_client or "")
        v = getpath(CROSS, p)
        # Show the resolved client in the field label, not the raw `<target>` placeholder.
        display_field = field.replace("<target>", target_client) if target_client else field
        return {"field": display_field, "value": v, "source_url": None, "confidence": "n/a"}
    node = getpath(row["detail"], field)
    if isinstance(node, dict):
        return {"field": field, "value": node.get("value"), "source_url": node.get("source_url"),
                "source_tier": node.get("source_tier"), "confidence": node.get("confidence")}
    return {"field": field, "value": node}


def predicate(row, when, target_client=None):
    """Tiny DSL evaluator. Supports: provider.id == X ; model.PATH.value exists|absent ;
    model.PATH.value <|<=|>|>= N ; cross.<...> exists."""
    prov = row["provider_id"]
    m = re.match(r"provider\.id (==|!=) (\S+)$", when)
    if m:
        return prov == m.group(2) if m.group(1) == "==" else prov != m.group(2)
    m = re.match(r"model\.([\w.]+)\.value (exists|absent)$", when)
    if m:
        v = getpath(row["detail"], m.group(1) + ".value")
        return (v is not None) if m.group(2) == "exists" else (v is None)
    m = re.match(r"model\.([\w.]+)\.value (<=|>=|<|>) (\d+)$", when)
    if m:
        v = getpath(row["detail"], m.group(1) + ".value")
        if not isinstance(v, (int, float)):
            return False
        op, n = m.group(2), int(m.group(3))
        return {"<": v < n, "<=": v <= n, ">": v > n, ">=": v >= n}[op]
    if when.startswith("cross.") and when.endswith("exists"):
        return getpath(CROSS, when[6:].replace("<target>", target_client or "").rsplit(" ", 1)[0]) is not None
    return False


def fill(template, row, target_client=None):
    s = template.replace("{provider}", row["provider_name"])
    for ph in re.findall(r"\{([\w.<>-]+)\}", s):
        if ph == "provider":
            continue
        if ph.startswith("cross."):
            val = getpath(CROSS, ph[6:].replace("<target>", target_client or ""))
        else:
            val = getpath(row["detail"], ph + ".value")
        # render null gracefully — never emit the literal "None"/"null" into a rationale
        if val is None:
            rendered = "(undocumented)"
        elif isinstance(val, int):
            rendered = f"{val:,}"
        else:
            rendered = str(val)
        s = s.replace("{" + ph + "}", rendered)
    return s


def is_scorable(model_id):
    """A model with no documented context window can't be meaningfully scored — flag insufficient
    data rather than rendering degenerate verdicts (e.g. Llama-4-Behemoth, weights unreleased)."""
    cw = getpath(ROWS[model_id]["detail"], "context.context_window_tokens.value")
    return cw is not None


def resolve(test, model_id, target_client=None):
    row = ROWS[model_id]
    ms = test["model_severity"]
    # MIN-1: window-dependent tests can't be scored for models with no documented context window.
    # Gate on the PRIMARY measure (measured.inputs), not a blind json.dumps scan of the whole test —
    # the latter also tripped for tests that merely cite the window in an unrelated fallback rule,
    # wrongly dropping a window-independent binding cap (e.g. ENV_AGGREGATE_TOOL_COUNT) to na.
    if not is_scorable(model_id) and "model.context.context_window_tokens" in test["measured"]["inputs"]:
        return {"severity": "na", "consequence": "insufficient data",
                "rationale": "insufficient data — no documented context window for this model", "evidence": []}
    if not ms["variant"]:
        return {"severity": ms["default"], "consequence": test["impact"]["what_happens"],
                "rationale": "(model-invariant) " + test["impact"]["what_happens"], "evidence": []}
    for rule in ms.get("rules", []):
        if predicate(row, rule["when"], target_client):
            ev = [resolve_field(row, f, target_client) for f in rule["evidence_fields"]]
            return {"severity": rule["severity"], "consequence": rule["consequence"],
                    "rationale": fill(rule["rationale_template"], row, target_client), "evidence": ev}
    return {"severity": ms["default"], "consequence": test["impact"]["what_happens"],
            "rationale": "(default — no rule matched)", "evidence": []}


if __name__ == "__main__":
    demo = ["gemini-3.5-flash", "gpt-5.5", "claude-opus-4-8", "microsoft/phi-4", "Qwen/Qwen3.6-27B"]
    for tid in ["SERVER_TOOL_COUNT_HARD", "TOOL_SCHEMA_UNSUPPORTED_KEYWORDS", "SERVER_DEFINITION_FOOTPRINT"]:
        test = next(t for t in CAT["tests"] if t["id"] == tid)
        imp = test["impact"]
        print(f"\n### {tid}  —  impact={imp['failure_mode']} / {imp['recoverability']}")
        for mid in demo:
            if mid not in ROWS:
                continue
            r = resolve(test, mid)
            ev = r["evidence"][0] if r["evidence"] else {}
            tag = f"  [{ev.get('field')}={ev.get('value')} · {ev.get('confidence')}]" if ev else ""
            print(f"  {ROWS[mid]['provider_name'][:15]:15} {mid[:22]:22} {r['severity']:7} {r['rationale'][:96]}{tag}")
