#!/usr/bin/env python3
"""Build the Agent example previews (roadmap/illustrations exemplar).

Draws the `agent` entity component once (true-iso math per D-IL15), emits:
  - agent-preview.html  : live preview — fills are var(--illus-*), tokens bound per
                          theme with real oklch() + color-mix(), the same mechanism
                          the real package will use
  - agent-bright.png / agent-dark.png : rasterized with token values resolved
                          numerically (cairosvg can't do CSS vars/color-mix)

Stand-in token values approximate @brand/tokens qlik-bright / qlik-dark; in the real
package tokens.css binds --illus-* to the live theme variables instead.
"""

import math, re, subprocess, sys

# ---------- oklch → hex (for the rasterized previews only) ----------
def oklch_to_hex(L, C, h):
    hr = math.radians(h)
    a, b = C * math.cos(hr), C * math.sin(hr)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    def enc(u):
        u = max(0.0, min(1.0, u))
        u = 12.92 * u if u <= 0.0031308 else 1.055 * (u ** (1 / 2.4)) - 0.055
        return round(max(0.0, min(1.0, u)) * 255)
    return "#{:02X}{:02X}{:02X}".format(enc(r), enc(g), enc(bb))

def mix(c1, c2, t):  # lerp in oklch (hues here are near-neutral / close)
    return tuple(c1[i] + (c2[i] - c1[i]) * t for i in range(3))

# ---------- stand-in theme tokens (oklch triples) ----------
FACE_L, FACE_R = 0.16, 0.34  # tuned mix toward ink for left/right faces (D-IL15)
THEMES = {
    "bright": dict(paper=(0.985,0,0), grid=(0.942,0,0), grid_major=(0.905,0,0),
                   ink=(0.37,0,0), ink_muted=(0.556,0,0), guide=(0.79,0,0),
                   surface=(0.995,0,0), sunken=(0.955,0,0),
                   accent=(0.5425,0.1342,152.5), accent_fg=(1,0,0),
                   error=(0.577,0.215,27)),
    "dark":   dict(paper=(0.21,0.005,75), grid=(0.255,0.006,75), grid_major=(0.29,0.006,75),
                   ink=(0.93,0.01,75), ink_muted=(0.72,0.012,75), guide=(0.44,0.008,75),
                   surface=(0.275,0.006,75), sunken=(0.24,0.005,75),
                   accent=(0.75,0.14,153), accent_fg=(0.2,0.02,153),
                   error=(0.65,0.18,25)),
}
def resolved(t):
    d = THEMES[t]
    m = {
        "illus-paper": d["paper"], "illus-grid": d["grid"], "illus-grid-major": d["grid_major"],
        "illus-ink": d["ink"], "illus-ink-muted": d["ink_muted"], "illus-guide": d["guide"],
        "illus-face-top": d["surface"],
        "illus-face-left": mix(d["surface"], d["ink"], FACE_L),
        "illus-face-right": mix(d["surface"], d["ink"], FACE_R),
        "illus-surface-sunken": d["sunken"],
        "illus-accent": d["accent"], "illus-accent-contrast": d["accent_fg"],
        "illus-error": d["error"],
    }
    return {k: oklch_to_hex(*v) for k, v in m.items()}

def css_vars(t):
    d = THEMES[t]
    o = lambda c: f"oklch({c[0]:.3f} {c[1]:.3f} {c[2]:.1f})"
    return f"""
      --illus-paper:{o(d['paper'])}; --illus-grid:{o(d['grid'])}; --illus-grid-major:{o(d['grid_major'])};
      --illus-ink:{o(d['ink'])}; --illus-ink-muted:{o(d['ink_muted'])}; --illus-guide:{o(d['guide'])};
      --illus-face-top:{o(d['surface'])};
      --illus-face-left:color-mix(in oklch, {o(d['surface'])}, {o(d['ink'])} {FACE_L*100:.0f}%);
      --illus-face-right:color-mix(in oklch, {o(d['surface'])}, {o(d['ink'])} {FACE_R*100:.0f}%);
      --illus-surface-sunken:{o(d['sunken'])};
      --illus-accent:{o(d['accent'])}; --illus-accent-contrast:{o(d['accent_fg'])};
      --illus-error:{o(d['error'])};"""

