# WP 2.1 — Quality-validated trims + skill effect + model-per-quality-bar

**Phase:** 2 · **Size:** L · **Depends on:** 1.2, benchmarks 3.4/5.1 (**owner-gated / blocked**)

## Objective
Join grades to recommendations: suggest a toolset trim only when suite score holds; summarize skill
A/B effect (mean grade delta vs cost delta); name the cheapest model clearing a quality bar per
suite (joins compatibility + grades).

## Acceptance
- [ ] Each grade-aware recommendation records `GRADING_VERSION` and the suite-run ids it read.
- [ ] A trim is never suggested when the quality evidence is missing — `insufficientData` instead.
- [ ] Gate green.
