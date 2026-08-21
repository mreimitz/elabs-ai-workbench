---
type: "Status Ledger"
title: "UI/UX audit remediation — work-package status ledger · PRIORITY: MEDIUM"
description: "Living state for the RM-36 audit-remediation plan, read and updated by /next-wp RM-36."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T18:35:00Z"
status: "active"
---

# UI/UX audit remediation — work-package status ledger · **PRIORITY: MEDIUM**

Living state for the **UI/UX audit remediation** plan, read and updated by `/next-wp RM-36`. A box
is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/ui-audit/<id>`.

> Measured evidence, the scorecard, and the refuted findings are in
> [`audit-report.md`](./audit-report.md). Plan and goal in [`item.md`](./item.md).

## What this plan is, and is not

The 2026-08-21 rendered audit measured 30 routes in both themes and found the **foundations sound**:
zero contrast failures, 45/45 tab stops ringed, reduced motion covered by the design system, no raw
colour literals in shipped UI, real state coverage. Scorecard **19/24**.

This plan is the short remainder — **six work packages over ten findings**, two of which are live
rendering or React errors, three of which break a written project rule. It is **not** a redesign, and
it does **not** reopen anything RM-30 settled.

**One rule for every WP here:** these are cosmetic and structural fixes to surfaces that already
work. No migration, no wire change, no new dependency, no new token. If a fix seems to need one,
stop and raise it.

## Coverage gap — carry this forward

The **Assistant feature flag was off** on the audited instance, so all eight `/assistant/*` routes
rendered the "turned off" panel. The Hub workspace, sessions, agents/crews, projects, memory, usage
and audit surfaces are **un-audited**. Re-run the sweep with the flag on before this item retires,
or record explicitly that they remain unmeasured.

## Work packages

### Phase 1 — the defects that are errors or rule violations

- [ ] **WP 1.1** — `/advisor`: move the 139-name tool list out of the card's prose into a
      disclosure, and fix the 55 WCAG 2.5.8 evidence-chip target failures.
      Spec: [`wp-1.1-advisor.md`](./wp-1.1-advisor.md) · findings P1-1, P1-2
- [ ] **WP 1.2** — `PaperStage`: instance-unique SVG pattern ids, ending the live grid
      mis-registration in the illustration detail dialog.
      Spec: [`wp-1.2-paperstage-ids.md`](./wp-1.2-paperstage-ids.md) · finding P1-3
- [ ] **WP 1.3** — run console: remove the `<p>`-inside-`<p>` React error from the KPI cost tile.
      Spec: [`wp-1.3-kpirail-nested-p.md`](./wp-1.3-kpirail-nested-p.md) · finding P1-4
- [ ] **WP 1.4** — markdown table toolbar: raise the D-TB5 violation upstream and record the
      exception; do **not** patch around it locally.
      Spec: [`wp-1.4-markdown-toolbar.md`](./wp-1.4-markdown-toolbar.md) · finding P1-5

### Phase 2 — reach, consistency and density

- [ ] **WP 2.1** — keep the primary actions of `/testing/runs` and the run console reachable at
      768px.
      Spec: [`wp-2.1-responsive-actions.md`](./wp-2.1-responsive-actions.md) · finding P1-6
- [ ] **WP 2.2** — consistency and density sweep: one encoding per runs-table column, drop the
      server-card chips the group heading already states, size the launcher's step 1, surface the
      swallowed 404, unstretch the skill-inspector card, retire the three side stripes.
      Spec: [`wp-2.2-consistency-density.md`](./wp-2.2-consistency-density.md) · findings P2-1 … P2-6

## Owner-acceptance

Not started — nothing is built yet. When Phase 1 and Phase 2 are done, these are the hand checks
that no test can stand in for:

- [ ] `/advisor` read in both themes: the recommendation's number and decision are visible without
      scrolling past a list, and the evidence chips are comfortably clickable.
- [ ] `/illustrations` detail dialog in both themes: every stage's grid registers against its own
      crosshair at every size in the matrix.
- [ ] Run console opened in both themes with the browser console visible: **no React error**.
- [ ] `/testing/runs` and the run console at a 768px-wide window: **+ New run** and **Re-run with
      changes** are reachable.
- [ ] A keyboard-only pass over `/advisor` and `/skills/:skillId` Overview: every stop shows a ring.
- [ ] The un-audited `/assistant/*` surfaces: either swept with the flag on, or explicitly recorded
      as still unmeasured.
