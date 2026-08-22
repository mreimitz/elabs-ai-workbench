# Illustration registry changelog

The catalog's growth record. **This file, not `REGISTRY_VERSION`, is where "we added a component"
gets written down** — and that separation is the whole point of it.

`REGISTRY_VERSION` (`ILLUSTRATION_REGISTRY_VERSION` in
`packages/shared/src/illustration-registry.ts`) is a **flag-don't-break compatibility marker**,
stamped into every authored scene spec the way `TOKEN_COUNTING_VERSION` is stamped into every scan.
It answers exactly one question: *can a scene written against version V still be trusted against the
registry as it stands today?* Adding an entity **cannot** invalidate an authored scene — no scene can
reference an id that did not exist when it was written — so an addition leaves the number alone. A
flag that fires on non-events is a flag people learn to ignore.

| Change | Bumps `REGISTRY_VERSION`? |
| --- | --- |
| A new component, variant, port or state | **No** — additive, recorded here |
| Title, description, keywords, tier | **No** — cosmetic, not recorded here either |
| An id or port **renamed or removed** | **Yes** |
| A variant, state or size **dropped** | **Yes** |
| A footprint **re-sized** | **Yes** |

The rule has teeth: `src/registry-contract.snapshot.json` records every entry's scene-visible
contract, and `src/registry-contract.test.ts` fails the gate when one of them loses or renames
something without the version moving. See D-IL12 and its amendment of 2026-08-21 in
`planning/Roadmap/RM-14-illustrations/decisions.md`.

An entry's `since` is the version it was **born** under, never the version it was last touched
under — which is what makes the useful question answerable: a scene stamped version V can resolve any
entity whose `since <= V`.

---

## 0.1.0

The version the catalog has carried since WP 0.1 declared the shape, and the version **every entry
to date is `since`**. Nothing below moved it, and that is correct rather than an oversight.

### The pilots — WP 0.3 (`pilot` cast)

The three that proved the primitives could carry an entity at all.

- `mcp-server` — MCP Server (`stdio` · `streamable-http`)
- `skill` — Skill (`plain` · `versioned`)
- `agent` — Agent / LLM (honours D-IL17 `facing`)

### The runtime cast — WP 1.1 (`runtime` cast)

What actually executes: the model, who serves it, who checks it, the run it happens in, and what it
was asked. Shipped alongside the **cast-module seam** that made WPs 1.2 and 1.3 parallelizable, and
extracted `primitives/IsoFigure.tsx` on the way.

- `model` — Model
- `provider` — Provider (deliberately blank cartouche — no vendor marks)
- `validator` — Validator (`grader` · `guardrail`)
- `run` — Run
- `prompt` — Prompt (`user` · `system`)

### The assets cast — WP 1.2 (`assets` cast)

The things that are read, written, measured and handed around. Extracted
`primitives/IsoSheetStack.tsx`, and published `scanClearance()` **instead of** an arch primitive —
the arch turned out to be three `IsoHousing` calls with one caller, and a primitive that abstracts
nothing is a finding, not a deliverable.

- `tool` — Tool
- `resource` — Resource
- `prompt-template` — Prompt Template
- `file` — File (`single` · `stack`)
- `feedback-report` — Feedback Report
- `scan` — Scan
- `token-meter` — Token Meter (`budget` · `spend`)

### The orchestration cast — WP 1.3 (`orchestration` cast)

How work is grouped, driven, compared and stored. Extracted `primitives/IsoTrack.tsx` (with `Run`
refactored onto it and verified byte-identical first), and reused `IsoFigure` unmodified for
`assistant` — the payment WP 1.1's extraction was taken out for.

- `suite` — Suite
- `collection` — Collection (`local` · `git-bound`)
- `orchestrator` — Orchestrator
- `diff-compare` — Diff / Compare (`two-way` · `baseline`)
- `environment` — Environment (`hosted` · `local`)
- `database` — Database
- `credentials-vault` — Credentials Vault
- `assistant` — Assistant (`dock` · `hub`)

### Added since

One line per component, appended by `scripts/new-component.mjs`, newest last. A line here is the
growth record; none of them moves the version.

<!-- new-component.mjs appends one line per component below -->
- 2026-08-21 — `owner` — Owner / User (orchestration cast)

---

## Not a component: the scene engine

Everything above is the CATALOG. Phase 2 adds the layer that composes it, and it moves
`REGISTRY_VERSION` no more than an addition does — it adds no entry, and changes no entry's
scene-visible contract. Recorded here because this file, not the number, is the growth record.

### WP 2.3 — `<IllustrationScene>`, the renderer

The first thing in this package that draws a whole scene. `scene/Scene.tsx` validates a spec, lays
it out (WP 2.1), routes its connectors (WP 2.2) and paints the result through the fixed
`ILLUSTRATION_LAYERS` order; `scene/annotations.tsx` adapts an annotation's text to the slot the
layout gave it. Byte-identical for the same spec, in any tree.

Two primitives grew a seam for it, both additive and neither changing what they draw:

- **`Connector`** now exports its style table (`CONNECTOR_STYLE`), the arrowhead fills, the tail
  trim and the caption knockout, because the renderer paints from the router's filleted path rather
  than through the component and must not keep a second copy of the six rows.
  `connector-style-single-source.test.ts` fails on a second declaration anywhere in `src/`.
- **`PaperStage`** takes an optional `idPrefix`. Its `useId` default is stable per POSITION, which
  an export path cannot use; the scene derives the prefix from the scene id instead.

**Two measured findings are recorded in the source rather than smoothed over.** The connector
table's six kinds separate without hue in 13 of the 15 pairs — `flow`/`publish` and `write`/`loop`
do not — and the D-IL6 accent band (2–6%) cannot be satisfied by a part-count proxy at all below 17
parts, so all three fixtures warn on every render (28.6% · 21.1% · 30.0%). Neither is patched here:
both are properties of locked design artifacts, and changing one is not a builder's call.
