# SkillFlow — validated architecture & locked decisions

SkillFlow is a visual IDE + execution tracer for Agent Skills, built **into** this app's existing
Skills capability. It adds two views over entities that already exist here — skills
(`skills`/`skill_versions`/`skill_files`/`skill_blobs`), scenario attachments (`scenario_skills`),
and test runs (`runs`/`run_steps`) — plus one new subsystem: external session-log ingestion.

The framing: **process mining for AI.** A design-time model (the skill as intended, projected from
`SKILL.md`) is conformance-checked against an event log (the session as it actually ran). Trace
insights flow back into skill improvements, closing the loop.

This document supersedes the original handover draft where they differ — every assumption below was
validated against this codebase (2026-07-02).

## Locked decisions

### D1 — SkillFlow lives inside the existing Skills Management UI
Design and Trace are **two new tabs** on the existing `SkillInspector`
(`apps/web/src/features/skills/SkillInspector.tsx`, today: Overview / Files / Versions / Diff).
No new top-level nav section, no separate app. The canvas renders whichever **version** the
inspector's existing version picker selects.

### D2 — The graph must work for *every* skill (inference-first projection)
Skills arrive by upload, GitHub import, or (new) blank creation — most will carry **no**
SkillFlow-specific markup. Therefore the projection engine is **inference-first**: any valid
`SKILL.md` yields a useful graph from structure alone —

- headings / ordered sections → **sub-routine** nodes (document order → default edges),
- relative-path references to bundled files → **asset** nodes (validated against `skill_files`),
- script references + exit-code/verification language → **validation-gate** nodes,
- explicit decision/branching language ("if … then …", routing tables) → **gatekeeper** nodes with
  condition-labelled edges,
- repeat/retry language → **loop-guard** hints.

Optional, lightweight **in-file annotations** (HTML comments, `<!-- skillflow:… -->`) refine the
inferred graph — never required, never a side-car file, invisible to rendered markdown, and inert
for the consuming agent. Every node carries an **anchor** (heading path + line range) back into the
markdown.

### D3 — Blank skill as a first-class third source
The add-skill wizard (`SkillWizard`) gains a **Blank** source next to Upload and GitHub:
name + description → the API scaffolds a minimal, spec-valid `SKILL.md` (frontmatter + starter
section skeleton) and registers it as version 1 **through the existing ingest path** (manifest
validation, caps, token footprint all apply). A blank skill is immediately openable in the Design
tab and grows from there.

