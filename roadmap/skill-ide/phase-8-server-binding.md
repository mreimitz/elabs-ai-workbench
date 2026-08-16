# Phase 8 — Server-bound skill authoring (WP specs) · locked decision I9

> Owner-locked 2026-07-04. Runs AFTER the current W3–W6 waves (recommended: W7 `8.1` →
> W8 `8.2 ∥ 8.4` → W9 `8.3`). 8.1 writes `packages/shared` + a migration — serialize with any
> in-flight workstream per the cross-workstream decision-log convention (claim the next free
> `user_version`; Benchmarks currently holds v13–v15).

## WP 8.1 — Contract, binding, `tool_ref` projection
**Size:** L · **Depends on:** 1.2 · shared + API migration

**Objective:** the foundations of I9: portable frontmatter binding, exact-server resolution,
and tools as text-projected graph citizens.

**Files:** `packages/shared` (node kind `tool_ref` + node fields `{ toolName, serverName? }`;
edit-op member `add_tool_ref { nodeId, server, tool, sentence? }` as a 400-stub; binding shapes
`SkillServerBinding { serverName, serverId | null }`; frontmatter `servers?: string[]` on the
manifest types); migration: `skill_server_bindings (skill_id FK, server_name, server_id NULL,
PRIMARY KEY(skill_id, server_name))`; `apps/api/src/skills/manifest.ts` (parse `servers:` like
`keywords:` — tolerated, order-preserving); NEW shared extraction helper
`apps/api/src/skillflow/extract-tools.ts` (the conservative heuristic from WP 5.1's notes —
**single implementation used by both the projector and 5.1's validator**); projector emits
`tool_ref` accessory nodes (leaf + `calls` edge from the referencing section, id pinned by
line + name, source `inferred`) — TEXT EVIDENCE ONLY, no scan reads (projector purity, I9.2);
`PROJECTOR_VERSION` bump + zero-reference regression lock (existing fixtures project unchanged
modulo nothing — they contain no tool references; assert exactly that); binding API
`GET/PUT /api/skills/:id/bindings` (resolves names → registered servers; unknown name ⇒
`serverId: null`, never a guess); `node-kind-meta.tsx` entry for `tool_ref` (wrench-style
lucide glyph, muted tone until overlay upgrades it).

**Acceptance:** multi-command fixture extended with two tool references projects the
`tool_ref` nodes deterministically (accessory side-column layout picks them up with ZERO layout
changes — assert positions); binding CRUD round-trips incl. the unbound state; frontmatter
`servers:` survives round-trip byte-exactly when untouched; migration forward-safe; gate green.

## WP 8.2 — Editor assistance: completion + hover from bound scans
**Size:** M · **Depends on:** 8.1 · API + Web

**Objective:** authoring against a real server's tool surface without leaving the editor.

**Files:** API — `GET /api/skills/:id/versions/:vid/bound-tools` (for each RESOLVED binding:
the server's latest completed scan's tools as `{ serverName, toolName, description,
schemaParams: [{name, type, required}], definitionTokens }` — read via
`ScanRepository.getLatestForServer`, never live). Web — a `use-bound-tools.ts` fetcher + Monaco
wiring in the `CodeEditor` `onMount` of the section-body editor (and the 3.2 Files-tab editor
if merged): a **completion provider** scoped to backtick context offering bound tool names
(server-prefixed detail line), and a **hover provider** rendering the popup: tool name +
owning server, description excerpt, parameter list from the schema summary, definition token
cost. Providers are registered once per mount and disposed on unmount (track disposables).

**Acceptance:** with a seeded fixture server + scan: completion inside backticks offers exactly
the bound tools; hover on a known tool shows the popup with correct tokens **and a "Test this
tool…" action** (Monaco command-link in the hover markdown → opens the WP 8.5 runner; hidden
when the binding is unresolved); unbound skill ⇒ no providers registered (honest degradation);
disposal proven (no duplicate suggestions after remount); gate green + smoke screenshot.

## WP 8.3 — Tools palette, drag-to-reference, tool detail card, footprint readout
**Size:** L · **Depends on:** 8.1, 8.2 · API + Web

