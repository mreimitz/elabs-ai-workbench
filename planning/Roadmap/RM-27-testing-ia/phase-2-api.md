---
type: "Work Package Spec"
title: "Phase 2 \u2014 API (WP specs)"
description: "Size: M \u00b7 Depends on: 1.1, 1.2 \u00b7 API-only (batch 2, parallel-safe with 2.2 + 3.0"
tags: ["roadmap", "RM-27"]
timestamp: "2026-08-20T13:47:37Z"
status: "final"
---
# Phase 2 — API (WP specs)

## WP 2.1 — Collections git-decouple
**Size:** M · **Depends on:** 1.1, 1.2 · API-only (batch 2, parallel-safe with 2.2 + 3.0 —
stays inside `apps/api/src/collections/`)

**Objective:** a collection is a folder first, a git remote second. Local collections have full
CRUD; binding a repo later enables sync unchanged.

**Files:** `apps/api/src/collections/*` (routes/service/repository as they exist today),
tests `apps/api/test/collections-local.test.ts` (new; leave existing collection/sync tests
untouched and green).

**Semantics:** create/update without a binding; **bind-later** update validates the full group
+ PAT discipline (write-only, encrypted) and runs the same SSRF/URL checks as today; unbinding
is out of scope (owner call later). `/sync`, `/status`, `/resolve` on an unbound collection →
honest 400 with the shared `REPO_NOT_BOUND` error code. **Local guarantees** (per D-T4):
undeletable, not repo-bindable, reserved name; deleting any other collection reassigns its
tests/suites to Local (app-level, transactional — today's FK is `ON DELETE SET NULL`).

**Acceptance:** local lifecycle (create → hold tests → delete other collection ⇒ members move
to Local); unbound sync/status/resolve → 400 typed error; bind-later then the existing offline
`file://` bare-repo sync E2E passes unchanged; Local cannot be deleted or bound; PAT never
returned; gate green.

## WP 2.2 — Inline-plan suite runs (one engine for suite · collection · adhoc)
**Size:** L · **Depends on:** 1.1, 1.2 · API-only (batch 2 — touches `apps/api/src/suites/*`
+ `apps/api/src/index.ts`, disjoint from 2.1)

**Objective:** the owner-addendum execution model: every multi-test execution is a suite-run
over a **plan**. One endpoint accepts a plan from three sources and hands it to the existing
orchestrator — run-a-collection and interactive sessions come for free.

**Files:** `apps/api/src/suites/plan-routes.ts` (new), `apps/api/src/suites/orchestrator.ts`
(extend the entry to accept an inline plan per D-T5 — do not fork it),
`apps/api/src/index.ts` (register the new routes), tests
`apps/api/test/run-plan.test.ts` (new).

**Semantics:** `POST /api/run-plans` (body = `runPlanInputSchema` from WP 1.1):
`source:'suite'` → resolve the suite's plan (existing behavior, now via the same path);
`source:'collection'` → plan = all tests of the collection × chosen scenarios × reps;
`source:'adhoc'` → explicit `testIds` × `scenarioIds` × reps. All three produce a normal
suite-run (matrix, KPI rail, cost cap, analytics — nothing bespoke). Per D-T5 recommendation:
no Suite row for adhoc/collection — snapshot `source` + plan on the suite-run; "Save as suite"
is the existing suites CRUD called by the web, not this endpoint. Cost-cap + guardrail
semantics identical to suite runs today.

**Acceptance:** all three sources produce a suite-run whose members equal the plan (count +
pairing); collection source picks up exactly the collection's current tests at launch time;
existing `POST /api/suites/:id/run` (or current trigger route) keeps working (compat shim or
delegation — no breaking change); cost cap rejects unpriced models exactly as today; replay/
persistence of members unchanged; gate green.
