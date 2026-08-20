---
type: "Work Package Spec"
title: "Skill IDE \u2014 architecture & locked decisions"
description: "Successor plan to ../skillflow/ (all 13 WPs shipped). Skill IDE turns the"
tags: ["roadmap", "RM-22"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Skill IDE — architecture & locked decisions

Successor plan to [`../skillflow/`](/Roadmap/RM-23-skillflow/) (all 13 WPs shipped). Skill IDE turns the
Skills + SkillFlow features into an enterprise-grade IDE. Every SkillFlow decision (D1–D8,
as amended) remains binding; the decisions below extend them.

## Locked decisions

### I1 — Entry points are first-class graph citizens
The graph IR gains an `entry_point` node kind with `trigger: { type: 'command' | 'keyword',
value: string }` (e.g. `/report`, or a trigger phrase). **Every /command gets its own start
node**, and every node/edge belongs to a **flow** (`flowId` = the owning entry point's id, or
`'main'` for the skill's default body flow). The canvas renders flows as horizontal lanes with
the entry point at the head; a flow picker filters to one flow. Projection stays inference-first
(D2): headings whose text starts with `/` (e.g. `## /report`) become command entry points; a
frontmatter `commands:`/`keywords:` list (already legal, spec-tolerated metadata) and
`<!-- skillflow:command id=… -->` annotations refine. Zero-command skills project exactly as
today: one `main` flow — **no regression for existing skills**. `SKILLFLOW_PROJECTOR_VERSION`
bumps; graph consumers treat `flowId` as additive.

### I2 — The canvas is an editor, panel-ops under the hood
Canvas-native interactions (create/delete/rename a /command, drag-to-connect a step to an asset)
compile down to the SAME edit-op vocabulary and round-trip engine (D5) — new ops
(`add_command`, `rename_command`, `delete_command`, `set_keywords`, `connect_asset`,
`disconnect_asset`) are anchored text edits like all others. Byte-exactness, stale-anchor 409,
and new-immutable-version semantics are unchanged. Drag-to-connect uses React Flow's connection
API (via `@elabs-ai/components-flow`'s underlying engine) but the drop only STAGES an op — nothing mutates
until Save.

### I3 — Folders and files are tree-level edit ops, versions stay immutable
The workspace (create folder/subfolder, create/rename/move/delete/edit files) never mutates
blobs: a batch of tree ops (`add_file`, `update_file`, `rename_file` [also = move], `delete_file`,
folders being implicit path prefixes with `add_folder` sugar creating a `.gitkeep`-free empty
prefix only at save-time materialization) produces a **new version** through
`SkillRepository.createVersion` — same dedupe, caps, footprint, and diff as every other path.
`SKILL.md` cannot be deleted or renamed (manifest invariant).

### I4 — Quality is deterministic rules with a transparent score
The quality engine is pure and versioned (`QUALITY_ENGINE_VERSION`): a rule set over
(manifest, files, graph, footprint) producing findings `{ ruleId, severity: 'error'|'warning'|
'info', message, anchor?, fix?: SkillEditOp[] }` and a 0–100 score with a documented formula
(weighted severity counts; the formula lives in code + doc, not vibes). Rules include: manifest
completeness, broken relative refs (projector warnings promoted), token budgets (L1/L2 ceilings
with defaults, env-overridable), unused assets, scripts without exit-code documentation,
breadcrumb adoption on gatekeepers, trigger hygiene (description length/specificity, keyword
duplication), and orphan sections (unreachable from any flow). No model calls; LLM-assisted
review remains owner-gated future work.

### I5 — MCP validation reads this app's own scan data
Tool references in `SKILL.md` (backtick-quoted tool names, `server:tool` mentions, and tool_call
names the projector already extracts) are validated against the **latest completed scan of each
registered MCP server** (`mcp_tool_scans`) — the app's core dataset. Diagnostics:
`unknown_tool` (no server has it), `stale_tool` (existed in an older scan, gone in the latest),
plus close-match candidates (existing normalized/fuzzy matching from the compare feature is
reused, not re-invented). Validation scope defaults to ALL registered servers, narrowable per
skill via an annotation (`<!-- skillflow:servers a,b -->`). Read-only over scan data; no MCP
calls are made by validation itself (never-scan-on-keystroke — it reads persisted scans only).

### I6 — Publish-to-GitHub reuses the import trust model
"Create GitHub repo from this skill" runs entirely API-side with the same encrypted-PAT handling
as import (`SkillGitService` patterns: PAT in argv-only credential helper, never on disk, never
returned, redacted errors). Flow: create repo via the GitHub REST API (PAT) → materialize the
version tree in a temp dir → `git init/commit/push` via the git CLI → optionally bind the repo
as the skill's `github` source so pull/upstream work immediately. No force-push ever; publishing
to a non-empty repo is refused (409).

### I7 — Keywords/trigger surface is managed, collisions are surfaced
The trigger surface (description phrasing, keywords, commands) gets a manager panel backed by
`set_keywords`/command ops, and a **cross-skill collision report**: deterministic overlap
detection (exact + normalized keyword/command collisions across all registered skills' current
versions) so an enterprise catalog can keep trigger phrases unambiguous. Read-only report +
deep links; resolution is a normal edit.

### I8 — Everything else inherits SkillFlow
Contract-first in `packages/shared`, additive-only; never-execute invariant (D4) untouched — the
quality engine, validation, and publisher never run skill content; `@elabs-ai/components-*`-only UI, two
themes; deterministic engines stamped with versions; ledger discipline via
[`STATUS.md`](./STATUS.md); the SkillFlow conventions file applies verbatim.

### I9 — Server-bound skill authoring (owner-locked 2026-07-04)
A skill can be developed **for specific MCP servers**, with its tool references first-class and
visual. Four parts, all scan-backed, never live:

1. **Binding = portable name + local resolution.** `SKILL.md` frontmatter carries a portable
   `servers:` list (tolerated metadata, survives GitHub sync/zip export, like `keywords:`).
   The IDE resolves each name to an **exact registered server** through a per-skill development
   binding (`skill_server_bindings`: skill → server name → registered `server_id`, editable in
   a picker). Unresolved names are an honest "unbound" state — features degrade, never guess.
   Bound servers are Phase 5's default validation scope (`skillflow:servers` remains a
   narrowing override).
2. **`tool_ref` is a graph citizen — projected from TEXT ONLY.** New additive accessory node
   kind `tool_ref` (the `entry_point` pattern): sections referencing a tool (the conservative
   extraction heuristic, shared with WP 5.1) get a leaf node + `calls` edge. The projector
   stays pure over file bytes — it never reads scans; existence/staleness/candidates arrive as
   a **separate validation overlay** (5.1 diagnostics + binding resolution) merged in the UI as
   node state (ok / unknown / stale / unbound). Projector version bumps; zero-reference skills
   project unchanged (regression-locked).
3. **Authoring aids read the bound servers' latest scans:** Monaco completion (tool names
   inside backticks) + hover popup (description, schema params, definition token cost, owning
   server), a Tools palette (searchable, per-server, token cost per tool + total tool-surface
   footprint) with insert-at-cursor and drag-onto-section staging a new additive
   `add_tool_ref` edit op, and a tool detail card on `tool_ref` nodes deep-linking to the
   server's tool page/playground. **Tool popups offer a real test run in place** (owner-added
   2026-07-04): the existing tool playground (schema-generated form →
   `POST /api/servers/:id/tools/:toolName/call` → result + measured request/response tokens)
   is reusable from the hover/detail card, resolved through the skill's binding — explicitly
   user-initiated, never automatic, destructive-annotation confirm required. This executes an
   MCP tool exactly like the built playground does (runtime boundary: the API makes the call);
   it does NOT touch the never-execute-skill-content invariant.
