# Phase 2 — Flow editor v2 (WP specs)

## WP 2.1 — Edit-ops v2: command CRUD, keywords, asset connections
**Size:** L · **Depends on:** 1.2 · API

**Objective:** the round-trip engine learns the new ops so the canvas can edit commands and
connect assets — same anchored-splice discipline, byte-exactness, and new-immutable-version
semantics as every existing op.

**Files:** `apps/api/src/skillflow/{edit-ops.ts, roundtrip.ts}`; tests
`apps/api/test/skill-ide-roundtrip.test.ts`.

**Semantics:** `add_command { command, title?, body?, afterFlowId? }` → insert `## /command`
section (+ optional annotation pin) after the last section of the reference flow (or document
end); `rename_command { nodeId, command }` → rewrite the heading's command token only;
`delete_command { nodeId }` → remove the command's whole flow subtree (its sections; shared
assets survive — they're referenced text elsewhere or unreferenced files, never deleted).
**Cross-flow references TO the deleted flow (e.g. another flow's "see /other") are left
untouched** — they become dangling and surface as a projector warning; never edit text outside
the deleted flow's span (review 2026-07-04 finding 6);
`set_keywords { keywords[] }` → create/update the frontmatter `keywords:` list (YAML-safe via
the `yaml` package, preserving unrelated frontmatter bytes verbatim — splice only the keywords
block); `connect_asset { nodeId, path, sentence? }` → same mechanics as `add_asset_ref` but
edge-aware (alias to it where identical — do not duplicate logic); `disconnect_asset { nodeId,
path }` → remove the referencing sentence when it is exactly locatable on one line, else
warning+skip (never guess).

**Acceptance:** round-trip property (outside-span bytes identical; re-projection reflects the
edit) for every new op on the multi-command fixture; frontmatter keyword edits preserve
surrounding frontmatter byte-exactly; conflicting-op validation extended (delete_command +
any op inside its flow → 400); gate green.

**Implementation notes (verified 2026-07-04 — see also [`references.md`](./references.md)):**

- The op cases are already **live 400-stubs** in `edit-ops.ts` (`add_command` …
  `disconnect_asset`) — replace the stubs, don't re-declare. Node anchors carry
  `startLine`/`endLine`; the splice engine + stale-anchor 409 + one-`createVersion`-per-batch
  live in `roundtrip.ts`.
- **Spans:** `delete_command` removes from the entry's pinned annotation line (if present, per
  `annotations.ts` — annotation sits on its own line directly above the heading) through the
  `endLine` of the flow's LAST node. `rename_command` rewrites only the command token in the
  heading line and must preserve a `skillflow:command id=` pin. `add_command` inserts after the
  `endLine` of the reference flow's last node (else document end), normalizing exactly one
  blank line before the new `## /command` heading; a document without a trailing newline gets
  one (inside the inserted span — outside-span bytes stay identical).
- **Duplicate command token → 400** (validate against the projected graph's entry points before
  splicing).
- **`set_keywords`:** `yaml@^2.9.0` is already an api dependency. Never re-serialize the whole
  frontmatter — locate the `keywords:` block's lines and splice only them; if no frontmatter
  exists, insert a minimal `---\nkeywords: […]\n---\n` at byte 0. Test against the
  `github-style` fixture (real frontmatter with unrelated keys).
- **Test checklist** (beyond the property test): command section at EOF without trailing
  newline; two commands with the same token (400); `delete_command` on a flow containing an
  annotated gatekeeper; `disconnect_asset` when the path is referenced on two lines
  (warning+skip, never guess); `set_keywords` creating frontmatter on the `zero-annotation`
  fixture (regression-locked — assert the lock test still passes with its additive delta).

## WP 2.2 — Canvas editing: command CRUD + drag-to-connect
**Size:** L · **Depends on:** 1.3, 2.1 · Web-only

**Objective:** the flow graph becomes the editor the owner asked for: create, rename, delete
/commands and connect steps to assets directly on the canvas.

**Files:** `apps/web/src/features/skills/design/{SkillDesignView.tsx, SkillGraphCanvas.tsx,
NodeDetailPanel.tsx, use-edit-ops.ts}` (+ a small `CommandDialog.tsx`).

**UX:** toolbar "Add command" → dialog (command token validated `/kebab-or-word`, optional title
+ body) → stages `add_command`; entry-point node panel: rename command (stages `rename_command`),
delete command (destructive confirm listing the flow's sections → stages `delete_command`);
drag a connection from a section node to an asset node (React Flow `onConnect` via the shared
canvas — enabled only in edit mode, only section→asset) → stages `connect_asset`; deleting a
section→asset edge stages `disconnect_asset`. All staged ops ride the existing preview + Save
dialog (I2 — nothing mutates until Save). Keywords editing hooks arrive with WP 6.1's panel.

**Acceptance:** full canvas loop live-verified (Playwright): add a command → lane appears in
preview → save → re-projected graph shows it and the SKILL.md diff is clean; delete + rename +
drag-connect similarly; connect attempts that violate the section→asset rule are rejected
inline; both themes; gate green.

**Implementation notes (verified 2026-07-04):** stage everything through the existing
`useEditOps()` buffer (`EditOpsController`: append-ordered ops, staged-removal conflicts are
silent no-ops, `PREVIEW_NODE_PREFIX` for preview-only nodes, client-side preview apply).
Reuse its `isSectionNode` for the section→asset connect guard. The hook's header comment says
"NEVER canvas drag-to-draw" — that guarded *freehand* drawing under SkillFlow D-decisions;
I2's constrained drag-to-connect (drop only STAGES `connect_asset`) supersedes it: **update
that comment in this WP** so the rule stays honest. Command dialogs validate the token against
`/^\/[a-z0-9][a-z0-9-]*$/i` client-side; the API stays authoritative (its 400 surfaces inline).
