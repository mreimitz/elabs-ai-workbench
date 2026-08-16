# The interview script (full mode — the 7 stages)

Progressive-disclosure detail for `SKILL.md`'s 7-stage table. Each stage is 1–2
`AskUserQuestion` rounds (≤4 questions/round, ≤4 options each; "Other" is always
free text). **Append every answer to `app-spec.md` immediately** — the spec is the
source of truth (template: `reference/app-spec-template.md`; the machine-readable
contract is `reference/app-spec.schema.json`). Stage-6 question sets live in
`reference/archetypes.md`. Stages that carry a visual choice are marked **[visual
loop]** — run `reference/visual-loop.md` there (never decide a visual on text alone
when a render is possible).

> **Golden rule:** never re-ask what the description already answers. If the user
> said "a qlik-dark sales dashboard called Pulse", stages 1–2 and the theme are
> already decided — record them and skip ahead. If the user says "just scaffold
> it / defaults are fine", drop to Quick mode and record the defaults used.

## Stage 1 — Intent

Capture the one-sentence reason the app exists. One round:

1. **Purpose** — "In one sentence, what does this app let someone do?" (free text).
2. **Audience** — who opens it (internal team · customers · execs · yourself).
3. **Scale** — demo/POC · internal tool · production-bound (drives data-size and
   gate decisions later).

→ writes `intent` (purpose, audience, scale).

## Stage 2 — Archetype **[visual loop]**

Map the user's words to one of the six archetypes (recognition table:
`reference/archetypes.md`). Don't make them know component names.

1. **Archetype** — dashboard · data-app · ai-assistant · flow-workspace ·
   settings · marketing (offer the 2–3 that best match their stage-1 answer).
   Preview the candidate templates as real stories in the loop before they pick.

Mixed asks ("dashboard with a chat sidebar") → pick the **primary** as the
archetype, add the secondary via its playbook's blocks (note it in the spec).

→ writes `archetype` (+ resolves `template-<archetype>` + `playbooks/<archetype>.md`).

## Stage 3 — Surfaces & navigation **[visual loop]**

1. **Surfaces** — multi-select the screens this app needs (offer the common ones
   for the chosen archetype + "add your own"). One archetype per surface; shared
   app shell.
2. **Nav shape** — sidebar (default) · top-nav (marketing) · both. Preview the
   shell option in the loop.

→ writes `surfaces[]` (`{id, navLabel, archetype}`) + nav shape.

## Stage 4 — Data & entities

Only for data-bearing archetypes (dashboard/data-app/flow/settings; skip for
marketing). For each main object:

1. **Entity name** (e.g. "Deal", "Incident").
2. **Key fields** — `name : type` where type ∈ `text · number · date · status ·
boolean` (status fields list their values: `status: open | won | lost`).
3. **Render + filter** — per field, how it renders (text cell · Badge · date ·
   number) and whether it's a filter facet or search. (Defaults inferable from
   type — only ask when ambiguous.)

→ writes `entities[]` (`{name, fields:[{name,type,rendersAs?,filterable?}]}`).
These drive the generated `interface` + `ColumnDef<Entity>[]` at scaffold time.

## Stage 5 — Brand & feel **[visual loop]**

1. **Theme** — qlik-bright (default) · qlik-dark · blueprint. **Render a sample
   surface in the candidate theme** (loop rung 1) before they pick — never pick a
   theme on its name.
2. **Density / decoration** — default · compact; decoration dial if they want the
   blueprint texture on a non-blueprint theme (`data-decoration`).
3. **Brand color** (optional) — only if they want to re-tint `--primary`; route a
   real re-brand to the `brand-ui-theme` skill, don't hand-edit tokens here.

→ writes `theme`, `density`, optional brand note.

## Stage 6 — Per-surface detail **[visual loop]**

The archetype-specific questions — KPIs, columns/filters, chart types, fields,
node taxonomy, message parts. **Full question sets per archetype:
`reference/archetypes.md` (Stage-6 question sets).** Chart-type and layout choices
are visual — run the loop. Skippable: "scaffold with sensible defaults" records
the per-archetype defaults (also in `archetypes.md`) into the spec.

→ writes `perSurface` detail (or the recorded defaults).

## Stage 7 — Confirm → scaffold

1. Show the assembled `app-spec.md` (prose + the machine `json` block) and ask
   **"Scaffold this?"** (yes · edit a section · start over).
2. On yes → hand the spec to **`brand-ui scaffold`** (see `SKILL.md` → Scaffold).

→ no new fields; gate before generation.

## Re-frame trigger (conceptual-framing rule)

If the user corrects the **same dimension twice** (e.g. the archetype, or the
nav), **stop patching** — the model is wrong. Step back, re-derive from their
stage-1 intent, and re-propose, rather than issuing a third point-fix.
