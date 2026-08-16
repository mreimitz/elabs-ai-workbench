---
name: brand-ui-new-app
description: Define-to-build — scaffold a new brand-ui app from a plain-language description (VP-02). Use when the user wants to START an app, page, or demo ("build me a sales dashboard", "I need an admin console for X", "new app", "scaffold a chat assistant", "create a landing page for a pitch") rather than add to an existing one. Runs a staged interview (quick 3-question mode or full 7-stage spec mode), writes an app-spec.md, then scaffolds from the matching template + playbook with every wiring point annotated and a starter CLAUDE.md so later agent sessions stay on-brand. For adding components to an existing app use `brand-ui`; for authoring library components use `brand-ui-component`.
user-invocable: true
argument-hint: "[description of the app, e.g. 'sales pipeline dashboard, qlik-dark']"
allowed-tools:
  - Bash(npx @brand/cli *)
  - Bash(pnpm brand-ui *)
  - Bash(npx brand-ui *)
  - Bash(npx shadcn@latest *)
  - Bash(pnpm dlx shadcn@latest *)
  - Bash(pnpm storybook *)
---

# brand-ui-new-app (define-to-build)

Take a developer from "I want to build X" to a running, on-brand scaffold —
without them needing to know component names, composition patterns, or
design rules. **Ask first, generate second**: interview to a concrete spec,
write the spec down, scaffold _from the spec_.

## 0 · Pick the mode

| Signal                                                                      | Mode                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Short ask, archetype obvious ("a dashboard for deals")                      | **Quick** (3 questions)                                                |
| Rich description, multiple surfaces/entities, or user asks to "spec it out" | **Full** (7 stages)                                                    |
| User said "just scaffold it" / "defaults are fine"                          | Quick, zero extra questions where the description already answers them |

Never re-ask what the description already states (theme, archetype, title).

## Quick mode (the 80% path)

One `AskUserQuestion` round, only for the unknowns among:

1. **Archetype** — dashboard · data app · AI assistant · flow workspace ·
   settings · marketing page (mapping table: `reference/archetypes.md`).
2. **Theme** — qlik-bright (default) · qlik-dark · blueprint. Offer a preview
   when Storybook is available (ladder below).
3. **App title** — free text, defaults to the archetype name.

Then go straight to **Scaffold** with the archetype's defaults; record the
defaults used in `app-spec.md` so the user sees what was decided for them.

## Full mode — the 7 stages (VP-02)

Each stage is 1–2 `AskUserQuestion` rounds (≤4 questions each, options ≤4,
"Other" is free). Every answer is appended to `app-spec.md` immediately —
the spec is the source of truth, reviewable and re-runnable. **Full per-stage
question script: `reference/stages.md`** (stage-6 archetype question sets:
`reference/archetypes.md`).

| #   | Stage              | Capture                                                                                                                                 |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Intent             | what, for whom, rough scale                                                                                                             |
| 2   | Archetype          | app shape → template + playbook (show rendered archetypes if possible)                                                                  |
| 3   | Surfaces & nav     | screens/sections (multi-select common ones per archetype + own)                                                                         |
| 4   | Data & entities    | main objects + key fields → table/form/detail stubs                                                                                     |
| 5   | Brand & feel       | theme (+ render a sample surface in it), density, brand color                                                                           |
| 6   | Per-surface detail | per archetype — columns/filters, KPI list, chart types, fields, node taxonomy, message parts (question sets: `reference/archetypes.md`) |
| 7   | Confirm → scaffold | show the assembled spec, confirm, generate                                                                                              |

Stage 6 is skippable ("scaffold with sensible defaults") — record the
defaults in the spec. If the user corrects the same dimension twice, stop
patching and re-derive the frame (conceptual-framing rule).

## Visual feedback (propose → preview → pick → refine)

At every visual decision (archetype, nav, theme, chart types) run the shared
loop — **`reference/visual-loop.md`** (VP-04). Use the highest fidelity rung
available — **real Storybook render > generated artifact > option preview >
text** — and **never decide a visual on prose when a render is possible**
(start `pnpm storybook` in the background to reach the MCP if needed; theme
slugs `qlik-bright`/`qlik-dark`/`blueprint`).

## Scaffold (generated FROM the spec)

1. **Locate the target.** A new app folder (a Vite app, or whatever the project
   uses) or a folder the user names; in an existing project, its `app/` or `src/`.
2. **Lay down the template.** Start from the generated template source for the
   archetype — `playbooks/templates/<archetype>.tsx`. It's derived from that
   archetype's Storybook story, so it never drifts from what Storybook renders.
   It's the full, working composition with **placeholder data** (sample nav,
   metrics, columns, …).
3. **Apply the spec, replacing the placeholders.** Everything the spec answers
   replaces a placeholder now: rename nav items, generate the entity interface +
   `ColumnDef<Entity>[]` from stage-4 fields (renderer per field type — see
   `playbooks/data-app.md` §Columns), KPI list, chart types, node
   taxonomy, form fields. Placeholders the spec doesn't answer **stay as
   `// TODO(spec):` comments** — never invent data, and never silently drop an
   unanswered field.
4. **Wire the root.** `@brand/tokens` styles + `<ThemeProvider
defaultTheme="<chosen>">`; `@source` directives for Tailwind scanning;
   for flow apps the `@xyflow/react` stylesheet. Also wire the **taxonomy lint**:
   add `@brand/eslint-config` (devDep) + an `eslint.config.js` extending
   `@brand/eslint-config/react` with `brand/no-raw-font-size` and
   `brand/no-raw-color` set to **`error`** — full recipe in
   `reference/lint-and-taxonomy.md`. This makes "type is a role, colour is a
   token" _enforced in the agent's lint loop_, not just asked for in prose.
5. **Emit the agent context.** Write the scaffolded app's `CLAUDE.md` from
   `reference/starter-claude-md.md`, filled with the chosen theme, archetype,
   playbook link, and spec location. This is what keeps every later session
   on-brand.
6. **Drop `app-spec.md`** at the app root (template:
   `reference/app-spec-template.md`). It carries a single fenced `json` **Machine
   spec** block — the contract `brand-ui scaffold` reads (schema:
   `reference/app-spec.schema.json`, validated by `pnpm app-spec:check`; example:
   `reference/app-spec.example.md`). Keep the prose and the `json` block in sync.

## Verify before "done"

- `typecheck` **and `lint`** on the scaffolded app — green. The scaffold
  configures `@brand/eslint-config`, so `brand/no-raw-font-size` /
  `brand/no-raw-color` must be clean (no raw sizes/colours).
- Open the playbook checklist for the archetype; confirm each block the spec
  ordered is present.
- If Storybook/browser rendering is available, render the scaffold once in
  the chosen theme; otherwise **say plainly that the scaffold compiled but
  was not visually verified** — never claim a visual result you didn't see.
- Report remaining `// TODO(spec):` placeholders as the user's explicit next
  steps (that's the handoff, not a failure).

## Hard rules the scaffold must obey

**Type is a role, not a size** (`text-<role>` / `Heading` / `Text` — never
`text-2xl`/`text-sm`/`text-[18px]`) · **semantic tokens only** — never raw hex
or Tailwind palette (`text-gray-500`), both enforced by the scaffolded
`brand/no-raw-*` lint · import via `@brand/*` · Lucide for generic glyphs ·
loading/empty/error states wired, never blank regions · brand-ui never owns
model calls or data fetching (D5) — scaffold stubs, not transport.
