---
type: "Roadmap Item"
title: "SkillFlow — the visual skill designer and tracer"
description: "Add a visual skill designer and execution tracer to the skill inspector: graph edits that become new immutable versions, a test-run conformance overlay, gate assertions on tests and a fracture-to-suggestion feedback loop."
tags: ["roadmap", "RM-23"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---

# SkillFlow — the visual skill designer and tracer

## Goal

Add a visual skill designer and execution tracer to the skill inspector: graph edits that become new immutable versions, a test-run conformance overlay, gate assertions on tests and a fracture-to-suggestion feedback loop.

## Why it matters

A skill's intended execution flow existed only in prose, so nothing could check whether a real run followed it.

## Milestones

- [ ] Phase 1 — the design tab and graph projection.
- [ ] Phase 2 — graph editing as new versions.
- [ ] Phase 3 — the trace tab.
- [ ] Phase 4 — conformance and gate assertions.
- [ ] Phase 5 — the feedback loop.

## Linked research

- [RS-02](/Research/RS-02-skill-registry/topic.md)

## Plan overview (from the original plan README)

Executable plan for **SkillFlow** — a visual skill **designer** (Design Mode) and execution
**tracer** (Trace Mode) built into the existing **Skills** section — driven by `/next-wp skillflow`.
The validated architecture and every locked decision live in
[`00-architecture.md`](./00-architecture.md). Shared rules: [`conventions.md`](./conventions.md).
Living state: [`STATUS.md`](./STATUS.md).

> **Precondition (skills-ledger rule):** the deferred owner-acceptance items in
> [`../skills/STATUS.md`](/Roadmap/RM-24-skills/STATUS.md) must be closed or explicitly waived before
> Phase 1 here opens.

## What we're building

Two new tabs inside the existing `SkillInspector` (Skills section — **no new nav section**):

- **Design** — the selected skill version rendered as an interactive node graph (gatekeeper /
  sub-routine / asset / validation-gate / loop-guard nodes, routed edges), projected from the raw
  `SKILL.md` by an inference-first parser so it works for **every** skill — uploaded, GitHub-imported,
  or newly created **blank** (a new third source in the add-skill wizard). Read-only first; later
  phases add editing with round-trip back to `SKILL.md` as a **new immutable version**.
- **Trace** — a real execution overlaid on that same graph: nodes/edges that ran as designed light
  green, fractures (misrouting, failed gates via non-zero exit codes, loops, never-visited paths)
  light red/dimmed. Trace sources: (a) this app's own persisted test runs (`run_steps`), (b) uploaded
  external Claude Code session JSONL. **The app never executes skill content** — gates run only
  inside the session the skill is attached to via scenarios; SkillFlow observes.

Canvas + overlay UI come from the already-vendored **`@elabs-ai/components-flow`** (currently installed, unused):
`CanvasShell`, `FlowNode` (`tone: success|warning|destructive`), `FlowEdge`, `InspectorPanel`,
`Legend`, `ZoomControls`.

## WP index

### Phase 1 — Foundation: contracts, graph projection, blank skill, read-only Design tab
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.0 | Shared contract (graph IR + trace vocabulary + session-trace shape) | — | M |
| 1.1 | SKILL.md → graph projection engine + graph route | 1.0 | L |
| 1.2 | Blank-skill creation (API `source:'blank'` + wizard third source) | — | M |
| 1.3 | Web: Design tab — read-only canvas on `@elabs-ai/components-flow` | 1.1 | L |

### Phase 2 — Trace Mode over internal runs
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | Run→trace normalizer + `run_skills` persistence (which version ran) | 1.0 | M |
| 2.2 | Alignment engine (deterministic signals → verdicts) | 1.1, 2.1 | L |
| 2.3 | Web: Trace tab — overlay, run picker, conversation pane | 1.3, 2.2 | L |

### Phase 3 — External session ingestion
| WP | Title | Depends on | Size |
|---|---|---|---|
| 3.1 | Claude Code session JSONL ingestion → shared trace vocabulary | 2.2 | L |
| 3.2 | Breadcrumb convention + gatekeeper verdict hardening | 3.1 | M |

### Phase 4 — Design editing (round-trip)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 4.1 | Graph-edit → SKILL.md round-trip engine (anchors, new version) | 1.1 | L |
| 4.2 | Web: Design-tab editing via `InspectorPanel` + save-as-new-version | 1.3, 4.1 | L |

### Phase 5 — Gates as first-class tests + the feedback loop
| WP | Title | Depends on | Size |
|---|---|---|---|
| 5.1 | Validation-gate expectations unified with `tests.assertions_json` | 2.2 | M |
| 5.2 | Trace → suggested SKILL.md edit (feedback loop) | 4.1, 5.1 | M |

## Dependency graph

```
1.0 → 1.1 ─┬→ 1.3 ─────────┬→ 2.3
           │               │
1.2 (independent)          │
           │               │
1.0 → 2.1 ─┴→ 2.2 ─────────┤
                    │      └→ 4.2 (needs 4.1)
                    ├→ 3.1 → 3.2
                    ├→ 5.1 ─┐
1.1 → 4.1 ──────────────────┴→ 5.2
```

## Recommended build order

1. **Spine, serial:** `1.0 → 1.1` (contract → projection engine). `1.2` (blank skill) can run in
   parallel with `1.1` — different files.
2. `1.3` (Design tab, read-only) — the first visible deliverable; demo checkpoint.
3. **Trace slice:** `2.1 → 2.2 → 2.3` — the "aha" (green/red overlay on a real run). Second demo
   checkpoint; de-risks alignment before any editing complexity.
4. `3.1 → 3.2` (external sessions) ∥ `4.1` (round-trip engine) — independent of each other.
5. `4.2` (editing UI), then `5.1 → 5.2`.

Parallel batches honor **minimal file overlap** (see each WP's **Files**); WPs touching
`packages/shared` or `apps/api/src/index.ts` are serialized to avoid collisions.

## Definition of done (every WP)

`pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root, plus the WP's
**Acceptance** checklist met. Contract-first, API runtime/secret boundary, `@elabs-ai/components-*`-only + two
themes, kebab/Pascal naming — see [`conventions.md`](./conventions.md).
