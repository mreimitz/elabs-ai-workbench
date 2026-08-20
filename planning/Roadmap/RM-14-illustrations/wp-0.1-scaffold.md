---
type: "Work Package Spec"
title: "WP 0.1 - package scaffold, the --illus-* token layer, and the shared spec/registry contract"
description: "Phase 0 of 02-plan.md. Ledger: STATUS.md. Ships the workspace package, the one token mapping file, and the SceneSpec/RegistryEntry contract in packages/shared. Renders nothing."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-20T22:30:00Z"
status: "final"
---
# WP 0.1 — package scaffold + `--illus-*` token layer + shared spec/registry contract

Phase 0 of [`02-plan.md`](./02-plan.md). Ledger: [`STATUS.md`](./STATUS.md). Locked decisions:
[`decisions.md`](./decisions.md). Design detail: [`01-system-design.md`](./01-system-design.md)
§3–§4. Visual language: [`00-research.md`](./00-research.md) §3.1–§3.4.

**Depends on:** nothing.
**Consumed by:** WP 0.2 (every primitive imports `iso-math` types + the token names declared here),
WP 0.3 (the registry entries are typed here), WP 2.1 (fills in the full `SceneSpec`), and the API
(which validates scene specs from `packages/shared` without importing React, D-IL10).

This is a **foundation-only** WP. It ships a wired workspace package, one CSS mapping file, the
shared contract stubs and their tests. **It renders no illustration.** A reviewer should be able to
read the whole diff and see nothing that draws.

---

## Locked decisions this WP implements

- **D-IL3 / D-IL4** — React 19 + inline SVG, **zero new runtime dependency**. The package's only
  dependencies are the `react` peer and the workspace `@mcp-token-footprint/shared`. No canvas, no
  WebGL, no animation or icon library, no drawing helper.
- **D-IL5** — the `--illus-*` indirection layer. Components consume only `--illus-*`; **exactly one
  file** (`src/tokens.css`) binds them to `@elabs-ai/components-tokens` semantics. No color literal
  anywhere in the package, ever — face shading is derived with `color-mix(in oklch, …)`, never
  hand-picked.
- **D-IL9** — the registry is the single catalog, zod-typed, carrying `REGISTRY_VERSION`.
- **D-IL10** — the scene spec is the only composition path, and its types + zod live in
  `packages/shared`, not in the React package.
- **D-IL14** — `apps/api` never imports the illustrations package; only `apps/web` consumes it.
- **`.claude/rules/architecture.md`** — a wire shape is declared in `packages/shared` first, as a
  type **and** a zod schema.

## Scope

### 1. The workspace package

Create `packages/illustrations`, published in-workspace as `@mcp-token-footprint/illustrations`,
wired **exactly** like `packages/shared/package.json`:

- `"type": "module"`, `"private": true`, `"types": "./src/index.ts"`,
  `exports` with `types → ./src/*.ts` and `default → ./dist/*.js`.
- Own `build` (`tsc -p tsconfig.json`), `typecheck` (`--noEmit`) and `test` scripts. The root gate
  is `pnpm -r --sort typecheck|build` and `pnpm -r --if-present test`, so a correctly-wired package
  joins the gate with **no root `package.json` edit**. If a root edit turns out to be necessary,
  that is a finding to record, not a silent change.
- `react` as a **peer** dependency (`^19`), `@mcp-token-footprint/shared` as `workspace:*`.
- `tsconfig.json` matching `packages/shared`'s strict settings (`NodeNext`, strict,
  `noUncheckedIndexedAccess`) plus `jsx: "react-jsx"`.
- Test runner: the same `tsx --test` node-runner the other non-web packages use, so the package's
  tests appear in `pnpm test` output. Tests are co-located `*.test.ts(x)`.

### 2. `src/tokens.css` — the one mapping file

Implements the research §3.4 table verbatim. **Verified against the installed
`@elabs-ai/components-tokens@4.0.0` light theme: all thirteen upstream tokens below exist**, so
there is no upstream gap to raise and no fallback chain to write:

| `--illus-*` | bound to |
| --- | --- |
| `--illus-paper` | `--background` |
| `--illus-grid` | `--grid-line` |
| `--illus-grid-major` | `--grid-line-major` |
| `--illus-ink` | `--foreground` |
| `--illus-ink-muted` | `--muted-foreground` |
| `--illus-guide` | `--rule` |
| `--illus-surface` | `--card` |
| `--illus-surface-sunken` | `--surface-muted` |
| `--illus-accent` | `--primary` |
| `--illus-accent-contrast` | `--primary-foreground` |
| `--illus-accent-2` | `--chart-3` |
| `--illus-ok` / `--illus-warn` / `--illus-error` | `--success` / `--warning` / `--destructive` |
| `--illus-shadow` | `--foreground` at ~7% alpha |

Plus the three derived faces (research §3.3), tuned to hit the **top ≈ 100% / left ≈ 75–80% /
right ≈ 55–60%** ratios with a **≥ 20% adjacent-face lightness separation floor**:

```css
--illus-face-top:   var(--illus-surface);
--illus-face-left:  color-mix(in oklch, var(--illus-surface), var(--illus-ink) 12%);
--illus-face-right: color-mix(in oklch, var(--illus-surface), var(--illus-ink) 24%);
```

The mix percentages may be re-tuned **per theme inside this file** if the ratios miss — that is the
sanctioned place, and the only one. WP 0.2 adds the dev-mode assertion that measures the resolved
separation; this WP only declares the tokens.

### 3. The shared contract (`packages/shared`)

Two new modules, exported from `packages/shared/src/index.ts`:

- `illustration-registry.ts` — `RegistryEntry` type + `.strict()` zod schema exactly as
  [`01-system-design.md`](./01-system-design.md) §3 specifies (`id`, `title`, `entity`, `tier`,
  `keywords`, `variants`, `states`, `ports`, `sizes`, `since`, `description`), plus the closed
  vocabularies of **D-IL8**: entity states (`idle · active · highlight · dimmed · error`), connector
  kinds (`flow · read · write · publish · loop · signal`), sizes (`s · m · l`), and
  `REGISTRY_VERSION`.
- `illustration-scene.ts` — `SceneSpec` **stub**: `version`, `registryVersion`, `id`, required
  `title` + `summary` (a11y is schema-enforced, D-IL10), `canvas`, and permissive-but-typed
  `bands`/`nodes`/`connectors`/`annotations`/`steps` arrays. **WP 2.1 tightens this**; 0.1 only
  fixes the envelope so nothing downstream invents a second one. Record in the spec's doc comment
  that the loose arrays are deliberate and whose job it is to close them.

Neither module imports React, `node:*`, or anything but `zod`.

### 4. Web wiring

- `apps/web/package.json` gains the workspace dependency.
- `apps/web/src/styles/app.css` gains `@import "@mcp-token-footprint/illustrations/tokens.css";`
  **after** the two theme imports (it consumes theme variables, so it must resolve later), and — only
  if the package ships className strings — a matching `@source` line beside the existing seven. A
  missing `@source` renders a package unstyled with no error, so state in the done-line which of the
  two applies and why.

## Out of scope (explicitly)

Any primitive, any entity, any route, any registry **entry**, any rendering. `iso-math.ts` itself is
WP 0.2 — this WP may declare its *types* only if WP 0.2 would otherwise duplicate them.

## Acceptance

1. `pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root.
2. `pnpm test` output **names the new package** — proof it joined the gate, not just that the command
   exited 0. Quote the line in the done-line.
3. `grep -rniE '#[0-9a-f]{3,8}\b|rgb\(|hsl\(' packages/illustrations/src` returns nothing (D-IL5).
4. The package builds standalone: `pnpm --filter @mcp-token-footprint/illustrations build`.
5. Zod round-trip tests: a valid `RegistryEntry` and a valid `SceneSpec` parse; an unknown key,
   an unknown state and an unknown connector kind each **fail** (`.strict()`, closed sets).
6. **Teeth check, performed and reported:** delete one closed-set member from the zod enum and watch
   a test go red; restore it. A guard that was never seen failing is not verified.
7. Nothing under `apps/api/` imports the new package (D-IL14) — assert by grep in the done-line.

## Ledger

Tick WP 0.1 in [`STATUS.md`](./STATUS.md) with the branch, the gate result, deviations, and an
explicit **"Not verified:"** tail. No front-page (`README.md`/`CHANGELOG.md`) update yet — nothing
user-visible ships until WP 0.3.
