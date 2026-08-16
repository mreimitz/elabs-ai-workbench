# Phase 3 — Web IA (WP specs)

> Parallel-safety rule for this phase: **WP 3.0 is the only WP that edits
> `apps/web/src/App.tsx` and `apps/web/src/components/AppShell.tsx`**; 3.1/3.2 own disjoint
> feature folders and put new client fns in **feature-local** api files (not
> `apps/web/src/lib/api.ts` — 3.1 owns that file in batch 3). 3.3 and 3.4 run solo.

## WP 3.0 — IA shell: nav 7→4, route moves, redirects
**Size:** M · **Depends on:** — · Web-only (batch 2; re-points **existing** views, no feature
work)

**Objective:** the new skeleton, landed first so every later WP builds into its final home.

**Files:** `apps/web/src/components/AppShell.tsx` (TESTING_NAV_ITEMS, ~line 69),
`apps/web/src/App.tsx` (routes ~lines 731–742).

**Semantics:** Testing group becomes **Collections · Runs · Compatibility**; new **Setup**
group (sidebar section, same pattern as the existing groups) holding **Environments** →
`/testing/environments` rendering the existing `ScenariosView` (component rename happens in
3.4). Route moves + `Navigate replace` redirects (pattern at App.tsx line 688):
`/testing/tests` → `/testing/collections` · `/testing/scenarios` → `/testing/environments` ·
`/testing/compare` → `/testing/runs/compare` (CompareRunsView rendered there unchanged for
now) · `/testing/suites` → `/testing/collections`. **Unchanged:** `/testing/runs`,
`/testing/runs/new`, `/testing/runs/:runId`, `/testing/suites/:suiteId` (detail stays
routable), `/testing/suite-runs/:suiteRunId`, `/testing/compatibility`. Keep icon choices
sensible (`FolderGit2` may become a plain folder icon now git is optional — verify against
`lucide-react`).

**Acceptance:** every old URL lands somewhere correct (manually walk all four redirects +
the five unchanged deep links against the running app); nav shows 4 items + Setup group in
both themes; no feature view is orphaned (TestsView temporarily reachable via
CollectionsView untouched — it is re-homed in 3.1); gate green.

## WP 3.1 — Collections as the test home
**Size:** L · **Depends on:** 3.0, 2.1 · Web-only (batch 3, parallel-safe with 3.2 + 4.1)

**Objective:** Q1/Q2 in the UI: collections are where tests live and are managed; Local is
pinned; git is an optional binding on the collection.

**Files:** `apps/web/src/features/testing/collections/*` (CollectionsView, CollectionDetail —
grows tabs), `apps/web/src/features/testing/` test files (TestsView/TestEditor re-parented
under collections — move, don't duplicate), `apps/web/src/lib/api.ts` (collections client fns:
local create/update, bind).

**Semantics:** CollectionsView lists Local first (badge, undeletable); create-collection no
longer demands a repo (binding is a separate "Bind to GitHub" action/dialog on the detail —
same fields as today, PAT write-only). CollectionDetail = tabs **Tests · Suites · Git** —
Tests tab is the re-homed TestsView/TestEditor scoped to the collection (search/filter as
today); Suites tab lists the collection's suites (existing SuitesView list, scoped); Git tab =
the existing sync UI, or the bind CTA when unbound (no fake sync affordances). Empty states
per `interaction-guidelines.md`.

**Acceptance:** full test lifecycle happens inside a collection (create/edit/move between
collections); a repo-less collection can be created and later bound (then sync UI appears and
works against the offline E2E fixture); Local shows loose legacy tests after migration; both
themes verified by looking; gate green.

## WP 3.2 — Unified Runs surface: feed + drill + Compare tab
**Size:** L · **Depends on:** 3.0, 2.2 · Web-only (batch 3 — owns
`apps/web/src/features/testing/runs/` + the re-homed compare files only)

**Objective:** the owner-addendum results view: one feed for single runs and suite runs —
**summary → member list → drill into the session** — with Compare as a mode of Runs.

