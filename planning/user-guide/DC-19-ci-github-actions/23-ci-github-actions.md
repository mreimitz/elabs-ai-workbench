---
type: "Guide Page"
title: "23. Gating a pull request \u2014 GitHub Actions with mcpfp"
description: "The mcpfp command line turns a measurement into a verdict with an exit code."
tags: ["documentation", "DC-19"]
timestamp: "2026-08-20T13:47:37Z"
status: "current"
---
# 23. Gating a pull request — GitHub Actions with `mcpfp`

The [`mcpfp` command line](../DC-18-mcpfp-cli/22-mcpfp-cli.md) turns a measurement into a verdict with an exit code.
This page is about wiring that verdict into **GitHub Actions**: a job that measures an MCP server on
every pull request, fails the build when the footprint (or the quality) moved outside what your team
agreed, and posts the reason as a comment on the PR.

Two ready-made workflows ship with the repository:

| File | Topology |
| --- | --- |
| `examples/github-actions/mcpfp-footprint-gate.yml` | **A** — a throwaway workbench started on the runner |
| `examples/github-actions/mcpfp-remote-gate.yml` | **B** — a persistent workbench your team already runs |

They are **examples to copy**, not workflows this repository runs. This repository keeps exactly one
workflow (`mcp-self-scan.yml`, its own footprint dogfood gate): a live gate here would need a running
workbench and a registered MCP server that its CI does not have, so it would be permanently red or
permanently skipped — and a skipped gate in the repository that publishes gates is worse than no
gate. What the repository does instead is **validate the examples as text** on every run of its test
suite: every action is pinned, no example reaches for `pnpm --silent`, nothing token-shaped appears
in them, and both shipped gate files still parse against the current schema.

> Companion pages: [The `mcpfp` command line](../DC-18-mcpfp-cli/22-mcpfp-cli.md) for the commands themselves, and
> [Service tokens](../DC-17-service-tokens/21-service-tokens.md) for the credential topology B needs.

---

## Choose a topology first

This is the decision that determines what your gate can actually check, so make it deliberately.

| | **A — ephemeral workbench on the runner** | **B — persistent shared workbench** |
| --- | --- | --- |
| Where the app runs | On the GitHub runner, started by the job itself | On a machine your team keeps running |
| Database | Created empty on every run, thrown away with the runner | Long-lived: it remembers every scan |
| Service token | **None.** The job reaches it on `127.0.0.1`, which is open | **Required.** A remote caller always needs one |
| Repository secrets | None beyond the `GITHUB_TOKEN` GitHub issues to the job | `MCPFP_URL` and `MCPFP_TOKEN` |
| Provider API keys | None, so no test run and no suite can execute | Whatever you configured in the app |
| Setup cost | Nothing to operate | Someone has to run and update the instance |
| Good for | An absolute token budget on a server's definitions | Everything: budgets, change over time, suite quality and cost |

Topology A is open without a token because the workbench treats **a request from its own machine**
as trusted, exactly as it does for your browser — and it decides that from the network socket, never
from a header a caller could set. Topology B is a request from somewhere else, and those are refused
unless they carry a token.

### What each topology can gate

**In topology A every baseline rule skips on every run — the database is new each time, so there is
never anything earlier to compare against — and no suite gate is possible at all, because a fresh
database holds no provider credentials, no environments and no saved suites.**

That is not a bug to work around; it is what "fresh database" means. The rules still appear in the
example gate file so the same file works unchanged against a persistent workbench, and each one
reports a loud **SKIP** with its reason. A delta gate in topology A is decoration, not protection.

| Rule | Topology A | Topology B |
| --- | --- | --- |
| `max-server-tokens` | ✅ works | ✅ works |
| `max-tool-tokens` | ✅ works | ✅ works |
| `max-tool-count` | ✅ works | ✅ works |
| `no-new-tools` | ⏭️ skips every run | ✅ works |
| `no-removed-tools` | ⏭️ skips every run | ✅ works |
| `max-scan-delta` | ⏭️ skips every run | ✅ works |
| `no-new-security-findings` | ⏭️ skips every run | ✅ works |
| `min-suite-score` | ❌ not possible | ✅ works |
| `max-suite-cost` | ❌ not possible | ✅ works |

A ⏭️ still exits **0** — a first-ever run must not fail a pipeline for having no history — and prints
a warning naming the rule that did not run. A ❌ is not a soft failure: a suite gate needs a saved
suite and a provider key, and topology A has neither, so there is nothing to point `mcpfp suite run`
at.

---

## The exit-code contract

Every `mcpfp` command answers with one of three codes, and the difference between **1** and **2** is
the whole reason a gate is worth having.