# ---------- true-iso math (D-IL15) ----------
U = 16.0; KX = math.cos(math.radians(30)) * U; KY = math.sin(math.radians(30)) * U
def P(x, y, z, ox, oy):
    return (ox + (x - y) * KX, oy - z * U + (x + y) * KY)
def poly(pts, fill, sw=1.6, extra=""):
    p = " ".join(f"{a:.1f},{b:.1f}" for a, b in pts)
    return (f'<polygon points="{p}" style="fill:var(--{fill});stroke:var(--illus-ink)" '
            f'stroke-width="{sw}" stroke-linejoin="round" {extra}/>')

def iso_box(cx, cy, w, d, z0, h, ox, oy, sw=1.6):
    """Three visible faces of a box, painted back-to-front, fixed light rule."""
    A = P(cx-w/2, cy-d/2, z0+h, ox, oy); B = P(cx+w/2, cy-d/2, z0+h, ox, oy)
    C = P(cx+w/2, cy+d/2, z0+h, ox, oy); D = P(cx-w/2, cy+d/2, z0+h, ox, oy)
    Cb = P(cx+w/2, cy+d/2, z0, ox, oy); Bb = P(cx+w/2, cy-d/2, z0, ox, oy)
    Db = P(cx-w/2, cy+d/2, z0, ox, oy)
    return (poly([D, C, Cb, Db], "illus-face-left", sw)
          + poly([B, C, Cb, Bb], "illus-face-right", sw)
          + poly([A, B, C, D], "illus-face-top", sw))

def face_matrix_right(origin):  # +x face: local x → viewed rightward, y → down
    return f"matrix(0.866,-0.5,0,1,{origin[0]:.1f},{origin[1]:.1f})"

def face_matrix_left(origin):   # +y face: local x → viewed rightward, y → down
    return f"matrix(0.866,0.5,0,1,{origin[0]:.1f},{origin[1]:.1f})"

