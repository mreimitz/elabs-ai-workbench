# brand-ui only — UNBREAKABLE

> **Hard rule, no exceptions without owner sign-off.** Every visible element in this app is a
> component from the upstream **`@brand/*`** design system (brand-ui). We do **not** hand-roll UI,
> we do **not** add a second component kit, and we do **not** style with raw colors. This is
> enforced by the `enforce-brand-ui` hook (see `.claude/hooks/enforce-brand-ui.mjs`) and the
> `brand-ui audit` pass.

## The packages (vendored at `vendor/brand/`, see `dependencies.md`)

- **`@brand/ui`** — all foundation + app UI: Button, Input, Select, Textarea, Checkbox, Switch,
  RadioGroup, Form*, Card*, MetricCard, Table*, Dialog/Sheet/Popover/Tooltip, Tabs, Wizard*,
  EmptyState/ErrorState/LoadingState/StatePanel/Skeleton/Spinner, Alert, Badge/StatusBadge,
  Progress, AppShell/AppSidebar/Sidebar*/NavMain/TopNav/PageShell/Breadcrumb*, Heading/Text,
  Descriptions*, ChangeReview*/Timeline*, ThemeSwitcher, Toaster/toast, `cn`.
- **`@brand/data`** — `DataTable` (TanStack, virtualized), `SearchInput`, `FilterBar`,
  `FacetFilter`, `ColumnPicker`, and `ColumnDef` (re-export). Use for any sortable/filterable table.
- **`@brand/icons`** — brand glyphs + `BrandLogo`. Generic glyphs: `lucide-react` (the only other
  icon source allowed).
- **`@brand/tokens`** — `ThemeProvider`, `useTheme`, `THEMES`/`THEME_META`, and `styles.css`
  (the Tailwind v4 token entry). The app exposes 2 themes (`qlik-bright` default + `qlik-dark`);
  the shipped `blueprint` theme is filtered out (see `apps/web/src/lib/theme.ts`).

Authoritative usage reference is vendored at **`vendor/brand-ui-agent-kit/`** (manifest, `llms/`,
`playbooks/`, `skills/`). Check it / the `.d.ts` for real props — never guess a prop.

## Forbidden (the hook blocks these in `apps/web/src`)

- **Raw interactive / component HTML** when a `@brand` component exists:
  `<button>`→`Button`, `<input>`→`Input`/`NumberInput`/`Checkbox`/`Switch`, `<select>`→`Select`,
  `<textarea>`→`Textarea`, `<table>`/`<tr>`/`<td>`…→`DataTable`/`Table*`, `<dialog>`→`Dialog`/`Sheet`.
- **Bespoke components** that duplicate a `@brand` one (no hand-rolled tables, dialogs, KPI tiles,
  toasts, dropdowns, wizards).
- **Imports from the retired local adapter** `@mcp-token-footprint/brand-ui`.
- **Raw colors** (`#hex`, `rgb()/hsl()`, `bg-[#…]`, `*-black`/`*-white` literals, Tailwind palette
  colors like `text-gray-500`) anywhere but `@brand/tokens` themes. Use semantic tokens.
- **A second UI/styling system** (another kit, CSS-in-JS, a non-`@brand` Tailwind theme).

## Allowed

- Raw **layout/structure** elements with no `@brand` equivalent: `<div>`, `<span>`, `<section>`,
  `<header>`, `<main>`, `<ul>/<li>`, `<form>` — for composition only, styled with **semantic
  token utilities** (`bg-card`, `text-muted-foreground`, `gap-4`, `grid`, …). Prefer
  `Heading`/`Text` over raw `<h1>`/`<p>` and `PageShell`/`Card` over ad-hoc containers.
- Real `<a>` for navigation; for a link that looks like a button use `<Button asChild><a …/></Button>`.
- `className` for **layout only** — never to recolor/retypeset a component (use its `variant`/`size`).

## Required at the app root (providers)

`ThemeProvider` (`@brand/tokens`, `defaultTheme="qlik-bright"`) → `TooltipProvider` →
`SidebarProvider` → app; mount `<Toaster />` once inside. `LocaleProvider` only if using
`t()`/locale formatting. See `vendor/brand-ui-agent-kit/skills/brand-ui/reference/theming.md`.

## Escape hatch (rare, owner-gated)

If a genuine gap forces a raw element, put `brand-ui-allow: <reason>` in a comment on that line so
the hook skips it, and raise it with the owner — a real gap should become a `@brand` component
upstream, not a permanent local exception.
