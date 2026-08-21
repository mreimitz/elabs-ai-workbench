---
type: "Guide Page"
title: "9. Testing console \u2014 run a real session"
description: "Scanning tells you what a server costs to load. The Testing console goes further: it drives"
tags: ["documentation", "DC-08"]
timestamp: "2026-08-21T20:15:00Z"
status: "current"
---
# 9. Testing console — run a real session

Scanning tells you what a server *costs to load*. The **Testing console** goes further: it drives
a server through a **real AI agent loop** — an actual model using the server's tools (and any
attached [skills](../DC-07-skills/08-skills.md)) to work through a task — and records everything that happens.
This is where you see how skills and servers behave *together*, debug a session, and measure what
it really costs. It's the heart of the "session workbench."

## What a run is

A **run** is one AI session, captured start to finish. A model is given a task, reads the tool
and skill definitions, then works — thinking, calling tools, reading results — until it produces
an answer. The console records every step so you can replay and inspect it later.

Because a run drives a real model, you first add a **provider credential** (an API key, or your
Claude subscription) in [Settings](../DC-14-settings-and-features/13-settings.md). Keys are encrypted before they're saved, and
a model with no known price can't be run, so cost figures stay honest.

## The building blocks

The **Testing** and **Setup** groups in the sidebar hold a few surfaces that work together:

- **Environments** — a reusable configuration for a run: which provider and model to use, which
  server(s) and [skills](../DC-07-skills/08-skills.md) to include, whether tools load eagerly or on demand, and
  any guardrails. (Internally an environment is sometimes called a "scenario.")
- **Collections** — where your tests live. There's always a default collection named **Local**;
  binding a collection to a git repository is optional.
- **Runs** — the feed of every run, with columns for status, turns, tools, tokens, cost, and the
  automatic quality grade.

![The Environments list, showing the provider for each — anthropic models and a Claude subscription side by side.](../DC-23-product-overview/images/16-environments.png)

Notice the **Provider** column above: every configured provider — a metered API key or the signed-in
Claude subscription — is a valid run target.

## Sessions and runs — what's which

The app uses two terms carefully: a **session** is an interactive container — you start it, watch
it work, and can ask it to stop. An automated, suite-driven execution is a **run**. The API still
calls everything `runs` under the hood, but the UI uses the right term for what you're watching:
"Starting a session…" for interactive work, "Session waiting for you" when it needs input.

## Starting a run

Choose **New run**, pick an environment and a test (or type an ad-hoc prompt), and start it. The
run opens in the **run console**, which streams the session live and then keeps the full record.

### Status and timers

Every session has a **status** drawn from a locked vocabulary applied consistently across every
surface — the runs feed, the console, comparison views, and reports. The same session state always
reads the same way: `Queued` (plus position in the queue), `Pending`, `Running`, `Waiting for you`,
`Stopping…`, `Reviewing…`, `Completed`, `Ended`, `Stopped — time limit`, `Stopped — stalled`,
`Stopped — context overflow`, `Stopped — wait timeout`, `Stopped by you`, `Failed`, and
`Assertions failed`. The app also shows cost/token/tool limits when they're hit.

The **wait timeout** is how long a session will wait for you to provide input. By default it's
**10 minutes** — if you don't respond in that time, the session ends with `Stopped — wait timeout`.
You can change these defaults in
**Settings → Testing**, and override them per environment. While waiting, the session's active
timer pauses — it resumes when you respond — so a lunch break doesn't count against your run's
cost.

The **stall detector** kicks in after **10 minutes with no events** while a session is running.
If the session goes silent — hung MCP server, unresponsive network, anything — it's stopped with
`Stopped — stalled`. This is opt-in per environment via the **max duration** cap (set it to enable
stall detection as well). The **active duration** shown in the KPI rail excludes waiting time;
the **total duration** is wall-clock.

### Ending a session

Interactive sessions can be ended explicitly. From the run console, click **End session**, confirm
in the dialog, and the session finishes as `Ended` — a clean close, not a guardrail stop. This is
the way to say "I got what I needed" or "I'm done exploring."

