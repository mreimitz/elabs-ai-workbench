# SkillFlow fixture corpus

Shared, hand-authored test fixtures for the SkillFlow feature (see
[`roadmap/skillflow/00-architecture.md`](../../../../roadmap/skillflow/00-architecture.md)). These
are plain data files only — no `.test.ts` files live here, nothing here is executed or wired into
any build/run path, and nothing outside this directory was touched to create it. Individual test
suites read whichever fixtures they need and adapt the shapes below to their own types; **this
directory does not itself assert anything.**

## `skills/` — sample skill trees (WP 1.1 projection)

Each subfolder is a small, realistic skill directory (frontmatter + Markdown body + bundled
`reference/`, `scripts/`, `assets/`), meant to exercise the inference-first graph projector across
the range of skills it will actually see:

- **`zero-annotation/`** (`data-report`) — a typical upload with *no* SkillFlow markup at all: 4
  ordered `##` sections (gather → validate → generate → verify), relative-path references to
  bundled files, one explicit CSV/JSON branch ("If the input is CSV, ... otherwise if JSON, ..."),
  and one retry sentence ("repeat until the validation passes, at most 3 times"). This is the
  primary fixture for proving inference alone (headings → subroutines, paths → assets, script +
  exit-code language → validation gates, branching prose → a gatekeeper, retry language → a
  loop-guard hint) produces a useful graph with zero hand-authoring.
- **`github-style/`** (`github-style`) — mimics an imported OSS skill: 3 sections, one nested `###`
  subsection (rate-limit handling under "Fetch issues"), `license`/`metadata` frontmatter fields,
  and its own `reference/api-notes.md` + `scripts/fetch.sh`. Exercises a slightly different
  document shape than `zero-annotation/`.
- **`annotated/`** (`annotated`) — same shape as `zero-annotation/` but smaller (3 sections), with
  two `<!-- skillflow:gate id=check-output -->` / `<!-- skillflow:gatekeeper id=route-input -->`
  HTML-comment annotations, each on its own line directly above the heading it refines. Exercises
  the optional annotation-overlay path (D2) — annotations are inert to the rendered markdown and
  to any agent reading the skill; only the projector is meant to notice them. The annotation
  convention is still being finalized, so keep any parser tolerant of syntax drift here.
- **`blank-scaffold/`** (`blank-skill`) — the degenerate case: just a `SKILL.md` with minimal valid
  frontmatter and an empty `## Steps` section, standing in for the D3 "blank skill" wizard source.
  Exercises the projector's floor (a graph with a single empty subroutine node and no assets/gates).

## `runs/` — synthetic `run_steps` traces (WP 2.1 / 2.2 trace + alignment)

JSON arrays shaped like `run_steps` rows (`idx`, `type`, `label`, `status`, `tool_name`,
`turn_index`, and `payload_json` **as a JSON object, not a string** — the real column is
`TEXT`-serialized; these fixtures keep it structured for readability and expect the consuming test
to `JSON.stringify` where needed). Both runs depict an agent executing `skills/zero-annotation/`:

- **`clean-run.steps.json`** — a fully successful pass: `user_message` → `llm_response` turns →
  `read_skill_file` tool_call/tool_result pairs covering every bundled file (`SKILL.md`,
  `reference/format-spec.md`, `assets/template.html`) → a `Bash` validate.py run with `exitCode: 0`
  → a final `context_event`. Every asset is read exactly once; no loops.
- **`fractured-run.steps.json`** — three conformance breaks for the aligner to catch: (1) the
  `validate.py` tool_result carries `exitCode: 1` (a failed validation gate), (2)
  `assets/template.html` is never read (an unvisited asset node — the report was never generated),
  and (3) `reference/format-spec.md` is re-read 4 times in a row across consecutive turns after the
  failure (a loop-guard signal above the skill's own "at most 3" retry language).

## Round-trip (WP 4.1)

None of these fixtures encode a round-trip edit themselves; `skills/zero-annotation/SKILL.md` and
`skills/annotated/SKILL.md` are good byte-stable inputs for a future round-trip test (edit an
anchored region, assert the rest of the file is untouched byte-for-byte, submit as a new version).

## A note on shape stability

**These JSON shapes are provisional.** The shared contract for the skill graph IR, the trace-event
vocabulary, and the session-trace shape lands in WP 1.0
(`packages/shared`, types + zod) and has not landed as of this corpus's creation. Field names here
(`payload_json` as an object, the specific tool names, the annotation comment syntax) are best
guesses at what a consuming test will want, not a frozen API. **Tests own the final mapping** from
these fixtures to whatever WP 1.0 actually specifies — expect adapters, not exact equality, and
feel free to add more fixtures alongside these as real gaps turn up.
