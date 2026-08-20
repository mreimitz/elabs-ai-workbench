---
name: "research-intake"
type: "Agent Skill"
title: "Research Intake"
description: "Scope a research request and transactionally create its conformant RS topic."
tags: ["agent", "skill", "research", "okf"]
timestamp: "2026-07-24T00:00:00Z"
status: "active"
---

# Research Intake

Turns a vague "I want to look into X" into a properly scoped, properly filed research topic.
It asks a short sequence of questions, then creates the topic folder and seeds its README.

## When to run

- The user wants to start/scope a new research topic or investigation.
- The user describes a question or decision they need answered with research.
- You're about to create research files and no `RS-NN` topic folder exists yet for them.

If a topic folder already exists and the user just wants to add to it, skip the intake and work inside that folder.

## The intake sequence

The questions live in `questions.md` next to this file. **Read `questions.md` and ask those
questions** — it is the single, editable source of truth, so the user can customize the intake
without touching this skill. Ask them conversationally, a few at a time, not as a wall of text.

Guidance while interviewing:
- Pull answers from the existing conversation first; only ask what's genuinely unknown.
- If the user is vague on scope, push gently for what's explicitly *out* of scope — that's the
  most valuable answer and the easiest to skip.
- Keep it short. The goal is a usable scope, not a contract. 3–8 questions is the target.
- If the user says "just go", infer sensible defaults, state them, and proceed.

## After the interview — scaffold the topic

1. **Pick the next free tag.** List `Research/` and find the highest existing `RS-NN`; the new one
   is the next integer, zero-padded. Never reuse a retired number. (`RS-00` is the template — skip it.)
2. Pass the completed answers to `.claude/scripts/okf.py new-research`; never allocate a tag
   manually.
3. The generator creates `topic.md`, `index.md`, `log.md`, and indexed `sources/`, `notes/`, and
   `outputs/` directories in one transaction.
4. It synchronizes the master roadmap and managed indexes, then validates official OKF and the
   strict project profile.
5. **Confirm** the tag, path, objective, and validation result. Begin work only inside the generated
   topic folder.

## Hard rules (also enforced by the PreToolUse hook)

- Research docs go **only** inside `Research/RS-NN-*/`. Never loose in `Research/`.
- Every live Markdown document is an OKF concept or reserved index/log.
- Non-Markdown source artifacts require same-stem `Source Reference` concepts.
- Research notes and outputs require `# Citations`.
- One topic = one folder = one tag. Don't scatter a topic's files.

If a write gets blocked by the hook, you violated one of the above — create the proper folder and retry; don't work around it.
