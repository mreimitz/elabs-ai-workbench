---
type: "Work Package Spec"
title: "WP 7.9 build - Designer = visual, Files = source (the mode switch dies, SKILL.md joins the file register, the rail says Components)"
description: "The build spec for the last open WP in RM-30 Phase 7. Deletes the Flow|Code|Split control and the Studio's ?mode= param, makes the centre surface a consequence of which tab is open, gives SKILL.md a source tab in the Files register over the SAME one draft, pays WP 7.7's recorded Tools/Components rail debt, and folds in the one-line SkillDiffView version-label fix."
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-22T20:30:00Z"
status: "final"
---
# WP 7.9 — Designer = visual, Files = source (build)

Ledger: [`STATUS.md`](./STATUS.md) (line 227). Owner decision this implements — **D-UX19 #2**, full
text in the ledger's decision log at `STATUS.md:304-311`:

> **Designer = visual, Files = source** — the mode switch dies, both edit one draft.

**Depends on:** WP 7.7 (merged) and WP 7.8 (merged `8b423e7`). Both owned `use-edit-ops`; this one
runs after both, and it is the **last open work package in Phase 7**.

**Size:** L–XL. **Commit in four separately-gated pieces** (§7) — this plan has twice lost an agent
to a session limit, and once the rescued work had no commits of its own.

---

## 1. Where every premise below was read

A premise about the codebase must say where it came from — two specs in the previous batch were
wrong because they did not. Everything asserted here was read at `main` @ `01a87fe`:

| Fact | Read at |
| --- | --- |
| The Studio toolbar renders a `Flow \| Code \| Split` `ToggleGroup` | `apps/web/src/features/skills/studio/StudioShell.tsx:225-268` |
| The three modes and the URL param that carries them | `apps/web/src/features/skills/studio/studio-url.ts:16-31` (`StudioMode`, `STUDIO_MODES`, `STUDIO_DEFAULT_MODE`, `isStudioMode`) |
| `?mode=` is deliberately **shared** with the editor's own param | `studio-url.ts:12-14` |
| The editor's own mode axis | `apps/web/src/features/skills/design/UnifiedEditor.tsx:122-123` (`EditorMode`, `EDITOR_MODES`), read from the URL at `:285`, toggle rendered at `:1121-1140`, panes at `:1237-1259` |
| `hideModeToggle` already exists as a prop | `UnifiedEditor.tsx:196`, `:269`; passed by the Studio at `StudioShell.tsx:371` |
| `SkillDesignView` has exactly ONE live call site | `StudioShell.tsx:369` (the inspector now mounts the read-only `SkillFlowPreview` instead — `SkillInspector.tsx:56`, `:818`) |
| SKILL.md is deliberately **not** a tab today | `apps/web/src/features/skills/studio/files/file-ops.ts:53-58` (`isTabbableFile`) |
| The one invariant the files layer exists to protect | `file-ops.ts:9-25` — *"SKILL.md is written by `content`, and by nothing else"*, enforced once in `studioFileOps` (`:44-47`) |
| `?file=` names the active tab; the SKILL.md pane stays **mounted** behind another tab | `StudioShell.tsx:167-188`, `:337-345` (and the comment at `:330-336` giving the two reasons) |
| The default file is SKILL.md and `setFile` **deletes** the param for it | `studio-url.ts:26`, `StudioShell.tsx:97-100` |
| The rail tab reads "Tools" while the panel inside reads "Components" | `apps/web/src/features/skills/studio/StudioLeftRail.tsx:80`, with the reason recorded at `:62-77` |
| That mismatch was assigned to **this** WP | `StudioLeftRail.tsx:74-77` and ledger `STATUS.md:159-163` |
| The measurement behind it | ~78px of label against ~49px of room at the shipped 184px rail, 1600×1000 (`StudioLeftRail.tsx:68-73`) |
| The rail tab rides in the URL as `?rail=` | `studio-url.ts:33-47`, written at `StudioShell.tsx:92-95` |
| The duplicated `v5 · v5` version label in the diff pickers | `apps/web/src/features/skills/SkillDiffView.tsx:515-518` renders `v{v.seq}` + `· {v.versionLabel}` by hand |
| The de-duping helper that already exists and is already tested | `apps/web/src/features/skills/SkillInspector.tsx:89-94` (`formatVersionLabel`), tests at `design/design-chrome.test.tsx:201-210` |

---

## 2. The model this ships

Two authoring surfaces over **one** draft, and nothing that asks the author to pick a "mode":

- **Designer** — the visual composer. The flow canvas, the components palette, the node detail
  panel, the connect grammar WP 7.8 shipped. No code pane inside it.
- **Files** — the source register. Every file in the version opens as a source tab in the centre
  surface, **including `SKILL.md`**, which is where an author edits the manifest as text.

Which surface is showing is a **consequence of which tab is open**, not a separate axis. So the
mode control does not move, shrink or relocate — it stops existing.

### The seam that keeps this safe