4. **Scaffold-from-server:** "New skill for server X" generates, via the existing blank-skill
   source, a skeleton with frontmatter binding + one section per selected tool seeded from the
   scan's descriptions.

All reads are persisted-scan reads (I5 discipline); no MCP connection is ever opened by
authoring features. Plan: [`phase-8-server-binding.md`](./phase-8-server-binding.md).

### I10 — One document, two live views: unified Flow/Code editing + education layer (owner-locked 2026-07-04)
The IDE must reach **full feature parity** between the flow canvas and the code editor, with
**dynamic switching (Show flow | Show code, plus split view)** and **live bidirectional sync**
— and it must *explain* every element of a skill while doing so.

1. **The live draft is canonical.** While editing, there is exactly ONE working state: the
   draft SKILL.md text (plus pending tree changes). Canvas interactions keep compiling to the
   existing edit-op vocabulary (I2's ops survive as the canvas's interaction language) but are
   **applied to the draft immediately** through the SAME server-side splice engine, exposed
   statelessly (`apply-preview`: content + ops → content′, pure, nothing persisted). The code
   editor edits the draft directly. Both views are therefore *always* in sync because neither
   owns state — the draft does. This is how "full bidirectional live sync" ships without
   two-way rebasing: one document, two projections.
2. **Live projection.** A stateless, pure preview endpoint (content → graph + warnings; the
   projector already never throws) re-projects the draft debounced as it changes; the canvas
   renders that projection, unsaved edits included. Same engine as persisted projection — one
   implementation, one version stamp.
3. **Save semantics.** Save turns the draft into a new immutable version (base-version check →
   409 on a moved head; the staged-op **intent log is attached as version metadata** so audit
   granularity survives the move to text-canonical saves). Amends I2's "nothing mutates until
   Save" — still true; what changes is that *staging* is now the shared live draft rather than
   an op buffer only the canvas sees. The 3.1 "ambiguous writers" 400 becomes obsolete on this
   path (there is only one writer: the draft).
4. **Parity is a tested contract.** Every authoring operation has a flow gesture AND a code
   idiom (+ snippet), tracked in the parity matrix (phase-9 file); acceptance walks both paths
   for every row. Selection syncs both directions via anchors (node ⇄ line range).
5. **The IDE teaches.** Every element — node/edge kinds, frontmatter keys, annotations,
   breadcrumb markers, tool/asset references — has a plain-language explainer + a deep link to
   its `docs/skill-authoring.md` anchor, surfaced in the node
   panel, a canvas legend, and Monaco hovers/gutter decorations. One **unified problems panel**
   (projector warnings + quality findings + tool diagnostics) renders identically in both
   modes, each item deep-linking node AND line AND guide anchor. Authoring snippets give code
   mode the same guided creation the canvas dialogs give flow mode. (Guided walkthrough mode
   was considered and deferred.)

Plan: [`phase-9-unified-editing.md`](./phase-9-unified-editing.md). Phases 2–3's staged-buffer
UX (2.2, 3.2) ships as specced and is **migrated** to the live draft by 9.1 — do not block
W3–W6 on this.

## Non-goals (this plan)
- No LLM-assisted anything (owner-gated, unchanged).
- No multi-user/auth/RBAC — the app stays single-owner local (enterprise-grade ≠ multi-tenant).
- No live MCP calls from validation (persisted scans only).
- No editing of GitHub-bound skills' upstream (publish creates NEW repos; pushing edits upstream
  stays out of scope as in WP 4.1).
