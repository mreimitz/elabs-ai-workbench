# Scaffold step — enforce the taxonomy (`brand/no-raw-*`)

Every scaffolded app must enforce "type is a role, colour is a token" at the
agent's point of action — not just ask for it in prose. Two minutes of wiring:

## 1 · Dependency

Add to the app's `package.json` devDependencies (then install):

```
"@brand/eslint-config": "workspace:*",
"eslint": "^9"
```

## 2 · `eslint.config.js` (app root)

The shared config ships `brand/no-raw-font-size` + `brand/no-raw-color` at
`warn`. A freshly scaffolded app starts clean, so bump them to **`error`** so
the lint _blocks_ raw sizes/colours instead of just warning:

```js
import { reactConfig } from "@brand/eslint-config/react";

export default [
  ...reactConfig,
  {
    rules: {
      "brand/no-raw-font-size": "error",
      "brand/no-raw-color": "error",
    },
  },
];
```

(A Storybook app also adds `eslint-plugin-storybook`; the two brand rules sit on
top either way.)

## 3 · `package.json` script

```
"lint": "eslint ."
```

## What the rules catch

- **`brand/no-raw-font-size`** — `text-2xl`, `text-[18px]` → use a `text-<role>`
  utility (display / title / subtitle / body / caption / meta / kpi) or a
  `<Heading>` / `<Text>` component.
- **`brand/no-raw-color`** — `text-gray-500`, `bg-[#fff]` → use a semantic token
  (`text-foreground`, `text-muted-foreground`, `bg-primary` +
  `text-primary-foreground`, `bg-success/10`, `border-border`, …).

These run on every `pnpm lint` + in CI — **agent-independent**. The brand-ui
plugin also ships a PostToolUse hook (`hooks/check-raw-taxonomy.mjs`) that
surfaces the same findings **inside the agent's edit loop**, so violations are
fixed in the same turn. One set of patterns, three surfaces; judgment calls
(which role? does the hierarchy read?) stay with the `brand-ui-audit` review.
