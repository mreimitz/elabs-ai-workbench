---
type: "Roadmap Item"
title: "Announcement readiness — multi-persona review remediation (2026-08)"
description: "Turn the 2026-08-21/22 multi-persona review of the running app (end user, product owner, UI/UX designer, QA engineer, presales, engineering/release, security & privacy, market analyst, UX copy) into executable work packages: relayout every view so the most relevant information comes first, close the defects and inconsistencies the review found, and clear the items that stand between the current build and a broad announcement."
tags: ["roadmap", "RM-37"]
timestamp: "2026-08-22T06:58:01Z"
status: "planned"
---

# Announcement readiness — multi-persona review remediation (2026-08)

## Goal

Turn the 2026-08-21/22 multi-persona review of the running app (end user, product owner, UI/UX designer, QA engineer, presales, engineering/release, security & privacy, market analyst, UX copy) into executable work packages: relayout every view so the most relevant information comes first, close the defects and inconsistencies the review found, and clear the items that stand between the current build and a broad announcement.

## Why it matters

The app is built out across twelve capability areas, but the review found the same faults repeating across views — counters that disagree on one screen, identifiers truncated while metadata keeps its width, configuration styled as outcome, failures rendered as measurements, severity words that overstate heuristic findings, and a navigation that does not fit a 900px sidebar — plus unproven hand-off paths and open announcement gate items (one name, one version, a licence, a container trust boundary that works, a first-run path). Sequencing them as one item keeps the announcement scope explicit, prioritised and measurable.

## Milestones

Work-package state lives in [`STATUS.md`](./STATUS.md); every action point is mapped in
[`review-register.md`](./review-register.md). The phases below are the milestones; each ticks when
all of its WPs are done and the phase's owner-acceptance line in the ledger is checked.

- [ ] Phase 0 — Announcement gate: WP 0.1 Hub as preview · WP 0.2 one name, one version, licence · WP 0.3 container trust boundary and launchers proven · WP 0.4 loopback API hardening · WP 0.5 posture false positive and severity vocabulary · WP 0.6 CI gate · WP 0.7 front-page claims truthed
- [ ] Phase 1 — First run and hand-off: WP 1.1 demo seed and snapshot · WP 1.2 config import and quick starts · WP 1.3 testing first-run checklist · WP 1.4 in-image docs, help, diagnostics, pre-flight · WP 1.5 transcript retention, data-flow statement, approval gaps
- [ ] Phase 2 — Information-hierarchy relayouts: WP 2.1 shell IA · WP 2.2 dashboard · WP 2.3 servers · WP 2.4 scans and compare · WP 2.5 advisor · WP 2.6 skills · WP 2.7 testing home and launcher · WP 2.8 runs feed and run console · WP 2.9 compatibility, environments, setup · WP 2.10 assistant surfaces
- [ ] Phase 3 — Vocabulary and consistency: WP 3.1 copy scrub and label maps · WP 3.2 glossary and vocabulary rules · WP 3.3 error, empty and loading states · WP 3.4 one definition per number and URL state
- [ ] Phase 4 — Acceptance and demo proof: WP 4.1 owner acceptance through the Docker image · WP 4.2 demo rehearsal and screenshots · WP 4.3 illustrations placed in empty states

## How the review was run

Nine persona reviews (end user, product owner, UI/UX designer, QA engineer, presales, engineering and
release, security and privacy, market analyst, UX copy) plus a live walkthrough of every route,
menu, dialog and button at 1440×900 in Light theme (Dark spot-checked), on the owner's instance with
the Assistant flag on. Each persona produced findings with a severity (P0 blocks announcing broadly ·
P1 hurts the first week · P2 noticeable · P3 polish) and an effort (S ≤ 1 day · M 2–5 days · L > 1
week); the register merges them into one action list. Findings that RM-36 already scopes are not
re-filed.

## Linked research

- [RS-05](/Research/RS-05-langfuse-landscape/topic.md)
- [RS-07](/Research/RS-07-full-validation/topic.md)
- [RS-10](/Research/RS-10-open-questions/topic.md)
