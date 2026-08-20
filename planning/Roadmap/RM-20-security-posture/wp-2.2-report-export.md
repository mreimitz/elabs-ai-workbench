---
type: "Work Package Spec"
title: "WP 2.2 — report-export integration: the scan, server and skill reports gain a posture section"
description: "Fold the posture report into the existing JSON and Markdown exports so an exported document carries the findings, the score and the analyzer version alongside the token footprint."
tags: ["roadmap", "RM-20"]
timestamp: "2026-08-20T17:10:00Z"
status: "final"
---

# WP 2.2 — report-export integration

**Phase:** 2 · **Size:** S · **Depends on:** 1.4

Ledger: [`STATUS.md`](./STATUS.md). Item: [`item.md`](./item.md). Shared rules: the
[testing conventions](/Roadmap/RM-26-testing/conventions.md) + the repo rules in `.claude/rules/`.

**Runs after WP 2.1 merges** — both need `apps/api/src/index.ts`, and two agents must not edit one
file in parallel.

---

## Objective

An exported report is what leaves the app: pasted into a PR, mailed to a vendor, attached to a review.
Today it carries the token footprint and nothing about posture. Add a **posture section** to the
existing scan, server and skill exports — the score, the band, the per-severity counts, the analyzer
version, and the findings themselves — in both the JSON and the Markdown renderings.

## Locked decisions this WP inherits

- **D-SP3/D-SP6** — the score, band and finding order come off the report. Nothing is re-sorted,
  re-scored or re-banded here, and no count is derived from `findings.length` (`counts` describes
  **all** findings; a `truncated` report must say so in the export, or the document lies).
- **D-SP4** — evidence is already redacted. Do not un-escape it, do not re-escape it, and **never**
  widen what is exported: no raw payload, no absolute local path, no secret value.
- **D-SP8** — computed on read. The export analyses on demand; nothing is persisted.
- **D-SP10/D-SP16** — a non-`success` scan and an unreadable `SKILL.md` are refusals, not clean
  reports. See D-SP24 for what an export does with that.
- **API conventions** (`.claude/rules/architecture.md`) — **additive response fields only** during the
  MVP. An existing consumer of `GET /api/reports/scan/:id/json` must keep working unchanged.

## Decisions to lock in this WP (record them in the ledger's decision log)

- **D-SP24 — a report that cannot be scored says so IN the document; it never fails the export and it
  never renders as clean.** The posture section is **optional** in the JSON (absent, or present with an
  explicit `unavailable` reason) and always present in the Markdown, where an unscorable subject prints
  one honest line naming why (the scan was not `success`; the skill version has no readable SKILL.md).
  An export that 500s because posture could not be computed would make the token footprint
  unobtainable for exactly the broken servers an operator most wants to document — and an export that
  silently omitted the section would read as "nothing found".
- **D-SP25 — the Markdown posture section is a fixed, greppable shape.** One `## Security posture`
  heading, a score line naming the analyzer version, a per-severity count line, then a findings table
  (severity · rule · anchor · message) and the evidence beneath each finding as a fenced block. Fixed
  because these documents get diffed and grepped by people and by CI; a section whose shape moves with
  its content is a section nobody can automate against. `renderAssertionMarkdown` in the CI workstream
  is the precedent for "one renderer, fixed shape".
- **D-SP26 — the skill export gains posture the same way, and skill reports get their own endpoint only
  if one does not already exist.** Read `apps/api/src/reports/routes.ts` first. If there is no skill
  report endpoint today, **do not invent one** — say so in your report and limit this WP to the scan
  and server exports; adding a whole new export surface is a scope decision for the owner, not a
  side-effect of a posture section.

---

## What we're building

1. **`apps/api/src/reports/security-section.ts`** (new) — the ONE derivation of the posture section, in
   both shapes: the JSON object and the Markdown string. Every export calls it; none re-renders posture
   itself (the D-SP17 discipline, applied to rendering).
2. **`apps/api/src/reports/{reports,server-report,server-report-markdown}.ts`** — the scan and server
   exports gain the section, additively.
3. **`apps/api/src/reports/routes.ts`** + **`apps/api/src/index.ts`** — the reports module gains the
   security port (the existing `analyzeScan` / `analyzeSkillVersion`, injected exactly as the CI
   assertions engine injects `security.analyze` — D-MCP4, re-project rather than reimplement).
4. **`packages/shared`** — the additive type for the JSON section + its `.strict()` zod schema,
   contract-first. **Zero removed lines** in `security-posture.ts`.
5. **Tests** — extend the existing report tests; add fixtures for a scored subject, a clean subject and
   an unscorable one.

### Explicitly NOT in this WP

Any **UI** (WP 2.1) · a new rule, matcher, severity or rule id · a change to the analyzers, the score,
the order, the redactor or the differ · a **new export surface** unless D-SP26's check says one already
exists · the posture **diff** in an export (a later, additive decision — say so rather than adding it) ·
a workbench MCP tool · a migration · a new runtime dependency · an environment variable · a feature
flag · persisting anything.

---

## Files

**New**
- `apps/api/src/reports/security-section.ts`
- test coverage alongside the existing report tests

**Modified**
- `packages/shared/src/security-posture.ts` (+ its test) — the section type + schema, additive
- `apps/api/src/reports/{reports,server-report,server-report-markdown,routes}.ts`
- `apps/api/src/index.ts` — the security port into the reports deps

**Zero-line diff**
- `apps/web/**` — WP 2.1's, not this WP's
- `apps/api/src/security/**` — the analyzers and the differ are read, never changed
- `apps/api/src/assertions/**`, `packages/shared/src/ci-assertions.ts`
- `apps/api/src/mcp-server/**`, `apps/api/src/db/**`
- `pnpm-lock.yaml`, every `package.json`, `.env.example`, `apps/api/src/config/env.ts`
- `planning/**`

---

## Acceptance

- **A1** — `GET /api/reports/scan/:id/json` and `/markdown`, and the server report's two renderings,
  each carry the posture section: score, band, analyzer version, per-severity counts (off `counts`,
  not `findings.length`) and the findings.
- **A2 (D-SP24)** — An unscorable subject exports successfully with an honest line naming why; it never
  renders as clean and never 500s. Pinned by a test using a non-`success` scan.
- **A3 (D-SP25)** — The Markdown section has the fixed documented shape; a test asserts the heading, the
  score line, the count line and the table header literally.
- **A4 (additive)** — Every pre-existing field of every export is unchanged; the existing report tests
  pass **unmodified** except where a new field is deliberately asserted.
- **A5 (D-SP4)** — Evidence appears exactly as the redactor produced it: invisible characters as
  `\uXXXX`, credentials as `«redacted»`. A test asserts a stored secret appears nowhere in an exported
  document.
- **A6 (one renderer)** — `security-section.ts` is the only place the posture section is built; a test
  or a grep proves no export re-renders it.
- **A7 (D-SP26)** — Either the skill export carries the section, or your report states plainly that no
  skill report endpoint exists and that inventing one was out of scope.
- **A8 (gate)** — `pnpm typecheck && pnpm test && pnpm build && pnpm lint`, plus
  `pnpm --filter @mcp-token-footprint/web test` separately, plus `pnpm okf:validate`. The 7 api
  compatibility failures and the 2 `all-models.json` lint errors are **pre-existing** — report them,
  never fix them silently. Measure the baseline first.
- **A9 (no drive-by scope)** — Every zero-line-diff path is clean; you did **not** touch any file under
  `planning/`.
