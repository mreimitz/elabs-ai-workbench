# 22. The `mcpfp` command line — scans and reports from a terminal

Everything the workbench measures is reachable from a browser. This page is about doing the same
things **from a terminal or a build pipeline**: run a scan, pull a report, list what is registered —
without clicking anything, and with output a script can read.

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

- `--format markdown` is available on the `report` commands only. Asking for it anywhere else is an
  error naming the formats that command *does* support — never a silent fall back to a human table
  that a later step would fail to parse.
- `--output <file>` writes the answer to a file instead of standard output, creating folders as
  needed, and confirms on standard error.
- `--quiet` turns off the progress lines. It does not hide errors, and it does not hide the warning
  about a token stored in a config file.

## Exit codes

| Code | Meaning |
| --- | --- |
| **0** | It did what you asked. |
| **1** | **An assertion failed.** Reserved for `mcpfp assert`, which is not built yet — nothing in this version returns it. |
| **2** | It could not do what you asked: bad options, an unreadable config file, an unreachable workbench, a refused request, a scan that failed. |

The distinction between **1** and **2** is the one that matters in a pipeline: "the check said no" and
"the check could not run" are different problems, and you want to be able to tell them apart.

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

This is the first version of the command line. Three planned pieces are not in it, and `mcpfp` will
tell you it does not know the command rather than pretending:

- **`mcpfp assert`** — a versioned assertions file (max tokens per server or tool, no new or removed
  tools, a maximum change against a baseline) evaluated by the app and failing the build with exit
  code 1. *(Work package 1.3.)*
- **`mcpfp suite run`** — trigger a suite mass-run, follow it, and summarize the result.
  *(Work package 2.1.)*
- **The pull-request comment artifact** — a markdown summary of what changed against a named
  baseline, ready to post on a PR. *(Work package 2.2.)*

Until then, `scan` plus `report … --format json` is enough to record a footprint in CI and compare it
yourself.
