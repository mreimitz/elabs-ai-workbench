# 22. The `mcpfp` command line — scans, reports and build gates from a terminal

Everything the workbench measures is reachable from a browser. This page is about doing the same
things **from a terminal or a build pipeline**: run a scan, check it against rules you wrote down,
pull a report, list what is registered — without clicking anything, and with output a script can
read.

`mcpfp` is a **client**. It does not connect to your MCP servers, it does not read your database,
and it holds no credentials of its own beyond the one token you hand it. It talks to a **running
workbench** over HTTP and prints what comes back. If the app is not running, `mcpfp` can do nothing —
which is the point: the app keeps every rule about secrets and MCP connections in one place.

> Companion pages: [Service tokens](./21-service-tokens.md) for the credential a remote caller
> presents, and the [Workbench agent playbook](./20-workbench-mcp-server.md) for letting an AI
> assistant read the same data.

---

## Running it

The workbench does not publish `mcpfp` to npm. You run it from the repository:

```bash
# From the repository root, with the app running somewhere:
pnpm mcpfp servers
pnpm mcpfp scan "My Server"
pnpm mcpfp report fleet --format markdown
```

**In a script or a CI job, build once and call the entry point directly:**

```bash
pnpm build
node apps/cli/dist/index.js report scan <scanId> --format json > report.json
```

That is not a stylistic preference. `pnpm mcpfp` is a convenience wrapper, and pnpm adds two banner
lines of its own to standard output — which a script that parses the output will choke on. Silencing
them with `pnpm --silent` makes pnpm **collapse every non-zero exit code to 1**, which is the code
reserved for "an assertion failed" (below). Building once and calling `node apps/cli/dist/index.js`
avoids both problems: clean output, honest exit codes.

---

## Pointing it at your workbench

`mcpfp` needs to know **which instance** to talk to and, sometimes, **which token** to present.
Each setting can come from four places, and they win in this order:

**a flag beats an environment variable, which beats a config file, which beats the default.**

| Setting | Flag | Environment | Config file | Default |
| --- | --- | --- | --- | --- |
| Workbench URL | `--url <url>` | `MCPFP_URL` | `"url"` | `http://127.0.0.1:8080` |
| Service token | `--token <token>` | `MCPFP_TOKEN` | `"token"` | *(none)* |
| Request timeout | `--timeout <ms>` | `MCPFP_TIMEOUT_MS` | `"timeoutMs"` | `120000` |

The config file is called **`mcpfp.config.json`** and is found by looking in the current directory,
then its parent, and so on up to the root of the disk — the first one found wins. Point at a
specific one with `--config <path>`; if that file does not exist, `mcpfp` stops rather than quietly
falling back to the default instance.

```json
{
  "url": "http://workbench.internal:8081",
  "timeoutMs": 300000
}
```

A key it does not recognise is an **error**, not something it ignores — so a typo like `"apiUrl"`
tells you, instead of silently talking to the wrong machine.

Not sure what it resolved? Ask:

```bash
pnpm mcpfp config show
```

```
API URL      http://127.0.0.1:8080
Timeout      120000 ms
Config file  none found (looked for mcpfp.config.json)
Token        none — loopback instances are open unless API_AUTH_REQUIRED=true
```

### About the token

You usually do not need one. **A workbench running on the same machine is open**, exactly as it is
for your browser — see [Service tokens](./21-service-tokens.md). You need a token when the workbench
is somewhere else, or when it was started with `API_AUTH_REQUIRED=true`.

Which permission a command needs:

| Command | Permission |
| --- | --- |
| `scan` | **Run scans** (plus **Read**, if you pass a server *name* rather than an id) |
| `suite run` | **Run suites** to start the matrix, **plus Read** to follow it (and to resolve a suite *name*) |
| `assert` | **Read** — it only reads something the app already measured |
| everything else | **Read** |

Three things `mcpfp` does with your token, deliberately:

- **It never prints it.** Not in `config show`, not in an error, not in a file it writes. Where a
  token has to be acknowledged you see only its short prefix — `mcpfp_ab12cd34…`.
