# Phase 2 — View migrations (fan-out; every WP depends on ALL of Phase 1)

Each WP migrates one feature area onto the Phase-1 foundations AND fixes that area's per-view
audit findings. One WP = one feature folder = one agent. **Shared pattern for every WP here
(the "migration checklist" — copy into each task prompt):**

> Adopt PageShell/PageHeader (1.2) · TabPanel/SplitPane rules where tabbed (1.3) · TableToolbar +
> DataTable defaults on every table (1.4) · StatusBadge everywhere (1.1) · modal tiers for the
> area's dialogs (1.5) · form primitives for the area's inputs (1.6) · scroll contract (S22) ·
> then the WP-specific fixes below · verify both themes + 1500/1100 widths.

**Waves:** D: 2.1 ∥ 2.2 ∥ 2.7 ∥ 2.9 → E: 2.3 ∥ 2.5 ∥ 2.8 ∥ 2.10 → F: 2.4 → 2.6 (serialized:
both touch `features/testing` shared files incl. the RunLauncher and runs feed surroundings).

---

## WP 2.1 — Dashboard (D1–D4, G1 quick wins)
**Domain:** `apps/web/src/features/dashboard/` (locate: `Grep "Latest server footprint"`).
**Fixes:** title "Dashboard" (not brand duplicate) via PageHeader; breadcrumb "Home"; split the
two double-metric KPI cards (D2); Operational-state 1-row table → attention list with actions
(F1); footprint table footnote for unscanned exclusions (D3); "Recent scan activity" badges only
on non-success (D4); row links → row-click + chevron (S7); per-server Δ-vs-previous-scan column in
the footprint table IF the data is already client-available from the scans list API — else mark
deferred-to-3.1 in report (no API work in this WP).
**Acceptance:** conventions §3 shell checks pass on Dashboard; no "Page 1 of 1"; both themes.

## WP 2.2 — MCP Servers area (SV1–SV9 remainder, F10)
**Domain:** `apps/web/src/features/servers/` (locate: `Grep "Tool inventory"`), plus the
add/edit-server wizard files.
**Fixes:** wizard → S14 validation grammar (inline field errors, focus-first-error, no silent
no-op; "Test & continue" label) on FormDialog/WideDialog tiers; Args/Env JSON → `ListEditor` +
`KeyValueEditor` (SV2, examples as placeholders); remove "Delete server" from the edit footer
(row-menu + ConfirmDialog only, SV3); tool-inventory SplitPane with priority columns + single-line
rows + visible divider (SV4); resource Read failure → terminal error state in the read modal with
"Re-authenticate" action, NEVER auto-open the edit wizard (SV5 — locate the auto-open trigger and
delete it); playground: Run bottom-right, no `null` under errors, header badge "last scan ·
success" tooltip (SV6); Tests tab count (SV7); Scans tab rows clickable → scan detail + delete
action w/ ConfirmDialog (SV8, DELETE /api/scans/:id exists); Tests-tab legend passive (SV9);
labeled "Scan now" primary in header, rest icons (S6); unexplained green dot column in tool rows:
header tooltip or removal (F10).
**Acceptance:** every SV item individually checked; shell checks pass on server detail incl. the
stable tab strip (1.3 reference already did the frame — this WP finishes the content).
**Size:** XL — PM may split into 2.2a (wizard+playground+modals) ∥ 2.2b (detail tabs) with
disjoint files if the agent reports the domain is too large. Wave-D slot budget allows it.

## WP 2.3 — Scans + scan detail + Compare-scans (SC1–SC3, C2–C5)
**Domain:** `apps/web/src/features/scans/` + `apps/web/src/features/compare/` (locate:
`Grep "Compare scans"`).
**Fixes:** Scans master-detail balance + dedupe "51 scans" (SC1); scan-detail full-word headers,
add Name/Annotations columns behind column picker, KPI padding, wheel-through scrolling (SC2);
breadcrumb w/ scan timestamp (SC3). Compare: empty/landing state instead of arbitrary cross-server
default + Baseline/Comparison labels when servers differ (C2); toolbar row per 1.4 + "eligible
scans" relocated (C3); diff colors green/red + magnitude red only on summary (C4/D-UX9); zero-diff
"changes only" default + explicit no-differences state (C5); "Latest" quick-picks + A↔B swap
button (F7).
**Acceptance:** each item checked; a same-server zero-diff compare shows the empty state, not 60
Unchanged rows; both themes.

