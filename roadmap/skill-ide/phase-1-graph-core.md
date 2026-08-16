# Phase 1 — Command-aware graph core (WP specs)

## WP 1.1 — Contract v2: entry-point nodes, flows, keywords
**Size:** M · **Depends on:** — · **Solo** (owns `packages/shared`)

**Objective:** the additive contract for everything in this plan, landed whole.

**Files:** `packages/shared/src/{types,schemas,constants}.ts`; contract tests in
`apps/api/test/skill-ide-contract.test.ts`.

**Contract:** `SkillGraphNode` gains kind `entry_point` (fields: `trigger: { type:
'command'|'keyword', value }`) and every node/edge gains additive `flowId?: string` (absent ⇒
`'main'`). `SkillGraph` gains `flows?: [{ id, label, entryNodeId? }]`. New edit-op union members
(types only here; semantics in 2.1/3.1): `add_command`, `rename_command`, `delete_command`,
`set_keywords`, `connect_asset`, `disconnect_asset`, `add_file`, `update_file`, `rename_file`,
`delete_file`. Quality shapes: `QualityFinding { ruleId, severity: 'error'|'warning'|'info',
message, anchor?, fix?: SkillEditOp[] }`, `QualityReport { findings, score, ruleCounts,
qualityEngineVersion }`. Validation shapes: `ToolDiagnostic { kind: 'unknown_tool'|'stale_tool',
name, anchor?, candidates: [{ server, tool, confidence: 'exact'|'normalized'|'fuzzy' }],
toolValidationVersion }`. Trigger-surface shapes: `TriggerSurface { description, keywords[],
commands[] }`, `TriggerCollision { value, kind, skillIds[] }`. Publish shapes:
`PublishToGithubInput { repoName, private, token?, bindAsSource }`, result with `repoUrl`.
Constants: bump `SKILLFLOW_PROJECTOR_VERSION` → 3 reserved comment (actual bump in 1.2),
`QUALITY_ENGINE_VERSION = 1`, `TOOL_VALIDATION_VERSION = 1`, quality token-ceiling defaults.

**Acceptance:** all shapes typed + zod + round-trip tested; existing SkillFlow contract
untouched except additive fields; gate green.

## WP 1.2 — Projector v2: /command + trigger detection, per-entry flows
**Size:** L · **Depends on:** 1.1

**Objective:** every /command in a SKILL.md gets its own entry-point start node and flow; the
graph shows the execution flow each command suggests.

**Files:** `apps/api/src/skillflow/{projector.ts, annotations.ts}`; tests
`apps/api/test/skill-ide-projector.test.ts` + new fixture skill
`apps/api/test/fixtures/skillflow/skills/multi-command/` (a skill with 2 commands + keywords +
shared assets).

**Rules:** headings starting with `/` (e.g. `## /report daily`) → `entry_point` node
(trigger.type 'command', value `/report`) + that section's subtree becomes its flow (`flowId`);
frontmatter `keywords:` (string list, tolerated metadata) → keyword entry points on the `main`
flow head; `<!-- skillflow:command id=… -->` pins ids; cross-flow references ("see /other")
project as edges between flows with a warning; content before any command heading stays flow
`'main'`. Zero-command regression lock: existing fixtures project identically modulo additive
`flowId:'main'` (fixture-locked test). `SKILLFLOW_PROJECTOR_VERSION` → 3.

**Acceptance:** multi-command fixture projects N entry points with disjoint flows; all existing
projector tests pass with only the locked additive delta; determinism + anchors hold; gate green.

## WP 1.3 — Canvas v2: flow lanes, entry-point start nodes, flow picker
**Size:** L · **Depends on:** 1.2 · Web-only

**Objective:** the canvas renders one lane per flow with the entry point at its head; a flow
picker (All / per-command) filters; entry-point nodes get distinct styling (play-icon,
`tone="accent"`, trigger value as title).

**Files:** `apps/web/src/features/skills/design/{graph-layout.ts, SkillGraphCanvas.tsx,
node-kind-meta.tsx, SkillDesignView.tsx}` (+ Trace view inherits lanes automatically via the
shared canvas — verify overlay still correct per flow).

**Acceptance:** multi-command skill renders lanes with own start nodes; flow picker filters
nodes+edges; single-flow skills look unchanged; Trace overlay unaffected (spot-check with the
seeded run); both themes; keyboard reachable; gate green + Playwright smoke screenshots.

**Implementation notes (verified 2026-07-04 — see also [`references.md`](./references.md)):**
`graph-layout.ts` is a pure, hand-rolled layered layout (no dependency; constants
`COLUMN_WIDTH=260`, `ROW_HEIGHT=140`, `SIDE_ROW_STEP=88`; section = "has outgoing edge", NOT
kind). Extend it, don't replace it:

- **Lanes = vertical bands per flow.** Group nodes by `flowId` (absent ⇒ `'main'`). Band order:
  `'main'` first, then flows by their entry point's `anchor.startLine`. Within a band, reuse the
  existing primary/accessory column algorithm unchanged, offset by a running `laneBaseY`
  (previous band's max row + one `ROW_HEIGHT` gap). The `entry_point` node renders at the band
  head (row 0, main column). Same graph → same positions must keep holding.
- **Lane labels:** a non-interactive label element per band (flow label + command token), not a
  graph node — if `@brand/flow` lacks a group/background primitive, absolutely position a styled
  div behind the canvas layer; do not invent a new node kind for it.
- **Flow picker:** toolbar `Select` — "All flows" + one entry per flow. Filtering hides
  nodes/edges of other flows; a **cross-flow edge renders only when both endpoints are
  visible** (deterministic, no dangling half-edges).
- **Trace overlay:** it colors nodes/edges by id and is layout-agnostic — verify with the
  seeded run that per-flow filtering doesn't strand verdict badges on hidden nodes (filter the
  overlay list by the same visibility predicate).
