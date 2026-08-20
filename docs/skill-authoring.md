# Skill authoring guide — dos, don'ts, and why

The canonical best-practices reference for building Agent Skills in this workspace. Every
practice has a stable anchor; the Skill IDE **quality engine cites these anchors from its
findings** (ruleId = anchor where one exists), so enforcement and explanation never drift
apart. Served in-app via the docs route (platform WP 1.2).

Each practice is tagged:
**[enforced]** a quality/validation rule checks it · **[measured]** a Benchmarks suite can
prove or refute it on your own runs · **[convention]** agreed practice, not machine-checked ·
**[planned]** the checking rule is specced but not built yet.

The mental model behind everything here is **progressive disclosure**: L1 (name + description)
is always in context, L2 (the SKILL.md body) loads when the skill triggers, L3 (referenced
files) loads only when a step needs it. Every token you push down a level is a token every
unrelated conversation doesn't pay.

---

## 1. Identity & triggering (L1)

### `manifest-incomplete` — write the description for the router, not the reader · [enforced]
The description is the single highest-leverage line in the skill: it is how the model decides
to use the skill at all, in every runtime.
**Do:** state *when* to use it ("Use when the user asks to compare two MCP servers…"), name
concrete trigger phrases, keep it specific and ≥ 20 meaningful characters.
**Don't:** generic marketing prose ("A powerful helper for data tasks"), duplicate the name,
bury the trigger conditions mid-sentence.
*Enforced:* a missing description is an **error**; a description under 20 characters is a
**warning**.

### `trigger-hygiene` — maintain the trigger surface deliberately · [enforced]
Keywords + description phrasing + `/commands` are one surface.
**Do:** keywords in frontmatter (`keywords:`) for the phrases users actually type; distinct
`/command` tokens per entry flow.
**Don't:** keyword lists that repeat the description verbatim, near-synonym keyword spam, or
keywords that collide with sibling skills (`command-collision-internal` is an error inside one
skill; the cross-skill collision report catches the rest).
*Enforced:* a skill with **no** frontmatter keywords **and** a generic description is flagged
(**info**) — the trigger surface is too thin to route on reliably.

### `command-collision-internal` — each entry point owns a distinct trigger · [enforced]
Two entry points inside one skill that share a trigger (two `## /report …` headings, or a
`/command` a keyword also claims) are ambiguous: only one can win the invocation, and which one
is an accident of ordering.
**Do:** give every `/command` and keyword its own distinct trigger token; if two flows are
really variants, make them one entry with an explicit branch.
**Don't:** copy-paste a command heading and forget to rename its trigger.
*Enforced:* two entry points with the same trigger are an **error**. (The cross-skill trigger
collision report, Phase 7, catches collisions *between* skills.)

### `l1-budget` — L1 stays lean (default ceiling 500 tokens) · [enforced]
L1 is paid in **every** conversation the runtime loads the catalog into, triggered or not.
**Do:** move anything beyond identity + trigger conditions into the body.
**Don't:** parameter tables, examples, or caveats in the description.

## 2. Body structure & flows (L2)

### `l2-budget` — the body is a briefing, not a manual (default ceiling 5 000 tokens) · [enforced]
Anthropic's own guidance: keep SKILL.md under ~500 lines; split beyond that.
**Do:** short numbered steps, one section per step (sections are what the flow projector
turns into graph nodes), push detail to L3 files.
**Don't:** exhaustive API docs inline, duplicated content between sections.

### `orphan-section` — every section reachable from a flow · [enforced]
A section no flow reaches is dead weight the agent may still read.
**Do:** one flow per `/command` with its own entry section; shared material referenced
explicitly ("see /report") or moved to L3.
**Don't:** appendix sections that nothing links to.

### `gatekeeper-no-breadcrumb` — decision points leave markers · [enforced, measured]
Branch points ("if X do A else B") are where skills silently derail. The breadcrumb convention
(`[skillflow:gate=<nodeId> route=<edgeId>]`, see `planning/Roadmap/RM-23-skillflow/breadcrumb-convention.md`)
turns "probably took branch A" into a checkable claim your test runs verify.
**Do:** instruct the agent to emit the marker at each gatekeeper; keep branches mutually
exclusive and explicitly worded.
**Don't:** implicit branching buried in prose; three-way decisions written as two paragraphs.

