# Security posture — a deterministic analyzer over persisted scans and skills

## Concepts

* [Security posture — a deterministic analyzer over persisted scans and skills](item.md) - Add a deterministic, versioned analyzer that turns persisted scans and skills into findings and a score: tool-poisoning heuristics, annotation sanity, schema hygiene, OAuth scope breadth and a skill security roll-up, diffable release to release and usable as a CI assertion.
* [Security posture — work-package status ledger · PRIORITY: HIGH](STATUS.md) - Living state for the security-posture plan, read and updated by /next-wp security-posture.
* [WP 1.1 — the security-posture contract: findings, report, score, rule-id registry](wp-1.1-contract.md) - Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the
* [WP 1.2 — server analyzer: poisoning / annotation / schema / OAuth rules + score](wp-1.2-server-analyzer.md) - Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the
* [WP 1.3 — skill analyzer: security-surface roll-up into the same report shape + score](wp-1.3-skill-analyzer.md) - Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the
* [WP 1.4 — posture diff: scan↔scan and version↔version (added / resolved / unchanged findings)](wp-1.4-posture-diff.md) - Phase 1 of README.md. Ledger: STATUS.md. Shared rules: the
* [WP 2.1 — Security UI: tabs on the scan and the skill, posture badges in the servers list, the diff view](wp-2.1-security-ui.md) - Surface the posture analyzer in the app: a Security tab on the scan detail and in the skill inspector, a posture badge per server in the servers list, and a baseline-picker diff view — both themes, keyboard reachable, brand-ui only.
* [WP 2.2 — report-export integration: the scan, server and skill reports gain a posture section](wp-2.2-report-export.md) - Fold the posture report into the existing JSON and Markdown exports so an exported document carries the findings, the score and the analyzer version alongside the token footprint.
