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
