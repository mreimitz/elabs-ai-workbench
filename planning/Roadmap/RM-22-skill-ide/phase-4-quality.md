---
type: "Work Package Spec"
title: "Phase 4 \u2014 Quality (WP specs)"
description: "Size: L \u00b7 Depends on: 1.2 \u00b7 API"
tags: ["roadmap", "RM-22"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 4 — Quality (WP specs)

## WP 4.1 — Quality engine: deterministic rules + score + route
**Size:** L · **Depends on:** 1.2 · API

**Objective:** enterprise-grade quality checks per skill version (I4): pure, versioned, scored.

**Files:** `apps/api/src/skillflow/quality.ts` (new), routes end-hunk
`GET /api/skills/:id/versions/:vid/quality`; `apps/api/src/config/env.ts` + `.env.example`
(token ceilings); tests `apps/api/test/skill-ide-quality.test.ts`.

**Rules (initial set, each with ruleId + severity + anchored finding + optional `fix` ops):**
`manifest-incomplete` (missing/weak description <20 chars — error/warning), `broken-ref`
(projector warnings promoted — error), `l1-budget` / `l2-budget` (ceilings, warning),
`unused-asset` (file never referenced — info, fix: none), `script-undocumented` (script file
with no exit-code/verify language near its reference — warning, fix: append expectation
sentence), `gatekeeper-no-breadcrumb` (fix: the WP 5.2 SkillFlow missing-breadcrumbs ops —
REUSE `suggestions.ts` helpers), `orphan-section` (section unreachable from any flow — warning),
`trigger-hygiene` (empty keywords + generic description — info), `command-collision-internal`
(two entry points with the same trigger — error). Score: 100 − Σ(weights: error 15, warning 5,
info 1), floored at 0, formula exported as a constant and documented.

**Acceptance:** fixture matrix — a deliberately-messy new fixture skill scores low with the
expected findings; the clean zero-annotation fixture scores high; every `fix` op batch passes
`validateEditOps`; determinism; stamped `qualityEngineVersion`; gate green. **Rule↔guide
contract (owner-added 2026-07-04):** every finding carries
`guideAnchor = "docs/skill-authoring.md#<ruleId>"`, and a test asserts every emitted ruleId has
a matching anchor in `../../docs/skill-authoring.md` (`../../docs/skill-authoring.md`) (parse
the headings) — a rule without its guide section fails the gate.

**Note (review 2026-07-04 finding 5):** this WP only **emits and shape-validates** `fix` ops
(`validateEditOps`, landed in 1.1) — it never applies them. Application happens through the
normal edits route in WP 4.3 (W6, after 2.1's semantics land). Do not add a dependency on 2.1
here, and do not execute ops in this WP.

**Implementation notes (verified 2026-07-04):** every input the rules need already exists —
manifest via `parseSkillManifest` (`apps/api/src/skills/manifest.ts`), graph via the projector
(v3), L1/L2 token levels via `countLevels` (`apps/api/src/skills/footprint.ts`), file list via
the skills repository. The severity weights, `QUALITY_ENGINE_VERSION`, and the L1=500/L2=5000
ceilings (env-overridable) **landed in WP 1.1's shared constants** — consume them, don't
redefine. Rule data sources: `unused-asset` = file present in the tree but target of no asset
node/edge; `orphan-section` = section node unreachable from any entry point or the main-flow
head by edge walk; `gatekeeper-no-breadcrumb` reuses the WP 5.2 SkillFlow helpers in
`suggestions.ts` (import, don't copy).

## WP 4.2 — Static optimization suggestions
**Size:** M · **Depends on:** 4.1 · API

**Objective:** "suggest ways to optimize skills" without needing a trace: trace-less rules in
the existing suggestion engine, unified shape with quality `fix` ops.

**Files:** `apps/api/src/skillflow/suggestions.ts` (extend: a `buildStaticSuggestions(graph,
files, footprint)` entry), routes: `GET …/versions/:vid/suggestions` WITHOUT runId now returns
static suggestions (runId keeps returning trace-based ones); tests extend
`skillflow-suggestions.test.ts`.

**Rules:** `split-oversized-body` (L2 over ceiling → move a named section to
`reference/<slug>.md` — ops: add_file + update_section_body; **3.1 has landed, so this ships
with real ops, not advisory-only** — review 2026-07-04 finding 4), `dedupe-keywords`,
`remove-unused-asset` (advisory), `tighten-description` (advisory). Same no-corruption guarantee: non-empty ops validated or
downgraded.

**Acceptance:** static route works on all fixtures; rules fire exactly where expected;
suggestions with ops round-trip; gate green.

## WP 4.3 — Quality tab
**Size:** M · **Depends on:** 4.1, 4.2 · Web-only

**Objective:** a Quality tab in the SkillInspector (after Trace): score card (MetricCard +
severity breakdown), findings list (severity badge, message, anchor deep-link into the Design
tab's node/panel where anchored), static optimization suggestions with the same
"Review & apply" flow as trace suggestions (reuse SuggestionCard), a "Re-run checks"
refresh, **and the tool-diagnostics section (WP 5.1's `ToolDiagnostic`s rendered here — moved
from 5.2 per review 2026-07-04 finding 1, since 5.2 merges before this WP).**

**Files:** `apps/web/src/features/skills/quality/QualityView.tsx` (+ children),
`skills-inspector-api.ts`, `SkillInspector.tsx` (tab order: Overview · Design · Trace ·
**Quality** · Files · Versions · Diff).

**Acceptance:** live walk: messy fixture shows score + findings; applying a fix creates a new
version and the score improves; each finding renders a **"Why" link to its
`docs/skill-authoring.md` section** (in-app docs route when platform WP 1.2 is merged, else the
repo file path shown as reference); both themes; empty/loading/error states; gate green + smoke
screenshots.
