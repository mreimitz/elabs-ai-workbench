# 1. Key concepts

This page explains the ideas the rest of the guide builds on. If you already work with MCP
servers and tokenizers day to day, you can skim it and jump to
[Getting started](./02-getting-started.md).

## What is an MCP server?

**MCP** stands for *Model Context Protocol* — a standard way for AI assistants to connect to
external capabilities. An **MCP server** is a program that exposes those capabilities to an AI
model in a structured form. For example, a server might offer tools to search a database,
create a support ticket, or read a file.

When an assistant connects to an MCP server, the server describes what it offers. Three kinds
of things can be described:

- **Tools** — actions the model can take (e.g. "create_ticket", "run_query"). Each tool has a
  name, a description, and an *input schema* that spells out its parameters.
- **Resources** — pieces of readable content the model can pull in (e.g. a document or record).
- **Prompts** — reusable prompt templates the server provides.

Most of the token cost usually comes from **tools**, which is why they're the main focus of
this app — but resources and prompts are measured too.

## How the app talks to a server

MCP servers can be reached two ways, and the app supports both:

- **Local command (stdio)** — the server runs as a program on your machine, and the app talks
  to it by launching it. You provide the command and its arguments.
- **Server URL (streamable HTTP)** — the server runs as a web service, and the app talks to it
  over HTTP. You provide a URL, and if the server needs credentials, you provide those too.

You'll choose one of these when you [connect a server](./03-connect-a-server.md).

## Agent Skills

Alongside MCP servers, an AI assistant can load **Agent Skills**. A skill is a self-contained
bundle of instructions and files (built around a `SKILL.md` file) that gives the assistant a
reusable way to do a particular kind of task. Where an MCP server provides *tools* (actions), a
skill provides *know-how* (guidance the model reads).

Skills matter here for the same reason tools do: their contents load into the model's context,
so they carry a token footprint too. And a skill and a server often work *together* in a
session, with the skill shaping how the tools get used. The app can measure a skill's footprint
and include it in a test run to see its real effect (see [Skills](./08-skills.md)).

## What happens in a session

A **session** is a single working conversation between a model and everything connected to it:
the MCP servers supplying tools and the skills supplying instructions. In a session the model
reads all of those definitions, then works through a task — usually calling tools along the way —
until it produces an answer.

Almost everything you'll want to understand lives in the session: how much context the setup
used up before any work started, how the skills and servers interacted, where a run went wrong,
and what it cost. The app lets you drive real sessions (see [Testing console](./09-testing.md)),
watch them step by step, and measure them. That's what turns a vague "it isn't working" into a
specific, reproducible, fixable problem.

## What is a "token", and what is a "footprint"?

AI language models don't read text character by character — they read **tokens**, which are
short chunks of text (roughly a few characters each). Every model has a limited **context
window**, measured in tokens, that has to hold everything the model is working with: the
conversation, any documents, *and* the definitions of all the tools it can use.

Here's the key insight this app is built around: **before an assistant does any work, the
definitions of every tool on a connected server are loaded into that context window.** That
upfront cost is what we call the **startup footprint**. A server with many tools, or with long
descriptions and elaborate schemas, can consume a large share of the budget before the model
has answered a single question.

There are two costs worth measuring, and the app measures both:

- **Startup footprint** — the token cost of the tool/resource/prompt *definitions*, loaded
  when the server connects. This is what a [scan](./04-scan-and-read-footprint.md) measures.
- **Runtime cost** — the token cost of actually *calling* a tool: the request you send plus the
  response that comes back. This is what the [tool run console](./06-run-a-tool.md) measures.

## Token profiles (how counting is done)

Different model families split text into tokens slightly differently, so a definition that's
1,000 tokens for one model may be 1,050 for another. The app offers several **token profiles**
so you can count the way your target model does:

- **`generic_o200k`** (the default) — accurate counting for the GPT-4o / `o200k` family of
  models.
- **`generic_cl100k`** — accurate counting for the GPT-3.5 / GPT-4 `cl100k` family.
- **`generic_estimate`** — a quick heuristic estimate, not tied to a specific model.
- **`raw_json_rough`** — a very rough size estimate based on raw bytes.

The first two do **real** tokenization (the same math the models use), so they're the ones to
trust for decisions. The two estimate profiles are handy for a fast approximation.

Two things to keep in mind:

- A tool's token total is measured on the **actual payload sent to a model**, not by adding up
  its name, description, and schema separately — so the number reflects real-world cost.
- Because profiles count differently, the app **won't silently compare numbers produced by
  different profiles**. If you try, it warns you. Stick to one profile when comparing.

## Why this matters

Keeping the startup footprint small leaves more of the context window for the actual work,
which tends to make an assistant faster, cheaper, and more reliable. This app gives you the
measurements to spot bloated tools, trim what you don't need, and confirm that a change
actually reduced the cost.

---

Next: [Getting started →](./02-getting-started.md)