# ---------- the agent drawing ----------
def agent(ox, oy, state="idle", ports=False, facing="upstream"):
    """facing='upstream' (default): gaze meets the incoming flow in a L→R process
    scene → face panel on the LEFT (+y) face. 'downstream' mirrors it to the
    right (+x) face for scenes where the agent addresses what comes next."""
    s = []
    dim = ' opacity="0.32"' if state == "dimmed" else ""
    s.append(f"<g{dim}>")
    # shadows layer
    sx, sy = P(0.25, 0.25, 0, ox, oy)
    s.append(f'<ellipse cx="{sx:.1f}" cy="{sy:.1f}" rx="56" ry="27" style="fill:var(--illus-ink)" fill-opacity="0.07"/>')
    if state == "highlight":
        s.append(f'<ellipse cx="{sx:.1f}" cy="{sy+6:.1f}" rx="78" ry="38" style="fill:var(--illus-accent)" fill-opacity="0.28"/>')
    # construction ghost (dashed echo of the base tier top face)
    g = [P(*c, 0.7, ox-7, oy-5) for c in [(-2.8,-2.8),(2.8,-2.8),(2.8,2.8),(-2.8,2.8)]]
    gp = " ".join(f"{a:.1f},{b:.1f}" for a, b in g)
    s.append(f'<polygon points="{gp}" fill="none" style="stroke:var(--illus-guide)" stroke-width="1" stroke-dasharray="4 4"/>')
    # structure layer (back to front)
    s.append(iso_box(0, 0, 5.6, 5.6, 0.0, 0.7, ox, oy, 1.8))   # platform tier 1
    s.append(iso_box(0, 0, 4.2, 4.2, 0.7, 0.5, ox, oy, 1.6))   # platform tier 2
    s.append(iso_box(0, 0, 2.9, 2.9, 1.2, 1.8, ox, oy, 1.8))   # body
    s.append(iso_box(0, 0, 0.9, 0.9, 3.0, 0.18, ox, oy, 1.2))  # neck
    s.append(iso_box(0, 0, 2.2, 2.2, 3.18, 1.4, ox, oy, 1.8))  # head
    # detail layer — face panel + eyes, mounted on the gaze face (face-map transform)
    if facing == "upstream":
        hf = P(-1.1, 1.1, 4.58, ox, oy)   # head LEFT (+y) face, viewed top-left corner
        bf = P(-1.45, 1.45, 2.9, ox, oy)
        fm_head, fm_body = face_matrix_left(hf), face_matrix_left(bf)
    else:
        hf = P(1.1, 1.1, 4.58, ox, oy)    # head RIGHT (+x) face
        bf = P(1.45, 1.45, 2.9, ox, oy)
        fm_head, fm_body = face_matrix_right(hf), face_matrix_right(bf)
    s.append(f'<g transform="{fm_head}">')
    s.append('<rect x="4" y="5.5" width="27.2" height="13" rx="3" style="fill:var(--illus-surface-sunken);stroke:var(--illus-ink)" stroke-width="1.2"/>')
    eye = "var(--illus-error)" if state == "error" else "var(--illus-ink)"
    s.append(f'<circle cx="12" cy="12" r="2.6" style="fill:{eye}"/><circle cx="23.2" cy="12" r="2.6" style="fill:{eye}"/>')
    s.append("</g>")
    # chest slots on the same gaze side
    s.append(f'<g transform="{fm_body}" style="stroke:var(--illus-ink-muted)" stroke-width="2" stroke-linecap="round">')
    s.append('<line x1="7" y1="8" x2="27" y2="8"/><line x1="7" y1="14" x2="20" y2="14"/>')
    s.append("</g>")
    # antenna — THE one accent moment (D-IL6)
    ax, ay = P(0, 0, 4.58, ox, oy); tx, ty = P(0, 0, 5.35, ox, oy)
    tip = "var(--illus-error)" if state == "error" else "var(--illus-accent)"
    s.append(f'<line x1="{ax:.1f}" y1="{ay:.1f}" x2="{tx:.1f}" y2="{ty:.1f}" style="stroke:var(--illus-ink)" stroke-width="1.8"/>')
    s.append(f'<circle cx="{tx:.1f}" cy="{ty:.1f}" r="3.6" style="fill:{tip}"/>')
    if state == "active":
        s.append(f'<circle cx="{tx:.1f}" cy="{ty:.1f}" r="8" fill="none" style="stroke:var(--illus-accent)" stroke-width="1.5" opacity="0.55"/>')
    if state == "error":
        s.append(f'<circle cx="{tx:.1f}" cy="{ty:.1f}" r="8" fill="none" style="stroke:var(--illus-error)" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.7"/>')
    # ports overlay (registry metadata made visible)
    if ports:
        def port(x, y, z, label, mode):
            px, py = P(x, y, z, ox, oy)
            s.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="4" style="fill:var(--illus-accent)" stroke-width="1.4" stroke="white"/>')
            if mode == "right":   # 30° leader stub then short horizontal (D-IL16)
                lx, ly = px + 16, py - 16 * 0.577
                s.append(f'<path d="M {px:.1f} {py:.1f} L {lx:.1f} {ly:.1f} h 12" fill="none" style="stroke:var(--illus-ink-muted)" stroke-width="1" stroke-dasharray="3 3"/>')
                s.append(f'<text x="{lx+16:.1f}" y="{ly-3:.1f}" font-size="10.5" style="fill:var(--illus-ink)" font-family="Inter, system-ui, sans-serif">{label}</text>')
            else:                  # label directly below the dot (edge-safe)
                s.append(f'<text x="{px:.1f}" y="{py+16:.1f}" font-size="10.5" style="fill:var(--illus-ink)" text-anchor="middle" font-family="Inter, system-ui, sans-serif">{label}</text>')
        port(0, 0, 5.35, "top", "right")
        port(-2.8, 2.8, 0.35, "context-in", "below")
        port(2.8, -2.8, 0.35, "result-out", "below")
        port(2.8, 2.8, 0.0, "bottom", "right")
    s.append("</g>")
    return "".join(s)

def calibration_cube(ox, oy):
    s = [iso_box(0, 0, 1, 1, 0, 1, ox, oy, 1.6)]
    a = P(0.5, -0.5, 1, ox, oy); b = P(0.5, -0.5, 0, ox, oy)
    s.append(f'<path d="M {a[0]+8:.1f} {a[1]:.1f} V {b[1]:.1f}" fill="none" style="stroke:var(--illus-guide)" stroke-width="1" stroke-dasharray="2 3"/>')
    s.append(f'<text x="{a[0]+12:.1f}" y="{(a[1]+b[1])/2+3:.1f}" font-size="10.5" style="fill:var(--illus-ink-muted)" font-family="Inter, system-ui, sans-serif">1u</text>')
    return "".join(s)

