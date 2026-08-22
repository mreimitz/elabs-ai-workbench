---
type: "Work Package Spec"
title: "WP 0.2 — One product name, one version source, licence and distribution decision, Node pin"
description: "Phase 0 of item.md. Ledger: STATUS.md. Owner decisions on product name, machine handle, licence, distribution model and release number; one build-time version that /api/health, Settings › About, the sidebar footer and the bundle tag all report; the 19 Unreleased changelog sections collapsed into one tagged release; a Node ≥ 22.9 pin; 'Local / dev mode' removed from the shell."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 0.2 — One product name, one version source, licence and distribution decision, Node pin

Phase 0 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Files: `README.md:1-8` (H1 + the "two names" paragraph) and `:498-511` (Local development), the five
`package.json` files (root `name: mcp-token-footprint`, `version: 1.1.0`; `apps/api`, `apps/web`,
`apps/cli`, `packages/shared` at `0.1.0`, none with `license` or `engines`), `apps/cli/package.json:6-7`
(`mcpfp` bin), `scripts/release.sh:42` (`IMAGE_NAME`), `:83-91` (version from root `package.json`) and
`:182-186` (recipient README titled "MCP Token Footprint"), `CHANGELOG.md` (19 "Unreleased" headings
above `## 0.2.0 — 2026-07-02`), `ROADMAP.md:1`, `apps/api/src/config/env.ts:133`
(`npm_package_version ?? "0.1.0"` — always the fallback inside Docker), `apps/api/scripts/copy-data.mjs`,
`apps/api/src/index.ts:1420-1431` (`/api/health`), `apps/web/src/features/settings/SettingsView.tsx:1173-1190`
(About), `apps/web/src/components/AppShell.tsx:582-601` (brand lockup) and `:785` ("Local / dev mode"),
`apps/web/index.html:7`, the absent `LICENSE` and `.nvmrc`, `planning/Roadmap/completed/RM-19-release/item.md:24-26`.
Out of scope: proving the launchers and cold starts (WP 0.3), `release.yml`, build-from-HEAD and the
dirty-tree check (WP 0.6), README claims and screenshots (WP 0.7), the diagnostics panel (WP 1.4).

## Actions

