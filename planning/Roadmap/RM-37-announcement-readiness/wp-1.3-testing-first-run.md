---
type: "Work Package Spec"
title: "WP 1.3 — Testing first-run checklist, judge auto-default, linked empty states, launcher says what will load"
description: "Phase 1 of item.md. Ledger: STATUS.md. Turns the five-screen first run of the testing path into one checklist with live state and links, makes every launcher empty state a creating action, defaults the judge to the first priced credential, and makes environment rows and the launcher name the servers, tools and skills a run will load."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T07:10:00Z"
status: "final"
---
# WP 1.3 — Testing first-run checklist, judge auto-default, linked empty states, launcher says what will load

Phase 1 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md).

## Scope

`/testing/runs` empty state (`apps/web/src/features/testing/RunsView.tsx:787-797`), the run launcher
(`apps/web/src/features/testing/run-launcher/RunLauncher.tsx`, empties at `:728-733` and `:810-815`,
step 1 copy at `:598-630`), `/testing/environments` (`apps/web/src/features/testing/EnvironmentsView.tsx`,
`EnvironmentEditor.tsx`), the Report tab (`apps/web/src/features/testing/ReportTab.tsx`), provider
creation (`apps/api/src/providers/routes.ts:29`, `POST /api/providers`) and the judge resolver
(`apps/api/src/grading/judge-chain.ts:73` `readProviderJudge`, `GET/PUT /api/grading/judge-settings` in
`apps/api/src/grading/routes.ts:98-105`). Out of scope and filed elsewhere: the Step 3 relayout (cost
estimate as hero, one cost cap, limits under Advanced, glossary tooltips — wp-2.7, EU-15/EU-16), the
"Not rated yet" state and failure banner on the run console (wp-2.8, EU-02), server-side credential
health replacing "Never tested" (wp-2.9, UXC-19/ENG-15/EU-33), the pre-flight panel (wp-1.4, PS-18),
README/product-page wording "once a judge is configured" (wp-0.7, PO-09), and the demo seed that
short-cuts this chain (wp-1.1).

## Actions

1. **"Set up testing" checklist** on the `/testing/runs` empty state (`RunsView.tsx:787-797`) and as the
   launcher's first panel whenever a prerequisite is missing (`RunLauncher.tsx`, before step 1). Four rows
   with live state read from `GET /api/providers`, `GET /api/scenarios`, the tests list and
   `GET /api/grading/judge-settings` (`resolvedSource`): **Provider key** → `/settings/providers` ·
   **Environment** → `/testing/environments` (opens the new-environment editor) · **Test** →
   `/testing/collections` (opens the new-test editor in the Local collection) · **Judge** →
   `/settings/grading`. Each row: ✓ or "missing", one sentence of what it is, a link that returns to the
   launcher with its selections kept (`?returnTo=`). A fifth line "or Load demo data" (wp-1.1). **P1**
2. **Launcher empty states become actions**: "No tests yet" (`:728-733`) gains a "New test" button that
   opens `collections/TestEditor.tsx` in a nested dialog and selects the created test on save; "No
   environments yet" (`:810-815`) gains "New environment" opening `EnvironmentEditor.tsx` the same way.
   Copy stays one sentence; no empty state ends without a button. **P1**
3. **Judge auto-default**: in `POST /api/providers`, when `readProviderJudge` is null and the new
   credential's kind has a priced model (`isModelPriced`, `apps/api/src/providers/pricing.ts:214`), write
   the judge setting `{ providerCredentialId, model: <first priced model of that kind> }` through the
   same code path as `PUT /api/grading/judge-settings`. Never overwrites an existing setting; the CLI
   judge, when signed in, keeps precedence per `resolveJudgeSource`. Settings › Grading shows "Default
   judge set automatically from <credential label> — change". **P1**
4. **"Rating needs a judge" line**: when `resolvedSource` is none, the runs feed header
   (`RunsView.tsx`) and the Report tab (`ReportTab.tsx`) render one `role="status"` line "Rating needs a
   judge — choose one" linking to `/settings/grading`; it disappears once a judge resolves. No outcome
   chips are shown in that state (the chip/"Not rated yet" redesign itself is wp-2.8). **P1**
5. **Environment rows say what they load** (launcher step 2 and `EnvironmentsView.tsx`): each
   environment row shows `name · model · server chips ("demo-catalog · 12 tools · <startup tokens>") ·
   skill chips`; the Servers column of the environments table shows names as chips with the count as fallback
   beyond three; the launcher's environment search matches server and skill names too. Values come from
   the environment's server list joined to each server's latest scan (`totalTokens`, tool count). **P1**
6. **Launcher step 3 "What will load" line** above the estimate: "Loads demo-catalog (all 12 tools) +
   demo-catalog-analyst · startup tokens <n> · model demo-model"; when an environment restricts
   `allowedTools`, the line reads "n of m tools". Step 1's "judge" mention gets an inline link "configured
   in Settings › Grading" (the rest of EU-16's glossary is wp-2.7). **P1**
7. **Environments page ⓘ**: the one-line definition already shown inside the editor ("An environment is
   the harness — a provider, model, allowed tools, and guardrails a test runs against") becomes the
   page's toolbar ⓘ sentence and the empty-state description on `/testing/environments`. **P2**

## Acceptance

- [ ] Fresh DB (no demo data): `/testing/runs` shows the four-row checklist, all "missing"; each link lands
      on the named surface and returns to the launcher with prior selections intact (e2e).
- [ ] Adding one provider credential (test) flips the Judge row to ✓ without visiting Settings › Grading;
      an explicitly set judge is never replaced (test both orders).
- [ ] Both launcher empties open their editor in place and select the created item on save (test).
- [ ] Step 2 environment rows and the environments table show server chips with tool count and startup
      tokens; the table's Servers column never reads as a bare count when ≤ 3 servers are bound.
- [ ] Step 3 shows the "What will load" line for every selected environment, including the
      "n of m tools" form when `allowedTools` is set.
- [ ] The "Rating needs a judge" line appears with no judge and is absent with one (test); it is the only
      rating-related element on the Report tab in that state.
- [ ] Owner walk (recorded in wp-4.1): empty DB + one API key → first rated run in ≤ 10 minutes
      following only on-screen links.
- [ ] Every touched surface reads correctly in **both** themes at 1440×900.
- [ ] Gate green: `pnpm typecheck && pnpm test && pnpm build && pnpm lint`.

## Effort

**M** — one derived checklist with four data sources, two nested editors in the launcher, a small API
default with tests, and row/line additions that reuse the latest-scan numbers.

## Sources

PO-08 · PO-09 (judge default and banner; README wording → wp-0.7) · EU-13 · EU-14 · EU-16 (the judge
clause only; glossary/Advanced → wp-2.7) · EU-15 (→ wp-2.7, listed for traceability) · PS-18 (→ wp-1.4) ·
UXC-19 (→ wp-2.9) · presales B.4 "Grading and testing need credentials".
