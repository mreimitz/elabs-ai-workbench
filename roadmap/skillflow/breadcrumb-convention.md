# The SkillFlow breadcrumb convention (WP 3.2)

D7(b): without markers, gatekeeper conformance can only be **inferred** from downstream signals
(which sub-routine's tools fired next). Inference is conservative on purpose (see
[`00-architecture.md`](./00-architecture.md) and `aligner.ts`'s `inferGatekeepers`) — it will never
fracture a gatekeeper it can't prove misrouted, so a silent misroute stays `unvisited` rather than
inventing a fracture. The breadcrumb convention closes that gap: a skill can ask the agent to leave
a trivial, self-describing marker at each gatekeeper decision, turning "probably took this branch"
into an exact, checkable claim.

This document is the one deliverable other phases build on: Phase 4's Design-mode editor can inject
the instruction sentence automatically when it creates a gatekeeper node; Phase 5's suggested-edit
loop can recommend adding it to a skill whose gatekeepers keep coming back `inferred`.

## The marker syntax

A single bracketed line, emitted as ordinary prose in the agent's own turn (not a tool call, not a
side-channel):

```
[skillflow:gate=<nodeId> route=<edgeId>]
```

- `gate=<nodeId>` — **required**. The gatekeeper's stable node id from the projected graph (see
  "Matching rules" below for where that id comes from).
- `route=<edgeId>` — **optional**. The id of the outgoing edge (branch) the agent is about to take.
  Omit it when the marker only needs to record "I reached this gatekeeper", e.g. a gate with a
  single unconditional path forward.
- Whitespace is tolerant: extra spaces around `=` or inside the brackets parse identically
  (`[skillflow: gate = route-input  route=r-csv ]` is the same marker as the compact form).
- Multiple markers may appear in the same turn (one per gatekeeper decision made in that turn); each
  is extracted independently, in the order it appears.
- A marker may also name a `subroutine` section's id instead of a gatekeeper's — this records "I'm
  in this section now" without a route (no `route=` is meaningful there since a plain section has no
  branch to name).

The shared regex is `SKILLFLOW_MARKER_PATTERN` in `packages/shared/src/constants.ts`; the one parser
that reads it is `apps/api/src/skillflow/markers.ts` (`extractMarkers`) — both trace normalizers
(`run-trace.ts` for internal runs, `session-ingest.ts` for uploaded Claude Code sessions) call this
same function, so the syntax is defined exactly once and detected identically regardless of source.

## The one-sentence SKILL.md instruction

Skill authors add this sentence directly under (or immediately after) the prose that describes a
gatekeeper decision — no other file, no side-car, nothing outside `SKILL.md` itself:

> Right before you act on this decision, emit a single line of the form
> `[skillflow:gate=<this-section's-id> route=<the-branch-you-chose>]` so the choice can be checked
> later — pick `<the-branch-you-chose>` from the routing table below; if you're unsure, still emit
> the gate id alone with no `route=`.

The skill's author fills in `<this-section's-id>` and the candidate route ids once they know them —
see "Matching rules" for how to get them. This is the ONLY thing a hand-written skill needs to add
to opt in; nothing else about the skill's structure changes, and the graph projection, footprint,
and every other SkillFlow view keep working exactly as before whether or not the sentence is there.

## Matching rules

- **Ids come from the projected graph.** `GET /api/skills/:id/versions/:vid/graph` (WP 1.1) assigns
  every gatekeeper and every outgoing edge a stable id — that id is exactly what a marker's `gate=`/
  `route=` values must name. A skill author (or Design Mode, in Phase 4) reads the graph once to know
  which ids to write into the instruction sentence above.
- **Annotation-pinned ids survive reordering.** Projection-inferred ids are derived from heading text
  and document position, so moving a section around the file CAN change its inferred id. To keep a
  marker's `gate=` value stable across edits, pin the gatekeeper's id explicitly with an in-file
  annotation directly above its heading (`apps/api/src/skillflow/annotations.ts`):

  ```markdown
  <!-- skillflow:gatekeeper id=route-input -->
  ## Route the input
  ```

  The annotation is an HTML comment — invisible in rendered markdown, inert to the consuming agent
  (D2) — and the projector honors it over the inferred id no matter where the section moves. A test
  (`apps/api/test/skillflow-breadcrumbs.test.ts`, "annotations: a skillflow:gatekeeper id survives
  its section moving to a different position") proves the id is unchanged by a reorder while the
  anchor (line range) legitimately does move.
- **Exact matching, both directions.** When a marker's `gateId` names a real gatekeeper node, the
  aligner visits it; when its `routeId` names one of that gatekeeper's real outgoing edges, the
  aligner traverses exactly that edge. When `routeId` names something that ISN'T one of the
  gatekeeper's outgoing edges, that's a genuine, provable misroute: the aligner fractures the
  gatekeeper with **both** the expected edge ids and the actual (bogus) route named in the verdict's
  `reason`, and the bogus id itself on the verdict's `edgeId` (`aligner.ts`'s `matchMarkers`). No
  edge is guessed at or silently traversed on a mismatch.

## Degradation story — skills without markers

Markers are entirely optional (D2 — every skill, including one with zero SkillFlow markup, must
still work). A gatekeeper with no marker evidence falls back to the WP 2.2 conservative-inference
path (`inferGatekeepers`): it is visited (and its taken branch traversed) ONLY when downstream
territory the trace demonstrably reached implies a specific branch was taken, and it is **never
fractured** by inference alone — a silent gatekeeper simply stays `unvisited` rather than being
judged. Nothing is invented either way.

To make that distinction visible in the contract, every verdict (not just gatekeepers') now carries
an additive `confidence` field:

- `'exact'` — the verdict's evidence includes at least one `marker` event or one `script_result`
  event: deterministic hard evidence (an explicit breadcrumb naming the gate/route, or an observed
  script exit code), not a guess.
- `'inferred'` — everything else, including every verdict on a trace with no markers/script results
  anywhere at all (the honest reality for most internal runs today — WP 2.1's ground truth is that
  they carry no structured exit codes and, until a skill adopts the breadcrumb sentence, no markers
  either). A zero-annotation skill therefore has **every** verdict come back `'inferred'` — the exact
  same statuses/reasons Phase 2 already produced, plus this one new field.

One documented nuance: the conservative inference pass folds a visited downstream node's own
evidence into the gatekeeper it implies. If that downstream territory happens to include a
script-backed gate that passed, the implied gatekeeper inherits that idx and reads `'exact'` too —
intentional, not a bug: the branch is only "implied" in the sense that the aligner decided it was
taken, but the fact that it WAS taken is then confirmed by real deterministic evidence further down
the same path.

## Token cost

A breadcrumb line is deliberately trivial — a few tokens (`[skillflow:gate=… route=…]` is well under
20 tokens on any tokenizer) per gated turn, not per turn overall: it only rides on turns where the
agent is actually making a gatekeeper decision the skill asked it to mark. For a skill with, say,
five gatekeepers exercised once per run, that's on the order of 50-100 tokens total — negligible
next to the SKILL.md/reference-file footprint SkillFlow already measures, and never emitted at all
for a skill that doesn't adopt the sentence.
