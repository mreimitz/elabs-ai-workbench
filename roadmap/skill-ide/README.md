# Skill IDE — implementation plan (work packages) · **PRIORITY: HIGH**

Executable plan turning the Skills + SkillFlow features into a **full enterprise-grade IDE for
Agent Skills**, driven by `/next-wp skill-ide`. Locked decisions: [`00-architecture.md`](./00-architecture.md).
Shared rules: [`conventions.md`](./conventions.md) (inherits the SkillFlow conventions wholesale).
Living state: [`STATUS.md`](./STATUS.md).

Owner directive (2026-07-03): quality checks · create a GitHub repo from a skill · optimization
suggestions · folders/subfolders (file management) · organize/manage trigger keywords and
/commands · smart editor validation against tools from registered MCP servers · **every /command
gets its own starting point in the flow graph**, the graph visualizes the execution flow the skill
suggests, and the flow itself is an editor: create/update/delete /commands and connect flows to
assets.

## What we're building (on top of SkillFlow)

1. **Command-aware graph**: the projector recognizes **entry points** — /commands and trigger
   keywords — and projects one flow per entry point, each with its own start node. The canvas
   lays flows out as lanes; a flow picker filters the view.
2. **Flow editor v2**: create, rename, and delete /commands and connect flow steps to assets
   directly on the canvas (drag-to-connect), all round-tripping to `SKILL.md` as new immutable
   versions through the existing edit-ops engine.
3. **Workspace**: the Files tab becomes a file manager — create folders/subfolders, create,
   rename, move, delete, and edit files; every mutation is a tree-level edit op producing a new
   version (immutability preserved).
4. **Quality**: a deterministic quality engine (rules + score) per skill version, and static
   (trace-less) optimization suggestions extending the SkillFlow suggestion engine — surfaced in
   a new Quality tab with apply-able fixes.
5. **MCP-aware validation**: tool references in `SKILL.md` are validated against the **latest
   scans of registered MCP servers** (this app's core dataset) — unknown/removed tools become
   editor diagnostics and canvas badges, with close-match candidates.
6. **Keywords & triggers**: manage the skill's trigger surface (description phrasing, keywords,
   /commands) with cross-skill collision detection.
7. **Publish to GitHub**: create a new GitHub repository from a skill version (PAT-authenticated,
   encrypted at rest) and bind it as the skill's GitHub source — closing the loop with the
   existing import/pull machinery.

## WP index

### Phase 1 — Command-aware graph core
| WP | Title | Depends on | Size |
|---|---|---|---|
| 1.1 | Contract v2: entry-point nodes, flows, keywords (projector v2 stamp) | — | M |
| 1.2 | Projector v2: /command + trigger detection, per-entry flows | 1.1 | L |
| 1.3 | Canvas v2: flow lanes, entry-point start nodes, flow picker | 1.2 | L |

### Phase 2 — Flow editor v2
| WP | Title | Depends on | Size |
|---|---|---|---|
| 2.1 | Edit-ops v2: add/rename/delete_command, set_keywords, connect/disconnect_asset | 1.2 | L |
| 2.2 | Canvas editing: command CRUD on canvas + drag-to-connect assets | 1.3, 2.1 | L |

### Phase 3 — Workspace (files & folders)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 3.1 | Tree edit ops: create/rename/move/delete files + folders → new version | — | L |
| 3.2 | Files tab → file manager (folder tree CRUD, Monaco editing, save-as-version) | 3.1 | L |

### Phase 4 — Quality
| WP | Title | Depends on | Size |
|---|---|---|---|
| 4.1 | Quality engine: deterministic rules + score + route | 1.2 | L |
| 4.2 | Static optimization suggestions (trace-less rules in the suggestion engine) | 4.1 | M |
| 4.3 | Quality tab: score card, findings, apply-able fixes | 4.1, 4.2 | M |

### Phase 5 — MCP-aware smart validation
| WP | Title | Depends on | Size |
|---|---|---|---|
| 5.1 | Tool-reference extraction + validation vs latest MCP scans (diagnostics) | 1.2 | L |
| 5.2 | Editor markers + canvas tool badges + validation-scope config | 5.1 | M |

