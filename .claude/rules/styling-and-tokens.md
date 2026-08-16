# Styling & tokens

The app styles with **Tailwind v4 + semantic `@brand/tokens`** — utility classes backed by
CSS-variable (oklch) tokens. Raw colors live only inside `@brand/tokens`.

## Wiring (already set up)

- `apps/web/src/styles/app.css` imports the token entry: `@import "@brand/tokens/styles.css";`
  (this file contains `@import "tailwindcss"`, `tw-animate-css`, the per-theme `[data-theme]` blocks, and
  the `@theme` bridge).
- Tailwind v4 runs via `@tailwindcss/vite` (in `apps/web/vite.config.ts`).
- Because Tailwind ignores `node_modules`, `app.css` adds `@source` directives for the `@brand/ui`,
  `@brand/data`, and `@brand/icons` `dist` so their utility classes are generated. **If a new
  `@brand/*` package is added, add a matching `@source`.**
- Providers at the root (`apps/web/src/main.tsx`): `ThemeProvider defaultTheme="qlik-bright"`
  (`@brand/tokens`) → `TooltipProvider` → app, with `<Toaster />` mounted once. `AppShell` wraps
  its own `SidebarProvider`.

## Rules

- **Semantic, token-backed utilities only:** `bg-background`, `text-foreground`,
  `text-muted-foreground`, `bg-card`, `bg-primary text-primary-foreground`, `border-border`,
  `ring-ring`, `bg-sidebar`, `bg-muted`, `--chart-1..5`. **No raw `#hex`/`rgb()`/`hsl()`**, no
  `bg-[#…]`, no palette colors (`text-gray-500`), no `*-black`/`*-white`. The `check-tokens` hook
  warns on raw color literals in `apps/web/src` `.ts(x)`.
- **`className` is layout only** — never recolor/retypeset a component; use its `variant`/`size`.
- **Merge with `cn()`** (from `@brand/ui`).
- **Visible focus** on every interactive element (the `@brand/ui` components already do this).
- A new visual concept is a **token** (upstream in `@brand/tokens`), not a literal here.

## Themes (2)

The app exposes exactly two themes — `qlik-bright` (default) and `qlik-dark` — applied via
`data-theme` on `<html>` by `ThemeProvider`; switch them in **Settings** (the theme `Select` in
`apps/web/src/features/settings/SettingsView.tsx`). `@brand/tokens` v1.9.0 also ships a `blueprint`
theme, but the app deliberately filters it out of the switcher and coerces any persisted
`blueprint` back to `qlik-bright` (`apps/web/src/lib/theme.ts` `ALLOWED_THEMES` + the pre-mount
localStorage guard in `main.tsx` + a `useEffect` safety net in `SettingsView`). Do not re-add
`blueprint` (or `light`/`dark`/`high-contrast`, which this version does not ship). **New visible UI
must read correctly in both themes** — verify by looking, not by assuming. Don't reach for `dark:`
overrides; tokens cover both themes.
