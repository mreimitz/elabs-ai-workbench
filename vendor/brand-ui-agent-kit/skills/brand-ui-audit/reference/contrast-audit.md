# Rendered contrast + capture recipe

brand-ui themes compute to `oklch()`, so an `rgb()`-only contrast parser **passes
everything silently**. Use this oklch-aware auditor in the page.

## In-page WCAG auditor (paste into the browser via agent-browser `eval`)

```js
(function () {
  function lin(c) {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function lumLin(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function oklabLum(L, A, B) {
    const l_ = L + 0.3963377774 * A + 0.2158037573 * B,
      m_ = L - 0.1055613458 * A - 0.0638541728 * B,
      s_ = L - 0.0894841775 * A - 1.291485548 * B;
    const l = l_ ** 3,
      m = m_ ** 3,
      s = s_ ** 3;
    let R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      Bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    R = Math.max(0, Math.min(1, R));
    G = Math.max(0, Math.min(1, G));
    Bb = Math.max(0, Math.min(1, Bb));
    return lumLin(R, G, Bb);
  }
  function P(str) {
    if (!str) return null;
    str = str.trim();
    if (str === "transparent") return { lum: 0, a: 0 };
    let m = str.match(/^rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1]
        .split(/[ ,\/]+/)
        .filter(Boolean)
        .map(parseFloat);
      return { lum: lumLin(lin(p[0]), lin(p[1]), lin(p[2])), a: p[3] === undefined ? 1 : p[3] };
    }
    m = str.match(/^oklch\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[ ,\/]+/).filter(Boolean);
      let L = parseFloat(p[0]);
      if (p[0].includes("%")) L /= 100;
      const C = parseFloat(p[1]) || 0,
        H = ((parseFloat(p[2]) || 0) * Math.PI) / 180;
      const a = p[3] !== undefined ? parseFloat(p[3]) : 1;
      return { lum: oklabLum(L, C * Math.cos(H), C * Math.sin(H)), a };
    }
    m = str.match(/^oklab\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[ ,\/]+/).filter(Boolean);
      let L = parseFloat(p[0]);
      if (p[0].includes("%")) L /= 100;
      const a = p[3] !== undefined ? parseFloat(p[3]) : 1;
      return { lum: oklabLum(L, parseFloat(p[1]) || 0, parseFloat(p[2]) || 0), a };
    }
    return null;
  }
  function ratio(a, b) {
    const hi = Math.max(a, b),
      lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }
  function bgLum(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      const c = P(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c.lum;
      n = n.parentElement;
    }
    return 1;
  }
  const root = document.querySelector("#storybook-root") || document.body,
    out = [];
  for (const el of root.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const t = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(" ");
    if (!t) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
    const f = P(cs.color);
    if (!f) continue;
    const rr = ratio(f.lum, bgLum(el)),
      sz = parseFloat(cs.fontSize),
      w = parseInt(cs.fontWeight) || 400;
    const large = sz >= 24 || (sz >= 18.66 && w >= 700),
      min = large ? 3 : 4.5;
    if (rr < min - 0.03) out.push({ t: t.slice(0, 28), r: Math.round(rr * 100) / 100, sz, min });
  }
  return JSON.stringify({
    theme: document.documentElement.getAttribute("data-theme"),
    count: out.length,
    fails: out.slice(0, 25),
  });
})();
```

## Capture recipe (agent-browser)

- **Theme switch (Storybook):** `…/iframe.html?id=<story>&globals=theme:Qlik+Dark&viewMode=story`
  (labels: `Qlik Bright`, `Qlik Dark`, `Light`, `Dark`, `Blueprint`, `High contrast`).
- **Render gate (critical):** after `open`, `wait <ms>` (e.g. `wait 1200`) or poll
  until `#storybook-root` has content **before** the screenshot. A blank/spinner
  capture is a timing bug, not a component bug — re-shoot, don't report it.
- **Readable screenshots:** save into the project (e.g.
  `reports/screenshots/…png`) so they can be read back; paths outside the
  connected folder can't be opened.
- **Verify the theme applied:** `eval document.documentElement.getAttribute('data-theme')`.
- Do **not** put `wait` and `eval` (with quotes) inside a single batch string —
  the batch tokenizer eats quotes; use the dedicated `eval` tool for JS.

## Turning a failure into a fix

Report the measured ratio and the offending token. Example:
`Default button label 3.61:1 (white on --primary)` → fix in `themes.css`: darken
`--primary` or add `--primary-strong` for text/labels; re-run until ≥ 4.5:1 in
qlik-bright and qlik-dark. Never "use a darker gray/green" as a literal — name the
token.