| Code | Meaning | What your pipeline should do |
| --- | --- | --- |
| **0** | It did what you asked. For `assert`: every rule passed. A rule that could not be evaluated yet is a loud SKIP, and still a 0. | Merge. Read the SKIP warnings if you expected a delta check. |
| **1** | **An assertion failed** — the gate said no. Only `mcpfp assert` can return this. | Fail the build. The verdict is real: something got more expensive, or scored worse. |
| **2** | The gate **could not run**: bad options, an unreadable gate file, an unreachable workbench, a refused token, a scan that failed, a suite run that did not complete, a baseline that could not be resolved. | Fail the build — but treat it as broken plumbing, not as a footprint verdict. Nothing was measured. |

Both **1** and **2** fail a GitHub Actions job, which is correct: neither is evidence that your
footprint is fine. The distinction survives in the job log because **the scan and the assert are
separate steps**. Never `&&`-chain them:

```yaml
# Good — the log says which one produced the code.
- name: Scan the server
  run: node apps/cli/dist/index.js scan "$MCPFP_SERVER" --format json --output scan.json

- name: Check the footprint against the gate file
  run: node apps/cli/dist/index.js assert mcpfp.assert.json --format markdown --output gate.md
```

`mcpfp assert` never runs a scan of its own. It judges a measurement the app already holds, which is
exactly what keeps a server that could not be reached (`scan`, exit 2) distinguishable from a budget
that was broken (`assert`, exit 1).

---

## Never `pnpm mcpfp` in a pipeline

Build once, then call the built entry point:

```yaml
- name: Install
  run: pnpm install --frozen-lockfile

- name: Build the CLI
  run: pnpm --filter "@mcp-token-footprint/cli..." build

- name: Scan the server
  run: node apps/cli/dist/index.js scan "$MCPFP_SERVER" --format json --output scan.json
```

`pnpm mcpfp` is a development convenience and it breaks a pipeline in two measured ways:

- **pnpm prints its own banner on standard output**, so `--format json > file` produces a file that
  is not JSON and the next step fails to parse it.
- **Silencing that banner makes it worse.** With `pnpm --silent` — and with `pnpm exec` — pnpm
  **collapses every non-zero child exit code to 1** (measured on pnpm 9.15.4, the version this
  repository pins). That is the code reserved for "an assertion failed". A workbench that was never
  reachable would report itself as a broken budget, and the two things you built the gate to tell
  apart would become one thing.

`node apps/cli/dist/index.js` has clean output *and* honest exit codes. Both example workflows use
it, and the repository's own test suite fails if either of them ever stops.

---

## Permissions, for topology B

A remote caller presents a **service token** created in **Settings → API tokens** (see
[Service tokens](../DC-17-service-tokens/21-service-tokens.md)). Tick only what the job needs:

| Step in the job | Permission it needs |
| --- | --- |
| `mcpfp scan <server>` | **Run scans** — plus **Read** |
| `mcpfp suite run <suite>` | **Run suites** to start the matrix — plus **Read** to poll it |
| `mcpfp assert` | **Read** |
| Polling, resolving a server or suite by *name*, pulling a report | **Read** |

**An execute permission does not include Read.** They are separate ticks, and Read is the price of
admission: a token holding only "Run scans" is refused at the door, because listing what exists is
itself a read. Every row above that says "plus **Read**" means the token needs *both* — a job that
scans and then asserts holds **Read + Run scans**, and one that also runs a suite holds **Read + Run
scans + Run suites**.

Two limits are built in and cannot be switched on: **no token can delete anything**, and **no token
can create or revoke another token**. A leaked CI token cannot mint a replacement for itself.

### Keeping the token out of the log

- Store it as a repository secret and reference it **only** as `${{ secrets.MCPFP_TOKEN }}`.
- Put it in a step's `env:`, not in a `run:` line, not in an `echo`, and never in a URL. Scoping it
  per step also keeps it out of the environment of any action you add to the job later.
- `mcpfp` itself never prints a token: every line it writes to standard output, standard error or a
  file goes through a redaction pass first, so even an API error that echoed the credential back
  comes out as its short prefix — `mcpfp_ab12cd34…`.
- The pull-request comment `assert --format markdown` produces carries **no credential and no path
  from the runner**, which is what makes it safe to post on a public repository.

---

## Topology A, walked through

Copy `mcpfp-footprint-gate.yml` (`../examples/github-actions/mcpfp-footprint-gate.yml`). The job:

1. **Checks out, installs and builds.** Pinned `actions/checkout@v4`, `pnpm/action-setup@v4` (pnpm
   9.15.4) and `actions/setup-node@v4` (Node 22).
2. **Starts the API in the background** against a throwaway `DATA_DIR` under the runner's temp
   directory, on `127.0.0.1:8080`.
