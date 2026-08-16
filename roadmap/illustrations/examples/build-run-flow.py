#!/usr/bin/env python3
"""Anatomy of a Run — scene exemplar (roadmap/illustrations).

Three acts: Intake (user → agent + satellite prep phases) · Execution loop
(4-station ring, context stack growing per turn) · Resolution (summarize →
answer, returning to the user). One shared MCP Server + Skill hub serves the
whole run. Authored against run-flow.scene.json (the SceneSpec dogfood).

Emits run-flow-{bright,dark}.png + run-flow-preview.html. Same token machinery
as build-agent-example.py (stand-in values; the real package binds via tokens.css).
"""
import math, pathlib

# ---------- oklch → hex ----------
def oklch_to_hex(L, C, h):
    hr = math.radians(h); a, b = C*math.cos(hr), C*math.sin(hr)
    l_ = L+0.3963377774*a+0.2158037573*b; m_ = L-0.1055613458*a-0.0638541728*b
    s_ = L-0.0894841775*a-1.2914855480*b
    l, m, s = l_**3, m_**3, s_**3
    r = 4.0767416621*l-3.3077115913*m+0.2309699292*s
    g = -1.2684380046*l+2.6097574011*m-0.3413193965*s
    bb = -0.0041960863*l-0.7034186147*m+1.7076147010*s
    def enc(u):
        u = max(0.0, min(1.0, u))
        u = 12.92*u if u <= 0.0031308 else 1.055*(u**(1/2.4))-0.055
        return round(max(0.0, min(1.0, u))*255)
    return "#{:02X}{:02X}{:02X}".format(enc(r), enc(g), enc(bb))
def mix(c1, c2, t): return tuple(c1[i]+(c2[i]-c1[i])*t for i in range(3))

FACE_L, FACE_R = 0.16, 0.34
THEMES = {
    "bright": dict(paper=(0.985,0,0), grid=(0.945,0,0), ink=(0.37,0,0), ink_muted=(0.556,0,0),
                   guide=(0.79,0,0), surface=(0.995,0,0), sunken=(0.955,0,0),
                   accent=(0.5425,0.1342,152.5), error=(0.577,0.215,27)),
    "dark":   dict(paper=(0.21,0.005,75), grid=(0.255,0.006,75), ink=(0.93,0.01,75),
                   ink_muted=(0.72,0.012,75), guide=(0.44,0.008,75), surface=(0.275,0.006,75),
                   sunken=(0.24,0.005,75), accent=(0.75,0.14,153), error=(0.65,0.18,25)),
}
def resolved(t):
    d = THEMES[t]
    m = {"illus-paper": d["paper"], "illus-grid": d["grid"], "illus-ink": d["ink"],
         "illus-ink-muted": d["ink_muted"], "illus-guide": d["guide"],
         "illus-face-top": d["surface"], "illus-face-left": mix(d["surface"], d["ink"], FACE_L),
         "illus-face-right": mix(d["surface"], d["ink"], FACE_R),
         "illus-surface-sunken": d["sunken"], "illus-accent": d["accent"], "illus-error": d["error"]}
    return {k: oklch_to_hex(*v) for k, v in m.items()}
def css_vars(t):
    d = THEMES[t]; o = lambda c: f"oklch({c[0]:.3f} {c[1]:.3f} {c[2]:.1f})"
    return (f"--illus-paper:{o(d['paper'])};--illus-grid:{o(d['grid'])};--illus-ink:{o(d['ink'])};"
            f"--illus-ink-muted:{o(d['ink_muted'])};--illus-guide:{o(d['guide'])};"
            f"--illus-face-top:{o(d['surface'])};"
            f"--illus-face-left:color-mix(in oklch, {o(d['surface'])}, {o(d['ink'])} {FACE_L*100:.0f}%);"
            f"--illus-face-right:color-mix(in oklch, {o(d['surface'])}, {o(d['ink'])} {FACE_R*100:.0f}%);"
            f"--illus-surface-sunken:{o(d['sunken'])};--illus-accent:{o(d['accent'])};"
            f"--illus-error:{o(d['error'])};")

