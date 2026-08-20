---
type: "Roadmap Item"
title: "Illustration design system — theme-token-driven blueprint illustrations"
description: "Build a design system of isometric blueprint illustration components for the app's own entities, driven live by the theme tokens, with a machine-readable registry, a declarative scene spec, an explain-mode step player and assistant-composed scenes."
tags: ["roadmap", "RM-14"]
timestamp: "2026-08-20T13:47:37Z"
status: "planned"
---

# Illustration design system — theme-token-driven blueprint illustrations

## Goal

Build a design system of isometric blueprint illustration components for the app's own entities, driven live by the theme tokens, with a machine-readable registry, a declarative scene spec, an explain-mode step player and assistant-composed scenes.

## Why it matters

The app explains complex internal processes in prose alone; a consistent, theme-aware illustration layer would make them legible.

## Milestones

- [ ] Phase 1 — the token layer and core components.
- [ ] Phase 2 — the registry and the in-app gallery.
- [ ] Phase 3 — the scene spec and renderer.
- [ ] Phase 4 — explain mode.
- [ ] Phase 5 — assistant composition.

## Linked research

No linked research yet.

## Plan overview (from the original plan README)

A design system for **explanatory process illustrations** of the app's own entities and
workflows: isometric blueprint-style components (LLMs, agents, MCP servers, skills, runs,
suites, …) whose colors derive live from the active theme, a machine-readable **registry**
(the in-app asset repository at `/illustrations`), a declarative **scene spec** for composing
workflows from components, an **explain mode** that walks users through app-internal
processes step by step, and **assistant composition** (describe a workflow in chat → get the
scene).

| Doc | What it holds |
| --- | --- |
| [`00-research.md`](./00-research.md) | The research: reference-image deconstruction, visual-language spec, token-derivation logic, technology argument, entity catalog, risks |
| [`01-system-design.md`](./01-system-design.md) | Package architecture, component/port model, registry, scene spec, app surfaces (gallery · explain mode · scene library · assistant tools), growth process |
| [`decisions.md`](./decisions.md) | **Locked decisions D-IL1–D-IL17** |
| [`02-plan.md`](./02-plan.md) | Phases 0–4, work packages |
| [`STATUS.md`](./STATUS.md) | **Authoritative ledger** (drive with `/next-wp illustrations`) |
| [`examples/`](./examples/) | Working exemplars: [`Agent.example.tsx`](./examples/Agent.example.tsx) (package-shaped component — iso-math, face transforms, tokens, states, ports, registry entry) with both-theme previews (`agent-*.png`, `agent-preview.html`); and the **run-flow scene** — [`run-flow.scene.json`](./examples/run-flow.scene.json) (SceneSpec dogfood, discovered the `cycle` band kind) rendered as "Anatomy of a Run" (`run-flow-*.png`, `run-flow-preview.html`). Regenerate via the `build-*.py` scripts |

Origin: the owner's hand-made "Self-Learning Agentic Loop" reference image (2026-07-12) — the
style to systematize; its rebuilt one-off lives at `illustrations/` (repo root), which remains
an export-output folder once the system exists (D-IL14).
