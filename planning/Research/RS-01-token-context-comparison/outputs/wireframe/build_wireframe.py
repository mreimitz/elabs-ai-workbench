#!/usr/bin/env python3
"""
Build the test-results wireframe (RevisionTimeline-styled) from the live catalog + resolver.
Emits:
  wireframe/test-results-wireframe.html   standalone, all tests, opens in a browser
  wireframe/_inline_fragment.html         compact (5 tests) fragment for an inline preview
Re-run after the catalog changes:  python3 wireframe/build_wireframe.py
"""
import json, html, importlib.util, collections, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("r", os.path.join(ROOT, "tests/resolve_model_severity.py"))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
cat, allm = r.CAT, r.ALLM

PROV_ORDER = ["anthropic","openai","google-gemini","xai","mistral","microsoft-copilot",
              "meta-llama","deepseek","alibaba-qwen","google-gemma","microsoft-phi"]
prov_name, prov_group, by_prov = {}, {}, collections.OrderedDict()
for m in allm["models"]:
    prov_name[m["provider_id"]] = m["provider_name"]; prov_group[m["provider_id"]] = m["group"]
    by_prov.setdefault(m["provider_id"], []).append(m)

def short(dn):
    return (dn.replace("Claude ","").replace(" Instruct","")
            .replace("Microsoft 365 Copilot","M365 Copilot")
            .replace("Microsoft Copilot (Consumer / copilot.microsoft.com)","Copilot consumer")
            .replace("GitHub Copilot (model-picker surface; VS Code / IDE / CLI)","GitHub Copilot"))

SEV = ["blocker","high","medium","low","na"]
SEVLABEL = {"blocker":"Blocker","high":"High","medium":"Medium","low":"Low","na":"N/A"}
LEVELS = [("environment","Environment — all servers combined"),("server","Server — one MCP server"),
          ("tool","Tool — one tool definition"),("session","Session — live run")]
LEVEL_COLOR = {"server":"#534AB7","environment":"#0F6E56","tool":"#185FA5","session":"#993C1D"}

def esc(s): return html.escape(str(s if s is not None else ""))

def worst(dist):
    for s in SEV[:-1]:
        if dist.get(s): return s
    return "na"

def cell(test, m):
    rr = r.resolve(test, m["model_id"])
    ev = (rr.get("evidence") or [{}])[0]
    return {"short":short(m["display_name"]),"name":m["display_name"],"sev":rr["severity"],
            "rat":rr.get("rationale",""),"cons":rr.get("consequence",""),
            "ef":ev.get("field"),"ev":ev.get("value"),"ec":ev.get("confidence"),"es":ev.get("source_url")}

def chip_tooltip(test, c):
    rows = []
    rows.append(f'<div class="tt-h"><span class="chip s-{c["sev"]}">{esc(SEVLABEL[c["sev"]])}</span><b>{esc(c["name"])}</b></div>')
    if test["impact"]["failure_mode"] != "none":
        rows.append(f'<div class="tt-fm"><i class="ti ti-alert-triangle" aria-hidden="true"></i> {esc(test["impact"]["failure_mode"].replace("_"," "))} · {esc(test["impact"]["recoverability"].replace("_","-"))}</div>')
    rows.append(f'<div class="tt-rat">{esc(c["rat"])}</div>')
    if c["ev"] is not None:
        src = f' · <a href="{esc(c["es"])}">source</a>' if c["es"] else ""
        evv = str(c["ev"]); evv = evv[:88] + "…" if len(evv) > 90 else evv
        rows.append(f'<div class="tt-ev"><i class="ti ti-database" aria-hidden="true"></i> {esc(c["ef"])} = <b>{esc(evv)}</b> <span class="tt-conf">({esc(c["ec"])})</span>{src}</div>')
    return "".join(rows)