3. **Waits for `GET /api/health`** in a bounded loop — up to two minutes, then it gives up and prints
   the workbench's log. Not a fixed `sleep`: a sleep that is long enough today is exactly how a
   copied workflow starts flaking six months later.
4. **Registers the MCP server under test.** This step is repo-specific — a fresh database knows no
   servers — and the example shows the `POST /api/servers` call for a stdio server. The name you
   register must match the gate file's `"target": { "server": … }` byte for byte.
5. **Scans**, then **asserts**, as two steps.
6. **Posts `gate.md` on the pull request** and **uploads it as an artifact**, both `if: always()`, so
   a *failing* gate still explains itself — which is the one thing a reviewer needs.

The comment is posted with the **GitHub CLI** (`gh pr comment "$PR" --body-file gate.md`, with
`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`), which is preinstalled on GitHub-hosted runners. No
third-party action, nothing to pin, nothing to audit. The job needs `pull-requests: write` in its
`permissions:` block for that.

Note what is **not** there: `continue-on-error` on the assert step. A gate you allow to fail softly
is not a gate.

## Topology B, walked through

Copy `mcpfp-remote-gate.yml` (`../examples/github-actions/mcpfp-remote-gate.yml`). There is no server
to start, so the job builds only the CLI and then runs four steps against your instance:

1. `mcpfp scan` — measures the server now.
2. `mcpfp assert mcpfp.assert.json` — the footprint budget **and** the three change rules, which mean
   something here because this workbench remembers the previous scan.
3. `mcpfp suite run` — runs a saved suite's matrix and waits for it, including the post-run rating.
4. `mcpfp assert mcpfp.suite.assert.json` — the score and cost budget.

**Two gate files, not one.** A gate document asserts one family: a footprint target (`server` /
`scan`) takes only the footprint rules, and a quality target (`suite` / `suiteRun`) takes only the
suite rules. Mixing them is a validation error naming the offending rule. Keeping them apart is also
what makes a build log readable — you can see *which* gate said no.

If the footprint gate fails, the job stops there and the suite half never runs; the PR comment then
carries the footprint verdict alone. That is deliberate. The alternative is `continue-on-error`, and
that is how a red gate quietly becomes a green build.

### The two gate files

Both ship next to the workflows and are copyable as a working pair:
`mcpfp.assert.json` (`../examples/github-actions/mcpfp.assert.json`) (footprint) and
`mcpfp.suite.assert.json` (`../examples/github-actions/mcpfp.suite.assert.json`) (quality). Neither
carries a credential — commit them next to the code they protect. The full rule reference is in
[The `mcpfp` command line](../DC-18-mcpfp-cli/22-mcpfp-cli.md#the-rules).

---

## Running the workbench in its own container

Topology B's instance is usually the app's own Docker image rather than a `pnpm start` on somebody's
laptop. Three things matter, and getting the third wrong loses data:

- **Ports.** The container listens on **8080 internally**; the bundled `docker-compose.yml` publishes
  it on host port **8081**, bound to loopback. `MCPFP_URL` must point at the *published* address —
  `http://127.0.0.1:8081` from the host, or `https://workbench.internal:8081` from a runner, once
  you have deliberately exposed it beyond loopback.
- **Exposing it at all is a decision.** The compose file binds to `127.0.0.1` on purpose. The moment
  a GitHub-hosted runner has to reach it, it is on a network — put it behind whatever your team uses
  for internal services, and remember that every remote request then needs a token. A self-hosted
  runner inside your own network is often the smaller step.
- **`DATA_DIR` and `MCP_SECRET_KEY` live on the same persistent volume.** The database at
  `DATA_DIR/app.sqlite` holds your servers, scans and suites; the encryption key is either
  `MCP_SECRET_KEY` (base64, 32 bytes) or the file the app generates at `DATA_DIR/mcp-secret.key`.
  **Lose both the environment variable and that file and every stored secret becomes
  unrecoverable** — the MCP `env`/`header` values and the OAuth tokens are encrypted with it. Mount
  one volume, keep both on it, and back it up. Scan history is the whole basis of a delta gate, so
  losing the volume also silently turns topology B into topology A.

The same applies to a runner that starts the container as a job service: it is only topology B if the
volume outlives the job. A container started fresh per run is topology A wearing a different hat, and
its baseline rules will skip exactly the same way.

---

## What is not here

- **A published GitHub Action.** There is no `action.yml` and no marketplace listing — the
  deliverable is a workflow you copy and can read end to end, not a distributed action that hides
  what it runs.
- **Rules about security findings.** Assertions today cover footprint and change (tokens, tool
  counts, added and removed tools) and suite quality (a minimum mean score, a maximum cost). Security
  posture rules arrive on the same file and the same exit codes in a later work package, and will add
  a row to the topology table above.
