# Dependencies

A **pnpm workspace** (`pnpm@9.15.4`); packages are `apps/*` and `packages/*`, wired with
`workspace:*`. Not npm/yarn; no Tauri.

## The `@elabs-ai/components-*` design system (public npm, ACTIVE)

The app's UI is the upstream **`@elabs-ai/components-*`** design system (brand-ui) at **`^4.0.0`**,
installed from **public npmjs.org** and listed in `apps/web/package.json`:

- `@elabs-ai/components-tokens` — themes + `ThemeProvider`/`useTheme` + `styles.css` (Tailwind v4 token entry).
- `@elabs-ai/components-ui` — all components (Radix + class-variance-authority based). `cn` via `@elabs-ai/components-ui`.
- `@elabs-ai/components-icons` — brand glyphs + `BrandLogo`.
- `@elabs-ai/components-data` — `DataTable`, `SearchInput`, `FilterBar`, `FacetFilter`, `ColumnPicker`.
- `@elabs-ai/components-charts`, `-ai`, `-flow`, `-editor` — also installed and in use.

`@elabs-ai/components-editor` provides the Monaco `CodeEditor` used for the tool-run result viewer —
its web workers are wired by importing `@elabs-ai/components-editor/monaco-environment` once in
`apps/web/src/main.tsx` (Vite `?worker`). Bundling Monaco + Milkdown + Mermaid makes the web build
memory-hungry: on a constrained machine run the build with `NODE_OPTIONS=--max-old-space-size=3400`
(not needed on a typical dev box). Compact token visualizations are still built from
`@elabs-ai/components-ui` (see `apps/web/src/components/TokenViz.tsx`).

`@elabs-ai/components-marketing`, `-maps` and `-viewer` are published but unused here. To adopt one,
add the dep at the same major, install its own peers (below), and add a matching `@source` line in
`app.css` (owner-approved). **There is no `-blueprint` package** — it was removed in v4 with no
replacement; for a drafting/reprographic look use the decoration dial (`data-decoration="0..10"`,
`<DecorationProvider>`, `useDecoration()`).

### Registry & auth

The packages are **public**. Install is anonymous: no `.npmrc` scope line, no `_authToken`, no CI
token. Do not reintroduce one — the only reason to add an `@elabs-ai:registry=` line would be a
private mirror.

### Peers the app owns itself

Each of these owns a global or a React context, so a second copy breaks at runtime. They are direct
deps of `apps/web` on purpose, not transitive:

| Peer | Why |
| --- | --- |
| `monaco-editor` `^0.55.1` | peer of `-editor` (was a plain dependency pre-v4) |
| `@xyflow/react` `^12.11.1` | peer of `-flow` and the `-ai` canvas |
| `ai` `^6.0.0` | peer of `-ai` (npm resolves 6.0.256) |
| `tailwindcss` `^4` | peer of `-tokens`; must be the SAME instance that processes the token CSS |

Note `apps/api` depends on `ai@^7` for the run engine. That is a different workspace package and a
different runtime (Node process vs browser bundle), so the two never share a module instance —
but do not "unify" them without checking both peer ranges.

All packages are **ESM-only**. React `^18.2 || ^19`; this app is on 19.

### Version discipline

Every package ships **in lockstep** — do not mix majors. Build glue: **Tailwind v4** via
`@tailwindcss/vite` + `tw-animate-css` (web devDeps). `@elabs-ai/components-tokens/styles.css` is the
**engine only** (`@import "tailwindcss"` + the `:root` base + the `@theme` bridge); since v4 each
theme is a **separate, opt-in stylesheet** that `apps/web/src/styles/app.css` imports explicitly —
see `styling-and-tokens.md`. `app.css` also carries the `@source` directives so Tailwind scans the
`@elabs-ai/components-*` dist.

`@elabs-ai/components-charts` pulls in `@visx/*`, which declare React 16–18 peer ranges; React 19
satisfies them in practice — pnpm prints a peer warning, not an error. `@elabs-ai/components-ai` also
pulls in `@xterm/xterm` + `@xterm/addon-fit` (for `InteractiveTerminal`) and `zod` as runtime deps.

## Ground truth for component APIs — never guess

The **`@elabs-ai/components-cli`** is a root devDependency. It is the anti-hallucination source:

```bash
pnpm exec brand-ui info             # packages, themes, tokens, registry, rules
pnpm exec brand-ui search <thing>   # find a component / hook / playbook
pnpm exec brand-ui docs <Component> # REAL props, read from source
pnpm exec brand-ui audit src/       # static token/style lint (--strict to gate)
```

It also ships a persistent **MCP server** (`brand-ui mcp`, stdio; tools `info`/`search`/`docs`/
`tokens`/`audit`), registered for this repo in `.mcp.json`. If `docs` lists anti-patterns for a
component, follow them.

A generated, portable snapshot lives at [`docs/brand-ui-context.md`](../../docs/brand-ui-context.md)
— regenerate with `pnpm exec brand-ui context` (it writes `apps/docs/public/`; move the file back to
`docs/`). The snapshot is a convenience; `brand-ui docs` is the authority.

> The old `vendor/brand-ui-agent-kit/` bundle was **deleted** in the v4 migration. It was pinned to
> v1.9.0 — wrong scope, wrong theme names, wrong component APIs — so it had become actively
> misleading. Use the CLI/MCP server instead.

## Updating `@elabs-ai/components-*` (owner-gated)

Bump every `@elabs-ai/components-*` dep to the same version together, re-run install + build + tests,
and re-check the peer table above (a minor can promote a dependency to a peer, as v4 did for
`monaco-editor`). A version bump needs owner approval before commit.

## Retired local adapter (removed)

`packages/brand-ui` was a temporary hand-rolled adapter. It was retired and has now been
**deleted** — the app runs directly on the `@elabs-ai/components-*` packages. Do not import from
`@mcp-token-footprint/brand-ui` (the `enforce-brand-ui` hook still blocks it).

## Adding dependencies — STOP and ask the owner before

1. Any **new UI dependency** (another component kit, a CSS framework, an icon set other than
   `lucide-react`/`@elabs-ai/components-icons`). UI comes from `@elabs-ai/components-*` — see `brand-ui-only.md`.
2. A **state/data library** — the app uses `useState` + `localStorage` + `fetch` for state.
   Navigation is via `react-router-dom` v7 (sanctioned, adopted dep).
3. Anything paid, or a large tree for a small need.

## Icons

`lucide-react` for generic glyphs (single version, aligned with `@elabs-ai/components-ui`); `@elabs-ai/components-icons` for
brand glyphs + `BrandLogo`. No other icon library.
