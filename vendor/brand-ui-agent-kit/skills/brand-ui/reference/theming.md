# brand-ui — theming

## Mechanism

- Themes are `[data-theme="<name>"]` blocks in the `@brand/tokens` theme
  stylesheet (`@brand/tokens/styles.css`); `:root` is the default (light) base.
  Each theme overrides the full semantic token set (surfaces, sidebar,
  canvas/flow, chat, chart-1..5, radius).
- `ThemeProvider` (from `@brand/tokens`) writes `data-theme` and persists the
  choice; `useTheme()` reads/sets it.
- Shipped themes: **qlik-bright (default)**, qlik-dark, blueprint. Confirm the
  live set with `brand-ui info`.

## Setup (once, at the app root)

```tsx
import "@brand/tokens/styles.css";
import { ThemeProvider } from "@brand/tokens";

export function App() {
  return <ThemeProvider defaultTheme="qlik-bright">{/* app */}</ThemeProvider>;
}
```

## Using tokens

Reference tokens through Tailwind utilities — never literals:

`bg-background` `text-foreground` `text-muted-foreground` `bg-card`
`bg-primary text-primary-foreground` `bg-secondary` `bg-accent` `bg-destructive`
`border-border` `ring-ring` `bg-surface` `bg-sidebar` `--chart-1..5` (data viz).

Run `brand-ui info` for the full token list, or read the `:root` block in
`themes.css`.

## Re-branding / a new theme

Re-branding is a **token change, not a component change**. Add a new
`[data-theme="acme"]` block that overrides every token, add it to `THEMES` /
`THEME_META` in `theme-types.ts`, and (optionally) ship a `registry:theme` item.
In the monorepo, the maintainer flow is the `brand-ui-theme` skill / `/new-theme`.

## Radius

Corner rounding is the single `--radius` token (currently `0.25rem`); `rounded-sm/md/lg/xl`
derive from it via `@theme inline`. Squaring or softening the whole system is a
one-token change per theme — don't hardcode `rounded-[Npx]` in components.

## Contrast

Body text must meet WCAG AA (4.5:1), UI 3:1, in **every** theme. The
`brand-ui-audit` skill measures rendered contrast across all themes (oklch-aware).
Watch brand green as small text on white and white text on green fills — verify
with the audit rather than assuming.
