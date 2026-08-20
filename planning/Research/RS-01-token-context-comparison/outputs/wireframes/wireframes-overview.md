---
type: "Research Output"
title: "Wireframes \u2014 test results view"
description: "Clickable HTML prototypes for displaying the compatibility test results. Open the .html files in a"
tags: ["research", "RS-01"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Wireframes — test results view

Clickable HTML prototypes for displaying the compatibility test results. Open the `.html` files in a
browser. They are **wireframes** (plain HTML/CSS, neutral palette) — to be rebuilt with `@elabs-ai/components-*`
components for production.

## Prototypes

- **`01-test-results-timeline.html`** — the test list as a **vertical timeline** (RevisionTimeline
  style): tests stacked newest-style under level headers (Environment / Server / Tool / Session),
  each an **expandable** entry. Expanding reveals the **impact per LLM/model** as **severity chips**
  grouped by provider (hosted vs open-weight). **Hover a chip** for a popup with the resolved
  severity, failure mode, the model-specific rationale, and the dataset **evidence** (field = value,
  confidence, source). Collapsed rows show a severity-distribution bar.

Real data: every chip + tooltip is generated from the live catalog (`tests/test-catalog.json`) run
through the resolver (`tests/resolve_model_severity.py`) against all 33 models — not mock data.

## Regenerate

```
python3 wireframes/build_wireframe.py
```

Re-run after the catalog or dataset changes.

## Note on the `RevisionTimeline` component

`@elabs-ai/components-data` `RevisionTimeline` (the storybook template) is a **git-history** component — it models
commits (lanes, SHAs, churn, day-grouping) with a **selection rail**, not an inline expand-to-detail
list. Its *vertical-timeline visual* is the right template and is what this wireframe emulates. For
the production build, two clean options:

1. **Reuse the visual pattern** (spine + node dots + stacked entries) on a generic
   expandable list / `Accordion` + a detail panel, styled with brand tokens — closest to this wireframe.
2. **Adapt `RevisionTimeline`**: map each test → a timeline node, use its selection rail to drive a
   side **detail panel** that renders the per-model chip grid (instead of inline expand).

Recommendation: option 1 (the timeline look is the value; the git-specific lane/SHA/churn machinery
isn't needed). Each test row = a node; chips = the per-model severities; tooltip = the rationale+evidence
the resolver already produces.

# Citations

None.
