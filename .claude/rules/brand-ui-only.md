# brand-ui only — UNBREAKABLE

> **Hard rule, no exceptions without owner sign-off.** Every visible element in this app is a
> component from the upstream **`@elabs-ai/components-*`** design system (brand-ui). We do **not** hand-roll UI,
> we do **not** add a second component kit, and we do **not** style with raw colors. This is
> enforced by the `enforce-brand-ui` hook (see `.claude/hooks/enforce-brand-ui.mjs`) and the
> `brand-ui audit` pass.

## The packages (public npm, `^4.0.0` lockstep — see `dependencies.md`)

- **`@elabs-ai/components-ui`** — all foundation + app UI: Button, Input, Select, Textarea, Checkbox, Switch,
  RadioGroup, Form*, Card*, MetricCard, Table*, Dialog/Sheet/Popover/Tooltip, Tabs, Wizard*,
  EmptyState/ErrorState/LoadingState/StatePanel/Skeleton/Spinner, Alert, Badge/StatusBadge,
  Progress, AppShell/AppSidebar/Sidebar*/NavMain/TopNav/PageShell/Breadcrumb*, Heading/Text,
  Descriptions*, ChangeReview*/Timeline*, ThemeSwitcher, Toaster/toast, `cn`.
- **`@elabs-ai/components-data`** — `DataTable` (TanStack, virtualized), `SearchInput`, `FilterBar`,
  `FacetFilter`, `ColumnPicker`, and `ColumnDef` (re-export). Use for any sortable/filterable table.
- **`@elabs-ai/components-icons`** — brand glyphs + `BrandLogo`. Generic glyphs: `lucide-react` (the only other
  icon source allowed).
- **`@elabs-ai/components-tokens`** — `ThemeProvider`, `useTheme`, `THEMES`/`THEME_META`, and `styles.css`
  (the Tailwind v4 token entry). The app exposes 2 themes (`light` default + `dark`);
  `light` (default) and `dark` are the only themes the library ships. `ThemeName` is `string`,
  not a union — narrow with `isBuiltInThemeName` or `useTheme().themes`, never a bare literal.

Authoritative usage reference is the **CLI** — `pnpm exec brand-ui docs <Component>` prints the real
props read from source (also `info`, `search`, `audit`), and the same engine is registered as an MCP
server in `.mcp.json`. Check it or the `.d.ts` for real props — **never guess a prop, never trust
memory**. If `docs` lists anti-patterns for a component, follow them. A generated snapshot lives at
[`docs/brand-ui-context.md`](../../docs/brand-ui-context.md).

## Forbidden (the hook blocks these in `apps/web/src`)

- **Raw interactive / component HTML** when a `@elabs-ai/components-*` component exists:
  `<button>`→`Button`, `<input>`→`Input`/`NumberInput`/`Checkbox`/`Switch`, `<select>`→`Select`,
  `<textarea>`→`Textarea`, `<table>`/`<tr>`/`<td>`…→`DataTable`/`Table*`, `<dialog>`→`Dialog`/`Sheet`.
- **Bespoke components** that duplicate a `@elabs-ai/components-*` one (no hand-rolled tables, dialogs, KPI tiles,
  toasts, dropdowns, wizards).
- **Imports from the retired local adapter** `@mcp-token-footprint/brand-ui`.
- **Raw colors** (`#hex`, `rgb()/hsl()`, `bg-[#…]`, `*-black`/`*-white` literals, Tailwind palette
  colors like `text-gray-500`) anywhere but `@elabs-ai/components-tokens` themes. Use semantic tokens.
- **A second UI/styling system** (another kit, CSS-in-JS, a non-`@elabs-ai/components-*` Tailwind theme).

## Allowed

- Raw **layout/structure** elements with no `@elabs-ai/components-*` equivalent: `<div>`, `<span>`, `<section>`,
  `<header>`, `<main>`, `<ul>/<li>`, `<form>` — for composition only, styled with **semantic
  token utilities** (`bg-card`, `text-muted-foreground`, `gap-4`, `grid`, …). Prefer
  `Heading`/`Text` over raw `<h1>`/`<p>` and `PageShell`/`Card` over ad-hoc containers.
- Real `<a>` for navigation; for a link that looks like a button use `<Button asChild><a …/></Button>`.
- `className` for **layout only** — never to recolor/retypeset a component (use its `variant`/`size`).

## Required at the app root (providers)

`ThemeProvider` (`@elabs-ai/components-tokens`, `defaultTheme="light"`) → `TooltipProvider` →
`SidebarProvider` → app; mount `<Toaster />` once inside. `LocaleProvider` only if using
`t()`/locale formatting. See `.claude/rules/styling-and-tokens.md` for the theme wiring (theme CSS
is opt-in per theme since v4).

## Escape hatch (rare, owner-gated)

If a genuine gap forces a raw element, put `brand-ui-allow: <reason>` in a comment on that line so
the hook skips it, and raise it with the owner — a real gap should become a `@elabs-ai/components-*` component
upstream, not a permanent local exception.
