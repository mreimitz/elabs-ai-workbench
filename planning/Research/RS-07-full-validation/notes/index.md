# Research Notes

## Concepts

* [API package review — production readiness](02-api-review.md) - Part of the full-validation series. Scope: apps/api/src/ (all 22 subdirectories + index.ts, ~46 000 lines across 159 files). apps/api/test/ was consulted only to judge coverage gaps.
* [Web package review — apps/web/src/](03-web-review.md) - Date: 2026-07-11 · Reviewer: production-readiness code review (automated deep pass)
* [Production-readiness review 04 — Shared contract & infrastructure](04-shared-contract-infra.md) - Date: 2026-07-11 · Reviewer: automated agent pass (shared-contract / config / Docker / CI / e2e scope)
* [05 — Dead code, duplication & dependency analysis](05-dead-code-duplication.md) - Automated tooling pass (jscpd · knip · ts-prune · depcheck · grep sweeps) over the pnpm
* [06 — Security Review](06-security-review.md) - Target: MCP Token Footprint (Fastify API + React 19 SPA, SQLite, connects to arbitrary MCP servers, stores encrypted credentials, ingests skill zips, runs LLM/provider calls and a spawned…
* [Docs-vs-Code Consistency Audit — 07](07-docs-consistency.md) - Release-candidate validation pass over CLAUDE.md, README.md, .claude/rules/, the
* [Quality gate — clean-checkout run](08-quality-gate.md) - Part of the full-validation series. This documents an actual execution of the project's
