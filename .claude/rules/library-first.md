# Library-first

**Every visible element comes from the `@elabs-ai/components-*` design system.** This is the soft-rationale
companion to the hard rule in [`brand-ui-only.md`](./brand-ui-only.md) (enforced by the
`enforce-brand-ui` hook). If it renders, it's a `@elabs-ai/components-*` component.

## Compose-first — reuse before writing markup

`@elabs-ai/components-ui` is large (Button, Input, Select, Textarea, Checkbox, Switch, RadioGroup, Card,
MetricCard, Table, Dialog/Sheet/Popover/Tooltip, Tabs, Wizard, EmptyState/ErrorState/LoadingState,
Alert, Badge/StatusBadge, Progress, AppShell/Sidebar/TopNav/PageShell/Breadcrumb, Heading/Text,
Descriptions, ChangeReview/Timeline, ThemeSwitcher, Toaster/toast, …); `@elabs-ai/components-data` owns tables.
Before writing markup, find the component:

1. `pnpm exec brand-ui search <thing>` — find the component / hook / archetype playbook.
2. `pnpm exec brand-ui docs <Component>` — its REAL props, read from source (or check the `.d.ts`).
3. Compose with the component's **variants/props** + semantic tokens; `className` for layout only.

Small repeated app patterns live in `apps/web/src/components/` (e.g. `SelectField`, `TokenViz`) and
in `apps/web/src/lib/table.tsx` (`col` helper for `DataTable`) — these **compose `@elabs-ai/components-*` components**,
they don't replace them.

## When `@elabs-ai/components-*` is missing something

It's a **real upstream gap**, not a license to hand-roll. Options, in order: (1) compose it from
existing `@elabs-ai/components-*` primitives in `apps/web/src/components/`; (2) raise the gap with the owner to add
it to `@elabs-ai/components-*` upstream. Code/text display is via `@elabs-ai/components-editor` Monaco `CodeEditor` for interactive
editing and `features/testing/CodeSnippet.tsx` for read-only display — both compose `@elabs-ai/components-*` primitives
without hand-rolling.

## STOP and ask the owner before

1. Building a bespoke component a `@elabs-ai/components-*` one could cover, or overriding a component's
   colors/typography.
2. Adding any non-`@elabs-ai/components-*` UI dependency (another kit, a different icon set, a CSS framework).
3. Introducing raw colors / a second design system.
4. Swapping or bumping the `@elabs-ai/components-*` version — they ship in lockstep, so it is all
   of them or none (see `dependencies.md`).
