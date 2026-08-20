# AI Workbench

**A local workbench for understanding, testing, and validating how MCP servers and Agent Skills
behave inside real AI sessions — what they cost, where they break, and how to fix them.**

*(This is the **`mcp-token-footprint`** repository. The product began as a token-footprint analyzer
and grew into a full session workbench — which is how it now presents itself in-app: **AI Workbench —
MCP analyzer**. The two names refer to the same thing.)*

![The workbench dashboard — total startup tokens across every server, what needs attention, and the latest footprint of each server.](docs/screenshots/dashboard.png)

> Runs entirely on your machine · one Docker container on port `8080` · React 19 + Fastify +
> SQLite · connects to MCP servers over stdio and streamable HTTP · drives them through real
> multi-provider LLM agent loops. No accounts, no cloud.

---

## What it is

An **AI session** is where everything comes together: the model, the MCP servers that give it tools,
and the Agent Skills that give it instructions. Each of those adds to the model's limited context
and shapes how the assistant behaves. When a session is slow, expensive, or simply gives the wrong
answer, the cause is usually buried in that interaction.

AI Workbench brings it into the open — **measured, reproducible, and testable** — so you can
move from "something feels off" to a concrete, verified fix. Connect to one server or many, extract
their entire tool surface, count what those definitions actually cost a model, run the server through
a live agent loop, watch the session play out turn by turn, have every run **automatically graded**
for what went wrong and why, and compare any two things: a server against its own past, two servers
against each other, or two sessions side by side.

Your servers, your credentials, and your data never leave the machine. Secrets are encrypted before
they touch the database and are never returned by the API.

## Who it's for

- **Operators & end users** — see how your skills and servers fit together, what each one costs in
  context, and how a session actually unfolds. Stop guessing about why an assistant behaves the way
  it does.
- **Presales, CSEs & technical field teams** — understand a session end to end, pinpoint exactly
  where an issue is, and demo or support from evidence instead of intuition.
- **Skill & MCP developers** — automated issue detection plus a closed test-and-fix loop turn
  "something's wrong" into a reproducible problem and a proven fix, without leaving the app.
- **MCP server owners** — analyze and validate your servers, track how they evolve, and run
  long-running quality gates so regressions are caught before they reach a user.

## What sets it apart

- **Real measurement, not estimates.** It counts the actual context cost of tools, skills, and live
  calls the way a model does — with real tokenizer BPE, over the serialized payload that is actually
  sent to the model.
- **Sessions, not just definitions.** It shows skills and servers *working together* in a real agent
  session, not only their static descriptions.
- **Automatic issue detection.** Every terminal run is reviewed automatically — did it answer the
  question, was the surplus valuable, what errored and why — so problems surface without a manual hunt.
- **Closed-loop test-and-fix.** A failing run can file a tracked issue against the skill or server
  involved, with a drafted fix you can apply yourself or hand to the built-in Assistant — then re-run
  and verify.
- **Compare anything.** Diff a server against its own history, two servers against each other, two
  runs turn by turn, or two agent configurations head-to-head.
- **Fully local.** Everything runs on your machine, so sensitive setups and credentials never leave it.

---

## Take the tour

### 1 · Connect servers and measure their footprint

Add an MCP server (stdio command or streamable-HTTP URL), test the connection, and run a **discovery
scan**: `initialize` + `tools/list` (names, descriptions, input schemas, annotations) plus
`resources/list` and `prompts/list`. Every tool is ranked by how many tokens its definition costs a
model — broken down into schema, description, and raw bytes, with each tool's share of the total.

Token counting uses **real `js-tiktoken` BPE** for the `o200k` and `cl100k` families (rank data
bundled, so it works offline), plus two heuristic profiles for quick estimates. A tool's total is
the count of the **serialized provider payload** actually sent to a model — not the sum of isolated
facets — and every scan is stamped with a counting version so results from different methods are
never silently compared.

