---
type: "Roadmap Item"
title: "UI/UX audit remediation 2026-08"
description: "Fix the defects found by the 2026-08-21 rendered cross-theme design and usability audit of the running app: the /advisor recommendation wall-of-text and its 55 WCAG 2.5.8 target failures, the duplicate SVG pattern ids that mis-register the illustration grid, the nested <p> React error on the run console, the markdown-table toolbar that names icon controls with title= and paints no focus ring, the two pages whose primary actions become unreachable at 768px, and the smaller consistency and density findings."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:21:33Z"
status: "planned"
---

# UI/UX audit remediation 2026-08

## Goal

Fix the defects found by the 2026-08-21 rendered cross-theme design and usability audit of the running app: the /advisor recommendation wall-of-text and its 55 WCAG 2.5.8 target failures, the duplicate SVG pattern ids that mis-register the illustration grid, the nested <p> React error on the run console, the markdown-table toolbar that names icon controls with title= and paints no focus ring, the two pages whose primary actions become unreachable at 768px, and the smaller consistency and density findings.

## Why it matters

The audit measured the running app in both themes and found the token, contrast and focus foundations genuinely sound (0 contrast failures across 30 routes x 2 themes, 45/45 tab stops ringed, reduced-motion covered by the design system). What is left is a short list of specific, evidenced defects - two of which are live rendering or React errors, and three of which break the project's own written rules (icon-affordances D-TB5, the no-swallowed-errors rule, and the 24px target minimum). Fixing them is bounded work with a measurable finish line.

## Milestones

- [ ] WP 1.1 - /advisor: recommendation body readability + evidence-chip target size
- [ ] WP 1.2 - PaperStage: unique SVG pattern ids (live grid mis-registration)
- [ ] WP 1.3 - run console: remove the nested <p> React error
- [ ] WP 1.4 - markdown table toolbar: IconButton affordance + focus ring (D-TB5)
- [ ] WP 2.1 - responsive: keep primary actions reachable at 768px
- [ ] WP 2.2 - consistency + density: runs-table dual encodings, server-card chip repetition, run-launcher step 1, silent 404 on environments

## Linked research

No linked research yet.