# ---------- iso math ----------
U = 16.0; KX = math.cos(math.radians(30))*U; KY = math.sin(math.radians(30))*U
def P(x, y, z, ox, oy): return (ox+(x-y)*KX, oy-z*U+(x+y)*KY)
def poly(pts, fill, sw=1.6):
    p = " ".join(f"{a:.1f},{b:.1f}" for a, b in pts)
    return (f'<polygon points="{p}" style="fill:var(--{fill});stroke:var(--illus-ink)" '
            f'stroke-width="{sw}" stroke-linejoin="round"/>')
def iso_box(cx, cy, w, d, z0, h, ox, oy, sw=1.6):
    zt = z0+h
    A=P(cx-w/2,cy-d/2,zt,ox,oy); B=P(cx+w/2,cy-d/2,zt,ox,oy)
    C=P(cx+w/2,cy+d/2,zt,ox,oy); D=P(cx-w/2,cy+d/2,zt,ox,oy)
    Cb=P(cx+w/2,cy+d/2,z0,ox,oy); Bb=P(cx+w/2,cy-d/2,z0,ox,oy); Db=P(cx-w/2,cy+d/2,z0,ox,oy)
    return (poly([D,C,Cb,Db],"illus-face-left",sw)+poly([B,C,Cb,Bb],"illus-face-right",sw)
            +poly([A,B,C,D],"illus-face-top",sw))
def face_left(o):  return f"matrix(0.866,0.5,0,1,{o[0]:.1f},{o[1]:.1f})"

FONT = 'font-family="Inter, system-ui, sans-serif"'
def txt(x, y, s, size=13, fill="illus-ink", anchor="middle", weight="", extra=""):
    w = f' font-weight="{weight}"' if weight else ""
    return f'<text x="{x:.0f}" y="{y:.0f}" font-size="{size}" style="fill:var(--{fill})" text-anchor="{anchor}"{w} {FONT} {extra}>{s}</text>'

def arrow(pts_list, color="illus-ink-muted", w=2.2, dash=None, head=7):
    """Polyline + manually drawn head (no <marker> — renderer-safe)."""
    d = "M " + " L ".join(f"{a:.1f} {b:.1f}" for a, b in pts_list)
    dd = f' stroke-dasharray="{dash}"' if dash else ""
    (x1, y1), (x2, y2) = pts_list[-2], pts_list[-1]
    vx, vy = x2-x1, y2-y1; n = math.hypot(vx, vy) or 1; ux, uy = vx/n, vy/n
    nx, ny = -uy, ux
    hp = [(x2, y2), (x2-ux*head*1.6+nx*head*0.8, y2-uy*head*1.6+ny*head*0.8),
          (x2-ux*head*1.6-nx*head*0.8, y2-uy*head*1.6-ny*head*0.8)]
    hs = " ".join(f"{a:.1f},{b:.1f}" for a, b in hp)
    return (f'<path d="{d}" fill="none" style="stroke:var(--{color})" stroke-width="{w}"{dd}/>'
            f'<polygon points="{hs}" style="fill:var(--{color})"/>')

def chip(x, y, n, r=15):
    return (f'<circle cx="{x}" cy="{y}" r="{r}" style="fill:var(--illus-face-top);stroke:var(--illus-ink)" stroke-width="1.8" stroke-dasharray="4 3"/>'
            + txt(x, y+5, str(n), 15, weight="700"))

