---
type: "Guide Page"
title: "AI Workbench"
description: "Understand, test, debug, and validate how your MCP servers and Agent Skills behave in real AI"
tags: ["documentation", "DC-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "current"
---
# AI Workbench

**Understand, test, debug, and validate how your MCP servers and Agent Skills behave in real AI
sessions — what they cost, where they break, and how to fix them.**

> The app presents itself as **AI Workbench — MCP analyzer**. Its code repository is named
> **`mcp-token-footprint`** after the capability it started with; the two names refer to the same
> product.

---

## What it is

AI Workbench is a local workbench for anyone who builds, runs, sells, or supports AI
assistants that rely on **MCP servers** (tools) and **Agent Skills** (packaged know-how). It
shows you what those pieces cost inside a model's limited context, how they work together during
a session, where a session goes wrong, and whether a change actually fixed it.

An **AI session** is where everything comes together: the model, the MCP servers that give it
tools, and the skills that give it instructions. Each of those adds to the model's context and
shapes how the assistant behaves. When a session is slow, expensive, or simply gives the wrong
answer, the cause is usually buried in that interaction. This app brings it into the open —
measured, reproducible, and testable — so you can move from "something feels off" to a concrete,
verified fix.

It runs **entirely on your own machine**. Your servers, your credentials, and your data stay
local. There are no accounts and no cloud.

![The workbench dashboard: total startup tokens across all servers, what needs attention, and recent activity.](../DC-23-product-overview/images/01-dashboard.png)

## Who it helps

The app is built for four kinds of people, and it meets each of them where they are.

**End users and operators — understand your setup.**
See how your skills and MCP servers fit together, what each one costs in context, and how a
session actually plays out. Stop guessing about why an assistant behaves the way it does and get
a clear picture of the setup you're running.

**Presales, CSEs, and technical field teams — debug sessions with confidence.**
Understand how a session works from end to end, pinpoint exactly where an issue is, and learn
how to avoid it. Demo, support, and advise from evidence instead of intuition, and turn a
confusing failure into an explanation you can show a customer.

**Skill and MCP developers — find and fix, in a loop.**
Automated issue detection, closed-loop execution, and test-and-fix workflows turn "something's
wrong" into a reproducible problem and a proven fix. Debug a skill or server, make a change,
re-run it, and confirm the change worked — without leaving the app.

**MCP server owners — analyze, validate, and keep it healthy.**
Analyze and validate your servers, track how they evolve, and see how each change affects real
sessions. Run long-running quality gates so regressions are caught early instead of surfacing in
front of a user.

## What sets it apart

- **Real measurement, not estimates.** It counts the actual context cost of tools, skills, and
  live calls the way a model does — numbers you can act on.
- **Sessions, not just definitions.** It shows skills and servers *working together* in a real
  agent session, not only their static descriptions.
- **Automated issue detection.** Runs are reviewed automatically for what went wrong and why, so
  problems surface without a manual hunt.
- **Closed-loop test-and-fix.** A failing run files a tracked **issue against the skill** involved,
  with a drafted fix you can apply yourself or hand to the Assistant — then re-run and verify. A
  full loop in one place.
- **Long-running quality gates.** Validate servers and skills over time and flag regressions
  before they reach a session.
- **Compare anything.** Diff a server against its own past, two servers against each other, two
  runs turn by turn, or two agent configurations head-to-head.
- **Fully local.** Everything runs on your machine, so sensitive setups and credentials never
  leave it.

---

## How this guide is organized

This guide is written for people who *use* the app. If MCP servers, skills, and "tokens" are new
to you, start with [Key concepts](./01-key-concepts.md); the core workflow pages then follow the
natural order you'll use the app in.

**Start here**

- [Key concepts](./01-key-concepts.md) — MCP servers, skills, sessions, tokens, and why footprint matters.
- [Getting started](./02-getting-started.md) — run the app, tour the interface, and read the Dashboard.

**Core workflows**

- [Connect a server](../DC-02-mcp-servers/03-connect-a-server.md) — add an MCP server and test the connection.
- [Scan and read the footprint](../DC-03-scans-and-footprint/04-scan-and-read-footprint.md) — run a scan and understand the numbers.
- [Compare](../DC-04-comparison/05-compare.md) — track a server's footprint over time and against other servers.
- [Run a tool](../DC-05-tool-playground/06-run-a-tool.md) — execute a tool and measure its real call cost.
- [Export reports](../DC-06-reports/07-reports.md) — save scan, server, and run reports.

**The session workbench**

- [Skills](../DC-07-skills/08-skills.md) — register and inspect Agent Skills.
- [Testing console](../DC-08-testing-console/09-testing.md) — drive a server through a real AI agent loop and inspect the session.
- [Comparing runs](../DC-08-testing-console/10-comparing-runs.md) — put two sessions side by side (Summary + trace diff).
- [Suites & benchmarks](../DC-09-suites-and-benchmarks/18-suites-and-benchmarks.md) — run many tests at once and grade the answers.
- [Model compatibility](../DC-10-compatibility/19-compatibility.md) — check whether a server fits inside each model's limits.
- [Observability](../DC-11-observability/17-observability.md) — watch rules, the Review queue, and catching regressions.

**More**

- [App assistant](../DC-12-app-assistant/12-assistant.md) — the built-in AI helper **dock** that operates the current page.
- [Assistant](../DC-13-assistant-hub/16-assistant-hub.md) — the full-page, multi-model, multi-agent **workspace**.
- [Workbench agent playbook](../DC-16-workbench-mcp-server/20-workbench-mcp-server.md) — let an outside AI assistant (Claude Code, Cursor) read your workbench.
- [Service tokens](../DC-17-service-tokens/21-service-tokens.md) — reach the workbench from CI or another machine, without a browser.
- [The `mcpfp` command line](../DC-18-mcpfp-cli/22-mcpfp-cli.md) — run scans, gate a build on the footprint, and pull reports from a terminal or a build pipeline.
- [Gating a pull request](../DC-19-ci-github-actions/23-ci-github-actions.md) — wire the gate into GitHub Actions: two example workflows, the exit codes, and which rules work where.
- [Settings](../DC-14-settings-and-features/13-settings.md) — providers, themes, and storage.
- [Troubleshooting & FAQ](../DC-15-operations/14-troubleshooting.md) — common problems and fixes.

---

> Tip: In the app, press the **Search** box in the top bar (or its keyboard shortcut) to open
> the command palette and jump to any screen quickly. Looking for the high-level pitch instead of
> a how-to? See the [product overview](../DC-23-product-overview/product-page.md).
