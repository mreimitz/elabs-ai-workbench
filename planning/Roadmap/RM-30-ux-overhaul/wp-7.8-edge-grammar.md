---
type: "Work Package Spec"
title: "WP 7.8 build - edge grammar + entry-point flows (five edge kinds, reachability flows with always/maybe-read token figures, guided connect refusals, app-side box positions)"
description: "The build spec for WP 7.8, derived from the owner-approved design doc. Four ordered pieces: the edge kind on the wire and in the projector, reachability-derived entry-point flows with token figures, the connection grammar and its guidance, and per-skill box-position persistence with Auto-arrange."
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-22T13:05:00Z"
status: "final"
---
# WP 7.8 — edge grammar + entry-point flows (build)

Ledger: [`STATUS.md`](./STATUS.md). **The design is already settled and signed off** —
[`wp-7.8-edge-grammar-design.md`](./wp-7.8-edge-grammar-design.md), APPROVED BY THE OWNER
2026-08-22, all six recommended decisions accepted as written plus decision 7 settled.

> **Read the design doc first, end to end.** This file is the build order and the acceptance
> surface. It does not restate the reasoning, and where the two appear to differ, **the design doc
> is authoritative on intent** and this file is authoritative on scope and sequencing.

**Depends on:** WP 7.7, **merged** (`wp/roadmap-cleanup/rm30-7.7`). Both work packages own
`use-edit-ops`, which is why 7.8 lands *after* 7.7 and never beside it.

**Blocks:** WP 7.9 (Designer=visual vs Files=source), the last open WP in Phase 7.

**Size:** XL. It is the largest single work package remaining in this plan.

---

## 0. Sequencing — four pieces, committed separately

The design doc §7 splits this into four pieces and says the first two are not separable from each
other while the last two are small and independent. Build in this order and **commit at the end of
each piece**:

1. **The contract and the projector.** The majority of the work and the only genuinely risky part.
2. **Reachability flows and per-kind drawing.** Not separable from piece 1.
3. **The connection grammar and its guidance.** Small, independent.
4. **Box-position persistence + Auto-arrange.** Small, independent, carries the one migration.

> **This is not a style preference — it is a recovery requirement.** This plan has twice lost an
> agent mid-build to a session limit, and once the rescued work had **no commits of its own** and
> came within a routine worktree cleanup of being destroyed silently. Commit each piece as it
> lands, even if the next one has not started. A partial WP with four clean commits is recoverable;
> a complete WP with none is not.

If you run out of room, stop at a piece boundary and report exactly which pieces landed. Pieces 3
and 4 are explicitly droppable to a follow-up; pieces 1 and 2 are not.

---

## 1. Piece 1 — the edge kind on the wire and in the projector

### 1.1 The contract (`packages/shared`)

The edge gains an **optional** `kind`. Additive: a graph produced before this still parses.

```
SkillGraphEdge = { id, from, to, condition?, anchor?, flowId?, kind? }
```

The five kinds and their legality table are **§2 of the design doc**. Transcribe that table into
the contract as data — a frozen legal-pair structure the projector, the connect handler and the
tests all read — not as three independent `if` chains. One definition, three readers. If you find
yourself writing the rule twice, you have built the bug this project has already fixed once this
month (the two byte-identical `buildRunFilterWhere` copies, one of which was silently unpinned).

Contract-first is a hard repo rule: **types + zod in `packages/shared` first**, then API, then web.

### 1.2 The projector (`apps/api/src/skillflow/projector.ts`)

Three changes, in the design doc's own words:

- **Stamp a kind** at each of the nine places it currently creates an anonymous edge.
- **Merge duplicate file and tool boxes** — one box per file or tool, with many `Uses` edges into
  it, instead of one box per mention (design decision 3).
- **Tighten `extractConditions`** so prose stops becoming branch labels.

> **That last point supersedes the design doc's §7 recommendation, and the reason is measured, not
> assumed.** The doc recommended fixing unresolved branch targets before introducing `Branch`, and
> flagged that it could not tell from the code whether real skills write branches resolvably. The
> owner asked for that to be measured; it was. The whole registered corpus — five skills, 47
> versions — yields **one** unresolved branch, and it is a **mis-parse**: two narrative sentences
> beginning *"If the answer is complete after one query…"* became two condition labels on one edge.
> Conditionals are frequent but are intra-step rules, not routing; only three phrases in the corpus
> name a destination and none sits in a gatekeeper section.
>
> So the defect is a **false positive, not a missing resolution**. The fix is to tighten
> `extractConditions` **inside this work package** so prose stops becoming branch labels, and to
> leave `Branch` **defined but unused** until an author has a real decision point. It is explicitly
> **not** its own work package. Evidence, method and the sample-size caveat (five skills, one
> author, one domain) are in the design doc's Evidence section — read it before touching the
> extractor, and do not over-fit to that one corpus.

