---
type: "Roadmap Item"
title: "Roadmap cleanup — close what is already started"
description: "Retire every roadmap item whose work is finished, and close out the items that are started but not complete, so the active roadmap shows only live work."
tags: ["roadmap", "RM-35"]
timestamp: "2026-08-21T14:53:04Z"
status: "active"
---

# Roadmap cleanup — close what is already started

## Goal

Retire every roadmap item whose work is finished, and close out the items that are started but not complete, so the active roadmap shows only live work.

## Why it matters

Twenty-eight items sit under Roadmap/ and only one has zero open boxes. Thirteen are code-complete and blocked solely on owner-acceptance walks spread across thirteen files; eight have real engineering left; three carry no ledger at all. Nothing distinguishes them, so finished work reads the same as unstarted work and the roadmap has stopped describing the project.

## Milestones

- [ ] Wave 0 — free retirements, ledger hygiene, CLAUDE.md correction, three parked decisions.
- [ ] Wave 1 — RM-18 WP 1.6: one consolidated owner-acceptance checklist across all ledgers.
- [ ] Wave 2 — the four owner-acceptance sittings (browser · provider key · subscription · CI).
- [ ] Wave 3 — the remaining engineering, in value order.
- [ ] Wave 4 — new work and the three ledger-less items.

## Linked research

No linked research yet.

## The review

Reviewed 2026-08-21 against every `planning/Roadmap/RM-*/STATUS.md` ledger on local `main`,
cross-checked against the code on disk, `git branch --no-merged main`, `pnpm okf:validate`
and `pnpm okf status`. Companion to the generated [`roadmap.md`](../roadmap.md), which lists
items but not their closure state.

---

## 1. The headline

| | Count |
| --- | --- |
| Items under `Roadmap/` | **28** (25 with a `STATUS.md` ledger, 3 without) |
| Items under `Roadmap/completed/` | 6 |
| Items with **zero** open boxes — retirable today | **1** (RM-11) |
| Items **code-complete**, blocked only by an owner walk | **13** (~90 open boxes) |
| Items with **real engineering** still open | **8** (~24 work packages) |
| Items **never started** (0 of N done) | **2** (RM-18, RM-25) |
| Items with **no ledger at all** | **3** (RM-12, RM-19, RM-31) |

**The single most important finding: the roadmap is not blocked on engineering. It is blocked
on owner acceptance.** Thirteen items — every work package built, gate green, merged to `main` —
cannot be retired because `/complete-roadmap` refuses while any box in the ledger is open, and
their only open boxes are owner-acceptance walks. That is roughly **90 checkboxes spread across
13 files**, with no single place to work through them.

Everything in §5 flows from that.

---

## 2. Retire now — zero open boxes

### RM-11 · Dashboard bento — the homepage Overview
12 of 12 work packages done (Phase 0, Phase 1 + close-out, Phase 2). **No owner-acceptance
section exists**, so nothing blocks retirement. It has been sitting `active` since 2026-08-20
purely because nobody ran the command.

```bash
/complete-roadmap RM-11 --docu DC-11
```

`DC-11-observability` is the right home — RM-17 already put the Dashboard's Scans/Testing/Issues
tabs there. Before running, confirm no existing `### RM-11` increment (there is none).

**Effort: 10 minutes. Importance: low on its own, high as proof the retirement path still works.**

---

## 3. Code-complete — blocked only on an owner walk

Every work package ticked, gate green, code on `main`. The only open boxes are owner-acceptance.
Sorted by how cheap the walk is, because that is what determines closure order.

### 3a. Browser only — no credentials needed (7 items, 31 boxes)

| Item | Open | The walk |
| --- | --- | --- |
| **RM-01** advisor | 1 | One real scenario shows a believable unused-tool trim; evidence links resolve |
| **RM-27** testing-ia | 1 | Nav 4 + Setup, 4 redirects, collection-as-home, launcher both paths, Runs feed drill |
| **RM-05** assistant-operability | 2 | `/assistant/agents` dock shows agent/crew chips; the gate bites on a bogus route |
| **RM-24** skills | 2 | Two-theme walk of the registry, add-skill wizard, allowed-skills editor |
| **RM-22** skill-ide | 7 | Nine phase walks — flow lanes, file CRUD, quality fix, tool refs, publish/pull, code round-trip |
| **RM-32** overview-detail | 8 | `/servers` grid ⇄ table, search, breadcrumb popover, keyboard, `/skills` + `/collections`, <768px |
| **RM-20** security-posture | 10 | False-positive rate on **your** servers and skills, the diff, one exported document, two decision sign-offs (D-SP9 decryption path, D-SP15 read boundary) |

