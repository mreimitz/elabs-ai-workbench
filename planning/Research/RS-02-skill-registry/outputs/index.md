# Research Outputs

## Concepts

* [03 — Data model](03-data-model.md) - New tables live in apps/api/src/db/schema.ts (created with CREATE TABLE IF NOT EXISTS, evolved
* [04 — Versioning & deep "what-changed" diff](04-versioning-and-diff.md) - A version is an immutable snapshot (skillversions + its skillfiles). Versions are created,
* [05 — API surface & shared contract](05-api-surface.md) - Contract-first: add types + zod to packages/shared first, then the API, then the web. Routes
* [06 — Ingestion pipeline, GitHub import, security](06-ingestion-and-github.md) - Lives in apps/api/src/skills/ — ingest-service.ts (parse/validate/store), git-service.ts
* [07 — Web UI plan (the enterprise-grade inspector)](07-ui-plan.md) - 100% @elabs-ai/components- (enforced by the enforce-brand-ui hook), two themes, semantic tokens, useState +
* [08 — Phase 2: attach skills to scenarios](08-scenario-attachment.md) - Mirrors the scenarioservers attachment exactly (02), adding
* [09 — Implementation plan (work packages)](09-implementation-plan.md) - Sequenced, contract-first, each WP ending green on pnpm typecheck && pnpm test && pnpm build.

## Sections

* [Mockups](mockups/) - Browse mockups.
* [Schema](schema/) - Browse schema.
