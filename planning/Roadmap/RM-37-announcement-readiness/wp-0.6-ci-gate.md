---
type: "Work Package Spec"
title: "WP 0.6 — ci.yml with the four-command gate, e2e and a build matrix; the two GitHub Actions examples executed once"
description: "Phase 0 of item.md. Ledger: STATUS.md. Stand up ci.yml (typecheck, test, build, lint, e2e, Docker smoke, windows/macos build matrix, pnpm lint:ui) and release.yml (amd64 + arm64 bundle built from HEAD with a git_sha label), make release.sh refuse a dirty tree, run the two example gate workflows in a throwaway repository and record the green runs, and quote one self-scan figure everywhere."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 0.6 — ci.yml with the four-command gate, e2e and a build matrix; the two GitHub Actions examples executed once

Phase 0 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Files: `.github/workflows/mcp-self-scan.yml` (the only workflow: self-scan budget + planning-bundle
conformance, Node 22, pnpm 9.15.4), new `.github/workflows/ci.yml` and `release.yml`, root
`package.json:8-24` scripts (`typecheck`, `test`, `build`, `lint`, `test:e2e`, `mcp:self-scan`),
`playwright.config.ts:46-73` (hard-coded `/opt/pw-browsers/chromium` probe and `--no-sandbox`),
`e2e/smoke.spec.ts` (20 tests, 5 `test.skip`), `.claude/hooks/enforce-brand-ui.mjs` and
`check-tokens.mjs` (enforced only through editor hooks today), `scripts/release.sh:117` (dirty tree =
warning, `--publish` only) and `:141-146` (`docker buildx build "$ROOT_DIR"` builds the working tree),
`.dockerignore` (absent from the review copy — confirm in the real repository),
`examples/github-actions/mcpfp-footprint-gate.yml` and `mcpfp-remote-gate.yml`, README `:384-438`
(CI sections) and `:254` (self-scan figure "24 tools · 3,183 tokens against a 3,500 budget"),
`CLAUDE.md:109` ("24 tools · 2,749 tokens" against "3,000"), the budget constant
`packages/shared/src/workbench-mcp.ts:219` (`3500`), `apps/api/package.json:40` (`xlsx` from a vendor
CDN tarball URL), `patches/node-pty@1.1.0.patch`. Out of scope: the guard change the Docker smoke depends
on (WP 0.3), the CLI publishing decision (WP 0.2), owner acceptance sittings (WP 4.1), the RM-08
persistent-gate token scopes (unchanged).

## Actions

1. `ci.yml` job `gate` on push and pull request: `ubuntu-latest`, `pnpm/action-setup@v4` 9.15.4,
   `actions/setup-node@v4` Node 22 with pnpm cache, `pnpm install --frozen-lockfile`, then `pnpm
   typecheck`, `pnpm test`, `pnpm build` with `NODE_OPTIONS=--max-old-space-size=3400`, `pnpm lint`;
   upload the web bundle size (`apps/web/dist` du) as a job-summary line. — P0
2. Job `e2e`: `playwright.config.ts` uses `executablePath` only when `PW_CHROMIUM_PATH` is set and
   `--no-sandbox` only when `CI` is set; the job runs `pnpm exec playwright install --with-deps chromium`
   then `pnpm test:e2e`; each of the 5 `test.skip` cases in `e2e/smoke.spec.ts` is enabled or carries a
   one-line reason naming the owning WP. — P1
3. Job `build-matrix`: `windows-latest` and `macos-latest`, `pnpm install --frozen-lockfile`,
   `pnpm typecheck`, `pnpm build` (no tests). — P1
4. `pnpm lint:ui`: a script that runs `.claude/hooks/enforce-brand-ui.mjs` and `check-tokens.mjs` over
   `apps/web/src` and exits 1 on a raw `<button>`, a hard-coded colour or a missing token; included in
   the `gate` job after `pnpm lint` and documented in `CONTRIBUTING.md` (WP 0.2). — P1
5. Job `docker-smoke`: `docker build` the image, run it with `-p 127.0.0.1:8081:8080`, wait for
   `/api/health`, assert `GET /api/servers` → 200 through the published port and that `/` serves the
   SPA; uses the smoke script from WP 0.3 and fails until WP 0.3's guard change lands. — P1
