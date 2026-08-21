# Changelog

All notable changes to MCP Token Footprint. This project is single-owner and versioned loosely; the
authoritative in-flight state lives in [`CLAUDE.md`](./CLAUDE.md) and the
`planning/Roadmap/RM-*/STATUS.md` ledgers (before 2026-08-20 these were `planning/Roadmap/*/STATUS.md`;
entries below that date name the paths as they were at the time). Per-phase git tags are an **owner action** (not created by this remediation).

## Unreleased — the app can draw itself

There is a new page at **`/illustrations`**, and it is the first thing you can look at from the
illustration workstream. It lists the app's own isometric drawings — an **MCP server**, a **skill**
and an **LLM agent** — and they are live components rather than exported images, so switching the
theme repaints every one of them. That is the whole point of how they are built: not one drawing
names a colour, so a theme nobody has drawn them in still lights them correctly.

Open one and you get it at all five **states**, at all three **footprints** framed against a single
box so the size difference you see is the real one, at each of its **variants** (a server as stdio or
as streamable-HTTP; a skill as one sheet or as a version stack), facing upstream and downstream, and
its catalog entry — ports, keywords, tier, registry version. A **port overlay** switch marks the
named attachment points a future diagram would connect lines to.

A second tab carries the drawing vocabulary the three are composed from — the paper stage, the
platform and housing solids, the glyph frame, the construction ghost, the six connector kinds, the
calibration cube. Every entity is built only from those parts; a test refuses any entity whose
rendered output contains a hand-drawn path at all.

**What this is not, yet.** There is no scene composition: you cannot lay several of these out into a
diagram, there is no step-by-step explainer, and you cannot describe a workflow to the assistant and
get a picture back. Those are the next phases. The page is also route-only — there is no sidebar
entry for it yet, so reach it by address.

## Unreleased — the two assistants get their own switches

Settings › Features carried one switch called **Assistant**. Turning it off did what it said and
rather more: the full-page Assistant workspace disappeared from the sidebar *and* so did the
App-assistant dock on the right-hand side of every page — two unrelated surfaces sharing one
off-switch, with no way to keep one and drop the other.

**They are now two switches.** *Assistant workspace* covers the `/assistant` pages and their sidebar
group. *App assistant* covers the right-hand dock, its ⌘J shortcut and the “Ask the assistant”
buttons that open it. Each turn-off confirmation names only its own surfaces, and turning either one
off leaves the other exactly as it was.

The Claude sign-in in Settings › Assistant belongs to neither and survives both: the workspace runs
on that same credential, so switching the dock off can no longer lock you out of signing in.

An instance that already had the Assistant switched off keeps the **workspace** off. The dock is a
newly separate capability and arrives on, like every other feature does.

## Unreleased — the list rail becomes a place

Servers, Skills and Collections used to be a fixed 288-pixel list column beside a detail pane. One
server row squeezed a name, a health dot, a health chip, a token total, a posture band, a transport,
an auth kind and an endpoint into that column, which truncated the names to `barc…`, `qlik-…`, `m…`
— and it charged every detail page 288 pixels for a list you look at once.

**Each of those three is now an overview page.** Opening MCP Servers shows the whole fleet as a grid
of cards grouped by server type, switchable to a grouped table and remembered per section (the mode
also rides in the URL, so a view can be shared). Skills group by source, Collections by whether they
are bound to a git repo. Selecting one opens its **full-width** detail page.

**Switching entities moved into the breadcrumb.** The crumb now reads
`Home › MCP Servers › [barc-benchmark ▾]`, and clicking the last part opens a searchable, grouped
list of every server — the same grouping the overview uses. Clicking `MCP Servers` goes back to the
overview.

Three smaller corrections fell out of it: landing on `/servers` or `/skills` no longer teleports you
to whichever entity happened to sort first (the address you typed is the page you get); deleting the
entity you are looking at returns you to its overview instead of swapping the page's subject for an
unrelated one; and an address naming a server or skill that does not exist now says so, rather than
showing a "nothing selected" prompt for a state that can no longer happen.

The screenshots in the README still show the previous layout.

## Unreleased — the bench takes its own medicine

We pointed the new security analyzer at the workbench's **own** MCP mount and it returned **49/100,
band `high`**. Reading the findings changed three things — two in the analyzer, one in the mount.

**The analyzer was wrong twice, and is now tighter.** `annotation.open-world-unmarked` matched its
whole term list in a tool's *description* as well as its name, and a description names what a tool
**returns** as often as what it does — so it flagged `servers_list` for the word "url" in *"transport,
command/url, auth kind"* and `skills_list` for "upload" in *"source (upload/GitHub)"*. Neither tool
reaches anything; both read the local database. The term list is now split: a tool's **name** keeps
every term, while its **description** accepts only unambiguous action inflections (`fetches`,
`downloads`, …). Both real false positives are regression fixtures now, verbatim.

