# Assistant — Refinement R1: page-scope lock · skill-structure awareness · live edits

> Owner-driven refinement after the first working build (2026-07-10). Three ground rules from real
> use. Locked decisions **D-AS19–D-AS23** in [`decisions.md`](./decisions.md); ledger section
> **Refinement R1** in [`STATUS.md`](./STATUS.md). Same execution model as
> [`execution-plan.md`](./execution-plan.md) (Opus 4.8 orchestrator · parallel worktree subagents ·
> per-WP models · gate = `pnpm typecheck && pnpm test && pnpm build && pnpm lint`). Integration base:
> **`ux/integration`**. Schema is at **v21**; R1 needs **no migration** (scope is derived, workspace
> events are transient, the live-workspace read is off disk).

## The three rules (owner, verbatim intent)

1. **The assistant always operates in the current page scope.** Asked to enhance a skill from recent
   runs, it instead edited the **environment's system prompt**. That must never happen.
2. **On a skill the user is enhancing**, the assistant must know the skill's **full structure**, and
   the **skill-creator best-practices** must be loaded so edits follow best practice.
3. **When the assistant changes files**, show the changes in the **Files view in real time** and have
   the **UI navigate to the file being edited** as it happens.

## Root causes (grounded in the shipped code)

- **Rule 1 — two causes.** (a) *No scoping exists.* `apps/api/src/assistant/tools/index.ts`
  (`buildAssistantToolDefinitions`, ~154–581) unconditionally spreads **every** write tool
  (`environments_update`, `tests_*`, `servers_update_config`, `collections_modify`, `suites_*`,
  `skills_*_workspace`); the context envelope reaches the session
  (`session-manager.ts` refreshes `live.toolCtx.envelope` per message, ~337) but **tools are built
  once at session start with `envelope: undefined`** (~513) and never read it. (b) *Context is
  advisory.* `context-envelope.ts` renders the page as **"a hint, not an instruction"** — the model
  was told the page, not told to stay on it. Screenshot evidence: `environments_update` appears in
  the approval log on a skill page.
- **Rule 2.** Materialization already writes **all** files (`workspace.ts` `materializeWorkspace`,
  ~94–111), but `ASSISTANT_SYSTEM_PROMPT` (`system-prompt.ts`, ~21–55) says **nothing** about the
  active skill or its structure, and **no skill-creator exists in the repo** (grep clean; the only
  authoring guide is `docs/skill-authoring.md`, the quality rule↔guide contract).
- **Rule 3.** The Files tab (`apps/web/src/features/skills/SkillFileExplorer.tsx` via
  `SkillInspector.tsx`) reads **committed versions only**; the "Editing — save as a new version"
  draft is **browser-local** and unrelated to the assistant's **server-side** `ws/<threadId>/`
  workspace. The pump special-cases **only** `ui_action` (~586–597); there is **no**
  `workspace`/`file-changed` event in the `AssistantEvent` union, so an assistant edit is invisible
  until commit + manual reload.

## Design (what changes)

### D-AS19 — Hard page-scope lock (authoritative guard in the permission layer)
Writes are confined to the **current page's entity**; reads stay broad (it still reads runs/etc.).
- **Shared** (`packages/shared`): `AssistantScope = {entityKind, entityId} | null`;
  `SCOPE_WRITE_TOOLS: Record<AssistantEntityKind, readonly ToolName[]>` — e.g. `skill →
  {skills_open_workspace, skills_commit_workspace}`; `scenario`(environment) → `{environments_*,
  tests_*, expectations_set, attachments_manage, attach/detach_skill}`; `server →
  {servers_update_config}`; `collection → {collections_modify}`; `suite_run → {suites_*}`;
  `run`/`scan`/`compare` → **∅** (analysis surfaces, read-only). Helpers `deriveAssistantScope(envelope)`
  and `isWriteToolInScope(toolName, scope, input)` — the latter also **id-matches** the target
  (`skills_open_workspace`/`skills_commit_workspace` `skillId` must equal `scope.entityId`).
- **Enforcement is per-message in `canUseTool`** (`permission-classifier.ts` +
  `session-manager.ts` `handlePermission`, ~747), using the **current** envelope's scope (already
  refreshed per message). Any write/workspace tool **not in scope → deny** with a model-visible
  reason ("Out of scope: this session is working on `<kind> <id>`; `<tool>` would modify a different
  entity — ask the user to open that entity's page first."). **Unscoped (null) → all writes denied**
  (read-only). This is authoritative and works even though the toolset is built once (the SDK calls
  `canUseTool` per invocation). Build-time toolset filtering by the *initial* scope is optional
  defense-in-depth / a tidier tool list — the runtime guard is the guarantee.
- **Envelope becomes an instruction.** Reword `context-envelope.ts` + `system-prompt.ts`: writes are
  confined to the current entity; never modify another entity.
- **Pin reconciliation.** Extend `deriveAssistantEnvelope`/`resolveEntityPin`
  (`assistant-context.tsx`, ~101–123) to emit `scenario`(environment)/`test`/`compare` pins so scope
  works on those pages too; reconcile `ASSISTANT_ENTITY_KINDS` (9) ↔ scope map ↔ UI views (7).

### D-AS20 + D-AS21 — Skill-structure awareness + bundled skill-creator
- On **skill scope**, inject a skill-context block (the active skill's **file tree** with sizes + the
  rendered `SKILL.md`) and instruct: *read every file (including `references/`) before proposing
  edits.* Materialization already provides the files; this adds the **awareness**.
- **Bundle Anthropic's `skill-creator`** (SKILL.md + its `references/`) as a **read-only** resource
  shipped in the image (e.g. `apps/api/resources/skill-authoring/skill-creator/`), plus surface the
  app's own **`docs/skill-authoring.md`** (so edits satisfy the Quality engine's rule↔anchor
  contract). In skill scope, add the reference dir to the session's `additionalDirectories`
  (`session-driver.ts` confirms mid-session widening, ~108) and name the guide path in the injected
  context. **Read-only, never executed** (Bash stays disabled; the dir is outside any exec path).
  If the current skill-creator can't be vendored at build time, fall back to a distilled checklist +
  `docs/skill-authoring.md` and flag it for the owner.

