# Dependencies

A **pnpm workspace** (`pnpm@9.15.4`); packages are `apps/*` and `packages/*`, wired with
`workspace:*`. Not npm/yarn; no Tauri.

## The `@brand/*` design system (vendored, ACTIVE)

The app's UI is the upstream **`@brand/*`** design system (brand-ui) v1.9.0, vendored as GitHub
Release tarballs under **`vendor/brand/`** and referenced from `apps/web/package.json` via `file:`:

- `@brand/tokens` — themes + `ThemeProvider`/`useTheme` + `styles.css` (Tailwind v4 token entry).
- `@brand/ui` — all components (Radix + class-variance-authority based). `cn` via `@brand/ui`.
- `@brand/icons` — brand glyphs + `BrandLogo`.
- `@brand/data` — `DataTable`, `SearchInput`, `FilterBar`, `FacetFilter`, `ColumnPicker`.

`@brand/charts`, `@brand/ai`, `@brand/flow`, `@brand/editor` are **also vendored** (v1.9.0 tarballs in
`vendor/brand/`, wired via `file:` in `apps/web/package.json`). `@brand/editor` provides the Monaco
`CodeEditor` used for the tool-run result viewer — its web workers are wired by importing
`@brand/editor/monaco-environment` once in `apps/web/src/main.tsx` (Vite `?worker`). Bundling Monaco +
Milkdown + Mermaid makes the web build memory-hungry: on a constrained machine run the build with
`NODE_OPTIONS=--max-old-space-size=3400` (not needed on a typical dev box). Compact token
visualizations are still built from `@brand/ui` (see `apps/web/src/components/TokenViz.tsx`).

`@brand/marketing` and `@brand/blueprint` exist upstream but are **not vendored**. To use another
`@brand/*` package, add its tarball to `vendor/brand/`, wire the `file:` dep, and add a matching
`@source` line in `app.css` (owner-approved).

Build glue: **Tailwind v4** via `@tailwindcss/vite` + `tw-animate-css` (web devDeps). The token CSS
(`@brand/tokens/styles.css`) carries `@import "tailwindcss"` + the per-theme `[data-theme]` blocks + the
`@theme` bridge; `apps/web/src/styles/app.css` adds `@source` directives so Tailwind scans the
`@brand/*` dist. React stays a single **v19** copy — @brand/* v1.9.0 targets React 19 (it uses React-19-only APIs such as `use()` and context-as-provider). (`@brand/charts` v1.9.0 ships the interactive Gantt v2 that pulls in `@visx/*`, which declare React 16–18 peer ranges; React 19 satisfies them in practice — pnpm prints a peer warning, not an error.) `@brand/ai` v1.9.0 also pulls in `@xterm/xterm` + `@xterm/addon-fit` (for `InteractiveTerminal`) and `zod` as runtime deps; `@brand/flow` v1.9.0 depends on `@xyflow/react` `^12.11.1`, so the web app's direct `@xyflow/react` pin is `^12.11.1` to keep a single copy.

The coding-agent reference (manifest, `llms/`, `playbooks/`, `skills/`) is vendored at
**`vendor/brand-ui-agent-kit/`** (v1.9.0) — consult it (or the `.d.ts`) for real props; never guess.
The **`@brand/cli`** is vendored too (`vendor/brand/brand-cli-1.9.0.tgz`, a root devDependency); run
`pnpm exec brand-ui <info|search|docs>` for the live component API instead of reading the manifest by hand.
v1.9.0 of `@brand/cli` also ships a persistent **brand-ui MCP server** (`brand-ui mcp`, stdio; tools
`info`/`search`/`docs`/`tokens`/`audit`) registered for this repo in `.mcp.json` — the anti-hallucination
ground truth for component APIs/tokens (works with no Storybook). (The agent-kit bundle at
`vendor/brand-ui-agent-kit/` was updated to v1.9.0 alongside the components, so kit and installed
version are in lockstep.)

## Updating `@brand/*` (owner-gated)

Updating means swapping the tarballs in `vendor/brand/`, re-pinning the `file:` versions, and
re-running install + build + tests. A version bump needs owner approval before commit.

## Retired local adapter (removed)

`packages/brand-ui` was a temporary hand-rolled adapter. It was retired and has now been
**deleted** — the app runs directly on the vendored `@brand/*` packages. Do not import from
`@mcp-token-footprint/brand-ui` (the `enforce-brand-ui` hook still blocks it). Any historical
provenance now lives in `vendor/brand/PROVENANCE.md`.

## Adding dependencies — STOP and ask the owner before

1. Any **new UI dependency** (another component kit, a CSS framework, an icon set other than
   `lucide-react`/`@brand/icons`). UI comes from `@brand/*` — see `brand-ui-only.md`.
2. A **state/data library** — the app uses `useState` + `localStorage` + `fetch` for state.
   Navigation is via `react-router-dom` v7 (sanctioned, adopted dep).
3. Anything paid, or a large tree for a small need.

## Icons

`lucide-react` for generic glyphs (single version, aligned with `@brand/ui`); `@brand/icons` for
brand glyphs + `BrandLogo`. No other icon library.