6. `release.yml` (`workflow_dispatch`, input `version`): runs the gate, builds `linux/amd64` and
   `linux/arm64` with buildx from a clean checkout of HEAD, labels the image `org.opencontainers.image.revision=<git sha>`
   and passes the same sha into the build so `/api/health` reports `gitSha`, then runs
   `scripts/release.sh --skip-build` to produce the bundle and uploads `dist/release/v<version>/` as
   the workflow artifact. — P1
7. `scripts/release.sh`: exit non-zero on a dirty tree unless `--allow-dirty` (today `:117` warns and
   only under `--publish`); build from `git archive HEAD | docker buildx build -` instead of
   `"$ROOT_DIR"` (`:141-146`); add a test (`scripts/release.test.mjs` or `apps/api/test/`) that
   `.dockerignore` exists and lists `data/`, `.env*`, `.git`, `*.key`. — P1
8. Execute the two example gates once: in a throwaway repository (or the public demo repository, if
   WP 0.2 chose a public distribution) add `mcpfp-footprint-gate.yml` (ephemeral workbench) and
   `mcpfp-remote-gate.yml` (persistent workbench reachable from the runner, service token in a secret);
   run both to green; paste the run URLs into `planning/Roadmap/RM-08-ci/STATUS.md` § Owner acceptance
   (`:965`), tick the matching Sitting D boxes in `planning/Roadmap/RM-18-platform/owner-acceptance-consolidated.md`,
   and link them from README "Two ready-made CI setups" (`:427-438`). Until then that README section
   carries the line "Examples — not yet exercised on GitHub Actions". — P0
9. One self-scan figure: `mcp-self-scan.yml` writes the measured token count and the budget into the
   job summary; README `:254` and `CLAUDE.md:109` quote that number and the budget from
   `workbench-mcp.ts:219` (3,500 — `CLAUDE.md` says 3,000); a text test asserts both files carry the
   same figure, or both replace the literal with "see the latest self-scan run". — P1
10. Reproducible installs: replace the `xlsx` tarball URL (`apps/api/package.json:40`) with a vendored
    `vendor/xlsx-0.20.3.tgz` or an npm-registry package; add a test that `patches/node-pty@1.1.0.patch`
    is inside the Docker build context; document the `ai` v6/v7 split in `.claude/rules/dependencies.md`
    with its exit plan. — P2
11. Branch protection on `main` (owner setting in GitHub): required checks `ci / gate`, `ci / e2e`,
    `ci / build-matrix`, `Repository gates / self-scan`. — P2

## Acceptance

- [ ] A pull request to `main` shows the checks `ci / gate`, `ci / e2e`, `ci / build-matrix (windows)`,
      `ci / build-matrix (macos)`, `ci / docker-smoke`, `Repository gates / self-scan`, all green at HEAD.
- [ ] A branch with a deliberate raw `<button>` fails `pnpm lint:ui` in CI; HEAD passes.
- [ ] `e2e/smoke.spec.ts` runs in CI with zero unexplained skips; no `/opt/pw-browsers` path in the
      config outside an env-var branch.
- [ ] One `release.yml` run produces a bundle artifact with both architectures; `docker inspect` shows
      the revision label; `/api/health` on that image reports the same sha.
- [ ] `scripts/release.sh` on a dirty working tree exits non-zero without `--allow-dirty`; the
      `.dockerignore` test passes.
- [ ] Two green run URLs for the example workflows recorded in RM-08 `STATUS.md` and README.
- [ ] README and `CLAUDE.md` quote one self-scan figure and the 3,500 budget; the text test passes.
- [ ] `pnpm install --frozen-lockfile` succeeds with `cdn.sheetjs.com` unreachable.
- [ ] Gate green locally and in CI: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — `ci.yml` and the e2e/config changes are two days; `release.yml` and the `release.sh` changes one;
executing the examples needs a reachable workbench and a token (half a day).

## Sources

`ENG-08, ENG-24, ENG-25, PO-24, MK-13, MK-17, PO-25`
