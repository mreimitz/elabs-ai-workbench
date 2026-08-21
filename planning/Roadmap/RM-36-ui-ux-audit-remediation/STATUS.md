---
type: "Status Ledger"
title: "UI/UX audit remediation — work-package status ledger · PRIORITY: MEDIUM"
description: "Living state for the RM-36 audit-remediation plan, read and updated by /next-wp RM-36."
tags: ["roadmap", "RM-36"]
timestamp: "2026-08-21T20:25:48Z"
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

- [x] **WP 1.1** — `/advisor`: move the 139-name tool list out of the card's prose into a
      disclosure, and fix the 55 WCAG 2.5.8 evidence-chip target failures.
      Spec: [`wp-1.1-advisor.md`](./wp-1.1-advisor.md) · findings P1-1, P1-2 — done 2026-08-21 · wp/ui-audit/1.1
- [x] **WP 1.2** — `PaperStage`: instance-unique SVG pattern ids, ending the live grid
      mis-registration in the illustration detail dialog.
      Spec: [`wp-1.2-paperstage-ids.md`](./wp-1.2-paperstage-ids.md) · finding P1-3 — done 2026-08-21 · wp/ui-audit/1.2
- [x] **WP 1.3** — run console: remove the `<p>`-inside-`<p>` React error from the KPI cost tile.
      Spec: [`wp-1.3-kpirail-nested-p.md`](./wp-1.3-kpirail-nested-p.md) · finding P1-4 — done 2026-08-21 · wp/ui-audit/1.3
- [x] **WP 1.4** — markdown table toolbar: raise the D-TB5 violation upstream and record the
      exception; do **not** patch around it locally.
      Spec: [`wp-1.4-markdown-toolbar.md`](./wp-1.4-markdown-toolbar.md) · finding P1-5 — done 2026-08-21 · wp/ui-audit/1.4

### Phase 2 — reach, consistency and density

- [x] **WP 2.1** — keep the primary actions of `/testing/runs` and the run console reachable at
      768px.
      Spec: [`wp-2.1-responsive-actions.md`](./wp-2.1-responsive-actions.md) · finding P1-6 — done 2026-08-21 · wp/ui-audit/2.1
- [x] **WP 2.2** — consistency and density sweep: one encoding per runs-table column, drop the
      server-card chips the group heading already states, size the launcher's step 1, surface the
      swallowed 404, unstretch the skill-inspector card, retire the three side stripes.
      Spec: [`wp-2.2-consistency-density.md`](./wp-2.2-consistency-density.md) · findings P2-1 … P2-6 — done 2026-08-21 · wp/ui-audit/2.2

## Owner-acceptance

Not started — nothing is built yet. When Phase 1 and Phase 2 are done, these are the hand checks
that no test can stand in for:

- [x] `/advisor` read in both themes: the recommendation's number and decision are visible without
      scrolling past a list, and the evidence chips are comfortably clickable.
      **Verified 2026-08-21 by the orchestrator on the running merged build** (own instance on
      :8099 against an isolated DB copy; the live `data/app.sqlite` md5 confirmed unchanged).
      At 1440×900 in **both** themes: **2** recommendation cards in the first viewport (was 1),
      first card 515px tall, the sentence + "≈ 136,502 tokens/turn" + the Estimated-saving panel all
      above the fold, and the 139 names behind a trigger reading "Show 139 never-called tools".
      The 2.5.8 probe — the audit's own method, inline and spacing exceptions granted — reports
      **0 failures, down from 55**; all **221** evidence links measure **26px** (was 16px).
- [ ] `/illustrations` detail dialog in both themes: every stage's grid registers against its own
      crosshair at every size in the matrix.
      **Measured clean, visually spot-checked only.** The orchestrator measured the dialog on the
      running merged build in both themes: **68 `<pattern>` elements → 68 distinct ids** (was 68 → 2),
      i.e. no stage can borrow another's grid phase, and the contract test additionally pins that each
      stage's `url(#…)` resolves to the patterns that stage defined. The States and Sizes rows were
      looked at in both themes and read correctly — but the rows **below the fold** of the dialog were
      not scrolled through by eye, so the "every size in the matrix" half is left for the owner.
- [x] Run console opened in both themes with the browser console visible: **no React error**.
      **Verified 2026-08-21 by the orchestrator** on run `SHsiRblmacvEOJi4gkalE` on the running
      merged build: **0** console errors of any kind and **0** `<p>` containing another `<p>`, in
      **both** themes. The pre-merge baseline on the same probe captured the audit's exact markup:
      `<p class="text-meta font-normal text-muted-foreground"><p class="text-meta text-muted-foreground">estimated</p></p>`.