**The score was measuring surface size, not risk.** The deduction was an unbounded sum, so 49 hygiene
nudges — zero errors, zero warnings — dragged the mount into the same band as a server carrying three
genuine tool-poisoning errors. Each severity now deducts at most a documented cap: `info` stops
counting after 10 findings, `warning` after 5, and `error` is **uncapped** on purpose. Hygiene is a
bounded concern; there is no honest ceiling on the number of separate ways a server can be trying to
steer a model. An `info`-only report now floors at 90/`low`.

**And the mount really did deserve 49 findings.** It declared 49 parameters with **no description at
all** — an agent could not tell whether `runs_list`'s `since` wanted a timestamp or a run id. All 49
are described now, tersely. That costs 434 tokens, which took the definition footprint past its own
3,000-token budget, so the budget was raised to **3,500** — deliberately, with the reasoning written
into the constant: there was no fat left to trim, and leaving parameters undescribed to keep a number
under a line we drew ourselves is exactly what we would criticise a vendor for.

The mount now measures **24 tools · 3,183 tokens** and scores **100/100, `clean`** against its own
analyzer. `SECURITY_ANALYZER_VERSION` moved 1 → 3, so reports from different builds are refused for
comparison rather than silently diffed.

## Unreleased — security posture, on the page

The deterministic security analyzer built over the previous four work packages is now **visible**.
Every scan and every skill version has a **Security tab**: findings worst-first, each naming the rule
that fired, what it fired on, and the matched evidence. Invisible characters are rendered visibly as
`\uXXXX` — surfacing them is the entire point of the rule that finds them — and anything
credential-shaped is masked to `«redacted»` before it reaches the screen. A 0–100 score and a risk
band sit above the list; the servers list carries a posture badge per server, fed by **one**
`GET /api/security/summary` request rather than one per row.

Pick a baseline and the tab becomes a diff — added, resolved, carried over — with the selection in
the URL, so the state is shareable and survives a reload. **A comparison that cannot be trusted is
refused rather than answered**: two different servers, a server against a skill, two different
analyzer versions, or a report whose list was truncated each produce an explanation with the current
report still on screen. A subject with nothing wrong says so and names what was checked, because a
blank panel is indistinguishable from a broken one.

The analyzer itself reads only what the app has **already stored** — no MCP connection, no skill
execution, no network — and persists nothing: every posture answer is computed on read. Eighteen
frozen rules: eleven over a server's tool surface (injection phrasing, hidden instruction blocks,
invisible unicode, annotations that contradict their own tool, credential-shaped parameters,
unconstrained schemas, OAuth scope breadth) and seven over a skill (the same steering heuristics over
`SKILL.md`, a credential in the body, a wildcard `allowed-tools` grant, shipped scripts, network
references).

The CI gate's `no-new-security-findings` rule was re-pointed at the same comparison the tab uses, so
the page and the pull request cannot disagree about which findings are new. Its own test file was
left byte-identical through that change, which is the proof no gate behaviour moved.

Exported **scan and server reports** now carry the posture too, in JSON and Markdown alike: score,
band, analyzer version, per-severity counts, the findings and their redacted evidence, in a fixed
greppable shape built in exactly one file. A subject that cannot be scored — a scan that failed, a
skill whose `SKILL.md` is not readable text — exports successfully with one honest line saying so;
it never fails the download, and it never renders as clean. (There is no skill *report* endpoint
today, only a zip download of a version's files, so the skill half of that integration is not built
rather than invented.)

No migration, no new dependency, no feature flag.

## Unreleased — one governed home for research, planning and the guide

Every research, roadmap and user-guide document now lives in a single **Open Knowledge Format
bundle** at [`planning/`](./planning/), and the rules that keep it honest are mechanical rather than
cultural.

Each investigation is a tagged `RS-NN` topic, each initiative a tagged `RM-NN` item with its own
`STATUS.md` work-package ledger, and each part of the system a tagged `DC-NN` documentation subject
that holds both the record of what shipped and that part of the manual. Tags are two digits,
allocated atomically and never reused, so a cross-reference stays valid for the life of the project.
The loose `planning/Research/`, `planning/Roadmap/` and `planning/user-guide/` trees are gone; 569 documents moved into tagged
folders and every internal link was re-pointed.