## WP 2.4 — Runs feed (T1–T4, S2) — wave F, BEFORE 2.6
**Domain:** `apps/web/src/features/testing/runs/` + `RunsView` + `runs-api.ts` (verified names
from the testing-ia ledger).
**Fixes:** row-click → console everywhere; single runs get Open semantics, re-execution renamed
"Re-run…" into a row menu (T1); pin Name + Actions columns, drop/merge Grade-when-empty and Type
double-pills → one tag (T3, S9); suite expansion constrained to viewport + "Completed · 1 error"
rollup (T2); toolbar per 1.4 incl. group-by additions **by test / by environment** (G8 — feed
already has grouping infra); selection banner stays; **suites get checkboxes** (feeds 4.6);
sticky table header + totals strip (tokens/cost/failure-rate for current filter) (G8).
**Acceptance:** at 1500px NO horizontal scroll with Name+Actions visible; drill-in from any row
type in one click; both themes.

## WP 2.5 — Run console (T6b–T6f, F9)
**Domain:** `apps/web/src/features/testing/` console files: `ConversationPane.tsx`,
`ChatMarkdown.tsx`, `ToolCallCard.tsx`, the console view + KPI rail + Analytics (locate:
`Grep "Export session log"`).
**Fixes:** dedupe header Replay chip vs disabled button — one action; "Locked" info chip with
tooltip (T6b); metric triplication → header strip = caps only, rail = live metrics, Analytics =
distributions (S8); remove decorative sparklines on scalar cards; x-axis labels on the two
Analytics charts (T6c); `min-w-0` + `overflow-x-auto` so expanded tool-call JSON cannot widen the
layout (T6d — regression-test with the longest param blob in the seed data); **review mode** for
terminal runs: open at top, "jump to end" affordance (T6f — full review-mode cross-linking is WP
3.2, keep this to scroll behavior); rail stacks below content <1200px (S1 slice).
**Acceptance:** expanding every tool call on run `9JThXmPbkW2zh8JeINxGy` never moves the rail;
console opens at turn 1 for finished runs; both themes.

## WP 2.6 — Collections + test editor + launcher (T5, T7, T8) — wave F, AFTER 2.4
**Domain:** `apps/web/src/features/collections/` (CollectionDetail, CollectionTests, TestEditor —
verified names) + `RunLauncher` (verified name; lives in features/testing — the reason this WP
serializes after 2.4).
**Fixes:** collection breadcrumb shows the name; Git-tab vs header contradiction resolved per the
LOCKED product rule — Local cannot bind: disable the button + explain (if the owner instead wants
binding allowed, that's a D-UX flip the PM must confirm — ask, don't pick); "Added profiles"
tooltip; drop name+Local badge dupe (T7). TestEditor → WideDialog with sections Basics · Grading ·
Metadata · Attachments; token-profile chips get visible pressed state (bug vs env editor);
TagInput for tags; Segmented difficulty; structured gate-assertion rows w/ JSON escape hatch
(T8/F5). Launcher: icon-label spacing; visible list scrollbars + "N of M shown" + per-list search;
Cost cap → BoundedNumber; stale-banner cleared on mode switch; Run disabled-with-reason on empty
selection (T5/F4).
**Acceptance:** every T5/T7/T8 item; the launcher modal never cuts a row in half at 771px height;
both themes.