- [x] `/testing/runs` and the run console at a 768px-wide window: **+ New run** and **Re-run with
      changes** are reachable.
      **Verified 2026-08-21 by the orchestrator** on the running merged build, in **both** themes:
      **zero** clipped named controls at **768, 1024 and 1280**. `+ New run` moved from right-edge
      **958px** to inside the viewport, `Re-run with changes` from **975px** to inside; the audit's
      own numbers (849 / 958 / 806 / 975) were reproduced on the pre-merge build first, so the probe
      is known to detect the defect. The run console's bar measures **39px at both 1024 and 1280**
      (one row — unchanged) and **96px at 768** (wrapped), so the wrap is content-driven and does not
      fire at the roomy widths. WP 2.1's agent flagged a possible 1024 regression from its own
      fixture; **it does not reproduce on real data.**
- [ ] A keyboard-only pass over `/advisor` and `/skills/:skillId` Overview: every stop shows a ring.
      **Partially evidenced, NOT a full pass.** The orchestrator confirmed the new `/advisor`
      disclosure trigger is a real `<button>` that takes focus and paints a visible ring in **both**
      themes (light uses the app-side `--ring` contrast override). Every other stop on either route
      was **not** walked, and `/skills/:skillId` Overview still carries the 11 unringed upstream
      controls recorded as a known exception below — expect them.
- [ ] The un-audited `/assistant/*` surfaces: either swept with the flag on, or explicitly recorded
      as still unmeasured.

### Known upstream exception — the markdown toolbar's unringed icon buttons (WP 1.4)

- [ ] **Owner decision recorded.** `/skills/:skillId` → Overview renders **11 icon-only controls
      with no focus ring, named only by a native `title=`, measuring 21×21 / 23×23**. They are the
      only unringed focusables the audit found anywhere in the app (finding **P1-5**), and they
      violate the written D-TB5 rule in `.claude/rules/icon-affordances.md`.

      **This is not app code and is deliberately not being patched locally.** The markup comes from
      **`streamdown@2.5.0`**, a runtime dependency of **`@elabs-ai/components-ai@4.0.0`**, whose
      `MessageResponse` component `apps/web/src/features/skills/SkillOverview.tsx:538` renders.
      Source: `node_modules/.pnpm/streamdown@2.5.0_.../node_modules/streamdown/dist/chunk-BO2N2NFS.js`
      — independently re-verified by the orchestrator: that chunk carries **8** occurrences of the
      audit's exact class string and **zero** `focus-visible` rules, and `grep -rn "Copy table"` over
      `apps/web/src apps/api/src packages` returns **no match**. The buttons carry `title:` with no
      `aria-label` and no rest-prop spread to add one. `@elabs-ai/components-editor@4.0.0` bundles
      the same version.

      Per `.claude/rules/library-first.md` this is a **real upstream gap, not a licence to
      hand-roll**; a CSS override of the library's class names would be a second styling system by
      the back door and would break silently on the next `@elabs-ai/components-*` bump. The drafted
      upstream request (one `label` prop feeding both tooltip and `aria-label`, a token-driven
      `focus-visible:ring-2 ring-ring`, a ≥24px target — the
      `apps/web/src/components/IconButton.tsx` treatment) is **awaiting the owner to send it**.

      **A later audit that reports "11 unringed focusables on `/skills/:skillId`" should find this
      entry and NOT re-file it.** Re-open only when `@elabs-ai/components-*` ships a fix, or when
      the owner decides otherwise on the note below.

- [ ] **Owner call — a partial local remedy exists and was NOT taken.** The app already owns a
      sanctioned, non-CSS override: `MD_TABLE_COMPONENTS` in
      `apps/web/src/features/testing/ChatMarkdown.tsx:147` replaces Streamdown's table block with
      `@elabs-ai/components-ui` `Table*` inside the app's own `ExpandableTable`, whose toolbar IS
      built from `IconButton`. Three surfaces pass it (`ChatMarkdown.tsx:81`,
      `hub/ConversationPane.tsx:960`, `hub/AgentTranscript.tsx:164`); `SkillOverview.tsx:538` is the
      one bare `MessageResponse` left — orchestrator-verified. Passing that existing map there would
      remove **the table trio** with no CSS override and no new component — but would **not** remove
      the code-block trio (`Copy Code` / `Download file`), which shares the identical defect and
      which no app-side `components` map covers. Decide whether to close the table half now or wait
      for the single upstream fix.

## Follow-ups found while building (not part of any WP's scope)

Recorded so they are not lost. Neither was fixed; both are owner calls.

- **The Context tile's popover repeats the P1-4 defect, interaction-triggered.** WP 1.3 closed the
  load-triggered nested `<p>` on the run console. The Context KPI tile's `description` is
  `<ContextBreakdown>`, which at rest is a `<button>` — valid phrasing content, which is why the
  audit saw only one nested pair. But `@elabs-ai/components-ui`'s `HoverCardContent` renders with
  **no Portal**, and orchestrator-verified: `HoverCardPortal` is exported **zero** times by that
  package and `@elabs-ai/components-ai` exports no `ContextPortal`. So **opening** that popover
  renders its content — including a `<Text as="p">` — inside `MetricCard`'s own `<p>`. Closing it
  needs an upstream portal export or a structural rewrite of a tile governed by the RM-33 contract;
  it is not reachable from the call site. Same defect class as P1-4, and it belongs with the WP 1.4
  upstream request.