**A plan can no longer be quietly "finished".** Work is planned as an `RM` item, built against its
ledger, recorded in a `DC` subject as *what shipped versus what was planned*, and then retired by a
transactional command that refuses while any ledger box is still open. Five finished initiatives —
the Assistant Hub UX rebuild, Interface Craft, server types, Toolbar Reach and Unified Sessions —
went through that path and now sit in `planning/Roadmap/completed/` with their deliveries, their
deviations and their unverified gaps recorded against the subjects they shipped into.

**Enforcement runs at the moment of the edit.** A pre-write hook rejects a `README.md` inside the
bundle, a by-hand `status: "done"` flip, a document that lands outside its domain folder, or a
meaningful edit that leaves its timestamp untouched; a post-write hook revalidates the whole bundle;
and both conformance layers plus the bundle's own 34 tests run in CI. `pnpm okf:validate`,
`pnpm okf:sync` and `pnpm okf:test` are the local equivalents. The lifecycle is written down as §11
of [`CLAUDE.md`](./CLAUDE.md), and `/next-wp` now closes a plan out rather than stopping at the last
tick.

No application behaviour changed. The one code-visible consequence: the model-comparison dataset the
compatibility engine builds from now reads from
`planning/Research/RS-01-token-context-comparison/outputs/data/**`.

## Unreleased — headless automation: the bench is operable by machines

The **CI & headless automation** workstream is complete (all 11 WPs, Phases 1–3 + Phase MCP,
decisions **D-C1–D-C22** and **D-MCP1–D-MCP13**), and **security-posture Phase 1** landed with it
(WPs 1.1–1.2, decisions **D-SP1–D-SP11**). Everything the bench measures is now reachable three ways
— over MCP, from a terminal, and from a build pipeline — through the same API, so all three give the
same numbers. Authoritative per-WP state: [`planning/Roadmap/RM-08-ci/STATUS.md`](./planning/Roadmap/RM-08-ci/STATUS.md) and
[`planning/Roadmap/RM-20-security-posture/STATUS.md`](./planning/Roadmap/RM-20-security-posture/STATUS.md).

**The workbench MCP server can now act, not only read.** The `/api/mcp` mount grew three write tools
— `scan_run` (`scan:run`), `suite_run_start` (`suites:run`), `run_plan_start` (`runs:launch`) — one
per execute scope in the frozen D-C4 vocabulary, each re-projecting a service the HTTP API already
exposes. A write tool answers with a **ticket, not an outcome**, and names the read tool that polls
it; both launch tools carry the launcher's own advisory cost estimate (`buildRunPlanEstimate`,
re-projected by import). `run_plan_start` refuses `source: "suite"` twice — the enum has no such
member and the handler names `suite_run_start` — so `runs:launch` is never a back door onto a saved
suite. **Nothing on the surface deletes, prunes, revokes or edits configuration, at any scope, at any
phase** (D-MCP3, made mechanical by a test over the registered tool names). WP M.2's scope gate
absorbed the first tools that actually need it with **zero change to itself**. The mount now measures
**24 tools · 2,749 definition tokens** against the **unchanged** 3,000 budget.
`createWorkbenchMcpServer`'s `caller` parameter lost its allow-everything default (D-MCP13) — a
default-open parameter in an authorization path is a latent privilege escalation.

**`mcpfp suite run`** starts a saved suite's matrix and waits for it by **polling**, not by consuming
the SSE stream (an event-stream parser is exactly the dependency D-C5 refuses). `completed` exits
**0**; `error`, `capped`, `stopped` and an exhausted wait budget all exit **2**; nothing here can emit
`1`, which stays reserved to `mcpfp assert`. The wait covers the post-run **rating** as well as the
terminal status, so a summary is never published while member grades are still landing.

**Suite/grade assertions + the PR-comment artifact.** Two new rules — `min-suite-score` and
`max-suite-cost` — over a suite run named by `{suite}` or `{suiteRun}`. A gate document stays
**single-family**: one target, one family of rules, with the validation error naming *every* offending
rule index, so "the footprint moved" and "the scores dropped" stay two answers in a build log. A
**named** baseline is now always resolved and echoed even when no rule needs one (D-C14), so the
artifact always has a delta to state. `renderAssertionMarkdown` is one pure function in
`packages/shared` — not a second endpoint, not a CLI copy — and `mcpfp assert --format markdown`
renders it; **the format never changes the exit code**. A suite gate **refuses a run that is not
`completed` and settled**, an absent `ratingState` failing closed: a half-graded matrix read as a mean
score would report a quality regression that is really grading latency.

