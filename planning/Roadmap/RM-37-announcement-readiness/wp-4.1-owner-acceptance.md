---
type: "Work Package Spec"
title: "WP 4.1 — Owner acceptance: Sitting A + RM-26 WP 4.4 through the Docker image; park Sittings B/C/D and RM-14/17/22/23/25; freeze new phases until green"
description: "Phase 4 of item.md. Ledger: STATUS.md. Runs the browser-only owner sitting and the one real run through the built image as the announcement's acceptance set, records outcomes in the source ledgers, parks every other sitting and the five non-announcement items with a dated line, and writes the no-new-phase rule."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 4.1 — Owner acceptance: Sitting A + RM-26 WP 4.4 through the Docker image; park Sittings B/C/D and RM-14/17/22/23/25; freeze new phases until green

Phase 4 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

Owner walks and ledger bookkeeping only — no application code. Inputs: the consolidated checklist
`planning/Roadmap/RM-18-platform/owner-acceptance-consolidated.md` (Sitting A = sections A1–A10, 39
checks over RM-01, RM-27, RM-05, RM-24, RM-26 WP 5.4, RM-30, RM-32, RM-22, RM-20, RM-08's local half),
[`/Roadmap/RM-35-roadmap-cleanup-close-what/STATUS.md`](/Roadmap/RM-35-roadmap-cleanup-close-what/STATUS.md)
(Wave 2 WP 2.1–2.5, Wave 3 WP 3.1), [`/Roadmap/RM-26-testing/STATUS.md`](/Roadmap/RM-26-testing/STATUS.md)
(WP 4.4), [`/Roadmap/RM-18-platform/STATUS.md`](/Roadmap/RM-18-platform/STATUS.md) (the demo-data and
diagnostics owner line, delivered by wp-1.1/wp-1.4) and the RM-37 phase acceptance in `./STATUS.md`.
Prerequisites: wp-0.3 (the container trust boundary — without it every `/api` call through the published
port answers 401 and no sitting can start), wp-1.1 (demo data for a clean instance), wp-4.2's pre-flight
list. Out of scope: the 124 Hub-related checks (B9–B12, C3, C5) and Sittings B/C/D (RM-35 WP 2.2–2.4),
retirement mechanics beyond recording (RM-35 WP 2.5), and any new engineering found during the walk —
that becomes register rows, not work in this WP.

## Actions

1. **Write the "Announcement" milestone into RM-35** (`planning/Roadmap/RM-35-roadmap-cleanup-close-what/STATUS.md`,
   a new heading above Wave 2) listing exactly: Sitting A (WP 2.1) · RM-26 WP 4.4 (WP 3.1) · RM-18
   WP 1.1/1.2/1.3 as delivered by RM-37 wp-1.1/wp-1.4 · RM-36 Phase 2 (in flight) · RM-37 Phase 0 and
   Phase 1 acceptance · the wp-4.2 rehearsal. Each line names its ledger and box. Nothing else is in
   the milestone. **P0**
2. **Run Sitting A through the built image**: `docker compose up -d --build`, `http://localhost:8081/`
   (the checklist's "Which URL to use" table; 8080 is a different application on the owner's machine),
   demo data loaded (wp-1.1) unless a check names its own fixture, both themes and keyboard-only per
   surface as the checklist prescribes. Record each of the 39 checks as pass / fail / blocked with the
   date in the ledger its `Ledger:` line names; the ⛔ checks (RM-22/RM-23 Design and Trace tabs parked
   by O2b) are recorded as "blocked — parked", never skipped silently. **P0**
3. **RM-26 WP 4.4 — one real run through the image**: one provider key, the demo collection's two tests
   (wp-1.1) against a real environment, `Scan now` on the demo server first; record run id, cost,
   the Report tab's rating source and the issue created by the failing test in RM-26's ledger box. The
   same run is the closed-loop recording input for wp-4.2 action 5. **P0**
4. **RM-37's own acceptance walk**: walk the wp-4.2 pre-flight table top to bottom on the image with
   demo data; tick each Phase 0 and Phase 1 WP's acceptance box in `./STATUS.md` only where every
   criterion in that WP's spec holds on the running image; a criterion that fails becomes a row in
   `./review-register.md` with source id `OA-A<n>` and the WP it belongs to. **P0**
5. **Park explicitly, do not retire**: add one dated line "Post-announcement — parked on 2026-08-22 by
   RM-37 wp-4.1; do not dispatch until the Announcement milestone is green" to RM-35 Wave 2 (WP 2.2
   Sitting B, 2.3 Sitting C, 2.4 Sitting D) and to the STATUS ledgers of RM-17 (Phase 6), RM-22
   (remaining owner checks), RM-23, RM-25 (all phases); RM-14's line is written by wp-4.3. RM-36's open
   owner checks that overlap Sitting A surfaces are taken in the same sitting and recorded in RM-36. **P1**
6. **Freeze rule**: a decision-log entry in RM-35 and in `./STATUS.md`: "No new feature phase starts in
   any item while the Announcement milestone is open; within an item, owner acceptance of the previous
   phase is a precondition for dispatching the next phase." The rule is also added to the working-rules
   file a second maintainer reads (`CLAUDE.md` until wp-0.2's split lands). **P1**
7. **After the sitting**: items Sitting A cleared go through `/complete-roadmap` per RM-35 WP 2.5 (RM-01
   needs an Advisor documentation subject first, per RM-35's note); RM-35's milestone lines are ticked
   with evidence. **P2**

## Acceptance

- [ ] RM-35 carries the Announcement milestone with the seven lines of action 1 and nothing else.
- [ ] All 39 Sitting A checks carry a dated outcome in their source ledger; the count of pass / fail /
      blocked is written under the milestone; every fail has a register row.
- [ ] RM-26 WP 4.4 is ticked with a run id that exists in the image's database, and the Report tab of
      that run shows a rating source.
- [ ] Every Phase 0 and Phase 1 WP in `./STATUS.md` is either ticked on the image or has its failing
      criteria listed as `OA-A<n>` rows.
- [ ] The parking line is present in RM-35 Wave 2 (three WPs) and in the RM-17, RM-22, RM-23 and RM-25
      ledgers; no item was retired by this WP.
- [ ] The freeze rule appears in RM-35's decision log, `./STATUS.md` and the working-rules file.
- [ ] `pnpm okf:validate` passes after the ledger edits; no application file changed in this WP.

## Effort

**M** — one owner day for the sitting and the run, plus an agent pass for the ledger writes; the
bottleneck is owner time, not engineering.

## Sources

PO-32 · PO-36 · ENG-01 (the container walk is the first check; fix in wp-0.3) · RM-35 Wave 2 / Wave 3 ·
RM-18 owner-acceptance line · RM-26 WP 4.4.
