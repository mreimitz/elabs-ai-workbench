# Styling & tokens

The app styles with **Tailwind v4 + semantic `@elabs-ai/components-tokens`** — utility classes backed by
CSS-variable (oklch) tokens. Raw colors live only inside `@elabs-ai/components-tokens`.

## Wiring (already set up)

- `apps/web/src/styles/app.css` imports the **engine** and then **each theme it wants**:

  ```css
  @import "@elabs-ai/components-tokens/styles.css";        /* engine: tailwindcss, :root base, @theme bridge */
  @import "@elabs-ai/components-tokens/themes/light.css";  /* opt-in */
  @import "@elabs-ai/components-tokens/themes/dark.css";   /* opt-in */
  ```

  **Theme CSS is opt-in since v4.** `styles.css` no longer contains any `[data-theme]` block —
  importing it alone renders a neutral `:root` base, not the themes. Adding a theme means adding its
  `@import`; dropping one silently un-themes that mode.
- Tailwind v4 runs via `@tailwindcss/vite` (in `apps/web/vite.config.ts`).
- Because Tailwind ignores `node_modules`, `app.css` adds `@source` directives pointing at each
  installed package's `dist` so their utility classes are generated. **If a new
  `@elabs-ai/components-*` package is added, add a matching `@source`** — a missing one renders that
  package's components **unstyled, with no error**. Verify each path resolves on disk.
- Providers at the root (`apps/web/src/main.tsx`): `ThemeProvider defaultTheme="light"`
  (`@elabs-ai/components-tokens`) → `TooltipProvider` → app, with `<Toaster />` mounted once. `AppShell` wraps
  its own `SidebarProvider`.

## Rules

- **Semantic, token-backed utilities only:** `bg-background`, `text-foreground`,
  `text-muted-foreground`, `bg-card`, `bg-primary text-primary-foreground`, `border-border`,
  `ring-ring`, `bg-sidebar`, `bg-muted`, `--chart-1..12`. **No raw `#hex`/`rgb()`/`hsl()`**, no
  `bg-[#…]`, no palette colors (`text-gray-500`), no `*-black`/`*-white`. The `check-tokens` hook
  warns on raw color literals in `apps/web/src` `.ts(x)`.
- **`className` is layout only** — never recolor/retypeset a component; use its `variant`/`size`.
- **Merge with `cn()`** (from `@elabs-ai/components-ui`).
- **Visible focus** on every interactive element (the `@elabs-ai/components-ui` components already do this).
- A new visual concept is a **token** (upstream in `@elabs-ai/components-tokens`), not a literal here.
- The **chart ramp is 12 series** (`--chart-1` … `--chart-12`), and charts cycle all twelve before
  repeating. Code that hardcodes `--chart-1..5` still works but no longer covers the ramp.

## Themes (2)

The app exposes exactly two themes — **`light`** (the default, and the library's `DEFAULT_THEME`)
and **`dark`** — applied via `data-theme` on `<html>` by `ThemeProvider`; switch them in
**Settings** (the theme `Select` in `apps/web/src/features/settings/SettingsView.tsx`), or from the
top-bar theme menu. `light` and `dark` are the only themes the library ships; theming is an open
registry (ADR 0029), so a third theme would be authored here with `defineTheme` and registered on
`ThemeProvider` — that is an owner decision, not a default.

`ThemeName` is `string`, not a union, so the compiler will **not** catch a typo'd theme name. Narrow
against `BuiltInThemeName` / `isBuiltInThemeName`, or read `useTheme().themes` at runtime, rather
than writing bare string literals. The exports are `BUILT_IN_THEMES`, `BUILT_IN_THEME_META`,
`BUILT_IN_THEME_DEFINITIONS`, `DEFAULT_THEME`, `THEME_TOKEN_NAMES` — there is no `THEMES`,
`THEME_META`, `isThemeName`, or `PAUSED_THEMES`.

**New visible UI must read correctly in both themes** — verify by looking, not by assuming. Don't
reach for `dark:` overrides; tokens cover both themes.

### The one app-side token override: the light focus ring

`app.css` carries a small `[data-theme="light"]` block that re-points `--ring` and `--sidebar-ring`.
This is **not cosmetic**. Upstream v4 sets `--ring: var(--primary)` — the brand lime — which on the
light theme measures 1.30–1.42:1 against the page surfaces; WCAG 2.4.7 / 1.4.11 require 3:1, so a
keyboard user cannot see focus at all. It takes two tokens because the light theme nests a dark
sidebar rail inside a light content area. `dark` is deliberately left on the upstream ring (12.46:1).

Both `apps/web/src/styles/tokens-contrast.test.ts` and
`apps/web/src/guardrails/token-contrast-identity.guardrail.test.ts` assert this and run in
`pnpm test`. **Do not delete the override to "get back to stock tokens"** — that reintroduces a
known accessibility failure, and the gate will go red.
