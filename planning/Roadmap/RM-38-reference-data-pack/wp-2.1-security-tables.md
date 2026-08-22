---
type: "Work Package Spec"
title: "WP 2.1 — the security rule registry, its frozen id ledger, and every signature list into the pack"
description: "Phase 2 of item.md. Ledger: STATUS.md. The analyzers keep their logic and lose their literals."
tags: ["roadmap", "RM-38"]
timestamp: "2026-08-22T18:37:00Z"
status: "final"
---
# WP 2.1 — the security rule registry, its frozen id ledger, and every signature list into the pack

Phase 2 of [`item.md`](./item.md). Ledger: [`STATUS.md`](./STATUS.md). **Depends on WP 1.2.**

## Why, and the risk this WP owns

Prompt-injection payloads, credential-shaped parameter names and over-broad scope patterns change on
attackers' schedule. Today each is a literal in `apps/api/src/security/*.ts`, so recognising a new
payload needs a release. Moving them is the point of the item.

**This is also the WP with the sharp edge.** `SECURITY_RULES` feeds the `no-new-security-findings` CI
assertion, whose finding identity is `(ruleId, anchor)` and whose severity floor decides pass or fail.
A fetched file that renames an id or lowers a severity would silently change someone's CI verdict.
D-DP6 and D-DP7 exist for exactly this, and they are this WP's obligation to implement — not
documentation, a load-time refusal.

## Scope

1. **`data-pack/security/rules.json`** — the 18 rules currently in
   `packages/shared/src/security-posture.ts:130` (11 `subject: "server"`, 7 `subject: "skill"`), each
   `{ id, category, subject, severity, title, rationale, deprecated? }`, plus:
   - `analyzerVersion` (today `3`), and
   - `idLedger: [...]` — every rule id ever shipped, append-only.

2. **`data-pack/security/signatures.json`** — every ageing literal, moved verbatim:
   - from `apps/api/src/security/text-scan.ts`: `INJECTION_PHRASES` (13 entries with their
     `requiresInstructionObject` flag), `INJECTION_INSTRUCTION_OBJECTS`, `INJECTION_OBJECT_MODIFIERS`,
     the three hidden-instruction patterns, `INVISIBLE_CODE_POINT_RANGES`, `EVIDENCE_CONTEXT_CHARS`;
   - from `apps/api/src/security/analyzer.ts`: `DESTRUCTIVE_VERBS`, `MUTATING_VERBS_IN_NAME`,
     `MUTATING_VERBS_IN_DESCRIPTION`, `OPEN_WORLD_NAME_TERMS`, `OPEN_WORLD_DESCRIPTION_TERMS`,
     `OPEN_WORLD_PHRASE_PATTERN`, `SECRET_PARAMETER_PATTERN`, `SECRET_PARAMETER_MEASUREMENT_SUFFIXES`,
     `BROAD_OAUTH_SCOPE_PATTERNS`, `SCHEMA_WALK_MAX_DEPTH`, `SCHEMA_WALK_MAX_NODES`, and the
     oversized-description ceiling;
   - from `apps/api/src/security/skill-analyzer.ts`: `BROAD_ALLOWED_TOOL_PATTERNS`;
   - from `packages/shared/src/skill-security.ts`: `SKILL_SCRIPT_LANG_LABELS`, `SKILL_NETWORK_REF_PATTERN`.

3. **Regex is data (D-DP9).** Patterns ship as `{ source, flags }` strings with a source-length cap,
   compiled **once** at pack load. A pattern that fails to compile, or exceeds the cap, **refuses the
   pack** — it never throws mid-scan.

4. **Load-time enforcement.**
   - `idLedger` append-only vs the bundled ledger, else refuse (D-DP6).
   - Any severity differing from the bundled registry requires a greater `analyzerVersion`, else
     refuse (D-DP7).
   - The rule set the analyzers can emit and the rule set the pack declares must be equal in both
     directions — a declared rule no analyzer implements, or an emitted id the pack does not declare,
     is a red test (this preserves the existing `SECURITY_RULES` ↔ analyzer reconciliation).

5. **The analyzers keep their logic.** `analyzeScanTools` stays pure (the existing source-scan test
   that fails on `better-sqlite3` / `node:fs` / `fastify` / `Date.now(` must still pass); it now takes
   its tables from the resolved pack rather than from module constants.

## Explicitly out of scope

`SECURITY_ANALYZER_VERSION`'s *meaning*, the score formula, `computeSecurityScore`,
`compareSecurityFindings`, `redactSecurityEvidence`, `capSecurityFindings`, `createSecurityFinding`,
`diffSecurityReports`, the zod shapes, and the routes. Those are contract, not data (D-SP5: a rule
still may not choose its own severity — it reads it from the registry, wherever the registry lives).
No advisor threshold moves here — that is WP 2.2.

## Acceptance

- [ ] **Byte-identity**: a security report and a security diff over the existing fixtures — server and
      skill — are byte-identical before and after. The migration changed the address of the tables,
      nothing else.
- [ ] No security literal remains in `apps/api/src/security/*.ts` or `packages/shared/src/skill-security.ts`;
      a source-scan test fails on a re-introduced phrase list or verb array.
- [ ] Every regex in the pack compiles at load; the cap is enforced.
- [ ] The bench's own MCP mount still scores what it scores today (recorded in RM-20 as 49 / high risk
      on 51 `info` findings) — or the change is explained, not absorbed.
- [ ] Gate green.

## Teeth (each must go red, then be restored)

1. Rename a rule id in the pack → refused (D-DP6).
2. Lower one severity without bumping `analyzerVersion` → refused (D-DP7).
3. Bump `analyzerVersion` **and** lower a severity → accepted, and the posture diff refuses to compare
   the new report against a baseline computed under the old version.
4. Ship a regex with catastrophic backtracking beyond the source cap → refused at load, not at scan.
5. Remove an id from `idLedger` while keeping the rule → refused.
6. Declare a rule no analyzer emits → red test.
