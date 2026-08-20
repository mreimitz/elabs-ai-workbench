---
type: "Work Package Spec"
title: "WP 2.3 \u2014 GitHub Actions packaging: workflow example + docs"
description: "Phase 2 of README.md. Ledger: STATUS.md. Shared rules: the"
tags: ["roadmap", "RM-08"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP 2.3 — GitHub Actions packaging: workflow example + docs

Phase 2 of [`README.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). Shared rules: the
[testing conventions](../RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Depends on:** WP 2.2 (the PR-comment artifact the workflow posts).
**Consumed by:** nobody in-repo — this WP's output is copied by *other* repositories.

---

## Locked decisions this WP implements

- **D-C2 (locked 2026-08-19)** — **loopback is open, remote requires a token.** Loopback is decided
  from the socket peer, never a header (`trustProxy` stays off). This single fact is what splits the
  two topologies below, and getting it wrong is the difference between a workflow that works and one
  that 401s.
- **D-C6 / D-C7 (locked 2026-08-19)** — stdout is the payload; `0` pass, `1` **assertion failure
  only**, `2` the gate could not run. **`pnpm exec` and `pnpm --silent` both collapse a non-zero child
  exit to `1`** (measured on pnpm 9.15.4), i.e. straight onto the code reserved for assertions.
- **D-C8 (locked 2026-08-19)** — a first-ever scan does not fail a pipeline: baseline rules `skip`
  loudly and the command exits `0`.
- **D-C9 (locked 2026-08-19)** — `assert` never scans. A job chains `mcpfp scan` then `mcpfp assert`,
  which is what keeps `1` and `2` distinguishable.
- **README invariant** — artifacts contain **no secrets and no absolute local paths**.

### Decisions to lock in this WP (record them in the ledger's decision log)

- **D-C17 — the packaged workflow ships as an EXAMPLE under `examples/github-actions/`, not as a live
  workflow in this repository.** A live `.github/workflows/mcpfp-gate.yml` here would need a running
  workbench *and* a registered MCP server that this repo's CI does not have; it would be either
  permanently red or permanently skipped, and a skipped gate in the repo that publishes gates is
  worse than no gate. This repo keeps exactly one workflow (`mcp-self-scan.yml`, the D-MCP5 dogfood
  gate). The examples are instead **validated by a test** that reads them as text and asserts the
  invariants that actually matter.
- **D-C18 — two topologies, and the ephemeral one is documented with what it CANNOT gate.**
  - **(A) Ephemeral workbench on the runner** — start the built API on the runner host, talk to it on
    `127.0.0.1`, no token (D-C2). Fresh database, so: no provider keys (⇒ no suite gates) and **no
    scan history at all** — every run is a first run, so `no-new-tools`, `no-removed-tools` and
    `max-scan-delta` **skip on every run** (D-C8 case 1). A delta gate in topology A is decoration,
    and the docs must say so in those words rather than shipping an example that looks like it works.
  - **(B) Persistent shared workbench** — a long-lived instance the team runs; the runner reaches it
    over the network with `MCPFP_TOKEN` from a repository secret. This is the topology that supports
    baselines, suite runs and grade gates, because it has history and credentials.
  A table in the docs says which rule works in which topology. Guessing wrong is the most likely way
  a reader's first gate silently passes.
- **D-C19 — the examples invoke the built CLI entry point directly, never `pnpm mcpfp`.**
  `node apps/cli/dist/index.js …` (or the container's equivalent). pnpm's banner lands on **stdout**
  (corrupting `--format json > file`) and `pnpm exec`/`--silent` collapse `2` onto `1`, turning "the
  gate could not run" into "the gate said no". A test asserts no example contains `pnpm --silent`,
  `pnpm exec mcpfp` or `pnpm mcpfp`.

---

## What we're building

1. **`examples/github-actions/mcpfp-footprint-gate.yml`** — topology A. Checkout → pnpm/node setup →
   `pnpm install --frozen-lockfile` → `pnpm build` → start the API in the background against a
   throwaway `DATA_DIR` → poll `GET /api/health` until ready → register the MCP server under test
   (or note that this step is repo-specific and show the `POST /api/servers` call) → `mcpfp scan` →
   `mcpfp assert --format markdown --output gate.md` → post `gate.md` as a PR comment → upload it as
   an artifact. `if: always()` on the comment/upload steps so a **failing** gate still posts its
   reason — the one thing a reviewer needs.
2. **`examples/github-actions/mcpfp-remote-gate.yml`** — topology B. Same chain, but `MCPFP_URL` /
   `MCPFP_TOKEN` come from repository secrets, there is no local server to start, and the suite half
   (`mcpfp suite run` → a suite gate file) is included because it is only possible here.
3. **`examples/github-actions/mcpfp.assert.json`** and **`mcpfp.suite.assert.json`** — the two
   single-family gate files (D-C13) the workflows reference, so a reader can copy a working pair.
4. **`user-guide/23-ci-github-actions.md`** — the walkthrough: the two topologies and how to choose,
   the exit-code contract and what each code should do to a pipeline, the token/scope table (`read`
   for assert and polling, `scan:run` for `mcpfp scan`, `suites:run` for `mcpfp suite run` — and that
   a token needs `read` **in addition** to an execute scope), the rule×topology table from D-C18, the
   "never `pnpm --silent`" rule with its measured reason, and containerized-runner notes (the app's
   own image, port 8080 internal / 8081 published, `DATA_DIR` and `MCP_SECRET_KEY` on the same
   persistent volume — losing both makes stored secrets unrecoverable).
5. **`apps/api/test/ci-examples.test.ts`** (or a `packages/shared` test if that reads better) — the
   D-C17 validation described below.
6. Cross-links: one line in `README.md`'s CI section and in `user-guide/22-mcpfp-cli.md` pointing at
   the new guide.

### Explicitly NOT in this WP

A live workflow in `.github/workflows/` (D-C17) · a published GitHub Action (a `action.yml`,
a marketplace listing, a Docker action) — the deliverable is a copyable workflow, not a distributed
action · any change to the CLI, the API, the assertions engine or the wire · a YAML parsing
dependency (the validation test reads text) · a migration · an environment variable in *this* app
(the examples set env vars for their own job; nothing new is read by `apps/api/src/config/env.ts`).

---

## Design (implement this, don't redesign it)

### The example workflows

Follow `.github/workflows/mcp-self-scan.yml`'s register exactly: a comment banner at the top saying
what the file is, what it needs, and what it deliberately does not do; pinned action majors
(`actions/checkout@v4`, `pnpm/action-setup@v4` with `version: 9.15.4`, `actions/setup-node@v4` with
`node-version: 22`, `actions/upload-artifact@v4`); named steps that read as sentences.

Non-negotiables in both files:

- **The scan and the assert are two steps.** Never `&&`-chained into one, so the job log shows which
  of the two failed and the exit code is attributable (D-C9).
- **`continue-on-error` is not used to hide a failing gate.** The comment step is
  `if: always()`; the assert step is not.
- **The token is `${{ secrets.MCPFP_TOKEN }}` and appears nowhere else** — not in a `run:` line, not
  in an `echo`, not in a URL.
- **The PR comment is posted with the GitHub CLI** (`gh pr comment "$PR" --body-file gate.md`, with
  `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`), because `gh` is preinstalled on GitHub-hosted runners —
  no third-party action, nothing to pin, nothing to audit.
- **Topology A's health wait is a bounded loop with a timeout**, not a `sleep 10`. A fixed sleep is
  how these examples get copied and then flake.
- Topology A's comment block states, in the file, that baseline rules skip on every run because the
  database is fresh (D-C18) — a reader who copies only the YAML must still learn it.

### The validation test (D-C17)

Reads each example as text and asserts:

- every `uses:` is version-pinned (matches `@v\d`), and the set of actions used is exactly the
  allow-list above — a new third-party action in a copied gate is a supply-chain decision, and the
  test makes adding one deliberate;
- no line matches `pnpm --silent`, `pnpm exec mcpfp`, or `pnpm mcpfp` (D-C19), and the CLI is invoked
  as `node apps/cli/dist/index.js`;
- nothing token-shaped appears (`mcpfp_[A-Za-z0-9_-]{20,}`, `ghp_…`, `sk-…`) — reuse the CLI's
  `redactTokens` patterns or the security contract's masks rather than inventing a third set;
- the token, where used, comes from `${{ secrets.` ;
- the scan step and the assert step are distinct steps;
- every gate file referenced by a workflow exists in `examples/github-actions/` and parses against
  `assertionDocumentSchema` — **this is the one that earns its keep**: a shipped example gate file
  that no longer validates after a schema change would otherwise be discovered by a stranger.

---

## Files

**New**
- `examples/github-actions/mcpfp-footprint-gate.yml`
- `examples/github-actions/mcpfp-remote-gate.yml`
- `examples/github-actions/mcpfp.assert.json`
- `examples/github-actions/mcpfp.suite.assert.json`
- `user-guide/23-ci-github-actions.md`
- `apps/api/test/ci-examples.test.ts`

**Modified**
- `README.md` (one cross-link), `user-guide/22-mcpfp-cli.md` (one cross-link)

**Zero-line diff**
- `.github/workflows/**` — this repo keeps exactly one workflow (D-C17)
- `apps/cli/**`, `apps/api/src/**` (the test is the only api-side addition), `apps/web/**`
- `packages/shared/src/**`
- `apps/api/src/db/**`, `pnpm-lock.yaml`, every `package.json`, `.env.example`,
  `apps/api/src/config/env.ts`

---

## Acceptance

- **A1 (D-C17)** — The examples live under `examples/github-actions/`; `.github/workflows/` has a
  zero-line diff and still contains exactly one workflow.
- **A2 (D-C18)** — Both topologies are shipped and documented, and the guide states plainly that in
  topology A every baseline rule skips on every run and no suite gate is possible. Quote the sentence.
- **A3 (D-C19)** — No example invokes `pnpm mcpfp` / `pnpm exec mcpfp` / `pnpm --silent`; every CLI
  call is `node apps/cli/dist/index.js`; the validation test fails if that changes.
- **A4** — Scan and assert are separate steps in both examples; the comment/upload steps are
  `if: always()`; the assert step is not `continue-on-error`.
- **A5** — Every `uses:` is version-pinned and drawn from the allow-list; the PR comment uses `gh`,
  not a third-party action.
- **A6 (no secrets)** — Nothing token-shaped appears in any example or in the guide; the token comes
  only from `${{ secrets.MCPFP_TOKEN }}`; no absolute local path appears anywhere.
- **A7** — Both shipped gate files parse against `assertionDocumentSchema`, are single-family
  (D-C13), and the test proves it.
- **A8** — `user-guide/23-ci-github-actions.md` carries the exit-code contract, the scope table
  (including "an execute scope does not include `read`"), the rule×topology table, and the
  containerized-runner notes (`DATA_DIR` + `MCP_SECRET_KEY` on one persistent volume).
- **A9 (gate)** — From the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` **separately**. Report exit codes and test counts.
  Note that **Biome lints YAML? it does not** — confirm `pnpm lint` is unaffected by the new files and
  say so; if Biome does pick up the new JSON gate files, format them rather than excluding them.
  The two pre-existing failures (`apps/api/test/compatibility-data.test.ts`;
  `research/token-context-comparison/comparison/all-models.json` in lint) must be reported as
  pre-existing, never fixed silently.
- **A10 (no drive-by scope)** — No source file outside the Files section changed; no CLI, API or wire
  behaviour was touched. You did **not** touch any `STATUS.md`.
