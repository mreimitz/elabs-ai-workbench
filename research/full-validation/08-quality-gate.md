# Quality gate — clean-checkout run

Part of the full-validation series. This documents an **actual execution** of the project's
definition-of-done gate (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) against a fresh
copy of the working tree, plus the observed test counts and bundle stats.

## method

- Copied the working tree to an isolated Linux sandbox (`/tmp/gate/repo`), `pnpm install`
  (`--no-frozen-lockfile`, pnpm 9.15.4, Node 22). Native `better-sqlite3`/`node-pty` rebuilt fine
  for Linux.
- Ran each gate separately and captured exit codes and output.
- Two transient failures were caused by the copy step excluding two `data` directories
  (`apps/api/src/compatibility/data`, `research/token-context-comparison/data`); both were restored
  and the affected gates re-run. These are **copy artifacts, not repo defects** — the real tree has
  both directories.

Run date: 2026-07-12. Environment: Linux sandbox (not the owner's macOS box), so binary rebuild
paths differ but the JS gate results transfer.

## results

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck — shared | `tsc --noEmit` | ✅ pass |
| Typecheck — api | `tsc --noEmit` | ✅ pass |
| Typecheck — web | `tsc --noEmit` | ✅ pass |
| Lint | `biome check --formatter-enabled=false .` | ✅ pass (704 files, 0 errors)¹ |
| Build — shared | `tsc` | ✅ pass |
| Build — api | `tsc && copy-data` | ✅ pass |
| Build — web | `vite build` | ✅ pass (⚠ chunk-size warning — see below) |
| Test — api | `tsx --test test/*.test.ts` | ✅ 1532 tests, 1529+3² pass, 0 real fail |
| Test — web | `vitest run` | ✅ 79 files, 746 pass, 5 skipped |

**Verdict: the gate is green.** Every gate the repo defines as its definition-of-done passes on a
clean checkout. Nothing in the findings series below is a *broken build* — they are latent quality,
security, and maintainability issues that a passing gate does not catch.

¹ Biome initially reported 8 `noVar` errors — all in `apps/web/vitest.config.ts.timestamp-*.mjs`
files, which are **Vite's transient config-transpilation artifacts** created by running the web test
suite in the sandbox (esbuild emits `var`). They are not tracked files and do not exist in a fresh
checkout; after removing them, lint is clean. Worth a `.gitignore`/`biome.json` `files.ignore` entry
for `*.timestamp-*.mjs` so a developer who runs tests then lints locally doesn't hit this. (Low.)

² The API runner reported 3 failures on the first pass — all three were the
`research/token-context-comparison/data` copy artifact (`compatibility-data.test.ts` byte-compares
the bundled roster against that research source). After restoring the directory the file passes 8/8,
so the true count is **1532/1532**.

## observations worth carrying into the report

- **Web bundle is a single ~9.3 MB chunk** (`dist/assets/index-*.js` = 9,321 kB / 2,564 kB gzip),
  and vite prints the ">500 kB chunk" warning. Monaco language chunks alone are large
  (`emacs-lisp` 780 kB, `wasm` 622 kB, `wardley` 615 kB, `cytoscape` 444 kB) and ship eagerly.
  This is the concrete, measured confirmation of web finding **H1** (no code-splitting) — the whole
  app, including Monaco + React Flow + Mermaid + charts, loads on first paint of any route.
- **Web build needs a memory ceiling**: it was OOM-killed (exit 137) at
  `--max-old-space-size=3400` on a 3.9 GB box and only completed at `2800`. CLAUDE.md documents the
  `3400` figure for "constrained" machines; the true constrained-box figure is lower. The heavy
  Monaco/Milkdown/Mermaid tree is the cause — another reason to split it.
- **API test suite is fast** (~18 s for 1532 tests) and hermetic (no network); web suite ~28 s.
  Both are healthy.
- The suite counts differ from the doc snapshots (CLAUDE.md cites "1511 API / 566 web"; observed is
  1532 API / 751 web incl. skipped). The docs are stale snapshots, not wrong in spirit — see
  `07-docs-consistency.md`.