### D-AS22 — Live working-copy + auto-navigate (save once at end)
- **New transient stream events** (`AssistantEvent`): `workspace_opened {skillId, versionId,
  files:[{path,size}]}`, `workspace_file_changed {skillId, path, changeKind}`,
  `workspace_committed {skillId, versionId}`. Emitted from the pump by observing native
  `Write`/`Edit`/`MultiEdit` tool results whose resolved path is **under the thread workspace root**
  (→ `skillId` + relative path), plus on `skills_open_workspace`/`skills_commit_workspace` success.
- **New read endpoint** `GET /api/assistant/threads/:id/workspace/:skillId/files` (+ `…/file?path=`)
  serving the **live** workspace tree + contents (path-traversal guarded, text/binary flagged,
  secret-free).
- **Web:** the Skills Files view subscribes to the thread stream's `workspace_*` events (reuse
  `use-assistant-stream`). `workspace_opened` → enter **live working-copy mode** for that skill;
  `workspace_file_changed` → refetch that file from the endpoint, show it **diffed against the base
  version** (changed files badged), and **auto-open/select it** (debounced), navigating to
  `/skills/<id>?tab=files&file=…` if not already there; `workspace_committed` → exit live mode and
  **rebase to the new version** (reuse `SkillInspector.handleDesignSaved`). **"Save once at end" = the
  existing gated `skills_commit_workspace` approval** — the live view is the review surface before you
  approve. Streaming discipline per `.claude/rules/loading-states.md` (build up edits; no mid-stream
  error flash).

### D-AS23 — Scope visibility
The dock shows a **"Scope: `<kind> <name>`"** chip from the current envelope (unscoped → "Read-only —
open an entity to enable edits"), so the user always sees what the assistant may write to; it
re-derives on navigation.

## Work packages (waves · models)

Recommended waves — max 2 parallel subagents; parallel WPs touch disjoint surfaces.

**Wave A**
- **R1.1 — scope lock + envelope-as-instruction + pin reconciliation** (`shared` + `api` + a web
  pin tweak) · **opus** (security-critical). Deliver the scope types + `SCOPE_WRITE_TOOLS`, the
  per-message `canUseTool` enforcement (deny out-of-scope + id-mismatch, unscoped=read-only, reason
  surfaced), reworded envelope/system-prompt, and the pin reconciliation. Tests: on skill scope
  `environments_update`/`tests_*` denied, `skills_commit_workspace` to another `skillId` denied /
  same allowed, unscoped read-only, scope re-derives when the envelope changes. **Must add each new
  out-of-scope path to the existing classifier tests.**

**Wave B** (after A — both consume the scope types)
- **R1.2 — skill-structure context + bundled skill-creator** (`api` + Dockerfile/resources) ·
  **sonnet**. Bundle skill-creator read-only + wire `additionalDirectories` in skill scope + inject
  the structure/guide context. Tests: skill-scope context carries the tree + guide path; reference
  present + reachable; non-skill scope injects nothing.
- **R1.3 — workspace events + live-workspace read endpoint** (`shared` + `api`) · **sonnet**. New
  `workspace_*` events from the pump (path-under-root detection) + the read endpoint. Tests: an Edit
  under the workspace emits `workspace_file_changed` (right skillId/path); a write outside emits
  nothing; endpoint serves live contents; open/commit emit their events. *(Disjoint from R1.2.)*

**Wave C**
- **R1.4 — live Files view + auto-navigate** (`web`, Skills feature) · **sonnet** (needs R1.3). Live
  working-copy mode, diff-vs-base, debounced auto-open, rebase on commit. Both themes.
- **R1.5 — dock scope chip + nav re-scope** (`web`, assistant dock) · **sonnet** (needs R1.1).
  Scope chip from the envelope; verify re-scope on navigation. *(Different web area from R1.4.)*

**Wave D** — **opus review** (scope enforcement is security-critical: prove no out-of-scope or
id-mismatched write can pass `canUseTool`, and secrets/other-entity data never leak), full gate,
refresh the Owner-acceptance list.

## Owner-acceptance (needs a live token)
- On a skill page, ask "enhance this skill from recent runs" → it reads runs but **only** edits the
  skill; an attempt to touch the environment is **denied with a visible reason** (Rule 1).
- The assistant reads `references/*` before editing and cites skill-creator/`skill-authoring.md`
  guidance (Rule 2).
- Edits appear **live** in the Files view with the UI **auto-navigating** to each changed file;
  review the accumulated diff, approve the commit once → new version (Rule 3). Both themes + keyboard.

## Non-goals / notes
- No new migration. No new runtime dependency. No auto-commit per edit (D-AS22 = one gated commit).
- Read scope stays broad on purpose (enhancing a skill needs cross-entity run data); **only writes**
  are locked. Global/unscoped dock = read-only until you open an entity.
