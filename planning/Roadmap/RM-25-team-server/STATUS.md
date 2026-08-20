---
type: "Status Ledger"
title: "Team server \u2014 work-package status ledger \u00b7 PRIORITY: MEDIUM (after ci Phase 1)"
description: "Living state for the team-server plan, read and updated by /next-wp team-server. A box is"
tags: ["roadmap", "RM-25"]
timestamp: "2026-08-20T13:47:37Z"
status: "active"
---
# Team server — work-package status ledger · **PRIORITY: MEDIUM (after ci Phase 1)**

Living state for the **team-server** plan, read and updated by `/next-wp team-server`. A box is
ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/team-server/<id>`.

> Plan + invariants in [`README.md`](./item.md). **Blocked-on:** `../ci/STATUS.md` WP 1.1
> (service-token table alignment). WP 3.1's OIDC dependency is **owner-gated** — log the
> dependency decision before any code. Migrations: claim the next free `user_version` via the
> cross-workstream decision-log convention.

## Phase 1 — Accounts & enforcement
- [ ] WP 1.1 — contract + schema: users/sessions/roles, scrypt auth, bootstrap, route gating
- [ ] WP 1.2 — role enforcement matrix per API family + tests
- [ ] WP 1.3 — UI: login, user management, role-aware affordances (both themes)

## Phase 2 — Audit & ops
- [ ] WP 2.1 — audit log (append-only) + filterable view
- [ ] WP 2.2 — backup/restore + retention policy UI + multi-user concurrency review

## Phase 3 — SSO (owner-gated dependency)
- [ ] WP 3.1 — OIDC login (authorization-code + PKCE)

## Decision log
_Entries: date · decision · rationale._

## Owner acceptance (owner-only)
- [ ] Fresh instance bootstrap → admin login → create editor + viewer → viewer cannot mutate
      (verified in UI AND via direct API call) → audit shows the session's actions → backup then
      restore round-trips with secrets intact — accepted: ____
