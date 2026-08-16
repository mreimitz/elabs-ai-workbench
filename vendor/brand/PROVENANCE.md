# `vendor/brand/` provenance

This directory holds the **active** UI design system for this app: the upstream `@brand/*`
packages (brand-ui) at **v1.9.0**, vendored as tarballs and consumed via `file:` dependencies
(see `apps/web/package.json` and the root `package.json` for `@brand/cli`). These tarballs are the
real dependency source — `pnpm-lock.yaml` pins each one by `file:` path **and** records its
`sha512` integrity, so installs are reproducible and tamper-evident.

## Provenance note

Vendored from the upstream **`@brand/* v1.9.0` GitHub Release** —
**<https://github.com/mreimitz/qlabs-components/releases/tag/v1.9.0>** (repo
`mreimitz/qlabs-components`, private). Fetched with the owner's authenticated `gh` CLI
(`gh release download v1.9.0 --repo mreimitz/qlabs-components`); the upstream repo/release is
private, so unauthenticated fetches 404. The packages are **not published to npm**; the vendored
tarballs are the only supply.

Upgraded from v1.6.0 on 2026-07-17. The v1.6.0→v1.9.0 span is **additive** for everything this app
imports: a type-surface diff of every consumed package (`ui`/`data`/`charts`/`ai`/`editor`/`flow`/
`tokens`/`icons`) showed **zero removed exports**. The one deprecation that touches this app —
`@brand/charts` renamed the `Status` union to `GanttStatus` (v1.8.0), keeping `Status` as a
`@deprecated` alias — was migrated in `RunGantt.tsx`. New `@brand/ai` content (the v1.9.0
message-body components `MessageForm`/`MessageTable`/`MessageEdit`/`MessageFeedback`/`GroupedParts`/
`SelectionToolbar`/`StreamingSuggestions`, and v1.8.5's `InteractiveTerminal`) is purely additive
and pulls in `@xterm/xterm` + `@xterm/addon-fit` + `zod` as `@brand/ai` runtime deps. The app's
direct `@xyflow/react` pin was moved to `^12.11.1` to align with `@brand/flow`'s v1.8.0 upgrade.

## Tarballs

Each row lists the tarball, its published package name/version, the `sha512` integrity recorded in
`pnpm-lock.yaml` (`resolution.integrity`), and the `sha256` computed locally with
`shasum -a 256 vendor/brand/*.tgz`.

### `brand-ai-1.9.0.tgz` — `@brand/ai` v1.9.0
- sha512: `sha512-WG2S1k9qWcIPaCXBW1SuV+yJ7/NCs8OJ4RhRTAR65NwEedDMq8pXwe+JtKwE6jQ5jl1/cMSWUe+Jsc62bfV2mQ==`
- sha256: `98e4832375f43f029c7ea4b6e276810cb88468763f13ad61b4783b5f6760639c`

### `brand-charts-1.9.0.tgz` — `@brand/charts` v1.9.0
- sha512: `sha512-KOMRnt4cMi04F6YpKnxhFZaHxBkXfb3Hjd4yvwfq5b8ikJV86CRr9FqbhKb0HCJ8EXlN404fRC+xjn7r1fbEqQ==`
- sha256: `b2fbac7dafc0a46a2b68e3e29e4d48d7d608c6f26ff5277aab529c736fad8eb5`

### `brand-cli-1.9.0.tgz` — `@brand/cli` v1.9.0
- sha512: `sha512-HgC5q9N7t9mnhgneRHiOJBhv019qXJVg94ftjA1ZEecw11J30uelMLhmLSIo41M1ih4d65kGZcIgtSBB+2I/4g==`
- sha256: `754134be8fc7dc8f8e466107e680ef0e538fd36f206828c0dae3121d5baeacc2`
- Note: root devDependency; provides `pnpm exec brand-ui <info|search|docs>` and the `brand-ui mcp`
  server (`.mcp.json`).

### `brand-data-1.9.0.tgz` — `@brand/data` v1.9.0
- sha512: `sha512-zxr+kk3e4jmsYDiMyNpKJ+NsrsT1FFTWyFK64TS8sGFrWZU5GyqMNB2IvpP0FO8eDkSTuVj62ugpXxFh4w6L5Q==`
- sha256: `42ca904c427e1b0deb98df9e443af43e385f44d693cf14117a94a3a905d310c6`

### `brand-editor-1.9.0.tgz` — `@brand/editor` v1.9.0
- sha512: `sha512-1kKBq/yeQ6Ld61v6fCnT1kqHX3D7HIU3HxWJLIOno/bwcQuZCbGFIFL/K5yvTuhAjEHZXuVG6aKxrjj1n75tXw==`
- sha256: `955904d69cb0d3f10f2e691cb7cd3b91c138463659bf1eda575cdd088398a8b0`

### `brand-flow-1.9.0.tgz` — `@brand/flow` v1.9.0
- sha512: `sha512-mOmdz0bTCXLPJfWh/hParycmVUTQPItbNbU0kOjOx0Cf0hUf/mUwyesC4I/nLsmBF7TN1YYX/31v7NBAplCIhA==`
- sha256: `92eaa4bdce9c89048aff6725441d3f68b8d126291a599af2fe2bdade38fcbbeb`

### `brand-icons-1.9.0.tgz` — `@brand/icons` v1.9.0
- sha512: `sha512-wCypSqYWO+Jl9a+/Y+RV0etnycSdRspihUMahVqwF8UlTH9j4jjPyYoJoKKHHX1Z/9PXf8Y6RcZMAQmGrgxaPw==`
- sha256: `1ce4ba359facc5dce850437309811abda8dda7be65cf6991b916d80fc2180105`

### `brand-tokens-1.9.0.tgz` — `@brand/tokens` v1.9.0
- sha512: `sha512-zKKZtjCC2lUZQCIJuC9xKsl74PUrYBZPXzyCww1mnIEyFwwCVeWdsrCLb94YQ9E6NcvTnCgXswr8AIMl7TDTJg==`
- sha256: `86b7888530dc3e311aec26ff106727bc1dca754c9411789cffd54979d03efda8`

### `brand-ui-1.9.0.tgz` — `@brand/ui` v1.9.0
- sha512: `sha512-xeufxB3++CnwL/hWWj/rEZAYJZeBDhIbA1fbjVopiazqpx6FlXIxXas9lYpzRf6QSbRpieIzH0lnJ8gUgnSqcA==`
- sha256: `dcb605fdfeb747260902def27059d9308d47038d016c7af8e17e3a28031f0ca9`

To re-verify the sha256 values: `shasum -a 256 vendor/brand/*.tgz`. To re-verify the sha512 against
the lockfile: `grep -A1 "@brand/.*file:vendor/brand" pnpm-lock.yaml` (the `resolution.integrity`
carries the `sha512-…`).

## Agent-kit version skew

The coding-agent reference bundle at `vendor/brand-ui-agent-kit/` is **v1.9.0** (updated alongside
this bump from the release's `brand-ui-agent-kit-1.9.0.zip` asset), matching the installed
components. When the kit and installed version ever disagree, trust the installed version: confirm
props via the package `.d.ts` or `pnpm exec brand-ui <info|search|docs>` / `brand-ui mcp`, not the
kit.

## How to update `@brand/*` (owner-gated)

Bumping the design system is **owner-approved** (see `.claude/rules/dependencies.md` and
`library-first.md`). The owner-run process:

1. Fetch the new upstream release tarballs — `gh release download <tag> --repo
   mreimitz/qlabs-components --pattern 'brand-*.tgz'` (owner's authenticated `gh`; packages are not
   on npm).
2. Swap the tarball(s) in `vendor/brand/` (drop the old version, add the new one).
3. Re-pin the `file:` version(s) in `apps/web/package.json` (and root `package.json` for
   `@brand/cli`).
4. Run `pnpm install` to refresh `pnpm-lock.yaml` (new `sha512` integrity is recorded here).
5. If a new `@brand/*` package is added, add a matching `@source` line in
   `apps/web/src/styles/app.css`.
6. Run the quality gate — `pnpm typecheck && pnpm test && NODE_OPTIONS=--max-old-space-size=3400 pnpm build && pnpm lint`.
7. Update this file: new tarball name/version, the new `sha512` (from the lockfile) and `sha256`
   (`shasum -a 256`).