### Phase 6 — Keywords & triggers
| WP | Title | Depends on | Size |
|---|---|---|---|
| 6.1 | Trigger-surface manager (keywords/commands panel) + cross-skill collision report | 1.2, 2.1 | M |

### Phase 7 — Publish to GitHub
| WP | Title | Depends on | Size |
|---|---|---|---|
| 7.1 | API: create GitHub repo from a version + initial push + bind as source | — | L |
| 7.2 | UI: Publish-to-GitHub wizard | 7.1 | M |

### Phase 8 — Server-bound skill authoring (I9, owner-locked 2026-07-04)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 8.1 | Contract + binding (frontmatter `servers:` → exact registered server) + `tool_ref` projection | 1.2 | L |
| 8.2 | Editor assistance: Monaco completion + hover popup from bound servers' latest scans | 8.1 | M |
| 8.3 | Tools palette + drag-to-reference (`add_tool_ref`) + tool detail card + footprint readout | 8.1, 8.2 | L |
| 8.4 | Scaffold: new skill from a server (tool multi-select → seeded SKILL.md + bindings) | 8.1 | M |
| 8.5 | Inline tool test run from hover/tool card (extracted `ToolRunner`, binding-resolved, destructive-confirm, token readout) | 8.2, 8.3 | M |

### Phase 9 — Unified Flow/Code editing + education layer (I10, owner-locked 2026-07-04)
| WP | Title | Depends on | Size |
|---|---|---|---|
| 9.1 | Live-draft engine: stateless apply-preview + project-preview, save w/ intent log, staging migration | 1.2, 2.1, 3.1 | L |
| 9.2 | Unified editor shell: Show flow \| Show code \| Split, selection sync via anchors, one Save bar | 9.1, 1.3 | L |
| 9.3 | Code-mode intelligence: kind decorations, construct hovers, authoring snippets/completions | 9.1 | L |
| 9.4 | Education layer: explainer registry (guide-anchored) + unified problems panel in both modes | 9.1 | M |

## Dependency graph / build order

```
1.1 → 1.2 ─┬→ 1.3 ─┐
           │       ├→ 2.2
           ├→ 2.1 ─┘
           ├→ 4.1 → 4.2 → 4.3
           ├→ 5.1 → 5.2
           └→ 6.1 (also needs 2.1)
3.1 → 3.2          (independent of Phase 1)
7.1 → 7.2          (independent)
1.2 → 8.1 ─┬→ 8.2 ─┬→ 8.3 ─┬→ 8.5
           └→ 8.4  └───────┘
(1.2, 2.1, 3.1) → 9.1 ─┬→ 9.2 (also needs 1.3)
                       ├→ 9.3
                       └→ 9.4
```

Recommended waves: **W1** 1.1 (solo, contract) → **W2** 1.2 ∥ 3.1 ∥ 7.1 → **W3** 1.3 ∥ 2.1 ∥ 4.1 →
**W4** 2.2 ∥ 3.2 ∥ 5.1 → **W5** 4.2 ∥ 5.2 ∥ 7.2 → **W6** 4.3 ∥ 6.1 → **W7** 8.1 (shared+migration
writer — serialize cross-workstream) → **W8** 8.2 ∥ 8.4 → **W9** 8.3 → **W10** 9.1 ∥ 8.5 → **W11**
9.2 ∥ 9.3 → **W12** 9.4. Parallel batches honor minimal file overlap; `packages/shared` and
`run-service` writers serialize as always. The 5.1 validation overlay enriches Phase 8's
`tool_ref` nodes but is not a hard dependency (8.3 renders an honest partial state until it
lands). Phase 9 **migrates** the 2.2/3.2 staged-buffer UX onto the live draft (I10) — W3–W6
proceed unchanged.

## Definition of done (every WP)

`pnpm typecheck && pnpm test && pnpm build && pnpm lint` green from the repo root, plus the WP's
Acceptance met. Contract-first, API runtime/secret boundary, never-execute invariant, `@elabs-ai/components-*`
only + two themes — see [`conventions.md`](./conventions.md).