RM-20 and RM-22 carry judgement calls, not just looking — RM-20 in particular asks you to rule on
the analyzer's false-positive rate against your own fleet and to sign off two read-boundary
decisions. Budget those separately from the pure look-at-it walks.

**Effort: one long sitting, maybe two. Importance: HIGH — retires 7 of 28 items in one pass.**

### 3b. Needs a provider API key (3 items, 15 boxes)

| Item | Open | Gate |
| --- | --- | --- |
| **RM-23** skillflow | 4 | Trace tab against a real run, visual edit → new version, gate verdicts round-trip |
| **RM-07** benchmarks | 5 | Live suite runs, LLM-judge grades, ± skill deltas (+ 2 owner-gated Phase 6 WPs, see §4) |
| **RM-10** crew-nesting | 9 | Live nested missions ≥2 levels, budget-exhaustion traces, cycle/depth rejection, transitive grants |
| **RM-06** auto-rating | 7 | CLI/provider judge fallback, error-forensics believability, suite consistency (+ 3 owner-gated Phase 5 WPs, see §4) |

**Effort: one key + one sitting. Importance: HIGH — these are the items whose *quality* is
genuinely unproven, not just unlooked-at.**

### 3c. Needs a live Claude subscription sign-in (3 items, 33 boxes)

| Item | Open | Gate |
| --- | --- | --- |
| **RM-09** claude-subscription | 4 | Live run + suite mass-run on the subscription, semaphore holds, not-signed-in path is honest |
| **RM-16** model-identity | 7 | Anthropic CLI → Sonnet with no metered call, `HubModelPicker` at nine call sites, subscription-pinned agent in a crew |
| **RM-02** assistant | 22 | Four refinement rounds (R1–R4) plus the base walk — sign-in, skill edit loop, scope chip, limit-error retry |

RM-02's 22 boxes are the largest single block in the roadmap. They are four separate refinement
rounds that each grew their own acceptance section rather than merging into one.

**Effort: subscription sign-in + two sittings. Importance: HIGH for RM-09/RM-16 (they gate honest
cost reporting), MEDIUM for RM-02's later rounds.**

### 3d. Needs a real CI pipeline (1 item, 13 boxes)

**RM-08** ci — 13 boxes, and the blocking one is structural: *"the example workflow, actually
executed"*. The two GitHub Actions gates in `examples/github-actions/` **have never run** — this
repository has no place to run them, and `main` is 17 commits ahead of `origin/main`, so even the
one live workflow (`mcp-self-scan.yml`) has not seen this code.

**This is the only owner-acceptance block with a real prerequisite you do not currently have.**
Options: push `main` and let `mcp-self-scan.yml` run; or copy the two example workflows into a
throwaway repo with a service token and execute them there.

**Effort: 1–2 hours including setup. Importance: HIGH — an unexecuted CI gate is an unproven
CI gate.**

---

## 4. Started but genuinely unfinished — real engineering left

Ordered by importance × effort to close.

### 4.1 · RM-30 UX Overhaul — Phase 7 Skill Studio · **6 WPs** · HIGH
`WP 7.1, 7.3, 7.4` (Skill Studio shell, settings panel + one draft store, editable multi-tab files)
then round 2's `WP 7.7, 7.8, 7.9` (components palette, edge grammar + entry-point flows,
Designer=visual vs Files=source). 61 of 70 boxes already done; this is the last phase, and it exists
because the owner used the shipped Skill IDE and found SI1–SI17 plus the D-UX19 model correction.

Dependency chain is written into the ledger: `7.1 ∥ 7.2 → 7.3 → (7.4 ∥ 7.6) → 7.5`. Round 2's
7.7–7.9 revise the same surface, so they must land **after** 7.1/7.3/7.4 or they will conflict.

**Close it with:** `/next-wp ux-overhaul` — three batches.
**Effort: HIGH (~3 batches).** **Importance: HIGHEST of the engineering work** — it is owner-directed
rework of a surface the owner has already rejected in its current form, and it blocks RM-30's
retirement, which in turn is the largest done-work item in the bundle (61 WPs).

