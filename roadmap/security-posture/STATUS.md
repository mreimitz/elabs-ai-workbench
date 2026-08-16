# Security posture — work-package status ledger · **PRIORITY: HIGH**

Living state for the **security-posture** plan, read and updated by `/next-wp security-posture`.
A box is ticked **only** when the WP's Acceptance is met and the gate
(`pnpm typecheck && pnpm test && pnpm build && pnpm lint`) is green.

**Legend:** `[ ]` open · `[x]` done. Done lines: `… — done <YYYY-MM-DD> · wp/security-posture/<id>`.

> Plan + invariants in [`README.md`](./README.md). Pure read-model over persisted scans/skills —
> no schema migration expected; if one becomes necessary, claim the next free `user_version` via
> the cross-workstream decision-log convention.

## Phase 1 — Analyzer
- [ ] WP 1.1 — contract: finding/report/score shapes, rule-id registry, `SECURITY_ANALYZER_VERSION`
- [ ] WP 1.2 — server analyzer: poisoning/annotation/schema/OAuth rules + score
- [ ] WP 1.3 — skill analyzer: security-surface roll-up + score
- [ ] WP 1.4 — posture diff (scan↔scan, version↔version)

## Phase 2 — Surfacing
- [ ] WP 2.1 — UI: Security tabs, list badges, diff view (both themes)
- [ ] WP 2.2 — report export integration

## Decision log
_Entries: date · decision · rationale._

## Owner acceptance (owner-only)
- [ ] A deliberately poisoned fixture server (injection phrasing + secret-shaped param +
      contradictory annotation) shows the expected findings with readable evidence in both
      themes; a clean server scores clean; the diff shows a finding appearing and resolving —
      accepted: ____