### 1.3 The coupling that will bite you

**The projector is not only the canvas's source.** The same graph drives trace replay, the quality
findings, and the cross-skill trigger-collision report. Merging duplicate boxes changes which box a
recorded "the agent read this file" event lands on.

Decision 7 is settled: **a trace recorded before the change DEGRADES with a visible notice.** Not
migrated, not hidden. Build that notice — a trace whose node ids no longer resolve must say so on
screen, in plain language, rather than rendering a silently wrong overlay. The design doc's author
read the alignment code but **did not run a trace against it**; you must. If you cannot exercise a
real trace, say so explicitly in your report rather than inferring the behaviour from the code.

Expect the projector's stored fixtures and the layout tests to move. **That is intended** — "the
graph looks different than yesterday" is the expected outcome here, not a regression. Update the
fixtures deliberately and say in your report which ones changed and why.

---

## 2. Piece 2 — reachability flows and per-kind drawing

Replace lane-membership filtering with **forward reachability from the entry point** (design
decision 2). Everything reached is labelled:

- **Always read** — every edge on the path is `Triggers`, `Then` or `Contains`.
- **Maybe read** — at least one `Branch` or `Uses` edge lies on the path.

**The token figure is the deliverable.** The panel beside the canvas must read something of the
form *"/analyze — always reads 4 sections, 1,240 tokens. May additionally read 1 file and call 1
tool, up to 3,900 tokens."* The design doc is explicit: that number *"is what turns the diagram
from a picture into a measurement, and it is why this work package is worth its size."* A flow view
that filters correctly but shows no token figure has not delivered this WP.

Reuse the app's existing skill token-footprint accounting for those figures — this app already
meters L1/L2/L3. **Do not introduce a second counter.**

Three accepted consequences, all approved, all visible changes:

1. **A step can appear in more than one flow.** Today it belongs to exactly one lane.
2. **Files and tools are drawn once**, with many arrows in (this is piece 1's box merge landing on
   screen).
3. **A keyword's flow is the whole skill.** Do not compute a per-keyword subset — it would be
   fiction. Stated in the design doc precisely so nobody builds it.

Per-kind drawing: the five kinds must be visually distinguishable on the canvas. **Distinguish by
more than colour** — the repo has already locked that principle once (D-DB4, footprint lines
differentiated by stroke pattern, not colour alone) and it applies here for the same reason.
Everything visible is `@elabs-ai/components-*` with semantic tokens; no raw colour literals.

`graph-layout.ts`: the "one entry point" view lays out one flow at a time; the "All" view keeps
today's stacking.

---

## 3. Piece 3 — the connection grammar and its guidance

Design decision 4, three behaviours in this order:

1. **Prevent the impossible silently.** While dragging, only legal targets highlight. An arrow into
   a file, or out of a tool, does not snap. No error — nothing went wrong.
2. **When the intent is obvious, offer the legal move.** Dropping a tool onto another tool becomes
   an offer with a button: *"A tool can't be called by another tool. Call it from **Summarise**
   instead?"* — one click applies it.
3. **When it is genuinely wrong, explain in the vocabulary the app already teaches.** Name the edge
   kind attempted and link the guide section. `code-intel/explainers.ts` already defines edge kinds
   by name with verified guide links and is already covered by a test — **reuse it, do not write
   new copy.**

**The rule to hold the build to, verbatim from the design doc:** *"no message that only says an
action failed."* Every refusal either offers the correct move or names the rule that was broken.
The current single message — *"Couldn't create that connection — A connection runs from a section
to an asset file"* — is exactly what this replaces.

---

## 4. Piece 4 — box positions, app-side

Design decision 5, approved: positions live **in the app's database, per skill, not per version,
and never in `SKILL.md`**.

The reason is this project's whole subject: `SKILL.md`'s body is what the model reads, and this app
meters it as the L2 footprint. Position comments are invisible to a reader and fully visible to the
tokenizer — *"a tool whose purpose is measuring context cost should not inflate that cost to store
cosmetics."* Two further consequences ruled it out: every version is an immutable snapshot, so
nudging a box would either dirty the draft or be discarded; and layout churn would appear in every
version diff.

**This WP may take one migration — one, and only for this.** Two conditions ride with it, both part
of the approval:

- an orphaned position falls back to automatic layout **for that one box** — never a broken canvas;
- a visible **Auto-arrange** button clears the saved positions. The design doc names it as part of
  the decision, so shipping the persistence without the reset does not satisfy the approval.

---

## 5. Rules that bind this WP