- **`/advisor` parses prose the API wrote, because the wire has no structured field.** WP 1.1 lifts
  the 139 identifiers out of the card body by string-matching the lead-ins the advisor rules emit
  (`"Never called: "`, `"Suggested allowedTools: "`) inside `recommendation.detail`. This was the
  correct call **inside the WP** — the spec scopes it to `RecommendationCard.tsx` and forbids
  touching `apps/api/` — and it is deliberately conservative: a detail carrying no recognised
  enumeration comes back **byte-identical**, pinned by a test, so no other rule's wording can be
  silently mangled. But the durable fix is the API sending the names as a structured field instead of
  inlining them into prose, which would delete the parser. Worth a small additive wire change later.

## Corrections and discoveries from Phase 2 (orchestrator-verified)

- **Finding P2-4's premise in [`audit-report.md`](./audit-report.md) is WRONG, and the ledger says so
  rather than inheriting it.** The audit recorded the repeating
  `GET /api/servers/FInszS9xQ4Jvdpo0fUdML/latest-scan` **404** as "an environment references a server
  id that no longer resolves". It does not. That id **is** a registered server (`mcp-powerbi-fabric`);
  it 404s because it has **never been scanned** — which `EnvironmentsView.tsx`'s own pre-existing
  comment already called out as "expected, not an error". Orchestrator-verified against the running
  app: the id appears in `GET /api/servers`, and **no** environment in the owner's database has a
  dangling `allowedServers` entry.
  WP 2.2 shipped the right fix anyway: it keys off "this id is absent from `/api/servers`", **not**
  off the 404, so it flags a genuinely deleted server and correctly stays silent for an unscanned
  one. It is covered by four tests whose teeth were broken and re-proved. **Consequence:** the
  acceptance sentence "the dangling-server 404 is visible in the UI" cannot be satisfied as written,
  because the 404 it names is not a dangling reference. **Residual, for the owner:** an environment
  pointing at a registered-but-never-scanned server is still surfaced nowhere. That may be worth
  saying out loud — you cannot know that server's tool surface — but it is a **new** judgement, not
  this audit's finding.

- **The compare workspace's diff rail has been painting neutral in every state.** Found by WP 2.2
  while checking whether `LaneCell`'s stripe was load-bearing (it is — it carries the D-UX9 diff
  colour semantics, so it was correctly left alone). In
  `apps/web/src/features/testing/compare/flow/LaneCell.tsx:125-128`, `"border-border"` is passed to
  `cn()` **after** `DIFF_RAIL[diff]`, and `tailwind-merge` puts `border-<color>` and
  `border-l-<color>` in the same conflict group — so the later class wins and the rail colour is
  **deleted before it reaches the DOM**. Orchestrator-verified empirically by calling the app's own
  `cn()` with the real class list: **all five** of `border-l-border` / `-success` / `-destructive` /
  `-warning` / `-transparent` come back stripped, leaving only the `bg-*/10` tint to distinguish
  added from removed. Not fixed here — it changes how the Compare Workspace looks in a way the owner
  has not seen, and it is a colour-semantics bug, not a density sweep. **Needs its own work package**
  (the fix is a class-order swap plus a guard; `DIFF_TINT` should be checked for the same trap).

- **`ViewToolbar` cannot wrap, and it is app-local — one fix would cover ~40 views.**
  `apps/web/src/components/ViewToolbar.tsx` renders its action cluster `ml-auto flex shrink-0` inside
  a **non-wrapping** root row, which is why WP 2.1 had to solve the runs feed by collapsing into a
  `⋯` menu instead of wrapping. Upstream `@elabs-ai/components-ui`'s own `ViewToolbar` documents the
  opposite in its source: *"The row wraps; it never scrolls or clips. The action cluster wraps
  INTERNALLY too."* Adding `flex-wrap` to the app-local component would fix this class of defect
  across every view at once and let the runs feed drop its bespoke collapse. Out of WP 2.1's
  ownership; **recommended as a follow-up work package**, with a per-view 1024/1280 re-check.

- **768px is the app's worst width by construction, not just on these two routes.** `useIsMobile()`
  is `width < 768`, so at *exactly* 768 every mobile mitigation is off while the desktop layout still
  needs more room than it has, and `app-shell-main` is `overflow:hidden`. P1-6 only measured two
  routes; other dense views very likely share it. `e2e/responsive-actions.spec.ts` is written so
  adding a route is one line in its `CASES` array.

- **P2-6 (the three side stripes) was deliberately SKIPPED, not forgotten.** All three are
  misclassified by the static pass: `SourcesPanel.tsx:124` and `ReportTab.tsx:603` are **blockquote
  rules** around quoted material (a citation snippet and verbatim judge evidence) — a left rule is the
  standard typographic mark for a quotation, and making them a full border or a tint would make each
  quote read as a card, which is a regression. `LaneCell.tsx:125` is load-bearing diff semantics. The
  spec itself said to drop this finding if it cost more than it returned.
