---
name: brand-ui-audit
description: Audit and refine UI built with brand-ui — visual quality, design consistency, accessibility, and token compliance. Use when the user asks to audit/review/polish a UI, check contrast or accessibility, find design issues, make an interface feel more finished, verify it works across themes, or before shipping a screen. Runs a deterministic static pass (token violations, spacing, sizing, anti-patterns) plus a rendered cross-theme visual + WCAG-contrast pass over Storybook or a running app, then produces a phased, token-referenced plan. Read-only by default — reports findings; every fix points at a @brand token, never raw hex.
user-invocable: true
argument-hint: "[audit|contrast|review|polish] [target]"
allowed-tools:
  - Bash(npx @brand/cli *)
  - Bash(pnpm brand-ui *)
  - Bash(npx brand-ui *)
---

# brand-ui-audit

A design-quality reviewer for brand-ui interfaces. It catches what static checks
and unit tests miss — weak hierarchy, cramped spacing, low contrast, token
violations, broken theming, anti-patterns — and reports them as a prioritized,
implementation-ready plan. **Read-only**: it reports and (with approval) files
issues; the fix is done separately.

## Setup

1. Run **`brand-ui info`** once to load the theme list and token set. Every
   recommendation must resolve to a token from this set — never propose raw hex.
2. Identify the target: a file/dir (static pass), a Storybook story id, or a
   running app URL (rendered pass).
3. **Pick the register** (it flips the defaults you audit against):
   - **product** (default for brand-ui) — app UI, dashboards, admin, tools. Bar is
     _earned familiarity_: one type family, fixed rem scale, restrained color,
     every component state present (default/hover/focus/active/disabled/loading/
     empty/error), skeletons over spinners, quick 150–250ms state-only motion, no
     modal-as-first-thought. Most `@brand/*` surfaces are here.
   - **brand** — `@brand/marketing` surfaces, landing pages, campaigns. Bar is
     _distinctiveness_: committed color, required real imagery (not colored blocks),
     ambitious first-load motion, a POV. "Restraint without intent reads as
     mediocre." Judge by the surface in focus, not the whole repo.

## Modes (route on the first argument)

| Mode                  | Does                                                                          |
| --------------------- | ----------------------------------------------------------------------------- |
| `audit [path]`        | Full pass: static lint **+** rendered cross-theme visual + contrast. Default. |
| `contrast [target]`   | Just the WCAG pass (oklch-aware) across all themes.                           |
| `review [story\|url]` | Visual/UX critique of a specific surface (hierarchy, spacing, states).        |
| `polish [target]`     | Re-audit after fixes; confirm findings are resolved, no regressions.          |

## Pass 1 — deterministic (no browser, no LLM)

Run `brand-ui audit <path> --json`. It flags, per file:line:

- **raw-hex / rgb-literal / arbitrary-color** — colors outside `themes.css`
  (the one allowed place). Fix: a semantic token (`bg-card`, `text-muted-foreground`, …).
- **space-y-x** — `space-x/space-y-*` → use `flex`/`grid` + `gap-*`.
- **wh-equal** — `w-N h-N` with equal values → `size-N`.
- **outline-none** — focus ring possibly removed → keep `focus-visible:ring-2 ring-ring`.
- **Visual anti-slop (WP-15)** — `pure-black` (use the `foreground` token),
  `neon-glow` (tinted/inset shadow), `gradient-text`, `side-stripe`, `over-round`,
  `custom-cursor`, `viewport-h-screen` (`min-h-dvh`). Token-translated tells.
- **Content anti-slop — the "Jane Doe effect" (WP-15)** — `slop-generic-name`
  ("John/Jane Doe"), `slop-fake-number` ("99.99%"), `slop-brand-name`
  ("Acme/Nexus"), `marketing-buzzword` (filler verbs). Advisory here (placeholders
  can be intentional); the **ratcheted `pnpm slop:check` CI gate** is where these
  get teeth — the audit reports, the gate enforces.

These are cheap, exact, and CI-friendly. The register-gated/perceptual tells
(anti-card, 3-equal-cards, motion intensity) and rendered contrast stay in Pass 2.

## Pass 2 — rendered (cross-theme visual + contrast)

This is the high-signal pass and needs a browser. Use the **agent-browser** skill
to drive a running Storybook (default `http://localhost:6007`) or app:

1. Enumerate the surfaces to check (Storybook `/index.json`, or the app's routes).
   Pick a representative set: app shell, data table, chat, charts, flow, forms,
   overlays (opened), states (empty/loading/error), plus foundation (button, badge, alert).
2. For **each theme** (qlik-bright, qlik-dark, blueprint): navigate with a render
   gate, screenshot, and read the pixels. Switch a Storybook story's theme via
   `&globals=theme:<Qlik Bright|Qlik Dark|Blueprint>`.
   **Always wait for render before the screenshot** (poll for content / fixed
   delay) — a screenshot fired during the loader is a capture bug, not a finding.
3. **Measure contrast on the real pixels**, oklch-aware. Computed colors here come
   back as `oklch()`, so an `rgb()`-only parser silently passes everything —
   convert oklch → sRGB → relative luminance, then ratio. Flag body text < 4.5:1,
   large text/UI < 3:1. (This is exactly how the brand green was caught at
   3.61:1 white-on-green and 3.77:1 green-on-white.)
4. Check focus rings (tab through), hover/active/disabled, and that each theme
   actually repaints (`document.documentElement.dataset.theme`).

See [reference/contrast-audit.md](reference/contrast-audit.md) for the oklch
contrast function and the capture-gate recipe, and
[reference/anti-patterns.md](reference/anti-patterns.md) for the design smells.

**Two ways to measure rendered contrast** (the reference covers the first; the
second is the more robust upgrade):

1. **Computed-color** (default here): read each text element's computed `color` +
   effective background, convert oklch→sRGB→luminance, ratio. Accurate for the
   solid-token backgrounds brand-ui normally uses; blind to gradients/images
   behind text.
2. **Screenshot-diff** (upgrade, for gradient/image backgrounds): screenshot the
   element, hide the glyph text (`color: transparent`), screenshot again,
   pixel-diff to isolate glyph pixels, and take the **p10 percentile** contrast
   against the actually-rendered background. This is how a mature detector
   (impeccable's `screenshot-contrast.mjs`) avoids missing low contrast over a
   photo or gradient. Reach for it when text sits on imagery.

## Evaluate (scored)

Run **two independent passes then synthesize** — form the design/heuristic read
(Pass A) before the detector numbers (Pass B) enter judgment, so the deterministic
output doesn't anchor the eye. Then score with the rubric in
[reference/ux-evaluation.md](reference/ux-evaluation.md):

- **/24 scorecard** (accessibility · states & resilience · theming & tokens ·
  consistency & hierarchy · visual anti-patterns · **taste & anti-slop**), optional
  0–100 composite + a one-line "does this look AI-generated?" verdict that now
  weighs **content** slop (the "Jane Doe effect"), not just visual tells. The taste
  axis is **register-gated** — judge against the active taste profile (register ×
  density × motion × expressiveness); product is restrained, brand is expressive.
- **9-state inventory** per component (default/hover/focus/active/disabled/loading/
  empty/error/partial) — flag missing or ad-hoc states; check brand-ui's
  `EmptyState`/`Skeleton`/`ErrorState`/`LoadingState` are used, not bespoke markup.
- **WCAG 2.2 for designers** (POUR + the 2.2 additions: 24px targets, focus not
  obscured, redundant entry, dragging alternative).
- **Copy & microcopy** (error = what+how, empty = what+how+why, verb+object
  buttons, destructive friction hierarchy), the **content anti-slop** check (the
  "Jane Doe effect"), and an **ethics / dark-pattern** scan.
- **Taste pre-flight** (ux-evaluation.md) — the final, register-gated QA gate
  (tokens-not-literals, real content, every state, motion honored-not-mandated,
  cross-theme contrast, hierarchy/layout) before a surface is "done".

Apply the **reduction filter** — if an element can be removed without losing
meaning, recommend removing it; if a user would need to be told it exists, rework it.

## Output — phased plan, then approval

Group findings by severity and present as a plan; **do not edit components**:

- **P0** — broken / illegible / inaccessible (e.g. AA contrast failures).
- **P1** — clearly hurts quality.
- **P2** — polish.

Each finding: surface + theme, what's wrong, why it matters, and a **concrete,
token-referenced fix** (name the token or rule). Write the report to a dated
file (e.g. `reports/visual-ux-<date>.md`) with screenshot links.

Then **report the findings to the user** — for each: `file:line` (or
surface + theme), severity, and the concrete, token-referenced fix. This skill
**reports, it does not fix**: the user decides what to change. Don't edit
components as part of the audit.

## Token discipline (what makes this on-brand, not generic)

Never recommend a raw color, a hardcoded radius, or an arbitrary value. Every fix
is a `@brand` token or a documented rule. If a needed visual concept has no token,
say so and route to `brand-ui-theme` to add it — don't invent a literal.