- **Contract-first**: `packages/shared` types + zod first, then API, then web.
- **The one-draft, staged-edit architecture holds unchanged.** Nothing on the canvas mutates a
  skill directly; every gesture stages a typed edit reviewed at save. New connections follow the
  same path — no exceptions, no second write path. Three hidden save paths have already been
  deleted from this surface in WPs 7.3 and 7.4; do not add a fourth.
- **brand-ui only**, semantic tokens, **both themes** (`light` and `dark`), keyboard reachable with
  visible focus. Icon-only controls use `IconButton` per D-TB5.
- **One migration maximum**, and only for piece 4.
- **No new runtime dependency.**
- Gate from the repo root: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

---

## 6. Acceptance

**Piece 1 — contract and projector**
- [ ] `SkillGraphEdge.kind` is additive and optional; a graph serialized before this change still
      parses, proved by a fixture test.
- [ ] The legal-pair table is **one** frozen definition read by the projector, the connect handler
      and the tests. A test asserts there is no second copy.
- [ ] All nine anonymous-edge sites in the projector stamp a kind; a test asserts no edge the
      projector emits is kindless.
- [ ] One box per file and per tool, with many `Uses` edges in. A fixture citing one file from four
      steps yields **one** box and four edges.
- [ ] `extractConditions` no longer turns narrative prose into branch labels. The measured
      mis-parse from the design doc's Evidence section is a **named regression test** that fails on
      the old extractor.
- [ ] `Branch` exists in the grammar and **no authoring affordance draws one by hand** (deferred by
      design decision 6).

**Piece 2 — flows**
- [ ] An entry-point flow is forward reachability, not lane membership.
- [ ] Every reached item is labelled always-read or maybe-read by the design doc's rule.
- [ ] **The token figure renders** — always-read count and tokens, plus the maybe-read ceiling —
      from the app's existing footprint accounting, with no second counter introduced.
- [ ] A step reachable from two entry points appears in both flows.
- [ ] No per-keyword subset is computed; a keyword's flow is the whole skill.
- [ ] The five kinds are visually distinguishable by more than colour alone.

**Piece 3 — grammar**
- [ ] Illegal targets do not snap during a drag, and produce **no** error.
- [ ] The tool-onto-tool near-miss offers a one-click legal move that applies correctly.
- [ ] Every genuine refusal names the rule and links the guide, reusing `explainers.ts`.
- [ ] **No message anywhere says only that an action failed** — asserted over the message set, not
      spot-checked.

**Piece 4 — positions**
- [ ] Positions persist per skill across reload, version switch and adding a section.
- [ ] An orphaned position falls back to auto-layout for that one box; the canvas still renders.
- [ ] **Auto-arrange** is visible and clears saved positions.
- [ ] Exactly one migration, and `SKILL.md` is byte-unchanged by a box move — asserted by a test,
      because this is the decision's entire justification.

**Cross-cutting**
- [ ] A trace recorded before the change **degrades with a visible notice** — not migrated, not
      hidden, not silently misaligned. Exercised against a real trace, or the failure to do so
      stated plainly in the report.
- [ ] Changed projector fixtures are listed in the report with the reason each moved.
- [ ] No new dependency; at most one migration; no second save path.
- [ ] Gate green from the repo root, all four commands.

**Prove the teeth, do not assert them.** For at least these three — the kindless-edge assertion,
the `extractConditions` regression, and the `SKILL.md`-byte-unchanged test — break the
implementation, watch the test go red, restore it, and report what you broke and what caught it.

---

## 7. Out of scope

- **Drawing a branch by hand** (design decision 6, deferred).
- **Per-keyword reading lists** (design decision 2, would be fiction).
- Migrating old traces (decision 7: they degrade with a notice).
- WP 7.9's rework: Design dropping Flow|Code|Split, Files becoming the source register. Note that
  7.9 also owns the rail-label mismatch WP 7.7 deliberately left behind — the rail tab reads
  "Tools" while the panel inside is headed "Components". **Leave it alone.** The rename was tried
  and reverted after a browser measurement (~78px of label against ~49px of room).
- Any second component kit, raw colour, or hand-rolled UI.

---

## 8. What is honestly still unknown

State these in your report rather than papering over them:

- **Nobody has ever used this Studio.** Three WPs deep, no human has driven it, no save has been
  completed against a live API, and it has never met a bound MCP server. Every visual claim on
  record is a headless-Chromium measurement. If your acceptance evidence is also headless, say so
  in exactly those terms — do not write "verified in both themes" for a screenshot diff.
- The trace-alignment coupling (§1.3) was read but never exercised by the design's author.
- The branch-corpus evidence is five skills by one author in one domain. The extractor tightening
  should not be over-fitted to it.
