---
type: "Work Package Spec"
title: "WP \u2014 Replace rouge1 with a deterministic aipattern grader"
description: "Status: \ud83d\udd1c planned, not started (owner-decided 2026-07-12)."
tags: ["roadmap", "RM-06"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# WP — Replace `rouge1` with a deterministic `ai_pattern` grader

**Status:** 🔜 planned, not started (owner-decided 2026-07-12).
**Depends:** none new — works entirely within the Phase 1 grading seam already built
(`apps/api/src/grading/grader.ts`, `GRADER_IDS`).

## Motivation

Owner feedback (2026-07-12): ROUGE-1 lexical overlap (`apps/api/src/grading/rouge1.ts`, grades the
final answer against `test.expectedInsight`) is a weak quality signal — a correct answer phrased
differently from the expectation scores low, a near-duplicate-but-wrong answer scores high. The
deterministic check that's actually useful is catching **AI-writing-slop patterns** in the final
answer: hedging boilerplate, filler/sycophancy, and other tells that the answer is padded rather
than substantive. That's a real, cheap, judge-free signal worth keeping a deterministic grader
slot for — ROUGE-1 isn't.

## Scope

- New deterministic grader `ai_pattern` (no judge call, same family as `tool_hygiene` and
  `error_forensics`'s inventory half) scoring **1 minus a weighted incidence** of detected
  AI-writing patterns in the final assistant answer:
  - hedging boilerplate ("it's important to note", "I should mention", "it's worth noting…"),
  - filler/sycophancy phrases ("great question!", "I'd be happy to help", "certainly!"),
  - "As an AI…" / capability-disclaimer patterns,
  - apology patterns ("I apologize for…", "sorry for the confusion"),
  - unnecessary bullet/heading stuffing (structure with no information density — e.g. a
    single-sentence answer broken into three headed sections),
  - em-dash overuse,
  - repeated stock openers ("Certainly," "Moreover," "Furthermore," at paragraph starts),
  - restate-the-question padding (the answer echoes the prompt back before answering it).
- **Evidence, not just a score:** each detected pattern is listed with its category, a count, and
  example spans (quoted, same evidence-citation discipline as the other base graders —
  AR9-style, "labeled finding" not a black-box penalty).
- **Runs on every terminal run that has a final answer** — mirrors the AR5 all-terminal-status
  rule already used by the base-rating graders (`answer_validation`/`insight_surplus`/
  `error_forensics`), not the expectation-gated rule `rouge1` used today.
- `rouge1` is **removed** from the ACTIVE roster (no longer registered in
  `apps/api/src/index.ts`'s `graderRoster`, no longer rendered anywhere in the web UI — runs
  feed, GradePanel, Report tab, suite matrix, `grade-format.ts` label maps) — but the grader id
  **stays in the `GRADER_IDS` shared enum** (append-only, per the AR1 convention already used for
  the base-rating ids) so any already-persisted `run_grades` rows with `graderId: "rouge1"`
  remain a valid, readable `GraderId` and don't become an orphaned/invalid value on read.

## Open decisions (to resolve at implementation, not here)

- **Base vs. expectation dimension:** should `ai_pattern` join `BASE_RATING_GRADER_IDS` (AR6 —
  its own dimension, never folds into `meanGrade`/`passRateAt05`) like the three Auto-Rating
  graders, or stay an expectation-gated grader like the five it sits alongside today? Leaning
  base-dimension (it needs no `test.expectations` to be meaningful, and folding a slop-detector
  into `meanGrade` would conflate "answer quality per the test's rubric" with "writing hygiene")
  — but note the AR6 trade-off explicitly before implementing: adding a fourth always-on
  dimension changes what "the base rating" means and touches the same surfaces WP 3.2 built
  (verdict chips, GradePanel summary).
- **Pattern list versioning:** the detector's pattern list will change over time (new slop tells,
  false-positive fixes) — needs the same never-silently-compare discipline as
  `AUTO_RATING_VERSION`/`GRADING_VERSION`/`TOKEN_COUNTING_VERSION`; decide whether it gets its own
  version constant or rides `GRADING_VERSION`.
- **Multilingual answers:** the pattern list above is English-only; decide whether v1 ships
  English-only (with an honest `unevaluable` for non-English answers, detected how?) or is scoped
  down to language-agnostic patterns only (em-dash overuse, heading stuffing) for v1.
- **Tone reuse:** confirm the new `scoreTone()` helper (added 2026-07-12 for the Outcome/
  Trajectory judge cards — `<0.6` danger, `0.6–<0.8` warning, `≥0.8` success) is the right
  threshold mapping for a slop-incidence score, or whether it needs its own thresholds.

## Definition of done

- `packages/shared` first: no `GRADER_IDS` removal (append-only stands), new grader-internal
  types/evidence shape as needed.
- `ai_pattern` grader implemented + registered (or added to `BASE_RATING_GRADER_IDS` per the
  decision above), `rouge1` deregistered from the active roster and scrubbed from web-visible
  surfaces (label maps, chips, Report tab, suite matrix) while the id itself remains a valid enum
  member.
- Tests cover: pattern detection (true positives per category + a clean-answer control), evidence
  citation shape, the all-terminal-run gate, and a persisted `rouge1` row still round-tripping
  through `GraderId`-typed code without a type or runtime error.
- Gate green (`pnpm typecheck && pnpm test && pnpm build && pnpm lint`); ledger entry in
  [`STATUS.md`](./STATUS.md) on completion, same as every other WP in this plan.

## References

- `apps/api/src/grading/rouge1.ts`, `apps/api/src/grading/grader.ts`,
  `packages/shared/src/constants.ts` (`GRADER_IDS`, `BASE_RATING_GRADER_IDS`),
  `apps/web/src/features/testing/grade-format.ts`, `apps/web/src/features/testing/ReportTab.tsx`.
- [`STATUS.md`](./STATUS.md) 2026-07-12 entry (rating visibility + report redesign session that
  surfaced this decision) and [`README.md`](./item.md) (AR1 append-only-roster convention,
  AR6 base-vs-expectation dimension split, AR15 versioning discipline).
