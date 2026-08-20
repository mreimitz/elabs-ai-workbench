---
type: "Project"
title: "MCP Token Footprint Workbench"
description: "A local, Dockerized workbench for analyzing MCP servers: their tool surface, model-context token cost, change over time, live tool execution, agent test runs, skills, and security posture."
tags: ["project", "mcp", "token-accounting", "agent-testing", "workbench"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# MCP Token Footprint Workbench

**MCP Token Footprint** is a local, Dockerized web app for **analyzing MCP servers**: connect to
one or many, extract their full tool surface, measure the model-context token cost of those
definitions, track how a server changes over time, compare servers against each other, and
exercise individual tools through generated forms.

It is a single-owner developer tool. It runs locally (no auth, no multi-tenant, no cloud) and
talks to MCP servers over **stdio** and **streamable HTTP**. The code lives at the repository
root (`apps/api`, `apps/web`, `apps/cli`, `packages/shared`); this `planning/` bundle is the
Open Knowledge Format knowledge graph that governs what gets built and records what shipped.

## What it does

- **Connects to multiple MCP servers** and extracts every detail — `initialize`, `tools/list`,
  names, descriptions, input schemas, annotations, plus `resources/list` and `prompts/list`.
- **Accounts for tokens and payload size** from the serialized provider payload, per token
  profile, with real tiktoken BPE encodings alongside two named heuristics.
- **Diffs over time** — a server against its own previous scans (added / removed / changed
  tools, token deltas) — and **across servers**, down to tool-level matching.
- **Runs tools** — reads a tool's input schema, generates a form, executes `tools/call`, shows
  the result, and measures the token cost of the request and the response.
- **Tests servers through a real LLM agent loop**, measuring context cost, guardrails and
  estimated spend per run, with full replay, grading and auto-rating.
- **Registers and inspects Agent Skills**, measures their L1/L2/L3 footprint, and attaches them
  to test environments — skill content is stored and metered but **never executed**.
- **Observes the fleet** — metrics over time, search, issues, watch rules and reports.
- **Serves its own MCP server** at `/api/mcp`, so external agents can operate the workbench.
- **Automates in CI** through service tokens, the `mcpfp` CLI and server-side assertions.

## Knowledge domains

- [Research](/Research/) contains tagged investigations — provider limits, competing
  observability platforms, session contracts, skill formats — with their sources, notes and
  outputs.
- [Roadmap](/Roadmap/) contains the master roadmap and the tagged initiatives that sequence the
  build. Each item carries its own `STATUS.md` work-package ledger. Finished initiatives move
  to `Roadmap/completed/`.
- [Documentation](/user-guide/) records what has actually been built, one tagged subject per
  part of the system. A subject holds both the delivery record (`doc.md`) and that part of the
  user-facing guide.
- [Claude controls](/.claude/) contains the commands, skills, hooks, templates and profile that
  keep this knowledge tree valid.

## Daily workflows

- Use `/new-research` to scope and create an `RS-NN` research topic.
- Use `/doc-intake` to convert a local file or directory into a new `RS-NN` topic.
- Use `/new-roadmap` to create an `RM-NN` roadmap item.
- Use `/new-docu` to create a `DC-NN` documentation subject.
- Use `/next-wp` (a repository-root skill) to drive the next work packages of an item's ledger.
- Use `/complete-roadmap` to retire a finished roadmap item: it records the delivery in
  `user-guide/` and moves the item into `Roadmap/completed/`.
- Use `/research-status` to inspect current work.
- Use `/validate-okf` to validate official OKF and the strict local profile.
- Use `/sync-okf` to regenerate managed indexes and the master roadmap view.

## Stable tags

Research folders use `RS-NN-short-slug`, roadmap folders `RM-NN-short-slug`, and documentation
folders `DC-NN-short-slug`. Numbers are zero-padded, allocated atomically by the generator, and
never reused — a completed roadmap item keeps its number after moving to `Roadmap/completed/`.

## Project tooling

Non-OKF helper code lives under `tools/`. It is intentionally absent from the knowledge indexes
and may not contain Markdown. The application's own source code lives outside this bundle, at
the repository root.
