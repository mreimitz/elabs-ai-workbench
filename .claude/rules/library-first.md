# Library-first

**Every visible element comes from the `@brand/*` design system.** This is the soft-rationale
companion to the hard rule in [`brand-ui-only.md`](./brand-ui-only.md) (enforced by the
`enforce-brand-ui` hook). If it renders, it's a `@brand` component.

## Compose-first — reuse before writing markup

`@brand/ui` is large (Button, Input, Select, Textarea, Checkbox, Switch, RadioGroup, Card,
MetricCard, Table, Dialog/Sheet/Popover/Tooltip, Tabs, Wizard, EmptyState/ErrorState/LoadingState,
Alert, Badge/StatusBadge, Progress, AppShell/Sidebar/TopNav/PageShell/Breadcrumb, Heading/Text,
Descriptions, ChangeReview/Timeline, ThemeSwitcher, Toaster/toast, …); `@brand/data` owns tables.
Before writing markup, find the component:

1. Read `vendor/brand-ui-agent-kit/llms/ui.txt` / `data.txt` and the `playbooks/`.
2. Check exact props in the package `.d.ts` or `vendor/brand-ui-agent-kit/brand-ui.manifest.json`.
3. Compose with the component's **variants/props** + semantic tokens; `className` for layout only.

Small repeated app patterns live in `apps/web/src/components/` (e.g. `SelectField`, `TokenViz`) and
in `apps/web/src/lib/table.tsx` (`col` helper for `DataTable`) — these **compose `@brand` components**,
they don't replace them.

## When `@brand/*` is missing something

It's a **real upstream gap**, not a license to hand-roll. Options, in order: (1) compose it from
existing `@brand` primitives in `apps/web/src/components/`; (2) raise the gap with the owner to add
it to `@brand/*` upstream. Code/text display is via `@brand/editor` Monaco `CodeEditor` for interactive
editing and `features/testing/CodeSnippet.tsx` for read-only display — both compose `@brand` primitives
without hand-rolling.

## STOP and ask the owner before

1. Building a bespoke component a `@brand` one could cover, or overriding a component's
   colors/typography.
2. Adding any non-`@brand` UI dependency (another kit, a different icon set, a CSS framework).
3. Introducing raw colors / a second design system.
4. Swapping or bumping the vendored `@brand/*` version (see `dependencies.md`).
