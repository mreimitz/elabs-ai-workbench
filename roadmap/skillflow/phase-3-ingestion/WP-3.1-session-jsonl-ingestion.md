# WP 3.1 — Claude Code session JSONL ingestion → shared trace vocabulary

**Phase:** 3 · **Size:** L · **Depends on:** 2.2

## Objective
The one genuinely new subsystem: upload an external **Claude Code session log** (JSONL), normalize
it into the same `TraceEvent` vocabulary internal runs use, persist it, and make it selectable in
the Trace tab alongside runs — so skills exercised *outside* this app (real Claude Code sessions)
get the same conformance overlay.

## Why / references
D6 (two normalizers, one vocabulary). The external format differs from `run_steps` (this app's
runtime is a Vercel AI SDK loop, not Claude Code) — normalization is the whole point. Caps +
redaction rules in [`../conventions.md`](../conventions.md) §Ingestion caps.

## Files
- `apps/api/src/db/schema.ts` + `db/database.ts` + `db/rows.ts` *(modify)* — additive
  `session_traces` (`id, label, skill_id?, skill_version_id?, source_meta_json, event_count,
  bytes, created_at` — skill refs denormalized, not FK-cascaded, same immutability stance as
  `run_skills`) and `session_trace_events` (`session_id FK CASCADE, idx, type, payload_json`
  **redacted before persistence**).
- `apps/api/src/skillflow/session-ingest.ts` *(create)* — streaming JSONL parse with
  `SESSION_MAX_BYTES`/`SESSION_MAX_EVENTS` caps (reject, don't truncate silently); map Claude Code
  entries (assistant turns, tool_use/tool_result incl. Bash exit codes, Read/file accesses,
  subagent Task spawns, user messages) → `TraceEvent[]`; redact obvious credential material from
  payloads before persistence (reuse the run-payload redaction discipline); unknown entry types →
  counted + reported, not fatal.
- `apps/api/src/skillflow/routes.ts` *(modify)* — `POST /api/sessions` (multipart upload, optional
  `skillId`/`skillVersionId` link), `GET /api/sessions`, `GET /api/sessions/:id`,
  `DELETE /api/sessions/:id`, and `GET /api/skills/:id/versions/:vid/trace?sessionId=…` (same
  align pipeline as runs).
- `apps/api/src/config/env.ts` + `.env.example` *(modify)* — `SESSION_MAX_BYTES`,
  `SESSION_MAX_EVENTS`.
- `apps/web/src/features/skills/trace/SkillTraceView.tsx` *(modify)* — source picker gains
  "Uploaded sessions" (upload via the existing `FileUpload` pattern; list + delete with confirm).
- `apps/api/test/skillflow-session-ingest.test.ts` *(create)* — fixture JSONL (checked-in,
  sanitized): normalization correctness, cap rejection, unknown-type tolerance, redaction, full
  upload→align round trip.

## Acceptance
- [ ] A real (sanitized fixture) Claude Code session JSONL uploads, normalizes, persists, and
      aligns against a skill version through the identical WP 2.2 pipeline — no aligner changes.
- [ ] Caps enforced with clear 4xx errors; payloads redacted at rest; delete cascades events and
      confirms in the UI.
- [ ] The app performs **no execution** of anything found in the log (observation only, D4).
- [ ] Repo gate green.

## Notes
Session logs are untrusted external content — treat payload text as data, never interpolate it
into anything executable, and keep it out of API logs.