`UnifiedEditor` is 2,146 lines and owns the code↔flow anchor sync, the code-intel decorations and
hovers, the Problems panel mount, the save-cluster registration and the bind host. **Do not rip it
apart.** It keeps being the engine; what changes is that its `mode` stops being a URL-read axis and
becomes a value derived from the open tab:

```
active tab === Designer   ⇒  the editor renders its flow surface
active tab === SKILL.md   ⇒  the editor renders its code surface, over the SAME `content` buffer
active tab === any other  ⇒  WorkspaceEditor, exactly as WP 7.4 shipped it
```

`split` is **deleted**, not hidden. Two views of one document side by side is precisely the "pick a
mode" affordance D-UX19 #2 removes.

Because the SKILL.md **source** tab is still the same `UnifiedEditor` instance writing `content`,
the `file-ops.ts` invariant is untouched: no `update_file`/`rename_file`/`delete_file` op ever names
SKILL.md, and `studioFileOps`'s filter stays exactly as it is. Do not route the SKILL.md tab through
`WorkspaceEditor` — that would create the second write path the whole files layer exists to prevent.

---

## 3. Scope

### 3a. Delete the mode axis

- Remove the `ToggleGroup` block from `StudioShell.tsx:225-268` and the `Workflow`/`Code2`/`Columns2`
  imports it alone uses.
- Remove the toggle from `UnifiedEditor.tsx:1121-1140` and the now-unconditional `hideModeToggle`
  prop with it (a prop with one possible value is a lie about the API).
- Narrow `EditorMode` to `"flow" | "code"`; delete `"split"`, its `ResizablePanel` branch
  (`UnifiedEditor.tsx:1245-1259`) and every `mode === "split"` path. The `ResizablePanelGroup`
  around the single pane goes with it if nothing else needs it.
- `mode` becomes a **required prop** on `UnifiedEditor`, supplied by the host. It is no longer read
  from `?mode=` (`:285`) and no longer written (`:861-880`, `:924-925` — the "switch to code"
  behaviours become "open the SKILL.md source tab", or are deleted if they no longer mean anything;
  say which in the commit message).
- `studio-url.ts` drops `StudioMode`, `STUDIO_MODES`, `STUDIO_DEFAULT_MODE`, `isStudioMode` and the
  `mode` member of `StudioUrlState`.

### 3b. `?file=` alone decides the surface

Today the param is **absent** for SKILL.md (`StudioShell.tsx:97-100`). That inverts:

- `?file=` **absent** ⇒ the Designer. This is the Studio's zero-param landing surface, and it must
  be genuinely useful on a cold load (D-TB10, `.claude/rules/routes-vs-dialogs.md`).
- `?file=SKILL.md` ⇒ the SKILL.md source tab, written explicitly like every other path.
- `STUDIO_DEFAULT_FILE` (`studio-url.ts:26`) is deleted or re-pointed; do not leave a constant whose
  comment describes the old rule.
- A legacy URL carrying `?mode=flow|code|split` must still land on a usable workbench. `?mode=` is
  simply ignored — `readStudioUrlState` already degrades rather than throwing (`:63-77`), and that
  behaviour is the reason a stale bookmark does not break.

### 3c. The Designer becomes a pinned tab