**Security posture, and a gate on it.** `packages/shared/src/security-posture.ts` declares a frozen
**eleven-rule** server registry (4 `error` · 4 `warning` · 3 `info`), the finding/report/score shapes,
and five pure functions — one score, one total order, one evidence redactor, one cap, and a finding
factory that reads severity from the registry so a rule can never choose its own (D-SP5). The
analyzer (`apps/api/src/security/`) serves `GET /api/scans/:scanId/security`: eleven deterministic
rules over an already-persisted scan, **computed on read and persisted nowhere** (no migration, no
table, no column), byte-stable for the same input, refusing a non-`success` scan with a 400 rather
than scoring a partial tool list. Evidence is redacted **by construction** — invisible characters
escaped so they are visible (a poisoning rule's whole job is to surface what you cannot see),
credential-shaped runs masked *after* escaping so an injected zero-width space cannot split a token
past the matcher, then truncated. The one credential read is `OAuthRepository.listGrantedScopes` —
scope **names** only, never token material (**D-SP9, owner-reviewable**). Three of the plan's own
near-miss fixtures forced the *matchers* to be tightened rather than the tests weakened: "will ignore
previous drafts" is silent, `list_deleted_items` with `readOnlyHint: true` is silent, and
`token_count` / `access_key_id` are silent while `secret_access_key` still fires.

`no-new-security-findings` closes the loop: **"new" is set membership by `(ruleId, anchor)`, never a
count** (D-C20). A count comparison would pass a release that resolved one finding and introduced a
worse one, so the guardrail fixture has total, per-severity **and** per-rule counts identical on both
sides. Evidence text is deliberately outside the identity — a reworded description that still trips
the same rule on the same tool is the *same* finding, and a gate that fired on rewording gets switched
off within a week. The default floor is `warning` (D-C21): hygiene does not break builds. A truncated
report on either side is a **400**, never a fallback to counts.

**CI packaging.** [`examples/github-actions/`](./examples/github-actions/) ships two copyable
workflows — an ephemeral workbench on the runner and a persistent shared one — plus the two gate files
they reference and [`planning/user-guide/DC-19-ci-github-actions/23-ci-github-actions.md`](./planning/user-guide/DC-19-ci-github-actions/23-ci-github-actions.md). They
ship as **examples, not live workflows**: this repo has no workbench to run them against, and a
permanently skipped gate in the repo that publishes gates is worse than no gate (D-C17). A text test
holds them honest instead — pinned action majors from an allow-list, the CLI called only as
`node apps/cli/dist/index.js` (D-C19 — `pnpm --silent` collapses exit 2 onto 1), measure and assert as
separate steps, nothing credential-shaped, and **every shipped gate file still parsing against
`assertionDocumentSchema`**. The ephemeral topology is documented with what it *cannot* gate: a fresh
database has no history, so every baseline rule skips on every run.

**Docs.** README gained a **"Drive it without a browser"** section (the three surfaces, the permission
model, the exit-code contract); its section 10 and `CLAUDE.md`'s capability rows were corrected — both
still described a read-only mount at 21 tools · 2,224 tokens. Two stale claims that a root
`.github/workflows/ci.yml` runs the quality gate were removed from README (there is no `ci.yml`; the
repo's only workflow is `mcp-self-scan.yml`), and `mcpfp assert`'s scope documentation was corrected
in three places — since WP M.2 it needs only `read`.

**No migration, no new runtime dependency, no new environment variable, and no change to the scope
vocabulary** anywhere in this wave. `pnpm-lock.yaml` is byte-identical.

Gate green on merged `main`: typecheck · build · **shared 152 · cli 87 · api 3,467 · web 3,574**
tests · `pnpm mcp:self-scan` within budget. `pnpm test` and `pnpm lint` exit non-zero on **only** the
pre-existing failures that predate this wave — 7 stale-model-roster tests
(`compatibility-runner` / `compatibility-tool-findings` / `compatibility-session`) and 2 research JSON
files over Biome's 1 MiB size cap.

**Owner-acceptance pending**, tracked in both ledgers. The three that matter: the example workflows
have **never been executed by GitHub Actions**; the security heuristics were reviewed against fixtures
and **never against a corpus of real third-party MCP servers**, so their false-positive rate is
unmeasured; and **D-SP9** — the one decryption-path touch in the workstream — wants explicit sign-off.

## Unreleased — design system migrated to `@elabs-ai/components-*` v4.0.0

The UI design system moved off the private, vendored `@brand/*` tarballs (v1.9.0) onto the **public
npm `@elabs-ai/components-*` packages at `^4.0.0`**. Install is now anonymous — no `.npmrc` scope
line, no `_authToken`, no CI token, no `vendor/brand/` tarballs, no `file:` dependencies.

**Renames.** 1,233 import specifiers / `@source` paths across 458 source files; every theme slug
(the vendor bright/dark pair → `light`/`dark`) in code, tests, e2e and screenshot scripts; and the
same sweep across 191 markdown files. `THEME_META` → `BUILT_IN_THEME_META` (the only import in the
app with no 1:1 new name — all 358 other named imports resolved unchanged). Theme labels are now
"Light"/"Dark", so the command-palette entry reads "Switch to Light theme".

**Theme CSS is opt-in.** `@elabs-ai/components-tokens/styles.css` is the engine only and carries no
`[data-theme]` blocks; `app.css` now imports `themes/light.css` and `themes/dark.css` explicitly.
Both token-contrast gates were repointed at the per-theme stylesheets and taught to follow `var()`
aliases.

**Accessibility — deliberate app-side override.** v4 sets `--ring: var(--primary)` (the brand lime),
which on the light theme measures 1.30–1.42:1 and fails WCAG 2.4.7 / 1.4.11 — keyboard focus is
effectively invisible. The app overrides `--ring` (`oklch(0.52 0.16 250)`, worst case 3.81:1) and
`--sidebar-ring` (`oklch(0.72 0.16 250)`, worst case 4.02:1) in a `[data-theme="light"]` block, with
a new 3:1 non-text regression gate over every surface a ring can be drawn on. `dark` keeps the
upstream ring (12.46:1). Conversely, v4 fixed the four AA failures and two role collapses the app
used to patch locally, so those overrides were deleted.

**Peers the app now owns:** `monaco-editor` `^0.55.1` and `ai` `^6.0.0` became peers in v4 and are
direct deps of `apps/web`; `@xyflow/react` and `tailwindcss` already were.

**Other v4 behaviour changes**, each decided and recorded at its call site: BentoGrid's cursor glow
is opt-in (not re-enabled — the skill overview is a dense operator surface); the decoration dial
narrowed to backgrounds and chart fills (a no-op for the app's one consumer); `CardDescription`
ships a `measure` prop, so the local `ProseCardDescription` wrapper now composes it instead of
hand-rolling a `max-w-[68ch]` class; `TabsList` gained `overflow-x-auto`, so a RunsView assertion was
scoped to the app's own chrome. The `blueprint` package and theme are gone (never a dependency here).

**Docs.** `vendor/brand-ui-agent-kit/` (pinned to v1.9.0, and therefore actively misleading) was
deleted in favour of the CLI + MCP server as ground truth, plus a generated snapshot at
`docs/brand-ui-context.md`. `docs/BRAND-UI-PORTABLE-SETUP-PROMPT.md` was rewritten for the public-npm
model; `docs/BRAND-UI-UPSTREAM-ISSUES.md` carries a superseded banner listing which gaps v4 closed.

Gate green: typecheck · 3,105 API + 3,094 web tests · build · Biome lint.

## Unreleased (0.3.0) — RC & feature convergence wave

Significant feature completion across multiple workstreams: the UX overhaul consolidated into main
(all 34 WPs, Phases 0–5; Compare Workspace rebuild per audit), Skill IDE all 20 WPs Phases 1–9
live-validated + 851 API tests, Testing-IA consolidation migration v16 + 697 API tests, the vendor-assistant backend
Phases 0–5 (migrations v23/v24) + Phase 5 answer rendering rework, Assistant Phases 0–3 + hardening
(gate 1143 API + 566 web tests), Auto-Rating Phases 1–4 complete (13 WPs, migrations v22/v26, 1624 API
tests + live bug-fix + rating-issues registry post-work), Assistant Hub all 5 waves (missions, roles/
crews, declarative GenUI, artifacts, memory/projects, usage/audit; migrations v47/v48; on
`feat/assistant-hub`, not yet merged). RC-hardening pass: path-traversal/git-sync/
shutdown/leak fixes, SSRF hardening, bundle splitting, dead-code removal, docs truth-up (Skill IDE +
Auto-Rating rows flipped Built; web tests statement corrected; router/persistence/CodeBlock references
updated; 6 missing API endpoint families added). Per-WP in-flight state authoritative in STATUS ledgers
— see [`CLAUDE.md` capability table](./CLAUDE.md).

### Assistant Hub — full-page, multi-model, multi-agent Assistant (Waves 0–4)

A new full-page **Assistant** (nav item below Dashboard, route `/assistant`) — a general-purpose,
multi-model, multi-agent workspace distinct from the existing right-side dock (relabeled **"App
assistant"**, copy-only). Built on the existing multi-provider inference, MCP-bridge, skills, and
token-metering infrastructure, adopting the Unified-Sessions contract verbatim (`phase`,
`stopReasonCode`, capability manifests, `SessionClock`, cursor-resumable SSE). Plan + locked
decisions D-AH1–D-AH20 at [`planning/Roadmap/RM-03-assistant-hub/`](./planning/Roadmap/RM-03-assistant-hub/).

- **Three session modes** — `chat` (multi-model conversation over registered MCP tools + skills),
  `research` (citations-first, search-grounded), and `mission` (the harness below); model
  switchable per session and per message across all five AI-SDK kinds plus `claude_subscription`.
- **Missions — propose → approve → run → synthesize** — a planner produces a structured team plan
  (roles, models, tool grants, budgets, rationale, cost estimate) rendered as an editable plan
  card; approval spawns isolated child sessions (never the parent transcript) that run under one of
  four topologies (`parallel`/`pipeline`/`debate`/`best_of_n`, the last resolved by a **blind**
  judge), with a live per-agent board (status, stream, cost ticker, stop/steer) and a synthesized
  final answer that cites every agent's contribution; a tripped budget stops cleanly and
  synthesizes honestly marked PARTIAL. An autonomy dial (`always_ask`/`threshold`/`auto`) gates
  approval; hard agent-count/cost caps are enforced server-side regardless of the dial.
- **First-class citations** — any MCP tool result carrying sources becomes numbered inline
  citations with a per-message + per-session Sources panel; citations survive synthesis with every
  `[n]` resolving to a real source.
- **Role library + saved crews** (`/assistant/agents`) — reusable agent definitions (system prompt,
  model, per-server/per-tool MCP grants, skills, target, budgets) the planner draws from; crews
  instantiate a saved team deterministically, skipping the planning call.
- **Declarative generative UI** — the model composes forms/tables/charts/stat-tiles from a curated,
  zod-defined `@brand`-part catalog (never raw HTML/JS) via a silent `present` tool, with a bounded
  machine-hinted repair loop on validation failure and two-tier interactivity (client-side state
  ops never re-enter the model; deliberate actions carry dual-audience payloads).
- **Artifacts** — versioned markdown/code/html/table/json deliverables in a side canvas, a
  hunk-by-hunk critic review workflow (`AI/ChangeReview`), version diff + revert, and export as
  md/html/json plus a self-contained `share.html` (styles inlined, no app/network dependency).
- **Memory + projects** — an explicit, editable profile/preferences/instructions store (the
  assistant proposes, never writes silently); projects group sessions and pin shared instructions
  + files.
- **Governance** — a Usage view (spend by model/provider/mode/day, mission breakdowns) with a
  per-session context inspector (a real token-counted breakdown by prompt layer, eager-vs-deferred
  tool defs, skill L1/L2/L3, memory, project, history — the app measuring its own assistant), and a
  filterable Audit timeline deep-linking into session replay.
- **MCP/skill handling depth** — deferred tool loading + a tool-search built-in (measured token
  savings shown), annotation-informed approval defaults, MCP elicitation through the existing
  schema→form generator, progress/cancellation on tool calls, output caps with workspace spill, a
  bundled **research-server recipe** (curated Tavily/Brave/Exa presets in the "Add MCP server"
  wizard — no bundled key, no built-in search engine), and skill L1/L2/L3 budget-aware loading.
- New `hub_*` tables (migrations v47–v48) + `apps/api/src/hub/**` (turn engine, missions, tools,
  prompting, genui) + `apps/web/src/features/hub/**`; documented in
  [`planning/user-guide/DC-13-assistant-hub/16-assistant-hub.md`](./planning/user-guide/DC-13-assistant-hub/16-assistant-hub.md). Built on
  `feat/assistant-hub` (all 5 waves); an e2e smoke test drives the full propose→approve→run→
  synthesize flow against a deterministic stubbed model (`e2e/fixtures/hub-stub-llm-server.ts`) —
  no real provider key needed. **Not yet merged to `main`** (owner merges); live-provider/
  subscription/real-research-server walks are owner-acceptance (see the ledger's Owner-acceptance
  section and [`planning/Roadmap/RM-03-assistant-hub/owner-acceptance-walk.md`](./planning/Roadmap/RM-03-assistant-hub/owner-acceptance-walk.md)).

#### Assistant Hub UX rebuild (Waves 0–4, 24 WPs)

A complete visual and interaction redesign onto the app's shell grammar (PageShell, ViewToolbar,
one status vocabulary). The workspace layout was restructured: the session rail is retired and
replaced with a collapsible 360-px right meta rail (Progress/Outputs/Context sections), a session
switcher in the toolbar, and the first-prompt choreography (composer animates from centered to
docked). The **Sessions** page (`/assistant/sessions`) is now a sortable/filterable DataTable
showing status, mode, project, model, tokens, cost, and errors. The **Agents & Crews** area
(formerly "Roles, crews") was redesigned as a workforce section with three tabs: **Directory** (a
card grid of agents and crews with quick-create), **Org chart** (a graph on `@brand/flow` showing
execution topologies), and **Usage** (spend drill-down by agent/crew/model/mode/project). Agent
and crew **profile modals** are now `WideDialog` tier-3 modals with full sections including an
**Access** section showing per-server + per-tool grants with scan-measured token costs. Memory was
refactored into four scopes (profile/project/agent/crew) with clear effective-stack ordering shown
in the workspace Context section. Navigation was consolidated 6→4 (Assistant + Sessions child,
Agents & Crews, Projects, Audit) with transparent legacy redirects (`/assistant/memory` →
`?memory=profile`, `/assistant/usage` → `?tab=usage`). Plan + 24 WPs across Waves 0–4 at
[`planning/Roadmap/completed/RM-04-assistant-hub-ux/`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/) (ledger:
[`STATUS.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/STATUS.md), [`execution-plan.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/execution-plan.md));
all decisions D-HUX1–16 + pre-flight P1–P4 locked; Wave 0 was contracts + unblockers (WP0.1 wire,
WP0.2 shell registry, WP0.3 silent-create-role fix, WP0.4 hub-ux constants); Waves 1–3 delivered
workspace + meta rail + sessions + workforce + memory + usage + nav consolidation + retirement
sweep (MemoryView/UsageView/SessionRail/WorkspaceFilesPanel deleted, zero live imports); WP4.1
e2e, WP4.2 visual/a11y + owner-acceptance walk, WP4.3 docs + stale-comment cleanup, WP4.4
integration train. Owner-acceptance pending: live provider keys, real mission, real search server,
both-theme + keyboard walk (see ledger's Owner-acceptance section and
[`owner-acceptance-walk.md`](./planning/Roadmap/completed/RM-04-assistant-hub-ux/owner-acceptance-walk.md)).

### Unified Sessions — one run/session lifecycle across every backend (Phases 0–5)

Consolidated the run backends (the AI-SDK engine, Claude subscription, and the since-removed vendor assistant) onto **one
session lifecycle**, so a run reads, streams, and renders the same way regardless of provider. Plan +
locked decisions D-US1–D-US26 at [`planning/Roadmap/completed/RM-29-unified-sessions/`](./planning/Roadmap/completed/RM-29-unified-sessions/).

- **One terminal vocabulary** — a shared `terminalFor()` table maps each end cause to the canonical
  `(status, outcome, stopReasonCode)` triple, plus a `phase` axis (`queued`/`waiting_input`/…) and an
  explicit `ended` state; `deriveRunStatusView` renders the SAME locked chip label + tone for a given
  state across all three kinds (D-US5 — the backend kind never changes the label). A reusable seed
  harness + a conformance test prove the full 3 kinds × 14 states = 42-row table end-to-end
  (persistence → `GET /api/runs/:id` → derivation) with no provider key (`pnpm --filter …/api
  seed:sessions`).
- **Stall-based `SessionClock`** — pause-while-waiting, an active/total duration split, a stall
  detector, and warn → extend → stop; **no wall-clock cap by default** (per-environment override
  only), so a long but healthy run is never killed on the clock.
- **Static-per-kind capability manifest + a capability-driven console** — a run persists a
  `capabilities_json` manifest at start and the console's KPI tiles + affordances are gated
  declaratively off it (e.g. context-window surfaces hidden for question-metered `vendor_assistant`).
- **Cursor-resumable SSE** — the run stream carries a cursor + periodic ping; a client watchdog
  reconnects and resumes from the last cursor after a drop, and an expected post-terminal socket close
  is never surfaced as an error.
- **End session** — an explicit affordance to end a live run/session, alongside live phase chips, a
  "needs attention" section, seen-markers, and durations in the Runs feed.
- **OpenAI-compatible facade (`/openai/v1`)** — an external interop endpoint (`GET /openai/v1/models`
  + `POST /openai/v1/chat/completions`) that makes a configured `vendor_assistant` assistant selectable
  from any OpenAI-compatible client (Open WebUI, LiteLLM, another harness). Hold-back streaming by
  default (reasoning live, the answer held until settled) with an opt-in `OPENAI_FACADE_LIVE_STREAM`
  flag, a locally-minted `0600` bearer key (`DATA_DIR/openai-facade.key`; `OPENAI_FACADE_KEY`
  overrides), a per-facade concurrency cap → `429` + `Retry-After` (`OPENAI_FACADE_MAX_CONCURRENCY`),
  and vendor `vendor_assistant`/`citations` fields; the internal the vendor executor is untouched, so the answer
  is byte-identical. Mounted in `apps/api/src/index.ts` with real provider-layer deps; documented in
  `user-guide/15-openai-endpoint.md` (since removed with the rest of that vendor's documentation). Every tenant call is
  stubbed in tests — no real the vendor tenant is ever contacted.

## 0.2.0 — 2026-07-02 — Docs & process remediation wave

Documentation-and-process pass reconciling the docs to what the code actually is now (issues #21,
#22). No product behavior changed in this wave; it corrects stale claims and tidies the agent setup.

### Docs reconciled to shipped state (#21)

- **CLAUDE.md capability table (§1):** flipped stale rows — Testing Web UI (Phase 3, built),
  Skills → attach-to-scenario (Phase 2, built), Resource/prompt footprint (built:
  `mcp_resource_scans` / `mcp_prompt_scans`, `resources/list` + `prompts/list`). Added rows for URL
  routing (react-router), real tokenizer + serialized-payload counting (`counting_version`),
  versioned migrations + scan/run delete + retention, CI + Biome lint, the System theme option, and
  MCP × model compatibility. Corrected the profile count (3 → 4) and the "no lint" claims.
- **CLAUDE.md tech stack (§3), commands (§4), architecture (§5):** `react-router-dom` replaces the
  "no router / local `activeView` state" claim; Biome (`pnpm lint` / `pnpm format`) + root CI replace
  the "no ESLint / no lint script" claim.
- **CLAUDE.md API surface (§6) & data model (§7):** reduced to a source-of-truth pointer
  (`**/routes.ts`, `db/schema.ts`) plus the current endpoint families and full table list; the
  token-counting section now describes real `js-tiktoken` BPE, the `generic_estimate` heuristic,
  serialized-payload counting, and `counting_version`; noted `PRAGMA user_version` migrations and
  `SCAN_RETENTION_PER_SERVER`.
- **README.md:** rewritten to the current product (cross-server compare, playground, Testing console,
  Skills, compatibility) as a short overview that defers to CLAUDE.md and the STATUS ledgers;
  refreshed Acceptance Criteria.
- **roadmap:** `00-product-brief.md` non-goals trimmed to auth/cloud (removed conversation replay,
  LLM proxy mode, provider token adapters — now delivered/in-scope); `ROADMAP.md`,
  `planning/user-guide/DC-21-architecture/01-architecture.md`, `planning/Roadmap/RM-31-mvp-footprint-analyzer/02-implementation-plan.md` marked historical with a
  "current state" pointer to CLAUDE.md + the STATUS ledgers.
- **Single source of truth:** stated in CLAUDE.md that `planning/Roadmap/*/STATUS.md` ledgers are
  authoritative for in-flight status; other docs link rather than restate.

### Process hygiene (#22)

- **Themes:** replaced the stale "six themes" with "two themes (the vendor bright/dark pair)" across
  the Testing WP specs (`planning/Roadmap/RM-26-testing/phase-*/WP-*.md`) and both `/next-wp` definitions. Did not
  re-add blueprint/light/dark/high-contrast.
- **`/next-wp` dedup:** the `next-wp` skill (`.claude/skills/next-wp/SKILL.md`) is now the single
  canonical definition; the command (`.claude/commands/next-wp.md`) is reduced to a thin pointer so
  the two can't drift.
- **Tombstones deleted:** `.claude/rules/issue-workflow.md`, `.claude/rules/component-api.md`,
  `.claude/commands/file-issue.md`, `.claude/rules/quality-gates.md.probe`, and
  `.claude/commands/brand-ui-update.md` (each self-described as safe to delete). Updated the
  CLAUDE.md §10 `.claude/` map to be accurate (adds `next-wp`, drops deleted files).
- **Owner-acceptance tracking:** added an "Owner acceptance" section to `planning/Roadmap/RM-26-testing/STATUS.md`
  and `planning/Roadmap/RM-24-skills/STATUS.md` (one tickable line per deferred owner visual/a11y/e2e item) plus
  the rule that a new phase shouldn't open with prior owner-acceptance items unresolved.
- **Versioning:** bumped root `package.json` to `0.2.0` and added this changelog. Per-phase git tags
  remain an owner action.
- **Lint statements:** corrected "no lint script" to reflect Biome + CI in the quality-gates rule,
  both plan `conventions.md` files, and the `next-wp` skill.

## 0.1.0

Initial startup-footprint MVP and the expanded target build-out (scans, token counting, cross-server
compare, tool playground, Testing console, Skills registry, MCP × model compatibility). See the
`planning/Roadmap/` history and the `planning/Roadmap/*/STATUS.md` ledgers.
