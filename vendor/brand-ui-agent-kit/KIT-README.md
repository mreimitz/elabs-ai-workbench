# brand-ui agent kit — v1.9.0

The coding-agent layer for the brand-ui design system, pinned to the `@brand/*`
v1.9.0 packages. Install it so your AI coding agent knows **what brand-ui
offers and how to compose it** — instead of guessing component names and props.

Pairs with the released package tarballs — see `docs/CONSUMING.md` in the repo
for installing the `@brand/*` packages themselves.

## Contents

- `skills/` — the consumer-facing skills (`brand-ui` build/compose, plus
  `brand-ui-audit`, `brand-ui-theme`, `brand-ui-new-app`, and
  `brand-ui-enterprise` (enterprise design-judgment layer)).
- `playbooks/` — whole-screen recipes (dashboard, ai-assistant, data-app, …).
- `brand-ui.manifest.json` — machine-readable inventory: every component, its
  variants, intent and (where resolved) props, plus tokens, themes, registry.
- `llms.txt` + `llms/<pkg>.txt` — portable agent docs for tools that
  auto-discover `llms.txt` (Cursor, Copilot, Claude Projects).

## Install (Claude Code)

Either install the plugin (live, repo-backed):

```
/plugin marketplace add mreimitz/qlabs-components
```

…or vendor this pinned kit into your project: copy `skills/` into your repo's
`.claude/skills/` and keep `playbooks/` + `brand-ui.manifest.json` +
`llms.txt` alongside them.

Then install the CLI so the skills' `brand-ui` commands work in your project:

```
# add @brand/cli from the release (see docs/CONSUMING.md), then:
npx brand-ui info            # themes, tokens, installed @brand/* packages
npx brand-ui search <query>  # find a component / hook / registry item
npx brand-ui docs <Name>     # real props + intent for a component
```

The CLI reads the manifest bundled inside `@brand/cli`, so `search`/`docs`
work with no monorepo present. (`docs` omits the raw source snippet outside the
monorepo; the resolved props + intent come from the manifest.)

## Other harnesses (Cursor / Copilot / Gemini)

Point the tool at `llms.txt` (and the per-package `llms/<pkg>.txt`), or drop
`skills/` into the harness's skills directory.

## Note

`brand-ui.manifest.json` records each component's `module` as a path in
brand-ui's own source tree (e.g. `packages/ui/src/...`) — informational, a
pointer into the upstream repo, not a path in your project.