### Needs attention — sessions waiting for you

The runs feed has a dedicated **Needs attention** section that shows sessions currently waiting
for input, and finished sessions you haven't seen yet. Opening one marks it seen, so you always
know which sessions need a look.

### Launcher effective limits

Before starting a run, the launcher shows an **effective limits** summary: the stall timeout, wait
budget, wall-clock cap (if set), and the subscription run concurrency this session will be subject
to. This tells you upfront what constraints will apply.

### What the pre-launch estimate is based on

Alongside the limits, the launcher shows an **estimated cost** — a token range and a dollar range
for everything you're about to run. The single biggest thing driving that number is *how many turns
the agent will take*, because an agent re-sends its context on every turn.

The app doesn't guess at that any more. It reads the turn count off **your own completed runs**,
preferring the narrowest evidence it has, and tells you which it used in a line under the band:

- *"Turn count from 51 past runs of this test on this environment."* — the best case: this exact
  pairing has enough history to speak for itself.
- *"Turn count from 79 past runs on this environment."* — you selected several tests, so no single
  pairing covers the whole plan; the environment's own history does.
- *"Turn count from 122 past runs across all environments."* — a new environment with no runs yet.
- *"Turn count is an assumption — no past runs to measure."* — a fresh install. This is the honest
  label on the number the app has always shown.

Only **completed** runs count. A run you stopped, or one that failed, tells you how long the
interruption was rather than how long the task takes, so including it would drag the estimate down.
A sample smaller than three runs is ignored entirely and the app falls back to the next-widest
level, rather than building a range out of one or two data points. The same line appears wherever
the estimate does — the run launcher, the suite run-confirm, and the fork dialog — and when a plan
spans several environments, the line describes the *weakest* evidence behind the total, because the
band is a sum and one unmeasured environment makes the whole figure partly assumed.

The range stays a range on purpose. Even one test on one environment is genuinely variable — in this
repository's own history, 51 runs of a single test put the 10th percentile at 5 turns and the 90th at
16, with the longest run reaching 19. The ends of the range
are the 10th and 90th percentile of what actually happened, so roughly one run in ten will land
above the top and one in ten below the bottom. If a scenario sets a **max turns** guardrail, it caps
the estimate too, and it is applied last.

**Treat it as a bound, not a forecast.** The turn count is now measured, but the tokens-per-turn
arithmetic still assumes the agent re-sends the environment's entire tool catalogue on every turn
from the first one. For environments using deferred tool loading — where tool definitions are pulled
in on demand — that over-states a short run by two to three times, and it means the dollar range's
lower end can sit above what a typical run really costs. Both are known and written down; see
[`RM-34`](/Roadmap/RM-34-estimator-turn-model-calibrate/STATUS.md). The figure is advisory: it blocks
nothing, and the run's real cost is measured as it goes.

## The run console

The console is one screen with the session on the left, a **KPI rail** on the right (context used,
estimated cost, tokens in/out, tool calls, turns), a **context-window chart** showing how each turn
fills the model's limit, and a per-turn list. Four tabs move between different views of the same run.

![The run console, Chat tab: the conversation with tool calls inline, and the KPI rail plus context-window chart on the right.](../DC-23-product-overview/images/08-run-console-chat.png)

### Chat — the conversation

The **Chat** tab reads like a transcript: the task prompt, the model's thinking, each tool call
with its arguments and result, and the final answer. This is the quickest way to understand *what
the assistant did and why*.

### Trace — the event timeline (for debugging)

The **Trace** tab is the debugger. It breaks the session into a turn-by-turn tree of events — user
prompt, LLM response, each tool call — each stamped with tokens in/out, duration, cost, and time.
When a session is slow, expensive, or goes wrong, this is where you find the exact step responsible.

![The Trace tab: an expandable per-turn event tree with timings, token counts, and cost for every step.](../DC-23-product-overview/images/09-run-trace.png)