- **It checks the shape before sending anything.** A truncated or wrong-format secret fails
  immediately with "that is not a workbench token" instead of a puzzling authentication error later.
- **It warns if the token came from `mcpfp.config.json`.** That works, but a file next to your code
  is a file that gets committed. Prefer `MCPFP_TOKEN` in CI. (The repository ignores
  `mcpfp.config.json` for exactly this reason.)

---

## The commands

### `scan <server>` — measure a server now

```bash
pnpm mcpfp scan "Everything (demo)"
```

```
Server        Everything (demo) (JS8YDxdw9pvo3B1hS-keH)
Scan          r-3ZMS8fNiNfoBu6O0Qfs
Scanned at    2026-08-19T20:25:56.402Z
Status        success
Tools         13
Total tokens  1,729
Raw payload   10.1 KB
Resources     9 (240 tokens)
Prompts       4 (147 tokens)

Top 5 tools by contribution
TOKENS  SHARE  TOOL
   249  14.4%  gzip-file-as-resource
   197  11.4%  get-structured-content
   176  10.2%  simulate-research-query
   149   8.6%  get-annotated-message
   130   7.5%  get-resource-reference

1,729 definition tokens across 13 tools (generic_o200k, counting version 2).
```

`<server>` is a **server id or its exact name**. If two registered servers share a name, `mcpfp`
stops and lists their ids rather than guessing — scanning the wrong server and printing a plausible
number is worse than not scanning.

**If the scan itself fails, `mcpfp` exits with an error** (code 2) and says why, so a build step
cannot go green against a server that could not be reached.

Formats: `human` (default), `json`.

### `suite run <suite>` — run a saved suite and wait for the verdict

```bash
pnpm mcpfp suite run "Nightly regression"
```

This starts a saved suite's **matrix run** — every test × every environment × every repetition — and
then, by default, **waits for it** and prints the summary. `<suite>` is a suite id or its exact name;
if two saved suites share a name, `mcpfp` stops and lists their ids rather than guessing.

```
Suite       Nightly regression (ste_Nightly7fQ2xLm)
Suite run   srn_9Kd2LmT4vQ8sWx0aB
Source      suite
Status      completed
Started at  2026-08-20T09:00:00.000Z
Ended at    2026-08-20T09:07:12.000Z
Duration    7m 12s
Rating      rated

Aggregates
Cells           12/12
Mean grade      0.82
Grade std-dev   0.11
Pass rate @0.5  91.7%
Total tokens    184,320
Execution cost  $1.0231
Judge cost      $0.1194

Members, worst score first (4 of 4)
RUN      STATUS     SCORE  TOKENS     COST
run_2bQ  completed   0.41  16,500  $0.0902
run_7Lp  completed   0.55  15,100  $0.0851
run_9aZ  completed   0.88  14,100  $0.0788
run_Kx4  error          —   2,000  $0.0123

Suite run srn_9Kd2LmT4vQ8sWx0aB completed: 12/12 cells, mean grade 0.82, $1.14.
```

The member rows are the **worst-scoring first**, because that is what you open a build log for; the
ten worst are shown, and `--format json` carries every one of them. A dash is a dash: a run with no
graded score prints `—`, never a `0` that would read as "it scored zero".

#### Waiting

**The run happens in the app, not here.** `mcpfp` starts it and then re-reads it every five seconds
until it settles. That includes the post-run **rating**: the summary is not printed while member
grades are still being computed, so what you see is the finished picture.

| Flag | What it does |
| --- | --- |
| *(nothing)* | Wait up to **30 minutes** for the run to finish, then summarize it. |
| `--wait <seconds>` | Use a different total budget. Running out while the matrix is still going is an error (below). |
| `--no-wait` | Return as soon as the run has **started**, print the suite run's id, and stop. No members, exit 0. |

While it waits, a progress line goes to standard error each time the number of finished cells
actually moves — `Suite run srn_… : 6/12 cells, $0.48 so far…` — so a forty-minute matrix does not
produce five hundred identical lines in a build log. `--quiet` turns those off.

