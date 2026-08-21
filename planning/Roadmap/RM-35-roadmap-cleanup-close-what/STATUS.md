---
type: "Status Ledger"
title: "Roadmap cleanup — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the roadmap-cleanup plan, read and updated by /next-wp roadmap-cleanup. A box is ticked only when its acceptance is met."
tags: ["roadmap", "RM-35"]
timestamp: "2026-08-21T20:45:00Z"
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
- [ ] **OWNER** D-1 — RM-17's Langfuse amendment (AM-OB1–14 + proposed WP 3.5 agent-graph lens):
      **lock** it and build 3.5, or **reject** it and drop the box. RM-17 has 28/29 done and **no
      owner-acceptance section** — rejecting retires it outright, the cheapest closure available
- [ ] **OWNER** D-2 — RM-06 Phase 5 (3 WPs, cross-links): build, or split to a new RM item so
      RM-06 can retire on its owner walk alone
- [ ] **OWNER** D-3 — RM-07 Phase 6 (2 WPs, judge calibration): build, or split to a new RM item
      so RM-07 can retire on its owner walk alone

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
      named). **Blocked:** RM-01 has no documentation subject — run `/new-docu` for an Advisor
      subject, or fold it into DC-11, before retiring it

## Wave 3 — the remaining engineering, in value order
- [ ] WP 3.1 — **RM-26 WP 4.4** end-to-end verification: a real run through the built Docker
      image. 1 WP, needs a provider key. Highest value per hour on this list — it exercises
      migrations, the encrypted-secret path, static serving and the run engine in one shot
- [ ] WP 3.2 — _status: in progress (agent B · validating + integrating `71d7b60`)_ — **RM-34 WP 2.1** re-measure the estimator band against recorded runs. 1 WP. Fixes
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
      rejected; unblocks RM-30's 61 done WPs
- [ ] WP 3.4 — **RM-03 WP 2.3**: autonomy dial + hard budgets + steering + live HITL
      approval-gating + MCP elicitation. One box, two BLOCKING MUSTs (elicitation transport
      R-MCP4, the approval/HITL path). Unblocks RM-03's 18-box walk.
      **⚠️ DETERMINED 2026-08-21 — THIS IS ALREADY BUILT. Do not dispatch it as engineering.** The
      contradiction WP 0.4 flagged is resolved against the code, and the code wins. Every artefact
      the ledger line claims exists on `main`:
      • the four additive `HubEvent` members — `approval_requested` / `approval_responded` /
        `elicitation_requested` / `elicitation_responded` (`packages/shared/src/constants.ts:1701–1704`),
        plus hub-fixes WP 2.5's board-mirror pair `agent_approval_requested`/`_responded` (`:1684`);
      • all four routes — `POST /api/hub/sessions/:id/approvals` (`apps/api/src/hub/routes.ts:1818`),
        `POST …/:id/elicitation` (`:1833`), `PATCH …/:id/autonomy` (`:1884`) and
        `POST /api/hub/missions/:id/agents/:agentSessionId/steer` (`:1891`);
      • the turn-engine HITL seam as its **own module**, `apps/api/src/hub/hitl.ts`, alongside
        `turn-engine.ts`, `session-service.ts` and `tools/approval-policy.ts`;
      • the UI — `AutonomyModeSelect.tsx`, `AssistantPermissionCard.tsx`, `MissionApprovalQueue.tsx`
        (the ledger's prose names them `AutonomyDial`/`ApprovalCard`/`ElicitationPanel`, which is why
        a name-based search finds nothing — **the components were renamed, not dropped**).
      **So RM-03 has NO engineering left.** Its WP 2.3 box is `[ ]` while its own text reads
      *"✅ DONE 2026-07-18 · wp/assistant-hub/2.3 (integrated @ bb89591) … GAP-A/GAP-B CLOSED"*, with
      only a live MCP `elicitation/create` round-trip against a real eliciting server outstanding —
      which is **owner-acceptance, and is already carried as check B10 in
      [`RM-18/owner-acceptance-consolidated.md`](../RM-18-platform/owner-acceptance-consolidated.md)**.
      **Recommended: drop this WP and tick RM-03's WP 2.3 box as a ledger correction**, which moves
      RM-03 from "engineering left" to "owner-acceptance only" and puts its 18-box walk in reach.
      **Deliberately NOT ticked here:** a source-grep is weaker evidence than the gate that originally
      proved it, and it is another item's ledger — the owner's call, exactly as WP 0.4 left it
- [ ] WP 3.5 — **RM-14 Phases 2–4** (10 WPs): scene spec layout engine + connector router +
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
- [ ] WP 4.4 — **RM-12** and **RM-31**: both `archived` but still filed as live work. Retire with
      `--no-ledger`, or leave archived if the provenance is worth the clutter

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
