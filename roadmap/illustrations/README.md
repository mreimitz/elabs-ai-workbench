# Illustrations — theme-token-driven "3D blueprint" illustration system

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