![A scan of an MCP server: 60 tools, 48,614 tokens, every tool ranked by footprint with schema / description / bytes / share.](docs/screenshots/scan-footprint.png)

### 2 · Server health, findings, and token advice

Each server has its own home with a footprint summary, a per-tool token distribution, and
**evidenced findings** ranked by severity — the heaviest tools, names that risk hitting length
limits, schemas using unsupported keywords, definitions that crowd a model's context window — each
with a concrete recovery and an estimate of the tokens you'd get back.

![The barc-benchmark server: 64,522 startup tokens, findings graded blocker → low, and where every token goes per tool.](docs/screenshots/servers.png)

### 3 · Compare — over time and across servers

Track a server against its own previous scans (added / removed / changed tools, token deltas), or put
two **different** servers side by side. Tool-level comparison matches tools exact → normalized →
fuzzy, so you can see the same tool across servers and exactly how their token costs differ.

![Cross-server compare: a baseline and a comparison scan, tool-level deltas, 17 tools added, +15,908 tokens (+32.7%).](docs/screenshots/compare-scans.png)

### 4 · Skills — register, inspect, attach

Register an [Agent Skill](https://agentskills.io) by uploading a `.zip`/`SKILL.md` or importing a
GitHub repo, version it, and inspect its **L1/L2/L3 token footprint**, its rendered `SKILL.md`, its
triggers and command entry points, and a **security surface** (script files and languages, network
references, file and byte totals). Skills can be attached to test scenarios — exposed to the agent
read-only and metered, **never executed**.

![The skill inspector: frontmatter, an L1/L2/L3 token footprint totalling 1,760, the trigger configuration, and a security surface.](docs/screenshots/skill-inspector.png)

### 5 · The testing console — real agent sessions

Drive a server through a **real LLM agent loop** across multiple providers and watch the whole
session: the conversation, every tool call and result, a live KPI rail (context used, estimated cost,
tokens sent/received, tool calls, turns), hotspots (slowest and costliest steps, largest context
jump), and a per-turn context-window chart. Runs are fully persisted, so any run replays exactly.

![The run console: a real agent session — 13 tool calls across 14 turns, a live KPI rail, hotspots, and a per-turn context chart.](docs/screenshots/run-console.png)

### 6 · Automatic run rating

Every terminal run is graded automatically — **answer validation** (did the final answer address the
prompt, with cited evidence), **insight surplus** (was the extra content valuable or just padding),
and **error forensics** (root-cause buckets and fix targets) — using a Claude-CLI-first judge chain
that falls back to a provider judge or deterministic graders. It's a separate dimension from
expectation grades and never changes their meaning.

![The Run rating tab: answer validation at 100% with cited steps, insight surplus, and a rating radar.](docs/screenshots/run-report.png)

### 7 · MCP × model compatibility

See how a server's tool surface holds up across models. The heatmap scores every tool (or the whole
server) against a roster of models — within limits, near limits, below the floor, not tested — with
per-cell issue counts, and is honest about the concerns that still need a human review.

![The compatibility heatmap: tools scored across Claude Opus 4.8, GPT-5.5, Gemini 3.5 Flash, Claude Haiku 4.5, and Phi-4.](docs/screenshots/compatibility.png)

### 8 · The runs feed — your session fleet

Every run and suite-run in one searchable, filterable feed with running totals (tokens, cost, failure
rate). Suite-runs expand into their member sessions; drill into any one to open its console. Runs can
be compared, reviewed, and turned into repeatable suites.

![The unified Runs feed: 76 runs, 70.6M tokens, $90.64, a 6.6% failure rate, with grades and durations.](docs/screenshots/runs-feed.png)

### 9 · The Assistant and the multi-agent Hub

A built-in **App assistant** dock operates the current page on your behalf — analyze this scan,
triage this failed run, edit this skill into a new version (approval-gated). Alongside it, a
full-page **Assistant Hub** is a general-purpose, multi-model workspace: chat, citations-first
research, and **missions**, where a planner proposes a team of subagents (roles, models, tool grants,
budgets) that run in parallel and synthesize a cited answer. Saved agents and crews live in a
directory you can browse, reuse, and cost-track.