### Analytics — cost and context

The **Analytics** tab summarizes the run: how much was served from cache, tool errors, peak context
used against the model's limit, and total duration — plus charts of **cost per turn** and **context
growth per turn** so you can see where the budget went.

![The Analytics tab: cached share, peak context, duration, and per-turn cost and context-growth charts.](../DC-23-product-overview/images/11-run-analytics.png)

### Reading the token numbers — and why they look so large

The first thing most people notice is that **Tokens ↑** is enormous next to **Context**. On a real
seven-turn session the rail reads *369,841 sent* against a *91,912-token* conversation. Neither number
is wrong — they measure different things:

- **Context** is a snapshot: how big the conversation is *right now*.
- **Tokens ↑** is a running total: an agent re-sends its whole context on every turn, so a
  91,912-token conversation across seven turns sends several hundred thousand tokens in total.

What keeps that from being ruinously expensive is **prompt caching**. Re-sent context is usually
served from the provider's cache, and the rail says so: *"sent · 96.2% from cache"*. Hover any token
figure for the full breakdown, or open **Analytics → Tokens** for the per-turn stack.

#### Reads and writes are not the same thing

The app never shows a single "cached" number, because caching has two halves that pull in opposite
directions:

| | What it is | What it costs |
| --- | --- | --- |
| **Cache read** | context served from cache instead of re-processed | **~0.1×** the normal input rate — a large discount |
| **Cache write** | context being *put into* the cache | **1.25×** the normal input rate — a **premium** |

A write costs *more* than an uncached token. It pays for itself on the next turn that reads it, but a
combined figure would make an expensive turn look like a cheap one — so reads and writes are always
labelled separately, with their rates, wherever they appear.

#### "Not measured" is not zero

Some runs can't answer this. A session recorded before the app measured the split, or one whose
provider reported only a merged total, shows **"not measured"** rather than a zero. That distinction
matters: a 0% cache-hit rate looks exactly like caching that has broken, and you would go looking for
a problem that isn't there.

The same split appears in the runs feed (as an optional **Cache hit** column), suite rollups, exports,
the compare workspace, and the Testing dashboard's **Prompt cache** panel — where you can also chart
it over time or set a watch rule on it.

### Report — automatic quality rating

When a run finishes, the app **reviews it automatically** — a core part of the automated
issue-detection story. The **Report** tab shows whether the answer actually addressed the task
(with the judge's cited evidence), whether it added useful or wasteful extra content, and an **error
forensics** inventory that classifies anything that went wrong and drafts a fix. You can re-rate at
any time.

![The Report tab: an automatic run rating with the answer-validation score and grade breakdown, cited evidence, and error forensics.](../DC-23-product-overview/images/10-run-report.png)

When that review implicates a skill, the finding doesn't just sit in the report — it's filed as a
tracked **issue against the skill itself**, with a drafted fix. That closed loop is described in
[Skills → the feedback loop](../DC-07-skills/08-skills.md).

## Replay

Any finished run can be **replayed** step by step from its saved record — useful for walking a
colleague or customer through exactly what happened, without re-running anything.

## Will it even fit? (Compatibility)

Before you spend tokens on a run, the **Compatibility** screen answers a related question: does a
server's footprint fit inside a given model's context limit? It scores a scan against a roster of
models as a heatmap. See [Model compatibility](../DC-10-compatibility/19-compatibility.md) for the full walkthrough.

## Reviewing runs at scale

Two things help once you've run more than a handful of sessions:

- The **Runs** feed is searchable and filterable — narrow by prompt, tool, status, or cost, and save
  a filter as a **view** you can return to.
- To run many tests at once and grade the answers, move up to a **suite** — see
  [Suites & benchmarks](../DC-09-suites-and-benchmarks/18-suites-and-benchmarks.md). To keep a standing eye on what's breaking,
  see [Observability](../DC-11-observability/17-observability.md).

---

Next: [Comparing runs →](./10-comparing-runs.md)