- `StudioFileTabs` gains a **first, pinned, non-closable** Designer tab. It is not a file; it has no
  `×` (WP 7.7's owner correction put an `×` on every *file* tab — that stays).
- `isTabbableFile` (`file-ops.ts:53-58`) stops excluding SKILL.md, and its doc comment — which
  currently explains why the manifest is *not* a tab — is rewritten to say what is now true.
- SKILL.md appears in the Files rail tree and opens from it (`StudioFilesRail`), like any other file.
- The manifest still cannot be renamed, moved or deleted (`useWorkspace` already refuses —
  `file-ops.ts:20-22`); that refusal stays, and its reason is now visible to the author rather than
  implied by the file's absence.

### 3d. Pay WP 7.7's recorded rail debt

The tab must read **Components**, matching the panel it opens (`ComponentsPalette`). The label does
not fit the shipped 184px rail split three ways, and the previous WP correctly refused to ship a
clipped label rather than quietly truncating it.

- **This WP owns the rail**, so the fix is the rail's: widen it, stack the tabs, or move to
  icon+label triggers — the builder's call, made with a **real browser measurement at 1600×1000**,
  in **both themes**, with the measured numbers written into the ledger line.
- Whatever ships, "Components" must render **unclipped and un-truncated**, and "Files" and
  "Settings" with it.
- Rename the URL value `rail=tools` → `rail=components`, and **accept `tools` as a legacy alias on
  read** so an existing shared link still opens the right tab. Do not accept it on write.
- Delete the deliberate-mismatch comment at `StudioLeftRail.tsx:62-77` — it documents a debt this WP
  pays, and leaving it would describe software that no longer exists.

### 3e. The `SkillDiffView` label fix (the one-liner that rides along)

`SkillDiffView.tsx:515-518` builds the picker option label by hand and produces the duplicated
`v5 · v5` for an editor save, which is exactly what `formatVersionLabel` (`SkillInspector.tsx:89`)
already fixes everywhere else. Call the helper. Add the picker assertion beside the existing helper
tests.

---

## 4. Files

**Modify:**

- `apps/web/src/features/skills/studio/StudioShell.tsx` (toolbar, surface selection, tab wiring)
- `apps/web/src/features/skills/studio/studio-url.ts` (+ `studio-url.test.ts`)
- `apps/web/src/features/skills/studio/StudioLeftRail.tsx` (label, rail layout)
- `apps/web/src/features/skills/studio/files/StudioFileTabs.tsx` (+ its test)
- `apps/web/src/features/skills/studio/files/file-ops.ts` (+ its test)
- `apps/web/src/features/skills/studio/files/tab-model.ts` (the Designer tab is not a path)
- `apps/web/src/features/skills/studio/files/StudioFilesRail.tsx` (SKILL.md selectable)
- `apps/web/src/features/skills/design/UnifiedEditor.tsx` (mode axis → prop; split deleted)
- `apps/web/src/features/skills/design/SkillDesignView.tsx` (prop pass-through)
- `apps/web/src/features/skills/SkillDiffView.tsx` (the label one-liner)
- the affected test files, including `files-one-save.test.tsx` and `SkillStudioView.test.tsx`

**Do not touch** (another agent holds them this batch): `packages/**`, `apps/api/**`,
`apps/cli/**`, `apps/web/src/features/testing/**`, `apps/web/src/features/watch/**`,
`apps/web/src/App.tsx`, `apps/web/src/components/AppShell.tsx`, `apps/web/src/lib/api.ts`.

---

## 5. Non-goals

- **No wire change, no migration, no new dependency, no feature flag.** This is a web-only rework of
  one surface. `packages/shared` and `apps/api` must be a **zero-line diff**.
- No change to what a save produces — still one new immutable version through the one existing save
  path. No second save surface may appear (WP 7.4 shipped a guardrail against exactly that; it must
  stay green).
- No canvas behaviour change. WP 7.8's edge grammar, reachability flows, token figures and box
  positions are consumed as they are.
- No rework of the Inspector. Its Design tab stays the read-only `SkillFlowPreview` + "Edit in
  Studio" that WP 7.1 and the owner correction settled.
- No new palette content, no new component kinds.

---

## 6. Acceptance

1. **The mode control does not exist.** No `Flow`/`Code`/`Split` toggle renders anywhere in the
   Studio or the editor, and `"split"` appears in no source file under
   `apps/web/src/features/skills/**` as an editor mode. Pinned by a source-walk test, not by a
   screenshot.
2. **`?mode=` is neither read nor written by the Studio**, and a cold load of
   `/skills/:id/studio?mode=split` lands on a usable workbench (the Designer) rather than an error
   or a blank pane.
3. **Zero-param `/skills/:id/studio` opens the Designer** and is immediately usable (D-TB10).
4. **SKILL.md is a source tab**: it appears in the Files rail, opens in the centre surface as text,
   and is editable there.
5. **One draft, one dirty count, one save.** Edit the canvas *and* the SKILL.md source tab *and* a
   resource file, and the toolbar shows **one** dirty count and **one** `Save as vN`, producing
   **one** new version. Extend `files-one-save.test.tsx` to cover the SKILL.md tab specifically.
6. **The invariant holds.** `studioFileOps` still emits no op naming SKILL.md, asserted directly —
   and prove the guard has teeth by removing the filter and watching a test go red.
7. **The Designer tab cannot be closed** and is always first.
8. **The rail reads "Components"**, unclipped and un-truncated in both themes at 1600×1000, with the
   measurement recorded. `?rail=tools` still opens it; `?rail=components` is what gets written.
9. **`SkillDiffView`'s pickers show `v5`, not `v5 · v5`**, asserted in a test.
10. **No raw colour, no hand-rolled interactive HTML** in any changed file (`brand-ui-only.md`);
    every icon-only control follows D-TB5.
11. **Gate green**: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, run from the repo root.
12. **Report what was not verified.** Headless Chromium is a measurement, not a walk. Whether an
    author can actually author with this — a mouse drag, a completed save against a running API, a
    bound MCP server — is owner-acceptance and must be written as such, not implied. Three Studio
    WPs have now shipped without a human using any of them; do not be the fourth to blur that.

---

## 7. Commit discipline (recovery requirement, not style)

Four commits, each gate-green when it lands:

1. **Mode axis deleted** — toggle, `split`, `?mode=`, `mode` as a prop.
2. **SKILL.md as a source tab** — pinned Designer tab, `isTabbableFile`, rail selection, the
   one-save test extension.
3. **The rail** — Components label, width/layout fix with its measurement, `rail=` value + alias.
4. **The diff label** — the one-liner and its test.

If a session ends mid-WP, whatever is finished is already committed and already green.