**Files:** the testing feature is **flat today** — this WP creates the
`apps/web/src/features/testing/runs/` subfolder and moves/owns exactly these current files:
`RunsView.tsx`, `CompareRunsView.tsx`, `compare-curve.ts` + `compare-derive.ts` (+ their
`.test.ts`), plus new suite-run summary/expansion components and a feature-local `runs-api.ts`
for any new client fns. (`use-run-stream.ts` is shared with the run console — read it, don't
move it.) CompareRunsView renders at `/testing/runs/compare` (route created by 3.0). Verified
2026-07-04: 3.1 owns `TestsView.tsx`/`TestEditor.tsx`/`collections/`; 3.2 owns the files above
— disjoint, so batch 3 stays parallel-safe.

**Semantics:** feed rows: single runs as today; suite runs as **summary rows** (source
badge suite/collection/adhoc, status, tests × environments × reps, pass/grade %, total cost,
duration) that expand to the member list and link to the existing suite-run console
(`/testing/suite-runs/:id`) — reuse its KPI/matrix pieces, don't rebuild them. Member rows
drill to the individual run console (`/testing/runs/:runId`). Compare tab = the existing
CompareRunsView + **multi-select in the feed → "Compare selected"** prefilling it. Streaming
discipline per `loading-states.md` (`loading` vs `isStreaming`; errors only at terminal
phases — mirror `use-run-stream.ts`).

**Acceptance:** a live suite run streams into the feed as a summary row without layout
collapse; expand → members → drill both directions (breadcrumbs back); compare flow reachable
from selection and from the tab; single-run UX unregressed; both themes; gate green.

## WP 3.3 — Run launcher: run-a-suite · interactive session · run-a-collection · Save as suite
**Size:** L · **Depends on:** 2.2, 3.1, 3.2 · Web-only (batch 4, **solo** — integrates into
3.1 + 3.2 surfaces)

**Objective:** Q4d/addendum: one "Run" entry, two paths; ad-hoc configurations become
repeatable by saving as a suite.

**Files:** `apps/web/src/features/testing/run-launcher/*` (new), integration points:
RunsView header ("New run"), CollectionDetail header ("Run collection"), test row ("Run
test"), suite row ("Run suite"); `apps/web/src/lib/api.ts` (run-plan client fn).

**Semantics:** launcher dialog/wizard (brand `Dialog`/`Wizard`): **Path 1 — Run a suite**:
pick suite → confirm knobs (reps/cost cap prefilled) → `POST /api/run-plans` source `suite`.
**Path 2 — Interactive session**: pick-or-create tests (from any collection) + pick-or-create
environment(s) inline → reps/cost cap → run (source `adhoc`); entry from a collection prefills
its tests (source `collection`); entry from a test row with ONE test × ONE environment uses
the existing lightweight single-run path (unchanged). **"Save as suite"** on any ad-hoc
configuration → existing suites CRUD (named, lands in the collection). After launch → navigate
to the suite-run console (or run console for single). Form hygiene per
`interaction-guidelines.md` (inline validation, focus first error, submit → spinner).

**Acceptance:** all four entry points launch correctly-shaped runs (verify member counts);
save-as-suite → the suite appears in the collection's Suites tab and reruns identically;
single test × single environment still uses the lightweight path; both themes; gate green.

## WP 3.4 — Environments rename sweep (UI labels only)
**Size:** M · **Depends on:** 3.1, 3.2, 3.3 · Web-only (batch 5, **solo** — cross-cutting;
runs LAST so it sweeps 3.1–3.3's new UI too)

**Objective:** Q4a: every user-visible "Scenario(s)" becomes "Environment(s)"; nothing on the
wire changes.

**Files:** cross-cutting label sites in `apps/web/src/features/testing/**` (~20–30 sites:
ScenariosView → EnvironmentsView file/export rename, run/suite/compare/launcher copy, column
headers, empty states, toasts) and `apps/web/src/features/compatibility/**` if any copy says
"scenario". **Not** `packages/shared`, **not** `apps/api` (identifiers, routes, types keep
`scenario`).

**Acceptance:** `grep -ri "scenario" apps/web/src --include='*.tsx'` leaves only identifiers/
API field names (no user-visible strings — spot-check rendered views, both themes); typecheck
catches all import renames; deep link `/testing/environments` still lands on the renamed view;
gate green.