1. **Owner decision needed:** the product name. Options: (a) "AI Workbench" (today's README H1,
   `<title>`, lockup) — a third-party product of the same name exists (MK-02); (b) a new name that
   carries the category; (c) "MCP Token Footprint" (today's package, image and changelog name). — P0
2. **Owner decision needed:** the machine handle. Options: (a) keep `mcpfp` (CLI bin, token prefix
   `mcpfp_` in `apps/api/src/api-tokens/guard.ts:186`, gate file `mcpfp.assert.json` in
   `examples/github-actions/`); (b) a handle derived from the product name. The prefix and the gate-file
   name become contracts in other people's repositories, so decide before the first external token. — P0
3. **Owner decision needed:** licence and distribution model. Options: (a) public repository under an
   OSI licence (Apache-2.0 or MIT) with `docker compose up --build` as the install path; (b) public
   repository under a source-available licence; (c) private repository, bundle-only, with a written
   licence/EULA in the bundle folder. In every option: add `LICENSE` at the repo root, a `"license"` field
   in all five `package.json` files, one sentence in README §Run it, and the licence name in the
   recipient README heredoc (`scripts/release.sh:182-186`). — P0
4. Apply the name everywhere a user reads it: `scripts/release.sh:42` `IMAGE_NAME` → the handle;
   `:182-186` recipient README H1; `CHANGELOG.md:1-3` title; `ROADMAP.md:1` H1; `README.md:6-8` drops the
   "two names refer to the same thing" paragraph; `/api/health.service` (`index.ts:1424`); `AppShell.tsx:582-601`
   lockup and `index.html:7` `<title>` show the product name once; `docker-compose.yml` service/image/volume
   names follow the handle (volume rename = data migration note in the recipient README). The package scope
   `@mcp-token-footprint/*` is renamed in a separate follow-up commit (M), not in Phase 0. — P1
5. One version source: root `package.json` is the only version. `Dockerfile` takes `ARG APP_VERSION`
   (passed by `release.sh` and `docker-compose.yml` `build.args`) or `apps/api/scripts/copy-data.mjs` writes
   `dist/version.json` at build; `config/env.ts:133` reads it, then `npm_package_version`, then
   `"0.0.0-dev"` — never a fixed `"0.1.0"`; `/api/health.version` and About (`SettingsView.tsx:1177`) show
   it; the web bundle shows the same value via `import.meta.env.VITE_APP_VERSION`; `apps/*/package.json`
   versions mirror root through one bump script. — P0
6. **Owner decision needed:** the release number. Options: (a) `0.3.0` (continues `0.2.0`; a heading
   `## Unreleased (0.3.0)` already exists at `CHANGELOG.md:603`); (b) `1.0.0`/`1.1.0` (matches root
   `package.json`). Then collapse the 19 "Unreleased" sections (`CHANGELOG.md:8-734`) into one dated entry,
   replace the "versioned loosely" sentence (`CHANGELOG.md:3-6`) with the rule from action 5, create
   `git tag v<n>`, and make `scripts/release.sh` refuse an untagged HEAD unless `--untagged` is passed. — P1
7. Node pin: root `package.json` gets `"engines": { "node": ">=22.9" }` (the `--env-file-if-exists`
   flags in `apps/api/package.json:8-9` need it) and `"packageManager": "pnpm@9.15.4"`; add `.nvmrc`
   with `22`; README "Local development" (`README.md:498`) opens with "Node 22 LTS (≥ 22.9) and
   `corepack enable`"; a `preinstall` script prints that sentence and exits 1 on an older Node. — P1
8. Shell footer `AppShell.tsx:785`: "Local / dev mode" → "v<version> · Local"; the words "dev mode"
   render only when `import.meta.env.DEV`; About "App version" shows the version or "unknown", never
   "n/a". — P1
9. Top-bar theme menu gains "Comfortable / Compact" density, bound to the same `useTheme().setDensity`
   as Settings › General (`SettingsView.tsx:840-877`). — P2
10. CLI distribution, after action 3: bundle-only → `pnpm pack` of `apps/cli` into `dist/release/v<n>/`
    and `run.sh` prints the `npx <handle> …` line; public repository → publish the CLI under the chosen
    handle, or README states it is repo-local (`node apps/cli/dist/index.js`). — P2
11. Planning truth-up: `planning/Roadmap/completed/RM-19-release/item.md:26` "Verify a cold start on a
    clean machine" is unticked or annotated "ticked at retirement; performed in RM-37 WP 0.3"; README
    `:495-496` keeps "Not yet proven end to end" until WP 0.3 records the runs. — P2
12. Maintainer docs: add `CONTRIBUTING.md` (one page: Node version, the four-command gate, where tests
    go, how to add a migration); split `CLAUDE.md` into a ≤ 150-line working-rules file plus a generated
    `CAPABILITIES.md` built from the `planning/Roadmap/*/STATUS.md` ledgers. — P2
13. After action 3, correct `planning/Research/RS-05-langfuse-landscape/notes/02-alternatives-landscape.md:283`
    ("source-open repo") and `topic.md:115` ("cleaner license story") to the decided licence. — P2

## Acceptance

- [ ] `LICENSE` exists; `grep -L '"license"' package.json apps/*/package.json packages/*/package.json`
      prints nothing; README §Run it names the licence.
- [ ] `grep -rn "MCP Token Footprint\|mcp-token-footprint" README.md CHANGELOG.md ROADMAP.md scripts docker-compose.yml apps/api/src/index.ts`
      returns nothing except package-scope imports scheduled for the follow-up.
- [ ] In the running image: `/api/health.version` = root `package.json` version = Settings › About =
      sidebar footer = bundle tag `v<n>`; no `"0.1.0"` literal remains in `apps/api/src/config/env.ts`.
- [ ] `CHANGELOG.md` has at most one "Unreleased" heading, above a dated `## <n> — <date>` entry;
      `git tag` lists `v<n>`; `scripts/release.sh` on an untagged HEAD exits non-zero naming the tag.
- [ ] Node 20: `pnpm install` stops with the prerequisite sentence; Node ≥ 22.9: installs.
- [ ] A production build shows no "dev mode" on any screen; the footer shows the version; the top-bar
      menu switches density.
- [ ] Bundle folder contains the CLI package (bundle-only) or README states the CLI path (public).
- [ ] RM-19 `item.md` milestone matches the recorded state; RS-05 licence cells corrected.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — the four decisions are hours; the version plumbing, changelog collapse and renames across scripts
and docs are two to three days; the package-scope rename is deferred.

## Sources

`PO-02, PO-03, PO-04, MK-01, MK-02, MK-20, MK-25, ENG-11, ENG-23, ENG-28, ENG-29, PS-20, PS-28`
