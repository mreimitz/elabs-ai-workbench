---
type: "Agent Instruction"
title: "Research Intake Questions"
description: "The editable question set used to scope every new research topic."
tags: ["agent", "instruction", "research", "intake"]
timestamp: "2026-07-24T00:00:00Z"
status: "active"
---

# Research Intake Questions

This is the editable script for the research intake interview. Add, remove, reorder, or reword
questions freely — the `research-intake` skill and the `/new-research` command both read from here,
so changes take effect everywhere. Keep each question to one clear ask. Anything marked *(optional)*
can be skipped with a sensible default.

## Core (always ask)

1. **Objective** — In one sentence, what question are we trying to answer or what are we trying to learn?
2. **Why now / what it feeds** — What decision, deliverable, or downstream work depends on this? Why does it matter now?
3. **Scope — in** — What's clearly *inside* the scope? (topics, markets, time range, systems)
4. **Scope — out** — What's explicitly *out of scope*? What are we deliberately NOT doing?
5. **Deliverable** — What's the final output and who's the audience? (e.g. one-page memo, comparison table, decision brief, slide deck)
6. **Success criteria** — How will we know the research is "done" and good enough?

## Context (ask if not already clear)

7. **Sub-questions / hypotheses** *(optional)* — What are the 2–4 specific sub-questions or hypotheses to test?
8. **Sources & constraints** *(optional)* — Where should evidence come from? (internal docs, web, specific domains/vendors) Anything off-limits?
9. **Prior art / dependencies** *(optional)* — Does this build on or get blocked by an existing topic? (reference by `RS-NN` / `RM-NN` tag)
10. **Time budget / deadline** *(optional)* — How much effort or by when?

## Defaults when the user says "just go"

- Deliverable → a decision-oriented `Research Output` concept in `outputs/`.
- Sources → web + any project-internal material, paraphrased with provenance kept in `sources/`.
- Success criteria → the objective is answered with traceable evidence and stated confidence.
- Scope-out → infer from the objective and state your assumption explicitly before proceeding.
