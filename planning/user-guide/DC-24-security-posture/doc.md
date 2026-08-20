---
type: "Documentation"
title: "Security posture"
description: "The deterministic security analyzer over persisted scans and skills: eighteen frozen rules, a 0-100 score, the Security tabs and posture badges, the scan-to-scan and version-to-version diff, the posture section in exported reports, and the no-new-security-findings CI gate."
tags: ["documentation", "DC-24"]
timestamp: "2026-08-20T16:54:50Z"
status: "draft"
---

# Security posture

## Subject

The deterministic security analyzer over persisted scans and skills: eighteen frozen rules, a 0-100 score, the Security tabs and posture badges, the scan-to-scan and version-to-version diff, the posture section in exported reports, and the no-new-security-findings CI gate.

## Scope

**In:** The eleven server rules and seven skill rules and their severities; the score formula and its bands; evidence redaction; the Security tab on a scan and on a skill version; posture badges in the servers list; the posture diff and its four refusals; the posture section in exported scan and server reports; how the CI gate consumes the same comparison.

**Out:** Token counting and the footprint itself (DC-03); report export mechanics other than the posture section (DC-06); the skills registry and inspector at large (DC-07); writing and running a CI gate file (DC-19); MCP server registration and auth (DC-02).

## Where the code lives

- `packages/shared/src/security-posture.ts, apps/api/src/security/, apps/api/src/reports/security-section.ts, apps/web/src/features/security/`

## Delivered increments

No delivered increments have been recorded yet.