## WP 2.7 — Environments table + editor rework (T10, F3, S19) — THE form template
**Domain:** `apps/web/src/features/testing/EnvironmentsView.tsx` + `EnvironmentEditor.tsx`
(verified names).
**Fixes:** table: loading pills equal-weight, labeled actions column, no sort icon there (T10);
editor on WideDialog two-column (keep the right footprint rail — it's the house best-practice):
credential+model one row 60/40 with `useDependentField` (model disabled "Pick a credential
first…", strictly filtered); Temperature/TopP → SliderNumber (0–2/0–1, decimals=2); Max output
tokens → BoundedNumber default=model default; Reasoning effort → SegmentedField
(Default·Low·Medium·High), hidden/disabled for non-reasoning models; token profile chips + per-chip
tooltips (o200k/cl100k/estimate/rough one-liners); Tool loading → SegmentedField with swap-in
description AND disabled-Deferred for unsupported providers (enforce the caption's own rule);
guardrails → five BoundedNumbers w/ units + "No limit" placeholders; real section headings.
**Acceptance:** every F3 row's Verdict implemented; stepping/typing can no longer produce
"0.30000" or an unintended max-output=1; save round-trips an existing environment unchanged
(regression: open→save without edits produces no diff — add a test if the editor has tests).
**Size:** L–XL.

## WP 2.8 — Skills post-update fixes (K1–K11, D-UX1/D-UX2)
**Domain:** `apps/web/src/features/skills/` (+ its `design/`, `trace/` subfolders — verified).
**Fixes (owner-locked first):** "New skill from server" button removed → 4th source tile in the
Add-skill modal (K6/D-UX1); Trigger-collisions panel → skills-LIST footer status (expandable),
removed from detail pane (K7/D-UX2). Then: Overview SKILL.md real markdown hierarchy + frontmatter
only in side card (K1); header version+publish+download into PageHeader action slot (K2); Design
canvas fitView on mount, horizontal rank layout, legend+palette docked not floating (K3); Trace
value-aware chips + one-line all-unmatched verdict + docked legend (K4); registry list truncation
fix + one-line meta (K5); ONE IDE home — Design owns the editor, Files tab becomes file
management only (tree + read-only preview + upload), single dirty indicator (K8); Quality tab:
"Re-run checks" busy state + unscanned-server warning links to that server's scan action (K9);
"Save keywords" → "Save as new version" + ConfirmDialog explaining the version fork (K10); page
onto the scroll contract — IDE toolbar never scrolls away (K11).
**Acceptance:** every K item tagged in the audit as PERSISTS/NEW is closed or explicitly reported
blocked; the two owner-locked moves match D-UX1/D-UX2 exactly; both themes.
**Size:** XL — PM may split 2.8a (K6/K7/K1/K2/K5 structure) ∥ 2.8b (K3/K4/K8–K11 IDE+tabs)
if the agent requests it; domains split cleanly by subfolder.

## WP 2.9 — Compatibility (CP2–CP5)
**Domain:** `apps/web/src/features/compatibility/` (verified).
**Fixes:** sticky header row + sticky first column on both heatmap views (CP2 — coordinates with
1.4 helpers); "Models: Default set" → real picker or labeled chip-group (CP3); score-band legend
tooltips explaining model-relative thresholds (CP4); evidence-drawer header padding + severity
"Medium" chip through StatusBadge tones (CP5); "What to do" tool names link to the tool's
breakdown (S20 slice — route exists: server detail Tools tab with selection).
**Acceptance:** scrolling 60 tool rows keeps model headers + tool column visible; both themes.

## WP 2.10 — Settings + top-bar ThemeSwitcher (ST1–ST4, F0/F2)
**Domain:** `apps/web/src/features/settings/SettingsView.tsx` (verified), `apps/web/src/lib/theme.ts`
(verified), the top-bar component (locate: `Grep "Refresh" apps/web/src` for the global top bar).
**Fixes:** ThemeSwitcher (`@brand/ui` component — confirm it respects the 2-theme+System filter in
`lib/theme.ts`; keep blueprint filtered OUT) into the top-bar slot; demote/scope the global
Refresh (F0); Settings keeps a mirror segmented theme control, System first (ST2); "applies
immediately" microcopy vs explicit-save cards (ST1); default-judge Model input → same
credential-filtered combobox as environments (F2/S19); Storage/Maintenance card exposing the
existing `POST /api/maintenance/{checkpoint,vacuum,prune-scans}` + retention info (ST4 — API
exists, this is UI-only; confirm response shapes via the route source before wiring).
**Acceptance:** theme switchable from any page in 2 clicks; blueprint still unreachable; judge
model no longer free-text; maintenance actions behind ConfirmDialog with honest result toasts;
both themes.