### 4.2 · RM-14 Illustrations — Phases 2–4 · **10 WPs** · HIGH
Phase 0 and Phase 1 complete (24 components, the cast-module seam, the scaffold recipe). What is
missing is everything that makes the catalog *usable*: the scene spec's layout engine + connector
router + renderer (2.1–2.4), explain mode (3.1–3.3), persistence, and the assistant `illustrations_*`
compose tools (4.1–4.3).

**Note the shape of the risk:** 24 illustration components exist and nothing composes them. Phase 1
delivered breadth; Phase 2 is the load-bearing part. Stopping here leaves a gallery, not a system.

**Close it with:** `/next-wp illustrations` — Phase 2 is one dependency chain (2.1 → 2.2 → 2.3 → 2.4),
Phase 3 and Phase 4 parallelize after it.
**Effort: HIGHEST (~4–5 batches).** **Importance: HIGH but discretionary** — nothing else depends on it.

### 4.3 · RM-26 Testing — WP 4.4 end-to-end verification · **1 WP** · HIGH
A real run through the **built Docker image**. WP 4.1 is code-complete and only wants the owner
walk (folds into §3a/§3b). WP 4.4 is genuine work: stand the container up, drive a real run through
it, prove the whole path.

This is also the cheapest way to de-risk everything else — a Docker-image e2e exercises migrations,
the encrypted-secret path, static serving and the run engine in one shot.

**Effort: LOW (1 WP, needs a provider key).** **Importance: HIGH — highest value-per-hour on this list.**

### 4.4 · RM-34 Estimator turn model — WP 2.1 · **1 WP** · MEDIUM
`WP 2.1 — re-measure the band live against recorded runs`, marked *in progress (agent D)*. WPs 1.1–1.3
are done. The ledger's in-progress marker is stale — check whether an agent is still holding it before
re-dispatching.

Context: RM-33's owner-acceptance already recorded that the launcher's band **brackets** a real run
($0.42–$1.59 against $0.80 billed) but cannot land near it, because the estimator's 8-turn ceiling is
the dominant error where the run took 19 turns. WP 2.1 is the measurement that fixes exactly that.

**Effort: LOW (1 WP).** **Importance: MEDIUM-HIGH — it closes a known-wrong number the owner has seen.**

### 4.5 · RM-03 Assistant Hub — WP 2.3 · **1 WP (large)** · MEDIUM
`WP 2.3 — autonomy dial + hard budgets + steering + live HITL approval-gating + MCP elicitation`
(GAP-A/GAP-B folded in per owner 2026-07-18). One box, but it carries two BLOCKING MUSTs from the
original WP1.R findings: the elicitation transport (R-MCP4) and the approval/HITL path.

Also note four historical WP1.R finding boxes (BUG-4, GAP-E, LOW-a11y, GAP-A+GAP-B) sit **unticked
under a heading that says they were resolved above**. See §6 — ledger hygiene, not work.

**Effort: MEDIUM-HIGH (1 large WP).** **Importance: MEDIUM — but it is the last thing standing
between RM-03 (32 WPs done) and its 18-box owner walk.**

### 4.6 · RM-17 Observability — WP 3.5 · **1 WP, needs an owner decision first** · MEDIUM
`WP 3.5 — Agent-graph lens (aggregated/expanded)`, **proposed 2026-08-19** as part of the Langfuse
amendment (AM-OB1–14) which is **pending owner lock**. 28 of 29 boxes done.

**Do not dispatch this.** Decide the amendment first: either lock AM-OB1–14 and build 3.5, or reject
the amendment and drop the box — at which point RM-17 becomes retirable with zero owner-acceptance
boxes, since it has none.

**Effort: 5 minutes (a decision) or MEDIUM (a WP).** **Importance: HIGH as a decision — it is the
cheapest possible item-retirement in the whole roadmap if you reject it.**

### 4.7 · Owner-gated backlogs — decide keep or split · **5 WPs** · LOW
Two ledgers carry phases explicitly marked *"do not pick up without owner instruction"*:

- **RM-06** Phase 5 — Cross-links (3 WPs: skill findings → SkillFlow drafts, verdict as CI assertable, judge-settings live preview)
- **RM-07** Phase 6 — Judge calibration & trust (2 WPs: grade feedback + calibration set, agreement analytics + re-grade guard)

They block retirement of two otherwise-complete HIGH-priority items. **Decide one of two things
per phase:** build it, or move it out to a new RM item so the parent can retire. Leaving them
parked is the status quo that produced this cleanup.

**Effort: 10 minutes (a decision).** **Importance: MEDIUM — unblocks 2 items.**

---

## 5. The single highest-leverage action