### Loop guards — bound every retry · [convention]
**Do:** state an iteration ceiling wherever you ask for retry/repeat behavior ("retry at most
twice, then report the failure").
**Don't:** "keep trying until it works" — weaker models will.

## 3. Referenced files (L3)

### `broken-ref` — every relative reference must resolve · [enforced]
**Do:** reference bundled files by relative path from the skill root; keep names stable.
**Don't:** absolute paths, OS-specific separators, references to files you removed.
*Enforced:* the quality engine promotes the flow projector's **reference-resolution** warnings
(e.g. an annotation naming a script that doesn't exist, a malformed annotation, an empty or
heading-less document) to **errors**. Design-legitimate projector warnings — a branching
section whose branch targets aren't distinct sections, or a deliberate cross-flow `see /other`
link — are **not** promoted.

### `unused-asset` — no dead files · [enforced]
Every bundled file costs registry bytes and reader attention.
**Do:** delete or reference; if two contexts are mutually exclusive, keep them in **separate**
files so a run loads only one (this is the core L3 win).
**Don't:** "just in case" dumps, generated artifacts, binaries the agent can't read.

## 4. Scripts

### `script-undocumented` — scripts declare their contract · [enforced]
**Do:** state what the script does, its expected exit code, and how the agent verifies success
("run `check.py`; exit 0 means the schema is valid — on non-zero, read stderr and fix the
input"). Provide a manual fallback path for runtimes that cannot execute scripts.
**Don't:** assume bash/python exists, assume network access, or make a script the only way a
step can complete. Scripts are stored and metered by this app but **never executed** by it.

## 5. Tool & MCP-server references

### Tool references are explicit and conservative · [enforced-when-5.1-lands, planned]
**Do:** name tools in backticks exactly as the server exposes them (`` `acme_create_data_object` ``),
near words like "tool"/"call"; declare target servers in frontmatter `servers:` and resolve
them to exact registered servers in the IDE (Phase 8 binding).
**Don't:** paraphrased tool names ("use the data-object thing"), tools the bound server's scan
doesn't contain, references relying on a tool that vanished two scans ago (`stale_tool`).

### Mind the tool-surface footprint · [measured]
Every referenced tool implies its definition rides along in the agent's context.
**Do:** reference the minimal tool set; check the palette's footprint readout; prefer skills
that narrow tool choice (that is their economic point).
**Don't:** "the server has 40 tools, mention them all."

## 6. Token & cost discipline · [measured]

**Do:** check the skill's L1/L2/L3 footprint in the inspector after every edit; treat the
quality engine's budget warnings as real regressions; validate a heavy skill's *value* with a
Benchmarks A/B (same suite ± skill — grade delta vs token delta).
**Don't:** trust vibes ("it's probably fine") — this entire app exists because it isn't.

## 7. Security & trust · [enforced-when-security-posture-lands]

**Do:** plain imperative instructions; disclose any network endpoints a skill asks the agent
to touch; keep secrets out of skill files entirely (they sync to git).
**Don't:** instruction-injection phrasing ("ignore previous instructions", "do not tell the
user"), zero-width/homoglyph characters, secret-shaped sample values in examples — the posture
analyzer flags all of these on servers, and the same heuristics roll up over skills.

## 8. Cross-runtime & cross-model portability

The SKILL.md format is a de-facto standard across 16+ runtimes (Claude Code/web, Cursor,
OpenAI Codex, Gemini CLI, GitHub Copilot, Goose, Letta, …) — but **implementations differ**.
Write for the strictest runtime and the weakest model you intend to support.

### `portability-frontmatter` — only `name` + `description` are universal · [convention]
Everything else (`keywords`, `servers`, `license`, …) is tolerated metadata some runtimes
ignore.
**Do:** treat extended frontmatter as an enhancement; repeat anything behavior-critical as
plain body text.
**Don't:** encode a must-follow constraint *only* in a nonstandard frontmatter field.

### `portability-loading` — don't assume lazy loading · [convention]
Claude-family runtimes read the body on trigger; some runtimes inject more eagerly, some
summarize long bodies. The L2 budget is your safety margin everywhere.
**Do:** front-load the critical instructions in the first screenful of the body.
**Don't:** rely on "the model will read to line 400."

### `portability-execution` — capabilities differ per runtime · [convention]
Script execution, filesystem access, and network access vary (chat contexts often have none).
**Do:** per §4, every scripted step carries a manual fallback; file operations use relative
paths; state assumptions explicitly ("requires a runtime that can run Python").
**Don't:** hard dependencies on bash, cwd layout, or OS specifics.

### `portability-model` — write for the weakest model in scope · [measured]
Models differ in context window, schema strictness, parallel-tool-call behavior, and how much
implicit structure they infer. A skill that works on a frontier model can fail on a smaller
one by skipping steps or mangling tool arguments.
**Do:** explicit numbered steps, one instruction per sentence for critical paths, exact tool
argument examples; then **prove** portability by running the same graded suite across
scenarios with different models (the suite × scenario matrix exists for exactly this) and
reading the compatibility heatmap for context-limit pressure.
**Don't:** claim "model-agnostic" without a measured per-model grade — that claim is testable
here, so test it.

## 9. Validate before you ship (in this app)

1. **Quality tab** (Skill IDE): score + findings — each finding links back to its section here.
2. **Tool diagnostics** (Phase 5) + **binding state** (Phase 8): no unknown/stale/unbound
   tool references.
3. **Footprint** (inspector): L1/L2/L3 within budget; tool-surface tokens sane.
4. **Conformance**: attach to a scenario, run a test, check the Trace overlay + gate
   assertions — did the agent actually follow the designed flow?
5. **Effect**: a Benchmarks suite ± the skill — does it improve grades enough to justify its
   tokens, per model you care about?
6. **Portability**: repeat 4–5 on every model/runtime class you claim to support.

---

## Maintaining this guide

- **Rule ↔ anchor contract:** a quality/validation/posture ruleId and its anchor here share
  one name; adding a rule without its section (or vice versa) fails the WP acceptance that
  introduced it.
- **New practices need evidence or a source:** either a Benchmarks measurement on this
  workspace's own runs, or an external source worth citing.
- External grounding used for this revision: Anthropic's
  [skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
  and [Agent Skills engineering post](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
  (progressive disclosure, ≤500-line bodies, evaluation-first authoring, split
  mutually-exclusive contexts), the
  [agent-skills ecosystem overview](https://serenitiesai.com/articles/agent-skills-guide-2026)
  (16+ runtimes, per-runtime differences), and
  [cross-provider convergence analysis](https://www.mindstudio.ai/blog/agent-skills-open-standard-claude-openai-google)
  (portable core = name/description/schema; wrappers differ).