# ---------- tiles & sheet ----------
TW, TH = 232, 260
TILES = [("idle","idle · faces upstream"),("active","active"),("highlight","highlight"),
         ("dimmed","dimmed"),("error","error"),("downstream","facing: downstream"),
         ("ports","idle + ports"),("calibration","calibration cube")]

def tile(i, kind):
    x0 = 16 + i * (TW + 10)
    s = [f'<g transform="translate({x0},52)">']
    s.append(f'<rect width="{TW}" height="{TH}" rx="10" style="fill:var(--illus-paper);stroke:var(--illus-guide)" stroke-width="1"/>')
    s.append(f'<rect width="{TW}" height="{TH}" rx="10" fill="url(#gr)"/>')
    # registration crosshair
    s.append(f'<path d="M 16 10 V 22 M 10 16 H 22" style="stroke:var(--illus-guide)" stroke-width="1.2" fill="none"/>')
    if kind == "calibration":
        s.append(calibration_cube(TW/2, 170))
        s.append(f'<text x="{TW/2}" y="215" font-size="11" style="fill:var(--illus-ink-muted)" text-anchor="middle" font-family="Inter, system-ui, sans-serif">1 iso unit = 16 px · grid before drawing</text>')
    elif kind == "downstream":
        s.append(agent(TW/2, 196, state="idle", facing="downstream"))
    else:
        state = kind if kind != "ports" else "idle"
        s.append(agent(TW/2, 196, state=state, ports=(kind == "ports")))
    label = dict(TILES)[kind]
    s.append(f'<text x="{TW/2}" y="{TH-12}" font-size="12.5" font-weight="600" style="fill:var(--illus-ink)" text-anchor="middle" font-family="Inter, system-ui, sans-serif">{label}</text>')
    s.append("</g>")
    return "".join(s)

def sheet(theme_label):
    W = 16 + len(TILES) * (TW + 10) + 6
    H = TH + 78
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">']
    s.append('<defs><pattern id="gr" width="16" height="16" patternUnits="userSpaceOnUse">'
             '<path d="M 16 0 L 0 0 0 16" fill="none" style="stroke:var(--illus-grid)" stroke-width="1"/></pattern></defs>')
    s.append(f'<rect width="{W}" height="{H}" style="fill:var(--illus-paper)"/>')
    s.append(f'<text x="18" y="30" font-size="19" font-weight="700" style="fill:var(--illus-ink)" font-family="Inter, system-ui, sans-serif">agent — entity component · {theme_label}</text>')
    s.append(f'<text x="18" y="46" font-size="12" style="fill:var(--illus-ink-muted)" font-family="Inter, system-ui, sans-serif">states · ports · calibration — every color is a --illus-* token derived from the theme (D-IL5/15)</text>')
    for i, (kind, _) in enumerate(TILES):
        s.append(tile(i, kind))
    s.append("</svg>")
    return "".join(s)

# ---------- emit ----------
import pathlib
out = pathlib.Path(__file__).resolve().parent
svg = sheet("{THEME}")

# PNGs with resolved tokens
import cairosvg
for theme in ("bright", "dark"):
    r = resolved(theme)
    body = svg.replace("{THEME}", f"qlik-{theme}")
    for k, v in r.items():
        body = body.replace(f"var(--{k})", v)
    cairosvg.svg2png(bytestring=body.encode(), write_to=str(out / f"agent-{theme}.png"), scale=1.4)

# live HTML (real var()/color-mix mechanism + a theme toggle)
html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Agent — illustration exemplar</title>
<style>
body{{margin:0;font-family:Inter,system-ui,sans-serif;background:#888;padding:24px;display:grid;gap:24px}}
.panel{{border-radius:14px;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.25)}}
.panel svg{{display:block}}
.bright{{{css_vars('bright')}}}
.dark{{{css_vars('dark')}}}
</style></head><body>
<div class="panel bright">{svg.replace("{THEME}", "qlik-bright")}</div>
<div class="panel dark">{svg.replace("{THEME}", "qlik-dark")}</div>
</body></html>"""
(out / "agent-preview.html").write_text(html)
print("ok", [p.name for p in out.iterdir()])