def render_entry(t):
    cells = {pid:[cell(t,m) for m in by_prov[pid]] for pid in PROV_ORDER if pid in by_prov}
    dist = collections.Counter()
    for pid in cells:
        for c in cells[pid]: dist[c["sev"]] += 1
    n = sum(dist.values())
    bar = "".join(f'<span class="seg s-{s}" style="width:{round(100*dist[s]/n)}%" title="{dist[s]} {s}"></span>' for s in SEV if dist[s])
    counts = " · ".join(f'<span class="cnt s-{s}">{dist[s]} {SEVLABEL[s].lower()}</span>' for s in SEV if dist[s])

    def prov_block(group):
        out = []
        for pid in PROV_ORDER:
            if pid not in cells or prov_group[pid] != group: continue
            chips = []
            for c in cells[pid]:
                chips.append(f'<span class="mchip s-{c["sev"]}" tabindex="0">{esc(c["short"])}'
                             f'<span class="tt">{chip_tooltip(t,c)}</span></span>')
            out.append(f'<div class="prow"><span class="plabel">{esc(prov_name[pid])}</span>'
                       f'<span class="pchips">{"".join(chips)}</span></div>')
        return "".join(out)

    dot = LEVEL_COLOR[t["level"]]
    return f'''<details class="entry">
  <summary>
    <span class="node" style="--dot:{dot}"></span>
    <span class="ehead">
      <span class="etitle">{esc(t["user_facing_name"])}</span>
      <span class="badges"><span class="bdg">{esc(t["scope"])}</span><span class="bdg">{esc(t["execution_mode"])}</span></span>
      <span class="etech">{esc(t["tech_name"])}</span>
    </span>
    <span class="edist"><span class="bar">{bar}</span></span>
    <i class="ti ti-chevron-down chev" aria-hidden="true"></i>
  </summary>
  <div class="body">
    <p class="what">{esc(t["what_it_does"])}</p>
    <p class="rec"><i class="ti ti-bulb" aria-hidden="true"></i> {esc(t["recommendation"])}</p>
    <div class="counts">{counts}</div>
    <div class="matrix">
      <div class="mgroup"><span class="ghead">Hosted (SaaS)</span>{prov_block("saas")}</div>
      <div class="mgroup"><span class="ghead">Open-weight (self-hosted)</span>{prov_block("open_weight")}</div>
    </div>
  </div>
</details>'''

def render_timeline(tests):
    out = []
    for lvl, lbl in LEVELS:
        group = [t for t in tests if t["level"] == lvl]
        if not group: continue
        out.append(f'<div class="lvlhead"><span class="ldot" style="--dot:{LEVEL_COLOR[lvl]}"></span>{esc(lbl)} <span class="lcount">{len(group)}</span></div>')
        out += [render_entry(t) for t in group]
    return f'<div class="tl">{"".join(out)}</div>'

CSS = '''
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
.legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:0 0 14px;font-size:12px;color:var(--color-text-secondary)}
.legend .chip{margin-right:4px}
.chip,.mchip,.bdg,.cnt{font-family:var(--font-sans);font-size:11px;line-height:1.4;border-radius:999px;padding:2px 9px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;border:0.5px solid transparent}
.s-blocker{background:#FCEBEB;color:#791F1F;border-color:#F09595}
.s-high{background:#FAECE7;color:#712B13;border-color:#F0997B}
.s-medium{background:#FAEEDA;color:#633806;border-color:#EF9F27}
.s-low{background:#E6F1FB;color:#0C447C;border-color:#85B7EB}
.s-na{background:#F1EFE8;color:#5F5E5A;border-color:#D3D1C7}
.tl{position:relative;padding-left:6px}
.lvlhead{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--color-text-primary);margin:18px 0 6px}
.lvlhead:first-child{margin-top:0}
.ldot{width:9px;height:9px;border-radius:50%;background:var(--dot)}
.lcount{font-size:11px;color:var(--color-text-tertiary);font-weight:400}
.entry{border-left:1.5px solid var(--color-border-tertiary);margin-left:4px}
.entry>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:9px 6px 9px 16px;position:relative;border-radius:var(--border-radius-md)}
.entry>summary::-webkit-details-marker{display:none}
.entry>summary:hover{background:var(--color-background-secondary)}
.node{position:absolute;left:-8px;top:50%;transform:translateY(-50%);width:11px;height:11px;border-radius:50%;background:var(--dot);box-sizing:border-box;border:2.5px solid var(--color-background-primary)}
.ehead{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.etitle{font-size:14px;font-weight:500;color:var(--color-text-primary)}
.badges{display:flex;gap:6px}
.bdg{background:var(--color-background-secondary);color:var(--color-text-secondary);border-color:var(--color-border-tertiary)}
.etech{font-family:var(--font-mono);font-size:11px;color:var(--color-text-tertiary)}
.edist{margin-left:auto}
.bar{display:inline-flex;width:120px;height:8px;border-radius:999px;overflow:hidden;border:0.5px solid var(--color-border-tertiary)}
.seg{display:block;height:100%}
.seg.s-blocker{background:#E24B4A}.seg.s-high{background:#D85A30}.seg.s-medium{background:#EF9F27}.seg.s-low{background:#378ADD}.seg.s-na{background:#D3D1C7}
.chev{font-size:18px;color:var(--color-text-tertiary);transition:transform .15s}
.entry[open]>summary .chev{transform:rotate(180deg)}
.body{padding:4px 6px 14px 18px}
.what{font-size:13px;color:var(--color-text-secondary);margin:0 0 6px;line-height:1.55}
.rec{font-size:13px;color:var(--color-text-primary);margin:0 0 10px;line-height:1.55}
.rec .ti,.what .ti{color:var(--color-text-tertiary)}
.counts{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 12px}
.cnt{border:0}
.mgroup{margin:0 0 10px}
.ghead{display:block;font-size:11px;text-transform:none;letter-spacing:.02em;color:var(--color-text-tertiary);margin:0 0 6px;font-weight:500}
.prow{display:flex;align-items:flex-start;gap:10px;padding:3px 0}
.plabel{width:104px;flex:none;font-size:12px;color:var(--color-text-secondary);padding-top:3px}
.pchips{display:flex;flex-wrap:wrap;gap:6px}
.mchip{position:relative;cursor:default;outline:none}
.mchip:hover,.mchip:focus{filter:brightness(.97);box-shadow:0 0 0 2px var(--color-border-secondary)}
.tt{position:absolute;left:0;top:calc(100% + 8px);width:300px;z-index:50;background:var(--color-background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);padding:12px 14px;box-shadow:0 6px 24px rgba(0,0,0,.14);opacity:0;visibility:hidden;transition:opacity .12s;pointer-events:none;text-align:left;white-space:normal}
.mchip:hover .tt,.mchip:focus .tt{opacity:1;visibility:visible}
.tt-h{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;color:var(--color-text-primary)}
.tt-fm{font-size:11px;color:var(--color-text-secondary);margin-bottom:6px}
.tt-rat{font-size:12px;color:var(--color-text-primary);line-height:1.5;margin-bottom:8px}
.tt-ev{font-size:11px;color:var(--color-text-secondary);margin-bottom:8px;font-family:var(--font-mono)}
.tt-conf{color:var(--color-text-tertiary)}
.tt-rec{font-size:11px;color:var(--color-text-secondary);line-height:1.5;border-top:0.5px solid var(--color-border-tertiary);padding-top:8px}
.tt .ti{font-size:14px;vertical-align:-2px}
'''