# ---------- entities ----------
def agent(ox, oy):  # upstream-facing (D-IL17), compact re-draw of the exemplar
    s = []
    sx, sy = P(0.25, 0.25, 0, ox, oy)
    s.append(f'<ellipse cx="{sx:.0f}" cy="{sy:.0f}" rx="52" ry="25" style="fill:var(--illus-ink)" fill-opacity="0.07"/>')
    s.append(iso_box(0,0,5.2,5.2,0,0.65,ox,oy,1.8)); s.append(iso_box(0,0,3.9,3.9,0.65,0.45,ox,oy))
    s.append(iso_box(0,0,2.7,2.7,1.1,1.7,ox,oy,1.8)); s.append(iso_box(0,0,0.85,0.85,2.8,0.16,ox,oy,1.2))
    s.append(iso_box(0,0,2.1,2.1,2.96,1.3,ox,oy,1.8))
    hf = P(-1.05,1.05,4.26,ox,oy)
    s.append(f'<g transform="{face_left(hf)}"><rect x="3.5" y="5" width="26" height="12" rx="3" style="fill:var(--illus-surface-sunken);stroke:var(--illus-ink)" stroke-width="1.1"/>'
             f'<circle cx="11" cy="11" r="2.4" style="fill:var(--illus-ink)"/><circle cx="21.5" cy="11" r="2.4" style="fill:var(--illus-ink)"/></g>')
    ax, ay = P(0,0,4.26,ox,oy); tx, ty = P(0,0,4.95,ox,oy)
    s.append(f'<line x1="{ax:.0f}" y1="{ay:.0f}" x2="{tx:.0f}" y2="{ty:.0f}" style="stroke:var(--illus-ink)" stroke-width="1.7"/>')
    s.append(f'<circle cx="{tx:.0f}" cy="{ty:.0f}" r="3.4" style="fill:var(--illus-accent)"/>')
    return "".join(s)

def person(ox, oy):
    s = [iso_box(0,0,3.2,3.2,0,0.55,ox,oy,1.6)]
    bx, by = P(0,0,0.55,ox,oy)
    s.append(f'<rect x="{bx-9:.0f}" y="{by-46:.0f}" width="18" height="34" rx="9" style="fill:var(--illus-face-top);stroke:var(--illus-ink)" stroke-width="1.8"/>')
    s.append(f'<circle cx="{bx:.0f}" cy="{by-56:.0f}" r="8.5" style="fill:var(--illus-face-top);stroke:var(--illus-ink)" stroke-width="1.8"/>')
    return "".join(s)

def bubble(x, y, w, h, tail=None, dots=False):
    s = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" style="fill:var(--illus-face-top);stroke:var(--illus-ink)" stroke-width="1.6"/>']
    if tail:
        s.append(f'<path d="M {tail[0]} {y+h} L {tail[1]} {y+h+12} L {tail[2]} {y+h}" style="fill:var(--illus-face-top);stroke:var(--illus-ink)" stroke-width="1.6"/>')
        s.append(f'<line x1="{tail[0]+1}" y1="{y+h}" x2="{tail[2]-1}" y2="{y+h}" style="stroke:var(--illus-face-top)" stroke-width="2.4"/>')
    if dots:
        for i in range(3):
            s.append(f'<circle cx="{x+w/2-14+i*14}" cy="{y+h/2}" r="3.2" style="fill:var(--illus-ink)"/>')
    return "".join(s)

def hub(ox, oy):  # shared MCP Server + Skill panel
    s = [f'<rect x="{ox-178}" y="{oy-72}" width="356" height="150" rx="14" style="fill:var(--illus-face-top);stroke:var(--illus-ink)" stroke-width="1.8"/>']
    s.append(txt(ox, oy-50, "SHARED — SERVES THE WHOLE RUN", 10.5, "illus-ink-muted", weight="700", extra='letter-spacing="2.5"'))
    s.append(f'<line x1="{ox}" y1="{oy-38}" x2="{ox}" y2="{oy+52}" style="stroke:var(--illus-guide)" stroke-width="1.2" stroke-dasharray="3 4"/>')
    # skill (left half)
    px, py = ox-132, oy-34
    s.append(f'<path d="M {px} {py+14} H {px+13} C {px+11} {py+5} {px+18} {py} {px+23} {py} C {px+28} {py} {px+35} {py+5} {px+33} {py+14} H {px+46} V {py+27} C {px+55} {py+25} {px+60} {py+32} {px+60} {py+37} C {px+60} {py+42} {px+55} {py+49} {px+46} {py+47} V {py+60} H {px} Z" '
             f'style="fill:var(--illus-accent);stroke:var(--illus-ink)" fill-opacity="0.16" stroke-width="2"/>')
    s.append(txt(ox-89, oy+52, "Skill", 13.5, weight="700"))
    # server rack (right half)
    for i in range(3):
        y = oy-34+i*20
        s.append(f'<rect x="{ox+42}" y="{y}" width="88" height="16" rx="4" style="fill:var(--illus-surface-sunken);stroke:var(--illus-ink)" stroke-width="1.8"/>')
        s.append(f'<circle cx="{ox+52}" cy="{y+8}" r="2.4" style="fill:var(--illus-ink)"/>')
        s.append(f'<line x1="{ox+88}" y1="{y+8}" x2="{ox+118}" y2="{y+8}" style="stroke:var(--illus-guide)" stroke-width="2"/>')
    s.append(txt(ox+89, oy+52, "MCP Server", 13.5, weight="700"))
    return "".join(s)