### RM-18 WP 1.6 — owner-acceptance consolidation

`RM-18-platform` WP 1.6 is already written as *"one runnable checklist across all ledgers"*. It is
the direct fix for §3: **~90 owner-acceptance boxes scattered across 13 ledger files, with no
single place to work them.**

The pattern already exists and has been proven twice — `RM-13-hub-fixes/owner-acceptance-walk.md`
(assembled by its WP 7.R) and `completed/RM-04-assistant-hub-ux/owner-acceptance-walk.md`. Both
consolidate raw items into one honest checklist with exact click-paths and expected outcomes.

**Do this before any owner walk.** Building it costs one agent batch; running it saves the owner
from opening 13 files and deciding, per box, what "accepted" even means.

It should group by prerequisite — matching §3a/3b/3c/3d — so each sitting has exactly one entry
condition (browser · provider key · subscription · CI).

```bash
/next-wp platform    # will select WP 1.6 among the six open
```

**Effort: 1 batch.** **Importance: HIGHEST in the document.**

---

## 6. Ledger hygiene — boxes that are not work

These block `/complete-roadmap` while representing nothing to build. Fix them as edits, not as work
packages.

| Item | Boxes | What they actually are |
| --- | --- | --- |
| **RM-13** hub-fixes | 2 | *"Gates — check before any implementation batch"* — per-batch process checks (clean tree, no concurrent hub edits). All 21 WPs are done. These should be prose, not checkboxes. **RM-13 is otherwise retirable.** |
| **RM-03** assistant-hub | 4 | *"Original WP1.R findings (historical — resolved above)"* — BUG-4, GAP-E, LOW-a11y, GAP-A+GAP-B, retained for provenance under a heading that says they are resolved. Tick them with a pointer to where each was resolved, or move the block to prose. |

**After fixing RM-13's two gate boxes, RM-13 retires immediately** (`--docu DC-13`). That is a second
free retirement alongside RM-11.

---

## 7. Never started

| Item | State | Note |
| --- | --- | --- |
| **RM-18** platform | 0 of 6 | WP 1.6 is §5 — do that one now. WP 1.1 (demo seed) blocked on Benchmarks P1 (done — recheck the flag), 1.5 on Benchmarks P3 (done — recheck). The blocked flags are stale, exactly as RM-01's WP 2.1 flag was found to be stale on 2026-08-18. |
| **RM-25** team-server | 0 of 6 | MEDIUM, gated on `RM-08` Phase 1 — **which is done**. The gate has been met; the item is simply unstarted. Note it revises the "single-owner local" scope in CLAUDE.md §1, so starting it is a product decision, not just scheduling. |

Neither is "started but not completed", so neither belongs in the closure plan. Listed so the review
is complete.

---

## 8. No ledger at all

| Item | Status | Reality |
| --- | --- | --- |
| **RM-19** release | `planned` | **The code shipped.** `scripts/release.sh` + `scripts/release/{README.md,run.sh,run.ps1}` exist and build the offline bundle the item describes. The item is a retro stub with three unticked milestones and no `STATUS.md`. `DC-22-packaging-and-deployment` exists but does not mention the bundle. → retire with `/complete-roadmap RM-19 --docu DC-22 --no-ledger`, after writing the bundle into DC-22. |
| **RM-12** findings | `archived` | The 2026-06 UI audit programme. Remediation was executed; the folder is a historical record. → retire with `--no-ledger`, or leave archived if you prefer the provenance in place. |
| **RM-31** mvp-footprint-analyzer | `archived` | The original MVP + expanded-target brief. Superseded by CLAUDE.md §1's north star. Same choice as RM-12. |

Retiring the three shrinks the active list from 28 to 25 and removes the two items that are
`archived` but still filed as live work.

---

## 9. Two correctness defects found during this review

### 9.1 · CLAUDE.md's capability table is stale for RM-20
It says security posture is *"🚧 Partially built… Still open: WP 1.3 (skill analyzer), WP 1.4
(posture diff) and Phase 2 (Security tabs/badges/diff UI, report-export integration) — deliberately
not built."*

All six work packages are ticked done, and the code is on `main`:
`apps/api/src/security/skill-analyzer.ts`, `apps/web/src/features/security/SecurityDiffPanel.tsx`,
`SecurityPanel.tsx`, `PostureScore.tsx`, `ServersOverviewPosture.test.tsx`.

`README.md` §11 and `CHANGELOG.md` are **already correct** (README describes eighteen rules, the
diff and the report integration). Only CLAUDE.md was left behind — the exact failure mode the
"front page follows the work" hard rule exists to prevent.

