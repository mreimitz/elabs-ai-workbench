---
type: "Work Package Spec"
title: "Phase 3 \u2014 Workflow & cross-links (S20 + G-walkthrough fixes)"
description: "Turns destination-screens into journeys. Mostly web; two WPs add ADDITIVE API fields (contract"
tags: ["roadmap", "RM-30"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 3 — Workflow & cross-links (S20 + G-walkthrough fixes)

Turns destination-screens into journeys. Mostly web; two WPs add ADDITIVE API fields (contract-
first: `packages/shared` types+zod → api → web; never breaking). Depends on Phase 2 (the views
being linked must already be migrated).

**Batching:** 3.1 ∥ 3.2 ∥ 3.5, then 3.3 ∥ 3.4.

---

## WP 3.1 — Scan history tells its story: Δ-vs-previous + diff-vs-previous (G3, S20)
**Domain:** `apps/web/src/features/scans/` + `features/dashboard/` (Δ column slot from 2.1) +
IF an API field is needed: `packages/shared/src/{types,schemas}.ts` + `apps/api/src/scans/`
(additive only).
**Steps:** (1) Determine cheapest correct source for "previous successful scan of same server":
if the scan-list payload already carries enough (server id + totals, ordered), compute client-side;
else add additive `deltaTokens`/`prevScanId` to the scan-list response (contract-first, tests).
(2) Scans list: Δ column (signed, red=growth per D-UX9 magnitude rule, tabular-nums). (3) Row
action "Diff vs previous" → `/compare/scans` pre-filled via URL params (extend the compare view to
accept `?serverA/scanA/scanB` — coordinate: that view is 2.3's domain, so this WP may touch it;
PM schedules 3.1 after 2.3 — it does). (4) Server detail Scans tab gets the same Δ + action.
(5) Dashboard footprint Δ column wired if 2.1 left it deferred.
**Acceptance:** from any scan row, one click answers "what changed vs previous?" with a pre-filled
diff; Δ math spot-checked against two known scans (acme-demo 22,436 → 45,264). Gate green.

## WP 3.2 — Console review mode & cross-representation links (G9, S20)
**Domain:** `apps/web/src/features/testing/` console files (post-2.5).
**Steps:** terminal runs open in review mode (2.5 did scroll; this adds): turn index in the rail
(clickable list of turns w/ per-turn tokens); context-window chart bars clickable → scroll chat to
that turn; Analytics→Errors cards clickable → jump to the failing step in Chat AND Trace; Trace
rows ↔ Chat blocks share anchor ids. Grade "—" in any console/feed surface gets tooltip + link to
Settings judge card (G12 slice).
**Acceptance:** on run `9JThXmPbkW2zh8JeINxGy`: click error card → lands on the failed
acme_create_data_object call in chat; click Turn-3 bar → turn 3; every "—" grade explains itself.
Gate green.

## WP 3.3 — Skills connected to their life (G11 remainder) — after 3.2
**Domain:** `apps/web/src/features/skills/` + IF needed additive API: `apps/api/src/skills/`
usage endpoint (`GET /api/skills/:id/usage` → environments + latest runs referencing the skill;
data exists in `scenario_skills` — contract-first).
**Steps:** Usage panel on skill Overview ("Used by N environments · last run …" with links);
"Test this skill…" action → run launcher pre-seeded with an environment that has the skill
attached (launcher accepts preset via props/URL — launcher is 2.6's artifact, coordinate);
Trace tab empty/all-unmatched state teaches the attach→run→trace chain with links.
**Acceptance:** from a skill page: one click to see where it's used; one click to launch a test
with it; the unmatched state explains itself. Gate green.

## WP 3.4 — Dashboard becomes operational (G1 full) — after 3.1
**Domain:** `apps/web/src/features/dashboard/`.
**Steps:** lead sections re-ordered around change & attention: "Since your last visit" deltas
(reuse 3.1 data), attention queue (unscanned · failed last scan · unreachable-if-known) with
inline actions, biggest movers list; keep inventory KPIs below. localStorage last-visit timestamp
is acceptable state.
**Acceptance:** dashboard answers "what changed / what needs me" above the fold at 1500px; still
honest when nothing changed ("No changes since Jul 4"). Gate green.

## WP 3.5 — Launcher cost preview (G7)
**Domain:** `apps/web/src/features/testing/` RunLauncher (post-2.6) + `packages/shared` +
`apps/api/src/` ONLY if an estimate endpoint is required — first try client-side: environments
carry footprint totals and models have pricing? Pricing lives server-side
(`apps/api/src/providers/pricing.ts`) — so add additive `GET /api/estimate/run-plan` or embed
price-per-token in an existing environments/models response (PM + owner pick at kickoff of this
WP; log as D-UX decision).
**Steps:** summary bar gains "≈ tokens & cost range" per selection (tests × envs × reps ×
env-footprint × pricing; wide error bars are fine — label as estimate); warn rows for
environments with no cost cap; block nothing.
**Acceptance:** selecting 2 tests × 2 envs × 2 reps shows a non-zero estimate for priced models
and "unpriced model" for ollama envs; numbers explained in a tooltip. Gate green.