**Objective:** the visual half of I9.3 — tools browsable, insertable, and inspectable on the
canvas.

**Files:** implement `add_tool_ref` (replace the 8.1 stub in `edit-ops.ts` + splice in
`roundtrip.ts`: append a reference sentence — default "Call \`<tool>\`." — to the target
section's body; same anchored mechanics as `add_asset_ref`); Web —
`design/ToolsPalette.tsx` (per-server groups, `SearchInput` filter, per-tool definition token
cost, header = **total tool-surface footprint**: Σ definition tokens of tools currently
referenced AND resolved, labeled as scan-derived); insert-at-cursor into the body editor;
drag a palette tool onto a section node (same constrained `onConnect`-style staging as 2.2)
→ stages `add_tool_ref`; `tool_ref` node click → `NodeDetailPanel` tool card (scan data +
validation-overlay state + deep link to the server's tool detail/playground route + a
**"Test run" button opening the WP 8.5 runner**); the 5.1 overlay (when built) colors
`tool_ref` nodes ok/stale/unknown — until then nodes show resolved/unbound from bindings alone
(honest partial state).

**Acceptance:** live loop: bind server → palette lists its tools with costs → drag onto a
section → preview shows the new `tool_ref` node → save → clean SKILL.md diff (one appended
sentence) → re-projection shows the node; footprint header equals the hand-summed reference
set; unbound skills show an empty-state palette with the binding picker CTA; both themes;
gate green + smoke screenshots.

## WP 8.4 — Scaffold: new skill from a server
**Size:** M · **Depends on:** 8.1 · API + Web

**Objective:** I9.4 — start a skill FROM a server's tool surface.

**Files:** API — `POST /api/skills/scaffold-from-server` (body: serverId, skill name/slug,
selected tool names): composes a SKILL.md via the existing blank-skill source path —
frontmatter (`name`, `description` stub, `servers: [<server name>]`), an intro section, one
`##` section per selected tool titled after the tool with the scan description's first
sentence + a backticked tool reference — then creates the skill (v1) and the binding rows
(resolved to the source server). Web — "New skill from server…" action on the Skills registry
view: wizard = server picker (registered servers with a completed scan) → tool multi-select
(`DataTable` with token costs) → name/slug → create → open in Design tab.

**Acceptance:** scaffold from a seeded fixture server yields a valid skill: manifest parses,
projector emits one section + one `tool_ref` per selected tool, bindings resolved, palette and
completion immediately live; servers without a completed scan are not offered; slug collisions
→ 409 surfaced inline; both themes; gate green.

## WP 8.5 — Inline tool test run (owner-added 2026-07-04)
**Size:** M · **Depends on:** 8.2, 8.3 · Web (+ tiny shared extraction)

**Objective:** a tool popup is not just documentation — it can DO: run the real tool against
the bound server from inside the IDE, with the same measured request/response token cost the
playground reports.

**Files:** extract the schema-form + call + result machinery from
`apps/web/src/features/scans/ToolPlayground.tsx` into a reusable
`components/ToolRunner.tsx` (the scans playground becomes a consumer — no behavior change
there, asserted); a `Sheet`-based runner in the skills feature: opened from the 8.2 hover
command-link and the 8.3 tool-card button, pre-resolved via the skill's binding
(`serverId` + `toolName`), schema-generated form (interaction-guidelines rules apply), calls
the EXISTING `POST /api/servers/:id/tools/:toolName/call`, renders result (Monaco viewer as in
the playground) + request/response tokens & bytes.

**Rules:** strictly user-initiated — nothing runs on hover/open; tools whose scan annotations
mark destructive/open-world behavior get a confirmation step naming the annotation; unresolved
binding ⇒ the affordance is disabled with the reason (never a broken run); results are
ephemeral IDE state (persisting playground history is out of scope). No new endpoint, no new
invariant: this is the built playground surfaced where authors work.

**Acceptance:** against a seeded stub server: hover → Test → form from the real schema → run →
result + token readout; destructive-annotated fixture tool requires the confirm; unbound skill
shows the disabled state; scans playground still passes its existing behavior (extraction
regression-checked); both themes; gate green + smoke screenshot.