#### Exit codes

| Situation | Exit |
| --- | --- |
| The matrix **completed**. | **0** |
| `--no-wait`: the run started. (It says nothing about the outcome — that is what you asked for.) | **0** |
| The run ended in **error**. | **2** |
| The run was **capped** — the suite's aggregate cost cap soft-stopped the matrix part-way. | **2** |
| The run was **stopped** — somebody halted it from the app. | **2** |
| Your **wait budget ran out** while the matrix was still going. The message names the suite run id so you can go and look at it; the run itself keeps going. | **2** |
| The request could not be made at all: unreachable app, refused token, unknown suite. | **2** |

**Never 1.** That code belongs to `mcpfp assert` alone, so a pipeline can always tell "the gate said
no" from "the run did not finish".

One case is deliberately *not* a failure: if your budget runs out after the matrix reached a terminal
status but while the **grades** were still landing, the exit code still comes from the status — and a
warning tells you the summary's grades may be incomplete. **`--quiet` does not hide that warning.**

#### In a build

```bash
pnpm build
node apps/cli/dist/index.js suite run "Nightly regression" --format json > suite-run.json
```

Use the built entry point, never `pnpm --silent mcpfp` — pnpm collapses every non-zero exit to **1**,
which is the one code this command must never produce (see [Running it](#running-it) above).

`--format json` puts both halves of the answer in `data`, exactly as the app returned them:

```json
{
  "outputVersion": 1,
  "command": "suite run",
  "generatedAt": "2026-08-20T09:07:13.402Z",
  "apiUrl": "http://127.0.0.1:8080",
  "data": {
    "suiteRun": { },
    "members": [ ]
  }
}
```

Formats: `human` (default), `json`. Markdown is **not** offered here — the pull-request comment
belongs to the *gate*, and lives on [`assert --format markdown`](#assert-file--fail-the-build-when-a-budget-is-broken).
A flag that silently produced a human table into a file a later step tried to parse as that comment
would be worse than not having it.

### `assert [file]` — fail the build when a budget is broken

This is the one that turns a measurement into a **gate**. You write down what you consider
acceptable, `mcpfp assert` asks the app whether the latest measurement still meets it, and the exit
code tells your pipeline what to do.

There are two kinds of gate, and they work identically:

- a **footprint gate** over a *scan* — "this server's tools may not cost more than 3,000 tokens";
- a **quality gate** over a *suite run* — "the nightly suite must still average 0.8, for under $2.50".

```bash
node apps/cli/dist/index.js scan   "Everything (demo)"   # measure it now
node apps/cli/dist/index.js assert                       # then check it against your rules

node apps/cli/dist/index.js suite run "Nightly"          # run the matrix and wait for it
node apps/cli/dist/index.js assert quality.assert.json   # then check the scores
```

Those are deliberately separate commands. **`assert` never runs anything** — it judges a measurement
the app already holds. That is what keeps the exit codes honest: a server that could not be reached
fails the *scan* step with code 2, rather than quietly turning into "the gate says no".

#### The file

`mcpfp assert` looks for **`mcpfp.assert.json`**, starting in the current folder and walking up until
it finds one — so it works from any subfolder of your repository. Name a different file as an
argument (`mcpfp assert gates/footprint.json`) and that one is used instead. Finding nothing is an
error, never a silent pass.

A worked example, also in the repository as
[`mcpfp.assert.example.json`](../mcpfp.assert.example.json):

```json
{
  "version": 1,
  "target": { "server": "Everything (demo)" },
  "baseline": "previous",
  "rules": [
    { "rule": "max-server-tokens", "max": 3000 },
    { "rule": "max-tool-count", "max": 30 },
    { "rule": "max-tool-tokens", "max": 400 },
    { "rule": "max-tool-tokens", "max": 900, "tool": "search_issues" },
    { "rule": "no-new-tools" },
    { "rule": "no-removed-tools" },
    { "rule": "max-scan-delta", "maxTokens": 250, "maxPercent": 10 }
  ]
}
```

- **`version`** must be `1`. A file written for a newer version is refused with a sentence naming
  both, rather than half-read.
- **`target`** is exactly one of four shapes:

  | Target | What is asserted |
  | --- | --- |
  | `{ "server": "<id or exact name>" }` | that server's newest completed scan |
  | `{ "scan": "<scanId>" }` | that exact scan |
  | `{ "suite": "<id or exact name>" }` | that suite's newest finished, fully-rated run |
  | `{ "suiteRun": "<suiteRunId>" }` | that exact suite run |

  Naming two of them is an error, not a precedence rule nobody remembers. An ambiguous *name* (two
  servers or two suites share it) lists both ids rather than picking one.
- **`baseline`** is optional: `"previous"` means "the one before this, of the same server / the same
  suite", or you can name an exact id. A baseline you **name** is always resolved and echoed back,
  even when none of your rules needs it — that is what puts the before-and-after line in the
  pull-request comment.
- **Every key is checked.** A misspelled key is an error naming the field — never a rule that
  silently disappears from a gate you believe is protecting you.

Unlike `mcpfp.config.json`, this file carries **no credential** — commit it. It is the record of what
your team agreed the footprint (or the quality) may cost, and it belongs next to the code it
protects.

#### One file, one family

A gate file asserts **one kind of thing**. A footprint target (`server` / `scan`) takes only the
footprint rules; a quality target (`suite` / `suiteRun`) takes only the suite rules. Mixing them is a
validation error that names the offending rule's position in your `rules` array.

That is deliberate. If you want both gates, keep two files and run `mcpfp assert` twice — which is
also what makes the result readable in a build log, because you can see *which* gate said no.

```bash
node apps/cli/dist/index.js assert footprint.assert.json   # the token budget
node apps/cli/dist/index.js assert quality.assert.json     # the score and cost budget
```

#### The rules

**Footprint rules** — for a `server` or `scan` target:

| Rule | What it checks | Needs a baseline |
| --- | --- | --- |
| `max-server-tokens` | The whole server's tool definitions cost at most `max` tokens. | no |
| `max-tool-tokens` | Every tool costs at most `max` tokens. With `tool`, only that one — and if that tool is **missing**, the rule fails. | no |
| `max-tool-count` | The server exposes at most `max` tools. | no |
| `no-new-tools` | No tool appeared that the baseline did not have. | yes |
| `no-removed-tools` | No tool the baseline had has disappeared. | yes |
| `max-scan-delta` | The change against the baseline stays within `maxTokens` and/or `maxPercent`. Both are **absolute**, so a large drop fails too. | yes |
| `no-new-security-findings` | No **security finding** appeared that the baseline scan did not have. Optional `minSeverity` (`error` / `warning` / `info`) sets the floor; the default is `warning`. | yes |

**Quality rules** — for a `suite` or `suiteRun` target:

| Rule | What it checks | Needs a baseline |
| --- | --- | --- |
| `min-suite-score` | The suite run's **mean grade** is at least `min` (a number from 0 to 1). A finished run that produced **no** graded score at all **fails** — a gate that asked for a score and got none has not been satisfied. | no |
| `max-suite-cost` | The suite run's **execution + judge cost** is at most `maxUsd`. The message names both halves, because "the judge blew the budget" and "the matrix blew the budget" are different problems. | no |

Every rule is evaluated, every time — you get the full list of problems in one run, not one problem
per round trip.

#### The posture rule, in detail

`no-new-security-findings` re-runs the workbench's own security analyser — the same one behind the
scan's **Security** report — over the scan under test *and* over the baseline scan, and fails if the
new scan carries a finding the old one did not.

```json
{ "rule": "no-new-security-findings" }
{ "rule": "no-new-security-findings", "minSeverity": "info" }
```

Two things about it are worth knowing before you put it in front of a team, because both decide
whether the gate is one you keep or one you switch off.

**"New" means a finding you did not have, not a bigger number.** Two findings are *the same finding*
when they come from the same rule and sit in the same place — the same tool, the same parameter, the
same file, or the server itself. Nothing else is part of that comparison. So:

- A release that **fixes one finding and introduces a different one** fails. The totals did not move,
  but you did acquire a problem you did not have, and that is exactly the case a posture gate exists
  to catch.
- A vendor **rewording a tool description** that still trips the same rule on the same tool does
  **not** fail. It is the same finding, said differently. A gate that went red every time somebody
  edited a sentence would be turned off inside a week.

**The default floor is `warning`.** `error` and `warning` findings gate. `info` findings — an
undescribed parameter, an unmarked open-world tool, an unconstrained object schema — are hygiene, and
a gate that goes red on its first run because a third-party server left three parameters undescribed
is a gate nobody keeps. The message still tells you how many findings it declined to gate on, so
nothing is hidden. If you want the strict posture, ask for it: `"minSeverity": "info"`.

A passing result still reports the inventory — *"This scan has 4 finding(s), 4 of which the baseline
already had"* — because "nothing new" over four known findings and "nothing new" over none are
different sentences. A failing result lists each new finding as
`<severity> · <rule id> · <where> — <what>`, and those lines go straight into the pull-request
comment.

Two situations are **errors** (exit 2) rather than a verdict, for the same reason an incomparable
token delta is: the comparison would not have been on the same scale.

- The two reports were produced by **different analyser versions**, so a rule may have changed
  meaning underneath the comparison.
- Either scan produced **so many findings that the report was truncated**. "No new findings among the
  ones we listed" is not a verdict.

#### A worked quality gate

Also in the repository as
[`mcpfp.assert.suite.example.json`](../mcpfp.assert.suite.example.json):

```json
{
  "version": 1,
  "target": { "suite": "Nightly" },
  "baseline": "previous",
  "rules": [
    { "rule": "min-suite-score", "min": 0.8 },
    { "rule": "max-suite-cost", "maxUsd": 2.5 }
  ]
}
```

`"target": { "suite": "Nightly" }` uses the suite's newest run that has **finished and been fully
rated**. A run that is still going, one the cost cap soft-stopped, one an operator halted, one that
errored, and one that has finished but is still being reviewed are all **refused** with code 2 — never
scored. Reading a half-graded matrix as a mean grade would report a quality regression that is really
just the review still running.

#### What it prints

```
Server    Everything (demo) (JS8YDxdw9pvo3B1hS-keH)
Scan      r-3ZMS8fNiNfoBu6O0Qfs — 2026-08-19T20:25:56.402Z
Baseline  qN1p2LmT4vQ8sWx0aBcDe — 2026-08-18T09:12:41.008Z (asked for "previous")

PASS  max-server-tokens  Server tokens 1,729 within budget 3,000.
PASS  max-tool-count     13 tools within the limit of 30.
FAIL  max-tool-tokens    1 of 13 tools exceed the 200-token budget.
        gzip-file-as-resource — 249 > 200
PASS  no-new-tools       No tools were added against the baseline.
PASS  no-removed-tools   No tools were removed against the baseline.
PASS  max-scan-delta     Scan delta +12 tokens (+0.7%) vs baseline is within the allowance.

5 passed · 1 failed · 0 skipped
```

Note the **Baseline** line. You asked for `"previous"`; the app tells you the one concrete scan it
actually compared against, with its timestamp. That is what makes a stored result reproducible — you
can re-run the same comparison later by naming that id.

A quality gate prints the same shape, with the suite in place of the server:

```
Suite      Nightly (Fp2xQ8vLmT4wS0aBcDeRt)
Suite run  sr7YkP1nQwEr — 2026-08-20T09:00:00.000Z
Baseline   sr2MvB8xTzQa — 2026-08-19T09:00:00.000Z (asked for "previous")

FAIL  min-suite-score  Mean grade 0.79 is below the required 0.80.
PASS  max-suite-cost   Suite run cost $1.31 (execution $1.20 + judge $0.11) is within the $2.00 budget.

1 passed · 1 failed · 0 skipped
```

Formats: `human` (default), `json`, `markdown`.

- **`json`** is the same envelope every other command uses, with the full report in `data` —
  including each rule's `observed`, `limit` and itemized `details`.
- **`markdown`** is the **pull-request comment**: a pass/fail heading, what was asserted, the
  before-and-after against the baseline, a table of every rule, and a collapsed block for each
  failure. Write it to a file and post it from your pipeline:

  ```bash
  node apps/cli/dist/index.js assert --format markdown --output comment.md
  ```

  ```markdown
  ## ❌ mcpfp gate failed

  **Everything (demo) (JS8YDxdw9pvo3B1hS-keH)** · scan `r-3ZMS8fNiNfoBu6O0Qfs` · captured 2026-08-19T20:25:56.402Z

  Tokens 1,717 → 1,729 (+12, +0.7%) against scan `qN1p2LmT4vQ8sWx0aBcDe` (2026-08-18T09:12:41.008Z, asked for `previous`).

  | Rule | Status | Observed | Limit |
  | --- | --- | --- | --- |
  | `max-server-tokens` | ✅ pass | 1,729 | 3,000 |
  | `max-tool-tokens` | ❌ fail | 249 | 200 |

  <details>
  <summary>❌ max-tool-tokens — 1 of 13 tools exceed the 200-token budget.</summary>

  - gzip-file-as-resource — 249 > 200

  </details>

  <sub>mcpfp assertions v1 · evaluated 2026-08-19T20:26:03.117Z</sub>
  ```

  The same body renders identically every time it is asked for, and it carries **no credential and no
  path from your machine** — it is safe to post publicly. Posting it is your pipeline's job for now; a
  packaged GitHub Actions workflow that does it for you is planned.

**The format changes only how the result is written, never what it is.** A failing gate exits `1`
whether you asked for `human`, `json` or `markdown`, and a gate that could not run exits `2` in all
three.

#### When a rule cannot be evaluated

The three cases are deliberately **not** the same outcome, because two of them mean your gate did not
actually check anything:

| Situation | What happens | Exit |
| --- | --- | --- |
| This is the server's **first** scan (or the suite's first run), so there is nothing earlier to compare against. | The baseline rules report **SKIP** with a reason, and a warning naming each one goes to standard error. The pull-request comment says there is no baseline, and why. | **0** — a first run does not fail a build for having no history. |
| You **named** a baseline that does not resolve: an unknown id, a scan of a different server, a run of a different suite, a failed scan, a run that has not finished being rated. | An error naming the problem. | **2** — a typo must never quietly degrade into the case above. |
| The two scans are **not on the same scale** — a different token profile or counting method, where every difference would read as zero. | An error naming both profiles and both counting versions. | **2** — a `max-scan-delta` measured against a fake zero would pass every single time. |
| The suite run you named has **not finished**, or has finished but is **still being reviewed**. | An error naming the state it is in. | **2** — a half-graded matrix read as a mean grade reports a regression that is really just the review still running. |

The `--quiet` flag does **not** hide the skip warnings. "Be less chatty" must not be able to hide
"this rule did not actually run".

#### Overriding the file from the command line

```bash
mcpfp assert --scan <scanId>            # assert this exact scan, not the newest
mcpfp assert --server "Other server"    # assert a different server's newest scan
mcpfp assert --baseline <id>            # compare against this exact scan or suite run
mcpfp assert --file gates/strict.json   # same as passing the path as an argument
```

`--server` and `--scan` together is an error — they name two different targets. There is no
`--suite` flag: a quality gate names its suite in the file, and `--baseline` works for both kinds.

#### Permissions

Against a workbench on the same machine you need no token at all. A **remote** workbench needs a
token with the **Read** permission, and nothing more: the check only reads a scan (or a suite run)
the app already holds. It travels as a POST because it carries your gate file, but the workbench maps
this endpoint to **Read** by name rather than guessing from the request type.

### `report <what>` — pull a report the app already composes

```bash
pnpm mcpfp report scan   <scanId>     # the token-footprint report for one scan
pnpm mcpfp report server <scanId>     # the server-level report for that scan
pnpm mcpfp report run    <runId>      # the report for one session
pnpm mcpfp report fleet               # the whole install
```

These are the **same documents** the app's export buttons produce — `mcpfp` fetches them, it does
not re-render them.

Formats: `markdown` (and `human`, which is the same markdown), `json`.

```bash
node apps/cli/dist/index.js report fleet --format markdown > fleet.md
```

### `servers` and `scans` — find an id

```bash
pnpm mcpfp servers
pnpm mcpfp scans
pnpm mcpfp scans --server "Everything (demo)"
```

Newest scans first. Formats: `human` (default), `json`.

### `config show` — what did it resolve?

Covered above. Formats: `human` (default), `json`.

---

## Output, and how to read it in a script

**Standard output carries the answer. Standard error carries everything else** — progress lines,
warnings, failures. So a redirect gets a clean file:

```bash
node apps/cli/dist/index.js report scan <scanId> --format json > report.json
```

`report.json` contains the JSON and nothing else, every time.

- `--format json` wraps the app's own response in a small, stable envelope:

  ```json
  {
    "outputVersion": 1,
    "command": "report scan",
    "generatedAt": "2026-08-19T20:26:04.118Z",
    "apiUrl": "http://127.0.0.1:8099",
    "data": { }
  }
  ```

  `data` is exactly what the workbench returned. The envelope never carries a token.

- `--format markdown` is available on the `report` commands (the app's own report documents) and on
  `assert` (the pull-request comment). Asking for it anywhere else is an error naming the formats
  that command *does* support — never a silent fall back to a human table that a later step would
  fail to parse.
- `--output <file>` writes the answer to a file instead of standard output, creating folders as
  needed, and confirms on standard error.
- `--quiet` turns off the progress lines. It does not hide errors, and it does not hide the warning
  about a token stored in a config file.

## Exit codes

| Code | Meaning |
| --- | --- |
| **0** | It did what you asked. For `assert`: every rule passed. A rule that could not be evaluated yet is a loud SKIP, and still a 0. |
| **1** | **An assertion failed.** Only `mcpfp assert` returns this — no other command can. |
| **2** | It could not do what you asked: bad options, an unreadable config or gate file, an unreachable workbench, a refused request, a scan that failed, a suite run that did not complete, a baseline that could not be resolved. |

The distinction between **1** and **2** is the one that matters in a pipeline: "the check said no" and
"the check could not run" are different problems, and you want to be able to tell them apart. That is
why an unreachable workbench, a broken gate file and an unusable baseline are all **2** — none of
them is evidence that your footprint is fine.

## When something goes wrong

`mcpfp` turns the workbench's refusals into sentences rather than status codes:

| What you see | What it means |
| --- | --- |
| *No workbench API at `<url>` — is it running?* | Nothing is listening there. Check the URL and that the app is up. |
| *This instance requires a service token…* | You are reaching a workbench from outside its own machine (or it runs with `API_AUTH_REQUIRED=true`). Create a token in **Settings → API tokens**. |
| *The service token was rejected (unknown, revoked or expired).* | The token is not one this workbench knows any more. Create a new one. |
| *The token authenticated but lacks the scope for this request.* | Right token, wrong permissions. For `scan` it names the one it needs: **Run scans**. |
| *That feature is switched off in Settings › Features.* | A capability the request needed is turned off in the app. |
| *That is not a workbench token…* | The value you passed is not shaped like one — usually a truncated copy or the wrong secret. Nothing was sent. |

---

## What is not built yet

One planned piece is not in it:

- **Posting the pull-request comment for you** — a packaged GitHub Actions workflow that runs the
  gate and puts `--format markdown`'s output on the PR. *(Work package 2.3.)* The comment **body**
  is built today: `mcpfp assert --format markdown` writes it, and any pipeline can post it.

Assertions cover **footprint and change** (tokens, tool counts, added and removed tools) and **suite
quality** (a minimum mean score, a maximum cost). Rules about *security findings* arrive with a later
work package, on the same file and the same exit codes.

So today: `scan` + `assert` gates a footprint, `suite run` + `assert` gates a suite's quality and
cost, `assert --format markdown` writes the comment, and `report … --format json` records any of it.