![Agents & Crews: 9 saved agents organized into 10 crews, each with its model, tools, skills, and run history.](docs/screenshots/hub-agents.png)

### 10 · The bench itself, MCP-operable

The workbench serves its own **read-only MCP server** at `/api/mcp` (streamable HTTP), so an outside
agent — a Claude Code session, a Cursor window, a CI job — reads what the bench has already measured
without a browser: servers and scans with per-tool footprints, runs with their grades and reports,
skills with their footprint and security surface, suites, collections and compatibility. It is
read-only, returns no secret values, and lives behind a Settings › Features switch. Point a host at
`http://127.0.0.1:8080/api/mcp`, or read the generated usage page it serves at
[`/api/mcp/llms.txt`](http://127.0.0.1:8080/api/mcp/llms.txt); the owner-facing walkthrough is
[Workbench agent playbook](user-guide/20-workbench-mcp-server.md). We hold it to our own standard:
`pnpm mcp:self-scan` points the app's discovery scanner at its own mount and fails if the tool
definitions exceed their token budget (currently **21 tools · 2,224 tokens** against a 3,000 budget).
The same gate is yours to run: the `mcpfp` CLI plus two copyable workflows in
[`examples/github-actions/`](examples/github-actions/) fail a pull request when a server's footprint
(or a suite's quality) moves outside budget — see
[Gating a pull request](user-guide/23-ci-github-actions.md).

> **Also on board:** export any scan, server, or run as **JSON or Markdown**.
> See the [user guide](user-guide/README.md) for the full picture.

### Two themes

The whole app is built on the upstream `@elabs-ai/components-*` design system and reads correctly in **Light**
and **Dark**, with a **System** option that follows your OS preference. Switch it in Settings or
the top bar.

![The dashboard in Dark.](docs/screenshots/dashboard-dark.png)

---

## Run it

### With Docker (recommended)

```bash
docker compose up --build
```

Then open **http://localhost:8081** (the container listens on 8080 internally; 8081 is the
published host port — see `docker-compose.yml`). The single container runs the API, which serves the built web
app. Keep the SQLite database and the generated encryption key on the same persistent `/data` volume.

### Local development

```bash
pnpm install     # pnpm 9.15.4 workspace — not npm/yarn
pnpm dev         # API on :8080, Vite on :5173 (proxies /api → :8080)
```

Quality gate — run it locally; **no workflow runs it** (the repo's only workflow is
`.github/workflows/mcp-self-scan.yml`, the MCP definition-footprint budget gate):

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm lint
```

### Connecting an MCP server

The server wizard is **URL-first** for streamable HTTP: enter a URL, the API probes it
unauthenticated, and only if it returns `401`/`403` does it ask for auth — a bearer token, an
API-key header, custom headers, or OAuth. Bearer/API-key headers and OAuth tokens are encrypted
before they're persisted.

The default OAuth callback is `http://127.0.0.1:8080/api/oauth/callback` for a local `pnpm dev`
run; the Docker container publishes 8081 and sets `OAUTH_REDIRECT_URL` to match (override with
`OAUTH_REDIRECT_URL`). Providers without Dynamic Client Registration need a pre-registered OAuth client id — create an
OAuth client in the provider's admin UI with scopes
`user_default` and `mcp:execute`, add the callback as an allowed redirect URL, and enter the Client
ID in the wizard.

When running in Docker, server URLs resolve from **inside** the container: use
`http://host.docker.internal:<port>/mcp` to reach an MCP server that publishes a port on your Mac
host.

---

## How it's built

A **pnpm TypeScript monorepo** (ESM, strict mode):

```
apps/
  api/       Fastify 5 API — SQLite (better-sqlite3), MCP client, token counting,
             scan/run orchestration, OAuth, reports; serves the web build in production
  web/       React 19 + Vite SPA — react-router-dom v7, the @elabs-ai/components-* design system
packages/
  shared/    the API contract — types.ts, schemas.ts (zod), constants.ts
```

- **Runtime boundary:** the API is the *only* process that spawns MCP stdio commands, makes MCP HTTP
  calls, or decrypts secrets. The browser only ever receives **redacted** configs (booleans like
  `hasEnvSecrets`, never values).
- **Contract-first:** anything touching the wire changes in `packages/shared` first (type + zod
  schema), then the API, then the web app.
- **Persistence:** one SQLite file, evolved through `PRAGMA user_version`-gated migrations.
- **Multi-provider inference** via the Vercel AI SDK (`@ai-sdk/*`); per-model pricing lives in code,
  and the cost cap rejects unpriced models.
- **Tooling:** Biome for lint/format (no ESLint). The four-command quality gate is run **locally** —
  there is no `ci.yml`. The repo's only workflow is `.github/workflows/mcp-self-scan.yml`, which
  asserts the workbench MCP server's own definition-token budget. Copyable CI gates for *your*
  repository live in [`examples/github-actions/`](./examples/github-actions/) — see
  [`user-guide/23-ci-github-actions.md`](./user-guide/23-ci-github-actions.md).

## Data & security

This is a local/dev tool with no authentication by design.

- MCP `env`/`header` secrets and all OAuth material are **encrypted before** SQLite persistence and
  are **never returned** by the API.
- The encryption key is `MCP_SECRET_KEY` (base64, 32 bytes) or an auto-generated
  `DATA_DIR/mcp-secret.key`. Losing **both** the key and the file makes stored secrets unrecoverable
  — keep the key on the same persistent `/data` volume as the database.
- Tool execution runs in the API, validates arguments against the tool's input schema, and treats
  tool output as untrusted.

The embedded Assistant runs the `@anthropic-ai/claude-agent-sdk` in-container on the owner's Claude
subscription (or an Anthropic API key) and needs outbound HTTPS to `api.anthropic.com` and
`claude.ai`. Its full egress, concurrency, and retention notes are in the
[architecture rules](.claude/rules/) and [`CLAUDE.md`](CLAUDE.md).

## Project status & further reading

This project evolves quickly. The authoritative, per-capability picture of **what is built vs.
planned** lives in:

- **[`CLAUDE.md`](CLAUDE.md)** — the capability table and working rules (start here).
- **[`roadmap/*/STATUS.md`](roadmap/)** — the in-flight ledgers, authoritative for per-work-package
  status.
- **[`CHANGELOG.md`](CHANGELOG.md)** — notable changes over time.
- **[`user-guide/`](user-guide/README.md)** — a task-oriented guide written for people who *use* the
  app (key concepts, connecting servers, testing, comparing runs, the Assistant, and
  more).

## The design system

The UI is built entirely on the upstream **`@elabs-ai/components-*`** design system (brand-ui) at
**`^4.0.0`** — every visible element is a `@elabs-ai/components-*` component, styled with Tailwind v4
+ semantic oklch tokens (no raw colors). The packages are **public on npmjs.org**, so `pnpm install`
needs no registry configuration and no token. Every package ships in lockstep at the same version.

Two themes are exposed, **`light`** (default) and **`dark`**; theme CSS is opt-in per theme, imported
in `apps/web/src/styles/app.css`. For the real component API use the CLI —
`pnpm exec brand-ui docs <Component>` — which is also wired as an MCP server in
[`.mcp.json`](.mcp.json); a generated snapshot lives at
[`docs/brand-ui-context.md`](docs/brand-ui-context.md). See the
[UI rules](.claude/rules/brand-ui-only.md), [dependency rules](.claude/rules/dependencies.md) and
[styling & tokens](.claude/rules/styling-and-tokens.md).

---

<sub>Screenshots are captured from the running app against a live local instance. The helper
`scripts/readme-screenshots.mjs` is included for reference — its entity ids are instance-specific and
would need updating for another database.</sub>
