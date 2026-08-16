# WP 1.9 — Hardening & docs

**Phase:** 1 · **Size:** M · **Depends on:** 1.6, 1.8

## Objective
Close Phase 1: enforce caps/guards end to end, polish empty/loading/error states and the security
surface, and update project docs to record the shipped capability.

## Why / references
[`../../research/skill-registry/06-ingestion-and-github.md`](../../research/skill-registry/06-ingestion-and-github.md)
(caps, security), `09-implementation-plan.md` WP 1.9, `CLAUDE.md` capability table.

## Files
- `apps/api/src/skills/*` *(modify)* — verify size/file-count caps + zip-bomb guard; clear 4xx
  messages; consistent error handling.
- `apps/web/src/features/skills/*` *(modify)* — `StatePanel`/`EmptyState`/`Skeleton` for empty/
  loading/error; security-strip polish; toasts.
- `.env.example`, `apps/api/src/config/env.ts` *(modify)* — `SKILL_MAX_FILE_BYTES`,
  `SKILL_MAX_TOTAL_BYTES`, `SKILL_MAX_FILES` (documented, on the `/data` volume where relevant).
- `CLAUDE.md`, `research/skill-registry/README.md` *(modify)* — mark Skills registry/inspector built.

## Acceptance
- [ ] Oversized/zip-bomb/malformed inputs are rejected with clear messages and no partial state; caps
      are env-configurable and documented.
- [ ] Every Skills surface has honest empty/loading/error states; scripts + network-reference flags
      are visible in the inspector.
- [ ] Docs updated (capability table + research README); `docker compose up --build` serves the
      feature.
- [ ] Repo gate green. **Owner-verify (localhost:8080):** end-to-end manual pass in the container.

## Notes
No new contract/deps. Pure hardening + docs; safe to run solo at the end of Phase 1.
