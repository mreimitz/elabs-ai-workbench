---
name: brand-ui-theme
description: Create or retune a brand-ui theme (token work). Use when adding a new theme, re-branding the system to a customer's palette, adjusting global radius/spacing/surfaces, or fixing token-level contrast across themes. Use when the user says "new theme", "brand it for <customer>", "make corners less rounded", "dark theme", "adjust the tokens", or "our colors". Every change is a token in themes.css — never a hardcoded value in a component.
user-invocable: true
argument-hint: "<theme-name> [brief]"
allowed-tools:
  - Bash(pnpm brand-ui *)
  - Bash(pnpm --filter *)
---

# brand-ui-theme

Theming is a **token change, not a component change**. This skill is the portable
front door to brand-ui's theming workflow and rules.

## Where everything lives

The `@brand/tokens` theme stylesheet (`@brand/tokens/styles.css`) — `:root` is the
default base; each theme is a `[data-theme="name"]` block that overrides the
**full** semantic token set (surfaces, sidebar, canvas/flow, chat, chart-1..5,
radius). `theme-types.ts` holds
`THEMES`, `THEME_META`, and `DEFAULT_THEME`. Run `brand-ui info` for the live
theme list, token set, and current `--radius`.

## Add a theme

1. Add a `[data-theme="<name>"]` block in `themes.css` that overrides **every**
   token (a missing token falls back to `:root` and usually looks wrong). Use OKLCH.
2. Add the `THEMES` + `THEME_META` entries; set `DEFAULT_THEME` only if it should
   be the default.
3. Optionally ship a `registry:theme` item (`brand-ui-registry`).
4. Map any new visual concept in the `@theme inline` block so `bg-foo`/`text-foo`
   resolve.

## Re-brand from a customer palette

Derive the brand color → set `--primary` (+ `--ring`, sidebar/chart accents),
compose surfaces/ink around it, keep `--destructive` conventional. Carry warmth via
accent + type, not a tinted near-white body. Preserve an existing committed brand
if one is already in the tokens.

## Global tweaks (radius, spacing, surfaces)

These are single-token edits that cascade. Example: corner rounding is `--radius`
per theme; `rounded-sm/md/lg/xl` derive via `@theme inline`. To square the system,
lower `--radius` in each block — don't touch components.

## Verify (non-negotiable)

- Body text ≥ 4.5:1 / UI ≥ 3:1 in **every** theme. Use the `brand-ui-audit` skill
  (oklch-aware, rendered) — don't eyeball. Watch brand green as small text on
  white and white text on green fills.
- Re-render the playground/Storybook in the new theme.
- `pnpm --filter @brand/tokens typecheck` and keep `THEMES`/`THEME_META` in sync
  with the CSS blocks.
