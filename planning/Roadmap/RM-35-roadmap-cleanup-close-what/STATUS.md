---
type: "Status Ledger"
title: "Roadmap cleanup — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the roadmap-cleanup plan, read and updated by /next-wp roadmap-cleanup. A box is ticked only when its acceptance is met."
tags: ["roadmap", "RM-35"]
timestamp: "2026-08-22T10:40:00Z"
status: "active"
---
# Roadmap cleanup — work-package status ledger · **PRIORITY: HIGH**

Living state for the **roadmap-cleanup** plan. A box is ticked **only** when its acceptance is
met and — where the box touches code — the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · <evidence>`.

> Plan + the full review in [`item.md`](./item.md). Most boxes here are **not** engineering —
> they are retirements, decisions and ledger edits. Boxes marked **OWNER** cannot be done by an
> agent at all; they are walks of the running app.
>
> **Ordering rule:** Wave 1 (WP 1.1) should land before any Wave 2 sitting, because it is what
> turns the scattered acceptance boxes into one runnable checklist. **It has landed** —
> [`RM-18/owner-acceptance-consolidated.md`](../RM-18-platform/owner-acceptance-consolidated.md).
> The real count is **192 boxes across 23 files, not the ~90 estimated here**; Wave 2's four sittings
> are now A/B/C/D in that file.

## Wave 0 — free retirements and hygiene (no engineering)
- [x] WP 0.1 — push `main` to `origin/main` — **done 2026-08-21 · no push was needed: the premise was
      already stale.** `git ls-remote origin main` and `git rev-parse main` both return `9f64e93`, and
      `git rev-list --left-right --count origin/main...main` reports `0 0`. `main` is fully pushed, so
      every "on local main, not pushed to origin" note in the other ledgers — and the review's
      "17 commits ahead" figure — is out of date. **Consequence for WP 2.4:** the CI prerequisite is
      no longer "push `main`"; `mcp-self-scan.yml` has had this code since the push. Whether it has
      actually *run* green is a separate, still-open question.
- [x] WP 0.2 — retire RM-11 — **done 2026-08-21 · `RM-11` → `Roadmap/completed/RM-11-dashboard-bento`,
      increment recorded in `DC-11`, 2 milestones ticked, 1 bundle link re-pointed.** Verified first
      that no OTHER file in the item carried a gating box (the per-WP spec checklists are acceptance
      criteria for already-ticked WPs; `STATUS.md`'s only `[ ]` hit was the legend line). The two
      stale references the tool reported in `CLAUDE.md` were applied and
      `check-references --tag RM-11` is clean. `pnpm okf:validate` PASS.
- [x] WP 0.3 — RM-13 ledger hygiene + retirement — **done 2026-08-21.** The two "Gates" boxes were
      rewritten as prose (they were entry conditions re-checked before each batch, and all 21 WPs are
      done, so there is no further batch to gate). `RM-13` → `Roadmap/completed/RM-13-hub-fixes`,
      increment recorded in `DC-13`, 4 milestones ticked.
      **⚠️ Correction to this plan's §6, recorded rather than hidden.** §6 called RM-13 "otherwise
      retirable" after counting only `STATUS.md`. It missed
      [`owner-acceptance-walk.md`](../completed/RM-13-hub-fixes/owner-acceptance-walk.md) — **28
      unticked live-verification boxes**, assembled by WP 7.R, whose own header reads *"Nothing below
      is verified."* Those cover the live scoped-session vendor tool call, a live mission agent MCP
      call, the real failing-MCP path, a real mission with a real provider key proving cost + budget
      enforcement, `web.search` behind a real key, and the both-theme + keyboard walk.
      `/complete-roadmap` reads only the ledger, so it did not refuse. The item was retired on this
      plan's written instruction **with the entire unrun walk written verbatim into the `--gap` field
      of the DC-13 increment**, and the walk file travels with the item. RM-13 is filed as delivered;
      it is **not** filed as verified.
- [x] WP 0.4 — RM-03 ledger hygiene — **done 2026-08-21 · RM-03 open boxes 23 → 19.** All four were
      resolved with evidence, and each now carries its pointer: **BUG-4**, **GAP-E** and
      **LOW-a11y + LOW-cite** were merged 2026-07-18 at `45924bc` (branches `1.fix-api` / `1.fix-web`)
      with WP1.R's `INV2` and `INV4` repros un-skipped and passing; **GAP-A + GAP-B** were folded into
      WP 2.3 by owner decision (option a) the same day and delivered at `bb89591`. The section heading
      now reads "ALL RESOLVED; retained for provenance" and says why it was ticked.
      **⚠️ Correction to this plan's §4.5 / WP 3.4, found while doing this.** §4.5 lists RM-03 WP 2.3
      as "real engineering left". Its ledger line says otherwise: *"✅ DONE 2026-07-18 ·
      wp/assistant-hub/2.3 (integrated @ bb89591) — 4 additive `HubEvent`s, turn-engine HITL seam,
      decision/elicitation/autonomy/steer routes, live `ApprovalCard`/`ElicitationPanel` +
      `AutonomyDial` … GAP-A/GAP-B CLOSED"*, with only a live MCP `elicitation/create` round-trip left
      as owner-acceptance. **The box is `[ ]` and its own text says both "status: open" and "DONE" —
      it contradicts itself.** Left untouched deliberately: ticking it is outside WP 0.4's scope and
      is the owner's call. **WP 3.4 should be re-scoped or dropped before it is dispatched.**
- [x] WP 0.5 — correct CLAUDE.md's RM-20 row — **done 2026-08-21.** Confirmed against the ledger
      (6 ticked WPs, 10 open boxes all owner-acceptance) and the code on disk
      (`apps/api/src/security/skill-analyzer.ts`, `apps/web/src/features/security/{SecurityPanel,
      SecurityDiffPanel,PostureScore}.tsx`). The row's status marker changed from
      "🚧 Partially built" to "✅ Built — all 6 WPs (Phases 1–2) done 2026-08-20, owner-acceptance
      pending", and the "deliberately not built" sentence was replaced with what WP 1.3 (seven
      `skill-surface.*` rules, D-SP12–16), WP 1.4 (`diffSecurityReports` as the one differ,
      D-SP17–20) and Phase 2 (WP 2.1 Security tabs/badges/diff UI D-SP21–23, WP 2.2 report-export
      section D-SP24–26) actually shipped — including that all six are computed on read and persisted
      nowhere, and the 10 owner-acceptance boxes, naming the recorded finding that the bench's own MCP
      mount scores **49 / high risk** on 51 `info` findings.
- [x] WP 0.6 — add the seven missing CLAUDE.md rows — **done 2026-08-21.** Confirmed all seven had a
      `grep -c` of **0** in `CLAUDE.md` before the edit. Added a capability-table row each for
      **RM-09** (claude subscription as a run model, 13 WPs, 4 owner boxes), **RM-11** (dashboard
      bento, 12/12 — now marked retired), **RM-13** (hub defect fixes, 21 WPs — now marked retired
      with its unrun walk called out), **RM-16** (model identity, 16 WPs, 7 owner boxes, incl. that
      WP 5.R's refute-review found 2 of 6 acceptance criteria did not hold and Phase 6 remediated all
      12 findings), **RM-19** (release — code shipped, item is a ledger-less stub, DC-22 silent on the
      bundle), **RM-32** (overview → detail, 6 WPs, 8 owner boxes that explicitly block retirement)
      and **RM-34** (estimator turn model — honestly marked 🚧 3 of 4, Phase 3 open). Each row carries
      its ledger link and its real open-box state. The STATUS-ledger list at the top of `CLAUDE.md`
      also gained RM-09, RM-11, RM-13, RM-16, RM-32, RM-34 **and RM-35 itself** (RM-19 has no ledger
      to link). Every claim was taken from the ledgers and the code on disk, not from the WP text.

## Wave 0b — three parked decisions (owner, minutes each)

> **BLOCKED on the owner — skipped by the 2026-08-21 batch, not attempted.** All three are
> judgement calls an agent cannot make: each decides whether unbuilt work gets built, split out,
> or dropped. D-1 in particular is the cheapest retirement on the roadmap — rejecting the Langfuse
> amendment leaves RM-17 at 29/29 with **no owner-acceptance section**, i.e. retirable outright.
> Note that WP 0.1 changed nothing here.
- [x] **OWNER** D-1 — RM-17's Langfuse amendment — **LOCKED 2026-08-21 · D-OB29**. Owner chose
      lock over reject, with the trade stated: rejecting would have retired RM-17 outright
      (28/29 done, no checkbox owner-acceptance section); locking re-opens it with **14 boxes**.
      Recorded in [`../RM-17-observability/STATUS.md`](../RM-17-observability/STATUS.md) — the
      amendment's fourteen items are held as **Phase 6 work packages, not renumbered into
      D-OB29+ decisions** (a `D-OB` number is a constraint to keep honouring; these are things to
      build, each individually droppable), and **AM-OB9 was promoted into Phase 3 as WP 3.5**,
      ready to dispatch with both dependencies built. RM-17's completion banner was corrected so
      it no longer reads as the whole workstream. **Consequence for this plan: RM-17 moves out of
      Wave 0b and into Wave 3 — see WP 3.6.**
- [x] **OWNER** D-2 — **DECIDED 2026-08-21: BUILD.** RM-06 Phase 5 (3 WPs, cross-links) stays
      inside RM-06 rather than splitting to a new item, so **RM-06 does not retire on its owner walk
      alone** — it now waits on three work packages as well. Phase 5's "do not pick up without owner
      instruction" gate is **satisfied, not removed**, and its heading records that. Original text:
      build, or split to a new RM item so RM-06 can retire on its owner walk alone.
- [x] **OWNER** D-3 — **DECIDED 2026-08-21: BUILD.** RM-07 Phase 6 (2 WPs, judge calibration) stays
      inside RM-07 on the same terms, so **RM-07 does not retire on its owner walk alone** either.
      Specs for both WPs already existed
      ([`phase-6-judge-calibration.md`](../RM-07-benchmarks/phase-6-judge-calibration.md)); WP 6.2
      depends on 6.1, so they are sequential, not parallel. Original text: build, or split to a new
      RM item so RM-07 can retire on its owner walk alone.
      **Consequence of D-1 + D-2 + D-3 together, stated plainly: all three parked decisions went the
      EXPENSIVE way.** §5 of this plan valued them as the cheapest closures available — rejecting
      D-1 alone would have retired RM-17 outright. Instead the roadmap gained **14 boxes (RM-17) + 3
      WPs (RM-06) + 2 WPs (RM-07) = 19 new units of work**, and three items that were one walk from
      closing are now blocked on engineering. That is a legitimate product call — the work was judged
      worth doing — but Wave 0b can no longer be described as a cheap-closure wave, and Waves 2/2.5
      shrink accordingly: **RM-06, RM-07 and RM-17 will not retire in Sitting B or its retirement
      pass.**

## Wave 1 — the leverage batch
- [x] WP 1.1 — **done 2026-08-21 · `wp/roadmap-cleanup/1.1` (`7e04155` · `bd59865`, merged)** —
      **RM-18 WP 1.6**: one consolidated owner-acceptance checklist across all ledgers,
      grouped by prerequisite (browser · provider key · subscription · CI), with exact click-paths
      and expected outcomes. Pattern already proven twice —
      `RM-13-hub-fixes/owner-acceptance-walk.md` and
      `completed/RM-04-assistant-hub-ux/owner-acceptance-walk.md`. Run via `/next-wp platform`.
      **Delivered:** [`RM-18/owner-acceptance-consolidated.md`](../RM-18-platform/owner-acceptance-consolidated.md)
      — 1,503 lines. **192 boxes from 23 files, worked as 193 checks**, in four sittings each gated on
      exactly ONE prerequisite: **A** browser only (39 checks, 10 items) · **B** one provider key (113,
      11 items) · **C** a subscription sign-in (35, 5 items) · **D** a real pipeline (6, RM-08). Every
      check carries an exact URL/click-path, an unambiguous expected outcome, its fixture, and a
      `Ledger:` back-pointer naming file, section and box ordinal.
      **Validated by the orchestrator, not taken on report.** Scope is clean (no application code —
      the new file, the WP 1.6 tick, one regenerated index). Exactly one box was ticked, in RM-18's
      own ledger, with its timestamp bumped in the same write; **no other item's ledger was touched**.
      Every route the checklist cites was checked against `apps/web/src/App.tsx` — `/advisor`,
      `/testing/{collections,environments,review,suites}`, `/testing/runs/compare`, `/illustrations`,
      `/servers` all exist, and all four redirects resolve exactly as described. Nothing fabricated.
      **The count of ~90 in this plan's §1 and §5 was wrong — it is 192**, because §1 counted only the
      13 items it had already identified, and only their `STATUS.md`. The same undercount the Wave 0
      lesson warned about.
      **Three findings verified against the code, each true:** (1) **~6 checks cannot be run at all
      today** — the skill inspector's Design and Trace tabs are hidden by owner decision **O2b**
      (`SkillInspector.tsx:353,365` rewrite `design`/`trace` → `files`), which is most of RM-23's 4
      boxes and 3 of RM-22's 7; un-parking them is RM-30 Phase 7, so **Sitting B cannot fully clear
      RM-23 until then**. (2) **RM-20's box says "check the servers rail badges" but RM-32 deleted the
      rail** (`ServerRail.tsx` no longer exists) — the badge now lives on the `/servers` overview.
      (3) **RM-02 has 22 open boxes, not the 18** the orchestrator's inventory reported — the
      orchestrator's scan filtered on a heading regex and missed sections that do not match it, and
      **this plan's own §3c says 22**. Seven further corrections are in the file's Appendix 2.
      **Nothing was silently dropped:** items excluded for having prose-only pending walks (RM-17,
      RM-34, `completed/` RM-21/RM-28/RM-33) are carried in **Appendix 1** rather than lost, and
      **`completed/RM-04` (15) and `completed/RM-13` (28) ARE included**, flagged
      *🗄 RETIRED — verification outstanding* — the outcome WP 0.3 specifically needed

## Wave 2 — the owner-acceptance sittings (OWNER only — never agent-doable)
- [ ] **OWNER** WP 2.1 — Sitting A, browser only: RM-01 (1) · RM-05 (2) · RM-24 (2) · RM-27 (1) ·
      RM-32 (8) · RM-22 (7) · RM-20 (10). **Retires 7 items.** RM-20 and RM-22 carry judgement
      calls (false-positive rate on your own fleet; two read-boundary sign-offs), not just looking
- [ ] **OWNER** WP 2.2 — Sitting B, one provider key: RM-23 (4) · RM-07 (5) · RM-10 (9) ·
      RM-06 (7) · RM-26 WP 4.1. **Retires up to 4 items**, and these are the ones whose *quality*
      is genuinely unproven rather than merely unlooked-at
- [ ] **OWNER** WP 2.3 — Sitting C, Claude subscription sign-in: RM-09 (4) · RM-16 (7) ·
      RM-02 (22). **Retires 3 items.** RM-02's 22 boxes are four refinement rounds that each grew
      their own acceptance section
- [ ] **OWNER** WP 2.4 — Sitting D, a real pipeline: RM-08 (13). The blocking box is structural —
      the two gates in `examples/github-actions/` **have never executed**. Push `main` (WP 0.1) so
      `mcp-self-scan.yml` runs, or execute the examples in a throwaway repo with a service token
- [ ] WP 2.5 — retire every item its sitting cleared (`/complete-roadmap` per item, DC subject
      named). **The prerequisite is CLEARED 2026-08-22:** the owner chose a dedicated subject over
      folding Advisor into DC-11, and **`DC-25-advisor`** now exists (`/advisor`, the seven evidenced
      rules, `GET /api/advisor/report`, the fleet exports; explicitly scoping OUT the scan, testing,
      observability and security subjects it reads from). RM-01 can be retired into it the moment its
      sitting clears it. **This box still waits on Wave 2** — there is nothing to retire until a
      sitting actually clears an item

> **Session-limit interruption, 2026-08-22.** Four agents died mid-task on an API session limit
> (resets 04:50 Europe/Zurich): WP 7.7, the UX corrections (on its fourth item), the headless
> two-theme walk, and the branch-authoring investigation. **Everything uncommitted was rescued and
> committed verbatim before anything else** — see WP 3.3's note and RM-17's perf-case line. Two
> deliverables were lost outright rather than half-done: the **headless two-theme walk** produced no
> report (it was re-running its corrected audit when it died), and the **branch-authoring
> investigation** never started. Both are cheap to re-run and neither wrote anything.

## Wave 3 — the remaining engineering, in value order
- [ ] WP 3.1 — **RM-26 WP 4.4** end-to-end verification: a real run through the built Docker
      image. 1 WP, needs a provider key. Highest value per hour on this list — it exercises
      migrations, the encrypted-secret path, static serving and the run engine in one shot
- [x] WP 3.2 — **done 2026-08-21 · `wp/roadmap-cleanup/3.2` (`6faa5a5`, merged) — RM-34 is now at
      ZERO open CHECKBOXES — but NOT retirable.**
      Its Owner-acceptance section carries three live items as *prose*, so `/complete-roadmap` (which
      reads checkboxes only) would not refuse — **the same trap this plan's §6 fell into with RM-13**.
      They are: the owner judgement call on option (c); the follow-up WP for the unmodelled intercept;
      and two hand walks never done (a keyboard pass over the launcher's estimate block, and a
      real-value two-theme look at the **suite run-confirm** and **fork dialog** basis lines — only the
      launcher was re-walked live). Those three are **not** yet in the WP 1.1 consolidated checklist,
      because they carry no checkbox for it to have found. Not "re-measure": the measurement already existed as agent
      D's rescued `71d7b60`, so this became **validate-and-integrate**, with a second agent briefed to
      *try to break it*. It did, usefully. **The chartered defect is CLOSED** — RM-33's reference run
      now falls inside the token band that previously topped out 1.86× below it, and the band brackets
      93–96% of real turn counts against 49–61% before. **The money half got WORSE** — on the
      most-measured pair the dollar floor now sits above what **27 of 28** real runs cost, against 19
      of 28 before — and `README.md` now says exactly that, instead of claiming an improvement.
      **Reviewer's corrections, each re-verified by the orchestrator against the code.** The three hard
      facts hold: `estimate.ts:148–153` charges `turns × (footprint + systemPrompt)` unconditionally,
      its header states the premise *"eager tool loading"* (`:8`), and **`tool_loading_mode` has ZERO
      occurrences anywhere in `apps/api/src/estimate/`** — mode-blind *by construction*. But agent D's
      causal story overreached: its "live context peaked at 27–34k" support is **circular**
      (`accounting.ts:362`/`:651` set `toolDefs = 0` in deferred mode by construction, so that figure
      cannot evidence what was billed); the **effective** mode is never persisted
      (`run-service.ts:1389–1392` silently downgrades `deferred`→`eager` unless the model supports tool
      search, so only the *requested* mode was ever read); and "always upward" is true of the
      intercept, not the slope — the Banking pair's **0.77×** is direct counter-evidence. The reviewer
      also **refuted** two rival explanations (a turn-counting mismatch; conversation-growth
      convexity), so the negative intercept is real even though its cause is **not** established. All
      arithmetic reconciled to the unit, including RM-33's independently recorded $0.4198–$1.5912 to
      four decimals.
      **`data/app.sqlite` was never touched** — the orchestrator confirmed md5 `1762bcdadae9…` and
      mtime `16:22` identical, matching what agent D recorded.
      **Consequences.** CLAUDE.md's RM-34 row read 🚧 *"3 of 4 WPs … Open: WP 2.1"*; ticking made that
      false, so it was rewritten in the same commit. The two remaining estimator defects — the
      mode-blind per-turn prefix, and a dollar band that excludes the answer — belong to a **NEW item,
      not this one**, and that item must **measure per-turn billed input directly from `run_steps`
      before assuming the deferred-loading cause**; fixing the wrong axis is a live risk here.
      **Not verified:** the live endpoint responses and the browser walk were not re-run by the
      reviewer (deliberately — it was told not to open the database or start the app), so WP 2.1's
      live pass rests on agent D's session plus the reviewer's arithmetic reconciliation, which is
      strong circumstantial agreement rather than an independent re-call. Whether those runs actually
      executed in **deferred** mode is recorded nowhere and remains unknown. 1 WP. Fixes
      a number the owner has already seen be wrong (RM-33 recorded the band bracketing a real run
      at $0.42–$1.59 against $0.80 billed, because the 8-turn ceiling dominates at 19 turns).
      **Check first** whether "agent D" still holds it — the in-progress marker looks stale.
      **⚠️ ANSWERED 2026-08-21 — do NOT dispatch a fresh agent for this.** No process holds it, but
      the worktree `.claude/worktrees/agent-acd2078a3c24a268f` (branch
      `worktree-agent-acd2078a3c24a268f`) held **284 lines of uncommitted work** on exactly this WP:
      a full live-calibration evidence writeup in RM-34's ledger, plus `README.md`, `CHANGELOG.md`,
      `CLAUDE.md` and a `DC-08` delivery record. The branch had **no commits of its own**, so the
      `git worktree remove` this WP's own note calls for would have destroyed it silently. It has
      been committed verbatim as `71d7b60` on that branch — **rescued, not reviewed**: nothing in it
      has been checked against the gate or the running app, and RM-34's box is still open because
      agent D's own note says *"box left for the orchestrator"*.
      **Its headline, which changes what this WP means:** *"the turn model is fixed and the estimator
      is still wrong"* — measuring the turn band moved its ends onto real ground, but that exposed a
      second, larger error on the **tokens-per-turn** axis which the previously under-stated turn
      count had been masking. So WP 3.2 is now **validate-and-integrate `71d7b60`**, then decide
      whether the newly-exposed tokens-per-turn error is in RM-34's scope or a new item — not
      "re-measure the band"
- [ ] WP 3.3 — **RM-30 Phase 7** Skill Studio: WP 7.1, 7.3, 7.4 then 7.7, 7.8, 7.9. Three batches,
      dependency chain `7.1 ∥ 7.2 → 7.3 → (7.4 ∥ 7.6) → 7.5`; round 2's 7.7–7.9 revise the same
      surface so they land after. Owner-directed rework of a surface the owner has already
      rejected; unblocks RM-30's 61 done WPs.
      **WP 7.1 landed 2026-08-21** (`wp/roadmap-cleanup/rm30-7.1`, merged; gate green on `main`) — the
      batch was one WP wide, not three: 7.2 was already done and 7.3/7.4 both depend on 7.1.
      **Still open: 7.3 · 7.4 · 7.7 · 7.8 · 7.9**, so this box stays open. Two of those now carry an
      inherited one-line deletion, recorded in RM-30's ledger rather than hidden: the Studio shell
      deliberately left Overview's "Save as new version" (7.3's job) and the Inspector Files
      Discard/Save bar (7.4's job) in place, because removing them before their replacements exist
      would strand the only way to edit a skill's keywords and files. **Nobody has used the Studio** —
      its 61.1%-of-viewport claim is a headless-Chromium measurement, it was never driven against a
      bound MCP server, and no save was ever completed.
      **BATCH 2 LANDED 2026-08-21 — WP 7.3 and WP 7.4 both merged, gate green on `main`.**
      7.3: the settings panel + **one draft store** — name · description · servers · keywords ·
      `/command` entry points as form controls, no YAML by hand, one dirty count, one "Save as vN".
      It closed **D-UX18** (binding no longer saves a version the instant you click) and paid 7.1's
      first inherited line (Overview is mutation-free). It also found and fixed a **real corruption
      bug in the shipped 7.3a engine**: a folded block scalar (`description: >`) was classified as a
      plain scalar and would have been mangled on rewrite.
      7.4: files join that same draft — tabs in the centre, an editable Files rail, and **one** save
      for a file change plus a manifest change together. It paid 7.1's second inherited line: the
      Inspector's Files tab is browse-only, its Save/Discard bar and `SaveWorkspaceDialog` are
      **deleted**, with a guardrail that goes red if the dialog returns — and a **third** hidden save
      path (the Files-tab bindings strip) went with it, which was the builder's judgement rather than
      the spec's letter.
      **BATCH 3 (2026-08-22) — cut short by a session limit; here is exactly where it stopped.**
      **WP 7.8's design doc is written, merged and APPROVED** — five edge kinds with a legal-pair
      table, an entry-point flow as forward reachability with always-read/maybe-read labels and token
      figures, one box per file/tool, refusals that offer the legal move, **app-side box positions**
      (chosen because a position comment would sit in the metered `l2_body_tokens` body and inflate
      the very cost this app measures), branches deferred, and old traces **degrading with a visible
      notice** rather than being migrated or hidden. So 7.8 is ready to build — **after 7.7, never
      beside it**: both own `use-edit-ops`.
      **WP 7.7 died mid-build** and is rescued as `0e8c5b5` on `wp/roadmap-cleanup/rm30-7.7-wip` —
      9 files, **unreviewed, ungated, and it does not typecheck** (the agent's last words were "now
      let's typecheck to find the fallout"). It had deleted `ToolsPalette.tsx` and written
      `ComponentsPalette.tsx` · `ComponentValueDialog.tsx` · `skill-components.ts` ·
      `use-server-binding.ts`. **It had NO commits of its own**, so a routine worktree cleanup would
      have destroyed all of it silently — the same trap this plan hit once before with agent D.
      **Two owner corrections DID land** (`wp/roadmap-cleanup/ux-corrections`, merged, gate green):
      an × on every file tab with the strip owning its own keyboard, and one contextual "Edit in
      Studio" instead of two. A third (the warning-severity reversal) landed in RM-17.
      **Still open: 7.7 · 7.8 · 7.9** (7.8's gate is now cleared).
      **Nobody has still ever used any of this.** Three Studio WPs deep, no browser has been opened,
      no save has been completed against a live API, and it has never met a bound MCP server
- [x] WP 3.4 — **RM-03 WP 2.3** — **done 2026-08-22 · dropped as engineering and closed as the ledger
      correction it always was, on the owner's explicit decision.** WP 0.4 found the contradiction and
      deliberately left it; this session verified every artefact against `main` and the owner said
      tick it. RM-03's WP 2.3 box is now `[x]` (open boxes 19 → 18) with the full re-verification
      written onto the line: the four additive `HubEvent` members, all four routes, the turn-engine
      HITL seam as its own `apps/api/src/hub/hitl.ts`, and the UI as `AutonomyModeSelect` /
      `AssistantPermissionCard` / `MissionApprovalQueue` — **renamed, not dropped**, which is why the
      ledger's own prose names find nothing by search. **RM-03 now has NO engineering left**; the live
      MCP `elicitation/create` round-trip is owner-acceptance and is already carried as check B10 in
      the consolidated file. **Not re-verified by a gate run** — a source walk is weaker evidence than
      the gate that originally proved it, and the line says so.
- [x] WP 3.6 — **RM-17 WP 3.5** agent-graph lens over a run — **done 2026-08-21 · already shipped;
      this box was a bookkeeping lag, not work.** RM-17's own ledger ticked it (`wp/observability/3.5`,
      six commits, merged `5c365ec`), and the orchestrator verified that independently rather than
      taking the tick on faith: `git merge-base --is-ancestor 5c365ec main` passes, the five source
      files exist on `main` (`AgentGraphLens.tsx` · `AgentGraphNode.tsx` · `agent-graph.ts` + two
      test files), and their suites run green here — **47 tests, 2 files, 0 failures**.
      **The ⚠️ chart-touching warning turned out not to apply:** the lens is built on
      `@elabs-ai/components-flow`'s canvas, not `@elabs-ai/components-charts`, so the no-op chart mock
      that silences prop bugs in the panel suites is not in this path at all.
      **Not verified here:** the two-theme + keyboard walk of the lens. That is owner-acceptance, it
      is carried as such in RM-17's own ledger, and no browser was opened for it
- [ ] WP 3.7 — **RM-17 Phase 6**, the thirteen locked Langfuse follow-ups. Six are marked
      _verify-at-pickup_ — the surface shipped before the amendment was written, so shrink each to
      its true residual instead of rebuilding. Two may need a migration (AM-OB2, AM-OB6); one at a
      time. **If RM-17 should retire before this is worked, split Phase 6 to its own RM item** —
      recorded as the sanctioned alternative on lock day.
      **2 of the 13 landed 2026-08-21 — 11 open** (this box stays open until Phase 6 is worked or
      split). `AM-OB1` (merged `17c93ba`) and `AM-OB10` (merged `c81e1d9`), each built by a worktree
      agent briefed to honour *verify-at-pickup* first, each validated by the orchestrator with its
      own mutation probe before the merge, gate green on `main` after both.
      **Both pickups paid for themselves, in opposite directions.** AM-OB1 shrank by more than half —
      the `RunFilter` was ALREADY in the URL; what was actually lost on reload was the applied saved
      view, the sort, the grouping, the type facet and the column preference — so it needed no wire
      change and no migration. AM-OB10 did **not** shrink: all four parts were unbuilt, and one was a
      **live alerting defect** — an empty window read as "not breached", so a bench that went silent
      while a rule was firing was recorded as *recovered*. It took migration **v61**, which the
      ledger's own note had not expected; that note was corrected rather than left standing.
      **Neither was walked in a browser** — no two-theme look, no keyboard pass, no live notification,
      and AM-OB1's create-view→copy-URL→paste-in-a-fresh-tab flow is pinned only against a stubbed
      API. Recorded in RM-17's ledger as owner-acceptance, not glossed.
      **BATCH 2 LANDED 2026-08-21 — 3 more, so 5 of the 13 are done and 8 remain.**
      `AM-OB11` (the typed `workflow_dispatch` action, on the **encrypted `github-account` token** per
      the ledger's own correction — not `api_tokens`, which holds a one-way digest and cannot present
      an outbound PAT); `AM-OB12` (the rating verdicts as filter dimensions); and **`AM-OB4`, which
      was not in the batch and was dispatched mid-session** because AM-OB12 turned out to be blocked
      on it — the share half could not exist without a ratio measure, and WP 6.11's own non-goals
      forbid a fourteenth bespoke measure. AM-OB4 delivered the ratio, made `feedbackRate` real, and
      **closed AM-OB12's blocked acceptance the same day**.
      **Two structural findings came out of it, both bigger than the WPs that found them.** The two
      byte-identical `buildRunFilterWhere` copies collapsed into one — and the header claiming *both*
      were pinned to `matchesRunFilter` was **false**, only the repository copy was, so the charts
      could have drifted from the runs feed unnoticed. And a share now omits a zero-denominator
      bucket rather than plotting 0%, which is the same class of lie AM-OB10 fixed in the watch
      engine: "nothing qualified" must not look like "nothing went wrong".
      **Remaining 8 are mostly fenced or chart-touching**: AM-OB2 · AM-OB3 · AM-OB5 · AM-OB8 ·
      AM-OB13 live in the runs-feed/console surface a concurrent RM-36 session holds, and AM-OB5 ·
      AM-OB7 · AM-OB8 · AM-OB14 touch charts, where the panel suites mock
      `@elabs-ai/components-charts` as no-ops. AM-OB6 is the one remaining migration-bearing item
- [ ] WP 3.8 — **RM-14 Phases 2–4** (10 WPs): scene spec layout engine + connector router +
      renderer (2.1–2.4), explain mode (3.1–3.3), assistant compose tools (4.1–4.3). Largest
      remaining build. **The risk to weigh:** 24 illustration components exist and nothing composes
      them — Phase 1 delivered breadth, Phase 2 is the load-bearing part

## Wave 4 — new work and the ledger-less items (owner's call)
- [ ] WP 4.1 — **RM-18** remaining 5 WPs (first-run seed, docs route, diagnostics bundle, upgrade
      harness, perf pass). **Recheck the stale "blocked on Benchmarks P1/P3" flags first** — both
      are done, exactly as RM-01's WP 2.1 flag was found stale on 2026-08-18.
      **✅ RECHECKED AND CLEARED 2026-08-21** (done ahead of this WP, since it is read-only and it is
      what makes the WP dispatchable). Both flags were false: `RM-07`'s **Phase 1 is 4/4** and
      **Phase 3 is 5/5**. RM-18's ledger note now says so and records that **nothing in that item is
      blocked on another workstream** — so WP 4.1 can be dispatched whenever the owner wants it, with
      no unblocking work first. This is the **second** stale blocked-flag found in RM-18 this way.
- [ ] WP 4.2 — **RM-25** team-server, 6 WPs. Its gate (RM-08 Phase 1) is met. Starting it revises
      the "single-owner local" scope in CLAUDE.md §1, so it is a product decision, not scheduling
- [x] WP 4.3 — **RM-19** release — **done 2026-08-21 · `RM-19` → `Roadmap/completed/RM-19-release`,
      increment recorded in `DC-22`, 3 milestones ticked, ledger waived.** The bundle was written into
      DC-22 first, as the WP required: a new *"Handing it to someone else — the offline bundle"*
      section in
      [`24-running-the-container.md`](../../user-guide/DC-22-packaging-and-deployment/24-running-the-container.md)
      covering the four bundle files, the launcher's behaviour, the private-repo consequence for
      GitHub Release assets, and the no-secrets-ship guarantee. `--no-ledger` is correct here and is
      **not** a waiver past an open box — RM-19 never had a `STATUS.md` at all (bundle rule §5).
      **Every claim was checked against the scripts, not the plan:** `bash -n` parses both shell
      scripts, and `scripts/release/run.sh` genuinely contains the `SHA256SUMS.txt` verification
      (line 65), the `docker load` (76), the container replace-keeping-the-volume (82–84), the
      upward free-port probe (89–113) and the `/api/health` wait (121–122).
      **⚠️ Recorded as a gap, not glossed:** the item's own milestone 3 — *"verify a cold start on a
      clean machine"* — **was not done**, and `/complete-roadmap` ticked it anyway because
      `--no-ledger` ticks milestones unconditionally. No bundle was built, none was handed to a
      recipient, `run.ps1` was never syntax-checked (no PowerShell on this host) or run on Windows —
      the platform most recipients use — and `--publish` has never been exercised. All of that is
      written verbatim into the DC-22 increment's *Known gaps* and into the `CLAUDE.md` row.
- [x] WP 4.4 — **RM-12** and **RM-31** — **done 2026-08-21 · both retired.**
      `RM-31` → `Roadmap/completed/RM-31-mvp-footprint-analyzer` (increment in **DC-23**,
      3 milestones ticked) and `RM-12` → `Roadmap/completed/RM-12-findings` (increment in **DC-20**,
      3 milestones ticked); both `--no-ledger`, which is correct and **not** a waiver past an open
      box — neither item ever had a `STATUS.md` (bundle rule §5), confirmed by `ls` before running.
      **Retiring them is honest, and that was checked rather than assumed:** each item's milestones
      describe work that actually happened. RM-31's MVP shipped and its `08-expanded-target.md` is
      the origin of today's north star; RM-12's three wave-status documents (`05-remediation-status`,
      `06-hardening-status`, `07-cross-server-compare-status`) all carry `status: "final"` and carry
      **zero open boxes** between them.
      **Stale references applied in the working tree only** — `CLAUDE.md`, `ROADMAP.md`,
      `CHANGELOG.md`, `.claude/rules/architecture.md`, `.claude/rules/mcp-and-security.md` and the
      new DC-23 increment's own gap sentence; the generator re-pointed the two bundle links itself.
      `check-references` for **both** tags now reports nothing outside `.claude/worktrees/` (those
      are three in-flight agent checkouts that branched before the move — re-check after their
      branches merge). `pnpm okf:validate` **PASS** on both conformance layers.
      **No `README.md`/`CHANGELOG.md` capability entry was written**, deliberately: nothing the app
      does changed — this is bundle bookkeeping, and the front-page rule governs shipped behaviour.
      **Recorded as a gap in both increments:** nothing was re-verified. RM-12's audit is from
      2026-06-20 against a UI since rebuilt twice and a design system that then shipped six themes
      against today's two, so it reads as provenance for why the later UI items exist — not as a
      description of the interface

## Decision log
_Entries: date · decision · rationale._

- **2026-08-21 · this review became an RM item rather than a loose file.** The request was a
  `roadmap-cleanup.md` beside `roadmap.md`. `planning/Roadmap/` permits exactly two loose files
  (`index.md`, `roadmap.md`) — `loose_files` in `okf.py`'s `rm` Domain — so the draft failed
  `pnpm okf:validate` with PROFILE027 + PROFILE018. Owner chose the generator path, which also
  makes the waves drivable by `/next-wp` instead of being prose nobody executes.
- **2026-08-21 · Wave 0 ran; three of the review's own premises were found stale.** Doing the work
  corrected the document that ordered it. (1) `main` **was already pushed** — remote and local are both
  `9f64e93`, so WP 0.1 was a no-op and WP 2.4's stated prerequisite has moved. (2) **RM-13 was not
  "otherwise retirable"** — §6 counted only `STATUS.md` and missed 28 unticked live-verification boxes
  in `owner-acceptance-walk.md`; it was retired as instructed, with the whole unrun walk written into
  the DC-13 `--gap` rather than dropped. (3) **RM-03 WP 2.3 is not obviously unbuilt** — its ledger line
  claims both "status: open" and "✅ DONE 2026-07-18 · integrated @ `bb89591` · GAP-A/GAP-B CLOSED", so
  WP 3.4 needs re-scoping before dispatch. **The lesson for the rest of this plan: count boxes across
  every file in an item, not just its ledger, before calling anything retirable.**
- **2026-08-21 · a stale git worktree still exists for RM-34 "agent D".** `git worktree list` shows
  `.claude/worktrees/agent-acd2078a3c24a268f` on branch `worktree-agent-acd2078a3c24a268f` at `8bb888a`
  — one commit behind `main`, and `8bb888a` is *"docs(RM-34): mark WP 2.1 in progress"*. So WP 3.2's
  in-progress marker is **not** simply stale text: an abandoned worktree is holding it. Before
  dispatching WP 3.2, inspect that worktree for unmerged work, then `git worktree remove` it. It also
  holds the last stale `RM-13-hub-fixes` path reference in the repo, which was deliberately **not**
  edited — writing to another branch's checkout is not this batch's business.
- **2026-08-21 · the roadmap is not blocked on engineering.** 13 of 28 items are code-complete
  and gate-green, held open only by owner-acceptance walks — roughly 90 checkboxes across 13
  files. Waves 0–2 take the active roadmap from 28 items to roughly 12 with **no feature work at
  all**. This is why Wave 1 (one consolidated checklist) outranks every engineering WP here.

## Owner acceptance (owner-only)
- [ ] The active roadmap lists only work that is genuinely live: every retirable item retired,
      every started-and-incomplete item either finished or explicitly parked with a named
      condition — accepted: ____
