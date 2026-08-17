# Phase 4 — Compare Workspace (audit §H, G13, T9) — pipeline

Rebuilds `/testing/runs/compare` as the workspace specified in audit §H. Read §H IN FULL before
any WP here; §H1–H9 are the spec, this file is the cut into WPs. Depends on Phase 2 wave F
(2.4 runs feed for entry points, 2.5 console for the drawer reuse).

**Batching:** 4.1 → (4.2 ∥ 4.3) → 4.4 → (4.5 ∥ 4.6). 4.2/4.3 parallel ONLY if 4.1 lands the
mode-switch file split cleanly (separate files per mode — it must; see 4.1 acceptance).

**Shared domain note:** all Phase-4 WPs live in a NEW folder
`apps/web/src/features/testing/compare/` (created by 4.1, one file per zone/mode) so parallel WPs
here never collide; the old compare view files are deleted by 4.1.

---

## WP 4.1 — Workspace shell: compare bar, chips, URL state, verdict band, entry points (H2, H3, T9b, T9d, T9g)
**Steps:** new `compare/` folder: `CompareWorkspace.tsx` (frame: sticky compare bar + verdict band
+ mode-switched content region, S22-compliant), `CompareBar.tsx` (test picker · letter-badged run
chips Ⓐ/Ⓑ/Ⓒ with ×-remove · "+ Add run" filterable popover (same-test default, mixed-test warning)
· baseline pin · mode segmented Summary|Flow|Metrics · Export placeholder), `useCompareState.ts`
(URL: `?ids&baseline&mode&focus` — full state round-trip), `VerdictBand.tsx` (comparability
caveats: status mismatch, turn-count mismatch, ungraded — sentence slots wired in 4.2/4.5; ships
with caveats only). Entry points: "Compare" TAB on the Runs page (per IA plan/D-UX3) + existing
selection banner routes here; suite checkboxes (from 2.4) route to 4.6's mode (disabled w/ "suite
compare coming" until 4.6 — feature-flag by mode). Delete the old selector-list page.
**Acceptance:** letter badges are the only run identity everywhere in the workspace; removing/
adding runs updates URL and never scrolls the page; reload restores the exact workspace; Runs page
shows the Compare tab; radar and old cards are GONE (T9a permanently resolved by deletion);
one file per zone so 4.2/4.3 have disjoint files. Gate green. **Size:** L.

## WP 4.2 — Summary mode: verdict sentences + baseline-Δ matrix + honest charts (G13.2–4, T9e–h, H3)
**Domain:** `compare/SummaryMode.tsx`, `compare/matrix/*` (new), `VerdictBand.tsx` sentence slots.
**Steps:** environment matrix upgraded: value + Δ%-vs-baseline per metric (green better/red worse,
neutral ties — NO ✓ on ties), absolute↔per-turn toggle, warning icons on non-comparable rows,
"Peak context %" actually % of model window (fall back to absolute w/ honest header when window
unknown), Quality column wired to grades else "— · enable grading" link; verdict sentences per
H3 (token-slice decomposition using the console's context-composition data source); charts:
ONE grouped horizontal delta-bar panel (value labels, shared baseline line) + context-window
curves only when >2 turns with real axes + model-limit line; zero-information metrics collapse to
text lines.
**Acceptance:** T9e/T9f/T9g/T9h all closed; comparing the two aborted REVV runs leads with the ⚠
non-comparability verdict; comparing two completed runs of one test yields a recommendation
sentence. Gate green. **Size:** L–XL.

## WP 4.3 — Flow mode: trace diff + lenses (H4)
**Domain:** `compare/FlowMode.tsx`, `compare/flow/*` (new: lanes, alignment, lenses).
**Steps:** per H4: lanes per run (2–3), synchronized scroll, turn-boundary anchors + LCS step
alignment (tool name + normalized args), gap rendering with add/remove gutter tints, changed-
outcome amber tint w/ side-by-side result popover, divergence marker, event blocks (preamble w/
skills loaded+cost, reasoning collapsed, tool calls, skill activations from conformance events,
guardrail hits, errors, final answer), lenses: Tools ribbon · Skills · Cost heat. Data source:
run steps/trace via existing run detail APIs (`/api/runs/:id/turns` — verify shape first, read
`apps/api/src/testing/routes.ts`).
**Acceptance:** two runs of the same test render aligned lanes; the REVV pair shows divergence at
turn 1/2 with the failed create_data_object flagged; Tools lens reduces each run to one legible
ribbon; scroll stays synchronized. Gate green. **Size:** XL (the program's hardest WP — PM
staffs it solo, no parallel sibling in its batch half).

## WP 4.4 — Step drawer + lossless drill loop (H5)
**Domain:** `compare/` + a small console touch: "← Back to comparison" pill (coordinates with 2.5
files — schedule solo).
**Steps:** click any step/matrix row → right drawer reusing the console inspector content (params,
result, raw events, timings); URL `&focus=`; "Open in console ↗" preserves the compare URL and
the console shows the return pill; browser Back restores mode+scroll+focus.
**Acceptance:** the H5 rule holds: no drill-down loses the comparison — verified by a scripted
walk (verdict→flow→drawer→console→back) landing exactly where it started. Gate green.

## WP 4.5 — Change markers + next-steps cards (H6, H7)
**Domain:** `compare/` + additive API if needed: run→scan-at-runtime/skill-version linkage (check
what runs already store — read `apps/api/src/db/schema.ts` runs/scenario tables FIRST; if the
linkage exists, this is web-only; else additive fields via contract-first, PM logs decision).
**Steps:** compare bar change markers ("server scan differs → open scan diff" linking to
`/compare/scans` pre-filled; "skill v1→v2 → open skill diff"; model/loading differences);
next-steps action cards per H7 rules (deferred-loading win → env editor; failing tool → playground
prefilled; unused skill → SkillFlow trace; export baseline report MD/JSON via existing report
endpoints if they cover runs — `GET /api/reports/run/:id/*` exists; a comparison export may be
client-side composition).
**Acceptance:** comparing runs that span the acme-stage Jul-4 scan boundary surfaces the server-
change marker linking a pre-filled scan diff; at least 3 next-step rules fire correctly on seed
data; every card's action lands pre-focused. Gate green.

## WP 4.6 — Suite compare (G13.6, T9c)
**Domain:** `compare/SuiteCompareMode.tsx` (new) + suite selection enablement (2.4 laid the
checkboxes).
**Steps:** suite-vs-suite: verdict strip (pass rate, mean grade, exec cost deltas), test ×
environment grid of grade/cost deltas (green/red cells, StatusBadge tones), cell click → member-
run compare (the same workspace with those runs), same export. Data: suite-run member stats exist
on the expanded suite rows' API — verify via `apps/api/src/suites/` routes before building.
**Acceptance:** selecting the two "Default Banking" suite runs produces the matrix with the
errored member visible as a red cell that drills into the member comparison. Gate green.
