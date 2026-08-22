---
type: "Status Ledger"
title: "Announcement readiness — work-package status ledger · PRIORITY: HIGH"
description: "Living state for the RM-37 review-remediation plan (29 work packages in five phases), read and updated by /next-wp RM-37."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:40:00Z"
status: "active"
---

# Announcement readiness — work-package status ledger · **PRIORITY: HIGH**

Living state for the **Announcement readiness** plan, read and updated by `/next-wp RM-37`. A box
is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/rm37/<id>`.

> Every action point behind this plan, mapped to its work package, is in
> [`review-register.md`](./review-register.md) (217 rows, 380 source findings). Plan and goal in
> [`item.md`](./item.md). Each WP spec carries its own numbered actions and acceptance list.

## What this plan is, and is not

The 2026-08-21/22 review walked every page, menu and button of the running app through nine
lenses (end user, product owner, UI/UX designer, QA engineer, presales, engineering/release,
security & privacy, market analyst, UX copy). This plan is the **remediation**: the announcement gate
items, the first-run and hand-off path, the information-hierarchy relayout of every view, the
vocabulary and consistency sweep, and the acceptance proofs.

It is **not** a feature programme. No WP adds a capability area; the few additive pieces (config
import, demo seed, `/docs`, diagnostics export, pre-flight panel) exist because the review found the
first-run path missing. It does **not** reopen RM-36's six WPs (the 2026-08-21 rendered audit) — the
register lists what RM-36 already covers.

**Sequencing rule:** Phase 0 is the gate — nothing is announced while a Phase 0 box is open. Phases 1
and 2 can run in parallel once Phase 0's owner decisions (WP 0.1, 0.2) are taken. Phase 3 follows
Phase 2 view by view (a relayout lands with its vocabulary). Phase 4 closes the item.

**Owner decisions this plan needs before engineering starts** (each is an action in its WP):
Hub on/off for fresh installs (WP 0.1) · one product name and machine handle (WP 0.2) · licence and
distribution model (WP 0.2) · subscription-terms check (WP 0.7) · Assistant approval model (WP 1.5).

## Work packages

### Phase 0 — Announcement gate (decisions and proofs)

- [ ] **WP 0.1** — Hub as preview: `assistant`/`app_assistant` off on fresh installs, one
      "Assistant (preview)" nav entry below Testing, announcement copy reduced to one sentence.
      Spec: [`wp-0.1-hub-preview.md`](./wp-0.1-hub-preview.md) · M
- [ ] **WP 0.2** — One product name, one build-time version source, a tagged release, licence and
      distribution decision, Node pin.
      Spec: [`wp-0.2-name-version-licence.md`](./wp-0.2-name-version-licence.md) · M
- [ ] **WP 0.3** — Container trust boundary (service-token guard behind a port mapping) and the
      offline launchers proven on a clean macOS and a clean Windows machine; backup before migration;
      arm64 bundle.
      Spec: [`wp-0.3-container-trust-launchers.md`](./wp-0.3-container-trust-launchers.md) · L
- [ ] **WP 0.4** — Loopback API hardening: Origin/Host allow-list, CSRF and DNS-rebinding defence,
      security headers, git subprocess env minimised.
      Spec: [`wp-0.4-loopback-api-hardening.md`](./wp-0.4-loopback-api-hardening.md) · M
- [ ] **WP 0.5** — Posture rule false positive (getter flagged as mutation), error-finding triage on
      the owner's servers, fleet chip without a risk band until accepted, one severity vocabulary.
      Spec: [`wp-0.5-posture-rule-severity-vocabulary.md`](./wp-0.5-posture-rule-severity-vocabulary.md) · M
- [ ] **WP 0.6** — `ci.yml` with the four-command gate, e2e and a build matrix; both GitHub Actions
      examples executed once; self-scan budget figure reconciled.
      Spec: [`wp-0.6-ci-gate.md`](./wp-0.6-ci-gate.md) · M
- [ ] **WP 0.7** — README and product-page truth-up: tokenizer wording (+ Anthropic `count_tokens`
      profile), "drafted fix" wording, judge prerequisite, inspector claim, ports, screenshots from
      demo data, subscription-terms check.
      Spec: [`wp-0.7-front-page-claims.md`](./wp-0.7-front-page-claims.md) · M

### Phase 1 — First run and hand-off

- [ ] **WP 1.1** — Demo seed (neutral dataset), `demo-snapshot save|restore`, "Load demo data",
      wizard preset for the workbench's own `/api/mcp` server.
      Spec: [`wp-1.1-demo-seed-snapshot.md`](./wp-1.1-demo-seed-snapshot.md) · M
- [ ] **WP 1.2** — Import MCP servers from `claude_desktop_config.json` / `.mcp.json` / Cursor
      config; analyzer quick starts; research presets only behind the Hub flag.
      Spec: [`wp-1.2-config-import-quickstarts.md`](./wp-1.2-config-import-quickstarts.md) · M
- [ ] **WP 1.3** — Testing first-run checklist (Provider → Environment → Test → Judge → Run), judge
      auto-default, linked empty states, launcher states what a run will load.
      Spec: [`wp-1.3-testing-first-run.md`](./wp-1.3-testing-first-run.md) · M
- [ ] **WP 1.4** — User guide served in-image at `/docs`, Help + Report a problem in the shell,
      redacted diagnostics export, pre-flight / demo-readiness panel.
      Spec: [`wp-1.4-docs-help-diagnostics-preflight.md`](./wp-1.4-docs-help-diagnostics-preflight.md) · M
- [ ] **WP 1.5** — Transcript retention defaults + export redaction, metadata-only token scope,
      Anthropic egress data-flow statement, mission and auto-accept approval gaps closed or documented.
      Spec: [`wp-1.5-transcript-retention-dataflow-approvals.md`](./wp-1.5-transcript-retention-dataflow-approvals.md) · L

### Phase 2 — Information-hierarchy relayouts (most relevant information first, every view)

- [ ] **WP 2.1** — Shell IA for 1440×900: ≤ 11 nav entries (8 + Settings with the Hub off), active
      item always visible, demoted Scans / Review / Review rubrics / Compatibility / Watch rules,
      sidebar footer, dock adopts the app theme; the app-wide hierarchy rules file.
      Spec: [`wp-2.1-shell-ia.md`](./wp-2.1-shell-ia.md) · M
- [ ] **WP 2.2** — Dashboard Overview relayout (attention stack → top saving → fleet → trend →
      activity), one issue count, range honesty, Testing/Issues tab states.
      Spec: [`wp-2.2-dashboard.md`](./wp-2.2-dashboard.md) · M
- [ ] **WP 2.3** — Servers overview card/table recipe v2; server-detail header, KPI strip, tabs in
      the URL, Tools column clipping, Issues card layout, "Tests" → "Model limits".
      Spec: [`wp-2.3-servers.md`](./wp-2.3-servers.md) · M
- [ ] **WP 2.4** — De-rail Scans, posture folded into the scan KPI strip, Compare with Δ as the
      result and neutral change colours.
      Spec: [`wp-2.4-scans-compare.md`](./wp-2.4-scans-compare.md) · M
- [ ] **WP 2.5** — Advisor summary band + compact list + headline number, server-scope
      recommendations, savings reconciliation, Copy/Apply `allowedTools`, evidence grouping.
      Spec: [`wp-2.5-advisor.md`](./wp-2.5-advisor.md) · M
- [ ] **WP 2.6** — Skills: cards carry footprint/security/usage, Overview outcome strip, tabs 9 → 7,
      Quality consolidation, Usage outcome columns, vertical outline + fitView, Studio labelled preview.
      Spec: [`wp-2.6-skills.md`](./wp-2.6-skills.md) · M
- [ ] **WP 2.7** — Testing home and launcher: outcome-first collections/tests/suites, suite hero =
      results, launcher "what will load" + cost estimate as hero, Metrics "Soon" removed.
      Spec: [`wp-2.7-testing-home-launcher.md`](./wp-2.7-testing-home-launcher.md) · M
- [ ] **WP 2.8** — Runs feed chrome diet + "+ Filter" defect + single grade encoding; run console
      verdict band, outcome-first rail, one cache/context number, full-height Steps, failure banner,
      "Not rated yet", settled `tool_call` steps, cost grammar.
      Spec: [`wp-2.8-runs-feed-console.md`](./wp-2.8-runs-feed-console.md) · L
- [ ] **WP 2.9** — Compatibility thresholds that can go green + dated dataset; Environments
      identity-first columns and credential health from runs; readable watch-rule editor.
      Spec: [`wp-2.9-compatibility-environments-setup.md`](./wp-2.9-compatibility-environments-setup.md) · M
- [ ] **WP 2.10** — Assistant surfaces (flag on): start surface, compact rail, sessions table,
      agents tree/usage reconciled, audit timestamps, dock starter contrast + one error surface;
      audit/notification recording restored.
      Spec: [`wp-2.10-assistant-surfaces.md`](./wp-2.10-assistant-surfaces.md) · L

### Phase 3 — Vocabulary and consistency

- [ ] **WP 3.1** — Planning ids and raw wire enums scrubbed from UI copy; shared label maps with a
      guardrail test.
      Spec: [`wp-3.1-copy-scrub-label-maps.md`](./wp-3.1-copy-scrub-label-maps.md) · M
- [ ] **WP 3.2** — One glossary (test / check / verify, session vs conversation, agent, runs not
      cells), one severity ramp, status spelling, absent-value rule, cost/token vocabulary, issue
      title template — enforced by tests.
      Spec: [`wp-3.2-glossary-vocabulary.md`](./wp-3.2-glossary-vocabulary.md) · M
- [ ] **WP 3.3** — Error panels with a Try-again action and short titles, empty-state rewrite, ⓘ
      sentence inline on zero-state views, one loading recipe.
      Spec: [`wp-3.3-error-empty-states.md`](./wp-3.3-error-empty-states.md) · M
- [ ] **WP 3.4** — One definition per number in `packages/shared` (cache share, startup tokens,
      latest scan, tool-call count, first-measured, issue and session counts); URL state for every
      tab, version, session and filter; group-by/columns persistence.
      Spec: [`wp-3.4-one-number-url-state.md`](./wp-3.4-one-number-url-state.md) · M

### Phase 4 — Acceptance and demo proof

- [ ] **WP 4.1** — Owner acceptance Sitting A + RM-26 WP 4.4 through the Docker image; Sittings
      B/C/D and RM-14/17/22/23/25 parked explicitly; no new feature phase until this ledger is green.
      Spec: [`wp-4.1-owner-acceptance.md`](./wp-4.1-owner-acceptance.md) · M
- [ ] **WP 4.2** — Demo rehearsal: the 10-minute path as a repeatable pre-flight checklist,
      screenshots regenerated from the demo seed, comparison page, one closed-loop example recorded.
      Spec: [`wp-4.2-demo-rehearsal-assets.md`](./wp-4.2-demo-rehearsal-assets.md) · M
- [ ] **WP 4.3** — Three existing illustrations placed into the first-run empty states; RM-14
      Phases 2–4 deferred behind RM-18.
      Spec: [`wp-4.3-illustrations-in-product.md`](./wp-4.3-illustrations-in-product.md) · S

## Owner-acceptance

Not started — nothing is built yet. The hand checks that no test can stand in for, to be run on the
merged build at 1440×900 in both themes when each phase closes:

- [ ] Phase 0: a fresh database boots with the Hub off; `docker compose up` and the offline bundle
      show the dashboard through the published port on a clean macOS and a clean Windows machine;
      Settings › About, `/api/health`, the image tag and the changelog print the same version; the
      fleet page shows no risk band that a heuristic false positive produced.
- [ ] Phase 1: a zero-data install reaches a scanned server, a registered skill and a graded run from
      "Load demo data" alone; "Import from config file" registers the servers of a real
      `claude_desktop_config.json`; `/docs` opens from the sidebar footer.
- [ ] Phase 2: on every view in the register, the first viewport shows what the WP's Target layout
      names first; the sidebar at 900px shows the current page's entry; no number appears twice on one
      viewport; no identifier is truncated while metadata keeps its width.
- [ ] Phase 3: the guardrail tests (planning ids, raw enums, status spellings, absent values) are
      green; the glossary terms are the only ones on screen.
- [ ] Phase 4: the demo pre-flight checklist passes on the demo seed in both themes; the README
      screenshots match the running app.

## Follow-ups found while planning (not part of any WP's scope)

- The illustration design system (RM-14) and the Skill Studio (RM-22/RM-23) keep their own ledgers;
  this plan only labels, places or hides what they ship today.
- Team-server authentication (RM-25) remains the prerequisite for any shared-instance use; WP 1.5
  documents the single-owner boundary, it does not build auth.