LEGEND = ('<div class="legend"><span><span class="chip s-blocker">Blocker</span>rejected/overflow</span>'
          '<span><span class="chip s-high">High</span>degraded</span>'
          '<span><span class="chip s-medium">Medium</span>inefficient</span>'
          '<span><span class="chip s-low">Low</span>advisory</span>'
          '<span><span class="chip s-na">N/A</span>not applicable</span></div>')

ICONS = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.7.0/dist/tabler-icons.min.css">'

tests = cat["tests"]
# standalone
standalone = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP × Model compatibility — test results</title>{ICONS}
<style>:root{{--color-text-primary:#1d1c1a;--color-text-secondary:#5f5e5a;--color-text-tertiary:#8b8a84;
--color-background-primary:#fff;--color-background-secondary:#f6f5f1;--color-border-tertiary:rgba(0,0,0,.12);
--color-border-secondary:rgba(0,0,0,.28);--font-sans:'Inter',system-ui,sans-serif;--font-mono:ui-monospace,SFMono-Regular,Menlo,monospace;
--border-radius-md:8px;--border-radius-lg:12px}}
body{{font-family:var(--font-sans);color:var(--color-text-primary);background:#faf9f6;margin:0;padding:28px;line-height:1.6}}
.wrap{{max-width:860px;margin:0 auto;background:#fff;border:0.5px solid var(--color-border-tertiary);border-radius:16px;padding:26px 30px}}
h1{{font-size:20px;font-weight:500;margin:0 0 2px}}.sub{{font-size:13px;color:var(--color-text-secondary);margin:0 0 18px}}
{CSS}</style></head><body><div class="wrap">
<h1>MCP × Model compatibility</h1>
<p class="sub">github-mcp · 26 tools · scanned 2026-06-21 · {len(tests)} tests × 33 models. Expand a test to see impact per model; hover a chip for the explanation.</p>
{LEGEND}{render_timeline(tests)}
</div></body></html>'''
os.makedirs(os.path.join(ROOT,"wireframes"), exist_ok=True)
open(os.path.join(ROOT,"wireframes/01-test-results-timeline.html"),"w").write(standalone)
print("wrote wireframes/01-test-results-timeline.html —", len(standalone), "bytes,", len(tests), "tests x 33 models")