### D4 — The app NEVER executes skill content (invariant preserved, unchanged)
The Phase-1/2 skills invariant stands verbatim: skill files are stored, inspected, and disclosed to
the agent-under-test **read-only** (`read_skill_file` / `list_skill_files`); no execution path
exists in this app. **Validation gates execute only inside the session the skill is attached to** —
the agent runtime that scenarios attach skills to (this app's own test runs) or an external Claude
Code session. SkillFlow **observes** gate outcomes (exit codes, tool results) from the persisted
run steps or the ingested session log. Trace Mode adds zero execution surface.

### D5 — SKILL.md stays the source of truth; editing = a new immutable version
The graph is a **projection** of the markdown, never a format that generates it. Round-trip editing
(Phase 4) rewrites only the anchored regions it changed, preserves hand-written prose byte-for-byte
elsewhere, and submits the modified tree as a **new immutable version** via the existing
`POST /api/skills/:id/versions` ingest path — so versioning, diff, footprint, and GitHub-pull
semantics all keep working, and git diffs of `SKILL.md` stay meaningful. There is deliberately no
in-place file mutation.

### D6 — One trace source: this app's own test runs (AMENDED by owner decision 2026-07-03)
A single shared **trace-event vocabulary** (tool calls, file reads, script results/exit codes,
subagent spawns, turns, markers) normalized from **internal runs**: `run_steps` persists a typed,
ordered event stream — attached-skill file reads surface as metered `read_skill_file` tool calls —
so Trace Mode is a **read + align**, not an ingestion problem. The `run_skills` record joins a run
to the exact skill versions it resolved.

> **Amendment (owner, 2026-07-03):** the originally planned second source — uploaded external
> Claude Code session JSONL (built as WP 3.1) — was **removed**: session logs must be the ones
> this app produces in its own test runs, based on the scenario the skill is attached to. The
> vocabulary and aligner remain source-agnostic (the `script_result`/`subagent_spawn` event types
> stay), so re-adding an external source later is a new normalizer, not a redesign. The removal
> landed as migration v12 (drops the session tables); the WP 3.1/3.2 ingestion design survives in
> git history and `breadcrumb-convention.md`.

### D7 — Alignment is deterministic first; semantics later and owner-gated
Order of attack for mapping a session onto the design graph:
(a) **deterministic signals** — tool name → sub-routine, skill-file read path → asset node, script
exit code → validation gate verdict, subagent spawn → sub-routine, visit counts → loop detection;
(b) **breadcrumb convention** (Phase 3) — skills instruct the agent to emit a trivial marker at
each gatekeeper decision, turning misrouting detection into exact matching;
(c) LLM-as-judge semantic drift is **out of scope** until Phase 5, and needs owner sign-off
(it implies model calls, cost, and non-determinism in verdicts).

### D8 — Reuse the existing taxonomy and contracts
- Node kinds align with the existing `skill_files.kind` classification
  (`skill_md|reference|script|asset|other`) — no parallel taxonomy.
- All wire shapes land in `packages/shared` first (types + zod), additive `/api` routes only.
- Gate expectations (Phase 5) unify with the reserved `tests.assertions_json` column rather than
  inventing a second assertion format.
- UI is `@elabs-ai/components-*` only. The canvas is the already-vendored **`@elabs-ai/components-flow`** v1.6.0
  (`CanvasShell`, `FlowNode` with `tone: default|accent|success|warning|destructive`, `FlowEdge`,
  `InspectorPanel`, `Legend`, `ZoomControls`) — installed today with zero imports; SkillFlow is the
  feature that wires it in. Conversation rendering beside the trace reuses the existing
  `@elabs-ai/components-ai` testing-console components; markdown/code editing reuses `@elabs-ai/components-editor`.

## The three schemas everything hangs off (WP 1.0)

1. **Skill graph IR** — `SkillGraph { nodes, edges, warnings }`; node kinds
   `gatekeeper | subroutine | asset | validation_gate | loop_guard`; every node has
   `{ id, kind, label, anchor: { headingPath, startLine, endLine }, source: 'inferred'|'annotated' }`
   plus kind-specific fields (asset → `path`+`fileKind`, gate → `script`+`expectation`); edges carry
   `{ from, to, condition?, anchor? }`.
2. **Trace-event vocabulary** — normalized events:
   `turn | tool_call | tool_result | skill_file_read | script_result | subagent_spawn | marker | user_message`,
   each `{ idx, at?, payload }` with source-specific raw references preserved.
3. **Session-trace shape** — `{ source: 'run'|'session_upload', ref, skillVersionId, events[],
   alignment: { nodeVisits, edgeTraversals, verdicts } }` where a verdict is
   `{ nodeId|edgeId, status: 'ok'|'fracture'|'unvisited', reason, evidence: eventIdx[] }`.

## Graph projection (WP 1.1) — where it runs

Server-side, `apps/api/src/skillflow/`, exposed as
`GET /api/skills/:id/versions/:vid/graph` and computed from the stored blobs (raw `SKILL.md` +
`skill_files` listing). Deterministic and cheap (pure text analysis — **no model calls**), so it can
be computed on demand and cached per `(version_id, projector_version)`. A `projector_version` stamp
mirrors the `counting_version` pattern: alignments computed under different projector versions are
never silently compared.

## Trace alignment (WP 2.2) — where it runs

Server-side, same module family: `alignTrace(graph, events) → alignment`. Pure function over the
two shared shapes; property-tested with synthetic traces. Exposed as
`GET /api/skills/:id/versions/:vid/trace?runId=…` (Phase 2) and `…?sessionId=…` (Phase 3).

## What Trace Mode shows (WP 2.3)

Same canvas as Design, plus: `tone="success"` on nodes/edges that executed as designed,
`tone="destructive"` on fractures (failed gate, misroute, loop over threshold), dimmed style for
never-visited nodes, execution-count badges, exit-code chips on gates, expected-vs-actual route
markers on gatekeepers, and traversal counts on trace edges. A run picker lists runs whose scenario
had this skill attached (via `run_skills`); a side pane renders the conversation turns
(`@elabs-ai/components-ai`) synced to node selection — click a fracture, see the exact turns that produced it.

## Explicit non-goals

- No skill execution, no script sandbox, no "run gate" button — ever (D4).
- No proprietary graph persistence — the graph is always recomputed from `SKILL.md` (D5).
- No live session streaming in v1 — traces are post-hoc (persisted runs / uploaded logs).
- No cross-repo split: SkillFlow ships in this repo, inside the existing Skills feature (D1).