### 9.2 · Seven shipped workstreams have no row in CLAUDE.md at all
`RM-09` (claude subscription), `RM-11` (dashboard bento), `RM-13` (hub fixes), `RM-16` (model
identity), `RM-19` (release), `RM-32` (overview → detail), `RM-34` (estimator turn model) appear
nowhere in the capability table or the STATUS-ledger list at the top of CLAUDE.md — including
RM-32, whose eight owner-acceptance boxes explicitly say they are *"what blocks retirement"*.

Anyone reading CLAUDE.md to find in-flight work will miss all seven.

---

## 10. The ordered action plan

### Wave 0 — free, today (~1 hour, no engineering)
1. **Push `main`.** It is **17 commits ahead of `origin/main`**. Every workstream marked "on local
   `main`, not pushed" is one disk failure from gone, and `mcp-self-scan.yml` has never seen this code.
2. `/complete-roadmap RM-11 --docu DC-11` — the one item with zero open boxes.
3. Fix RM-13's two "Gates" boxes (§6), then `/complete-roadmap RM-13 --docu DC-13`.
4. Fix RM-03's four historical finding boxes (§6) — bookkeeping only, does not retire RM-03.
5. Add the seven missing rows to CLAUDE.md and correct the RM-20 row (§9).
6. Decide RM-17's Langfuse amendment (§4.6). If rejected, RM-17 retires with zero further work.
7. Decide RM-06 Phase 5 and RM-07 Phase 6: build, or split to a new RM item (§4.7).

### Wave 1 — the leverage batch (1 agent batch)
8. `/next-wp platform` → **WP 1.6**, the consolidated owner-acceptance checklist, grouped by
   prerequisite (browser · provider key · subscription · CI). Everything in Wave 2 runs off it.

### Wave 2 — the owner's walks (the actual bottleneck)
9. **Sitting A — browser only:** RM-01, RM-05, RM-24, RM-27, RM-32, RM-22, RM-20 → **retires 7 items.**
10. **Sitting B — one provider key:** RM-23, RM-07, RM-10, RM-06 (+ RM-26 WP 4.1) → **retires up to 4.**
11. **Sitting C — subscription sign-in:** RM-09, RM-16, RM-02 → **retires 3.**
12. **Sitting D — a real pipeline:** RM-08's example workflows executed somewhere real → **retires 1.**

Waves 0–2 take the active roadmap from **28 items to roughly 12**, with no feature work at all.

### Wave 3 — the engineering, in this order
13. **RM-26 WP 4.4** — Docker-image e2e. 1 WP, highest value per hour, de-risks everything.
14. **RM-34 WP 2.1** — re-measure the estimator band. 1 WP, fixes a number the owner has already seen be wrong.
15. **RM-30 Phase 7** — Skill Studio, 6 WPs in three batches. The owner has already rejected the current surface; this is the rework.
16. **RM-03 WP 2.3** — HITL approval-gating + MCP elicitation. Unblocks RM-03's 18-box walk.
17. **RM-14 Phases 2–4** — 10 WPs. Largest remaining build. Do it when the above are closed, or accept that 24 components sit unusable.

### Wave 4 — new work, owner's call
18. **RM-18** remaining 5 WPs (first-run seed, docs route, diagnostics bundle, upgrade harness, perf pass).
    Recheck the stale "blocked on Benchmarks" flags first.
19. **RM-25** team-server — 6 WPs. Its gate (`RM-08` Phase 1) is met. Starting it is a product decision.
20. **RM-19 / RM-12 / RM-31** — retire the three ledger-less items (§8).

---

## 11. What this plan does not claim

- **Nothing here was verified against the running app.** Every state above comes from the ledgers,
  the code on disk and git. The owner-acceptance boxes are open *because* nobody has looked; this
  document does not change that.
- **The quality gate was not run** for this review (`pnpm typecheck && pnpm test && pnpm build &&
  pnpm lint`). `pnpm okf:validate` was run and reports `PASS` on both conformance layers.
- **Effort labels are relative, not estimates in hours.** They rank the work against itself.
- **The `/complete-roadmap` refusal rule is assumed, not tested** — it refuses while any ledger box
  is open. If a box turns out to be waivable (`--no-ledger`, `--no-task-board`), several items in
  §3 could retire sooner than this plan assumes. Do not reach for the waiver to skip a walk the
  owner has not done.