def context_stack(ox, oy):
    s = []
    for i, z in enumerate((0, 0.58, 1.16, 1.74)):
        s.append(iso_box(0, 0, 2.7, 2.7, z, 0.42, ox, oy, 1.5))
    # newest slab tinted accent + ghost of the next turn
    A=P(-1.35,-1.35,2.16,ox,oy); B=P(1.35,-1.35,2.16,ox,oy); C=P(1.35,1.35,2.16,ox,oy); D=P(-1.35,1.35,2.16,ox,oy)
    s.append(f'<polygon points="{A[0]:.0f},{A[1]:.0f} {B[0]:.0f},{B[1]:.0f} {C[0]:.0f},{C[1]:.0f} {D[0]:.0f},{D[1]:.0f}" style="fill:var(--illus-accent)" fill-opacity="0.22"/>')
    g = [P(*c, 2.9, ox, oy) for c in [(-1.35,-1.35),(1.35,-1.35),(1.35,1.35),(-1.35,1.35)]]
    gp = " ".join(f"{a:.0f},{b:.0f}" for a, b in g)
    s.append(f'<polygon points="{gp}" fill="none" style="stroke:var(--illus-guide)" stroke-width="1.2" stroke-dasharray="4 4"/>')
    return "".join(s)

# ---------- ring ----------
RCX, RCY, RA, RB = 855, 425, 225, 112
def ring_pt(deg): a = math.radians(deg); return (RCX+RA*math.cos(a), RCY-RB*math.sin(a))

def ring():
    s = [f'<ellipse cx="{RCX}" cy="{RCY}" rx="{RA}" ry="{RB}" fill="none" style="stroke:var(--illus-guide)" stroke-width="2.4" stroke-dasharray="8 7"/>']
    for deg in (45, 135, 225, 315):  # chevrons, clockwise travel
        x, y = ring_pt(deg); a = math.radians(deg)
        ux, uy = RA*math.sin(a), RB*math.cos(a); n = math.hypot(ux, uy); ux, uy = ux/n, uy/n
        nx, ny = -uy, ux
        pts = [(x-ux*3+nx*6, y-uy*3+ny*6), (x+ux*7, y+uy*7), (x-ux*3-nx*6, y-uy*3-ny*6)]
        pp = " ".join(f"{a:.0f},{b:.0f}" for a, b in pts)
        s.append(f'<polyline points="{pp}" fill="none" style="stroke:var(--illus-ink-muted)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>')
    # turn tally in the ring center
    for i in range(3):
        s.append(f'<rect x="{RCX-44+i*26}" y="{RCY-11}" width="20" height="22" rx="5" style="fill:var(--illus-face-top);stroke:var(--illus-guide)" stroke-width="1.3"/>')
        s.append(txt(RCX-34+i*26, RCY+4, str(i+1), 11, "illus-ink-muted"))
    s.append(txt(RCX+36, RCY+4, "… n", 12, "illus-ink-muted", "start"))
    s.append(txt(RCX, RCY+30, "one turn per lap", 11, "illus-ink-muted"))
    # stations: decide(top) → call tool(right) → observe(bottom) → append(left)
    def station(deg, label, glyph, label_dy=34):
        x, y = ring_pt(deg)
        g = [iso_box(0, 0, 2.2, 2.2, 0, 0.4, x, y+14)]
        g.append(glyph(x, y-16))
        g.append(txt(x, y+label_dy, label, 12, "illus-ink", weight="600"))
        return "".join(g)
    def g_decide(x, y):
        return (f'<circle cx="{x}" cy="{y}" r="10" fill="none" style="stroke:var(--illus-ink)" stroke-width="2"/>'
                f'<path d="M {x} {y+6} V {y} M {x} {y} L {x-5} {y-6} M {x} {y} L {x+5} {y-6}" fill="none" style="stroke:var(--illus-ink)" stroke-width="2" stroke-linecap="round"/>')
    def g_call(x, y):
        return (f'<rect x="{x-8}" y="{y-5}" width="16" height="12" rx="2.5" style="fill:var(--illus-surface-sunken);stroke:var(--illus-ink)" stroke-width="1.8"/>'
                f'<line x1="{x-3.5}" y1="{y-5}" x2="{x-3.5}" y2="{y-11}" style="stroke:var(--illus-ink)" stroke-width="2"/>'
                f'<line x1="{x+3.5}" y1="{y-5}" x2="{x+3.5}" y2="{y-11}" style="stroke:var(--illus-ink)" stroke-width="2"/>')
    def g_observe(x, y):
        return (f'<ellipse cx="{x}" cy="{y}" rx="11" ry="6.5" fill="none" style="stroke:var(--illus-ink)" stroke-width="2"/>'
                f'<circle cx="{x}" cy="{y}" r="2.6" style="fill:var(--illus-ink)"/>')
    def g_append(x, y):
        return (f'<rect x="{x-9}" y="{y+1}" width="18" height="5" rx="1.5" fill="none" style="stroke:var(--illus-ink)" stroke-width="1.8"/>'
                f'<rect x="{x-9}" y="{y-6}" width="18" height="5" rx="1.5" fill="none" style="stroke:var(--illus-ink)" stroke-width="1.8"/>'
                f'<path d="M {x+15} {y-2} h 8 M {x+19} {y-6} v 8" style="stroke:var(--illus-accent)" stroke-width="2" stroke-linecap="round"/>')
    s.append(station(90, "decide next step", g_decide, 40))
    s.append(station(0, "call a tool", g_call))
    s.append(station(270, "observe the result", g_observe, 44))
    s.append(station(180, "append to context", g_append))
    return "".join(s)

