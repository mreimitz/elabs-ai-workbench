# Starter CLAUDE.md (emitted into every scaffolded app)

Write this as `CLAUDE.md` at the scaffolded app's root, filling the
placeholders. Purpose: any later agent session in that app inherits the
brand constraints without the user re-explaining them.

```markdown
# CLAUDE.md — {Title}

This app is built on **brand-ui** (`@brand/*`). It was scaffolded from the
**{archetype}** template; the spec is in `./app-spec.md` — read it before
making structural changes.

## Non-negotiable rules

- **Use brand-ui components first.** Before writing any UI markup, check
  `@brand/ui`, `@brand/data`, `@brand/ai`, `@brand/flow`, `@brand/charts`,
  `@brand/marketing` for an existing component (`npx @brand/cli search
<concept>` if the CLI is available). Do not hand-roll tables, dialogs,
  chat bubbles, or KPI tiles.
- **Type is a role, not a size.** Use a `text-<role>` utility (`text-title`,
  `text-body`, `text-caption`, `text-display`, `text-kpi`, …) or the
  `<Heading>`/`<Text>` components. Never `text-2xl`, `text-sm`, or `text-[18px]`
  — raw sizes break the hierarchy and aren't theme-aware.
- **Semantic tokens only.** `bg-background`, `text-muted-foreground`,
  `bg-primary` (+ `text-primary-foreground`), `border-border`,
  `var(--chart-1..5)`. Never raw hex, `rgb()`, `bg-[#…]`, or a Tailwind palette
  (`text-gray-500`, `bg-red-500`). Re-theming must stay a token swap.
- **Don't touch the theme mechanism.** The app is themed via
  `<ThemeProvider defaultTheme="{theme}">` from `@brand/tokens`. To change
  look-and-feel, change tokens/theme — not component styles.
- **Keep the existing AppShell.** Extend the sidebar/nav in place; don't
  rebuild the shell.
- **Icons:** generic glyphs from `lucide-react`; brand marks from
  `@brand/icons`. No other icon libraries.
- **States:** every async surface gets loading (`Skeleton`), empty
  (`EmptyState`), and error (`ErrorState`) — never a blank region.
- **brand-ui is presentation-only.** Model calls, fetching, and transport
  live in this app's hooks/services — never inside shared UI components.
- **Lint after UI edits.** Run `pnpm lint`; `brand/no-raw-font-size` and
  `brand/no-raw-color` flag raw sizes/colours so the UI stays on-system.

## Wiring points

Unfinished spots are marked `WIRE:` in the source with the expected data
shape and pattern. `grep -rn "WIRE:" .` lists what's left. Wire them; don't
delete the guidance until each is wired.

## Composition reference

This archetype's recipe: {playbook-link} (building blocks, wiring order,
common mistakes). Follow it before inventing new structure.
```
