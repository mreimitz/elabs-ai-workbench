# WP 4.4 — End-to-end verification

**Phase:** 4 · **Size:** M · **Depends on:** all

## Objective
Prove the whole feature works against the running app and report honestly.

## Why / references
`.claude/rules/quality-gates.md` (the gate + honest reporting: lead with what you did **not** verify;
visual claims cite the real running app, never a mock).

## The gate
```bash
pnpm typecheck && pnpm test && pnpm build
```
must be green from the repo root.

## Live walkthrough (at http://localhost:8080)
1. Add a provider credential (Anthropic) — confirm the key is never echoed back (`hasKey` only).
2. Create a scenario (model, allow-list with a per-tool toggle, guardrails, profiles) and a test
   (prompt + an attachment).
3. **Automated run:** watch the conversation stream, the KPI counters tick, and the context chart
   fill with composition + the limit line. Inspect ≥2 packets (request/response/tokens/raw).
4. **Interactive run:** send a follow-up turn; confirm settings stay locked.
5. **Guardrail:** set a tiny token budget; confirm the run stops and names the reason.
6. **Overflow:** force a context overflow (small-context model or huge input); confirm
   `context_overflow` is recorded and marked on the chart (not a crash).
7. **Replay:** reopen the run; scrub; confirm panes reconstruct per step; export JSON + Markdown.
8. **Compare:** run the same test on a second scenario; confirm the matrix + curve overlay.
9. **Themes:** spot-check both (light, dark).

## Acceptance / reporting
- Gate green; the walkthrough completes with screenshots/notes.
- Report leads with anything unverified (e.g. providers without a key, multimodal attachments).
- File any real defects for the owner; do not paper over failures (`quality-gates.md`).