# ---------- the sheet ----------
W, H = 1680, 945
def sheet(theme_label):
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">']
    s.append('<defs><pattern id="gr" width="28" height="28" patternUnits="userSpaceOnUse">'
             '<path d="M 28 0 L 0 0 0 28" fill="none" style="stroke:var(--illus-grid)" stroke-width="1"/></pattern></defs>')
    s.append(f'<rect width="{W}" height="{H}" style="fill:var(--illus-paper)"/><rect width="{W}" height="{H}" fill="url(#gr)"/>')
    for cx, cy in ((40,40),(840,26),(1640,40),(40,905),(840,919),(1640,905)):
        s.append(f'<path d="M {cx} {cy-9} V {cy+9} M {cx-9} {cy} H {cx+9}" style="stroke:var(--illus-guide)" stroke-width="1.4" fill="none"/>')
    s.append(f'<rect x="26" y="18" width="{W-52}" height="{H-36}" fill="none" style="stroke:var(--illus-grid)" stroke-width="1" stroke-dasharray="2 8"/>')
    # title
    s.append(txt(70, 100, "Anatomy of a Run", 46, anchor="start", weight="800"))
    s.append(txt(72, 134, "from prompt to answer — skill, tools, and a growing context", 19, "illus-ink-muted", "start"))
    s.append(f'<rect x="72" y="152" width="60" height="6" style="fill:var(--illus-ink)"/>')
    s.append(f'<g style="stroke:var(--illus-accent)" stroke-width="2">' +
             "".join(f'<path d="M {142+i*10} 158 l 8 -8"/>' for i in range(5)) + "</g>")
    s.append(f'<text x="{W-70}" y="100" font-size="13" style="fill:var(--illus-ink-muted)" text-anchor="end" {FONT}>{theme_label}</text>')

    # ---- return connector (answer → user) ----
    s.append(arrow([(1560, 350), (1560, 185), (150, 185), (150, 235)], "illus-guide", 2, dash="7 6"))
    s.append(txt(855, 176, "the answer returns — and the session is saved for replay", 13, "illus-ink-muted", extra='font-style="italic"'))

    # ---- phase chips + headers ----
    s.append(chip(150, 250, 1)); s.append(txt(150, 292, "User prompt", 18, weight="700")); s.append(txt(150, 312, "the run starts with a question", 12.5, "illus-ink-muted"))
    s.append(chip(390, 250, 2)); s.append(txt(390, 292, "Agent receives", 18, weight="700")); s.append(txt(390, 312, "and prepares: ③ ④ ⑤", 12.5, "illus-ink-muted"))
    s.append(chip(664, 250, 6)); s.append(txt(664, 292, "Execution loop", 18, weight="700"))
    s.append(txt(664, 312, "turn after turn, until the plan is done", 12.5, "illus-ink-muted"))
    s.append(chip(1330, 250, 7)); s.append(txt(1330, 292, "Summarize &amp; answer", 18, weight="700")); s.append(txt(1330, 312, "the grown context, compressed", 12.5, "illus-ink-muted"))

    # ---- Act I ----
    s.append(person(150, 520))
    s.append(bubble(88, 350, 124, 54, tail=(120, 132, 144), dots=True))
    s.append(arrow([(226, 468), (296, 468)]))
    s.append(agent(390, 560))
    # satellite ④: plan card
    s.append(f'<g transform="rotate(-1 320 375)"><rect x="252" y="345" width="112" height="62" rx="8" style="fill:var(--illus-face-top);stroke:var(--illus-ink)" stroke-width="1.4"/>'
             + "".join(f'<rect x="262" y="{356+i*15}" width="8" height="8" rx="2" fill="none" style="stroke:var(--illus-ink-muted)" stroke-width="1.4"/>'
                       f'<line x1="276" y1="{360+i*15}" x2="{344-i*16}" y2="{360+i*15}" style="stroke:var(--illus-guide)" stroke-width="2.6" stroke-linecap="round"/>' for i in range(3))
             + f'<path d="M 263.5 359.5 l 2.5 3 l 4 -5" fill="none" style="stroke:var(--illus-accent)" stroke-width="1.6"/></g>')
    s.append(chip(252, 340, 4, 13)); s.append(txt(374, 352, "plans the", 11.5, "illus-ink-muted", "start")); s.append(txt(374, 366, "execution", 11.5, "illus-ink-muted", "start"))
    s.append(f'<path d="M 330 412 l 12 20.8" fill="none" style="stroke:var(--illus-guide)" stroke-width="1.2" stroke-dasharray="3 3"/>')

    # ---- hub + its connectors ----
    s.append(hub(855, 750))
    # ③ skill → agent (read)
    s.append(arrow([(672, 726), (390, 726), (390, 622)], "illus-ink", 2.2))
    s.append(chip(500, 726, 3, 13)); s.append(txt(522, 714, "loads the Skill", 13, "illus-ink", "start", "600"))
    # ⑤ agent → server (tools/list, discovery)
    s.append(arrow([(430, 640), (430, 782), (672, 782)], "illus-ink", 2, dash="6 5"))
    s.append(chip(500, 782, 5, 13)); s.append(txt(522, 770, "finds its tools (tools/list)", 13, "illus-ink", "start", "600"))
    # ring "call a tool" ⇄ hub (the loop talks to the SAME server)
    s.append(arrow([(1080, 452), (1080, 700), (1040, 700)], "illus-accent", 2.2, dash="7 5"))
    s.append(txt(1096, 560, "tools/call", 13, "illus-accent", "start", "700"))
    s.append(txt(1096, 578, "every turn, same server", 11.5, "illus-ink-muted", "start"))
    s.append(txt(855, 858, "one MCP server, one Skill — the same pair serves ③, ⑤ and every tools/call inside the loop", 13.5, "illus-ink", extra='font-style="italic"'))

    # ---- Act II: ring + context stack ----
    s.append(ring())
    s.append(arrow([(452, 520), (575, 424), (668, 364)]))          # agent → ring, entering at "decide"
    s.append(txt(548, 398, "plan in hand", 11.5, "illus-ink-muted"))
    # append → context stack
    s.append(arrow([(626, 454), (588, 516)], "illus-ink", 1.8))
    s.append(context_stack(555, 610))
    s.append(txt(642, 622, "context (t1 … tn)", 12.5, "illus-ink", "start", "600"))
    s.append(txt(642, 640, "grows every turn", 12, "illus-ink-muted", "start"))
    # exit (after last turn) → summarize
    s.append(arrow([(1046, 342), (1130, 300), (1216, 355)]))
    s.append(txt(1130, 285, "plan complete", 11.5, "illus-ink-muted"))

    # ---- Act III ----
    # summarizer: tall mini-stack → funnel → compact block
    fx, fy = 1268, 430
    for i, z in enumerate((0, 0.5, 1.0)):
        s.append(iso_box(0, 0, 1.9, 1.9, z, 0.36, fx, fy))
    s.append(f'<path d="M {fx+38} {fy-38} L {fx+74} {fy-38} L {fx+64} {fy-12} L {fx+48} {fy-12} Z" style="fill:var(--illus-surface-sunken);stroke:var(--illus-ink)" stroke-width="1.7"/>')
    s.append(f'<line x1="{fx+52}" y1="{fy-32}" x2="{fx+60}" y2="{fy-32}" style="stroke:var(--illus-ink-muted)" stroke-width="1.6"/>')
    s.append(f'<line x1="{fx+50}" y1="{fy-26}" x2="{fx+62}" y2="{fy-26}" style="stroke:var(--illus-ink-muted)" stroke-width="1.6"/>')
    s.append(iso_box(0, 0, 1.5, 1.5, 0, 0.9, fx+104, fy-6))
    s.append(txt(fx+40, fy+44, "the whole context, distilled", 12, "illus-ink-muted"))
    # answer bubble
    s.append(bubble(1462, 368, 152, 74, tail=(1490, 1478, 1512)))
    for i, wl in enumerate((116, 96, 60)):
        s.append(f'<line x1="1478" y1="{388+i*14}" x2="{1478+wl*0.6:.0f}" y2="{388+i*14}" style="stroke:var(--illus-guide)" stroke-width="3.2" stroke-linecap="round"/>')
    s.append(f'<circle cx="1594" cy="428" r="9" style="fill:var(--illus-accent)"/>')
    s.append(f'<path d="M 1590 428 l 3 3.5 l 5.5 -7" fill="none" stroke-width="2" style="stroke:var(--illus-face-top)"/>')
    s.append(txt(1538, 470, "Answer", 13.5, weight="700"))
    s.append(arrow([(1386, 424), (1450, 412)]))

    # ---- principle card ----
    s.append(f'<g transform="rotate(-0.6 220 855)"><rect x="60" y="800" width="330" height="112" rx="10" style="fill:var(--illus-face-top);stroke:var(--illus-ink)" stroke-width="1.5"/>'
             f'<rect x="68" y="808" width="314" height="96" rx="6" fill="none" style="stroke:var(--illus-guide)" stroke-width="1" stroke-dasharray="2 4"/>'
             + txt(86, 830, "THE TURN PRINCIPLE", 12.5, weight="800", anchor="start", extra='letter-spacing="2.5"')
             + txt(86, 856, "decide → act → observe → append", 14.5, anchor="start")
             + txt(86, 882, "the context is the memory of the run", 13, "illus-ink-muted", "start")
             + "</g>")
    s.append("</svg>")
    return "".join(s)

# ---------- emit ----------
out = pathlib.Path(__file__).resolve().parent
svg = sheet("{THEME}")
import cairosvg
for theme in ("bright", "dark"):
    body = svg.replace("{THEME}", f"qlik-{theme}")
    for k, v in resolved(theme).items():
        body = body.replace(f"var(--{k})", v)
    cairosvg.svg2png(bytestring=body.encode(), write_to=str(out / f"run-flow-{theme}.png"), scale=1.25)
html = (f'<!doctype html><html><head><meta charset="utf-8"><title>Anatomy of a Run</title>'
        f'<style>body{{margin:0;background:#888;padding:24px;display:grid;gap:24px}}'
        f'.panel{{border-radius:14px;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.25)}}'
        f'.bright{{{css_vars("bright")}}}.dark{{{css_vars("dark")}}}</style></head><body>'
        f'<div class="panel bright">{svg.replace("{THEME}", "qlik-bright")}</div>'
        f'<div class="panel dark">{svg.replace("{THEME}", "qlik-dark")}</div></body></html>')
(out / "run-flow-preview.html").write_text(html)
print("ok")
