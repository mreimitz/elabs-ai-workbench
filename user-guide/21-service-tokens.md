# 21. Service tokens — reaching the workbench without a browser

Everything else in this guide assumes you are sitting in front of the app. This page is about the
case where something else is: a build pipeline that wants to fail a pull request when an MCP server
gets more expensive, a command line, or an AI assistant on another machine.

A **service token** is the credential those callers present instead of a browser session. You create
one in **Settings → API tokens**, copy it once, and paste it into whatever needs it.

## Do you actually need one?

Probably not, if you only ever use the app on the computer it runs on.

The workbench keeps its original posture: **a request from the same machine passes without a token,
exactly as it always has.** Nothing about opening `http://localhost:8081` in your browser changes.

You need a token when the caller is **somewhere else** — another machine on your network, a CI
runner, a container reaching in from outside. Those requests are refused unless they carry one.

## Create a token

1. Open **Settings → API tokens**.
2. Press **Create token**.
3. Give it a **name** you will recognise later — the name is how you tell your tokens apart when you
   come back to revoke one. "CI — footprint gate" beats "token 2".
4. Tick only the **permissions** the caller actually needs (see below).
5. Optionally set an **expiry date**. Leave it empty for a token that never expires; you can revoke
   it by hand at any time either way.
6. Press **Create token**.

### Copy it now — you will not see it again

The workbench stores your token **scrambled**, the way a well-behaved app stores a password. That is
deliberate: if someone got hold of the database, the tokens in it would be useless to them. The
consequence is that **the app itself cannot show you the token a second time** — there is nothing
left to show.

So the moment after you create one, it appears once, in full, with a copy button. Copy it into
wherever it needs to live (your CI secret store, your shell profile, your assistant's config) before
you close that dialog.

Lost it? Revoke it and create another. That is the whole recovery procedure, and it is fine — tokens
are cheap.

## Permissions

A token carries only the permissions you tick:

| Permission | What it allows | The MCP tool it unlocks |
| --- | --- | --- |
| **Read** | Read everything the workbench has already measured — servers, scans, sessions, grades, skills, suites, reports. Needed by any caller that just wants to look. | every read tool — and connecting at all |
| **Run scans** | Start a discovery scan of a server you have registered. | `scan_run` |
| **Launch runs** | Start a test run — a collection's tests, or an explicit list of them. | `run_plan_start` |
| **Run suites** | Start a saved suite's mass-run. | `suite_run_start` |

The right-hand column is what the same permission unlocks for an assistant on the workbench's own
[MCP endpoint](./20-workbench-mcp-server.md). Each of those three tools needs its permission **plus**
Read, because Read is what lets a caller open that endpoint in the first place. They are also three
separate permissions on purpose: "Launch runs" will not start a saved suite, and an assistant that
tries is told to ask you for "Run suites" instead.

Two limits are built in and are **not** switchable:

- **No token can delete anything.** Not scans, not sessions, not servers — whatever permissions you
  give it. Deleting stays something you do yourself, in the app.
- **No token can create or revoke other tokens.** A leaked token cannot mint replacements for
  itself, so revoking it genuinely ends its access.

### Which permission does a caller need?

The rule of thumb is "reading needs Read, doing needs the matching permission". Two things look like
doing but are not, so they are called out here rather than left to be discovered:

| The caller wants to… | Ticks |
| --- | --- |
| Read anything the workbench has measured | **Read** |
| Connect an assistant to the workbench's own [MCP endpoint](./20-workbench-mcp-server.md) | **Read** |
| Check a footprint gate (`mcpfp assert`) | **Read** |
| Start a discovery scan | **Run scans** |
| Start a test run | **Launch runs** |
| Start a suite mass-run | **Run suites** |
| Let a *remote assistant* start a scan for you | **Read** + **Run scans** |
| Let a *remote assistant* start a suite for you | **Read** + **Run suites** |
| Let a *remote assistant* launch a run plan for you | **Read** + **Launch runs** |

The MCP endpoint and the gate check are the two that surprise people: both are pure reads that
happen to be sent as a `POST`, so *connecting* asks for **Read** and nothing more. In particular, a
token with *only* "Run scans" cannot connect an assistant to the workbench at all — listing what an
assistant can do is itself a read, so **Read is the price of admission**. That is why the last three
rows say Read *plus*: an assistant that takes actions needs both, and ticking only the action
permission gets it shut out at the door instead of let in with less power than you meant.

## Use a token

Send it as an `Authorization` header:

```bash
curl -H "Authorization: Bearer mcpfp_your_token_here" \
     http://192.168.1.20:8081/api/scans
```

If the token is missing, wrong, revoked, or past its expiry date, the request is refused with a
`401`. If the token is valid but lacks the permission that request needs, it is refused with a `403`.

Three things already accept a token: direct HTTP calls like the one above, the
[`mcpfp` command line](./22-mcpfp-cli.md), and the workbench's own
[MCP endpoint](./20-workbench-mcp-server.md#connecting-from-another-machine) — where the token goes
in the assistant's config as an `Authorization` header, and each tool on that endpoint checks the
permission it needs before it runs.

## Revoke a token

In **Settings → API tokens**, press the bin icon on its row and confirm. Revocation is **immediate**
and cannot be undone — anything still using that token starts being refused straight away.

The list also shows when each token was **last used**, which is the quickest way to spot one nothing
needs any more. (It is accurate to about a minute — the workbench deliberately does not re-record it
on every single request.)

## Locking down the local machine too

By default the computer running the workbench needs no token. If you want to require one even there
— a shared machine, or a container whose port you would rather treat as public — set the environment
variable:

```
API_AUTH_REQUIRED=true
```

and restart the app. Every request then needs a token, including from your own browser.

Two things to know before you flip it:

- **Your browser has no token to give**, so the app's own screens stop loading. This setting is for
  an instance nobody uses through the UI.
- **Create the tokens you need first.** Because no token can manage tokens, once this is on there is
  no way to add or revoke one until you turn it back off.

The health check (`/api/health`) keeps answering either way, so container orchestration and uptime
monitoring are unaffected.

## Where tokens sit in the bigger picture

- [Workbench agent playbook](./20-workbench-mcp-server.md) — pointing an AI assistant at the app.
  On your own machine that needs no token; from anywhere else it needs one with **Read**, plus
  **Run scans** / **Launch runs** / **Run suites** for each action you want it to be able to take.
- [The `mcpfp` command line](./22-mcpfp-cli.md) — scans, reports and footprint gates from a script.
- [Settings](./13-settings.md) — the rest of what lives in Settings.
- [Troubleshooting & FAQ](./14-troubleshooting.md) — if a call is being refused and you are not sure
  why.
