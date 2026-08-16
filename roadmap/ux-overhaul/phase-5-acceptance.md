# Phase 5 — Verification, regression sweep, owner acceptance (serial, last)

## WP 5.1 — Program-wide verification sweep (agent-run)
**Domain:** read-only + `.wp-evidence/5.1/` + test files only.
**Steps (the audit's acceptance tests, executed as a checklist against `ux/integration`):**
1. **Shell walk:** Dashboard → Runs → Servers → Skills → Settings — title does not move a pixel;
   breadcrumb never disappears (S16). Record a screenshot per stop, both themes.
2. **Tab walk:** server detail all 6 tabs, skill detail all 7, collection 3, console 3 — tab strip
   never moves; content offset constant; no tab re-titles itself (S21).
3. **Scroll walk:** Runs feed, server Scans tab, compatibility Tool×Model, skill Design — at any
   scroll depth: header + column labels + primary action visible (S22).
4. **Status sweep:** `Grep`-driven inventory that every status render goes through StatusBadge; no
   raw `stopped_guardrail`-style strings in JSX (S3).
5. **Form sweep:** environment editor, test editor, launcher, add-server — S14 grammar, S19
   bounds/dependencies verified by interaction.
6. **Responsive spot:** 1500 / 1200 / 1000 px on Dashboard, Runs, server detail, console,
   compare workspace — no horizontal clipping; sidebar behavior per S1 fix.
7. **Both themes** on every screenshot pair; heatmap + diff colors re-checked in dark.
8. **Cross-link walk:** the ten S20 rows re-tested (finding→tool stays; the nine formerly-missing
   links now work).
9. **Compare workspace walk:** the H5 lossless loop + H acceptance ("which setup wins, how much,
   can I trust it — first viewport, no scrolling").
**Output:** `roadmap/ux-overhaul/verification-report.md` — pass/fail per item with evidence paths;
failures become follow-up WPs the PM schedules before 5.2. Gate green on integration.

## WP 5.2 — Docs close-out + owner acceptance (PM + owner; the only WP allowed to edit CLAUDE.md)
**Steps:** CLAUDE.md capability row for the UX overhaul (✅ built, owner-acceptance state);
addendum note at the top of `UI-UX-AUDIT-2026-07-05.md` ("implemented by roadmap/ux-overhaul —
see STATUS.md"); finalize this ledger; hand the owner the acceptance checklist below.
**Owner-acceptance walk (unchecked until the OWNER does it live):**
- [ ] Two-theme visual walk of every migrated view
- [ ] Keyboard-only pass: nav, tables, dialogs, launcher, compare workspace
- [ ] The three shell acceptance walks from WP 5.1 items 1–3, live
- [ ] Compare workspace: real decision made on real runs using verdict + flow diff
- [ ] Sign-off recorded in STATUS.md decision log; owner merges `ux/integration → main`
